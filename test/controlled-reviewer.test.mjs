import {memoryForRole} from './project-memory-fixture.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { installSourceLoader } from './load-source.mjs';
import { loadContracts } from './load-contracts.mjs';
import { fixtures, context } from './contract-fixtures.mjs';
installSourceLoader();
const reviewer=await import('../src/controlled-reviewer.ts');
const scout=await import('../src/controlled-scout.ts');
const developer=await import('../src/controlled-developer.ts');
const api=await loadContracts();
const { ScopeGuard }=await import('../src/scope-guard.ts');
class Bus{map=new Map();on(n,f){const s=this.map.get(n)??new Set();s.add(f);this.map.set(n,s);return()=>s.delete(f)}emit(n,d){for(const f of [...(this.map.get(n)??[])])f(d)}}
const git=(cwd,args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8'}).replace(/\n$/,'');
function workspace({nested=false,unchangedCount=0,setupFiles=false}={}){const parent=mkdtempSync(join(tmpdir(),'controlled-reviewer-')),repo=join(parent,'original'),work=join(parent,'candidate');mkdirSync(repo);
  git(repo,['init','-q']);git(repo,['config','user.email','test@example.invalid']);git(repo,['config','user.name','Test']);
  writeFileSync(join(repo,'allowed.txt'),'before\n');writeFileSync(join(repo,'outside.txt'),'same\n');
  if(setupFiles){mkdirSync(join(repo,'tests','asw'),{recursive:true});writeFileSync(join(repo,'pyproject.toml'),'[tool.pytest.ini_options]\n');writeFileSync(join(repo,'tests','asw','test_setup.py'),'def test_setup(): pass\n');}
  if(unchangedCount){mkdirSync(join(repo,'unchanged'));for(let i=0;i<unchangedCount;i++)writeFileSync(join(repo,'unchanged',`source-${i}.txt`),'unchanged\n');}
  git(repo,['add','.']);git(repo,['commit','-qm','base']);
  const baseCommit=git(repo,['rev-parse','HEAD']);git(repo,['worktree','add','--quiet','--detach',work,baseCommit]);
  const allowedPaths=['allowed.txt',...(nested?['src/new.ts']:[])];const guard=ScopeGuard.open({schemaVersion:1,repoRoot:repo,baseRef:'HEAD',allowedPaths,deniedPaths:[],strongConfinementRequired:false},work,baseCommit);
  writeFileSync(join(work,'allowed.txt'),'after\n');if(nested){mkdirSync(join(work,'src'));writeFileSync(join(work,'src','new.ts'),'export const value = 1;\n')}const capture=guard.capture(1,'host terminal proof');return{parent,repo,work,baseCommit,guard,capture,allowedPaths}}
function manifest(ws){return JSON.parse(JSON.stringify(ws.capture.manifest))}
function packet(ws){const f=fixtures(api),m=manifest(ws),digest=api.hashCanonical(m),scope={...f.TaskSpec.scope,repoRoot:ws.repo,allowedPaths:ws.allowedPaths,deniedPaths:[]};
  f.TaskSpec={...f.TaskSpec,scope};f.TaskSpec.specHash=api.hashContract('TaskSpec',f.TaskSpec);
  const captureRefs=ws.capture.artifacts.map(value=>value.id);
  f.AssignmentEnvelope={...f.AssignmentEnvelope,role:'Reviewer',specHash:f.TaskSpec.specHash,repoRoot:ws.repo,workRoot:ws.work,baseCommit:ws.baseCommit,
    allowedPaths:ws.allowedPaths,deniedPaths:[],requirements:f.TaskSpec.requirements,acceptanceCriteria:f.TaskSpec.acceptanceCriteria,
    authority:['OP-01','OP-07'],validationCommands:f.TaskSpec.validationCommands,candidateDigest:digest,candidateGeneration:ws.capture.generation,
    inputArtifactRefs:[...f.AssignmentEnvelope.inputArtifactRefs,...captureRefs],launchContractHash:reviewer.REVIEWER_LAUNCH_CONTRACT_HASH};f.AssignmentEnvelope.assignmentHash=api.hashContract('AssignmentEnvelope',f.AssignmentEnvelope);
  f.ValidationResult={...f.ValidationResult,specHash:f.TaskSpec.specHash,candidateDigest:digest,candidateGeneration:ws.capture.generation,postCandidateDigest:digest};
  f.WorkflowState={...f.WorkflowState,revision:1,state:'REVIEWING',repoRoot:ws.repo,specHash:f.TaskSpec.specHash,baselineCommit:ws.baseCommit,
    candidate:ws.capture.candidate,runs:[
      {...f.RunRecord,assignmentId:'developer-assignment',attemptId:'developer-attempt',runId:'developer-run',childSessionId:'developer-session'},
      {...f.RunRecord,assignmentId:f.AssignmentEnvelope.assignmentId,attemptId:f.AssignmentEnvelope.attemptId,role:'Reviewer',requestId:'review-request',runId:'review-run',childSessionId:'review-session'}],
    counters:{...f.Counters,attempts:2,dispatches:2}};
  const assessment={schemaVersion:1,status:'PASS',evidenceRefs:['evidence'],reason:'Verified'};
  f.ReviewResult={schemaVersion:1,taskId:f.AssignmentEnvelope.taskId,assignmentId:f.AssignmentEnvelope.assignmentId,attemptId:f.AssignmentEnvelope.attemptId,
    role:'Reviewer',specHash:f.TaskSpec.specHash,assignmentHash:f.AssignmentEnvelope.assignmentHash,evidenceRefs:['evidence'],verdict:'PASS',reviewedTreeHash:digest,
    candidateGeneration:ws.capture.generation,criteria:f.TaskSpec.acceptanceCriteria.map(c=>({schemaVersion:1,criterionId:c.id,assessment})),findings:[],scopeAssessment:assessment,
    testAssessment:assessment,actualChangesAssessment:assessment,residualRisks:[],validationResultIds:['validation']};
  const ctx=context(f);ctx.records=ctx.records.filter(r=>!['spec','assignment','state'].includes(r.id));ctx.records.push({id:'spec',kind:'TaskSpec',value:f.TaskSpec},
    {id:'assignment',kind:'AssignmentEnvelope',value:f.AssignmentEnvelope},{id:'state',kind:'WorkflowState',value:f.WorkflowState},
    {id:'validation',kind:'ValidationResult',value:f.ValidationResult},...ws.capture.artifacts.map(value=>({id:value.id,kind:'ArtifactRef',value})));ctx.currentValidationIds=['validation'];
  const reviewPacket={schemaVersion:1,taskId:f.AssignmentEnvelope.taskId,assignmentId:f.AssignmentEnvelope.assignmentId,specHash:f.TaskSpec.specHash,
    candidateDigest:digest,candidateGeneration:ws.capture.generation,requirements:f.TaskSpec.requirements,acceptanceCriteria:f.TaskSpec.acceptanceCriteria,
    diff:ws.capture.patch,changedFiles:ws.capture.changedFiles,candidateManifest:m,
    validationResults:[f.ValidationResult],handoff:ws.capture.handoff,residualRisks:[],evidenceRefs:['evidence',...captureRefs]};return{f,ctx,reviewPacket}}
function fakeHost({ws,result,toolNames=['read','structured_output'],invoked=['read','structured_output'],agent='controlled.reviewer',contextName='fresh',historyLeak='',mutate,spawnReplyMalformed=false}={}){
  const tasks=[];
  const bus=new Bus(),state=mkdtempSync(join(tmpdir(),'controlled-reviewer-state-')),active=new Set();let disposed=0,spawns=0,run;
  bus.on(scout.RUNTIME_AGENT_REGISTER_EVENT,q=>{if(active.has(q.name)){q.result={ok:false,error:new Error('collision')};return}active.add(q.name);q.result={ok:true,registration:{dispose(){if(active.delete(q.name))disposed++}}}});
  bus.on('subagents:rpc:v1:request',q=>{const reply=data=>bus.emit('subagents:rpc:v1:reply:'+q.requestId,{version:1,requestId:q.requestId,method:q.method,success:true,data});
    if(q.method==='ping')return reply({version:1,methods:['ping','spawn','status','interrupt','stop','resume'],capabilities:{status:true,asyncSpawn:true,steer:true,interrupt:true,stop:true,resume:true},events:{asyncComplete:'subagents:complete'},session:{sessionId:'owner',sessionFile:null}});
    if(q.method==='spawn'){
      tasks.push(q.params.task);
      assert.match(q.params.task,/historical Developer handoff statements made before host validation/);
      assert.match(q.params.task,/real contradictions or unresolved risks must still block/);
      assert.match(q.params.task,/if you retain a supplied risk, copy every field exactly/);
      assert.match(q.params.task,/host retains the original Developer risks independently/);
      assert.match(q.params.task,/Software design and code quality/);
      assert.match(q.params.task,/Name variables for the values they hold, functions for the operations they perform, and classes for their cohesive responsibility/);
      assert.match(q.params.task,/Cite the affected symbol and explain the concrete ambiguity/);
      assert.match(q.params.task,/do not request cosmetic renames across unrelated code/);
      assert.match(q.params.task,/Check comments and docstrings in created or materially changed source files/);
      assert.match(q.params.task,/stale comments or unsupported guarantees are defects/);
      assert.match(q.params.task,/unnecessary abstraction, class, interface or design pattern/);
      assert.match(q.params.task,/subjective taste, small formatting differences or equivalent designs/);
      if(spawnReplyMalformed){spawns++;return reply({details:{}})}
      spawns++;run='review-run';reply({details:{asyncId:run,runId:run}});queueMicrotask(()=>{mutate?.();const sessionFile=join(state,'child.jsonl');
      writeFileSync(sessionFile,[{type:'session',cwd:ws.work},{type:'message',message:{role:'system',sections:{preamble:`<active_agent name="${agent}"/>${historyLeak}`},toolsAdded:toolNames.map(name=>({name}))}},
        {type:'message',message:{role:'assistant',content:invoked.map(name=>({type:'toolCall',name}))}}].map(JSON.stringify).join('\n'));
      bus.emit('subagents:complete',{id:run,runId:run,sessionId:'owner',success:true,state:'complete',exitCode:0,results:[{agent,context:contextName,success:true,status:'completed',sessionFile,
        launchContractDigest:'f'.repeat(64),launchResolvedExtensions:{version:1,source:'launch-resolved',disableAmbientExtensions:true,runtime:['internal'],configured:[],required:[],effective:['internal']},structuredOutput:result}]})});return}
    if(q.method==='status')return reply({asyncSnapshot:{kind:'pi-subagents.async-status-snapshot',version:1,runs:[{id:run,state:'complete'}]}});return reply({})});
  return{bus,state,tasks,get disposed(){return disposed},get spawns(){return spawns}}}
const cleanup=(ws,h)=>{rmSync(h?.state,{recursive:true,force:true});rmSync(ws.parent,{recursive:true,force:true})};
async function execute(ws,p,options={}){const host=fakeHost({ws,result:p.f.ReviewResult,...options}),registration=reviewer.registerControlledReviewer({events:host.bus},'generation'),runner=new reviewer.ControlledReviewerRunner(registration,host.bus,'owner');
  try{return{output:await runner.run(p.f.AssignmentEnvelope,p.reviewPacket,p.ctx,{historyCanary:'PARENT_CANARY'}),host}}finally{runner.dispose();registration.dispose()}}

test('P8-001 — deterministic Reviewer CLA-001 grants only OP-01 and OP-07',()=>{assert.equal(reviewer.REVIEWER_LAUNCH_CONTRACT_HASH,api.hashCanonical(reviewer.REVIEWER_LAUNCH_CONTRACT));assert.deepEqual(reviewer.REVIEWER_RUNTIME_DEFINITION.tools,['read']);assert.deepEqual(reviewer.REVIEWER_LAUNCH_CONTRACT.capabilityConstraints.operationIds,['OP-01','OP-07']);assert.deepEqual(reviewer.REVIEWER_RUNTIME_DEFINITION.mutationTools,[]);assert.equal(reviewer.REVIEWER_RUNTIME_DEFINITION.allowNestedSubagents,false)});
test('P8-002 TEST-032 — three-role generation lifecycle, collision and idempotent disposal',()=>{const ws=workspace(),p=packet(ws),h=fakeHost({ws,result:p.f.ReviewResult});const s=scout.registerControlledScout({events:h.bus},'g'),d=developer.registerControlledDeveloper({events:h.bus},'g'),r=reviewer.registerControlledReviewer({events:h.bus},'g');assert.ok(s&&d&&r);assert.throws(()=>reviewer.registerControlledReviewer({events:h.bus},'other'),/collision/);r.dispose();r.dispose();d.dispose();s.dispose();assert.equal(h.disposed,3);cleanup(ws,h)});
test('P8-003 TEST-004/014/018 — bound PASS is fresh, independent, read-only and tree-exact',async()=>{const ws=workspace(),p=packet(ws),{output,host}=await execute(ws,p);assert.equal(output.result.verdict,'PASS');assert.equal(output.evidence.reviewedTreeHash,p.f.AssignmentEnvelope.candidateDigest);assert.deepEqual(output.evidence.effectiveTools,['read','structured_output']);assert.equal(output.evidence.candidateUnchanged,true);cleanup(ws,host)});
test('Reviewer compares Git permissions across copies while preserving exact per-copy mutation canaries',async()=>{
 const ws=workspace();try{chmodSync(join(ws.repo,'outside.txt'),0o666);chmodSync(join(ws.work,'outside.txt'),0o644);const p=packet(ws),{output,host}=await execute(ws,p);
   assert.equal(output.result.verdict,'PASS');assert.equal(host.spawns,1);rmSync(host.state,{recursive:true,force:true});
   const h=fakeHost({ws,result:p.f.ReviewResult,mutate:()=>chmodSync(join(ws.work,'outside.txt'),0o600)}),registration=reviewer.registerControlledReviewer({events:h.bus},'g'),runner=new reviewer.ControlledReviewerRunner(registration,h.bus,'owner');
   try{await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.reviewPacket,p.ctx),error=>error.code==='READ_ONLY_CANARY_CHANGED');}finally{runner.dispose();registration.dispose();rmSync(h.state,{recursive:true,force:true});}
 }finally{rmSync(ws.parent,{recursive:true,force:true});}
});
test('Reviewer retains executable-mode changes as unauthorized differences',async()=>{
 const ws=workspace(),p=packet(ws),h=fakeHost({ws,result:p.f.ReviewResult}),registration=reviewer.registerControlledReviewer({events:h.bus},'g'),runner=new reviewer.ControlledReviewerRunner(registration,h.bus,'owner');
 try{chmodSync(join(ws.work,'outside.txt'),0o755);await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.reviewPacket,p.ctx),error=>error.code==='REVIEW_WORKSPACE_INVALID');assert.equal(h.spawns,0);}finally{runner.dispose();registration.dispose();cleanup(ws,h);}
});
test('Reviewer uses source index modes on filemode-ignoring filesystems but retains physical mutation canaries',async()=>{
 const ws=workspace({setupFiles:true});try{
   git(ws.repo,['config','core.filemode','false']);for(const path of ['pyproject.toml','tests/asw/test_setup.py'])chmodSync(join(ws.repo,path),0o777);
   assert.equal(git(ws.repo,['ls-files','--stage','pyproject.toml','tests/asw/test_setup.py']).split('\n').every(row=>row.startsWith('100644 ')),true);
   const p=packet(ws),{output,host}=await execute(ws,p);assert.equal(output.result.verdict,'PASS');assert.equal(host.spawns,1);rmSync(host.state,{recursive:true,force:true});
   for(const mutate of [()=>chmodSync(join(ws.repo,'outside.txt'),0o666),()=>chmodSync(join(ws.work,'outside.txt'),0o600)]){
     chmodSync(join(ws.repo,'outside.txt'),0o777);chmodSync(join(ws.work,'outside.txt'),0o644);
     const h=fakeHost({ws,result:p.f.ReviewResult,mutate}),registration=reviewer.registerControlledReviewer({events:h.bus},'g'),runner=new reviewer.ControlledReviewerRunner(registration,h.bus,'owner');
     try{await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.reviewPacket,p.ctx),e=>['ORIGINAL_WORKSPACE_CHANGED','READ_ONLY_CANARY_CHANGED'].includes(e.code));assert.equal(h.spawns,1)}finally{runner.dispose();registration.dispose();rmSync(h.state,{recursive:true,force:true});}
   }
   chmodSync(join(ws.repo,'outside.txt'),0o777);chmodSync(join(ws.work,'outside.txt'),0o755);
   const h=fakeHost({ws,result:p.f.ReviewResult}),registration=reviewer.registerControlledReviewer({events:h.bus},'g'),runner=new reviewer.ControlledReviewerRunner(registration,h.bus,'owner');
   try{await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.reviewPacket,p.ctx),e=>e.code==='REVIEW_WORKSPACE_INVALID'&&e.dispatchOutcome==='NOT_SENT');assert.equal(h.spawns,0)}finally{runner.dispose();registration.dispose();rmSync(h.state,{recursive:true,force:true});}
 }finally{rmSync(ws.parent,{recursive:true,force:true});}
});
test('Reviewer delivers a bound projection of a large verified manifest while preserving complete review evidence',async()=>{
 const ws=workspace({unchangedCount:1600}),p=packet(ws);try{assert.ok(Buffer.byteLength(api.canonicalize(p.reviewPacket.candidateManifest))>256*1024);
   const original=api.canonicalize(p.reviewPacket),{output,host}=await execute(ws,p);assert.equal(output.result.verdict,'PASS');assert.equal(host.spawns,1);
   assert.ok(Buffer.byteLength(host.tasks[0])<256*1024);const delivery=JSON.parse(host.tasks[0].split('\nREVIEW_PACKET=')[1].split('\n')[0]);
   assert.equal(delivery.candidateManifest,undefined);assert.equal(delivery.candidateManifestSummary.digest,p.reviewPacket.candidateDigest);assert.equal(delivery.candidateManifestSummary.baseCommit,ws.baseCommit);
   assert.equal(delivery.candidateManifestSummary.entryCount,1602);assert.deepEqual(delivery.candidateManifestSummary.changedEntries,p.reviewPacket.candidateManifest.entries.filter(entry=>entry.path==='allowed.txt'));assert.deepEqual(delivery.candidateManifestSummary.removedPaths,[]);
   for(const key of ['diff','changedFiles','requirements','acceptanceCriteria','validationResults','evidenceRefs','residualRisks','handoff'])assert.deepEqual(delivery[key],p.reviewPacket[key]);
   assert.equal(api.canonicalize(p.reviewPacket),original);rmSync(host.state,{recursive:true,force:true});
   const removed=reviewer.reviewPacketDelivery({...p.reviewPacket,changedFiles:[...p.reviewPacket.changedFiles,'removed.txt']});assert.deepEqual(removed.candidateManifestSummary.removedPaths,['removed.txt']);
 }finally{rmSync(ws.parent,{recursive:true,force:true});}
});
test('P8-004 TEST-017 — FAIL with finding and BLOCKED semantics are accepted as review data',async()=>{for(const verdict of ['FAIL','BLOCKED']){const ws=workspace(),p=packet(ws),assessment={schemaVersion:1,status:verdict==='FAIL'?'FAIL':'UNVERIFIABLE',evidenceRefs:verdict==='FAIL'?['evidence']:[],reason:'Not satisfied'};p.f.ReviewResult={...p.f.ReviewResult,verdict,criteria:[{schemaVersion:1,criterionId:'criterion',assessment}],findings:verdict==='FAIL'?[{...p.f.Finding,blocking:true}]:[],scopeAssessment:assessment};const{output,host}=await execute(ws,p);assert.equal(output.result.verdict,verdict);cleanup(ws,host)}});
test('P8-005 TEST-004/037 — mutation tools, use, fork and history leakage fail closed',async()=>{for(const options of [{toolNames:['read','structured_output','write']},{invoked:['bash']},{contextName:'fork'},{historyLeak:'PARENT_CANARY'},{mutate:null}]){const ws=workspace(),p=packet(ws);if(options.mutate===null)options.mutate=()=>writeFileSync(join(ws.work,'allowed.txt'),'tampered\n');const h=fakeHost({ws,result:p.f.ReviewResult,...options}),r=reviewer.registerControlledReviewer({events:h.bus},'g'),runner=new reviewer.ControlledReviewerRunner(r,h.bus,'owner');await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.reviewPacket,p.ctx,{historyCanary:'PARENT_CANARY'}));runner.dispose();r.dispose();cleanup(ws,h)}});
test('P8-006 TEST-018 — wrong candidate identity, manifest, validations or diff never dispatch',async()=>{for(const [change,field] of [[p=>p.reviewPacket.candidateDigest='0'.repeat(64),'candidateDigest'],[p=>p.reviewPacket.diff='invented','diff'],[p=>p.reviewPacket.validationResults=[],'validationResults'],[p=>p.reviewPacket.candidateManifest.entries[0].contentHash='0'.repeat(64),'candidateManifest']]){const ws=workspace(),p=packet(ws);change(p);const h=fakeHost({ws,result:p.f.ReviewResult}),r=reviewer.registerControlledReviewer({events:h.bus},'g'),runner=new reviewer.ControlledReviewerRunner(r,h.bus,'owner');let proof;await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.reviewPacket,p.ctx,{onNoDispatchProof:p=>proof=p}),e=>{assert.equal(e.code,'INVALID_REVIEW_PACKET');assert.equal(e.dispatchOutcome,'NOT_SENT');assert.deepEqual(e.diagnostic,{phase:'REVIEW_PACKET',path:field});assert.equal(Object.isFrozen(e.diagnostic),true);return true});assert.equal(proof.code,'INVALID_REVIEW_PACKET');assert.equal(h.spawns,0);runner.dispose();r.dispose();cleanup(ws,h)}});
test('P8-007 TEST-017 — incomplete PASS, state injection and unattributed/wrong evidence are rejected',async()=>{for(const alter of [r=>r.criteria=[],r=>r.completed=true,r=>r.validationResultIds=['foreign'],r=>r.scopeAssessment.evidenceRefs=['manifest'],r=>r.reviewedTreeHash='0'.repeat(64)]){const ws=workspace(),p=packet(ws);alter(p.f.ReviewResult);const h=fakeHost({ws,result:p.f.ReviewResult}),reg=reviewer.registerControlledReviewer({events:h.bus},'g'),runner=new reviewer.ControlledReviewerRunner(reg,h.bus,'owner');await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.reviewPacket,p.ctx),e=>e.code==='INVALID_STRUCTURED_OUTPUT');runner.dispose();reg.dispose();cleanup(ws,h)}});
test('P12.2 — real P11 canonical patch is accepted, not confused with Git presentation diff',async()=>{
  const ws=workspace(),p=packet(ws);
  assert.notEqual(p.reviewPacket.diff,git(ws.work,['diff','--binary','--no-ext-diff','HEAD','--']));
  const {output,host}=await execute(ws,p);assert.equal(output.result.verdict,'PASS');assert.equal(host.spawns,1);cleanup(ws,host);
});

