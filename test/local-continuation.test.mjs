import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {installSourceLoader} from './load-source.mjs';
import {fixtures,TIME} from './contract-fixtures.mjs';
installSourceLoader();
const api=await import('../src/contracts.ts');
const {DurableStore}=await import('../src/store.ts');
const {LockManager}=await import('../src/lock-manager.ts');
const {CentralOrchestrator}=await import('../src/orchestrator.ts');
const {releaseLocalContinuation,acquireLocalContinuation}=await import('../src/local-continuation.ts');
const {recoveryFixture}=await import('./recovery-fixture.mjs');
const inspect=()=> 'ACCEPT';
function root(t){const path=mkdtempSync(join(tmpdir(),'local-continuation-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
function fixture(t,fault){
 const base=root(t),repo=join(base,'repo'),data=join(base,'data');mkdirSync(repo);mkdirSync(data);
 const store=DurableStore.create(data,repo,'task',inspect),f=fixtures(api),source=store.put('source','input','text/plain');
 const spec={...f.TaskSpec,scope:{...f.TaskSpec.scope,repoRoot:repo},plan:{...f.InputSource,snapshot:source},currentTask:{...f.InputSource,snapshot:source}};
 spec.specHash=api.hashContract('TaskSpec',spec);
 const manager=new LockManager(data,'owner','initial-generation',fault),locks=manager.acquire('task',repo);
 const workflow=CentralOrchestrator.initialize(spec,{ownerSessionId:'owner',runners:{},store,lockManager:manager,locks,artifacts:[source],now:()=>TIME});
 const session=join(base,'session.jsonl');writeFileSync(session,JSON.stringify({type:'session',version:3,id:'owner',cwd:repo})+'\n'+JSON.stringify({type:'message',message:{role:'user',content:'Persistence fixture'}})+'\n');
 return {base,repo,data,store,storeRoot:store.root,manager,locks,workflow,session};
}
const completed=f=>readdirSync(join(f.storeRoot,'artifacts')).filter(name=>name.startsWith('local-release-complete-'));
const guard=f=>join(f.manager.root,'workspaces',f.locks.workspace.record.workspaceHash+'.guard');
const acquire=(f,owner='owner')=>acquireLocalContinuation(f.data,f.storeRoot,owner,inspect);

test('orderly release preserves the exact ledger and retires old authority before same-owner acquisition',t=>{
 const f=fixture(t),before=DurableStore.load(f.storeRoot);
 f.workflow.releaseOnSessionShutdown(f.session);
 assert.equal(completed(f).length,1);assert.equal(existsSync(f.locks.task.path),false);assert.equal(existsSync(f.locks.workspace.path),false);
 assert.equal(f.manager.verifyTaskLock(f.locks.task),false);assert.throws(()=>f.workflow.saveCheckpoint(f.workflow.state.revision),/AUTHORITY_RETIRED/);
 const next=acquire(f);assert.ok(next);assert.equal(next.manager.ownerSessionId,'owner');assert.notEqual(next.locks.task.record.token,f.locks.task.record.token);
 assert.notEqual(next.locks.workspace.record.token,f.locks.workspace.record.token);assert.deepEqual(next.ledger,before);
 assert.deepEqual(DurableStore.load(f.storeRoot),before);assert.ok(next.manager.verifyTaskLock(next.locks.task));assert.ok(next.manager.verifyWorkspaceLock(next.locks.workspace));
});

test('release has one consumer and cannot be replayed after the successor releases its locks',t=>{
 const f=fixture(t);f.workflow.releaseOnSessionShutdown(f.session);const next=acquire(f);assert.ok(next);
 assert.throws(()=>acquire(f));next.manager.releaseAll(next.locks);
 assert.throws(()=>acquire(f),/LOCAL_CONTINUATION_UNAVAILABLE/);assert.equal(existsSync(f.locks.workspace.path),false);
});

test('two independent processes competing for one completed release admit exactly one successor',async t=>{
 const f=fixture(t);f.workflow.releaseOnSessionShutdown(f.session);
 const script=`import {installSourceLoader} from ${JSON.stringify(new URL('./load-source.mjs',import.meta.url).href)};installSourceLoader();const {acquireLocalContinuation}=await import(${JSON.stringify(new URL('../src/local-continuation.ts',import.meta.url).href)});try{const lease=acquireLocalContinuation(process.argv[1],process.argv[2],'owner',()=> 'ACCEPT');process.exit(lease?0:3)}catch{process.exit(2)}`;
 const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',script,f.data,f.storeRoot],{stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',chunk=>error+=chunk);child.on('error',reject);child.on('exit',code=>resolve({code,error}));});
 const results=await Promise.all([run(),run()]);assert.deepEqual(results.map(r=>r.code).sort(),[0,2],JSON.stringify(results));
 assert.ok(existsSync(f.locks.task.path));assert.ok(existsSync(f.locks.workspace.path));
});

