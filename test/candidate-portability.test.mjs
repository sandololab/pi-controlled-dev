import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,unlinkSync,rmSync,cpSync,symlinkSync,existsSync,renameSync,readdirSync,statSync,utimesSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {CandidateGit}=await import('../src/candidate-git.ts');
const {workspaceManifest}=await import('../src/scope-guard.ts');
const {canonicalize,hashBytes,hashCanonical}=await import('../src/contracts.ts');
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trimEnd();
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'candidate-portable-')),repo=join(root,'original'),data=join(root,'host-old');mkdirSync(repo);mkdirSync(data);t.after(()=>rmSync(root,{recursive:true,force:true}));
 git(repo,'init','-q','-b','main');git(repo,'config','user.name','Fixture');git(repo,'config','user.email','fixture@example.invalid');writeFileSync(join(repo,'keep.txt'),'baseline\n');writeFileSync(join(repo,'delete.txt'),'remove\n');writeFileSync(join(repo,'script.sh'),'#!/bin/sh\nexit 0\n');git(repo,'add','.');git(repo,'commit','-qm','baseline');
 const helper=new CandidateGit(repo,data),base=helper.head(),ref='refs/heads/controlled-dev/partial',work=join(data,'work');helper.addTaskWorktree(ref,base,work);
 writeFileSync(join(work,'keep.txt'),'partial change\n');unlinkSync(join(work,'delete.txt'));writeFileSync(join(work,'new.bin'),Buffer.from([0,255,13,10]));chmodSync(join(work,'script.sh'),0o755);
 const manifest=workspaceManifest(work,base),digest=hashCanonical(manifest);mkdirSync(join(repo,'.controlled-dev'));writeFileSync(join(repo,'.controlled-dev','project.json'),canonicalize({schemaVersion:1,projectId:hashBytes(Buffer.from(repo)),originalRepoRoot:repo,baselineCommit:base,baselineTree:helper.tree(base)}));
 writeFileSync(join(repo,'.git','info','exclude'),'/.controlled-dev/\n/Documentazione/\n');
 const snapshot=join(repo,'.controlled-dev','candidates','task',digest);return{root,repo,data,helper,base,ref,work,manifest,digest,snapshot};
}
test('copied project restores exact partial candidate on another host without copying live worktree pointers or granting branch authority',t=>{
 const f=fixture(t);f.helper.captureCandidateSnapshot(f.work,f.manifest,f.snapshot);const raw=readFileSync(join(f.snapshot,'manifest.json'));f.helper.captureCandidateSnapshot(f.work,f.manifest,f.snapshot);
 const copy=join(f.root,'copied-project'),newData=join(f.root,'new-host');cpSync(f.repo,copy,{recursive:true});mkdirSync(newData);const helper=new CandidateGit(copy,newData),root=join(newData,'restored'),snapshot=join(copy,'.controlled-dev','candidates','task',f.digest);
 helper.restoreCandidateSnapshot(snapshot,root,f.ref,f.manifest);
 assert.equal(hashCanonical(workspaceManifest(root,f.base)),f.digest);assert.deepEqual(readFileSync(join(root,'new.bin')),Buffer.from([0,255,13,10]));assert.equal(existsSync(join(root,'delete.txt')),false);assert.equal(helper.head(root),f.base);assert.equal(helper.refHead(f.ref),f.base);assert.equal(helper.head(),f.base);
 assert.throws(()=>git(root,'symbolic-ref','--quiet','HEAD'));assert.deepEqual(readFileSync(join(snapshot,'manifest.json')),raw);assert.equal(hashCanonical(workspaceManifest(f.work,f.base)),f.digest);assert.ok(readFileSync(join(root,'.git'),'utf8').includes(join(copy,'.git')));
});
test('snapshot corruption and changed manifest are rejected before creating a restored worktree',t=>{
 const f=fixture(t);f.helper.captureCandidateSnapshot(f.work,f.manifest,f.snapshot);const entry=f.manifest.entries.find(e=>e.path==='new.bin');writeFileSync(join(dirname(dirname(f.snapshot)),'.objects',entry.contentHash),'corrupted');const root=join(f.data,'bad-restore');assert.throws(()=>f.helper.restoreCandidateSnapshot(f.snapshot,root,f.ref,f.manifest),/GIT_SNAPSHOT_DIGEST_MISMATCH/);assert.equal(existsSync(root),false);assert.equal(f.helper.refHead(f.ref),f.base);
});
test('checkpoint refuses source changes, symlink custodian boundaries and restoring over an existing worktree',t=>{
 const f=fixture(t);writeFileSync(join(f.work,'keep.txt'),'concurrent');assert.throws(()=>f.helper.captureCandidateSnapshot(f.work,f.manifest,f.snapshot),/GIT_CANDIDATE_CHANGED/);assert.equal(existsSync(f.snapshot),false);
 writeFileSync(join(f.work,'keep.txt'),'partial change\n');f.helper.captureCandidateSnapshot(f.work,f.manifest,f.snapshot);assert.throws(()=>f.helper.restoreCandidateSnapshot(f.snapshot,f.work,f.ref,f.manifest),/GIT_WORKTREE_EXISTS/);
 const outside=join(f.root,'outside');mkdirSync(outside);symlinkSync(outside,join(f.repo,'.controlled-dev','candidates','escape'));assert.throws(()=>f.helper.captureCandidateSnapshot(f.work,f.manifest,join(f.repo,'.controlled-dev','candidates','escape','new')),/GIT_SNAPSHOT_PATH_INVALID/);assert.equal(existsSync(join(outside,'new')),false);
});
test('an uncertain close retains its genuine live lease only when requested; defaults and successful actions release it',async t=>{
 const f=fixture(t),{CandidatePromotionRepository}=await import('../src/candidate-promotion-repository.ts'),{LockManager}=await import('../src/lock-manager.ts');
 const observer=new LockManager(f.data,'other-host-session','other-host-runtime');let held;
 const uncertain=Object.assign(new Error('UNKNOWN role process cannot be proved quiescent'),{code:'PROJECT_ROLE_NOT_QUIESCENT'});
 await assert.rejects(CandidatePromotionRepository.withLease(f.data,f.repo,()=> 'ACCEPT',async repository=>{
  held={manager:repository.options.manager,lock:repository.options.workspaceLock};assert.equal(held.manager.verifyWorkspaceLock(held.lock),true);throw uncertain;
 },undefined,{retainLeaseOnFailure:true}),error=>error===uncertain);
 try{
  assert.equal(held.manager.verifyWorkspaceLock(held.lock),true);
  assert.throws(()=>observer.acquireWorkspace(f.repo),/WORKSPACE_LOCK_UNAVAILABLE/);
 }finally{held.manager.release(held.lock)}
 let defaultLease;
 await assert.rejects(CandidatePromotionRepository.withLease(f.data,f.repo,()=> 'ACCEPT',async repository=>{
  defaultLease={manager:repository.options.manager,lock:repository.options.workspaceLock};throw uncertain;
 }),error=>error===uncertain);
 assert.equal(defaultLease.manager.verifyWorkspaceLock(defaultLease.lock),false);
 let successLease;
 assert.equal(await CandidatePromotionRepository.withLease(f.data,f.repo,()=> 'ACCEPT',async repository=>{
  successLease={manager:repository.options.manager,lock:repository.options.workspaceLock};return 'closed';
 },undefined,{retainLeaseOnFailure:true}),'closed');
 assert.equal(successLease.manager.verifyWorkspaceLock(successLease.lock),false);
 const available=observer.acquireWorkspace(f.repo);assert.equal(observer.verifyWorkspaceLock(available),true);observer.release(available);
});
test('a genuine published candidate checkpoint binds immutable state and consumed counters under the already-held lease',async t=>{
 const {completedFixture,git:fixtureGit,api}=await import('./candidate-promotion-fixture.mjs');
 const {captureCandidateCheckpoint,verifyCandidateCheckpoint}=await import('../src/candidate-checkpoints.ts');
 const {DurableStore}=await import('../src/store.ts');const {LockManager}=await import('../src/lock-manager.ts');
 const f=await completedFixture({checkpoint:'FINAL_GATE',freeze:false});
 t.after(()=>{new LockManager(f.data,f.locks.workspace.record.ownerSessionId,f.locks.workspace.record.runtimeGeneration).releaseAll(f.locks);rmSync(f.root,{recursive:true,force:true})});
 const h=await import('../src/project-handoff.ts'),{captureCandidateCheckpointStaging}=await import('../src/candidate-checkpoints.ts'),{presentTrustedConfirmation}=await import('../src/trusted-confirmation.ts');
 const hostManager=new LockManager(f.data,f.locks.workspace.record.ownerSessionId,f.locks.workspace.record.runtimeGeneration),hostLock=f.locks.workspace;
 const planning=DurableStore.project(f.data,f.repo,'planning',()=> 'ACCEPT',true),proposal=h.prepareProjectHandoff({repoRoot:f.repo,machineDataRoot:f.data}),request=h.projectHandoffRequest(proposal);
 const receipt=await presentTrustedConfirmation({mode:'tui',sessionManager:{getSessionId:()=> 'adoption-human'},ui:{async confirm(){return true}}},request);
 const cap=h.authorizeProjectHandoff(proposal,receipt,{store:planning,manager:hostManager,workspaceLock:hostLock,assertQuiescent(){assert.ok(DurableStore.load(f.storeRoot).state.runs.every(run=>run.status==='TERMINAL'||run.status==='NOT_DISPATCHED'))}});
 h.completeProjectHandoff(cap,{captureCandidates(auth){return [captureCandidateCheckpointStaging(auth,f.storeRoot,{manager:hostManager,workspaceLock:hostLock}).descriptorRelativePath]}});
 f.storeRoot=join(f.repo,'.controlled-dev','state','controlled-dev','projects',api.hashBytes(Buffer.from(f.repo)),'tasks',f.state.taskId);
 const ledger=DurableStore.load(f.storeRoot),manager=new LockManager(f.data,f.locks.workspace.record.ownerSessionId,f.locks.workspace.record.runtimeGeneration),workspaceLock=f.locks.workspace;
 const checkpoint=(()=>{const result=captureCandidateCheckpoint(f.repo,f.storeRoot,f.data,{manager,workspaceLock});assert.equal(manager.verifyWorkspaceLock(workspaceLock),true);return result})();assert.equal(checkpoint.descriptor.stateDigest,api.hashCanonical(ledger.state));assert.equal(checkpoint.descriptor.specHash,ledger.state.specHash);assert.equal(checkpoint.descriptor.candidate.digest,ledger.state.candidate.digest);assert.deepEqual(DurableStore.load(f.storeRoot),ledger);assert.equal(fixtureGit(f.repo,'rev-parse','HEAD'),f.initial.baseCommit);
 assert.throws(()=>captureCandidateCheckpoint(f.repo,f.storeRoot,f.data,{manager,workspaceLock:{...workspaceLock}}),/CANDIDATE_CHECKPOINT_LOCK_REQUIRED/);
 assert.deepEqual(verifyCandidateCheckpoint(f.repo,f.storeRoot,f.data).descriptor,checkpoint.descriptor);const stale={...ledger.state,counters:{...ledger.state.counters,reworkAttempts:ledger.state.counters.reworkAttempts+1}};assert.throws(()=>verifyCandidateCheckpoint(f.repo,f.storeRoot,f.data,stale),/CANDIDATE_CHECKPOINT_STATE_STALE/);
 const repository=(await import('../src/candidate-promotion-repository.ts')).CandidatePromotionRepository.open(f.data,f.repo,()=> 'ACCEPT',{manager,workspaceLock});const beforeRetirement=DurableStore.load(f.storeRoot);repository.retireForProjectTransfer();assert.throws(()=>repository.checkpoint(f.state.taskId),/PROMOTION_REPOSITORY_RETIRED/);assert.throws(()=>repository.materialize(f.state.taskId),/PROMOTION_REPOSITORY_RETIRED/);await assert.rejects(repository.prepare(f.state.taskId),/PROMOTION_REPOSITORY_RETIRED/);assert.equal(manager.verifyWorkspaceLock(workspaceLock),true);assert.deepEqual(DurableStore.load(f.storeRoot),beforeRetirement);
});
test('handoff stages a real candidate before marker publication, preserves ledger bytes, and refuses copied capabilities',async t=>{
 const {completedFixture,api}=await import('./candidate-promotion-fixture.mjs');
 const {captureCandidateCheckpointStaging,verifyCandidateCheckpointStaging,verifyCandidateCheckpoint}=await import('../src/candidate-checkpoints.ts');
 const {DurableStore}=await import('../src/store.ts');const {LockManager}=await import('../src/lock-manager.ts');const h=await import('../src/project-handoff.ts');
 const {presentTrustedConfirmation}=await import('../src/trusted-confirmation.ts');
 const f=await completedFixture({checkpoint:'FINAL_GATE',freeze:false});t.after(()=>{new LockManager(f.data,f.locks.workspace.record.ownerSessionId,f.locks.workspace.record.runtimeGeneration).releaseAll(f.locks);rmSync(f.root,{recursive:true,force:true})});
 const ledger=DurableStore.load(f.storeRoot),projectId=api.hashBytes(Buffer.from(f.repo)),planning=DurableStore.project(f.data,f.repo,'planning',()=> 'ACCEPT',true);
 const proposal=h.prepareProjectHandoff({repoRoot:f.repo,machineDataRoot:f.data}),request=h.projectHandoffRequest(proposal),receipt=await presentTrustedConfirmation({mode:'tui',sessionManager:{getSessionId:()=> 'checkpoint-human'},ui:{async confirm(){return true}}},request);
 const manager=new LockManager(f.data,f.locks.workspace.record.ownerSessionId,f.locks.workspace.record.runtimeGeneration),workspaceLock=f.locks.workspace;
 (()=>{
  const cap=h.authorizeProjectHandoff(proposal,receipt,{store:planning,manager,workspaceLock,assertQuiescent(){assert.ok(DurableStore.load(f.storeRoot).state.runs.every(run=>run.status==='TERMINAL'||run.status==='NOT_DISPATCHED'))}});
  assert.throws(()=>captureCandidateCheckpointStaging({...cap},f.storeRoot,{manager,workspaceLock}),/HANDOFF_REQUIRED/);
  let checkpoint;
  const handoff=h.completeProjectHandoff(cap,{captureCandidates(auth){
   assert.equal(existsSync(join(f.repo,'.controlled-dev','project.json')),false);
   checkpoint=captureCandidateCheckpointStaging(auth,f.storeRoot,{manager,workspaceLock});
   assert.deepEqual(verifyCandidateCheckpointStaging(auth,f.storeRoot).descriptor,checkpoint.descriptor);
   assert.equal(manager.verifyWorkspaceLock(workspaceLock),true);assert.deepEqual(DurableStore.load(f.storeRoot),ledger);
   assert.equal(existsSync(join(f.repo,'.controlled-dev','project.json')),false);
   return [checkpoint.descriptorRelativePath];
  }});
  assert.deepEqual(handoff.candidateDescriptors,[checkpoint.descriptorRelativePath]);
  const movedTask=join(f.repo,'.controlled-dev','state','controlled-dev','projects',projectId,'tasks',ledger.state.taskId);
  assert.deepEqual(DurableStore.load(movedTask),ledger);assert.equal(existsSync(f.storeRoot),false);
  const checked=verifyCandidateCheckpoint(f.repo,movedTask,f.data);assert.equal(checked.descriptor.stateDigest,api.hashCanonical(ledger.state));
  assert.deepEqual(checked.manifest,checkpoint.manifest);assert.equal(checked.candidateRef,f.initial.candidateRef);assert.equal(h.readProjectHandoff(f.repo).taskHeads[0].stateDigest,checked.descriptor.stateDigest);
 })();
 const copy=join(f.root,'copy-new-machine'),newData=join(f.root,'new-empty-profile');cpSync(f.repo,copy,{recursive:true});mkdirSync(newData);
 renameSync(f.repo,join(f.root,'original-unavailable'));
 const {rebuildHumanView}=await import('../src/human-repository.ts');
 const copiedTask=join(copy,'.controlled-dev','state','controlled-dev','projects',projectId,'tasks',ledger.state.taskId);
 assert.throws(()=>rebuildHumanView(copiedTask),/HUMAN_PROJECTION_CONTEXT_REQUIRED/);
 const human=rebuildHumanView(copiedTask,{machineDataRoot:newData});assert.equal(human.status,'CURRENT');assert.equal(human.vaultRoot,join(copy,'Documentazione'));
 assert.ok(human.files.some(file=>file.startsWith('Tasks/')&&existsSync(join(human.vaultRoot,file))));assert.deepEqual(DurableStore.load(copiedTask),ledger);
 assert.equal(existsSync(join(newData,'controlled-dev','projects',projectId)),false);
});