test('P12.2 — generation 2 current scope/validation refs dispatch despite retained generation 1 failure',async()=>{
  const ws=workspace();ws.capture=ws.guard.capture(2,'host terminal proof generation 2');const p=packet(ws);
  const old={...p.f.ValidationResult,id:'old-validation',candidateGeneration:1,status:'FAILED',exitCode:1};
  p.ctx.records.push({id:old.id,kind:'ValidationResult',value:old});p.f.WorkflowState.invalidEvidenceIds.push(old.id);
  const {output,host}=await execute(ws,p);assert.equal(output.result.candidateGeneration,2);assert.equal(host.spawns,1);cleanup(ws,host);
});

test('runtime comparison and both event artifacts reach Reviewer; altered before/after evidence is rejected',async()=>{
  const runtime=await import('../src/runtime-observability.ts'),scenarioApi=await import('../src/scenario-management.ts'),ws=workspace(),p=packet(ws);
  const current=p.f.ValidationResult;
  const row={schemaVersion:runtime.RUNTIME_EVENT_SCHEMA,timestamp:'2026-09-30T00:00:00.000Z',source:'fixture',
    eventType:'scenario.failed',severity:'ERROR',correlationId:'check',metrics:{observed:0}};
  const fixedRow={...row,eventType:'scenario.ok',severity:'INFO',metrics:{observed:1}};
  const base={schemaVersion:1,taskId:current.taskId,scenarioId:current.commandId,commandHash:current.commandHash,
    candidateDigest:current.candidateDigest,startedAt:row.timestamp,endedAt:row.timestamp,eventCount:1,redactions:0,complete:true,
    summary:'Scenario observed',importantObservations:['Processo osservato'],metrics:{observed:0}};
  const before={...base,id:'runtime-evidence-before',validationId:'validation-before',eventLogRef:'runtime-events-before',
    candidateGeneration:0,exitCode:1,status:'FAILED',diagnosis:runtime.runtimeDiagnosis('FAILED',[row],true)};
  const after={...base,id:'runtime-evidence-after',validationId:current.id,eventLogRef:'runtime-events-after',
    candidateGeneration:current.candidateGeneration,exitCode:0,status:'PASSED',diagnosis:runtime.runtimeDiagnosis('PASSED',[fixedRow],true)};
  const comparison=runtime.compareRuntimeEvidence(before,[row],after,[fixedRow]),comparisonId='runtime-comparison-after';
  const artifact=(id,content,mediaType='application/json')=>({schemaVersion:1,id,digest:createHash('sha256').update(content).digest('hex'),
    relativeStorePath:`artifacts/${id}`,bytes:Buffer.byteLength(content),mediaType});
  const refs=[artifact(before.id,api.canonicalize(before)),artifact(before.eventLogRef,api.canonicalize(row)+'\n','application/x-ndjson'),
    artifact(after.id,api.canonicalize(after)),artifact(after.eventLogRef,api.canonicalize(fixedRow)+'\n','application/x-ndjson'),
    artifact(comparisonId,api.canonicalize(comparison),'application/vnd.pi-controlled-dev.runtime-comparison+json')];
  const scenario=scenarioApi.createExecutableScenario(p.f.TaskSpec,current.commandId,current.startedAt),scenarioRef=artifact(`scenario-${scenario.scenarioHash.slice(0,24)}`,api.canonicalize(scenario),scenarioApi.SCENARIO_MEDIA_TYPE);
  const run=scenarioApi.createScenarioRun(scenario,current,after,refs[2],refs[3]),runRef=artifact(run.runId,api.canonicalize(run),scenarioApi.SCENARIO_RUN_MEDIA_TYPE);
  const bundle=scenarioApi.createTechnicalEvidenceBundle(scenario,[run],p.f.TaskSpec.acceptanceCriteria,{patchRef:p.f.WorkflowState.candidate.patch.id,extraArtifactRefs:[scenarioRef.id,runRef.id]}),bundleRef=artifact(bundle.bundleId,api.canonicalize(bundle),scenarioApi.EVIDENCE_BUNDLE_MEDIA_TYPE);
  refs.push(scenarioRef,runRef,bundleRef);p.reviewPacket.scenarioEvidence={scenarios:[scenario],runs:[run],bundles:[bundle]};
  p.ctx.records.push(...refs.map(value=>({id:value.id,kind:'ArtifactRef',value})));
  p.f.AssignmentEnvelope.inputArtifactRefs=[...p.f.AssignmentEnvelope.inputArtifactRefs,...refs.map(value=>value.id)];
  p.f.AssignmentEnvelope.assignmentHash=api.hashContract('AssignmentEnvelope',p.f.AssignmentEnvelope);
  p.f.ReviewResult.assignmentHash=p.f.AssignmentEnvelope.assignmentHash;
  p.ctx.records.find(value=>value.id==='assignment').value=p.f.AssignmentEnvelope;
  p.reviewPacket.evidenceRefs=[...p.reviewPacket.evidenceRefs,...refs.map(value=>value.id)];p.reviewPacket.runtimeComparison=comparison;
  let host;
  try{
    ({host}=await execute(ws,p));assert.equal(host.spawns,1);
    p.reviewPacket.runtimeComparison={...comparison,before:{...comparison.before,events:[{...row,eventType:'scenario.ok'}]}};
    const fake=fakeHost({ws,result:p.f.ReviewResult}),reg=reviewer.registerControlledReviewer({events:fake.bus},'g'),runner=new reviewer.ControlledReviewerRunner(reg,fake.bus,'owner');
    try{await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.reviewPacket,p.ctx),error=>error.code==='INVALID_REVIEW_PACKET');assert.equal(fake.spawns,0)}
    finally{runner.dispose();reg.dispose();rmSync(fake.state,{recursive:true,force:true})}
    p.reviewPacket.runtimeComparison=comparison;p.reviewPacket.scenarioEvidence={...p.reviewPacket.scenarioEvidence,runs:[{...run,candidateGeneration:0}]};
    const stale=fakeHost({ws,result:p.f.ReviewResult}),staleReg=reviewer.registerControlledReviewer({events:stale.bus},'stale-scenario'),staleRunner=new reviewer.ControlledReviewerRunner(staleReg,stale.bus,'owner');
    try{await assert.rejects(staleRunner.run(p.f.AssignmentEnvelope,p.reviewPacket,p.ctx),error=>error.code==='INVALID_REVIEW_PACKET');assert.equal(stale.spawns,0)}
    finally{staleRunner.dispose();staleReg.dispose();rmSync(stale.state,{recursive:true,force:true})}
  }finally{cleanup(ws,host)}
});

