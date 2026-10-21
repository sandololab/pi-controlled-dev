/**
 * Present frozen confirmation data as operator-readable text.
 * Rendering and risk labels grant no authority: native confirmation must bind
 * the exact presentation and decision separately. Escape untrusted text before
 * it reaches the terminal, while preserving protocol identities and evidence.
 */
import { canonicalize } from './contract-json.js';
import type { ImplementedHumanGate, HumanGateRequest, HumanDecisionChoice } from './orchestrator.js';

export const HUMAN_GATE_TITLES:Readonly<Record<ImplementedHumanGate,string>>=Object.freeze({
  beforeImplementation:"Authorize implementation?",onScopeChange:"A scope extension is required",
  onOracleDecision:"A decision is required",beforeCompletion:"Ready to complete the task",
  onRetryExhausted:"Automatic attempts exhausted",beforeReviewerRedispatch:"Review interrupted"});
/** Human-readable projection of frozen data, never a new authorization payload. */
export function humanGateDisplay(request:HumanGateRequest,choice:HumanDecisionChoice):string{
  const d=JSON.parse(request.displayText);
  // Escape control/bidi characters in frozen user/child text; never interpret it as terminal markup.
  const text=(v:unknown)=>String(v??"Unavailable").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);
  const lines=["Objective:",text(d.objective)];
  const validationDescriptions=(commands:readonly any[],criteria:readonly any[]=[],requirements:readonly any[]=[])=>{
    const reviews=criteria.filter(c=>c.method==='REVIEW').map(c=>`Independent review: ${text(c.text)}`);
    if(!commands.length)return reviews;
    const recipes=commands.map(command=>{
      const executable=String(command.executable??'').split('/').at(-1),argv=JSON.stringify(command.argv);
      if(executable==='git'&&argv==='["diff","--check"]')return "Diff formatting check; it does not prove the text is correct.";
      if(executable==='npm'&&argv==='["test"]')return "Run the project's configured test suite in the candidate copy.";
      return undefined;
    });
    if(recipes.every(Boolean))return [...recipes as string[],...reviews];
    const linked=criteria.filter(c=>(c.commandIds??[]).some((id:string)=>commands.some(command=>command.id===id)));
    if(linked.length)return linked.map(c=>typeof c.text==='string'&&c.text.trim()?`Check that ${text(c.text)}`:`Automated check required by criterion ${text(c.id)}`);
    const descriptions=requirements.filter(r=>typeof r.text==='string'&&r.text.trim()).map(r=>`Check that ${text(r.text)}`);
    return descriptions.length?descriptions:["Planned automated check; criterion description unavailable."];
  };
  const section=(title:string,items:readonly string[])=>lines.push('',`${title}:`,...(items.length?items.map(x=>`- ${x}`):["- None"]));
  const risks=d.residualRisks??d.knownRisks??[],decisions=d.decisions??[];
  const riskLines=risks.map((r:any)=>{
    const dispositions=decisions.filter((x:any)=>x.subjectId===r.id);
    const resolved=!r.blocking&&dispositions.length===1&&dispositions[0].kind==='RESOLVE_RISK';
    const deferred=!r.blocking&&dispositions.length===1&&dispositions[0].kind==='DEFER_RISK';
    const description=r.id==='host-validation-pending'?"The host was expected to run validation.":text(r.text);
    return `${description} Status: ${resolved?(r.id==='host-validation-pending'?"resolved — validation passed":"resolved"):deferred?"residual risk accepted and deferred":r.blocking?"blocking":"unresolved"}.`;
  });
  let question='';
  switch(request.gateType){
    case 'beforeImplementation':
      if(d.developerRecovery)lines.push('',"The previous Developer stopped because of a connection error, before executing tools.",
        "The worktree still matches the baseline. The previous attempt remains in the journal.",
        `Recovery attempt ${d.developerRecovery.infrastructureRetriesAfter} of ${d.developerRecovery.maxInfrastructureRetries} allowed by the task. Canceling the dialog keeps this request pending.`,
        "If you approve, a new Developer will start in the same worktree with the same scope.");
      if(d.boundedDeveloperRecovery)section("Why another attempt is needed",[
        "The previous Developer reported a blocker without changing files or running commands. Its result remains in history.",
        `Reported reason: ${text(d.boundedDeveloperRecovery.blockedReason)}`,
        "The package verified that the agents terminated and that the project and isolated copy remain unchanged.",
        "The package will run the approved automated checks in the isolated copy; the Developer will read their outcomes. Subsequent checks will run again.",
        `New attempt after a blocker: ${d.boundedDeveloperRecovery.boundedRetriesAfter} of ${d.boundedDeveloperRecovery.maxBoundedRetries}. Previously used attempts remain counted.`]);
      section("Editable files/paths in the candidate copy",(d.allowedPaths??[]).map(text));
      section("Forbidden files/paths",(d.deniedPaths??[]).map(text));
      section("Planned checks",validationDescriptions(d.validationCommands??[],d.acceptanceCriteria??[],d.requirements??[]));
      if(d.validationFailure)section("Why a correction is needed",[text(d.validationFailure)]);
      if(d.scoutClarifications?.length)section("Confirmed clarifications",(d.scoutClarifications??[]).map((a:any)=>`Question ${a.ambiguityIndex+1}: ${text(a.ambiguityText)}\nAnswer: ${text(a.answer)}`));
      section("Known risks",riskLines);
      if(d.scopeBaselineRecovery)section("Why confirmation is needed again",[
        "The previous baseline check stopped development before the Developer started.",
        "The package rechecked the same project version and isolated copy. The approved analysis is preserved.",
        "The previous confirmation remains in history. This new confirmation authorizes development to start within the same boundaries."]);
      question=d.developerRecovery||d.boundedDeveloperRecovery?"Do you authorize another Developer attempt?":d.scopeBaselineRecovery?"Do you authorize development after the baseline check?":"Do you authorize the Developer to start these changes?";break;
    case 'beforeCompletion':{
      section("Verified changes",(d.changedFiles??[]).map(text));
      if(d.changedFiles?.length)lines.push("- No other files changed");
      const validation=d.validation??[];
      lines.push('',"Checks:",validation.length&&validation.every((v:any)=>v.status==='PASSED')?"✓ Automated checks passed":"✗ Automated checks failed or unavailable",
        `${d.reviewResult?.verdict==='PASS'?'✓':'✗'} Reviewer: ${text(d.reviewResult?.verdict)}`);
      const unresolved=risks.some((r:any)=>r.blocking||decisions.filter((x:any)=>x.subjectId===r.id&&['RESOLVE_RISK','DEFER_RISK'].includes(x.kind)).length!==1);
      lines.push(unresolved?"✗ Unresolved risks: see below":"✓ No unresolved residual risks");
      if(riskLines.length)section("Risks and decisions",riskLines);
      question="Do you approve completion of this task?";break;
    }
    case 'beforeReviewerRedispatch':{
      lines.push('',d.previousReviewer?.dispatchProofRef?"The previous review request was not sent: the package verified this before allowing recovery.":"The previous Reviewer did not complete the check because of a technical problem.",
        "The candidate has not changed. Previously executed checks remain valid.",'',"If you continue:",
        "- a new Reviewer will start;","- the Developer will not run again;","- tests will not be repeated;",
        "- no changes will be applied to the original project.",'',"Technical details:",
        `Previous Reviewer: ${text(d.previousReviewer?.assignmentId)}`,
        `Infrastructure error: ${text(d.failureCode)}`,
        `Candidate: generation ${text(d.candidateGeneration)}, digest ${text(d.candidateDigest)}`,
        `Current checks: ${(d.validationIds??[]).map(text).join(', ')||"unavailable"}`);
      question="Do you want to start a new Reviewer?";break;
    }
    case 'onScopeChange':{
      section("Current scope",(d.oldAllowedPaths??[]).map(text));
      const changes:string[]=[];
      for(const path of d.proposedAllowedPaths??[])if(!(d.oldAllowedPaths??[]).includes(path))changes.push(`+ ${text(path)}`);
      for(const path of d.oldAllowedPaths??[])if(!(d.proposedAllowedPaths??[]).includes(path))changes.push(`− ${text(path)}`);
      for(const path of d.oldDeniedPaths??[])if(!(d.proposedDeniedPaths??[]).includes(path))changes.push(`+ Previously forbidden permission: ${text(path)}`);
      for(const r of d.proposedRequirements??[])if(!(d.oldRequirements??[]).some((old:any)=>canonicalize(old)===canonicalize(r)))changes.push(`+ Requirement: ${text(r.text)}`);
      for(const r of d.exactRemovals?.requirements??[])changes.push(`− Requirement: ${text(r.text)}`);
      for(const [key,label] of [['acceptanceCriteria',"Criterion"],['constraints',"Constraint"],['validationCommands','Validation']] as const){
        for(const [set,sign] of [[d.exactAdditions,'+'],[d.exactRemovals,'−']] as const)for(const item of set?.[key]??[])
          changes.push(`${sign} ${label}: ${key==='validationCommands'
            ?validationDescriptions([item],d.affectedAcceptanceCriteria?.[sign==='+'?'proposed':'old']??[],sign==='+'?d.proposedRequirements??[]:d.oldRequirements??[]).join('; ')
            :text(typeof item==='string'?item:item.text)}`);
      }
      const authorityLabels:Record<string,string>={STRONG_CONFINEMENT_RELAXED:"Strong confinement no longer required",OBJECTIVE_CHANGED:"Objective changed",INPUT_SOURCE_CHANGED:"Task sources changed"};
      for(const change of d.authorityChanges??[]){
        if(authorityLabels[change])changes.push(`! ${authorityLabels[change]}`);
        if(change.startsWith('HUMAN_GATE_DISABLED:'))changes.push(`! Human confirmation disabled: ${HUMAN_GATE_TITLES[change.split(':')[1] as ImplementedHumanGate]}`);
      }
      lines.push('',"New requested scope — changes:",...(changes.length?changes:["No detailed changes available"]));
      section("Resulting scope",(d.proposedAllowedPaths??[]).map(text));
      section("Forbidden paths after the change",(d.proposedDeniedPaths??[]).map(text));
      lines.push('',"Reason:",text(d.reason),'',"Approval installs the new specification and requires reanalysis; it does not start a writer.");
      question="Do you authorize this scope change?";break;
    }
    case 'onOracleDecision':
      lines.push('',"Problem:",text(d.ambiguity),'',"Options:",...(d.options??[]).map((o:string,i:number)=>`${String.fromCharCode(65+i)}. ${text(o)}`),
        '',"Oracle recommendation:",text(d.recommendation),'',"Consequences:",text(d.consequences),
        '',"Oracle provides a recommendation; the user makes the decision.",
        "Approval permits reconciliation only: it does not authorize implementation or retry.");
      question="Do you accept the recommendation for reconciliation only?";break;
    case 'onRetryExhausted':{
      const c=d.counters??{};
      const failureLabels:Record<string,string>={TEST:"Validation failed",REVIEW:"Review failed",INFRA:"Execution failed because of an infrastructure problem",AMBIGUITY:"Unresolved ambiguity",SCOPE:"Scope violation",SCHEMA:"Invalid result",RECOVERY:"State requires reconciliation"};
      const failure=failureLabels[d.lastFailure?.category]??"Unclassified error";
      lines.push('',"What failed:",failure,"Latest error:",failure,
        '',`Attempts made: ${text(c.attempts??d.attempts)}`,`Starts: ${text(c.dispatches??d.dispatches)}`,
        `Corrections: ${text(c.reworkAttempts??d.reworkAttempts)}`,`Infrastructure retries: ${text(c.infrastructureRetries??d.infrastructureRetries)}`);
      section("Permitted continuations",(d.legalContinuations??[]).map((v:string)=>v==='RECONCILE'?"Reconciliation by the Orchestrator; task still blocked":text(v)));
      lines.push('',"Approval does not increase budgets or reset counters.");
      question="Do you authorize reconciliation only, without further attempts?";break;
    }
  }
  lines.push('',"The original repository will not be modified automatically.","No automatic commit, merge, push, publish or apply.");
  if(choice.decision==='REJECT')lines.push('',"You are choosing a final rejection: the task will end with outcome FAILED.");
  if(choice.decision==='ANSWER')lines.push('',"Exact answer:",JSON.stringify(choice.answer),"The answer is NOT approval; the task will remain blocked.");
  lines.push('',"No/Esc cancels the dialog; it does not record a rejection.",'',choice.decision==='REJECT'?"Do you want to permanently reject this request?":
    choice.decision==='ANSWER'?"Do you want to send this answer without authorizing the request?":question);
  return lines.join('\n');
}
/** The sole production confirmation boundary. Choice/answer are untrusted until the exact display is confirmed. */
