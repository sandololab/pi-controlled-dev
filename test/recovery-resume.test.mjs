import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installSourceLoader } from './load-source.mjs';
installSourceLoader();
const {takeOverWorkflow,recoveryLease,classifyResumeAction,reconcileUnknownChildren,developerRecoveryData,scoutRecoveryData,scopeBaselineRecoveryData,boundedDeveloperRecoveryData}=await import('../src/recovery-resume.ts');
const {CentralOrchestrator,presentHumanGate,humanGateDisplay,humanGateStaleReason,createAssignment,registeredRoleDispatchers,OrchestratorHost}=await import('../src/orchestrator.ts');
const {DurableStore}=await import('../src/store.ts');
const {gatePresentations,checkPresentationChannel,checkGatePresentation}=await import('../src/gate-presentation.ts');
const {hashBytes,hashContract}=await import('../src/contracts.ts');
const {RpcAdapter}=await import('../src/pi-subagents-rpc.ts');
const {reconciliationAttempts}=await import('../src/recovery.ts');
const {productionRecoveryStatus,recoverProductionWorkflow}=await import('../src/production-bridge.ts');
const script=fileURLToPath(new URL('./recovery-fixture.mjs',import.meta.url));
function temporary(t){const root=mkdtempSync(join(tmpdir(),'restart-probe-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root}
function dead(t,state='READY',workflow=true,runStatus='TERMINAL'){const root=temporary(t),result=spawnSync(process.execPath,[script,workflow?'workflow-owner':'owner',root,state,...(workflow?[]:[runStatus])],{encoding:'utf8',timeout:workflow?120000:30000});
  assert.equal(result.status,0,result.stderr);return {...JSON.parse(result.stdout),root}}
const take=f=>takeOverWorkflow(f.data,f.storeRoot,'successor','Explicit operator reconciliation',()=> 'ACCEPT');
const runners={developer:async()=>assert.fail('Unexpected Developer replay'),reviewer:async()=>assert.fail('Unexpected Reviewer replay')};
const channel=(session='successor',yes=true)=>({mode:'tui',sessionManager:{getSessionId:()=>session},ui:{async confirm(){return yes}}});
const load=f=>DurableStore.load(f.storeRoot);

test('durable recovery preserves pre-WAL state artifacts without colliding with the next committed revision',async t=>{
 const f=dead(t,'DEVELOPER_BOUNDED'),before=load(f),revision=before.state.revision+1;
 const orphan=join(f.storeRoot,'artifacts',`state-r${revision}`),raw='{"uncommittedAttempt":true}';
 writeFileSync(orphan,raw,{flag:'wx'});
 const o=CentralOrchestrator.restore(take(f),scopeRecoveryRunners());
 const request=o.openBeforeBoundedDeveloperRecovery(o.state.revision,'successor');
 assert.equal(readFileSync(orphan,'utf8'),raw,'Historical preparatory bytes are never rewritten');
 const saved=load(f),last=saved.events.at(-1),stateBytes=DurableStore.readArtifact(f.storeRoot,last.stateAfter);
 assert.equal(last.stateAfter.id,`state-r${saved.state.revision}-${hashBytes(stateBytes)}`);
 assert.deepEqual(saved.state.counters,before.state.counters);assert.deepEqual(saved.state.runs,before.state.runs);
 assert.equal(request.snapshot.stateRevision,saved.state.revision);
 assert.equal(saved.truncatedTailBytes,0);o.dispose();
});

test('bounded Developer recovery preserves the accepted result and real counters, asks a fresh human gate and admits one new attempt',async t=>{
 const f=dead(t,'DEVELOPER_BOUNDED'),before=load(f),store={agentDataRoot:f.data,read:ref=>DurableStore.readArtifact(f.storeRoot,ref)};
 const data=boundedDeveloperRecoveryData(before,store),old=before.state.runs.at(-1);
 assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'RESUME_FROM_DURABLE_STATE');
 assert.equal(data.action,'REAUTHORIZE_BOUNDED_DEVELOPER');assert.equal(data.boundedRetriesAfter,1);
 const o=CentralOrchestrator.restore(take(f),scopeRecoveryRunners());
 assert.equal(o.resumeRecovered().decision,'HUMAN_GATE_REQUIRED');
 await assert.rejects(o.implement(o.state.revision,data.workRoot),/HUMAN_GATE_REQUIRED/);
 const request=o.openBeforeBoundedDeveloperRecovery(o.state.revision,'successor');
 assert.equal(request.approvedData.boundedDeveloperRecovery.resultRef.id,old.resultRef);
 assert.match(humanGateDisplay(request,{decision:'APPROVE'}),/The package will run the approved automated checks/);
 assert.deepEqual(o.state.counters,before.state.counters);assert.deepEqual(o.state.runs,before.state.runs);
 assert.equal(await presentHumanGate(channel('successor',false),request),undefined);
 assert.throws(()=>o.acceptHumanDecision(request.snapshot,{decision:'APPROVE'}),/HUMAN_DECISION_INVALID/);
 const receipt=await presentHumanGate(channel(),request);o.acceptHumanDecision(request.snapshot,receipt);
 assert.equal(o.state.state,'READY');assert.equal(o.boundedDeveloperRecoveryWorktree(),data.workRoot);
 assert.deepEqual(o.state.counters,before.state.counters);assert.deepEqual(o.state.runs,before.state.runs);
 const {ControlledDeveloperRunner}=await import('../src/controlled-developer.ts');let dispatched=0;
 t.mock.method(ControlledDeveloperRunner.prototype,'run',async()=>{dispatched++;throw new Error('fixture stops after fresh Developer admission')});
 await assert.rejects(o.implement(o.state.revision,data.workRoot),/fixture stops after fresh/);
 assert.equal(dispatched,1);assert.equal(o.state.taskId,before.state.taskId);
 assert.deepEqual(o.state.runs.slice(0,before.state.runs.length),before.state.runs);
 assert.equal(o.state.counters.attempts,before.state.counters.attempts+1);assert.equal(o.state.counters.dispatches,before.state.counters.dispatches+1);
 assert.equal(o.state.counters.infrastructureRetries,before.state.counters.infrastructureRetries);assert.equal(o.state.counters.reworkAttempts,before.state.counters.reworkAttempts);
 assert.ok(o.state.results.includes(old.resultRef));assert.deepEqual(o.state.failures,before.state.failures);o.dispose();
});

test('bounded Developer recovery rejects effects, missing or unknown proofs, altered original/copy/transcript and exhausted dispatch budget',async t=>{
 const f=dead(t,'DEVELOPER_BOUNDED'),ledger=load(f),store={agentDataRoot:f.data,read:ref=>DurableStore.readArtifact(f.storeRoot,ref)};
 const data=boundedDeveloperRecoveryData(ledger,store),run=ledger.state.runs.at(-1),resultId=run.resultRef;
 for(const mutate of [x=>x.state.runs.at(-1).status='UNKNOWN',x=>x.state.runs.at(-1).resultRef=undefined,
   x=>x.state.runs.at(-1).terminalProofRef=undefined,x=>x.state.runs[0].status='RUNNING',x=>x.state.candidate={},
   x=>x.records.find(r=>r.id===resultId).value.changedFiles=['file.txt'],x=>x.records.find(r=>r.id===resultId).value.commandsRun=['check'],
   x=>x.state.counters.dispatches=64,x=>x.state.specHash='a'.repeat(64)]){
  const altered=structuredClone(ledger);mutate(altered);assert.throws(()=>boundedDeveloperRecoveryData(altered,store));
 }
 const file=join(data.workRoot,'file.txt');writeFileSync(file,'partial change\n');assert.throws(()=>boundedDeveloperRecoveryData(ledger,store));writeFileSync(file,'base\n');
 chmodSync(file,0o755);assert.throws(()=>boundedDeveloperRecoveryData(ledger,store));chmodSync(file,0o644);
 writeFileSync(join(f.repo,'file.txt'),'operator change\n');assert.throws(()=>boundedDeveloperRecoveryData(ledger,store));writeFileSync(join(f.repo,'file.txt'),'base\n');
 const transcript=readFileSync(run.childSessionId,'utf8');appendFileSync(run.childSessionId,JSON.stringify({type:'message',message:{role:'assistant',content:[{type:'toolCall',name:'write',arguments:{path:'file.txt',content:'base\n'}}]}})+'\n');
 assert.throws(()=>boundedDeveloperRecoveryData(ledger,store));writeFileSync(run.childSessionId,transcript);
 const o=CentralOrchestrator.restore(take(f),scopeRecoveryRunners()),request=o.openBeforeBoundedDeveloperRecovery(o.state.revision,'successor');
 const receipt=await presentHumanGate(channel(),request);chmodSync(file,0o600);
 assert.throws(()=>o.acceptHumanDecision(request.snapshot,receipt));assert.equal(o.state.state,'AWAITING_HUMAN');
 assert.deepEqual(o.state.counters,ledger.state.counters);o.dispose();
});

test('bounded Developer retry allowance is finite and is not an infrastructure budget reset',t=>{
 const f=dead(t,'DEVELOPER_BOUNDED_EXHAUSTED'),ledger=load(f),store={agentDataRoot:f.data,read:ref=>DurableStore.readArtifact(f.storeRoot,ref)};
 assert.throws(()=>boundedDeveloperRecoveryData(ledger,store),/BOUNDED_DEVELOPER_RECOVERY_UNAVAILABLE/);
 assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'REMAIN_BLOCKED');
 assert.equal(ledger.state.counters.infrastructureRetries,0);assert.equal(ledger.state.runs.at(-1).resultRef!==undefined,true);
});

test('bounded Developer recovery pending confirmation survives owner exit without spending another attempt',async t=>{
 const f=dead(t,'DEVELOPER_BOUNDED_PENDING'),before=load(f),gate=before.records.find(r=>r.id===before.state.pendingGateId).value;
 assert.equal(before.state.state,'AWAITING_HUMAN');assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'HUMAN_ACTION_REQUIRED');
 const o=CentralOrchestrator.restore(take(f),scopeRecoveryRunners());assert.equal(o.resumeRecovered().decision,'HUMAN_GATE_REQUIRED');
 const request=o.representPendingGate(channel());assert.equal(request.snapshot.approvedDataHash,gate.approvedDataHash);
 assert.equal(JSON.parse(request.displayText).boundedDeveloperRecovery.boundedRetriesAfter,1);
 const receipt=await presentHumanGate(channel(),request);assert.throws(()=>o.acceptHumanDecision(request.snapshot,{...receipt}),/HUMAN_DECISION_INVALID/);
 o.acceptHumanDecision(request.snapshot,receipt);assert.equal(o.state.state,'READY');
 assert.deepEqual(o.state.counters,before.state.counters);assert.deepEqual(o.state.runs,before.state.runs);
 assert.ok(o.state.results.includes(before.state.runs.at(-1).resultRef));o.dispose();
});

