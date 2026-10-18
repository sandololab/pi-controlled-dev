import test from 'node:test';
import assert from 'node:assert/strict';
import { installSourceLoader } from './load-source.mjs';
import { loadContracts } from './load-contracts.mjs';
import { fixtures, H, GIT, TIME } from './contract-fixtures.mjs';
installSourceLoader();
const api=await loadContracts();
const { CentralOrchestrator, OrchestratorError, canComplete, createAssignment, selectCurrentValidationEvidence }=await import('../src/orchestrator.ts');
const { COMPLETION_CONDITIONS }=await import('../src/state-machine.ts');

function setup(overrides={}){
  const f=fixtures(api);
  f.TaskSpec={...f.TaskSpec,scope:{...f.TaskSpec.scope,repoRoot:process.cwd()},humanGates:{...f.TaskSpec.humanGates,beforeImplementation:false,beforeCompletion:false}};
  if(overrides.dispatchCap!==undefined)f.TaskSpec.retryPolicy={...f.TaskSpec.retryPolicy,maxDispatches:overrides.dispatchCap};
  if(overrides.infrastructureCap!==undefined)f.TaskSpec.retryPolicy={...f.TaskSpec.retryPolicy,maxInfrastructureRetries:overrides.infrastructureCap};
  f.TaskSpec.specHash=api.hashContract('TaskSpec',f.TaskSpec);
  const calls=[]; let verdict=overrides.verdict??'PASS', developerBlocked=overrides.developerBlocked,ambiguities=overrides.ambiguities??[];
  const evidence=a=>({runId:`run-${a.role}-${a.attemptId}`,requestId:`request-${a.role}-${a.attemptId}`,childSessionId:`session-${a.role}-${a.attemptId}`,
    ownerSessionId:'owner',runtimeGeneration:'generation',launchContractHash:a.launchContractHash,effectiveTools:[],invokedTools:[],
    context:a.context,source:'operational-runtime-registration'});
  const envelope=(a,role,refs=['evidence'])=>({schemaVersion:1,taskId:a.taskId,assignmentId:a.assignmentId,attemptId:a.attemptId,
    role,specHash:a.specHash,assignmentHash:a.assignmentHash,evidenceRefs:refs});
  const runners={
    scout:async a=>{calls.push('Scout');return {result:{...envelope(a,'Scout',[]),observations:[],relevantFiles:[],risks:[],ambiguities,
      recommendedScope:f.TaskSpec.scope},evidence:evidence(a)}},
    developer:async a=>{calls.push('Developer');return {result:{...envelope(a,'Developer'),summary:'Implemented',changedFiles:['file.txt'],
      commandsRun:[],tests:[],residualRisks:[],...(developerBlocked?{blockedReason:'blocked'}:{})},evidence:evidence(a)}},
    reviewer:async(a,p)=>{calls.push('Reviewer');const assessment={schemaVersion:1,status:'PASS',evidenceRefs:['evidence'],reason:'Inspected'};
      return {result:{...envelope(a,'Reviewer'),verdict,reviewedTreeHash:H,candidateGeneration:1,
        criteria:[{schemaVersion:1,criterionId:'criterion',assessment}],findings:verdict==='FAIL'?[f.Finding]:[],scopeAssessment:assessment,
        testAssessment:assessment,actualChangesAssessment:assessment,residualRisks:[],validationResultIds:p.validationResults.map(v=>v.id)},evidence:evidence(a)}},
    oracle:async(a,p)=>{calls.push('Oracle');return {result:{...envelope(a,'Oracle'),escalationId:p.escalationId,diagnosis:'Bounded diagnosis',
      options:['Keep blocked'],recommendation:'Ask a human',unresolvedQuestions:[],needsHumanDecision:true},evidence:evidence(a)}},
    ...overrides.runners,
  };
  const capture={candidate:f.Candidate,manifest:f.CandidateManifest,digest:f.Candidate.digest,generation:f.Candidate.generation,changes:[],
    changedFiles:['file.txt'],patch:'diff',handoff:'handoff',artifacts:[f.Candidate.manifest,f.Candidate.patch,f.Candidate.handoff,f.Candidate.terminalProof]};
  const orchestrator=CentralOrchestrator.initialize(f.TaskSpec,{ownerSessionId:'owner',runners,parallelReviewEnabled:overrides.parallelReviewEnabled??true,artifacts:[f.InputSource.snapshot,f.ArtifactRef],
    baselineRef:'HEAD',baselineCommit:GIT,now:()=>TIME,scopeGuardFactory:(...args)=>{
      // Routing-only seam; real rework materialization/authority is covered with Git fixtures separately.
      const guard=(overrides.scopeGuardFactory??(()=>({capture:()=>capture})))(...args);
      return {...guard,prepareRework(source,workRoot){return {originalBaselineCommit:GIT,baseCommit:GIT,repoRoot:f.TaskSpec.scope.repoRoot,workRoot,
        candidateRoot:source.candidate.root,candidateDigest:source.digest,candidateGeneration:source.generation,evidenceRefs:source.artifacts.map(a=>a.id)}},
        finishRework(base,proof){return guard.capture(base.candidateGeneration+1,proof)}};
    }});
  return {f,orchestrator,calls,runners,capture,setVerdict:v=>{verdict=v}};
}
async function throughTesting(s){
  const o=s.orchestrator;await o.analyze(0);o.ready(o.state.revision);await o.implement(o.state.revision,'/candidate');o.testing(o.state.revision);return o;
}
function validation(f,status='PASSED'){return {...f.ValidationResult,specHash:f.TaskSpec.specHash,status,...(status==='PASSED'?{}:{exitCode:1}),reason:status}}
const packet=f=>({candidateManifest:f.CandidateManifest,diff:'diff',changedFiles:['file.txt'],handoff:'handoff',residualRisks:[],evidenceRefs:['evidence']});

