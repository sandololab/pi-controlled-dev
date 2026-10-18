import { join } from 'node:path';
import { readFileSync,lstatSync } from 'node:fs';
import { CandidatePromotionRepository } from './candidate-promotion-repository.js';
import { IntegrationCheckpointRepository } from './integration-checkpoint-repository.js';
import { assertDependencyChanges } from './autonomy-dependencies.js';
import type { DependencyChange } from './autonomy-dependencies.js';
import type { TaskWizardDraft } from './pre-task-proposal.js';
import { compileValidations,compiledValidationResolver,hostValidationRecipeName } from './validation-proposals.js';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { canonicalize, hashBytes, hashContract, hashCanonical, parseJson, validateStructure, validateScalar } from './contracts.js';
import type { ArtifactRef, CommandSpec, TaskSpec } from './contracts.js';
import type { Json } from './contract-json.js';
import { DurableStore } from './store.js';
import type { ArtifactInspection } from './store.js';
import type { LockHandle,LockRecord } from './lock-manager.js';
import { LockManager, withLockMutation } from './lock-manager.js';
import { ProjectPlanningRepository } from './project-planning-repository.js';
import type { ProjectPlan } from './project-planning.js';
import { ProjectMemoryRepository } from './project-memory-repository.js';
import { memoryReference, freezeMemory } from './project-memory.js';
import { localRef } from './candidate-git.js';
import { createTrustedConfirmationRequest, consumeTrustedConfirmation, readTrustedConfirmationEvidence } from './trusted-confirmation.js';
import type { TrustedConfirmationRequest, TrustedConfirmationReceipt } from './trusted-confirmation.js';
import { POLICY_AUTHORIZATION_MEDIA, issuePolicyCapability,consumePolicyCapability,readPolicyAuthorization } from './policy-authorization.js';
import type { PolicyDerivedAuthorization, PolicyAuthorizationCapability } from './policy-authorization.js';

export const AUTONOMY_MEDIA='application/vnd.pi-controlled-dev.project-autonomy+json';
export const AUTONOMY_ACTIONS=['TaskSpec','beforeImplementation','onScopeChange','beforeCompletion','beforeReviewerRedispatch','candidate-promotion','integration-checkpoint'] as const;
export type AutonomyAction=typeof AUTONOMY_ACTIONS[number];
export const INTERRUPTIONS=['PLAN_CHANGE_REQUIRED','OUT_OF_SCOPE','ARCHITECTURE_DECISION_REQUIRED','MERGE_CONFLICT','EXTERNAL_BASELINE_CHANGE','RETRY_EXHAUSTED','PROVIDER_TERMINALITY_UNKNOWN','UNRESOLVED_RISK','UNEXPECTED_DEPENDENCY','POLICY_REVOKED','MANUAL_PAUSE'] as const;
export type InterruptionReason=typeof INTERRUPTIONS[number];
export interface TaskAutonomyBound {readonly plannedTaskId:string;readonly allowedPaths:readonly string[];readonly protectedPaths:readonly string[];readonly validationCommands:readonly CommandSpec[]}
export interface ProjectAutonomyPolicy {readonly schemaVersion:1;readonly policyId:string;readonly revision:number;readonly projectId:string;
 readonly plan:{readonly planId:string;readonly revision:number;readonly digest:string};readonly targetRef:string;readonly baselineCommit:string;
 readonly taskBounds:readonly TaskAutonomyBound[];readonly actions:readonly AutonomyAction[];readonly escalationConditions:readonly InterruptionReason[];
 readonly dependencyChanges:readonly DependencyChange[];readonly bindingMemory:readonly unknown[];readonly finalCheckpoint:{readonly validationIntent:readonly string[];readonly validationPlan:TaskWizardDraft['validationPlan'];readonly commands:readonly CommandSpec[]};
 readonly createdAt:string;readonly contentDigest:string}
export interface AutonomyEscalationDecision {readonly schemaVersion:1;readonly kind:'AutonomyDecision';readonly policyRef:ArtifactRef;readonly runId:string;readonly actionKind:string;readonly subject:Json;readonly decision:'ESCALATE'|'BLOCK';readonly checks:readonly {readonly name:string;readonly passed:boolean}[];readonly reason:string;readonly resultingArtifactRefs:readonly ArtifactRef[];readonly createdAt:string}
export type AutonomyDecision=PolicyDerivedAuthorization|AutonomyEscalationDecision;
export interface HumanInterruption {readonly reason:InterruptionReason;readonly phase:string;readonly decisionNeeded:string;readonly alreadyDone:readonly string[];readonly safeOptions:readonly string[];readonly mandatory:boolean;readonly detail:string;readonly createdAt:string}
export interface ProjectAutonomyRun {readonly schemaVersion:1;readonly runId:string;readonly revision:number;readonly policyRef:ArtifactRef;
 readonly status:'ACTIVE'|'PAUSED'|'FINISHED'|'CANCELLED';readonly expectedHead:string;readonly promotions:readonly {taskId:string;previousHead:string;resultingHead:string}[];
 readonly interruption:HumanInterruption|null;readonly pauseRequested:boolean;readonly finalCheckpointRef:ArtifactRef|null}
