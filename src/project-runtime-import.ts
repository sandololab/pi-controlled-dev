import { inventoryHash, inventoryTree } from './controlled-agent-runtime.js';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { canonicalize, hashCanonical, hashBytes, validateScalar, validateStructure, parseJson } from './contracts.js';
import type { ArtifactRef, TaskSpec, Json } from './contracts.js';
import { DurableStore } from './store.js';
import type { ArtifactInspection, StoredLedger } from './store.js';
import { LockManager, withRepairMutation } from './lock-manager.js';
import type { LockRecord, WorkflowLocks } from './lock-manager.js';
import { resolveProjectStorage, assertProjectStoragePath } from './project-storage.js';
import { readProjectHandoffForRuntimeImport, currentProjectHandoffCandidatePaths, releaseProjectHandoff, projectHandoffNamespaceManifest } from './project-handoff.js';
import { CandidateGit } from './candidate-git.js';
import { verifyCandidateCheckpoint, captureCandidateCheckpoint } from './candidate-checkpoints.js';
import { readBoundedDeveloperCheckpoint, materializeBoundedDeveloperCheckpoint } from './bounded-developer-checkpoint.js';
import type { VerifiedBoundedDeveloperCheckpoint } from './bounded-developer-checkpoint.js';
import { ScopeGuard, workspaceManifest } from './scope-guard.js';
import { runQuiescent } from './run-quiescence.js';
import { consumeTrustedConfirmation, createTrustedConfirmationRequest, readTrustedConfirmationEvidence } from './trusted-confirmation.js';
import { inspectProcessOwner } from './process-incarnation.js';
import type { TrustedConfirmationReceipt, TrustedConfirmationRequest } from './trusted-confirmation.js';
import { checkRuntimeRootBindingPayload, runtimeRebindResumeState } from './runtime-root-binding.js';
import type { RuntimeRootBindingPayload } from './runtime-root-binding.js';

export interface ProjectRuntimeImportProposal {readonly id:string;readonly payload:RuntimeRootBindingPayload}
export interface ProjectRuntimeImportCapability {readonly id:string;readonly taskId:string;readonly repoRoot:string;readonly sessionId:string}
interface Prepared {readonly proposal:ProjectRuntimeImportProposal;readonly data:string;readonly taskRoot:string;readonly ledger:StoredLedger;
 readonly spec:TaskSpec;readonly inspect:ArtifactInspection;readonly sessionId:string;readonly handoffRaw:Uint8Array;
 readonly humanChanges:readonly {path:string;status:'ADDED'|'CHANGED'|'REMOVED'}[];readonly candidate?:ReturnType<typeof verifyCandidateCheckpoint>;readonly boundedBaseline?:VerifiedBoundedDeveloperCheckpoint;request?:TrustedConfirmationRequest}
export interface ProjectRuntimeImportLease {readonly proposal:ProjectRuntimeImportProposal;readonly data:string;readonly taskRoot:string;
 readonly ledger:StoredLedger;readonly spec:TaskSpec;readonly inspect:ArtifactInspection;readonly manager:LockManager;readonly locks:WorkflowLocks;
 readonly confirmationRef:ArtifactRef;readonly confirmationRaw:Uint8Array;readonly handoffRaw:Uint8Array;readonly sessionId:string;readonly journal:RuntimeImportJournal;readonly boundedBaselineEvidence?:BoundedBaselineImportEvidence}
