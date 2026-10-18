import { productionAutonomy } from './project-autonomy-production.js';
import { approvePlanAndAutonomy } from './project-autonomy-ui.js';
import { IntegrationCheckpointRepository } from './integration-checkpoint-repository.js';
import { integrationStatus } from './integration-checkpoint-ui.js';
import { chooseAction, withProgress, safeText, errorPresentation } from './controlled-ui.js';
import { PreTaskProposalError } from './pre-task-proposal.js';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers';
import { validateScalar } from './contracts.js';
import { planNarrative, planSummary, designNarrative, scopeOverlapWarnings, projectTaskStatusLabel } from './project-planning.js';
import { plannedTaskDetail, readPlannedExecution } from './project-plan-consultation.js';
import { ContextInvestigationRepository } from './context-investigation-repository.js';
import { rebuildProjectPlanningView, rebuildProjectMemoryView } from './human-repository.js';
import { ProjectMemoryRepository } from './project-memory-repository.js';
import { showProjectMemory } from './project-memory-ui.js';
import { canonicalize, hashCanonical } from './contract-json.js';
import type { ProductionCommandContext } from './production-bridge.js';
import type { ProjectPlanningRepository, PlannedTaskSeed } from './project-planning-repository.js';
import type { PreTaskScout } from './pre-task-proposal.js';
import type { ProjectPlan } from './project-planning.js';
import type { RefinementBinding, PlanningRefinementOutput } from './project-planning-scout.js';
export const REFINEMENT_GUIDANCE="Split the remaining work into specific, verifiable increments. Preserve the objective, protected assets, compatibility and completed tasks with their evidence. Separate setup, characterization, review and correction: do not assign a full inventory and all library tests to one Developer. Each implementation solves a concrete problem with a few files and a targeted check; do not force changes in already consistent components. Split a broad review into small explicit groups with reconcilable coverage. Use the index to estimate work, not as proof of having read modules. Each invocation has a 10-minute limit: leave time for structured delivery, avoid enormous documents or manual transcriptions of inventories that can be generated. Refine the next ready task first and preserve the rest of the plan; later tasks can be refined when new evidence arrives. Describe real dependencies and groups with disjoint files that could be reviewed in parallel; a suggested group does not authorize concurrent launches or integrations. Preserve attempts and partial results without declaring them validated or complete; do not reset limits and counters by changing identity. Do not run commands or make changes: return only a new proposal for approval.";
export function projectStatus(repo:ProjectPlanningRepository):string{
  const current=repo.current(),views=repo.progress(),labels={COMPLETED:["completed","completed"],ACTIVE:["in progress","in progress"],READY:["not started","not started"],WAITING:["waiting","waiting"],BLOCKED:["requires a decision","require a decision"],FAILED:["failed","failed"]} as const;
  const counts=(Object.keys(labels) as (keyof typeof labels)[]).map(status=>{const count=views.filter(v=>v.status===status).length;return `${count} ${labels[status][count===1?0:1]}`}).join('; ');
  const checkpoints=IntegrationCheckpointRepository.open(repo.store.agentDataRoot,repo.repoRoot,repo.store.artifactInspection);
  const checkpointText=checkpoints?integrationStatus(checkpoints):"Integration verification: not executed yet.";
  let conflict="No conflicts detected.";const goal=repo.goals().at(-1);
  try{if(goal)repo.planningMemory(goal,repo.options.memory)}catch(error){conflict=String(error)}
  return `Current plan: ${current?"revision "+current.revision:"no approved plan"}.\nPlanned tasks: ${views.length}. ${counts}\n\n${views.map(v=>`${v.task.title} — ${projectTaskStatusLabel(v.status)}\n${v.explanation}`).join('\n\n')}\n\nPossible next tasks: ${views.filter(v=>v.status==='READY').map(v=>v.task.title).join('; ')||"none"}. Choose which one to start.\nPlan conflicts: ${conflict}\n\n${checkpointText}`;
}
/** Consultation has no Scout, task creation, note regeneration or approval boundary. */
export async function consultProjectPlan(ctx:ProductionCommandContext,repo:ProjectPlanningRepository):Promise<void>{
  if(ctx.mode!=='tui'||!ctx.sessionManager.getSessionId()||!ctx.ui.select)throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  const session=ctx.sessionManager.getSessionId(),check=()=>{if(ctx.mode!=='tui'||ctx.sessionManager.getSessionId()!==session)throw new Error('HUMAN_CHANNEL_UNAVAILABLE')};
  const panel={section:"Consult the plan",scrollWithArrows:true};
  while(true){
    const plan=repo.current();
    if(!plan){await chooseAction(ctx.ui,"Consult the plan","No approved plan is available. Saved proposals can be read from the project menu before approval.",["Back"],undefined,panel);check();return}
    let views;
    try{views=repo.progress(plan)}catch(error){await chooseAction(ctx.ui,"Progress unavailable",`The approved plan is saved, but at least one task's registry prevents progress verification.\n${errorPresentation(error).message}`,["Back"],undefined,panel);check();return}
    const labels=views.map((view,i)=>`${i+1}. ${view.task.title} — ${projectTaskStatusLabel(view.status)}`);
    const choice=await chooseAction(ctx.ui,"Consult the plan",`Approved plan — revision ${plan.revision}\n\nCurrent situation: ${views.filter(view=>view.status==='COMPLETED').length} tasks completed out of ${views.length}.\nTask completion and project integration can be consulted separately.\n\nStrategy approved during planning\nThe following observations describe that moment; current status appears above and in the plan items.\n${plan.strategy}\n\n${views.map((view,i)=>`${i+1}. ${view.task.title}\n${view.task.objective}\nStatus: ${projectTaskStatusLabel(view.status)}\n${view.explanation}`).join('\n\n')}\n\nChoose an item to read its purpose, prerequisites, steps, checks and linked work. Consultation does not change the plan or start agents.`,
      [...labels,"Refresh progress",...(plan.design?["Project structure"]:[]),"Back"],undefined,panel);check();
    if(!choice||choice==="Back")return;
    if(choice==="Refresh progress")continue;
    if(choice==="Project structure"){await chooseAction(ctx.ui,"Project structure",designNarrative(plan.design!),["Back to plan"],undefined,panel);check();continue}
    const view=views[labels.indexOf(choice)];if(!view)throw new Error('PROJECT_PLAN_SELECTION_INVALID');
    while(true){
      const detail=await chooseAction(ctx.ui,view.task.title,plannedTaskDetail(plan,view),[...(view.links.length?["Linked task status","Outcomes and changed files","Recorded decisions","Technical details"]:[]),"Back to plan"],undefined,panel);check();
      if(!detail||detail==="Back to plan")break;
      const execution=readPlannedExecution(repo,view),body=detail==="Linked task status"?execution.overview:detail==="Outcomes and changed files"?execution.results:detail==="Recorded decisions"?execution.decisions:execution.technical;
      await chooseAction(ctx.ui,detail,body,["Back to plan item"],undefined,panel);check();
    }
  }
}
/** Compact existing command/TUI surface. Natural-language edits generate another draft and approval
 * always goes through the same trusted host boundary. Starting only invokes normal task formulation. */