test('P10 initializes one valid in-memory CREATE ledger without persistence',()=>{
  const {orchestrator:o}=setup();assert.equal(o.state.state,'PENDING');assert.equal(o.state.revision,0);assert.equal(o.events.length,1);
  assert.equal(o.events[0].kind,'CREATE');assert.equal(api.validateContract('WorkflowState',o.state,o.context()).ok,true);
  assert.throws(()=>CentralOrchestrator.initialize({}, {ownerSessionId:'owner',runners:{}}),e=>e.code==='ORCHESTRATOR_TASK_INVALID');
});

test('P10 serial happy path stops in REVIEWING and never completes',async()=>{
  const s=setup(),o=await throughTesting(s);o.recordValidations([validation(s.f)],[],o.state.revision);
  const result=await o.review(o.state.revision,packet(s.f));assert.equal(result.decision,'COMPLETION_NOT_YET_AUTHORIZED');
  assert.equal(o.state.state,'REVIEWING');assert.deepEqual(s.calls,['Scout','Developer','Reviewer']);assert.equal(o.events.some(e=>e.targetState==='COMPLETED'),false);
  assert.equal(o.state.counters.attempts,3);assert.equal(o.state.counters.dispatches,3);
});

test('P10 assignment factory is deterministic, v2, scoped and authority-bounded',()=>{
  const {f,orchestrator:o}=setup();const a=createAssignment(f.TaskSpec,o.state,'Scout'),b=createAssignment(f.TaskSpec,o.state,'Scout');
  assert.deepEqual(a,b);assert.equal(a.schemaVersion,2);assert.deepEqual(a.authority,['OP-01']);assert.equal(a.context,'fresh');
  assert.equal(api.validateContract('AssignmentEnvelope',a,o.context()).ok,true);
});

test('P15 live regression — Scout and Oracle see validation metadata without execution authority',()=>{
  const {f,orchestrator:o}=setup();
  for(const role of ['Scout','Oracle']){
    const assignment=createAssignment(f.TaskSpec,o.state,role);
    assert.deepEqual(assignment.validationCommands,f.TaskSpec.validationCommands);
    assert.notEqual(assignment.validationCommands,f.TaskSpec.validationCommands);
    for(const criterion of assignment.acceptanceCriteria)for(const id of criterion.commandIds)
      assert.ok(assignment.validationCommands.some(command=>command.id===id&&command.required));
    assert.deepEqual(assignment.authority,['OP-01']);
    assert.equal(api.validateContract('AssignmentEnvelope',assignment,o.context()).ok,true);
    assert.equal(assignment.assignmentHash,api.hashContract('AssignmentEnvelope',assignment));
  }
});

test('P10 CAS rejects stale writers and role capability absence fails closed',async()=>{
  const s=setup({runners:{developer:undefined}}),o=s.orchestrator;await o.analyze(0);
  assert.throws(()=>o.ready(0),e=>e instanceof OrchestratorError&&e.code==='ORCHESTRATOR_REVISION_CONFLICT');
  assert.throws(()=>o.ready(o.state.revision),e=>e.code==='ROLE_CAPABILITY_UNAVAILABLE');
});

test('P10 ambiguity remains ANALYZING and never dispatches Developer',async()=>{
  const s=setup({ambiguities:['Need owner decision']}),result=await s.orchestrator.analyze(0);
  assert.equal(result.decision,'ADVISORY_REQUIRED');assert.equal(s.orchestrator.state.state,'ANALYZING');assert.deepEqual(s.calls,['Scout']);
});

