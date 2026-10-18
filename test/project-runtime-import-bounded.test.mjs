import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFileSync,cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {installSourceLoader} from './load-source.mjs';
import {restartFixture} from './recovery-fixture.mjs';
installSourceLoader();
const api=await import('../src/contracts.ts'),cp=await import('../src/bounded-developer-checkpoint.ts'),im=await import('../src/project-runtime-import.ts');
const {initializeProjectCustodian}=await import('../src/project-custodian.ts');
const {resolveProjectStorage}=await import('../src/project-storage.ts');
const {DurableStore}=await import('../src/store.ts');
const {CentralOrchestrator,presentHumanGate,registeredRoleDispatchers}=await import('../src/orchestrator.ts');
const {takeOverImportedWorkflow,boundedDeveloperRecoveryData}=await import('../src/recovery-resume.ts');
const {presentTrustedConfirmation}=await import('../src/trusted-confirmation.ts');
const {CandidateGit}=await import('../src/candidate-git.ts');
const h=await import('../src/project-handoff.ts');
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
const channel=(session='new-native',approved=true)=>({mode:'tui',sessionManager:{getSessionId:()=>session},ui:{confirm:async()=>approved,notify(){}}});
async function movedFixture(t){
 const root=mkdtempSync(join(tmpdir(),'bounded-runtime-import-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const repo=join(root,'repo'),data=join(root,'data');mkdirSync(repo);mkdirSync(data);
 git(repo,'init','-q');writeFileSync(join(repo,'file.txt'),'base\n');git(repo,'add','file.txt');git(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base');
 appendFileSync(join(repo,'.git','info','exclude'),'\n/.controlled-dev/\n/Documentazione/\n');mkdirSync(join(repo,'.controlled-dev'));mkdirSync(join(repo,'Documentazione'));
 initializeProjectCustodian(repo,{schemaVersion:1,projectId:api.hashBytes(Buffer.from(repo)),originalRepoRoot:repo,baselineCommit:git(repo,'rev-parse','HEAD'),baselineTree:git(repo,'rev-parse','HEAD^{tree}')},()=>{});
 const f=await restartFixture(root,'DEVELOPER_BOUNDED',false,false,{},undefined,{existingRepo:true});
 const before=DurableStore.load(f.storeRoot),run=before.state.runs.at(-1),assignment=before.records.find(r=>r.id===run.assignmentId).value;
 const saved=f.orchestrator.withProjectLease((manager,workspaceLock)=>cp.captureBoundedDeveloperCheckpoint(repo,f.storeRoot,data,{manager,workspaceLock,inspect:()=> 'ACCEPT'}));
 f.orchestrator.dispose();assert.equal(h.readProjectHandoff(repo).ownerDisposition,'RELEASED_FOR_TRANSFER');
 const moved=join(root,'copied project'),newData=join(root,'new local profile');cpSync(repo,moved,{recursive:true,preserveTimestamps:true});
 rmSync(repo,{recursive:true});rmSync(data,{recursive:true});rmSync(assignment.workRoot,{recursive:true});rmSync(join(root,'transcripts'),{recursive:true});mkdirSync(newData);
 const taskRoot=join(resolveProjectStorage(newData,moved).projectRoot,'tasks','task');
 for(const path of [repo,data,assignment.workRoot,run.childSessionId])assert.equal(existsSync(path),false);
 return {root,repo,data,moved,newData,taskRoot,before,run,assignment,saved};
}
async function authorize(f){const proposal=im.prepareProjectRuntimeImport(f.newData,f.moved,'task','new-native',()=> 'ACCEPT'),request=im.projectRuntimeImportRequest(proposal),receipt=await presentTrustedConfirmation(channel(),request);return {proposal,request,cap:im.authorizeProjectRuntimeImport(proposal,receipt)}}
test('fresh native import recreates the bounded baseline only after a journal reserve, preserves no-candidate history, and requires a new writer gate',async t=>{
 const f=await movedFixture(t),beforeRaw=api.canonicalize(f.before);let p=im.prepareProjectRuntimeImport(f.newData,f.moved,'task','new-native',()=> 'ACCEPT');
 assert.equal(p.payload.schemaVersion,2);assert.equal(p.payload.candidateRoot,null);assert.equal(p.payload.previousCandidateRoot,null);
 assert.equal(p.payload.boundedBaseline.descriptor.stateDigest,api.hashCanonical(f.before.state));assert.equal(p.payload.boundedBaseline.descriptor.originalWorkRoot,f.assignment.workRoot);
 let q=im.projectRuntimeImportRequest(p);assert.match(q.presentation.content,/It is not a candidate/);assert.match(q.presentation.content,/new implementation confirmation/);
 assert.equal(await presentTrustedConfirmation(channel('new-native',false),q),undefined);assert.equal(existsSync(p.payload.boundedBaseline.workRoot),false);assert.equal(api.canonicalize(DurableStore.load(f.taskRoot)),beforeRaw);
 assert.throws(()=>im.projectRuntimeImportRequest({...p}),/PROPOSAL_INVALID/);
 // Cancellation retires the native request: the next decision is a new request.
 p=im.prepareProjectRuntimeImport(f.newData,f.moved,'task','new-native',()=> 'ACCEPT');q=im.projectRuntimeImportRequest(p);
 const invalid=im.prepareProjectRuntimeImport(f.newData,f.moved,'task','new-native',()=> 'ACCEPT'),invalidRequest=im.projectRuntimeImportRequest(invalid),invalidReceipt=await presentTrustedConfirmation(channel(),invalidRequest);
 assert.throws(()=>im.authorizeProjectRuntimeImport(invalid,JSON.parse(JSON.stringify(invalidReceipt))),/RECEIPT_INVALID/);
 const receipt=await presentTrustedConfirmation(channel(),q);
 const originalDetached=CandidateGit.prototype.detached;let reservedBeforeMaterialization=false;
 CandidateGit.prototype.detached=function(work,commit){const path=join(f.newData,'controlled-dev','runtime-imports',`${p.id}-reserved.json`),journal=JSON.parse(readFileSync(path,'utf8'));assert.equal(journal.phase,'RESERVED');assert.deepEqual(journal.payload,p.payload);reservedBeforeMaterialization=true;return originalDetached.call(this,work,commit)};
 let cap;try{cap=im.authorizeProjectRuntimeImport(p,receipt)}finally{CandidateGit.prototype.detached=originalDetached}
 t.after(()=>{try{const l=im.projectRuntimeImportLease(cap);l.manager.releaseAll(l.locks)}catch{}});assert.equal(reservedBeforeMaterialization,true);
 const lease=im.projectRuntimeImportLease(cap),e=lease.boundedBaselineEvidence;assert.ok(e);assert.equal(api.hashBytes(e.transcriptRaw),f.saved.descriptor.transcriptDigest);
 assert.deepEqual(JSON.parse(Buffer.from(e.descriptorRaw).toString('utf8')),f.saved.descriptor);
 assert.equal(readFileSync(join(p.payload.boundedBaseline.workRoot,'file.txt'),'utf8'),'base\n');assert.equal(git(p.payload.boundedBaseline.workRoot,'rev-parse','HEAD'),f.before.state.baselineCommit);
 assert.equal(api.canonicalize(DurableStore.load(f.taskRoot)),beforeRaw,'Materialization is data only, with no accepted event');
 const runtime={events:{on(){return()=>{}},emit(){assert.fail('Fresh writer confirmation must precede any dispatch')}},ownerSessionId:'new-native'};
 for(const role of ['scout','developer','reviewer','oracle'])runtime[role]={name:`controlled.${role}`,runtimeGeneration:'new-import',active:()=>true};
 const o=CentralOrchestrator.restore(takeOverImportedWorkflow(cap),registeredRoleDispatchers(runtime));im.completeProjectRuntimeImport(cap);
 const imported=DurableStore.load(f.taskRoot),reader={agentDataRoot:f.newData,read:r=>DurableStore.readArtifact(f.taskRoot,r)};
 assert.equal(imported.state.state,'BLOCKED');assert.equal(imported.state.candidate,undefined);assert.equal(imported.state.revision,f.before.state.revision+1);
 assert.deepEqual(imported.state.counters,f.before.state.counters);assert.deepEqual(imported.state.runs,f.before.state.runs);assert.deepEqual(imported.events.slice(0,f.before.events.length),f.before.events);
 assert.deepEqual(imported.records.find(r=>r.id===f.before.state.spec.id).value,f.before.records.find(r=>r.id===f.before.state.spec.id).value);
 const binding=JSON.parse(Buffer.from(reader.read(imported.state.runtimeBindingRef)).toString('utf8'));
 assert.deepEqual(binding.boundedBaselineRef,e.descriptorRef);assert.deepEqual(binding.boundedTranscriptRef,e.transcriptRef);
 for(const ref of [e.descriptorRef,e.transcriptRef]){assert.deepEqual(reader.read(ref),ref===e.descriptorRef?e.descriptorRaw:e.transcriptRaw);assert.ok(imported.events.at(-1).evidenceRefs.includes(ref.id))}
 const proof=boundedDeveloperRecoveryData(imported,reader);assert.equal(proof.workRoot,p.payload.boundedBaseline.workRoot);assert.equal(proof.transcriptDigest,f.saved.descriptor.transcriptDigest);
 assert.equal(o.canOpenBeforeBoundedDeveloperRecovery(),true);await assert.rejects(()=>o.implement(o.state.revision,proof.workRoot),/HUMAN_GATE_REQUIRED/);
 const gate=o.openBeforeBoundedDeveloperRecovery(o.state.revision,'new-native');assert.equal(await presentHumanGate(channel('new-native',false),gate),undefined);
 const newReceipt=await presentHumanGate(channel(),gate);o.acceptHumanDecision(gate.snapshot,newReceipt);assert.equal(o.state.state,'READY');assert.equal(o.boundedDeveloperRecoveryWorktree(),proof.workRoot);
 assert.deepEqual(o.state.counters,f.before.state.counters);assert.equal(o.state.candidate,undefined);
 // Reloaded durable evidence, not the acquisition WeakMap, is sufficient for the
 // historical no-effects proof; new dispatch still depends on the new gate.
 assert.equal(boundedDeveloperRecoveryData(DurableStore.load(f.taskRoot),reader).transcriptDigest,proof.transcriptDigest);
});
test('bounded import rejects changed custody after presentation before materializing a baseline or granting ownership',async t=>{
 const f=await movedFixture(t),p=im.prepareProjectRuntimeImport(f.newData,f.moved,'task','new-native',()=> 'ACCEPT'),q=im.projectRuntimeImportRequest(p),receipt=await presentTrustedConfirmation(channel(),q);
 writeFileSync(join(f.moved,'.controlled-dev',f.saved.transcriptRelativePath),'{}\n');
 assert.throws(()=>im.authorizeProjectRuntimeImport(p,receipt),/SOURCE_CHANGED|CHECKPOINT_STALE|HUMAN_CHANGED|PAYLOAD_INVALID/);
 assert.equal(existsSync(p.payload.boundedBaseline.workRoot),false);assert.deepEqual(DurableStore.load(f.taskRoot).state,f.before.state);
});
test('a caught failure after bounded import staging seals the authentic evidence and releases only its no-dispatch lease',async t=>{
 const f=await movedFixture(t),{proposal,cap}=await authorize(f),lease=im.projectRuntimeImportLease(cap);
 takeOverImportedWorkflow(cap);im.abortProjectRuntimeImport(cap,new Error('PRE_HOST_INSTALL_FIXTURE'));
 assert.equal(lease.manager.verifyTaskLock(lease.locks.task),false);assert.equal(lease.manager.verifyWorkspaceLock(lease.locks.workspace),false);
 assert.throws(()=>im.projectRuntimeImportLease(cap),/CAPABILITY_INVALID/);assert.deepEqual(DurableStore.load(f.taskRoot).state,f.before.state);
 assert.equal(h.readProjectHandoff(f.moved).ownerDisposition,'RELEASED_FOR_TRANSFER');
 for(const r of [lease.boundedBaselineEvidence.descriptorRef,lease.boundedBaselineEvidence.transcriptRef])assert.equal(existsSync(join(f.taskRoot,r.relativeStorePath)),true);
 assert.ok(readdirSync(join(f.newData,'controlled-dev','runtime-imports')).includes(`${proposal.id}-closed_no_dispatch.json`));
 assert.equal(im.prepareProjectRuntimeImport(f.newData,f.moved,'task','new-native',()=> 'ACCEPT').payload.schemaVersion,2);
});