for(const [label,alter] of [
  ['packet generation N-1',p=>p.reviewPacket.candidateGeneration=1],
  ['candidate digest N-1',p=>p.reviewPacket.candidateDigest='0'.repeat(64)],
  ['validation generation N-1',p=>p.reviewPacket.validationResults=[{...p.f.ValidationResult,candidateGeneration:1}]],
  ['validationResultIds N-1',p=>p.ctx.currentValidationIds=['old-validation']],
  ['scope evidence N-1',p=>p.f.WorkflowState.invalidEvidenceIds.push(p.f.WorkflowState.candidate.manifest.id)],
  ['actual changes evidence N-1',p=>p.f.WorkflowState.invalidEvidenceIds.push(p.f.WorkflowState.candidate.patch.id)],
  ['missing scope evidence',p=>p.reviewPacket.evidenceRefs=p.reviewPacket.evidenceRefs.filter(id=>id!==p.f.WorkflowState.candidate.manifest.id)],
  ['missing actual changes evidence',p=>p.reviewPacket.evidenceRefs=p.reviewPacket.evidenceRefs.filter(id=>id!==p.f.WorkflowState.candidate.patch.id)],
  ['missing validation result',p=>p.ctx.records=p.ctx.records.filter(r=>r.id!=='validation')],
  ['dangling evidence ID',p=>p.ctx.records=p.ctx.records.filter(r=>r.id!=='evidence')],
  ['contradictory duplicate evidence ID',p=>p.ctx.records.push({id:'evidence',kind:'ArtifactRef',value:{...p.f.ArtifactRef,digest:'0'.repeat(64)}})],
  ['handoff bytes not matching artifact',p=>p.reviewPacket.handoff='invented'],
])test(`P12.2 — ${label} fails before Reviewer spawn`,async()=>{
  const ws=workspace();ws.capture=ws.guard.capture(2,'host terminal proof generation 2');const p=packet(ws);alter(p);
  const h=fakeHost({ws,result:p.f.ReviewResult}),reg=reviewer.registerControlledReviewer({events:h.bus},'g'),runner=new reviewer.ControlledReviewerRunner(reg,h.bus,'owner');
  try{await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.reviewPacket,p.ctx));assert.equal(h.spawns,0)}finally{runner.dispose();reg.dispose();cleanup(ws,h)}
});