test('production drive returns the accepted bounded Developer blocker without calling testing or inventing a generic state error',async t=>{
 const {restartFixture}=await import('./recovery-fixture.mjs');const root=temporary(t),prior=process.env.PI_CODING_AGENT_DIR;
 process.env.PI_CODING_AGENT_DIR=join(root,'data');t.after(()=>{if(prior===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=prior});
 const f=await restartFixture(root,'DEVELOPER_BOUNDED',false,false,undefined,undefined,{productionDriver:true,beforeDriver(o){t.mock.method(o,'testing',()=>assert.fail('A blocked result must not enter TESTING'))}});
 assert.equal(f.result.outcome,'BLOCKED');assert.equal(f.state.state,'BLOCKED');assert.ok(f.state.runs.at(-1).resultRef);
 assert.ok(f.notifications.some(text=>text.includes('The Developer stopped this attempt.')));
 assert.ok(f.notifications.some(text=>text.includes('approved checks must be executed by the host')));
 assert.equal(f.state.candidate,undefined);assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'base\n');
});
function scopeRecoveryRunners(){
 const runtime={events:{on(){return()=>{}},emit(){assert.fail('Recovery must not dispatch a child')}},ownerSessionId:'successor'};
 for(const role of ['scout','developer','reviewer','oracle'])runtime[role]={name:`controlled.${role}`,runtimeGeneration:'restored',active:()=>true};
 return registeredRoleDispatchers(runtime);
}

test('bounded Developer recovery after authenticated same-path import treats old approval only as history and requires a new gate',async t=>{
 const {restartFixture}=await import('./recovery-fixture.mjs');
 const {initializeProjectCustodian}=await import('../src/project-custodian.ts');
 const h=await import('../src/project-handoff.ts'),im=await import('../src/project-runtime-import.ts');
 const {takeOverImportedWorkflow}=await import('../src/recovery-resume.ts');
 const {presentTrustedConfirmation}=await import('../src/trusted-confirmation.ts');
 const root=temporary(t),repo=join(root,'repo'),data=join(root,'data');mkdirSync(repo);mkdirSync(data);
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
 git('init','-q');writeFileSync(join(repo,'file.txt'),'base\n');git('add','file.txt');
 git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base');
 appendFileSync(join(repo,'.git','info','exclude'),'\n/.controlled-dev/\n/Documentazione/\n');
 mkdirSync(join(repo,'.controlled-dev'));mkdirSync(join(repo,'Documentazione'));
 initializeProjectCustodian(repo,{schemaVersion:1,projectId:hashBytes(Buffer.from(repo)),originalRepoRoot:repo,
   baselineCommit:git('rev-parse','HEAD'),baselineTree:git('rev-parse','HEAD^{tree}')},()=>{});
 const f=await restartFixture(root,'DEVELOPER_BOUNDED',false,false,{},undefined,{existingRepo:true});
 const before=DurableStore.load(f.storeRoot),reader={agentDataRoot:data,read:ref=>DurableStore.readArtifact(f.storeRoot,ref)};
 const historical=boundedDeveloperRecoveryData(before,reader),oldGate=historical.previousApprovalId;
 const invalidatedWithoutImport=structuredClone(before);invalidatedWithoutImport.state.invalidEvidenceIds.push(oldGate);
 assert.throws(()=>boundedDeveloperRecoveryData(invalidatedWithoutImport,reader),/BOUNDED_DEVELOPER_RECOVERY_UNAVAILABLE/);
 f.orchestrator.dispose();assert.equal(h.readProjectHandoff(repo).ownerDisposition,'RELEASED_FOR_TRANSFER');
 const proposal=im.prepareProjectRuntimeImport(data,repo,'task','successor',()=> 'ACCEPT');
 assert.equal(proposal.payload.candidateRoot,null);assert.equal(proposal.payload.previousRepoRoot,repo);
 const request=im.projectRuntimeImportRequest(proposal),receipt=await presentTrustedConfirmation(channel(),request);
 const cap=im.authorizeProjectRuntimeImport(proposal,receipt);
 t.after(()=>{try{const l=im.projectRuntimeImportLease(cap);l.manager.releaseAll(l.locks)}catch{}});
 const o=CentralOrchestrator.restore(takeOverImportedWorkflow(cap),scopeRecoveryRunners()),imported=DurableStore.load(f.storeRoot);
 assert.equal(imported.state.state,'BLOCKED');assert.ok(imported.state.invalidEvidenceIds.includes(oldGate));
 const proof=boundedDeveloperRecoveryData(imported,reader);
 assert.deepEqual(proof.historicalApprovalBindingRef,imported.state.runtimeBindingRef);
 assert.equal(proof.previousApprovalId,oldGate);assert.equal(proof.originalTreeHash,historical.originalTreeHash);
 assert.deepEqual(imported.state.runs,before.state.runs);assert.deepEqual(imported.state.counters,before.state.counters);
 for(const mutate of [l=>delete l.state.runtimeBindingRef,l=>l.state.runtimeBindingRef.id='foreign-binding']){
   const forged=structuredClone(imported);mutate(forged);assert.throws(()=>boundedDeveloperRecoveryData(forged,reader));
 }
 const foreign=structuredClone(imported),binding=JSON.parse(Buffer.from(reader.read(imported.state.runtimeBindingRef)).toString('utf8'));
 binding.payload.previousRepoRoot=join(root,'foreign');const foreignRaw=Buffer.from(JSON.stringify(binding));
 const foreignRef={...foreign.state.runtimeBindingRef,digest:hashBytes(foreignRaw),bytes:foreignRaw.length};
 foreign.state.runtimeBindingRef=foreignRef;foreign.records.find(r=>r.id===foreignRef.id).value=foreignRef;
 assert.throws(()=>boundedDeveloperRecoveryData(foreign,{...reader,read:ref=>ref.id===foreignRef.id?foreignRaw:reader.read(ref)}),/PROJECT_RUNTIME_BINDING_INVALID/);
 assert.equal(o.canOpenBeforeBoundedDeveloperRecovery(),true);
 await assert.rejects(o.implement(o.state.revision,proof.workRoot),/HUMAN_GATE_REQUIRED/);
 const next=o.openBeforeBoundedDeveloperRecovery(o.state.revision,'successor');
 assert.notEqual(next.snapshot.gateId,oldGate);assert.equal(await presentHumanGate(channel('successor',false),next),undefined);
 assert.throws(()=>o.acceptHumanDecision(next.snapshot,{decision:'APPROVE'}),/HUMAN_DECISION_INVALID/);
 const fresh=await presentHumanGate(channel(),next);o.acceptHumanDecision(next.snapshot,fresh);
 assert.equal(o.state.state,'READY');assert.ok(o.state.invalidEvidenceIds.includes(oldGate));
 assert.equal(o.boundedDeveloperRecoveryWorktree(),proof.workRoot);
 assert.deepEqual(o.state.counters,before.state.counters);assert.deepEqual(o.state.runs,before.state.runs);
 assert.ok(o.state.results.includes(before.state.runs.at(-1).resultRef));o.dispose();
});

test('pre-Developer scope baseline recovery preserves Scout, counters and old approval through dead-owner takeover and fresh native approval',async t=>{
 const f=dead(t,'SCOPE_BASELINE'),before=load(f),store={agentDataRoot:f.data,read:ref=>DurableStore.readArtifact(f.storeRoot,ref)};
 const data=scopeBaselineRecoveryData(before,store);
 assert.equal(before.state.state,'BLOCKED');assert.deepEqual(before.state.counters.attempts,1);assert.equal(before.state.counters.dispatches,1);
 assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'RESUME_FROM_DURABLE_STATE');
 const o=CentralOrchestrator.restore(take(f),scopeRecoveryRunners());
 assert.equal(o.resumeRecovered().decision,'HUMAN_GATE_REQUIRED');
 await assert.rejects(o.implement(o.state.revision,data.workRoot),/HUMAN_GATE_REQUIRED/);
 const request=o.openBeforeScopeBaselineRecovery(o.state.revision,'successor');
 assert.equal(request.approvedData.scopeBaselineRecovery.blockedRevision,before.state.revision);
 assert.equal(request.approvedData.scopeBaselineRecovery.workRoot,data.workRoot);
 assert.equal(request.approvedData.scopeBaselineRecovery.specHash,before.state.specHash);
 assert.deepEqual(o.state.counters,before.state.counters);assert.deepEqual(o.state.runs,before.state.runs);
 const cancelled=await presentHumanGate(channel('successor',false),request);assert.equal(cancelled,undefined);
 assert.equal(o.state.state,'AWAITING_HUMAN');assert.throws(()=>o.acceptHumanDecision(request.snapshot,{decision:'APPROVE'}),/HUMAN_DECISION_INVALID/);
 const receipt=await presentHumanGate(channel(),request);o.acceptHumanDecision(request.snapshot,receipt);
 assert.equal(o.state.state,'READY');assert.equal(o.scopeBaselineRecoveryWorktree(),data.workRoot);
 const after=load(f);assert.deepEqual(after.state.counters,before.state.counters);assert.deepEqual(after.state.runs,before.state.runs);
 assert.equal(after.state.candidate,undefined);assert.ok(after.state.gates.includes(data.previousApprovalId));
 assert.equal(after.records.filter(r=>r.kind==='HumanGate'&&r.value.type==='beforeImplementation'&&r.value.status==='CONSUMED').length,2);
 assert.ok(after.events.some(e=>e.recordType==='RECONCILED'&&e.evidenceRefs.some(id=>id.startsWith('scope-baseline-recovery-'))));
 assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\n');
 await assert.rejects(o.implement(o.state.revision,join(f.root,'foreign-worktree')),e=>e.reasonCode==='IMPLEMENTATION_DATA_CHANGED');
 o.dispose();
});

