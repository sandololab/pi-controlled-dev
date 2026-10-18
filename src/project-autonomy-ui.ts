import { ProjectAutonomyRepository, ProjectAutonomyController, policyNarrative, boundPath, pathContained } from './project-autonomy.js';
import { presentTrustedConfirmationBundle } from './trusted-confirmation.js';
import { compileValidations } from './validation-proposals.js';
import { setTimeout,clearTimeout } from 'node:timers';
import { chooseAction,displayLines,wizardPanel,withProgress } from './controlled-ui.js';
import { isHostPreTaskProposal, proposalDraft } from './pre-task-proposal.js';
import { executablePath } from './production-bridge.js';
import type { ProductionCommandContext } from './production-bridge.js';
import type { ProjectPlanningRepository } from './project-planning-repository.js';
import type { ProjectPlan } from './project-planning.js';
import type { ProjectAutonomyRun, AutonomyDriver } from './project-autonomy.js';

export function autonomyStatus(repo:ProjectAutonomyRepository):string {
 const run=repo.runs().at(-1),policies=repo.policies(),policy=policies.find(p=>p.status==='APPROVED')??policies.findLast(p=>p.status!=='DRAFT');
 if(!policy)return "Supervised mode. Confirmations at the normal checkpoints.";
 const p=policy.policy,planning=repo.planning(),plan=planning.current(),links=planning.links(),views=(plan?.plannedTasks??[]).filter(t=>p.taskBounds.some(b=>b.plannedTaskId===t.plannedTaskId)).map(task=>({task,status:run?.promotions.some(p=>links.some(l=>l.controlledTaskId===p.taskId&&l.plannedTaskId===task.plannedTaskId))?'COMPLETED':links.some(l=>l.plannedTaskId===task.plannedTaskId&&l.planDigest===p.plan.digest)?'ACTIVE':'WAITING'}));
 return `Automatic development\n\nPlan: ${planning.goals().at(-1)?.objective??"waiting"} · Branch: ${p.targetRef.replace('refs/heads/','')}\n\nStatus: ${run?.status==='ACTIVE'?"In progress":run?.status==='PAUSED'?"Paused":run?.status==='FINISHED'?"Final verification passed":run?.status==='CANCELLED'?"Interrupted":policy.status==='REVOKED'?"Authorization revoked":"Waiting to start"}\n${views.filter(v=>p.taskBounds.some(b=>b.plannedTaskId===v.task.plannedTaskId)).map(v=>`${v.status==='COMPLETED'?'✓':v.status==='ACTIVE'?'●':'○'} ${v.task.plannedTaskId} ${v.task.title}`).join('\n')}\n\n${run?.interruption?`Automatic development suspended\n${run.promotions.length} integrated tasks.\n${run.interruption.decisionNeeded}\nYou may: ${run.interruption.safeOptions.join('; ')}`:run?.status==='FINISHED'?`Authorized tasks have been integrated. The current baseline passed final verification.\nProject folder: ${repo.repoRoot}`:"The system proceeds within agreed limits and stops when a new decision is required."}`;
}
/** Explicit mode selection, natural scope input, then one real confirmation for two exact subjects. */
export async function approvePlanAndAutonomy(ctx:ProductionCommandContext,planning:ProjectPlanningRepository,draft:ProjectPlan,repo:ProjectAutonomyRepository):Promise<'SUPERVISED'|'BOUNDED_AUTONOMOUS'|undefined>{
 const mode=await chooseAction(ctx.ui,"How do you want to execute this plan?","Controlled Autonomy: limits are prepared from the design and agent proposals; after your approval, development, checks, review and integration proceed. You are interrupted when a decision is needed.\n\nSupervised mode: confirmations at individual checkpoints.",ctx.prepareAutonomyTask?["Controlled Autonomy","Supervised mode","Back to plan"]:["Supervised mode","Controlled Autonomy","Back to plan"]);
 if(mode==="Supervised mode")return await planning.approve(ctx,draft.revision)?'SUPERVISED':undefined;
 if(mode!=="Controlled Autonomy")return;
 if(ctx.prepareAutonomyTask){
   const session=ctx.sessionManager.getSessionId(),taskBounds:import('./project-autonomy.js').TaskAutonomyBound[]=[],recipes:import('./pre-task-proposal.js').TaskWizardDraft['validationPlan'][number][]=[];
   const fresh=()=>{if(ctx.sessionManager.getSessionId()!==session)throw new Error('HUMAN_CHANNEL_UNAVAILABLE')};
   // The same stable dependency order used when choosing the next READY task.
   const remaining=new Set(draft.plannedTasks.map(t=>t.plannedTaskId)),ordered:typeof draft.plannedTasks[number][]=[];
   while(remaining.size){const next=draft.plannedTasks.find(t=>remaining.has(t.plannedTaskId)&&t.dependsOn.every(id=>!remaining.has(id)));if(!next)throw new Error('PROJECT_PLAN_CYCLE');ordered.push(next);remaining.delete(next.plannedTaskId)}
   for(const [index,task] of ordered.entries()){
     const proposal=await withProgress(ctx.ui,()=>`Preparing execution (${index+1}/${ordered.length})\n${task.title}\nRead-only analysis of files and checks.`,()=>ctx.prepareAutonomyTask!(task,draft));fresh();
     if(!isHostPreTaskProposal(proposal))throw new Error('PRE_TASK_SCOUT_UNAVAILABLE');
     if(proposal.ambiguities.length||proposal.risks.length){await chooseAction(ctx.ui,"A decision is required before development",`${task.title}\n\n${[...proposal.ambiguities,...proposal.risks].join('\n')}\n\nThe plan remains available. Correct the context or choose supervised mode.`,["Back to plan"]);fresh();return;}
     const allowedPaths=[...new Set(task.scopeIntent.map(boundPath))];
     if(proposal.proposedScope.some(path=>!pathContained(path,allowedPaths,[])))throw new Error('PROJECT_PLAN_NEEDS_SCOPE_REVIEW');
     const validationPlan=proposalDraft(task.objective,proposal).validationPlan,commands=compileValidations(proposalDraft(task.objective,proposal),executablePath);
     taskBounds.push({plannedTaskId:task.plannedTaskId,allowedPaths,protectedPaths:[],validationCommands:commands});
     // Exact intermediate file contents do not remain a final invariant when a
     // later authorized activity revisits that file. Its own check still runs.
     for(let i=recipes.length-1;i>=0;i--)if(recipes[i]!.kind==='CONTENT'&&recipes[i]!.paths.some(path=>pathContained(path,allowedPaths,[])))recipes.splice(i,1);
     for(const recipe of validationPlan)if(!recipes.some(previous=>JSON.stringify(previous)===JSON.stringify(recipe)))recipes.push(recipe);
   }
   const commands=compileValidations({objective:"Verify the integrated result",scope:[],criteria:[],architectureFindings:[],designExpectations:[],validationPlan:recipes},executablePath);
   const policy=repo.propose(draft,taskBounds,{validationIntent:draft.design?.validationStrategy??["Verify the integrated baseline of the approved plan"],validationPlan:recipes,commands});
   const planQ=planning.prepareApproval(draft.revision),policyQ=repo.prepareApproval(policy.policyId),receipts=await presentTrustedConfirmationBundle(ctx,[planQ,policyQ]);fresh();
   if(!receipts)return;
   planning.applyApproval(planQ,receipts[0]);repo.applyApproval(policyQ,receipts[1]);await ctx.onAutonomyApproved?.(policy.policyId);return 'BOUNDED_AUTONOMOUS';
 }
 const scope=await ctx.ui.editor?.("Which folders or files may be changed? Separate them with commas.",'');if(!scope?.trim())return;
 const allowed=scope.split(',').map(s=>boundPath(s.trim()));
 const protectedInput=await ctx.ui.editor?.("Which files or folders must remain protected? Separate them with commas; leave empty if no additional limits are needed.",'');if(protectedInput===undefined)return;const protectedPaths=protectedInput.trim()?protectedInput.split(',').map(s=>boundPath(s.trim())):[];
 const recipe=await chooseAction(ctx.ui,"Authorized checks","Reviews and the diff check remain mandatory. If the project provides npm test, you may authorize it for every task and the final verification.",["Project tests with npm test","Diff check and review","Back to plan"]);
 if(!recipe||recipe==="Back to plan")return;
 const validationPlan:any[]=[recipe==="Project tests with npm test"?{kind:'EXISTING_TEST',description:"Project tests",paths:[],expectedLines:[],mechanism:'NPM_TEST'}:{kind:'REVIEW',description:"Independent review",paths:[],expectedLines:[]}];
 const commands=compileValidations({objective:draft.plannedTasks[0].objective,scope:allowed,criteria:[],architectureFindings:[],designExpectations:[],validationPlan},executablePath);
 const policy=repo.propose(draft,draft.plannedTasks.map(t=>({plannedTaskId:t.plannedTaskId,allowedPaths:allowed,protectedPaths,validationCommands:commands})),{validationIntent:["Verify the integrated baseline of the approved plan"],validationPlan,commands});
 const planQ=planning.prepareApproval(draft.revision),policyQ=repo.prepareApproval(policy.policyId),receipts=await presentTrustedConfirmationBundle(ctx,[planQ,policyQ]);
 if(!receipts)return;
 // A partial publication can approve the plan, but never activates autonomy without its independent proof.
 planning.applyApproval(planQ,receipts[0]);repo.applyApproval(policyQ,receipts[1]);await ctx.onAutonomyApproved?.(policy.policyId);return 'BOUNDED_AUTONOMOUS';
}
export async function showAutonomy(ctx:ProductionCommandContext,repo:ProjectAutonomyRepository,driver:AutonomyDriver,command='status'):Promise<ProjectAutonomyRun|undefined>{
 const run=repo.runs().at(-1);
 if(command==='pause'&&run){repo.requestPause(run.runId);ctx.ui.notify("Pause requested at the next safe point.",'info');return repo.run(run.runId)}
 if(command==='revoke'){const p=repo.policies().find(p=>p.status==='APPROVED');if(p)repo.revoke(p.policy.policyId);ctx.ui.notify("Authorization revoked: no new automatic action can start.",'info');return}
 if(command==='cancel'&&run){repo.cancel(run.runId);return repo.run(run.runId)}
 if(command==='resume'&&run){if(run.status!=='ACTIVE')repo.resume(run.runId);return withAutonomyProgress(ctx,repo,()=>new ProjectAutonomyController(repo,driver).run(run.runId),driver.activity)}
 if(command==='start'){const p=repo.policies().find(p=>p.status==='APPROVED');if(!p)throw new Error('POLICY_APPROVAL_REQUIRED');return withAutonomyProgress(ctx,repo,()=>new ProjectAutonomyController(repo,driver).run(repo.start(p.policy.policyId).runId),driver.activity)}
 const options=run?.status==='PAUSED'?["Resume automatic development","Authorization details","Revoke authorization","Stop project","Back"]:run?.status==='ACTIVE'?["Pause automatic development","Authorization details","Revoke authorization","Back"]:["Authorization details","Back"];
 const choice=await chooseAction(ctx.ui,"Controlled Autonomy",autonomyStatus(repo),options);
 if(choice==="Authorization details"){const p=repo.policies().at(-1);if(p)await chooseAction(ctx.ui,"Approved limits",policyNarrative(p.policy),["Back"]);}
 const actions:Record<string,string>={"Resume automatic development":'resume',"Pause automatic development":'pause',"Revoke authorization":'revoke',"Stop project":'cancel'};if(choice&&actions[choice])return showAutonomy(ctx,repo,driver,actions[choice]);return run;
}

