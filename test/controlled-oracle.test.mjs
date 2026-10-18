import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { installSourceLoader } from './load-source.mjs';
import { loadContracts } from './load-contracts.mjs';
import { fixtures, context } from './contract-fixtures.mjs';
installSourceLoader();
const oracle=await import('../src/controlled-oracle.ts');
const api=await loadContracts();

class Bus{
  map=new Map();
  on(name,fn){const set=this.map.get(name)??new Set();set.add(fn);this.map.set(name,set);return()=>set.delete(fn)}
  emit(name,data){for(const fn of [...(this.map.get(name)??[])])fn(data)}
}
function workspace(){const root=mkdtempSync(join(tmpdir(),'controlled-oracle-work-'));writeFileSync(join(root,'canary.txt'),'same');return root}
function setup(root,selectedContext='fresh'){
  const f=fixtures(api);
  f.TaskSpec={...f.TaskSpec,scope:{...f.TaskSpec.scope,repoRoot:root}};f.TaskSpec.specHash=api.hashContract('TaskSpec',f.TaskSpec);
  f.AssignmentEnvelope={...f.AssignmentEnvelope,role:'Oracle',specHash:f.TaskSpec.specHash,repoRoot:root,workRoot:root,
    authority:['OP-01'],context:selectedContext,launchContractHash:oracle.ORACLE_LAUNCH_CONTRACT_HASH};
  delete f.AssignmentEnvelope.baseCommit;f.AssignmentEnvelope.assignmentHash=api.hashContract('AssignmentEnvelope',f.AssignmentEnvelope);
  f.Escalation={...f.Escalation,oracleAttemptId:'attempt'};
  f.WorkflowState={...f.WorkflowState,revision:1,state:'BLOCKED',blockedReason:'Diagnose',failures:[f.FailureRecord],escalations:[f.Escalation],
    runs:[{...f.RunRecord,role:'Oracle'}],counters:{...f.WorkflowState.counters,attempts:1,dispatches:1,escalationEpisodes:1,oracleInvocations:1}};
  f.OracleResult={...f.OracleResult,specHash:f.TaskSpec.specHash,assignmentHash:f.AssignmentEnvelope.assignmentHash,evidenceRefs:['evidence']};
  const ctx=context(f);ctx.records=ctx.records.filter(r=>!['spec','assignment','state'].includes(r.id));
  ctx.records.push({id:'spec',kind:'TaskSpec',value:f.TaskSpec},{id:'assignment',kind:'AssignmentEnvelope',value:f.AssignmentEnvelope},
    {id:'state',kind:'WorkflowState',value:f.WorkflowState});
  const body={schemaVersion:1,taskId:'task',assignmentId:'assignment',escalationId:'escalation',question:'Why?',objective:'Implement',
    requirements:f.AssignmentEnvelope.requirements,acceptanceCriteria:f.AssignmentEnvelope.acceptanceCriteria,constraints:f.AssignmentEnvelope.constraints,
    triggerFailures:[f.FailureRecord],evidenceRefs:['evidence'],unresolvedAmbiguities:['Cause is not yet established']};
  const packet={...body,packetHash:oracle.oraclePacketHash(body)};
  return {f,ctx,packet};
}
function fakeHost({root,result,selectedContext='fresh',fork=false,mutate=false,toolNames=['read','structured_output'],agent='controlled.oracle',
  history='',childContext=selectedContext,omitOutput=false}={}){
  const tasks=[],bus=new Bus(),state=mkdtempSync(join(tmpdir(),'controlled-oracle-state-')),parentFile=join(state,'parent.jsonl');
  writeFileSync(parentFile,'parent');let active=false,disposed=0,run,spawns=0;
  bus.on('pi-subagents:runtime-agent-register:v1',request=>{if(active){request.result={ok:false,error:new Error('collision')};return}
    active=true;request.result={ok:true,registration:{dispose(){if(active){active=false;disposed++}}}}});
  bus.on('subagents:rpc:v1:request',request=>{
    const reply=data=>bus.emit('subagents:rpc:v1:reply:'+request.requestId,{version:1,requestId:request.requestId,method:request.method,success:true,data});
    if(request.method==='ping')return reply({version:1,methods:['ping','spawn','status','interrupt','stop','resume'],
      capabilities:{status:true,asyncSpawn:true,interrupt:true,stop:true,resume:true,...(fork?{fork:{version:1,currentLeafId:'leaf'}}:{})},
      events:{request:'subagents:rpc:v1:request',replyPrefix:'subagents:rpc:v1:reply:',ready:'subagents:rpc:v1:ready',asyncComplete:'subagents:complete'},
      session:{sessionId:'owner',sessionFile:fork?parentFile:null}});
    if(request.method==='spawn'){
      tasks.push(request.params.task);spawns++;assert.equal(request.params.context,selectedContext);run='oracle-run';reply({text:'spawned',details:{asyncId:run,runId:run}});
      queueMicrotask(()=>{if(mutate)writeFileSync(join(root,'canary.txt'),'changed');const sessionFile=join(state,'child.jsonl');
        writeFileSync(sessionFile,[{type:'session',cwd:root},{type:'message',message:{role:'system',sections:{preamble:`<active_agent name="${agent}"/>${history}`},toolsAdded:toolNames.map(name=>({name}))}},
          {type:'message',message:{role:'assistant',content:[{type:'toolCall',name:'read'},{type:'toolCall',name:'structured_output'}]}}].map(JSON.stringify).join('\n'));
        const child={agent,context:childContext,success:true,status:'completed',sessionFile,launchContractDigest:'f'.repeat(64),
          launchResolvedExtensions:{version:1,source:'launch-resolved',disableAmbientExtensions:true,runtime:['internal'],configured:[],required:[],effective:['internal']},
          acceptance:{explicit:false,status:'attested'}};if(!omitOutput)child.structuredOutput=result;
        bus.emit('subagents:complete',{id:run,runId:run,sessionId:'owner',success:true,state:'complete',exitCode:0,results:[child]});});return;
    }
    if(request.method==='status')return reply({text:'complete',asyncSnapshot:{kind:'pi-subagents.async-status-snapshot',version:1,runs:[{id:run,state:'complete'}]}});
    return reply({text:'ok',details:{}});
  });
  return {bus,state,parentFile,tasks,get active(){return active},get disposed(){return disposed},get spawns(){return spawns}};
}
const clean=(root,host)=>{rmSync(root,{recursive:true,force:true});rmSync(host.state,{recursive:true,force:true})};