test('P8-008 TEST-014 — reused Developer run/session and excessive authority are rejected before acceptance',async()=>{const ws=workspace(),p=packet(ws),state=p.ctx.records.find(r=>r.id==='state').value;state.runs[1].childSessionId=state.runs[0].childSessionId;const h=fakeHost({ws,result:p.f.ReviewResult}),reg=reviewer.registerControlledReviewer({events:h.bus},'g'),runner=new reviewer.ControlledReviewerRunner(reg,h.bus,'owner');await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.reviewPacket,p.ctx));runner.dispose();reg.dispose();cleanup(ws,h)});

test('real Reviewer runner forwards durable identity observations before returning a verdict',async()=>{
  const ws=workspace(),p=packet(ws),h=fakeHost({ws,result:p.f.ReviewResult});
  const reg=reviewer.registerControlledReviewer({events:h.bus},'identity-test'),runner=new reviewer.ControlledReviewerRunner(reg,h.bus,'owner'),seen=[];
  try{
    const output=await runner.run(p.f.AssignmentEnvelope,p.reviewPacket,p.ctx,{onDispatchIdentity:v=>seen.push(v)});
    assert.equal(seen.length,3);assert.equal(seen[0].runId,undefined);
    assert.equal(seen[1].runId,output.evidence.runId);assert.equal(seen[2].childSessionId,output.evidence.childSessionId);
    assert.ok(seen.every(v=>v.requestId===output.evidence.requestId));
  }finally{runner.dispose();reg.dispose();cleanup(ws,h)}
});

