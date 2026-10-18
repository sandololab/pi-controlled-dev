import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { canonicalize, hashBytes, hashCanonical, parseJson, validateScalar, validateStructure } from './contracts.js';
import type { ArtifactRef, CandidateManifest, WorkflowState } from './contracts.js';
import { CandidateGit } from './candidate-git.js';
import { DurableStore } from './store.js';
import { physicalProjectRootForTask, projectCustodianRoot } from './project-storage.js';
import { readProjectCustodian } from './project-custodian.js';
import { LockManager } from './lock-manager.js';
import type { LockHandle } from './lock-manager.js';
import { runQuiescent } from './run-quiescence.js';
import { handoffStagingRoot, handoffTaskHead, isProjectHandoffCapability } from './project-handoff.js';
import type { ProjectHandoffCapability } from './project-handoff.js';
import { PROMOTION_MEDIA, validateGitBinding, validatePromotionIndex } from './candidate-promotion.js';

/** Portable payload provenance. It preserves history; it is never an execution permit. */
export interface CandidateCheckpointDescriptor {
 readonly schemaVersion:1;readonly projectId:string;readonly taskId:string;readonly specHash:string;
 readonly stateRevision:number;readonly stateDigest:string;readonly candidate:NonNullable<WorkflowState['candidate']>;
}
export interface VerifiedCandidateCheckpoint {
 readonly descriptor:CandidateCheckpointDescriptor;readonly descriptorPath:string;readonly descriptorDigest:string;
 readonly snapshotRoot:string;readonly manifest:CandidateManifest;readonly candidateRef:string;
}
interface Options {readonly manager:LockManager;readonly workspaceLock:LockHandle}
export class CandidateCheckpointError extends Error {constructor(readonly code:string){super(code)}}
function fail(code:string):never{throw new CandidateCheckpointError(code)}
function regular(path:string,max:number):Uint8Array {
 const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>max||realpathSync(path)!==path)fail('CANDIDATE_CHECKPOINT_FILE_INVALID');return readFileSync(path);
}
interface Placement {readonly root:string;readonly projectId:string;readonly originalRepoRoot:string}
function checkpointContext(repoRoot:string,taskRoot:string,expectedState?:WorkflowState,placement?:Placement){
 const marker=placement??readProjectCustodian(repoRoot),custodian=placement?.root??projectCustodianRoot(repoRoot);if(!custodian||!marker)fail('CANDIDATE_CHECKPOINT_CUSTODIAN_REQUIRED');
 const ledger=DurableStore.load(taskRoot),state=ledger.state,candidate=state.candidate;
 if(ledger.truncatedTailBytes||!candidate||!validateScalar('ID',state.taskId).ok)fail('CANDIDATE_CHECKPOINT_BINDING_INVALID');
 if(!placement&&taskRoot!==join(custodian,'state','controlled-dev','projects',marker.projectId,'tasks',state.taskId))fail('CANDIDATE_CHECKPOINT_BINDING_INVALID');
 if(expectedState&&hashCanonical(expectedState)!==hashCanonical(state))fail('CANDIDATE_CHECKPOINT_STATE_STALE');
 const spec=ledger.records.find(record=>record.kind==='TaskSpec'&&record.id===state.spec.id);if(spec?.kind!=='TaskSpec'||spec.value.specHash!==state.specHash)fail('CANDIDATE_CHECKPOINT_BINDING_INVALID');
 if(!placement&&physicalProjectRootForTask(taskRoot,spec.value.scope.repoRoot,ledger)!==repoRoot)fail('CANDIDATE_CHECKPOINT_BINDING_INVALID');
 const ref=candidate.manifest;if(ref.relativeStorePath!==`artifacts/${ref.id}`||!ledger.records.some(record=>record.kind==='ArtifactRef'&&canonicalize(record.value)===canonicalize(ref)))fail('CANDIDATE_CHECKPOINT_BINDING_INVALID');
 const raw=regular(join(taskRoot,ref.relativeStorePath),64*1024*1024);if(raw.byteLength!==ref.bytes||hashBytes(raw)!==ref.digest)fail('CANDIDATE_CHECKPOINT_BINDING_INVALID');
 const manifest=parseJson(raw,64*1024*1024) as CandidateManifest;if(!validateStructure('CandidateManifest',manifest).ok||hashCanonical(manifest)!==candidate.digest||manifest.baseCommit!==candidate.baseCommit)fail('CANDIDATE_CHECKPOINT_BINDING_INVALID');
 const descriptor:CandidateCheckpointDescriptor={schemaVersion:1,projectId:marker.projectId,taskId:state.taskId,specHash:state.specHash,stateRevision:state.revision,stateDigest:hashCanonical(state),candidate};
 const directory=join(custodian,'candidates',state.taskId),descriptorDigest=hashCanonical(descriptor),descriptorPath=join(directory,'checkpoints',descriptorDigest+'.json'),snapshotRoot=join(directory,candidate.digest);
 return {ledger,descriptor,descriptorPath,descriptorDigest,snapshotRoot,manifest};
}
function candidateRef(c:ReturnType<typeof checkpointContext>,taskRoot:string):string {
 // Read only the promotion namespace adjacent to this already verified task ledger.
 // During adoption the public resolver deliberately rejects the incomplete capsule.
 const root=join(dirname(dirname(taskRoot)),'promotion'),pointer=join(root,'index.json');
 if(!existsSync(pointer))fail('CANDIDATE_CHECKPOINT_REF_UNAVAILABLE');
 const ref=parseJson(regular(pointer,32768),32768) as ArtifactRef;
 const read=(r:ArtifactRef)=>{
  if(!validateStructure('ArtifactRef',r).ok||r.mediaType!==PROMOTION_MEDIA||r.bytes>2*1024*1024||r.relativeStorePath!==`artifacts/${r.id}`)fail('CANDIDATE_CHECKPOINT_BINDING_INVALID');
  const raw=regular(join(root,r.relativeStorePath),2*1024*1024);if(raw.byteLength!==r.bytes||hashBytes(raw)!==r.digest)fail('CANDIDATE_CHECKPOINT_BINDING_INVALID');return parseJson(raw,2*1024*1024);
 };
 const index=validatePromotionIndex(read(ref));if(index.projectId!==c.descriptor.projectId)fail('CANDIDATE_CHECKPOINT_BINDING_INVALID');
 const bindings=index.bindings.map(r=>validateGitBinding(read(r))).filter(b=>b.taskId===c.descriptor.taskId);
 if(!bindings.length||bindings.length>2||bindings.some(b=>b.projectId!==index.projectId)||bindings.some(b=>b.candidateRef!==bindings[0].candidateRef))fail('CANDIDATE_CHECKPOINT_BINDING_INVALID');
 return bindings.at(-1)!.candidateRef;
}
/** Read-only verification against the actual unchanged ledger, not a caller's copied JSON. */
export function verifyCandidateCheckpoint(repoRoot:string,taskRoot:string,machineDataRoot:string,expectedState?:WorkflowState):VerifiedCandidateCheckpoint {
 const c=checkpointContext(repoRoot,taskRoot,expectedState),raw=regular(c.descriptorPath,128*1024);
 if(Buffer.from(raw).toString('utf8')!==canonicalize(c.descriptor))fail('CANDIDATE_CHECKPOINT_BINDING_INVALID');
 new CandidateGit(repoRoot,machineDataRoot).verifyCandidateSnapshot(c.snapshotRoot,c.manifest);
 if(hashCanonical(DurableStore.load(taskRoot).state)!==c.descriptor.stateDigest)fail('CANDIDATE_CHECKPOINT_STATE_STALE');
 return Object.freeze({descriptor:c.descriptor,descriptorPath:c.descriptorPath,descriptorDigest:c.descriptorDigest,snapshotRoot:c.snapshotRoot,manifest:c.manifest,candidateRef:candidateRef(c,taskRoot)});
}
function capture(repoRoot:string,taskRoot:string,machineDataRoot:string,options:Options,placement?:Placement):VerifiedCandidateCheckpoint {
 const manager=options?.manager,lock=options?.workspaceLock;if(!manager||!lock)fail('CANDIDATE_CHECKPOINT_LOCK_REQUIRED');
 {
  if(!manager.verifyWorkspaceLock(lock)||lock.record.workspaceHash!==manager.workspaceIdentity(repoRoot).workspaceHash)fail('CANDIDATE_CHECKPOINT_LOCK_REQUIRED');
  const c=checkpointContext(repoRoot,taskRoot,undefined,placement);if(c.ledger.state.runs.some(run=>!runQuiescent(run)))fail('CANDIDATE_CHECKPOINT_ROLE_NOT_QUIESCENT');
  const historicalPath=relative(machineDataRoot,c.descriptor.candidate.root);
  if(!placement&&c.ledger.state.state==='COMPLETED'&&(historicalPath.startsWith('..')||historicalPath.startsWith('/')||!existsSync(c.descriptor.candidate.root))&&existsSync(c.descriptorPath)&&existsSync(c.snapshotRoot))return verifyCandidateCheckpoint(repoRoot,taskRoot,machineDataRoot,c.ledger.state);
  const git=new CandidateGit(repoRoot,machineDataRoot);git.tree(c.manifest.baseCommit);
  if(placement)git.captureCandidateSnapshotStaged(c.descriptor.candidate.root,c.manifest,c.snapshotRoot);
  else git.captureCandidateSnapshot(c.descriptor.candidate.root,c.manifest,c.snapshotRoot);
  const directory=dirname(c.descriptorPath);
  if(!existsSync(directory))mkdirSync(directory,{mode:0o700});if(!lstatSync(directory).isDirectory()||realpathSync(directory)!==directory)fail('CANDIDATE_CHECKPOINT_FILE_INVALID');
  const content=canonicalize(c.descriptor);
  if(existsSync(c.descriptorPath)){if(Buffer.from(regular(c.descriptorPath,128*1024)).toString('utf8')!==content)fail('CANDIDATE_CHECKPOINT_BINDING_INVALID')}
  else{const temp=c.descriptorPath+'.pending-'+randomUUID(),fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,content);fsyncSync(fd)}finally{closeSync(fd)}renameSync(temp,c.descriptorPath);const dir=openSync(directory,'r');try{fsyncSync(dir)}finally{closeSync(dir)}}
  if(placement){git.verifyCandidateSnapshotStaged(c.snapshotRoot,c.manifest);if(hashCanonical(DurableStore.load(taskRoot).state)!==c.descriptor.stateDigest)fail('CANDIDATE_CHECKPOINT_STATE_STALE');return Object.freeze({descriptor:c.descriptor,descriptorPath:c.descriptorPath,descriptorDigest:c.descriptorDigest,snapshotRoot:c.snapshotRoot,manifest:c.manifest,candidateRef:candidateRef(c,taskRoot)})}
  return verifyCandidateCheckpoint(repoRoot,taskRoot,machineDataRoot,c.ledger.state);
 }
}
/** Call only at a published-candidate boundary after every role is authentically quiescent.
 * The caller must supply its existing workspace lease; this helper never acquires a second lease. */
