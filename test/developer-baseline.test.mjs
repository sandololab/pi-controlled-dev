import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {installSourceLoader} from './load-source.mjs';
import {fixtures} from './contract-fixtures.mjs';
installSourceLoader();
const api=await import('../src/contracts.ts'),{DurableStore}=await import('../src/store.ts');
const {compileValidations}=await import('../src/validation-proposals.ts');
const {captureDeveloperBaseline,developerBaselineDispatch,createReviewerBaselineContext,reviewerBaselineDispatch}=await import('../src/developer-baseline.ts');
const {workspaceManifest}=await import('../src/scope-guard.ts');
const {runApprovedValidation,verifyValidationProcessProof}=await import('../src/validation-runner.ts');
const {createAssignment}=await import('../src/orchestrator.ts');
const {inventoryHash,inventoryTree}=await import('../src/controlled-agent-runtime.ts');
const git=(root,...argv)=>execFileSync('git',['-C',root,...argv],{encoding:'utf8'}).trim();
function setup(t,{source='def test_value():\n    import helper\n    assert helper.VALUE == 1\n',missing=false,config='[tool.pytest.ini_options]\npythonpath=["."]\n'}={}){
 const root=mkdtempSync(join(tmpdir(),'developer-baseline-')),repo=join(root,'repo'),data=join(root,'profile'),work=join(data,'work');mkdirSync(repo);mkdirSync(data);t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(repo,'tests'));writeFileSync(join(repo,'helper.py'),'VALUE = 1\n');writeFileSync(join(repo,'pyproject.toml'),config);if(!missing)writeFileSync(join(repo,'tests/test_value.py'),source);
 git(repo,'init','-q');git(repo,'add','.');git(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','baseline');const baseCommit=git(repo,'rev-parse','HEAD');git(repo,'worktree','add','--quiet','--detach',work,baseCommit);
 const store=DurableStore.create(data,repo,'task',()=> 'ACCEPT'),f=fixtures(api),input=store.put('source','input','text/plain');
 const commands=compileValidations({validationPlan:[{kind:'CANDIDATE_TEST',mechanism:'PYTEST',configPath:'pyproject.toml',paths:['tests/test_value.py'],expectedLines:[]}]},name=>({git:'/usr/bin/git',python3:'/usr/bin/python3'})[name]);
 const spec={...f.TaskSpec,scope:{...f.TaskSpec.scope,repoRoot:repo,allowedPaths:['helper.py','tests/test_value.py']},plan:{...f.InputSource,snapshot:input},currentTask:{...f.InputSource,snapshot:input},validationCommands:commands,
 acceptanceCriteria:[{...f.Criterion,commandIds:[commands[1].id]}]};spec.specHash=api.hashContract('TaskSpec',spec);
 const state={...f.WorkflowState,state:'READY',repoRoot:repo,baselineCommit:baseCommit,spec:store.writeSpec(spec),specHash:spec.specHash};return{root,repo,data,work,baseCommit,store,spec,state};
}
function packet(f,evidence){return createAssignment(f.spec,f.state,'Developer',{workRoot:f.work,inputArtifactRefs:evidence.evidenceRefs})}
function stored(f,capture){return JSON.parse(Buffer.from(f.store.read(capture.evidence.packageRef)).toString('utf8'))}
test('native host runs existing candidate tests before editing with real commit, process evidence and an unchanged complete inventory',t=>{
 const f=setup(t),before=inventoryHash(inventoryTree(f.work)),original=inventoryHash(inventoryTree(f.repo)),state=api.canonicalize(f.state);
 const captured=captureDeveloperBaseline(f.spec,f.state,f.work,f.store),p=stored(f,captured);assert.equal(captured.passed,true);assert.equal(captured.complete,true);
 assert.equal(p.phase,'PRE_IMPLEMENTATION');assert.equal(p.baseCommit,f.baseCommit);assert.equal(p.workRoot,f.work);assert.ok(p.checks.every(c=>c.status==='PASSED'));
 for(const check of p.checks){const proof=JSON.parse(Buffer.from(f.store.read(captured.artifacts.find(r=>r.id===check.processProofRef))).toString('utf8'));assert.ok(proof.pid>0);assert.equal(proof.cwd,f.work);assert.equal(proof.exitCode,0);assert.equal(proof.candidateGeneration,0)}
 assert.equal(api.canonicalize(f.state),state);assert.deepEqual(f.state.validations,[]);assert.equal(inventoryHash(inventoryTree(f.work)),before);assert.equal(inventoryHash(inventoryTree(f.repo)),original);
 assert.match(developerBaselineDispatch(captured.evidence,packet(f,captured.evidence)),/run by the host.*BEFORE/);assert.match(developerBaselineDispatch(captured.evidence,packet(f,captured.evidence)),/leave commandsRun empty/);
});
test('ordinary failure, skipped-only and empty Python suites never produce a successful initial check',t=>{
 for(const source of ['def test_bad():\n    assert False\n','import pytest\n@pytest.mark.skip(reason="missing device")\ndef test_skip():\n    pass\n','VALUE = 1\n']){
  const f=setup(t,{source}),captured=captureDeveloperBaseline(f.spec,f.state,f.work,f.store);assert.equal(captured.passed,false);assert.equal(stored(f,captured).checks.at(-1).status,'FAILED');assert.deepEqual(f.state.validations,[]);assert.throws(()=>developerBaselineDispatch(captured.evidence,packet(f,captured.evidence)),/DEVELOPER_BASELINE_FAILED/);
 }
});
test('prospective missing tests/config are explicitly deferred; existing aliases are rejected',t=>{
 const f=setup(t,{missing:true}),captured=captureDeveloperBaseline(f.spec,f.state,f.work,f.store);assert.equal(stored(f,captured).checks[1].status,'DEFERRED');assert.match(developerBaselineDispatch(captured.evidence,packet(f,captured.evidence)),/never PASS/);
 const unconfigured=setup(t,{config:'[project]\nname="fixture"\n'}),pending=captureDeveloperBaseline(unconfigured.spec,unconfigured.state,unconfigured.work,unconfigured.store);assert.equal(stored(unconfigured,pending).checks[1].status,'DEFERRED');
 mkdirSync(join(f.work,'tests'));symlinkSync(join(f.work,'helper.py'),join(f.work,'tests','test_value.py'));assert.throws(()=>captureDeveloperBaseline(f.spec,f.state,f.work,f.store),/DEVELOPER_BASELINE_PATH_INVALID/);
});
test('copied evidence, foreign assignment, absent input reference, changed source and changed stored proof fail before delivery',t=>{
 const f=setup(t),captured=captureDeveloperBaseline(f.spec,f.state,f.work,f.store),assignment=packet(f,captured.evidence);
 assert.throws(()=>developerBaselineDispatch({...captured.evidence},assignment),/DEVELOPER_BASELINE_INVALID/);
 for(const patch of [{workRoot:f.data},{inputArtifactRefs:[]},{baseCommit:'a'.repeat(40)}]){const other={...assignment,...patch};other.assignmentHash=api.hashContract('AssignmentEnvelope',other);assert.throws(()=>developerBaselineDispatch(captured.evidence,other),/DEVELOPER_BASELINE_INVALID/)}
 writeFileSync(join(f.work,'helper.py'),'VALUE = 2\n');assert.throws(()=>developerBaselineDispatch(captured.evidence,assignment),/DEVELOPER_BASELINE_WORKSPACE_CHANGED/);
 writeFileSync(join(f.work,'helper.py'),'VALUE = 1\n');const proofPath=join(f.store.root,captured.evidence.packageRef.relativeStorePath);chmodSync(proofPath,0o600);writeFileSync(proofPath,'{}');assert.throws(()=>developerBaselineDispatch(captured.evidence,assignment),/STORE_ARTIFACT_INTEGRITY/);
});
test('test-induced writes are preserved for diagnosis and prevent a valid initial handoff',t=>{
 const f=setup(t,{source:'from pathlib import Path\ndef test_mutates():\n    Path("helper.py").write_text("VALUE = 999\\n")\n'});assert.throws(()=>captureDeveloperBaseline(f.spec,f.state,f.work,f.store),/DEVELOPER_BASELINE_WORKSPACE_CHANGED/);assert.equal(readFileSync(join(f.work,'helper.py'),'utf8'),'VALUE = 999\n');assert.equal(readFileSync(join(f.repo,'helper.py'),'utf8'),'VALUE = 1\n');assert.deepEqual(f.state.validations,[]);
});
test('post-change validation uses a new real process and candidate generation; initial PASS cannot satisfy its proof',t=>{
 const f=setup(t),before=captureDeveloperBaseline(f.spec,f.state,f.work,f.store),pre=stored(f,before).checks[1],initial=JSON.parse(Buffer.from(f.store.read(pre.resultRef)).toString('utf8'));
 writeFileSync(join(f.work,'helper.py'),'# changed implementation\nVALUE = 1\n');const manifest=workspaceManifest(f.work,f.baseCommit),base=fixtures(api).Candidate;
 const candidate={...base,root:f.work,baseCommit:f.baseCommit,digest:api.hashCanonical(manifest),generation:1,manifest:f.store.put('after-manifest',api.canonicalize(manifest)),patch:f.store.put('after-patch','{}')};const state={...f.state,state:'TESTING',candidate};
 const after=runApprovedValidation(f.spec,state,f.spec.validationCommands[1].id,f.store);assert.equal(after.result.status,'PASSED');assert.notEqual(after.result.id,initial.id);assert.notEqual(after.result.processProofRef,initial.processProofRef);assert.equal(after.result.candidateGeneration,1);assert.notEqual(after.result.candidateDigest,initial.candidateDigest);
 const proof=JSON.parse(Buffer.from(f.store.read(before.artifacts.find(r=>r.id===initial.processProofRef))).toString('utf8')),log=f.store.read(before.artifacts.find(r=>r.id===initial.logRef));assert.equal(verifyValidationProcessProof(proof,initial,state,log),false);
});
test('durable workflow delivers genuine baseline evidence before Developer dispatch and keeps post-validation separate',async t=>{
 const {restartFixture}=await import('./recovery-fixture.mjs'),{LockManager}=await import('../src/lock-manager.ts');
 const root=mkdtempSync(join(tmpdir(),'developer-baseline-workflow-'));t.after(()=>rmSync(root,{recursive:true,force:true}));let seen=false,reviewSeen=false,report;
 try{
  report=await restartFixture(root,'FINAL_GATE',false,false,{},async({repo,spec})=>{
   writeFileSync(join(repo,'pyproject.toml'),'[tool.pytest.ini_options]\naddopts = \"-s\"\n');mkdirSync(join(repo,'tests'));writeFileSync(join(repo,'tests/test_initial.py'),'def test_initial():\n    import warnings\n    warnings.warn(\"x\" * 20000)\n    assert 1 + 1 == 2\n');git(repo,'add','.');git(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','existing tests');
   spec.validationCommands=compileValidations({validationPlan:[{kind:'CANDIDATE_TEST',mechanism:'PYTEST',configPath:'pyproject.toml',paths:['tests/test_initial.py'],expectedLines:[]}]},name=>({git:'/usr/bin/git',python3:'/usr/bin/python3'})[name]);spec.acceptanceCriteria=spec.acceptanceCriteria.map(c=>({...c,commandIds:[spec.validationCommands[1].id]}));spec.specHash=api.hashContract('TaskSpec',spec);return{};
  },{onRoleDispatch(assignment,options){if(assignment.role==='Reviewer'){reviewSeen=true;assert.ok(options.baselineContext);assert.match(reviewerBaselineDispatch(options.baselineContext,assignment,{candidateDigest:assignment.candidateDigest,candidateGeneration:assignment.candidateGeneration,evidenceRefs:assignment.inputArtifactRefs}),/PRE_IMPLEMENTATION[\s\S]*POST_IMPLEMENTATION/);return}if(assignment.role!=='Developer')return;seen=true;assert.ok(options.baselineEvidence);assert.match(developerBaselineDispatch(options.baselineEvidence,assignment),/Actual commit:/);assert.ok(assignment.inputArtifactRefs.includes(options.baselineEvidence.packageRef.id));assert.equal(readFileSync(join(assignment.workRoot,'file.txt'),'utf8'),'base\n')}});
  const ledger=DurableStore.load(report.storeRoot),packs=ledger.records.filter(r=>r.kind==='ArtifactRef'&&r.value.mediaType==='application/vnd.pi-controlled-dev.developer-baseline+json');assert.equal(seen,true);assert.equal(reviewSeen,true);assert.equal(packs.length,1);
  const payload=JSON.parse(readFileSync(join(report.storeRoot,packs[0].value.relativeStorePath),'utf8'));assert.ok(payload.checks.every(c=>c.status==='PASSED'));assert.equal(payload.phase,'PRE_IMPLEMENTATION');
  assert.equal(ledger.state.counters.dispatches,3);assert.equal(ledger.state.counters.infrastructureRetries,0);
  const spec=ledger.records.find(r=>r.kind==='TaskSpec'&&r.value.specHash===ledger.state.specHash).value;
  // Rebuild after a durable reload, without the original capture WeakMap.
  const reopened={read(ref){return DurableStore.readArtifact(report.storeRoot,ref)}},delivery=createReviewerBaselineContext(spec,ledger.state,ledger.records,reopened);
  const reviewer=ledger.records.find(r=>r.kind==='AssignmentEnvelope'&&r.value.role==='Reviewer').value,capture=report.orchestrator.candidateCapture;
  const reviewPacket=report.orchestrator.buildReviewPacket(reviewer,{candidateManifest:capture.manifest,diff:capture.patch,changedFiles:capture.changedFiles,handoff:capture.handoff,residualRisks:[],evidenceRefs:['source']});
  assert.ok(reviewPacket.evidenceRefs.includes(packs[0].id));assert.ok(reviewPacket.validationResults.every(r=>r.candidateGeneration===1));
  const text=reviewerBaselineDispatch(delivery,reviewer,reviewPacket);assert.match(text,/BEFORE[\s\S]*generation 1/);assert.match(text,/PRE log previews/);assert.ok(Buffer.byteLength(text)<16384);assert.ok(payload.checks.some(c=>c.logRef&&reopened.read(ledger.records.find(r=>r.id===c.logRef).value).byteLength>20000));
  assert.throws(()=>reviewerBaselineDispatch({...delivery},reviewer,reviewPacket),/DEVELOPER_BASELINE_INVALID/);
  assert.throws(()=>reviewerBaselineDispatch(delivery,reviewer,{...reviewPacket,evidenceRefs:reviewPacket.evidenceRefs.filter(id=>id!==packs[0].id)}),/DEVELOPER_BASELINE_INVALID/);
  for(const delta of [{candidateDigest:'a'.repeat(64)},{workRoot:report.data},{specHash:'b'.repeat(64)}]){const foreign={...reviewer,...delta};foreign.assignmentHash=api.hashContract('AssignmentEnvelope',foreign);assert.throws(()=>reviewerBaselineDispatch(delivery,foreign,reviewPacket),/DEVELOPER_BASELINE_INVALID/)}
  const changedRecords=ledger.records.map(r=>r.kind==='AssignmentEnvelope'&&r.value.role==='Developer'?{...r,value:{...r.value,inputArtifactRefs:[]}}:r);
  assert.throws(()=>createReviewerBaselineContext(spec,ledger.state,changedRecords,reopened),/DEVELOPER_BASELINE_INVALID/);
  assert.throws(()=>createReviewerBaselineContext(spec,{...ledger.state,invalidEvidenceIds:[...ledger.state.invalidEvidenceIds,packs[0].id]},ledger.records,reopened),/DEVELOPER_BASELINE_INVALID/);

  for(const id of ledger.state.validations){const result=ledger.records.find(r=>r.id===id).value;assert.equal(result.candidateGeneration,1);assert.ok(!payload.checks.some(c=>c.resultRef.id===id));assert.notEqual(result.processProofRef,payload.checks.find(c=>c.commandId===result.commandId).processProofRef)}
 }finally{if(report)new LockManager(report.data,report.locks.workspace.record.ownerSessionId,report.locks.workspace.record.runtimeGeneration).releaseAll(report.locks)}
});
test('a failed initial host test blocks the durable workflow before any Developer attempt',async t=>{
 const {restartFixture}=await import('./recovery-fixture.mjs'),{LockManager}=await import('../src/lock-manager.ts');const root=mkdtempSync(join(tmpdir(),'developer-baseline-failure-'));t.after(()=>rmSync(root,{recursive:true,force:true}));let seen=false,report;
 try{
  report=await restartFixture(root,'DEVELOPER_BOUNDED',false,false,undefined,async({repo,spec})=>{
   writeFileSync(join(repo,'pyproject.toml'),'[tool.pytest.ini_options]\n');mkdirSync(join(repo,'tests'));writeFileSync(join(repo,'tests/test_initial.py'),'def test_failure():\n    assert False\n');git(repo,'add','.');git(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','failing baseline test');
   spec.validationCommands=compileValidations({validationPlan:[{kind:'CANDIDATE_TEST',mechanism:'PYTEST',configPath:'pyproject.toml',paths:['tests/test_initial.py'],expectedLines:[]}]},name=>({git:'/usr/bin/git',python3:'/usr/bin/python3'})[name]);spec.acceptanceCriteria=spec.acceptanceCriteria.map(c=>({...c,commandIds:[spec.validationCommands[1].id]}));spec.specHash=api.hashContract('TaskSpec',spec);return{};
  },{onRoleDispatch(a){if(a.role==='Developer')seen=true}});
  const ledger=DurableStore.load(report.storeRoot);assert.equal(seen,false);assert.equal(ledger.state.state,'BLOCKED');assert.match(ledger.state.blockedReason,/Initial host verification did not pass/);assert.equal(ledger.state.counters.attempts,1);assert.equal(ledger.state.counters.dispatches,1);assert.equal(ledger.state.counters.infrastructureRetries,0);assert.equal(ledger.state.runs.some(r=>r.role==='Developer'),false);assert.equal(ledger.state.candidate,undefined);assert.deepEqual(ledger.state.validations,[]);
  const p=ledger.records.find(r=>r.kind==='ArtifactRef'&&r.value.mediaType==='application/vnd.pi-controlled-dev.developer-baseline+json');assert.ok(p);assert.equal(JSON.parse(readFileSync(join(report.storeRoot,p.value.relativeStorePath),'utf8')).checks.at(-1).status,'FAILED');
 }finally{if(report)new LockManager(report.data,report.locks.workspace.record.ownerSessionId,report.locks.workspace.record.runtimeGeneration).releaseAll(report.locks)}
});
