import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectAutonomyRepository } from './project-autonomy.js';
import type { AutonomyDriver } from './project-autonomy.js';
import { contextInvestigationAnswerHints } from './context-investigation.js';
import { ContextInvestigationRepository } from './context-investigation-repository.js';
import { plannedSeedInvestigationBinding } from './project-planning-repository.js';
import { DurableStore } from './store.js';
import { classifyResumeAction } from './recovery-resume.js';
import { createProductionTask, recoverProductionWorkflow, runProductionWorkflow, executablePath, productionProjectMemory, productionIntegrationCheckpoints } from './production-bridge.js';
import type { ProductionCommandContext } from './production-bridge.js';
import { CandidatePromotionRepository } from './candidate-promotion-repository.js';
import { inspectArtifact } from './production-bridge.js';
import type { OrchestratorHost } from './orchestrator.js';
import type { PreTaskScout } from './pre-task-proposal.js';
import type { ControlledReviewerRunner } from './controlled-reviewer.js';
import { canonicalize } from './contracts.js';
import { consumePolicyCapability } from './policy-authorization.js';
import { hostValidationRecipeName } from './validation-proposals.js';

declare const process:{readonly env:Readonly<Record<string,string|undefined>>};
export function productionAutonomy(ctx:Pick<ProductionCommandContext,'cwd'>,create=false):ProjectAutonomyRepository|undefined {
 const data=realpathSync(process.env.PI_CODING_AGENT_DIR??join(process.env.HOME??'','.pi','agent'));
 return ProjectAutonomyRepository.open(data,realpathSync(ctx.cwd),inspectArtifact,create);
}
/** Production adapter invokes the existing task workflow, promotion and checkpoint services. */
export function productionAutonomyDriver(ctx:ProductionCommandContext,repo:ProjectAutonomyRepository,host:OrchestratorHost,scout:PreTaskScout,reviewer?:ControlledReviewerRunner):AutonomyDriver {
 return {
  activity(){const o=host.current;if(!o)return "Preparing the next task";const role=o.state.runs.at(-1)?.role;return `${role??'Host'}: ${o.spec.title}`;},
  async recover(runId){await CandidatePromotionRepository.withLease(repo.store.agentDataRoot,repo.repoRoot,inspectArtifact,async promotion=>{const pending=promotion.pendingPolicyAction();if(pending){if(promotion.git.head()===pending.proposal.integrationCommit)promotion.recover();else promotion.resumePolicyAction(repo.authorize(runId,'candidate-promotion',pending));}repo.recoverProgress(runId,promotion.results());});},
  async execute(plannedTaskId,runId){
   const policy=repo.assertCurrent(repo.run(runId)),planning=repo.planning(),plan=planning.current()!,automaticCtx={...ctx,autonomy:{repo,runId,plannedTaskId}};
   const prior=planning.links().find(l=>l.plannedTaskId===plannedTaskId&&l.planDigest===policy.plan.digest);
   if(prior){
    const storeRoot=join(planning.projectRoot,'tasks',prior.controlledTaskId),ledger=DurableStore.load(storeRoot);const spec=ledger.records.find(r=>r.kind==='TaskSpec'&&r.id===ledger.state.spec.id);if(!spec||spec.kind!=='TaskSpec')throw new Error('UNRESOLVED_RISK');repo.assertTaskEligible(runId,plannedTaskId,spec.value);
    if(ledger.state.state==='COMPLETED')return prior.controlledTaskId;
    const action=classifyResumeAction(repo.store.agentDataRoot,storeRoot);
    if(['CHILD_RECONCILIATION_REQUIRED','P16C_REPAIR_REQUIRED'].includes(action.action))throw new Error('PROVIDER_TERMINALITY_UNKNOWN: '+action.message);
    if(host.current&&host.current.state.taskId!==prior.controlledTaskId)throw new Error('PROVIDER_TERMINALITY_UNKNOWN');
    if(!host.current)await recoverProductionWorkflow(host,automaticCtx,'recover',{} as any,prior.controlledTaskId);
    const result=await recoverProductionWorkflow(host,automaticCtx,'resume',{} as any,prior.controlledTaskId);
    if('outcome' in result&&result.outcome==='COMPLETED')return prior.controlledTaskId;throw new Error('UNRESOLVED_RISK');
   }
   if(host.current&&!['COMPLETED','FAILED'].includes(host.current.state.state))throw new Error('PROVIDER_TERMINALITY_UNKNOWN');host.dispose();
   const seed=planning.prepareStart(plan.planId,plan.revision,plannedTaskId),before=planning.baseline(),task=plan.plannedTasks.find(t=>t.plannedTaskId===plannedTaskId)!,bound=policy.taskBounds.find(t=>t.plannedTaskId===plannedTaskId)!;
   const hints=[...seed.hints,`Autonomy: preserve exactly these criteria, in the same order: ${JSON.stringify(task.acceptanceIntent)}`,`Authorized limits: ${bound.allowedPaths.join(', ')}. Protected: ${bound.protectedPaths.join(', ')}. Executable checks frozen by policy (closed list): ${JSON.stringify(bound.validationCommands.map(c=>({recipe:hostValidationRecipeName(c),executable:c.executable,argv:c.argv})))}. In validations, reproduce only these recipes: npm corresponds to EXISTING_TEST/NPM_TEST; the host adds git diff --check and REVIEW adds no commands. Do not add CONTENT checks or invented expected code: CONTENT is permitted only if the comparison for that path and those lines is already in the authorized list. If an additional check is essential, declare it in risks; do not treat it as already authorized. In this execution, risks and ambiguities indicate concrete blockers preventing the task within approved limits. Do not include ordinary waiting for tests, which the host will execute, or input scenarios outside the required criteria; describe these informational limits in explanation. Do not hide concrete risks or ambiguities: if present, they must stop the task.`];
   const binding=plannedSeedInvestigationBinding(seed),investigation=ContextInvestigationRepository.open(repo.store.agentDataRoot,repo.repoRoot,inspectArtifact).bind({kind:'pre-task',...binding});
   // Autonomy stops at its first unresolved question. Restarting the same seed does not investigate it again.
   if(investigation.snapshot().pendingQuestions.length||!investigation.canInvestigate()){ctx.ui.notify("Automatic analysis requires clarification. Resume task preparation to read the saved questions; restarting autonomy does not reset attempts.",'warning');throw new Error('UNRESOLVED_RISK: CONTEXT_INVESTIGATION_OPERATOR_REQUIRED');}
   hints.push(...contextInvestigationAnswerHints(investigation.snapshot().answers));if(hints.length>64)throw new Error('UNRESOLVED_RISK: CONTEXT_INVESTIGATION_INPUT_LIMIT');
   const reservation=investigation.reserve();let proposal;
   try{proposal=await scout.propose(repo.repoRoot,seed.objective,hints,undefined,productionProjectMemory(ctx))}catch(error){investigation.finish(reservation);throw error}
   const questions=proposal.clarificationQuestions?.length?proposal.clarificationQuestions:proposal.ambiguities.map(question=>({question,why:"This question requires the operator's answer before the task can start."}));
   investigation.finish(reservation,proposal,questions);
   if(questions.length){ctx.ui.notify("Autonomy stops on an open clarification. Questions are saved: resume task preparation to answer them. No changes have started.",'warning');throw new Error('UNRESOLVED_RISK: CONTEXT_INVESTIGATION_OPERATOR_REQUIRED');}
   if(canonicalize(before)!==canonicalize(planning.baseline()))throw new Error('EXTERNAL_BASELINE_CHANGE');
   const spec=await createProductionTask(automaticCtx,async()=>proposal,{seed,scoutResult:proposal,beforeSave:(spec,manager)=>planning.linkPreparedTask(seed,spec,manager,true)});
   if(!spec)throw new Error('UNRESOLVED_RISK');ctx.ui.notify(`${plannedTaskId} started automatically as specified by the approved plan.`,'info');
   const result=await runProductionWorkflow(host,automaticCtx);
   if(result.outcome!=='COMPLETED')throw new Error(host.current?.state.runs.some(r=>r.status==='UNKNOWN')?'PROVIDER_TERMINALITY_UNKNOWN':result.outcome==='REWORK_REQUIRED'?'RETRY_EXHAUSTED':'UNRESOLVED_RISK');return spec.taskId;
  },
  async promote(taskId,runId){await CandidatePromotionRepository.withLease(repo.store.agentDataRoot,repo.repoRoot,inspectArtifact,async promotion=>{
   const p=await promotion.prepare(taskId,reviewer);if(!p){const binding=promotion.binding(taskId);if(!binding||promotion.status(taskId).status!=='NOT_REQUIRED')throw new Error('UNRESOLVED_RISK');const cap=repo.authorize(runId,'candidate-promotion',{noOp:{taskId,binding}} as any);repo.recordNoOp(runId,cap);repo.recordEffect(cap.ref,[promotion.bindingEvidence(taskId).ref],promotion.store);ctx.ui.notify("The verified result is already in the baseline: no Git change is necessary.",'info');return;}const q=promotion.prepareDecision(p.proposalId,'APPROVE');
   const authorization=repo.authorize(runId,'candidate-promotion',q.payload),result=promotion.applyPolicyAuthorization(authorization);
   repo.recordPromotion(runId,{taskId:result.taskId,previousHead:result.previousHead,resultingHead:result.resultingHead});repo.recordEffect(authorization.ref,[promotion.resultEvidence(result.taskId).ref],promotion.store);
   ctx.ui.notify(`${taskId} integrated into branch ${p.targetRef.replace('refs/heads/','')} after successful tests and review.`,'info');});},
  async checkpoint(runId){const run=repo.run(runId),p=repo.assertCurrent(run),checkpoints=productionIntegrationCheckpoints(ctx,true)!,planning=repo.planning(),links=planning.links();
   const previous=repo.decisions().filter(a=>a.runId===runId&&a.actionKind==='integration-checkpoint'&&a.decision==='ALLOWED').at(-1);
   if(previous&&previous.kind==='PolicyDerivedAuthorization'){
    const subject=previous.subject as any,definition=checkpoints.definitions().find(d=>d.checkpointId===subject.definition.checkpointId&&d.revision===subject.definition.revision);
    if(!definition||definition.contentDigest!==subject.definition.contentDigest)throw new Error('UNRESOLVED_RISK: checkpoint definition unavailable');
    const priorRuns=checkpoints.runs().filter(r=>r.definitionDigest===definition.contentDigest&&r.baseline.commit===run.expectedHead),last=priorRuns.at(-1);
    if(last){
     if(!last.outcome){checkpoints.recover(last.checkpointRunId);throw new Error('PROVIDER_TERMINALITY_UNKNOWN: interrupted checkpoint retained for inspection');}
     if(last.outcome!=='PASS')throw new Error((last.reason.includes('TERMINALITY_UNKNOWN')?'PROVIDER_TERMINALITY_UNKNOWN':'UNRESOLVED_RISK')+': '+last.reason);
     const ref=repo.store.put(`final-checkpoint-${last.checkpointRunId}`,canonicalize(last),'application/vnd.pi-controlled-dev.integration-checkpoint+json');repo.finish(runId,ref);repo.recordEffect(repo.decisionRef(previous.authorizationId),[ref]);return;
    }
    const authorization=repo.authorize(runId,'integration-checkpoint',subject);
    if(definition.status==='DRAFT')checkpoints.applyPolicyAuthorization(authorization);else if(definition.status==='APPROVED')consumePolicyCapability(authorization,'integration-checkpoint',subject,checkpoints.store);else throw new Error('PLAN_CHANGE_REQUIRED');
    const checked=await checkpoints.run(definition.checkpointId,definition.revision,checkpoints.baseline(),reviewer);
    const ref=repo.store.put(`final-checkpoint-${checked.checkpointRunId}`,canonicalize(checked),'application/vnd.pi-controlled-dev.integration-checkpoint+json');repo.finish(runId,ref);repo.recordEffect(authorization.ref,[ref]);return;
   }
   const draft=checkpoints.propose({title:"Final plan verification",purpose:"Verify the baseline produced by authorized tasks",controlledTaskRefs:run.promotions.map(p=>p.taskId),
    plannedTaskRefs:run.promotions.map(t=>{const l=links.find(l=>l.controlledTaskId===t.taskId)!;return {planId:l.planId,revision:l.planRevision,digest:l.planDigest,plannedTaskId:l.plannedTaskId,controlledTaskId:l.controlledTaskId}}),
    validationIntent:p.finalCheckpoint.validationIntent,validationPlan:p.finalCheckpoint.validationPlan,reviewRequired:true},executablePath);
   const q=checkpoints.prepareApproval(draft.checkpointId,draft.revision),raw=q.payload as any,authorization=repo.authorize(runId,'integration-checkpoint',{definitionRef:raw.definitionRef,definition:raw.definition,baseline:raw.baseline});
   checkpoints.applyPolicyAuthorization(authorization);
   const checked=await checkpoints.run(draft.checkpointId,draft.revision,checkpoints.baseline(),reviewer);
   const ref=repo.store.put(`final-checkpoint-${checked.checkpointRunId}`,canonicalize(checked),'application/vnd.pi-controlled-dev.integration-checkpoint+json');repo.finish(runId,ref);repo.recordEffect(authorization.ref,[ref]);
   ctx.ui.notify("The plan's tasks are integrated. The current baseline passed final integration verification.",'info');}
 };
}