test('P10 Developer blocker transitions to BLOCKED without retry',async()=>{
  const s=setup({developerBlocked:true}),o=s.orchestrator;await o.analyze(0);o.ready(o.state.revision);
  const result=await o.implement(o.state.revision,'/candidate');assert.equal(result.decision,'BLOCKED');assert.equal(o.state.state,'BLOCKED');
  assert.deepEqual(s.calls,['Scout','Developer']);
});

test('P10 dispatch failure records UNKNOWN and blocks without retry',async()=>{
  const s=setup({runners:{developer:async()=>{s.calls.push('Developer');throw new Error('provider down')}}}),o=s.orchestrator;
  await o.analyze(0);o.ready(o.state.revision);await assert.rejects(()=>o.implement(o.state.revision,'/candidate'),/provider down/);
  assert.equal(o.state.state,'BLOCKED');assert.equal(o.state.runs.at(-1).status,'UNKNOWN');assert.deepEqual(s.calls,['Scout','Developer']);
});

test('P10 non-passed authoritative validation blocks review',async()=>{
  const s=setup(),o=await throughTesting(s),result=o.recordValidations([validation(s.f,'FAILED')],[],o.state.revision);
  assert.equal(result.decision,'BLOCKED');assert.equal(o.state.state,'BLOCKED');assert.deepEqual(s.calls,['Scout','Developer']);
});

test('P10 Reviewer FAIL records evidence then enters REWORK without new Developer',async()=>{
  const s=setup({verdict:'FAIL'}),o=await throughTesting(s);o.recordValidations([validation(s.f)],[],o.state.revision);
  const result=await o.review(o.state.revision,packet(s.f));assert.equal(result.decision,'REWORK_REQUIRED');assert.equal(o.state.state,'REWORK');
  assert.deepEqual(s.calls,['Scout','Developer','Reviewer']);
});

test('P10 contradictory duplicate child result is rejected and blocks',async()=>{
  let captured;const s=setup({runners:{scout:async a=>{captured={assignment:a,result:{schemaVersion:1,taskId:a.taskId,assignmentId:a.assignmentId,
    attemptId:a.attemptId,role:'Scout',specHash:a.specHash,assignmentHash:a.assignmentHash,evidenceRefs:[],observations:[],relevantFiles:[],risks:[],
    ambiguities:[],recommendedScope:{schemaVersion:1,repoRoot:process.cwd(),baseRef:'HEAD',allowedPaths:['file.txt'],deniedPaths:[],strongConfinementRequired:false}},
    evidence:{runId:'same-run',requestId:'request',childSessionId:'child',ownerSessionId:'owner',runtimeGeneration:'generation',
      launchContractHash:a.launchContractHash,effectiveTools:[],invokedTools:[],context:'fresh',source:'operational-runtime-registration'}};return {result:captured.result,evidence:captured.evidence}}}});
  await s.orchestrator.analyze(0);captured.result={...captured.result,ambiguities:['contradiction']};
  assert.throws(()=>s.orchestrator.acceptChildResult(captured.assignment,captured,s.orchestrator.state.revision),e=>e.code==='RESULT_CONTRADICTORY');
  assert.equal(s.orchestrator.state.state,'BLOCKED');
});

test('P10 Oracle is explicit one-shot advisory data and creates no gate',async()=>{
  const s=setup({ambiguities:['unknown']}),o=s.orchestrator;await o.analyze(0);
  const failure={...s.f.FailureRecord,specHash:undefined};delete failure.specHash;
  o.openEscalation(failure,'What bounded choice remains?',o.state.revision);const escalation=o.state.escalations[0];
  const result=await o.consultOracle(escalation.id,['unknown'],['evidence'],o.state.revision);
  assert.equal(result.decision,'HUMAN_DECISION_REQUIRED');assert.equal(o.state.state,'ANALYZING');assert.equal(o.state.gates.length,0);
  await assert.rejects(()=>o.consultOracle(escalation.id,['unknown'],['evidence'],o.state.revision),e=>e.code==='ADVISORY_REQUIRED');
});