test('pre-Developer scope recovery rejects changed source, worktree content/modes, stale binding and nonquiescent or already dispatched attempts',async t=>{
 const f=dead(t,'SCOPE_BASELINE'),ledger=load(f),store={agentDataRoot:f.data,read:ref=>DurableStore.readArtifact(f.storeRoot,ref)};
 const data=scopeBaselineRecoveryData(ledger,store),workFile=join(data.workRoot,'file.txt'),sourceFile=join(f.repo,'file.txt');
 for(const change of [x=>x.state.runs[0].status='UNKNOWN',x=>x.state.counters.dispatches=2,x=>x.state.candidate={},
   x=>x.state.runs[0].resultRef=undefined,x=>x.state.specHash='a'.repeat(64),x=>x.state.blockedReason='Other failure']){
  const altered=structuredClone(ledger);change(altered);assert.throws(()=>scopeBaselineRecoveryData(altered,store));
 }
 writeFileSync(workFile,'partial unauthorized work\n');assert.throws(()=>scopeBaselineRecoveryData(ledger,store));writeFileSync(workFile,'base\n');
 chmodSync(workFile,0o755);assert.throws(()=>scopeBaselineRecoveryData(ledger,store));chmodSync(workFile,0o644);
 execFileSync('git',['-C',data.workRoot,'checkout','--quiet','--detach']);assert.throws(()=>scopeBaselineRecoveryData(ledger,store));
 execFileSync('git',['-C',data.workRoot,'checkout','--quiet',data.candidateRef.slice('refs/heads/'.length)]);
 writeFileSync(sourceFile,'changed source\n');assert.throws(()=>scopeBaselineRecoveryData(ledger,store));writeFileSync(sourceFile,'base\n');
 const o=CentralOrchestrator.restore(take(f),scopeRecoveryRunners()),request=o.openBeforeScopeBaselineRecovery(o.state.revision,'successor');
 const receipt=await presentHumanGate(channel(),request);chmodSync(sourceFile,0o755);
 assert.throws(()=>o.acceptHumanDecision(request.snapshot,receipt));assert.equal(o.state.state,'AWAITING_HUMAN');
 assert.deepEqual(o.state.counters,ledger.state.counters);assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\n');o.dispose();
});

test('pre-Developer scope recovery pending confirmation survives restart with the same proof and a new authentic presentation',async t=>{
 const f=dead(t,'SCOPE_PENDING'),before=load(f);
 assert.equal(before.state.state,'AWAITING_HUMAN');assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'HUMAN_ACTION_REQUIRED');
 const gate=before.records.find(r=>r.id===before.state.pendingGateId).value;
 const o=CentralOrchestrator.restore(take(f),scopeRecoveryRunners());
 assert.equal(o.resumeRecovered().decision,'HUMAN_GATE_REQUIRED');
 const request=o.representPendingGate(channel());assert.equal(request.snapshot.approvedDataHash,gate.approvedDataHash);
 assert.ok(JSON.parse(request.displayText).scopeBaselineRecovery.proofRef);
 const receipt=await presentHumanGate(channel(),request);
 assert.throws(()=>o.acceptHumanDecision(request.snapshot,{...receipt}),/HUMAN_DECISION_INVALID/);
 o.acceptHumanDecision(request.snapshot,receipt);assert.equal(o.state.state,'READY');
 assert.deepEqual(o.state.counters,before.state.counters);assert.deepEqual(o.state.runs,before.state.runs);
 assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\n');o.dispose();
});

test('failed read-only Scout survives owner exit and explicitly resumes analysis without approving a writer',t=>{
 const f=dead(t,'SCOUT_INFRA'),before=load(f),old=before.state.runs.at(-1);
 assert.equal(before.state.state,'BLOCKED');assert.equal(old.status,'TERMINAL');assert.equal(old.resultRef,undefined);
 assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'RESUME_FROM_DURABLE_STATE');assert.deepEqual(load(f),before);
 const runtime={events:{on(){return()=>{}},emit(){assert.fail('Resume must not dispatch a child')}},ownerSessionId:'successor'};
 for(const role of ['scout','developer','reviewer','oracle'])runtime[role]={name:`controlled.${role}`,runtimeGeneration:'restored',active:()=>true};
 const o=CentralOrchestrator.restore(take(f),registeredRoleDispatchers(runtime)),result=o.resumeRecovered();
 assert.equal(result.state.state,'ANALYZING');assert.equal(result.state.counters.infrastructureRetries,1);
 assert.deepEqual(result.state.runs,before.state.runs);assert.equal(result.state.candidate,undefined);
 assert.equal(load(f).events.at(-1).transitionId,'TR-032');assert.throws(()=>o.ready(o.state.revision),/ADVISORY_REQUIRED/);
 assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\n');o.dispose();
});
test('Scout retry rejects unknown children, accepted results, altered tools, dirty baseline and exhausted policy',t=>{
 const f=dead(t,'SCOUT_INFRA'),ledger=load(f),store={agentDataRoot:f.data,read:ref=>DurableStore.readArtifact(f.storeRoot,ref)};
 assert.equal(scoutRecoveryData(ledger,store).deadlineMs,600000);
 for(const patch of [x=>x.state.runs[0].status='UNKNOWN',x=>x.state.runs[0].resultRef='accepted',x=>x.state.runs[0].terminalProofRef=undefined,
   x=>x.state.counters.infrastructureRetries=1,x=>x.state.counters.dispatches=99,x=>x.state.specHash='a'.repeat(64)]){
  const altered=structuredClone(ledger);patch(altered);assert.throws(()=>scoutRecoveryData(altered,store));
 }
 const child=ledger.state.runs.at(-1).childSessionId,original=readFileSync(child,'utf8');
 const aborted={type:'message',message:{role:'assistant',stopReason:'aborted',content:[{type:'toolCall',id:'aborted-result',name:'structured_output',arguments:{}}]}};
 appendFileSync(child,JSON.stringify(aborted)+'\n');assert.equal(scoutRecoveryData(ledger,store).deadlineMs,600000);
 appendFileSync(child,JSON.stringify({type:'message',message:{role:'toolResult',toolCallId:'aborted-result',content:[]}})+'\n');
 assert.throws(()=>scoutRecoveryData(ledger,store),/SCOUT_RECOVERY_UNAVAILABLE/);writeFileSync(child,original);
 appendFileSync(child,JSON.stringify({type:'message',message:{role:'assistant',content:[{type:'toolCall',name:'structured_output',arguments:{}}]}})+'\n');
 assert.throws(()=>scoutRecoveryData(ledger,store),/SCOUT_RECOVERY_UNAVAILABLE/);writeFileSync(child,original);
 writeFileSync(join(f.repo,'file.txt'),'operator change\n');assert.throws(()=>scoutRecoveryData(ledger,store));
});
test('production can close a proven failed Scout attempt after explicit confirmation without resetting policy or changing source',async t=>{
 const f=dead(t,'SCOUT_INFRA'),before=load(f).state,o=CentralOrchestrator.restore(take(f),runners);
 const host={current:o,ownerSessionId:'successor'},ctx=productionContext(t,f),events={on(){return()=>{}},emit(){assert.fail('No RPC call expected')}};
 assert.equal((await recoverProductionWorkflow(host,{...ctx,...channel('successor',false),ui:{...channel('successor',false).ui,notify(){}}},'close-attempt',events)).outcome,'NOT_CONFIRMED');
 assert.equal(o.state.state,'BLOCKED');
 assert.equal((await recoverProductionWorkflow(host,ctx,'close-attempt',events)).outcome,'FAILED');
 assert.deepEqual(o.state.counters,before.counters);assert.deepEqual(o.state.runs,before.runs);
 assert.equal(o.state.candidate,undefined);assert.deepEqual(o.lockStatus(),{taskLockHeld:false,workspaceLockHeld:false});
 assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\n');o.dispose();
});
test('production refinement closes a terminal failed Developer but preserves partial files and every retry counter',async t=>{
 const f=dead(t,'DEVELOPER_INFRA'),before=load(f).state,assignment=load(f).records.find(r=>r.id===before.runs.at(-1).assignmentId).value;
 writeFileSync(join(assignment.workRoot,'file.txt'),'partial work\n');
 const o=CentralOrchestrator.restore(take(f),runners),host={current:o,ownerSessionId:'successor'},ctx=productionContext(t,f),events={on(){return()=>{}},emit(){assert.fail('No replay')}};
 assert.equal((await recoverProductionWorkflow(host,{...ctx,...channel('successor',false)},'close-attempt',events)).outcome,'NOT_CONFIRMED');
 assert.equal(o.state.state,'BLOCKED');assert.equal(readFileSync(join(assignment.workRoot,'file.txt'),'utf8'),'partial work\n');
 assert.equal((await recoverProductionWorkflow(host,ctx,'close-attempt',events)).outcome,'FAILED');
 assert.deepEqual(o.state.runs,before.runs);assert.deepEqual(o.state.counters,before.counters);assert.equal(o.state.candidate,undefined);
 assert.equal(readFileSync(join(assignment.workRoot,'file.txt'),'utf8'),'partial work\n');assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'base\n');
 assert.deepEqual(o.lockStatus(),{taskLockHeld:false,workspaceLockHeld:false});o.dispose();
});

for(const checkpoint of ['READY','AWAITING_HUMAN'])test(`graceful shutdown at ${checkpoint} preserves owner proof for explicit takeover without replay or approval`,async t=>{
  const root=temporary(t),result=spawnSync(process.execPath,[script,'workflow-owner',root,checkpoint,'dispose'],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);
  const f={...JSON.parse(result.stdout),root},before=load(f);
  assert.equal(before.state.state,checkpoint);
  for(const kind of ['task','workspace'])assert.deepEqual(JSON.parse(readFileSync(f.locks[kind].path,'utf8')),f.locks[kind].record);
  const o=CentralOrchestrator.restore(take(f),runners);
  assert.equal(o.state.state,checkpoint);
  assert.deepEqual(o.state.runs,before.state.runs);
  assert.deepEqual(o.state.counters,before.state.counters);
  assert.deepEqual(o.state.decisions,before.state.decisions);
  assert.equal(o.state.pendingGateId,before.state.pendingGateId);
  assert.deepEqual(o.lockStatus(),{taskLockHeld:true,workspaceLockHeld:true});
  assert.equal(o.resumeRecovered().decision,checkpoint==='READY'?'DISPATCH_DEVELOPER':'HUMAN_GATE_REQUIRED');
  assert.equal(readFileSync(join(root,'effects.log'),'utf8'),'Scout\n');
  o.dispose();
  assert.deepEqual(o.lockStatus(),{taskLockHeld:true,workspaceLockHeld:true});
});