await test('P9-001 — Oracle CLA-001 is deterministic, advisory, read-only and fork-capable only by policy',()=>{
  assert.equal(oracle.ORACLE_LAUNCH_CONTRACT_HASH,api.hashCanonical(oracle.ORACLE_LAUNCH_CONTRACT));
  assert.equal(api.validateContract('ControlledLaunchContract',oracle.ORACLE_LAUNCH_CONTRACT).ok,true);
  assert.deepEqual(oracle.ORACLE_LAUNCH_CONTRACT.capabilityConstraints.operationIds,['OP-01']);
  assert.deepEqual(oracle.ORACLE_LAUNCH_CONTRACT.contextPolicy,{schemaVersion:1,defaultContext:'fresh',allowedContexts:['fork','fresh']});
  assert.deepEqual(oracle.ORACLE_RUNTIME_DEFINITION.tools,['read']);assert.equal(oracle.ORACLE_RUNTIME_DEFINITION.allowNestedSubagents,false);
  for(const key of ['model','provider','thinking','fast'])assert.equal(Object.hasOwn(oracle.ORACLE_RUNTIME_DEFINITION,key),false);
});

await test('P9-002 TEST-032 — process-local Oracle registration collision and idempotent disposal',()=>{
  assert.equal(oracle.registerControlledOracle({events:new Bus()},'generation'),undefined);
  const root=workspace(),{f}=setup(root),host=fakeHost({root,result:f.OracleResult});
  const first=oracle.registerControlledOracle({events:host.bus},'generation');assert.ok(first.active());
  assert.throws(()=>oracle.registerControlledOracle({events:host.bus},'other'),/collision/);
  first.dispose();first.dispose();assert.equal(host.disposed,1);assert.equal(first.active(),false);clean(root,host);
});