test('P11 candidate mutation invalidates current validation evidence and blocks review',async()=>{
  let calls=0,base;const s=setup({scopeGuardFactory:()=>({capture:()=>{calls++;const capture=base??(base={candidate:s.f.Candidate,manifest:s.f.CandidateManifest,digest:s.f.Candidate.digest,generation:1,changes:[],changedFiles:['file.txt'],patch:'diff',handoff:'handoff',artifacts:[s.f.Candidate.manifest,s.f.Candidate.patch,s.f.Candidate.handoff,s.f.Candidate.terminalProof]});
    return calls<3?capture:{...capture,digest:'0'.repeat(64)};}})}),o=await throughTesting(s);o.recordValidations([validation(s.f)],[],o.state.revision);
  await assert.rejects(()=>o.review(o.state.revision,packet(s.f)),e=>e.code==='SCOPE_GUARD_FAILED');assert.equal(o.state.state,'BLOCKED');assert.ok(o.state.invalidEvidenceIds.includes('validation'));
});

test('P12 RET-001 routes failures explicitly without an implicit retry loop',async()=>{
  const s=setup(),o=await throughTesting(s);const failed=validation(s.f,'FAILED');o.recordValidations([failed],[],o.state.revision);
  const proof={dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:false,writerTerminal:true,workspaceSafe:true,sameProtocol:true,
    concreteHumanResolution:false,duplicateEscalation:false};
  const routed=o.routeFailure({phase:'TESTING',source:'VALIDATION_FAILED',code:'CHECK_FAILED',subjectIds:['check'],evidenceRefs:['evidence']},proof,o.state.revision);
  assert.equal(routed.decision,'REWORK_REQUIRED');assert.equal(o.state.state,'REWORK');assert.ok(o.state.invalidEvidenceIds.includes('validation'));
  assert.equal(o.state.counters.reworkAttempts,0);assert.deepEqual(s.calls,['Scout','Developer']);
  const repeated=o.routeFailure({phase:'TESTING',source:'VALIDATION_FAILED',code:'CHECK_FAILED',subjectIds:['check'],evidenceRefs:['evidence']},proof,o.state.revision);
  assert.equal(repeated.decision,'ADVISORY_REQUIRED');assert.equal(repeated.value.occurrence,2);assert.equal(o.state.state,'REWORK');
});

test('P12 escalation is deduplicated, permits one Oracle, and closes only with DecisionRecord',async()=>{
  const s=setup({ambiguities:['unknown']}),o=s.orchestrator;await o.analyze(0);
  const failure={schemaVersion:1,id:'failure-ambiguity',phase:'ANALYZING',category:'AMBIGUITY',code:'UNRESOLVED',subjectIds:['criterion'],fingerprint:'0'.repeat(64),evidenceRefs:['evidence']};
  failure.fingerprint=api.failureFingerprint(failure);o.openEscalation(failure,'Which bounded option?',o.state.revision);const escalation=o.state.escalations[0];
  const advice=await o.consultOracle(escalation.id,['unknown'],['evidence'],o.state.revision);assert.equal(advice.decision,'HUMAN_DECISION_REQUIRED');
  await assert.rejects(()=>o.consultOracle(escalation.id,['unknown'],['evidence'],o.state.revision),e=>e.code==='ADVISORY_REQUIRED');
  const decision={schemaVersion:1,id:'decision-advice',kind:'ADOPT_ADVICE',subjectId:o.state.results.at(-1),reason:'Recorded, but human choice remains',evidenceRefs:['evidence']};
  const closed=o.recordDecision(decision,escalation.id,o.state.revision);assert.equal(closed.decision,'HUMAN_DECISION_REQUIRED');assert.equal(o.state.escalations[0].closed,true);
  assert.throws(()=>o.openEscalation(failure,'Which bounded option?',o.state.revision),e=>e.code==='ADVISORY_REQUIRED');
});

test('P12 infrastructure authorization is proof-gated, counted once, and never auto-dispatches',async()=>{
  const s=setup(),o=s.orchestrator;await o.analyze(0);const before=[...s.calls];
  const outcome=o.routeFailure({phase:'ANALYZING',source:'RPC_TRANSIENT',code:'TRANSIENT',subjectIds:['Scout'],evidenceRefs:['evidence']},
    {dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:true,writerTerminal:true,workspaceSafe:true,sameProtocol:true,concreteHumanResolution:false,duplicateEscalation:false},o.state.revision);
  assert.equal(outcome.decision,'RETRY_INFRASTRUCTURE');assert.equal(o.state.counters.infrastructureRetries,1);assert.deepEqual(s.calls,before);
});

test('P12.3 — cap zero refuses retry without consuming any counter',async()=>{
  const s=setup({infrastructureCap:0}),o=s.orchestrator;await o.analyze(0);const before=o.state.counters,calls=[...s.calls];
  const result=o.routeFailure({phase:'ANALYZING',source:'RPC_TRANSIENT',code:'TRANSIENT',subjectIds:['Scout'],evidenceRefs:['evidence']},
    {dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:true,writerTerminal:true,workspaceSafe:true,sameProtocol:true,concreteHumanResolution:false,duplicateEscalation:false},o.state.revision);
  assert.equal(result.decision,'FAILED');assert.deepEqual(o.state.counters,before);assert.deepEqual(s.calls,calls);
});