test('P16B TEST-035/039 real owner SIGKILL, takeover and ANALYZING -> READY without replay',async t=>{
  const root=temporary(t),child=spawn(process.execPath,[script,'workflow-owner',root,'ANALYZING','hold'],{stdio:['ignore','pipe','pipe']});t.after(()=>child.kill('SIGKILL'));
  let output='';const f=await new Promise((resolve,reject)=>{child.on('error',reject);child.stdout.on('data',v=>{output+=v;if(output.includes('\n'))resolve(JSON.parse(output))});child.on('exit',()=>reject(new Error('Owner failed before checkpoint')))});
  assert.throws(()=>take(f),/UNPROVEN/);const exit=new Promise(resolve=>child.on('exit',resolve));child.kill('SIGKILL');await exit;
  const before=load(f).state,authority=take(f);assert.throws(()=>recoveryLease({...authority}),/INVALID/);
  const o=CentralOrchestrator.restore(authority,runners);assert.equal(o.state.revision,before.revision+1);
  assert.deepEqual(o.state.runs,before.runs);assert.deepEqual(o.state.counters,before.counters);
  assert.deepEqual(o.lockStatus(),{taskLockHeld:true,workspaceLockHeld:true});assert.notEqual(recoveryLease(authority).locks.task.record.token,f.locks.task.record.token);
  assert.equal(o.resumeRecovered().state.state,'READY');assert.equal(o.state.revision,before.revision+2);
  assert.equal(readFileSync(join(root,'effects.log'),'utf8'),'Scout\n');assert.deepEqual(o.state.counters,before.counters);
  const next=createAssignment(o.spec,o.state,'Developer',{workRoot:join(root,'future-candidate')});assert.ok(before.runs.every(r=>r.assignmentId!==next.assignmentId&&r.attemptId!==next.attemptId));
  assert.throws(()=>take(f));assert.throws(()=>CentralOrchestrator.restore(authority,runners),/ALREADY_CLAIMED/);
  assert.equal(load(f).events.at(-1).transitionId,'TR-005');o.dispose();
});
test('P16B TEST-039 READY takeover uses durable current spec, not changed control input',t=>{
  const f=dead(t),before=load(f).state;writeFileSync(join(f.data,'task.json'),'{"title":"malicious replacement"}');
  const authority=take(f),o=CentralOrchestrator.restore(authority,runners);assert.equal(o.resumeRecovered().state.state,'READY');
  assert.equal(o.spec.specHash,before.specHash);assert.equal(o.state.taskId,before.taskId);assert.equal(o.state.baselineCommit,before.baselineCommit);
  for(const key of ['counters','candidate','failures','decisions','gates','runs'])assert.deepEqual(o.state[key],before[key]);o.dispose();
});
test('P16B TEST-019/021/046 pending presentation generation 2 uses new TUI and preserves gate/material',async t=>{
  const f=dead(t,'AWAITING_HUMAN'),before=load(f),gate=before.records.find(r=>r.id===before.state.pendingGateId).value;
  const authority=take(f),o=CentralOrchestrator.restore(authority,runners),lease=recoveryLease(authority);
  const request=o.representPendingGate(channel());assert.equal(o.state.revision,before.state.revision+2);
  const chain=gatePresentations(gate,o.context().records,o.events,lease.store);assert.deepEqual(chain.map(v=>v.value.presentationGeneration),[1,2]);
  assert.equal(request.snapshot.sessionId,'successor');assert.equal(request.snapshot.approvedDataHash,gate.approvedDataHash);
  assert.equal(hashBytes(Buffer.from(request.displayText)),gate.approvedDataHash);
  assert.deepEqual(o.context().records.find(r=>r.id===gate.id).value,gate);
  await assert.rejects(presentHumanGate(channel('owner'),request),e=>e.reasonCode==='SESSION_CHANGED');
  await assert.rejects(presentHumanGate({...channel(),mode:'rpc'},request),/HUMAN_CHANNEL_UNAVAILABLE/);
  await assert.rejects(presentHumanGate(channel(),{...request}),/HUMAN_DECISION_INVALID/);
  assert.throws(()=>o.representPendingGate(channel()),/ALREADY_CURRENT/);
  const receipt=await presentHumanGate(channel(),request);o.acceptHumanDecision(request.snapshot,receipt);
  assert.equal(o.state.state,'READY');assert.equal(load(f).events.at(-1).transitionId,'TR-038');
  assert.deepEqual(o.state.counters,before.state.counters);assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\n');
  assert.throws(()=>o.acceptHumanDecision(request.snapshot,receipt),/HUMAN_DECISION_INVALID/);
  const decision=o.context().records.find(r=>r.kind==='HumanDecisionEvidence').value;
  const channelRef=o.context().records.find(r=>r.id===decision.trustedChannelEvidenceRef).value;
  const bytes=JSON.parse(Buffer.from(lease.store.read(channelRef)).toString());
  assert.equal(checkPresentationChannel(bytes,gate,o.context().records,o.events,lease.store).presentationGeneration,2);
  for(const patch of [{sessionId:'owner'},{gateId:'another'},{taskId:'another'},{presentationRef:chain[0].ref}])
    assert.throws(()=>checkPresentationChannel({...bytes,...patch},gate,o.context().records,o.events,lease.store),/PRESENTATION_INVALID/);
  o.dispose();
});
test('P16B TEST-042 real restart final gate rebind completes with candidate and consumed gate history intact',async t=>{
  const f=dead(t,'FINAL_GATE'),before=load(f),authority=take(f);
  const runtime={events:{on(){return()=>{}},emit(){assert.fail('No child dispatch permitted')}},ownerSessionId:'successor'};
  for(const role of ['scout','developer','reviewer','oracle'])runtime[role]={name:`controlled.${role}`,runtimeGeneration:'restored',active:()=>true};
  const o=CentralOrchestrator.restore(authority,registeredRoleDispatchers(runtime));
  assert.deepEqual(o.state.candidate,before.state.candidate);assert.deepEqual(o.state.counters,before.state.counters);
  const request=o.representPendingGate(channel()),receipt=await presentHumanGate(channel(),request);
  o.acceptHumanDecision(request.snapshot,receipt);o.complete(o.state.revision);
  const after=load(f);assert.equal(after.state.state,'COMPLETED');assert.deepEqual(after.state.candidate,before.state.candidate);
  assert.deepEqual(after.state.counters,before.state.counters);assert.deepEqual(after.state.runs,before.state.runs);
  assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\nDeveloper\nReviewer\n');
  assert.deepEqual(o.lockStatus(),{taskLockHeld:false,workspaceLockHeld:false});
});
test('P16B.1 TEST-044 GatePresentation and ProcessIncarnation are closed versioned documents',()=>{
  const p={schemaVersion:1,id:'presentation',gateId:'gate',taskId:'task',presentationGeneration:1,workflowRevision:3,displayedDataHash:'a'.repeat(64),
    hostProcessIncarnation:{schemaVersion:1,platform:'linux',bootId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',pidNamespace:'pid:[123]',pid:10,startTicks:'100'},
    hostSessionId:'host',presentedAt:'2026-01-01T00:00:00.000Z'};
  assert.deepEqual(checkGatePresentation(p),p);
  for(const patch of [{schemaVersion:2},{presentationGeneration:0},{presentationGeneration:2},{workflowRevision:1.5},{displayedDataHash:'bad'},
    {gateId:''},{approved:true},{hostProcessIncarnation:{...p.hostProcessIncarnation,ownerDead:true}},{hostProcessIncarnation:{...p.hostProcessIncarnation,pid:0}}])
    assert.throws(()=>checkGatePresentation({...p,...patch}),/PRESENTATION_INVALID/);
});
test('P16B TEST-019 same gate and session B without authorized presentation still SESSION_CHANGED',()=>{
  const h='a'.repeat(64),snapshot={gateId:'gate',taskId:'task',stateRevision:9,specHash:h,approvedDataHash:h,sessionId:'A'};
  assert.equal(humanGateStaleReason(snapshot,{...snapshot,state:'AWAITING_HUMAN',sessionId:'B',taskLockHeld:true,workspaceLockHeld:true,gateStatus:'PENDING'}),'SESSION_CHANGED');
});
test('P16B TEST-035 explicit BLOCKED abandon selects TR-035 only after confirmation and quiescence',async t=>{
  const f=dead(t,'BLOCKED',false),before=load(f).state,authority=take(f),o=CentralOrchestrator.restore(authority,runners);
  await o.abandonRecovered(channel('successor',false),'Operator cancels');assert.equal(o.state.state,'BLOCKED');
  await assert.rejects(o.abandonRecovered(channel('foreign'),'Operator cancels'),/STALE/);
  await o.abandonRecovered(channel(),'Operator explicitly abandons the task');assert.equal(o.state.state,'FAILED');
  assert.equal(load(f).events.at(-1).transitionId,'TR-035');assert.deepEqual(o.state.counters,before.counters);
  assert.deepEqual(o.lockStatus(),{taskLockHeld:false,workspaceLockHeld:false});assert.equal(o.context().records.some(r=>r.kind==='HumanDecisionEvidence'),false);
});
test('P16B TEST-028 real owner dies with UNKNOWN: no takeover, no resume or dispatch',async t=>{
  const f=dead(t,'UNKNOWN'),before=readFileSync(join(f.storeRoot,'events.jsonl'),'utf8');
  assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'CHILD_RECONCILIATION_REQUIRED');assert.throws(()=>take(f),/CHILD_RECONCILIATION_REQUIRED/);
  assert.equal((await reconcileUnknownChildren(f.data,f.storeRoot)).resume.action,'CHILD_RECONCILIATION_REQUIRED');
  assert.equal(readFileSync(join(f.storeRoot,'events.jsonl'),'utf8'),before);assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\n');
});
test('P16B TEST-030 two real successor processes: one takeover winner, no workflow effect replay',async t=>{
  const f=dead(t);const run=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[script,'takeover',f.data,f.storeRoot],{stdio:['ignore','pipe','pipe']});let out='';
    t.after(()=>child.kill('SIGKILL'));child.on('error',reject);child.stdout.on('data',v=>{out+=v;if(out.includes('\n'))resolve(JSON.parse(out))});
  });
  const results=await Promise.all([run(),run()]);assert.equal(results.filter(r=>r.taken).length,1);
  assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\n');
});
test('P16B TEST-030 missing prior locks without death/reclaim proof does not authorize takeover',t=>{
  const f=dead(t);rmSync(f.locks.task.path);rmSync(f.locks.workspace.path);
  assert.throws(()=>take(f),/OWNER_DEATH_UNPROVEN/);
});
test('P16B TEST-046 decision persisted but consume not committed is never re-prompted',async t=>{
  const f=dead(t,'AWAITING_HUMAN'),authority=take(f),o=CentralOrchestrator.restore(authority,runners),lease=recoveryLease(authority);
  const request=o.representPendingGate(channel()),receipt=await presentHumanGate(channel(),request),commit=lease.store.commit.bind(lease.store);
  t.mock.method(lease.store,'commit',(state,event,records)=>{if(event.transitionId==='TR-038')throw new Error('injected before consume');return commit(state,event,records)});
  assert.throws(()=>o.acceptHumanDecision(request.snapshot,receipt),/injected/);
  assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'P16C_REPAIR_REQUIRED');
  assert.throws(()=>o.representPendingGate(channel()),/ALREADY_DECIDED/);
  assert.equal(load(f).records.filter(r=>r.kind==='HumanDecisionEvidence').length,1);
});
test('P16B TEST-029/046 terminal no-op; incomplete WAL and unresolved INTENT require P16C',t=>{
  const terminal=dead(t,'FAILED',false),before=readFileSync(join(terminal.storeRoot,'events.jsonl'),'utf8');
  assert.equal(classifyResumeAction(terminal.data,terminal.storeRoot).action,'NO_ACTION_TERMINAL');assert.throws(()=>take(terminal),/NO_ACTION_TERMINAL/);
  assert.equal(readFileSync(join(terminal.storeRoot,'events.jsonl'),'utf8'),before);
  const f=dead(t);appendFileSync(join(f.storeRoot,'events.jsonl'),'{');assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'P16C_REPAIR_REQUIRED');assert.throws(()=>take(f),/P16C_REPAIR_REQUIRED/);
});
function historicalProvider(run,capable=false,contradictory=false,terminalStatus="complete"){
  let queries=0;const listeners=new Map();
  const events={on(name,fn){listeners.set(name,fn);return()=>listeners.delete(name)},emit(name,r){
    if(name!=='subagents:rpc:v1:request')return;
    const terminalProof={schemaVersion:1,runId:run.runId,role:run.role,requestId:run.requestId,ownerSessionId:run.ownerSessionId,childSessionId:run.childSessionId,
      statusRequestId:r.requestId,completionSessionId:run.ownerSessionId,terminalStatus,observedAt:new Date().toISOString(),source:'targeted-rpc-status',
      provider:{version:1,state:'observed',runId:run.runId,runnerProcessInstanceId:'capability-fixture',observedAt:1,
        instances:[{kind:'runner',processInstanceId:'capability-fixture',closeObservedAt:1,exitCode:0,signal:null}],resumeDisposition:'resumable'}};
    const data=r.method==='ping'?{version:1,methods:['ping','spawn','status','interrupt','stop','resume'],session:{sessionId:'successor',sessionFile:null},
      events:{asyncComplete:'subagent:async-complete'},capabilities:{asyncSpawn:true,status:true,interrupt:true,stop:true,resume:true,
        ...(capable?{historicalRunReconciliation:{version:1,method:'status',binding:'exact-run-owner-child-role-request'}}:{})}}:
      {historicalRunReconciliation:{version:1,runId:run.runId,role:contradictory?'Developer':run.role,requestId:run.requestId,
        ownerSessionId:run.ownerSessionId,childSessionId:run.childSessionId,state:terminalStatus,terminalProof}};
    if(r.method!=='ping'){queries++;assert.equal(r.method,'status');assert.deepEqual(r.params,{id:run.runId,ownerSessionId:run.ownerSessionId,historical:true})}
    listeners.get(`subagents:rpc:v1:reply:${r.requestId}`)?.({version:1,requestId:r.requestId,success:true,data});
  }};
  const rpc=new RpcAdapter(events,{sessionId:'successor',environmentHash:'a'.repeat(64),piVersion:'fixture',subagentsVersion:'not-a-capability'});
  return {rpc,events,queries:()=>queries};
}
function productionContext(t,f){
  const prior=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;
  t.after(()=>{if(prior===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=prior});
  return {...channel(),cwd:f.repo,ui:{...channel().ui,notify(){}}};
}
test('P16B.3 capability absent: durable UNRESOLVED, reload, no automatic retry and no counter/state changes',async t=>{
  const f=dead(t,'BLOCKED',false,'UNKNOWN'),before=load(f),provider=historicalProvider(before.state.runs[0]);t.after(()=>provider.rpc.dispose());
  await provider.rpc.handshake();assert.equal(provider.rpc.liveTerminationMode(),'LOGICAL_ONLY');
  await reconcileUnknownChildren(f.data,f.storeRoot,provider.rpc,'successor');
  const attempts=reconciliationAttempts(f.data,load(f));assert.equal(attempts.length,1);assert.equal(attempts[0].result,'UNRESOLVED');
  assert.equal(attempts[0].reason,'PROVIDER_HISTORY_UNAVAILABLE');assert.equal(attempts[0].runId,before.state.runs[0].runId);
  assert.deepEqual(load(f).state,before.state);await reconcileUnknownChildren(f.data,f.storeRoot,provider.rpc,'successor');
  assert.equal(reconciliationAttempts(f.data,load(f)).length,1);assert.equal(provider.queries(),0);assert.throws(()=>take(f),/CHILD_RECONCILIATION_REQUIRED/);
  const ctx=productionContext(t,f),status=productionRecoveryStatus(ctx);
  assert.match(status.message,/cannot be established with certainty/);assert.equal(status.attempts[0].result,'UNRESOLVED');
  const host=new OrchestratorHost('successor',{});
  const frames=[],notifications=[];
  ctx.ui.notify=message=>notifications.push(message);
  ctx.ui.custom=async factory=>new Promise(resolve=>{
    const component=factory({requestRender(){},terminal:{rows:38}},null,null,resolve);
    frames.push(component.render(110).join('\n'));
    component.handleInput('\x1b');
  });
  await recoverProductionWorkflow(host,ctx,'recover',provider.events);await recoverProductionWorkflow(host,ctx,'reconcile',provider.events);
  assert.equal(frames.length,0,'the command layer opens status only after the progress panel has been removed');
  assert.deepEqual(notifications,[],'no full status dump in the chat');
  await assert.rejects(recoverProductionWorkflow(host,ctx,'resume',provider.events),/No new agent/);
  assert.equal(host.current,undefined);assert.deepEqual(load(f).state,before.state);
});
test('P16B.3 unrecognised historical advertisement grants no authority and UNKNOWN remains blocked',async t=>{
  const f=dead(t,'BLOCKED',false,'UNKNOWN'),before=load(f),provider=historicalProvider(before.state.runs[0],true);t.after(()=>provider.rpc.dispose());
  await provider.rpc.handshake();await reconcileUnknownChildren(f.data,f.storeRoot,provider.rpc,'successor');
  assert.equal(provider.queries(),0);assert.equal(reconciliationAttempts(f.data,load(f))[0].result,'UNRESOLVED');
  assert.deepEqual(load(f).state,before.state);assert.throws(()=>take(f),/CHILD_RECONCILIATION_REQUIRED/);
});
test('P16B.3 free-form historical proof payload is ignored and cannot affect recovery',async t=>{
  const f=dead(t,'BLOCKED',false,'UNKNOWN'),before=load(f),provider=historicalProvider(before.state.runs[0],true,true);t.after(()=>provider.rpc.dispose());
  await provider.rpc.handshake();await reconcileUnknownChildren(f.data,f.storeRoot,provider.rpc,'successor');
  assert.equal(provider.queries(),0);assert.equal(reconciliationAttempts(f.data,load(f))[0].result,'UNRESOLVED');assert.throws(()=>take(f));assert.deepEqual(load(f).state,before.state);
});
test('P16B.3 production commands in successor process dispatch fresh physical workers with continuous identities/spec/candidate/counters',t=>{
  const f=dead(t,'REWORK_READY'),before=load(f).state,control=join(f.data,'controlled-dev','control',hashBytes(Buffer.from(f.repo)));mkdirSync(control,{recursive:true});
  writeFileSync(join(control,'task.json'),JSON.stringify({specHash:'b'.repeat(64),objective:'External input must not replace the durable spec'}));
  // The larger artifact closure is checked in full; bound the fixture wall-clock without weakening recovery assertions.
  const result=spawnSync(process.execPath,[script,'workflow-successor',f.root],{encoding:'utf8',timeout:480000});assert.equal(result.status,0,`${result.error??''} ${result.stderr}`);
  const report=JSON.parse(result.stdout),after=load(f).state;assert.equal(after.state,'COMPLETED');assert.equal(after.specHash,before.specHash);
  assert.equal(after.counters.dispatches,before.counters.dispatches+2);assert.equal(after.counters.attempts,before.counters.attempts+2);
  for(const key of ['infrastructureRetries','escalationEpisodes','oracleInvocations'])assert.equal(after.counters[key],before.counters[key]);
  assert.equal(after.baselineCommit,before.baselineCommit);assert.deepEqual(after.spec,before.spec);
  assert.deepEqual(after.runs.slice(0,before.runs.length),before.runs);assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\nDeveloper\nReviewer\nDeveloper\nReviewer\n');
  assert.equal(after.counters.reworkAttempts,before.counters.reworkAttempts+1);assert.equal(after.candidate.generation,before.candidate.generation+1);
  assert.equal(hashBytes(readFileSync(join(f.storeRoot,before.candidate.manifest.relativeStorePath))),before.candidate.manifest.digest);
  for(const key of ['assignmentId','attemptId','requestId','runId','childSessionId'])assert.equal(new Set(after.runs.map(r=>r[key])).size,after.runs.length,key);
  for(const run of after.runs){const transcript=JSON.parse(readFileSync(run.childSessionId,'utf8'));
    assert.ok(transcript.pid>0);assert.equal(transcript.runId,run.runId);assert.equal(transcript.assignment.specHash,before.specHash);
    if(run.role==='Developer'&&!before.runs.some(r=>r.runId===run.runId)){
      assert.equal(transcript.assignment.candidateDigest,before.candidate.digest);assert.equal(transcript.assignment.candidateGeneration,before.candidate.generation);
    }
    if(run.role==='Reviewer'&&!before.runs.some(r=>r.runId===run.runId)){assert.equal(transcript.assignment.candidateDigest,after.candidate.digest);assert.equal(transcript.assignment.candidateGeneration,after.candidate.generation);
      const current=load(f).records.filter(r=>r.kind==='ValidationResult'&&r.value.candidateGeneration===after.candidate.generation&&
        r.value.candidateDigest===after.candidate.digest&&!after.invalidEvidenceIds.includes(r.id)).map(r=>r.id);
      assert.deepEqual(transcript.currentValidationIds,current);for(const id of current)assert.ok(transcript.evidenceIds.includes(id))}
  }
  assert.ok(report.notifications.some(v=>v.includes('The task was interrupted')));assert.ok(report.notifications.some(v=>v.includes('Completed')));
});
test('P16B.3 real successor command process records UNKNOWN; third process reload does not query or dispatch',t=>{
  const f=dead(t,'BLOCKED',false,'UNKNOWN'),before=load(f).state;
  const b=spawnSync(process.execPath,[script,'workflow-successor',f.root],{encoding:'utf8',timeout:30000});assert.equal(b.status,0,b.stderr);
  const report=JSON.parse(b.stdout);assert.match(report.resumeDenied,/No new agent/);assert.deepEqual(report.state,before);
  assert.ok(report.notifications.some(v=>v.includes('PROVIDER_HISTORY_UNAVAILABLE')));
  const attempts=reconciliationAttempts(f.data,load(f));assert.equal(attempts.length,1);
  const c=spawnSync(process.execPath,[script,'reconciliation-reload',f.data,f.storeRoot],{encoding:'utf8',timeout:30000});assert.equal(c.status,0,c.stderr);
  assert.deepEqual(JSON.parse(c.stdout).after,before);assert.deepEqual(reconciliationAttempts(f.data,load(f)),attempts);
  assert.equal(JSON.parse(readFileSync(f.locks.task.path,'utf8')).token,f.locks.task.record.token);
  assert.equal(JSON.parse(readFileSync(f.locks.workspace.path,'utf8')).token,f.locks.workspace.record.token);
});
test('P16B.3 explicit recheck cannot invent historical proof when public replay is absent',async t=>{
  const f=dead(t,'BLOCKED',false,'UNKNOWN'),run=load(f).state.runs[0];
  await reconcileUnknownChildren(f.data,f.storeRoot,undefined,'successor');
  const provider=historicalProvider(run,true);t.after(()=>provider.rpc.dispose());await provider.rpc.handshake();
  await reconcileUnknownChildren(f.data,f.storeRoot,provider.rpc,'successor');assert.equal(provider.queries(),0);
  await reconcileUnknownChildren(f.data,f.storeRoot,provider.rpc,'successor',true);assert.equal(provider.queries(),0);
  assert.deepEqual(reconciliationAttempts(f.data,load(f)).map(a=>a.result),['UNRESOLVED','UNRESOLVED']);assert.throws(()=>take(f));
});
test('P16B.3 production selection rejects arbitrary paths, foreign task IDs and symlinked stores',async t=>{
  const f=dead(t),ctx=productionContext(t,f),before=load(f).state;
  assert.throws(()=>productionRecoveryStatus(ctx,'../task'),/RECOVERY_TASK_INVALID/);
  assert.throws(()=>productionRecoveryStatus(ctx,'foreign'),/RECOVERY_TASK_NOT_FOUND/);
  symlinkSync(f.storeRoot,join(f.storeRoot,'..','alias'));
  assert.throws(()=>productionRecoveryStatus(ctx,'task'),/RECOVERY_PATH_INVALID/);assert.deepEqual(load(f).state,before);
});
test('P16B.3 production refuses INTENT and truncated WAL without repair',async t=>{
  const f=dead(t,'ANALYZING',false,'INTENT'),ctx=productionContext(t,f),host=new OrchestratorHost('successor',{}),events={on(){return()=>{}},emit(){assert.fail('No provider query')}};
  const before=readFileSync(join(f.storeRoot,'events.jsonl'),'utf8');
  for(const action of ['recover','reconcile','resume'])await assert.rejects(recoverProductionWorkflow(host,ctx,action,events),/store repair is required/);
  assert.equal(readFileSync(join(f.storeRoot,'events.jsonl'),'utf8'),before);
  appendFileSync(join(f.storeRoot,'events.jsonl'),'{');await assert.rejects(recoverProductionWorkflow(host,ctx,'resume',events),/store repair is required/);
  assert.equal(readFileSync(join(f.storeRoot,'events.jsonl'),'utf8'),before+'{');
});

test('Reviewer timeout preserves exact binding, candidate and validations and persists live terminal proof',async t=>{
  const f=dead(t,'REVIEWER_TIMEOUT'),before=load(f),run=before.state.runs.at(-1);
  assert.equal(run.role,'Reviewer');assert.equal(run.status,'TERMINAL');assert.ok(run.terminalProofRef);
  for(const key of ['assignmentId','attemptId','requestId','runId','childSessionId'])assert.ok(run[key],key);
  assert.ok(!run.requestId.startsWith('intent-'));assert.equal(run.resultRef,undefined);
  // Project Memory observes all three role dispatches; retain the exact three Reviewer observations.
  const bindings=before.events.filter(e=>e.recordType==='RUN_BOUND');assert.equal(bindings.length,9);
  const allSnapshots=bindings.map(e=>JSON.parse(readFileSync(join(f.storeRoot,e.stateAfter.relativeStorePath),'utf8')));
  for(const role of ['Scout','Developer','Reviewer'])assert.equal(allSnapshots.filter(s=>s.runs.at(-1).role===role).length,3);
  const snapshots=allSnapshots.filter(s=>s.runs.at(-1).assignmentId===run.assignmentId);assert.equal(snapshots.length,3);
  assert.equal(snapshots[0].runs.at(-1).requestId,run.requestId);
  assert.equal(snapshots[1].runs.at(-1).runId,run.runId);
  assert.equal(snapshots[2].runs.at(-1).childSessionId,run.childSessionId);
  for(const snapshot of snapshots){assert.deepEqual(snapshot.candidate,before.state.candidate);assert.deepEqual(snapshot.validations,before.state.validations);assert.deepEqual(snapshot.counters,before.state.counters)}
  assert.equal(reconciliationAttempts(f.data,load(f)).length,0);assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'REMAIN_BLOCKED');
  assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\nDeveloper\nReviewer\n');
});
test('real-process Reviewer dispatch, lost connection, SIGKILL, reload retains exact identity without replay',async t=>{
  const root=temporary(t),child=spawn(process.execPath,[script,'workflow-owner',root,'REVIEWER_CRASH'],{stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill('SIGKILL'));let output='',errors='';child.stderr.on('data',v=>errors+=v);
  const f=await new Promise((resolve,reject)=>{child.on('error',reject);child.stdout.on('data',v=>{output+=v;if(output.includes('\n'))resolve(JSON.parse(output.split('\n')[0]))});child.on('exit',()=>reject(new Error(errors||'Owner exited before binding')))});
  const before=load(f),run=before.state.runs.at(-1);
  assert.equal(before.state.state,'REVIEWING');assert.equal(run.status,'BOUND');assert.ok(run.childSessionId);assert.ok(run.runId);
  const exit=new Promise(resolve=>child.on('exit',resolve));child.kill('SIGKILL');await exit;
  assert.deepEqual(load(f),before);assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'CHILD_RECONCILIATION_REQUIRED');
  await reconcileUnknownChildren(f.data,f.storeRoot,undefined,'successor');assert.deepEqual(load(f),before);
  assert.equal(reconciliationAttempts(f.data,load(f))[0].runId,run.runId);assert.throws(()=>take(f));
  assert.equal(readFileSync(join(root,'effects.log'),'utf8'),'Scout\nDeveloper\nReviewer\n');
});