export interface BoundedBaselineImportEvidence {readonly descriptorRef:ArtifactRef;readonly descriptorRaw:Uint8Array;readonly transcriptRef:ArtifactRef;readonly transcriptRaw:Uint8Array}
interface RuntimeImportJournal {readonly schemaVersion:1;readonly id:string;readonly phase:'RESERVED';readonly payload:RuntimeRootBindingPayload;readonly taskRoot:string;readonly sessionId:string;readonly taskLock:WorkflowLocks['task']['record'];readonly workspaceLock:WorkflowLocks['workspace']['record']}
const proposals=new WeakMap<object,Prepared>(),capabilities=new WeakMap<object,{lease:ProjectRuntimeImportLease;claimed:boolean;restored:boolean;retired:boolean}>();
function fail(code:string):never{throw new Error(code)}
const same=(a:unknown,b:unknown)=>canonicalize(a)===canonicalize(b);
function immutablePayload(payload:RuntimeRootBindingPayload):RuntimeRootBindingPayload{
 const copy=JSON.parse(canonicalize(payload)) as RuntimeRootBindingPayload;
 const freeze=(value:unknown):void=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value)}};freeze(copy);return copy;
}
function syncDirectory(path:string):void{const fd=openSync(path,'r');try{fsyncSync(fd)}finally{closeSync(fd)}}
function journalRoot(data:string):string{
 const root=join(data,'controlled-dev','runtime-imports');try{mkdirSync(root,{mode:0o700})}catch(e){if((e as {code?:string}).code!=='EEXIST')throw e}
 const s=lstatSync(root);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(root)!==root)fail('PROJECT_RUNTIME_IMPORT_JOURNAL_INVALID');syncDirectory(dirname(root));return root;
}
function persistJournal(data:string,journal:RuntimeImportJournal,phase:string,details:Record<string,unknown>={}):void{
 const raw=canonicalize(phase==='RESERVED'?journal:{schemaVersion:1,id:journal.id,journalDigest:hashCanonical(journal),phase,createdAt:new Date().toISOString(),...details});
 if(Buffer.byteLength(raw,'utf8')>1024*1024)fail('PROJECT_RUNTIME_IMPORT_JOURNAL_LIMIT');
 const root=journalRoot(data),path=join(root,`${journal.id}-${phase.toLowerCase()}.json`),fd=openSync(path,'wx',0o600);
 try{writeFileSync(fd,raw);fsyncSync(fd)}finally{closeSync(fd)}syncDirectory(root);
}
/** Read-only preparation. Neither a proposal nor a seal is runtime authority. */
export function prepareProjectRuntimeImport(dataRoot:string,repoRoot:string,taskId:string,sessionId:string,inspect:ArtifactInspection):ProjectRuntimeImportProposal{
 if(!validateScalar('ID',taskId).ok||!validateScalar('Text',sessionId).ok||typeof inspect!=='function')fail('PROJECT_RUNTIME_IMPORT_INPUT_INVALID');
 const context=resolveProjectStorage(dataRoot,repoRoot);if(!context.custodian)fail('PROJECT_RUNTIME_IMPORT_CUSTODIAN_REQUIRED');
 const taskRoot=join(context.projectRoot,'tasks',taskId);assertProjectStoragePath(context,taskRoot);
 const ledger=DurableStore.load(taskRoot),s=ledger.state;
 if(ledger.truncatedTailBytes||['COMPLETED','FAILED'].includes(s.state))fail('PROJECT_RUNTIME_IMPORT_TERMINAL');
 if(s.runs.some(r=>!['TERMINAL','NOT_DISPATCHED'].includes(r.status)))fail('PROJECT_RUNTIME_IMPORT_RECONCILIATION_REQUIRED');
 const importedHandoff=readProjectHandoffForRuntimeImport(context.repoRoot),seal=importedHandoff?.record;
 if(!seal||seal.ownerDisposition!=='RELEASED_FOR_TRANSFER')fail('PROJECT_RUNTIME_IMPORT_RELEASE_REQUIRED');
 if(!seal.taskHeads.some(h=>h.taskId===taskId&&h.specHash===s.specHash&&h.stateRevision===s.revision
  &&h.stateDigest===hashCanonical(s)&&h.eventHash===ledger.events.at(-1)!.eventHash))fail('PROJECT_RUNTIME_IMPORT_STALE');
 const spec=ledger.records.find(r=>r.kind==='TaskSpec'&&r.id===s.spec.id);
 if(spec?.kind!=='TaskSpec'||spec.value.specHash!==s.specHash)fail('PROJECT_RUNTIME_IMPORT_BINDING_INVALID');
 const git=new CandidateGit(context.repoRoot,context.machineDataRoot);git.assertTarget(git.target(),seal.sourceHead);
 if(s.baselineCommit&&s.baselineCommit!==seal.sourceHead)fail('PROJECT_RUNTIME_IMPORT_BASELINE_MISMATCH');
 const candidate=s.candidate?verifyCandidateCheckpoint(context.repoRoot,taskRoot,context.machineDataRoot,s):undefined;
 const boundedBaseline=!s.candidate&&['BLOCKED','AWAITING_HUMAN','READY'].includes(s.state)&&s.blockedReason==='Developer reported a bounded blocker'?readBoundedDeveloperCheckpoint(context.repoRoot,taskRoot,context.machineDataRoot):undefined;
 const boundedWorkRoot=boundedBaseline?join(context.machineDataRoot,'controlled-dev','workspaces',`${context.projectId.slice(0,16)}-import-baseline-${taskId}-${randomUUID()}`):undefined;
 const candidateRoot=candidate?join(context.machineDataRoot,'controlled-dev','workspaces',`${context.projectId.slice(0,16)}-import-${taskId}-${randomUUID()}`):null;
 const payload=checkRuntimeRootBindingPayload({schemaVersion:boundedBaseline?2:1,...(boundedBaseline?{boundedBaseline:{descriptor:boundedBaseline.descriptor,descriptorRelativePath:boundedBaseline.descriptorRelativePath,transcriptRelativePath:boundedBaseline.transcriptRelativePath,workRoot:boundedWorkRoot!}}:{}),projectId:context.projectId,taskId,specHash:s.specHash,
  sourceRevision:s.revision,sourceEventHash:ledger.events.at(-1)!.eventHash,sourceStateDigest:hashCanonical(s),
  projectOriginalRepoRoot:context.custodian.originalRepoRoot,historicalRepoRoot:spec.value.scope.repoRoot,previousRepoRoot:s.repoRoot,repoRoot:context.repoRoot,
  previousCandidateRoot:s.candidate?.root??null,candidateRoot,candidateDigest:s.candidate?.digest??null,candidateGeneration:s.candidate?.generation??null,
  humanDigest:importedHandoff!.humanDigest,sourceHead:seal.sourceHead,sourceTree:seal.sourceTree,sourceInventoryDigest:inventoryHash(inventoryTree(context.repoRoot,['.git','node_modules'])),handoffDigest:seal.descriptorDigest,resumeState:runtimeRebindResumeState(s,ledger.records)});
 const proposal=Object.freeze({id:`import-${randomUUID()}`,payload:immutablePayload(payload)});
 const handoffRaw=readFileSync(join(context.repoRoot,'.controlled-dev','handoffs',seal.descriptorDigest+'.json'));
 if(inspect(handoffRaw,'application/vnd.pi-controlled-dev.project-handoff+json')!=='ACCEPT')fail('PROJECT_RUNTIME_IMPORT_DISCLOSURE_REJECTED');
 proposals.set(proposal,{proposal,data:context.machineDataRoot,taskRoot,ledger,spec:spec.value,inspect,sessionId,handoffRaw,candidate,boundedBaseline,humanChanges:importedHandoff!.humanChanges});return proposal;
}
export function projectRuntimeImportRequest(proposal:ProjectRuntimeImportProposal):TrustedConfirmationRequest{
 const p=proposals.get(proposal);if(!p)fail('PROJECT_RUNTIME_IMPORT_PROPOSAL_INVALID');if(p.request)return p.request;
 const v=proposal.payload,s=p.ledger.state;
 const bounded=v.schemaVersion===2?`The Developer stopped without changes: the Git baseline and its termination evidence are preserved. The baseline will be recreated in ${v.boundedBaseline.workRoot}. It is not a candidate. Another attempt requires a new implementation confirmation, within previously used limits.\n`:'';
 const human=p.humanChanges.length?`Documents or notes changed since the last save: ${p.humanChanges.length}. Current files will be preserved; they grant no execution permissions.\n${p.humanChanges.map(change=>`${({ADDED:"Added",CHANGED:"Modified",REMOVED:"Removed"} as const)[change.status]}: ${change.path}`).join('\n')}\n`:'';
 p.request=createTrustedConfirmationRequest({purpose:'project-runtime-import',subjectKind:'project-runtime-binding',subjectId:v.taskId,subjectRevision:v.sourceRevision,action:'APPROVE',payload:v as unknown as Json,
  presentation:{title:"Resume this project in the current folder?",content:`Task: ${p.spec.title}\nPrevious folder: ${v.previousRepoRoot}\nCurrent folder: ${v.repoRoot}\n${v.candidateRoot?`Saved work: verified copy ${v.candidateDigest}, version ${v.candidateGeneration}.\nNew workspace: ${v.candidateRoot}`:"Implementation has no saved copy yet."}\n${bounded}Attempts already used: ${s.counters.attempts}; dispatches: ${s.counters.dispatches}; corrections: ${s.counters.reworkAttempts}.\nThe plan, decisions and previous evidence remain in history. Required confirmations and checks will be requested again in the current folder.\n${human}State to resume: ${v.resumeState}.`}});return p.request;
}
function unchanged(p:Prepared):void{
 const v=p.proposal.payload;
 if(!same(DurableStore.load(p.taskRoot),p.ledger))fail('PROJECT_RUNTIME_IMPORT_STALE');
 const storage=resolveProjectStorage(p.data,v.repoRoot);if(storage.custodian?.projectId!==v.projectId||storage.custodian.originalRepoRoot!==v.projectOriginalRepoRoot)fail('PROJECT_RUNTIME_IMPORT_BINDING_INVALID');
 assertProjectStoragePath(storage,p.taskRoot);
 const git=new CandidateGit(v.repoRoot,p.data);git.assertTarget(git.target(),v.sourceHead);if(git.tree(v.sourceHead)!==v.sourceTree)fail('PROJECT_RUNTIME_IMPORT_STALE');
 if(inventoryHash(inventoryTree(v.repoRoot,['.git','node_modules']))!==v.sourceInventoryDigest)fail('PROJECT_RUNTIME_IMPORT_SOURCE_CHANGED');
 const imported=readProjectHandoffForRuntimeImport(v.repoRoot);if(imported?.humanDigest!==v.humanDigest||!same(imported?.humanChanges,p.humanChanges))fail('PROJECT_RUNTIME_IMPORT_HUMAN_CHANGED');
 if(p.candidate)verifyCandidateCheckpoint(v.repoRoot,p.taskRoot,p.data,p.ledger.state);
 if(p.boundedBaseline){const current=readBoundedDeveloperCheckpoint(v.repoRoot,p.taskRoot,p.data);if(!current||current.descriptorDigest!==p.boundedBaseline.descriptorDigest||!same(current.manifest,p.boundedBaseline.manifest))fail('PROJECT_RUNTIME_IMPORT_BASELINE_CHANGED')} 
}
function boundedBaselineEvidence(p:Prepared):BoundedBaselineImportEvidence|undefined{
 const c=p.boundedBaseline;if(!c)return undefined;
 const descriptorRaw=Buffer.from(canonicalize(c.descriptor),'utf8'),path=join(p.proposal.payload.repoRoot,'.controlled-dev',c.transcriptRelativePath),stat=lstatSync(path);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size!==c.descriptor.transcriptBytes||realpathSync(path)!==path)fail('PROJECT_RUNTIME_IMPORT_BASELINE_CHANGED');
 const transcriptRaw=readFileSync(path);
 if(hashBytes(descriptorRaw)!==c.descriptorDigest||transcriptRaw.byteLength!==c.descriptor.transcriptBytes||hashBytes(transcriptRaw)!==c.descriptor.transcriptDigest)fail('PROJECT_RUNTIME_IMPORT_BASELINE_CHANGED');
 const again=readBoundedDeveloperCheckpoint(p.proposal.payload.repoRoot,p.taskRoot,p.data);if(!again||again.descriptorDigest!==c.descriptorDigest)fail('PROJECT_RUNTIME_IMPORT_BASELINE_CHANGED');
 const ref=(id:string,raw:Uint8Array,mediaType:string):ArtifactRef=>({schemaVersion:1,id,relativeStorePath:`artifacts/${id}`,digest:hashBytes(raw),bytes:raw.byteLength,mediaType});
 return Object.freeze({descriptorRef:ref(`bounded-baseline-${c.descriptorDigest}`,descriptorRaw,'application/vnd.pi-controlled-dev.bounded-developer-baseline+json'),descriptorRaw,
  transcriptRef:ref(`bounded-transcript-${c.descriptor.transcriptDigest}`,transcriptRaw,'application/vnd.pi-controlled-dev.terminal-transcript+jsonl'),transcriptRaw});
}
/** Native receipt, exact-state CAS and newly acquired local locks are all
 * mandatory. Historical approval JSON never becomes this private capability. */
