import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize, parseJson, validateScalar } from './contracts.js';
import type { DecisionRecord, TaskSpec, WorkflowState } from './contracts.js';
import { currentValidationEvidence } from './contract-semantic.js';
import { DurableStore } from './store.js';
import { physicalProjectRootForTask } from './project-storage.js';
import type { ProjectPlanningRepository, ProjectTaskView } from './project-planning-repository.js';
import type { ProjectPlan } from './project-planning.js';
import { projectExecutionReason, projectTaskStatusLabel, planSummary } from './project-planning.js';

const phase:Record<WorkflowState['state'],string>={PENDING:"prepared, waiting to start",ANALYZING:"analysis in progress",READY:"ready for development",
  IMPLEMENTING:"development in progress",TESTING:"checks in progress",REVIEWING:"independent review",REWORK:"corrections required",
  AWAITING_HUMAN:"awaiting a decision",BLOCKED:"stopped: examine the reason",COMPLETED:"completed",FAILED:"ended without completion"};
const decisionLabels:Record<DecisionRecord['kind'],string>={ACCEPT_FINDING:"Issue accepted",DISMISS_FINDING:"Issue rejected",DEFER_RISK:"Risk deferred",
  RESOLVE_RISK:"Risk resolved",ADOPT_ADVICE:"Advice adopted",REJECT_ADVICE:"Advice declined",RESOLVE_AMBIGUITY:"Clarification recorded"};
