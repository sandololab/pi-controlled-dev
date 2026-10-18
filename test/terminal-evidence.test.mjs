import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSourceLoader } from './load-source.mjs';
import { fixtures } from './contract-fixtures.mjs';
installSourceLoader();
const api=await import('../src/contracts.ts');
const { RpcAdapter, verifyTerminalProof, isAcquiredTerminalProof }=await import('../src/pi-subagents-rpc.ts');
const { DurableStore }=await import('../src/store.ts');
const { ScopeGuard }=await import('../src/scope-guard.ts');
const { runApprovedValidation, verifyValidationProcessProof }=await import('../src/validation-runner.ts');
const { buildCompletionPackage, verifyCompletionPackage }=await import('../src/completion-package.ts');
const REQUEST='subagents:rpc:v1:request',EVENT='subagent:async-complete';
const env={sessionId:'owner',environmentHash:'a'.repeat(64),piVersion:'fixture',subagentsVersion:'fixture'};
// Public transport double only. Real process proofs are separately required by terminal-host-probe.ts.
class Bus {
  listeners=new Map();requests=[];capability={version:1,lifecycleArtifactVersion:3};state='complete';proof;
  constructor(role='Developer',suffix=''){
    this.role=role;this.agent=`controlled.${role.toLowerCase()}`;this.runId=`run-${role}${suffix}`;this.childSession=`/child-${role}${suffix}`;
    this.proof={version:1,state:'observed',runId:this.runId,runnerProcessInstanceId:'instance',observedAt:1,
      instances:[{kind:'runner',processInstanceId:'instance',closeObservedAt:1,exitCode:0,signal:null}],resumeDisposition:'resumable'};
  }
  on(name,fn){const list=this.listeners.get(name)??new Set();list.add(fn);this.listeners.set(name,list);return()=>list.delete(fn)}
  emit(name,data){
    if(name!==REQUEST){for(const fn of this.listeners.get(name)??[])fn(data);return}
    this.requests.push(data);
    const value=data.method==='ping'?{version:1,methods:['ping','spawn','status','interrupt','stop','resume'],session:{sessionId:'owner',sessionFile:null},
      events:{asyncComplete:EVENT},capabilities:{asyncSpawn:true,status:true,interrupt:true,stop:true,resume:true,...(this.capability?{processTerminalProof:this.capability}:{})}}
      :data.method==='spawn'?{details:{asyncId:this.runId,runId:this.runId}}:{details:{lifecycleStatus:{processTerminal:this.proof}},
        asyncSnapshot:{version:1,kind:'pi-subagents.async-status-snapshot',runs:[{id:this.runId,state:this.state}]}};
    this.emit(`subagents:rpc:v1:reply:${data.requestId}`,{version:1,requestId:data.requestId,success:true,data:value});
  }
  complete(){this.emit(EVENT,{id:this.runId,runId:this.runId,sessionId:'owner',state:'complete',success:true,exitCode:0,
    results:[{agent:this.agent,context:'fresh',sessionFile:this.childSession,status:'completed',success:true}]})}
}
async function launched(t,bus=new Bus()){
  const rpc=new RpcAdapter(bus,env);t.after(()=>rpc.dispose());assert.equal((await rpc.handshake()).status,'VERIFIED');
  const spawned=await rpc.spawn({agent:bus.agent,task:'Bounded transport fixture',cwd:'/',timeoutMs:1000,outputSchema:{type:'object',additionalProperties:false}});
  assert.equal(spawned.ok,true);bus.complete();return {rpc,bus,binding:spawned.value};
}
test('P14B capability detection rejects absent/unsupported proof capability',async t=>{
  for(const capability of [undefined,{version:2,lifecycleArtifactVersion:3},{version:1,lifecycleArtifactVersion:2}]){
    const bus=new Bus();bus.capability=capability;const {rpc}=await launched(t,bus);
    assert.equal((await rpc.acquireTerminalProof(bus.runId)).error.code,'TERMINAL_PROOF_CAPABILITY_UNAVAILABLE');
    assert.equal(bus.requests.some(r=>r.method==='status'),false);
  }
});
test('P14B targeted process-terminal proof is independent of missing/invalid structured result',async t=>{
  const {rpc,bus}=await launched(t);assert.equal(rpc.acquire(bus.runId,()=>({ok:false})).error.code,'MISSING_STRUCTURED_OUTPUT');
  const result=await rpc.acquireTerminalProof(bus.runId);assert.equal(result.ok,true);assert.equal(isAcquiredTerminalProof(result.value),true);
  assert.equal(isAcquiredTerminalProof(structuredClone(result.value)),false);
  assert.equal(bus.requests.at(-1).params.id,bus.runId);
  let observed=false;await assert.rejects(()=>rpc.withTerminalProof(bus.runId,Promise.reject(new Error('INVALID_RESULT')),()=>{observed=true}),/INVALID_RESULT/);
  assert.equal(observed,true);
});
test('P14B missing/unknown proof and RUNNING/PAUSED/UNKNOWN status do not establish quiescence',async t=>{
  for(const state of ['running','paused','UNKNOWN']){const bus=new Bus();bus.state=state;const {rpc}=await launched(t,bus);
    assert.equal((await rpc.acquireTerminalProof(bus.runId)).error.code,'TERMINAL_PROOF_UNAVAILABLE');}
  for(const proof of [undefined,{version:1,state:'unknown'}]){const bus=new Bus();bus.proof=proof;const {rpc}=await launched(t,bus);
    assert.equal((await rpc.acquireTerminalProof(bus.runId)).ok,false);}
});
test('P14B wrong run, role, session and invented process fields fail binding',async t=>{
  const {rpc,bus,binding}=await launched(t);const proof=(await rpc.acquireTerminalProof(bus.runId)).value;
  const expected={runId:binding.runId,role:'Developer',requestId:binding.requestId,ownerSessionId:'owner'};
  assert.equal(verifyTerminalProof(proof,expected),true);
  for(const patch of [{runId:'wrong'},{role:'Reviewer'},{ownerSessionId:'foreign'},{requestId:'wrong'}])assert.equal(verifyTerminalProof(proof,{...expected,...patch}),false);
  assert.equal(verifyTerminalProof({...proof,pid:123},expected),false);
  const unproven=structuredClone(proof);unproven.provider.instances[0].exitCode=null;
  assert.equal(verifyTerminalProof(unproven,expected),false);
  bus.proof.runId='wrong';assert.equal((await rpc.acquireTerminalProof(bus.runId)).error.code,'TERMINAL_PROOF_BINDING_INVALID');
});
test('P14B selective proof projection excludes secret/unrelated fields and full transcripts',async t=>{
  const {rpc,bus}=await launched(t);bus.proof.secret='SYNTHETIC_SECRET';bus.proof.transcript='FULL_TRANSCRIPT';
  const proof=(await rpc.acquireTerminalProof(bus.runId)).value;assert.doesNotMatch(JSON.stringify(proof),/SYNTHETIC_SECRET|FULL_TRANSCRIPT/);
});
async function bundle(t){
  const root=mkdtempSync(join(tmpdir(),'terminal-bundle-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const repo=join(root,'repo'),work=join(root,'work'),data=join(root,'data');mkdirSync(repo);mkdirSync(data);
  const git=(path,...args)=>execFileSync('git',['-C',path,...args],{encoding:'utf8'}).trim();
  writeFileSync(join(repo,'file.txt'),'before\n');git(repo,'init','-q');git(repo,'add','.');git(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base');
  const base=git(repo,'rev-parse','HEAD');git(repo,'worktree','add','--quiet','--detach',work,base);
  const store=DurableStore.create(data,repo,'task',()=> 'ACCEPT'),f=fixtures(api),records=[];
  const add=(id,kind,value)=>{if(kind!=='ArtifactRef')store.put(id,api.canonicalize(value));records.push({id,kind,value});return value};
  const source=store.put('source','input','text/plain');add(source.id,'ArtifactRef',source);
  const spec={...f.TaskSpec,scope:{...f.ScopeSpec,repoRoot:repo},plan:{...f.InputSource,snapshot:source},currentTask:{...f.InputSource,snapshot:source},
    validationCommands:[{...f.CommandSpec,executable:process.execPath,argv:['-e',"if(require('node:fs').readFileSync('file.txt','utf8')!=='after\\n')process.exit(1)"]}]};
  spec.specHash=api.hashContract('TaskSpec',spec);const specRef=store.writeSpec(spec);add('spec','TaskSpec',spec);
  const scout=await launched(t,new Bus('Scout')),dev=await launched(t),rev=await launched(t,new Bus('Reviewer'));
  const sp=(await scout.rpc.acquireTerminalProof(scout.bus.runId)).value,dp=(await dev.rpc.acquireTerminalProof(dev.bus.runId)).value,rp=(await rev.rpc.acquireTerminalProof(rev.bus.runId)).value;
  const guard=ScopeGuard.open(spec.scope,work,base);writeFileSync(join(work,'file.txt'),'after\n');const capture=guard.capture(1,api.canonicalize(dp));
  const candidate={...capture.candidate};
  for(const [key,content] of [['manifest',api.canonicalize(capture.manifest)],['patch',capture.patch],['handoff',capture.handoff],['terminalProof',api.canonicalize(dp)]]){
    const ref=candidate[key];candidate[key]=store.put(ref.id,content,ref.mediaType);add(ref.id,'ArtifactRef',candidate[key]);
  }
  const reviewerProof=store.put('reviewer-proof',api.canonicalize(rp));add(reviewerProof.id,'ArtifactRef',reviewerProof);
  const scoutProof=store.put('scout-proof',api.canonicalize(sp));add(scoutProof.id,'ArtifactRef',scoutProof);
  const scoutInput=store.put('scout-input',readFileSync(join(repo,'file.txt')),'text/plain');add(scoutInput.id,'ArtifactRef',scoutInput);
  const assignment=role=>{const a={...f.AssignmentEnvelope,assignmentId:`assignment-${role}`,attemptId:`attempt-${role}`,role,specHash:spec.specHash,
    repoRoot:repo,workRoot:work,baseCommit:base,requirements:spec.requirements,acceptanceCriteria:spec.acceptanceCriteria,validationCommands:spec.validationCommands,
    authority:role==='Scout'?['OP-01']:role==='Reviewer'?['OP-01','OP-07']:['OP-01','OP-02'],inputArtifactRefs:role==='Scout'?['source',scoutInput.id]:['source'],
    ...(role==='Reviewer'?{candidateDigest:candidate.digest,candidateGeneration:1}:{})};a.assignmentHash=api.hashContract('AssignmentEnvelope',a);add(a.assignmentId,'AssignmentEnvelope',a);return a};
  const sa=assignment('Scout'),da=assignment('Developer'),ra=assignment('Reviewer');
  const run=(a,p,ref,resultRef)=>({...f.RunRecord,assignmentId:a.assignmentId,attemptId:a.attemptId,role:a.role,requestId:p.requestId,runId:p.runId,
    childSessionId:p.childSessionId,terminalProofRef:ref.id,...(resultRef?{resultRef}:{})});
  const state={...f.WorkflowState,revision:1,state:'TESTING',spec:specRef,specHash:spec.specHash,repoRoot:repo,baselineRef:'HEAD',baselineCommit:base,candidate,
    runs:[run(sa,sp,scoutProof,'scout'),run(da,dp,candidate.terminalProof,'developer'),run(ra,rp,reviewerProof,'review')],counters:{...f.Counters,attempts:3,dispatches:3}};
  const envelope=a=>({taskId:'task',assignmentId:a.assignmentId,attemptId:a.attemptId,specHash:spec.specHash,assignmentHash:a.assignmentHash,evidenceRefs:['source']});
  const scoutResult={...f.ScoutResult,...envelope(sa),evidenceRefs:['source',scoutInput.id],observations:[{schemaVersion:1,id:'initial-file',text:`Original file.txt contains ${JSON.stringify(readFileSync(join(repo,'file.txt'),'utf8'))}; the approved check requires after.`,evidenceRefs:[scoutInput.id]}],
    relevantFiles:['file.txt'],risks:[],ambiguities:[],recommendedScope:spec.scope};
  add('scout','ScoutResult',scoutResult);
  const scoutCheck=api.validateContract('ScoutResult',scoutResult,{records,specId:'spec',assignmentId:sa.assignmentId,stateId:'unit-state',modelExtracted:false});
  assert.equal(scoutCheck.ok,true,JSON.stringify(scoutCheck));
  const developer={...f.DeveloperResult,...envelope(da),tests:[],commandsRun:[]};add('developer','DeveloperResult',developer);
  const validation=runApprovedValidation(spec,state,'check',store);for(const ref of validation.artifacts)add(ref.id,'ArtifactRef',ref);
  add(validation.result.id,'ValidationResult',validation.result);state.validations=[validation.result.id];
  const assessment={schemaVersion:1,status:'PASS',evidenceRefs:['source'],reason:'Unit fixture assessment; real Reviewer tested separately'};
  const review={...f.ReviewResult,...envelope(ra),reviewedTreeHash:candidate.digest,candidateGeneration:1,criteria:[{schemaVersion:1,criterionId:'criterion',assessment}],
    scopeAssessment:assessment,testAssessment:assessment,actualChangesAssessment:assessment,validationResultIds:state.validations};
  add('review','ReviewResult',review);state.state='REVIEWING';state.results=['scout','developer','review'];state.reviews=['review'];
  assert.equal(api.validateStructure('WorkflowState',state).ok,true,JSON.stringify(api.validateStructure('WorkflowState',state)));
  const check=api.validateContract('TaskSpec',spec,{records:[...records,{id:'unit-state',kind:'WorkflowState',value:state}],specId:'spec',stateId:'unit-state',modelExtracted:false});
  assert.equal(check.ok,true,JSON.stringify(check));
  const packet=buildCompletionPackage(state,records,store);return {root,store,state,records,packet,spec,validation,add};
}
async function readyGateWorkflow(t,beforeImplementation=false,taskId='task',reviewFailure=false,stopAnalyzing=false,exhausted=false,reviewRisks=[],scoutRisks=[],forbiddenFile=false,reviewOnly=false,failFirstValidation=false,reviewPacketObserver=()=>{},traceResidue=false,maxInfrastructureRetries=1){
  const {CentralOrchestrator,registeredRoleDispatchers}=await import('../src/orchestrator.ts');
  const root=mkdtempSync(join(tmpdir(),'gate-wiring-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const repo=join(root,'repo'),work=join(root,'work'),data=join(root,'data');mkdirSync(repo);mkdirSync(data);
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
  writeFileSync(join(repo,'file.txt'),'before\n');if(forbiddenFile)writeFileSync(join(repo,'forbidden.txt'),'protected\n');git('init','-q');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base');
  const base=git('rev-parse','HEAD');git('worktree','add','--quiet','--detach',work,base);
  const store=DurableStore.create(data,repo,taskId,()=> 'ACCEPT'),f=fixtures(api),source=store.put('source','input','text/plain');
  const spec={...f.TaskSpec,taskId,scope:{...f.ScopeSpec,repoRoot:repo},plan:{...f.InputSource,snapshot:source},currentTask:{...f.InputSource,snapshot:source},
    ...(reviewOnly?{acceptanceCriteria:f.TaskSpec.acceptanceCriteria.map(c=>({...c,method:'REVIEW',commandIds:[]}))}:{}),
    humanGates:{...f.TaskSpec.humanGates,beforeImplementation,beforeCompletion:true},
    retryPolicy:{...f.TaskSpec.retryPolicy,maxInfrastructureRetries,...(exhausted?{maxReworkAttempts:0}:{})},
    validationCommands:[{...f.CommandSpec,executable:process.execPath,argv:['-e',traceResidue?
      "if(!require('node:fs').readFileSync('file.txt','utf8').startsWith('after\\n'))process.exit(1)":
      "if(require('node:fs').readFileSync('file.txt','utf8')!=='after\\n')process.exit(1)"]}]};
  spec.specHash=api.hashContract('TaskSpec',spec);
  const output=async(a,result,options)=>{
    const {rpc,bus}=await launched(t,new Bus(a.role,a.assignmentId));const proof=(await rpc.acquireTerminalProof(bus.runId)).value;
    options.onTerminalProof(proof);
    return {result:{...result,taskId:a.taskId,assignmentId:a.assignmentId,attemptId:a.attemptId,role:a.role,specHash:a.specHash,assignmentHash:a.assignmentHash,evidenceRefs:['source']},
      evidence:{runId:proof.runId,requestId:proof.requestId,childSessionId:proof.childSessionId,ownerSessionId:'owner',runtimeGeneration:'fixture',
        launchContractHash:a.launchContractHash,effectiveTools:[],invokedTools:[],context:'fresh',source:'operational-runtime-registration'}};
  };
  const doubles={
    oracle:(a,p,c,options)=>output(a,{...f.OracleResult,escalationId:p.escalationId,needsHumanDecision:true},options),
    scout:(a,c,options)=>output(a,{...f.ScoutResult,observations:[],risks:scoutRisks,ambiguities:[],recommendedScope:spec.scope},options),
    developer:(a,c,options)=>{writeFileSync(join(a.workRoot,'file.txt'),failFirstValidation&&!options.reworkBase?'wrong\n':traceResidue?'after\nCONTROLLED_DEV_TEMP_TRACE\n':'after\n');return output(a,{...f.DeveloperResult,tests:[],commandsRun:[],residualRisks:[{schemaVersion:1,id:'host-validation-pending',text:'Host validation pending at handoff',criterionIds:['criterion'],blocking:false}]},options)},
    reviewer:async(a,p,c,options)=>{reviewPacketObserver(p);const assessment={schemaVersion:1,status:'PASS',evidenceRefs:['source'],reason:'Host double, not human evidence'},
      behavior=typeof reviewFailure==='function'?reviewFailure(a):reviewFailure;
      if(behavior==='UNKNOWN')throw new Error('TIMEOUT');
      const result=await output(a,{...f.ReviewResult,reviewedTreeHash:a.candidateDigest,candidateGeneration:a.candidateGeneration,
        criteria:[{schemaVersion:1,criterionId:'criterion',assessment}],scopeAssessment:assessment,testAssessment:assessment,actualChangesAssessment:assessment,
        findings:[],residualRisks:reviewRisks,validationResultIds:p.validationResults.map(v=>v.id),...(behavior===true||behavior==='FAIL'?{verdict:'FAIL',
          findings:[{...f.Finding,blocking:true,severity:'P1',evidenceRefs:['source']}]}:behavior==='BLOCKED'?{verdict:'BLOCKED'}:{})},options);
      if(behavior==='INFRA')throw new Error('TIMEOUT');return result}
  };
  const runtime={events:new Bus(),ownerSessionId:'owner'};
  for(const role of ['Scout','Developer','Reviewer','Oracle']){
    runtime[role.toLowerCase()]={name:`controlled.${role.toLowerCase()}`,runtimeGeneration:'fixture',active:()=>true};
    const module=await import(`../src/controlled-${role.toLowerCase()}.ts`);
    t.mock.method(module[`Controlled${role}Runner`].prototype,'run',doubles[role.toLowerCase()]);
  }
  const o=CentralOrchestrator.initialize(spec,{ownerSessionId:'owner',store,artifacts:[source],baselineRef:'HEAD',baselineCommit:base,runners:registeredRoleDispatchers(runtime)});
  await o.analyze(0);if(!stopAnalyzing)o.ready(o.state.revision);
  return {o,store,repo,work,data,git,base};
}
const stale=reason=>error=>error.code==='HUMAN_DECISION_STALE'&&error.reasonCode===reason;
const gateChannel=()=>({mode:'tui',sessionManager:{getSessionId:()=> 'owner'},ui:{async confirm(){return true}}});
const panelGateChannel=(action='yes')=>({mode:'tui',sessionManager:{getSessionId:()=> 'owner'},ui:{
  async confirm(){assert.fail('The native dialog must not be used when Pi offers the custom TUI')},
  custom:factory=>new Promise(resolve=>{
    const component=factory({requestRender(){},terminal:{rows:28}},null,null,resolve);
    const text=component.render(52).join('\n');
    assert.match(text,/Controlled Dev \| Confirmation/);assert.match(text,/\[ No, go back \]/);
    assert.match(text,/file\.txt/);
    if(action==='yes')component.handleInput('\x1b[C');
    component.handleInput(action==='escape'?'\x1b':'\r');
  })
}});
test('custom Pi confirmation is explicit, session-bound and durably verifiable',async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts');
  const {checkPresentationChannel}=await import('../src/gate-presentation.ts');
  const {o,store}=await readyGateWorkflow(t,true);
  const request=o.openBeforeImplementation(o.state.revision,'owner'),before=o.state;
  for(const action of ['no','escape']){
    assert.equal(await presentHumanGate(panelGateChannel(action),request),undefined);
    assert.deepEqual(DurableStore.load(store.root).state,before);
  }
  const changing=panelGateChannel();const custom=changing.ui.custom;
  changing.ui.custom=async factory=>{
    const result=await custom(factory);changing.sessionManager.getSessionId=()=> 'foreign';return result;
  };
  await assert.rejects(presentHumanGate(changing,request),stale('SESSION_CHANGED'));
  assert.deepEqual(DurableStore.load(store.root).state,before);
  const receipt=await presentHumanGate(panelGateChannel(),request);
  assert.ok(receipt);o.acceptHumanDecision(request.snapshot,receipt);
  const loaded=DurableStore.load(store.root),decision=loaded.records.find(r=>r.kind==='HumanDecisionEvidence').value;
  const ref=loaded.records.find(r=>r.id===decision.trustedChannelEvidenceRef).value;
  const proof=JSON.parse(Buffer.from(store.read(ref)).toString());
  assert.equal(proof.source,'ctx.ui.custom');assert.equal(proof.sessionId,'owner');
  assert.equal(proof.displayedDataHash,request.snapshot.approvedDataHash);
  const gate=loaded.records.find(r=>r.kind==='HumanGate'&&r.value.id===request.snapshot.gateId).value;
  assert.ok(checkPresentationChannel(proof,gate,o.context().records,o.events,store));
  assert.throws(()=>checkPresentationChannel({...proof,source:'ctx.ui.fake'},gate,o.context().records,o.events,store),/GATE_PRESENTATION_INVALID/);
});
test('completion accepts a custom confirmed gate after real validation and durable reload',async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts');
  const {o,store,repo,work}=await readyGateWorkflow(t);
  await o.implement(o.state.revision,work);o.testing(o.state.revision);o.validateApproved(o.state.revision);
  const c=o.candidateCapture;
  await o.review(o.state.revision,{candidateManifest:c.manifest,diff:c.patch,changedFiles:c.changedFiles,handoff:c.handoff,residualRisks:[],evidenceRefs:[]});
  o.resolveHostValidationRisks(o.state.revision);
  const request=o.openBeforeCompletion(o.state.revision,'owner');
  o.acceptHumanDecision(request.snapshot,await presentHumanGate(panelGateChannel(),request));o.complete(o.state.revision);
  assert.equal(DurableStore.load(store.root).state.state,'COMPLETED');
  assert.equal(readFileSync(join(repo,'file.txt'),'utf8'),'before\n');
  assert.equal(readFileSync(join(work,'file.txt'),'utf8'),'after\n');
});
for(const blocked of [false,true])test(`P15.2 Scout blocking=${blocked}: admission is data-bound, never automatic Oracle`,async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts');
  const risks=blocked?[{schemaVersion:1,id:'requires-denied-path',text:'Implementation requires a path outside the allowed scope',criterionIds:['criterion'],blocking:true}]:[];
  const {o,store,work}=await readyGateWorkflow(t,true,'task',false,blocked,false,[],risks);
  assert.equal(o.state.state,blocked?'ANALYZING':'READY');const before=o.state;
  if(blocked){
    assert.throws(()=>o.ready(o.state.revision),e=>e.code==='ADVISORY_REQUIRED'&&e.reasonCode==='SCOUT_BLOCKING_RISK');
    assert.deepEqual(o.state,before);assert.deepEqual(DurableStore.load(store.root).state,before);
    assert.equal(o.state.runs.some(r=>r.role==='Developer'),false);assert.equal(o.state.gates.length,0);
  }else{
    const request=o.openBeforeImplementation(o.state.revision,'owner');
    o.acceptHumanDecision(request.snapshot,await presentHumanGate(gateChannel(),request));
    await o.implement(o.state.revision,work);
    assert.equal(readFileSync(join(work,'file.txt'),'utf8'),'after\n');assert.ok(o.state.candidate);
  }
  assert.equal(o.state.runs.some(r=>r.role==='Oracle'),false);assert.equal(o.state.escalations.length,0);
});

test('P14H five golden presentations are deterministic, audit-free and hash-bound',async()=>{
  const {humanGateDisplay,humanGateStaleReason,presentHumanGate,HUMAN_GATE_TITLES}=await import('../src/orchestrator.ts');
  const {humanReadabilityExamples}=await import('./human-confirmation-host-probe.ts');
  const objective='Objective:\nModificare allowed.txt da "before" a "after".';
  const footer='\n\nThe original repository will not be modified automatically.\nNo automatic commit, merge, push, publish or apply.\n\nNo/Esc cancels the dialog; it does not record a rejection.\n\n';
  const golden={
    beforeImplementation:objective+'\n\nEditable files/paths in the candidate copy:\n- allowed.txt\n\nForbidden files/paths:\n- forbidden.txt\n\nPlanned checks:\n- Check that allowed.txt contenga esattamente "after" seguito da un ritorno a capo.\n\nKnown risks:\n- None'+footer+"Do you authorize the Developer to start these changes?",
    beforeCompletion:objective+'\n\nVerified changes:\n- allowed.txt\n- No other files changed\n\nChecks:\n✓ Automated checks passed\n✓ Reviewer: PASS\n✓ No unresolved residual risks'+footer+"Do you approve completion of this task?",
    onScopeChange:objective+'\n\nCurrent scope:\n- allowed.txt\n\nNew requested scope — changes:\n+ extra.txt\n+ Requirement: Aggiornare anche extra.txt.\n\nResulting scope:\n- allowed.txt\n- extra.txt\n\nForbidden paths after the change:\n- None\n\nReason:\nIl requisito include un secondo file.\n\nApproval installs the new specification and requires reanalysis; it does not start a writer.'+footer+"Do you authorize this scope change?",
    onOracleDecision:objective+'\n\nProblem:\nQuale formato mantenere?\n\nOptions:\nA. Mantenere il formato attuale.\nB. Proporre una modifica dei requisiti.\n\nOracle recommendation:\nMantenere il formato attuale.\n\nConsequences:\nRivalutazione da parte dell’Orchestrator; nessuna modifica immediata.\n\nOracle provides a recommendation; the user makes the decision.\nApproval permits reconciliation only: it does not authorize implementation or retry.'+footer+"Do you accept the recommendation for reconciliation only?",
    onRetryExhausted:objective+'\n\nWhat failed:\nValidation failed\nLatest error:\nValidation failed\n\nAttempts made: 3\nStarts: 3\nCorrections: 2\nInfrastructure retries: 0\n\nPermitted continuations:\n- Reconciliation by the Orchestrator; task still blocked\n\nApproval does not increase budgets or reset counters.'+footer+"Do you authorize reconciliation only, without further attempts?",
  };
  for(const request of humanReadabilityExamples()){
    const display=humanGateDisplay(request,{decision:'APPROVE'}),s=request.snapshot;
    assert.equal(display,golden[request.gateType]);assert.equal(display,humanGateDisplay(structuredClone(request),{decision:'APPROVE'}));
    assert.ok(display.startsWith('Objective:\n'));assert.equal(display.includes(HUMAN_GATE_TITLES[request.gateType]),false);
    assert.doesNotMatch(display,/node|check\.cjs/);
    assert.equal(display,humanGateDisplay({...request,snapshot:{...s,sessionId:'another-session',stateRevision:999}},{decision:'APPROVE'}),'Presentation depends on frozen material, not transport metadata');
    assert.doesNotMatch(display,/[a-f0-9]{64}|probe-gate|probe-task|specHash|candidateDigest|generation|revision|evidenceRef/);
    const changed={...JSON.parse(request.displayText),objective:'Modificare un altro file.'},changedHash=api.hashCanonical(changed);
    assert.notEqual(changedHash,s.approvedDataHash);assert.notEqual(display,humanGateDisplay({...request,displayText:api.canonicalize(changed)},{decision:'APPROVE'}));
    assert.equal(humanGateStaleReason(s,{...s,state:'AWAITING_HUMAN',approvedDataHash:changedHash,taskLockHeld:true,workspaceLockHeld:true,gateStatus:'PENDING'}),'APPROVED_DATA_HASH_CHANGED');
    await assert.rejects(presentHumanGate(gateChannel(),request),/HUMAN_DECISION_INVALID/,'Probe examples must never become authority');
    assert.match(humanGateDisplay(request,{decision:'REJECT'}),/Do you want to permanently reject this request\?$/);
    assert.match(humanGateDisplay(request,{decision:'ANSWER',answer:'  Testo esatto\n '}),/Do you want to send this answer without authorizing the request\?$/);
  }
  const request=humanReadabilityExamples().find(r=>r.gateType==='beforeCompletion');
  const data=JSON.parse(request.displayText);data.residualRisks=[{id:'host-validation-pending',text:'Pending',blocking:false}];
  data.decisions=[{subjectId:'host-validation-pending',kind:'RESOLVE_RISK'}];
  const display=humanGateDisplay({...request,displayText:api.canonicalize(data)},{decision:'APPROVE'});
  assert.match(display,/The host was expected to run validation. Status: resolved — validation passed/);
  assert.doesNotMatch(display,/host-validation-pending|blocking=false|RESOLVE_RISK/);
  data.decisions=[];data.validation[0].status='FAILED';data.reviewResult.verdict='BLOCKED';
  const failed=humanGateDisplay({...request,displayText:api.canonicalize(data)},{decision:'APPROVE'});
  assert.match(failed,/✗ Automated checks failed or unavailable/);assert.match(failed,/✗ Reviewer: BLOCKED/);assert.match(failed,/✗ Unresolved risks/);
});

test('P14H.1 validation intent uses frozen descriptions, never executable text',async()=>{
  const {humanGateDisplay}=await import('../src/orchestrator.ts');
  const {humanReadabilityExamples}=await import('./human-confirmation-host-probe.ts');
  const request=humanReadabilityExamples().find(r=>r.gateType==='beforeImplementation');
  const data=JSON.parse(request.displayText),render=value=>humanGateDisplay({...request,displayText:api.canonicalize(value)},{decision:'APPROVE'});
  const before=render(data),approvedHash=api.hashCanonical(data);
  assert.match(before,/Check that allowed.txt contenga esattamente "after" seguito da un ritorno a capo/);
  assert.doesNotMatch(before,/node|check\.cjs/);
  const changed=structuredClone(data);changed.requirements[0].text='allowed.txt contenga esattamente "different".';
  assert.notEqual(api.hashCanonical(changed),approvedHash);assert.notEqual(api.hashCanonical(render(changed)),api.hashCanonical(before));
  assert.equal(render(changed),render(structuredClone(changed)));
  const criteria={...data,acceptanceCriteria:[{id:'criterion-example',commandIds:['validation-example'],text:'il risultato soddisfi il criterio congelato.'}]};
  assert.match(render(criteria),/Check that il risultato soddisfi il criterio congelato/);
  criteria.acceptanceCriteria[0].text='';
  assert.match(render(criteria),/Automated check required by criterion criterion-example/);
  assert.doesNotMatch(render(criteria),/node|check\.cjs/);
  const unknown={...data,requirements:[]};
  assert.match(render(unknown),/Planned automated check; criterion description unavailable/);
  assert.doesNotMatch(render(unknown),/node|check\.cjs/);
  const scope=humanReadabilityExamples().find(r=>r.gateType==='onScopeChange'),scopeData=JSON.parse(scope.displayText);
  scopeData.exactAdditions={validationCommands:data.validationCommands};
  scopeData.affectedAcceptanceCriteria={proposed:[{id:'criterion-new',commandIds:['validation-example'],text:'extra.txt sia verificato.'}]};
  const scopeDisplay=humanGateDisplay({...scope,displayText:api.canonicalize(scopeData)},{decision:'APPROVE'});
  assert.match(scopeDisplay,/Check that extra.txt sia verificato/);assert.doesNotMatch(scopeDisplay,/node|check\.cjs/);
  assert.equal(api.hashCanonical(data),approvedHash,'Formatter never mutates canonical input');
});

test('P15 human dialog is readable, bound to frozen bytes and explicit about decisions',async t=>{
  const {humanGateDisplay}=await import('../src/orchestrator.ts');
  const {o}=await readyGateWorkflow(t,true),request=o.openBeforeImplementation(o.state.revision,'owner');
  const frozen=request.displayText;
  for(const decision of ['APPROVE','REJECT','ANSWER']){
    const choice={decision,...(decision==='ANSWER'?{answer:'  Risposta esatta\nnon approvazione  '}:{})};
    const display=humanGateDisplay(request,choice);
    assert.equal(display.includes(request.snapshot.approvedDataHash),false);assert.ok(display.includes(o.spec.objective));
    assert.match(display,/The original repository will not be modified automatically/);assert.match(display,/No automatic commit, merge, push, publish or apply/);
    if(decision==='REJECT')assert.match(display,/final rejection: the task will end with outcome FAILED/);
    if(decision==='ANSWER'){assert.match(display,/NOT approval/);assert.ok(display.includes(JSON.stringify(choice.answer)))}
  }
  assert.equal(request.displayText,frozen);assert.equal(o.state.state,'AWAITING_HUMAN');
  const display=humanGateDisplay({...request,displayText:JSON.stringify({objective:'hostile\u001b[2J\nAPPROVE'})},{decision:'APPROVE'});
  assert.equal(display.includes('\u001b'),false);assert.ok(display.includes('\\u001b'));
});

for(const conflict of [false,true])test(`P15.1 risk identity conflict=${conflict}; original before, candidate after is not a contradiction`,async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts');
  const risk={schemaVersion:1,id:'host-validation-pending',text:conflict?'Reviewer paraphrase of the Developer risk':'Host validation pending at handoff',criterionIds:['criterion'],blocking:false};
  const {o,store,repo,work}=await readyGateWorkflow(t,false,'task',false,false,false,[risk]);
  await o.implement(o.state.revision,work);o.testing(o.state.revision);o.validateApproved(o.state.revision);
  const c=o.candidateCapture;
  await o.review(o.state.revision,{candidateManifest:c.manifest,diff:c.patch,changedFiles:c.changedFiles,handoff:c.handoff,residualRisks:[],evidenceRefs:[]});
  assert.equal(readFileSync(join(repo,'file.txt'),'utf8'),'before\n');assert.equal(readFileSync(join(work,'file.txt'),'utf8'),'after\n');
  assert.equal(o.state.state,'REVIEWING');
  const before=o.state;
  if(conflict){
    assert.throws(()=>o.resolveHostValidationRisks(o.state.revision),e=>e.code==='RESULT_CONTRADICTORY'&&e.reasonCode==='RISK_ID_CONTENT_CONFLICT');
    assert.deepEqual(o.state,before);assert.deepEqual(DurableStore.load(store.root).state,before);
    assert.equal(o.state.decisions.length,0);assert.equal(o.pendingHumanGate,undefined);
    assert.throws(()=>o.openBeforeCompletion(o.state.revision,'owner'),/ADVISORY_REQUIRED/);
  }else{
    o.resolveHostValidationRisks(o.state.revision);
    assert.equal(o.state.decisions.filter(d=>d.kind==='RESOLVE_RISK').length,1);
    const request=o.openBeforeCompletion(o.state.revision,'owner');
    o.acceptHumanDecision(request.snapshot,await presentHumanGate(gateChannel(),request));o.complete(o.state.revision);
    assert.equal(DurableStore.load(store.root).state.state,'COMPLETED');
    assert.equal(readFileSync(join(repo,'file.txt'),'utf8'),'before\n');assert.equal(readFileSync(join(work,'file.txt'),'utf8'),'after\n');
  }
});

test('P17.2B.1 REVIEW risk resolution requires attributed current Reviewer coverage, not commandIds or automatic PASS (host doubles)',async t=>{
  const {o,store,work}=await readyGateWorkflow(t,false,'task',false,false,false,[],[],false,true);
  await o.implement(o.state.revision,work);o.testing(o.state.revision);o.validateApproved(o.state.revision);
  const c=o.candidateCapture;await o.review(o.state.revision,{candidateManifest:c.manifest,diff:c.patch,changedFiles:c.changedFiles,handoff:c.handoff,residualRisks:[],evidenceRefs:[]});
  o.resolveHostValidationRisks(o.state.revision);
  assert.equal(DurableStore.load(store.root).state.decisions[0].kind,'RESOLVE_RISK');
  const decision=o.state.decisions[0];assert.equal(api.validateContract('DecisionRecord',decision,o.context()).ok,true);
  for(const attack of ['absent','uncovered','stale','not-terminal','not-independent','invalidated']){
    const ctx=structuredClone(o.context()),d=structuredClone(decision),s=ctx.records.find(r=>r.id===ctx.stateId).value;
    const run=s.runs.findLast(r=>r.role==='Reviewer'),review=ctx.records.find(r=>r.id===run.resultRef).value;
    if(attack==='absent')d.evidenceRefs=d.evidenceRefs.filter(id=>id!==run.resultRef);
    if(attack==='uncovered')review.criteria[0].criterionId='unrelated';
    if(attack==='stale')review.candidateGeneration++;
    if(attack==='not-terminal')run.status='UNKNOWN';
    if(attack==='not-independent')run.childSessionId=s.runs.find(r=>r.role==='Developer').childSessionId;
    if(attack==='invalidated')s.invalidEvidenceIds.push(run.resultRef);
    assert.equal(api.validateContract('DecisionRecord',d,ctx).ok,false,attack);
  }
  const criterion=o.spec.acceptanceCriteria[0];assert.equal(api.validateContract('Criterion',criterion,o.context()).ok,true);
  for(const method of ['AUTOMATED','BOTH'])assert.equal(api.validateContract('Criterion',{...criterion,method},o.context()).ok,false,method);
  const {presentHumanGate}=await import('../src/orchestrator.ts'),request=o.openBeforeCompletion(o.state.revision,'owner');
  o.acceptHumanDecision(request.snapshot,await presentHumanGate(gateChannel(),request));o.complete(o.state.revision);
  assert.equal(DurableStore.load(store.root).state.state,'COMPLETED');
});

test('P14F.7 durable affirmative host double consumes TR-040 after exact frozen revision',async t=>{
  const {allResidualRisksDisposed,presentHumanGate}=await import('../src/orchestrator.ts');
  const channel=gateChannel(),{o,store,repo,work}=await readyGateWorkflow(t);
  await o.implement(o.state.revision,work);o.testing(o.state.revision);o.validateApproved(o.state.revision);
  const c=o.candidateCapture;await o.review(o.state.revision,{candidateManifest:c.manifest,diff:c.patch,changedFiles:c.changedFiles,handoff:c.handoff,residualRisks:[],evidenceRefs:[]});
  const originalRisk=structuredClone(o.context().records.find(r=>r.kind==='DeveloperResult').value.residualRisks);
  assert.equal(allResidualRisksDisposed(o.state,o.context(),o.events),false);
  assert.throws(()=>o.openBeforeCompletion(o.state.revision,'owner'),/ADVISORY_REQUIRED/);
  o.resolveHostValidationRisks(o.state.revision);
  assert.equal(allResidualRisksDisposed(o.state,o.context(),o.events),true);
  const resolved=DurableStore.load(store.root);
  assert.equal(resolved.state.decisions[0].kind,'RESOLVE_RISK');assert.equal(resolved.events.at(-1).recordType,'DECISION_RECORDED');
  assert.deepEqual(resolved.records.find(r=>r.kind==='DeveloperResult').value.residualRisks,originalRisk);
  for(const attack of ['missing','stale-validation','wrong-criterion','wrong-candidate','wrong-generation','wrong-spec','missing-evidence','invalidated','unauthorized','contradiction','duplicate']){
    const state=structuredClone(o.state),ctx=structuredClone(o.context()),events=structuredClone(o.events);
    ctx.records.find(r=>r.id===ctx.stateId).value=state;
    const d=state.decisions[0],v=ctx.records.find(r=>r.kind==='ValidationResult').value;
    if(attack==='missing')state.decisions=[];
    if(attack==='stale-validation')v.status='FAILED';
    if(attack==='wrong-criterion'){
      ctx.records.find(r=>r.kind==='Risk').value.criterionIds=['unknown'];
      ctx.records.find(r=>r.kind==='DeveloperResult').value.residualRisks[0].criterionIds=['unknown'];
    }
    if(attack==='wrong-candidate')state.candidate.digest='f'.repeat(64);
    if(attack==='wrong-generation')state.candidate.generation++;
    if(attack==='wrong-spec')state.specHash='f'.repeat(64);
    if(attack==='missing-evidence')d.evidenceRefs=d.evidenceRefs.filter(id=>id!==v.id);
    if(attack==='invalidated')state.invalidEvidenceIds.push(v.id);
    if(attack==='unauthorized')for(const e of events)if(e.recordType==='DECISION_RECORDED')e.actor='Developer';
    if(attack==='contradiction'||attack==='duplicate')state.decisions.push({...d,id:'contradictory',kind:attack==='contradiction'?'DEFER_RISK':'RESOLVE_RISK',reason:'different'});
    assert.equal(allResidualRisksDisposed(state,ctx,events),false,attack);
  }
  // Separate genuinely residual nonblocking risk: DEFER is not RESOLVE.
  {
    const state=structuredClone(o.state),ctx=structuredClone(o.context());ctx.records.find(r=>r.id===ctx.stateId).value=state;
    const risk=ctx.records.find(r=>r.kind==='Risk').value;risk.text='Documented nonblocking limitation';
    ctx.records.find(r=>r.kind==='DeveloperResult').value.residualRisks[0].text=risk.text;
    state.decisions[0]={...state.decisions[0],kind:'DEFER_RISK',reason:'Host accepts this non-material residual limitation; no scope or product tradeoff.'};
    ctx.records.find(r=>r.id===state.decisions[0].id&&r.kind==='DecisionRecord').value=state.decisions[0];
    assert.equal(allResidualRisksDisposed(state,ctx,o.events),true);
  }
  const request=o.openBeforeCompletion(o.state.revision,'owner'),frozen=DurableStore.load(store.root).state;
  assert.equal(frozen.state,'AWAITING_HUMAN');assert.equal(request.snapshot.stateRevision,frozen.revision);
  for(const patch of [{stateRevision:frozen.revision-1},{specHash:'f'.repeat(64)},{candidateDigest:'f'.repeat(64)},{candidateGeneration:99},
    {approvedDataHash:'f'.repeat(64)},{completionPackageHash:'f'.repeat(64)},{sessionId:'foreign'},{gateId:'foreign'},{taskId:'foreign'}]){
    const receipt=await presentHumanGate(channel,request);
    assert.throws(()=>o.acceptHumanDecision({...request.snapshot,...patch},receipt),e=>e.code==='HUMAN_DECISION_STALE'&&!!e.reasonCode);
    assert.deepEqual(DurableStore.load(store.root).state,frozen);
  }
  const accepted=await presentHumanGate({mode:'tui',sessionManager:{getSessionId:()=> 'owner'},ui:{notify(){},async confirm(){
    assert.equal(o.state.revision,frozen.revision);o.lockStatus();assert.equal(o.state.revision,frozen.revision);return true;
  }}},request);
  assert.ok(accepted);o.acceptHumanDecision(request.snapshot,accepted);
  const ledger=DurableStore.load(store.root);assert.equal(ledger.state.state,'REVIEWING');assert.equal(ledger.events.at(-1).transitionId,'TR-040');
  assert.equal(ledger.state.revision,frozen.revision+2);
  const decision=ledger.records.find(r=>r.kind==='HumanDecisionEvidence').value;
  assert.equal(decision.displayedRevision,frozen.revision);assert.equal(decision.displayedDataHash,request.snapshot.approvedDataHash);
  assert.throws(()=>o.acceptHumanDecision(request.snapshot,accepted),/HUMAN_DECISION_INVALID/);
  assert.equal(readFileSync(join(repo,'file.txt'),'utf8'),'before\n');assert.equal(readFileSync(join(work,'file.txt'),'utf8'),'after\n');
  o.complete(o.state.revision);
  assert.equal(DurableStore.load(store.root).state.state,'COMPLETED');
  assert.deepEqual(o.lockStatus(),{taskLockHeld:false,workspaceLockHeld:false});
  o.dispose();
});

for(const decision of ['REJECT','ANSWER']){
  test(`P14G.1 beforeCompletion shares ${decision} ingestion without inferring completion`,async t=>{
    const {presentHumanGate}=await import('../src/orchestrator.ts'),{o,store,work}=await readyGateWorkflow(t);
    await o.implement(o.state.revision,work);o.testing(o.state.revision);o.validateApproved(o.state.revision);
    const c=o.candidateCapture;await o.review(o.state.revision,{candidateManifest:c.manifest,diff:c.patch,changedFiles:c.changedFiles,handoff:c.handoff,residualRisks:[],evidenceRefs:[]});
    o.resolveHostValidationRisks(o.state.revision);
    const request=o.openBeforeCompletion(o.state.revision,'owner'),choice={decision,...(decision==='ANSWER'?{answer:'Need clarification, not approval'}:{})};
    o.acceptHumanDecision(request.snapshot,await presentHumanGate(gateChannel(),request,choice));
    assert.equal(DurableStore.load(store.root).state.state,decision==='REJECT'?'FAILED':'BLOCKED');
    assert.equal(o.humanGateStatus().decision,decision);assert.throws(()=>o.complete(o.state.revision),/COMPLETION_NOT_YET_AUTHORIZED/);
  });
}
test('P14G.1 production continuation re-enters admission after approval, never dispatches from the dialog',async t=>{
  const {decideProductionHumanGate}=await import('../src/production-bridge.ts'),{o,store,data}=await readyGateWorkflow(t,true);
  const prior=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=data;
  t.after(()=>{if(prior===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=prior});
  o.openBeforeImplementation(o.state.revision,'owner');const counters=o.state.counters,ctx=gateChannel();
  ctx.ui.confirm=async()=>{assert.deepEqual(o.state.counters,counters);assert.equal(o.state.candidate,undefined);return true};
  t.mock.method(o,'testing',()=>{throw new Error('fixture stops after real writer admission')});
  await assert.rejects(decideProductionHumanGate({current:o,ownerSessionId:'owner'},ctx,{decision:'APPROVE'}),/fixture stops/);
  const loaded=DurableStore.load(store.root);assert.equal(loaded.state.candidate.generation,1);
  assert.equal(loaded.state.counters.dispatches,counters.dispatches+1);assert.equal(o.humanGateStatus().status,'CONSUMED');
});
test('P14G.3 TEST-042 both gate lifecycles complete through production bridge',async t=>{
  const {decideProductionHumanGate}=await import('../src/production-bridge.ts'),{allResidualRisksDisposed}=await import('../src/orchestrator.ts');
  const {o,store,data}=await readyGateWorkflow(t,true),prior=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=data;
  t.after(()=>{if(prior===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=prior});
  o.openBeforeImplementation(o.state.revision,'owner');const shown=[],ctx=gateChannel();ctx.ui.notify=()=>{};
  ctx.ui.confirm=async(title,display)=>{shown.push(title==="Authorize implementation?"?'beforeImplementation':'beforeCompletion');assert.ok(display.startsWith('Objective:\n'));assert.equal(display.includes(title),false);return true};
  await decideProductionHumanGate({current:o,ownerSessionId:'owner'},ctx,{decision:'APPROVE'});
  assert.deepEqual(shown,['beforeImplementation','beforeCompletion']);const loaded=DurableStore.load(store.root);
  assert.equal(loaded.state.state,'COMPLETED');assert.equal(loaded.records.filter(r=>r.kind==='HumanDecisionEvidence').length,2);
  assert.equal(allResidualRisksDisposed(o.state,o.context(),o.events),true);
  assert.deepEqual(o.lockStatus(),{taskLockHeld:false,workspaceLockHeld:false});
});
test('P14G.3A TEST-042/046 scoped multi-gate authorization, hash linkage, tamper and read-only reload',async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts');
  const {evaluateHumanGateHistory,verifyTerminalCompletionPackage,buildTerminalCompletionPackage}=await import('../src/completion-package.ts');
  const {o,store,work}=await readyGateWorkflow(t,true);
  const approve=async request=>o.acceptHumanDecision(request.snapshot,await presentHumanGate(gateChannel(),request));
  await approve(o.openBeforeImplementation(o.state.revision,'owner'));
  for(const path of ['extra-one.txt','extra-two.txt']){
    await approve(o.openOnScopeChange(o.state.revision,proposedSpec(o,s=>s.scope.allowedPaths.push(path)),'Bounded explicit expansion','owner'));
    await o.analyze(o.state.revision);
  }
  o.ready(o.state.revision);await approve(o.openBeforeImplementation(o.state.revision,'owner'));
  await o.implement(o.state.revision,work);o.testing(o.state.revision);o.validateApproved(o.state.revision);
  const c=o.candidateCapture;await o.review(o.state.revision,{candidateManifest:c.manifest,diff:c.patch,changedFiles:c.changedFiles,handoff:c.handoff,residualRisks:[],evidenceRefs:[]});
  o.resolveHostValidationRisks(o.state.revision);
  const request=o.openBeforeCompletion(o.state.revision,'owner'),a=request.approvedData;
  const auth=JSON.parse(Buffer.from(store.read(a.authorizationPackageRef)).toString());
  assert.equal(api.hashCanonical(auth),a.authorizationPackageHash);
  assert.equal(o.context().records.some(r=>r.kind==='ArtifactRef'&&r.value.mediaType.includes('terminal-completion')),false,'No terminal package exists before approval');
  assert.equal(evaluateHumanGateHistory(o.state,o.context().records,store).valid,false);
  await approve(request);
  const gateHistory=evaluateHumanGateHistory(o.state,o.context().records,store);
  assert.deepEqual(gateHistory.invalidAuthorizations,[]);assert.deepEqual(gateHistory.unsatisfiedGateRequirements,[]);
  assert.equal(gateHistory.valid,true);assert.equal(gateHistory.satisfiedGateAuthorizations.length,5);
  assert.ok(gateHistory.dispositions.some(d=>d.status==='SUPERSEDED'));
  o.complete(o.state.revision);
  const loaded=DurableStore.load(store.root),terminalRecord=loaded.records.find(r=>r.kind==='ArtifactRef'&&r.value.mediaType==='application/vnd.pi-controlled-dev.terminal-completion-v2+json');
  const terminal=JSON.parse(Buffer.from(store.read(terminalRecord.value)).toString());
  assert.equal(terminal.schemaVersion,2);assert.equal(terminal.authorizationPackageHash,a.authorizationPackageHash);
  assert.notEqual(api.hashCanonical(terminal),a.authorizationPackageHash,'HA != HT is valid, not a circular authorization');
  assert.equal(loaded.state.state,'COMPLETED');verifyTerminalCompletionPackage(terminal,loaded.state,loaded.records,store);
  const disk=readFileSync(join(store.root,'events.jsonl')),snapshot=readFileSync(join(store.root,'state.json'));
  DurableStore.load(store.root);DurableStore.load(store.root);
  assert.deepEqual(readFileSync(join(store.root,'events.jsonl')),disk);assert.deepEqual(readFileSync(join(store.root,'state.json')),snapshot);
  for(const attack of ['missing-gate','stale-writer','missing-scope','unconsumed-final','stale-final','wrong-candidate','replay','contradiction','wrong-session','wrong-consume','consume-without-resume','displayed-hash','wrong-gate-id','wrong-gate-type']){
    const state=structuredClone(loaded.state),records=structuredClone(loaded.records);
    const writer=records.find(r=>r.kind==='HumanGate'&&r.value.type==='beforeImplementation'&&r.value.status==='PENDING');
    const final=records.find(r=>r.id===terminal.beforeCompletionGateRef.id),decision=records.find(r=>r.id===terminal.humanDecisionRef.id);
    let reader=store;
    if(attack==='missing-gate')records.splice(records.indexOf(writer),1);
    if(attack==='stale-writer')writer.value.specHash='0'.repeat(64);
    if(attack==='missing-scope')for(let i=records.length-1;i>=0;i--)if(records[i].kind==='HumanGate'&&records[i].value.type==='onScopeChange')records.splice(i,1);
    if(attack==='unconsumed-final')final.value.status='APPROVED';
    if(attack==='displayed-hash')decision.value.displayedDataHash='0'.repeat(64);
    if(attack==='wrong-gate-id')decision.value.gateId='another-authorization';
    if(attack==='wrong-gate-type')final.value.type='onOracleDecision';
    if(attack==='stale-final')final.value.stateRevision--;
    if(attack==='wrong-candidate')state.candidate.digest='0'.repeat(64);
    if(['replay','contradiction'].includes(attack))records.push({...structuredClone(decision),id:'duplicate-decision',value:{...decision.value,id:'duplicate-decision',...(attack==='contradiction'?{decision:'REJECT'}:{})}});
    if(attack==='wrong-session')for(const r of records)if(r.kind==='WorkflowState')r.value.ownerSessionId='foreign';
    if(attack==='wrong-consume')final.value.consumedEventId='event-r0';
    if(attack==='consume-without-resume')records.find(r=>r.id===final.value.consumedEventId).value.targetState='AWAITING_HUMAN';
    assert.equal(evaluateHumanGateHistory(state,records,reader).valid,false,attack);
    assert.throws(()=>buildTerminalCompletionPackage(terminal.executionPackage,state,records,reader),undefined,attack);
  }
  for(const attack of ['authorization-hash','authorization-ref','candidate','validation','review','material-decision','v1']){
    const forged=structuredClone(terminal);
    if(attack==='authorization-hash')forged.authorizationPackageHash='0'.repeat(64);
    if(attack==='authorization-ref')forged.authorizationPackageRef=terminal.beforeCompletionGateRef;
    if(attack==='candidate')forged.executionPackage.candidateDigest='0'.repeat(64);
    if(attack==='validation')forged.executionPackage.validationResultIds=[];
    if(attack==='review')forged.executionPackage.reviewId='foreign';
    if(attack==='material-decision')forged.finalDecisionRefs=[];
    if(attack==='v1')forged.schemaVersion=1;
    assert.throws(()=>verifyTerminalCompletionPackage(forged,loaded.state,loaded.records,store),undefined,attack);
  }
  for(const field of ['candidateDigest','candidateGeneration','validationResultIds','reviewId','decisionIds']){
    const changed=structuredClone(terminal.executionPackage);
    changed[field]=Array.isArray(changed[field])?[]:typeof changed[field]==='number'?99:'different';
    const {packageHash,...body}=changed;changed.packageHash=api.hashCanonical(body);
    assert.throws(()=>buildTerminalCompletionPackage(changed,loaded.state,loaded.records,store),undefined,`Material ${field} changes even with a fresh valid package hash`);
  }
  const authFile=join(store.root,a.authorizationPackageRef.relativeStorePath),bytes=readFileSync(authFile);
  chmodSync(authFile,0o600);writeFileSync(authFile,Buffer.from(JSON.stringify({...auth,taskId:'foreign'})));
  assert.throws(()=>DurableStore.load(store.root),/INTEGRITY/);writeFileSync(authFile,bytes);chmodSync(authFile,0o400);
  assert.equal(DurableStore.load(store.root).state.state,'COMPLETED');
  // E2E-15: exercise the actual terminal loader, not only the in-memory verifier.
  for(const ref of [terminal.executionPackage.patchRef,terminalRecord.value,terminal.humanDecisionRef]){
    const path=join(store.root,ref.relativeStorePath),original=readFileSync(path);
    chmodSync(path,0o600);writeFileSync(path,'tampered');
    assert.throws(()=>DurableStore.load(store.root),/INTEGRITY/);
    writeFileSync(path,original);chmodSync(path,0o400);
  }
  const eventPath=join(store.root,'events.jsonl'),originalEvents=readFileSync(eventPath),events=originalEvents.toString().trimEnd().split('\n');
  const lastEvent=JSON.parse(events.at(-1));lastEvent.eventHash='0'.repeat(64);events[events.length-1]=JSON.stringify(lastEvent);
  writeFileSync(eventPath,events.join('\n')+'\n');assert.throws(()=>DurableStore.load(store.root),/STORE_EVENT_HASH/);
  writeFileSync(eventPath,originalEvents);assert.equal(DurableStore.load(store.root).state.state,'COMPLETED');
});

test('P14G.1 beforeImplementation persists, confirms, consumes TR-038, then independently admits one writer',async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts');
  const {o,store,work}=await readyGateWorkflow(t,true),before=o.state;
  await assert.rejects(o.implement(before.revision,work),/HUMAN_GATE_REQUIRED/);
  assert.deepEqual(o.state,before);
  const request=o.openBeforeImplementation(before.revision,'owner'),pending=DurableStore.load(store.root);
  assert.equal(pending.events.at(-1).transitionId,'TR-010');assert.equal(pending.state.state,'AWAITING_HUMAN');
  assert.equal(request.snapshot.stateRevision,pending.state.revision);
  const gate=pending.records.find(r=>r.kind==='HumanGate').value,approved=JSON.parse(Buffer.from(store.read(gate.approvedData)).toString());
  for(const key of ['objective','specHash','baselineCommit','allowedPaths','deniedPaths','requirements','validationCommands','plannedDeveloperAuthority','knownRisks','knownBlockers'])assert.ok(key in approved,key);
  assert.equal(api.hashCanonical(approved),request.snapshot.approvedDataHash);
  const channel=gateChannel();channel.ui.confirm=async(title,display)=>{
    assert.equal(display.includes(request.snapshot.approvedDataHash),false);
    assert.equal(display.includes(request.snapshot.gateId),false);
    assert.match(display,/Editable files\/paths in the candidate copy/);
    assert.match(display,/Planned checks:/);
    assert.match(display,/Do you authorize the Developer to start these changes\?$/);
    assert.match(display,/No\/Esc cancels the dialog; it does not record a rejection/);
    assert.deepEqual(o.lockStatus(),{taskLockHeld:true,workspaceLockHeld:true});assert.deepEqual(o.state.counters,before.counters);return true;
  };
  const receipt=await presentHumanGate(channel,request),second=await presentHumanGate(channel,request);
  const decision=o.acceptHumanDecision(request.snapshot,receipt);
  assert.equal(decision.decision,'APPROVE');assert.equal(o.state.state,'READY');assert.deepEqual(o.state.counters,before.counters);
  assert.equal(o.state.candidate,undefined);assert.equal(o.humanGateStatus().status,'CONSUMED');
  const resumed=DurableStore.load(store.root);assert.equal(resumed.events.at(-1).transitionId,'TR-038');
  assert.equal(resumed.records.filter(r=>r.kind==='HumanDecisionEvidence').length,1);
  assert.throws(()=>o.acceptHumanDecision(request.snapshot,receipt),/HUMAN_DECISION_INVALID/);
  assert.throws(()=>o.acceptHumanDecision(request.snapshot,second),/HUMAN_DECISION_STALE/);
  await o.implement(o.state.revision,work);
  assert.equal(o.state.counters.dispatches,before.counters.dispatches+1);assert.equal(o.state.candidate.generation,1);
  await assert.rejects(o.implement(o.state.revision,work),/HUMAN_GATE_REQUIRED/);
});
for(const choice of [{decision:'REJECT'},{decision:'ANSWER',answer:'  Exact human text\nnot approval.  '}]){
  test(`P14G.1 ${choice.decision} is durably separate from approval; Orchestrator chooses F/B without writer`,async t=>{
    const {presentHumanGate}=await import('../src/orchestrator.ts'),{o,store,work}=await readyGateWorkflow(t,true),before=o.state;
    const request=o.openBeforeImplementation(before.revision,'owner'),receipt=await presentHumanGate(gateChannel(),request,choice);
    const returned=o.acceptHumanDecision(request.snapshot,receipt),loaded=DurableStore.load(store.root);
    const decision=loaded.records.find(r=>r.kind==='HumanDecisionEvidence').value;
    assert.deepEqual(returned,decision);assert.equal(decision.decision,choice.decision);assert.equal(decision.answer,choice.answer);
    const channel=loaded.records.find(r=>r.id===decision.trustedChannelEvidenceRef).value;
    const proof=JSON.parse(Buffer.from(store.read(channel)).toString());assert.equal(proof.source,'ctx.ui.confirm');assert.equal(proof.sessionId,'owner');
    if(choice.answer)assert.equal(proof.answerHash,api.hashCanonical(choice.answer));
    assert.equal(loaded.events.at(-1).transitionId,choice.decision==='REJECT'?'TR-043':'TR-042');
    assert.equal(loaded.state.state,choice.decision==='REJECT'?'FAILED':'BLOCKED');
    assert.equal(o.humanGateStatus().status,choice.decision==='ANSWER'?'INVALIDATED':'REJECTED');
    assert.equal(o.humanGateStatus().decision,choice.decision);assert.equal(loaded.state.pendingGateId,undefined);
    assert.deepEqual(loaded.state.counters,before.counters);assert.equal(loaded.state.candidate,undefined);
    const held=choice.decision!=='REJECT';assert.deepEqual(o.lockStatus(),{taskLockHeld:held,workspaceLockHeld:held});
    await assert.rejects(o.implement(o.state.revision,work),/HUMAN_GATE_REQUIRED/);
    assert.throws(()=>o.acceptHumanDecision(request.snapshot,receipt),/HUMAN_DECISION_INVALID/);
  });
}
test('P14G.1 shared boundary rejects JSON/RPC, model/child evidence, booleans and indirect commands',async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts'),{decideProductionHumanGate}=await import('../src/production-bridge.ts');
  const {o,store,work}=await readyGateWorkflow(t,true),request=o.openBeforeImplementation(o.state.revision,'owner'),before=o.state;
  for(const mode of ['json','rpc'])await assert.rejects(presentHumanGate({...gateChannel(),mode},request),/HUMAN_CHANNEL_UNAVAILABLE/);
  for(const answer of ['approved=true','proceed','user approved',1,{approved:true},false]){
    const channel=gateChannel();channel.ui.confirm=async()=>answer;
    assert.equal(await presentHumanGate(channel,request),undefined);
  }
  const fake={...fixtures(api).HumanDecisionEvidence,gateId:request.snapshot.gateId,taskId:o.spec.taskId,
    displayedRevision:before.revision,displayedDataHash:request.snapshot.approvedDataHash};
  assert.equal(api.validateStructure('HumanDecisionEvidence',fake).ok,true);
  for(const evidence of [true,fake,...['Scout','Developer','Reviewer','Oracle'].map(role=>({...fake,actorId:role}))])
    assert.throws(()=>o.acceptHumanDecision(request.snapshot,evidence),/HUMAN_DECISION_INVALID/);
  await assert.rejects(presentHumanGate(gateChannel(),{...request}),/HUMAN_DECISION_INVALID/);
  for(const choice of [{decision:'ANSWER'},{decision:'ANSWER',answer:'x'.repeat(4097)},{decision:'APPROVE',answer:'forged'},{decision:'proceed'}])
    await assert.rejects(presentHumanGate(gateChannel(),request,choice),/HUMAN_DECISION_INVALID/);
  const channel=gateChannel();channel.ui.confirm=async()=>false;
  assert.equal((await decideProductionHumanGate({current:o,ownerSessionId:'owner'},channel,{decision:'APPROVE'})).outcome,'NOT_CONFIRMED');
  assert.deepEqual(DurableStore.load(store.root).state,before);assert.equal(o.state.candidate,undefined);
  await assert.rejects(o.implement(o.state.revision,work),/HUMAN_GATE_REQUIRED/);
});
test('P14G.1 shared freshness rejects wrong revision/spec/data/session/task and cross-task receipts',async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts'),{o,store}=await readyGateWorkflow(t,true);
  const request=o.openBeforeImplementation(o.state.revision,'owner'),before=o.state;
  for(const patch of [{stateRevision:0},{specHash:'0'.repeat(64)},{approvedDataHash:'0'.repeat(64)},{sessionId:'foreign'},{taskId:'other'},
    {candidateDigest:'0'.repeat(64)},{candidateGeneration:1}]){
    const receipt=await presentHumanGate(gateChannel(),request);
    assert.throws(()=>o.acceptHumanDecision({...request.snapshot,...patch},receipt),/HUMAN_DECISION_STALE/);
  }
  const late=gateChannel(),lateReceipt=await presentHumanGate(late,request);late.sessionManager.getSessionId=()=> 'foreign';
  assert.throws(()=>o.acceptHumanDecision(request.snapshot,lateReceipt),stale('SESSION_CHANGED'));
  const wrong=gateChannel();wrong.sessionManager.getSessionId=()=> 'foreign';
  await assert.rejects(presentHumanGate(wrong,request),stale('SESSION_CHANGED'));
  const changing=gateChannel();changing.ui.confirm=async()=>{changing.sessionManager.getSessionId=()=> 'foreign';return true};
  await assert.rejects(presentHumanGate(changing,request),stale('SESSION_CHANGED'));
  for(const field of ['allowedPaths','plannedDeveloperAuthority']){
    const changed=JSON.parse(request.displayText);changed[field]=['arbitrary'];
    await assert.rejects(presentHumanGate(gateChannel(),{...request,displayText:api.canonicalize(changed)}),/HUMAN_DECISION_INVALID/);
  }
  const other=await readyGateWorkflow(t,true,'other-task'),otherRequest=other.o.openBeforeImplementation(other.o.state.revision,'owner');
  const receipt=await presentHumanGate(gateChannel(),otherRequest);
  assert.throws(()=>o.acceptHumanDecision(request.snapshot,receipt),/HUMAN_DECISION_STALE/);
  const bound=await presentHumanGate(gateChannel(),otherRequest);
  assert.throws(()=>o.acceptHumanDecision(otherRequest.snapshot,bound),stale('SPEC_HASH_CHANGED'));
  assert.deepEqual(DurableStore.load(store.root).state,before);
});
for(const stage of ['during dialog','after approval']){
  test(`P14G.1 stale baseline ${stage} cannot authorize a writer`,async t=>{
    const {presentHumanGate}=await import('../src/orchestrator.ts'),{o,repo,work,git}=await readyGateWorkflow(t,true);
    const request=o.openBeforeImplementation(o.state.revision,'owner'),receipt=await presentHumanGate(gateChannel(),request),counters=o.state.counters;
    if(stage==='after approval')o.acceptHumanDecision(request.snapshot,receipt);
    git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','different base');
    if(stage==='during dialog')assert.throws(()=>o.acceptHumanDecision(request.snapshot,receipt),stale('BASELINE_CHANGED'));
    else await assert.rejects(o.implement(o.state.revision,work),stale('BASELINE_CHANGED'));
    assert.deepEqual(o.state.counters,counters);assert.equal(o.state.candidate,undefined);assert.equal(readFileSync(join(repo,'file.txt'),'utf8'),'before\n');
  });
}
test('P14G.2A direct spec installation is impossible and cannot synthesize scope authority',async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts'),{o,work}=await readyGateWorkflow(t,true);
  const request=o.openBeforeImplementation(o.state.revision,'owner'),receipt=await presentHumanGate(gateChannel(),request);
  o.acceptHumanDecision(request.snapshot,receipt);const before=o.spec;
  assert.throws(()=>{o.spec={...o.spec,scope:{...o.spec.scope,allowedPaths:['arbitrary']}}},/only a getter/);
  assert.deepEqual(o.spec,before);await o.implement(o.state.revision,work);assert.deepEqual(o.spec,before);
});
function proposedSpec(o,change){
  const proposed=structuredClone(o.spec);proposed.specRevision++;change(proposed);proposed.specHash=api.hashContract('TaskSpec',proposed);return proposed;
}
test('P14G.2A TEST-021 gate 3/5 — APPROVE installs only the frozen expansion, invalidates old evidence and resumes ANALYZING',async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts'),{o,store}=await readyGateWorkflow(t,true,'task',false,true),old=o.spec;
  const proposed=proposedSpec(o,s=>{s.scope.allowedPaths.push('new.txt');s.requirements.push({schemaVersion:1,id:'req-new',text:'Implement exact additional work'});
    s.acceptanceCriteria.push({schemaVersion:1,id:'criterion-new',requirementIds:['req-new'],text:'Review additional work',method:'REVIEW',commandIds:[],reviewInstruction:'Inspect new.txt'});});
  const request=o.openOnScopeChange(o.state.revision,proposed,'Operator requests bounded expansion','owner'),pending=DurableStore.load(store.root);
  assert.equal(request.gateType,'onScopeChange');assert.equal(pending.state.state,'AWAITING_HUMAN');assert.equal(request.snapshot.proposedSpecHash,proposed.specHash);
  const data=JSON.parse(request.displayText);for(const key of ['currentSpecHash','proposedSpecHash','oldAllowedPaths','proposedAllowedPaths','oldRequirements',
    'proposedRequirements','authorityChanges','exactAdditions','exactRemovals','reason','affectedAcceptanceCriteria'])assert.ok(key in data,key);
  assert.deepEqual(data.exactAdditions.allowedPaths,['new.txt']);assert.deepEqual(data.exactRemovals.allowedPaths,[]);
  assert.deepEqual(data.authorityChanges,['ALLOWED_PATHS_ADDED','REQUIREMENTS_ADDED_OR_EXPANDED','ACCEPTANCE_CRITERIA_ADDED_OR_EXPANDED']);
  const oldResults=[...pending.state.results];o.acceptHumanDecision(request.snapshot,await presentHumanGate(gateChannel(),request));
  const installed=DurableStore.load(store.root);assert.equal(o.spec.specHash,proposed.specHash);assert.equal(o.state.specHash,proposed.specHash);
  assert.notEqual(o.spec.specHash,old.specHash);assert.equal(o.state.state,'ANALYZING');assert.equal(installed.events.at(-1).transitionId,'TR-037');
  assert.ok(oldResults.every(id=>o.state.invalidEvidenceIds.includes(id)));assert.equal(o.state.candidate,undefined);
  assert.throws(()=>o.ready(o.state.revision),/ADVISORY_REQUIRED/);await o.analyze(o.state.revision);o.ready(o.state.revision);
  const next=o.openBeforeImplementation(o.state.revision,'owner');assert.equal(next.snapshot.specHash,proposed.specHash);
  assert.notEqual(next.snapshot.approvedDataHash,request.snapshot.approvedDataHash);
});
for(const choice of [{decision:'REJECT'},{decision:'ANSWER',answer:'Keep current scope; clarify the proposal.'}]){
  test(`P14G.2A onScopeChange ${choice.decision} preserves the authoritative spec and never installs the proposal`,async t=>{
    const {presentHumanGate}=await import('../src/orchestrator.ts'),{o,store}=await readyGateWorkflow(t,false,'task',false,true),old=o.spec;
    const proposed=proposedSpec(o,s=>s.scope.allowedPaths.push('new.txt')),request=o.openOnScopeChange(o.state.revision,proposed,'Expansion proposal','owner');
    o.acceptHumanDecision(request.snapshot,await presentHumanGate(gateChannel(),request,choice));
    assert.equal(o.spec.specHash,old.specHash);assert.equal(o.state.specHash,old.specHash);assert.equal(o.state.state,choice.decision==='REJECT'?'FAILED':'BLOCKED');
    assert.equal(DurableStore.load(store.root).records.filter(r=>r.kind==='HumanDecisionEvidence').at(-1).value.answer,choice.answer);
  });
}
test('P14G.2A host classification gates expansions, not pure narrowing, and onScopeChange is always enabled',async t=>{
  const {analyzeScopeChange}=await import('../src/orchestrator.ts'),{o}=await readyGateWorkflow(t,false,'task',false,true);
  const variants=[s=>s.scope.allowedPaths.push('new.txt'),s=>{s.scope.deniedPaths=['new.txt'];s.scope.allowedPaths.push('new.txt')},
    s=>s.requirements[0].text='Expanded requirement text',s=>s.humanGates.onOracleDecision=false];
  // Removing an existing deny is expansion.
  const denied=proposedSpec(o,s=>{s.scope.deniedPaths=['new.txt']});denied.specRevision=0;denied.specHash=api.hashContract('TaskSpec',denied);
  const removeDeny=structuredClone(denied);removeDeny.specRevision=1;removeDeny.scope.deniedPaths=[];removeDeny.specHash=api.hashContract('TaskSpec',removeDeny);
  assert.equal(analyzeScopeChange(denied,removeDeny).requiresHumanGate,true);
  for(const change of variants)assert.equal(analyzeScopeChange(o.spec,proposedSpec(o,change)).requiresHumanGate,true);
  const narrow=proposedSpec(o,s=>s.scope.allowedPaths=[]);assert.equal(analyzeScopeChange(o.spec,narrow).requiresHumanGate,false);
  assert.throws(()=>o.openOnScopeChange(o.state.revision,narrow,'Pure narrowing','owner'),/SCOPE_CHANGE_NOT_EXPANSION/);
  const disabled=structuredClone(o.spec);disabled.specRevision++;disabled.humanGates.onScopeChange=false;disabled.specHash='0'.repeat(64);
  assert.throws(()=>o.openOnScopeChange(o.state.revision,disabled,'Disable mandatory gate','owner'),/ORCHESTRATOR_TASK_INVALID/);
});
test('P14G.2A TEST-019 stale/replay bindings and protocol authority limits fail closed',async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts'),{o}=await readyGateWorkflow(t,false,'task',false,true);
  const proposed=proposedSpec(o,s=>s.scope.allowedPaths.push('new.txt')),request=o.openOnScopeChange(o.state.revision,proposed,'Expansion proposal','owner');
  for(const patch of [{proposedSpecHash:'0'.repeat(64)},{specHash:'0'.repeat(64)},{stateRevision:0},{sessionId:'foreign'}]){
    const receipt=await presentHumanGate(gateChannel(),request);assert.throws(()=>o.acceptHumanDecision({...request.snapshot,...patch},receipt),/HUMAN_DECISION_STALE/);
  }
  const receipt=await presentHumanGate(gateChannel(),request);o.acceptHumanDecision(request.snapshot,receipt);
  assert.throws(()=>o.acceptHumanDecision(request.snapshot,receipt),/HUMAN_DECISION_INVALID/);
  const extra=structuredClone(proposed);extra.developerAuthority=['shell','merge','push','publish'];extra.specHash='0'.repeat(64);
  assert.equal(api.validateStructure('TaskSpec',extra).ok,false);
  const fixed=proposedSpec(o,s=>s.scope.allowedPaths.push('.git/config'));
  assert.throws(()=>o.openOnScopeChange(o.state.revision,fixed,'Forbidden path','owner'));
});
test('P14G.2A TEST-020 headless, model and child attacks cannot install a proposed spec',async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts'),{o}=await readyGateWorkflow(t,false,'task',false,true),old=o.spec;
  const proposed=proposedSpec(o,s=>s.scope.allowedPaths.push('new.txt')),request=o.openOnScopeChange(o.state.revision,proposed,'Expansion proposal','owner');
  for(const mode of ['json','rpc'])await assert.rejects(presentHumanGate({...gateChannel(),mode},request),/HUMAN_CHANNEL_UNAVAILABLE/);
  const fake={...fixtures(api).HumanDecisionEvidence,gateId:request.snapshot.gateId,taskId:o.spec.taskId,displayedRevision:request.snapshot.stateRevision,
    displayedDataHash:request.snapshot.approvedDataHash};
  for(const evidence of [fake,...['Scout','Developer','Reviewer','Oracle','parent-model'].map(actorId=>({...fake,actorId}))])
    assert.throws(()=>o.acceptHumanDecision(request.snapshot,evidence),/HUMAN_DECISION_INVALID/);
  assert.equal(o.spec.specHash,old.specHash);assert.equal(o.state.state,'AWAITING_HUMAN');
});
test('P15 E2E-03 integration: gated Reviewer FAIL, real rework generation 2, PASS and durable completion',async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts'),{o,store,work,repo}=await readyGateWorkflow(t,true,'task',a=>a.candidateGeneration===1);
  const first=o.openBeforeImplementation(o.state.revision,'owner'),receipt=await presentHumanGate(gateChannel(),first);
  o.acceptHumanDecision(first.snapshot,receipt);await o.implement(o.state.revision,work);
  o.testing(o.state.revision);o.validateApproved(o.state.revision);
  const c=o.candidateCapture;await o.review(o.state.revision,{candidateManifest:c.manifest,diff:c.patch,changedFiles:c.changedFiles,handoff:c.handoff,residualRisks:[],evidenceRefs:[]});
  assert.equal(o.state.state,'REWORK');const counters=o.state.counters;
  await assert.rejects(o.rework(o.state.revision,`${work}-next`),/HUMAN_GATE_REQUIRED/);
  const next=o.openBeforeImplementation(o.state.revision,'owner');assert.notEqual(next.snapshot.approvedDataHash,first.snapshot.approvedDataHash);
  assert.equal(next.snapshot.candidateDigest,c.digest);assert.equal(next.snapshot.candidateGeneration,1);
  assert.equal(o.events.at(-1).transitionId,'TR-030');
  o.acceptHumanDecision(next.snapshot,await presentHumanGate(gateChannel(),next));
  assert.equal(o.state.state,'READY');assert.equal(o.events.at(-1).transitionId,'TR-038');assert.deepEqual(o.state.counters,counters);
  await assert.rejects(o.implement(o.state.revision,`${work}-next`),/ORCHESTRATOR_STATE_INVALID/);
  await o.rework(o.state.revision,`${work}-next`);
  assert.equal(o.state.candidate.generation,2);assert.equal(o.state.counters.reworkAttempts,counters.reworkAttempts+1);
  assert.equal(DurableStore.load(store.root).records.filter(r=>r.kind==='HumanDecisionEvidence').length,2);
  const oldValidations=o.state.validations.slice(),oldReviews=o.state.reviews.slice();
  o.testing(o.state.revision);o.validateApproved(o.state.revision);
  const current=o.candidateCapture;
  await o.review(o.state.revision,{candidateManifest:current.manifest,diff:current.patch,changedFiles:current.changedFiles,handoff:current.handoff,residualRisks:[],evidenceRefs:[]});
  assert.equal(o.state.state,'REVIEWING');
  for(const id of [...oldValidations,...oldReviews])assert.ok(o.state.invalidEvidenceIds.includes(id));
  o.resolveHostValidationRisks(o.state.revision);
  const final=o.openBeforeCompletion(o.state.revision,'owner');o.acceptHumanDecision(final.snapshot,await presentHumanGate(gateChannel(),final));
  o.complete(o.state.revision);
  assert.equal(DurableStore.load(store.root).state.state,'COMPLETED');
  assert.equal(readFileSync(join(repo,'file.txt'),'utf8'),'before\n');assert.equal(readFileSync(join(work,'file.txt'),'utf8'),'after\n');
  assert.deepEqual(o.lockStatus(),{taskLockHeld:false,workspaceLockHeld:false});
});
test('runtime validation failure retains evidence across reload, gates bounded rework, and gives Reviewer a same-scenario comparison',async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts');
  const packets=[];
  const {o,store,work,repo}=await readyGateWorkflow(t,true,'task',false,false,false,[],[],false,false,true,packet=>packets.push(packet));
  const firstGate=o.openBeforeImplementation(o.state.revision,'owner');
  o.acceptHumanDecision(firstGate.snapshot,await presentHumanGate(gateChannel(),firstGate));
  await o.implement(o.state.revision,work);o.testing(o.state.revision);
  const failed=o.validateApproved(o.state.revision);
  assert.equal(failed.decision,'BLOCKED');assert.equal(failed.value[0].status,'FAILED');
  const failure=failed.value[0],token=failure.id.slice('validation-'.length);
  const persisted=DurableStore.load(store.root);
  assert.equal(persisted.state.state,'BLOCKED');
  const event=persisted.events.findLast(value=>value.recordType==='VALIDATION_RECORDED');
  assert.ok(event.evidenceRefs.includes(`runtime-evidence-${token}`));
  const evidenceRef=persisted.records.find(value=>value.id===`runtime-evidence-${token}`).value;
  const before=JSON.parse(Buffer.from(store.read(evidenceRef)).toString());
  assert.equal(before.status,'FAILED');assert.equal(before.complete,true);
  const routed=o.routeFailure({phase:'TESTING',source:'VALIDATION_FAILED',code:'HOST_VALIDATION_FAILED',subjectIds:[failure.id],
    evidenceRefs:[failure.id,`runtime-evidence-${token}`,`runtime-events-${token}`]},
    {dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:false,writerTerminal:true,workspaceSafe:true,sameProtocol:true,
      concreteHumanResolution:false,duplicateEscalation:false},o.state.revision);
  assert.equal(routed.decision,'REWORK_REQUIRED');assert.equal(o.state.state,'REWORK');
  const secondGate=o.openBeforeImplementation(o.state.revision,'owner');
  assert.match(secondGate.displayText,/Process: FAILED/);
  try{o.acceptHumanDecision(secondGate.snapshot,await presentHumanGate(gateChannel(),secondGate))}
  catch(error){assert.fail(`Second gate stale: ${error.reasonCode??error.message}`)}
  await o.rework(o.state.revision,`${work}-next`);
  assert.equal(o.state.candidate.generation,2);o.testing(o.state.revision);
  const passed=o.validateApproved(o.state.revision);
  assert.equal(passed.decision,'DISPATCH_REVIEWER');assert.equal(passed.value[0].status,'PASSED');
  const currentToken=passed.value[0].id.slice('validation-'.length),reloaded=DurableStore.load(store.root);
  const comparisonRef=reloaded.records.find(value=>value.id===`runtime-comparison-${currentToken}`).value;
  const comparison=JSON.parse(Buffer.from(store.read(comparisonRef)).toString());
  assert.equal(comparison.conclusion,'RESOLVED');assert.equal(comparison.before.evidenceId,before.id);
  assert.equal(comparison.scenarioId,before.scenarioId);assert.equal(comparison.commandHash,before.commandHash);
  const c=o.candidateCapture,host={candidateManifest:c.manifest,diff:c.patch,changedFiles:c.changedFiles,handoff:c.handoff,residualRisks:[],evidenceRefs:[]};
  const review=await o.review(o.state.revision,host);
  assert.notEqual(review.decision,'BLOCKED');
  assert.equal(packets.length,1);assert.equal(packets[0].runtimeComparison.conclusion,'RESOLVED');
  assert.ok(packets[0].evidenceRefs.includes(comparisonRef.id));
  assert.ok(packets[0].evidenceRefs.includes(evidenceRef.id));
  assert.ok(o.events.some(value=>value.recordType==='VALIDATION_RECORDED'&&value.evidenceRefs.includes(comparisonRef.id)));
  assert.equal(readFileSync(join(repo,'file.txt'),'utf8'),'before\n');
});
async function reviewerRedispatchWorkflow(t){
  const {presentHumanGate}=await import('../src/orchestrator.ts');let calls=0;const packets=[];
  const fixture=await readyGateWorkflow(t,true,'task',()=>++calls===1?'INFRA':false,false,false,[],[],false,false,true,p=>packets.push(p));
  const {o,work}=fixture,approve=async request=>o.acceptHumanDecision(request.snapshot,await presentHumanGate(gateChannel(),request));
  await approve(o.openBeforeImplementation(o.state.revision,'owner'));
  await o.implement(o.state.revision,work);o.testing(o.state.revision);const failed=o.validateApproved(o.state.revision),failure=failed.value[0];
  const token=failure.id.slice('validation-'.length);
  assert.equal(o.routeFailure({phase:'TESTING',source:'VALIDATION_FAILED',code:'HOST_VALIDATION_FAILED',subjectIds:[failure.id],
    evidenceRefs:[failure.id,`runtime-evidence-${token}`,`runtime-events-${token}`]},
    {dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:false,writerTerminal:true,workspaceSafe:true,sameProtocol:true,
      concreteHumanResolution:false,duplicateEscalation:false},o.state.revision).decision,'REWORK_REQUIRED');
  await approve(o.openBeforeImplementation(o.state.revision,'owner'));await o.rework(o.state.revision,`${work}-next`);o.testing(o.state.revision);
  assert.equal(o.validateApproved(o.state.revision).decision,'DISPATCH_REVIEWER');const capture=o.candidateCapture;
  try{await o.review(o.state.revision,{candidateManifest:capture.manifest,diff:capture.patch,changedFiles:capture.changedFiles,
    handoff:capture.handoff,residualRisks:[],evidenceRefs:[]});assert.fail('Reviewer A must fail infrastructurally')}
  catch(error){assert.equal(error.message,'TIMEOUT')}
  const reviewerA=o.state.runs.findLast(run=>run.role==='Reviewer');assert.equal(reviewerA.status,'TERMINAL');assert.equal(reviewerA.resultRef,undefined);
  const routed=o.recordReviewerInfrastructureFailure(new Error('TIMEOUT'),o.state.revision);assert.equal(routed.decision,'RETRY_INFRASTRUCTURE');
  return {...fixture,approve,packets,reviewerA,capture};
}
test('Reviewer infrastructure terminal/no verdict gate redispatches one fresh Reviewer and preserves all prior effects',async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts');
  const {o,store,repo,approve,packets,reviewerA,capture}=await reviewerRedispatchWorkflow(t);
  assert.equal(o.canOpenBeforeReviewerRedispatch(),true);const counters=o.state.counters,validations=[...o.state.validations];
  const developers=o.state.runs.filter(run=>run.role==='Developer').map(run=>run.assignmentId);
  const request=o.openBeforeReviewerRedispatch(o.state.revision,'owner');assert.equal(request.gateType,'beforeReviewerRedispatch');
  const display=(await import('../src/orchestrator.ts')).humanGateDisplay(request,{decision:'APPROVE'});
  assert.equal((await import('../src/orchestrator.ts')).HUMAN_GATE_TITLES.beforeReviewerRedispatch,"Review interrupted");
  assert.match(display,/Developer will not run again/);assert.match(display,/tests will not be repeated/);
  await assert.rejects(presentHumanGate({...gateChannel(),sessionManager:{getSessionId:()=> 'foreign'}},request),stale('SESSION_CHANGED'));
  const retryReceipt=await presentHumanGate(gateChannel(),request);o.acceptHumanDecision(request.snapshot,retryReceipt);
  assert.throws(()=>o.acceptHumanDecision(request.snapshot,retryReceipt),/HUMAN_DECISION_INVALID/);
  assert.equal(o.state.state,'REVIEWING');assert.equal(o.state.counters.dispatches,counters.dispatches);
  assert.equal(o.state.runs.filter(run=>run.role==='Reviewer').length,1,'the dialog does not dispatch');
  const reviewed=await o.redispatchReviewer(o.state.revision);assert.notEqual(reviewed.decision,'BLOCKED');
  const reviewerB=o.state.runs.findLast(run=>run.role==='Reviewer');
  for(const key of ['assignmentId','attemptId','requestId','runId','childSessionId'])assert.notEqual(reviewerB[key],reviewerA[key],key);
  assert.deepEqual(o.state.runs.filter(run=>run.role==='Developer').map(run=>run.assignmentId),developers);
  assert.deepEqual(o.state.validations,validations);assert.deepEqual(o.state.candidate,capture.candidate);
  assert.equal(o.state.counters.attempts,counters.attempts+1);assert.equal(o.state.counters.dispatches,counters.dispatches+1);
  assert.equal(o.state.counters.reworkAttempts,counters.reworkAttempts);assert.equal(o.state.counters.infrastructureRetries,counters.infrastructureRetries);
  assert.equal(packets.length,2);assert.deepEqual(packets[1].runtimeComparison,packets[0].runtimeComparison);
  assert.ok(packets[1].evidenceRefs.some(id=>id.startsWith('failure-')));assert.ok(packets[1].evidenceRefs.some(id=>id.startsWith('retry-authorization-')));
  o.resolveHostValidationRisks(o.state.revision);const final=o.openBeforeCompletion(o.state.revision,'owner');
  assert.equal(final.gateType,'beforeCompletion');assert.notEqual(final.snapshot.gateId,request.snapshot.gateId);
  o.acceptHumanDecision(final.snapshot,await presentHumanGate(gateChannel(),final));o.complete(o.state.revision);
  assert.equal(o.state.state,'COMPLETED');assert.equal(readFileSync(join(repo,'file.txt'),'utf8'),'before\n');
  assert.equal(DurableStore.load(store.root).state.state,'COMPLETED');
});
for(const decision of ['REJECT','ANSWER'])test(`Reviewer redispatch ${decision} never starts a Reviewer`,async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts'),{o}=await reviewerRedispatchWorkflow(t);
  const request=o.openBeforeReviewerRedispatch(o.state.revision,'owner'),before=o.state.runs.length;
  const receipt=await presentHumanGate(gateChannel(),request,{decision,...(decision==='ANSWER'?{answer:'Do not retry yet'}:{})});
  o.acceptHumanDecision(request.snapshot,receipt);assert.equal(o.state.runs.length,before);
  assert.equal(o.state.state,decision==='REJECT'?'FAILED':'BLOCKED');assert.equal(o.reviewerRedispatchAuthorized(),false);
});
test('Reviewer redispatch fails closed for verdicts, unresolved runs, stale candidate and changed runtime evidence',async t=>{
  for(const verdict of ['FAIL','BLOCKED',false]){
    const {o,work}=await readyGateWorkflow(t,false,`verdict-${verdict||'PASS'}`,verdict);
    await o.implement(o.state.revision,work);o.testing(o.state.revision);o.validateApproved(o.state.revision);const c=o.candidateCapture;
    await o.review(o.state.revision,{candidateManifest:c.manifest,diff:c.patch,changedFiles:c.changedFiles,handoff:c.handoff,residualRisks:[],evidenceRefs:[]});
    assert.equal(o.canOpenBeforeReviewerRedispatch(),false,`verdict ${verdict||'PASS'}`);
  }
  const unknown=await readyGateWorkflow(t,false,'unknown-reviewer','UNKNOWN');await unknown.o.implement(unknown.o.state.revision,unknown.work);
  unknown.o.testing(unknown.o.state.revision);unknown.o.validateApproved(unknown.o.state.revision);const uc=unknown.o.candidateCapture;
  await assert.rejects(()=>unknown.o.review(unknown.o.state.revision,{candidateManifest:uc.manifest,diff:uc.patch,changedFiles:uc.changedFiles,handoff:uc.handoff,residualRisks:[],evidenceRefs:[]}));
  assert.equal(unknown.o.state.runs.at(-1).status,'UNKNOWN');assert.equal(unknown.o.recordReviewerInfrastructureFailure(new Error('TIMEOUT'),unknown.o.state.revision),undefined);
  assert.equal(unknown.o.canOpenBeforeReviewerRedispatch(),false);
  const stale=await reviewerRedispatchWorkflow(t);writeFileSync(join(stale.capture.candidate.root,'file.txt'),'tampered\n');
  assert.equal(stale.o.canOpenBeforeReviewerRedispatch(),false);
  const changed=await reviewerRedispatchWorkflow(t),ledger=DurableStore.load(changed.store.root),runtime=ledger.records.find(r=>r.kind==='ArtifactRef'&&r.id.startsWith('runtime-evidence-')
    &&changed.o.state.validations.includes(JSON.parse(Buffer.from(changed.store.read(r.value)).toString()).validationId));
  const runtimePath=join(changed.store.root,runtime.value.relativeStorePath);chmodSync(runtimePath,0o600);writeFileSync(runtimePath,'{}');
  assert.equal(changed.o.canOpenBeforeReviewerRedispatch(),false);
});
test('Reviewer redispatch denies exhausted infrastructure budget and stale spec binding',async t=>{
  const {humanGateStaleReason}=await import('../src/orchestrator.ts');
  const budget=await readyGateWorkflow(t,false,'review-budget','INFRA',false,false,[],[],false,false,false,()=>{},false,0);
  await budget.o.implement(budget.o.state.revision,budget.work);budget.o.testing(budget.o.state.revision);budget.o.validateApproved(budget.o.state.revision);
  const c=budget.o.candidateCapture;await assert.rejects(()=>budget.o.review(budget.o.state.revision,{candidateManifest:c.manifest,diff:c.patch,
    changedFiles:c.changedFiles,handoff:c.handoff,residualRisks:[],evidenceRefs:[]}));
  assert.equal(budget.o.recordReviewerInfrastructureFailure(new Error('TIMEOUT'),budget.o.state.revision),undefined);
  assert.equal(budget.o.canOpenBeforeReviewerRedispatch(),false);
  const snapshot={gateId:'gate',taskId:'task',stateRevision:4,specHash:'a'.repeat(64),candidateDigest:'b'.repeat(64),candidateGeneration:2,
    approvedDataHash:'c'.repeat(64),sessionId:'owner'},current={gateId:'gate',taskId:'task',state:'AWAITING_HUMAN',stateRevision:4,
    specHash:'d'.repeat(64),candidateDigest:'b'.repeat(64),candidateGeneration:2,approvedDataHash:'c'.repeat(64),sessionId:'owner',
    taskLockHeld:true,workspaceLockHeld:true,gateStatus:'PENDING'};
  assert.equal(humanGateStaleReason(snapshot,current),'SPEC_HASH_CHANGED');
});
for(const target of ['spec','validation','validation-proof','reviewer-proof'])test(`Reviewer redispatch denies altered durable ${target} before opening the gate`,async t=>{
  const {o,store,reviewerA}=await reviewerRedispatchWorkflow(t),before=o.state;
  const validation=o.context().records.find(r=>r.kind==='ValidationResult'&&r.id===before.validations.at(-1)).value;
  const id=target==='spec'?before.spec.id:target==='validation'?validation.id:target==='validation-proof'?validation.processProofRef:reviewerA.terminalProofRef;
  const path=join(store.root,'artifacts',id);chmodSync(path,0o600);writeFileSync(path,'{}');
  assert.equal(o.canOpenBeforeReviewerRedispatch(),false);
  assert.throws(()=>o.openBeforeReviewerRedispatch(o.state.revision,'owner'));
  assert.deepEqual(o.state,before,'no gate, dispatch, or counter mutation');
});
test('Reviewer redispatch cancellation grants nothing and lost locks prevent dispatch after approval',async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts'),{o,approve,data}=await reviewerRedispatchWorkflow(t);
  const request=o.openBeforeReviewerRedispatch(o.state.revision,'owner'),before=o.state;
  assert.equal(await presentHumanGate({...gateChannel(),ui:{async confirm(){return false}}},request),undefined);
  assert.deepEqual(o.state,before);assert.equal(o.reviewerRedispatchAuthorized(),false);
  await approve(request);const approved=o.state;
  rmSync(join(data,'controlled-dev','locks'),{recursive:true,force:true});
  assert.equal(o.reviewerRedispatchAuthorized(),false);
  await assert.rejects(()=>o.redispatchReviewer(o.state.revision));assert.deepEqual(o.state,approved);
});
test('temporary diagnostic instrumentation residue blocks completion even when validation and Reviewer pass',async t=>{
  const {o,store,work,repo}=await readyGateWorkflow(t,false,'task',false,false,false,[],[],false,false,false,()=>{},true);
  await o.implement(o.state.revision,work);o.testing(o.state.revision);
  assert.equal(o.validateApproved(o.state.revision).decision,'DISPATCH_REVIEWER');
  const c=o.candidateCapture;
  const runtime=await import('../src/runtime-observability.ts');
  assert.equal(runtime.temporaryInstrumentationResidue(c.patch).length,1,c.patch);
  const reviewed=await o.review(o.state.revision,{candidateManifest:c.manifest,diff:c.patch,changedFiles:c.changedFiles,
    handoff:c.handoff,residualRisks:[],evidenceRefs:[]});
  assert.equal(reviewed.decision,'BLOCKED');assert.equal(DurableStore.load(store.root).state.state,'BLOCKED');
  assert.equal(readFileSync(join(repo,'file.txt'),'utf8'),'before\n');
});
test('P15 E2E-09 integration: candidate fault reaches production ScopeGuard, not a standalone guard call',async t=>{
  const {installP15ScopeFault,default:negativeHostProbe}=await import('./p15-negative-host-probe.ts');
  const commands=[];
  negativeHostProbe({on(){},registerCommand(name){commands.push(name)}});
  assert.deepEqual(commands,['controlled-dev'],'The probe must load production in its own module graph, not a separate extension');
  const {inventoryHash,inventoryTree}=await import('../src/controlled-agent-runtime.ts');
  const {o,store,repo,work,data,git}=await readyGateWorkflow(t,false,'p15-real-scope-negative',false,false,false,[],[],true);
  const snapshot=()=>({head:git('rev-parse','HEAD'),branch:git('symbolic-ref','HEAD'),index:readFileSync(join(repo,'.git/index')).toString('base64'),
    files:inventoryHash(inventoryTree(repo,['.git'])),status:git('status','--porcelain=v1','--untracked-files=all','--ignored')});
  const before=snapshot(),report=join(data,'scope-injection.json'),dispose=installP15ScopeFault(repo,report);t.after(dispose);
  await assert.rejects(o.implement(o.state.revision,work),/SCOPE_GUARD_FAILED/);
  const ledger=DurableStore.load(store.root);
  assert.equal(ledger.state.state,'BLOCKED');assert.ok(ledger.state.runs.every(r=>r.status==='TERMINAL'));
  assert.equal(ledger.state.runs.some(r=>r.role==='Reviewer'),false);assert.equal(ledger.state.counters.reworkAttempts,0);
  assert.equal(JSON.parse(readFileSync(report)).originalTouched,false);assert.deepEqual(snapshot(),before);
  assert.equal(readFileSync(join(work,'forbidden.txt'),'utf8'),'P15 host-controlled out-of-scope mutation\n');
  assert.deepEqual(o.lockStatus(),{taskLockHeld:true,workspaceLockHeld:true});
  assert.throws(()=>o.complete(o.state.revision),/COMPLETION_NOT_YET_AUTHORIZED/);
});
test('P14G.3 TEST-046 interruption before decision preserves pending gate and live locks, without authority',async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts'),{o,store,work}=await readyGateWorkflow(t,true);
  const request=o.openBeforeImplementation(o.state.revision,'owner'),before=o.state,channel=gateChannel();channel.ui.confirm=async()=>{throw new Error('UI interrupted')};
  assert.equal(await presentHumanGate(channel,request),undefined);const loaded=DurableStore.load(store.root);
  const {evaluateHumanGateHistory}=await import('../src/completion-package.ts');
  const history=evaluateHumanGateHistory(o.state,o.context().records,store);
  assert.equal(history.valid,false);assert.ok(history.dispositions.some(d=>d.status==='PENDING'));
  assert.deepEqual(loaded.state,before);assert.equal(loaded.records.some(r=>r.kind==='HumanDecisionEvidence'),false);
  assert.deepEqual(o.lockStatus(),{taskLockHeld:true,workspaceLockHeld:true});
  await assert.rejects(o.implement(o.state.revision,work),/HUMAN_GATE_REQUIRED/);
});
test('P14G.3 TEST-046 interruption after durable decision cannot replay or dispatch; no crash recovery',async t=>{
  const {presentHumanGate}=await import('../src/orchestrator.ts'),{o,store,work}=await readyGateWorkflow(t,true);
  const request=o.openBeforeImplementation(o.state.revision,'owner'),receipt=await presentHumanGate(gateChannel(),request),commit=store.commit.bind(store);
  t.mock.method(store,'commit',(state,event,records)=>{if(event.transitionId==='TR-038')throw new Error('interrupted before consume');return commit(state,event,records)});
  assert.throws(()=>o.acceptHumanDecision(request.snapshot,receipt),/interrupted before consume/);
  const loaded=DurableStore.load(store.root);assert.equal(loaded.state.state,'AWAITING_HUMAN');assert.equal(loaded.events.at(-1).recordType,'GATE_DECIDED');
  assert.equal(o.humanGateStatus().status,'APPROVED');assert.equal(loaded.records.filter(r=>r.kind==='HumanDecisionEvidence').length,1);
  assert.equal(loaded.records.some(r=>r.kind==='HumanGate'&&r.value.status==='CONSUMED'),false);
  const {evaluateHumanGateHistory}=await import('../src/completion-package.ts');
  const history=evaluateHumanGateHistory(o.state,o.context().records,store);
  assert.equal(history.valid,false);assert.ok(history.dispositions.some(d=>d.status==='DECIDED_NOT_RESUMED'));
  assert.deepEqual(DurableStore.load(store.root).state,loaded.state);
  assert.equal(o.pendingHumanGate,undefined);assert.deepEqual(o.lockStatus(),{taskLockHeld:true,workspaceLockHeld:true});
  assert.throws(()=>o.acceptHumanDecision(request.snapshot,receipt),/HUMAN_DECISION_INVALID/);
  await assert.rejects(o.implement(o.state.revision,work),/HUMAN_GATE_REQUIRED/);
});