export function authorizeProjectRuntimeImport(proposal:ProjectRuntimeImportProposal,receipt:TrustedConfirmationReceipt):ProjectRuntimeImportCapability{
 const p=proposals.get(proposal);if(!p||!p.request)fail('PROJECT_RUNTIME_IMPORT_PROPOSAL_INVALID');
 unchanged(p);const seal=readProjectHandoffForRuntimeImport(proposal.payload.repoRoot)?.record;
 if(seal?.descriptorDigest!==proposal.payload.handoffDigest||seal.ownerDisposition!=='RELEASED_FOR_TRANSFER')fail('PROJECT_RUNTIME_IMPORT_STALE');
 const manager=new LockManager(p.data,p.sessionId,`import-${randomUUID()}`),locks=manager.acquire(proposal.payload.taskId,proposal.payload.repoRoot);
 const journal:RuntimeImportJournal=Object.freeze({schemaVersion:1,id:proposal.id,phase:'RESERVED',payload:proposal.payload,taskRoot:p.taskRoot,sessionId:p.sessionId,taskLock:locks.task.record,workspaceLock:locks.workspace.record});
 let consumed=false;
 try{
  // Reserve the physical lease and exact source head durably before receipt
  // consumption, candidate restoration or any portable-namespace writes.
  persistJournal(p.data,journal,'RESERVED');
  unchanged(p);
  // Consumption checks freshness both before and after storing its evidence.
  // Stage only these authenticated bytes in this host process: publishing into
  // the portable namespace here would invalidate the exact release seal.
  const staged=new Map<string,{ref:ArtifactRef;raw:Uint8Array}>();
  const confirmationRef=consumeTrustedConfirmation(receipt,()=>{unchanged(p);return p.request},{
   put(id,content,mediaType){const raw=Buffer.from(content,'utf8');const ref:ArtifactRef={schemaVersion:1,id,relativeStorePath:`artifacts/${id}`,mediaType,digest:hashBytes(raw),bytes:raw.byteLength};staged.set(id,{ref,raw});return ref},
   read(ref){const value=staged.get(ref.id);if(!value||!same(value.ref,ref))fail('PROJECT_RUNTIME_IMPORT_CONFIRMATION_INVALID');return value.raw},
  });consumed=true;
  if(receipt.confirmationInstance.sessionId!==p.sessionId)fail('PROJECT_RUNTIME_IMPORT_SESSION_CHANGED');
  const candidate=p.candidate,v=proposal.payload;
  if(candidate){
   const git=new CandidateGit(v.repoRoot,p.data);
   // A detached baseline does not claim the historical branch/worktree owner.
   if(existsSync(v.candidateRoot!))fail('PROJECT_RUNTIME_IMPORT_DESTINATION_EXISTS');
   git.restoreCandidateSnapshot(candidate.snapshotRoot,v.candidateRoot!,candidate.candidateRef,candidate.manifest);
   ScopeGuard.restore({...p.spec.scope,repoRoot:v.repoRoot},{...p.ledger.state.candidate!,root:v.candidateRoot!},'verified portable snapshot');
  }
  let baselineEvidence:BoundedBaselineImportEvidence|undefined;
  if(p.boundedBaseline){
   if(v.schemaVersion!==2||candidate||existsSync(v.boundedBaseline.workRoot))fail('PROJECT_RUNTIME_IMPORT_BINDING_INVALID');
   const assertAuthorized=()=>{if(!consumed||!staged.has(confirmationRef.id)||!manager.verifyTaskLock(locks.task)||!manager.verifyWorkspaceLock(locks.workspace))fail('PROJECT_RUNTIME_IMPORT_CAPABILITY_INVALID');unchanged(p)};
   materializeBoundedDeveloperCheckpoint(p.boundedBaseline,v.boundedBaseline.workRoot,{manager,workspaceLock:locks.workspace,assertAuthorized});
   baselineEvidence=boundedBaselineEvidence(p);assertAuthorized();
  }
  const capability=Object.freeze({id:proposal.id,taskId:proposal.payload.taskId,repoRoot:proposal.payload.repoRoot,sessionId:p.sessionId});
  persistJournal(p.data,journal,'AUTHORIZED',{confirmationRef,...(baselineEvidence?{boundedBaselineRef:baselineEvidence.descriptorRef,boundedTranscriptRef:baselineEvidence.transcriptRef}:{})});
  capabilities.set(capability,{claimed:false,restored:false,retired:false,lease:{proposal,data:p.data,taskRoot:p.taskRoot,ledger:p.ledger,spec:p.spec,inspect:p.inspect,manager,locks,
   confirmationRef,confirmationRaw:staged.get(confirmationRef.id)!.raw,handoffRaw:p.handoffRaw,sessionId:p.sessionId,journal,...(baselineEvidence?{boundedBaselineEvidence:baselineEvidence}:{})}});
  proposals.delete(proposal);return capability;
 }catch(error){
  // No provider or portable store is reachable in this phase. Release only if
  // the sealed source and ledger are still exactly the prepared observations.
  try{unchanged(p);persistJournal(p.data,journal,'FAILED_BEFORE_TAKEOVER',{receiptConsumed:consumed,errorCode:error instanceof Error?error.message:'UNKNOWN'});manager.releaseAll(locks);persistJournal(p.data,journal,'CLOSED_NO_WORKFLOW_EFFECT')}catch{}
  throw error;
 }
}
export function projectRuntimeImportLease(capability:ProjectRuntimeImportCapability,claim=false):ProjectRuntimeImportLease{
 const c=capabilities.get(capability);if(!c||c.retired||!c.lease.manager.verifyTaskLock(c.lease.locks.task)||!c.lease.manager.verifyWorkspaceLock(c.lease.locks.workspace))fail('PROJECT_RUNTIME_IMPORT_CAPABILITY_INVALID');
 if(claim){if(c.claimed)fail('PROJECT_RUNTIME_IMPORT_ALREADY_CLAIMED');persistJournal(c.lease.data,c.lease.journal,'TAKEOVER_STAGING');c.claimed=true}return c.lease;
}

