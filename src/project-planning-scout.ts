import { hashCanonical, copyJson, canonicalize, byteLength } from './contract-json.js';
import { checkPlanning, validatePlanProposal, validatePlan, validateGoal, taskMeaning, planningError, designSchema, designMemory } from './project-planning.js';
import { MEMORY_PROPOSALS_WIRE } from './project-memory.js';
import type { PlanProposal, ProjectPlan, ProjectGoal } from './project-planning.js';
import type { Infer } from './contract-schema.js';
import { object, literal, scalars, list, integer } from './contract-schema.js';
import type { PreTaskProposalRequest } from './pre-task-proposal.js';
import type { MemorySelection } from './project-memory-context.js';
export interface RefinementBinding {readonly previousPlanDigest:string;readonly targetTaskId:string}
export interface PlanningScoutMode {readonly goal:ProjectGoal;readonly previous?:ProjectPlan;readonly correction?:string;readonly selection?:MemorySelection;
  readonly refinement?:RefinementBinding;readonly refinementFeedback?:PlanningRefinementOutput;readonly investigationQuestions?:readonly {question:string;why?:string}[]}
const fields={plannedTaskId:scalars.ID,title:scalars.Text,objective:scalars.Text,rationale:scalars.Text,
  scopeIntent:list(scalars.Text,1,16),acceptanceIntent:list(scalars.Text,1,16),validationIntent:list(scalars.Text,1,16),dependsOn:list(scalars.ID,0,64),
  dependencyRationale:list(object('Rationale',{plannedTaskId:scalars.ID,rationale:scalars.Text}),0,64),relevantMemoryIds:list(scalars.ID,0,8)};
const schema=object('ProjectPlanningProposal',{schemaVersion:literal(1),phase:literal('PROJECT_PLANNING_PROPOSAL'),proposalOnly:literal(true),
  requestId:scalars.ID,requestHash:scalars.Hash,strategy:scalars.Text,plannedTasks:list(object('PlannedTaskProposal',fields,{designIntent:list(scalars.Text,1,16),implementationSteps:list(scalars.Text,1,16),requiresRefinement:literal(true)}),0,64)},
  {design:designSchema,memoryProposals:list(designMemory,0,4),clarificationQuestions:list(object('ClarificationQuestion',{questionId:scalars.ID,question:scalars.Text,why:scalars.Text},{suggestedAnswer:scalars.Text}),0,5)});
const text={type:'string',minLength:1,maxLength:4096},strings=(min=0,max=16)=>({type:'array',items:text,minItems:min,maxItems:max});
const designFields={context:text,approach:text,decisions:strings(1),components:strings(1),dataFlow:strings(),compatibility:strings(1),implementationSequence:strings(1),validationStrategy:strings(1),risks:strings(),assumptions:strings()};
export const PLANNING_OUTPUT_SCHEMA={type:'object',additionalProperties:false,properties:{schemaVersion:{const:1},phase:{const:'PROJECT_PLANNING_PROPOSAL'},proposalOnly:{const:true},
  memoryProposals:MEMORY_PROPOSALS_WIRE,
  requestId:text,requestHash:text,strategy:text,design:{anyOf:[{type:'object',additionalProperties:false,properties:designFields,required:Object.keys(designFields)},{type:'null'}]},clarificationQuestions:{type:'array',maxItems:5,items:{type:'object',additionalProperties:false,properties:{questionId:text,question:text,why:text,suggestedAnswer:text},required:['questionId','question','why']}},plannedTasks:{type:'array',minItems:0,maxItems:64,items:{type:'object',additionalProperties:false,properties:{
    plannedTaskId:text,title:text,objective:text,rationale:text,scopeIntent:strings(1),acceptanceIntent:strings(1),validationIntent:strings(1),dependsOn:strings(0,64),
    dependencyRationale:{type:'array',maxItems:64,items:{type:'object',additionalProperties:false,properties:{plannedTaskId:text,rationale:text},required:['plannedTaskId','rationale']}},relevantMemoryIds:strings(0,8),designIntent:strings(1),implementationSteps:strings(1),requiresRefinement:{const:true}},required:[...Object.keys(fields),'designIntent','implementationSteps']}}},
  required:['schemaVersion','phase','proposalOnly','requestId','requestHash','strategy','plannedTasks','design','clarificationQuestions','memoryProposals']} as const;
