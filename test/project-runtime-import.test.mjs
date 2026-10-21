import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,renameSync,rmSync,writeFileSync,readFileSync,chmodSync,readdirSync,existsSync,cpSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {installSourceLoader} from './load-source.mjs';
import {recoveryFixture} from './recovery-fixture.mjs';
installSourceLoader();
const api=await import('../src/contracts.ts');
const h=await import('../src/project-handoff.ts');
const im=await import('../src/project-runtime-import.ts');
const {takeOverImportedWorkflow}=await import('../src/recovery-resume.ts');
const {CentralOrchestrator,createAssignment,registeredRoleDispatchers,presentHumanGate}=await import('../src/orchestrator.ts');
const {DurableStore}=await import('../src/store.ts');
const {presentTrustedConfirmation}=await import('../src/trusted-confirmation.ts');
const {resolveProjectStorage}=await import('../src/project-storage.ts');
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}).trim();
const channel=session=>({mode:'tui',sessionManager:{getSessionId:()=>session},ui:{confirm:async()=>true}});
async function fixture(t,{release=true,phase='PENDING',runStatus='NONE',largeHuman=false}={}){
 const root=mkdtempSync(join(tmpdir(),'runtime-import-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const f=recoveryFixture(root,phase,runStatus);git(f.repo,'init','-q','--initial-branch=main');git(f.repo,'config','user.name','Test');git(f.repo,'config','user.email','test@example.invalid');
 writeFileSync(join(f.repo,'file.txt'),'baseline\n');git(f.repo,'add','file.txt');git(f.repo,'commit','-qm','baseline');
 const original=DurableStore.load(f.storeRoot),planning=DurableStore.project(f.data,f.repo,'planning',()=> 'ACCEPT',true);
 if(largeHuman){const notes=join(resolveProjectStorage(f.data,f.repo).projectRoot,'human','Notes','a'.repeat(230),'b'.repeat(230),'c'.repeat(230));mkdirSync(notes,{recursive:true});for(let i=0;i<1500;i++)writeFileSync(join(notes,`note-${i}-${'z'.repeat(100)}.md`),`Personal note ${i}\n`)}
 const proposal=h.prepareProjectHandoff({repoRoot:f.repo,machineDataRoot:f.data}),request=h.projectHandoffRequest(proposal);
 const receipt=await presentTrustedConfirmation(channel('owner'),request),options={store:planning,manager:f.manager,workspaceLock:f.locks.workspace,assertQuiescent(){}};
 h.completeProjectHandoff(h.authorizeProjectHandoff(proposal,receipt,options));
 if(release)h.releaseProjectHandoff({...options,repoRoot:f.repo,retireAuthority(){f.manager.release(f.locks.task)}});
 else f.manager.releaseAll(f.locks);
 const moved=join(root,'moved project'),data=join(root,'empty local profile');renameSync(f.repo,moved);rmSync(f.data,{recursive:true});mkdirSync(data);
 const taskRoot=join(resolveProjectStorage(data,moved).projectRoot,'tasks','task');
 return {...f,root,moved,newData:data,taskRoot,original};
}
async function authorize(f){const proposal=im.prepareProjectRuntimeImport(f.newData,f.moved,'task','new-native',()=> 'ACCEPT');
 const request=im.projectRuntimeImportRequest(proposal),receipt=await presentTrustedConfirmation(channel('new-native'),request);
 return {proposal,receipt,cap:im.authorizeProjectRuntimeImport(proposal,receipt)};}
test('moved project with old path and profile removed acquires a fresh local owner without rewriting history, spec or counters',async t=>{
 const f=await fixture(t),{proposal,cap}=await authorize(f);t.after(()=>{try{const l=im.projectRuntimeImportLease(cap);l.manager.releaseAll(l.locks)}catch{}});
 assert.equal(h.readProjectHandoff(f.moved).descriptorDigest,proposal.payload.handoffDigest,'Native receipt staging leaves the sealed portable bytes intact until the authenticated takeover');
 assert.throws(()=>im.projectRuntimeImportLease({...cap}),/CAPABILITY_INVALID/);
 const authority=takeOverImportedWorkflow(cap),o=CentralOrchestrator.restore(authority,{}),ledger=DurableStore.load(f.taskRoot);
 assert.equal(o.state.repoRoot,f.moved);assert.equal(o.spec.scope.repoRoot,f.repo);assert.equal(o.spec.specHash,f.original.state.specHash);
 assert.deepEqual(o.state.counters,f.original.state.counters);assert.deepEqual(ledger.events.slice(0,f.original.events.length),f.original.events);
 assert.deepEqual(ledger.records.find(r=>r.kind==='TaskSpec').value,f.original.records.find(r=>r.kind==='TaskSpec').value);
 assert.equal(o.state.revision,f.original.state.revision+1);assert.equal(ledger.events.at(-1).recordType,'RECONCILED');
 assert.equal(o.context().runtimeRootMappings[0].payload.repoRoot,f.moved);assert.equal(o.context().runtimeRootMappings[0].refId,o.state.runtimeBindingRef.id);
 const assignment=createAssignment(o.spec,o.state,'Scout');assert.equal(assignment.repoRoot,f.moved);assert.equal(assignment.workRoot,f.moved);
 assert.equal(api.validateContract('AssignmentEnvelope',assignment,o.context(assignment)).ok,true);
 const copied={...o.context(assignment),runtimeRootMappings:JSON.parse(JSON.stringify(o.context(assignment).runtimeRootMappings))};
 assert.equal(api.validateContract('AssignmentEnvelope',assignment,copied).ok,false,'JSON cannot become a physical-root capability');
 assert.equal(proposal.payload.sourceStateDigest,api.hashCanonical(f.original.state));assert.equal(o.requiresLocalWriterConfirmation,true);
 assert.throws(()=>takeOverImportedWorkflow(cap),/ALREADY_CLAIMED/);
});
test('old pending human gate is invalidated and its saved resume point needs a new local confirmation',async t=>{
 const f=await fixture(t,{phase:'AWAITING_HUMAN'}),{cap}=await authorize(f);t.after(()=>{try{const l=im.projectRuntimeImportLease(cap);l.manager.releaseAll(l.locks)}catch{}});
 const o=CentralOrchestrator.restore(takeOverImportedWorkflow(cap),{});
 assert.equal(o.state.state,'PENDING');assert.equal(o.state.pendingGateId,undefined);assert.ok(o.state.invalidEvidenceIds.includes('pending-gate'));
 assert.equal(o.context().records.find(r=>r.id==='pending-gate').value.status,'PENDING','Historical gate stays byte identical, invalidation is recorded outside it');
});
test('a data checkpoint never claims a released old owner',async t=>{
 const f=await fixture(t,{release:false});assert.throws(()=>im.prepareProjectRuntimeImport(f.newData,f.moved,'task','new-native',()=> 'ACCEPT'),/RELEASE_REQUIRED/);
});
test('UNKNOWN child remains unresolved across transfer and cannot be adopted from copied JSON',async t=>{
 const f=await fixture(t,{phase:'ANALYZING',runStatus:'UNKNOWN'});
 assert.throws(()=>im.prepareProjectRuntimeImport(f.newData,f.moved,'task','new-native',()=> 'ACCEPT'),/RECONCILIATION_REQUIRED/);
});
test('source mutation, stale seal or copied proposal/receipt fail before import authority',async t=>{
 const f=await fixture(t),p=im.prepareProjectRuntimeImport(f.newData,f.moved,'task','new-native',()=> 'ACCEPT'),q=im.projectRuntimeImportRequest(p);
 assert.throws(()=>im.projectRuntimeImportRequest({...p}),/PROPOSAL_INVALID/);
 const receipt=await presentTrustedConfirmation(channel('new-native'),q);
 assert.throws(()=>im.authorizeProjectRuntimeImport(p,JSON.parse(JSON.stringify(receipt))),/RECEIPT_INVALID/);
 writeFileSync(join(f.moved,'file.txt'),'changed after approval\n');assert.throws(()=>im.authorizeProjectRuntimeImport(p,receipt),/GIT_TARGET_DIRTY|STALE/);
 assert.deepEqual(DurableStore.load(f.taskRoot).state,f.original.state);
});

test('a quiescent normal close on the same path needs a new native owner without replaying old authorization',async t=>{
 const f=await fixture(t);const {renameSync:rename}=await import('node:fs');rename(f.moved,f.repo);f.moved=f.repo;
 f.taskRoot=join(resolveProjectStorage(f.newData,f.moved).projectRoot,'tasks','task');
 const {productionRecoveryStatus,renderProductionStatus,recoverProductionWorkflow}=await import('../src/production-bridge.ts');
 const {errorPresentation}=await import('../src/controlled-ui.ts'),{LockManager}=await import('../src/lock-manager.ts');
 // Simulate the initialized native profile, without acquiring any runtime lease.
 const machineManager=new LockManager(f.newData,'new-native','readonly-release-discovery'),oldData=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.newData;
 try{
  const ctx={...channel('new-native'),cwd:f.repo,ui:{notify(){},confirm:async()=>assert.fail('Discovery never asks for approval')}},host={ownerSessionId:'new-native',restore(){assert.fail('Discovery never restores a workflow')}},events={on(){assert.fail('Discovery never connects to agents')},emit(){assert.fail('Discovery never dispatches')}};
  const status=productionRecoveryStatus(ctx,'task');assert.match(status.storageResumeHint,/resume-storage task/);assert.match(status.message,/closed with a verified save/);assert.doesNotMatch(status.message,/The task was interrupted/);
  const overview=renderProductionStatus(ctx,undefined,'task');assert.match(overview,/resume-storage task/);assert.doesNotMatch(overview,/Use \/controlled-dev recover to check/);
  for(const action of ['recover','resume'])await assert.rejects(()=>recoverProductionWorkflow(host,ctx,action,events,'task'),error=>{assert.equal(error.message,'PROJECT_RUNTIME_IMPORT_REQUIRED');assert.match(errorPresentation(error).message,/new local confirmation/);return true});
  assert.deepEqual(DurableStore.load(f.taskRoot),f.original);assert.match(errorPresentation(new Error('TAKEOVER_OWNER_DEATH_UNPROVEN')).message,/alone, does not prove|alone does not prove/);assert.match(errorPresentation(new Error('PAYLOAD_LIMIT')).message,/may be incomplete|may have stopped partway|may be partial/);
  const live=machineManager.acquireWorkspace(f.repo);try{assert.equal(productionRecoveryStatus(ctx,'task').storageResumeHint,undefined,'A local live lease does not advertise released import')}finally{machineManager.release(live)}
  const pointer=join(f.repo,'.controlled-dev','handoff.json'),raw=readFileSync(pointer);try{writeFileSync(pointer,'{invalid');assert.equal(productionRecoveryStatus(ctx,'task').storageResumeHint,undefined,'A corrupt release record cannot provide a proven hint')}finally{writeFileSync(pointer,raw)}
 }finally{if(oldData===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=oldData}
 const {cap}=await authorize(f);t.after(()=>{try{const l=im.projectRuntimeImportLease(cap);l.manager.releaseAll(l.locks)}catch{}});
 const o=CentralOrchestrator.restore(takeOverImportedWorkflow(cap),{});
 assert.equal(o.state.repoRoot,f.repo);assert.equal(o.state.ownerSessionId,'new-native');assert.equal(o.state.revision,f.original.state.revision+1);
 assert.deepEqual(o.state.counters,f.original.state.counters);assert.equal(o.requiresLocalWriterConfirmation,true);
 o.dispose();assert.equal(h.readProjectHandoff(f.repo).ownerDisposition,'RELEASED_FOR_TRANSFER');
 const {cap:next}=await authorize(f);t.after(()=>{try{const l=im.projectRuntimeImportLease(next);l.manager.releaseAll(l.locks)}catch{}});
 const reopened=CentralOrchestrator.restore(takeOverImportedWorkflow(next),{});assert.equal(reopened.state.revision,o.state.revision+1);
 assert.deepEqual(reopened.state.counters,f.original.state.counters);
});

test('published candidate survives deletion of old source/profile and resumes with fresh host checks and local review confirmation',async t=>{
 const {completedFixture}=await import('./candidate-promotion-fixture.mjs');
 const {captureCandidateCheckpointStaging}=await import('../src/candidate-checkpoints.ts');
 const {LockManager}=await import('../src/lock-manager.ts');
 const f=await completedFixture({checkpoint:'FINAL_GATE',freeze:false});t.after(()=>rmSync(f.root,{recursive:true,force:true}));
 const original=DurableStore.load(f.storeRoot),originalContent=readFileSync(join(f.state.candidate.root,'file.txt')),manager=new LockManager(f.data,f.locks.workspace.record.ownerSessionId,f.locks.workspace.record.runtimeGeneration),planning=DurableStore.project(f.data,f.repo,'planning',()=> 'ACCEPT',true);
 const p=h.prepareProjectHandoff({repoRoot:f.repo,machineDataRoot:f.data}),q=h.projectHandoffRequest(p),receipt=await presentTrustedConfirmation(channel('owner'),q);
 const options={manager,workspaceLock:f.locks.workspace,store:planning,assertQuiescent(){assert.ok(original.state.runs.every(r=>r.status==='TERMINAL'))}};
 const cap=h.authorizeProjectHandoff(p,receipt,options);const adopted=h.completeProjectHandoff(cap,{captureCandidates(auth){return [captureCandidateCheckpointStaging(auth,f.storeRoot,{manager,workspaceLock:f.locks.workspace}).descriptorRelativePath]}});
 h.releaseProjectHandoff({...options,repoRoot:f.repo,candidateDescriptors:adopted.candidateDescriptors,retireAuthority(){manager.release(f.locks.task)}});
 const moved=join(f.root,'new physical project'),newData=join(f.root,'new host');renameSync(f.repo,moved);rmSync(f.data,{recursive:true});mkdirSync(newData);
 const proposal=im.prepareProjectRuntimeImport(newData,moved,'task','fresh-owner',()=> 'ACCEPT'),request=im.projectRuntimeImportRequest(proposal),r=await presentTrustedConfirmation(channel('fresh-owner'),request),imported=im.authorizeProjectRuntimeImport(proposal,r);
 t.after(()=>{try{const l=im.projectRuntimeImportLease(imported);l.manager.releaseAll(l.locks)}catch{}});
 const runtime={events:{on(){return()=>{}},emit(){}},ownerSessionId:'fresh-owner'};
 for(const role of ['scout','developer','reviewer','oracle'])runtime[role]={name:`controlled.${role}`,runtimeGeneration:'fixture',active:()=>true};
 const o=CentralOrchestrator.restore(takeOverImportedWorkflow(imported),registeredRoleDispatchers(runtime)),taskRoot=im.projectRuntimeImportLease(imported).taskRoot;
 assert.equal(o.state.state,'TESTING');assert.equal(o.spec.scope.repoRoot,f.repo);assert.equal(o.state.repoRoot,moved);
 assert.equal(o.state.candidate.digest,original.state.candidate.digest);assert.equal(o.state.candidate.generation,original.state.candidate.generation);
 assert.deepEqual(o.state.counters,original.state.counters);assert.deepEqual(readFileSync(join(o.state.candidate.root,'file.txt')),originalContent);
 assert.ok(original.state.validations.every(id=>o.state.invalidEvidenceIds.includes(id)));assert.throws(()=>o.createImportedReviewRequest('fresh-owner'),/PROJECT_IMPORTED_REVIEW_CONFIRMATION_REQUIRED/);
 await assert.rejects(()=>o.reviewParallel(o.state.revision,{}),/PROJECT_IMPORTED_REVIEW_CONFIRMATION_REQUIRED/);
 o.validateApproved(o.state.revision);const after=DurableStore.load(taskRoot),fresh=after.records.filter(r=>r.kind==='ValidationResult'&&!o.state.invalidEvidenceIds.includes(r.id));
 assert.equal(fresh.length,1);assert.equal(fresh[0].value.status,'PASSED');assert.equal(fresh[0].value.exitCode,0);assert.ok(!original.state.validations.includes(fresh[0].id));
 const review=o.createImportedReviewRequest('fresh-owner');assert.ok(review);const confirm=await presentTrustedConfirmation(channel('fresh-owner'),review);o.acceptImportedReview(review,confirm);
 const a=createAssignment(o.spec,o.state,'Reviewer',{inputArtifactRefs:[]});assert.equal(a.repoRoot,moved);assert.equal(a.workRoot,o.state.candidate.root);assert.equal(api.validateContract('AssignmentEnvelope',a,o.context(a)).ok,true);
 const c=o.candidateCapture;await o.review(o.state.revision,{candidateManifest:c.manifest,diff:c.patch,changedFiles:c.changedFiles,handoff:c.handoff,residualRisks:[],evidenceRefs:['source']});
 assert.equal(o.state.runs.at(-1).ownerSessionId,'fresh-owner');assert.equal(o.state.runs.at(-1).status,'TERMINAL');
 o.resolveHostValidationRisks(o.state.revision);const gate=o.openBeforeCompletion(o.state.revision,'fresh-owner');
 const completionReceipt=await presentHumanGate(channel('fresh-owner'),gate);o.acceptHumanDecision(gate.snapshot,completionReceipt);o.complete(o.state.revision);
 assert.equal(o.state.state,'COMPLETED');assert.equal(h.readProjectHandoff(moved).ownerDisposition,'RELEASED_FOR_TRANSFER');
 assert.equal(o.state.counters.attempts,original.state.counters.attempts+1);assert.equal(o.state.counters.dispatches,original.state.counters.dispatches+1);assert.equal(o.state.counters.reworkAttempts,original.state.counters.reworkAttempts);
});

test('new work saved on a second host checkpoints automatically and transfers with its per-task origin intact',async t=>{
 const {restartFixture}=await import('./recovery-fixture.mjs');const {CandidatePromotionRepository:Promotion}=await import('../src/candidate-promotion-repository.ts');
 const {physicalProjectRootForTask}=await import('../src/project-storage.ts');
 const root=mkdtempSync(join(tmpdir(),'multi-hop-origin-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const repo=join(root,'repo'),data=join(root,'data'),origin=join(root,'first host unavailable');mkdirSync(repo);mkdirSync(data);
 git(repo,'init','-q','--initial-branch=main');git(repo,'config','user.name','Test');git(repo,'config','user.email','test@example.invalid');writeFileSync(join(repo,'file.txt'),'base\n');git(repo,'add','file.txt');git(repo,'commit','-qm','baseline');
 const base=git(repo,'rev-parse','HEAD'),projectId=api.hashBytes(Buffer.from(origin));mkdirSync(join(repo,'.controlled-dev'));
 writeFileSync(join(repo,'.controlled-dev','project.json'),api.canonicalize({schemaVersion:1,projectId,originalRepoRoot:origin,baselineCommit:base,baselineTree:git(repo,'rev-parse','HEAD^{tree}')}));
 writeFileSync(join(repo,'.git','info','exclude'),'/.controlled-dev/\n/Documentazione/\n');
 const f=await restartFixture(root,'FINAL_GATE',false,false,{},async({spec})=>{
  const promotion=Promotion.open(data,repo,()=> 'ACCEPT',{create:true});promotion.initialize(spec,base);return {candidateRoot:promotion.materialize('task')};
 },{existingRepo:true});
 const before=DurableStore.load(f.storeRoot),pointer=JSON.parse(readFileSync(join(repo,'.controlled-dev','handoff.json'),'utf8')),held=JSON.parse(readFileSync(join(repo,'.controlled-dev','handoffs',pointer.descriptorDigest+'.json'),'utf8'));assert.equal(api.hashCanonical(held),pointer.descriptorDigest);assert.equal(held.ownerDisposition,'LEASE_HELD_CHECKPOINT');
 assert.ok(held.candidateDescriptors.length);assert.ok(held.taskHeads[0].stateRevision<before.state.revision,'Last validation checkpoint precedes review/final gate');
 const published=before.events.find(e=>e.recordType==='CANDIDATE_MATERIALIZED');assert.ok(published);
 const o=f.orchestrator;o.dispose();const closed=h.readProjectHandoff(repo);assert.equal(closed.ownerDisposition,'RELEASED_FOR_TRANSFER');assert.equal(closed.taskHeads[0].stateRevision,before.state.revision);
 const moved=join(root,'third host folder'),newData=join(root,'third host private');renameSync(repo,moved);rmSync(data,{recursive:true});mkdirSync(newData);
 const p=im.prepareProjectRuntimeImport(newData,moved,'task','third-native',()=> 'ACCEPT'),q=im.projectRuntimeImportRequest(p),r=await presentTrustedConfirmation(channel('third-native'),q),cap=im.authorizeProjectRuntimeImport(p,r);
 t.after(()=>{try{const l=im.projectRuntimeImportLease(cap);l.manager.releaseAll(l.locks)}catch{}});
 const imported=CentralOrchestrator.restore(takeOverImportedWorkflow(cap),{}),ledger=DurableStore.load(im.projectRuntimeImportLease(cap).taskRoot);
 assert.equal(imported.spec.scope.repoRoot,repo);assert.equal(p.payload.projectOriginalRepoRoot,origin);assert.equal(p.payload.historicalRepoRoot,repo);assert.equal(imported.state.repoRoot,moved);
 assert.equal(physicalProjectRootForTask(im.projectRuntimeImportLease(cap).taskRoot,repo,ledger),moved);
 assert.throws(()=>physicalProjectRootForTask(im.projectRuntimeImportLease(cap).taskRoot,join(root,'foreign'),ledger),/PROJECT_STORAGE_PATH_INVALID/);
 assert.deepEqual(imported.state.counters,before.state.counters);assert.equal(imported.state.candidate.digest,before.state.candidate.digest);
 const a=createAssignment(imported.spec,imported.state,'Reviewer');assert.equal(a.repoRoot,moved);assert.equal(api.validateContract('AssignmentEnvelope',a,imported.context(a)).ok,true);
});

test('physical mode changes after native import presentation invalidate approval even when Git ignores file modes',async t=>{
 const f=await fixture(t);git(f.moved,'config','core.filemode','false');
 const p=im.prepareProjectRuntimeImport(f.newData,f.moved,'task','new-native',()=> 'ACCEPT'),q=im.projectRuntimeImportRequest(p),r=await presentTrustedConfirmation(channel('new-native'),q);
 chmodSync(join(f.moved,'file.txt'),0o755);assert.equal(git(f.moved,'status','--porcelain'),'');
 assert.throws(()=>im.authorizeProjectRuntimeImport(p,r),/PROJECT_RUNTIME_IMPORT_SOURCE_CHANGED/);assert.deepEqual(DurableStore.load(f.taskRoot).state,f.original.state);
});

test('personal notes changed after release remain preserved and their exact new bytes bind the fresh local confirmation',async t=>{
 const f=await fixture(t),notes=join(f.moved,'Documentazione','Notes');mkdirSync(notes,{recursive:true});const note=join(notes,'personali.md');writeFileSync(note,'First personal version\n');
 assert.throws(()=>h.readProjectHandoff(f.moved),/PROJECT_HANDOFF_CHECKPOINT_STALE/);
 const p=im.prepareProjectRuntimeImport(f.newData,f.moved,'task','new-native',()=> 'ACCEPT'),q=im.projectRuntimeImportRequest(p),r=await presentTrustedConfirmation(channel('new-native'),q);
 assert.match(q.presentation.content,/Documentazione\/Notes\/personali.md/);assert.doesNotMatch(q.presentation.content,/First personal version/);
 writeFileSync(note,'Second personal version\n');assert.throws(()=>im.authorizeProjectRuntimeImport(p,r),/PROJECT_RUNTIME_IMPORT_HUMAN_CHANGED/);
 const fresh=await authorize(f);t.after(()=>{try{const l=im.projectRuntimeImportLease(fresh.cap);l.manager.releaseAll(l.locks)}catch{}});
 assert.notEqual(fresh.proposal.payload.humanDigest,p.payload.humanDigest);const o=CentralOrchestrator.restore(takeOverImportedWorkflow(fresh.cap),{});
 assert.equal(readFileSync(note,'utf8'),'Second personal version\n');assert.equal(o.state.repoRoot,f.moved);assert.deepEqual(o.state.counters,f.original.state.counters);
});

test('native storage chooser and explicit bridge restore only verified nonterminal work, with cancellation preserving state',async t=>{
 const f=await fixture(t),prior=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.newData;t.after(()=>{if(prior===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=prior});
 const {productionProjectStorageResumeChoices,resumeProductionProjectStorage}=await import('../src/production-bridge.ts');const {OrchestratorHost}=await import('../src/orchestrator.ts');
 const notices=[],ctx={...channel('new-native'),cwd:f.moved};ctx.ui.notify=(text)=>notices.push(text);ctx.ui.confirm=async()=>false;
 const choices=productionProjectStorageResumeChoices(ctx);assert.equal(choices.length,1);assert.equal(choices[0].taskId,'task');
 const host=new OrchestratorHost('new-native',{});assert.equal(await resumeProductionProjectStorage(host,ctx,'task'),false);assert.equal(host.current,undefined);assert.deepEqual(DurableStore.load(f.taskRoot).state,f.original.state);
 ctx.ui.confirm=async()=>true;assert.equal(await resumeProductionProjectStorage(host,ctx,'task'),true);assert.equal(host.current.state.repoRoot,f.moved);assert.equal(host.current.spec.scope.repoRoot,f.repo);assert.deepEqual(host.current.state.counters,f.original.state.counters);assert.equal(host.current.state.runs.length,f.original.state.runs.length);
 assert.match(notices.at(-1),/checks and confirmations/i);host.dispose();assert.equal(h.readProjectHandoff(f.moved).ownerDisposition,'RELEASED_FOR_TRANSFER');
});
test('legacy menu has no portable-work choices and orderly close leaves its profile untouched',async t=>{
 const root=mkdtempSync(join(tmpdir(),'storage-menu-legacy-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const repo=join(root,'repo'),data=join(root,'profile');mkdirSync(repo);mkdirSync(data);const prior=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=data;
 t.after(()=>{if(prior===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=prior});
 const {productionProjectStorageResumeChoices,releaseProductionProjectStorage}=await import('../src/production-bridge.ts');
 assert.deepEqual(productionProjectStorageResumeChoices({...channel('native'),cwd:repo}),[]);await releaseProductionProjectStorage({cwd:repo});assert.deepEqual(readdirSync(data),[]);
});
test('close without an active task seals personal changes and retains an uncertain-project lease on failure',async t=>{
 const f=await fixture(t),prior=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.newData;
 t.after(()=>{if(prior===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=prior});
 const {releaseProductionProjectStorage}=await import('../src/production-bridge.ts');const note=join(f.moved,'Documentazione','Notes','close.md');mkdirSync(join(f.moved,'Documentazione','Notes'),{recursive:true});writeFileSync(note,'Saved personal note\n');
 await releaseProductionProjectStorage({cwd:f.moved});assert.equal(h.readProjectHandoff(f.moved).ownerDisposition,'RELEASED_FOR_TRANSFER');assert.equal(readFileSync(note,'utf8'),'Saved personal note\n');assert.deepEqual(DurableStore.load(f.taskRoot).state,f.original.state);
 const uncertain=await fixture(t,{phase:'ANALYZING',runStatus:'UNKNOWN'});process.env.PI_CODING_AGENT_DIR=uncertain.newData;
 const before=readFileSync(join(uncertain.moved,'.controlled-dev','handoff.json'));
 await assert.rejects(()=>releaseProductionProjectStorage({cwd:uncertain.moved}),/PROJECT_HANDOFF_ROLE_NOT_QUIESCENT/);
 assert.deepEqual(readFileSync(join(uncertain.moved,'.controlled-dev','handoff.json')),before);assert.deepEqual(DurableStore.load(uncertain.taskRoot).state,uncertain.original.state);
 const workspaceHash=api.hashBytes(Buffer.from(uncertain.moved));assert.equal(existsSync(join(uncertain.newData,'controlled-dev','locks','workspaces',workspaceHash+'.lock')),true,'Uncertain ownership stays recorded for explicit reconciliation');
});

test('dirty source shutdown disposes runtime roles without acquiring or retaining a new host lease',async t=>{
 const f=await fixture(t),previous=process.env.PI_CODING_AGENT_DIR;
 process.env.PI_CODING_AGENT_DIR=f.newData;
 t.after(()=>{if(previous===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=previous});
 const pointer=readFileSync(join(f.moved,'.controlled-dev','handoff.json'));
 writeFileSync(join(f.moved,'file.txt'),'operator work must survive\n');
 const {LockManager}=await import('../src/lock-manager.ts');let acquisitions=0;
 t.mock.method(LockManager.prototype,'acquireWorkspace',()=>{acquisitions++;throw new Error('UNEXPECTED_SHUTDOWN_LEASE')});
 const hooks=new Map(),disposed=[];
 const {default:extension}=await import('../extensions/controlled-dev.ts');
 extension({registerCommand(){},getAllTools:()=>[],setActiveTools(){},events:{on(){return()=>{}},emit(name,request){
  if(name==='pi-subagents:runtime-agent-register:v1')request.result={ok:true,registration:{dispose(){disposed.push(request.name)}}};
 }},on(name,fn){hooks.set(name,fn);return()=>{}}});
 const ctx={...channel('shutdown-native'),cwd:f.moved};
 await hooks.get('session_start')({},ctx);
 await assert.rejects(()=>hooks.get('session_shutdown')({},ctx),/GIT_TARGET_DIRTY/);
 assert.equal(acquisitions,0,'Known dirty source must fail before reserving a host lease');
 assert.deepEqual(disposed.sort(),['controlled.developer','controlled.oracle','controlled.reviewer','controlled.scout']);
 assert.deepEqual(readFileSync(join(f.moved,'.controlled-dev','handoff.json')),pointer);
 assert.deepEqual(DurableStore.load(f.taskRoot).state,f.original.state);
 assert.equal(readFileSync(join(f.moved,'file.txt'),'utf8'),'operator work must survive\n');
});

test('a genuine host handoff manifest above one MiB restores with exact references while small-document limits stay strict',async t=>{
 const f=await fixture(t,{largeHuman:true}),seal=h.readProjectHandoff(f.moved),sealPath=join(f.moved,'.controlled-dev','handoffs',seal.descriptorDigest+'.json'),sealRaw=readFileSync(sealPath);
 assert.ok(sealRaw.byteLength>1024*1024);assert.ok(sealRaw.byteLength<64*1024*1024);assert.ok(seal.namespaceManifest.length>=1500);
 const {cap}=await authorize(f);t.after(()=>{try{const l=im.projectRuntimeImportLease(cap);l.manager.releaseAll(l.locks)}catch{}});
 const o=CentralOrchestrator.restore(takeOverImportedWorkflow(cap),{}),ledger=DurableStore.load(f.taskRoot);
 assert.equal(o.state.repoRoot,f.moved);assert.deepEqual(o.state.counters,f.original.state.counters);assert.equal(o.context().runtimeRootMappings[0].payload.handoffDigest,seal.descriptorDigest);
 const record=ledger.records.find(r=>r.kind==='ArtifactRef'&&r.value.mediaType==='application/vnd.pi-controlled-dev.runtime-root-binding+json'),binding=JSON.parse(DurableStore.readArtifact(f.taskRoot,record.value));
 assert.equal(binding.handoffRef.bytes,sealRaw.byteLength);assert.deepEqual(Buffer.from(DurableStore.readArtifact(f.taskRoot,binding.handoffRef)),sealRaw);
 const {verifiedRuntimeRootMappings}=await import('../src/runtime-root-binding.ts');
 for(const id of [record.id,binding.confirmationRef.id]){
  const old=ledger.records.find(r=>r.kind==='ArtifactRef'&&r.id===id).value,raw=Buffer.from(' '.repeat(1024*1024)+'{}'),ref={...old,bytes:raw.length,digest:api.hashBytes(raw)},overrides=new Map([[id,{ref,raw}]]);
  if(id===binding.confirmationRef.id){const boundRaw=Buffer.from(api.canonicalize({...binding,confirmationRef:ref}));overrides.set(record.id,{ref:{...record.value,bytes:boundRaw.length,digest:api.hashBytes(boundRaw)},raw:boundRaw})}
  const records=ledger.records.map(r=>overrides.has(r.id)?{...r,value:overrides.get(r.id).ref}:r);
  assert.throws(()=>verifiedRuntimeRootMappings(records,ledger.events,{read(r){return overrides.get(r.id)?.raw??DurableStore.readArtifact(f.taskRoot,r)}}),/PAYLOAD_LIMIT/);
 }
});

test('bounded recovery errors explain incomplete ownership and a potentially partial import without promising no effects',async()=>{
 const {errorPresentation}=await import('../src/controlled-ui.ts');
 assert.match(errorPresentation(new Error('PROJECT_RUNTIME_IMPORT_REQUIRED')).message,/new local confirmation/);
 assert.match(errorPresentation(new Error('TAKEOVER_OWNER_DEATH_UNPROVEN')).message,/alone, does not prove|alone does not prove/);
 const size=errorPresentation(new Error('PAYLOAD_LIMIT'));assert.match(size.message,/may be incomplete|may have stopped partway|may be partial/);assert.doesNotMatch(size.message,/No.*acquired|No.*changes/);
});

test('caught failure before host installation preserves artifacts, reseals verified heads and releases the genuine import lease',async t=>{
 const f=await fixture(t),prior=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.newData;t.after(()=>{if(prior===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=prior});
 const {resumeProductionProjectStorage}=await import('../src/production-bridge.ts'),{OrchestratorHost}=await import('../src/orchestrator.ts'),host=new OrchestratorHost('new-native',{}),oldSeal=h.readProjectHandoff(f.moved),notices=[];
 host.restore=()=>{throw new Error('FIXTURE_RESTORE_REJECTED')};
 await assert.rejects(()=>resumeProductionProjectStorage(host,{...channel('new-native'),cwd:f.moved,ui:{confirm:async()=>true,notify(text){notices.push(text)}}},'task'),/FIXTURE_RESTORE_REJECTED/);
 assert.equal(host.current,undefined);assert.deepEqual(DurableStore.load(f.taskRoot),f.original);const seal=h.readProjectHandoff(f.moved);assert.equal(seal.ownerDisposition,'RELEASED_FOR_TRANSFER');assert.notEqual(seal.descriptorDigest,oldSeal.descriptorDigest);
 assert.ok(readdirSync(join(f.taskRoot,'artifacts')).some(id=>id.startsWith('runtime-binding-')),'Staged artifacts remain preserved');
 const journal=join(f.newData,'controlled-dev','runtime-imports'),files=readdirSync(journal);assert.ok(files.some(n=>n.endsWith('-reserved.json')));assert.ok(files.some(n=>n.endsWith('-failed_before_host_install.json')));assert.ok(files.some(n=>n.endsWith('-closed_no_dispatch.json')));
 assert.deepEqual(readdirSync(join(f.newData,'controlled-dev','locks','tasks')),[]);assert.ok(!readdirSync(join(f.newData,'controlled-dev','locks','workspaces')).some(n=>n.endsWith('.lock')));
 const next=im.prepareProjectRuntimeImport(f.newData,f.moved,'task','new-native',()=> 'ACCEPT');assert.equal(next.payload.sourceStateDigest,api.hashCanonical(f.original.state));
});
test('caught failure after a verified rebind commit keeps that history and closes without replay or counter changes',async t=>{
 const f=await fixture(t),{cap}=await authorize(f),authority=takeOverImportedWorkflow(cap),o=CentralOrchestrator.restore(authority,{}),before=DurableStore.load(f.taskRoot);
 assert.equal(before.state.revision,f.original.state.revision+1);im.abortProjectRuntimeImport(cap,new Error('FIXTURE_AFTER_CONSTRUCTOR'));
 assert.deepEqual(DurableStore.load(f.taskRoot),before);assert.equal(h.readProjectHandoff(f.moved).ownerDisposition,'RELEASED_FOR_TRANSFER');assert.throws(()=>im.projectRuntimeImportLease(cap),/CAPABILITY_INVALID/);
 const next=im.prepareProjectRuntimeImport(f.newData,f.moved,'task','next-native',()=> 'ACCEPT');assert.equal(next.payload.sourceRevision,before.state.revision);assert.deepEqual(before.state.counters,f.original.state.counters);
 assert.throws(()=>o.ready(o.state.revision),/LOCK|STATE|RECOVERY_AUTHORITY_INVALID/);
});
test('uncertain failure preserves the reserved lease and audit instead of claiming a safe release',async t=>{
 const f=await fixture(t),{cap}=await authorize(f),lease=im.projectRuntimeImportLease(cap);t.after(()=>{try{lease.manager.releaseAll(lease.locks)}catch{}});
 writeFileSync(join(f.moved,'file.txt'),'Changed after acquisition\n');assert.throws(()=>im.abortProjectRuntimeImport(cap,new Error('FIXTURE_UNCERTAIN')),/GIT_TARGET_DIRTY|ABORT_UNCERTAIN/);
 assert.equal(lease.manager.verifyTaskLock(lease.locks.task),true);assert.equal(lease.manager.verifyWorkspaceLock(lease.locks.workspace),true);assert.deepEqual(DurableStore.load(f.taskRoot),f.original);
 assert.ok(readdirSync(join(f.newData,'controlled-dev','runtime-imports')).some(n=>n.endsWith('-reserved.json')));
 assert.throws(()=>im.abortProjectRuntimeImport({...cap},new Error('COPIED')),/ABORT_DENIED/);
});

function crashImport(f,{staging=false}={}){
 // Genuine host APIs run in a separate Linux process. For the legacy fixture,
 // only publication mechanics are reverted: no prewrite journal, ordinal state
 // artifact ID, and an explicit pre-WAL store fault. No receipt, PID, lock,
 // workflow result or accepted history is fabricated.
 let source=fileURLToPath(new URL('../src/',import.meta.url));
 if(staging){const copy=join(f.root,'legacy-source');cpSync(source,copy,{recursive:true});source=copy+'/';const importer=join(copy,'project-runtime-import.ts');writeFileSync(importer,readFileSync(importer,'utf8').replace("function persistJournal(data:string,journal:RuntimeImportJournal,phase:string,details:Record<string,unknown>={}):void{","function persistJournal(data:string,journal:RuntimeImportJournal,phase:string,details:Record<string,unknown>={}):void{return;"));const orchestrator=join(copy,'orchestrator.ts');writeFileSync(orchestrator,readFileSync(orchestrator,'utf8').replace("nextId=`state-r${previous.revision+1}${this.#store?'-'+hashBytes(Buffer.from(nextText)):''}`","nextId=`state-r${previous.revision+1}`"))}
 const script=`import {installSourceLoader} from ${JSON.stringify(new URL('./load-source.mjs',import.meta.url).href)};installSourceLoader();
 const im=await import(${JSON.stringify(pathToFileURL(join(source,'project-runtime-import.ts')).href)}),tc=await import(${JSON.stringify(pathToFileURL(join(source,'trusted-confirmation.ts')).href)});
 const p=im.prepareProjectRuntimeImport(${JSON.stringify(f.newData)},${JSON.stringify(f.moved)},'task','crashed-native',()=> 'ACCEPT'),q=im.projectRuntimeImportRequest(p),r=await tc.presentTrustedConfirmation({mode:'tui',sessionManager:{getSessionId:()=> 'crashed-native'},ui:{confirm:async()=>true}},q),cap=im.authorizeProjectRuntimeImport(p,r);
 if(${staging}){const {DurableStore}=await import(${JSON.stringify(pathToFileURL(join(source,'store.ts')).href)}),{takeOverImportedWorkflow}=await import(${JSON.stringify(pathToFileURL(join(source,'recovery-resume.ts')).href)}),{CentralOrchestrator}=await import(${JSON.stringify(pathToFileURL(join(source,'orchestrator.ts')).href)});DurableStore.prototype.commit=function(){throw new Error('FIXTURE_PRE_WAL_INTERRUPTED')};try{CentralOrchestrator.restore(takeOverImportedWorkflow(cap),{})}catch(e){if(e.message!=='FIXTURE_PRE_WAL_INTERRUPTED')throw e}}
 console.log(JSON.stringify({process:im.projectRuntimeImportLease(cap).locks.task.record.processIncarnation,staging:${staging}}));`;
 return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024}));
}
test('a real dead journaled import with no portable writes closes only after a fresh native decision',async t=>{
 const f=await fixture(t),child=crashImport(f),{inspectProcessOwner,currentProcessIncarnation}=await import('../src/process-incarnation.ts');assert.equal(inspectProcessOwner(child.process).status,'DEAD');
 const p=im.prepareProjectRuntimeImportRecovery(f.newData,f.moved,'task','successor-native',()=> 'ACCEPT');assert.equal(p.evidenceKind,'JOURNALED_NO_PORTABLE_WRITES');assert.deepEqual(p.stagingRefs,[]);
 assert.throws(()=>im.projectRuntimeImportRecoveryRequest({...p}),/PROPOSAL_INVALID/);
 const hash=api.hashBytes(Buffer.from(f.moved)),workspace=join(f.newData,'controlled-dev','locks','workspaces',hash+'.lock'),old=readFileSync(workspace),record=JSON.parse(old);
 for(const incarnation of [currentProcessIncarnation(),{...child.process,bootId:'a'.repeat(36)}]){writeFileSync(workspace,JSON.stringify({...record,processIncarnation:incarnation}));assert.throws(()=>im.prepareProjectRuntimeImportRecovery(f.newData,f.moved,'task','successor-native',()=> 'ACCEPT'),/OWNER_NOT_DEAD/)}writeFileSync(workspace,old);
 const q=im.projectRuntimeImportRecoveryRequest(p),r=await presentTrustedConfirmation(channel('successor-native'),q);assert.throws(()=>im.recoverProjectRuntimeImport(p,JSON.parse(JSON.stringify(r))),/RECEIPT_INVALID/);
 im.recoverProjectRuntimeImport(p,r);assert.deepEqual(DurableStore.load(f.taskRoot),f.original);assert.equal(h.readProjectHandoff(f.moved).ownerDisposition,'RELEASED_FOR_TRANSFER');assert.equal(existsSync(workspace),false);
 assert.throws(()=>im.recoverProjectRuntimeImport(p,r),/PROPOSAL_INVALID/);assert.ok(im.prepareProjectRuntimeImport(f.newData,f.moved,'task','successor-native',()=> 'ACCEPT'));
});
test('real pre-WAL legacy staging preserves six orphans, verifies the dead pair, closes, and reimports with a second new decision',async t=>{
 const f=await fixture(t),child=crashImport(f,{staging:true}),{inspectProcessOwner}=await import('../src/process-incarnation.ts');assert.equal(inspectProcessOwner(child.process).status,'DEAD');assert.deepEqual(DurableStore.load(f.taskRoot),f.original);
 const p=im.prepareProjectRuntimeImportRecovery(f.newData,f.moved,'task','fresh-native',()=> 'ACCEPT');assert.equal(p.evidenceKind,'LEGACY_PRECOMMIT_STAGING');assert.equal(p.stagingRefs.length,6);
 const originals=new Map(p.stagingRefs.map(ref=>[ref.id,readFileSync(join(f.taskRoot,'artifacts',ref.id))]));assert.ok(originals.has('state-r1'));
 const q=im.projectRuntimeImportRecoveryRequest(p),r=await presentTrustedConfirmation(channel('fresh-native'),q);im.recoverProjectRuntimeImport(p,r);assert.deepEqual(DurableStore.load(f.taskRoot),f.original);
 for(const [id,raw] of originals)assert.deepEqual(readFileSync(join(f.taskRoot,'artifacts',id)),raw);
 const next=im.prepareProjectRuntimeImport(f.newData,f.moved,'task','fresh-native',()=> 'ACCEPT'),request=im.projectRuntimeImportRequest(next),receipt=await presentTrustedConfirmation(channel('fresh-native'),request),cap=im.authorizeProjectRuntimeImport(next,receipt);t.after(()=>{try{const l=im.projectRuntimeImportLease(cap);l.manager.releaseAll(l.locks)}catch{}});
 const o=CentralOrchestrator.restore(takeOverImportedWorkflow(cap),{});im.completeProjectRuntimeImport(cap);assert.equal(o.state.revision,f.original.state.revision+1);assert.equal(o.state.repoRoot,f.moved);assert.deepEqual(o.state.counters,f.original.state.counters);
 assert.notEqual(DurableStore.load(f.taskRoot).events.at(-1).stateAfter.id,'state-r1');for(const [id,raw] of originals)assert.deepEqual(readFileSync(join(f.taskRoot,'artifacts',id)),raw);
});

test('exact held checkpoint releases its saved data without rebuilding task views or granting an old writer',async t=>{
 const f=await fixture(t,{release:false}),prior=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.newData;t.after(()=>prior===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=prior);
 const {releaseProductionProjectStorage}=await import('../src/production-bridge.ts');
 const namespace=api.canonicalize(h.projectHandoffNamespaceManifest(f.moved)),before=DurableStore.load(f.taskRoot);
 await releaseProductionProjectStorage({cwd:f.moved});
 assert.equal(h.readProjectHandoff(f.moved).ownerDisposition,'RELEASED_FOR_TRANSFER');assert.equal(api.canonicalize(h.projectHandoffNamespaceManifest(f.moved)),namespace);assert.deepEqual(DurableStore.load(f.taskRoot),before);
 const proposal=im.prepareProjectRuntimeImport(f.newData,f.moved,'task','new-native',()=> 'ACCEPT');assert.deepEqual(proposal.payload.sourceStateDigest,api.hashCanonical(before.state));
});