test('different owner, altered ledger head and changed lock token do not become continuation authority',t=>{
 const different=fixture(t);different.workflow.releaseOnSessionShutdown(different.session);
 assert.throws(()=>acquire(different,'another-session'));assert.equal(existsSync(different.locks.workspace.path),false);
 const changedHead=fixture(t);changedHead.workflow.releaseOnSessionShutdown(changedHead.session);
 appendFileSync(join(changedHead.storeRoot,'events.jsonl'),'partial-uncommitted-event');
 assert.throws(()=>acquire(changedHead));assert.equal(existsSync(changedHead.locks.workspace.path),false);
 const changedToken=fixture(t);const old=JSON.parse(readFileSync(changedToken.locks.task.path,'utf8'));
 writeFileSync(changedToken.locks.task.path,JSON.stringify({...old,token:'00000000-0000-4000-8000-000000000000'}));
 assert.throws(()=>changedToken.workflow.releaseOnSessionShutdown(changedToken.session));assert.equal(completed(changedToken).length,0);
 assert.ok(existsSync(changedToken.locks.workspace.path));
});

test('missing or different persisted session is rejected without releasing the existing pair',t=>{
 for(const kind of ['missing','different']){const f=fixture(t);if(kind==='different')writeFileSync(f.session,JSON.stringify({type:'session',id:'foreign',cwd:f.repo})+'\n');
  assert.throws(()=>f.workflow.releaseOnSessionShutdown(kind==='missing'?undefined:f.session));assert.equal(completed(f).length,0);
  assert.ok(f.manager.verifyTaskLock(f.locks.task));assert.ok(f.manager.verifyWorkspaceLock(f.locks.workspace));}
});

test('failure before pair deletion retains guard and old locks and publishes no usable release',t=>{
 const f=fixture(t,point=>{if(point==='beforeRelease')throw new Error('injected-release-fault')});
 assert.throws(()=>f.workflow.releaseOnSessionShutdown(f.session),/injected-release-fault/);
 assert.ok(existsSync(guard(f)));assert.ok(existsSync(f.locks.task.path));assert.ok(existsSync(f.locks.workspace.path));assert.equal(completed(f).length,0);
 assert.equal(acquire(f),undefined);assert.throws(()=>f.workflow.saveCheckpoint(f.workflow.state.revision),/AUTHORITY_RETIRED/);
});

test('failure publishing completion after pair removal retains guard and prevents acquisition',t=>{
 const f=fixture(t),put=f.store.put.bind(f.store);f.store.put=(id,...args)=>{if(id.startsWith('local-release-complete-'))throw new Error('injected-completion-fault');return put(id,...args);};
 assert.throws(()=>f.workflow.releaseOnSessionShutdown(f.session),/injected-completion-fault/);
 assert.ok(existsSync(guard(f)));assert.equal(existsSync(f.locks.task.path),false);assert.equal(existsSync(f.locks.workspace.path),false);
 assert.equal(completed(f).length,0);assert.equal(acquire(f),undefined);
 assert.throws(()=>new LockManager(f.data,'owner','another').acquire('task',f.repo));
});

test('uncertain consumption retains both successor locks and the guard without exposing authority',t=>{
 const f=fixture(t),before=DurableStore.load(f.storeRoot);f.workflow.releaseOnSessionShutdown(f.session);
 const put=DurableStore.prototype.put;
 t.mock.method(DurableStore.prototype,'put',function(id,...args){if(id.startsWith('local-release-consumed-'))throw new Error('injected-consume-fault');return put.call(this,id,...args);});
 assert.throws(()=>acquire(f),/injected-consume-fault/);assert.ok(existsSync(guard(f)));
 assert.ok(existsSync(f.locks.task.path));assert.ok(existsSync(f.locks.workspace.path));
 const nextTask=JSON.parse(readFileSync(f.locks.task.path,'utf8'));assert.notEqual(nextTask.token,f.locks.task.record.token);
 assert.throws(()=>acquire(f));assert.deepEqual(DurableStore.load(f.storeRoot),before);
});