test('verified terminal Reviewer infra failure uses bounded retry policy, preserves evidence and monotonic identities',async t=>{
  const f=dead(t,'REVIEWER_TIMEOUT'),before=load(f),run=before.state.runs.at(-1);
  const o=CentralOrchestrator.restore(take(f),runners),reconciled=o.state.runs.at(-1);
  assert.equal(reconciled.status,'TERMINAL');assert.equal(reconciled.resultRef,undefined);
  const routed=o.routeFailure({phase:'REVIEWING',source:'RPC_TRANSIENT',code:'REVIEWER_TIMEOUT',subjectIds:[run.assignmentId],evidenceRefs:[reconciled.terminalProofRef]},
    {dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:true,writerTerminal:true,workspaceSafe:true,sameProtocol:true,concreteHumanResolution:false,duplicateEscalation:false},o.state.revision);
  assert.equal(routed.decision,'RETRY_INFRASTRUCTURE');
  assert.deepEqual(o.state.candidate,before.state.candidate);assert.deepEqual(o.state.validations,before.state.validations);
  assert.deepEqual(o.state.invalidEvidenceIds,before.state.invalidEvidenceIds);assert.deepEqual(o.state.results,before.state.results);
  assert.equal(o.state.counters.infrastructureRetries,before.state.counters.infrastructureRetries+1);
  assert.equal(o.state.counters.dispatches,before.state.counters.dispatches);
  const fresh=createAssignment(o.spec,o.state,'Reviewer',{inputArtifactRefs:['source']});
  for(const prior of o.state.runs){assert.notEqual(fresh.assignmentId,prior.assignmentId);assert.notEqual(fresh.attemptId,prior.attemptId)}
  // Retry admission is durable but still cannot dispatch: a distinct native gate is required.
  assert.equal(o.resumeRecovered().decision,'HUMAN_GATE_REQUIRED');assert.equal(o.canOpenBeforeReviewerRedispatch(),true);
  const request=o.openBeforeReviewerRedispatch(o.state.revision,'successor'),counters=o.state.counters;
  assert.equal(request.gateType,'beforeReviewerRedispatch');assert.equal(o.state.state,'AWAITING_HUMAN');
  const receipt=await presentHumanGate(channel(),request);o.acceptHumanDecision(request.snapshot,receipt);
  assert.equal(o.state.state,'REVIEWING');assert.deepEqual(o.state.counters,counters);
  assert.equal(o.state.runs.filter(r=>r.role==='Reviewer').length,1,'gate does not dispatch');
  assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'RESUME_FROM_DURABLE_STATE');
  assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\nDeveloper\nReviewer\n');
  assert.deepEqual(load(f).state,o.state);o.dispose();
});
test('real-process Reviewer A failure -> native gate double -> fresh Reviewer B without Developer or validation replay',t=>{
  const f=dead(t,'REVIEWER_TIMEOUT'),initial=load(f).state;
  const next=spawnSync(process.execPath,[script,'reviewer-successor',f.root],{encoding:'utf8',timeout:240000});
  assert.equal(next.status,0,`${next.error??''} ${next.stderr}`);const report=JSON.parse(next.stdout);
  assert.equal(report.routed,'RETRY_INFRASTRUCTURE');assert.equal(report.reviewed,'HUMAN_GATE_REQUIRED');
  assert.equal(report.after.state,'REVIEWING');assert.deepEqual(report.after.candidate,report.before.candidate);
  assert.deepEqual(report.after.validations,report.before.validations);assert.deepEqual(report.before.developers,
    initial.runs.filter(r=>r.role==='Developer').map(r=>r.assignmentId));
  for(const key of ['assignmentId','attemptId','requestId','runId','childSessionId'])assert.notEqual(report.reviewerB[key],report.reviewerA[key],key);
  assert.equal(report.after.counters.attempts,report.before.counters.attempts+1);
  assert.equal(report.after.counters.dispatches,report.before.counters.dispatches+1);
  assert.equal(report.after.counters.reworkAttempts,report.before.counters.reworkAttempts);
  assert.equal(report.after.counters.infrastructureRetries,report.before.counters.infrastructureRetries);
  assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\nDeveloper\nReviewer\nReviewer\n');
});

