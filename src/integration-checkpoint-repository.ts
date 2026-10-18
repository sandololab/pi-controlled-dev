import { consumePolicyCapability, readPolicyAuthorization, POLICY_AUTHORIZATION_MEDIA } from './policy-authorization.js';
import type { PolicyAuthorizationCapability } from './policy-authorization.js';
import { projectIdentity } from './project-identity.js';
import { verifyTerminalProof } from './pi-subagents-rpc.js';
import { IntegrationPrimaryCanary } from './integration-primary-canary.js';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { canonicalize, hashCanonical, hashBytes, parseJson, validateStructure, validateScalar } from './contracts.js';
import type { ArtifactRef, TaskSpec, Criterion, ValidationResult } from './contracts.js';
import { DurableStore } from './store.js';
import type { ArtifactInspection } from './store.js';
import { LockManager, withLockMutation } from './lock-manager.js';
import type { LockRecord } from './lock-manager.js';
import { inspectProcessOwner } from './process-incarnation.js';
import { CandidateGit } from './candidate-git.js';
import { CandidatePromotionRepository } from './candidate-promotion-repository.js';
import { ProjectPlanningRepository } from './project-planning-repository.js';
import { workspaceManifest, trackedWorkspaceManifest } from './scope-guard.js';
import { collectValidationEvidence } from './validation-runner.js';
import type { ExecutableScenario } from './scenario-management.js';
import type { ControlledReviewerRunner } from './controlled-reviewer.js';
import { selectProjectMemory, prepareMemoryContext } from './project-memory-context.js';
import type { ProjectMemoryRepository } from './project-memory-repository.js';
import type { TaskWizardDraft } from './pre-task-proposal.js';
import { createTrustedConfirmationRequest, presentTrustedConfirmation, consumeTrustedConfirmation, readTrustedConfirmationEvidence } from './trusted-confirmation.js';
import type { HumanConfirmationChannel, TrustedConfirmationRequest, TrustedConfirmationReceipt } from './trusted-confirmation.js';
import { CHECKPOINT_MEDIA, checkpointCommands, checkpointError, definitionDigest, validateDefinition, validateBaseline, checkpointNarrative } from './integration-checkpoint.js';
import type { IntegrationCheckpointDefinition, IntegrationCheckpointRun, IntegrationBaselineReference, CheckpointCoverage, CheckpointPlanReference } from './integration-checkpoint.js';

interface CheckpointIndex {schemaVersion:1;projectId:string;revision:number;definitions:ArtifactRef[];approvals:ArtifactRef[];runs:ArtifactRef[]}
export interface CheckpointOptions {create?:boolean;memory?:ProjectMemoryRepository;fault?:(point:string)=>void}
export interface CheckpointProposal {title:string;purpose:string;controlledTaskRefs:readonly string[];plannedTaskRefs?:readonly CheckpointPlanReference[];
  validationIntent:readonly string[];validationPlan:TaskWizardDraft['validationPlan'];scenarios?:readonly ExecutableScenario[];
  relevantMemoryRefs?:IntegrationCheckpointDefinition['relevantMemoryRefs'];reviewRequired?:boolean}
const same=(a:unknown,b:unknown)=>canonicalize(a)===canonicalize(b);
const now=()=>new Date().toISOString();
/** Optional project documents in DurableStore. Brief index locks never span commands or review.
 * The per-definition/commit task lease prevents duplicate work without locking the target branch.
 * Every partial stage is durable; recovery may block it but cannot infer a successful verdict. */
