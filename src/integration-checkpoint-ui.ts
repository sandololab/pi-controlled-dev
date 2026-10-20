import { hasHumanChannel } from './external-human-channel.js';
import { chooseAction, withProgress, errorPresentation } from './controlled-ui.js';
import { checkpointCommands } from './integration-checkpoint.js';
import type { IntegrationCheckpointRepository } from './integration-checkpoint-repository.js';
import type { ControlledReviewerRunner } from './controlled-reviewer.js';
import type { ProductionCommandContext } from './production-bridge.js';
import { executablePath } from './production-bridge.js';
import { ProjectPlanningRepository } from './project-planning-repository.js';
import { rebuildIntegrationCheckpointView } from './human-repository.js';
import { DurableStore } from './store.js';
import { join } from 'node:path';
import type { IntegrationCheckpointRun, IntegrationBaselineReference, IntegrationCheckpointDefinition } from './integration-checkpoint.js';
import type { TaskWizardDraft } from './pre-task-proposal.js';
export interface CheckpointTaskDescription {readonly taskId:string;readonly title:string;readonly contribution:string}
const branch=(b:IntegrationBaselineReference)=>b.targetRef.slice('refs/heads/'.length);
const brief=(text:string,limit=240)=>text.length>limit?text.slice(0,limit-1)+'…':text;
/** Read-only labels from the exact stored task/plan, never inferred from IDs or source files.
 * Missing descriptive data is shown honestly; eligibility and authority remain in the repository. */