// Provider/role and native confirmation are declared doubles. Workers, Git
// worktrees, durable stores, process takeover and orchestration are real.
const {restartFixture}=await import('./recovery-fixture.mjs');
async function developerFixture(t,options={},memorySetup){
  const f=await restartFixture(temporary(t),'DEVELOPER_INFRA',false,false,{},memorySetup,options);
  t.after(()=>f.orchestrator.dispose());return {...f,root:join(f.repo,'..')};
}
const recoveryData=f=>developerRecoveryData(load(f),{agentDataRoot:f.data,read:ref=>DurableStore.readArtifact(f.storeRoot,ref)});
const fixtureGit=(f,...args)=>execFileSync('git',['-C',f.repo,...args],{encoding:'utf8'}).trim();

test('Developer connection recovery requires a fresh native gate and retains exact scope, worktree and failed run',async t=>{
  const f=await developerFixture(t),o=f.orchestrator,before=load(f),old=before.state.runs.at(-1),ctx=channel('owner');
  assert.equal(before.state.state,'BLOCKED');assert.equal(old.status,'TERMINAL');assert.equal(old.resultRef,undefined);
  const work=before.records.find(r=>r.id===old.assignmentId).value.workRoot;
  assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'RESUME_FROM_DURABLE_STATE');
  assert.deepEqual(load(f),before,'classification cannot admit a retry');
  await assert.rejects(o.implement(o.state.revision,work),/HUMAN_GATE_REQUIRED/);
  assert.throws(()=>o.openBeforeDeveloperRecovery(o.state.revision,'foreign'),/ORCHESTRATOR_BLOCKED/);
  const request=o.openBeforeDeveloperRecovery(o.state.revision,'owner');
  assert.equal(request.gateType,'beforeImplementation');assert.notEqual(request.snapshot.gateId,before.state.gates.at(-1));
  const display=humanGateDisplay(request,{decision:'APPROVE'});
  assert.match(display,/connection error/);assert.match(display,/Recovery attempt 1 of 1/);
  assert.match(display,/same worktree with the same scope/);assert.match(display,/Do you authorize another Developer attempt/);
  assert.equal(o.events.findLast(e=>e.kind==='TRANSITION').transitionId,'TR-034');
  assert.equal(o.state.counters.infrastructureRetries,1);assert.deepEqual(o.state.runs,before.state.runs);
  assert.equal(await presentHumanGate(channel('owner',false),request),undefined);
  await assert.rejects(presentHumanGate({...ctx,mode:'rpc'},request),/HUMAN_CHANNEL_UNAVAILABLE/);
  assert.equal(o.state.state,'AWAITING_HUMAN');assert.equal(o.state.counters.dispatches,before.state.counters.dispatches);
  const receipt=await presentHumanGate(ctx,request);o.acceptHumanDecision(request.snapshot,receipt);
  assert.equal(o.state.state,'READY');assert.equal(o.events.at(-1).transitionId,'TR-038');
  await assert.rejects(o.implement(o.state.revision,join(f.root,'replacement')),/HUMAN_DECISION_STALE/);
  assert.equal((await o.implement(o.state.revision,work)).decision,'VALIDATION_REQUIRED');
  const fresh=o.state.runs.at(-1);
  for(const key of ['assignmentId','attemptId','requestId','runId','childSessionId'])assert.notEqual(fresh[key],old[key],key);
  const assignment=load(f).records.find(r=>r.id===fresh.assignmentId).value;
  assert.equal(assignment.workRoot,work);assert.equal(assignment.specHash,before.state.specHash);
  assert.deepEqual(o.state.runs.find(r=>r.assignmentId===old.assignmentId),old);
  assert.equal(o.state.counters.infrastructureRetries,1);assert.equal(o.state.counters.dispatches,before.state.counters.dispatches+1);
  assert.equal(o.state.counters.attempts,before.state.counters.attempts+1);assert.equal(o.state.counters.reworkAttempts,0);
  assert.equal(o.state.candidate.generation,1);assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'base\n');
  assert.equal(fixtureGit(f,'status','--porcelain'), '');
  const completed=load(f);
  assert.throws(()=>o.acceptHumanDecision(request.snapshot,receipt),/HUMAN_DECISION_INVALID/);
  await assert.rejects(o.implement(o.state.revision,work),/HUMAN_GATE_REQUIRED/);
  assert.equal(o.canOpenBeforeDeveloperRecovery(),false);
  assert.throws(()=>recoveryData(f),/DEVELOPER_RECOVERY_UNAVAILABLE/);
  assert.deepEqual(load(f),completed,'a completed Developer cannot be retried or accept an old receipt');
});