interface Index {schemaVersion:1;revision:number;policies:ArtifactRef[];approvals:ArtifactRef[];revoked:string[];runs:ArtifactRef[];decisions:ArtifactRef[];interruptions:ArtifactRef[];effects:ArtifactRef[]}
const same=(a:unknown,b:unknown)=>canonicalize(a)===canonicalize(b);
const now=()=>new Date().toISOString();
function fail(code:string):never{throw new Error(code)}
/** V1 bounds are literal files/directories plus an optional terminal /**. No arbitrary glob algebra. */
export function boundPath(input:string):string {
 const path=input.endsWith('/**')?input.slice(0,-3):input;
 if(!validateScalar('Path',path).ok||/[?*\[\]{}]/.test(path)||path.split('/').some(p=>['.git','.pi','.codex','.agents','.ssh','.env','.npmrc','.netrc','credentials','credentials.json'].includes(p)))fail('OUT_OF_SCOPE');
 return path;
}
export function pathContained(path:string,allowed:readonly string[],protectedPaths:readonly string[]):boolean {
 const p=boundPath(path),contains=(root:string)=>{const r=boundPath(root);return p===r||p.startsWith(r+'/')};
 return allowed.some(contains)&&!protectedPaths.some(root=>{const r=boundPath(root);return p===r||p.startsWith(r+'/')||r.startsWith(p+'/')});
}
export function validateAutonomyPolicy(input:unknown):ProjectAutonomyPolicy {
 const p=JSON.parse(canonicalize(input)) as ProjectAutonomyPolicy;
 const keys='actions,baselineCommit,bindingMemory,contentDigest,createdAt,dependencyChanges,escalationConditions,finalCheckpoint,plan,policyId,projectId,revision,schemaVersion,targetRef,taskBounds';
 if(Object.keys(p).sort().join(',')!==keys||p.schemaVersion!==1||!validateScalar('ID',p.policyId).ok||!validateScalar('Hash',p.projectId).ok||!validateScalar('Time',p.createdAt).ok
   ||!Number.isSafeInteger(p.revision)||p.revision<1||!validateScalar('GitOID',p.baselineCommit).ok||Object.keys(p.plan).sort().join(',')!=='digest,planId,revision'
   ||!validateScalar('ID',p.plan.planId).ok||!validateScalar('Hash',p.plan.digest).ok||!Number.isSafeInteger(p.plan.revision)||p.plan.revision<1)fail('POLICY_INVALID');
 localRef(p.targetRef);
 if(!p.targetRef.startsWith('refs/heads/')||!Array.isArray(p.taskBounds)||!p.taskBounds.length||p.taskBounds.length>64||new Set(p.taskBounds.map(b=>b.plannedTaskId)).size!==p.taskBounds.length
  ||!Array.isArray(p.actions)||!p.actions.length||new Set(p.actions).size!==p.actions.length||p.actions.some(a=>!AUTONOMY_ACTIONS.includes(a))
  ||!same(p.escalationConditions,INTERRUPTIONS)||!Array.isArray(p.bindingMemory)||p.bindingMemory.length>256)fail('POLICY_INVALID');
 for(const b of p.taskBounds){if(Object.keys(b).sort().join(',')!=='allowedPaths,plannedTaskId,protectedPaths,validationCommands'||!validateScalar('ID',b.plannedTaskId).ok
   ||!Array.isArray(b.allowedPaths)||!b.allowedPaths.length||b.allowedPaths.length>256||!Array.isArray(b.protectedPaths)||b.protectedPaths.length>256)fail('POLICY_INVALID');
  [...b.allowedPaths,...b.protectedPaths].forEach(boundPath);if(!Array.isArray(b.validationCommands)||!b.validationCommands.length||b.validationCommands.some((c:CommandSpec)=>!validateStructure('CommandSpec',c).ok||!hostValidationRecipeName(c)))fail('POLICY_INVALID');}
 if(Object.keys(p.finalCheckpoint).sort().join(',')!=='commands,validationIntent,validationPlan'||!Array.isArray(p.finalCheckpoint.commands)||!p.finalCheckpoint.commands.length
  ||p.finalCheckpoint.commands.some((c:CommandSpec)=>!validateStructure('CommandSpec',c).ok)||!Array.isArray(p.finalCheckpoint.validationIntent)||!p.finalCheckpoint.validationIntent.length)fail('POLICY_INVALID');
 if(!Array.isArray(p.dependencyChanges)||p.dependencyChanges.length>128||p.dependencyChanges.some(d=>Object.keys(d).sort().join(',')!=='manifestPath,name,section,version'||!d.manifestPath.endsWith('package.json')||!validateScalar('Path',d.manifestPath).ok||!['dependencies','devDependencies','peerDependencies','optionalDependencies'].includes(d.section)||typeof d.name!=='string'||!d.name||typeof d.version!=='string'||!d.version))fail('POLICY_INVALID');
 // Recompile the closed recipes using their approved executable identities; prose cannot become a shell command.
 const resolver=compiledValidationResolver(p.finalCheckpoint.commands);
 if(!same(compileValidations({objective:'Final checkpoint',scope:[],criteria:[],architectureFindings:[],designExpectations:[],validationPlan:p.finalCheckpoint.validationPlan},resolver),p.finalCheckpoint.commands))fail('POLICY_INVALID');
 const {contentDigest,...body}=p;if(hashCanonical(body)!==contentDigest)fail('POLICY_DIGEST');return freezeMemory(p);
}
/** Same DurableStore and short index mutation guard as checkpoints. Never writes task state. */
export class ProjectAutonomyRepository {
 readonly #requests=new WeakMap<object,{policy:ProjectAutonomyPolicy;ref:ArtifactRef}>();
 private constructor(readonly store:DurableStore,readonly repoRoot:string){this.snapshot()}
 static open(data:string,repo:string,inspect:ArtifactInspection,create=false):ProjectAutonomyRepository|undefined {
  const m=new LockManager(data,'autonomy-host',`autonomy-${randomUUID()}`);
  return withLockMutation(m.root,m.workspaceIdentity(repo).workspaceHash,()=>{const store=DurableStore.project(data,repo,'autonomy',inspect,create);return store?new ProjectAutonomyRepository(store,repo):undefined});
 }
 private write<T>(f:()=>T):T {const m=new LockManager(this.store.agentDataRoot,'autonomy-host',`autonomy-${randomUUID()}`);return withLockMutation(m.root,m.workspaceIdentity(this.repoRoot).workspaceHash,f)}
 private read<T>(ref:ArtifactRef):T {const v=parseJson(this.store.read(ref),2*1024*1024);if(hashCanonical(v)!==ref.digest)fail('AUTONOMY_ARTIFACT_INVALID');return v as T}
 private put(id:string,v:unknown,media=AUTONOMY_MEDIA):ArtifactRef{return this.store.put(id,canonicalize(v),media)}
 private snapshot(){const ref=this.store.readProjectIndex(),index:Index=ref?this.read(ref):{schemaVersion:1,revision:0,policies:[],approvals:[],revoked:[],runs:[],decisions:[],interruptions:[],effects:[]};
  if(Object.keys(index).sort().join(',')!=='approvals,decisions,effects,interruptions,policies,revision,revoked,runs,schemaVersion'||index.schemaVersion!==1||!Number.isSafeInteger(index.revision)||index.revision<0)fail('AUTONOMY_INDEX_INVALID');
  for(const k of ['policies','approvals','runs','decisions','interruptions','effects'] as const)if(!Array.isArray(index[k])||index[k].length>4096||index[k].some(r=>!validateStructure('ArtifactRef',r).ok)||new Set(index[k].map(r=>r.id)).size!==index[k].length)fail('AUTONOMY_INDEX_INVALID');
  const policies=index.policies.map(r=>validateAutonomyPolicy(this.read(r))),approvals=index.approvals.map(ref=>{const raw=this.read<any>(ref);const proof=readTrustedConfirmationEvidence(this.store,ref,raw.request),payload=proof.request.payload as any;
   const n=index.policies.findIndex(r=>same(r,payload.policyRef));if(n<0||proof.request.purpose!=='project-autonomy-policy-approval'||proof.receipt.decision!=='APPROVE'||!same(policies[n],payload.policy)
     ||proof.request.subjectId!==policies[n].policyId||proof.request.subjectRevision!==policies[n].revision)fail('POLICY_APPROVAL_INVALID');return {ref,policyRef:index.policies[n],policy:policies[n]};});
  return {ref,index,policies,approvals};
 }
 private commit(base:ArtifactRef|undefined,i:Index){const next={...i,revision:i.revision+1};this.store.replaceProjectIndex(base,this.put(`autonomy-index-${hashCanonical(next)}`,next))}
 planning(){const memory=ProjectMemoryRepository.open(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection);return ProjectPlanningRepository.open(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection,{memory})!}
 private bindings(){return ProjectMemoryRepository.open(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection)?.entries()
  .filter(e=>e.record.recordKind!=='technical-lesson'&&['ACCEPTED','ACTIVE'].includes(e.record.status)).map(e=>memoryReference(e.record,e.ref))??[]}
 private git(...args:string[]):string{return execFileSync('git',['-C',this.repoRoot,...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}).trim()}
 baseline(){if(this.git('status','--porcelain=v1','--untracked-files=all'))fail('EXTERNAL_BASELINE_CHANGE');return {head:this.git('rev-parse','HEAD'),targetRef:this.git('symbolic-ref','HEAD')}}
 propose(plan:ProjectPlan,taskBounds:readonly TaskAutonomyBound[],finalCheckpoint:ProjectAutonomyPolicy['finalCheckpoint'],actions:readonly AutonomyAction[]=AUTONOMY_ACTIONS,dependencyChanges:readonly DependencyChange[]=[]):ProjectAutonomyPolicy {
  return this.write(()=>{const s=this.snapshot(),b=this.baseline();if(!same(this.planning().history().find(p=>p.planId===plan.planId&&p.revision===plan.revision),plan)||taskBounds.some(t=>!plan.plannedTasks.some(p=>p.plannedTaskId===t.plannedTaskId)))fail('PLAN_CHANGE_REQUIRED');
   const body={schemaVersion:1 as const,policyId:`policy-${randomUUID()}`,revision:1,projectId:this.planning().projectId,plan:{planId:plan.planId,revision:plan.revision,digest:plan.contentDigest},targetRef:b.targetRef,baselineCommit:b.head,taskBounds,actions,escalationConditions:INTERRUPTIONS,dependencyChanges,bindingMemory:this.bindings(),finalCheckpoint,createdAt:now()};
   const p=validateAutonomyPolicy({...body,contentDigest:hashCanonical(body)});this.commit(s.ref,{...s.index,policies:[...s.index.policies,this.put(`${p.policyId}-r1`,p)]});return p;});
 }
 policies(){const s=this.snapshot();return s.policies.map(p=>({policy:p,status:s.index.revoked.includes(p.policyId)?'REVOKED':s.approvals.some(a=>a.policy.policyId===p.policyId)?s.approvals.at(-1)?.policy.policyId===p.policyId?'APPROVED':'SUPERSEDED':'DRAFT'} as const))}
 prepareApproval(policyId:string):TrustedConfirmationRequest {const s=this.snapshot(),p=s.policies.find(p=>p.policyId===policyId);if(!p||s.index.revoked.includes(policyId)||s.approvals.some(a=>a.policy.policyId===policyId))fail('POLICY_APPROVAL_INVALID');
  const ref=s.index.policies[s.policies.indexOf(p)];const q=createTrustedConfirmationRequest({purpose:'project-autonomy-policy-approval',subjectKind:'ProjectAutonomyPolicy',subjectId:p.policyId,subjectRevision:p.revision,action:'APPROVE',payload:{policyRef:ref,policy:p} as any,
   presentation:{title:"Controlled Autonomy",content:policyNarrative(p)}});this.#requests.set(q,{policy:p,ref});return q;
 }
 applyApproval(q:TrustedConfirmationRequest,r:TrustedConfirmationReceipt):void {const h=this.#requests.get(q);this.#requests.delete(q);if(!h)fail('POLICY_APPROVAL_INVALID');this.write(()=>{const s=this.snapshot();const fresh=()=>{const b=this.baseline(),plan=this.planning().current();
   if(!plan||!same(h.policy.plan,{planId:plan.planId,revision:plan.revision,digest:plan.contentDigest})||b.head!==h.policy.baselineCommit||b.targetRef!==h.policy.targetRef||!same(this.bindings(),h.policy.bindingMemory)||s.index.revoked.includes(h.policy.policyId)||this.snapshot().approvals.some(a=>a.policy.policyId===h.policy.policyId))fail('POLICY_STALE');return q;};
   const approval=consumeTrustedConfirmation(r,fresh,this.store);this.commit(s.ref,{...s.index,approvals:[...s.index.approvals,approval]});});}
 revoke(policyId:string):void{this.write(()=>{const s=this.snapshot();if(!s.approvals.some(a=>a.policy.policyId===policyId))fail('POLICY_APPROVAL_INVALID');this.commit(s.ref,{...s.index,revoked:[...new Set([...s.index.revoked,policyId])]});});}
 runs():readonly ProjectAutonomyRun[]{const s=this.snapshot();return freezeMemory(s.index.runs.map(r=>this.read<ProjectAutonomyRun>(r)))}
 run(id:string):ProjectAutonomyRun{const run=this.runs().find(r=>r.runId===id);if(!run)fail('AUTONOMY_RUN_MISSING');return run}
 private save(run:ProjectAutonomyRun):ProjectAutonomyRun{return this.write(()=>{const s=this.snapshot(),prior=this.runs().find(r=>r.runId===run.runId);if(prior&&run.revision!==prior.revision+1)fail('AUTONOMY_RUN_STALE');
  const refs=[...s.index.runs],n=prior?refs.findIndex(r=>this.read<ProjectAutonomyRun>(r).runId===run.runId):-1,ref=this.put(`${run.runId}-r${run.revision}`,run);if(n<0)refs.push(ref);else refs[n]=ref;let interruptions=s.index.interruptions,decisions=s.index.decisions;
  if(run.interruption&&!same(run.interruption,prior?.interruption??null)){const interruptionRef=this.put(`interruption-${run.runId}-r${run.revision}`,{schemaVersion:1,runId:run.runId,policyRef:run.policyRef,...run.interruption});interruptions=[...interruptions,interruptionRef];
    const decisionRef=this.put(`escalation-${run.runId}-r${run.revision}`,{schemaVersion:1,kind:'AutonomyDecision',policyRef:run.policyRef,runId:run.runId,actionKind:run.interruption.phase,subject:{runId:run.runId},decision:run.interruption.reason==='PROVIDER_TERMINALITY_UNKNOWN'?'BLOCK':'ESCALATE',checks:[{name:run.interruption.reason,passed:false}],reason:run.interruption.decisionNeeded,resultingArtifactRefs:[interruptionRef],createdAt:run.interruption.createdAt});decisions=[...decisions,decisionRef];}
  this.commit(s.ref,{...s.index,runs:refs,interruptions,decisions});return freezeMemory(run);});}
 start(policyId:string):ProjectAutonomyRun {return this.write(()=>{const s=this.snapshot(),a=s.approvals.at(-1);if(!a||a.policy.policyId!==policyId||this.runs().some(r=>r.status==='ACTIVE'||r.status==='PAUSED'))fail('AUTONOMY_RUN_EXISTS');
  const run:ProjectAutonomyRun={schemaVersion:1,runId:`autonomy-run-${randomUUID()}`,revision:1,policyRef:a.policyRef,status:'ACTIVE',expectedHead:a.policy.baselineCommit,promotions:[],interruption:null,pauseRequested:false,finalCheckpointRef:null};this.assertCurrent(run);const ref=this.put(`${run.runId}-r1`,run);this.commit(s.ref,{...s.index,runs:[...s.index.runs,ref]});return freezeMemory(run);});}
 policy(run:ProjectAutonomyRun):ProjectAutonomyPolicy{return validateAutonomyPolicy(this.read(run.policyRef))}
 private promotionFromRun(run:ProjectAutonomyRun,effect:{taskId:string;previousHead:string;resultingHead:string}):boolean{const source=CandidatePromotionRepository.open(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection),result=source?.results().find(n=>n.taskId===effect.taskId&&n.previousHead===effect.previousHead&&n.resultingHead===effect.resultingHead);if(!source||!result)return false;
  const intent=parseJson(source.store.read(result.intentRef),2*1024*1024) as any;if(intent.schemaVersion!==2||intent.authorizationKind!=='PolicyDerivedAuthorization')return false;const authorization=readPolicyAuthorization(source.store,intent.approvalRef,'candidate-promotion');return authorization.runId===run.runId&&same(authorization.policyRef,run.policyRef)&&this.decisions().some(a=>a.kind==='PolicyDerivedAuthorization'&&a.authorizationId===authorization.authorizationId);}
 assertCurrent(run:ProjectAutonomyRun):ProjectAutonomyPolicy {const s=this.snapshot(),p=this.policy(run),approved=s.approvals.at(-1),plan=this.planning().current(),b=this.baseline();
  if(!approved||!same(approved.policyRef,run.policyRef)||s.index.revoked.includes(p.policyId))fail('POLICY_REVOKED');
  if(!plan||!same(p.plan,{planId:plan.planId,revision:plan.revision,digest:plan.contentDigest}))fail('PLAN_CHANGE_REQUIRED');
  if(!same(this.bindings(),p.bindingMemory))fail('ARCHITECTURE_DECISION_REQUIRED');
  const linked=this.planning().links().filter(l=>l.planDigest===p.plan.digest).map(l=>l.controlledTaskId);
  if(ProjectMemoryRepository.open(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection)?.entries().some(e=>e.record.recordKind!=='technical-lesson'&&e.record.status==='PROPOSED'&&e.record.origin.taskId&&linked.includes(e.record.origin.taskId)))fail('ARCHITECTURE_DECISION_REQUIRED');if(b.targetRef!==p.targetRef||b.head!==run.expectedHead)fail('EXTERNAL_BASELINE_CHANGE');
  let expected=p.baselineCommit;if(new Set(run.promotions.map(p=>p.taskId)).size!==run.promotions.length)fail('EXTERNAL_BASELINE_CHANGE');
  for(const effect of run.promotions){if(effect.previousHead!==expected||!(this.promotionFromRun(run,effect)||effect.previousHead===effect.resultingHead&&this.noOpBinding(effect.taskId).baseCommit===effect.previousHead)||!this.decisions().some(a=>a.decision==='ALLOWED'&&a.runId===run.runId&&a.actionKind==='candidate-promotion'&&((a.subject as any)?.proposal?.taskId===effect.taskId&&(a.subject as any)?.proposal?.integrationCommit===effect.resultingHead||(a.subject as any)?.noOp?.taskId===effect.taskId&&(a.subject as any)?.noOp?.binding?.baseCommit===effect.resultingHead)))fail('EXTERNAL_BASELINE_CHANGE');expected=effect.resultingHead;}
  if(expected!==run.expectedHead)fail('EXTERNAL_BASELINE_CHANGE');return p;}
 private checkSpec(p:ProjectAutonomyPolicy,id:string,spec:TaskSpec){const task=this.planning().current()!.plannedTasks.find(t=>t.plannedTaskId===id),bound=p.taskBounds.find(t=>t.plannedTaskId===id);
  if((['beforeImplementation','onScopeChange','onOracleDecision','beforeCompletion','onRetryExhausted'] as const).some(flag=>spec.humanGates[flag]!==true))fail('UNRESOLVED_RISK');
  if(!task||!bound||spec.objective!==task.objective||!same(spec.acceptanceCriteria.map(c=>c.text),task.acceptanceIntent))fail('UNRESOLVED_RISK');
  if(!validateStructure('TaskSpec',spec).ok||hashContract('TaskSpec',spec)!==spec.specHash||!spec.scope.allowedPaths.length||spec.scope.repoRoot!==this.repoRoot||spec.scope.allowedPaths.some(path=>!pathContained(path,bound.allowedPaths,bound.protectedPaths))
   ||bound.protectedPaths.some(path=>!spec.scope.deniedPaths.includes(path)))fail('OUT_OF_SCOPE');
  if(!same(spec.validationCommands,bound.validationCommands))fail('UNRESOLVED_RISK');
 }
 assertTaskEligible(runId:string,plannedTaskId:string,spec:TaskSpec):void{const run=this.run(runId);if(run.status!=='ACTIVE')fail('MANUAL_PAUSE');this.checkSpec(this.assertCurrent(run),plannedTaskId,spec);
  if(!this.decisions().some(a=>a.kind==='PolicyDerivedAuthorization'&&a.runId===runId&&a.actionKind==='TaskSpec'&&(a.subject as any)?.plannedTaskId===plannedTaskId&&(a.subject as any)?.spec?.taskId===spec.taskId))fail('OUT_OF_SCOPE');}
 private completionAdmission(runId:string,taskId:string,specHash:string):boolean{return this.decisions().some(a=>a.kind==='PolicyDerivedAuthorization'&&a.runId===runId&&a.actionKind==='beforeCompletion'&&(a.subject as any)?.spec?.taskId===taskId&&(a.subject as any)?.spec?.specHash===specHash)}
 private noOpBinding(taskId:string){const native=CandidatePromotionRepository.open(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection),binding=native?.binding(taskId);if(!binding||binding.candidateCommit!==binding.baseCommit||!binding.completedSpecHash||!native!.status(taskId).baselineReady)fail('UNRESOLVED_RISK');return binding;}
 authorize(runId:string,action:AutonomyAction,subject:Json):PolicyAuthorizationCapability {
  const check=()=>{const run=this.run(runId);if(run.status!=='ACTIVE'||run.pauseRequested&&action==='TaskSpec')fail('MANUAL_PAUSE');const p=this.assertCurrent(run);if(!p.actions.includes(action))fail('OUT_OF_SCOPE');const s=subject as any;
   if(action==='candidate-promotion'&&s.noOp){const binding=this.noOpBinding(s.noOp.taskId);if(!this.planning().links().some(l=>l.controlledTaskId===binding.taskId&&l.planDigest===p.plan.digest&&p.taskBounds.some(b=>b.plannedTaskId===l.plannedTaskId))||!same(binding,s.noOp.binding)||binding.targetRef!==p.targetRef||binding.baseCommit!==run.expectedHead||!this.completionAdmission(runId,binding.taskId,binding.completedSpecHash!))fail('OUT_OF_SCOPE');
   }else if(action==='candidate-promotion'){const prop=s.proposal,link=this.planning().links().find(l=>l.controlledTaskId===prop?.taskId&&l.planId===p.plan.planId&&l.planRevision===p.plan.revision&&l.planDigest===p.plan.digest);
    if(!link||!p.taskBounds.some(b=>b.plannedTaskId===link.plannedTaskId)||prop.projectId!==p.projectId||prop.targetRef!==p.targetRef||prop.targetHead!==run.expectedHead||!this.completionAdmission(runId,prop.taskId,prop.specHash)||prop.changedFiles.some((f:{path:string})=>!pathContained(f.path,p.taskBounds.find(b=>b.plannedTaskId===link.plannedTaskId)!.allowedPaths,p.taskBounds.find(b=>b.plannedTaskId===link.plannedTaskId)!.protectedPaths)))fail('OUT_OF_SCOPE');
   }else if(action==='integration-checkpoint'){const d=s.definition;if(!d||run.promotions.length!==p.taskBounds.length||d.projectId!==p.projectId||s.baseline.commit!==run.expectedHead||s.baseline.targetRef!==p.targetRef||!same(d.commands,p.finalCheckpoint.commands)||!same(d.validationIntent,p.finalCheckpoint.validationIntent)
     ||!same(d.validationPlan,p.finalCheckpoint.validationPlan)||d.plannedTaskRefs.length!==run.promotions.length||d.scenarios.length||!d.reviewRequired||d.controlledTaskRefs.length!==run.promotions.length||d.controlledTaskRefs.some((id:string)=>!run.promotions.some(t=>t.taskId===id))
     ||new Set(d.plannedTaskRefs.map((r:any)=>r.plannedTaskId)).size!==d.plannedTaskRefs.length||d.plannedTaskRefs.some((r:any)=>!same({planId:r.planId,revision:r.revision,digest:r.digest},p.plan)||!p.taskBounds.some(t=>t.plannedTaskId===r.plannedTaskId)||!this.planning().links().some(l=>l.plannedTaskId===r.plannedTaskId&&l.controlledTaskId===r.controlledTaskId&&l.planDigest===p.plan.digest)||!run.promotions.some(t=>t.taskId===r.controlledTaskId)))fail('OUT_OF_SCOPE');
   }else{this.checkSpec(p,s.plannedTaskId,s.spec);if(action!=='TaskSpec'&&!this.planning().links().some(l=>l.controlledTaskId===s.spec.taskId&&l.plannedTaskId===s.plannedTaskId&&l.planDigest===p.plan.digest))fail('OUT_OF_SCOPE');
    if(action==='beforeCompletion'){
      const memory=ProjectMemoryRepository.open(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection);
      if(memory?.entries().some(e=>e.record.recordKind!=='technical-lesson'&&e.record.status==='PROPOSED'&&e.record.origin.taskId===s.spec.taskId))fail('ARCHITECTURE_DECISION_REQUIRED');
      const ledger=DurableStore.load(join(this.store.root,'..','tasks',s.spec.taskId));
      if(!ledger.state.candidate)fail('UNRESOLVED_RISK');assertDependencyChanges(this.repoRoot,ledger.state.candidate.root,ledger.state.candidate.baseCommit,p.dependencyChanges);
    }
    if(action==='onScopeChange'&&(s.approvedData?.objective!==s.spec.objective||s.approvedData?.authorityChanges?.some((change:string)=>change!=='ALLOWED_PATHS_ADDED')||s.approvedData?.proposedRequirements===undefined||!same(s.approvedData.oldRequirements,s.approvedData.proposedRequirements)||!same(s.approvedData.oldDeniedPaths,s.approvedData.proposedDeniedPaths)||!same(s.approvedData.affectedAcceptanceCriteria?.old,s.approvedData.affectedAcceptanceCriteria?.proposed)||['constraints','validationCommands','acceptanceCriteria','requirements'].some(key=>s.approvedData.exactAdditions?.[key]?.length||s.approvedData.exactRemovals?.[key]?.length)||s.approvedData.proposedAllowedPaths.some((path:string)=>!pathContained(path,p.taskBounds.find(b=>b.plannedTaskId===s.plannedTaskId)!.allowedPaths,p.taskBounds.find(b=>b.plannedTaskId===s.plannedTaskId)!.protectedPaths))))fail('OUT_OF_SCOPE');}
   return {run,p};};
  try{const {run,p}=check(),s=this.snapshot(),approval=s.approvals.find(a=>same(a.policyRef,run.policyRef))!;
  const a:PolicyDerivedAuthorization={schemaVersion:1,kind:'PolicyDerivedAuthorization',authorizationId:`autonomy-decision-${randomUUID()}`,policyRef:run.policyRef,policyRevision:p.revision,policyDigest:p.contentDigest,policyApprovalRef:approval.ref,planApprovalRef:this.planning().approvalEvidence(p.plan.planId,p.plan.revision),resultingArtifactRefs:[],plan:p.plan,runId,actionKind:action,subject,subjectDigest:hashCanonical(subject),checks:[{name:'current-plan-policy-memory-and-baseline',passed:true},{name:'exact-action-inside-approved-bounds',passed:true}],decision:'ALLOWED',reason:"Action included in the approved plan and limits.",createdAt:now()};
  const ref=this.write(()=>{check();const latest=this.snapshot(),planning=this.planning();this.store.import(a.planApprovalRef,planning.store.read(a.planApprovalRef));const ref=this.put(a.authorizationId,a,POLICY_AUTHORIZATION_MEDIA);this.commit(latest.ref,{...latest.index,decisions:[...latest.index.decisions,ref]});return ref;});return issuePolicyCapability(this.store,ref,()=>{check();});
  }catch(error){const message=(error as Error).message,reason=INTERRUPTIONS.find(r=>message.includes(r))??'UNRESOLVED_RISK';
   this.write(()=>{const run=this.run(runId),s=this.snapshot(),ref=this.put(`eligibility-failure-${randomUUID()}`,{schemaVersion:1,kind:'AutonomyDecision',policyRef:run.policyRef,runId,actionKind:action,subject,decision:reason==='PROVIDER_TERMINALITY_UNKNOWN'?'BLOCK':'ESCALATE',checks:[{name:'exact-action-eligibility',passed:false}],reason:interruptionExplanation(reason),resultingArtifactRefs:[],createdAt:now()});this.commit(s.ref,{...s.index,decisions:[...s.index.decisions,ref]});});throw error;
  }
 }
 recordEffect(authorizationRef:ArtifactRef,resultingArtifactRefs:readonly ArtifactRef[],reader:{read(ref:ArtifactRef):Uint8Array}=this.store):void{
  this.write(()=>{const s=this.snapshot();if(!s.index.decisions.some(ref=>same(ref,authorizationRef)))fail('AUTONOMY_ARTIFACT_INVALID');const authorization=this.read<PolicyDerivedAuthorization>(authorizationRef);
   if(authorization.kind!=='PolicyDerivedAuthorization'||!resultingArtifactRefs.length||resultingArtifactRefs.length>64)fail('AUTONOMY_ARTIFACT_INVALID');
   const prior=s.index.effects.map(ref=>this.read<any>(ref)).find(effect=>same(effect.authorizationRef,authorizationRef));
   if(prior){if(!same(prior.resultingArtifactRefs,resultingArtifactRefs))fail('AUTONOMY_ARTIFACT_INVALID');return;}
   for(const ref of resultingArtifactRefs)this.store.import(ref,reader.read(ref));
   const value={schemaVersion:1,kind:'AutonomyActionResult',authorizationRef,runId:authorization.runId,actionKind:authorization.actionKind,subjectDigest:authorization.subjectDigest,resultingArtifactRefs,createdAt:now()},ref=this.put(`action-result-${authorization.authorizationId}`,value);
   this.commit(s.ref,{...s.index,effects:[...s.index.effects,ref]});});
 }
 /** Workflow revisions are task-local. Copies in the project store need the run/task domain,
  * without renaming the original or making content changes into new identities. */
 recordTaskStateEffect(authorizationRef:ArtifactRef,sourceRef:ArtifactRef):void {
  const authorization=readPolicyAuthorization(this.store,authorizationRef),subject=authorization.subject as any,spec=subject.spec;
  if(!['beforeImplementation','onScopeChange','beforeCompletion','beforeReviewerRedispatch'].includes(authorization.actionKind)
    ||!validateScalar('ID',subject.plannedTaskId).ok||!validateStructure('TaskSpec',spec).ok||hashContract('TaskSpec',spec)!==spec.specHash)fail('AUTONOMY_ARTIFACT_INVALID');
  // Select the source namespace from the verified authorization, never from a caller-supplied path.
  let raw:Uint8Array;
  try{raw=DurableStore.readArtifact(join(this.store.root,'..','tasks',spec.taskId),sourceRef)}
  catch(error){if((error as {code?:string}).code==='ENOENT')fail('STORE_ARTIFACT_INTEGRITY');throw error}
  const state=parseJson(raw,2*1024*1024) as any;
  if(!validateStructure('WorkflowState',state).ok||state.taskId!==spec.taskId||state.repoRoot!==this.repoRoot
    ||![spec.specHash,subject.proposedSpecHash].includes(state.specHash)
    ||![`state-r${state.revision}`,`state-r${state.revision}-${hashBytes(raw)}`].includes(sourceRef.id))fail('AUTONOMY_ARTIFACT_INVALID');
  const identity={runId:authorization.runId,plannedTaskId:subject.plannedTaskId,controlledTaskId:spec.taskId,artifactKind:'WorkflowState',localRevision:state.revision};
  const id=`autonomy-task-state-${hashCanonical(identity)}`,namespaced={...sourceRef,id,relativeStorePath:`artifacts/${id}`};
  const prior=this.effects().find(effect=>same(effect.authorizationRef,authorizationRef));
  // A valid old effect remains exact and recoverable. Never migrate, overwrite or reinterpret it.
  const ref=prior?.resultingArtifactRefs[0]??namespaced;
  if(prior&&(prior.resultingArtifactRefs.length!==1||!same(ref,sourceRef)&&!same(ref,namespaced)))fail('AUTONOMY_ARTIFACT_INVALID');
  this.recordEffect(authorizationRef,[ref],{read:requested=>{if(!same(requested,ref))fail('AUTONOMY_ARTIFACT_INVALID');return raw;}});
 }
 effects():readonly {authorizationRef:ArtifactRef;runId:string;actionKind:string;resultingArtifactRefs:readonly ArtifactRef[]}[]{return this.snapshot().index.effects.map(ref=>this.read<any>(ref))}
 decisionRef(id:string):ArtifactRef{const ref=this.snapshot().index.decisions.find(r=>r.id===id);if(!ref)fail('AUTONOMY_ARTIFACT_INVALID');return ref;}
 decisions():readonly AutonomyDecision[]{return this.snapshot().index.decisions.map(r=>this.read<AutonomyDecision>(r))}
 interruptions():readonly HumanInterruption[]{return this.snapshot().index.interruptions.map(r=>this.read<HumanInterruption>(r))}
 pause(runId:string,reason:InterruptionReason,phase:string,decisionNeeded:string):ProjectAutonomyRun {const r=this.run(runId);if(r.status==='CANCELLED'||r.status==='FINISHED')return r;
  return this.save({...r,revision:r.revision+1,status:'PAUSED',pauseRequested:false,interruption:{reason,phase,decisionNeeded:(phase.startsWith('task-execution:')?`Stopped during task ${phase.slice('task-execution:'.length)}. `:phase.startsWith('candidate-promotion:')?`Stopped during integration of ${phase.slice('candidate-promotion:'.length)}. `:phase==='integration-checkpoint'?"Stopped during final verification. ":'')+interruptionExplanation(reason),alreadyDone:r.promotions.map(p=>p.taskId),safeOptions:["Review the change","Update the plan","Stop the project"],mandatory:reason!=='MANUAL_PAUSE',detail:decisionNeeded,createdAt:now()}});}
 requestPause(runId:string):void{const r=this.run(runId);if(r.status==='ACTIVE')this.save({...r,revision:r.revision+1,pauseRequested:true})}
 resume(runId:string):void{const r=this.run(runId);if(r.status==='ACTIVE'){this.assertCurrent(r);return}if(r.status!=='PAUSED')fail('AUTONOMY_RESUME_INVALID');this.assertCurrent(r);this.save({...r,revision:r.revision+1,status:'ACTIVE',interruption:null,pauseRequested:false})}
 cancel(runId:string):void{const r=this.run(runId);if(r.status==='FINISHED'||r.status==='CANCELLED')return;this.save({...r,revision:r.revision+1,status:'CANCELLED',pauseRequested:false})}
 recordNoOp(runId:string,capability:PolicyAuthorizationCapability):void{const subject=capability.authorization.subject as any,binding=this.noOpBinding(subject.noOp?.taskId);consumePolicyCapability(capability,'candidate-promotion',subject,this.store);const r=this.run(runId);this.assertCurrent(r);if(r.promotions.some(p=>p.taskId===binding.taskId)||binding.baseCommit!==r.expectedHead)fail('PROMOTION_RESULT_UNVERIFIED');this.save({...r,revision:r.revision+1,promotions:[...r.promotions,{taskId:binding.taskId,previousHead:r.expectedHead,resultingHead:r.expectedHead}]});}
 recordPromotion(runId:string,result:{taskId:string;previousHead:string;resultingHead:string}):void {const r=this.run(runId),p=this.policy(r),b=this.baseline();
  if(r.status!=='ACTIVE'||result.previousHead!==r.expectedHead||b.head!==result.resultingHead||b.targetRef!==p.targetRef||!this.decisions().some(a=>a.decision==='ALLOWED'&&a.runId===runId&&a.actionKind==='candidate-promotion'&&(a.subject as any)?.proposal?.taskId===result.taskId&&(a.subject as any)?.proposal?.integrationCommit===result.resultingHead))fail('EXTERNAL_BASELINE_CHANGE');
  if(r.promotions.some(p=>p.taskId===result.taskId)||!this.promotionFromRun(r,result))fail('PROMOTION_RESULT_UNVERIFIED');
  this.save({...r,revision:r.revision+1,expectedHead:result.resultingHead,promotions:[...r.promotions,result]});}
 recoverProgress(runId:string,results:readonly {taskId:string;previousHead:string;resultingHead:string}[]):void{
  const r=this.run(runId),b=this.baseline();if(b.head===r.expectedHead)return;
  const matching=results.filter(v=>v.previousHead===r.expectedHead&&v.resultingHead===b.head);
  if(matching.length!==1)fail('EXTERNAL_BASELINE_CHANGE');this.recordPromotion(runId,matching[0]);
 }
 finish(runId:string,checkpointRef:ArtifactRef):void{const r=this.run(runId);this.assertCurrent(r);const proof=parseJson(this.store.read(checkpointRef),2*1024*1024) as any;
  const native=IntegrationCheckpointRepository.open(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection)?.runs().find(x=>same(x,proof));
  if(!native||!this.decisions().some(a=>a.runId===runId&&a.actionKind==='integration-checkpoint'&&same((a.subject as any)?.definitionRef,proof.definitionRef)))fail('CHECKPOINT_RESULT_UNVERIFIED');
  if(proof.outcome!=='PASS'||proof.baseline.commit!==r.expectedHead||r.promotions.length!==this.policy(r).taskBounds.length)fail('UNRESOLVED_RISK');this.save({...r,revision:r.revision+1,status:'FINISHED',finalCheckpointRef:checkpointRef});}
}
export const AUTONOMY_ACTION_LABELS:Readonly<Record<AutonomyAction,string>>={TaskSpec:"Formulate and start tasks after the Scout",beforeImplementation:"Develop and correct within budgets",onScopeChange:"Adapt scope within approved limits",beforeCompletion:"Complete tasks after successful tests and review",beforeReviewerRedispatch:"Retry a review only with proven termination", 'candidate-promotion':"Integrate verified results locally", 'integration-checkpoint':"Verify the final integrated baseline"};
export function policyNarrative(p:ProjectAutonomyPolicy):string{return `Controlled Autonomy\n\nIf you approve, pi-controlled-dev may complete ${p.taskBounds.length} tasks from the plan, in the approved order.\nBranch: ${p.targetRef.replace('refs/heads/','')}\n\nAuthorized scopes\n${p.taskBounds.map(b=>`${b.plannedTaskId}: ${b.allowedPaths.join(', ')}; protected: ${b.protectedPaths.join(', ')||"fixed system boundaries"}`).join('\n')}\n\nAuthorized operations\n${p.actions.map(a=>`✓ ${AUTONOMY_ACTION_LABELS[a]}`).join('\n')}\n\nAuthorized checks\n${[...new Set(p.taskBounds.flatMap(b=>b.validationCommands.map(c=>hostValidationRecipeName(c))))].join(', ')}. Independent review is mandatory.\n\nIt will stop for changes to the plan or architecture, additional scope, Git conflicts, unexpected dependencies, unresolved risks, exhausted budgets, an external baseline or uncertain provider identity.\nNo remote Git operations. You can pause or revoke authorization.\n\nSupervised mode remains available without this policy.`}
export interface AutonomyDriver {activity?():string|undefined;execute(plannedTaskId:string,runId:string):Promise<string>;promote(taskId:string,runId:string):Promise<void>;checkpoint(runId:string):Promise<void>;recover?(runId:string):Promise<void>}
/** Bounded project-level sequencing. No role internals, Git internals or task state mutations. */
export class ProjectAutonomyController {
 constructor(readonly repo:ProjectAutonomyRepository,readonly driver:AutonomyDriver){}
 async run(runId:string):Promise<ProjectAutonomyRun>{const manager=new LockManager(this.repo.store.agentDataRoot,`autonomy-controller-${randomUUID()}`,`autonomy-${randomUUID()}`);let lease:LockHandle,phase='recovery';
  try{lease=manager.acquireTask(runId,this.repo.repoRoot)}catch(error){if((error as {code?:string}).code!=='TASK_LOCK_UNAVAILABLE')throw error;const path=join(manager.root,'tasks',`${hashBytes(Buffer.from(`${manager.workspaceIdentity(this.repo.repoRoot).workspaceHash}\0${runId}`))}.lock`),st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>16384)throw error;manager.reclaimAutonomyTask(this.repo.repoRoot,JSON.parse(Buffer.from(readFileSync(path)).toString('utf8')) as LockRecord);lease=manager.acquireTask(runId,this.repo.repoRoot)}try{await this.driver.recover?.(runId);const limit=this.repo.policy(this.repo.run(runId)).taskBounds.length;
  for(let n=0;n<=limit;n++){const run=this.repo.run(runId);if(run.status!=='ACTIVE')return run;if(run.pauseRequested)return this.repo.pause(runId,'MANUAL_PAUSE','safe-boundary',"Development paused at your request.");
   phase='baseline';const policy=this.repo.assertCurrent(run),views=this.repo.planning().progress(),pending=views.filter(v=>policy.taskBounds.some(b=>b.plannedTaskId===v.task.plannedTaskId)&&!run.promotions.some(p=>v.links.some(l=>l.controlledTaskId===p.taskId)));
   if(!pending.length){phase='integration-checkpoint';await this.driver.checkpoint(runId);return this.repo.run(runId)}
   const next=pending.find(v=>v.links.some(l=>l.planDigest===policy.plan.digest))??pending.find(v=>v.status==='READY');if(!next)fail('UNRESOLVED_RISK');phase=`task-execution:${next.task.plannedTaskId}`;const taskId=await this.driver.execute(next.task.plannedTaskId,runId);phase=`candidate-promotion:${next.task.plannedTaskId}`;await this.driver.promote(taskId,runId);
  }fail('RETRY_EXHAUSTED');
 }catch(error){const message=(error as Error).message,reason=INTERRUPTIONS.find(r=>message.includes(r))??(/CONFLICT/.test(message)?'MERGE_CONFLICT':/TERMINAL|UNKNOWN|PROVIDER/.test(message)?'PROVIDER_TERMINALITY_UNKNOWN':'UNRESOLVED_RISK');return this.repo.pause(runId,reason,phase,message);}finally{manager.release(lease)}}
}