async function advisoryGate(t,type){
  const f=await readyGateWorkflow(t,false,'task',false,true,type==='onRetryExhausted'),{o}=f;
  const failure={...fixtures(api).FailureRecord,evidenceRefs:['source']};
  o.openEscalation(failure,'Resolve the bounded ambiguity',o.state.revision);const episode=o.state.escalations.at(-1);
  if(type==='onOracleDecision')await o.consultOracle(episode.id,['Which continuation?'],['source'],o.state.revision);
  else o.recordDecision({schemaVersion:1,id:'resolution',kind:'RESOLVE_AMBIGUITY',subjectId:'source',reason:'Reconcile the explicit source; no further writer',evidenceRefs:['source']},episode.id,o.state.revision);
  const request=type==='onOracleDecision'?o.pendingHumanGate:o.openOnRetryExhausted(o.state.revision,episode.id,'owner');
  return {...f,request,episode};
}
for(const type of ['onOracleDecision','onRetryExhausted']){
  for(const choice of [{decision:'APPROVE'},{decision:'REJECT'},{decision:'ANSWER',answer:'  Exact answer\nnot approval.  '}]){
    test(`P14G.2B TEST-021 ${type} ${choice.decision} shared durable lifecycle`,async t=>{
      const {presentHumanGate}=await import('../src/orchestrator.ts'),{o,store,request}=await advisoryGate(t,type);
      const before=o.state,spec=o.spec,data=JSON.parse(request.displayText);
      assert.deepEqual(data.legalContinuations,['RECONCILE']);assert.ok(data.escalationEpisodeId);assert.ok(data.evidenceRefs.length);
      if(type==='onOracleDecision')for(const key of ['OracleResult','options','recommendation','rationale','consequences','ambiguity'])assert.ok(key in data);
      else for(const key of ['failureFingerprint','failureCategory','lastFailure','attempts','dispatches','infrastructureRetries','reworkAttempts','escalationEpisodes'])assert.ok(key in data);
      const receipt=await presentHumanGate(gateChannel(),request,choice);o.acceptHumanDecision(request.snapshot,receipt);
      assert.equal(o.state.state,choice.decision==='REJECT'?'FAILED':'BLOCKED');assert.deepEqual(o.state.counters,before.counters);assert.deepEqual(o.spec,spec);
      assert.equal(o.events.at(-1).transitionId,choice.decision==='REJECT'?'TR-043':'TR-042');
      assert.equal(o.humanGateStatus().status,choice.decision==='APPROVE'?'CONSUMED':choice.decision==='ANSWER'?'INVALIDATED':'REJECTED');
      assert.equal(DurableStore.load(store.root).records.find(r=>r.kind==='HumanDecisionEvidence').value.answer,choice.answer);
      const {evaluateHumanGateHistory}=await import('../src/completion-package.ts');
      const history=evaluateHumanGateHistory(o.state,o.context().records,store);
      assert.deepEqual(history.invalidAuthorizations,[]);assert.equal(history.valid,false,'No final approval exists');
      assert.equal(history.satisfiedGateAuthorizations.length,choice.decision==='APPROVE'?1:0);
      assert.equal(history.dispositions[0].status,choice.decision==='APPROVE'?'CONSUMED':choice.decision);
      const corrupted=structuredClone(o.context().records);
      for(const r of corrupted)if(r.kind==='WorkflowState'&&r.value.revision===request.snapshot.stateRevision){
        if(type==='onOracleDecision')r.value.escalations[0].id='wrong-episode';
        else r.value.failures.at(-1).fingerprint='wrong-fingerprint';
      }
      assert.ok(evaluateHumanGateHistory(o.state,corrupted,store).invalidAuthorizations.length,'TEST-042 episode/fingerprint mismatch');
      assert.throws(()=>o.acceptHumanDecision(request.snapshot,receipt),/HUMAN_DECISION_INVALID/);
      assert.deepEqual(o.state.counters,before.counters);
    });
  }
  test(`P14G.2B TEST-019/020 ${type} stale replay headless and fake evidence`,async t=>{
    const {presentHumanGate}=await import('../src/orchestrator.ts'),{o,request,store}=await advisoryGate(t,type),before=o.state;
    for(const mode of ['rpc','json'])await assert.rejects(presentHumanGate({...gateChannel(),mode},request),/HUMAN_CHANNEL_UNAVAILABLE/);
    const fake={...fixtures(api).HumanDecisionEvidence,gateId:request.snapshot.gateId,taskId:before.taskId,displayedRevision:before.revision,displayedDataHash:request.snapshot.approvedDataHash};
    for(const actorId of ['parent-model','Scout','Developer','Reviewer','Oracle'])assert.throws(()=>o.acceptHumanDecision(request.snapshot,{...fake,actorId}),/HUMAN_DECISION_INVALID/);
    for(const patch of [{stateRevision:0},{specHash:'0'.repeat(64)},{candidateDigest:'0'.repeat(64)},{candidateGeneration:99},{approvedDataHash:'0'.repeat(64)},{sessionId:'foreign'},{gateId:'episode-B'}]){
      const receipt=await presentHumanGate(gateChannel(),request);assert.throws(()=>o.acceptHumanDecision({...request.snapshot,...patch},receipt),/HUMAN_DECISION_STALE/);
    }
    const channel=gateChannel(),late=await presentHumanGate(channel,request);channel.sessionManager.getSessionId=()=> 'foreign';
    assert.throws(()=>o.acceptHumanDecision(request.snapshot,late),stale('SESSION_CHANGED'));
    assert.deepEqual(DurableStore.load(store.root).state,before);
    const first=await presentHumanGate(gateChannel(),request),second=await presentHumanGate(gateChannel(),request);
    o.acceptHumanDecision(request.snapshot,first);assert.throws(()=>o.acceptHumanDecision(request.snapshot,second),/HUMAN_DECISION_STALE/);
  });
}
test('P14G.2B no retry gate without exhaustion and recorded legal alternative; no Oracle gate without result',async t=>{
  const {o}=await readyGateWorkflow(t,false,'task',false,true),failure={...fixtures(api).FailureRecord,evidenceRefs:['source']};
  o.openEscalation(failure,'Bounded ambiguity',o.state.revision);const id=o.state.escalations.at(-1).id,before=o.state;
  assert.throws(()=>o.openOnOracleDecision(o.state.revision,id,'owner'),/ADVISORY_REQUIRED/);
  assert.throws(()=>o.openOnRetryExhausted(o.state.revision,id,'owner'),/ADVISORY_REQUIRED/);
  assert.deepEqual(o.state,before);
});