test('P12.3 — cap one authorizes once; counters charge only authorization and explicit admitted intent',async()=>{
  const s=setup({infrastructureCap:1}),o=s.orchestrator;await o.analyze(0);const before=o.state.counters,oldAttempt=o.state.runs[0].attemptId;
  const input={phase:'ANALYZING',source:'RPC_TRANSIENT',code:'TRANSIENT',subjectIds:['Scout'],evidenceRefs:['evidence']};
  const proof={dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:true,writerTerminal:true,workspaceSafe:true,sameProtocol:true,concreteHumanResolution:false,duplicateEscalation:false};
  assert.equal(o.routeFailure(input,proof,o.state.revision).decision,'RETRY_INFRASTRUCTURE');
  assert.deepEqual(o.state.counters,{...before,infrastructureRetries:before.infrastructureRetries+1});assert.deepEqual(s.calls,['Scout']);
  const proposed=createAssignment(s.f.TaskSpec,o.state,'Scout');assert.notEqual(proposed.attemptId,oldAttempt);
  const authorized=o.state.counters;
  // A repeated fingerprint escalates under RET-001, but neither retries nor launches anything.
  assert.equal(o.routeFailure(input,proof,o.state.revision).decision,'ADVISORY_REQUIRED');assert.deepEqual(o.state.counters,authorized);
  o.ready(o.state.revision);await o.implement(o.state.revision,'/candidate');
  assert.equal(o.state.counters.attempts,authorized.attempts+1);assert.equal(o.state.counters.dispatches,authorized.dispatches+1);
  assert.equal(o.state.counters.infrastructureRetries,1);assert.notEqual(o.state.runs.at(-1).attemptId,oldAttempt);
});

test('P12 bounded rework dispatch increments counter and candidate generation, invalidating old evidence',async()=>{
  const dynamic=()=>({capture(generation){const artifact=name=>({schemaVersion:1,id:`${name}-${generation}`,digest:H,relativeStorePath:`artifacts/${name}-${generation}`,bytes:1,mediaType:'application/json'});
    const artifacts=['manifest','patch','handoff','proof'].map(artifact),candidate={schemaVersion:1,root:'/candidate',baseCommit:GIT,digest:H,generation,
      manifest:artifacts[0],patch:artifacts[1],handoff:artifacts[2],terminalProof:artifacts[3]};
    return {candidate,manifest:{schemaVersion:1,baseCommit:GIT,entries:[{schemaVersion:1,path:'file.txt',kind:'FILE',mode:'100644',contentHash:H}]},digest:H,generation,
      changes:[],changedFiles:['file.txt'],patch:'diff',handoff:'handoff',artifacts};}});
  const s=setup({verdict:'FAIL',scopeGuardFactory:dynamic}),o=await throughTesting(s);o.recordValidations([validation(s.f)],[],o.state.revision);
  await o.review(o.state.revision,packet(s.f));assert.equal(o.state.state,'REWORK');assert.ok(o.state.invalidEvidenceIds.includes('validation'));
  await o.rework(o.state.revision,'/candidate');assert.equal(o.state.candidate.generation,2);assert.equal(o.state.counters.reworkAttempts,1);
  assert.deepEqual(s.calls,['Scout','Developer','Reviewer','Developer']);
});

test('P10 completion evaluator is conjunctive but orchestrator has no completion transition',()=>{
  const {orchestrator:o}=setup(),all=Object.fromEntries(Object.keys(COMPLETION_CONDITIONS).map(id=>[id,true]));
  assert.equal(canComplete(o.state,all),false);const reviewing={...o.state,state:'REVIEWING'};assert.equal(canComplete(reviewing,all),true);
  assert.equal(canComplete(reviewing,{...all,'CMP-17':false}),false);
});

