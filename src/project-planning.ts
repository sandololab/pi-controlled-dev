import { hashCanonical, canonicalize, copyJson, byteLength } from './contract-json.js';
import type { Issue } from './contract-json.js';
import { object, literal, list, scalars, integer, scalar, enumeration } from './contract-schema.js';
import type { Schema } from './contract-schema.js';
import { validateStructure } from './contracts.js';
import type { ArtifactRef, WorkflowState } from './contracts.js';
import { validateMemoryReference, validateMemoryProposal, memoryPresentation, freezeMemory } from './project-memory.js';
import type { ProjectMemoryReference, ProjectMemoryProposal } from './project-memory.js';

export const PLANNING_MEDIA='application/vnd.pi-controlled-dev.project-planning+json';
export const PLANNING_LIMITS=Object.freeze({payloadBytes:48000,indexBytes:2*1024*1024,revisions:256,tasks:64,links:512});
export interface ProjectGoal {readonly schemaVersion:1;readonly projectId:string;readonly goalId:string;readonly revision:number;
  readonly title:string;readonly objective:string;readonly constraints:readonly string[];readonly successIntent:readonly string[];
  readonly relatedMemoryRefs:readonly ProjectMemoryReference[];readonly createdAt:string;readonly contentDigest:string;
  readonly clarifications?:readonly GoalClarification[];readonly contextEvidenceRefs?:readonly ArtifactRef[]}
export interface GoalClarification {readonly questionId:string;readonly question:string;readonly why:string;readonly answer:string|null;readonly suggestedAnswer?:string}
export interface ProjectDesign {readonly context:string;readonly approach:string;readonly decisions:readonly string[];readonly components:readonly string[];
  readonly dataFlow:readonly string[];readonly compatibility:readonly string[];readonly implementationSequence:readonly string[];
  readonly validationStrategy:readonly string[];readonly risks:readonly string[];readonly assumptions:readonly string[]}
export interface PlannedTask {readonly plannedTaskId:string;readonly title:string;readonly objective:string;readonly rationale:string;
  readonly scopeIntent:readonly string[];readonly acceptanceIntent:readonly string[];readonly validationIntent:readonly string[];
  readonly dependsOn:readonly string[];readonly dependencyRationale:readonly {readonly plannedTaskId:string;readonly rationale:string}[];
  readonly relevantMemoryRefs:readonly ProjectMemoryReference[];readonly designIntent?:readonly string[];readonly implementationSteps?:readonly string[];
  readonly requiresRefinement?:true}
export interface PlanProposal {readonly strategy:string;readonly plannedTasks:readonly PlannedTask[];readonly design?:ProjectDesign;readonly memoryProposals?:readonly ProjectMemoryProposal[]}
export interface ProjectPlan extends PlanProposal {readonly schemaVersion:1;readonly projectId:string;readonly planId:string;readonly revision:number;
  readonly status:'DRAFT'|'APPROVED'|'SUPERSEDED';readonly projectGoalRef:ArtifactRef;readonly createdAt:string;readonly updatedAt:string;
  readonly supersedes:ArtifactRef|null;readonly contentDigest:string}
export interface PlanningInputReceipt {readonly schemaVersion:1;readonly goalRef:ArtifactRef;readonly goalDigest:string;
  readonly baselineCommit:string;readonly baselineInventoryDigest:string;readonly memoryRefs:readonly ProjectMemoryReference[];
  readonly scoutAnalysisRef:ArtifactRef;readonly memoryContextRef:ArtifactRef|null;readonly planRef:ArtifactRef;readonly planDigest:string}
export interface PlannedTaskExecutionLink {readonly schemaVersion:1;readonly projectId:string;readonly planId:string;readonly planRevision:number;
  readonly planDigest:string;readonly plannedTaskId:string;readonly plannedTaskDigest:string;readonly controlledTaskId:string;
  readonly specHash:string;readonly baselineCommit:string;readonly createdAt:string}
export type ProjectTaskStatus='WAITING'|'READY'|'ACTIVE'|'COMPLETED'|'BLOCKED'|'FAILED';
export function planningError(code:string):never{throw new Error(code)}
const memory=scalar<ProjectMemoryReference>('MEMORY',v=>{try{validateMemoryReference(v);return true}catch{return false}});
export const designMemory=scalar<ProjectMemoryProposal>('DESIGN_MEMORY',v=>{try{const p=validateMemoryProposal(v);return p.recordKind!=='technical-lesson'&&!p.relatedTaskRefs.length&&p.evidenceRefs.every(e=>e.kind==='repository-source')}catch{return false}});
export const planningArtifact=scalar<ArtifactRef>('ARTIFACT',v=>validateStructure('ArtifactRef',v).ok);
const intents=list(scalars.Text,1,16),refs=list(memory,0,8);
export const clarificationSchema=object('GoalClarification',{questionId:scalars.ID,question:scalars.Text,why:scalars.Text,answer:scalar<string|null>('ANSWER',v=>v===null||typeof v==='string'&&validateStructureText(v))},{suggestedAnswer:scalars.Text});
function validateStructureText(v:string):boolean {const errors:Issue[]=[];scalars.Text.check(v,'$',errors);return !errors.length&&!!v.trim()}
export const designSchema=object('ProjectDesign',{context:scalars.Text,approach:scalars.Text,decisions:intents,components:intents,dataFlow:list(scalars.Text,0,16),compatibility:intents,
  implementationSequence:intents,validationStrategy:intents,risks:list(scalars.Text,0,16),assumptions:list(scalars.Text,0,16)});