const bullet=(items:readonly string[],empty:string)=>items.length?items.map(item=>'• '+item).join('\n'):empty;
/** Data-only view for the active proposal panel. No second modal or repository. */
export function readProjectPlanSnapshot(repo:ProjectPlanningRepository):Readonly<{summary:string;points:readonly {title:string;detail:string}[]}>{
 const plan=repo.current();if(!plan)return Object.freeze({summary:"No approved plan is available yet.",points:Object.freeze([])});
 const views=repo.progress(plan);
 return Object.freeze({summary:`Approved plan — revision ${plan.revision}\n\n${planSummary(plan)}\n\nReading the saved plan. Intentions do not certify work already performed.`,
  points:Object.freeze(views.map(view=>Object.freeze({title:view.task.title,detail:plannedTaskDetail(plan,view)})))});
}
export function plannedTaskDetail(plan:ProjectPlan,view:ProjectTaskView):string{
  const task=view.task,byId=new Map(plan.plannedTasks.map(task=>[task.plannedTaskId,task]));
  return `${task.title}\n\nObserved status: ${projectTaskStatusLabel(view.status)}\n${view.explanation}\n\nPurpose\n${task.objective}\n\nWhy it matters\n${task.rationale}\n\nPlanned scope\n${bullet(task.scopeIntent,"Unavailable.")}\n\nPrerequisiti\n${bullet(task.dependencyRationale.map(dep=>`${byId.get(dep.plannedTaskId)?.title??dep.plannedTaskId}: ${dep.rationale}`),"None.")}\n\nPlanned structure\n${bullet(task.designIntent??[],"Unavailable in the saved plan.")}\n\nImplementation steps\n${task.implementationSteps?.map((step,i)=>`${i+1}. ${step.replace(/^\s*\d+[.)]\s+/,'')}`).join('\n')||"Unavailable in the saved plan."}\n\nExpected results\n${bullet(task.acceptanceIntent,"Unavailable.")}\n\nPlanned checks\n${bullet(task.validationIntent,"Unavailable.")}\n\nLinked controlled task\n${view.links.map(link=>link.controlledTaskId).join('\n')||"Not prepared yet. A plan item is not an execution."}\n\n${task.requiresRefinement?"This work must be split before starting.\n\n":''}This screen reads the saved plan. Plan intentions are not evidence of execution.`;
}
export interface PlannedExecutionConsultation {readonly available:boolean;readonly overview:string;readonly results:string;readonly decisions:string;readonly technical:string}
/** Reads existing verified task records. Never repairs, rebuilds notes or creates a task. */
export function readPlannedExecution(repo:ProjectPlanningRepository,view:ProjectTaskView):PlannedExecutionConsultation{
  const link=view.links[0];
  const unavailable=(reason:string):PlannedExecutionConsultation=>({available:false,overview:reason,results:"Outcomes and changed files: unavailable.",decisions:"Recorded decisions: unavailable.",technical:canonicalize({controlledTaskId:link?.controlledTaskId??null,reason})});
  if(!link)return unavailable("No controlled task is linked to this plan item yet.");
  const root=join(repo.projectRoot,'tasks',link.controlledTaskId);
  if(!existsSync(root))return unavailable(`Linked task: ${link.controlledTaskId}\nIt has been prepared, but the execution registry is not available yet.`);
  try{
    const ledger=DurableStore.load(root),state=ledger.state;
    if(ledger.truncatedTailBytes||state.taskId!==link.controlledTaskId
      ||!ledger.records.some(record=>record.kind==='TaskSpec'&&record.value.taskId===link.controlledTaskId&&record.value.specHash===link.specHash))throw new Error('PROJECT_EXECUTION_LINK_INVALID');
    const spec=ledger.records.find(record=>record.kind==='TaskSpec'&&record.id===state.spec.id)?.value as TaskSpec|undefined;
    if(!spec)throw new Error('PROJECT_EXECUTION_SPEC_UNAVAILABLE');
    if(physicalProjectRootForTask(root,spec.scope.repoRoot,ledger)!==repo.repoRoot)throw new Error('PROJECT_EXECUTION_LINK_INVALID');
    const checks=currentValidationEvidence(spec,state,ledger.records.flatMap(record=>record.kind==='ValidationResult'?[record.value]:[]));
    const required=spec.validationCommands.filter(command=>command.required),passed=checks.filter(check=>check.status==='PASSED'&&required.some(command=>command.id===check.commandId)).length;
    const review=ledger.records.findLast(record=>record.kind==='ReviewResult'&&state.reviews.includes(record.id)&&!state.invalidEvidenceIds.includes(record.id));
    let files="Not available yet: the package has not recorded a working copy.";
    if(state.candidate){
      const handoff=parseJson(DurableStore.readArtifact(root,state.candidate.handoff),64*1024*1024) as any;
      if(handoff.schemaVersion!==1||handoff.digest!==state.candidate.digest||handoff.generation!==state.candidate.generation||handoff.baseCommit!==state.candidate.baseCommit
        ||!Array.isArray(handoff.changes)||handoff.changes.some((change:any)=>!['CREATE','MODIFY','DELETE','RENAME','MODE'].includes(change?.kind)
          ||!validateScalar('Path',change.path).ok||change.fromPath!==undefined&&!validateScalar('Path',change.fromPath).ok))throw new Error('PROJECT_EXECUTION_HANDOFF_INVALID');
      const kinds:Record<string,string>={CREATE:"created",MODIFY:"modified",DELETE:"deleted",RENAME:"renamed",MODE:"permissions changed"};
      files=bullet(handoff.changes.map((change:any)=>`${change.path} — ${kinds[change.kind]}${change.fromPath?` (previously: ${change.fromPath})`:''}`),"No changes observed by the package.");
    }
    const integration=view.integrationStatus?`${view.integrationStatus==='INTEGRATED'?"Result integrated into the project":view.integrationStatus==='NOT_REQUIRED'?"Integration unnecessary":view.baselineReady===false?"Result awaiting integration or verification":"Recorded integration status"} (${view.integrationStatus}).`
      :"Unavailable: task completion alone does not certify project integration.";
    const pending=state.pendingGateId?ledger.records.find(record=>record.kind==='HumanGate'&&record.id===state.pendingGateId):undefined;
    const currentReason=projectExecutionReason(state);
    const overview=`Linked task: ${state.taskId}\nObjective\n${spec.objective}\n\nStatus: ${phase[state.state]}\nTask completion: ${state.state==='COMPLETED'?"verified":"not reached"}\nLast recorded update: ${state.updatedAt}\n${currentReason?`Current reason: ${currentReason}\n`:''}\nRequired checks on the current copy: ${passed} passed out of ${required.length}.\n${pending?.kind==='HumanGate'?`Pending decision: ${pending.value.type}.\n`:''}\nProject integration\n${integration}\n\nRecorded attempts: ${state.counters.attempts}; corrections: ${state.counters.reworkAttempts}; retries for technical problems: ${state.counters.infrastructureRetries}.\n\nThis reads the saved registry; it does not update continuously. Return to the plan to read it again.`;
    const checkLabels={PASSED:"passed",FAILED:"failed",NOT_RUN:"not executed",TIMED_OUT:"interrupted by timeout",INVALID:"invalid outcome"};
    const assessments={PASS:"satisfied",FAIL:"not satisfied",UNVERIFIABLE:"unverifiable"};
    const results=`Automated checks on the current copy\n${bullet(checks.map(check=>`${check.commandId}: ${checkLabels[check.status]} (evidence: ${check.id})`),"No current outcome available.")}\n\nIndependent review\n${review?.kind==='ReviewResult'?`${review.value.verdict==='PASS'?"Positive":review.value.verdict==='FAIL'?"Corrections required":"Inconclusive outcome"} (${review.value.verdict}). It does not replace task completion.\n${bullet(review.value.criteria.map(criterion=>`${spec.acceptanceCriteria.find(item=>item.id===criterion.criterionId)?.text??criterion.criterionId}: ${assessments[criterion.assessment.status]} — ${criterion.assessment.reason}`),"Criteria unavailable.")}`:"Not available yet."}\n\nWorking copy files observed by the package\n${files}\n\nThese files concern the working copy. Consult integration status separately to determine whether the result is in the project.`;
    const decisions=state.decisions.filter(decision=>!state.invalidEvidenceIds.includes(decision.id));
    const decisionText=decisions.length?decisions.map(decision=>`${decisionLabels[decision.kind]}\n${decision.reason}\nDecision: ${decision.id}\nLinked evidence: ${decision.evidenceRefs.join(', ')}`).join('\n\n'):"No recorded decisions available. Planned rationales remain intentions, not decisions made during execution.";
    return {available:true,overview,results,decisions:decisionText,technical:JSON.stringify({controlledTaskId:state.taskId,specHash:state.specHash,linkedSpecHash:link.specHash,
      revision:state.revision,state:state.state,blockedReason:state.blockedReason,terminalReason:state.terminalReason,candidate:state.candidate,runs:state.runs,counters:state.counters,validationIds:checks.map(check=>check.id),
      reviewId:review?.id,decisionIds:decisions.map(decision=>decision.id),integrationStatus:view.integrationStatus},null,2)};
  }catch(error){return unavailable(`Linked task: ${link.controlledTaskId}\nThe registry is unavailable for verified reading. Status, outcomes and changed files cannot be certified.\nDetail: ${error instanceof Error?error.message:'PROJECT_EXECUTION_UNAVAILABLE'}`)}
}