test('Project Memory is injected by the real Reviewer runner while preserving independent read-only review',async t=>{
 const ws=workspace(),p=packet(ws),host=fakeHost({ws,result:p.f.ReviewResult});t.after(()=>cleanup(ws,host));
 const memory=await memoryForRole(ws.repo,host.state,p.f.AssignmentEnvelope),registration=reviewer.registerControlledReviewer({events:host.bus},'memory-generation'),runner=new reviewer.ControlledReviewerRunner(registration,host.bus,'owner');
 p.f.ReviewResult.memoryProposals=[memory.proposal];
 try{const output=await runner.run(p.f.AssignmentEnvelope,p.reviewPacket,p.ctx,{projectMemory:memory.projectMemory});assert.deepEqual(output.memoryProposals,[memory.proposal]);assert.equal('memoryProposals' in output.result,false);assert.ok(host.tasks[0].endsWith('\n'+memory.selection.text));assert.match(host.tasks[0],/consistency assessment/);assert.ok(memory.receipts.some(r=>r.receipt.delivery==='PROVIDER_ACKNOWLEDGED'))}
 finally{runner.dispose();registration.dispose()}
});

// Native runner and public RPC boundary with a declared provider double.
test('Reviewer accepts ignored local files and newly created parents of authorized source files',async()=>{
 const ws=workspace({nested:true});writeFileSync(join(ws.repo,'.git','info','exclude'),'.env\ncache/\n');writeFileSync(join(ws.repo,'.env'),'PRIVATE_LOCAL_VALUE');mkdirSync(join(ws.repo,'cache'));writeFileSync(join(ws.repo,'cache','local.bin'),'cache');
 const p=packet(ws),{output,host}=await execute(ws,p);assert.equal(output.result.verdict,'PASS');assert.equal(output.evidence.originalWorkspaceUnchanged,true);assert.deepEqual(p.reviewPacket.changedFiles,['allowed.txt','src/new.ts']);cleanup(ws,host);
});