test('live or unknown children and unbound host command journals cannot produce an orderly release',t=>{
 for(const status of ['RUNNING','UNKNOWN']){const base=root(t),f=recoveryFixture(base,'BLOCKED',status),store=DurableStore.reopen(f.storeRoot,f.manager,f.locks,inspect),session=join(base,'session.jsonl');
  writeFileSync(session,JSON.stringify({type:'session',id:'owner',cwd:f.repo})+'\n');let retired=false;
  assert.throws(()=>releaseLocalContinuation({store,manager:f.manager,locks:f.locks,sessionFile:session,assertCurrent(){},retire(){retired=true;}}));
  assert.equal(retired,false);assert.equal(completed(f).length,0);assert.ok(f.manager.verifyWorkspaceLock(f.locks.workspace));}
 const f=fixture(t);writeFileSync(join(f.storeRoot,'artifacts','host-command-00000000-0000-4000-8000-000000000000-intent'),JSON.stringify({schemaVersion:1,phase:'INTENT'}));
 assert.throws(()=>f.workflow.releaseOnSessionShutdown(f.session),/HOST_COMMAND_TERMINATION_UNPROVEN/);
 assert.equal(completed(f).length,0);assert.ok(f.manager.verifyTaskLock(f.locks.task));assert.ok(f.manager.verifyWorkspaceLock(f.locks.workspace));
});

test('an existing pending implementation gate can be re-presented and accepted after same-owner orderly recovery',async t=>{
 const {currentProcessIncarnation}=await import('../src/process-incarnation.ts');
 if(!currentProcessIncarnation()){t.skip('PROCESS_INCARNATION_UNAVAILABLE: requires the authorized runtime process environment');return;}
 const {restartFixture}=await import('./recovery-fixture.mjs');
 const {takeOverWorkflow}=await import('../src/recovery-resume.ts');
 const {presentHumanGate}=await import('../src/orchestrator.ts');
 let original;const base=root(t),f=await restartFixture(base,'AWAITING_HUMAN',false,false,{},undefined,{onWorkflowCreated:o=>original=o});
 const before=DurableStore.load(f.storeRoot);assert.equal(before.state.state,'AWAITING_HUMAN');
 assert.equal(before.state.runs.length,1);assert.equal(before.state.runs[0].role,'Scout');assert.ok(before.state.runs[0].resultRef);
 const session=join(base,'saved-session.jsonl');writeFileSync(session,JSON.stringify({type:'session',version:3,id:'owner',cwd:f.repo})+'\n'+JSON.stringify({type:'message',message:{role:'user',content:'Persistence fixture'}})+'\n');
 original.releaseOnSessionShutdown(session);
 const authority=takeOverWorkflow(f.data,f.storeRoot,'owner','Resume the same saved session',inspect);
 assert.equal(authority.classification,'VERIFIED_LOCAL_ORDERLY_RELEASE');
 const recovered=CentralOrchestrator.restore(authority,{}),channel={mode:'tui',sessionManager:{getSessionId:()=> 'owner'},ui:{async confirm(){return true;}}};
 const request=recovered.representPendingGate(channel);assert.equal(request.snapshot.gateId,before.state.pendingGateId);
 const receipt=await presentHumanGate(channel,request);assert.ok(receipt);recovered.acceptHumanDecision(request.snapshot,receipt);
 const after=DurableStore.load(f.storeRoot);assert.equal(after.state.state,'READY');assert.equal(after.state.taskId,before.state.taskId);
 assert.deepEqual(after.state.runs,before.state.runs);assert.deepEqual(after.state.counters,before.state.counters);
 assert.deepEqual(after.state.results,before.state.results);assert.equal(after.state.ownerSessionId,'owner');
 assert.equal(after.events.filter(e=>e.recordType==='SPAWN_INTENT').length,before.events.filter(e=>e.recordType==='SPAWN_INTENT').length);
 recovered.dispose();
});

async function postResultFixture(t,{reviewer=false,recover=true}={}){
 const {restartFixture}=await import('./recovery-fixture.mjs');
 let original;const base=root(t),f=await restartFixture(base,reviewer?'REVIEWER_TIMEOUT':'TESTING',false,false,{},undefined,{onWorkflowCreated:o=>original=o});
 if(original.state.state!=='BLOCKED')original.routeFailure({phase:'TESTING',source:'RECOVERY_CONFLICT',code:'POST_RESULT_TEST_BLOCK',subjectIds:['check'],evidenceRefs:['source']},
  {dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:false,writerTerminal:true,workspaceSafe:true,sameProtocol:true,concreteHumanResolution:false,duplicateEscalation:false},original.state.revision);
 assert.equal(original.state.state,'BLOCKED');assert.ok(original.state.candidate);assert.ok(original.state.runs.every(run=>run.status==='TERMINAL'));
 const session=join(base,'post-result-session.jsonl');writeFileSync(session,JSON.stringify({type:'session',version:3,id:'owner',cwd:f.repo})+'\n'+JSON.stringify({type:'message',message:{role:'user',content:'Post-result persistence fixture'}})+'\n');
 if(!recover)return {...f,original,session};
 original.releaseOnSessionShutdown(session);
 const {takeOverWorkflow,recoveryLease}=await import('../src/recovery-resume.ts'),authority=takeOverWorkflow(f.data,f.storeRoot,'owner','Close preserved post-result work',inspect);
 const lease=recoveryLease(authority),workflow=CentralOrchestrator.restore(authority,{});
 return {...f,original,session,workflow,lease};
}
async function requireProcess(t){const {currentProcessIncarnation}=await import('../src/process-incarnation.ts');if(currentProcessIncarnation())return true;t.skip('PROCESS_INCARNATION_UNAVAILABLE: requires the authorized runtime process environment');return false;}