/** Optional live presentation. Closing it never cancels work; pause is deferred to a safe boundary. */
export async function withAutonomyProgress<T>(ctx:ProductionCommandContext,repo:ProjectAutonomyRepository,work:()=>Promise<T>,activity?:()=>string|undefined):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined,closed=false;
 const tick=()=>{if(closed)return;ctx.ui.setStatus?.('controlled-autonomy',"Automatic development");timer=setTimeout(tick,2000)};
 tick();const execution=work();
 if(ctx.ui.custom){
  void ctx.ui.custom<void>((tui,theme,keys,done)=>{
   let details=false;const dispose=()=>{closed=true;clearTimeout(timer)};
   execution.then(()=>{dispose();done()},()=>{dispose();done()});
   const refresh=()=>{if(closed)return;tui.requestRender();timer=setTimeout(refresh,2000)};clearTimeout(timer);refresh();
   return {render(width){
    const r=repo.runs().at(-1),p=r?repo.policy(r):undefined,planning=repo.planning(),plan=planning.current(),links=planning.links(),body=p?(plan?.plannedTasks??[]).filter(t=>p.taskBounds.some(b=>b.plannedTaskId===t.plannedTaskId)).map(t=>{const link=links.find(l=>l.plannedTaskId===t.plannedTaskId&&l.planDigest===p.plan.digest),integrated=r!.promotions.some(p=>p.taskId===link?.controlledTaskId);return `${integrated?'✓':link?'●':'○'} ${t.plannedTaskId} ${t.title}`}):["Preparation"];
    if(details)body.push('',autonomyStatus(repo));else body.push('',`Integrate: ${r?.promotions.length??0} of ${p?.taskBounds.length??0}`,r?.pauseRequested?"Pause requested at the next safe point.":activity?.()??"In progress: controlled development, checks and review.");
    const panel=wizardPanel(theme,width,"Automatic development",undefined,ctx.ui.wizardTextWidth,"Project");return panel.finish(displayLines(body,panel.inner).slice(0,Math.max(3,(tui.terminal?.rows??24)-10)).map(l=>panel.row(l)),displayLines(["P: Pause · D: Details · Esc: hide (work continues)"],panel.inner).map(l=>panel.row(l,'muted')));
   },handleInput(data){if(data.toLowerCase()==='p'){const r=repo.runs().at(-1);if(r)repo.requestPause(r.runId)}else if(data.toLowerCase()==='d')details=!details;else if(data==='\x1b'||keys?.matches(data,'tui.select.cancel')){dispose();done();return}tui.requestRender()},invalidate(){},dispose};
  }).catch(()=>{});
 }
 try{return await execution}finally{closed=true;clearTimeout(timer);ctx.ui.setStatus?.('controlled-autonomy',undefined)}
}