export async function showProjectPlanning(ctx:ProductionCommandContext,repo:ProjectPlanningRepository,scout:PreTaskScout|undefined,memory:ProjectMemoryRepository|undefined,
  command:string,start:(seed:PlannedTaskSeed)=>Promise<void>,checkIntegration?:()=>Promise<void>):Promise<void>{
  if(ctx.mode!=='tui'||!ctx.sessionManager.getSessionId()||!ctx.ui.select)throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  const session=ctx.sessionManager.getSessionId(),check=()=>{if(ctx.mode!=='tui'||ctx.sessionManager.getSessionId()!==session)throw new Error('HUMAN_CHANNEL_UNAVAILABLE')};
  let contextMemory=memory??ProjectMemoryRepository.open(repo.store.agentDataRoot,repo.repoRoot,repo.store.artifactInspection);
  const panel={section:"Project plan",scrollWithArrows:true};
  if(['consult','view'].includes(command)){await consultProjectPlan(ctx,repo);check();return}
  if(command==='status'){await chooseAction(ctx.ui,"Project status",projectStatus(repo),["Back"],undefined,panel);check();return}
  let previous=repo.history().at(-1);
  const newRequest=command==='request'||ctx.planningRequest!==undefined;
  const latestGoal=repo.goals().at(-1);
  const savedDraft=!newRequest&&previous?.status==='DRAFT'&&previous.contentDigest!==repo.current()?.contentDigest&&latestGoal&&previous.projectGoalRef.id===`${latestGoal.goalId}-r${latestGoal.revision}`?previous:undefined;
  const selectedAction=newRequest?"New request":command==='refine'?"Break down the work":command==='start'?"Prepare the next task":command==='plan'?(savedDraft?"Review the saved proposal":"Edit the plan"):
    await chooseAction(ctx.ui,"Your project",`Folder\n${repo.repoRoot}\n\n${projectStatus(repo)}`,["New request",...(latestGoal?.clarifications?.some(q=>q.answer===null)?["Resume clarifications"]:[]),...(savedDraft?["Review the saved proposal"]:[]),...(repo.current()?["Consult the plan","Continue the work","Break down the work"]:[]),"Edit the plan","Details and checks","Back"],undefined,panel);
  const action=selectedAction==="Edit the plan"?"Review the plan":selectedAction;
  check();if(!action||action==="Back")return;
  if(action==="Consult the plan"){await consultProjectPlan(ctx,repo);check();return}
  let refinement:RefinementBinding|undefined,refinementFeedback:PlanningRefinementOutput|undefined;
  if(action==="Break down the work"){
    const current=repo.current();if(!current){ctx.ui.notify("Approve a plan before choosing the task to split.",'info');return}
    const eligible=current.plannedTasks.filter(task=>{try{repo.prepareRefinement(current.contentDigest,task.plannedTaskId);return true}catch(error){
      if(error instanceof Error&&['PROJECT_REFINEMENT_LINKED','PROJECT_REFINEMENT_STALE'].includes(error.message))return false;throw error;}});
    if(!eligible.length){ctx.ui.notify("No tasks can be split now. The plan changed or work has already started. Open Edit the plan to propose a change.",'info');return}
    const labels=eligible.map((task,i)=>`${i+1}. ${task.title}`),choice=await chooseAction(ctx.ui,"Which task do you want to split?",
      "Choose a task that has not started yet. The agent will split it into at most three smaller tasks. The rest of the plan will be preserved. You can read and approve the new plan before starting.",["Back",...labels],undefined,panel);check();
    if(!choice||choice==="Back")return;
    const selected=eligible[labels.indexOf(choice)];if(!selected)throw new Error('PROJECT_REFINEMENT_BINDING');
    refinement=repo.prepareRefinement(current.contentDigest,selected.plannedTaskId);previous=current;
  }
  if(action==="Integration verification"){await checkIntegration?.();return}
  if(action==="Details and checks"){
    const choice=await chooseAction(ctx.ui,"Project details",projectStatus(repo),[...(checkIntegration?["Integration verification"]:[]),"Regenerate notes","Back"],undefined,panel);check();
    if(choice==="Integration verification")await checkIntegration?.();
    if(choice==="Regenerate notes"){rebuildProjectPlanningView(repo);ctx.ui.notify("Project notes regenerated.",'info')}return;
  }
  if(action==="Regenerate notes"){rebuildProjectPlanningView(repo);ctx.ui.notify("Project notes regenerated. Personal notes are preserved.",'info');return}
  if(action==="Prepare the next task"||action==="Continue the work"){
    const current=repo.current(),views=repo.progress(),ready=views.filter(v=>v.status==='READY'&&!v.task.requiresRefinement);
    if(current&&!ready.length&&views.some(v=>v.status==='READY'&&v.task.requiresRefinement)){
      const next=await chooseAction(ctx.ui,"The next work must be split","The remaining work is too broad for a single task. Choose Break down the work to obtain smaller tasks. The required result remains in the plan.",["Break down the work","Back"],undefined,panel);check();
      if(next==="Break down the work")await showProjectPlanning(ctx,repo,scout,memory,'refine',start,checkIntegration);return;
    }
    if(!current||!ready.length){ctx.ui.notify("No tasks are ready to start.",'info');return}
    const labels=ready.map((v,i)=>ready.length===1?v.task.title:`${i+1}. ${v.task.title}`),choice=ready.length===1?labels[0]:await chooseAction(ctx.ui,"Choose the next work","These tasks are ready. Choose the result to work on next.",labels,undefined,panel);
    check();if(choice){
      const task=ready[labels.indexOf(choice)].task;
      const seed=await withProgress(ctx.ui,()=>`Status: Preparing the proposal\nObjective: ${task.objective}\nWhy it matters: ${task.rationale}`,async()=>{
        // Paint the selected objective after the initial progress frame, before
        // synchronous baseline checks. The execution capability remains fresh.
        await new Promise<void>(resolve=>setTimeout(resolve,25));check();
        return repo.prepareStart(current.planId,current.revision,task.plannedTaskId);
      },"Preparing the next work");
      await start(seed);
    }return;
  }
  const newestGoal=repo.goals().at(-1),newGoal=action==="New request";
  let goal=newGoal?undefined:newestGoal;
  const input=async(title:string,why:string,position={step:1,total:2,section:panel.section},initial='')=>{
    const presentation={...position,question:title,why};
    if(!ctx.ui.wizardInput&&!ctx.ui.editor)throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
    const value=ctx.ui.wizardInput?await ctx.ui.wizardInput(`${position.section} (${position.step}/${position.total})`,initial,presentation):await ctx.ui.editor!(`${title}\n${why}`,initial);check();return value;
  };
  if(!goal){const objective=ctx.planningRequest??await input("What result do you want to achieve?","Describe freely what you want to build, continue or change in the project.");if(!objective?.trim())return;
    if(!validateScalar('Text',objective.trim()).ok)throw new Error('PROJECT_GOAL_INVALID');goal=repo.createGoal(objective.trim());}
  let correction:string|undefined,draft:ProjectPlan|undefined=action==="Review the saved proposal"?savedDraft:undefined;
  const correct=()=>input("What do you want to change in the plan?","You can change the work order, combine tasks or split them. The agent will prepare a new proposal for you to read. The current plan remains valid until you approve the change.");
  const sameGoal=previous&&repo.goals().some(g=>previous?.projectGoalRef.id===`${g.goalId}-r${g.revision}`&&g.goalId===goal!.goalId);
  if(previous&&!draft&&sameGoal&&!newGoal&&!goal.clarifications?.some(q=>q.answer===null)){correction=action==="Break down the work"?`${REFINEMENT_GUIDANCE}\nStatus observed by the project:\n${projectStatus(repo)}`:await correct();if(!correction?.trim())return;
    if(!validateScalar('Text',correction).ok)throw new Error('PROJECT_PLAN_CORRECTION_INVALID');}
  const investigation=ContextInvestigationRepository.open(repo.store.agentDataRoot,repo.repoRoot,repo.store.artifactInspection,repo.options).bind({
    kind:'planning',subjectId:goal.goalId,scopeDigest:hashCanonical({constraints:goal.constraints,scope:refinement?[...new Set(previous!.plannedTasks.find(task=>task.plannedTaskId===refinement!.targetTaskId)!.scopeIntent)].sort():['whole-project'],target:refinement?.targetTaskId??null})});
  const answeredGoal=goal.clarifications?.filter(q=>q.answer!==null).map(q=>({question:q.question,answer:q.answer!}))??[];
  if(investigation.snapshot().revision===0&&answeredGoal.length)investigation.confirmAnswers(answeredGoal,true);
  let investigationQuestions:readonly {question:string;why?:string}[]|undefined;
  while(true){
    if(!draft){
      const savedInvestigation=investigation.snapshot();
      // A crash after saving a human reply in ProjectGoal must not lose that explicit reply.
      if(savedInvestigation.pendingQuestions.length&&savedInvestigation.humanDigest!==hashCanonical(goal.clarifications?.filter(q=>q.answer!==null).map(q=>({question:q.question,answer:q.answer!}))??[])&&savedInvestigation.pendingQuestions.every(q=>goal!.clarifications?.some(saved=>saved.question===q.question&&saved.answer!==null))&&!goal.clarifications?.some(q=>q.answer===null)){
        investigation.confirmAnswers(goal.clarifications!.filter(q=>q.answer!==null).map(q=>({question:q.question,answer:q.answer!})),true);
      }
      if(!investigation.canInvestigate()&&!goal.clarifications?.some(q=>q.answer===null)){
        const savedQuestions=investigation.ensureOperatorQuestion();
        goal=repo.saveClarifications(goal,[...(goal.clarifications??[]),...savedQuestions.map(q=>({...q,questionId:`question-${randomUUID()}`,answer:null}))]);rebuildProjectPlanningView(repo);
      }
      const pending=goal.clarifications?.filter(q=>q.answer===null)??[];
      for(const [i,question] of pending.entries()){
        const prior=goal.clarifications?.findLast(old=>old.question.trim().toLocaleLowerCase('it')===question.question.trim().toLocaleLowerCase('it')&&old.answer!==null);
        const why=`${question.why}${prior?`\nPrevious answer preserved: ${prior.answer}\nMore precise clarification is required; the previous answer remains in history.`:''}${question.suggestedAnswer?"\nSuggested answer: you may approve or edit it. Submit it explicitly to save it.":''}`;
        const answer=await input(question.question,why,{step:i+1,total:pending.length,section:"Clarifications"},question.suggestedAnswer??'');
        if(!answer?.trim()){ctx.ui.notify("Request and clarifications saved. You can resume with /controlled-dev.",'info');return}
        if(!validateScalar('Text',answer.trim()).ok)throw new Error('PROJECT_GOAL_INVALID');
        goal=repo.saveClarifications(goal,goal.clarifications!.map(q=>q.questionId===question.questionId?{...q,answer:answer.trim()}:q));
        rebuildProjectPlanningView(repo);
      }
      if(pending.length){investigation.confirmAnswers(goal.clarifications!.filter(q=>q.answer!==null).map(q=>({question:q.question,answer:q.answer!})),true);investigationQuestions=undefined;}
      if(!scout)throw new Error('PRE_TASK_SCOUT_UNAVAILABLE');
      if(ctx.prepareProjectBaseline&&!await ctx.prepareProjectBaseline())return;
      const baseline=repo.baseline(),selection=repo.planningMemory(goal,contextMemory);
      let result;const reservation=investigation.reserve();
      try{result=await withProgress(ctx.ui,()=> "Status: Project analysis\nLast completed step: The request was saved.",()=>scout.plan(ctx.cwd,{goal:goal!,previous,correction,selection,...(investigationQuestions?{investigationQuestions}:{}),...(refinement?{refinement,...(refinementFeedback?{refinementFeedback}: {})}: {})},contextMemory))}catch(error){
        investigation.finish(reservation);check();
        if(!(error instanceof PreTaskProposalError)||!error.diagnostic.terminationVerified||!['PRE_TASK_PROVIDER_CONNECTION_FAILED','PRE_TASK_SCOUT_FAILED','PROJECT_REFINEMENT_LIMIT'].includes(error.code))throw error;
        const choice=await chooseAction(ctx.ui,"Project analysis interrupted",errorPresentation(error).message+"\n\nThe project and objective are saved. The agent ended the attempt. You may retry: the project and request are already saved.",["Retry analysis","Back to project"],undefined,panel);check();
        if(choice==="Retry analysis")continue;
        throw error;
      }
      check();
      const observed=investigation.finish(reservation,result,'clarificationQuestions' in result?result.clarificationQuestions.map(({question,why,suggestedAnswer})=>({question,why,...(suggestedAnswer!==undefined?{suggestedAnswer}:{})})):[]);
      if('clarificationQuestions' in result){
        ctx.ui.notify(`Investigation ${observed.attempts}: ${observed.newFacts} new verified reads. This count indicates files read, not correctness or understanding of their content. ${observed.retry?"Still searching files for missing information before requesting clarification.":"The investigation limit was reached or reads add no information. Your clarification is required."}`,'info');
        if(observed.retry){investigationQuestions=result.clarificationQuestions;continue;}
        investigationQuestions=undefined;
        const held=goal.clarifications??[];
        const questions=result.clarificationQuestions.map(q=>({...q,questionId:held.some(old=>old.questionId===q.questionId)?`question-${randomUUID()}`:q.questionId,answer:null}));
        goal=repo.saveClarifications(goal,[...held,...questions],result.analysis);rebuildProjectPlanningView(repo);continue;
      }
      draft=repo.propose(goal.goalId,result,baseline);
      rebuildProjectPlanningView(repo);
    }
    if(draft.memoryProposals?.length){
      contextMemory??=ProjectMemoryRepository.open(repo.store.agentDataRoot,repo.repoRoot,repo.store.artifactInspection,{create:true})!;
      for(const proposal of draft.memoryProposals){const entries=contextMemory.entries();
        if(!entries.some(({record})=>{const {recordKind,title,scope,content,evidenceRefs,relatedTaskRefs,relatedRecordRefs}=record;return ['PROPOSED','ACCEPTED','ACTIVE'].includes(record.status)&&canonicalize({recordKind,title,scope,content,evidenceRefs,relatedTaskRefs,relatedRecordRefs})===canonicalize(proposal)}))contextMemory.propose(proposal,{role:'Scout'});
      }
      rebuildProjectMemoryView(contextMemory);
    }
    const choice=await chooseAction(ctx.ui,"Read the proposed plan",`Official folder\n${repo.repoRoot}\n\nObjective\n${goal.objective}\nConstraints: ${goal.constraints.join('; ')||"no additional constraints"}\nExpected success: ${goal.successIntent.join('; ')}\n\nDraft — revision ${draft.revision}. This choice starts no tasks.\n\n${repo.refinementNarrative(draft.revision)}${planSummary(draft)}\n\n${scopeOverlapWarnings(draft).join('\n')}`,["Approve the plan","Correct the proposal","Read structure and details",...(draft.memoryProposals?.length?["Saved decisions"]:[]),"Back"],
      {step:2,total:2,section:panel.section,question:"Does the plan cover the result you want?",why:"Review what each task delivers, why it matters and which prerequisites it requires; correct the proposal before final confirmation."});check();
    if(choice==="Read structure and details"){await chooseAction(ctx.ui,"Plan structure and details",planNarrative(draft),["Back to summary"],undefined,panel);check();continue}
    if(choice==="Saved decisions"){
      const before=canonicalize(contextMemory!.entries());await showProjectMemory(ctx,contextMemory);check();
      if(before!==canonicalize(contextMemory!.entries())){previous=draft;draft=undefined;refinement=undefined;refinementFeedback=undefined;correction="Update the design and plan using current Project Memory decisions; do not duplicate recently assessed memories."}continue;
    }
    if(choice==="Approve the plan"){const approved=ctx.autonomyPlanning?await approvePlanAndAutonomy(ctx,repo,draft,productionAutonomy(ctx,true)!):await repo.approve(ctx,draft.revision);rebuildProjectPlanningView(repo);
      if(approved){ctx.ui.notify(approved==='BOUNDED_AUTONOMOUS'?(ctx.onAutonomyApproved?"Plan and autonomy approved. Consult project status for the result or outstanding decisions.":"Plan and autonomy approved. Start automatic development from the project menu."):"Plan approved. You may continue with the next task.",'info');
        if(ctx.continueAfterPlan&&approved!=='BOUNDED_AUTONOMOUS')await showProjectPlanning({...ctx,continueAfterPlan:false},repo,scout,contextMemory,'',start,checkIntegration);return}
      ctx.ui.notify("Approval canceled. You may still correct the plan or go back.",'info');continue}
    if(choice!=="Correct the proposal"){
      ctx.ui.notify(safeText(`Plan proposal saved\nOfficial folder: ${repo.repoRoot}\nStatus: draft, revision ${draft.revision}.\nNo task has started.`),'info');return;
    }
    correction=await correct();if(!correction?.trim())return;
    if(!validateScalar('Text',correction).ok)throw new Error('PROJECT_PLAN_CORRECTION_INVALID');
    const bound=repo.prepareRefinementCorrection(draft.revision);
    if(bound){previous=bound.previous;refinement=bound.binding;refinementFeedback=bound.proposal;}
    else {previous=draft;refinement=undefined;refinementFeedback=undefined;}
    draft=undefined;
  }
}
