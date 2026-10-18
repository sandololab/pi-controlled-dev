import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installSourceLoader } from './load-source.mjs';
installSourceLoader();
const {classifyRecoveryState,recoverLocks}=await import('../src/recovery.ts');
const {DurableStore}=await import('../src/store.ts');
const {classifyStore,repairStore}=await import('../src/store-repair.ts');
const {classifyResumeAction,takeOverWorkflow}=await import('../src/recovery-resume.ts');
const hash=raw=>createHash('sha256').update(raw).digest('hex');
function inventory(root){return readdirSync(root,{withFileTypes:true}).flatMap(entry=>{
  assert.equal(entry.isSymbolicLink(),false);const path=join(root,entry.name);
  return entry.isDirectory()?inventory(path):[[path,hash(readFileSync(path))]];
}).sort()}

test('P16A/P16B TEST-028/030/039/046 preserved P14/P15 histories: copies only, no historical mutation',t=>{
  const source=process.env.P16A_HISTORICAL_DATA_ROOT;
  assert.ok(source,'Explicit historical data root required; this probe is not part of portable npm test');
  const original=join(source,'controlled-dev'),before=inventory(original),temporary=mkdtempSync(join(tmpdir(),'recovery-historical-'));
  t.after(()=>rmSync(temporary,{recursive:true,force:true}));
  const data=join(temporary,'copy');cpSync(source,data,{recursive:true,filter:path=>path===source||path.startsWith(original)});
  const states=new Set(),results=[];let intent=false,completed;
  const projects=join(data,'controlled-dev','projects');
  for(const project of readdirSync(projects))for(const task of readdirSync(join(projects,project,'tasks'))){
    const storeRoot=join(projects,project,'tasks',task),ledger=DurableStore.load(storeRoot),state=ledger.state;
    const snapshot=readFileSync(join(storeRoot,'state.json')),events=readFileSync(join(storeRoot,'events.jsonl'));
    const s=classifyRecoveryState(data,storeRoot).recovery;states.add(state.state);
    assert.equal(s.safeReclaimPossible,false);assert.equal(s.automaticResumeAllowed,false);assert.equal(recoverLocks(data,storeRoot).reclaimed,false);
    if(state.runs.some(r=>r.status==='INTENT')){intent=true;assert.equal(s.classification,'INTERRUPTED_WITH_UNKNOWN_CHILD');
      assert.equal(classifyStore(data,storeRoot).reason,'RECOVERY_AMBIGUOUS');assert.throws(()=>repairStore(data,storeRoot),/RECOVERY_AMBIGUOUS/)}
    if(['BLOCKED','ANALYZING','AWAITING_HUMAN'].includes(state.state)&&state.runs.every(r=>r.status==='TERMINAL')&&s.lockOwnerStatus!=='NONE')assert.equal(s.classification,'LOCK_OWNER_UNCERTAIN');
    assert.deepEqual(readFileSync(join(storeRoot,'state.json')),snapshot);assert.deepEqual(readFileSync(join(storeRoot,'events.jsonl')),events);
    let residualClassification;
    if(['BLOCKED','ANALYZING','AWAITING_HUMAN'].includes(state.state)&&state.runs.every(r=>r.status==='TERMINAL')&&s.lockOwnerStatus==='NONE'){
      // Some preserved stores no longer have their original lock files. Add legacy residuals ONLY to the copy.
      for(const kind of ['TASK','WORKSPACE']){
        const name=kind==='TASK'?hash(`${project}\0${state.taskId}`):project;
        const record={schemaVersion:1,kind,...(kind==='TASK'?{taskId:state.taskId}:{}),workspaceHash:project,
          ownerSessionId:state.ownerSessionId,runtimeGeneration:'historical-fixture',token:`legacy-${kind}`,acquiredAt:'2000-01-01T00:00:00.000Z'};
        writeFileSync(join(data,'controlled-dev','locks',kind==='TASK'?'tasks':'workspaces',`${name}.lock`),JSON.stringify(record),{flag:'wx'});
      }
      residualClassification=classifyRecoveryState(data,storeRoot).recovery.classification;
      assert.equal(residualClassification,'LOCK_OWNER_UNCERTAIN');assert.equal(recoverLocks(data,storeRoot).reclaimed,false);
    }
    const resume=classifyResumeAction(data,storeRoot);assert.equal(resume.automaticResumeAllowed,false);
    if(['COMPLETED','FAILED'].includes(state.state))assert.equal(resume.action,'NO_ACTION_TERMINAL');
    if(state.runs.some(r=>r.status==='INTENT'))assert.equal(resume.action,'P16C_REPAIR_REQUIRED');
    // Historical missing/legacy ownership cannot be promoted into proven-dead ownership.
    assert.throws(()=>takeOverWorkflow(data,storeRoot,'historical-probe','Explicit negative historical reconciliation',()=> 'ACCEPT'));
    assert.deepEqual(readFileSync(join(storeRoot,'state.json')),snapshot);assert.deepEqual(readFileSync(join(storeRoot,'events.jsonl')),events);
    results.push({state:state.state,classification:s.classification,residualClassification,resumeAction:resume.action,takeoverDenied:true});if(state.state==='COMPLETED')completed={storeRoot,state,project,snapshot,events};
  }
  for(const state of ['BLOCKED','ANALYZING','AWAITING_HUMAN','COMPLETED'])assert.ok(states.has(state),state);assert.ok(intent);assert.ok(completed);
  // Additional copied-COMPLETED regression: residual lock fixture with an actually exited Node incarnation.
  const actor=mkdtempSync(join(tmpdir(),'recovery-terminal-owner-'));t.after(()=>rmSync(actor,{recursive:true,force:true}));
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./recovery-fixture.mjs',import.meta.url)),'owner',actor,'PENDING','NONE'],{encoding:'utf8'});
  assert.ifError(result.error);
  assert.equal(result.status,0,result.stderr);
  assert.ok(result.stdout.trim(),'Historical recovery fixture produced no output');
  const dead=JSON.parse(result.stdout),lockRoot=join(data,'controlled-dev','locks');
  for(const kind of ['task','workspace']){
    const record={...dead.locks[kind].record,workspaceHash:completed.project,ownerSessionId:completed.state.ownerSessionId};
    if(kind==='task')record.taskId=completed.state.taskId;
    const name=kind==='task'?hash(`${completed.project}\0${completed.state.taskId}`):completed.project;
    writeFileSync(join(lockRoot,kind==='task'?'tasks':'workspaces',`${name}.lock`),JSON.stringify(record),{flag:'wx'});
  }
  // Artificial snapshot lag and dead-owner lock fixtures exist ONLY in the historical copy.
  // This is repair of authentic historical event/artifact bytes, not proof of a historical process death.
  const terminalLedger=DurableStore.load(completed.storeRoot),prior=terminalLedger.events.at(-2);
  writeFileSync(join(completed.storeRoot,'state.json'),readFileSync(join(completed.storeRoot,prior.stateAfter.relativeStorePath)));
  assert.equal(classifyStore(data,completed.storeRoot).classification,'REPAIRABLE');assert.equal(repairStore(data,completed.storeRoot).repaired,true);
  assert.deepEqual(readFileSync(join(completed.storeRoot,'state.json')),completed.snapshot);
  assert.deepEqual(readFileSync(join(completed.storeRoot,'events.jsonl')),completed.events);
  assert.equal(classifyRecoveryState(data,completed.storeRoot).recovery.classification,'STALE_LOCK_PROVABLE');
  assert.equal(recoverLocks(data,completed.storeRoot).reclaimed,true);
  assert.deepEqual(readFileSync(join(completed.storeRoot,'state.json')),completed.snapshot);
  assert.deepEqual(readFileSync(join(completed.storeRoot,'events.jsonl')),completed.events);
  assert.equal(DurableStore.load(completed.storeRoot).state.state,'COMPLETED');
  assert.deepEqual(inventory(original),before);console.log(JSON.stringify({historicalCopies:results,unresolvedIntent:intent,completedResidualReclaim:'PASS',originalInventoryUnchanged:true}));
});