function legacySnapshot(f){
 mkdirSync(join(f.snapshot,'objects'),{recursive:true});
 for(const entry of f.manifest.entries)writeFileSync(join(f.snapshot,'objects',entry.contentHash),readFileSync(join(f.work,entry.path)));
 writeFileSync(join(f.snapshot,'manifest.json'),canonicalize(f.manifest));
}
test('new snapshots share immutable payloads across candidates and restore without rewriting identical baseline files',t=>{
 const f=fixture(t);f.helper.captureCandidateSnapshot(f.work,f.manifest,f.snapshot);
 const objects=join(dirname(dirname(f.snapshot)),'.objects'),first=new Set(f.manifest.entries.map(e=>e.contentHash));
 assert.deepEqual(new Set(readdirSync(objects)),first);
 writeFileSync(join(f.work,'keep.txt'),'second change\n');const next=workspaceManifest(f.work,f.base),second=join(dirname(f.snapshot),hashCanonical(next));
 f.helper.captureCandidateSnapshot(f.work,next,second);
 assert.equal(readdirSync(objects).length,new Set([...f.manifest.entries,...next.entries].map(e=>e.contentHash)).size);
 assert.equal(existsSync(join(f.snapshot,'objects')),false);assert.equal(existsSync(join(second,'objects')),false);
 const detached=f.helper.detached.bind(f.helper);t.mock.method(f.helper,'detached',(root,base)=>{detached(root,base);utimesSync(join(root,'script.sh'),new Date(0),new Date(0))});
 const restored=join(f.data,'restore-shared');f.helper.restoreCandidateSnapshot(f.snapshot,restored,f.ref,f.manifest);
 assert.equal(statSync(join(restored,'script.sh')).mtimeMs,0,'An identical baseline payload is not rewritten');
 assert.equal(hashCanonical(workspaceManifest(restored,f.base)),f.digest);
});
test('legacy snapshot migration preserves logical bytes, tolerates a pause during cleanup, and resumes without another writer',async t=>{
 const f=fixture(t);legacySnapshot(f);const manifest=readFileSync(join(f.snapshot,'manifest.json'));
 f.helper.verifyCandidateSnapshot(f.snapshot,f.manifest);
 let stop=false;
 await assert.rejects(f.helper.shareSnapshotStorage(f.snapshot,f.manifest,async()=>{if(stop)throw Error('Synthetic pause')},p=>{if(p.phase==='cleanup'&&p.completed===1)stop=true}),/Synthetic pause/);
 assert.equal(existsSync(join(f.snapshot,'storage.json')),true);
 f.helper.verifyCandidateSnapshot(f.snapshot,f.manifest);
 const restored=join(f.data,'restored-during-pause');f.helper.restoreCandidateSnapshot(f.snapshot,restored,f.ref,f.manifest);
 assert.equal(hashCanonical(workspaceManifest(restored,f.base)),f.digest);
 const completed=await f.helper.shareSnapshotStorage(f.snapshot,f.manifest,async()=>{});
 assert.ok(completed.removedFiles>0);assert.equal(existsSync(join(f.snapshot,'objects')),false);
 assert.deepEqual(readFileSync(join(f.snapshot,'manifest.json')),manifest);
 assert.deepEqual(await f.helper.shareSnapshotStorage(f.snapshot,f.manifest,async()=>{}),{removedBytes:0,removedFiles:0});
});
test('a corrupt shared destination or aliased object directory never removes legacy evidence',async t=>{
 for(const kind of ['corruption','alias']){
  const f=fixture(t);legacySnapshot(f);const objects=join(dirname(dirname(f.snapshot)),'.objects'),before=readdirSync(join(f.snapshot,'objects'));
  if(kind==='corruption'){mkdirSync(objects);const entry=f.manifest.entries.find(e=>e.path==='new.bin');writeFileSync(join(objects,entry.contentHash),'bad shared bytes')}
  else{const outside=join(f.root,'outside-shared');mkdirSync(outside);symlinkSync(outside,objects)}
  await assert.rejects(f.helper.shareSnapshotStorage(f.snapshot,f.manifest,async()=>{}),/GIT_SNAPSHOT_(DIGEST_MISMATCH|PATH_INVALID)/);
  assert.deepEqual(readdirSync(join(f.snapshot,'objects')),before);assert.equal(existsSync(join(f.snapshot,'storage.json')),false);
  f.helper.verifyCandidateSnapshot(f.snapshot,f.manifest);
 }
});
test('shared storage does not accept a caller-selected path outside the project',t=>{
 const f=fixture(t);f.helper.captureCandidateSnapshot(f.work,f.manifest,f.snapshot);
 writeFileSync(join(f.snapshot,'storage.json'),JSON.stringify({schemaVersion:2,objects:'../../../../outside'})+'\n');
 assert.throws(()=>f.helper.verifyCandidateSnapshot(f.snapshot,f.manifest),/GIT_SNAPSHOT_INVALID/);
});
