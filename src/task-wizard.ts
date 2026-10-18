import { setTimeout, clearTimeout } from 'node:timers';
import { validateScalar } from './contracts.js';
import { ContextInvestigationBudget, investigationQuestionHints, contextInvestigationAnswerHints } from './context-investigation.js';
import type { PersistentContextInvestigation } from './context-investigation-repository.js';
import { proposalDraft } from './pre-task-proposal.js';
import type { PreTaskProposalResult, ProposalCancellation, TaskWizardDraft } from './pre-task-proposal.js';
import { safeText, displayLines, withProgress, chooseAction, wizardPanel } from './controlled-ui.js';
import type { ControlledUI } from './controlled-ui.js';
export type InvestigationFactory=(objective:string,humanScope:readonly string[])=>PersistentContextInvestigation;
export type ProposeTask=(objective:string,hints:readonly string[],signal?:ProposalCancellation)=>Promise<PreTaskProposalResult>;
class Cancellation implements ProposalCancellation {
  aborted=false;listeners=new Set<()=>void>();
  addEventListener(_name:'abort',fn:()=>void){this.listeners.add(fn)}
  removeEventListener(_name:'abort',fn:()=>void){this.listeners.delete(fn)}
  abort(){this.aborted=true;for(const fn of this.listeners)fn()}
}
async function scoutProposalOnce(ui:ControlledUI,propose:ProposeTask,objective:string,hints:readonly string[],compact=false,rationale?:string):Promise<PreTaskProposalResult|undefined>{
  const signal=new Cancellation();let result:PreTaskProposalResult|undefined,failure:unknown;
  const work=async()=>{try{result=await propose(objective,hints,signal)}catch(error){failure=error}};
  if(ui.custom){
    await ui.custom<void>((tui,_theme,_keys,done)=>{
      let settled=false,reading=false,loading=false,offset=0,selected=0,detail=false,disposed=false,readGeneration=0,movedSelection=false;
      let snapshot:Awaited<ReturnType<NonNullable<ControlledUI['readPlanSnapshot']>>>|undefined,readError='';
      const repaint=()=>{if(!disposed)tui.requestRender()};
      const finish=()=>{settled=true;if(disposed)return;if(!reading)done();else repaint()};
      // Native Pi installs the component only after the factory returns. Its
      // renderer throttles frames: yield before any synchronous provider setup.
      const timer=setTimeout(()=>{if(signal.aborted){finish();return}void work().finally(finish)},25);
      const leaveReading=()=>{readGeneration++;reading=false;loading=false;detail=false;offset=0;if(settled)done();else repaint()};
      const openReading=()=>{
        if(!ui.readPlanSnapshot)return;reading=true;loading=true;offset=0;detail=false;readError='';repaint();
        const generation=++readGeneration;setTimeout(()=>{if(!reading||disposed||generation!==readGeneration)return;Promise.resolve().then(()=>ui.readPlanSnapshot!()).then(value=>{if(generation===readGeneration){snapshot=value;selected=0}},error=>{if(generation===readGeneration)readError=error instanceof Error?error.message:String(error)}).finally(()=>{if(generation===readGeneration){loading=false;repaint()}})},25);
      };
      return {render:width=>{
        const panel=wizardPanel(_theme,width,reading?(detail?snapshot?.points[selected]?.title??"Plan item":"Consult the plan"):"Prepare the work",undefined,ui.wizardTextWidth,reading?"Project plan":"Next work");
        const text=reading?loading?"Loading the saved plan. Work continues.":readError?`The plan cannot be read: ${readError}`:detail?snapshot?.points[selected]?.detail??"Item unavailable.":`Plan items\n${snapshot?.points.map((point,i)=>`${i===selected?'→':' '} ${i+1}. ${point.title}`).join('\n')||"No items available."}\n\n${snapshot?.summary??''}`:
          `Task being prepared\n${objective}${rationale?"\n\nWhy it matters\n"+rationale:''}\n\nReading files to propose precise changes and checks. The proposal will be presented before creating the task.\n${signal.aborted?"Cancellation requested; waiting for analysis to finish.":"Wait for the proposal."}`;
        const body=displayLines([text],panel.inner),footer=displayLines([reading?(loading?"Wait for the plan · Esc: return to waiting":detail?"↑↓: scroll · Esc: back to plan":"←→/Tab: item · Enter: details · ↑↓: scroll · Esc: back to waiting"):`${ui.readPlanSnapshot?"Alt+P: consult the plan · ":''}↑↓: scroll · Esc: cancel preparation`,...(reading&&settled?["The proposal is ready. Close this view to continue."]:[])],panel.inner);
        const height=Math.max(1,(tui.terminal?.rows??24)-8-panel.top.length-footer.length-1);if(reading&&!detail&&movedSelection&&snapshot){const line=1+displayLines(snapshot.points.slice(0,selected).map((point,i)=>`  ${i+1}. ${point.title}`),panel.inner).length;if(line<offset)offset=line;else if(line>=offset+height)offset=line-height+1;movedSelection=false}offset=Math.min(offset,Math.max(0,body.length-height));
        return panel.finish(body.slice(offset,offset+height).map(line=>panel.row(line)),footer.map(line=>panel.row(line,'muted')));
      },
        handleInput(data){
          if(data==='\x1bp'||data==='\x1b[112;3u'){if(reading)leaveReading();else openReading();return}
          if(_keys?.matches(data,'tui.select.cancel')||data==='\x1b'){if(reading){if(detail){detail=false;offset=0;repaint()}else leaveReading()}else{signal.abort();repaint()}return}
          if(_keys?.matches(data,'tui.select.up')||data==='\x1b[A')offset=Math.max(0,offset-1);
          else if(_keys?.matches(data,'tui.select.down')||data==='\x1b[B')offset++;
          else if(data==='\x1b[5~')offset=Math.max(0,offset-10);
          else if(data==='\x1b[6~')offset+=10;
          else if(reading&&!detail&&!loading&&snapshot?.points.length){
            if(data==='\t'||data==='\x1b[C'){selected=(selected+1)%snapshot.points.length;movedSelection=true}
            else if(data==='\x1b[D'){selected=(selected+snapshot.points.length-1)%snapshot.points.length;movedSelection=true}
            else if(data==='\r'||data==='\n'){detail=true;offset=0}
          }
          repaint();
        },invalidate(){},dispose(){disposed=true;readGeneration++;clearTimeout(timer);if(!settled)signal.abort()}};
    });
  }else await withProgress(ui,()=> "Status: reading files to prepare the proposal",work);
  if(signal.aborted)return;
  if(failure)throw failure;return result;
}
type Clarification={question:string;answer:string};
/** A returned suggestion is not an operator answer. Every unresolved question
 * requires explicit input and another read-only analysis before task creation. */
