import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {restartFixture}=await import('./recovery-fixture.mjs');
const {presentTrustedConfirmation}=await import('../src/trusted-confirmation.ts');
const {scoutClarificationDispatch}=await import('../src/scout-clarifications.ts');
const {DurableStore}=await import('../src/store.ts');
const {clarifyProductionScout,continueProductionWorkflow}=await import('../src/production-bridge.ts');
const {presentHumanGate,createAssignment}=await import('../src/orchestrator.ts');
const {verifyPreparedReviewPacket}=await import('../src/controlled-reviewer.ts');
const {verifyCompletionPackage}=await import('../src/completion-package.ts');
const ctx=(f,confirm=true)=>({mode:'tui',cwd:f.repo,sessionManager:{getSessionId:()=> 'owner'},ui:{confirm:async()=>confirm,notify(){}}});
async function setup(t,ambiguities=['Quale formato?', 'Quale semantica?'],extra={}){
 const root=mkdtempSync(join(tmpdir(),'scout-answer-host-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const f=await restartFixture(root,'ANALYZING',false,false,{ambiguities},undefined,extra);return {...f,root,o:f.orchestrator};
}
async function answer(f,index,text='Formato documentato',impact='WITHIN_APPROVED_SPEC',confirmation=true){
 const revision=f.o.state.revision,q=f.o.createScoutAnswer(index,text,impact,'Decisione esplicita dell’operatore',revision,'owner');
 const receipt=await presentTrustedConfirmation(ctx(f,confirmation),q);if(receipt)f.o.acceptScoutAnswer(q,receipt,revision);return {q,receipt,revision};
}
test('frozen Scout questions receive atomic bound answers, survive durable reload, and never bypass implementation approval',async t=>{
 const dispatched=[],f=await setup(t,undefined,{onRoleDispatch(a,options){dispatched.push({a,options})}}),o=f.o;
 const scout=o.context().records.find(r=>r.kind==='ScoutResult'),frozen=JSON.stringify(scout.value),spec=JSON.stringify(o.spec),counters=o.state.counters;
 assert.throws(()=>o.ready(o.state.revision),/ADVISORY_REQUIRED/);await answer(f,0);assert.equal(o.scoutClarifications().status,'MISSING_ANSWERS');
 assert.throws(()=>o.ready(o.state.revision),/ADVISORY_REQUIRED/);await answer(f,1,'Semantica pubblica corrente');
 assert.equal(o.scoutClarifications().covered,true);assert.equal(JSON.stringify(o.context().records.find(r=>r.id===scout.id).value),frozen);
 assert.equal(JSON.stringify(o.spec),spec);assert.deepEqual(o.state.counters,counters);
 const ledger=DurableStore.load(f.storeRoot);assert.equal(ledger.state.decisions.length,2);assert.equal(ledger.events.filter(e=>e.recordType==='DECISION_RECORDED').length,2);
 for(const d of ledger.state.decisions)assert.ok(ledger.events.some(e=>e.recordType==='DECISION_RECORDED'&&d.evidenceRefs.every(id=>e.evidenceRefs.includes(id))));
 o.ready(o.state.revision);await assert.rejects(o.implement(o.state.revision,join(f.root,'candidate')),/HUMAN_GATE_REQUIRED/);
 assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\n');assert.equal(o.state.counters.dispatches,1);
 const q=o.openBeforeImplementation(o.state.revision,'owner');assert.equal(q.approvedData.scoutClarifications.length,2);
 const receipt=await presentHumanGate(ctx(f),q);o.acceptHumanDecision(q.snapshot,receipt);
 execFileSync('git',['-C',f.repo,'worktree','add','--quiet','--detach',join(f.root,'candidate'),o.state.baselineCommit]);
 await o.implement(o.state.revision,join(f.root,'candidate'));
 const developer=dispatched.find(d=>d.a.role==='Developer');assert.ok(developer.options.scoutClarifications);
 assert.match(scoutClarificationDispatch(developer.options.scoutClarifications,developer.a),/Semantica pubblica corrente/);
 assert.equal(developer.a.objective,`${o.spec.objective} Perform the change only inside workRoot; never modify repoRoot.`);
 o.testing(o.state.revision);o.validateApproved(o.state.revision);const c=o.candidateCapture;
 const host={candidateManifest:c.manifest,diff:c.patch,changedFiles:c.changedFiles,handoff:c.handoff,residualRisks:[],evidenceRefs:['source']};
 const draft=o.buildReviewPacket(createAssignment(o.spec,o.state,'Reviewer'),host);
 const assignment=createAssignment(o.spec,o.state,'Reviewer',{inputArtifactRefs:draft.evidenceRefs}),prepared=o.buildReviewPacket(assignment,host);
 const context=o.context(assignment,prepared.validationResults.map(v=>v.id)),workspace={diff:c.patch,changedFiles:c.changedFiles},beforeReview=o.state;
 for(const mutation of ['wrong-assignment','unproven-scout']){
  const records=context.records.map(r=>r.id===scout.id&&mutation==='wrong-assignment'?{...r,value:{...r.value,assignmentHash:'0'.repeat(64)}}
   :r.id===context.stateId&&mutation==='unproven-scout'?{...r,value:{...r.value,runs:r.value.runs.map(run=>run.role==='Scout'?{...run,status:'UNKNOWN'}:run)}}:r);
  assert.throws(()=>verifyPreparedReviewPacket(prepared,assignment,{...context,records},c.manifest,workspace),e=>e.code==='INVALID_REVIEW_PACKET'&&e.diagnostic.path===`evidenceRefs.${scout.id}.contract`,mutation);
 }
 assert.deepEqual(o.state,beforeReview);
 await o.review(o.state.revision,host)
  .catch(error=>{throw new Error(`${error.message}: ${JSON.stringify(error.diagnostic)}`,{cause:error})});
 const reviewer=dispatched.find(d=>d.a.role==='Reviewer');assert.match(scoutClarificationDispatch(reviewer.options.scoutClarifications,reviewer.a),/Formato documentato/);
 const packet=o.completionPackage(o.state.revision).artifact,store={read:ref=>DurableStore.readArtifact(f.storeRoot,ref)},p=JSON.parse(Buffer.from(store.read(packet)).toString());
 const completedLedger=DurableStore.load(f.storeRoot);assert.equal(verifyCompletionPackage(p,completedLedger.state,completedLedger.records,store).status,'COMPLETION_PACKAGE_VALID');
 const altered=structuredClone(completedLedger.state);altered.invalidEvidenceIds.push(altered.decisions[0].id);
 assert.throws(()=>verifyCompletionPackage(p,altered,completedLedger.records,store),/COMPLETION_(SCOUT_CLARIFICATION_UNRESOLVED|GATE_OR_DECISION_BINDING|EVIDENCE)/);
});
test('revision-required answers stay blocked and an explicitly confirmed edit supersedes only the old answer atomically',async t=>{
 const f=await setup(t,['Formato?']),o=f.o;await answer(f,0,'Nuovo formato','SPEC_REVISION_REQUIRED');const old=o.state.decisions[0];
 assert.equal(o.scoutClarifications().status,'SPEC_REVISION_REQUIRED');assert.throws(()=>o.ready(o.state.revision),/ADVISORY_REQUIRED/);
 const counters=o.state.counters,spec=JSON.stringify(o.spec);await answer(f,0,'Formato già documentato');
 assert.equal(o.scoutClarifications().covered,true);assert.ok(o.state.invalidEvidenceIds.includes(old.id));assert.equal(o.state.decisions.length,2);
 assert.deepEqual(o.state.counters,counters);assert.equal(JSON.stringify(o.spec),spec);assert.equal(DurableStore.load(f.storeRoot).state.decisions.length,2);
});
test('cancelled, copied, stale and foreign-channel confirmations do not resolve frozen questions',async t=>{
 const f=await setup(t,['Formato?']),o=f.o;const cancelled=await answer(f,0,undefined,undefined,false);assert.equal(cancelled.receipt,undefined);assert.equal(o.state.decisions.length,0);
 let a=await answer(f,0);assert.throws(()=>o.acceptScoutAnswer(a.q,structuredClone(a.receipt),o.state.revision));
 assert.equal(o.state.decisions.length,1);assert.equal(o.state.counters.dispatches,1);
 const revision=o.state.revision,q=o.createScoutAnswer(0,'Correzione','WITHIN_APPROVED_SPEC',"Decision",revision,'owner');
 const receipt=await presentTrustedConfirmation({...ctx(f),sessionManager:{getSessionId:()=> 'foreign'}},q);
 assert.throws(()=>o.acceptScoutAnswer(q,receipt,revision),/ORCHESTRATOR_STATE_INVALID/);assert.equal(o.state.revision,revision);
});
test('production continuation asks bounded editable questions and cancellation does not redispatch accepted Scout',async t=>{
 const f=await setup(t,['Formato?']),o=f.o;const ui=ctx(f,false);ui.ui.editor=async()=> 'Risposta da rivedere';ui.ui.select=async(_title,options)=>options[0];
 assert.equal(await clarifyProductionScout(o,ui),false);assert.equal(o.state.decisions.length,0);
 assert.equal((await continueProductionWorkflow(o,ui)).outcome,'NOT_CONFIRMED');
 assert.equal(readFileSync(join(f.root,'effects.log'),'utf8'),'Scout\n');assert.equal(o.state.counters.dispatches,1);
 ui.ui.confirm=async()=>true;assert.equal(await clarifyProductionScout(o,ui),true);o.ready(o.state.revision);
 assert.equal(o.state.state,'READY');assert.equal(o.state.gates.length,0);assert.equal(o.state.counters.dispatches,1);
});

test('oversize confirmed context fails before READY or any new intent; explicit edit preserves complete old answers in history',async t=>{
 const f=await setup(t,['Prima?','Seconda?','Terza?','Quarta?']),o=f.o,text='界'.repeat(1320);for(let i=0;i<4;i++)await answer(f,i,text);
 const revision=o.state.revision,counters=o.state.counters;
 assert.equal(o.scoutClarifications().covered,true);assert.throws(()=>o.ready(revision),/SCOUT_CLARIFICATION_DELIVERY_LIMIT/);
 assert.equal(o.state.state,'ANALYZING');assert.equal(o.state.revision,revision);assert.deepEqual(o.state.counters,counters);
 const ui=ctx(f);ui.ui.editor=async()=> 'Risposta breve confermata';ui.ui.select=async(_title,options)=>options[0];
 assert.equal(await clarifyProductionScout(o,ui),true);assert.equal(o.state.decisions.length,5);assert.equal(o.state.invalidEvidenceIds.length,1);
 o.ready(o.state.revision);assert.equal(o.state.state,'READY');assert.deepEqual(o.state.counters,counters);
 const historical=o.context().records.filter(r=>r.kind==='ArtifactRef'&&r.value.mediaType==='application/vnd.pi-controlled-dev.trusted-confirmation+json');
 assert.ok(historical.some(r=>Buffer.from(DurableStore.readArtifact(f.storeRoot,r.value)).toString().includes(text)));
});
test('a stale genuine answer and a copied fresh receipt cannot consume authority or replace the current response',async t=>{
 const f=await setup(t),o=f.o,revision=o.state.revision;
 const old=o.createScoutAnswer(1,'Seconda risposta','WITHIN_APPROVED_SPEC',"Decision",revision,'owner'),oldReceipt=await presentTrustedConfirmation(ctx(f),old);
 const fresh=o.createScoutAnswer(0,'Prima risposta','WITHIN_APPROVED_SPEC',"Decision",revision,'owner'),freshReceipt=await presentTrustedConfirmation(ctx(f),fresh);
 assert.throws(()=>o.acceptScoutAnswer(fresh,structuredClone(freshReceipt),revision),/TRUSTED_CONFIRMATION_RECEIPT_INVALID/);assert.equal(o.state.decisions.length,0);
 o.acceptScoutAnswer(fresh,freshReceipt,revision);const latest=o.state.revision;
 assert.throws(()=>o.acceptScoutAnswer(old,oldReceipt,latest),/SCOUT_CLARIFICATION_STALE/);assert.equal(o.state.revision,latest);assert.equal(o.state.decisions.length,1);
 assert.deepEqual(o.scoutClarifications().missingIndices,[1]);
});
test('redispatch updates the human label before waiting for the next Reviewer, without inventing PASS or completion',async()=>{
 const statuses=[],ctx={mode:'tui',cwd:'/',sessionManager:{getSessionId:()=> 'owner'},ui:{notify(){},confirm:async()=>true,setStatus(_key,label){statuses.push(label)},setWidget(){}}};
 const workflow={state:{state:'REVIEWING',taskId:'task'},spec:{taskId:'task'},reviewerRedispatchAuthorized:()=>true,async redispatchReviewer(){
   assert.equal(statuses.at(-1),'Status: Preparing independent review');return {decision:'BLOCKED'};
 }};
 assert.equal((await continueProductionWorkflow(workflow,ctx)).outcome,'BLOCKED');assert.ok(statuses.every(s=>!/PASS|Completed/.test(s)));
});

test('dead-owner takeover preserves unanswered frozen Scout and resumes human clarification without a repeated analysis',async t=>{
 const root=mkdtempSync(join(tmpdir(),'scout-answer-restart-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const script=`import {installSourceLoader} from './test/load-source.mjs';installSourceLoader();const {restartFixture}=await import('./test/recovery-fixture.mjs');const f=await restartFixture(process.argv[1],'ANALYZING',false,false,{ambiguities:['Formato?']});console.log(JSON.stringify({repo:f.repo,data:f.data,storeRoot:f.storeRoot}));`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script,root],{encoding:'utf8',timeout:30000});assert.equal(child.status,0,child.stderr);
 const f=JSON.parse(child.stdout),before=DurableStore.load(f.storeRoot),{takeOverWorkflow}=await import('../src/recovery-resume.ts');
 const {CentralOrchestrator,registeredRoleDispatchers}=await import('../src/orchestrator.ts');
 const runtime={events:{on(){return()=>{}},emit(){assert.fail('Clarification cannot dispatch')}},ownerSessionId:'successor'};
 for(const role of ['scout','developer','reviewer','oracle'])runtime[role]={name:`controlled.${role}`,runtimeGeneration:'restored',active:()=>true};
 const o=CentralOrchestrator.restore(takeOverWorkflow(f.data,f.storeRoot,'successor','Explicit clarification recovery',()=> 'ACCEPT'),registeredRoleDispatchers(runtime));
 assert.equal(o.resumeRecovered().decision,'ADVISORY_REQUIRED');assert.equal(o.state.state,'ANALYZING');assert.deepEqual(o.state.counters,before.state.counters);
 const ui={...ctx(f),sessionManager:{getSessionId:()=> 'successor'}};ui.ui.editor=async()=> 'Formato pubblico corrente';ui.ui.select=async(_title,options)=>options[0];
 assert.equal(await clarifyProductionScout(o,ui),true);o.ready(o.state.revision);assert.equal(o.state.state,'READY');
 assert.equal(readFileSync(join(root,'effects.log'),'utf8'),'Scout\n');assert.deepEqual(o.state.counters,before.state.counters);
});
