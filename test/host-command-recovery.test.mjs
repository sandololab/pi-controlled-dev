import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,unlinkSync,writeFileSync,readdirSync,chmodSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {DurableStore}=await import('../src/store.ts');
const {inspectHostCommandRecovery}=await import('../src/host-command-recovery.ts');
const {classifyRecoveryState}=await import('../src/recovery.ts');
const {classifyResumeAction,takeOverWorkflow}=await import('../src/recovery-resume.ts');
const {CentralOrchestrator}=await import('../src/orchestrator.ts');
const {restartFixture}=await import('./recovery-fixture.mjs');
const here=fileURLToPath(new URL('./recovery-fixture.mjs',import.meta.url));
// This deadline covers a complete multi-step synthetic workflow under parallel CI,
// not a model or an approved command. Command timeouts remain unchanged.
function completed(t){const root=mkdtempSync(join(tmpdir(),'host-recovery-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const code=`import {restartFixture} from ${JSON.stringify(new URL('./recovery-fixture.mjs',import.meta.url).href)};const f=await restartFixture(${JSON.stringify(root)},'TESTING',false,false,undefined,undefined,{asyncValidation:true});console.log(JSON.stringify({data:f.data,storeRoot:f.storeRoot,state:f.state}));`;return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024}));}
test('a dead host with closed supervised checks can be recovered without consuming another model attempt',async t=>{
 const f=completed(t),ledger=DurableStore.load(f.storeRoot),status=inspectHostCommandRecovery(f.storeRoot,ledger);assert.equal(status.status,'QUIESCENT');assert.equal(status.supervisedTesting,true);assert.ok(status.operations>0);
 assert.equal(classifyRecoveryState(f.data,f.storeRoot).recovery.classification,'STALE_LOCK_PROVABLE');assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'RESUME_FROM_DURABLE_STATE');
 const authority=takeOverWorkflow(f.data,f.storeRoot,'successor','Resume closed host checks',()=> 'ACCEPT');const o=CentralOrchestrator.restore(authority,{});assert.deepEqual(o.state.counters,ledger.state.counters);assert.equal(o.state.candidate.digest,ledger.state.candidate.digest);assert.equal(o.state.runs.length,ledger.state.runs.length);
});
test('a missing terminal host record preserves UNKNOWN and refuses takeover despite terminal model runs',t=>{
 const f=completed(t);const name=readdirSync(join(f.storeRoot,'artifacts')).find(n=>n.startsWith('host-command-')&&n.endsWith('-intent'));
 const intent=JSON.parse(readFileSync(join(f.storeRoot,'artifacts',name),'utf8'));intent.operationId='host-command-'+randomUUID();writeFileSync(join(f.storeRoot,'artifacts',intent.operationId+'-intent'),JSON.stringify(intent));

 const ledger=DurableStore.load(f.storeRoot),status=inspectHostCommandRecovery(f.storeRoot,ledger);assert.notEqual(status.status,'QUIESCENT');assert.equal(classifyRecoveryState(f.data,f.storeRoot).recovery.safeReclaimPossible,false);assert.throws(()=>takeOverWorkflow(f.data,f.storeRoot,'successor','Uncertain check',()=> 'ACCEPT'));
});
test('altered or copied command ownership is rejected instead of manufacturing terminal evidence',t=>{
 const f=completed(t),name=readdirSync(join(f.storeRoot,'artifacts')).find(n=>n.startsWith('host-command-')&&n.endsWith('-intent')),path=join(f.storeRoot,'artifacts',name),raw=JSON.parse(readFileSync(path,'utf8'));raw.owner={...raw.owner,pid:1};chmodSync(path,0o600);writeFileSync(path,JSON.stringify(raw));
 assert.throws(()=>DurableStore.load(f.storeRoot)); // Completed evidence is hash-bound in the catalog.
});
test('a supervised validation cannot be followed by an unjournaled legacy command',async t=>{
 const root=mkdtempSync(join(tmpdir(),'host-recovery-legacy-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 let workflow;await restartFixture(root,'TESTING',false,false,undefined,undefined,{asyncValidation:true,onWorkflowCreated:o=>workflow=o});
 const before=workflow.state,events=workflow.events;
 assert.throws(()=>workflow.validateApproved(before.revision),e=>e.code==='HOST_COMMAND_ASYNC_REQUIRED');
 assert.deepEqual(workflow.state,before);assert.deepEqual(workflow.events,events);
});
