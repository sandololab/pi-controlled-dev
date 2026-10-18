import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installSourceLoader} from './load-source.mjs';
import {fixtures} from './contract-fixtures.mjs';
installSourceLoader();
const contracts=await import('../src/contracts.ts');
const {hashBytes,hashCanonical,canonicalize}=contracts;
const {createScoutClarificationRequest:create,consumeScoutClarification:consume,scoutClarificationCoverage:coverage,ScoutClarificationInvestigationBudget:Budget,
  createScoutClarificationDelivery:delivery,scoutClarificationDispatch:dispatch,SCOUT_CLARIFICATION_DELIVERY_LIMIT}=await import('../src/scout-clarifications.ts');
const {presentTrustedConfirmation:present}=await import('../src/trusted-confirmation.ts');
const {recordContextInvestigationReads}=await import('../src/context-investigation.ts');
// These in-process UI doubles exercise production capabilities; they do not certify a real human interaction.
const human=response=>({mode:'tui',sessionManager:{getSessionId:()=> 'test-human'},ui:{confirm:async()=>response}});
function setup(ambiguities=['Quale formato va conservato?']){
  const f=fixtures(contracts),scout={...f.ScoutResult,ambiguities},spec=f.TaskSpec;
  const state={...f.WorkflowState,state:'ANALYZING',revision:2,results:['scout'],runs:[{...f.RunRecord,role:'Scout',resultRef:'scout'}],counters:{...f.Counters,attempts:1,dispatches:1}};
  const ctx={spec,state,records:[{id:'spec',kind:'TaskSpec',value:spec},{id:'scout',kind:'ScoutResult',value:scout}],events:[]};
  const data=new Map(),store={put(id,content,mediaType){const raw=Buffer.from(content),ref={schemaVersion:1,id,digest:hashBytes(raw),relativeStorePath:`artifacts/${id}`,bytes:raw.byteLength,mediaType};data.set(id,raw);return ref;},read(ref){if(!data.has(ref.id))throw new Error('missing');return data.get(ref.id);}};
  return {f,ctx,store,data,scout};
}
async function answer(f,index=0,impact='WITHIN_APPROVED_SPEC',text='Conserva il formato documentato.'){
  const request=create(f.ctx,index,text,impact,'Il contratto approvato resta applicabile.'),receipt=await present(human(true),request);
  return {request,receipt,...consume(request,receipt,()=>f.ctx,f.store)};
}
function commit(f,result){
  f.ctx.records.push({id:result.confirmationRef.id,kind:'ArtifactRef',value:result.confirmationRef},{id:result.decision.id,kind:'DecisionRecord',value:result.decision});
  f.ctx.state={...f.ctx.state,revision:f.ctx.state.revision+1,decisions:[...f.ctx.state.decisions,result.decision]};
  f.ctx.events.push({...f.f.TransitionEvent,taskId:f.ctx.state.taskId,kind:'RECORD',actor:'Orchestrator',recordType:'DECISION_RECORDED',revision:f.ctx.state.revision,evidenceRefs:result.decision.evidenceRefs});
}
test('answer confirmation binds immutable Scout, exact index/text/spec and explicit human answer without granting writer authority',async()=>{
  const f=setup(),original=canonicalize(f.scout),state=canonicalize(f.ctx.state),a=await answer(f);
  assert.equal(a.request.purpose,'scout-clarification');assert.equal(a.request.action,'ANSWER');assert.match(a.request.presentation.content,/Checks and development authorizations are still required/);
  assert.deepEqual(a.decision.evidenceRefs,['scout',a.confirmationRef.id]);assert.equal(canonicalize(f.scout),original);assert.equal(canonicalize(f.ctx.state),state);
  assert.equal(coverage(f.ctx,f.store).covered,false);commit(f,a);assert.equal(coverage(f.ctx,f.store).status,'COVERED');
  assert.equal(f.ctx.state.state,'ANALYZING');assert.equal(f.ctx.state.gates.length,0);assert.equal(f.ctx.state.counters.dispatches,1);
});
test('answers that change requirements or scope require a new approved spec, never merely cover the ambiguity',async()=>{
  const f=setup(),a=await answer(f,0,'SPEC_REVISION_REQUIRED','Cambiare il formato pubblico.');commit(f,a);
  assert.equal(coverage(f.ctx,f.store).status,'SPEC_REVISION_REQUIRED');assert.equal(coverage(f.ctx,f.store).covered,false);
  const next={...f.ctx.spec,specRevision:1};next.specHash=contracts.hashContract('TaskSpec',next);
  f.ctx.spec=next;f.ctx.state={...f.ctx.state,specHash:next.specHash};f.ctx.records[0]={id:'spec',kind:'TaskSpec',value:next};
  assert.equal(coverage(f.ctx,f.store).status,'INVALID_EVIDENCE');
});
test('duplicate question texts remain distinct indices; every index needs a confirmed answer',async()=>{
  const f=setup(['Formato?','Formato?']);commit(f,await answer(f,0));
  assert.deepEqual(coverage(f.ctx,f.store).missingIndices,[1]);commit(f,await answer(f,1));assert.equal(coverage(f.ctx,f.store).covered,true);
  commit(f,await answer(f,0));assert.equal(coverage(f.ctx,f.store).status,'INVALID_EVIDENCE');
});
test('cancellation and blank/invalid input never produce an answer or an automatic confirmation',async()=>{
  const f=setup();for(const text of ['', '   ', 'x'.repeat(4097)])assert.throws(()=>create(f.ctx,0,text,'WITHIN_APPROVED_SPEC','Reason'));
  for(const index of [-1,0.5,1])assert.throws(()=>create(f.ctx,index,'Answer','WITHIN_APPROVED_SPEC','Reason'));
  assert.throws(()=>create(f.ctx,0,'Answer','PASS','Reason'));
  const request=create(f.ctx,0,'Answer','WITHIN_APPROVED_SPEC','Reason');assert.equal(await present(human(false),request),undefined);assert.equal(f.data.size,0);
});
test('JSON receipt copies, model-produced answers and stale revisions cannot acquire authority',async()=>{
  const f=setup(),request=create(f.ctx,0,'Answer','WITHIN_APPROVED_SPEC','Reason'),receipt=await present(human(true),request);
  assert.throws(()=>consume(request,structuredClone(receipt),()=>f.ctx,f.store),/RECEIPT_INVALID/);assert.equal(f.data.size,0);
  f.ctx.state={...f.ctx.state,revision:3};assert.throws(()=>consume(request,receipt,()=>f.ctx,f.store),/STALE/);assert.equal(f.data.size,0);
  assert.throws(()=>consume(request,receipt,()=>f.ctx,f.store),/RECEIPT_INVALID/);
});
for(const [label,mutate] of [
  ['changed frozen text',f=>{f.scout.ambiguities[0]='Different';}],
  ['unaccepted result',f=>{f.ctx.state.results=[];}],
  ['newest unfinished Scout',f=>{f.ctx.state.runs.push({...f.f.RunRecord,role:'Scout',assignmentId:'new',status:'INTENT'});}],
  ['missing decision commit',f=>{f.ctx.events=[];}],
  ['missing decision record',f=>{f.ctx.records=f.ctx.records.filter(r=>r.kind!=='DecisionRecord');}],
  ['invalid confirmation',f=>{f.ctx.state.invalidEvidenceIds=[f.ctx.state.decisions[0].evidenceRefs[1]];}],
  ['mutated proof bytes',f=>{const id=f.ctx.state.decisions[0].evidenceRefs[1];f.data.set(id,Buffer.from('{}'));}],
])test(`${label} fails closed instead of declaring ambiguity coverage`,async()=>{
  const f=setup();commit(f,await answer(f));mutate(f);assert.equal(coverage(f.ctx,f.store).status,'INVALID_EVIDENCE');
});
test('generic RESOLVE_AMBIGUITY decision alone does not bypass the human answer requirement',()=>{
  const f=setup();f.ctx.state.decisions=[{...f.f.DecisionRecord,kind:'RESOLVE_AMBIGUITY',subjectId:'scout'}];
  assert.equal(coverage(f.ctx,f.store).status,'MISSING_ANSWERS');assert.equal(coverage(f.ctx,f.store).covered,false);
});
function oracle(f,n=1){
  const value={...f.f.OracleResult,assignmentId:`oracle-${n}`,attemptId:`attempt-${n}`,role:'Oracle',specHash:f.ctx.spec.specHash};
  f.ctx.state={...f.ctx.state,results:[...f.ctx.state.results,`oracle-result-${n}`],runs:[...f.ctx.state.runs,{...f.f.RunRecord,role:'Oracle',assignmentId:value.assignmentId,attemptId:value.attemptId,resultRef:`oracle-result-${n}`}],
    counters:{...f.ctx.state.counters,attempts:f.ctx.state.counters.attempts+1,dispatches:f.ctx.state.counters.dispatches+1,oracleInvocations:f.ctx.state.counters.oracleInvocations+1,escalationEpisodes:n}};
  f.ctx.records.push({id:`oracle-result-${n}`,kind:'OracleResult',value});return value;
}
test('no verified new read stops after two investigations, preserves workflow counts, cannot resume on paraphrase or unconfirmed answers',()=>{
  const f=setup(),budget=new Budget(f.ctx.spec,f.ctx.state);assert.equal(budget.observe(oracle(f,1),f.ctx).retry,true);
  const result=budget.observe(oracle(f,2),f.ctx);assert.equal(result.retry,false);assert.equal(result.newFacts,0);assert.equal(budget.canInvestigate(f.ctx.state),false);
  assert.equal(f.ctx.state.counters.oracleInvocations,2);assert.throws(()=>budget.resetAfterHumanAnswers(f.ctx,f.store));
  assert.throws(()=>budget.observe(oracle(f,3),f.ctx));
});
test('only transcript-backed new reads extend investigation, still capped at three and by actual dispatch policy',t=>{
  const f=setup(),budget=new Budget(f.ctx.spec,f.ctx.state),root=mkdtempSync(join(tmpdir(),'scout-read-budget-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'source.py'),'source');const session=join(root,'session.jsonl');
  for(let n=1;n<=3;n++){
    const result=oracle(f,n);writeFileSync(session,[{message:{role:'assistant',content:[{type:'toolCall',name:'read',id:'call',arguments:{path:'source.py'}}]}},
      {message:{role:'toolResult',toolName:'read',toolCallId:'call',isError:false,content:[{type:'text',text:`verified range ${n}`}]}}].map(canonicalize).join('\n'));
    recordContextInvestigationReads(result,session,root);const observed=budget.observe(result,f.ctx);assert.equal(observed.newFacts,1);assert.equal(observed.retry,n<3);
  }
  assert.equal(budget.canInvestigate(f.ctx.state),false);
  const limited=setup();limited.ctx.spec={...limited.ctx.spec,retryPolicy:{...limited.ctx.spec.retryPolicy,maxDispatches:1}};
  assert.equal(new Budget(limited.ctx.spec,limited.ctx.state).canInvestigate(limited.ctx.state),false);
});
test('accepted-result binding and actual Oracle counters are mandatory; human reset cannot be reused',async()=>{
  const f=setup(),budget=new Budget(f.ctx.spec,f.ctx.state),value=oracle(f);assert.throws(()=>budget.observe({...value,recommendation:'forged'},f.ctx));
  f.ctx.state.counters={...f.ctx.state.counters,oracleInvocations:0};assert.throws(()=>budget.observe(value,f.ctx));
  commit(f,await answer(f));budget.resetAfterHumanAnswers(f.ctx,f.store);assert.throws(()=>budget.resetAfterHumanAnswers(f.ctx,f.store));
});
test('answers committed before the investigation round cannot reset it as if the human answered again',async()=>{
  const f=setup();commit(f,await answer(f));const budget=new Budget(f.ctx.spec,f.ctx.state);
  assert.throws(()=>budget.resetAfterHumanAnswers(f.ctx,f.store));
});
function boundAssignment(f,d,role='Developer'){
  const a={...f.f.AssignmentEnvelope,role,specHash:f.ctx.spec.specHash,inputArtifactRefs:[...d.evidenceRefs]};
  if(role==='Reviewer')Object.assign(a,{candidateDigest:'a'.repeat(64),candidateGeneration:1,authority:['OP-01','OP-07']});
  a.assignmentHash=contracts.hashContract('AssignmentEnvelope',a);return a;
}
test('only committed coverage creates a frozen dispatch capability; copies and missing bindings fail before provider',async()=>{
  const f=setup();assert.throws(()=>delivery(f.ctx,f.store),/UNRESOLVED/);commit(f,await answer(f));
  const d=delivery(f.ctx,f.store),a=boundAssignment(f,d),before=canonicalize(a);
  assert.equal(Object.isFrozen(d),true);assert.equal(Object.isFrozen(d.evidenceRefs),true);assert.ok(d.evidenceRefs.includes(f.ctx.state.decisions[0].id));
  assert.match(dispatch(d,a),/Conserva il formato documentato/);assert.match(dispatch(d,boundAssignment(f,d,'Reviewer')),/SCOUT_CLARIFICATIONS=/);assert.equal(canonicalize(a),before);
  assert.throws(()=>dispatch(structuredClone(d),a),/DELIVERY_INVALID/);
  for(const patch of [{taskId:'foreign'},{specHash:'b'.repeat(64)},{inputArtifactRefs:['scout']},{role:'Scout'}]){
    const wrong={...a,...patch};if(patch.role)wrong.authority=['OP-01'];wrong.assignmentHash=contracts.hashContract('AssignmentEnvelope',wrong);assert.throws(()=>dispatch(d,wrong),/DELIVERY_INVALID/);
  }
  assert.throws(()=>dispatch(d,{...a,objective:'Changed without hash'}),/DELIVERY_INVALID/);
  assert.equal(dispatch(undefined,a),'');
});
test('no questions needs no delivery, whereas scope-changing answers never become context-only approval',async()=>{
  const none=setup([]);assert.equal(delivery(none.ctx,none.store),undefined);
  const f=setup();commit(f,await answer(f,0,'SPEC_REVISION_REQUIRED'));assert.throws(()=>delivery(f.ctx,f.store),/SPEC_REVISION_REQUIRED/);
});
test('complete UTF-8 delivery fails explicitly above 16 KiB without truncating answers',async()=>{
  const f=setup(['One?','Two?','Three?','Four?','Five?']);for(let i=0;i<5;i++)commit(f,await answer(f,i,'WITHIN_APPROVED_SPEC','à'.repeat(2048)));
  assert.equal(coverage(f.ctx,f.store).covered,true);assert.equal(SCOUT_CLARIFICATION_DELIVERY_LIMIT,16384);
  assert.throws(()=>delivery(f.ctx,f.store),/DELIVERY_LIMIT/);assert.equal(coverage(f.ctx,f.store).answers[4].answer,'à'.repeat(2048));
});
