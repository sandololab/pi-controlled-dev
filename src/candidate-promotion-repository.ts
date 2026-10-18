import { physicalProjectRootForTask, projectCustodianRoot } from './project-storage.js';
import { captureCandidateCheckpoint, verifyCandidateCheckpoint } from './candidate-checkpoints.js';
import { consumePolicyCapability, readPolicyAuthorization, POLICY_AUTHORIZATION_MEDIA } from './policy-authorization.js';
import type { PolicyAuthorizationCapability } from './policy-authorization.js';
import { projectIdentity } from './project-identity.js';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { dirname, join } from 'node:path';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { canonicalize, hashCanonical, hashBytes, parseJson, validateScalar, validateStructure } from './contracts.js';
import type { ArtifactRef, CandidateManifest, TaskSpec } from './contracts.js';
import { DurableStore } from './store.js';
import type { ArtifactInspection, StoredLedger } from './store.js';
import { LockManager } from './lock-manager.js';
import type { LockHandle, LockRecord } from './lock-manager.js';
import { CandidateGit } from './candidate-git.js';
import { readProjectHandoff } from './project-handoff.js';
import { runQuiescent } from './run-quiescence.js';
import { workspaceManifest, trackedWorkspaceManifest } from './scope-guard.js';
import { executeApprovedCommand } from './validation-runner.js';
import { redactRuntimeText } from './runtime-observability.js';
import type { ControlledReviewerRunner } from './controlled-reviewer.js';
import { createTrustedConfirmationRequest, consumeTrustedConfirmation, readTrustedConfirmationEvidence } from './trusted-confirmation.js';
import type { TrustedConfirmationRequest, TrustedConfirmationReceipt } from './trusted-confirmation.js';
import { PROMOTION_MEDIA, validateGitBinding, validatePromotionIndex, validatePromotionProposal, validatePromotionIntent, validatePromotionResult,
  validatePromotionObservation, promotionError, promotionNarrative } from './candidate-promotion.js';
import type { CandidateGitBinding, CandidatePromotionProposal, CandidatePromotionIntent, CandidatePromotionResult, IntegrationStatus, PromotionIndex, PromotionObservation } from './candidate-promotion.js';
import { validatePlanningPortability } from './project-planning.js';

interface Options {readonly manager?:LockManager;readonly workspaceLock?:LockHandle;readonly create?:boolean;readonly fault?:(point:string)=>void}
const same=(a:unknown,b:unknown)=>canonicalize(a)===canonicalize(b);
/** Project artifacts, indexed by the existing store, serialized by the existing workspace lock.
 * Completion remains a task fact. Only a consumed native receipt can publish a durable intent. */