test('Developer connection recovery rejects partial work, tool calls, model errors, invalid proof, changed spec and exhausted limits',async t=>{
  const f=await developerFixture(t),before=load(f),run=before.state.runs.at(-1);
  const read=ref=>DurableStore.readArtifact(f.storeRoot,ref),store={agentDataRoot:f.data,read};
  const work=before.records.find(r=>r.id===run.assignmentId).value.workRoot;
  writeFileSync(join(work,'file.txt'),'partial\n');assert.throws(()=>recoveryData(f));
  assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'REMAIN_BLOCKED');
  assert.equal(readFileSync(join(work,'file.txt'),'utf8'),'partial\n','no automatic reset');
  writeFileSync(join(work,'file.txt'),'base\n');writeFileSync(join(f.repo,'extra.txt'),'dirty');assert.throws(()=>recoveryData(f));rmSync(join(f.repo,'extra.txt'));
  const transcript=readFileSync(run.childSessionId);
  for(const rows of [
    [{type:'message',message:{role:'assistant',stopReason:'error',errorMessage:'fetch failed',content:[{type:'toolCall',name:'edit'}]}}],
    [{type:'message',message:{role:'toolResult',content:[]}}],
    [{type:'message',message:{role:'assistant',stopReason:'error',errorMessage:'invalid schema',content:[]}}]
  ]){writeFileSync(run.childSessionId,Buffer.concat([transcript,Buffer.from(rows.map(JSON.stringify).join('\n')+'\n')]));assert.throws(()=>recoveryData(f),/DEVELOPER_RECOVERY_UNAVAILABLE/)}
  writeFileSync(run.childSessionId,transcript.toString().replace('fetch failed','WebSocket error'));
  assert.equal(recoveryData(f).providerError,'WebSocket error');
  writeFileSync(run.childSessionId,transcript);
  for(const patch of [
    ledger=>{ledger.state.runs.at(-1).status='UNKNOWN'},
    ledger=>{ledger.state.runs.at(-1).terminalProofRef=undefined},
    ledger=>{ledger.state.specHash='b'.repeat(64)},
    ledger=>{ledger.state.invalidEvidenceIds.push(run.terminalProofRef)},
    ledger=>{ledger.state.counters.infrastructureRetries=1},
    ledger=>{ledger.state.counters.dispatches=64}
  ]){const ledger=structuredClone(before);patch(ledger);assert.throws(()=>developerRecoveryData(ledger,store))}
  assert.ok(recoveryData(f));assert.deepEqual(load(f),before);
});

test('Developer retry confirmation becomes stale if transcript or target branch changes after display',async t=>{
  const f=await developerFixture(t),o=f.orchestrator,run=o.state.runs.at(-1),ctx=channel('owner');
  const request=o.openBeforeDeveloperRecovery(o.state.revision,'owner'),receipt=await presentHumanGate(ctx,request);
  const transcript=readFileSync(run.childSessionId);appendFileSync(run.childSessionId,'\n');
  assert.throws(()=>o.acceptHumanDecision(request.snapshot,receipt));
  writeFileSync(run.childSessionId,transcript);
  const reissued=await presentHumanGate(ctx,request);
  fixtureGit(f,'switch','-q','-c','another-target');
  assert.throws(()=>o.acceptHumanDecision(request.snapshot,reissued));
  assert.equal(o.state.state,'AWAITING_HUMAN');assert.equal(o.state.runs.length,2);
  assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'base\n');assert.equal(o.state.counters.infrastructureRetries,1);
});

test('Developer recovery live production resume can cancel, resume the same gate and reject without dispatch',async t=>{
  const f=await developerFixture(t),o=f.orchestrator,initial=o.state;
  const ctx={...productionContext(t,f),...channel('owner',false)};
  const first=await recoverProductionWorkflow(f.host,ctx,'resume',f.runtime.events);
  assert.equal(first.outcome,'NOT_CONFIRMED');assert.equal(o.state.state,'AWAITING_HUMAN');
  const id=o.state.pendingGateId;assert.equal(o.state.counters.infrastructureRetries,1);
  assert.equal((await recoverProductionWorkflow(f.host,ctx,'resume',f.runtime.events)).outcome,'NOT_CONFIRMED');
  assert.equal(o.state.pendingGateId,id);assert.equal(o.state.counters.infrastructureRetries,1);
  const request=o.pendingHumanGate,receipt=await presentHumanGate(channel('owner'),request,{decision:'REJECT'});
  o.acceptHumanDecision(request.snapshot,receipt);
  assert.equal(o.state.state,'FAILED');assert.deepEqual(o.state.runs,initial.runs);
  assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'base\n');
});