export class IntegrationCheckpointRepository {
  readonly projectId:string;readonly projectRoot:string;readonly git:CandidateGit;
  readonly #approvals=new WeakMap<object,{definition:IntegrationCheckpointDefinition;ref:ArtifactRef;base:ArtifactRef|undefined;baseline:IntegrationBaselineReference}>();
  private constructor(readonly store:DurableStore,readonly repoRoot:string,readonly options:CheckpointOptions){
    this.projectId=projectIdentity(repoRoot);this.projectRoot=dirname(store.root);this.git=new CandidateGit(repoRoot,store.agentDataRoot);this.#snapshot();
  }
  static open(data:string,repo:string,inspect:ArtifactInspection,options:CheckpointOptions={}):IntegrationCheckpointRepository|undefined {
    const open=()=>{const store=DurableStore.project(data,repo,'integration',inspect,!!options.create);return store?new IntegrationCheckpointRepository(store,repo,options):undefined};
    if(!options.create)return open();const m=new LockManager(data,`integration-checkpoint-${randomUUID()}`,`checkpoint-${randomUUID()}`);
    return withLockMutation(m.root,m.workspaceIdentity(repo).workspaceHash,()=>open());
  }
  #write<T>(action:()=>T):T {
    const m=new LockManager(this.store.agentDataRoot,`integration-checkpoint-${randomUUID()}`,`checkpoint-${randomUUID()}`);
    // This guard covers only the integration namespace's index/CAS, never project files.
    // A promotion may hold its source lease while these disjoint artifact writes proceed.
    return withLockMutation(m.root,m.workspaceIdentity(this.repoRoot).workspaceHash,()=>action());
  }
  #put(id:string,value:unknown,media=CHECKPOINT_MEDIA){return this.store.put(id,canonicalize(value),media)}
  read(ref:ArtifactRef):any {const v=parseJson(this.store.read(ref),2*1024*1024);if(hashCanonical(v)!==ref.digest)checkpointError('CHECKPOINT_ARTIFACT_INVALID');return v}
  #commit(base:ArtifactRef|undefined,index:CheckpointIndex){const value={...index,revision:index.revision+1};
    if(canonicalize(value).length>2*1024*1024)checkpointError('CHECKPOINT_RECORD_LIMIT');this.store.replaceProjectIndex(base,this.#put(`checkpoint-index-${hashCanonical(value)}`,value))}
  #snapshot(){
    const ref=this.store.readProjectIndex(),index:CheckpointIndex=ref?this.read(ref):{schemaVersion:1,projectId:this.projectId,revision:0,definitions:[],approvals:[],runs:[]};
    if(Object.keys(index).sort().join(',')!=='approvals,definitions,projectId,revision,runs,schemaVersion'||index.schemaVersion!==1||index.projectId!==this.projectId
      ||!Number.isSafeInteger(index.revision)||index.revision<0)checkpointError('CHECKPOINT_INDEX_INVALID');
    for(const refs of [index.definitions,index.approvals,index.runs])if(!Array.isArray(refs)||refs.length>4096||new Set(refs.map(r=>r.id)).size!==refs.length
      ||refs.some(r=>!validateStructure('ArtifactRef',r).ok))checkpointError('CHECKPOINT_INDEX_INVALID');
    const definitions=index.definitions.map(r=>validateDefinition(this.read(r))),approved=new Set<string>();
    for(const [n,d] of definitions.entries()){
      const previous=definitions.slice(0,n).filter(p=>p.checkpointId===d.checkpointId).at(-1);
      if(d.projectId!==this.projectId||d.status!=='DRAFT'||index.definitions[n].id!==`${d.checkpointId}-r${d.revision}`||d.revision!==(previous?.revision??0)+1)checkpointError('CHECKPOINT_DEFINITION_IDENTITY');
    }
    for(const a of index.approvals){
      const raw=this.read(a),derived=a.mediaType===POLICY_AUTHORIZATION_MEDIA,authorization=derived?readPolicyAuthorization(this.store,a,'integration-checkpoint'):undefined,verified=derived?undefined:readTrustedConfirmationEvidence(this.store,a,raw.request),payload=(authorization?.subject??verified!.request.payload) as any;
      const n=index.definitions.findIndex(r=>same(r,payload.definitionRef)),d=definitions[n];
      if(!d||(!derived&&(verified!.request.purpose!=='integration-checkpoint'||verified!.request.subjectId!==d.checkpointId||verified!.request.subjectRevision!==d.revision||verified!.receipt.decision!=='APPROVE'))||!same(payload.definition,d)||approved.has(index.definitions[n].id))checkpointError('CHECKPOINT_APPROVAL_INVALID');
      validateBaseline(payload.baseline);if(payload.baseline.projectId!==this.projectId)checkpointError('CHECKPOINT_APPROVAL_INVALID');approved.add(index.definitions[n].id);
    }
    const projected=definitions.map((d,n)=>({...d,status:approved.has(index.definitions[n].id)?definitions.slice(n+1).some(x=>x.checkpointId===d.checkpointId&&approved.has(index.definitions[definitions.indexOf(x)].id))?'SUPERSEDED' as const:'APPROVED' as const:'DRAFT' as const}));
    const runs=index.runs.map(r=>this.#validateRun(this.read(r),index.definitions,definitions,approved));
    if(new Set(runs.map(r=>r.checkpointRunId)).size!==runs.length)checkpointError('CHECKPOINT_RUN_IDENTITY');
    return {ref,index,definitions:projected,runs};
  }
  #validateRun(v:any,refs:ArtifactRef[],definitions:IntegrationCheckpointDefinition[],approved:Set<string>):IntegrationCheckpointRun {
    const keys='baseline,checkpointDefinitionId,checkpointRunId,coverage,definitionDigest,definitionRef,definitionRevision,evidenceRefs,finishedAt,outcome,owner,phase,reason,reviewPacketRef,reviewRef,reviewerDispatchRef,reviewerTerminalRef,schemaVersion,startedAt';
    const d=definitions[refs.findIndex(r=>same(r,v.definitionRef))];
    if(Object.keys(v).sort().join(',')!==keys||v.schemaVersion!==1||!validateScalar('ID',v.checkpointRunId).ok||!d||!approved.has(v.definitionRef.id)
      ||v.checkpointDefinitionId!==d.checkpointId||v.definitionRevision!==d.revision||v.definitionDigest!==d.contentDigest
      ||!validateScalar('Time',v.startedAt).ok||!['CREATED','VALIDATIONS','SCENARIOS','REVIEW','FINISHED'].includes(v.phase)
      ||!['PASS','FAIL','BLOCKED',null].includes(v.outcome)||typeof v.reason!=='string')checkpointError('CHECKPOINT_RUN_INVALID');
    // Parentheses matter: the partial/terminal distinction must not weaken other checks.
    if((v.finishedAt===null)!==(v.outcome===null)||v.finishedAt!==null&&(!validateScalar('Time',v.finishedAt).ok||v.phase!=='FINISHED')
      ||!Array.isArray(v.coverage)||!Array.isArray(v.evidenceRefs)||v.evidenceRefs.length>512)checkpointError('CHECKPOINT_RUN_INVALID');
    validateBaseline(v.baseline);if(v.baseline.projectId!==this.projectId)checkpointError('CHECKPOINT_RUN_INVALID');
    for(const r of [...v.evidenceRefs,...[v.reviewPacketRef,v.reviewRef,v.reviewerDispatchRef,v.reviewerTerminalRef].filter(Boolean)]){if(!validateStructure('ArtifactRef',r).ok)checkpointError('CHECKPOINT_EVIDENCE_INVALID');this.store.read(r)}
    for(const c of v.coverage){if(Object.keys(c).sort().join(',')!=='completionRef,integrationCommit,integrationRequired,promotionResultRef,specHash,taskId'
      ||!d.controlledTaskRefs.includes(c.taskId)||!validateScalar('Hash',c.specHash).ok||!validateScalar('GitOID',c.integrationCommit).ok||typeof c.integrationRequired!=='boolean'
      ||!validateStructure('ArtifactRef',c.completionRef).ok||c.integrationRequired&&!c.promotionResultRef)checkpointError('CHECKPOINT_COVERAGE_INVALID');}
    if(new Set(v.coverage.map((c:CheckpointCoverage)=>c.taskId)).size!==v.coverage.length)checkpointError('CHECKPOINT_COVERAGE_INVALID');
    if(v.outcome==='PASS'){
      if(!same(v.coverage.map((c:CheckpointCoverage)=>c.taskId),d.controlledTaskRefs)||d.reviewRequired&&(!v.reviewRef||!v.reviewerTerminalRef))checkpointError('CHECKPOINT_PASS_EVIDENCE_MISSING');
      const validations=v.evidenceRefs.filter((r:ArtifactRef)=>r.mediaType===CHECKPOINT_MEDIA).map((r:ArtifactRef)=>this.read(r)).filter((e:any)=>e.kind==='checkpoint-validation');
      for(const e of validations){
        const intent=this.read(e.commandIntentRef);
        if(intent.kind!=='checkpoint-command-intent'||intent.checkpointRunId!==v.checkpointRunId||intent.commandHash!==e.commandHash||!same(intent.baseline,v.baseline))checkpointError('CHECKPOINT_VALIDATION_BINDING');
        if(!same(e.baseline,v.baseline)||e.checkpointRunId!==v.checkpointRunId||!same(e.definitionRef,v.definitionRef)||e.result.specHash!==d.contentDigest||e.result.commandHash!==e.commandHash
          ||e.result.candidateGeneration!==0||e.result.postCandidateDigest!==e.result.candidateDigest)checkpointError('CHECKPOINT_VALIDATION_BINDING');
        const proof=this.read(e.artifacts.find((r:ArtifactRef)=>r.id===e.result.processProofRef)),log=e.artifacts.find((r:ArtifactRef)=>r.id===e.result.logRef);
        const scenario=e.scenarioHash?d.scenarios.find(s=>s.scenarioHash===e.scenarioHash&&s.version===e.scenarioVersion):undefined;
        if(e.result.taskId!==(e.scenarioHash?scenario?.taskId:v.checkpointRunId)||proof.cwd!==this.worktree(v)||proof.candidateGeneration!==0
          ||proof.startedAt!==e.result.startedAt||proof.endedAt!==e.result.endedAt
          ||proof.source!=='node-spawnSync'||proof.commandHash!==e.commandHash||proof.specHash!==d.contentDigest||proof.taskId!==e.result.taskId
          ||proof.candidateDigest!==e.result.candidateDigest||proof.postCandidateDigest!==e.result.candidateDigest||proof.logDigest!==log.digest
          ||!Number.isSafeInteger(proof.pid)||proof.pid<=0||proof.exitCode!==0||proof.signal!==null||proof.timedOut)checkpointError('CHECKPOINT_VALIDATION_BINDING');
      }
      for(const c of d.commands.filter(c=>c.required))if(!validations.some((e:any)=>e.checkpointRunId===v.checkpointRunId&&same(e.baseline,v.baseline)&&e.commandHash===hashCanonical(c)&&e.result.status==='PASSED'))checkpointError('CHECKPOINT_PASS_EVIDENCE_MISSING');
      for(const s of d.scenarios)if(!validations.some((e:any)=>e.scenarioHash===s.scenarioHash&&e.scenarioVersion===s.version&&e.result.status==='PASSED'))checkpointError('CHECKPOINT_PASS_EVIDENCE_MISSING');
      if(v.reviewRef){const review=this.read(v.reviewRef),packet=v.reviewPacketRef?this.read(v.reviewPacketRef):undefined,proof=v.reviewerTerminalRef?this.read(v.reviewerTerminalRef):undefined,dispatch=v.reviewerDispatchRef?this.read(v.reviewerDispatchRef):undefined;
        if(!packet||!same(packet.baseline,v.baseline)||packet.checkpointRunId!==v.checkpointRunId||packet.definition.contentDigest!==d.contentDigest
          ||review.result.verdict!=='PASS'||review.packetDigest!==v.reviewPacketRef.digest||review.result.packetDigest!==v.reviewPacketRef.digest
          ||review.terminalProofDigest!==v.reviewerTerminalRef.digest||!dispatch||dispatch.agent!=='controlled.reviewer'
          ||!verifyTerminalProof(proof,{runId:review.runId,requestId:review.requestId,role:'Reviewer',ownerSessionId:dispatch.ownerSessionId})
          ||dispatch.runId!==proof.runId||dispatch.requestId!==proof.requestId||proof.terminalStatus!=='complete')checkpointError('CHECKPOINT_REVIEW_INVALID')}
    }
    return v;
  }
  definitions():readonly IntegrationCheckpointDefinition[]{return this.#snapshot().definitions}
  runs():readonly IntegrationCheckpointRun[]{return this.#snapshot().runs}
  baseline(targetRef=this.git.target(),commit=this.git.refHead(targetRef)):IntegrationBaselineReference {
    const b={projectId:this.projectId,targetRef,commit,tree:this.git.tree(commit)};validateBaseline(b);
    if(!this.git.ancestor(commit,this.git.refHead(targetRef)))checkpointError('CHECKPOINT_BASELINE_NOT_IN_TARGET');return b;
  }
  #planning(d:Pick<IntegrationCheckpointDefinition,'plannedTaskRefs'>){
    if(!d.plannedTaskRefs.length)return;const planning=ProjectPlanningRepository.open(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection);
    if(!planning)checkpointError('CHECKPOINT_PLAN_UNAVAILABLE');const p=planning.current(),links=planning.links();
    for(const ref of d.plannedTaskRefs)if(!p||p.planId!==ref.planId||p.revision!==ref.revision||p.contentDigest!==ref.digest
      ||!links.some(l=>l.planId===ref.planId&&l.planRevision===ref.revision&&l.planDigest===ref.digest&&l.plannedTaskId===ref.plannedTaskId&&l.controlledTaskId===ref.controlledTaskId))checkpointError('CHECKPOINT_PLAN_STALE');
  }
  #task(taskId:string){
    if(!validateScalar('ID',taskId).ok)checkpointError('CHECKPOINT_TASK_INVALID');const root=join(this.projectRoot,'tasks',taskId),ledger=DurableStore.load(root);
    const r=ledger.records.find(r=>r.kind==='TaskSpec'&&r.id===ledger.state.spec.id);
    if(ledger.truncatedTailBytes||ledger.state.state!=='COMPLETED'||ledger.state.taskId!==taskId||ledger.state.repoRoot!==this.repoRoot||r?.kind!=='TaskSpec')checkpointError('CHECKPOINT_TASK_NOT_COMPLETED');
    const completion=ledger.records.find(r=>r.kind==='ArtifactRef'&&['application/vnd.pi-controlled-dev.terminal-completion-v2+json','application/vnd.pi-controlled-dev.terminal-completion-v3+json'].includes(r.value.mediaType)&&ledger.state.completionEvidenceRefs.includes(r.id));
    if(completion?.kind!=='ArtifactRef')checkpointError('CHECKPOINT_COMPLETION_UNAVAILABLE');return {ledger,spec:r.value,root,completionRef:completion.value};
  }
  coverage(d:IntegrationCheckpointDefinition,b:IntegrationBaselineReference):readonly CheckpointCoverage[] {
    validateBaseline(b);if(b.projectId!==this.projectId||this.git.tree(b.commit)!==b.tree)checkpointError('CHECKPOINT_BASELINE_INVALID');this.#planning(d);
    for(const scenario of d.scenarios){if(!d.controlledTaskRefs.includes(scenario.taskId))checkpointError('CHECKPOINT_SCENARIO_UNRESOLVABLE');const task=this.#task(scenario.taskId);
      if(!task.ledger.records.some(r=>r.kind==='ArtifactRef'&&r.value.mediaType==='application/vnd.pi-controlled-dev.executable-scenario+json'&&same(parseJson(readFileSync(join(task.root,r.value.relativeStorePath)),262144),scenario)))checkpointError('CHECKPOINT_SCENARIO_UNRESOLVABLE');}
    const promotion=CandidatePromotionRepository.open(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection);
    return d.controlledTaskRefs.map(taskId=>{
      const task=this.#task(taskId),binding=promotion?.binding(taskId),completionRef=task.completionRef;
      if(!binding?.candidateCommit||!completionRef||binding.completedSpecHash!==task.spec.specHash||binding.targetRef!==b.targetRef)checkpointError('CHECKPOINT_INPUT_NOT_IN_BASELINE');
      const notRequired=binding.candidateCommit===binding.baseCommit;
      if(!this.git.ancestor(binding.candidateCommit,b.commit))checkpointError('CHECKPOINT_INPUT_NOT_IN_BASELINE');
      let promotionResultRef:ArtifactRef|null=null,integrationCommit=binding.baseCommit;
      if(!notRequired){
        const index=promotion!.store.readProjectIndex();if(!index)checkpointError('CHECKPOINT_INPUT_NOT_IN_BASELINE');
        const refs=(parseJson(promotion!.store.read(index),2*1024*1024) as any).results as ArtifactRef[];
        for(const ref of refs){const result=parseJson(promotion!.store.read(ref),2*1024*1024) as any;
          if(result.taskId===taskId&&result.targetRef===b.targetRef&&this.git.ancestor(result.integrationCommit,b.commit)){promotionResultRef=ref;integrationCommit=result.integrationCommit;break}}
        if(!promotionResultRef)checkpointError('CHECKPOINT_INPUT_NOT_IN_BASELINE');
      }
      return {taskId,specHash:task.spec.specHash,completionRef,promotionResultRef,integrationCommit,integrationRequired:!notRequired};
    });
  }
  eligibleTasks(b=this.baseline()):readonly string[]{
    const p=CandidatePromotionRepository.open(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection);if(!p)return [];
    return p.bindings().filter(binding=>{try{this.#task(binding.taskId);return binding.targetRef===b.targetRef&&!!binding.candidateCommit
      &&this.git.ancestor(binding.candidateCommit,b.commit)&&(binding.candidateCommit===binding.baseCommit||p.results().some(r=>r.taskId===binding.taskId&&this.git.ancestor(r.integrationCommit,b.commit)))}catch{return false}}).map(b=>b.taskId);
  }
  availableScenarios(taskIds:readonly string[],commands:TaskSpec['validationCommands']):readonly ExecutableScenario[]{
    const scenarios:ExecutableScenario[]=[];
    for(const id of taskIds){const t=this.#task(id);for(const r of t.ledger.records)if(r.kind==='ArtifactRef'&&r.value.mediaType==='application/vnd.pi-controlled-dev.executable-scenario+json'){
      const s=parseJson(readFileSync(join(t.root,r.value.relativeStorePath)),262144) as unknown as ExecutableScenario;
      if(commands.some(c=>c.id===s.execution.commandId&&hashCanonical(c)===s.execution.commandHash)&&!scenarios.some(existing=>existing.scenarioId===s.scenarioId))scenarios.push(s);
    }}return scenarios;
  }
  #memory(d:Pick<IntegrationCheckpointDefinition,'checkpointId'|'purpose'|'relevantMemoryRefs'>,role:'Scout'|'Reviewer',assignmentId:string,files:readonly string[]){
    const memory=this.options.memory;if(!memory){if(d.relevantMemoryRefs.length)checkpointError('CHECKPOINT_MEMORY_UNAVAILABLE');return}
    return selectProjectMemory(memory,{taskId:d.checkpointId,role,assignmentId,objective:d.purpose,files,requiredBinding:d.relevantMemoryRefs});
  }
  propose(proposal:CheckpointProposal,resolveExecutable:(name:string)=>string,checkpointId?:string):IntegrationCheckpointDefinition {
    return this.#write(()=>{const s=this.#snapshot(),old=checkpointId?s.definitions.filter(d=>d.checkpointId===checkpointId).at(-1):undefined;
      if(checkpointId&&!old)checkpointError('CHECKPOINT_DEFINITION_NOT_FOUND');const time=now(),material={...proposal,schemaVersion:1 as const,projectId:this.projectId,
        checkpointId:checkpointId??`checkpoint-${randomUUID()}`,revision:(old?.revision??0)+1,status:'DRAFT' as const,plannedTaskRefs:proposal.plannedTaskRefs??[],
        scenarios:proposal.scenarios??[],relevantMemoryRefs:proposal.relevantMemoryRefs??[],reviewRequired:proposal.reviewRequired??true,
        commands:checkpointCommands(proposal.validationPlan,resolveExecutable),createdAt:old?.createdAt??time,updatedAt:time};
      const selected=this.#memory(material,'Scout',`definition-${material.checkpointId}-r${material.revision}`,this.git.pathsAt(this.baseline().commit));
      if(selected&&!proposal.relevantMemoryRefs)material.relevantMemoryRefs=selected.selected.map(s=>s.reference);
      const d=validateDefinition({...material,contentDigest:definitionDigest(material)});
      this.#planning(d);const ref=this.#put(`${d.checkpointId}-r${d.revision}`,d);this.#commit(s.ref,{...s.index,definitions:[...s.index.definitions,ref]});return d;});
  }
  prepareApproval(id:string,revision:number,b=this.baseline()):TrustedConfirmationRequest {
    const s=this.#snapshot(),d=s.definitions.find(d=>d.checkpointId===id&&d.revision===revision);
    if(!d||d.status!=='DRAFT'||s.definitions.filter(x=>x.checkpointId===id).at(-1)?.revision!==revision)checkpointError('CHECKPOINT_DEFINITION_STALE');
    this.coverage(d,b);const files=this.git.pathsAt(b.commit);this.#memory(d,'Scout',`approval-${id}`,files);
    const ref=s.index.definitions[s.definitions.indexOf(d)],request=createTrustedConfirmationRequest({purpose:'integration-checkpoint',subjectKind:'IntegrationCheckpoint',subjectId:id,
      subjectRevision:revision,action:'APPROVE',payload:{projectId:this.projectId,definitionRef:ref,definition:d,baseline:b,baseDigest:s.ref?.digest??'0'.repeat(64)} as any,
      presentation:{title:`Approve verification: ${d.title}?`,content:checkpointNarrative(d,b)}});
    this.#approvals.set(request,{definition:d,ref,base:s.ref,baseline:b});return request;
  }
  applyApproval(q:TrustedConfirmationRequest,r:TrustedConfirmationReceipt):IntegrationCheckpointDefinition {
    const h=this.#approvals.get(q);if(!h)checkpointError('CHECKPOINT_APPROVAL_INVALID');this.#approvals.delete(q);
    return this.#write(()=>{const s=this.#snapshot(),fresh=()=>{
      if(!same(this.store.readProjectIndex()??null,h.base??null)||this.git.refHead(h.baseline.targetRef)!==h.baseline.commit)checkpointError('CHECKPOINT_APPROVAL_STALE');
      this.coverage(h.definition,h.baseline);this.#memory(h.definition,'Scout',`approval-${h.definition.checkpointId}`,this.git.pathsAt(h.baseline.commit));return q;};
      const ref=consumeTrustedConfirmation(r,fresh,this.store);this.#commit(s.ref,{...s.index,approvals:[...s.index.approvals,ref]});return this.definitions().find(d=>d.checkpointId===h.definition.checkpointId&&d.revision===h.definition.revision)!;});
  }
  applyPolicyAuthorization(capability:PolicyAuthorizationCapability):IntegrationCheckpointDefinition{return this.#write(()=>{
    const s=this.#snapshot(),subject=capability.authorization.subject as any,d=s.definitions.find(d=>d.checkpointId===subject.definition?.checkpointId&&d.revision===subject.definition.revision);
    if(!d||d.status!=='DRAFT'||!same(d,subject.definition)||!same(this.baseline(),subject.baseline))checkpointError('CHECKPOINT_DEFINITION_STALE');
    const ref=s.index.definitions[s.definitions.indexOf(d)];if(!same(ref,subject.definitionRef))checkpointError('CHECKPOINT_APPROVAL_INVALID');this.coverage(d,subject.baseline);
    this.#memory(d,'Scout',`policy-${d.checkpointId}`,this.git.pathsAt(subject.baseline.commit));
    const approval=consumePolicyCapability(capability,'integration-checkpoint',{definitionRef:ref,definition:d,baseline:subject.baseline},this.store);
    this.#commit(s.ref,{...s.index,approvals:[...s.index.approvals,approval]});return this.definitions().find(x=>x.checkpointId===d.checkpointId&&x.revision===d.revision)!;
  })}
  async approve(ctx:HumanConfirmationChannel,id:string,revision:number,b=this.baseline()){
    const q=this.prepareApproval(id,revision,b),r=await presentTrustedConfirmation(ctx,q);if(!r){this.#approvals.delete(q);return}return this.applyApproval(q,r);
  }
  #save(run:IntegrationCheckpointRun){this.#write(()=>{const s=this.#snapshot(),previous=s.runs.find(r=>r.checkpointRunId===run.checkpointRunId);
    if(previous?.outcome)checkpointError('CHECKPOINT_RUN_IMMUTABLE');
    if(previous){for(const key of ['checkpointDefinitionId','definitionRevision','definitionDigest','definitionRef','baseline','owner','startedAt'] as const)if(!same(previous[key],run[key]))checkpointError('CHECKPOINT_RUN_IDENTITY');
      if(!same(previous.evidenceRefs,run.evidenceRefs.slice(0,previous.evidenceRefs.length))||previous.coverage.length&&!same(previous.coverage,run.coverage))checkpointError('CHECKPOINT_RUN_HISTORY_CHANGED');}const ref=this.#put(`${run.checkpointRunId}-${hashCanonical(run).slice(0,16)}`,run),n=s.runs.indexOf(previous!);
    const refs=[...s.index.runs];if(n<0)refs.push(ref);else refs[n]=ref;this.#commit(s.ref,{...s.index,runs:refs});});return run}
  #uncertainCommands(run:IntegrationCheckpointRun):boolean {
    const values=run.evidenceRefs.filter(r=>r.mediaType===CHECKPOINT_MEDIA).map(ref=>({ref,value:this.read(ref)}));
    return values.some(({ref,value})=>value.kind==='checkpoint-command-intent'&&!values.some(e=>e.value.kind==='checkpoint-validation'
      &&e.value.checkpointRunId===run.checkpointRunId&&same(e.value.commandIntentRef,ref)));
  }
  #leaseKey(d:IntegrationCheckpointDefinition,b:IntegrationBaselineReference){return `checkpoint-${hashCanonical({id:d.checkpointId,revision:d.revision,commit:b.commit}).slice(0,40)}`}
  worktree(run:IntegrationCheckpointRun){return join(this.store.agentDataRoot,'controlled-dev','workspaces',`${this.projectId.slice(0,16)}-${run.checkpointRunId}`)}
  async run(id:string,revision:number,b=this.baseline(),reviewer?:ControlledReviewerRunner):Promise<IntegrationCheckpointRun> {
    const s=this.#snapshot(),d=s.definitions.find(d=>d.checkpointId===id&&d.revision===revision);if(!d||d.status!=='APPROVED')checkpointError('CHECKPOINT_DEFINITION_NOT_APPROVED');
    const primaryCanary=new IntegrationPrimaryCanary(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection);
    const manager=new LockManager(this.store.agentDataRoot,`integration-checkpoint-${randomUUID()}`,`checkpoint-${randomUUID()}`),lease=manager.acquireTask(this.#leaseKey(d,b),this.repoRoot);
    let run:IntegrationCheckpointRun={schemaVersion:1,checkpointRunId:`checkpoint-run-${randomUUID()}`,definitionRef:s.index.definitions[s.definitions.indexOf(d)],
      checkpointDefinitionId:id,definitionRevision:revision,definitionDigest:d.contentDigest,baseline:b,startedAt:now(),finishedAt:null,outcome:null,phase:'CREATED',reason:'',
      coverage:[],evidenceRefs:[],reviewRef:null,owner:lease.record,reviewPacketRef:null,reviewerDispatchRef:null,reviewerTerminalRef:null};
    const append=(ref:ArtifactRef)=>{run={...run,evidenceRefs:[...run.evidenceRefs,ref]};this.options.fault?.('duringEvidencePersistence');this.#save(run)};
    const finish=(outcome:'PASS'|'FAIL'|'BLOCKED',reason:string)=>{run={...run,outcome,reason,phase:'FINISHED',finishedAt:now()};const saved=this.#save(run);this.options.fault?.('afterFinalOutcome');return saved};
    const work=this.worktree(run);let materialized=false;
    try{
      if(s.runs.some(r=>r.definitionDigest===d.contentDigest&&r.baseline.commit===b.commit&&r.reviewerDispatchRef&&!r.reviewerTerminalRef))checkpointError('CHECKPOINT_REVIEWER_TERMINALITY_UNKNOWN');
      if(s.runs.some(r=>r.definitionDigest===d.contentDigest&&r.baseline.commit===b.commit&&this.#uncertainCommands(r)))checkpointError('CHECKPOINT_COMMAND_TERMINALITY_UNKNOWN');
      this.#save(run);this.options.fault?.('afterCreated');
      try{run={...run,coverage:this.coverage(d,b)};this.git.detached(work,b.commit);materialized=true;this.#save(run)}catch(error){return finish('BLOCKED',String(error))}
      const digest=hashCanonical(trackedWorkspaceManifest(work,b.commit)),files=workspaceManifest(work,b.commit).entries.map(e=>e.path),criteria:Criterion[]=d.validationIntent.map((text,n)=>({schemaVersion:1,id:`integration-criterion-${n+1}`,text,method:'REVIEW',commandIds:[],requirementIds:['integration'],reviewInstruction:text} as Criterion));
      const selection=this.#memory(d,'Scout',`planning-${run.checkpointRunId}`,files);
      if(selection){const context=prepareMemoryContext(selection,this.store);append(context.contextRef);append(this.#put(`checkpoint-planning-context-${run.checkpointRunId}`,{schemaVersion:1,checkpointRunId:run.checkpointRunId,baseline:b,
        purpose:'validation planning and scenario selection',contextRef:context.contextRef,contextDigest:selection.digest,delivery:'HOST_CONSUMED'}))}
      const execute=(command:TaskSpec['validationCommands'][number],scenario?:ExecutableScenario)=>{
        const commandIntent=this.#put(`checkpoint-command-intent-${randomUUID()}`,{schemaVersion:1,kind:'checkpoint-command-intent',checkpointRunId:run.checkpointRunId,baseline:b,definitionRef:run.definitionRef,commandHash:hashCanonical(command),scenarioHash:scenario?.scenarioHash??null});
        run={...run,evidenceRefs:[...run.evidenceRefs,commandIntent]};this.#save(run);
        const result=collectValidationEvidence(command,this.store,{taskId:scenario?.taskId??run.checkpointRunId,specHash:d.contentDigest,
          candidate:{root:work,baseCommit:b.commit,digest,generation:0},trackedBaseline:true,criteria:scenario?this.#task(scenario.taskId).spec.acceptanceCriteria:criteria,createdAt:run.startedAt,...(scenario?{scenario}:{})});
        const envelope={schemaVersion:1,kind:'checkpoint-validation',checkpointRunId:run.checkpointRunId,definitionRef:run.definitionRef,baseline:b,
          commandIntentRef:commandIntent,commandHash:hashCanonical(command),scenarioHash:scenario?.scenarioHash??null,scenarioVersion:scenario?.version??null,result:result.result,artifacts:result.artifacts};
        for(const ref of result.artifacts)append(ref);append(this.#put(`checkpoint-validation-${hashCanonical(envelope).slice(0,32)}`,envelope));
        this.git.assertDetachedBaseline(work,b.commit);
        if(!primaryCanary.verify())checkpointError('CHECKPOINT_PRIMARY_CHANGED');
        if(this.git.head(work)!==b.commit||this.git.tree(b.commit)!==b.tree||hashCanonical(trackedWorkspaceManifest(work,b.commit))!==digest)checkpointError('CHECKPOINT_BASELINE_CHANGED');
        return result.result;
      };
      const assertCanaries=()=>{this.git.assertDetachedBaseline(work,b.commit);if(!primaryCanary.verify())checkpointError('CHECKPOINT_PRIMARY_CHANGED');if(hashCanonical(trackedWorkspaceManifest(work,b.commit))!==digest)checkpointError('CHECKPOINT_BASELINE_CHANGED')};
      const statuses:ValidationResult['status'][]=[];
      for(const command of d.commands){const result=execute(command);if(command.required)statuses.push(result.status)}
      run={...run,phase:'VALIDATIONS'};this.#save(run);this.options.fault?.('afterValidation');
      for(const scenario of d.scenarios){const command=d.commands.find(c=>c.id===scenario.execution.commandId)!;statuses.push(execute(command,scenario).status)}
      run={...run,phase:'SCENARIOS'};this.#save(run);this.options.fault?.('afterScenario');
      if(statuses.some(status=>!['PASSED','FAILED'].includes(status)))return finish('BLOCKED',"A check or its execution evidence is incomplete.");
      if(d.reviewRequired){
        if(!reviewer)return finish('BLOCKED',"Reviewer unavailable: an independent assessment is missing.");
        const packet={taskId:d.checkpointId,assignmentId:run.checkpointRunId,integrationCommit:b.commit,integrationDigest:hashCanonical(workspaceManifest(work,b.commit)),criteria,
          checkpointRunId:run.checkpointRunId,definition:d,baseline:b,coverage:run.coverage,evidenceRoot:this.store.root,evidence:run.evidenceRefs.filter(ref=>ref.mediaType.includes('scenario-run')||ref.mediaType.includes('technical-evidence-bundle')||ref.mediaType.includes('runtime-evidence')||ref.mediaType===CHECKPOINT_MEDIA).map(ref=>{const value=this.read(ref);if(value.kind==='checkpoint-validation'){const {artifacts,...summary}=value;return {ref,value:summary}}return {ref,value}}).filter(e=>e.value.kind!=='checkpoint-command-intent'),
          selectedTaskResults:run.coverage.map(c=>{const task=this.#task(c.taskId),raw=readFileSync(join(task.root,c.completionRef.relativeStorePath));if(hashBytes(raw)!==c.completionRef.digest)checkpointError('CHECKPOINT_COMPLETION_BINDING');return {taskId:c.taskId,specHash:c.specHash,completionRef:c.completionRef,completionPackageDigest:c.completionRef.digest,evidenceRoot:task.root,title:task.spec.title,objective:task.spec.objective,developer:task.ledger.records.findLast(r=>r.kind==='DeveloperResult')?.value,review:task.ledger.records.findLast(r=>r.kind==='ReviewResult')?.value,criteria:task.spec.acceptanceCriteria}}),
          promotionResults:run.coverage.filter(c=>c.promotionResultRef).map(c=>{const promotion=CandidatePromotionRepository.open(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection)!;return parseJson(promotion.store.read(c.promotionResultRef!),2*1024*1024)})};
        if(Buffer.byteLength(canonicalize(packet),'utf8')>48000)checkpointError('CHECKPOINT_REVIEW_PACKET_LIMIT');
        const packetRef=this.#put(`checkpoint-packet-${run.checkpointRunId}`,packet);run={...run,reviewPacketRef:packetRef};append(packetRef);
        const memory=this.#memory(d,'Reviewer',run.checkpointRunId,files),prepared=memory?prepareMemoryContext(memory,this.store,ref=>append(ref)):undefined;
        if(prepared)append(prepared.contextRef);run={...run,phase:'REVIEW'};this.#save(run);
        try{const review=await reviewer.reviewIntegration(this.repoRoot,work,packet,{projectMemory:prepared,primaryContinuity:primaryCanary,
          onDispatchIdentity:identity=>{const ref=this.#put(`checkpoint-dispatch-${hashCanonical(identity).slice(0,32)}`,identity);run={...run,reviewerDispatchRef:ref};append(ref)},
          onTerminalProof:proof=>{const ref=this.#put(`checkpoint-terminal-${hashCanonical(proof).slice(0,32)}`,proof);run={...run,reviewerTerminalRef:ref};append(ref)}});
          if(review.packetDigest!==hashCanonical(packet)||!review.terminalProofDigest||!run.reviewerTerminalRef||review.result.packetDigest!==hashCanonical(packet))checkpointError('CHECKPOINT_REVIEW_BINDING');
          assertCanaries();const ref=this.#put(`checkpoint-review-${run.checkpointRunId}`,review);run={...run,reviewRef:ref};append(ref);
          if(review.result.verdict==='BLOCKED')return finish('BLOCKED',review.result.reason);
          if(review.result.verdict==='FAIL')return finish('FAIL',review.result.reason);
        }catch(error){return finish('BLOCKED',`The review cannot be verified: ${String(error)}`)}
      }
      this.options.fault?.('beforeFinalOutcome');assertCanaries();return finish(statuses.includes('FAILED')?'FAIL':'PASS',statuses.includes('FAILED')?"An integrated check failed; the evidence is preserved.":"The planned checks passed on the exact specified commit.");
    }catch(error){if((error as Error).message.startsWith('CHECKPOINT_FAULT'))throw error;return finish('BLOCKED',String(error))}
    finally{if(materialized){try{this.git.removeDetached(work)}catch{/* Preserve dirty/generated files for explicit inspection, never force-delete. */}}manager.release(lease)}
  }
  /** Explicit recovery never reruns commands or agents. Even complete-looking partial evidence
   * cannot synthesize PASS/FAIL. An unproven Reviewer remains ineligible for another dispatch. */
  recover(runId:string):IntegrationCheckpointRun {
    const run=this.runs().find(r=>r.checkpointRunId===runId);if(!run)checkpointError('CHECKPOINT_RUN_NOT_FOUND');
    const owner=run.owner as LockRecord;if(run.outcome&&inspectProcessOwner(owner.processIncarnation).status!=='DEAD')return run;if(inspectProcessOwner(owner.processIncarnation).status!=='DEAD')checkpointError('CHECKPOINT_RECOVERY_OWNER_UNCERTAIN');
    const manager=new LockManager(this.store.agentDataRoot,`integration-checkpoint-${randomUUID()}`,`checkpoint-${randomUUID()}`);
    manager.reclaimCheckpointTask(this.repoRoot,owner);if(run.outcome)return run;
    const d=this.definitions().find(d=>d.checkpointId===run.checkpointDefinitionId&&d.revision===run.definitionRevision)!;
    const lease=manager.acquireTask(this.#leaseKey(d,run.baseline),this.repoRoot);
    try{return this.#save({...run,outcome:'BLOCKED',phase:'FINISHED',finishedAt:now(),reason:"Execution interrupted: partial evidence preserved. No PASS or FAIL inferred from recovery."})}finally{manager.release(lease)}
  }
  recoverableRuns():readonly IntegrationCheckpointRun[]{return this.runs().filter(run=>{if(!run.outcome)return true;const owner=run.owner as LockRecord;return inspectProcessOwner(owner.processIncarnation).status==='DEAD'&&existsSync(join(this.store.agentDataRoot,'controlled-dev','locks','tasks',`${hashBytes(Buffer.from(`${hashBytes(Buffer.from(this.repoRoot))}\0${owner.taskId}`))}.lock`))})}
  status(targetRef=this.git.target()){
    const baseline=this.baseline(targetRef),runs=this.runs().filter(r=>r.baseline.targetRef===targetRef),latest=runs.at(-1),current=runs.filter(r=>r.baseline.commit===baseline.commit).at(-1);
    const status=current?.outcome==='PASS'?'VERIFIED':current?.outcome==='FAIL'?'FAILED':runs.some(r=>r.outcome==='PASS'&&r.baseline.commit!==baseline.commit)?'STALE':'NOT_CHECKED';
    return {baseline,latest,current,status,lastVerified:runs.findLast(r=>r.outcome==='PASS'),coveredTasks:current?.coverage.map(c=>c.taskId)??[]};
  }
}