test('P14G.2B UNKNOWN prevents either gate and never authorizes redispatch',async t=>{
  const {ControlledOracleRunner}=await import('../src/controlled-oracle.ts');
  const {o}=await readyGateWorkflow(t,false,'task',false,true,true),failure={...fixtures(api).FailureRecord,evidenceRefs:['source']};
  o.openEscalation(failure,'Unresolved process',o.state.revision);const id=o.state.escalations.at(-1).id;
  t.mock.method(ControlledOracleRunner.prototype,'run',async()=>{throw new Error('unknown dispatch')});
  await assert.rejects(o.consultOracle(id,['ambiguity'],['source'],o.state.revision),/unknown dispatch/);
  assert.ok(o.state.runs.some(r=>r.status==='UNKNOWN'));const before=o.state;
  assert.throws(()=>o.openOnOracleDecision(o.state.revision,id,'owner'),/ORCHESTRATOR_BLOCKED/);
  assert.throws(()=>o.openOnRetryExhausted(o.state.revision,id,'owner'),/ORCHESTRATOR_BLOCKED/);
  assert.deepEqual(o.state,before);
});

test('P14B completion package with actual host validation verifies, but never grants human authority',async t=>{
  const b=await bundle(t);assert.deepEqual(verifyCompletionPackage(b.packet,b.state,b.records,b.store),{status:'COMPLETION_PACKAGE_VALID',completion:'HUMAN_GATE_REQUIRED'});
  const proofRef=b.validation.artifacts.find(r=>r.id===b.validation.result.processProofRef),logRef=b.validation.artifacts.find(r=>r.id===b.validation.result.logRef);
  const proof=JSON.parse(Buffer.from(b.store.read(proofRef)).toString());assert.ok(proof.pid>0);assert.equal(proof.source,'node-spawnSync');
  assert.equal(verifyValidationProcessProof(proof,b.validation.result,b.state,b.store.read(logRef)),true);
  assert.equal(verifyValidationProcessProof({...proof,exitCode:1},b.validation.result,b.state,b.store.read(logRef)),false);
  assert.equal(verifyValidationProcessProof(proof,b.validation.result,{...b.state,candidate:{...b.state.candidate,generation:2}},b.store.read(logRef)),false);
  const altered=structuredClone(b.spec);altered.validationCommands[0].argv=['-e','process.exit(7)'];
  assert.throws(()=>runApprovedValidation(altered,{...b.state,state:'TESTING'},'check',b.store),/VALIDATION_PRECONDITION/);
});
test('P14B package rejects missing/stale validation, wrong review, invalidated proof and incomplete closure',async t=>{
  const b=await bundle(t),verify=(p=b.packet,state=b.state,records=b.records)=>verifyCompletionPackage(p,state,records,b.store);
  assert.throws(()=>verify({...b.packet,packageHash:'0'.repeat(64)}),/PACKAGE_HASH/);
  assert.throws(()=>verify(b.packet,{...b.state,validations:[]}),/VALIDATION/);
  assert.throws(()=>verify(b.packet,{...b.state,candidate:{...b.state.candidate,generation:2}}),/CANDIDATE_BINDING/);
  for(const status of ['RUNNING','UNKNOWN','INTENT']){
    const unresolved=structuredClone(b.state);unresolved.runs[0].status=status;assert.throws(()=>verify(b.packet,unresolved));
  }
  const stale=structuredClone(b.records);stale.find(r=>r.kind==='ValidationResult').value.candidateGeneration=0;
  assert.throws(()=>verify(b.packet,b.state,stale),/BINDING|VALIDATION/);
  const wrong=structuredClone(b.packet);wrong.candidateDigest='0'.repeat(64);delete wrong.packageHash;wrong.packageHash=api.hashCanonical(wrong);
  assert.throws(()=>verify(wrong),/CANDIDATE_BINDING/);
  const badReview=structuredClone(b.records);badReview.find(r=>r.kind==='ReviewResult').value.reviewedTreeHash='0'.repeat(64);
  assert.throws(()=>verify(b.packet,b.state,badReview),/BINDING|REVIEW/);
  for(const id of [b.packet.reviewId,b.packet.candidateTerminalProofRef.id,b.validation.result.id,b.validation.result.processProofRef])
    assert.throws(()=>verify(b.packet,{...b.state,invalidEvidenceIds:[id]}),/INVALIDATED/);
  const cut={...b.packet,completionEvidenceRefs:[]};delete cut.packageHash;cut.packageHash=api.hashCanonical(cut);
  assert.throws(()=>verify(cut),/EVIDENCE_CLOSURE/);
});
test('P14B wrong writer/reviewer proof and provider retention are independent of transcript paths',async t=>{
  const b=await bundle(t),provider=join(b.root,'provider-proof.json');writeFileSync(provider,Buffer.from(b.store.read(b.packet.candidateTerminalProofRef)));
  unlinkSync(provider);assert.equal(verifyCompletionPackage(b.packet,b.state,b.records,b.store).status,'COMPLETION_PACKAGE_VALID');
  // No transcript file exists at either synthetic childSessionId.
  const wrong={...b.packet,reviewerTerminalProofRef:b.packet.candidateTerminalProofRef};delete wrong.packageHash;wrong.packageHash=api.hashCanonical(wrong);
  assert.throws(()=>verifyCompletionPackage(wrong,b.state,b.records,b.store),/REVIEW_BINDING/);
});
test('P14B tampered or missing durable proof, patch and log reject completion',async t=>{
  const b=await bundle(t);
  for(const ref of [b.packet.candidateTerminalProofRef,b.packet.patchRef,b.validation.artifacts[0]]){
    const path=join(b.store.root,ref.relativeStorePath),before=readFileSync(path);chmodSync(path,0o600);writeFileSync(path,'tampered');
    assert.throws(()=>verifyCompletionPackage(b.packet,b.state,b.records,b.store),/INTEGRITY/);
    unlinkSync(path);assert.throws(()=>verifyCompletionPackage(b.packet,b.state,b.records,b.store));writeFileSync(path,before);chmodSync(path,0o400);
  }
});