const taskSchema=object('PlannedTask',{plannedTaskId:scalars.ID,title:scalars.Text,objective:scalars.Text,rationale:scalars.Text,
  scopeIntent:intents,acceptanceIntent:intents,validationIntent:intents,dependsOn:list(scalars.ID,0,64),
  dependencyRationale:list(object('DependencyRationale',{plannedTaskId:scalars.ID,rationale:scalars.Text}),0,64),relevantMemoryRefs:refs},{designIntent:intents,implementationSteps:intents,requiresRefinement:literal(true)});
const proposalSchema=object('PlanProposal',{strategy:scalars.Text,plannedTasks:list(taskSchema,1,PLANNING_LIMITS.tasks)},{design:designSchema,memoryProposals:list(designMemory,0,4)});
const goalSchema=object('ProjectGoal',{schemaVersion:literal(1),projectId:scalars.Hash,goalId:scalars.ID,revision:integer(1,256),title:scalars.Text,
  objective:scalars.Text,constraints:list(scalars.Text,0,16),successIntent:intents,relatedMemoryRefs:refs,createdAt:scalars.Time,contentDigest:scalars.Hash},{clarifications:list(clarificationSchema,0,64),contextEvidenceRefs:list(planningArtifact,0,64)});
const planSchema=object('ProjectPlan',{schemaVersion:literal(1),projectId:scalars.Hash,planId:scalars.ID,revision:integer(1,256),
  status:enumeration('DRAFT','APPROVED','SUPERSEDED'),projectGoalRef:planningArtifact,strategy:scalars.Text,plannedTasks:list(taskSchema,1,64),
  createdAt:scalars.Time,updatedAt:scalars.Time,supersedes:scalar<ArtifactRef|null>('REF',v=>v===null||validateStructure('ArtifactRef',v).ok),contentDigest:scalars.Hash},{design:designSchema,memoryProposals:list(designMemory,0,4)});
