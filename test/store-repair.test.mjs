import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync,appendFileSync,unlinkSync,symlinkSync} from 'node:fs';
import {spawnSync,spawn} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {recoveryFixture} from './recovery-fixture.mjs';
const {repairStore,classifyStore}=await import('../src/store-repair.ts');
const {DurableStore}=await import('../src/store.ts');
const {hashBytes,hashContract}=await import('../src/contracts.ts');
const worker=fileURLToPath(new URL('./store-repair-worker.mjs',import.meta.url));
function root(t){const r=mkdtempSync(join(tmpdir(),'p16c-'));t.after(()=>rmSync(r,{recursive:true,force:true}));return r}
function paths(r){const data=join(r,'data'),repo=join(r,'repo');return {data,repo,store:join(data,'controlled-dev','projects',hashBytes(Buffer.from(repo)),'tasks','task')}}
function run(mode,r,point){const p=spawnSync(process.execPath,[worker,mode,r,...(point?[point]:[])],{encoding:'utf8',timeout:30000});
  if(p.signal)return p;assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout)}
function dead(t,point='wal'){const r=root(t),result=run('crash-owner',r,point);if(['wal','intent','terminal-wal'].includes(point))assert.equal(result.signal,'SIGKILL');return {r,...paths(r)}}
const image=f=>['events.jsonl','state.json','spec.json'].map(n=>{try{return readFileSync(join(f.store,n))}catch{return null}});
const audits=f=>readdirSync(f.store).filter(n=>/^repair-.*\.complete.json$/.test(n));