/** Called immediately after a host instance is successfully installed. A later
 * failure must be handled by that instance's ordinary quiescent shutdown. */
export function completeProjectRuntimeImport(capability:ProjectRuntimeImportCapability):void{
 const c=capabilities.get(capability);if(!c||c.retired||!c.claimed)fail('PROJECT_RUNTIME_IMPORT_CAPABILITY_INVALID');
 c.restored=true;persistJournal(c.lease.data,c.lease.journal,'RESTORED');
}
/** No dispatch is performed by authorization/takeover/constructor. On a caught
 * pre-install failure, verify all durable heads and the actual source before
 * retiring this capability and publishing a new release seal. Orphan immutable
 * artifacts stay in place and become part of that seal; nothing is rolled back. */
export function abortProjectRuntimeImport(capability:ProjectRuntimeImportCapability,error:unknown):void{
 const c=capabilities.get(capability);if(!c||c.retired||c.restored)fail('PROJECT_RUNTIME_IMPORT_ABORT_DENIED');
 const l=projectRuntimeImportLease(capability),p=l.proposal.payload,storage=resolveProjectStorage(l.data,p.repoRoot),tasks=join(storage.projectRoot,'tasks');
 const ids=readdirSync(tasks).sort();
 const verify=()=>{
  if(!l.manager.verifyTaskLock(l.locks.task)||!l.manager.verifyWorkspaceLock(l.locks.workspace)||!same(readdirSync(tasks).sort(),ids))fail('PROJECT_RUNTIME_IMPORT_ABORT_UNCERTAIN');
  const git=new CandidateGit(p.repoRoot,l.data);git.assertTarget(git.target(),p.sourceHead);if(git.tree(p.sourceHead)!==p.sourceTree||inventoryHash(inventoryTree(p.repoRoot,['.git','node_modules']))!==p.sourceInventoryDigest)fail('PROJECT_RUNTIME_IMPORT_ABORT_UNCERTAIN');
  for(const id of ids){const ledger=DurableStore.load(join(tasks,id));if(ledger.truncatedTailBytes||ledger.state.runs.some(r=>!runQuiescent(r)))fail('PROJECT_RUNTIME_IMPORT_ABORT_UNCERTAIN')}
  const current=DurableStore.load(l.taskRoot);
  if(!same(current,l.ledger)){
   if(current.events.length!==l.ledger.events.length+1||!same(current.events.slice(0,-1),l.ledger.events)||current.state.revision!==p.sourceRevision+1
    ||current.state.repoRoot!==p.repoRoot||current.state.ownerSessionId!==l.sessionId||!current.state.runtimeBindingRef
    ||!same(current.state.counters,l.ledger.state.counters)||!same(current.state.runs,l.ledger.state.runs)||!same(current.state.spec,l.ledger.state.spec))fail('PROJECT_RUNTIME_IMPORT_ABORT_UNCERTAIN');
   // load() validates the new binding, original confirmation, seal and chain.
   if(current.state.candidate&&hashCanonical(workspaceManifest(current.state.candidate.root,current.state.candidate.baseCommit))!==current.state.candidate.digest)fail('PROJECT_RUNTIME_IMPORT_ABORT_UNCERTAIN');
   if(p.schemaVersion===2&&hashCanonical(workspaceManifest(p.boundedBaseline.workRoot,p.boundedBaseline.descriptor.baselineCommit))!==p.boundedBaseline.descriptor.manifestDigest)fail('PROJECT_RUNTIME_IMPORT_ABORT_UNCERTAIN');
  }
 };
 verify();persistJournal(l.data,l.journal,'FAILED_BEFORE_HOST_INSTALL',{errorCode:error instanceof Error?error.message:'UNKNOWN',currentRevision:DurableStore.load(l.taskRoot).state.revision});
 const descriptors=[...currentProjectHandoffCandidatePaths(p.repoRoot)],current=DurableStore.load(l.taskRoot);
 if(current.state.candidate&&current.state.revision!==p.sourceRevision){const saved=captureCandidateCheckpoint(p.repoRoot,l.taskRoot,l.data,{manager:l.manager,workspaceLock:l.locks.workspace});for(let i=descriptors.length-1;i>=0;i--)if(descriptors[i].startsWith(`candidates/${p.taskId}/checkpoints/`))descriptors.splice(i,1);descriptors.push(`candidates/${p.taskId}/checkpoints/${saved.descriptorDigest}.json`)}
 let retiring=false;
 releaseProjectHandoff({repoRoot:p.repoRoot,manager:l.manager,workspaceLock:l.locks.workspace,candidateDescriptors:descriptors,
  assertQuiescent(){if(!retiring)verify();else{for(const id of ids){const ledger=DurableStore.load(join(tasks,id));if(ledger.truncatedTailBytes||ledger.state.runs.some(r=>!runQuiescent(r)))fail('PROJECT_RUNTIME_IMPORT_ABORT_UNCERTAIN')}}},
  retireAuthority(){c.retired=true;retiring=true;l.manager.release(l.locks.task)}});
 persistJournal(l.data,l.journal,'CLOSED_NO_DISPATCH',{revision:DurableStore.load(l.taskRoot).state.revision});
}