await test('P9-003 TEST-006 — fresh Oracle result is bound advisory data with attributed runtime evidence',async()=>{
  const root=workspace(),{f,ctx,packet}=setup(root),host=fakeHost({root,result:f.OracleResult});
  const registration=oracle.registerControlledOracle({events:host.bus},'generation'),runner=new oracle.ControlledOracleRunner(registration,host.bus,'owner');
  const run=await runner.run(f.AssignmentEnvelope,packet,ctx,{historyCanary:'PARENT_ONLY'});
  assert.deepEqual(run.result,f.OracleResult);assert.equal(run.evidence.context,'fresh');assert.equal(run.evidence.packetHash,packet.packetHash);
  assert.equal(run.evidence.escalationId,'escalation');assert.equal(run.evidence.filesystemUnchanged,true);assert.equal(run.evidence.noSilentFallback,true);
  assert.deepEqual(run.evidence.effectiveTools,['read','structured_output']);
  await assert.rejects(runner.run(f.AssignmentEnvelope,packet,ctx),e=>e.code==='ORACLE_ESCALATION_ALREADY_DISPATCHED');assert.equal(host.spawns,1);
  runner.dispose();registration.dispose();clean(root,host);
});

await test('P9-004 DATA-006 — closed packet, exact escalation and attributed output fail closed before acceptance',async()=>{
  const root=workspace(),base=setup(root),host=fakeHost({root,result:{...base.f.OracleResult,evidenceRefs:['unknown']}}),registration=oracle.registerControlledOracle({events:host.bus},'generation');
  const runner=new oracle.ControlledOracleRunner(registration,host.bus,'owner');
  await assert.rejects(runner.run(base.f.AssignmentEnvelope,{...base.packet,extra:true},base.ctx),e=>e.code==='ORACLE_ESCALATION_PACKET_INVALID');assert.equal(host.spawns,0);
  await assert.rejects(runner.run(base.f.AssignmentEnvelope,base.packet,base.ctx),e=>e.code==='ORACLE_OUTPUT_INVALID');
  runner.dispose();registration.dispose();clean(root,host);
});

for(const [label,options,code] of [
  ['filesystem mutation',{mutate:true},'ORACLE_READ_ONLY_CANARY_CHANGED'],
  ['effective mutation tool',{toolNames:['read','structured_output','write']},'ORACLE_RUNTIME_IDENTITY_MISMATCH'],
  ['wrong runtime context',{childContext:'fork'},'ORACLE_RUNTIME_IDENTITY_MISMATCH'],
  ['fresh history leakage',{history:'PARENT_SECRET'},'ORACLE_HISTORY_CONTEXT_MISMATCH'],
]) await test(`P9-005 TEST-006/037 — hostile ${label} fails closed`,async()=>{
  const root=workspace(),{f,ctx,packet}=setup(root),host=fakeHost({root,result:f.OracleResult,...options}),registration=oracle.registerControlledOracle({events:host.bus},'generation');
  const runner=new oracle.ControlledOracleRunner(registration,host.bus,'owner');
  await assert.rejects(runner.run(f.AssignmentEnvelope,packet,ctx,{historyCanary:'PARENT_SECRET'}),e=>e.code===code);
  runner.dispose();registration.dispose();clean(root,host);
});