export function interruptionExplanation(reason:InterruptionReason):string{
 const text:Record<InterruptionReason,string>={PLAN_CHANGE_REQUIRED:"The approved plan changed. The plan and authorization need review.",OUT_OF_SCOPE:"The next change requires a part of the project outside the authorized limits.",ARCHITECTURE_DECISION_REQUIRED:"An architectural decision, convention or constraint emerged or changed. Your decision is required in project memory.",MERGE_CONFLICT:"Integration encountered a Git conflict. The destination is preserved: a decision is required on how to proceed.",EXTERNAL_BASELINE_CHANGE:"The branch or official folder changed outside the authorized sequence. Existing changes are preserved.",RETRY_EXHAUSTED:"Corrections or planned attempts exhausted the budget. A decision is required on the next step.",PROVIDER_TERMINALITY_UNKNOWN:"Termination of the previous process cannot be proven. Evidence must be recovered before starting other roles.",UNRESOLVED_RISK:"Evidence is missing or a risk or ambiguity remains. Consult task details before authorizing more work.",UNEXPECTED_DEPENDENCY:"An unexpected dependency or unverifiable manifest was found. Your decision is required.",POLICY_REVOKED:"Authorization is revoked or superseded. New approval is required before continuing.",MANUAL_PAUSE:"Development paused at your request. You may resume if the bindings remain valid."};return text[reason];
}