export type PlanningScoutOutput=Infer<typeof schema>;
export const REFINEMENT_PAYLOAD_BYTES=24*1024;
/** Account for the envelope, actual replacement count and required coverage.
 * The global cap still bounds every proposal regardless of its shape. */
export function refinementPayloadBudget(taskCount:number,coverageCount:number):number{
  if(!Number.isInteger(taskCount)||taskCount<1||taskCount>3||!Number.isInteger(coverageCount)||coverageCount<1||coverageCount>16)planningError('PROJECT_PLANNING_SCHEMA_INVALID');
  return Math.min(REFINEMENT_PAYLOAD_BYTES,4096+4096*taskCount+256*coverageCount);
}
const refinementSchema=object('ProjectRefinementProposal',{schemaVersion:literal(1),phase:literal('PROJECT_REFINEMENT_PROPOSAL'),proposalOnly:literal(true),
  requestId:scalars.ID,requestHash:scalars.Hash,previousPlanDigest:scalars.Hash,targetTaskId:scalars.ID,explanation:scalars.Text,
  replacementTasks:list(object('ReplacementTask',fields,{designIntent:list(scalars.Text,1,16),implementationSteps:list(scalars.Text,1,16),requiresRefinement:literal(true)}),1,3),
  coverage:list(object('RefinementCoverage',{acceptanceIndex:integer(0,15),taskIds:list(scalars.ID,1,3),rationale:scalars.Text}),1,16)});
export type PlanningRefinementOutput=Infer<typeof refinementSchema>;
function checkRefinement(input:unknown):PlanningRefinementOutput{
  const material=copyJson(input),bytes=byteLength(canonicalize(material));if(bytes>REFINEMENT_PAYLOAD_BYTES)planningError('PROJECT_REFINEMENT_LIMIT');
  const proposal=checkPlanning(refinementSchema,material);
  if(bytes>refinementPayloadBudget(proposal.replacementTasks.length,proposal.coverage.length))planningError('PROJECT_REFINEMENT_LIMIT');
  return proposal;
}
const compactText={type:'string',minLength:1,maxLength:512},compactId={type:'string',minLength:1,maxLength:128},
  conciseText={type:'string',minLength:1,maxLength:160,description:'One concise, readable point. Preserve the meaningful boundary or check; avoid repeated inventories and obscure abbreviations.'},
  conciseSummary={...conciseText,maxLength:240},compactStrings=(items:{type:string;minLength:number;maxLength:number;description?:string},min=0,max=4)=>({type:'array',items,minItems:min,maxItems:max});
// Field budgets guide generation towards an 8 KiB delivery. They cannot prove a
// UTF-8 byte budget (characters and bytes differ); the host checks the exact
// published value against a proportional budget and 24 KiB global cap.
const replacementProperties={plannedTaskId:compactId,title:conciseText,objective:conciseSummary,rationale:conciseSummary,
  scopeIntent:compactStrings(compactText,1,8),acceptanceIntent:compactStrings(conciseText,1),validationIntent:compactStrings(conciseText,1),dependsOn:compactStrings(compactId,0,64),
  dependencyRationale:{type:'array',maxItems:64,items:{type:'object',additionalProperties:false,properties:{plannedTaskId:compactId,rationale:conciseText},required:['plannedTaskId','rationale']}},
  relevantMemoryIds:compactStrings(compactId,0,8),designIntent:compactStrings(conciseText,1),implementationSteps:compactStrings(conciseText,1),requiresRefinement:{const:true}};
/** A delivery format only. The host still saves and approves a complete ProjectPlan. */
export const REFINEMENT_OUTPUT_SCHEMA={type:'object',additionalProperties:false,properties:{schemaVersion:{const:1},phase:{const:'PROJECT_REFINEMENT_PROPOSAL'},proposalOnly:{const:true},
  requestId:compactId,requestHash:compactId,previousPlanDigest:compactId,targetTaskId:compactId,explanation:{...conciseSummary,maxLength:384},
  replacementTasks:{type:'array',minItems:1,maxItems:3,items:{type:'object',additionalProperties:false,properties:replacementProperties,required:Object.keys(replacementProperties).filter(key=>key!=='requiresRefinement')}},
  coverage:{type:'array',minItems:1,maxItems:16,items:{type:'object',additionalProperties:false,properties:{acceptanceIndex:{type:'integer',minimum:0,maximum:15},taskIds:compactStrings(compactId,1,3),rationale:conciseSummary},required:['acceptanceIndex','taskIds','rationale']}}},
  required:['schemaVersion','phase','proposalOnly','requestId','requestHash','previousPlanDigest','targetTaskId','explanation','replacementTasks','coverage']} as const;
