import { currentValidationEvidence } from './contract-semantic.js';
import { contextInvestigationScopeDigest } from './context-investigation.js';
import { projectIdentity } from './project-identity.js';
import { physicalProjectRootForTask } from './project-storage.js';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { dirname, join } from 'node:path';
import { lstatSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { canonicalize, hashCanonical, hashBytes, parseJson, validateScalar, validateStructure } from './contracts.js';
import type { ArtifactRef, TaskSpec, WorkflowState, CandidateManifest, ValidationResult } from './contracts.js';
import { DurableStore } from './store.js';
import type { ArtifactInspection } from './store.js';
import { LockManager } from './lock-manager.js';
import type { LockHandle } from './lock-manager.js';
import { inventoryTree, inventoryHash } from './controlled-agent-runtime.js';
import { workspaceManifest } from './scope-guard.js';
import { selectProjectMemory, prepareMemoryContext } from './project-memory-context.js';
import type { MemorySelection } from './project-memory-context.js';
import { ProjectMemoryRepository } from './project-memory-repository.js';
import { CandidatePromotionRepository } from './candidate-promotion-repository.js';
import type { IntegrationStatus } from './candidate-promotion.js';
import { freezeMemory, validateMemoryReference, validateMemoryRecord, MEMORY_CONTEXT_MEDIA } from './project-memory.js';
import { createTrustedConfirmationRequest, presentTrustedConfirmation, consumeTrustedConfirmation, readTrustedConfirmationEvidence } from './trusted-confirmation.js';
import type { TrustedConfirmationRequest, TrustedConfirmationReceipt, HumanConfirmationChannel } from './trusted-confirmation.js';
import { projectExecutionReason, projectTaskStatusLabel, PLANNING_MEDIA, PLANNING_LIMITS, validateGoal, validatePlan, validatePlanProposal, goalDigest, planDigest, taskMeaning, planNarrative, projectTaskHints, planningError, validatePlanningPortability } from './project-planning.js';
import type { ProjectGoal, ProjectPlan, PlanProposal, PlanningInputReceipt, PlannedTaskExecutionLink, ProjectTaskStatus, PlannedTask, GoalClarification } from './project-planning.js';
import { materializeRefinement } from './project-planning-scout.js';
import type { RefinementBinding, PlanningRefinementOutput } from './project-planning-scout.js';

interface PlanningIndex {schemaVersion:1;projectId:string;revision:number;goals:ArtifactRef[];plans:ArtifactRef[];inputs:ArtifactRef[];approvals:ArtifactRef[];links:ArtifactRef[];current:ArtifactRef|null}
export interface PlanningOptions {readonly create?:boolean;readonly manager?:LockManager;readonly workspaceLock?:LockHandle;readonly now?:()=>string;readonly memory?:ProjectMemoryRepository}
export interface ProjectTaskView {readonly task:PlannedTask;readonly status:ProjectTaskStatus;readonly explanation:string;readonly links:readonly PlannedTaskExecutionLink[];readonly integrationStatus?:IntegrationStatus;readonly baselineReady?:boolean;readonly reworkAttempts?:number}
export interface PlanningAnalysis {readonly proposal:PlanProposal;readonly analysis:unknown;readonly memorySelection?:MemorySelection;readonly memoryContextRef?:ArtifactRef}
export interface PlanningClarificationAnalysis {readonly clarificationQuestions:readonly Omit<GoalClarification,'answer'>[];readonly analysis:unknown}
export interface PlannedTaskSeed {readonly rationale?:string;readonly objective:string;readonly hints:readonly string[];readonly designContext?:string}
interface StartBinding {plan:ProjectPlan;task:PlannedTask;baseline:ReturnType<ProjectPlanningRepository['baseline']>}
const investigationSeedBindings=new WeakMap<object,Readonly<{subjectId:string;scopeDigest:string}>>();
/** Host binding only; a JSON seed never acquires the registered planning identity. */
export function plannedSeedInvestigationBinding(seed:PlannedTaskSeed):Readonly<{subjectId:string;scopeDigest:string}>{
  const binding=investigationSeedBindings.get(seed);if(!binding)planningError('PROJECT_EXECUTION_AUTHORITY');return binding;
}
const equal=(a:unknown,b:unknown)=>canonicalize(a)===canonicalize(b);
const refinementOwners=new WeakMap<object,ProjectPlanningRepository>();
/** A document namespace using the existing DurableStore and workspace LockManager.
 * One atomic index publishes drafts, trusted approvals and execution links. No task state is persisted here. */
export class ProjectPlanningRepository {
  readonly projectId:string;readonly projectRoot:string;
  readonly #approvals=new WeakMap<object,{base:ArtifactRef|undefined;plan:ProjectPlan;ref:ArtifactRef}>();
  readonly #starts=new WeakMap<object,StartBinding>();
  private constructor(readonly store:DurableStore,readonly repoRoot:string,readonly options:PlanningOptions){
    this.projectId=projectIdentity(repoRoot);this.projectRoot=dirname(store.root);this.#snapshot();
  }
  static open(dataRoot:string,repoRoot:string,inspect:ArtifactInspection,options:PlanningOptions={}):ProjectPlanningRepository|undefined{
    const open=()=>{const store=DurableStore.project(dataRoot,repoRoot,'planning',inspect,options.create===true);return store?new ProjectPlanningRepository(store,repoRoot,options):undefined};
    if(!options.create)return open();
    const manager=options.manager??new LockManager(dataRoot,'project-planning-host',`planning-${randomUUID()}`),lock=options.workspaceLock??manager.acquireWorkspace(repoRoot);
    try{if(!manager.verifyWorkspaceLock(lock)||lock.record.workspaceHash!==hashBytes(Buffer.from(repoRoot)))planningError('PROJECT_PLANNING_LOCK_REQUIRED');return open()}
    finally{if(!options.workspaceLock)manager.release(lock)}
  }
  #write<T>(action:()=>T):T{
    const manager=this.options.manager??new LockManager(this.store.agentDataRoot,'project-planning-host',`planning-${randomUUID()}`),lock=this.options.workspaceLock??manager.acquireWorkspace(this.repoRoot);
    try{if(!manager.verifyWorkspaceLock(lock)||lock.record.workspaceHash!==manager.workspaceIdentity(this.repoRoot).workspaceHash)planningError('PROJECT_PLANNING_LOCK_REQUIRED');return action()}
    finally{if(!this.options.workspaceLock)manager.release(lock)}
  }
  #now(){return this.options.now?.()??new Date().toISOString()}
  #read(ref:ArtifactRef,max:number=PLANNING_LIMITS.payloadBytes):any{
    if(!validateStructure('ArtifactRef',ref).ok||ref.mediaType!==PLANNING_MEDIA||ref.relativeStorePath!==`artifacts/${ref.id}`)planningError('PROJECT_PLANNING_ARTIFACT');
    const raw=this.store.read(ref),value=parseJson(raw,max);if(hashCanonical(value)!==ref.digest)planningError('PROJECT_PLANNING_ARTIFACT');return value;
  }
  #put(id:string,value:unknown):ArtifactRef{validatePlanningPortability(value);return this.store.put(id,canonicalize(value),PLANNING_MEDIA)}
  #index():{ref:ArtifactRef|undefined;value:PlanningIndex}{
    const ref=this.store.readProjectIndex();if(!ref)return {ref,value:{schemaVersion:1,projectId:this.projectId,revision:0,goals:[],plans:[],inputs:[],approvals:[],links:[],current:null}};
    const v=this.#read(ref,PLANNING_LIMITS.indexBytes) as PlanningIndex;
    if(Object.keys(v).sort().join(',')!=='approvals,current,goals,inputs,links,plans,projectId,revision,schemaVersion'||v.schemaVersion!==1||v.projectId!==this.projectId||!Number.isSafeInteger(v.revision)||v.revision<1)planningError('PROJECT_PLAN_INDEX');
    for(const key of ['goals','plans','inputs','approvals','links'] as const){const refs=v[key];
      if(!Array.isArray(refs)||refs.length>(key==='links'?PLANNING_LIMITS.links:PLANNING_LIMITS.revisions)||new Set(refs.map(r=>r.id)).size!==refs.length)planningError('PROJECT_PLAN_INDEX');
      for(const r of refs)if(!validateStructure('ArtifactRef',r).ok)planningError('PROJECT_PLAN_INDEX');
    }
    if(v.current!==null&&!v.plans.some(r=>equal(r,v.current)))planningError('PROJECT_PLAN_INDEX');return {ref,value:v};
  }
  #snapshot(){
    const snap=this.#index(),i=snap.value,goals=i.goals.map(r=>validateGoal(this.#read(r))),plans=i.plans.map(r=>validatePlan(this.#read(r)));
    for(const [n,g] of goals.entries()){
      if(g.projectId!==this.projectId||i.goals[n].id!==`${g.goalId}-r${g.revision}`)planningError('PROJECT_GOAL_IDENTITY');
      for(const ref of g.contextEvidenceRefs??[])this.#read(ref);
    }
    for(const [n,p] of plans.entries()){
      if(p.projectId!==this.projectId||p.status!=='DRAFT'||i.plans[n].id!==`${p.planId}-r${p.revision}`||!i.goals.some(r=>equal(r,p.projectGoalRef)))planningError('PROJECT_PLAN_IDENTITY');
      if(n===0?(p.revision!==1||p.supersedes!==null):(p.planId!==plans[0].planId||p.revision!==plans[n-1].revision+1))planningError('PROJECT_PLAN_REVISION');
      if(p.supersedes&&!i.plans.slice(0,n).some(r=>equal(r,p.supersedes)))planningError('PROJECT_PLAN_SUPERSESSION');
      for(const old of plans.slice(0,n))for(const task of p.plannedTasks){const prior=old.plannedTasks.find(t=>t.plannedTaskId===task.plannedTaskId);
        if(prior&&taskMeaning(prior)!==taskMeaning(task))planningError('PROJECT_PLAN_IDENTITY_CHANGED');}
    }
    if(i.inputs.length!==plans.length)planningError('PROJECT_PLAN_INPUT_MISSING');
    for(const [n,ref] of i.inputs.entries()){
      const r=this.#read(ref) as PlanningInputReceipt,p=plans[n],goal=goals[i.goals.findIndex(g=>equal(g,p.projectGoalRef))];
      if(Object.keys(r).sort().join(',')!=='baselineCommit,baselineInventoryDigest,goalDigest,goalRef,memoryContextRef,memoryRefs,planDigest,planRef,schemaVersion,scoutAnalysisRef'
        ||r.schemaVersion!==1||!equal(r.planRef,i.plans[n])||r.planDigest!==p.contentDigest||!equal(r.goalRef,p.projectGoalRef)||r.goalDigest!==goal.contentDigest
        ||!validateScalar('GitOID',r.baselineCommit).ok||!validateScalar('Hash',r.baselineInventoryDigest).ok||!Array.isArray(r.memoryRefs)||r.memoryRefs.length>8)planningError('PROJECT_PLAN_INPUT_INVALID');
      for(const memory of r.memoryRefs)validateMemoryReference(memory);
      this.#read(r.scoutAnalysisRef);
      const used=[...goal.relatedMemoryRefs,...p.plannedTasks.flatMap(t=>t.relevantMemoryRefs),...(p.memoryProposals??[]).flatMap(m=>m.relatedRecordRefs)];
      if(used.some(m=>!r.memoryRefs.some(selected=>equal(selected,m))))planningError('PROJECT_PLAN_MEMORY_BINDING');
      if(r.memoryContextRef){const memory=ProjectMemoryRepositoryForReceipt(this.store,r.memoryContextRef,this.repoRoot);if(!equal(memory,r.memoryRefs))planningError('PROJECT_PLAN_MEMORY_BINDING')}
      else if(r.memoryRefs.length)planningError('PROJECT_PLAN_MEMORY_BINDING');
    }
    const approved=new Set<string>();let previous:ArtifactRef|null=null;
    for(const a of i.approvals){
      const raw=parseJson(this.store.read(a),135168) as any,verified=readTrustedConfirmationEvidence(this.store,a,raw.request),payload=verified.request.payload as any;
      const n=i.plans.findIndex(r=>equal(r,payload.planRef)),p=plans[n];
      if(!p||verified.receipt.purpose!=='project-plan-approval'||verified.receipt.decision!=='APPROVE'||verified.request.subjectId!==p.planId
        ||verified.request.subjectRevision!==p.revision||!equal(payload.plan,p)||!equal(p.supersedes,previous)||approved.has(i.plans[n].id)
        ||(previous&&p.revision<=plans[i.plans.findIndex(r=>equal(r,previous))].revision))planningError('PROJECT_PLAN_APPROVAL_INVALID');
      approved.add(i.plans[n].id);previous=i.plans[n];
    }
    if(!equal(previous,i.current))planningError('PROJECT_PLAN_APPROVAL_MISSING');
    const links=i.links.map(r=>this.#read(r) as PlannedTaskExecutionLink),taskIds=new Set<string>();
    for(const link of links){
      const p=plans.find(p=>p.planId===link.planId&&p.revision===link.planRevision),task=p?.plannedTasks.find(t=>t.plannedTaskId===link.plannedTaskId);
      if(Object.keys(link).sort().join(',')!=='baselineCommit,controlledTaskId,createdAt,planDigest,planId,planRevision,plannedTaskDigest,plannedTaskId,projectId,schemaVersion,specHash'
        ||link.schemaVersion!==1||link.projectId!==this.projectId||!p||!task||!approved.has(`${p.planId}-r${p.revision}`)||p.contentDigest!==link.planDigest||hashCanonical(task)!==link.plannedTaskDigest
        ||!validateScalar('ID',link.controlledTaskId).ok||!validateScalar('Hash',link.specHash).ok||!validateScalar('GitOID',link.baselineCommit).ok||!validateScalar('Time',link.createdAt).ok||taskIds.has(link.controlledTaskId))planningError('PROJECT_EXECUTION_LINK_INVALID');
      taskIds.add(link.controlledTaskId);
    }
    if(new Set(links.map(l=>l.plannedTaskId)).size!==links.length)planningError('PROJECT_DUPLICATE_EXECUTION');
    return { ...snap,goals,plans:plans.map((p,n)=>freezeMemory({...p,status:equal(i.current,i.plans[n])?'APPROVED' as const:approved.has(i.plans[n].id)?'SUPERSEDED' as const:'DRAFT' as const})),links};
  }
  #commit(base:ArtifactRef|undefined,value:PlanningIndex){const next={...value,revision:value.revision+1};
    if(byteLengthCanonical(next)>PLANNING_LIMITS.indexBytes)planningError('PROJECT_PLANNING_LIMIT');this.store.replaceProjectIndex(base,this.#put(`planning-index-${hashCanonical(next)}`,next));}
  history():readonly ProjectPlan[]{return freezeMemory(this.#snapshot().plans)}
  current():ProjectPlan|undefined{return this.history().find(p=>p.status==='APPROVED')}
  goals():readonly ProjectGoal[]{return freezeMemory(this.#snapshot().goals)}
  links():readonly PlannedTaskExecutionLink[]{return freezeMemory(this.#snapshot().links)}
  inputs():readonly PlanningInputReceipt[]{return freezeMemory(this.#snapshot().value.inputs.map(r=>this.#read(r)))}
  /** Recover the bound delta as feedback, retaining the approved base. A draft
   * never becomes the authority for another refinement, including after reopen. */
  prepareRefinementCorrection(revision:number):{previous:ProjectPlan;binding:RefinementBinding;proposal:PlanningRefinementOutput}|undefined{
    const plan=this.history().find(p=>p.revision===revision),input=plan&&this.inputs().find(i=>i.planDigest===plan.contentDigest);
    if(!plan||plan.status!=='DRAFT'||!input)planningError('PROJECT_PLAN_INPUT_MISSING');
    const proposal=(this.#read(input.scoutAnalysisRef) as {refinement?:PlanningRefinementOutput}).refinement;
    if(!proposal)return;
    const binding=this.prepareRefinement(proposal.previousPlanDigest,proposal.targetTaskId),previous=this.current()!;
    return Object.freeze({previous,binding,proposal:freezeMemory(proposal)});
  }
  refinementNarrative(revision:number):string{
    const plan=this.history().find(p=>p.revision===revision),input=plan&&this.inputs().find(i=>i.planDigest===plan.contentDigest);
    if(!input)return '';
    const analysis=this.#read(input.scoutAnalysisRef) as {refinement?:PlanningRefinementOutput},refinement=analysis.refinement;
    if(!refinement)return '';
    const previous=this.history().find(p=>p.contentDigest===refinement.previousPlanDigest),target=previous?.plannedTasks.find(t=>t.plannedTaskId===refinement.targetTaskId);
    if(!target)planningError('PROJECT_REFINEMENT_BINDING');
    return `Proposed refinement\nPrevious task: ${target.title}\n${target.objective}\nPrevious scope: ${target.scopeIntent.join('; ')}\nReason for splitting: ${refinement.explanation}\n\nProposed coverage, to be assessed: it is not evidence of execution or correctness.\n`+
      refinement.coverage.map(c=>`${c.acceptanceIndex+1}. ${target.acceptanceIntent[c.acceptanceIndex]}\nResults: ${c.taskIds.map(id=>refinement.replacementTasks.find(t=>t.plannedTaskId===id)?.title??id).join('; ')}\nRationale: ${c.rationale}`).join('\n\n')+'\n\n';
  }
  #checkRefinementPlan(plan:ProjectPlan):void{
    const input=this.inputs().find(i=>i.planDigest===plan.contentDigest);
    if(!input)planningError('PROJECT_PLAN_INPUT_MISSING');
    const refinement=(this.#read(input.scoutAnalysisRef) as {refinement?:PlanningRefinementOutput}).refinement;
    if(refinement)this.prepareRefinement(refinement.previousPlanDigest,refinement.targetTaskId);
  }
  /** A fresh, read-only host check. No task, approval, execution link or counter is changed. */
  prepareRefinement(previousPlanDigest:string,targetTaskId:string):RefinementBinding{
    const current=this.current(),latestGoal=this.goals().at(-1);
    if(!current||current.status!=='APPROVED'||current.contentDigest!==previousPlanDigest
      ||!latestGoal||current.projectGoalRef.id!==`${latestGoal.goalId}-r${latestGoal.revision}`)planningError('PROJECT_REFINEMENT_STALE');
    if(!current.plannedTasks.some(t=>t.plannedTaskId===targetTaskId))planningError('PROJECT_REFINEMENT_BINDING');
    const affected=new Set([targetTaskId]);let added=true;
    while(added){added=false;for(const task of current.plannedTasks)if(!affected.has(task.plannedTaskId)&&task.dependsOn.some(id=>affected.has(id))){affected.add(task.plannedTaskId);added=true;}}
    if(this.links().some(link=>affected.has(link.plannedTaskId)))planningError('PROJECT_REFINEMENT_LINKED');
    const binding=freezeMemory({previousPlanDigest,targetTaskId});refinementOwners.set(binding,this);return binding;
  }
  static verifyPreparedRefinement(binding:RefinementBinding,repoRoot:string):void{
    const owner=refinementOwners.get(binding);
    if(!owner||owner.repoRoot!==realpathSync(repoRoot))planningError('PROJECT_REFINEMENT_NOT_PREPARED');
    owner.prepareRefinement(binding.previousPlanDigest,binding.targetTaskId);
  }
  createGoal(objective:string,title=objective.slice(0,120),constraints:readonly string[]=[],successIntent:readonly string[]=[objective]):ProjectGoal{
    return this.#write(()=>{const {ref,value}=this.#snapshot();if(value.goals.length>=256)planningError('PROJECT_PLANNING_LIMIT');
      const material={schemaVersion:1 as const,projectId:this.projectId,goalId:`goal-${randomUUID()}`,revision:1,title,objective,constraints,successIntent,relatedMemoryRefs:[],createdAt:this.#now()};
      const goal=validateGoal({...material,contentDigest:goalDigest(material)});this.#commit(ref,{...value,goals:[...value.goals,this.#put(`${goal.goalId}-r1`,goal)]});return goal;});
  }
  baseline(requireClean=false){
    const commit=execFileSync('git',['-C',this.repoRoot,'rev-parse','--verify','HEAD'],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}).trim();
    if(requireClean&&execFileSync('git',['-C',this.repoRoot,'status','--porcelain=v1','--untracked-files=all'],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}).trim())planningError('PROJECT_BASELINE_DIRTY');
    return {commit,inventoryDigest:inventoryHash(inventoryTree(this.repoRoot,['.git','node_modules']))};
  }
  saveClarifications(goal:ProjectGoal,clarifications:readonly GoalClarification[],analysis?:unknown):ProjectGoal{
    return this.#write(()=>{const s=this.#snapshot(),latest=s.goals.findLast(g=>g.goalId===goal.goalId);
      if(!latest||latest.contentDigest!==goal.contentDigest)planningError('PROJECT_GOAL_STALE');
      if(s.goals.length>=PLANNING_LIMITS.revisions)planningError('PROJECT_PLANNING_LIMIT');
      const {contentDigest,...previous}=latest,material={...previous,revision:latest.revision+1,clarifications,...(analysis!==undefined?{contextEvidenceRefs:[...(latest.contextEvidenceRefs??[]),this.#put(`planning-context-${hashCanonical(analysis)}`,analysis)]}:{})};
      const next=validateGoal({...material,contentDigest:goalDigest(material)});
      this.#commit(s.ref,{...s.value,goals:[...s.value.goals,this.#put(`${next.goalId}-r${next.revision}`,next)]});return next;
    });
  }
  planningMemory(goal:ProjectGoal,memory?:ProjectMemoryRepository):MemorySelection|undefined{
    const files=[...inventoryTree(this.repoRoot,['.git','node_modules'])].filter(([,kind])=>kind.startsWith('f\t')).map(([path])=>path);
    return memory?selectProjectMemory(memory,{taskId:goal.goalId,role:'Scout',assignmentId:`planning-${goal.goalId}`,objective:goal.objective,files}):undefined;
  }
  propose(goalId:string,result:PlanningAnalysis,baseline:ReturnType<ProjectPlanningRepository['baseline']>):ProjectPlan{
    const submitted=validatePlanProposal(result.proposal);
    return this.#write(()=>{const s=this.#snapshot(),{ref,value}=s,goalIndex=s.goals.findLastIndex(g=>g.goalId===goalId),goal=s.goals[goalIndex];if(!goal)planningError('PROJECT_GOAL_NOT_FOUND');
      if(goal.clarifications?.some(q=>q.answer===null))planningError('PROJECT_CONTEXT_INCOMPLETE');
      const analyzedGoal=(result.analysis as {goalDigest?:unknown}|null)?.goalDigest;if(analyzedGoal!==undefined&&analyzedGoal!==goal.contentDigest)planningError('PROJECT_GOAL_STALE');
      if(!equal(this.baseline(),baseline))planningError('PROJECT_PLAN_BASELINE_STALE');if(value.plans.length>=256)planningError('PROJECT_PLANNING_LIMIT');
      const refinement=(result.analysis as {refinement?:PlanningRefinementOutput}|null)?.refinement;
      if(refinement){
        const previous=s.plans.find(p=>p.status==='APPROVED'),analysis=result.analysis as {requestId?:unknown;requestHash?:unknown;previousPlanDigest?:unknown};
        this.prepareRefinement(refinement.previousPlanDigest,refinement.targetTaskId);
        if(analysis.requestId!==refinement.requestId||analysis.requestHash!==refinement.requestHash||analysis.previousPlanDigest!==refinement.previousPlanDigest)planningError('PROJECT_REFINEMENT_BINDING');
        if(refinement.replacementTasks.some(task=>s.plans.some(plan=>plan.plannedTasks.some(old=>old.plannedTaskId===task.plannedTaskId))))planningError('PROJECT_REFINEMENT_IDENTITY');
        const materialized=materializeRefinement(refinement,{goal,previous,selection:result.memorySelection,refinement:{previousPlanDigest:refinement.previousPlanDigest,targetTaskId:refinement.targetTaskId}});
        if(!equal(materialized,submitted))planningError('PROJECT_REFINEMENT_MATERIALIZATION');
      }
      const selected=result.memorySelection?.selected.map(s=>s.reference)??[];
      if(result.memorySelection&&(result.memorySelection.projectId!==this.projectId||result.memorySelection.role!=='Scout'))planningError('PROJECT_PLAN_MEMORY_BINDING');
      if([...submitted.plannedTasks.flatMap(t=>t.relevantMemoryRefs),...(submitted.memoryProposals??[]).flatMap(m=>m.relatedRecordRefs)].some(r=>!selected.some(s=>equal(s,r))))planningError('PROJECT_PLAN_MEMORY_BINDING');
      // Natural-language edits may change an increment while the model reuses its
      // label. Assign a fresh host identity instead of asking the user to repair
      // protocol IDs. Prior approvals and execution links stay with the old task.
      const replaced=new Map<string,string>();
      for(const task of submitted.plannedTasks)if(s.plans.some(old=>old.plannedTasks.some(prior=>prior.plannedTaskId===task.plannedTaskId&&taskMeaning(prior)!==taskMeaning(task))))
        replaced.set(task.plannedTaskId,`activity-${randomUUID()}`);
      const id=(value:string)=>replaced.get(value)??value;
      const proposal=validatePlanProposal({...submitted,plannedTasks:submitted.plannedTasks.map(task=>({...task,plannedTaskId:id(task.plannedTaskId),dependsOn:task.dependsOn.map(id),dependencyRationale:task.dependencyRationale.map(edge=>({...edge,plannedTaskId:id(edge.plannedTaskId)}))}))});
      const now=this.#now(),material={...proposal,schemaVersion:1 as const,projectId:this.projectId,planId:s.plans[0]?.planId??`plan-${randomUUID()}`,
        revision:value.plans.length+1,status:'DRAFT' as const,projectGoalRef:value.goals[goalIndex],createdAt:s.plans[0]?.createdAt??now,updatedAt:now,supersedes:value.current};
      const plan=validatePlan({...material,contentDigest:planDigest(material)}),planRef=this.#put(`${plan.planId}-r${plan.revision}`,plan);
      const scoutAnalysisRef=this.#put(`planning-analysis-${hashCanonical(result.analysis)}`,result.analysis);
      const memoryContextRef=result.memoryContextRef??(result.memorySelection?prepareMemoryContext(result.memorySelection,this.store).contextRef:null);
      const receipt:PlanningInputReceipt={schemaVersion:1,goalRef:plan.projectGoalRef,goalDigest:goal.contentDigest,baselineCommit:baseline.commit,baselineInventoryDigest:baseline.inventoryDigest,
        memoryRefs:selected,scoutAnalysisRef,memoryContextRef,planRef,planDigest:plan.contentDigest};
      this.#commit(ref,{...value,plans:[...value.plans,planRef],inputs:[...value.inputs,this.#put(`planning-input-${hashCanonical(receipt)}`,receipt)]});return plan;});
  }
  #freshMemory(plan:ProjectPlan):void{
    const input=this.inputs().find(r=>r.planDigest===plan.contentDigest),goal=this.goals().find(g=>g.contentDigest===input?.goalDigest)!;
    const memory=this.options.memory??ProjectMemoryRepository.open(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection);
    if(!memory){if(input?.memoryRefs.length)planningError('PROJECT_MEMORY_CONTEXT_STALE');return}
    const files=[...inventoryTree(this.repoRoot,['.git','node_modules'])].filter(([,kind])=>kind.startsWith('f\t')).map(([path])=>path);
    selectProjectMemory(memory,{taskId:goal.goalId,role:'Scout',assignmentId:`approval-${plan.planId}`,objective:goal.objective,files,requiredBinding:input?.memoryRefs});
  }
  prepareApproval(revision:number):TrustedConfirmationRequest{
    const s=this.#snapshot(),plan=s.plans.find(p=>p.revision===revision);if(!plan||plan.status!=='DRAFT'||!equal(plan.supersedes,s.value.current)||revision!==s.plans.at(-1)?.revision)planningError('PROJECT_PLAN_STALE');
    this.#freshMemory(plan);this.#checkRefinementPlan(plan);
    const ref=s.value.plans[s.plans.indexOf(plan)],goal=s.goals[s.value.goals.findIndex(r=>equal(r,plan.projectGoalRef))];
    if(s.goals.findLast(g=>g.goalId===goal.goalId)?.contentDigest!==goal.contentDigest)planningError('PROJECT_PLAN_CONTEXT_STALE');
    const request=createTrustedConfirmationRequest({purpose:'project-plan-approval',subjectKind:'ProjectPlan',subjectId:plan.planId,subjectRevision:revision,action:'APPROVE',
      payload:{projectId:this.projectId,baseDigest:s.ref?.digest??'0'.repeat(64),planRef:ref,plan} as any,
      presentation:{title:`Approve plan: ${goal.title}?`,content:`Objective\n${goal.objective}\nConstraints: ${goal.constraints.join('; ')||"no additional constraints"}\nExpected success: ${goal.successIntent.join('; ')}\n\n${this.refinementNarrative(revision)}${planNarrative(plan)}\n\nYou are approving the organization of the work. The precise request and checks will still be prepared before each task. In supervised mode, confirmation will be requested before proceeding. For automatic development, you must also approve Controlled Autonomy limits. Approving this plan does not change files or Git history.`}});
    this.#approvals.set(request,{base:s.ref,plan,ref});return request;
  }
  applyApproval(request:TrustedConfirmationRequest,receipt:TrustedConfirmationReceipt):ProjectPlan{
    const held=this.#approvals.get(request);if(!held)planningError('PROJECT_PLAN_APPROVAL_INVALID');this.#approvals.delete(request);
    return this.#write(()=>{const s=this.#snapshot();const fresh=()=>{if(!equal(this.#index().ref??null,held.base??null))planningError('PROJECT_PLAN_STALE');this.#freshMemory(held.plan);this.#checkRefinementPlan(held.plan);return request};
      const evidence=consumeTrustedConfirmation(receipt,fresh,this.store);this.#commit(s.ref,{...s.value,current:held.ref,approvals:[...s.value.approvals,evidence]});return this.current()!;});
  }
  async approve(ctx:HumanConfirmationChannel,revision:number):Promise<ProjectPlan|undefined>{const q=this.prepareApproval(revision),r=await presentTrustedConfirmation(ctx,q);
    if(!r){this.#approvals.delete(q);return}return this.applyApproval(q,r)}
  #linkedState(taskLink:PlannedTaskExecutionLink):WorkflowState|undefined{
    const root=join(this.projectRoot,'tasks',taskLink.controlledTaskId);
    if(!existsSync(root))return;
    const ledger=DurableStore.load(root),origin=ledger.records.find(r=>r.kind==='TaskSpec'&&r.id===ledger.state.spec.id);
    if(origin?.kind!=='TaskSpec'||ledger.state.taskId!==taskLink.controlledTaskId||physicalProjectRootForTask(root,origin.value.scope.repoRoot,ledger)!==this.repoRoot
      ||!ledger.records.some(r=>r.kind==='TaskSpec'&&r.value.taskId===taskLink.controlledTaskId&&r.value.specHash===taskLink.specHash))planningError('PROJECT_EXECUTION_LINK_INVALID');return ledger.state;
  }
  progress(plan=this.current()):readonly ProjectTaskView[]{
    if(!plan)return [];const links=this.links(),views=new Map<string,ProjectTaskView>(),promotion=CandidatePromotionRepository.open(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection);
    const visit=(task:PlannedTask):ProjectTaskView=>{const prior=views.get(task.plannedTaskId);if(prior)return prior;
      const linked=links.filter(l=>l.plannedTaskId===task.plannedTaskId),state=linked[0]?this.#linkedState(linked[0]):undefined;
      let status:ProjectTaskStatus,explanation:string;
      const integration=state?.state==='COMPLETED'&&promotion?.binding(state.taskId)?promotion.status(state.taskId):undefined;
      if(linked.length){status=!state?'ACTIVE':state.state==='COMPLETED'?'COMPLETED':state.state==='FAILED'?'FAILED':state.state==='BLOCKED'?'BLOCKED':'ACTIVE';
        const reason=state?projectExecutionReason(state):undefined,summary=status==='BLOCKED'?"The task is stopped and requires a decision.":status==='FAILED'?"The task ended without completion.":`This task is ${projectTaskStatusLabel(status)}.`;
        explanation=!state?"The task has been prepared and is waiting to start. If saving was interrupted, check the details before resuming.":`${summary}${reason?' '+reason:''}`;}
      else{const deps=task.dependsOn.map(id=>visit(plan.plannedTasks.find(t=>t.plannedTaskId===id)!)),waiting=deps.filter(d=>d.status!=='COMPLETED'||d.baselineReady===false);
        status=plan.status!=='APPROVED'||waiting.length?'WAITING':'READY';explanation=plan.status!=='APPROVED'?"The plan requires approval or has been superseded.":waiting.length?`Waiting for ${waiting.map(d=>`${d.task.title} (${projectTaskStatusLabel(d.status)})${d.baselineReady===false?": result awaiting project integration":['BLOCKED','FAILED'].includes(d.status)?': '+d.explanation:''}`).join('; ')}`:task.requiresRefinement?"You may proceed, but this work is still too broad. Choose Break down the work before starting it.":"Previous tasks are complete. Choose Continue the work to prepare this task and check the starting files.";}
      if(integration)explanation+=` ${integration.explanation}`;
      const value=freezeMemory({task,status,explanation,links:linked,...(state?{reworkAttempts:state.counters.reworkAttempts}:{}),...(integration?{integrationStatus:integration.status,baselineReady:integration.baselineReady}:{})});views.set(task.plannedTaskId,value);return value;};
    return freezeMemory(plan.plannedTasks.map(visit));
  }
  #checkBaseline(task:PlannedTask):void{
    const plan=this.current()!,links=this.links(),ancestry=new Map<string,Set<string>>(),promotion=CandidatePromotionRepository.open(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection);
    const ancestors=(id:string):Set<string>=>{const cached=ancestry.get(id);if(cached)return cached;
      const result=new Set<string>();for(const dep of plan.plannedTasks.find(t=>t.plannedTaskId===id)!.dependsOn){result.add(dep);for(const upstream of ancestors(dep))result.add(upstream)}
      ancestry.set(id,result);return result;};
    // Later prerequisites may legitimately supersede earlier file bytes. Compare the required
    // cumulative paths against the latest predecessor manifests, not against obsolete candidates.
    const frontier=task.dependsOn.filter(id=>!task.dependsOn.some(other=>other!==id&&ancestors(other).has(id)));
    const results=new Map<string,{manifest:CandidateManifest;paths:readonly string[]}>();
    const completed=(id:string)=>{
      const cached=results.get(id);if(cached)return cached;
      const link=links.find(l=>l.plannedTaskId===id),state=link?this.#linkedState(link):undefined;
      if(!state||state.state!=='COMPLETED'||!state.candidate)planningError(`PROJECT_BASELINE_NOT_READY: ${id}, completed result unavailable.`);
      if(promotion?.binding(state.taskId)&&!promotion.status(state.taskId).baselineReady)planningError(`PROJECT_BASELINE_NOT_READY: ${id}, result awaiting project integration.`);
      const ledger=DurableStore.load(join(this.projectRoot,'tasks',state.taskId)),read=(ref:ArtifactRef)=>{
        const r=ledger.records.find(r=>r.kind==='ArtifactRef'&&r.id===ref.id);if(r?.kind!=='ArtifactRef'||!equal(r.value,ref))planningError('PROJECT_BASELINE_NOT_READY');
        const path=join(this.projectRoot,'tasks',state.taskId,ref.relativeStorePath);if(realpathSync(path)!==path||!lstatSync(path).isFile())planningError('PROJECT_BASELINE_NOT_READY');
        const bytes=readFileSync(path);if(hashBytes(bytes)!==ref.digest||bytes.byteLength!==ref.bytes)planningError('PROJECT_BASELINE_NOT_READY');return parseJson(bytes,64*1024*1024) as any;};
      const manifest=read(state.candidate.manifest) as CandidateManifest,handoff=read(state.candidate.handoff);
      if(!validateStructure('CandidateManifest',manifest).ok||hashCanonical(manifest)!==state.candidate.digest||handoff.digest!==state.candidate.digest
        ||handoff.baseCommit!==state.candidate.baseCommit||handoff.generation!==state.candidate.generation||!Array.isArray(handoff.changes))planningError('PROJECT_BASELINE_NOT_READY');
      const paths:string[]=handoff.changes.flatMap((change:any)=>[change.path,...(change.fromPath?[change.fromPath]:[])]);
      if(paths.some(path=>!validateScalar('Path',path).ok))planningError('PROJECT_BASELINE_NOT_READY');
      const result={manifest,paths};results.set(id,result);return result;
    };
    for(const id of frontier){const link=links.find(l=>l.plannedTaskId===id);
      if(link&&promotion?.binding(link.controlledTaskId)){for(const upstream of [id,...ancestors(id)]){const dep=links.find(l=>l.plannedTaskId===upstream);if(dep&&promotion?.binding(dep.controlledTaskId)){if(!promotion.status(dep.controlledTaskId).baselineReady)planningError('PROJECT_BASELINE_NOT_READY')}else completed(upstream)}continue}
      const expected=completed(id),actual=new Map(workspaceManifest(this.repoRoot,expected.manifest.baseCommit).entries.map(e=>[e.path,e])),entries=new Map(expected.manifest.entries.map(e=>[e.path,e]));
      const paths=new Set([id,...ancestors(id)].flatMap(upstream=>completed(upstream).paths));
      for(const path of paths)if(!equal(actual.get(path)??null,entries.get(path)??null))planningError(`PROJECT_BASELINE_NOT_READY: ${id}, baseline missing result for ${path}. Apply the result through an explicit external decision before continuing.`);
    }
  }
  /** Process-local host capability. Selection alone never creates a TaskSpec or dispatches an agent. */
  approvalEvidence(planId:string,revision:number):ArtifactRef{const s=this.#snapshot(),ref=s.value.approvals.findLast(ref=>{const raw=parseJson(this.store.read(ref),135168) as any;return raw.request.subjectId===planId&&raw.request.subjectRevision===revision});if(!ref)planningError('PROJECT_PLAN_APPROVAL_MISSING');return ref;}
  /** Compact host-authenticated references, not model claims or copied runtime logs. */
  #prerequisiteHints(task:PlannedTask):readonly string[]{
    if(!task.dependsOn.length)return [];
    const links=this.links(),promotion=CandidatePromotionRepository.open(this.store.agentDataRoot,this.repoRoot,this.store.artifactInspection);
    const summaries=task.dependsOn.map(id=>{
      const link=links.find(l=>l.plannedTaskId===id),state=link?this.#linkedState(link):undefined;
      if(!state||state.state!=='COMPLETED'||!state.candidate)planningError('PROJECT_BASELINE_NOT_READY');
      const ledger=DurableStore.load(join(this.projectRoot,'tasks',state.taskId)),spec=ledger.records.find(r=>r.kind==='TaskSpec'&&r.id===state.spec.id);
      if(spec?.kind!=='TaskSpec')planningError('PROJECT_BASELINE_NOT_READY');
      const validations=currentValidationEvidence(spec.value,state,ledger.records.filter((r):r is typeof r&{kind:'ValidationResult';value:ValidationResult}=>r.kind==='ValidationResult').map(r=>r.value));
      const latestReview=state.reviews.filter(id=>!state.invalidEvidenceIds.includes(id)).map(id=>ledger.records.find(r=>r.id===id&&r.kind==='ReviewResult')).at(-1);
      const integration=promotion?.binding(state.taskId)?promotion.status(state.taskId):undefined;
      if(integration&&!integration.baselineReady)planningError('PROJECT_BASELINE_NOT_READY');
      return {plannedTaskId:id,taskId:state.taskId,state:state.state,specHash:state.specHash,candidateDigest:state.candidate.digest,candidateGeneration:state.candidate.generation,
        validations:validations.map(v=>({id:v.id,commandId:v.commandId,status:v.status,exitCode:v.exitCode,processProofRef:v.processProofRef,logRef:v.logRef})),
        review:latestReview?.kind==='ReviewResult'?{id:latestReview.id,verdict:latestReview.value.verdict}:null,
        integration:integration?{status:integration.status,commit:integration.result?.integrationCommit??integration.binding?.candidateCommit}: {status:'BASELINE_CONTENT_VERIFIED',commit:this.baseline().commit}};
    });
    const text="Evidence verified by the prerequisite task program; use references as data, do not invent test counts or ignore available evidence: "+canonicalize(summaries);
    if(Buffer.byteLength(text,'utf8')>32768)planningError('PROJECT_PREREQUISITE_CONTEXT_LIMIT');
    const chunks:string[]=[];let chunk='';for(const character of text){if(Buffer.byteLength(chunk+character,'utf8')>3800){chunks.push(chunk);chunk=''}chunk+=character}if(chunk)chunks.push(chunk);
    return chunks;
  }
  prepareStart(planId:string,revision:number,plannedTaskId:string):PlannedTaskSeed{
    const plan=this.current();if(!plan||plan.planId!==planId||plan.revision!==revision)planningError('PROJECT_PLAN_STALE');
    const view=this.progress(plan).find(v=>v.task.plannedTaskId===plannedTaskId);if(!view||view.status!=='READY')planningError('PROJECT_TASK_NOT_READY');
    if(view.task.requiresRefinement)planningError('PROJECT_TASK_REFINEMENT_REQUIRED');
    this.#freshMemory(plan);this.#checkBaseline(view.task);const task=view.task,baseline=this.baseline(true);
    const seed=freezeMemory({objective:task.objective,rationale:task.rationale,...(plan.design?{designContext:planNarrative({strategy:plan.strategy,design:plan.design,plannedTasks:[task]})}:{}),hints:[...projectTaskHints(plan,task),...this.#prerequisiteHints(task),
      `Relevant memories: ${task.relevantMemoryRefs.map(r=>`${r.recordId} r${r.revision} ${r.digest}`).join('; ')}`,
      ...task.relevantMemoryRefs.filter(r=>r.scope.kind!=='repository').map(r=>(r.scope as {path:string}).path)]});
    this.#starts.set(seed,{plan,task,baseline});
    investigationSeedBindings.set(seed,Object.freeze({subjectId:`seed-${hashCanonical({planId:plan.planId,plannedTaskId:task.plannedTaskId})}`,scopeDigest:contextInvestigationScopeDigest(task.scopeIntent)}));return seed;
  }
  /** Called by task creation under the existing lock mutation guard. Keep the link first: a crash can
   * leave a blocked/prepared link, never an unlinked executable input or a duplicate execution. */
  linkPreparedTask(seed:PlannedTaskSeed,spec:TaskSpec,manager:LockManager,underMutationGuard=false):PlannedTaskExecutionLink{
    const held=this.#starts.get(seed);if(!held||!underMutationGuard||manager.root!==join(this.store.agentDataRoot,'controlled-dev','locks'))planningError('PROJECT_EXECUTION_AUTHORITY');
    if(!existsSync(join(manager.root,'workspaces',`${manager.workspaceIdentity(this.repoRoot).workspaceHash}.guard`))||existsSync(join(manager.root,'workspaces',`${manager.workspaceIdentity(this.repoRoot).workspaceHash}.lock`)))planningError('PROJECT_PLANNING_LOCK_REQUIRED');
    const s=this.#snapshot(),current=this.current();if(!current||!equal(current,held.plan)||!equal(this.baseline(true),held.baseline))planningError('PROJECT_PLAN_STALE');
    if(this.progress(current).find(v=>v.task.plannedTaskId===held.task.plannedTaskId)?.status!=='READY')planningError('PROJECT_DUPLICATE_EXECUTION');
    this.#freshMemory(current);this.#checkBaseline(held.task);if(spec.scope.repoRoot!==this.repoRoot||spec.objective!==seed.objective||!validateStructure('TaskSpec',spec).ok)planningError('PROJECT_EXECUTION_SPEC');
    const execution:PlannedTaskExecutionLink={schemaVersion:1,projectId:this.projectId,planId:current.planId,planRevision:current.revision,planDigest:current.contentDigest,
      plannedTaskId:held.task.plannedTaskId,plannedTaskDigest:hashCanonical(held.task),controlledTaskId:spec.taskId,specHash:spec.specHash,baselineCommit:held.baseline.commit,createdAt:this.#now()};
    this.#commit(s.ref,{...s.value,links:[...s.value.links,this.#put(`planned-execution-${spec.taskId}`,execution)]});this.#starts.delete(seed);return freezeMemory(execution);
  }
}
function byteLengthCanonical(v:unknown){return Buffer.byteLength(canonicalize(v),'utf8')}
/** Context artifacts may live in either existing namespace; preserve relative refs only. */
function ProjectMemoryRepositoryForReceipt(store:DurableStore,ref:ArtifactRef,repoRoot:string){
  if(ref.mediaType!==MEMORY_CONTEXT_MEDIA||ref.bytes>262144)planningError('PROJECT_PLAN_MEMORY_BINDING');
  const memory=DurableStore.project(store.agentDataRoot,repoRoot,'memory',store.artifactInspection);
  let raw:Uint8Array;try{raw=store.read(ref)}catch{if(!memory)planningError('PROJECT_PLAN_MEMORY_BINDING');raw=memory.read(ref)}
  const context=parseJson(raw,262144) as any,{digest,...material}=context;
  if(hashCanonical(material)!==digest||context.projectId!==projectIdentity(repoRoot)||context.role!=='Scout'||context.totalBytes!==Buffer.byteLength(context.text,'utf8')||context.totalCharacters!==context.text.length||context.totalBytes>12288||context.totalCharacters>10000||!Array.isArray(context.selected)||context.selected.length>8)planningError('PROJECT_PLAN_MEMORY_BINDING');
  for(const selected of context.selected){validateMemoryReference(selected.reference);validateMemoryRecord(selected.record);
    if(selected.record.projectId!==context.projectId||selected.reference.recordId!==selected.record.recordId||selected.reference.revision!==selected.record.revision||selected.reference.digest!==selected.record.contentDigest)planningError('PROJECT_PLAN_MEMORY_BINDING');}
  return context.selected.map((s:any)=>s.reference);
}