export class CandidatePromotionRepository {
  readonly projectId:string;readonly git:CandidateGit;readonly projectRoot:string;
  #retired=false;#preparing=false;
  readonly #terminalRequests=new WeakMap<object,{taskId:string;stateDigest:string;handoffDigest:string;candidateRef:string;candidateCommit:string;descriptorDigest:string;workRoot:string}>();
  readonly #terminalLocations=new Map<string,{stateDigest:string;workRoot:string;receiptRef:ArtifactRef;locationRef:ArtifactRef}>();
  readonly #approvals=new WeakMap<object,{proposal:CandidatePromotionProposal;ref:ArtifactRef}>();
  private constructor(readonly store:DurableStore,readonly repoRoot:string,readonly options:Options){
    this.projectId=projectIdentity(repoRoot);this.projectRoot=dirname(store.root);this.git=new CandidateGit(repoRoot,store.agentDataRoot);this.#snapshot();
  }
  static open(data:string,repo:string,inspect:ArtifactInspection,options:Options={}):CandidatePromotionRepository|undefined{
    const open=()=>{const store=DurableStore.project(data,repo,'promotion',inspect,options.create===true);return store?new CandidatePromotionRepository(store,repo,options):undefined};
    if(!options.create)return open();
    const manager=options.manager??new LockManager(data,`candidate-promotion-${randomUUID()}`,`promotion-${randomUUID()}`),lock=options.workspaceLock??manager.acquireWorkspace(repo);
    try{if(!manager.verifyWorkspaceLock(lock)||lock.record.workspaceHash!==hashBytes(Buffer.from(repo)))promotionError('PROMOTION_LOCK_REQUIRED');return open()}
    finally{if(!options.workspaceLock)manager.release(lock)}
  }
  /** Keep one lease across preparation, native human interaction and final application. Dead
   * promotion leases can be reclaimed by process incarnation, never by age or guessed PID. */
  static async withLease<T>(data:string,repo:string,inspect:ArtifactInspection,action:(r:CandidatePromotionRepository)=>Promise<T>,fault?:Options['fault'],options:{readonly retainLeaseOnFailure?:boolean}={}):Promise<T>{
    const manager=new LockManager(data,`candidate-promotion-${randomUUID()}`,`promotion-${randomUUID()}`);let lock:LockHandle;
    try{lock=manager.acquireWorkspace(repo)}catch(error){
      if((error as {code?:string}).code!=='WORKSPACE_LOCK_UNAVAILABLE')throw error;
      const path=join(manager.root,'workspaces',`${manager.workspaceIdentity(repo).workspaceHash}.lock`),stat=lstatSync(path);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16384)throw error;
      const prior=JSON.parse(readFileSync(path).toString('utf8')) as LockRecord;manager.reclaimProjectWorkspace(repo,prior);lock=manager.acquireWorkspace(repo);
    }
    let completed=false;
    try{const result=await action(CandidatePromotionRepository.open(data,repo,inspect,{create:true,manager,workspaceLock:lock,fault})!);completed=true;return result}
    finally{if(completed||options.retainLeaseOnFailure!==true)manager.release(lock)}
  }
  #assertActive():void{if(this.#retired)promotionError('PROMOTION_REPOSITORY_RETIRED')}
  /** Retires this host instance only after its async work and pending effects are quiescent. */
  retireForProjectTransfer():void{this.#write(()=>{if(this.#preparing||this.#pending().length)promotionError('PROMOTION_NOT_QUIESCENT');this.#retired=true})}
  #write<T>(action:(manager:LockManager,workspaceLock:LockHandle)=>T):T{
    this.#assertActive();
    const manager=this.options.manager??new LockManager(this.store.agentDataRoot,`candidate-promotion-${randomUUID()}`,`promotion-${randomUUID()}`),lock=this.options.workspaceLock??manager.acquireWorkspace(this.repoRoot);
    try{if(!manager.verifyWorkspaceLock(lock)||lock.record.workspaceHash!==manager.workspaceIdentity(this.repoRoot).workspaceHash)promotionError('PROMOTION_LOCK_REQUIRED');return action(manager,lock)}
    finally{if(!this.options.workspaceLock)manager.release(lock)}
  }
  #now(){return new Date().toISOString()}
  #work(id:string){return join(this.store.agentDataRoot,'controlled-dev','workspaces',`${this.projectId.slice(0,16)}-${id}`)}
  worktree(taskId:string):string{const local=this.#terminalLocations.get(taskId);if(local)return local.workRoot;const b=this.binding(taskId);if(!b)promotionError('LEGACY_CANDIDATE_NOT_AUTOPROMOTABLE');return this.#work(`task-${b.taskId}-${b.specHash.slice(0,16)}`)}
  /** Persist the exact currently published candidate as portable data. This is not a
   * relocation approval: raw historical state/spec paths and all counters are untouched. */
  checkpoint(taskId:string):{readonly descriptorPath:string;readonly snapshotRoot:string;readonly stateDigest:string}|undefined {
    if(!projectCustodianRoot(this.repoRoot))return undefined;
    return this.#write((manager,workspaceLock)=>{
      if(!validateScalar('ID',taskId).ok)promotionError('PROMOTION_TASK_INVALID');
      const result=captureCandidateCheckpoint(this.repoRoot,join(this.projectRoot,'tasks',taskId),this.store.agentDataRoot,{manager,workspaceLock});
      return Object.freeze({descriptorPath:result.descriptorPath,snapshotRoot:result.snapshotRoot,stateDigest:result.descriptor.stateDigest});
    });
  }

  #put(id:string,value:unknown):ArtifactRef{this.#assertActive();validatePlanningPortability(value);return this.store.put(id,canonicalize(value),PROMOTION_MEDIA)}
  #read(ref:ArtifactRef):any{
    if(!validateStructure('ArtifactRef',ref).ok||ref.mediaType!==PROMOTION_MEDIA||ref.bytes>2*1024*1024)promotionError('PROMOTION_ARTIFACT_INVALID');
    const value=parseJson(this.store.read(ref),2*1024*1024);if(hashCanonical(value)!==ref.digest)promotionError('PROMOTION_ARTIFACT_INVALID');validatePlanningPortability(value);return value;
  }
  #snapshot(){
    const ref=this.store.readProjectIndex(),index:PromotionIndex=ref?validatePromotionIndex(this.#read(ref)):
      {schemaVersion:1,projectId:this.projectId,revision:0,bindings:[],proposals:[],intents:[],results:[],observations:[]};
    if(index.projectId!==this.projectId)promotionError('PROMOTION_PROJECT_INVALID');
    for(const refs of [index.bindings,index.proposals,index.intents,index.results,index.observations])if(new Set(refs.map(r=>r.id)).size!==refs.length)promotionError('PROMOTION_INDEX_INVALID');
    const bindings=index.bindings.map(r=>validateGitBinding(this.#read(r))),proposals=index.proposals.map(r=>validatePromotionProposal(this.#read(r))),
      intents=index.intents.map(r=>validatePromotionIntent(this.#read(r))),results=index.results.map(r=>validatePromotionResult(this.#read(r))),observations=index.observations.map(r=>validatePromotionObservation(this.#read(r)));
    for(const record of [...bindings,...proposals,...intents,...results,...observations])if(record.projectId!==this.projectId)promotionError('PROMOTION_PROJECT_INVALID');
    for(const [n,b] of bindings.entries()){
      const prior=bindings.slice(0,n).filter(p=>p.taskId===b.taskId);
      if(prior.length>1||prior.length&&(!same({...b,candidateCommit:null,candidateDigest:null,candidateGeneration:null,completedSpecHash:null},prior[0])||!b.candidateCommit)
        ||(b.candidateCommit===null)!==(b.candidateDigest===null)||(b.candidateCommit===null)!==(b.candidateGeneration===null)||(b.candidateCommit===null)!==(b.completedSpecHash===null))promotionError('PROMOTION_BINDING_INVALID');
    }
    for(const p of proposals){const b=bindings.findLast(b=>b.taskId===p.taskId);
      if(!b||p.specHash!==b.completedSpecHash||p.targetRef!==b.targetRef||p.taskBaseCommit!==b.baseCommit||p.candidateRef!==b.candidateRef||p.candidateCommit!==b.candidateCommit||p.candidateDigest!==b.candidateDigest)promotionError('PROMOTION_PROPOSAL_BINDING');
      this.#verifyProposalEvidence(p);
    }
    for(const i of intents){const n=index.proposals.findIndex(r=>same(r,i.proposalRef)),p=proposals[n];if(!p||p.taskId!==i.taskId)promotionError('PROMOTION_INTENT_INVALID');this.#approval(i,p)}
    for(const r of results){const n=index.intents.findIndex(i=>same(i,r.intentRef)),i=intents[n],p=i?proposals[index.proposals.findIndex(q=>same(q,i.proposalRef))]:undefined;
      if(!p||r.taskId!==p.taskId||r.targetRef!==p.targetRef||r.previousHead!==p.targetHead||r.resultingHead!==p.integrationCommit||r.integrationCommit!==p.integrationCommit)promotionError('PROMOTION_RESULT_INVALID');}
    if(new Set(results.map(r=>r.intentRef.id)).size!==results.length)promotionError('PROMOTION_RESULT_INVALID');
    return {ref,index,bindings,proposals,intents,results,observations};
  }
  bindingEvidence(taskId:string):{ref:ArtifactRef;binding:CandidateGitBinding}{const s=this.#snapshot(),i=s.bindings.findLastIndex(b=>b.taskId===taskId);if(i<0)promotionError('PROMOTION_BINDING_INVALID');return {ref:s.index.bindings[i],binding:s.bindings[i]};}
  #commit(base:ArtifactRef|undefined,index:PromotionIndex){const next=validatePromotionIndex({...index,revision:index.revision+1});this.store.replaceProjectIndex(base,this.#put(`promotion-index-${hashCanonical(next)}`,next))}
  #publish(key:'bindings'|'proposals'|'intents'|'results'|'observations',value:unknown,id:string):ArtifactRef{
    const {ref,index}=this.#snapshot(),artifact=this.#put(id,value);this.#commit(ref,{...index,[key]:[...index[key],artifact]});return artifact;
  }
  binding(taskId:string):CandidateGitBinding|undefined{if(!validateScalar('ID',taskId).ok)promotionError('PROMOTION_TASK_INVALID');return this.#snapshot().bindings.findLast(b=>b.taskId===taskId)}
  bindings():readonly CandidateGitBinding[]{return this.#snapshot().bindings.filter((b,n,all)=>!all.slice(n+1).some(x=>x.taskId===b.taskId))}
  integrationChoices():readonly {taskId:string;title:string;target:string}[]{
    const choices:{taskId:string;title:string;target:string}[]=[];
    for(const b of this.bindings()){
      if(this.status(b.taskId).baselineReady)continue;
      try{const {spec}=this.#terminalTask(b.taskId);choices.push({taskId:b.taskId,title:spec.title,target:b.targetRef.slice('refs/heads/'.length)})}
      catch(error){if((error as Error).message!=='PROMOTION_TASK_NOT_COMPLETED'&&(error as {code?:string}).code!=='ENOENT')throw error}
    }return choices;
  }
  #pending(){const s=this.#snapshot();return s.intents.filter(i=>!s.results.some(r=>r.intentRef.id===s.index.intents[s.intents.indexOf(i)].id))}
  initialize(spec:TaskSpec,base:string):CandidateGitBinding{
    return this.#write(()=>{
      if(this.#pending().length)promotionError('PROMOTION_RECOVERY_REQUIRED');if(!validateStructure('TaskSpec',spec).ok||spec.scope.repoRoot!==this.repoRoot)promotionError('PROMOTION_SPEC_INVALID');
      const prior=this.binding(spec.taskId);if(prior){if(prior.specHash!==spec.specHash||prior.baseCommit!==base||prior.candidateCommit)promotionError('PROMOTION_BINDING_INVALID');return prior}
      const targetRef=this.git.target();this.git.assertTarget(targetRef,base);
      const candidateRef=`refs/heads/controlled-dev/${spec.taskId}-${spec.specHash.slice(0,16)}`;
      try{this.git.refHead(candidateRef);promotionError('GIT_CANDIDATE_REF_COLLISION')}catch(error){if((error as {code?:string}).code!=='GIT_OPERATION_FAILED')throw error}
      const value=validateGitBinding({schemaVersion:1,taskId:spec.taskId,projectId:this.projectId,specHash:spec.specHash,targetRef,baseCommit:base,candidateRef,
        candidateCommit:null,candidateDigest:null,candidateGeneration:null,completedSpecHash:null,createdAt:this.#now()});
      this.#publish('bindings',value,`git-binding-${spec.taskId}-initial`);return value;
    });
  }
  materialize(taskId:string):string{return this.#write(()=>{const b=this.binding(taskId);if(!b||b.candidateCommit)promotionError('PROMOTION_BINDING_INVALID');const root=this.worktree(taskId);this.git.addTaskWorktree(b.candidateRef,b.baseCommit,root);return root})}
  #terminalTask(taskId:string):{ledger:StoredLedger;spec:TaskSpec;root:string}{
    if(!validateScalar('ID',taskId).ok)promotionError('PROMOTION_TASK_INVALID');const root=join(this.projectRoot,'tasks',taskId),ledger=DurableStore.load(root);
    if(ledger.truncatedTailBytes||ledger.state.taskId!==taskId||ledger.state.state!=='COMPLETED'||!ledger.state.candidate||ledger.state.runs.some(r=>!runQuiescent(r)))promotionError('PROMOTION_TASK_NOT_COMPLETED');
    const spec=ledger.records.find(r=>r.kind==='TaskSpec'&&r.id===ledger.state.spec.id);if(spec?.kind!=='TaskSpec'||spec.value.specHash!==ledger.state.specHash)promotionError('PROMOTION_SPEC_INVALID');
    if(physicalProjectRootForTask(root,spec.value.scope.repoRoot,ledger)!==this.repoRoot)promotionError('PROMOTION_CANDIDATE_BINDING');
    return {ledger,spec:spec.value,root};
  }
  /** Discovery only: neither historical completion nor copied files grant local restoration. */
  terminalRestorationRequired(taskId:string):boolean{
    if(!validateScalar('ID',taskId).ok)return false;
    const snapshot=this.#snapshot();if(snapshot.intents.some(i=>i.taskId===taskId&&!snapshot.results.some(r=>r.intentRef.id===snapshot.index.intents[snapshot.intents.indexOf(i)].id))||this.status(taskId).baselineReady)return false;
    let raw:StoredLedger;try{raw=DurableStore.load(join(this.projectRoot,'tasks',taskId))}catch(error){if((error as {code?:string}).code==='ENOENT')return false;throw error}
    if(raw.state.state!=='COMPLETED')return false;
    const task=this.#terminalTask(taskId),local=this.#terminalLocations.get(taskId);
    if(local){this.#assertTerminalLocation(taskId,task);return false}
    return task.ledger.state.repoRoot!==this.repoRoot||task.ledger.state.candidate!.root!==this.worktree(taskId)||!existsSync(this.worktree(taskId));
  }
  #held():void{if(!this.options.manager||!this.options.workspaceLock||!this.options.manager.verifyWorkspaceLock(this.options.workspaceLock)||this.options.workspaceLock.record.workspaceHash!==this.options.manager.workspaceIdentity(this.repoRoot).workspaceHash)promotionError('PROMOTION_LOCK_REQUIRED')}
  prepareTerminalRestoration(taskId:string):TrustedConfirmationRequest{
    this.#assertActive();this.#held();if(this.#preparing||this.#pending().length)promotionError('PROMOTION_NOT_QUIESCENT');
    if(!this.terminalRestorationRequired(taskId))promotionError('PROMOTION_RESTORATION_NOT_REQUIRED');
    const task=this.#terminalTask(taskId),candidate=task.ledger.state.candidate!,checkpoint=verifyCandidateCheckpoint(this.repoRoot,task.root,this.store.agentDataRoot),binding=this.binding(taskId),handoff=readProjectHandoff(this.repoRoot);
    if(!handoff||handoff.ownerDisposition!=='RELEASED_FOR_TRANSFER'||!handoff.taskHeads.some(h=>h.taskId===taskId&&h.stateDigest===hashCanonical(task.ledger.state)&&h.specHash===task.spec.specHash&&h.eventHash===task.ledger.events.at(-1)!.eventHash))promotionError('PROMOTION_TRANSFER_NOT_RELEASED');
    if(!binding?.candidateCommit||binding.completedSpecHash!==task.spec.specHash||binding.candidateDigest!==candidate.digest||binding.candidateGeneration!==candidate.generation||checkpoint.candidateRef!==binding.candidateRef)promotionError('PROMOTION_CANDIDATE_BINDING');
    this.#verifyCandidate(binding);if(this.status(taskId).baselineReady)promotionError('PROMOTION_RESTORATION_NOT_REQUIRED');
    const workRoot=this.#work(`restored-terminal-${taskId}-${randomUUID()}`),data={taskId,stateDigest:hashCanonical(task.ledger.state),handoffDigest:handoff.descriptorDigest,candidateRef:binding.candidateRef,candidateCommit:binding.candidateCommit,descriptorDigest:checkpoint.descriptorDigest,workRoot};
    const q=createTrustedConfirmationRequest({purpose:'candidate-promotion',subjectKind:'CandidateRestoration',subjectId:taskId,subjectRevision:task.ledger.state.revision,action:'APPROVE',payload:{...data,projectId:this.projectId,repoRoot:this.repoRoot,specHash:task.spec.specHash,candidateDigest:candidate.digest},
      presentation:{title:"Resume integration in the current folder?",content:`Completed task: ${task.spec.title}\nCurrent project: ${this.repoRoot}\nFolder recorded in the history: ${task.spec.scope.repoRoot}\nThe verified copy will be restored to: ${workRoot}\n\nCompletion and previously consumed attempts remain unchanged. This confirmation only restores the local copy. New checks, a new review and your approval will be required before integration into the project.`}});
    this.#terminalRequests.set(q,data);return q;
  }
  restoreTerminalCandidate(q:TrustedConfirmationRequest,receipt:TrustedConfirmationReceipt):{readonly workRoot:string;readonly receiptRef:ArtifactRef;readonly locationRef:ArtifactRef}{return this.#write(()=>{
    const prepared=this.#terminalRequests.get(q);if(!prepared||this.#preparing||this.#pending().length)promotionError('PROMOTION_RESTORATION_REQUEST_INVALID');
    const check=()=>{this.#held();const task=this.#terminalTask(prepared.taskId),handoff=readProjectHandoff(this.repoRoot),checkpoint=verifyCandidateCheckpoint(this.repoRoot,task.root,this.store.agentDataRoot),binding=this.binding(prepared.taskId);
      if(hashCanonical(task.ledger.state)!==prepared.stateDigest||handoff?.descriptorDigest!==prepared.handoffDigest||handoff.ownerDisposition!=='RELEASED_FOR_TRANSFER'||checkpoint.descriptorDigest!==prepared.descriptorDigest||binding?.candidateRef!==prepared.candidateRef||binding?.candidateCommit!==prepared.candidateCommit||this.git.refHead(prepared.candidateRef)!==prepared.candidateCommit)promotionError('PROMOTION_RESTORATION_STALE');return {task,checkpoint};};
    const current=check(),staged=new Map<string,{ref:ArtifactRef;content:string}>();
    const stagedRef=consumeTrustedConfirmation(receipt,()=>{check();return q},{put(id,content,mediaType){const ref:ArtifactRef={schemaVersion:1,id,relativeStorePath:`artifacts/${id}`,mediaType,digest:hashBytes(Buffer.from(content,'utf8')),bytes:Buffer.byteLength(content,'utf8')};staged.set(id,{ref,content});return ref},read(ref){const saved=staged.get(ref.id);if(!saved||!same(saved.ref,ref))promotionError('PROMOTION_RESTORATION_STALE');return Buffer.from(saved.content,'utf8')}});
    // Exact-state/lease CAS immediately before the durable write. The shared
    // primitive already consumed the genuine native receipt, never a JSON copy.
    check();const saved=staged.get(stagedRef.id)!;
    const receiptRef=this.store.put(stagedRef.id,saved.content,stagedRef.mediaType);if(!same(receiptRef,stagedRef))promotionError('PROMOTION_RESTORATION_STALE');
    readTrustedConfirmationEvidence(this.store,receiptRef,q);this.#held();if(hashCanonical(DurableStore.load(current.task.root).state)!==prepared.stateDigest)promotionError('PROMOTION_RESTORATION_STALE');this.#terminalRequests.delete(q);
    // Ref head is read from the genuine frozen binding. Restore remains detached;
    // no historical branch, task state or approval is changed here.
    this.git.restoreCandidateSnapshot(current.checkpoint.snapshotRoot,prepared.workRoot,prepared.candidateRef,current.checkpoint.manifest,prepared.candidateCommit);
    const locationRef=this.store.put(`terminal-location-${randomUUID()}`,canonicalize({schemaVersion:1,taskId:prepared.taskId,projectId:this.projectId,specHash:current.task.spec.specHash,stateDigest:prepared.stateDigest,descriptorDigest:prepared.descriptorDigest,repoRoot:this.repoRoot,workRoot:prepared.workRoot,historicalWorkRoot:current.task.ledger.state.candidate!.root,receiptRef}),'application/vnd.pi-controlled-dev.terminal-candidate-location+json');
    this.#terminalLocations.set(prepared.taskId,{stateDigest:prepared.stateDigest,workRoot:prepared.workRoot,receiptRef,locationRef});this.#assertTerminalLocation(prepared.taskId,current.task);
    return Object.freeze({workRoot:prepared.workRoot,receiptRef,locationRef});
  })}
  /** Persisted locations are consultation data. Only the private live map can be current. */
  terminalRestorationHistory(taskId:string):readonly {readonly workRoot:string;readonly historicalWorkRoot:string;readonly repoRoot:string;readonly confirmationRef:ArtifactRef;readonly locationRef:ArtifactRef;readonly current:boolean}[]{
    if(!validateScalar('ID',taskId).ok)promotionError('PROMOTION_TASK_INVALID');const folder=join(this.store.root,'artifacts'),result=[];
    for(const id of readdirSync(folder).filter(id=>/^terminal-location-[a-f0-9-]{36}$/.test(id)).sort()){
      const path=join(folder,id),stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>65536||realpathSync(path)!==path)promotionError('PROMOTION_RESTORATION_STALE');
      const raw=readFileSync(path),value=parseJson(raw,65536) as any;
      if(!value||Object.keys(value).sort().join(',')!=='descriptorDigest,historicalWorkRoot,projectId,receiptRef,repoRoot,schemaVersion,specHash,stateDigest,taskId,workRoot'||value.schemaVersion!==1||value.projectId!==this.projectId||canonicalize(value)!==raw.toString('utf8'))promotionError('PROMOTION_RESTORATION_STALE');
      if(value.taskId!==taskId)continue;
      const evidence=parseJson(this.store.read(value.receiptRef),135168) as any,checked=readTrustedConfirmationEvidence(this.store,value.receiptRef,evidence.request),q=checked.request,p=q.payload as any;
      if(q.purpose!=='candidate-promotion'||q.subjectKind!=='CandidateRestoration'||q.subjectId!==taskId||q.action!=='APPROVE'||p.specHash!==value.specHash||p.projectId!==value.projectId||p.stateDigest!==value.stateDigest||p.descriptorDigest!==value.descriptorDigest||p.repoRoot!==value.repoRoot||p.workRoot!==value.workRoot)promotionError('PROMOTION_RESTORATION_STALE');
      const local=this.#terminalLocations.get(taskId),current=!this.#retired&&!!local&&local.workRoot===value.workRoot&&local.locationRef.id===id&&!!this.options.manager&&!!this.options.workspaceLock&&this.options.manager.verifyWorkspaceLock(this.options.workspaceLock);
      result.push(Object.freeze({workRoot:value.workRoot,historicalWorkRoot:value.historicalWorkRoot,repoRoot:value.repoRoot,confirmationRef:value.receiptRef,locationRef:{schemaVersion:1 as const,id,relativeStorePath:`artifacts/${id}`,mediaType:'application/vnd.pi-controlled-dev.terminal-candidate-location+json',digest:hashBytes(raw),bytes:raw.byteLength},current}));
    }return Object.freeze(result);
  }
  #assertTerminalLocation(taskId:string,task:{ledger:StoredLedger;spec:TaskSpec;root:string}):void{
    this.#assertActive();this.#held();const local=this.#terminalLocations.get(taskId);if(!local||local.stateDigest!==hashCanonical(task.ledger.state)||hashCanonical(workspaceManifest(local.workRoot,task.ledger.state.candidate!.baseCommit))!==task.ledger.state.candidate!.digest)promotionError('PROMOTION_RESTORATION_STALE');
    this.store.read(local.receiptRef);this.store.read(local.locationRef);
  }
  #task(taskId:string):{ledger:StoredLedger;spec:TaskSpec;root:string}{
    if(!validateScalar('ID',taskId).ok)promotionError('PROMOTION_TASK_INVALID');const root=join(this.projectRoot,'tasks',taskId),ledger=DurableStore.load(root);
    if(ledger.truncatedTailBytes||ledger.state.taskId!==taskId||ledger.state.state!=='COMPLETED'||!ledger.state.candidate)promotionError('PROMOTION_TASK_NOT_COMPLETED');
    const r=ledger.records.find(r=>r.kind==='TaskSpec'&&r.id===ledger.state.spec.id);if(r?.kind!=='TaskSpec')promotionError('PROMOTION_SPEC_INVALID');const task={ledger,spec:r.value,root};if(ledger.state.repoRoot!==this.repoRoot||ledger.state.candidate.root!==this.worktree(taskId))this.#assertTerminalLocation(taskId,task);return task;
  }
  #taskArtifact(task:{ledger:StoredLedger;root:string},ref:ArtifactRef):any{
    if(!task.ledger.records.some(r=>r.kind==='ArtifactRef'&&same(r.value,ref))||!validateStructure('ArtifactRef',ref).ok||ref.relativeStorePath!==`artifacts/${ref.id}`)promotionError('PROMOTION_TASK_ARTIFACT');
    const path=join(task.root,ref.relativeStorePath),stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||realpathSync(path)!==path)promotionError('PROMOTION_TASK_ARTIFACT');
    const raw=readFileSync(path);if(hashBytes(raw)!==ref.digest||raw.byteLength!==ref.bytes)promotionError('PROMOTION_TASK_ARTIFACT');return parseJson(raw,64*1024*1024);
  }
  freeze(taskId:string):CandidateGitBinding{return this.#write(()=>{
    if(this.#pending().length)promotionError('PROMOTION_RECOVERY_REQUIRED');const b=this.binding(taskId);if(!b)promotionError('LEGACY_CANDIDATE_NOT_AUTOPROMOTABLE');
    const task=this.#task(taskId),candidate=task.ledger.state.candidate!,manifest=this.#taskArtifact(task,candidate.manifest) as CandidateManifest;
    if(!task.ledger.records.some(r=>r.kind==='TaskSpec'&&r.value.specHash===b.specHash)||candidate.baseCommit!==b.baseCommit||candidate.root!==this.worktree(taskId)&&!this.#terminalLocations.has(taskId)||!validateStructure('CandidateManifest',manifest).ok||hashCanonical(manifest)!==candidate.digest)promotionError('PROMOTION_CANDIDATE_BINDING');
    if(b.candidateCommit){if(b.completedSpecHash!==task.spec.specHash||b.candidateDigest!==candidate.digest||b.candidateGeneration!==candidate.generation)promotionError('PROMOTION_CANDIDATE_BINDING');this.git.bindCandidate(b.candidateRef,b.candidateCommit,b.baseCommit);this.#verifyCandidate(b);return b}
    const commit=this.git.candidateCommit(candidate.root,b.candidateRef,b.baseCommit,manifest,`controlled-dev: complete ${taskId} ${task.spec.title.slice(0,120)}`),changes=this.git.changed(commit,b.baseCommit);
    if(changes.some(c=>!task.spec.scope.allowedPaths.includes(c.path)||task.spec.scope.deniedPaths.includes(c.path)))promotionError('PROMOTION_CANDIDATE_SCOPE');
    if(hashCanonical(this.git.manifestAt(commit,b.baseCommit,this.#work(`freeze-${randomUUID()}`)))!==candidate.digest)promotionError('PROMOTION_COMMIT_DIGEST_MISMATCH');
    const next=validateGitBinding({...b,candidateCommit:commit,candidateDigest:candidate.digest,candidateGeneration:candidate.generation,completedSpecHash:task.spec.specHash});
    this.#publish('bindings',next,`git-binding-${taskId}-frozen`);this.options.fault?.('afterCandidateBinding');this.git.bindCandidate(b.candidateRef,commit,b.baseCommit);return next;
  })}
  #verifyCandidate(b:CandidateGitBinding):void{
    if(!b.candidateCommit||!b.candidateDigest||this.git.refHead(b.candidateRef)!==b.candidateCommit||b.candidateCommit!==b.baseCommit&&!same(this.git.parents(b.candidateCommit),[b.baseCommit])
      ||hashCanonical(this.git.manifestAt(b.candidateCommit,b.baseCommit,this.#work(`candidate-proof-${randomUUID()}`)))!==b.candidateDigest)promotionError('PROMOTION_CANDIDATE_CHANGED');
  }
  status(taskId:string):{status:IntegrationStatus;baselineReady:boolean;binding?:CandidateGitBinding;proposal?:CandidatePromotionProposal;result?:CandidatePromotionResult;explanation:string}{
    const s=this.#snapshot(),b=s.bindings.findLast(b=>b.taskId===taskId),p=s.proposals.findLast(p=>p.taskId===taskId),r=s.results.findLast(r=>r.taskId===taskId);
    let status:IntegrationStatus='LEGACY_CANDIDATE_NOT_AUTOPROMOTABLE';
    // A verified freeze is the project artifact proving eligibility. Rendering an
    // in-progress binding must not replay the complete task ledger on every refresh.
    if(b&&!b.candidateCommit)status='NOT_READY';
    const freezePending=b?.candidateCommit&&this.git.refHead(b.candidateRef)===b.baseCommit&&b.candidateCommit!==b.baseCommit;
    if(b?.candidateCommit){if(!freezePending&&this.git.refHead(b.candidateRef)!==b.candidateCommit)promotionError('PROMOTION_CANDIDATE_CHANGED');
      status=freezePending?'STALE':b.candidateCommit===b.baseCommit?'NOT_REQUIRED':this.git.ancestor(b.candidateCommit,this.git.refHead(b.targetRef))?'INTEGRATED':
        p&&p.targetHead!==this.git.refHead(b.targetRef)?'STALE':s.observations.findLast(o=>o.taskId===taskId)?.code==='MERGE_CONFLICT'?'CONFLICT':'READY_FOR_INTEGRATION';
    }
    if(b&&(status==='INTEGRATED'||status==='NOT_REQUIRED'))try{this.git.assertTarget(b.targetRef)}catch{status='STALE'}
    const pending=s.intents.some(i=>i.taskId===taskId&&!s.results.some(r=>r.intentRef.id===s.index.intents[s.intents.indexOf(i)].id));
    if(pending)status='STALE';
    const explanation={NOT_READY:"The candidate still needs to be frozen after checks and completion. The project has not been changed.",LEGACY_CANDIDATE_NOT_AUTOPROMOTABLE:"Historical candidate: automatic integration is unavailable.",NOT_REQUIRED:"The task does not change the project: integration is not needed.",
      INTEGRATED:"The result is present in the target branch history.",READY_FOR_INTEGRATION:"Verified result, ready to integrate into the project with your authorization.",
      CONFLICT:"The integration attempt found a conflict. The project has not been changed.",STALE:"The target has advanced: a new integration must be prepared and approved."}[status];
    return {status,baselineReady:status==='NOT_REQUIRED'||status==='INTEGRATED',...(b?{binding:b}:{}),...(p?{proposal:p}:{}),...(r?{result:r}:{}),explanation:freezePending?"The verified result is preserved: open Integrate into project to finish freezing the candidate.":pending?"An already authorized integration needs to be completed or reconciled. Open Integrate into project.":explanation};
  }
  #observe(taskId:string,head:string,code:PromotionObservation['code'],evidenceRefs:readonly ArtifactRef[]=[]){const value=validatePromotionObservation({schemaVersion:1,observationId:`observation-${randomUUID()}`,projectId:this.projectId,taskId,targetHead:head,code,evidenceRefs,createdAt:this.#now()});this.#publish('observations',value,value.observationId)}
  #verifyProposalEvidence(p:CandidatePromotionProposal):void{
    for(const ref of p.validationRefs){const v=this.#read(ref);if(v.schemaVersion!==1||v.taskId!==p.taskId||v.specHash!==p.specHash||v.integrationCommit!==p.integrationCommit||v.integrationDigest!==p.integrationDigest||v.status!=='PASS'||v.postDigest!==p.integrationDigest||v.exitCode!==0||v.signal!==null||v.error!==null||!validateScalar('ID',v.commandId).ok||!validateScalar('Hash',v.commandHash).ok)promotionError('PROMOTION_VALIDATION_INVALID');this.store.read(v.logRef)}
    const review=this.#read(p.reviewRef);if(review.taskId!==p.taskId||review.integrationCommit!==p.integrationCommit||review.integrationDigest!==p.integrationDigest||review.verdict!=='PASS'||!['COMPLETED_TASK_REVIEW','controlled.reviewer'].includes(review.source))promotionError('PROMOTION_REVIEW_INVALID');
  }
  async prepare(taskId:string,reviewer?:ControlledReviewerRunner):Promise<CandidatePromotionProposal|undefined>{
    this.#assertActive();if(this.#preparing)promotionError('PROMOTION_NOT_QUIESCENT');this.#preparing=true;
    try{
    // withLease callers hold this lease throughout the async review. Direct callers must also
    // borrow a live existing lease; this prevents a review from releasing mutation serialization.
    if(!this.options.manager||!this.options.workspaceLock||!this.options.manager.verifyWorkspaceLock(this.options.workspaceLock))promotionError('PROMOTION_LOCK_REQUIRED');
    if(this.#pending().length)promotionError('PROMOTION_RECOVERY_REQUIRED');const b=this.freeze(taskId),view=this.status(taskId);if(view.baselineReady)return;
    this.#verifyCandidate(b);const head=this.git.head();this.git.assertTarget(b.targetRef,head);
    const {ledger,spec}=this.#task(taskId),root=this.#work(`integration-${randomUUID()}`);let commit:string;
    try{commit=this.git.prepareMerge(root,head,b.candidateCommit!,`controlled-dev: integrate ${taskId} ${spec.title.slice(0,120)}`)}catch(error){if((error as {code?:string}).code==='MERGE_CONFLICT')this.#observe(taskId,head,'MERGE_CONFLICT');throw error}
    const digest=hashCanonical(workspaceManifest(root,commit)),tree=this.git.tree(commit),refs:ArtifactRef[]=[];this.options.fault?.('afterIntegrationPreparation');
    const original=hashCanonical(trackedWorkspaceManifest(this.repoRoot,head));
    for(const command of spec.validationCommands){
      const run=executeApprovedCommand(spec,command.id,root),logRef=this.store.put(`integration-log-${randomUUID()}`,canonicalize({stdout:redactRuntimeText(run.child.stdout??'').text,stderr:redactRuntimeText(run.child.stderr??'').text}));
      const postDigest=hashCanonical(workspaceManifest(root,commit)),pass=run.child.status===0&&run.child.signal===null&&!run.child.error&&postDigest===digest&&this.git.head(root)===commit
        &&this.git.head()===head&&hashCanonical(trackedWorkspaceManifest(this.repoRoot,head))===original;
      const evidence={schemaVersion:1,taskId,specHash:spec.specHash,commandId:command.id,commandHash:hashCanonical(command),integrationCommit:commit,integrationDigest:digest,
        status:pass?'PASS':'FAIL',exitCode:run.child.status,signal:run.child.signal,error:run.child.error?.code??null,pid:run.child.pid,startedAt:run.startedAt,endedAt:run.endedAt,postDigest,logRef};
      refs.push(this.#put(`integration-validation-${randomUUID()}`,evidence));
      if(!pass){this.#observe(taskId,head,'INTEGRATION_VALIDATION_FAILED',refs);promotionError('INTEGRATION_VALIDATION_FAILED')}
    }
    let review:unknown;
    if(head===b.baseCommit&&tree===this.git.tree(b.candidateCommit!)&&!this.#terminalLocations.has(taskId))review={schemaVersion:1,source:'COMPLETED_TASK_REVIEW',taskId,integrationCommit:commit,integrationDigest:digest,verdict:'PASS',completionDigest:hashCanonical(ledger.state)};
    else{
      if(!reviewer)promotionError('INTEGRATION_REVIEW_REQUIRED');
      const packet={taskId,integrationCommit:commit,integrationDigest:digest,targetHead:head,taskBaseCommit:b.baseCommit,candidateCommit:b.candidateCommit,criteria:spec.acceptanceCriteria,
        requirements:spec.requirements,changedFiles:this.git.changed(commit,head),validationEvidence:refs.map(r=>this.#read(r))};
      const reviewed=await reviewer.reviewIntegration(this.repoRoot,root,packet);
      review={...reviewed,taskId,integrationCommit:commit,integrationDigest:digest,verdict:reviewed.result.verdict};
    }
    const reviewRef=this.#put(`integration-review-${randomUUID()}`,review);
    if((review as {verdict:string}).verdict!=='PASS'){this.#observe(taskId,head,'INTEGRATION_REVIEW_FAILED',[...refs,reviewRef]);promotionError('INTEGRATION_REVIEW_FAILED')}
    this.git.assertTarget(b.targetRef,head);if(this.git.head(root)!==commit||hashCanonical(workspaceManifest(root,commit))!==digest)promotionError('GIT_INTEGRATION_TREE_CHANGED');
    const proposal=validatePromotionProposal({schemaVersion:1,proposalId:`promotion-${randomUUID()}`,projectId:this.projectId,taskId,specHash:spec.specHash,title:spec.title,
      targetRef:b.targetRef,targetHead:head,taskBaseCommit:b.baseCommit,candidateRef:b.candidateRef,candidateCommit:b.candidateCommit,candidateDigest:b.candidateDigest,
      integrationCommit:commit,integrationTree:tree,integrationDigest:digest,validationRefs:refs,reviewRef,changedFiles:this.git.changed(commit,head),createdAt:this.#now()});
    this.#publish('proposals',proposal,proposal.proposalId);return proposal;
    }finally{this.#preparing=false}
  }
  prepareDecision(proposalId:string,action:'APPROVE'|'REJECT'):TrustedConfirmationRequest{
    this.#assertActive();
    const s=this.#snapshot(),p=s.proposals.find(p=>p.proposalId===proposalId);if(!p||s.proposals.findLast(q=>q.taskId===p.taskId)!==p||this.#pending().length)promotionError('PROMOTION_PROPOSAL_STALE');
    this.git.assertTarget(p.targetRef,p.targetHead);this.#exact(p);const ref=s.index.proposals[s.proposals.indexOf(p)];
    const q=createTrustedConfirmationRequest({purpose:'candidate-promotion',subjectKind:'CandidatePromotion',subjectId:p.proposalId,subjectRevision:1,action,
      payload:{proposalRef:ref,proposal:p},presentation:{title:action==='APPROVE'?"Integrate this task into the project?":"Reject this integration?",content:promotionNarrative(p)}});
    this.#approvals.set(q,{proposal:p,ref});return q;
  }
  #exact(p:CandidatePromotionProposal):void{
    const b=this.binding(p.taskId)!;this.#verifyCandidate(b);if(this.#task(p.taskId).spec.specHash!==p.specHash)promotionError('PROMOTION_SPEC_CHANGED');this.#verifyProposalEvidence(p);
    if(this.git.tree(p.integrationCommit)!==p.integrationTree||!same(this.git.parents(p.integrationCommit),[p.targetHead,p.candidateCommit])||!same(this.git.changed(p.integrationCommit,p.targetHead),p.changedFiles)
      ||hashCanonical(this.git.manifestAt(p.integrationCommit,p.integrationCommit,this.#work(`integration-proof-${randomUUID()}`)))!==p.integrationDigest)promotionError('PROMOTION_INTEGRATION_CHANGED');
  }
  #approval(i:CandidatePromotionIntent,p:CandidatePromotionProposal):void{
    if(i.authorizationKind==='PolicyDerivedAuthorization'){if(i.schemaVersion!==2||i.approvalRef.mediaType!==POLICY_AUTHORIZATION_MEDIA)promotionError('PROMOTION_APPROVAL_INVALID');
      readPolicyAuthorization(this.store,i.approvalRef,'candidate-promotion',{proposalRef:i.proposalRef,proposal:p});return;}
    if(i.schemaVersion!==1||i.authorizationKind!==undefined)promotionError('PROMOTION_APPROVAL_INVALID');
    const raw=parseJson(this.store.read(i.approvalRef),135168) as any,evidence=readTrustedConfirmationEvidence(this.store,i.approvalRef,raw.request),q=evidence.request;
    if(q.purpose!=='candidate-promotion'||q.subjectKind!=='CandidatePromotion'||q.subjectId!==p.proposalId||q.subjectRevision!==1||q.action!=='APPROVE'
      ||!same(q.payload,{proposalRef:i.proposalRef,proposal:p}))promotionError('PROMOTION_APPROVAL_INVALID');
  }
  applyPolicyAuthorization(capability:PolicyAuthorizationCapability):CandidatePromotionResult{return this.#write(()=>{
    const subject=capability.authorization.subject as any,s=this.#snapshot(),p=s.proposals.find(v=>v.proposalId===subject.proposal?.proposalId);
    if(!p||!same(p,subject.proposal)||this.#pending().length||s.proposals.findLast(x=>x.taskId===p.taskId)?.proposalId!==p.proposalId)promotionError('PROMOTION_PROPOSAL_STALE');
    const proposalRef=s.index.proposals[s.proposals.indexOf(p)];if(!same(proposalRef,subject.proposalRef))promotionError('PROMOTION_APPROVAL_INVALID');
    this.git.assertTarget(p.targetRef,p.targetHead);this.#exact(p);
    const approvalRef=consumePolicyCapability(capability,'candidate-promotion',{proposalRef,proposal:p},this.store);
    const intent=validatePromotionIntent({schemaVersion:2,authorizationKind:'PolicyDerivedAuthorization',intentId:`intent-${randomUUID()}`,projectId:this.projectId,taskId:p.taskId,proposalRef,approvalRef,createdAt:this.#now()});
    const ref=this.#publish('intents',intent,intent.intentId);this.options.fault?.('afterPromotionIntent');return this.#apply(intent,ref,p,false);
  })}
  pendingPolicyAction():Readonly<{proposalRef:ArtifactRef;proposal:CandidatePromotionProposal}>|undefined{const s=this.#snapshot(),pending=this.#pending();if(!pending.length)return;if(pending.length!==1||pending[0].authorizationKind!=='PolicyDerivedAuthorization')promotionError('PROMOTION_RECOVERY_REQUIRED');const i=pending[0],p=s.proposals[s.index.proposals.findIndex(ref=>same(ref,i.proposalRef))];return {proposalRef:i.proposalRef,proposal:p};}
  resumePolicyAction(capability:PolicyAuthorizationCapability):CandidatePromotionResult{return this.#write(()=>{const s=this.#snapshot(),pending=this.#pending();if(pending.length!==1)promotionError('PROMOTION_RECOVERY_REQUIRED');const i=pending[0],n=s.intents.findIndex(v=>v.intentId===i.intentId),p=s.proposals[s.index.proposals.findIndex(ref=>same(ref,i.proposalRef))];if(i.authorizationKind!=='PolicyDerivedAuthorization')promotionError('PROMOTION_APPROVAL_INVALID');this.git.assertTarget(p.targetRef,p.targetHead);this.#exact(p);consumePolicyCapability(capability,'candidate-promotion',{proposalRef:i.proposalRef,proposal:p},this.store);return this.#apply(i,s.index.intents[n],p,false);})}
  applyDecision(q:TrustedConfirmationRequest,receipt:TrustedConfirmationReceipt):CandidatePromotionResult|undefined{return this.#write(()=>{
    const held=this.#approvals.get(q);if(!held)promotionError('PROMOTION_APPROVAL_INVALID');this.#approvals.delete(q);const p=held.proposal;
    const fresh=()=>{const s=this.#snapshot();if(this.#pending().length||s.proposals.findLast(x=>x.taskId===p.taskId)?.proposalId!==p.proposalId)promotionError('PROMOTION_PROPOSAL_STALE');
      this.git.assertTarget(p.targetRef,p.targetHead);this.#exact(p);return q};
    const approvalRef=consumeTrustedConfirmation(receipt,fresh,this.store);this.options.fault?.('afterHumanApproval');
    if(q.action==='REJECT'){this.#observe(p.taskId,p.targetHead,'REJECTED',[approvalRef]);return}
    if(q.action!=='APPROVE')promotionError('PROMOTION_APPROVAL_INVALID');
    const intent=validatePromotionIntent({schemaVersion:1,intentId:`intent-${randomUUID()}`,projectId:this.projectId,taskId:p.taskId,proposalRef:held.ref,approvalRef,createdAt:this.#now()});
    const ref=this.#publish('intents',intent,intent.intentId);this.options.fault?.('afterPromotionIntent');return this.#apply(intent,ref,p,false);
  })}
  #apply(i:CandidatePromotionIntent,ref:ArtifactRef,p:CandidatePromotionProposal,recovery:boolean):CandidatePromotionResult{
    this.#approval(i,p);this.#exact(p);if(recovery&&i.authorizationKind==='PolicyDerivedAuthorization'&&this.git.head()!==p.integrationCommit)promotionError('POLICY_RECOVERY_REAUTHORIZATION_REQUIRED');if(!recovery)this.git.assertTarget(p.targetRef,p.targetHead);
    this.git.apply(p.targetRef,p.targetHead,p.integrationCommit,i.intentId,this.options.fault,recovery);this.options.fault?.('beforePromotionResult');
    this.git.assertTarget(p.targetRef,p.integrationCommit);
    const result=validatePromotionResult({schemaVersion:1,resultId:`result-${i.intentId}`,projectId:this.projectId,taskId:i.taskId,intentRef:ref,targetRef:p.targetRef,
      previousHead:p.targetHead,resultingHead:this.git.head(),integrationCommit:p.integrationCommit,completedAt:this.#now()});
    this.#publish('results',result,result.resultId);return result;
  }
  recover():readonly CandidatePromotionResult[]{return this.#write(()=>{
    const s=this.#snapshot(),out:CandidatePromotionResult[]=[];for(const [n,i] of s.intents.entries()){
      const ref=s.index.intents[n];if(s.results.some(r=>r.intentRef.id===ref.id))continue;
      const p=s.proposals[s.index.proposals.findIndex(r=>same(r,i.proposalRef))];out.push(this.#apply(i,ref,p,true));
    }return out;
  })}
  resultEvidence(taskId:string):{ref:ArtifactRef;result:CandidatePromotionResult}{const s=this.#snapshot(),n=s.results.findLastIndex(r=>r.taskId===taskId);if(n<0)promotionError('PROMOTION_RESULT_UNVERIFIED');return {ref:s.index.results[n],result:s.results[n]};}
  results():readonly CandidatePromotionResult[]{return this.#snapshot().results}
  observations():readonly PromotionObservation[]{return this.#snapshot().observations}
}