export function checkpointTaskDescriptions(repo:IntegrationCheckpointRepository,d:Pick<IntegrationCheckpointDefinition,'controlledTaskRefs'|'plannedTaskRefs'>,run?:IntegrationCheckpointRun):CheckpointTaskDescription[]{
  const planning=ProjectPlanningRepository.open(repo.store.agentDataRoot,repo.repoRoot,repo.store.artifactInspection),history=planning?.history()??[];
  return d.controlledTaskRefs.map((id,n)=>{
    const ledger=DurableStore.load(join(repo.projectRoot,'tasks',id)),hash=run?.coverage.find(c=>c.taskId===id)?.specHash;
    const record=ledger.records.find(r=>r.kind==='TaskSpec'&&(hash?r.value.specHash===hash:r.id===ledger.state.spec.id));
    const spec=record?.kind==='TaskSpec'?record.value:undefined,ref=d.plannedTaskRefs.find(r=>r.controlledTaskId===id);
    const planned=ref?history.find(p=>p.planId===ref.planId&&p.revision===ref.revision&&p.contentDigest===ref.digest)?.plannedTasks.find(t=>t.plannedTaskId===ref.plannedTaskId):undefined;
    const title=planned?.title??spec?.title;
    return {taskId:id,title:title&&title!==id?brief(title,100):`Included change ${n+1}`,contribution:brief(spec?.objective??planned?.objective??"The contribution's description is unavailable.")};
  });
}
const modifications=(tasks:readonly CheckpointTaskDescription[])=>tasks.map(t=>`${t.title}
${t.contribution}`).join('\n\n')||"No changes described.";
export function checkpointOutcomeExplanation(outcome:IntegrationCheckpointRun['outcome']):string {
  return outcome==='PASS'?"The verified version passed every check specified by this integration verification.":outcome==='FAIL'?"We found a problem during integration verification. Verification did not modify the original project.":outcome==='BLOCKED'?"Verification could not be completed reliably. We cannot conclude that the checks succeeded.":"Verification is incomplete: no result is available yet.";
}
export function checkpointVersionExplanation(selected:IntegrationBaselineReference,current:IntegrationBaselineReference):string {
  return selected.commit===current.commit&&selected.targetRef===current.targetRef?`The current version of branch ${branch(selected)} will be verified.`:`The selected version of branch ${branch(selected)} is not the current version. This verification concerns only the selected version; it excludes subsequent changes.`;
}
export function checkpointOverview(d:IntegrationCheckpointDefinition,b:IntegrationBaselineReference,current:IntegrationBaselineReference,tasks:readonly CheckpointTaskDescription[]):string {
  const why=tasks.length>1?"This proposal concerns the selected changes. Verification checks that separately developed parts also work correctly together.":"This verification checks the selected result in the context of the project version containing it.";
  return `Why this verification\n${why}
${d.purpose}\n\nProject version\n${checkpointVersionExplanation(b,current)}\n\nIncluded changes\n${modifications(tasks)}`;
}
export function checkpointChecks(d:IntegrationCheckpointDefinition):string {
  return `What will be checked\n${d.validationIntent.join('\n')}
${d.validationPlan.map(v=>`${v.kind==='EXISTING_TEST'?'Test':v.kind==='CONTENT'?"File check":"Technical review"}: ${v.description}`).join('\n')}

${d.scenarios.length?"Scenarios: "+d.scenarios.map(s=>`${s.title} — ${s.purpose}`).join('\n'):"No additional scenarios are planned."}
${d.scenarios.length?"Results and runtime observations will be collected for executed scenarios.":"Results and logs from the executed checks will be preserved."}\nIndependent technical review: ${d.reviewRequired?"planned":"not planned"}.`;
}
export function checkpointAuthorization(d:IntegrationCheckpointDefinition,start:boolean):string {
  const action=start?"You are authorizing the verification described above to start.":"You are approving the verification proposal described above. This approval does not start the checks: you can start them later with a separate action.";
  return `${action}\n\nDuring this verification, pi-controlled-dev will not modify the project. Checks will run on an isolated copy of the exact specified version. Uncommitted local changes will not be included.\nThis authorization does not permit code changes, merges, rollbacks or other changes to the project branch.\n\n${checkpointChecks(d)}\n\nResult\nIf the checks succeed, the result applies only to this exact version. If they find a problem, evidence is preserved and the project is not corrected automatically. If reliable evidence is missing, verification remains blocked.`;
}
export function checkpointTechnicalDetails(d:IntegrationCheckpointDefinition,b:IntegrationBaselineReference,run?:IntegrationCheckpointRun):string {
  return `Technical details\ncheckpointId: ${d.checkpointId}
definitionRevision: ${d.revision}
Definition digest: ${d.contentDigest}
projectId: ${b.projectId}
targetRef: ${b.targetRef}
baselineCommit: ${b.commit}
tree: ${b.tree}
Task IDs: ${d.controlledTaskRefs.join(', ')}
Planned task refs: ${d.plannedTaskRefs.map(r=>`${r.plannedTaskId} / ${r.planId} r${r.revision} / ${r.digest}`).join('; ')||"none"}\nPlanned commands: ${d.commands.map(c=>c.id).join(', ')}\nScenarios: ${d.scenarios.map(s=>`${s.scenarioId} v${s.version} / ${s.scenarioHash}`).join('; ')||"none"}${run?`
Run ID: ${run.checkpointRunId}
Outcome: ${run.outcome??'INCOMPLETE'}\nRecorded reason: ${run.reason}
Coverage refs: ${run.coverage.map(c=>`${c.taskId}: ${c.completionRef.id}; ${c.promotionResultRef?.id??"integration unnecessary"}`).join('\n')}
Evidence refs: ${run.evidenceRefs.map(r=>`${r.id} / ${r.digest}`).join('\n')}
Reviewer ref: ${run.reviewRef?.id??"unavailable"}`:''}`;
}
export function integrationStatus(repo:IntegrationCheckpointRepository):string {
  const s=repo.status(),latest=repo.definitions().find(d=>d.contentDigest===s.latest?.definitionDigest),tasks=latest?checkpointTaskDescriptions(repo,latest,s.latest):[];
  const state=checkpointStatusExplanation(s.status);
  return `This verification checks that integrated changes also work correctly together. You can review a proposal, approve it and start it with a separate action.\n\nProject version: branch ${branch(s.baseline)}, current version.\nLatest verification: ${latest?.title??"none"}.\n\nResult\n${s.latest?checkpointOutcomeExplanation(s.latest.outcome):"No verification has been executed yet."}\n${state}\n\nChanges included in the latest verification\n${tasks.map(t=>t.title).join('; ')||"None."}\n\nCompleting individual tasks, integrating their results and verifying them together are three separate steps.`;
}
export function checkpointStatusExplanation(value:string):string {
  return value==='STALE'?"A successful verification concerns an earlier project version. The project now contains later changes; the current version has not been verified yet.":value==='VERIFIED'?"The current version passed integration verification.":value==='FAILED'?"Verification of the current version found a problem.":"The current version does not yet have a successful integration verification.";
}
export function checkpointResultPresentation(repo:IntegrationCheckpointRepository,d:IntegrationCheckpointDefinition,run:IntegrationCheckpointRun,tasks:readonly CheckpointTaskDescription[]):string {
  const current=repo.baseline(),stale=current.commit!==run.baseline.commit;
  const checks=run.evidenceRefs.filter(r=>r.mediaType==='application/vnd.pi-controlled-dev.integration-checkpoint+json').map(r=>repo.read(r)).filter(e=>e.kind==='checkpoint-validation');
  const recipeNames={NPM_TEST:'npm',PYTEST:'python3',CARGO_TEST:'cargo',MAVEN_TEST:'mvn',GRADLE_TEST:'gradle',MAKE_TEST:'make'} as const;
  const status=(v:string)=>v==='PASS'?"succeeded":v==='FAIL'?"problem found":"not reliably concluded";
  const results=checks.map(e=>{const scenario=e.scenarioHash?d.scenarios.find(s=>s.scenarioHash===e.scenarioHash):undefined;
    const command=d.commands.find(c=>c.id===e.result.commandId),recipe=d.validationPlan.find(v=>v.kind==='CONTENT'?command?.argv[0]==='-e'&&command.argv[3]===v.paths[0]:v.kind==='EXISTING_TEST'&&command?.executable.split('/').at(-1)===recipeNames[v.mechanism!]&&JSON.stringify(command?.argv)===JSON.stringify(({NPM_TEST:['test'],PYTEST:['-m','pytest'],CARGO_TEST:['test'],MAVEN_TEST:['test'],GRADLE_TEST:['test'],MAKE_TEST:['test']} as const)[v.mechanism!]));
    return `${scenario?'Scenario: '+scenario.title:recipe?.description??(command?.argv[0]==='diff'?"File formatting check":"Planned check")}: ${status(e.result.status)}.`;});
  const review=run.reviewRef?repo.read(run.reviewRef).result:undefined;
  const reason=errorPresentation(new Error(run.reason)),humanReason=reason.code==='CONTROLLED_ACTION_FAILED'?(run.reason.includes('CHECKPOINT_')||/^Error:/.test(run.reason)?"The technical reason is available in the details.":run.reason):reason.message;
  return `${checkpointOutcomeExplanation(run.outcome)}\n\nProject version\nBranch ${branch(run.baseline)}: version ${stale?"previous":"current"} at the time of this summary.${stale?" This verification still applies to the checked version, but the project now contains later changes. This result does not verify the current version.":''}\n\nIncluded changes\n${modifications(tasks)}\n\nMain results\n${results.join('\n')||"No executed check has a demonstrable result."}
${run.outcome!=='PASS'?humanReason:''}\n\nEvidence\n${run.evidenceRefs.length} preserved references; results, logs and evidence are available in Integration/Runs notes.\n\nTechnical review\n${review?`Independent assessment: ${status(review.verdict)}.`:d.reviewRequired?"No verifiable independent review is available.":"It was not planned for this verification."}\n\nLimitations and next step\n${run.outcome==='FAIL'?"Review the failed checks and evidence; a correction requires a normal controlled task.":run.outcome==='BLOCKED'?"Review the reason and available evidence before considering another execution.":"The result concerns the selected interactions, not all project requirements or a release."}\nVerification does not correct code or undo integrations.`;
}
/** Explicit TUI only. Models propose intent; the host detects existing closed recipes at the
 * exact commit. A native receipt approves the immutable Definition, never free shell text. */