await test('P9-006 TEST-037 — requested fork without advertised capability does not dispatch or fall back',async()=>{
  const root=workspace(),{f,ctx,packet}=setup(root,'fork'),host=fakeHost({root,result:f.OracleResult,selectedContext:'fork'}),registration=oracle.registerControlledOracle({events:host.bus},'generation');
  const runner=new oracle.ControlledOracleRunner(registration,host.bus,'owner');
  await assert.rejects(runner.run(f.AssignmentEnvelope,packet,ctx,{historyCanary:'PARENT_FORK',forkEvidence:{parentSessionId:'owner',parentSessionFile:host.parentFile,currentLeafId:'leaf',capabilityEvidenceRefs:['fork-cap']}}),e=>e.code==='ORACLE_FORK_UNAVAILABLE');
  assert.equal(host.spawns,0);runner.dispose();registration.dispose();clean(root,host);
});

await test('P9-007 TEST-037 — verified fork preserves explicit context and parent/child lineage',async()=>{
  const root=workspace(),{f,ctx,packet}=setup(root,'fork'),host=fakeHost({root,result:f.OracleResult,selectedContext:'fork',fork:true,history:'PARENT_FORK'}),registration=oracle.registerControlledOracle({events:host.bus},'generation');
  const runner=new oracle.ControlledOracleRunner(registration,host.bus,'owner');
  const run=await runner.run(f.AssignmentEnvelope,packet,ctx,{historyCanary:'PARENT_FORK',forkEvidence:{parentSessionId:'owner',parentSessionFile:host.parentFile,currentLeafId:'leaf',capabilityEvidenceRefs:['fork-cap']}});
  assert.equal(run.evidence.context,'fork');assert.equal(run.evidence.parentSessionFile,host.parentFile);assert.equal(run.evidence.currentLeafId,'leaf');
  assert.notEqual(run.evidence.childSessionId,host.parentFile);assert.equal(host.spawns,1);runner.dispose();registration.dispose();clean(root,host);
});

await test('P9-008 — invalid authority, inactive generation and missing structured output have stable Oracle errors',async()=>{
  const root=workspace(),base=setup(root),host=fakeHost({root,result:base.f.OracleResult,omitOutput:true}),registration=oracle.registerControlledOracle({events:host.bus},'generation');
  const runner=new oracle.ControlledOracleRunner(registration,host.bus,'owner');
  const excessive={...base.f.AssignmentEnvelope,authority:['OP-01','OP-05']};
  await assert.rejects(runner.run(excessive,base.packet,base.ctx),e=>['ORACLE_ASSIGNMENT_INVALID','ORACLE_AUTHORITY_INVALID'].includes(e.code));
  await assert.rejects(runner.run(base.f.AssignmentEnvelope,base.packet,base.ctx),e=>e.code==='ORACLE_OUTPUT_MISSING');
  runner.dispose();registration.dispose();assert.throws(()=>new oracle.ControlledOracleRunner(registration,host.bus,'owner'),e=>e.code==='ORACLE_REGISTRATION_INACTIVE');clean(root,host);
});

await test('domain profile reaches native Oracle dispatch without replacing core guidance or authority (provider double)',async t=>{
  const root=workspace(),{f,ctx,packet}=setup(root),host=fakeHost({root,result:f.OracleResult});
  const developmentProfile={schemaVersion:1,id:'systemist_factory',common:['Preserve requirement source links'],phases:{Oracle:['Domain method for Oracle'],ProjectPlanning:['Planning only marker']}};
  const registration=oracle.registerControlledOracle({events:host.bus},'generation');
  t.after(()=>{registration.dispose();clean(root,host)});
  const output=await oracle.runOracle(f.AssignmentEnvelope,packet,{registration,events:host.bus,ownerSessionId:'owner',validationContext:ctx,developmentProfile});
  assert.deepEqual(output.result,f.OracleResult);
  assert.match(host.tasks[0],/Preserve requirement source links/);assert.match(host.tasks[0],/Domain method for Oracle/);
  assert.doesNotMatch(host.tasks[0],/Planning only marker/);assert.match(host.tasks[0],/Technical PASS does not establish system requirement compliance/);
  assert.deepEqual(output.evidence.effectiveTools,['read','structured_output']);
});