export function validateRefinementMode(mode:PlanningScoutMode):void{
  const binding=mode.refinement,previous=mode.previous;
  if(!binding||Object.keys(binding).sort().join(',')!=='previousPlanDigest,targetTaskId'||!previous||validatePlan(previous).status!=='APPROVED'
    ||previous.contentDigest!==binding.previousPlanDigest||!previous.plannedTasks.some(t=>t.plannedTaskId===binding.targetTaskId)
    ||previous.projectGoalRef.id!==`${mode.goal.goalId}-r${mode.goal.revision}`||previous.projectId!==mode.goal.projectId
    ||hashCanonical(validateGoal(mode.goal))!==previous.projectGoalRef.digest)planningError('PROJECT_REFINEMENT_BINDING');
  if(mode.refinementFeedback){const feedback=checkRefinement(mode.refinementFeedback);
    if(feedback.previousPlanDigest!==binding.previousPlanDigest||feedback.targetTaskId!==binding.targetTaskId)planningError('PROJECT_REFINEMENT_BINDING');}
}
export function readRefinementScoutOutput(input:unknown,request:PreTaskProposalRequest,mode:PlanningScoutMode):PlanningRefinementOutput{
  validateRefinementMode(mode);
  const r=checkRefinement(input);
  if(r.requestId!==request.requestId||r.requestHash!==hashCanonical(request)||r.previousPlanDigest!==mode.refinement!.previousPlanDigest
    ||r.targetTaskId!==mode.refinement!.targetTaskId)planningError('PROJECT_REFINEMENT_BINDING');
  if(!r.explanation.trim()||r.replacementTasks.some(t=>!t.designIntent||!t.implementationSteps))planningError('PROJECT_REFINEMENT_INCOMPLETE');
  return r;
}
export function materializeRefinement(input:PlanningRefinementOutput,mode:PlanningScoutMode):PlanProposal{
  validateRefinementMode(mode);
  const r=checkRefinement(input),previous=mode.previous!,target=previous.plannedTasks.find(t=>t.plannedTaskId===mode.refinement!.targetTaskId)!;
  if(r.previousPlanDigest!==previous.contentDigest||r.targetTaskId!==target.plannedTaskId)planningError('PROJECT_REFINEMENT_BINDING');
  const ids=new Set(r.replacementTasks.map(t=>t.plannedTaskId)),oldIds=new Set(previous.plannedTasks.map(t=>t.plannedTaskId));
  if(ids.size!==r.replacementTasks.length||[...ids].some(id=>oldIds.has(id)))planningError('PROJECT_REFINEMENT_IDENTITY');
  for(const t of r.replacementTasks){
    if(t.dependsOn.some(id=>!ids.has(id)&&!target.dependsOn.includes(id)))planningError('PROJECT_REFINEMENT_DEPENDENCY');
    if(!t.dependsOn.some(id=>ids.has(id))&&[...t.dependsOn].sort().join(',')!==[...target.dependsOn].sort().join(','))planningError('PROJECT_REFINEMENT_DEPENDENCY');
  }
  if(r.coverage.length!==target.acceptanceIntent.length||new Set(r.coverage.map(c=>c.acceptanceIndex)).size!==target.acceptanceIntent.length
    ||r.coverage.some(c=>c.acceptanceIndex>=target.acceptanceIntent.length||!c.rationale.trim()||new Set(c.taskIds).size!==c.taskIds.length||c.taskIds.some(id=>!ids.has(id)))
    ||[...ids].some(id=>!r.coverage.some(c=>c.taskIds.includes(id))))planningError('PROJECT_REFINEMENT_COVERAGE');
  const replacements=r.replacementTasks.map(t=>{const {relevantMemoryIds,...task}=t;return {...task,relevantMemoryRefs:relevantMemoryIds.map(id=>{
    const ref=mode.selection?.selected.find(s=>s.reference.recordId===id)?.reference;if(!ref)planningError('PROJECT_PLAN_MEMORY_BINDING');return ref})};});
  if(replacements.filter(t=>t.requiresRefinement).length>1||replacements.every(t=>t.requiresRefinement))planningError('PROJECT_REFINEMENT_REMAINDER');
  if(replacements.length===1&&taskMeaning(replacements[0])===taskMeaning(target))planningError('PROJECT_REFINEMENT_NO_CHANGE');
  const terminals=replacements.filter(t=>!replacements.some(other=>other.dependsOn.includes(t.plannedTaskId))).map(t=>t.plannedTaskId);
  if(!terminals.length)planningError('PROJECT_PLAN_CYCLE');
  const plannedTasks=previous.plannedTasks.flatMap(task=>{
    if(task.plannedTaskId===target.plannedTaskId)return replacements;
    if(!task.dependsOn.includes(target.plannedTaskId))return [task];
    const original=task.dependencyRationale.find(edge=>edge.plannedTaskId===target.plannedTaskId)!;
    return [{...task,dependsOn:task.dependsOn.flatMap(id=>id===target.plannedTaskId?terminals:[id]),dependencyRationale:task.dependencyRationale.flatMap(edge=>edge.plannedTaskId===target.plannedTaskId?
      terminals.map(id=>({plannedTaskId:id,rationale:original.rationale})): [edge])}];
  });
  return validatePlanProposal({strategy:previous.strategy,plannedTasks,...(previous.design?{design:previous.design}:{}),...(previous.memoryProposals?{memoryProposals:previous.memoryProposals}:{})});
}
export function readPlanningScoutOutput(input:unknown,request:PreTaskProposalRequest,live=false):PlanningScoutOutput{
  // Null design belongs only to a clarification round. Legacy saved/model fixtures
  // without new fields remain readable; the live output schema requires them.
  const raw=input as Record<string,unknown>,material=raw?.design===null?Object.fromEntries(Object.entries(raw).filter(([k])=>k!=='design')):input;
  const r=checkPlanning(schema,material);if(r.requestId!==request.requestId||r.requestHash!==hashCanonical(request))planningError('PROJECT_PLANNING_SCOUT_BINDING');
  if(live&&(raw?.design===undefined||r.clarificationQuestions===undefined||r.memoryProposals===undefined))planningError('PROJECT_PLANNING_SCHEMA_INVALID');
  const questions=r.clarificationQuestions??[];
  if(questions.length){if(r.plannedTasks.length||r.design||r.memoryProposals?.length||new Set(questions.map(q=>q.questionId)).size!==questions.length||questions.some(q=>!q.question.trim()||!q.why.trim()))planningError('PROJECT_CLARIFICATION_INVALID');}
  else if(!r.plannedTasks.length||raw?.design===null)planningError('PROJECT_PLAN_EMPTY_INTENT');
  else if(r.clarificationQuestions!==undefined&&(!r.design||r.plannedTasks.some(t=>!t.designIntent||!t.implementationSteps)))planningError('PROJECT_PLAN_DESIGN_INCOMPLETE');
  return r;
}
export function validatePlanningScout(input:unknown,request:PreTaskProposalRequest,mode:PlanningScoutMode,live=false):PlanProposal|undefined{
  if(mode.refinement)return materializeRefinement(readRefinementScoutOutput(input,request,mode),mode);
  const r=readPlanningScoutOutput(input,request,live);
  if(r.clarificationQuestions?.length)return;
  for(const proposal of r.memoryProposals??[])if(proposal.relatedRecordRefs.some(ref=>!mode.selection?.selected.some(s=>hashCanonical(s.reference)===hashCanonical(ref))))planningError('PROJECT_PLAN_MEMORY_BINDING');
  return validatePlanProposal({strategy:r.strategy,...(r.design?{design:r.design}:{}),...(r.memoryProposals?{memoryProposals:r.memoryProposals}:{}),plannedTasks:r.plannedTasks.map(t=>{const {relevantMemoryIds,...task}=t;
    return {...task,relevantMemoryRefs:relevantMemoryIds.map(id=>{const ref=mode.selection?.selected.find(s=>s.reference.recordId===id)?.reference;
      if(!ref)planningError('PROJECT_PLAN_MEMORY_BINDING');return ref})};})});
}