test('real wizard gate explains automatic checks separately from editorial review',async()=>{
  const {humanGateDisplay}=await import('../src/orchestrator.ts');
  const {humanReadabilityExamples}=await import('./human-confirmation-host-probe.ts');
  const request=humanReadabilityExamples().find(r=>r.gateType==='beforeImplementation');
  const data=JSON.parse(request.displayText);
  data.validationCommands=[{id:'validation-1',executable:'/usr/bin/git',argv:['diff','--check']},{id:'validation-2',executable:'/usr/bin/npm',argv:['test']}];
  data.acceptanceCriteria=[{id:'criterion-1',text:'La sezione Usage spiega come avviare il progetto.',method:'REVIEW',commandIds:[]}];
  const before=api.hashCanonical(data),display=humanGateDisplay({...request,displayText:api.canonicalize(data)},{decision:'APPROVE'});
  assert.match(display,/Diff formatting check; it does not prove the text is correct/);
  assert.match(display,/project's configured test suite in the candidate copy/);
  assert.match(display,/Independent review: La sezione Usage/);
  assert.doesNotMatch(display,/\/usr\/bin|--check/);assert.equal(api.hashCanonical(data),before);
});

test('oversized real validation output fails closed with an understandable explanation',async t=>{
  const b=await bundle(t);mkdirSync(join(b.root,'overflow-store'));
  const store=DurableStore.create(join(b.root,'overflow-store'),b.spec.scope.repoRoot,'task',()=> 'ACCEPT');
  const spec={...b.spec,validationCommands:[{...b.spec.validationCommands[0],argv:['-e',"process.stdout.write('x'.repeat(200000))"]}]};
  spec.specHash=api.hashContract('TaskSpec',spec);
  const state={...b.state,state:'TESTING',spec:store.writeSpec(spec),specHash:spec.specHash};
  const result=runApprovedValidation(spec,state,'check',store).result;
  assert.equal(result.status,'INVALID');assert.match(result.reason,/allowed output limit/);
  assert.doesNotMatch(result.reason,/ENOBUFS|SIGKILL/);
});