export function validatePlanningPortability(v:unknown):void{
  if(typeof v==='string'&&(/(?:^|[\s`"'(=])\/(?:home|media|run\/media|tmp|Users)\/|(?<![A-Za-z])[A-Za-z]:[\\/]/.test(v)))planningError('PROJECT_PLANNING_ABSOLUTE_PATH');
  if(v&&typeof v==='object')for(const x of Object.values(v))validatePlanningPortability(x);
}
export function checkPlanning<T>(schema:Schema<T>,input:unknown,max=PLANNING_LIMITS.payloadBytes):T{
  const v=copyJson(input),errors:Issue[]=[];if(byteLength(canonicalize(v))>max)planningError('PROJECT_PLANNING_LIMIT');
  schema.check(v,'$',errors);if(errors.length)planningError('PROJECT_PLANNING_SCHEMA_INVALID');validatePlanningPortability(v);return freezeMemory(v as T);
}
export function goalDigest(value:Omit<ProjectGoal,'contentDigest'>|ProjectGoal):string{const {contentDigest,...material}=value as ProjectGoal;return hashCanonical(material)}
/** Lifecycle is an index projection. The immutable proposed content keeps the same digest after approval/supersession. */
export function planDigest(value:Omit<ProjectPlan,'contentDigest'>|ProjectPlan):string{
  const {contentDigest,status,...material}=value as ProjectPlan;return hashCanonical(material);
}
export function validateGoal(input:unknown):ProjectGoal{const g=checkPlanning(goalSchema,input);if([g.objective,g.title,...g.successIntent].some(s=>!s.trim()))planningError('PROJECT_GOAL_EMPTY_INTENT');
  if(g.clarifications&&(new Set(g.clarifications.map(q=>q.questionId)).size!==g.clarifications.length||g.clarifications.some(q=>!q.question.trim()||!q.why.trim()||q.suggestedAnswer!==undefined&&!q.suggestedAnswer.trim())))planningError('PROJECT_GOAL_CLARIFICATION_INVALID');
  if(goalDigest(g)!==g.contentDigest)planningError('PROJECT_GOAL_DIGEST');return g}
export function taskMeaning(task:PlannedTask):string{return hashCanonical({objective:task.objective,scopeIntent:task.scopeIntent,acceptanceIntent:task.acceptanceIntent,...(task.designIntent?{designIntent:task.designIntent}:{}),...(task.implementationSteps?{implementationSteps:task.implementationSteps}:{}),...(task.requiresRefinement?{requiresRefinement:true}:{})})}
/** Preserve detailed context across the bounded Text fields in native Scout requests. */
export function projectTaskHints(plan:PlanProposal,task:PlannedTask):readonly string[]{
  const parts:string[]=[];
  const add=(label:string,value:unknown)=>{const text=typeof value==='string'?value:canonicalize(value);let chunk='';
    for(const character of `${label}: ${text}`){if(byteLength(chunk+character)>3800){parts.push(chunk);chunk=''}chunk+=character}if(chunk)parts.push(chunk)};
  add("Rationale",task.rationale);add("Planned scope",task.scopeIntent.join('; '));add("Expected result",task.acceptanceIntent.join('; '));add("Planned checks",task.validationIntent.join('; '));
  if(plan.design)add("Project design (data; consecutive parts continue the text)",plan.design);
  if(task.designIntent)add("Task design",task.designIntent.join('; '));if(task.implementationSteps)add("Implementation steps",task.implementationSteps.join('; '));
  return parts;
}
export function validatePlanProposal(input:unknown):PlanProposal{
  const p=checkPlanning(proposalSchema,input),tasks=new Map(p.plannedTasks.map(t=>[t.plannedTaskId,t]));
  if(tasks.size!==p.plannedTasks.length)planningError('PROJECT_PLAN_DUPLICATE_ID');
  const meanings=new Set<string>(),visiting=new Set<string>(),visited=new Set<string>();
  if(!p.strategy.trim())planningError('PROJECT_PLAN_EMPTY_INTENT');
  if(p.design&&Object.values(p.design).flat().some(s=>!s.trim()))planningError('PROJECT_PLAN_EMPTY_INTENT');
  for(const t of p.plannedTasks){
    if([t.title,t.objective,t.rationale,...t.scopeIntent,...t.acceptanceIntent,...t.validationIntent,...(t.designIntent??[]),...(t.implementationSteps??[]),...t.dependencyRationale.map(d=>d.rationale)].some(s=>!s.trim()))planningError('PROJECT_PLAN_EMPTY_INTENT');
    const meaning=t.objective.normalize('NFC').trim().toLocaleLowerCase('it');
    if(meanings.has(meaning))planningError('PROJECT_PLAN_DUPLICATE_MEANING');meanings.add(meaning);
    if(new Set(t.dependsOn).size!==t.dependsOn.length)planningError('PROJECT_PLAN_DUPLICATE_EDGE');
    if(t.dependsOn.includes(t.plannedTaskId))planningError('PROJECT_PLAN_SELF_DEPENDENCY');
    if(t.dependsOn.some(id=>!tasks.has(id)))planningError('PROJECT_PLAN_MISSING_DEPENDENCY');
    if(t.dependencyRationale.length!==t.dependsOn.length||new Set(t.dependencyRationale.map(r=>r.plannedTaskId)).size!==t.dependsOn.length
      ||t.dependencyRationale.some(r=>!t.dependsOn.includes(r.plannedTaskId)))planningError('PROJECT_PLAN_DEPENDENCY_RATIONALE');
  }
  const visit=(id:string)=>{if(visiting.has(id))planningError('PROJECT_PLAN_CYCLE');if(visited.has(id))return;
    visiting.add(id);for(const dep of tasks.get(id)!.dependsOn)visit(dep);visiting.delete(id);visited.add(id)};
  for(const id of tasks.keys())visit(id);return p;
}
export function validatePlan(input:unknown):ProjectPlan{const p=checkPlanning(planSchema,input);validatePlanProposal({strategy:p.strategy,plannedTasks:p.plannedTasks,...(p.design?{design:p.design}:{}),...(p.memoryProposals?{memoryProposals:p.memoryProposals}:{})});
  if(planDigest(p)!==p.contentDigest)planningError('PROJECT_PLAN_DIGEST');return p}
export function planNarrative(plan:PlanProposal):string{
  const tasks=new Map(plan.plannedTasks.map(t=>[t.plannedTaskId,t]));
  return `${plan.design?designNarrative(plan.design)+'\n\n':''}${plan.memoryProposals?.length?"Decisions to save\nThese proposals require the normal memory decision before becoming current.\n"+plan.memoryProposals.map(p=>p.title+'\n'+memoryPresentation({...p,status:'PROPOSED',authorityKind:'proposal'})).join('\n\n')+'\n\n':''}Strategy\n${plan.strategy}\n\n`+plan.plannedTasks.map(t=>`${t.title}\n${t.objective}\n${t.requiresRefinement?"Needs splitting: this task is still too broad to start.\n":''}Why it matters: ${t.rationale}\nPlanned scope: ${t.scopeIntent.join('; ')}\n${t.designIntent?`Task structure: ${t.designIntent.join('; ')}\n`:''}${t.implementationSteps?`Implementation steps:\n${t.implementationSteps.map((s,i)=>`${i+1}. ${s}`).join('\n')}\n`:''}Expected result: ${t.acceptanceIntent.join('; ')}\nPlanned checks: ${t.validationIntent.join('; ')}\nDependencies: ${t.dependencyRationale.map(d=>`${tasks.get(d.plannedTaskId)?.title??d.plannedTaskId}: ${d.rationale}`).join('; ')||"none"}\nRelevant memories: ${t.relevantMemoryRefs.map(r=>`${r.recordId} r${r.revision}`).join(', ')||"none"}`).join('\n\n');
}
/** First-screen overview; the full design remains available before approval. */
export function projectTaskStatusLabel(status:ProjectTaskStatus):string{
  return {COMPLETED:"completed",ACTIVE:"in progress",READY:"not started",WAITING:"waiting",BLOCKED:"a decision is required",FAILED:"unsuccessful attempt"}[status];
}
/** Presentation only: retained historical reasons never become the current task status. */
export function projectExecutionReason(state:Pick<WorkflowState,'state'|'blockedReason'|'terminalReason'>):string|undefined{
  const raw=state.state==='BLOCKED'?state.blockedReason:state.state==='FAILED'?state.terminalReason:undefined;
  if(!raw)return;
  const known:Record<string,string>={
    'Developer reported a bounded blocker':"The agent preparing the change reported an unmet prerequisite. Its attempt has ended; verify the reason before authorizing a resume.",
    'Reviewer batch failed':"Independent review could not be completed. Check the problem before resuming it.",
    'Scout dispatch/result failed':"Initial analysis returned no verifiable result. Check the problem before resuming it.",
    'Oracle dispatch/result failed':"The additional investigation returned no verifiable advice. Check the problem before resuming it.",
    'Rework source/base preparation failed':"The working copy for corrections could not be prepared.",
    'Human ANSWER requires re-evaluation; approval not granted':"The operator's answer must still be assessed before continuing.",
    'Human accepted reconciliation only; host must re-evaluate without retry authority':"The operator requested reconsideration. Resuming work still requires authorization.",
    'Conflicting authoritative validation set':"Recorded checks have conflicting outcomes. Resolve them before continuing.",
    'Contradictory validation replay':"A different outcome was received for the same check. Resolve the conflict.",
    'Contradictory result replay':"Different results were received for the same execution. Resolve the conflict.",
    'Candidate mutated after materialization':"The working copy changed after verification. Check it again before continuing.",
    'Human definitive refusal; F verified':"The operator refused to continue: the task ended without completion.",
  };
  return known[raw]??(state.state==='BLOCKED'?"Examine the reason for blocking in Technical details before resuming work.":"The task ended without completion. The recorded reason is available in Technical details.");
}
export function planSummary(plan:PlanProposal):string{
  return `Strategy\n${plan.strategy}\n\n${plan.plannedTasks.length} planned tasks\n`+plan.plannedTasks.map((task,i)=>`${i+1}. ${task.title}\n${task.objective}\n${task.requiresRefinement?"Split before starting.\n":''}Prerequisites: ${task.dependsOn.length?task.dependsOn.map(id=>plan.plannedTasks.find(t=>t.plannedTaskId===id)?.title??id).join('; '):"none"}`).join('\n\n')+"\n\nUse Read structure and details to consult responsibilities, planned files, criteria and checks for every task.";
}
export function designNarrative(d:ProjectDesign):string{
  return [["Context",d.context],["Proposed structure",d.approach],["Decisions and rationales",d.decisions],["Components and interfaces",d.components],["Data flow",d.dataFlow],["Compatibility",d.compatibility],["Implementation sequence",d.implementationSequence],["Verification strategy",d.validationStrategy],["Risks",d.risks],["Assumptions",d.assumptions]].map(([title,value])=>`${title}\n${Array.isArray(value)?value.map(s=>'• '+s).join('\n')||"none":value}`).join('\n\n');
}
export function scopeOverlapWarnings(plan:PlanProposal):readonly string[]{
  return plan.plannedTasks.flatMap((t,i)=>plan.plannedTasks.slice(i+1).filter(other=>other.scopeIntent.some(s=>t.scopeIntent.includes(s)))
    .map(other=>`${t.title} and ${other.title} involve the same planned scope; check boundaries and order during formulation.`));
}