test('Developer infrastructure retry still requires approval with an optional initial implementation gate and cannot repeat past budget',async t=>{
  const f=await developerFixture(t,{repeatDeveloperFailure:true},async({spec})=>{
    spec.humanGates={...spec.humanGates,beforeImplementation:false};spec.specHash=hashContract('TaskSpec',spec);
  }),o=f.orchestrator,work=load(f).records.find(r=>r.id===o.state.runs.at(-1).assignmentId).value.workRoot;
  const request=o.openBeforeDeveloperRecovery(o.state.revision,'owner');
  await assert.rejects(o.implement(o.state.revision,work),/HUMAN_GATE_REQUIRED/);
  const receipt=await presentHumanGate(channel('owner'),request);o.acceptHumanDecision(request.snapshot,receipt);
  await assert.rejects(o.implement(o.state.revision,work),/fetch failed/);
  assert.equal(o.state.state,'BLOCKED');assert.equal(o.state.counters.infrastructureRetries,1);
  assert.equal(o.canOpenBeforeDeveloperRecovery(),false);assert.throws(()=>o.openBeforeDeveloperRecovery(o.state.revision,'owner'));
  assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'REMAIN_BLOCKED');
  assert.equal(readFileSync(join(work,'file.txt'),'utf8'),'base\n');
});

test('Developer failed owner -> takeover -> separate native gate double -> fresh writer, validation and review complete without target mutation',t=>{
  const f=dead(t,'DEVELOPER_INFRA'),before=load(f),old=before.state.runs.at(-1),head=fixtureGit(f,'rev-parse','HEAD');
  const next=spawnSync(process.execPath,[script,'workflow-successor',f.root],{encoding:'utf8',timeout:240000});
  assert.equal(next.status,0,`${next.error??''} ${next.stderr}`);const report=JSON.parse(next.stdout),after=load(f);
  assert.equal(report.state.state,'COMPLETED',report.resumeDenied);
  assert.equal(after.state.counters.infrastructureRetries,1);assert.equal(after.state.runs.filter(r=>r.role==='Scout').length,1);
  assert.deepEqual(after.state.runs.find(r=>r.assignmentId===old.assignmentId),old);
  const fresh=after.state.runs.filter(r=>r.role==='Developer').at(-1);
  for(const key of ['assignmentId','attemptId','requestId','runId','childSessionId'])assert.notEqual(fresh[key],old[key],key);
  const assignments=after.records.filter(r=>r.kind==='AssignmentEnvelope'&&r.value.role==='Developer').map(r=>r.value);
  assert.equal(assignments[0].workRoot,assignments[1].workRoot);assert.equal(assignments[0].specHash,assignments[1].specHash);
  assert.equal(after.state.candidate.generation,1);assert.equal(after.state.validations.length,1);assert.equal(after.state.reviews.length,1);
  assert.equal(fixtureGit(f,'rev-parse','HEAD'),head);assert.equal(fixtureGit(f,'status','--porcelain'),'');
  assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'base\n');
});

test('Developer recovery pending gate survives owner shutdown with its reserved budget and requires a successor presentation',async t=>{
  const f=dead(t,'DEVELOPER_RETRY_GATE'),before=load(f),gateId=before.state.pendingGateId;
  assert.equal(before.state.state,'AWAITING_HUMAN');assert.equal(before.state.counters.infrastructureRetries,1);
  const o=CentralOrchestrator.restore(take(f),runners);t.after(()=>o.dispose());
  assert.equal(o.resumeRecovered().decision,'HUMAN_GATE_REQUIRED');
  const request=o.representPendingGate(channel());assert.equal(request.snapshot.gateId,gateId);
  assert.equal(request.snapshot.sessionId,'successor');assert.deepEqual(o.state.counters,before.state.counters);
  assert.equal(await presentHumanGate(channel('successor',false),request),undefined);
  const receipt=await presentHumanGate(channel(),request);o.acceptHumanDecision(request.snapshot,receipt);
  assert.equal(o.state.state,'READY');assert.deepEqual(o.state.runs,before.state.runs);
  assert.deepEqual(o.state.counters,before.state.counters);
  const work=before.records.find(r=>r.id===before.state.runs.at(-1).assignmentId).value.workRoot;
  assert.equal(o.developerRecoveryWorktree(),work);
  assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\nDeveloper\n');
});

test('Developer recovery interrupted retry publication cannot spend another retry or reopen a gate',async t=>{
  const f=await developerFixture(t),o=f.orchestrator,data=recoveryData(f);
  const routed=o.routeFailure({phase:'IMPLEMENTING',source:'RPC_TRANSIENT',code:data.failureCode,
    subjectIds:[data.assignmentId],evidenceRefs:[data.terminalProofRef.id]},
    {dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:true,writerTerminal:true,workspaceSafe:true,sameProtocol:true,
      concreteHumanResolution:false,duplicateEscalation:false},o.state.revision);
  assert.equal(routed.decision,'RETRY_INFRASTRUCTURE');
  // Simulate shutdown after ordinary durable admission, before authorization publication.
  const before=load(f);assert.equal(before.state.counters.infrastructureRetries,1);
  assert.equal(o.canOpenBeforeDeveloperRecovery(),false);
  assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'REMAIN_BLOCKED');
  assert.throws(()=>o.openBeforeDeveloperRecovery(o.state.revision,'owner'),/ORCHESTRATOR_BLOCKED/);
  assert.deepEqual(load(f),before);assert.equal(o.state.counters.escalationEpisodes,0);
  assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'base\n');
});


test('Developer recovery rejects wrong exact run identities, completed results and any candidate generation',async t=>{
  const f=await developerFixture(t),before=load(f),run=before.state.runs.at(-1);
  const store={agentDataRoot:f.data,read:ref=>DurableStore.readArtifact(f.storeRoot,ref)};
  const cases=[
    ['wrong task',ledger=>{ledger.state.taskId='another-task'}],
    ...['runId','requestId','childSessionId','ownerSessionId','attemptId','assignmentId'].map(key=>
      [`wrong ${key}`,ledger=>{ledger.state.runs.at(-1)[key]='another-identity'}]),
    ...['BOUND','RUNNING','UNKNOWN'].map(status=>[`${status} is not terminal`,ledger=>{ledger.state.runs.at(-1).status=status}]),
    ['already accepted result',ledger=>{ledger.state.runs.at(-1).resultRef='accepted-developer-result'}],
    ['current candidate',ledger=>{ledger.state.candidate={digest:'a'.repeat(64),generation:1}}],
    ['stale candidate generation',ledger=>{ledger.state.candidate={digest:'a'.repeat(64),generation:2}}],
    ['assignment bound to another candidate',ledger=>{
      const assignment=ledger.records.find(r=>r.id===run.assignmentId).value;
      assignment.candidateDigest='a'.repeat(64);assignment.candidateGeneration=2;
      assignment.assignmentHash=hashContract('AssignmentEnvelope',assignment);
    },/STORE_ARTIFACT_INTEGRITY/],
    ['changed baseline',ledger=>{ledger.state.baselineCommit='b'.repeat(40)}],
    ['truncated durable tail',ledger=>{ledger.truncatedTailBytes=1}]
  ];
  for(const [name,mutate,error=/DEVELOPER_RECOVERY_UNAVAILABLE/] of cases){
    const ledger=structuredClone(before);mutate(ledger);
    assert.throws(()=>developerRecoveryData(ledger,store),error,name);
  }
  assert.ok(recoveryData(f));assert.deepEqual(load(f),before);
  assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'base\n');
});


test('authenticated before-spawn Reviewer receipt closes intent without phantom child and permits only bounded approved redispatch',async t=>{
 const f=dead(t,'REVIEWER_NOT_DISPATCHED'),before=load(f),run=before.state.runs.at(-1);
 assert.equal(run.status,'NOT_DISPATCHED');assert.ok(run.dispatchProofRef);assert.equal(run.runId,undefined);assert.equal(run.childSessionId,undefined);
 assert.equal(run.terminalProofRef,undefined);assert.equal(run.resultRef,undefined);assert.ok(run.requestId.startsWith('intent-'));
 assert.equal(before.state.counters.attempts,3);assert.equal(before.state.counters.dispatches,3);assert.equal(before.state.counters.infrastructureRetries,1);
 assert.equal(before.state.failures.at(-1).code,'RPC_UNAVAILABLE');assert.deepEqual(before.state.failures.at(-1).evidenceRefs,[run.dispatchProofRef]);
 assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\nDeveloper\n');
 assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'RESUME_FROM_DURABLE_STATE');
 const o=CentralOrchestrator.restore(take(f),runners);assert.equal(o.canOpenBeforeReviewerRedispatch(),true);
 const request=o.openBeforeReviewerRedispatch(o.state.revision,'successor');assert.equal(request.approvedData.previousReviewer.dispatchProofRef,run.dispatchProofRef);
 assert.equal(request.approvedData.previousReviewer.runId,undefined);const receipt=await presentHumanGate(channel(),request);o.acceptHumanDecision(request.snapshot,receipt);
 assert.deepEqual(o.state.candidate,before.state.candidate);assert.deepEqual(o.state.validations,before.state.validations);assert.deepEqual(o.state.runs,before.state.runs);
 assert.deepEqual(o.state.counters,before.state.counters);assert.equal(o.state.state,'REVIEWING');assert.deepEqual(load(f).state,o.state);o.dispose();
});


test('a preserved NOT_DISPATCHED Reviewer history can reach real reviewed completion without replaying accepted work',async t=>{
 const f=dead(t,'REVIEWER_NOT_DISPATCHED'),initial=load(f);
 const next=spawnSync(process.execPath,[script,'reviewer-successor',f.root,'complete'],{encoding:'utf8',timeout:240000});
 assert.equal(next.status,0,`${next.error??''} ${next.stderr}`);const report=JSON.parse(next.stdout);
 assert.equal(report.after.state,'COMPLETED');assert.equal(report.reviewerA.status,'NOT_DISPATCHED');assert.equal(report.reviewerB.status,'TERMINAL');assert.ok(report.reviewerB.resultRef);
 assert.equal(report.after.counters.attempts,4);assert.equal(report.after.counters.dispatches,4);assert.equal(report.after.counters.infrastructureRetries,1);
 assert.deepEqual(report.after.candidate,initial.state.candidate);assert.deepEqual(report.after.validations,initial.state.validations);
 assert.deepEqual(report.after.runs.slice(0,3),initial.state.runs);assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\nDeveloper\nReviewer\n');
 assert.equal(classifyResumeAction(f.data,f.storeRoot).action,'NO_ACTION_TERMINAL');
 const {classifyStore}=await import('../src/store-repair.ts');assert.equal(classifyStore(f.data,f.storeRoot).classification,'CLEAN');
 assert.ok(load(f).state.completionEvidenceRefs.length,'DurableStore.load validates the terminal completion proof package');
});