export interface ProjectRuntimeImportRecoveryProposal {readonly id:string;readonly taskId:string;readonly sourceRevision:number;readonly sourceStateDigest:string;readonly namespaceDigest:string;readonly oldLocksDigest:string;readonly evidenceKind:'JOURNALED_NO_PORTABLE_WRITES'|'LEGACY_PRECOMMIT_STAGING';readonly stagingRefs:readonly {id:string;digest:string;bytes:number}[]}
interface ImportRecoveryPrepared {proposal:ProjectRuntimeImportRecoveryProposal;data:string;repo:string;taskRoot:string;ledger:StoredLedger;payload:RuntimeRootBindingPayload;oldTask:LockRecord;oldWorkspace:LockRecord;taskPath:string;workspacePath:string;namespace:ReturnType<typeof projectHandoffNamespaceManifest>;inspect:ArtifactInspection;session:string;request?:TrustedConfirmationRequest}
const importRecoveries=new WeakMap<object,ImportRecoveryPrepared>();
function regularJson(path:string,max=1024*1024):{raw:Uint8Array;value:any}{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>max||realpathSync(path)!==path)fail('PROJECT_RUNTIME_IMPORT_RECOVERY_EVIDENCE_INVALID');const raw=readFileSync(path);return {raw,value:parseJson(raw,max)}}
function noOtherTaskLease(lockRoot:string,taskPath:string,workspaceHash:string):void{for(const name of readdirSync(join(lockRoot,'tasks'))){const path=join(lockRoot,'tasks',name);if(path!==taskPath&&name.endsWith('.lock')&&regularJson(path,16384).value.workspaceHash===workspaceHash)fail('PROJECT_RUNTIME_IMPORT_RECOVERY_LOCK_INVALID')}}
function exactLock(path:string,kind:'TASK'|'WORKSPACE',workspaceHash:string,taskId:string):LockRecord{
 const {value}=regularJson(path,16384),keys=['acquiredAt','kind','ownerSessionId','processIncarnation','runtimeGeneration','schemaVersion','token','workspaceHash',...(kind==='TASK'?['taskId']:[])];
 if(Object.keys(value).sort().join(',')!==keys.sort().join(',')||value.schemaVersion!==2||value.kind!==kind||value.workspaceHash!==workspaceHash||kind==='TASK'&&value.taskId!==taskId
  ||!/^import-[a-f0-9-]{36}$/.test(value.runtimeGeneration)||!validateScalar('Text',value.ownerSessionId).ok||!validateScalar('Time',value.acquiredAt).ok||!/^[-a-f0-9]{36}$/.test(value.token))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_LOCK_INVALID');
 if(inspectProcessOwner(value.processIncarnation).status!=='DEAD')fail('PROJECT_RUNTIME_IMPORT_RECOVERY_OWNER_NOT_DEAD');return value;
}
/** Narrow read-only recovery for a dead import that never committed ownership.
 * It never edits old approval/state bytes or treats a staged state as history.
 * Unrecognized partial staging and already-committed ownership stay blocked. */