await test('domain profile reaches native Reviewer dispatch without replacing core guidance or authority (provider double)',async t=>{
  const ws=workspace(),{f,ctx,reviewPacket}=packet(ws),host=fakeHost({ws,result:f.ReviewResult});
  const developmentProfile={schemaVersion:1,id:'systemist_factory',common:['Preserve requirement source links'],phases:{Reviewer:['Domain method for Reviewer'],ProjectPlanning:['Planning only marker']}};
  const registration=reviewer.registerControlledReviewer({events:host.bus},'generation');
  t.after(()=>{registration.dispose();cleanup(ws,host)});
  const output=await reviewer.runReviewer(f.AssignmentEnvelope,reviewPacket,{registration,events:host.bus,ownerSessionId:'owner',validationContext:ctx,developmentProfile});
  assert.deepEqual(output.result,f.ReviewResult);
  assert.match(host.tasks[0],/Preserve requirement source links/);assert.match(host.tasks[0],/Domain method for Reviewer/);
  assert.doesNotMatch(host.tasks[0],/Planning only marker/);assert.match(host.tasks[0],/Technical PASS does not establish system requirement compliance/);
  assert.deepEqual(output.evidence.effectiveTools,['read','structured_output']);
});


test('before-spawn Reviewer receipts are authenticated and bound; uncertain emitted spawn never receives one',async()=>{
 const ws=workspace(),p=packet(ws),h=fakeHost({ws,result:p.f.ReviewResult}),registration=reviewer.registerControlledReviewer({events:h.bus},'g'),runner=new reviewer.ControlledReviewerRunner(registration,h.bus,'owner');
 let proof;try{chmodSync(join(ws.work,'outside.txt'),0o755);
   await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.reviewPacket,p.ctx,{onNoDispatchProof:value=>proof=value}),e=>e.code==='REVIEW_WORKSPACE_INVALID'&&e.dispatchOutcome==='NOT_SENT');
   assert.equal(h.spawns,0);assert.equal(reviewer.isAcquiredReviewerNoDispatchProof(proof),true);assert.equal(reviewer.isAcquiredReviewerNoDispatchProof(JSON.parse(JSON.stringify(proof))),false);
   const {verifyReviewerNoDispatchProof}=await import('../src/run-quiescence.ts');
   const r={schemaVersion:1,assignmentId:p.f.AssignmentEnvelope.assignmentId,attemptId:p.f.AssignmentEnvelope.attemptId,role:'Reviewer',requestId:'intent-'+p.f.AssignmentEnvelope.attemptId,ownerSessionId:'owner',status:'NOT_DISPATCHED',dispatchProofRef:'proof'};
   assert.equal(verifyReviewerNoDispatchProof(proof,p.f.AssignmentEnvelope,r),true);
   for(const patch of [{assignmentHash:'0'.repeat(64)},{candidateDigest:'0'.repeat(64)},{candidateGeneration:99},{ownerSessionId:'foreign'},{launchContractHash:'0'.repeat(64)},{legacyProtocol:null},{legacyProtocol:false}])assert.equal(verifyReviewerNoDispatchProof({...proof,...patch},p.f.AssignmentEnvelope,r),false);
 }finally{runner.dispose();registration.dispose();cleanup(ws,h)}
 const ws2=workspace(),p2=packet(ws2),h2=fakeHost({ws:ws2,result:p2.f.ReviewResult,spawnReplyMalformed:true}),reg=reviewer.registerControlledReviewer({events:h2.bus},'g'),run2=new reviewer.ControlledReviewerRunner(reg,h2.bus,'owner');
 let count=0;try{await assert.rejects(run2.run(p2.f.AssignmentEnvelope,p2.reviewPacket,p2.ctx,{onNoDispatchProof:()=>count++}),e=>e.dispatchOutcome==='UNKNOWN');assert.equal(h2.spawns,1);assert.equal(count,0)}finally{run2.dispose();reg.dispose();cleanup(ws2,h2)}
});


test('legacy no-dispatch migration rejects arbitrary JSON and unrelated or already-bound sessions',async()=>{
 const {acquireLegacyReviewerNoDispatchProof,isAcquiredLegacyReviewerProof}=await import('../src/legacy-reviewer-preflight.ts');
 const {recordLegacyReviewerNoDispatchAttempt}=await import('../src/recovery.ts');
 const arbitrary={schemaVersion:1,source:'reviewer-host-before-spawn',legacyProtocol:{method:'FROZEN_FULL_MANIFEST_REQUEST_LIMIT'}};
 assert.equal(isAcquiredLegacyReviewerProof(arbitrary),false);
 assert.throws(()=>recordLegacyReviewerNoDispatchAttempt('/not-selected-data','/not-selected-store','operator',arbitrary),/RECONCILIATION_PROOF_INVALID/);
 assert.throws(()=>acquireLegacyReviewerNoDispatchProof({storeRoot:'/not-selected-store',installedRoot:'/not-selected-package',bridgePath:'/not-selected-bridge',originalHostPid:process.pid,sessionFile:'/not-selected-session',terminalEventsPath:'/not-selected-events'}),/LEGACY_REVIEWER_NO_DISPATCH_UNPROVEN/);
});