export function captureCandidateCheckpoint(repoRoot:string,taskRoot:string,machineDataRoot:string,options:Options):VerifiedCandidateCheckpoint {
 return capture(repoRoot,taskRoot,machineDataRoot,options);
}
function stagingPlacement(cap:ProjectHandoffCapability,taskRoot:string):Placement {
 if(!isProjectHandoffCapability(cap))fail('CANDIDATE_CHECKPOINT_HANDOFF_REQUIRED');
 const ledger=DurableStore.load(taskRoot),head=handoffTaskHead(cap,ledger.state.taskId);
 if(taskRoot!==join(cap.machineDataRoot,'controlled-dev','projects',cap.projectId,'tasks',ledger.state.taskId)||!head
   ||head.stateDigest!==hashCanonical(ledger.state)||head.stateRevision!==ledger.state.revision||head.specHash!==ledger.state.specHash||head.eventHash!==ledger.events.at(-1)?.eventHash)fail('CANDIDATE_CHECKPOINT_BINDING_INVALID');
 return {root:handoffStagingRoot(cap),projectId:cap.projectId,originalRepoRoot:cap.repoRoot};
}
/** Used only by the native consumed handoff capability before the custodian marker exists. */
export function captureCandidateCheckpointStaging(cap:ProjectHandoffCapability,taskRoot:string,options:Required<Options>):VerifiedCandidateCheckpoint & {readonly descriptorRelativePath:string} {
 const placement=stagingPlacement(cap,taskRoot),result=capture(cap.repoRoot,taskRoot,cap.machineDataRoot,options,placement);
 stagingPlacement(cap,taskRoot);
 return Object.freeze({...result,descriptorRelativePath:`candidates/${result.descriptor.taskId}/checkpoints/${result.descriptorDigest}.json`});
}
export function verifyCandidateCheckpointStaging(cap:ProjectHandoffCapability,taskRoot:string):VerifiedCandidateCheckpoint {
 const c=checkpointContext(cap.repoRoot,taskRoot,undefined,stagingPlacement(cap,taskRoot));
 if(Buffer.from(regular(c.descriptorPath,128*1024)).toString('utf8')!==canonicalize(c.descriptor))fail('CANDIDATE_CHECKPOINT_BINDING_INVALID');
 new CandidateGit(cap.repoRoot,cap.machineDataRoot).verifyCandidateSnapshotStaged(c.snapshotRoot,c.manifest);stagingPlacement(cap,taskRoot);
 return Object.freeze({descriptor:c.descriptor,descriptorPath:c.descriptorPath,descriptorDigest:c.descriptorDigest,snapshotRoot:c.snapshotRoot,manifest:c.manifest,candidateRef:candidateRef(c,taskRoot)});
}