async function scoutProposal(ui:ControlledUI,propose:ProposeTask,objective:string,hints:readonly string[],compact=false,answers:Clarification[]=[],persistent?:PersistentContextInvestigation,rationale?:string):Promise<PreTaskProposalResult|undefined>{
  const investigation=new ContextInvestigationBudget();let pending:readonly {question:string;why?:string}[]=[];
  if(persistent)answers.splice(0,answers.length,...persistent.snapshot().answers);
  while(true){
    const context=[...hints,...(pending.length?investigationQuestionHints(pending):[])];
    context.push(...contextInvestigationAnswerHints(answers));
    if(context.length>64){ui.notify("Clarifications exceed this preparation's capacity. No task was created. Review the context before resuming.",'warning');return}
    let questions:readonly {question:string;why?:string;suggestedAnswer?:string}[];
    if(persistent&&!persistent.canInvestigate())questions=persistent.ensureOperatorQuestion();
    else {
      const reservation=persistent?.reserve();let proposal:PreTaskProposalResult|undefined;
      try{proposal=await scoutProposalOnce(ui,propose,objective,context,compact,rationale)}catch(error){if(reservation)persistent!.finish(reservation);throw error}
      if(!proposal){if(reservation)persistent!.finish(reservation);return}
      questions=proposal.clarificationQuestions?.length?proposal.clarificationQuestions:proposal.ambiguities.map(question=>({question,why:"This point is still uncertain. Your answer is required before preparing the task."}));
      const progress=reservation?persistent!.finish(reservation,proposal,questions.map(q=>({...q,why:q.why??''}))):questions.length?investigation.observe(proposal):undefined;
      if(!questions.length)return proposal;
      if(progress?.retry){
        ui.notify(`Information still needs clarification. Starting another file investigation (attempt ${progress.attempts+1} of 3); this analysis added ${progress.newFacts} new reads. No changes are started.`,'info');
        pending=questions;continue;
      }
    }
    ui.notify("Available investigations did not resolve these questions. Your answer is required; the dependent step remains stopped. Closing and reopening preserves used attempts.",'info');
    const submitted=persistent?.snapshot().answeredIndices??[];
    for(const [i,question] of questions.entries()){
      if(submitted.includes(i))continue;
      const previous=answers.findLast(answer=>answer.question===question.question);
      const why=[question.why,previous?`Previous answer: ${previous.answer}. The agent requests further clarification.`:'',question.suggestedAnswer?"The suggested answer is a proposal: you may approve or edit it.":''].filter(Boolean).join('\n');
      while(true){
        const presentation={step:i+1,total:questions.length,section:"Clarifications",question:question.question,why};
        const answer=ui.wizardInput?await ui.wizardInput(`Clarifications (${i+1}/${questions.length})`,question.suggestedAnswer??'',presentation):await ui.editor!(`${question.question}\n\n${why}`,question.suggestedAnswer??'');
        if(!answer?.trim()){ui.notify("Preparation interrupted: this clarification remains open. No task was created.",'info');return}
        if(!validateScalar('Text',answer.trim()).ok){ui.notify("The answer is too long. Shorten it without omitting the decision.",'warning');continue}
        const explicit={question:question.question,answer:answer.trim()};
        if(persistent)persistent.savePreTaskAnswer(i,explicit);answers.push(explicit);break;
      }
    }
    if(persistent)persistent.confirmAnswers(answers);
    pending=[];investigation.reset();
  }
}
function wizardVerifications(draft:TaskWizardDraft):string {
  return ["  Diff check: reports formatting errors. The other checks are also required to verify the result.",
    ...draft.validationPlan.flatMap(v=>[`  ${v.kind==='REVIEW'?"Independent review":v.kind==='CONTENT'?"Exact content":v.kind==='CANDIDATE_TEST'?"Tests on the working copy":"Existing tests"}: ${v.description}`,
      ...(v.paths.length?[`  File: ${v.paths.join(', ')}`]:[]),...(v.kind==='CANDIDATE_TEST'?[`  Pytest configuration: ${v.configPath}`,"  These tests will run after the specified files are created."]:[]),...(v.kind==='CONTENT'?["  Expected content (exact lines):",...v.expectedLines.map(l=>`    ${l}`)]:[])]),
    ...(draft.validationPlan.some(v=>v.kind==='EXISTING_TEST')?["Existing tests will execute code in the working copy."]:[]),
    ...(draft.validationPlan.some(v=>v.kind==='CANDIDATE_TEST')?["Pytest will run only the specified tests. It will not save temporary cache or bytecode files. It will load built-in plugins and those required by the tests. At least one test must pass; skipping all tests is insufficient."]:[]),
    "Checks will run only after the required authorizations."].join('\n');
}
export function wizardSummary(draft:TaskWizardDraft):string {
  return [`Objective: ${draft.objective}`,"Editable files:",...draft.scope.map(p=>`  ${p}`),"How to recognize the correct result:",...draft.criteria.map((c,i)=>`  ${i+1}. ${c}`),
    ...(draft.architectureFindings.length?["Observed architecture:",...draft.architectureFindings.map(value=>`  - ${value}`)]:[]),
    ...(draft.designExpectations.length?["Planned structure:",...draft.designExpectations.map(value=>`  - ${value}`)]:[]),
    "Proposed checks:",wizardVerifications(draft),...(draft.clarifications?.length?["Clarifications provided by the operator:",...draft.clarifications.flatMap(q=>[`  Question: ${q.question}`,`  Answer: ${q.answer}`])]:[])].join('\n');
}
/** A planned objective is already known: one proposal, natural-language corrections,
 * one creation decision. The existing workflow still owns execution confirmations. */