test('P16C clean is read-only/no-op, even with a live owner',t=>{
  const r=root(t),f=recoveryFixture(r),p={...paths(r)},before=image(p);
  assert.equal(classifyStore(p.data,p.store).classification,'CLEAN');assert.equal(repairStore(p.data,p.store).repaired,false);
  assert.deepEqual(image(p),before);assert.deepEqual(audits(p),[]);f.manager.releaseAll(f.locks);
});
test('P16C real SIGKILL WAL-ahead, production repair in another process, exact history and counters, reload/idempotence',t=>{
  const f=dead(t),before=image(f),head=DurableStore.readHistory(f.store),status=classifyStore(f.data,f.store);
  assert.equal(status.classification,'REPAIRABLE');assert.equal(status.previousSnapshotRevision,0);assert.equal(status.validWalRevision,1);
  const result=run('command',f.r,'repair');assert.equal(result.denied,undefined);assert.equal(result.rpcCalls,0);assert.equal(result.confirmations,1);
  const ledger=DurableStore.load(f.store);assert.deepEqual(ledger,head);assert.deepEqual(ledger.state.counters,head.state.counters);
  assert.deepEqual(readFileSync(join(f.store,'events.jsonl')),before[0]);assert.deepEqual(readFileSync(join(f.store,'spec.json')),before[2]);
  const a=JSON.parse(readFileSync(join(f.store,audits(f)[0])));assert.equal(a.previousFsyncStatus,'UNKNOWN');assert.equal(a.repairFsyncPerformed,true);
  assert.equal(a.previousSnapshotRevision,0);assert.equal(a.rebuiltSnapshotRevision,1);assert.equal(a.automaticResumeAllowed,false);
  const after=image(f);assert.equal(run('repair',f.r).repaired,false);assert.deepEqual(image(f),after);assert.equal(audits(f).length,1);
});
for(const tail of [Buffer.from('{"revision":'),Buffer.from([0xf0,0x9f])])test('P16C truncated tail is preserved for audit, never applied',t=>{
  const f=dead(t,'clean');appendFileSync(join(f.store,'events.jsonl'),tail);const original=readFileSync(join(f.store,'events.jsonl'));
  assert.equal(classifyStore(f.data,f.store).classification,'REPAIRABLE');assert.equal(repairStore(f.data,f.store).repaired,true);
  assert.equal(DurableStore.load(f.store).truncatedTailBytes,0);
  const backup=readdirSync(f.store).find(n=>/^repair-.*\.wal$/.test(n));assert.deepEqual(readFileSync(join(f.store,backup)),original);
});
for(const damage of ['snapshot-ahead','snapshot-conflict','hash','revision-gap','missing-artifact','invalid-event','encoding'])test(`P16C ${damage} is corrupt and cannot reconstruct`,t=>{
  const f=dead(t),wal=join(f.store,'events.jsonl'),snapshot=join(f.store,'state.json'),state=JSON.parse(readFileSync(snapshot));
  if(damage==='snapshot-ahead'){state.revision=9;writeFileSync(snapshot,JSON.stringify(state))}
  if(damage==='snapshot-conflict'){state.ownerSessionId='other';writeFileSync(snapshot,JSON.stringify(state))}
  if(['hash','revision-gap','invalid-event'].includes(damage)){const lines=readFileSync(wal,'utf8').trimEnd().split('\n'),e=JSON.parse(lines[1]);
    if(damage==='hash')e.eventHash='0'.repeat(64);if(damage==='revision-gap'){e.revision=3;e.previousRevision=2;e.eventHash=hashContract('TransitionEvent',e);}if(damage==='invalid-event')e.kind='invented';
    lines[1]=JSON.stringify(e);writeFileSync(wal,lines.join('\n')+'\n')}
  if(damage==='missing-artifact')unlinkSync(join(f.store,'artifacts','recovery-fixture-state'));
  if(damage==='encoding')appendFileSync(wal,Buffer.from([0xff,10]));
  const before=image(f);assert.equal(classifyStore(f.data,f.store).classification,'CORRUPT');assert.throws(()=>repairStore(f.data,f.store));assert.deepEqual(image(f),before);
});
test('P16C real external process after durable INTENT, killed owner, no inferred outcome or duplicate effect',t=>{
  const f=dead(t,'intent'),before=image(f);assert.equal(readFileSync(join(f.r,'effect'),'utf8'),'once');
  const status=classifyStore(f.data,f.store);assert.equal(status.classification,'AMBIGUOUS');assert.equal(status.reason,'RECOVERY_AMBIGUOUS');
  assert.equal(status.intents[0].outcome,'AMBIGUOUS');const result=run('command',f.r,'repair');assert.equal(result.denied,'RECOVERY_AMBIGUOUS');
  assert.equal(result.rpcCalls,0);assert.equal(result.confirmations,1);assert.deepEqual(image(f),before);assert.deepEqual(audits(f),[]);
  assert.equal(readFileSync(join(f.r,'effect'),'utf8'),'once');assert.equal(run('command',f.r,'status').status.reason,'RECOVERY_AMBIGUOUS');
});
for(const point of ['afterAuthorization','afterWalSync','afterSnapshotSync','afterRename','beforeJournal','afterJournal'])test(`P16C interrupted repair ${point}, durable generation claims and restart`,t=>{
  const f=dead(t);assert.equal(run('repair',f.r,point).signal,'SIGKILL');
  assert.equal(classifyStore(f.data,f.store).classification,'REPAIRABLE');const result=run('repair',f.r);assert.equal(result.denied,undefined);assert.equal(result.repaired,true);
  assert.equal(DurableStore.load(f.store).state.revision,1);assert.equal(run('repair',f.r).repaired,false);
});
test('P16C live owner and legacy ownerless guard deny mutation',t=>{
  const r=root(t),f=recoveryFixture(r,'BLOCKED'),p=paths(r);appendFileSync(join(p.store,'events.jsonl'),'{');
  const before=image(p);assert.throws(()=>repairStore(p.data,p.store),/OWNER_UNCERTAIN/);assert.deepEqual(image(p),before);f.manager.releaseAll(f.locks);
  const d=dead(t),guard=join(d.data,'controlled-dev','locks','workspaces',`${hashBytes(Buffer.from(d.repo))}.guard`);writeFileSync(guard,'legacy-token');
  assert.throws(()=>repairStore(d.data,d.store),/RECOVERY_AMBIGUOUS/);assert.equal(readFileSync(guard,'utf8'),'legacy-token');
});
test('P16C rejects foreign and symlink store paths',t=>{
  const f=dead(t),link=join(f.r,'alias');symlinkSync(f.store,link);assert.throws(()=>repairStore(f.data,link));
  assert.throws(()=>repairStore(join(f.r,'other'),f.store));
});
test('P16C two repair processes race: one metadata commit, no history duplication',async t=>{
  const f=dead(t);const launch=()=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,[worker,'repair',f.r]);let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);
    p.on('error',reject);p.on('close',code=>code?reject(new Error(err)):resolve(JSON.parse(out)))});
  const results=await Promise.all([launch(),launch()]);assert.equal(results.filter(r=>r.repaired).length,1);
  assert.equal(audits(f).length,1);assert.equal(DurableStore.load(f.store).events.length,2);
});
for(const point of ['afterAuthorization','afterTaskRemoval','beforeWorkspaceRemoval'])test(`P16C finish previously authorized interrupted lock reclaim ${point}`,t=>{
  const f=dead(t,'clean'),before=image(f);assert.equal(run('reclaim-crash',f.r,point).signal,'SIGKILL');
  assert.equal(classifyStore(f.data,f.store).classification,'REPAIRABLE');const result=run('repair',f.r);
  assert.equal(result.denied,undefined);assert.equal(result.repaired,true);assert.deepEqual(image(f),before);
  const locks=join(f.data,'controlled-dev','locks');assert.equal(readdirSync(join(locks,'tasks')).filter(n=>n.endsWith('.lock')).length,0);
  assert.equal(readdirSync(join(locks,'workspaces')).filter(n=>n.endsWith('.lock')||n.endsWith('.guard')).length,0);
  assert.equal(readdirSync(locks).filter(n=>n.endsWith('-complete.json')).length,1);
});
test('P16C contradictory repair journal stays blocked; original WAL and snapshot untouched',t=>{
  const f=dead(t);assert.equal(run('repair',f.r,'afterAuthorization').signal,'SIGKILL');
  const name=readdirSync(f.store).find(n=>/^repair-[a-f0-9-]+\.json$/.test(n)),path=join(f.store,name),a=JSON.parse(readFileSync(path));
  a.previousSnapshotRevision=999;writeFileSync(path,JSON.stringify(a));const before=image(f);
  assert.equal(classifyStore(f.data,f.store).classification,'CORRUPT');assert.throws(()=>repairStore(f.data,f.store));assert.deepEqual(image(f),before);
});
test('P16C exact existing terminal proof closes physical execution only, nonzero counters preserved',t=>{
  const f=dead(t,'terminal-wal'),before=DurableStore.readHistory(f.store);assert.equal(before.state.counters.dispatches,1);
  assert.equal(classifyStore(f.data,f.store).intents[0].outcome,'COMPLETED');assert.equal(repairStore(f.data,f.store).repaired,true);
  assert.deepEqual(DurableStore.load(f.store),before);assert.equal(DurableStore.load(f.store).state.state,'BLOCKED');
});
test('P16C absent complete INTENT event does not turn an orphan artifact into authority',t=>{
  const f=dead(t,'clean');writeFileSync(join(f.store,'artifacts','orphan-intent'),JSON.stringify({status:'INTENT',explanation:'not dispatched'}));
  const before=image(f);assert.equal(classifyStore(f.data,f.store).classification,'CLEAN');assert.equal(repairStore(f.data,f.store).repaired,false);
  assert.deepEqual(image(f),before);
});