for(const claim of [{transientInfrastructure:true},{childNeverStarted:true},{writerTerminal:true},{workspaceClean:true},
  {transientInfrastructure:true,childNeverStarted:true,writerTerminal:true,workspaceSafe:true,workspaceClean:true,sameProtocol:true},
  {storedRunStatus:'TERMINAL',transientInfrastructure:true,writerTerminal:true,workspaceSafe:true,sameProtocol:true}])
  test(`P12 corrective TEST-024/028 — UNKNOWN overrides ${JSON.stringify(claim)}`,async()=>{
    const s=setup({infrastructureCap:1,runners:{developer:async()=>{throw new Error('unknown launch')}}}),o=s.orchestrator;
    await o.analyze(0);o.ready(o.state.revision);await assert.rejects(()=>o.implement(o.state.revision,'/candidate'));
    const before=o.state.counters;
    const result=o.routeFailure({phase:'IMPLEMENTING',source:'RPC_TRANSIENT',code:'TRANSIENT',subjectIds:['Developer'],evidenceRefs:['evidence']},
      {dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:false,writerTerminal:false,workspaceSafe:false,sameProtocol:false,
        concreteHumanResolution:false,duplicateEscalation:false,...claim},o.state.revision);
    assert.equal(result.decision,'BLOCKED');assert.equal(o.state.runs.at(-1).status,'UNKNOWN');assert.deepEqual(o.state.counters,before);
  });

for(const parallel of [false,true])for(const sameDigest of [false,true])test(`${parallel?'P13 parallel':'P12 corrective'} TEST-039 subset — re-review current generation, same digest=${sameDigest}`,async()=>{
  const s=setup({scopeGuardFactory:()=>({capture(generation){
    const digest=generation===1||sameDigest?H:'c'.repeat(64),artifacts=['manifest','patch','handoff','proof'].map(name=>({...s.f.Candidate.manifest,id:`${name}-${generation}`}));
    const candidate={...s.f.Candidate,digest,generation,manifest:artifacts[0],patch:artifacts[1],handoff:artifacts[2],terminalProof:artifacts[3]};
    return {candidate,manifest:s.f.CandidateManifest,digest,generation,changes:[],changedFiles:['file.txt'],patch:'diff',handoff:'handoff',artifacts};
  }})}),o=await throughTesting(s);
  o.recordValidations([validation(s.f,'FAILED')],[],o.state.revision);
  o.routeFailure({phase:'TESTING',source:'VALIDATION_FAILED',code:'CHECK_FAILED',subjectIds:['check'],evidenceRefs:['validation']},
    {dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:false,writerTerminal:true,workspaceSafe:true,sameProtocol:true,concreteHumanResolution:false,duplicateEscalation:false},o.state.revision);
  await o.rework(o.state.revision,'/candidate');o.testing(o.state.revision);
  const c=o.state.candidate;
  o.recordValidations([{...validation(s.f),id:'validation-2',candidateGeneration:2,candidateDigest:c.digest,postCandidateDigest:c.digest}],[],o.state.revision);
  const runner=s.runners.reviewer;
  s.runners.reviewer=async(a,p,ctx)=>{
    assert.deepEqual(p.validationResults.map(v=>v.id),['validation-2']);assert.deepEqual(ctx.currentValidationIds,['validation-2']);
    assert.ok(!p.evidenceRefs.includes('validation'));assert.ok(!a.inputArtifactRefs.includes('validation'));
    const output=await runner(a,p);return {...output,result:{...output.result,reviewedTreeHash:c.digest,candidateGeneration:2}};
  };
  const hostPacket={...packet(s.f),evidenceRefs:['validation','evidence']};
  await (parallel?o.reviewParallel(o.state.revision,hostPacket):o.review(o.state.revision,hostPacket));
  assert.equal(o.state.reviews.length,parallel?2:1);
  assert.equal(o.state.state,'REVIEWING');assert.ok(o.state.validations.includes('validation'));assert.ok(o.state.invalidEvidenceIds.includes('validation'));
  assert.ok(o.context().records.some(r=>r.id==='validation'&&r.value.status==='FAILED'));
});

test('P12 corrective — latest same-generation evidence never prefers an old PASS',()=>{
  const s=setup(),v=validation(s.f),state={...s.orchestrator.state,candidate:s.f.Candidate,validations:['first','last']};
  for(const statuses of [['FAILED','PASSED'],['PASSED','FAILED']]){
    const records=statuses.map((status,i)=>({...v,id:i?'last':'first',status}));
    assert.deepEqual(selectCurrentValidationEvidence(s.f.TaskSpec,state,records).map(v=>[v.id,v.status]),[['last',statuses[1]]]);
  }
});

test('P12 corrective — contradictory simultaneous authoritative validation set blocks',async()=>{
  const s=setup(),o=await throughTesting(s);
  assert.throws(()=>o.recordValidations([{...validation(s.f),id:'pass'},{...validation(s.f,'FAILED'),id:'fail'}],[],o.state.revision),e=>e.code==='RESULT_CONTRADICTORY');
  assert.equal(o.state.state,'BLOCKED');assert.deepEqual(s.calls,['Scout','Developer']);
});