export function prepareProjectRuntimeImportRecovery(dataRoot:string,repoRoot:string,taskId:string,session:string,inspect:ArtifactInspection):ProjectRuntimeImportRecoveryProposal|undefined{
 const storage=resolveProjectStorage(dataRoot,repoRoot);if(!storage.custodian)return undefined;
 if(!validateScalar('ID',taskId).ok||!validateScalar('Text',session).ok||typeof inspect!=='function')fail('PROJECT_RUNTIME_IMPORT_INPUT_INVALID');
 const data=storage.machineDataRoot,repo=storage.repoRoot,hash=hashBytes(Buffer.from(repo)),lockRoot=join(data,'controlled-dev','locks'),workspacePath=join(lockRoot,'workspaces',hash+'.lock'),taskPath=join(lockRoot,'tasks',hashBytes(Buffer.from(`${hash}\0${taskId}`))+'.lock');
 if(!existsSync(workspacePath))return undefined;
 noOtherTaskLease(lockRoot,taskPath,hash);
 const oldWorkspace=exactLock(workspacePath,'WORKSPACE',hash,taskId),oldTask=exactLock(taskPath,'TASK',hash,taskId);
 if(oldWorkspace.ownerSessionId!==oldTask.ownerSessionId||oldWorkspace.runtimeGeneration!==oldTask.runtimeGeneration||!same(oldWorkspace.processIncarnation,oldTask.processIncarnation))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_LOCK_INVALID');
 const taskRoot=join(storage.projectRoot,'tasks',taskId);assertProjectStoragePath(storage,taskRoot);const ledger=DurableStore.load(taskRoot),state=ledger.state;
 if(ledger.truncatedTailBytes||state.runs.some(r=>!runQuiescent(r)))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_NOT_QUIESCENT');
 const pointer=regularJson(join(repo,'.controlled-dev','handoff.json'),4096).value;
 if(pointer.schemaVersion!==1||!validateScalar('Hash',pointer.descriptorDigest).ok||Object.keys(pointer).sort().join(',')!=='descriptorDigest,schemaVersion')fail('PROJECT_RUNTIME_IMPORT_RECOVERY_EVIDENCE_INVALID');
 const sealed=regularJson(join(repo,'.controlled-dev','handoffs',pointer.descriptorDigest+'.json'),64*1024*1024),seal=sealed.value;
 if(hashBytes(sealed.raw)!==pointer.descriptorDigest||canonicalize(seal)!==Buffer.from(sealed.raw).toString('utf8')||seal.schemaVersion!==1||seal.projectId!==storage.projectId
  ||seal.originalRepoRoot!==storage.custodian.originalRepoRoot||seal.ownerDisposition!=='RELEASED_FOR_TRANSFER'||seal.quiescence!=='VERIFIED'||!Array.isArray(seal.namespaceManifest)
  ||!Array.isArray(seal.taskHeads)||!seal.taskHeads.some((h:any)=>h.taskId===taskId&&h.stateRevision===state.revision&&h.stateDigest===hashCanonical(state)&&h.eventHash===ledger.events.at(-1)!.eventHash&&h.specHash===state.specHash))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_HEAD_CHANGED');
 const git=new CandidateGit(repo,data);git.assertTarget(git.target(),seal.sourceHead);if(git.tree(seal.sourceHead)!==seal.sourceTree)fail('PROJECT_RUNTIME_IMPORT_RECOVERY_SOURCE_CHANGED');
 const namespace=projectHandoffNamespaceManifest(repo),currentByPath=new Map(namespace.map(f=>[f.path,f])),prior=new Map<string,any>(seal.namespaceManifest.map((f:any)=>[f.path,f]));
 if(prior.size!==seal.namespaceManifest.length||seal.namespaceManifest.some((f:any)=>!currentByPath.has(f.path)||!same(currentByPath.get(f.path),f)))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_NAMESPACE_CHANGED');
 const extras=namespace.filter(f=>!prior.has(f.path)),prefix=relative(repo,join(taskRoot,'artifacts'))+'/';
 if(extras.some(f=>!f.path.startsWith(prefix)||f.path.slice(prefix.length).includes('/')))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_NAMESPACE_CHANGED');
 let payload:RuntimeRootBindingPayload|undefined,evidenceKind:ProjectRuntimeImportRecoveryProposal['evidenceKind'];
 if(extras.length===0){
  const root=join(data,'controlled-dev','runtime-imports');if(!existsSync(root))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_JOURNAL_REQUIRED');
  if(realpathSync(root)!==root||!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink())fail('PROJECT_RUNTIME_IMPORT_RECOVERY_EVIDENCE_INVALID');
  const matches=readdirSync(root).filter(n=>/^import-[a-f0-9-]{36}-reserved\.json$/.test(n)).map(n=>regularJson(join(root,n)).value).filter(j=>j.schemaVersion===1&&j.phase==='RESERVED'&&j.taskRoot===taskRoot&&same(j.taskLock,oldTask)&&same(j.workspaceLock,oldWorkspace));
  if(matches.length!==1)fail('PROJECT_RUNTIME_IMPORT_RECOVERY_JOURNAL_REQUIRED');payload=checkRuntimeRootBindingPayload(matches[0].payload);evidenceKind='JOURNALED_NO_PORTABLE_WRITES';
 }else{
  // The pre-journal release has one fully bound six-file pre-WAL staging graph.
  // Other partial layouts require investigation instead of permissive cleanup.
  if(extras.length!==6)fail('PROJECT_RUNTIME_IMPORT_RECOVERY_PARTIAL_STAGING_UNSUPPORTED');
  const byId=new Map(extras.map(f=>[f.path.slice(prefix.length),f])),readRef=(ref:ArtifactRef)=>{
   if(!validateStructure('ArtifactRef',ref).ok||ref.relativeStorePath!==`artifacts/${ref.id}`||!byId.has(ref.id))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_EVIDENCE_INVALID');
   return DurableStore.readArtifact(taskRoot,ref);
  };
  const bindingFiles=extras.filter(f=>/^runtime-binding-/.test(f.path.slice(prefix.length))),takeoverFiles=extras.filter(f=>/^takeover-/.test(f.path.slice(prefix.length))),catalogFiles=extras.filter(f=>/^catalog-[a-f0-9]{64}$/.test(f.path.slice(prefix.length)));
  if(bindingFiles.length!==1||takeoverFiles.length!==1||catalogFiles.length!==1)fail('PROJECT_RUNTIME_IMPORT_RECOVERY_EVIDENCE_INVALID');
  const bindingFile=bindingFiles[0]!,binding=regularJson(join(repo,bindingFile.path)).value,takeover=regularJson(join(repo,takeoverFiles[0]!.path)).value;
  if(Object.keys(binding).sort().join(',')!=='confirmationRef,handoffRef,id,payload,schemaVersion'||binding.schemaVersion!==1||binding.id!==bindingFile.path.slice(prefix.length))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_EVIDENCE_INVALID');
  payload=checkRuntimeRootBindingPayload(binding.payload);
  const packet=regularJson(join(taskRoot,binding.confirmationRef.relativeStorePath)).value;
  const evidence=readTrustedConfirmationEvidence({read:readRef},binding.confirmationRef,packet.request);
  if(evidence.request.purpose!=='project-runtime-import'||evidence.request.subjectKind!=='project-runtime-binding'||evidence.request.subjectId!==taskId
   ||evidence.request.subjectRevision!==state.revision||evidence.request.action!=='APPROVE'||evidence.receipt.confirmationInstance.sessionId!==oldTask.ownerSessionId||!same(evidence.request.payload,payload)
   ||hashBytes(readRef(binding.handoffRef))!==pointer.descriptorDigest||binding.handoffRef.mediaType!=='application/vnd.pi-controlled-dev.project-handoff+json'
   ||takeover.schemaVersion!==1||takeover.id!==takeoverFiles[0]!.path.slice(prefix.length)||takeover.classification!=='VERIFIED_PORTABLE_IMPORT'||takeover.taskId!==taskId
   ||takeover.revision!==state.revision||takeover.eventHash!==ledger.events.at(-1)!.eventHash||takeover.sessionId!==oldTask.ownerSessionId
   ||!same(takeover.taskLock,oldTask)||!same(takeover.workspaceLock,oldWorkspace)||!same(takeover.processIncarnation,oldTask.processIncarnation)
   ||takeover.runtimeBindingRef.id!==binding.id||hashBytes(readRef(takeover.runtimeBindingRef))!==bindingFile.digest)fail('PROJECT_RUNTIME_IMPORT_RECOVERY_EVIDENCE_INVALID');
  const refs=[binding.confirmationRef,binding.handoffRef,takeover.runtimeBindingRef,{schemaVersion:1,id:takeover.id,relativeStorePath:`artifacts/${takeover.id}`,mediaType:'application/vnd.pi-controlled-dev.takeover+json',digest:takeoverFiles[0]!.digest,bytes:takeoverFiles[0]!.bytes}];
  const catalogFile=catalogFiles[0]!,catalog=regularJson(join(repo,catalogFile.path),64*1024*1024).value,head=ledger.events.at(-1)!;
  const sourceCatalogRaw=Buffer.from(canonicalize({schemaVersion:1,records:ledger.records})),sourceCatalogId=`catalog-${hashBytes(sourceCatalogRaw)}`,sourceCatalog:ArtifactRef={schemaVersion:1,id:sourceCatalogId,digest:hashBytes(sourceCatalogRaw),bytes:sourceCatalogRaw.byteLength,mediaType:'application/json',relativeStorePath:`artifacts/${sourceCatalogId}`};
  if(!same(Buffer.from(DurableStore.readArtifact(taskRoot,sourceCatalog)).toString('utf8'),sourceCatalogRaw.toString('utf8')))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_CATALOG_INVALID');
  // The constructor adds the exact current state/event and its source catalog
  // to the persisted catalog before adding the four new staged references.
  const expectedRecords=new Map<string,unknown>(ledger.records.map(r=>[r.id,r]));
  for(const r of [{id:sourceCatalog.id,kind:'ArtifactRef',value:sourceCatalog},{id:head.stateAfter.id,kind:'WorkflowState',value:state},{id:head.id,kind:'TransitionEvent',value:head},...refs.map(ref=>({id:ref.id,kind:'ArtifactRef',value:ref}))])expectedRecords.set(r.id,r);
  if(catalogFile.path.slice(prefix.length)!==`catalog-${hashCanonical(catalog)}`||catalog.schemaVersion!==1||!Array.isArray(catalog.records)
   ||catalog.records.length!==expectedRecords.size||new Set(catalog.records.map((r:any)=>r.id)).size!==expectedRecords.size
   ||catalog.records.some((r:any)=>!expectedRecords.has(r.id)||!same(expectedRecords.get(r.id),r)))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_CATALOG_INVALID');
  const stagedFile=extras.find(f=>f.path===prefix+`state-r${state.revision+1}`||f.path.startsWith(prefix+`state-r${state.revision+1}-`));if(!stagedFile)fail('PROJECT_RUNTIME_IMPORT_RECOVERY_EVIDENCE_INVALID');
  const staged=regularJson(join(repo,stagedFile.path)).value,{pendingGateId:_pending,...base}=state;
  const expected={...base,repoRoot:payload.repoRoot,runtimeBindingRef:takeover.runtimeBindingRef,ownerSessionId:takeover.sessionId,state:payload.resumeState,revision:state.revision+1,
   ...(state.candidate?{candidate:{...state.candidate,root:payload.candidateRoot}}:{}),invalidEvidenceIds:[...new Set([...state.invalidEvidenceIds,...state.gates,...state.validations,...state.reviews])],lastEventId:`event-r${state.revision+1}`,updatedAt:staged.updatedAt};
  if(stagedFile.path!==prefix+`state-r${state.revision+1}`&&stagedFile.path!==prefix+`state-r${state.revision+1}-${hashCanonical(staged)}`||!validateStructure('WorkflowState',staged).ok||!same(staged,expected)||!same(extras.map(f=>f.path.slice(prefix.length)).sort(),[...refs.map(r=>r.id),catalogFile.path.slice(prefix.length),stagedFile.path.slice(prefix.length)].sort()))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_STAGED_STATE_INVALID');
  evidenceKind='LEGACY_PRECOMMIT_STAGING';
 }
 if(payload.taskId!==taskId||payload.projectId!==storage.projectId||payload.repoRoot!==repo||payload.sourceRevision!==state.revision||payload.sourceStateDigest!==hashCanonical(state)
  ||payload.sourceEventHash!==ledger.events.at(-1)!.eventHash||payload.specHash!==state.specHash||payload.handoffDigest!==pointer.descriptorDigest
  ||payload.previousRepoRoot!==state.repoRoot||payload.sourceHead!==seal.sourceHead||payload.sourceTree!==seal.sourceTree
  ||payload.sourceInventoryDigest!==inventoryHash(inventoryTree(repo,['.git','node_modules'])))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_HEAD_CHANGED');
 const proposal=Object.freeze({id:`import-recovery-${randomUUID()}`,taskId,sourceRevision:state.revision,sourceStateDigest:hashCanonical(state),namespaceDigest:hashCanonical(namespace),oldLocksDigest:hashCanonical([oldTask,oldWorkspace]),evidenceKind,stagingRefs:Object.freeze(extras.map(f=>({id:f.path.slice(prefix.length),digest:f.digest,bytes:f.bytes})))});
 importRecoveries.set(proposal,{proposal,data,repo,taskRoot,ledger,payload,oldTask,oldWorkspace,taskPath,workspacePath,namespace,inspect,session});return proposal;
}
export function projectRuntimeImportRecoveryRequest(proposal:ProjectRuntimeImportRecoveryProposal):TrustedConfirmationRequest{
 const p=importRecoveries.get(proposal);if(!p)fail('PROJECT_RUNTIME_IMPORT_RECOVERY_PROPOSAL_INVALID');
 return p.request??=createTrustedConfirmationRequest({purpose:'project-runtime-import',subjectKind:'failed-project-import',subjectId:proposal.taskId,subjectRevision:proposal.sourceRevision,action:'APPROVE',payload:proposal as unknown as Json,
  presentation:{title:"Close the interrupted resume without starting agents?",content:`The previous instance terminated, and its permission pair was physically identified. Revision ${proposal.sourceRevision} is still the saved revision: no new event was accepted.\nPreserved evidence: ${proposal.stagingRefs.length} prepared documents; ${proposal.evidenceKind==='LEGACY_PRECOMMIT_STAGING'?"the previous version had no write-ahead journal.":"the write-ahead journal identifies this operation."}\nThis confirmation only removes those dead permissions and saves a new verified closure. It does not acquire the work or approve changes: resuming requires a second, new confirmation. The plan, evidence and used attempts remain preserved.`}});
}
export function recoverProjectRuntimeImport(proposal:ProjectRuntimeImportRecoveryProposal,receipt:TrustedConfirmationReceipt):void{
 const p=importRecoveries.get(proposal);if(!p||!p.request)fail('PROJECT_RUNTIME_IMPORT_RECOVERY_PROPOSAL_INVALID');
 const check=()=>{
  noOtherTaskLease(join(p.data,'controlled-dev','locks'),p.taskPath,p.oldTask.workspaceHash);
  if(!same(DurableStore.load(p.taskRoot),p.ledger)||hashCanonical(projectHandoffNamespaceManifest(p.repo))!==proposal.namespaceDigest
   ||!same(exactLock(p.taskPath,'TASK',p.oldTask.workspaceHash,proposal.taskId),p.oldTask)||!same(exactLock(p.workspacePath,'WORKSPACE',p.oldWorkspace.workspaceHash,proposal.taskId),p.oldWorkspace))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_STALE');
  const git=new CandidateGit(p.repo,p.data);git.assertTarget(git.target(),p.payload.sourceHead);if(git.tree(p.payload.sourceHead)!==p.payload.sourceTree||inventoryHash(inventoryTree(p.repo,['.git','node_modules']))!==p.payload.sourceInventoryDigest)fail('PROJECT_RUNTIME_IMPORT_RECOVERY_STALE');
 };check();
 const staged=new Map<string,{ref:ArtifactRef;raw:Uint8Array}>(),confirmationRef=consumeTrustedConfirmation(receipt,()=>{check();return p.request},{
  put(id,content,mediaType){const raw=Buffer.from(content,'utf8'),ref:ArtifactRef={schemaVersion:1,id,relativeStorePath:`artifacts/${id}`,mediaType,digest:hashBytes(raw),bytes:raw.byteLength};staged.set(id,{ref,raw});return ref},read(ref){const v=staged.get(ref.id);if(!v||!same(v.ref,ref))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_EVIDENCE_INVALID');return v.raw},
 });
 if(receipt.confirmationInstance.sessionId!==p.session)fail('PROJECT_RUNTIME_IMPORT_SESSION_CHANGED');
 const root=join(p.data,'controlled-dev','locks'),auditRoot=journalRoot(p.data),persist=(suffix:string,value:unknown)=>{const fd=openSync(join(auditRoot,proposal.id+suffix+'.json'),'wx',0o600);try{writeFileSync(fd,canonicalize(value));fsyncSync(fd)}finally{closeSync(fd)}syncDirectory(auditRoot)};
 withRepairMutation(root,p.oldTask.workspaceHash,retain=>{let complete=false;try{
  check();persist('-reclaim-authorized',{schemaVersion:1,proposal,previousTaskLock:p.oldTask,previousWorkspaceLock:p.oldWorkspace,confirmationRef,confirmationEvidence:JSON.parse(Buffer.from(staged.get(confirmationRef.id)!.raw).toString('utf8')),automaticResumeAllowed:false});
  unlinkSync(p.taskPath);syncDirectory(dirname(p.taskPath));unlinkSync(p.workspacePath);syncDirectory(dirname(p.workspacePath));persist('-pair-reclaimed',{schemaVersion:1,id:proposal.id,automaticResumeAllowed:false});complete=true;
 }finally{if(!complete)retain()}});
 const manager=new LockManager(p.data,p.session,`import-recovery-${randomUUID()}`),locks=manager.acquire(proposal.taskId,p.repo);
 // No automatic continuation: this lease may only publish a close checkpoint.
 const verify=()=>{const git=new CandidateGit(p.repo,p.data);git.assertTarget(git.target(),p.payload.sourceHead);if(git.tree(p.payload.sourceHead)!==p.payload.sourceTree||inventoryHash(inventoryTree(p.repo,['.git','node_modules']))!==p.payload.sourceInventoryDigest)fail('PROJECT_RUNTIME_IMPORT_RECOVERY_STALE');if(!manager.verifyTaskLock(locks.task)||!manager.verifyWorkspaceLock(locks.workspace)||!same(DurableStore.load(p.taskRoot),p.ledger)||hashCanonical(projectHandoffNamespaceManifest(p.repo))!==proposal.namespaceDigest)fail('PROJECT_RUNTIME_IMPORT_RECOVERY_STALE');
  const tasks=join(dirname(dirname(p.taskRoot)),'tasks');for(const id of readdirSync(tasks)){const ledger=DurableStore.load(join(tasks,id));if(ledger.truncatedTailBytes||ledger.state.runs.some(r=>!runQuiescent(r)))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_NOT_QUIESCENT')}};
 verify();releaseProjectHandoff({repoRoot:p.repo,manager,workspaceLock:locks.workspace,candidateDescriptors:currentProjectHandoffCandidatePaths(p.repo),assertQuiescent(){for(const id of readdirSync(join(dirname(dirname(p.taskRoot)),'tasks'))){const ledger=DurableStore.load(join(dirname(dirname(p.taskRoot)),'tasks',id));if(ledger.truncatedTailBytes||ledger.state.runs.some(r=>!runQuiescent(r)))fail('PROJECT_RUNTIME_IMPORT_RECOVERY_NOT_QUIESCENT')}},retireAuthority(){manager.release(locks.task)}});
 persist('-closed',{schemaVersion:1,id:proposal.id,outcome:'DEAD_IMPORT_LEASE_CLOSED',automaticResumeAllowed:false});importRecoveries.delete(proposal);
}