test('confirmed post-result abandonment records FAILED while preserving candidate, Developer result and terminal Reviewer history',async t=>{
 if(!await requireProcess(t))return;const f=await postResultFixture(t,{reviewer:true}),before=DurableStore.load(f.storeRoot),output=join(before.state.candidate.root,'file.txt');
 const bytes=readFileSync(output),spec=DurableStore.readArtifact(f.storeRoot,before.state.spec);let confirmations=0;
 assert.ok(before.state.runs.some(run=>run.role==='Developer'&&run.resultRef));assert.ok(before.state.runs.some(run=>run.role==='Reviewer'&&run.terminalProofRef));
 await f.workflow.abandonRecovered({mode:'tui',sessionManager:{getSessionId:()=> 'owner'},ui:{async confirm(){confirmations++;return true;}}},'Explicitly close this incomplete post-result attempt');
 const after=DurableStore.load(f.storeRoot);assert.equal(confirmations,1);assert.equal(after.state.state,'FAILED');assert.equal(after.state.taskId,before.state.taskId);
 assert.deepEqual(after.state.candidate,before.state.candidate);assert.deepEqual(after.state.counters,before.state.counters);assert.deepEqual(after.state.runs,before.state.runs);
 assert.deepEqual(after.state.results,before.state.results);assert.deepEqual(readFileSync(output),bytes);assert.deepEqual(DurableStore.readArtifact(f.storeRoot,after.state.spec),spec);
 assert.equal(after.events.at(-1).transitionId,'TR-035');assert.equal(existsSync(f.lease.locks.task.path),false);assert.equal(existsSync(f.lease.locks.workspace.path),false);
});

test('post-result abandonment rejects candidate changes before and during confirmation and an uncertain host command',async t=>{
 if(!await requireProcess(t))return;
 for(const mode of ['before','during','host-command']){
  const f=await postResultFixture(t),before=DurableStore.load(f.storeRoot),output=join(before.state.candidate.root,'file.txt');let confirmations=0;
  if(mode==='before')writeFileSync(output,'unapproved candidate change\n');
  const channel={mode:'tui',sessionManager:{getSessionId:()=> 'owner'},ui:{async confirm(){confirmations++;
   if(mode==='during')writeFileSync(output,'candidate changed while the confirmation was open\n');
   if(mode==='host-command')writeFileSync(join(f.storeRoot,'artifacts','host-command-00000000-0000-4000-8000-000000000000-intent'),JSON.stringify({schemaVersion:1,phase:'INTENT'}));
   return true;}}};
  await assert.rejects(f.workflow.abandonRecovered(channel,'Close only if every preserved effect is still verified'));
  assert.equal(confirmations,mode==='before'?0:1);const after=DurableStore.load(f.storeRoot);
  if(mode==='host-command')assert.deepEqual(after,before);
  else{
   assert.equal(after.state.state,'BLOCKED');assert.equal(after.state.taskId,before.state.taskId);
   for(const key of ['candidate','runs','results','counters','spec','specHash','ownerSessionId'])assert.deepEqual(after.state[key],before.state[key]);
   assert.deepEqual(after.events.slice(0,before.events.length),before.events);
   assert.equal(after.events.length,before.events.length+1);assert.equal(after.events.at(-1).recordType,'EVIDENCE_INVALIDATED');
   assert.equal(after.events.at(-1).reason,'Candidate identity changed');assert.equal(after.events.at(-1).sourceState,'BLOCKED');assert.equal(after.events.at(-1).targetState,'BLOCKED');
   assert.ok(after.state.invalidEvidenceIds.length>before.state.invalidEvidenceIds.length);
  }
  assert.equal(after.events.slice(before.events.length).some(event=>event.transitionId==='TR-035'||event.recordType==='DECISION_RECORDED'),false);
  assert.equal(readdirSync(join(f.storeRoot,'artifacts')).some(name=>name.startsWith('abandon-')),false);
  assert.ok(f.lease.manager.verifyTaskLock(f.lease.locks.task));assert.ok(f.lease.manager.verifyWorkspaceLock(f.lease.locks.workspace));
 }
});