test('P12 corrective — wrong command hash, invalidated and stale generation cannot satisfy validation',()=>{
  const s=setup(),v=validation(s.f),state={...s.orchestrator.state,candidate:{...s.f.Candidate,generation:2},validations:['validation']};
  for(const altered of [v,{...v,candidateGeneration:2,commandHash:'0'.repeat(64)},{...v,candidateGeneration:2,specHash:'0'.repeat(64)}])
    assert.deepEqual(selectCurrentValidationEvidence(s.f.TaskSpec,state,[altered]),[]);
  assert.deepEqual(selectCurrentValidationEvidence(s.f.TaskSpec,{...state,invalidEvidenceIds:['validation']},[{...v,candidateGeneration:2}]),[]);
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('P13 — two read-only reviews overlap logically, reserve the whole budget and exclude writers',async()=>{
  const s=setup(),o=await throughTesting(s);o.recordValidations([validation(s.f)],[],o.state.revision);
  const base=s.runners.reviewer,releases=[],assignments=[];let active=0,peak=0;
  s.runners.reviewer=async(a,p)=>{assignments.push(a);peak=Math.max(peak,++active);await new Promise(r=>releases.push(r));--active;return base(a,p)};
  const pending=o.reviewParallel(o.state.revision,packet(s.f));await tick();assert.equal(peak,2);assert.equal(o.state.counters.dispatches,4);
  assert.equal(new Set(assignments.map(a=>a.assignmentId)).size,2);assert.equal(new Set(assignments.map(a=>a.attemptId)).size,2);
  for(const a of assignments){assert.equal(a.context,'fresh');assert.deepEqual(a.authority,['OP-01','OP-07']);assert.equal(a.candidateGeneration,1)}
  const counters=o.state.counters;await assert.rejects(o.implement(o.state.revision,'/candidate'));await assert.rejects(o.rework(o.state.revision,'/rework'));
  await assert.rejects(o.reviewParallel(o.state.revision,packet(s.f)),e=>e.code==='ORCHESTRATOR_BLOCKED');assert.throws(()=>o.testing(o.state.revision),e=>e.code==='ORCHESTRATOR_BLOCKED');
  assert.deepEqual(o.state.counters,counters);releases[0]();await tick();assert.equal(o.state.reviews.length,0);assert.equal(o.state.state,'REVIEWING');
  releases[1]();const result=await pending;assert.equal(result.value.length,2);assert.equal(result.decision,'COMPLETION_NOT_YET_AUTHORIZED');
  assert.equal(o.state.state,'REVIEWING');assert.ok(o.state.runs.every(r=>r.status==='TERMINAL'));assert.equal(new Set(o.state.runs.map(r=>r.childSessionId)).size,4);
});

test('P13 — parallel capability stays disabled without explicit host opt-in',async()=>{
  const s=setup({parallelReviewEnabled:false}),o=await throughTesting(s);o.recordValidations([validation(s.f)],[],o.state.revision);const before=o.state;
  await assert.rejects(o.reviewParallel(o.state.revision,packet(s.f)),e=>e.code==='ROLE_CAPABILITY_UNAVAILABLE');assert.deepEqual(o.state,before);
});

test('P13 — BLOCKED plus PASS remains blocked with both results retained',async()=>{
  const s=setup(),o=await throughTesting(s);o.recordValidations([validation(s.f)],[],o.state.revision);const base=s.runners.reviewer;let i=0;
  s.runners.reviewer=async(a,p)=>{const index=i++,output=await base(a,p);if(index===0)output.result.verdict='BLOCKED';return output};
  const result=await o.reviewParallel(o.state.revision,packet(s.f));assert.equal(result.decision,'BLOCKED');assert.equal(o.state.reviews.length,2);
  assert.ok(o.state.runs.every(r=>r.status==='TERMINAL'));assert.equal(o.state.counters.reworkAttempts,0);
});

test('P13 — insufficient whole-batch budget consumes no intent, attempt or dispatch',async()=>{
  const s=setup({dispatchCap:3}),o=await throughTesting(s);o.recordValidations([validation(s.f)],[],o.state.revision);const before=o.state;
  await assert.rejects(o.reviewParallel(o.state.revision,packet(s.f)),e=>e.code==='ORCHESTRATOR_BLOCKED');assert.deepEqual(o.state,before);assert.deepEqual(s.calls,['Scout','Developer']);
});

test('P13 — FAIL plus PASS is not a majority vote and cannot route rework before quiescence',async()=>{
  const s=setup(),o=await throughTesting(s);o.recordValidations([validation(s.f)],[],o.state.revision);
  const base=s.runners.reviewer;let release,index=0;
  s.runners.reviewer=async(a,p)=>{const i=index++;if(i===1)await new Promise(r=>release=r);const output=await base(a,p);
    if(i===0)output.result={...output.result,verdict:'FAIL',findings:[s.f.Finding]};return output};
  const pending=o.reviewParallel(o.state.revision,packet(s.f));await tick();assert.equal(o.state.state,'REVIEWING');assert.equal(o.state.reviews.length,0);
  await assert.rejects(o.rework(o.state.revision,'/rework'));release();const result=await pending;assert.equal(result.decision,'REWORK_REQUIRED');
  assert.equal(o.state.state,'REWORK');assert.equal(o.state.reviews.length,2);assert.ok(o.state.runs.every(r=>r.status==='TERMINAL'));
});

test('P13 — an unattributable/failed sibling waits for the other and UNKNOWN forbids retry',async()=>{
  const s=setup(),o=await throughTesting(s);o.recordValidations([validation(s.f)],[],o.state.revision);const base=s.runners.reviewer;let release,index=0;
  s.runners.reviewer=async(a,p)=>{if(index++===0)throw undefined;await new Promise(r=>release=r);return base(a,p)};
  const pending=o.reviewParallel(o.state.revision,packet(s.f)),rejection=assert.rejects(pending,e=>e.code==='ORCHESTRATOR_BLOCKED');await tick();
  assert.equal(o.state.state,'REVIEWING');assert.equal(o.state.reviews.length,0);release();await rejection;
  assert.equal(o.state.state,'BLOCKED');assert.deepEqual(o.state.runs.slice(-2).map(r=>r.status),['UNKNOWN','TERMINAL']);const before=o.state.counters;
  const decision=o.routeFailure({phase:'REVIEWING',source:'RPC_TRANSIENT',code:'TRANSIENT',subjectIds:['Reviewer'],evidenceRefs:['evidence']},
    {dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:true,writerTerminal:true,workspaceSafe:true,sameProtocol:true,concreteHumanResolution:false,duplicateEscalation:false},o.state.revision);
  assert.equal(decision.value.action,'BLOCK');assert.deepEqual(o.state.counters,before);
});

test('P13 — child/session attribution cannot be shared by independent reviews',async()=>{
  const s=setup(),o=await throughTesting(s);o.recordValidations([validation(s.f)],[],o.state.revision);const base=s.runners.reviewer;
  s.runners.reviewer=async(a,p)=>{const output=await base(a,p);output.evidence.childSessionId='duplicated-session';return output};
  await assert.rejects(o.reviewParallel(o.state.revision,packet(s.f)),e=>e.code==='RESULT_ATTRIBUTION_MISMATCH');assert.equal(o.state.state,'BLOCKED');
  assert.deepEqual(o.state.runs.slice(-2).map(r=>r.status),['TERMINAL','UNKNOWN']);
});

test('P13 — candidate corruption after fan-out invalidates evidence and blocks the cohort',async()=>{
  const {ScopeGuardError}=await import('../src/scope-guard.ts');let mutated=false;
  const s=setup({scopeGuardFactory:()=>({capture:()=>{if(mutated)throw new ScopeGuardError('SCOPE_WORKSPACE_CHANGED');return s.capture}})}),o=await throughTesting(s);
  o.recordValidations([validation(s.f)],[],o.state.revision);const base=s.runners.reviewer;
  s.runners.reviewer=async(a,p)=>{const output=await base(a,p);mutated=true;return output};
  await assert.rejects(o.reviewParallel(o.state.revision,packet(s.f)),e=>e.code==='SCOPE_GUARD_FAILED');assert.equal(o.state.state,'BLOCKED');
  assert.ok(o.state.invalidEvidenceIds.includes('validation'));assert.ok(o.state.runs.slice(-2).every(r=>r.status==='UNKNOWN'));assert.equal(o.state.reviews.length,0);
});

test('P13 — a live Developer prevents a second writer and any validation admission',async()=>{
  const s=setup(),o=s.orchestrator;await o.analyze(0);o.ready(o.state.revision);const base=s.runners.developer;let release;
  s.runners.developer=async a=>{await new Promise(r=>release=r);return base(a)};const pending=o.implement(o.state.revision,'/candidate');await tick();
  const counters=o.state.counters;await assert.rejects(o.implement(o.state.revision,'/candidate'));assert.throws(()=>o.testing(o.state.revision));
  assert.deepEqual(o.state.counters,counters);release();await pending;assert.equal(o.state.runs.filter(r=>r.role==='Developer').length,1);
});
