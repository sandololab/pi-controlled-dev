import test from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoveryFixture } from './recovery-fixture.mjs';
const {classifyRecoveryState,recoverLocks}=await import('../src/recovery.ts');
const {currentProcessIncarnation,inspectProcessOwner}=await import('../src/process-incarnation.ts');
const {LockManager}=await import('../src/lock-manager.ts');
const {DurableStore}=await import('../src/store.ts');
const script=fileURLToPath(new URL('./recovery-fixture.mjs',import.meta.url));
function root(t){const path=mkdtempSync(join(tmpdir(),'recovery-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path}
function dead(t,phase='BLOCKED',run='TERMINAL'){
  const result=spawnSync(process.execPath,[script,'owner',root(t),phase,run],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
const classify=f=>classifyRecoveryState(f.data,f.storeRoot).recovery;
const recover=(f,fault)=>recoverLocks(f.data,f.storeRoot,fault);
const snapshot=f=>['state.json','events.jsonl'].map(name=>readFileSync(join(f.storeRoot,name),'utf8'));
const overwrite=(path,value)=>{chmodSync(path,0o600);writeFileSync(path,typeof value==='string'?value:JSON.stringify(value))};
const audits=f=>readdirSync(join(f.data,'controlled-dev','locks')).filter(name=>name.startsWith('recovery-'));
const guard=f=>f.locks.workspace.path.replace(/\.lock$/,'.guard');
function subprocess(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[script,...args],{stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);child.on('error',reject);
  child.on('exit',code=>code===0?resolve(JSON.parse(out)):reject(new Error(err)));})}

test('P16A TEST-030 Linux process incarnation protects PID reuse and unsupported evidence',()=>{
  const owner=currentProcessIncarnation();assert.ok(owner,'Real-process probe requires verified local procfs');
  assert.equal(inspectProcessOwner(owner).status,'LIVE');
  assert.equal(inspectProcessOwner({...owner,startTicks:String(BigInt(owner.startTicks)+1n)}).reason,'PID_REUSED_DIFFERENT_START_MARKER');
  for(const altered of [undefined,{...owner,pid:-1},{...owner,bootId:'foreign'},{...owner,pidNamespace:'foreign'},{...owner,platform:'other'}])
    assert.equal(inspectProcessOwner(altered).status,'UNCERTAIN');
});
test('P16A TEST-030 same-process live P14D handle and different session deny reclaim',t=>{
  const f=recoveryFixture(root(t)),before=snapshot(f);assert.equal(classify(f).lockOwnerStatus,'LIVE');
  assert.equal(recover(f).reclaimed,false);assert.equal(classify(f).safeReclaimPossible,false);
  assert.deepEqual(snapshot(f),before);assert.deepEqual(audits(f),[]);
  assert.throws(()=>new LockManager(f.data,'different','reload').acquire('task',f.repo));
  f.manager.releaseAll(f.locks);assert.equal(classify(f).classification,'CLEAN_NONTERMINAL');
});
test('P16A TEST-030 real process A alive then SIGKILL; process B classifies/reclaims',async t=>{
  const child=spawn(process.execPath,[script,'owner',root(t),'BLOCKED','TERMINAL','hold'],{stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill('SIGKILL'));let out='';
  const f=await new Promise((resolve,reject)=>{child.stdout.on('data',v=>{out+=v;if(out.includes('\n'))resolve(JSON.parse(out))});child.on('error',reject);child.on('exit',()=>reject(new Error('Owner failed')))});
  assert.equal(classify(f).lockOwnerStatus,'LIVE');assert.equal(classify(f).safeReclaimPossible,false);
  const exit=new Promise(resolve=>child.on('exit',resolve));child.kill('SIGKILL');await exit;
  const before=snapshot(f),s=classify(f);assert.equal(s.classification,'STALE_LOCK_PROVABLE');assert.equal(s.safeReclaimPossible,true);
  const result=await subprocess(['recover',f.data,f.storeRoot]);assert.equal(result.reclaimed,true);
  assert.equal(existsSync(f.locks.task.path),false);assert.equal(existsSync(f.locks.workspace.path),false);
  assert.deepEqual(snapshot(f),before);assert.equal(result.recovery.automaticResumeAllowed,false);
  const audit=JSON.parse(readFileSync(join(f.data,'controlled-dev','locks',`${result.auditId}.json`)));
  assert.equal(audit.authorization,'RECLAIM_LOCK_PAIR_ONLY');assert.equal(audit.quiescenceProof.length,1);
  assert.ok(audit.oldOwners.every(o=>o.deathProof.status==='DEAD'&&o.record.processIncarnation.startTicks));
  assert.equal(recover(f).reclaimed,false);
});
for(const phase of ['PENDING','ANALYZING','BLOCKED','AWAITING_HUMAN','FAILED'])test(`P16A TEST-035/039/046 ${phase} remains persisted after reclaim`,t=>{
  const f=dead(t,phase,phase==='PENDING'?'NONE':'TERMINAL'),before=snapshot(f);
  assert.equal(classify(f).classification,'STALE_LOCK_PROVABLE');assert.equal(recover(f).reclaimed,true);
  assert.equal(DurableStore.load(f.storeRoot).state.state,phase);assert.deepEqual(snapshot(f),before);
  assert.equal(classify(f).automaticResumeAllowed,false);
  assert.equal(classify(f).classification,phase==='FAILED'?'CLEAN_TERMINAL':['PENDING','AWAITING_HUMAN'].includes(phase)?'CLEAN_NONTERMINAL':'INTERRUPTED_WITH_PROVEN_TERMINAL_CHILDREN');
});
for(const run of ['INTENT','UNKNOWN','RUNNING'])test(`P16A TEST-028 ${run} prevents reclaim and redispatch`,t=>{
  const f=dead(t,'BLOCKED',run),before=snapshot(f);assert.equal(classify(f).classification,'INTERRUPTED_WITH_UNKNOWN_CHILD');
  assert.equal(recover(f).reclaimed,false);assert.equal(existsSync(f.locks.task.path),true);assert.deepEqual(snapshot(f),before);
});
for(const alteration of ['legacy','different-boot','missing-marker','old-time','different-session'])test(`P16A TEST-030 uncertain ${alteration} never authorizes deletion`,t=>{
  const f=dead(t);
  for(const l of Object.values(f.locks)){
    const record={...l.record};
    if(alteration==='legacy'){record.schemaVersion=1;delete record.processIncarnation}
    if(alteration==='different-boot')record.processIncarnation={...record.processIncarnation,bootId:'foreign'};
    if(alteration==='missing-marker')delete record.processIncarnation.startTicks;
    if(alteration==='old-time'){delete record.processIncarnation;record.acquiredAt='1970-01-01T00:00:00.000Z'}
    if(alteration==='different-session'){delete record.processIncarnation;record.ownerSessionId='other'}
    overwrite(l.path,record);
  }
  assert.equal(classify(f).classification,'LOCK_OWNER_UNCERTAIN');assert.equal(recover(f).reclaimed,false);assert.deepEqual(audits(f),[]);
});
for(const damage of ['missing-proof','corrupt-proof','contradictory-proof','snapshot','wal-tail'])test(`P16A TEST-029 ${damage} is inconsistent, no repair`,t=>{
  const f=dead(t),proof=join(f.storeRoot,'artifacts','terminal-proof');
  if(damage==='missing-proof')rmSync(proof);
  if(damage==='corrupt-proof')overwrite(proof,'{');
  if(damage==='contradictory-proof'){const p=JSON.parse(readFileSync(proof));p.provider.instances[0].exitCode=null;overwrite(proof,p)}
  if(damage==='snapshot')overwrite(join(f.storeRoot,'state.json'),'{}');
  if(damage==='wal-tail')appendFileSync(join(f.storeRoot,'events.jsonl'),'{');
  const before=snapshot(f);assert.equal(classify(f).classification,'STORE_INCONSISTENT');assert.equal(recover(f).reclaimed,false);
  assert.deepEqual(snapshot(f),before);assert.equal(existsSync(f.locks.workspace.path),true);
});
for(const point of ['afterAuthorization','afterTaskRemoval','beforeWorkspaceRemoval'])test(`P16A TEST-034 ${point} fault retains audit and pair guard`,t=>{
  const f=dead(t),before=snapshot(f);
  assert.throws(()=>recover(f,p=>{if(p===point)throw new Error('injected')}),/injected/);
  assert.equal(audits(f).length,1);assert.equal(existsSync(f.locks.task.path),point==='afterAuthorization');
  assert.equal(existsSync(f.locks.workspace.path),true);assert.equal(existsSync(guard(f)),true);
  assert.equal(classify(f).reason,'LOCK_MUTATION_OR_PARTIAL_RECOVERY_PENDING');assert.equal(recover(f).reclaimed,false);
  const manager=new LockManager(f.data,'new','new');assert.throws(()=>manager.acquire('task',f.repo),/EEXIST/);
  assert.deepEqual(snapshot(f),before);
});
for(const kind of ['task','workspace'])test(`P16A TEST-034 actual ${kind} unlink failure retains durable authorization and exclusion`,t=>{
  const f=dead(t),unlink=fs.unlinkSync;
  t.mock.method(fs,'unlinkSync',path=>{if(path===f.locks[kind].path)throw Object.assign(new Error('injected unlink EACCES'),{code:'EACCES'});return unlink(path)});
  syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports()});
  assert.throws(()=>recover(f),/injected unlink EACCES/);
  assert.equal(audits(f).length,1);assert.equal(existsSync(guard(f)),true);assert.equal(existsSync(f.locks.workspace.path),true);
  assert.equal(existsSync(f.locks.task.path),kind==='task');assert.equal(classify(f).safeReclaimPossible,false);
});
test('P16A TEST-034 recovery mutex acquisition fails without audit or lock deletion',t=>{
  const f=dead(t);assert.throws(()=>recover(f,p=>{if(p==='beforeMutex')writeFileSync(guard(f),'another-owner',{flag:'wx'})}),/EEXIST/);
  assert.equal(audits(f).length,0);assert.equal(existsSync(f.locks.task.path),true);assert.equal(existsSync(f.locks.workspace.path),true);
});
test('P16A TEST-030 pair with one missing or uncertain lock is not partly reclaimed',t=>{
  for(const change of ['missing','uncertain']){
    const f=dead(t);if(change==='missing')rmSync(f.locks.task.path);else {const r={...f.locks.task.record};delete r.processIncarnation;overwrite(f.locks.task.path,r)}
    assert.equal(classify(f).classification,'LOCK_OWNER_UNCERTAIN');assert.equal(recover(f).reclaimed,false);assert.equal(existsSync(f.locks.workspace.path),true);
  }
});
test('P16A TEST-030 ABA between initial classification and mutex leaves new ownership intact',t=>{
  const f=dead(t);let newer;
  const result=recover(f,p=>{if(p==='beforeMutex'){
    rmSync(f.locks.task.path);rmSync(f.locks.workspace.path);
    newer=new LockManager(f.data,'new-owner','new-generation');newer.held=newer.acquire('task',f.repo);
  }});
  assert.equal(result.reclaimed,false);assert.equal(newer.verifyTaskLock(newer.held.task),true);assert.equal(newer.verifyWorkspaceLock(newer.held.workspace),true);
  assert.equal(audits(f).length,0);newer.releaseAll(newer.held);
});
test('P16A TEST-030 double real-process recovery has exactly one authorization',async t=>{
  const f=dead(t),before=snapshot(f),results=await Promise.all([subprocess(['recover',f.data,f.storeRoot]),subprocess(['recover',f.data,f.storeRoot])]);
  assert.equal(results.filter(r=>r.reclaimed).length,1);assert.equal(audits(f).length,2);assert.deepEqual(snapshot(f),before);
  assert.equal(existsSync(guard(f)),false);
});