async function plannedTaskWizard(ui:ControlledUI,propose:ProposeTask,initial:{readonly objective:string;readonly hints:readonly string[];readonly rationale?:string},investigations?:InvestigationFactory):Promise<TaskWizardDraft|undefined>{
  const answers:Clarification[]=[];
  let hints=[...initial.hints],proposal=await scoutProposal(ui,propose,initial.objective,hints,true,answers,investigations?.(initial.objective,[]),initial.rationale);if(!proposal)return;
  while(true){
    const draft={...proposalDraft(initial.objective,proposal),...(answers.length?{clarifications:[...answers]}:{})},notes=[...proposal.ambiguities.map(s=>`To clarify: ${s}`),...proposal.risks.map(s=>`Limitation: ${s}`),proposal.explanation].join('\n\n');
    const body=[`Result\n${draft.objective}`,`Editable files\n${draft.scope.join('\n')}`,`Expected result\n${draft.criteria.map(c=>`• ${c}`).join('\n')}`,`Checks\n${wizardVerifications(draft)}`,
      ...(proposal.ambiguities.length||proposal.risks.length?[`The agent reports ${proposal.ambiguities.length} points to clarify and ${proposal.risks.length} limitations. Consult the details before continuing.`]:[])].join('\n\n');
    const action=await chooseAction(ui,"Prepare the task",body,["Create the task","Correct the proposal","Read details","Back"],undefined,{section:"Next work",scrollWithArrows:true});
    if(!action||action==="Back")return;
    if(action==="Create the task")return draft;
    if(action==="Read details"){await chooseAction(ui,"Proposal details",wizardSummary(draft)+'\n\n'+notes,["Back to proposal"],undefined,{section:"Next work",scrollWithArrows:true});continue}
    const correction=await ui.editor?.("Describe what you want to correct in the proposal.",'');if(!correction?.trim())continue;
    if(!validateScalar('Text',correction.trim()).ok){ui.notify("The correction is too long.",'warning');continue}
    hints=[...initial.hints,`Previous proposal (data): ${JSON.stringify(draft).slice(0,3500)}`,correction.trim()];
    const next=await scoutProposal(ui,propose,initial.objective,hints,true,answers,investigations?.(initial.objective,[]),initial.rationale);if(!next)return;proposal=next;
  }
}
/** Session-local draft, not a workflow contract. Navigation has no authority. */
export async function taskWizard(ui:ControlledUI,propose:ProposeTask,initial?:{readonly objective:string;readonly hints:readonly string[];readonly compact?:boolean;readonly rationale?:string},investigations?:InvestigationFactory):Promise<TaskWizardDraft|undefined>{
  if(!ui.select||!ui.editor)throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  if(initial?.compact)return plannedTaskWizard(ui,propose,initial,investigations);
  let draft:TaskWizardDraft={objective:initial?.objective??'',scope:[],criteria:[],architectureFindings:[],designExpectations:[],validationPlan:[]},step=0,analyzed='',notes='',hints:string[]=[...(initial?.hints??[])];
  const answers:Clarification[]=[];let humanScope:readonly string[]=[];
  const names=["Objective","Editable files","Criteria","Checks","Summary"];
  const questions=["What result do you want to achieve?","Which files may change?","How will you recognize the correct result?","How should the result be verified?","Create the task with this proposal?"];
  const reasons=["Helps the agent prepare the proposal.","Defines the boundary of permitted changes.","Clarifies when the work satisfies the request.","Clarifies the proposed checks before authorizing work.","Review your choices: creation does not start changes."];
  const heading=()=>`Questions (${step+1}/5) — ${names[step]}`;
  const cancelled=async()=>{
    const choice=await chooseAction(ui,heading(),"The local draft will be discarded. No task will be created.",
      ["Continue preparation","Discard draft"],{
        step:step+1,total:5,question:"Cancel preparation?",
        why:"This choice concerns only the local draft."});
    return choice==="Discard draft";
  };
  const edit=async()=>{
    const current=step===0?draft.objective:step===1?draft.scope.join('\n'):draft.criteria.join('\n');
    const title=step===0?"What result do you want to achieve?":step===1?"Which exact files may change? One path per line.":"How will you recognize the correct result? One criterion per line.";
    const text=ui.wizardInput?await ui.wizardInput(heading(),current,{step:step+1,total:5,question:title,why:reasons[step]}):await ui.editor!(`Controlled Dev | New task\n${heading()}\n${Array.from({length:5},(_,i)=>i<=step?'●':'○').join(' ')}\n${title}\nWhy it matters: ${reasons[step]}`,current);if(text===undefined)return;
    const value=text.normalize('NFC').trim();
    if(step===0){if(!validateScalar('Text',value).ok){ui.notify("Objective empty or too long.",'warning');return}draft.objective=value}
    else if(step===1){const paths=[...new Set(value.split('\n').map(p=>p.trim().replace(/^\.\//,'').replace(/\/+$/,'')).filter(Boolean))];
      if(!paths.length||paths.length>4096||paths.some(p=>!validateScalar('Path',p).ok||p.split('/').includes('.git')||/[\*?\[\]]/.test(p))){ui.notify("Specify exact project-relative files, without .., .git or wildcards.",'warning');return}draft.scope=paths;humanScope=paths}
    else {const criteria=value.split('\n').map(c=>c.trim()).filter(Boolean);if(!criteria.length||criteria.length>32||criteria.some(c=>!validateScalar('Text',c).ok)){ui.notify("Nonempty, verifiable acceptance criteria are required.",'warning');return}draft.criteria=criteria}
  };
  const analyze=async(correction?:string)=>{
    const nextHints=correction?[...hints.slice(-10),`Current user-edited draft (untrusted proposal data): ${JSON.stringify(draft).slice(0,3500)}`,correction]:hints;
    const proposal=await scoutProposal(ui,propose,draft.objective,nextHints,false,answers,investigations?.(draft.objective,humanScope));if(!proposal)return false;
    draft={...proposalDraft(draft.objective,proposal),...(answers.length?{clarifications:[...answers]}:{})};analyzed=draft.objective;hints=nextHints;
    notes=[...proposal.ambiguities.map(s=>`To clarify: ${s}`),...proposal.risks.map(s=>`Note: ${s}`),`Proposal rationale: ${proposal.explanation}`].join('\n');return true;
  };
  try{
    await edit();
    while(true){
      const body=step===0?draft.objective:step===1?draft.scope.join('\n'):step===2?draft.criteria.join('\n'):step===3?wizardVerifications(draft):wizardSummary(draft);
      ui.setWidget?.('controlled-dev',undefined);
      const action=await chooseAction(ui,heading(),`${step===0?"Answer":step===4?"Summary":"Proposal"}:\n${body}${notes&&step>0?"\n\nProposal observations and limitations are available: choose Read the observations.":''}`,[
        step===4?"Create the task":"Next",...(step<3?["Edit"]:[]),...(analyzed?["Request a correction"]:[]),
        ...(notes&&step>0?["Read the observations"]:[]),
        ...(step>0?["Back"]:[]),...(step===4?["Edit objective","Edit files","Edit criteria","Edit checks"]:[]),"Cancel"],{step:step+1,total:5,question:questions[step],why:reasons[step]});
      if(action===undefined||action==="Cancel"){if(await cancelled())return;continue}
      if(action==="Back"){step--;continue}
      if(action==="Read the observations"){
        await chooseAction(ui,"Agent observations",notes,["Back to proposal"],{step:step+1,total:5,
          question:"Proposal observations and limitations",why:"These notes explain the proposal; they are not editable paths or executed checks."});continue;
      }
      if(action==="Edit"){await edit();continue}
      if(action.startsWith("Edit ")){step={"Edit objective":0,"Edit files":1,"Edit criteria":2,"Edit checks":3}[action]??step;continue}
      if(action==="Request a correction"){
        const correction=await ui.editor("Describe what to change in the proposal, in natural language.",'');
        if(correction?.trim()){if(!validateScalar('Text',correction).ok){ui.notify("The correction is too long.",'warning');continue}if(!await analyze(correction))return;step=1}continue;
      }
      if(step===0){if(!draft.objective){await edit();continue}if(draft.objective!==analyzed){hints=[...(initial?.hints??[])];answers.length=0;if(!await analyze())return}}
      if(step===4)return draft;
      step++;
    }
  }finally{ui.setWidget?.('controlled-dev',undefined)}
}
