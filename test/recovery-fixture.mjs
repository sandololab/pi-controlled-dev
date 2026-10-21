import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { installSourceLoader } from './load-source.mjs';
import { fixtures, TIME } from './contract-fixtures.mjs';
installSourceLoader();
const api=await import('../src/contracts.ts');
const {DurableStore}=await import('../src/store.ts');
const {CentralOrchestrator,createAssignment,OrchestratorHost}=await import('../src/orchestrator.ts');
const {LockManager}=await import('../src/lock-manager.ts');
const {projectIdentity}=await import('../src/project-identity.ts');
const {ScopeGuardError}=await import('../src/scope-guard.ts');

// Storage fixtures only: no runner execution or claim of real provider completion.
export function recoveryFixture(root,phase='PENDING',runStatus='NONE') {
  const repo=join(root,'repo'),data=join(root,'data');mkdirSync(repo);mkdirSync(data);
  const store=DurableStore.create(data,repo,'task',()=> 'ACCEPT'),f=fixtures(api),source=store.put('source','input','text/plain');
  const spec={...f.TaskSpec,scope:{...f.TaskSpec.scope,repoRoot:repo},plan:{...f.InputSource,snapshot:source},currentTask:{...f.InputSource,snapshot:source}};
  spec.specHash=api.hashContract('TaskSpec',spec);
  const manager=new LockManager(data,'owner','fixture-generation'),locks=manager.acquire('task',repo);
  const o=CentralOrchestrator.initialize(spec,{ownerSessionId:'owner',runners:{scout:async()=>{throw new Error('UNEXPECTED_DISPATCH')}},
    store,lockManager:manager,locks,artifacts:[source],now:()=>TIME});
  if(phase!=='PENDING'||runStatus!=='NONE') {
    const records=[...o.context().records],state={...o.state,revision:1,lastEventId:'recovery-fixture-event',state:phase};
    if(phase==='BLOCKED')state.blockedReason='Interrupted fixture';
    if(phase==='FAILED')state.terminalReason='Committed failure fixture';
    if(runStatus!=='NONE') {
      const a=createAssignment(spec,o.state,'Scout');records.push({id:a.assignmentId,kind:'AssignmentEnvelope',value:a});
      const run={schemaVersion:1,assignmentId:a.assignmentId,attemptId:a.attemptId,role:'Scout',requestId:'request',ownerSessionId:'owner',status:runStatus};
      if(runStatus!=='INTENT'){run.runId='run';run.childSessionId='child'}
      if(runStatus==='TERMINAL') {
        const proof={schemaVersion:1,runId:'run',role:'Scout',requestId:'request',ownerSessionId:'owner',childSessionId:'child',statusRequestId:'status',
          completionSessionId:'owner',terminalStatus:'complete',observedAt:TIME,source:'targeted-rpc-status',provider:{version:1,state:'observed',runId:'run',
          runnerProcessInstanceId:'instance',observedAt:1,instances:[{kind:'runner',processInstanceId:'instance',closeObservedAt:1,exitCode:0,signal:null}],resumeDisposition:'resumable'}};
        const ref=store.put('terminal-proof',api.canonicalize(proof));records.push({id:ref.id,kind:'ArtifactRef',value:ref});run.terminalProofRef=ref.id;
      }
      state.runs=[run];state.counters={...state.counters,attempts:1,dispatches:1};
    }
    if(phase==='AWAITING_HUMAN') {
      const approved=store.put('gate-data','{}');records.push({id:approved.id,kind:'ArtifactRef',value:approved});
      const gate={...f.HumanGate,id:'pending-gate',status:'PENDING',stateRevision:1,resumeState:'PENDING',continuation:'PREPARE',approvedData:approved,approvedDataHash:approved.digest};
      records.push({id:gate.id,kind:'HumanGate',value:gate});state.gates=[gate.id];state.pendingGateId=gate.id;
    }
    const catalog=store.catalog(records),transition={ANALYZING:'TR-001',AWAITING_HUMAN:'TR-002',FAILED:'TR-003',BLOCKED:'TR-004'}[phase];
    const event={schemaVersion:1,id:state.lastEventId,taskId:'task',kind:transition?'TRANSITION':'RECORD',...(transition?{transitionId:transition}:{recordType:'RECONCILED'}),
      actor:'Orchestrator',sourceState:'PENDING',targetState:phase,previousRevision:0,revision:1,timestamp:TIME,reason:'Storage-only recovery fixture',
      evidenceRefs:[catalog.id],invalidatedEvidenceIds:[],stateAfter:store.put('recovery-fixture-state',api.canonicalize(state)),previousEventHash:o.events[0].eventHash,eventHash:'0'.repeat(64)};
    event.eventHash=api.hashContract('TransitionEvent',event);store.commit(state,event,records);
  }
  return {repo,data,storeRoot:store.root,manager,locks};
}
export async function restartFixture(root,checkpoint='READY',resume=false,disposeBeforeExit=false,scoutConditions,memorySetup,options={}) {
  const importedTesting=checkpoint==='IMPORTED_TESTING';if(importedTesting)checkpoint='TESTING';
  const boundedPending=checkpoint==='DEVELOPER_BOUNDED_PENDING';if(boundedPending)checkpoint='DEVELOPER_BOUNDED';
  const {registeredRoleDispatchers,presentHumanGate}=await import('../src/orchestrator.ts');
  const {RpcAdapter}=await import('../src/pi-subagents-rpc.ts');
  const repo=join(root,'repo'),data=join(root,'data'),owner=resume?'successor':'owner',taskId=options.taskId??'task';
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
  if(!resume&&!options.existingRepo){mkdirSync(repo);mkdirSync(data);writeFileSync(join(repo,'file.txt'),'base\n');
    git('init','-q');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base')}
  const storeRoot=join(data,'controlled-dev','projects',projectIdentity(repo),'tasks',taskId);
  const ledger=resume?DurableStore.load(storeRoot):undefined;
  const store=resume?undefined:DurableStore.create(data,repo,taskId,()=> 'ACCEPT'),f=fixtures(api);
  const source=resume?ledger.records.find(r=>r.id==='source').value:store.put('source','input','text/plain');
  const spec=options.preparedSpec?structuredClone(options.preparedSpec):resume?ledger.records.find(r=>r.id===ledger.state.spec.id&&r.kind==='TaskSpec').value:
    {...f.TaskSpec,taskId,scope:{...f.ScopeSpec,repoRoot:repo},plan:{...f.InputSource,snapshot:source},currentTask:{...f.InputSource,snapshot:source},
      validationCommands:[{...f.CommandSpec,executable:process.execPath,argv:['-e','process.exit(0)']}]};
  if(checkpoint==='DEVELOPER_BOUNDED_EXHAUSTED'){spec.retryPolicy={...spec.retryPolicy,maxReworkAttempts:0};checkpoint='DEVELOPER_BOUNDED'}
  const sourceArtifacts=[source];if(options.preparedSpec)for(const input of [spec.plan,spec.currentTask])sourceArtifacts.push(store.put(input.snapshot.id,input.inline,input.snapshot.mediaType));
  if(!resume)spec.specHash=api.hashContract('TaskSpec',spec);
  const memoryScenario=memorySetup&&!resume?await memorySetup({data,repo,store,spec}):undefined;
  const fixtureOptions=options;
  const runtime={events:{on(){return()=>{}},emit(){}},ownerSessionId:owner},repeatDeveloperFailure=options.repeatDeveloperFailure===true,productionFixture=options.productionAutonomy===true;let developerConnectionFailed=false,reviewerFailed=false;
  for(const role of ['Scout','Developer','Reviewer','Oracle']){
    runtime[role.toLowerCase()]={name:`controlled.${role.toLowerCase()}`,runtimeGeneration:'fixture',active:()=>true};
    const module=await import(`../src/controlled-${role.toLowerCase()}.ts`);
    const originalRun=module[`Controlled${role}Runner`].prototype.run;
    module[`Controlled${role}Runner`].prototype.run=async function(a,...args){
      const options=args.at(-1),packet=args[0],dispatchOwner=this.ownerSessionId;fixtureOptions.onRoleDispatch?.(a,options);
      if(role==='Reviewer'&&checkpoint==='REVIEWER_NOT_DISPATCHED'){
        const handlers=new Map(),events={on(name,fn){handlers.set(name,fn);return()=>handlers.delete(name)},emit(name,q){
          if(name==='subagents:rpc:v1:request'){if(q.method!=='ping')throw new Error('Unexpected child spawn');
            handlers.get('subagents:rpc:v1:reply:'+q.requestId)?.({version:1,requestId:q.requestId,method:q.method,success:false,error:{code:'unavailable',message:'Test provider unavailable'}});}}};
        const real=new module.ControlledReviewerRunner(this.registration,events,dispatchOwner);
        try{return await originalRun.call(real,a,...args)}finally{real.dispose()}
      }
      appendFileSync(join(root,'effects.log'),`${role}\n`);
      if(checkpoint==='UNKNOWN')throw new Error('deterministic unknown dispatch');
      const listeners=new Map(),runId=`run-${a.attemptId}`,childSession=join(root,'transcripts',`${a.attemptId}.jsonl`),agent=`controlled.${role.toLowerCase()}`;
      let workerPid,closedAt;const reviewerTimeout=role==='Reviewer'&&checkpoint==='REVIEWER_TIMEOUT'&&(!productionFixture||!reviewerFailed);
      const scoutFailure=role==='Scout'&&checkpoint==='SCOUT_INFRA'&&!resume;
      const developerConnection=role==='Developer'&&checkpoint==='DEVELOPER_INFRA'&&(!developerConnectionFailed||repeatDeveloperFailure),developerBounded=role==='Developer'&&checkpoint==='DEVELOPER_BOUNDED'&&!resume,failed=reviewerTimeout||developerConnection||scoutFailure;
      const bus={on(name,fn){listeners.set(name,fn);return()=>listeners.delete(name)},emit(name,r){
        if(name!=='subagents:rpc:v1:request'){listeners.get(name)?.(r);return}
        const value=r.method==='ping'?{version:1,methods:['ping','spawn','status','interrupt','stop','resume'],session:{sessionId:dispatchOwner,sessionFile:null},
          events:{asyncComplete:'subagent:async-complete'},capabilities:{asyncSpawn:true,status:true,interrupt:true,stop:true,resume:true,processTerminalProof:{version:1,lifecycleArtifactVersion:3}}}:
          r.method==='spawn'?{details:{asyncId:runId,runId}}:{details:{lifecycleStatus:{processTerminal:{version:1,state:'observed',runId,runnerProcessInstanceId:`node-${workerPid}-${a.attemptId}`,observedAt:closedAt,
            instances:[{kind:'runner',processInstanceId:`node-${workerPid}-${a.attemptId}`,closeObservedAt:closedAt,exitCode:failed?1:0,signal:null}],resumeDisposition:'resumable'}}},
            asyncSnapshot:{version:1,kind:'pi-subagents.async-status-snapshot',runs:[{id:runId,state:failed?'failed':'complete'}]}};
        listeners.get(`subagents:rpc:v1:reply:${r.requestId}`)?.({version:1,requestId:r.requestId,success:true,data:value});
      }};
      const rpc=new RpcAdapter(bus,{sessionId:dispatchOwner,environmentHash:'a'.repeat(64),piVersion:'fixture',subagentsVersion:'fixture'});
      const {memoryDispatch}=await import('../src/project-memory-context.ts');
      const memory=memoryDispatch(options.projectMemory,a,options);
      await rpc.handshake();await rpc.spawn({agent,task:'Deterministic role double'+memory.text,cwd:a.repoRoot,timeoutMs:1000,outputSchema:{type:'object',additionalProperties:false}},options.projectMemory?memory.options:role==='Reviewer'?options:{});
      // Deterministic provider/role double, but a real separate Node worker and retained transcript.
      workerPid=Number(execFileSync(process.execPath,['-e',`const fs=require('node:fs'),path=require('node:path'),v=JSON.parse(process.argv[1]);
        fs.mkdirSync(path.dirname(v.childSession),{recursive:true});fs.writeFileSync(v.childSession,JSON.stringify({...v,pid:process.pid})+'\\n');
        if(v.role==='Developer'&&!v.noChange)fs.writeFileSync(path.join(v.assignment.workRoot,v.developerPath??'file.txt'),v.developerContent??(v.assignment.candidateGeneration?'after rework\\n':'after\\n'));process.stdout.write(String(process.pid));`,
        JSON.stringify({runId,childSession,role,owner:dispatchOwner,assignment:a,developerPath:memoryScenario?.developerPath,developerContent:typeof memoryScenario?.developerContent==='function'?memoryScenario.developerContent(a):memoryScenario?.developerContent,noChange:developerConnection||developerBounded||memoryScenario?.noChange===true,evidenceIds:args[role==='Reviewer'?1:0].records.map(r=>r.id),
          currentValidationIds:args[role==='Reviewer'?1:0].currentValidationIds??[]})],{encoding:'utf8'}));closedAt=Date.now();
      if(developerConnection)writeFileSync(childSession,[{type:'session',cwd:a.workRoot},{type:'message',message:{role:'assistant',stopReason:'error',errorMessage:'fetch failed',content:[]}}].map(JSON.stringify).join('\n')+'\n');
      if(developerBounded)writeFileSync(childSession,[{type:'session',cwd:a.workRoot},{type:'message',message:{role:'system',sections:{preamble:'<active_agent name="controlled.developer"/>'},toolsAdded:['read','edit','write','structured_output'].map(name=>({name}))}},{type:'message',message:{role:'assistant',stopReason:'stop',content:[{type:'toolCall',name:'read',arguments:{path:'file.txt'}}]}}].map(JSON.stringify).join('\n')+'\n');
      if(scoutFailure)writeFileSync(childSession,[{type:'session',cwd:a.workRoot},{type:'message',message:{role:'system',sections:{preamble:'<active_agent name="controlled.scout"/>'},toolsAdded:[{name:'read'},{name:'structured_output'}]}},{type:'message',message:{role:'assistant',content:[{type:'toolCall',name:'read',arguments:{path:'file.txt'}}]}},{type:'message',message:{role:'assistant',stopReason:'aborted',content:[]}}].map(JSON.stringify).join('\n')+'\n');
      bus.emit('subagent:async-complete',{id:runId,runId,sessionId:dispatchOwner,state:failed?'failed':'complete',success:!failed,exitCode:failed?1:0,
        results:[{agent,context:'fresh',sessionFile:childSession,status:failed?'failed':'completed',success:!failed}]});
      if(developerConnection){const acquired=await rpc.awaitTerminalProof(runId,500);if(!acquired.ok)throw new Error(acquired.error.code);
        options.onTerminalProof(acquired.value);rpc.dispose();developerConnectionFailed=true;throw new Error('fetch failed')}
      if(scoutFailure){const acquired=await rpc.awaitTerminalProof(runId,500);if(!acquired.ok)throw new Error(acquired.error.code);options.onTerminalProof(acquired.value);rpc.dispose();throw new Error('TIMEOUT')}
      if(role==='Reviewer'&&(reviewerTimeout||checkpoint==='REVIEWER_CRASH')){
        if(checkpoint==='REVIEWER_TIMEOUT'){
          const acquired=await rpc.awaitTerminalProof(runId,500);if(!acquired.ok)throw new Error(acquired.error.code);
          options.onTerminalProof(acquired.value);rpc.dispose();reviewerFailed=true;throw new Error('TIMEOUT');
        }else{
          // Owner loss before proof observation remains historical UNKNOWN.
          rpc.dispose();
          console.log(JSON.stringify({repo,data,storeRoot:store.root,locks,state:o.state}));
          await new Promise(()=>{setInterval(()=>{},1000)});
        }
      }
      if(role==='Reviewer'&&checkpoint==='REVIEWER_UNKNOWN'){rpc.dispose();throw new Error('TIMEOUT');}
      const acquired=await rpc.acquireTerminalProof(runId);if(!acquired.ok)throw new Error(acquired.error.code);
      const proof=acquired.value;options.onTerminalProof(proof);rpc.dispose();
      const assessment={schemaVersion:1,status:'PASS',evidenceRefs:['source'],reason:'Deterministic independent role double'};
      const failReview=role==='Reviewer'&&!resume&&['REWORK_READY','REWORK_EXHAUSTED'].includes(checkpoint)&&(!productionFixture||!reviewerFailed||checkpoint==='REWORK_EXHAUSTED');if(failReview)reviewerFailed=true;
      const result=role==='Scout'?{...f.ScoutResult,observations:[],relevantFiles:[],risks:[],ambiguities:[],...scoutConditions,recommendedScope:spec.scope}:
        role==='Developer'?{...f.DeveloperResult,changedFiles:developerBounded?[]:[memoryScenario?.developerPath??'file.txt'],tests:[],commandsRun:[],residualRisks:[],...(developerBounded?{blockedReason:'The approved checks must be executed by the host before development.'}:{})}:
        {...f.ReviewResult,verdict:failReview?'FAIL':'PASS',reviewedTreeHash:a.candidateDigest,candidateGeneration:a.candidateGeneration,
          criteria:spec.acceptanceCriteria.map(c=>({schemaVersion:1,criterionId:c.id,assessment:failReview?{...assessment,status:'FAIL'}:assessment})),scopeAssessment:assessment,testAssessment:assessment,actualChangesAssessment:assessment,
          findings:failReview?[{...f.Finding,...(productionFixture?{paths:[memoryScenario?.developerPath??'file.txt'],criterionIds:spec.acceptanceCriteria.map(c=>c.id)}:{}),blocking:true,severity:'P1',evidenceRefs:['source']}]:[],residualRisks:[],validationResultIds:packet.validationResults.map(v=>v.id)};
      return {...(role==='Developer'&&memoryScenario?.proposal?{memoryProposals:[memoryScenario.proposal]}:{}),result:{...result,taskId:a.taskId,assignmentId:a.assignmentId,attemptId:a.attemptId,role,specHash:a.specHash,assignmentHash:a.assignmentHash,evidenceRefs:['source']},
        evidence:{runId,requestId:proof.requestId,childSessionId:childSession,ownerSessionId:dispatchOwner,runtimeGeneration:this.runtimeGeneration??'fixture',launchContractHash:a.launchContractHash,
          effectiveTools:[],invokedTools:[],context:'fresh',source:'operational-runtime-registration'}};
    };
  }
  if(resume&&['REVIEWER_REDISPATCH','REVIEWER_REDISPATCH_COMPLETE'].includes(checkpoint)){
    const {takeOverWorkflow}=await import('../src/recovery-resume.ts');
    const authority=takeOverWorkflow(data,storeRoot,owner,'Reviewer redispatch real-process probe',()=> 'ACCEPT');
    const o=CentralOrchestrator.restore(authority,registeredRoleDispatchers(runtime)),reviewerA=o.state.runs.findLast(r=>r.role==='Reviewer');
    const routed=reviewerA.status==='NOT_DISPATCHED'?o.resumeRecovered():o.routeFailure({phase:'REVIEWING',source:'RPC_TRANSIENT',code:'REVIEWER_TIMEOUT',subjectIds:[reviewerA.assignmentId],evidenceRefs:[reviewerA.terminalProofRef]},
      {dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:true,writerTerminal:true,workspaceSafe:true,sameProtocol:true,concreteHumanResolution:false,duplicateEscalation:false},o.state.revision);
    const gate=o.openBeforeReviewerRedispatch(o.state.revision,owner),receipt=await presentHumanGate({mode:'tui',sessionManager:{getSessionId:()=>owner},ui:{async confirm(){return true}}},gate);
    o.acceptHumanDecision(gate.snapshot,receipt);const before={candidate:o.state.candidate,validations:o.state.validations,counters:o.state.counters,
      developers:o.state.runs.filter(r=>r.role==='Developer').map(r=>r.assignmentId)};
    const reviewed=await o.redispatchReviewer(o.state.revision),reviewerB=o.state.runs.findLast(r=>r.role==='Reviewer');
    if(checkpoint==='REVIEWER_REDISPATCH_COMPLETE'){
      o.resolveHostValidationRisks(o.state.revision);const request=o.openBeforeCompletion(o.state.revision,owner);
      const confirmation=await presentHumanGate({mode:'tui',sessionManager:{getSessionId:()=>owner},ui:{async confirm(){return true}}},request);
      o.acceptHumanDecision(request.snapshot,confirmation);o.complete(o.state.revision);
    }
    const report={repo,data,storeRoot,reviewerA,reviewerB,before,after:o.state,routed: routed.decision,reviewed:reviewed.decision};o.dispose();return report;
  }
  if(resume){
    process.env.PI_CODING_AGENT_DIR=data;
    const {productionRecoveryStatus}=await import('../src/production-bridge.ts');
    const {default:extension}=await import('../extensions/controlled-dev.ts');
    const notifications=[],errors=[],handlers=new Map(),commands=new Map();
    const ctx={mode:'tui',cwd:repo,sessionManager:{getSessionId:()=>owner},ui:{notify(message,type){notifications.push(message);if(type==='error')errors.push(message)},async confirm(){return true}}};
    extension({events:{...runtime.events,emit(name,r){if(name==='pi-subagents:runtime-agent-register:v1')r.result={ok:true,registration:{dispose(){}}};else runtime.events.emit(name,r)}},
      on(name,fn){handlers.set(name,[...(handlers.get(name)??[]),fn]);return()=>{}},registerCommand(name,cmd){commands.set(name,cmd)},
      getAllTools:()=>[{name:'read',sourceInfo:{source:'builtin',path:'<builtin:read>'}}],setActiveTools(){}});
    for(const fn of handlers.get('session_start'))fn({},ctx);
    const status=productionRecoveryStatus(ctx);
    let resumeDenied;
    for(const command of ['status','status --technical','recover','reconcile','status --technical','resume']){
      try{await commands.get('controlled-dev').handler(command,ctx)}catch(error){
        if(command!=='resume'||!DurableStore.load(storeRoot).state.runs.some(r=>r.status==='UNKNOWN'))throw error;resumeDenied=error.message;
      }
    }
    resumeDenied??=errors.at(-1);
    return {state:DurableStore.load(storeRoot).state,status,notifications,...(resumeDenied?{resumeDenied}:{})};
  }
  const manager=new LockManager(data,'owner','real-owner'),locks=manager.acquire(taskId,repo);
  const host=new OrchestratorHost('owner',registeredRoleDispatchers(runtime));
  const o=host.initialize(spec,{store,lockManager:manager,locks,artifacts:sourceArtifacts,baselineRef:'HEAD',baselineCommit:git('rev-parse','HEAD'),
    ...(['SCOPE_BASELINE','SCOPE_PENDING'].includes(checkpoint)?{scopeGuardFactory(){throw new ScopeGuardError('SCOPE_BASELINE_INVALID')}}:{})});
  options.onWorkflowCreated?.(o);
  const authorizeGate=async type=>{
    const a=memoryScenario?.autonomy;
    if(!a){const request=type==='beforeImplementation'?o.openBeforeImplementation(o.state.revision,'owner'):o.openBeforeCompletion(o.state.revision,'owner');
      const receipt=await presentHumanGate({mode:'tui',sessionManager:{getSessionId:()=> 'owner'},ui:{async confirm(){return true}}},request);o.acceptHumanDecision(request.snapshot,receipt);return;}
    const request=o.openPolicyGate(type,o.state.revision,'owner'),capability=a.repo.authorize(a.runId,type,{plannedTaskId:a.plannedTaskId,spec:o.spec,...request.snapshot,approvedData:JSON.parse(request.displayText)});
    o.acceptPolicyAuthorization(request.snapshot,capability);
  };
  try{await o.analyze(0)}catch(error){if(!['UNKNOWN','SCOUT_INFRA'].includes(checkpoint))throw error}
  if(['TESTING','READY','AWAITING_HUMAN','FINAL_GATE','COMPLETED','REWORK_READY','REVIEWER_TIMEOUT','REVIEWER_NOT_DISPATCHED','REVIEWER_CRASH','DEVELOPER_INFRA','DEVELOPER_BOUNDED','REVIEWER_UNKNOWN','REWORK_EXHAUSTED','VALIDATION_REWORK','SCOPE_BASELINE','SCOPE_PENDING'].includes(checkpoint))o.ready(o.state.revision);
  if(options.productionDriver){
    const {continueProductionWorkflow}=await import('../src/production-bridge.ts');
    options.beforeDriver?.(o);const notifications=[];
    const ctx={mode:'tui',cwd:repo,sessionManager:{getSessionId:()=> 'owner'},ui:{notify(message){notifications.push(message)},async confirm(){return true}}};
    const result=await continueProductionWorkflow(o,ctx);o.dispose();return {repo,data,storeRoot:store.root,state:o.state,result,notifications};
  }
  if(options.productionAutonomy){
    const {continueProductionWorkflow}=await import('../src/production-bridge.ts'),a=memoryScenario.autonomy;
    const notifications=[];const ctx={mode:'tui',cwd:repo,sessionManager:{getSessionId:()=>owner},autonomy:a,ui:{notify(message){notifications.push(message)},confirm:async()=>{throw new Error('No routine human confirmation')},editor:async()=>{throw new Error('No routine human editor')}}};
    const result=await continueProductionWorkflow(o,ctx);o.dispose();return {repo,data,storeRoot:store.root,state:o.state,result,notifications};
  }
  if(checkpoint==='AWAITING_HUMAN')o.openBeforeImplementation(o.state.revision,'owner');
  if(['TESTING','FINAL_GATE','COMPLETED','REWORK_READY','REVIEWER_TIMEOUT','REVIEWER_NOT_DISPATCHED','REVIEWER_CRASH','DEVELOPER_INFRA','DEVELOPER_BOUNDED','SCOPE_BASELINE','SCOPE_PENDING'].includes(checkpoint)){
    let work=memoryScenario?.candidateRoot??(importedTesting?join(data,'controlled-dev','workspaces','import-fixture-candidate'):join(root,'candidate'));
    if(importedTesting)mkdirSync(dirname(work),{recursive:true});
    if(importedTesting||['SCOPE_BASELINE','SCOPE_PENDING'].includes(checkpoint)){
      const {CandidatePromotionRepository}=await import('../src/candidate-promotion-repository.ts');
      const promotion=CandidatePromotionRepository.open(data,repo,()=> 'ACCEPT',{create:true,manager,workspaceLock:locks.workspace});
      promotion.initialize(spec,git('rev-parse','HEAD'));work=promotion.materialize(spec.taskId);
    }else if(!memoryScenario?.candidateRoot)git('worktree','add','--quiet','--detach',work,git('rev-parse','HEAD'));
    if(spec.humanGates.beforeImplementation){
      await authorizeGate('beforeImplementation');
    }
    try{const developed=await o.implement(o.state.revision,work);if(developed.decision==='BLOCKED'){if(boundedPending)o.openBeforeBoundedDeveloperRecovery(o.state.revision,'owner');if(disposeBeforeExit)o.dispose();return {repo,data,storeRoot:store.root,locks,state:o.state,...(scoutConditions?{orchestrator:o,host,runtime}:{})}}}catch(error){if(!['DEVELOPER_INFRA','DEVELOPER_BOUNDED','SCOPE_BASELINE','SCOPE_PENDING'].includes(checkpoint))throw error;
      if(checkpoint==='SCOPE_PENDING')o.openBeforeScopeBaselineRecovery(o.state.revision,'owner');
      if(disposeBeforeExit)o.dispose();return {repo,data,storeRoot:store.root,locks,state:o.state,...(scoutConditions?{orchestrator:o,host,runtime}:{})}}
    o.testing(o.state.revision);if(options.asyncValidation)await o.validateApprovedAsync(o.state.revision);else o.validateApproved(o.state.revision);
    if(checkpoint==='TESTING'){
      if(!importedTesting)return {repo,data,storeRoot:store.root,locks,state:o.state,orchestrator:o};
      // Real process fixture for a validated candidate imported into a fresh
      // profile. Human and provider doubles are explicit; locks and Git are real.
      const h=await import('../src/project-handoff.ts'),im=await import('../src/project-runtime-import.ts');
      const {captureCandidateCheckpointStaging}=await import('../src/candidate-checkpoints.ts');
      const {presentTrustedConfirmation}=await import('../src/trusted-confirmation.ts');
      const native={mode:'tui',sessionManager:{getSessionId:()=> 'fixture-native'},ui:{confirm:async()=>true}};
      const planning=DurableStore.project(data,repo,'planning',()=> 'ACCEPT',true),proposal=h.prepareProjectHandoff({repoRoot:repo,machineDataRoot:data});
      const receipt=await presentTrustedConfirmation(native,h.projectHandoffRequest(proposal));
      const cap=h.authorizeProjectHandoff(proposal,receipt,{store:planning,manager,workspaceLock:locks.workspace,assertQuiescent(){}});
      let descriptors;h.completeProjectHandoff(cap,{captureCandidates(auth){descriptors=[captureCandidateCheckpointStaging(auth,store.root,{manager,workspaceLock:locks.workspace}).descriptorRelativePath];return descriptors}});
      h.releaseProjectHandoff({repoRoot:repo,manager,workspaceLock:locks.workspace,assertQuiescent(){},candidateDescriptors:descriptors,retireAuthority(){manager.release(locks.task)}});
      const freshData=join(root,'imported-profile');mkdirSync(freshData);
      const p=im.prepareProjectRuntimeImport(freshData,repo,spec.taskId,'fixture-native',()=> 'ACCEPT'),q=im.projectRuntimeImportRequest(p),r=await presentTrustedConfirmation(native,q),imported=im.authorizeProjectRuntimeImport(p,r);
      const {takeOverImportedWorkflow}=await import('../src/recovery-resume.ts');const next=CentralOrchestrator.restore(takeOverImportedWorkflow(imported),{});im.completeProjectRuntimeImport(imported);next.validateApproved(next.state.revision);
      return {repo,data:freshData,storeRoot:im.projectRuntimeImportLease(imported).taskRoot,state:next.state};
    }
    const c=o.candidateCapture;try{await o.review(o.state.revision,{candidateManifest:c.manifest,diff:c.patch,changedFiles:c.changedFiles,handoff:c.handoff,residualRisks:[],evidenceRefs:['source']})}catch(error){if(!['REVIEWER_TIMEOUT','REVIEWER_NOT_DISPATCHED'].includes(checkpoint))throw error;if(checkpoint==='REVIEWER_NOT_DISPATCHED')o.recordReviewerInfrastructureFailure(error,o.state.revision)}
    if(checkpoint==='FINAL_GATE'){o.resolveHostValidationRisks(o.state.revision);o.openBeforeCompletion(o.state.revision,'owner')}
    else if(checkpoint==='COMPLETED'){
      o.resolveHostValidationRisks(o.state.revision);await authorizeGate('beforeCompletion');o.complete(o.state.revision);
    }
    else if(checkpoint==='REWORK_READY'){const request=o.openBeforeImplementation(o.state.revision,'owner');
      const receipt=await presentHumanGate({mode:'tui',sessionManager:{getSessionId:()=> 'owner'},ui:{async confirm(){return true}}},request);
      o.acceptHumanDecision(request.snapshot,receipt)}
  }
  if(disposeBeforeExit)o.dispose();
  return {repo,data,storeRoot:store.root,locks,state:o.state,...(scoutConditions?{orchestrator:o}:{})};
}
if(process.argv[2]==='reconciliation-reload'){
  const {reconcileUnknownChildren}=await import('../src/recovery-resume.ts');
  const before=DurableStore.load(process.argv[4]).state;
  const result=await reconcileUnknownChildren(process.argv[3],process.argv[4],{historicalRunReconciliationAvailable(){throw new Error('Automatic provider query forbidden')}},'third-process');
  console.log(JSON.stringify({before,after:DurableStore.load(process.argv[4]).state,result}));
}
if(process.argv[2]==='workflow-successor')console.log(JSON.stringify(await restartFixture(process.argv[3],'READY',true)));
if(process.argv[2]==='reviewer-successor')console.log(JSON.stringify(await restartFixture(process.argv[3],process.argv[4]==='complete'?'REVIEWER_REDISPATCH_COMPLETE':'REVIEWER_REDISPATCH',true)));
if(process.argv[2]==='workflow-owner') {
  const developerGate=process.argv[4]==='DEVELOPER_RETRY_GATE';
  let f=await restartFixture(process.argv[3],developerGate?'DEVELOPER_INFRA':process.argv[4],false,process.argv[5]==='dispose',developerGate?{}:undefined);
  if(developerGate){const {orchestrator,host,runtime,...report}=f;
    orchestrator.openBeforeDeveloperRecovery(orchestrator.state.revision,'owner');f={...report,state:orchestrator.state};}
  console.log(JSON.stringify(f));
  if(process.argv[5]==='hold')setInterval(()=>{},1000);
}
if(process.argv[2]==='owner') {
  const f=recoveryFixture(process.argv[3],process.argv[4],process.argv[5]);
  console.log(JSON.stringify({repo:f.repo,data:f.data,storeRoot:f.storeRoot,locks:f.locks}));
  if(process.argv[6]==='hold')setInterval(()=>{},1000);
}
if(process.argv[2]==='takeover') {
  const {takeOverWorkflow}=await import('../src/recovery-resume.ts');
  try{
    const authority=takeOverWorkflow(process.argv[3],process.argv[4],`successor-${process.pid}`,'Concurrent operator takeover',()=> 'ACCEPT');
    const o=CentralOrchestrator.restore(authority,{});console.log(JSON.stringify({taken:true,revision:o.state.revision}));setTimeout(()=>{},3000);
  }catch(error){console.log(JSON.stringify({taken:false,reason:error.message}))}
}
if(process.argv[2]==='recover') {
  const {recoverLocks}=await import('../src/recovery.ts');
  try{console.log(JSON.stringify(recoverLocks(process.argv[3],process.argv[4])))}catch(error){console.log(JSON.stringify({error:error.code??error.message}))}
}

if(process.argv[2]==='autonomy-boundary-owner'){
 const {ProjectAutonomyRepository,ProjectAutonomyController}=await import('../src/project-autonomy.ts');
 const repo=ProjectAutonomyRepository.open(process.argv[3],process.argv[4],()=> 'ACCEPT'),runId=process.argv[5];repo.resume(runId);
 await new ProjectAutonomyController(repo,{execute:async()=>{console.log('BEFORE_P2');await new Promise(()=>setInterval(()=>{},1000));return 'unreachable'},promote:async()=>{throw new Error('Unexpected promotion')},checkpoint:async()=>{throw new Error('Unexpected checkpoint')}}).run(runId);
}