export async function showIntegrationCheckpoints(ctx:ProductionCommandContext,repo:IntegrationCheckpointRepository,reviewer?:ControlledReviewerRunner):Promise<void> {
  if(!hasHumanChannel(ctx)||!ctx.sessionManager.getSessionId()||!ctx.ui.select)throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  const session=ctx.sessionManager.getSessionId(),check=()=>{if(!hasHumanChannel(ctx)||ctx.sessionManager.getSessionId()!==session)throw new Error('HUMAN_CHANNEL_UNAVAILABLE')};
  const panel={section:"Integration verification",scrollWithArrows:true};
  const details=async(d:IntegrationCheckpointDefinition,b:IntegrationBaselineReference,run?:IntegrationCheckpointRun)=>{await chooseAction(ctx.ui,"Technical details",checkpointTechnicalDetails(d,b,run),["Back to summary"],undefined,panel);check()};
  const reviewProposal=async(d:IntegrationCheckpointDefinition,b:IntegrationBaselineReference,start:boolean)=>{
    const tasks=checkpointTaskDescriptions(repo,d);
    while(true){const next=await chooseAction(ctx.ui,d.title,checkpointOverview(d,b,repo.baseline(),tasks),["Continue","Technical details","Go back"],undefined,panel);check();
      if(next==="Technical details"){await details(d,b);continue}if(next!=="Continue")return false;break}
    while(true){const next=await chooseAction(ctx.ui,start?"Start verification":"Approve the proposal",checkpointAuthorization(d,start),[start?"Start verification":"Approve proposal","Technical details","Go back","Cancel"],undefined,panel);check();
      if(next==="Technical details"){await details(d,b);continue}return next===(start?"Start verification":"Approve proposal")}
  };
  const action=await chooseAction(ctx.ui,"Integration verification",integrationStatus(repo),["Propose a verification","Review a proposal","Edit a proposal","Run an approved verification","Recover an interrupted verification","Regenerate notes","Back"],undefined,panel);check();
  if(!action||action==="Back")return;
  if(action==="Regenerate notes"){rebuildIntegrationCheckpointView(repo);ctx.ui.notify("Verification notes updated.",'info');return}
  if(action==="Recover an interrupted verification"){
    const pending=repo.recoverableRuns(),definitions=repo.definitions(),labels=pending.map((r,n)=>`${definitions.find(d=>d.contentDigest===r.definitionDigest)?.title??"Interrupted verification"} — execution ${n+1}`),selected=await chooseAction(ctx.ui,"Interrupted verifications","Recovery preserves partial evidence and records a blocked state; completed results remain unchanged. It requires a definitely terminated owner and does not restart agents.",[...labels,"Back"],undefined,panel);check();
    if(selected&&selected!=="Back"){repo.recover(pending[labels.indexOf(selected)].checkpointRunId);rebuildIntegrationCheckpointView(repo)}return;
  }
  let draft, previous:IntegrationCheckpointDefinition|undefined;
  if(action==="Edit a proposal"){
    const definitions=repo.definitions().filter(d=>d.status==='APPROVED'),labels=definitions.map(d=>`${d.title} — proposal ${d.revision}`),choice=await chooseAction(ctx.ui,"Which proposal should be updated?","The approved proposal remains in history. Changing what will be checked requires approval again.",[...labels,"Back"],undefined,panel);check();if(!choice||choice==="Back")return;previous=definitions[labels.indexOf(choice)];
  }
  if(action==="Propose a verification"||previous){
    const b=repo.baseline(),eligible=repo.eligibleTasks(b);if(!eligible.length){ctx.ui.notify("No changes with proven integration into the current project version are available.",'warning');return}
    const taskDescriptions=checkpointTaskDescriptions(repo,{controlledTaskRefs:eligible,plannedTaskRefs:previous?.plannedTaskRefs??[]}),labels=taskDescriptions.map((t,n)=>`${t.title} — change ${n+1}`);
    const selected:string[]=previous?.controlledTaskRefs.filter(id=>eligible.includes(id))??[];
    while(true){const choices=eligible.map((id,n)=>`${selected.includes(id)?'✓ ':'+ '}${labels[n]}`),choice=await chooseAction(ctx.ui,"Which results should be verified together?",`Project version: branch ${branch(b)}, current version.\nAvailable changes\n${modifications(taskDescriptions)}\n\nSelected: ${taskDescriptions.filter(t=>selected.includes(t.taskId)).map(t=>t.title).join('; ')||"none"}`,["Continue",...choices,"Back"],undefined,panel);check();
      if(!choice||choice==="Back")return;if(choice==="Continue"){if(selected.length)break;continue}const id=eligible[choices.indexOf(choice)],at=selected.indexOf(id);if(at<0)selected.push(id);else selected.splice(at,1);
    }
    const purpose=await ctx.ui.editor?.("Why verify these results together?",previous?.purpose??"Verify the interaction of integrated components through the repository's current checks.");check();if(!purpose?.trim())return;
    const plan:TaskWizardDraft['validationPlan']=[];
    const supported=[['NPM_TEST','package.json',"Repository suite"],['PYTEST','pytest.ini',"Python tests"],['CARGO_TEST','Cargo.toml',"Rust tests"],['MAVEN_TEST','pom.xml',"Maven tests"],['GRADLE_TEST','build.gradle',"Gradle tests"],['MAKE_TEST','Makefile',"Make tests"]] as const;
    for(const [mechanism,file,description] of supported)try{const content=repo.git.fileAt(b.commit,file);if(mechanism==='NPM_TEST'&&!JSON.parse(content).scripts?.test)continue;
      const choice=await chooseAction(ctx.ui,"Integrated checks",`${description}: available in the selected project version. The tests specified by the repository configuration will run.`,["Include","Exclude"],undefined,panel);check();if(choice==="Include")plan.push({kind:'EXISTING_TEST',description,mechanism,paths:[],expectedLines:[]});
    }catch(error){if(!(error as {code?:string}).code?.startsWith('GIT_'))throw error}
    if(!plan.length){ctx.ui.notify("An executable integrated check is missing: the Git formatting check alone does not demonstrate interaction.",'warning');return}
    const commands=checkpointCommands(plan,executablePath),available=repo.availableScenarios(selected,commands),scenarios=[];
    for(const s of available){const choice=await chooseAction(ctx.ui,"Available scenarios",`${s.title}, version ${s.version}\n${s.purpose}`,["Include","Exclude"],undefined,panel);check();if(choice==="Include")scenarios.push(s)}
    const planning=ProjectPlanningRepository.open(repo.store.agentDataRoot,repo.repoRoot,repo.store.artifactInspection),current=planning?.current();
    const refs=current?planning!.links().filter(l=>selected.includes(l.controlledTaskId)&&l.planRevision===current.revision).map(l=>({planId:l.planId,revision:l.planRevision,digest:l.planDigest,plannedTaskId:l.plannedTaskId,controlledTaskId:l.controlledTaskId})):[];
    draft=repo.propose({title:previous?.title??"Verification of integrated results",purpose:purpose.trim(),controlledTaskRefs:selected,plannedTaskRefs:refs,validationIntent:[purpose.trim()],validationPlan:plan,scenarios,reviewRequired:previous?.reviewRequired??true},executablePath,previous?.checkpointId);rebuildIntegrationCheckpointView(repo);
  }
  if(action==="Review a proposal"){
    const drafts=repo.definitions().filter(d=>d.status==='DRAFT'),labels=drafts.map(d=>`${d.title} — proposal ${d.revision}`),choice=await chooseAction(ctx.ui,"Saved proposals","The proposal requires human confirmation before it can run.",[...labels,"Back"],undefined,panel);check();if(!choice||choice==="Back")return;draft=drafts[labels.indexOf(choice)];
  }
  if(draft){const b=repo.baseline();if(await reviewProposal(draft,b,false)){
    const approved=await repo.approve(ctx,draft.checkpointId,draft.revision,b);check();rebuildIntegrationCheckpointView(repo);
    ctx.ui.notify(approved?"Proposal approved. No checks have started: choose Run an approved verification when you want to start them.":"Proposal not approved. No verification started.",'info')}return;
  }
  if(action==="Run an approved verification"){
    const definitions=repo.definitions().filter(d=>d.status==='APPROVED'),labels=definitions.map(d=>`${d.title} — proposal ${d.revision}`),choice=await chooseAction(ctx.ui,"Approved verifications","Each execution preserves a separate result.",[...labels,"Back"],undefined,panel);check();if(!choice||choice==="Back")return;
    const d=definitions[labels.indexOf(choice)],b=repo.baseline();if(!await reviewProposal(d,b,true))return;
    const run=await withProgress(ctx.ui,()=>`Integration verification\nProject version: branch ${branch(b)}.\nChecks and evidence in an isolated copy; the original project is not modified.`,()=>repo.run(d.checkpointId,d.revision,b,reviewer));check();rebuildIntegrationCheckpointView(repo);
    const tasks=checkpointTaskDescriptions(repo,d,run);
    while(true){const next=await chooseAction(ctx.ui,"Verification result",checkpointResultPresentation(repo,d,run,tasks),["Go back","Technical details"],undefined,panel);check();if(next!=="Technical details")return;await details(d,run.baseline,run)}
  }
}
