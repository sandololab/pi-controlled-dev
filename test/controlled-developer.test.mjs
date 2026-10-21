import {memoryForRole} from './project-memory-fixture.mjs';
import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { installSourceLoader } from './load-source.mjs';
import { loadContracts } from './load-contracts.mjs';
import { fixtures, context } from './contract-fixtures.mjs';
installSourceLoader();
const developer=await import('../src/controlled-developer.ts');
const scout=await import('../src/controlled-scout.ts');
const api=await loadContracts();
const { inventoryTree, inventoryHash }=await import('../src/controlled-agent-runtime.ts');
const { isolateParentTools }=await import('../extensions/controlled-dev.ts');
const { ScopeGuard }=await import('../src/scope-guard.ts');

class Bus{
  map=new Map();
  on(name,fn){const set=this.map.get(name)??new Set();set.add(fn);this.map.set(name,set);return()=>set.delete(fn)}
  emit(name,data){for(const fn of [...(this.map.get(name)??[])])fn(data)}
}
const git=(cwd,args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8'}).trim();
function workspace(beforePrepare=()=>{}){
  const parent=mkdtempSync(join(tmpdir(),'controlled-developer-')),repo=join(parent,'original'),work=join(parent,'candidate');mkdirSync(repo);
  git(repo,['init','-q']);git(repo,['config','user.email','test@example.invalid']);git(repo,['config','user.name','Test']);
  writeFileSync(join(repo,'allowed.txt'),'before\n');writeFileSync(join(repo,'outside.txt'),'unchanged\n');
  git(repo,['add','.']);git(repo,['commit','-qm','baseline']);const baseCommit=git(repo,['rev-parse','HEAD']);
  beforePrepare({parent,repo,work,baseCommit});
  git(repo,['worktree','add','--quiet','--detach',work,baseCommit]);return {parent,repo,work,baseCommit};
}
function packet(ws){
  const f=fixtures(api);const scope={...f.TaskSpec.scope,repoRoot:ws.repo,allowedPaths:['allowed.txt'],deniedPaths:[]};
  f.TaskSpec={...f.TaskSpec,scope};f.TaskSpec.specHash=api.hashContract('TaskSpec',f.TaskSpec);
  f.AssignmentEnvelope={...f.AssignmentEnvelope,role:'Developer',specHash:f.TaskSpec.specHash,repoRoot:ws.repo,workRoot:ws.work,
    baseRef:'HEAD',baseCommit:ws.baseCommit,allowedPaths:['allowed.txt'],deniedPaths:[],authority:['OP-01','OP-02'],
    launchContractHash:developer.DEVELOPER_LAUNCH_CONTRACT_HASH};
  f.AssignmentEnvelope.assignmentHash=api.hashContract('AssignmentEnvelope',f.AssignmentEnvelope);
  f.DeveloperResult={schemaVersion:1,taskId:f.AssignmentEnvelope.taskId,assignmentId:f.AssignmentEnvelope.assignmentId,
    attemptId:f.AssignmentEnvelope.attemptId,role:'Developer',specHash:f.TaskSpec.specHash,assignmentHash:f.AssignmentEnvelope.assignmentHash,
    evidenceRefs:[],summary:'Updated allowed file',changedFiles:['allowed.txt'],commandsRun:[],tests:[],residualRisks:[]};
  f.WorkflowState={...f.WorkflowState,specHash:f.TaskSpec.specHash,baselineCommit:ws.baseCommit};
  const ctx=context(f);ctx.records=ctx.records.filter(r=>!['spec','assignment'].includes(r.id));
  ctx.records.push({id:'spec',kind:'TaskSpec',value:f.TaskSpec},{id:'assignment',kind:'AssignmentEnvelope',value:f.AssignmentEnvelope});
  return {f,ctx};
}
function fakeHost({ws,result,mutate=()=>writeFileSync(join(ws.work,'allowed.txt'),'after\n'),toolNames=['edit','read','structured_output','write'],
  invoked=['read','edit','structured_output'],agent='controlled.developer',contextName='fresh',historyLeak=''}={}){
  const tasks=[];
  const bus=new Bus(),state=mkdtempSync(join(tmpdir(),'controlled-developer-state-')),active=new Set();let disposed=0,spawns=0,run;
  bus.on(scout.RUNTIME_AGENT_REGISTER_EVENT,request=>{
    if(active.has(request.name)){request.result={ok:false,error:new Error('collision')};return}
    active.add(request.name);request.result={ok:true,registration:{dispose(){if(active.delete(request.name))disposed++}}};
  });
  bus.on('subagents:rpc:v1:request',request=>{
    const reply=data=>bus.emit('subagents:rpc:v1:reply:'+request.requestId,{version:1,requestId:request.requestId,method:request.method,success:true,data});
    if(request.method==='ping')return reply({version:1,methods:['ping','spawn','status','interrupt','stop','resume'],
      capabilities:{status:true,asyncSpawn:true,steer:true,interrupt:true,stop:true,resume:true},
      events:{request:'subagents:rpc:v1:request',replyPrefix:'subagents:rpc:v1:reply:',ready:'subagents:rpc:v1:ready',asyncComplete:'subagents:complete'},
      session:{sessionId:'owner',sessionFile:null}});
    if(request.method==='spawn'){
      tasks.push(request.params.task);
      assert.match(request.params.task,/Host validation runs after your handoff/);
      assert.match(request.params.task,/blockedReason means you cannot deliver the currently assigned step/);
      assert.match(request.params.task,/changedFiles:\[\] and no blockedReason/);
      assert.match(request.params.task,/Keep blockedReason for genuine current obstacles/);
      assert.match(request.params.task,/risk id host-validation-pending, blocking:false/);
      assert.match(request.params.task,/Preserve any other genuine risks separately/);
      assert.match(request.params.task,/Software design and code quality/);
      assert.match(request.params.task,/Name variables for the values they hold, functions for the operations they perform, and classes for their cohesive responsibility/);
      assert.match(request.params.task,/timeoutMs.*sampleRateHz/);
      assert.match(request.params.task,/Do not compress several decisions or mutations onto one line/);
      assert.match(request.params.task,/provide or update a concise module comment or module docstring/);
      assert.match(request.params.task,/Keep comments consistent with the implementation/);
      assert.match(request.params.task,/Architecture finding or Design expectation/);
      assert.match(request.params.task,/Design rationale:/);
      spawns++;run='run-1';reply({text:'spawned',details:{asyncId:run,runId:run}});queueMicrotask(()=>{
        mutate();const sessionFile=join(state,'child.jsonl');
        const lines=[{type:'session',cwd:ws.work},{type:'message',message:{role:'system',sections:{preamble:`<active_agent name="${agent}"/>${historyLeak}`},toolsAdded:toolNames.map(name=>({name}))}},
          {type:'message',message:{role:'assistant',content:invoked.map(name=>({type:'toolCall',name}))}}];
        writeFileSync(sessionFile,lines.map(JSON.stringify).join('\n'));
        bus.emit('subagents:complete',{id:run,runId:run,sessionId:'owner',success:true,state:'complete',exitCode:0,results:[{agent,context:contextName,
          success:true,status:'completed',sessionFile,launchContractDigest:'f'.repeat(64),launchResolvedExtensions:{version:1,source:'launch-resolved',
          disableAmbientExtensions:true,runtime:['internal'],configured:[],required:[],effective:['internal']},structuredOutput:result,
          acceptance:{explicit:false,status:'not-required'}}]});
      });return;
    }
    if(request.method==='status')return reply({text:'complete',details:{},asyncSnapshot:{kind:'pi-subagents.async-status-snapshot',version:1,runs:[{id:run,state:'complete'}]}});
    return reply({text:'ok',details:{}});
  });
  return {bus,state,tasks,active,get disposed(){return disposed},get spawns(){return spawns}};
}
function cleanup(ws,host){rmSync(host?.state,{recursive:true,force:true});rmSync(ws.parent,{recursive:true,force:true})}
async function execute(ws,p,hostOptions={}){
  const host=fakeHost({ws,result:p.f.DeveloperResult,...hostOptions});
  const registration=developer.registerControlledDeveloper({events:host.bus},'generation');
  const runner=new developer.ControlledDeveloperRunner(registration,host.bus,'owner');
  try{return {output:await runner.run(p.f.AssignmentEnvelope,p.ctx,{historyCanary:'PARENT_HISTORY_CANARY'}),host}}
  finally{runner.dispose();registration.dispose()}
}

await test('P7-001 — deterministic Developer authority contract is minimal and closed',()=>{
  assert.equal(developer.DEVELOPER_LAUNCH_CONTRACT_HASH,api.hashCanonical(developer.DEVELOPER_LAUNCH_CONTRACT));
  assert.deepEqual(developer.DEVELOPER_RUNTIME_DEFINITION.tools,['edit','read','write']);
  assert.deepEqual(developer.DEVELOPER_LAUNCH_CONTRACT.capabilityConstraints.operationIds,['OP-01','OP-02']);
  assert.deepEqual(developer.DEVELOPER_RUNTIME_DEFINITION.mutationTools,['edit','write']);
  assert.equal(developer.DEVELOPER_RUNTIME_DEFINITION.allowNestedSubagents,false);
  for(const key of ['model','provider','thinking','fast'])assert.equal(Object.hasOwn(developer.DEVELOPER_RUNTIME_DEFINITION,key),false);
});

await test('P7-002 — process-local registration collision, generation and idempotent lifecycle',()=>{
  const absent=developer.registerControlledDeveloper({events:new Bus()},'generation');assert.equal(absent,undefined);
  const ws=workspace(),p=packet(ws),host=fakeHost({ws,result:p.f.DeveloperResult});
  const scoutRegistration=scout.registerControlledScout({events:host.bus},'generation');
  const registration=developer.registerControlledDeveloper({events:host.bus},'generation');assert.ok(registration.active());
  assert.throws(()=>developer.registerControlledDeveloper({events:host.bus},'other'),/collision/);
  registration.dispose();registration.dispose();scoutRegistration.dispose();assert.equal(host.disposed,2);cleanup(ws,host);
});

await test('P7-003 — isolated worktree run changes only the allowed file with attributed fresh evidence',async()=>{
  const ws=workspace(),p=packet(ws),{output,host}=await execute(ws,p);
  assert.equal(readFileSync(join(ws.repo,'allowed.txt'),'utf8'),'before\n');assert.equal(readFileSync(join(ws.work,'allowed.txt'),'utf8'),'after\n');
  assert.deepEqual(output.evidence.changedFiles,['allowed.txt']);assert.deepEqual(output.evidence.effectiveTools,['edit','read','structured_output','write']);
  assert.equal(output.evidence.context,'fresh');assert.equal(output.evidence.originalWorkspaceUnchanged,true);cleanup(ws,host);
});
await test('host baseline evidence is delivered without granting commands and copied evidence never reaches the provider',async()=>{
 const {DurableStore}=await import('../src/store.ts'),{captureDeveloperBaseline}=await import('../src/developer-baseline.ts');
 const ws=workspace(),p=packet(ws);mkdirSync(join(ws.parent,'profile'));const store=DurableStore.create(join(ws.parent,'profile'),ws.repo,p.f.TaskSpec.taskId,()=> 'ACCEPT');
 const state={...p.f.WorkflowState,repoRoot:ws.repo,spec:store.writeSpec(p.f.TaskSpec)},baseline=captureDeveloperBaseline(p.f.TaskSpec,state,ws.work,store);
 p.f.AssignmentEnvelope.inputArtifactRefs=[...p.f.AssignmentEnvelope.inputArtifactRefs,...baseline.evidence.evidenceRefs];p.f.AssignmentEnvelope.assignmentHash=api.hashContract('AssignmentEnvelope',p.f.AssignmentEnvelope);p.f.DeveloperResult.assignmentHash=p.f.AssignmentEnvelope.assignmentHash;
 p.ctx.records=p.ctx.records.filter(r=>r.id!==p.f.AssignmentEnvelope.assignmentId).concat([{id:p.f.AssignmentEnvelope.assignmentId,kind:'AssignmentEnvelope',value:p.f.AssignmentEnvelope},...baseline.artifacts.map(ref=>({id:ref.id,kind:'ArtifactRef',value:ref}))]);
 const host=fakeHost({ws,result:p.f.DeveloperResult}),registration=developer.registerControlledDeveloper({events:host.bus},'generation'),runner=new developer.ControlledDeveloperRunner(registration,host.bus,'owner');
 try{
  await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.ctx,{baselineEvidence:{...baseline.evidence}}),/DEVELOPER_BASELINE_INVALID/);assert.equal(host.spawns,0);
  const output=await runner.run(p.f.AssignmentEnvelope,p.ctx,{baselineEvidence:baseline.evidence});assert.deepEqual(output.result.commandsRun,[]);assert.match(host.tasks[0],/run by the host.*BEFORE/);assert.match(host.tasks[0],/Checks after the changes will be new/);
 }finally{runner.dispose();registration.dispose();cleanup(ws,host)}
});

await test('P7-004 — non-Git, original checkout, dirty baseline and strong-confinement assignments never dispatch',async()=>{
  const ws=workspace(),p=packet(ws),host=fakeHost({ws,result:p.f.DeveloperResult}),registration=developer.registerControlledDeveloper({events:host.bus},'generation');
  const runner=new developer.ControlledDeveloperRunner(registration,host.bus,'owner');
  const variants=[];
  const same={...p.f.AssignmentEnvelope,workRoot:ws.repo,assignmentHash:'0'.repeat(64)};variants.push(same);
  writeFileSync(join(ws.repo,'dirty.txt'),'dirty');variants.push(p.f.AssignmentEnvelope);
  for(const value of variants)await assert.rejects(runner.run(value,p.ctx),error=>['INVALID_ASSIGNMENT','DEVELOPER_WORKSPACE_NOT_ISOLATED'].includes(error.code));
  const strong={...p.f.TaskSpec,scope:{...p.f.TaskSpec.scope,strongConfinementRequired:true}};strong.specHash=api.hashContract('TaskSpec',strong);
  const a={...p.f.AssignmentEnvelope,specHash:strong.specHash};a.assignmentHash=api.hashContract('AssignmentEnvelope',a);
  const ctx={...p.ctx,records:p.ctx.records.filter(r=>!['spec','assignment'].includes(r.id)).concat([{id:'spec',kind:'TaskSpec',value:strong},{id:'assignment',kind:'AssignmentEnvelope',value:a}])};
  await assert.rejects(runner.run(a,ctx),error=>error.code==='DEVELOPER_WORKSPACE_NOT_ISOLATED');assert.equal(host.spawns,0);
  runner.dispose();registration.dispose();cleanup(ws,host);
});

for(const [label,mutation,code] of [
  ['outside scope',ws=>writeFileSync(join(ws.work,'outside.txt'),'bad\n'),'DEVELOPER_SCOPE_VIOLATION'],
  ['original checkout',ws=>writeFileSync(join(ws.repo,'allowed.txt'),'bad\n'),'ORIGINAL_WORKSPACE_CHANGED'],
  ['Git metadata',ws=>writeFileSync(join(ws.work,'.git'),'bad\n'),'DEVELOPER_SCOPE_VIOLATION'],
])await test(`P7-005 — hostile ${label} mutation fails closed`,async()=>{
  const ws=workspace(),p=packet(ws),host=fakeHost({ws,result:p.f.DeveloperResult,mutate:()=>mutation(ws)}),registration=developer.registerControlledDeveloper({events:host.bus},'generation');
  const runner=new developer.ControlledDeveloperRunner(registration,host.bus,'owner');
  await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.ctx),error=>error.code===code);
  runner.dispose();registration.dispose();cleanup(ws,host);
});

await test('P7-006 — shell, delegation, wrong context and parent history evidence fail closed',async()=>{
  for(const options of [
    {toolNames:['bash','edit','read','structured_output','write']},
    {toolNames:['edit','read','structured_output','subagent','write']},
    {invoked:['bash']},
    {contextName:'fork'},
    {historyLeak:'PARENT_HISTORY_CANARY'},
  ]){
    const ws=workspace(),p=packet(ws),host=fakeHost({ws,result:p.f.DeveloperResult,...options}),registration=developer.registerControlledDeveloper({events:host.bus},'generation');
    const runner=new developer.ControlledDeveloperRunner(registration,host.bus,'owner');
    await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.ctx,{historyCanary:'PARENT_HISTORY_CANARY'}));
    runner.dispose();registration.dispose();cleanup(ws,host);
  }
});

await test('P7-007 — authority mismatch and COMPLETED/state injection are rejected',async()=>{
  for(const injected of [{completed:true},{state:'COMPLETED'},{approved:true},{reviewVerdict:'PASS'}]){
    const ws=workspace(),p=packet(ws),bad={...p.f.DeveloperResult,...injected};
    const host=fakeHost({ws,result:bad}),registration=developer.registerControlledDeveloper({events:host.bus},'generation'),runner=new developer.ControlledDeveloperRunner(registration,host.bus,'owner');
    await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.ctx),error=>error.code==='INVALID_STRUCTURED_OUTPUT');runner.dispose();registration.dispose();cleanup(ws,host);
  }
  const ws2=workspace(),p2=packet(ws2),host2=fakeHost({ws:ws2,result:p2.f.DeveloperResult}),registration2=developer.registerControlledDeveloper({events:host2.bus},'generation'),runner2=new developer.ControlledDeveloperRunner(registration2,host2.bus,'owner');
  const excessive={...p2.f.AssignmentEnvelope,authority:['OP-01','OP-02','OP-08']};excessive.assignmentHash=api.hashContract('AssignmentEnvelope',excessive);
  await assert.rejects(runner2.run(excessive,p2.ctx),error=>['INVALID_ASSIGNMENT','LAUNCH_CONTRACT_MISMATCH'].includes(error.code));assert.equal(host2.spawns,0);
  runner2.dispose();registration2.dispose();cleanup(ws2,host2);
});

await test('FORENSIC — worktree preparation alone changes only linked Git administration, not original content/index/HEAD',()=>{
  let before,index,head;
  const ws=workspace(({repo})=>{before=inventoryTree(repo);index=readFileSync(join(repo,'.git/index'));head=readFileSync(join(repo,'.git/HEAD'))});
  try{
    const after=inventoryTree(ws.repo),changed=[...new Set([...before.keys(),...after.keys()])].filter(path=>before.get(path)!==after.get(path));
    assert.ok(changed.length>0);
    assert.ok(changed.every(path=>path==='.git/worktrees'||path.startsWith('.git/worktrees/candidate')),JSON.stringify(changed));
    assert.deepEqual(readFileSync(join(ws.repo,'.git/index')),index);assert.deepEqual(readFileSync(join(ws.repo,'.git/HEAD')),head);
    assert.equal(git(ws.repo,['--no-optional-locks','status','--porcelain=v1','--untracked-files=all']),'');
    assert.equal(readFileSync(join(ws.repo,'allowed.txt'),'utf8'),'before\n');
    const original=lstatSync(join(ws.repo,'allowed.txt')),candidate=lstatSync(join(ws.work,'allowed.txt'));
    assert.equal(original.nlink,1);assert.equal(candidate.nlink,1);assert.notDeepEqual([original.dev,original.ino],[candidate.dev,candidate.ino]);
  }finally{rmSync(ws.parent,{recursive:true,force:true})}
});

await test('staged initial handoff without a current blocker preserves the unchanged candidate for host validation',async()=>{
  const ws=workspace(),p=packet(ws);p.f.DeveloperResult.changedFiles=[];
  delete p.f.DeveloperResult.blockedReason;
  p.f.DeveloperResult.residualRisks=[{schemaVersion:1,id:'later-rework',text:'Correction requires a failed host validation and new authorization.',criterionIds:['criterion'],blocking:false}];
  const host=fakeHost({ws,result:p.f.DeveloperResult,mutate:()=>{},invoked:['read','structured_output']}),registration=developer.registerControlledDeveloper({events:host.bus},'generation');
  const runner=new developer.ControlledDeveloperRunner(registration,host.bus,'owner'),before=inventoryHash(inventoryTree(ws.repo));
  try{const output=await runner.run(p.f.AssignmentEnvelope,p.ctx);assert.deepEqual(output.result,p.f.DeveloperResult);assert.equal(output.result.blockedReason,undefined);assert.deepEqual(output.evidence.changedFiles,[]);assert.equal(output.evidence.originalWorkspaceUnchanged,true);
    assert.equal(inventoryHash(inventoryTree(ws.repo)),before);runner.dispose();registration.dispose();assert.equal(inventoryHash(inventoryTree(ws.repo)),before);
  }finally{runner.dispose();registration.dispose();cleanup(ws,host)}
});

await test('Developer handoff guidance never removes a reported current blocker',async()=>{
  const ws=workspace(),p=packet(ws);p.f.DeveloperResult.changedFiles=[];
  p.f.DeveloperResult.blockedReason='The required implementation file is outside the permitted scope.';
  const host=fakeHost({ws,result:p.f.DeveloperResult,mutate:()=>{},invoked:['read','structured_output']}),registration=developer.registerControlledDeveloper({events:host.bus},'generation');
  const runner=new developer.ControlledDeveloperRunner(registration,host.bus,'owner');
  try{assert.deepEqual((await runner.run(p.f.AssignmentEnvelope,p.ctx)).result,p.f.DeveloperResult)}
  finally{runner.dispose();registration.dispose();cleanup(ws,host)}
});

await test('FORENSIC — parent completion listener writing original is rejected independently of valid candidate edit',async()=>{
  const ws=workspace(),p=packet(ws),host=fakeHost({ws,result:p.f.DeveloperResult});
  host.bus.on('subagents:complete',()=>writeFileSync(join(ws.repo,'allowed.txt'),'after\n'));
  const registration=developer.registerControlledDeveloper({events:host.bus},'generation'),runner=new developer.ControlledDeveloperRunner(registration,host.bus,'owner');
  try{await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.ctx),error=>error.code==='ORIGINAL_WORKSPACE_CHANGED');
    assert.equal(readFileSync(join(ws.work,'allowed.txt'),'utf8'),'after\n');assert.equal(readFileSync(join(ws.repo,'allowed.txt'),'utf8'),'after\n');assert.equal(host.spawns,1);
  }finally{runner.dispose();registration.dispose();cleanup(ws,host)}
});

for(const [label,mutation] of [
  ['HEAD identity with unchanged commit',ws=>git(ws.repo,['checkout','-qb','other'])],
  ['index-only flags with clean status',ws=>{git(ws.repo,['update-index','--assume-unchanged','allowed.txt']);assert.equal(git(ws.repo,['status','--porcelain=v1']),'')}],
  ['untracked original file',ws=>writeFileSync(join(ws.repo,'unexpected.txt'),'host or child write')],
  ['tracked executable mode',ws=>chmodSync(join(ws.repo,'allowed.txt'),0o755)],
  ['late host worktree creation',ws=>git(ws.repo,['worktree','add','--quiet','--detach',join(ws.parent,'late'),ws.baseCommit])],
])await test(`FORENSIC — ${label} remains an original integrity violation`,async()=>{
  const ws=workspace(),p=packet(ws),host=fakeHost({ws,result:p.f.DeveloperResult,mutate:()=>mutation(ws)});
  const registration=developer.registerControlledDeveloper({events:host.bus},'generation'),runner=new developer.ControlledDeveloperRunner(registration,host.bus,'owner');
  try{await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.ctx),error=>error.code==='ORIGINAL_WORKSPACE_CHANGED');assert.equal(host.spawns,1)}
  finally{runner.dispose();registration.dispose();cleanup(ws,host)}
});

function parentRuntime(){
  const bus=new Bus();let active=['read','write','edit','bash','subagents_enable'];
  const tools=[{name:'read',sourceInfo:{source:'builtin',path:'<builtin:read>'}}];
  isolateParentTools({on:(name,handler)=>bus.on(name,handler),getAllTools:()=>tools,setActiveTools:names=>{active=names}});
  bus.emit('session_start',{});
  return {bus,tools,get active(){return active},reactivate(names){active=names},call(name,execute){
    if(!active.includes(name))return 'NOT_EXPOSED';
    for(const handler of bus.map.get('tool_call')??[])if(handler({toolName:name})?.block)return 'BLOCKED';
    return execute();
  }};
}

for(const role of ['Scout','Developer','Reviewer','Oracle'])await test(`P12.1 — ${role} notification cannot grant parent original or candidate mutation`,()=>{
  const ws=workspace(),parent=parentRuntime(),before=inventoryHash(inventoryTree(ws.repo)),candidate=inventoryHash(inventoryTree(ws.work));
  try{
    // Native completion may start an ordinary model turn. No cooperation by that model is assumed.
    parent.bus.emit('before_agent_start',{notification:role});assert.deepEqual(parent.active,['read']);
    assert.equal(parent.call('read',()=>readFileSync(join(ws.repo,'allowed.txt'),'utf8')),'before\n');
    assert.equal(parent.call('read',()=>readFileSync(join(ws.work,'allowed.txt'),'utf8')),'before\n');
    let executed=0;
    for(const [name,mutation] of [
      ['write',()=>writeFileSync(join(ws.repo,'allowed.txt'),'bad')],
      ['edit',()=>writeFileSync(join(ws.work,'allowed.txt'),'parent candidate edit')],
      ['bash',()=>writeFileSync(join(ws.repo,'untracked'),'status change')],
      ['bash',()=>git(ws.repo,['update-index','--assume-unchanged','allowed.txt'])],
      ['bash',()=>git(ws.repo,['checkout','-qb','parent-head'])],
      ['bash',()=>chmodSync(join(ws.repo,'allowed.txt'),0o755)],
      ['late_allocator',()=>git(ws.repo,['worktree','add','--quiet','--detach',join(ws.parent,'late'),ws.baseCommit])],
      ['subagent',()=>writeFileSync(join(ws.work,'outside.txt'),'delegated bypass')],
      ['subagents_enable',()=>writeFileSync(join(ws.repo,'allowed.txt'),'lazy bypass')],
    ]){
      assert.equal(parent.call(name,()=>{executed++;mutation()}),'NOT_EXPOSED');
      // Simulate runtime late registration/reactivation AFTER the exposure filter.
      parent.reactivate(['read',name]);
      assert.equal(parent.call(name,()=>{executed++;mutation()}),'BLOCKED');
      parent.bus.emit('before_agent_start',{});
    }
    assert.equal(executed,0);assert.equal(inventoryHash(inventoryTree(ws.repo)),before);assert.equal(inventoryHash(inventoryTree(ws.work)),candidate);
    assert.equal(git(ws.repo,['--no-optional-locks','status','--porcelain=v1']),'');assert.equal(git(ws.repo,['rev-parse','HEAD']),ws.baseCommit);
  }finally{rmSync(ws.parent,{recursive:true,force:true})}
});

await test('P12.1 — gate persists across disposal, delayed notifications, new turns and session start',()=>{
  const parent=parentRuntime();let calls=0;
  for(const event of ['session_shutdown','before_agent_start','before_agent_start','session_start']){
    parent.bus.emit(event,{});parent.reactivate(['write','unknown_late_tool']);
    for(const tool of parent.active)assert.equal(parent.call(tool,()=>calls++),'BLOCKED');
  }
  assert.equal(calls,0);
});

await test('P12.1 — unavailable or extension-shadowed read is not a read-only capability',()=>{
  const parent=parentRuntime();let calls=0;
  for(const metadata of [undefined,{source:'extension',path:'custom-read'},{source:'sdk',path:'<sdk:read>'}]){
    parent.tools[0].sourceInfo=metadata;parent.bus.emit('before_agent_start',{});assert.deepEqual(parent.active,[]);
    parent.reactivate(['read']);assert.equal(parent.call('read',()=>calls++),'BLOCKED');
  }
  assert.equal(calls,0);
});

await test('P12.1 — parent isolation does not remove the independent Developer allowed write',async()=>{
  const ws=workspace(),p=packet(ws),parent=parentRuntime();let host;
  try{
    assert.deepEqual(parent.active,['read']);
    const completed=await execute(ws,p);host=completed.host;
    assert.deepEqual(completed.output.evidence.changedFiles,['allowed.txt']);
    assert.equal(readFileSync(join(ws.work,'allowed.txt'),'utf8'),'after\n');assert.equal(readFileSync(join(ws.repo,'allowed.txt'),'utf8'),'before\n');
    parent.bus.emit('before_agent_start',{notification:'Developer'});parent.reactivate(['write']);
    assert.equal(parent.call('write',()=>writeFileSync(join(ws.work,'allowed.txt'),'parent bypass')),'BLOCKED');
    assert.equal(readFileSync(join(ws.work,'allowed.txt'),'utf8'),'after\n');
  }finally{if(host)cleanup(ws,host);else rmSync(ws.parent,{recursive:true,force:true})}
});

async function reworkFixture(){
  const ws=workspace(),initial=packet(ws),guard=ScopeGuard.open(initial.f.TaskSpec.scope,ws.work,ws.baseCommit);
  const first=await execute(ws,initial);const capture=guard.capture(1,JSON.stringify(first.output.evidence));
  const base=guard.prepareRework(capture,join(ws.parent,'rework')),nextWs={...ws,work:base.workRoot,baseCommit:base.baseCommit},p=packet(nextWs);
  p.f.WorkflowState.baselineCommit=ws.baseCommit;p.f.WorkflowState.candidate=capture.candidate;p.f.WorkflowState.counters={...p.f.WorkflowState.counters,attempts:2,dispatches:2,reworkAttempts:1};
  p.f.WorkflowState.revision=1;p.f.WorkflowState.state='IMPLEMENTING';p.f.WorkflowState.repoRoot=ws.repo;
  Object.assign(p.f.AssignmentEnvelope,{candidateDigest:capture.digest,candidateGeneration:1,inputArtifactRefs:[...p.f.AssignmentEnvelope.inputArtifactRefs,...base.evidenceRefs]});
  p.f.AssignmentEnvelope.assignmentHash=api.hashContract('AssignmentEnvelope',p.f.AssignmentEnvelope);
  p.f.DeveloperResult.assignmentHash=p.f.AssignmentEnvelope.assignmentHash;
  p.ctx.records.push(...capture.artifacts.map(value=>({id:value.id,kind:'ArtifactRef',value})));
  const checked=api.validateContract('AssignmentEnvelope',p.f.AssignmentEnvelope,p.ctx);assert.equal(checked.ok,true,JSON.stringify(checked));
  return {ws,nextWs,p,guard,base,first};
}

await test('P12.4 — original baseline differs from host-authorized rework base, valid isolated rework admitted',async()=>{
  const {ws,nextWs,p,guard,base,first}=await reworkFixture(),before=inventoryHash(inventoryTree(ws.repo));
  const host=fakeHost({ws:nextWs,result:p.f.DeveloperResult,mutate:()=>writeFileSync(join(nextWs.work,'allowed.txt'),'reworked\n')}),reg=developer.registerControlledDeveloper({events:host.bus},'g'),runner=new developer.ControlledDeveloperRunner(reg,host.bus,'owner');
  try{
    assert.notEqual(base.baseCommit,ws.baseCommit);assert.equal(git(nextWs.work,['status','--porcelain=v1']),'');
    const output=await runner.run(p.f.AssignmentEnvelope,p.ctx,{reworkBase:base});assert.equal(host.spawns,1);
    assert.equal(inventoryHash(inventoryTree(ws.repo)),before);assert.deepEqual(output.evidence.changedFiles,['allowed.txt']);
    const c=guard.finishRework(base,JSON.stringify(output.evidence));assert.equal(c.generation,2);assert.equal(c.candidate.baseCommit,ws.baseCommit);
    assert.equal(readFileSync(join(ws.work,'allowed.txt'),'utf8'),'reworked\n');assert.equal(readFileSync(join(ws.repo,'allowed.txt'),'utf8'),'before\n');
  }finally{runner.dispose();reg.dispose();rmSync(first.host.state,{recursive:true,force:true});cleanup(ws,host)}
});

for(const [label,alter,code] of [
  ['forged host capability',x=>x.base={...x.base},'DEVELOPER_REWORK_BASE_MISMATCH'],
  ['stale generation with identical digest',x=>x.p.f.WorkflowState.candidate={...x.p.f.WorkflowState.candidate,generation:2},'DEVELOPER_REWORK_GENERATION_STALE'],
  ['arbitrary assignment base',x=>x.p.f.AssignmentEnvelope.baseCommit=x.ws.baseCommit,'DEVELOPER_REWORK_BASE_MISMATCH'],
  ['clean but unauthorized intermediate commit',x=>{git(x.nextWs.work,['commit','--allow-empty','-qm','unauthorized']);x.p.f.AssignmentEnvelope.baseCommit=git(x.nextWs.work,['rev-parse','HEAD'])},'DEVELOPER_REWORK_BASE_MISMATCH'],
  ['original changed before dispatch',x=>writeFileSync(join(x.ws.repo,'allowed.txt'),'mutated'),'DEVELOPER_WORKSPACE_NOT_ISOLATED'],
  ['worktree base moved',x=>git(x.nextWs.work,['reset','--hard',x.ws.baseCommit]),'DEVELOPER_WORKROOT_BASE_MISMATCH'],
  ['missing host authorization',x=>x.base=undefined,'DEVELOPER_REWORK_BASE_MISMATCH'],
])await test(`P12.4 — ${label} never dispatches`,async()=>{
  const x=await reworkFixture();alter(x);x.p.f.AssignmentEnvelope.assignmentHash=api.hashContract('AssignmentEnvelope',x.p.f.AssignmentEnvelope);
  const host=fakeHost({ws:x.nextWs,result:x.p.f.DeveloperResult}),reg=developer.registerControlledDeveloper({events:host.bus},'g'),runner=new developer.ControlledDeveloperRunner(reg,host.bus,'owner');
  try{await assert.rejects(runner.run(x.p.f.AssignmentEnvelope,x.p.ctx,{reworkBase:x.base}),e=>e.code===code);assert.equal(host.spawns,0)}
  finally{runner.dispose();reg.dispose();rmSync(x.first.host.state,{recursive:true,force:true});cleanup(x.ws,host)}
});

await test('P12.4 — initial attempt cannot choose a non-baseline commit',async()=>{
  const ws=workspace(),p=packet(ws);p.f.AssignmentEnvelope.baseCommit='f'.repeat(40);p.f.AssignmentEnvelope.assignmentHash=api.hashContract('AssignmentEnvelope',p.f.AssignmentEnvelope);
  const h=fakeHost({ws,result:p.f.DeveloperResult}),reg=developer.registerControlledDeveloper({events:h.bus},'g'),runner=new developer.ControlledDeveloperRunner(reg,h.bus,'owner');
  try{await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.ctx),e=>e.code==='DEVELOPER_INITIAL_BASE_MISMATCH');assert.equal(h.spawns,0)}
  finally{runner.dispose();reg.dispose();cleanup(ws,h)}
});

await test('P14B — durable Developer refuses missing capability before spawn',async()=>{
  const ws=workspace(),p=packet(ws),host=fakeHost({ws,result:p.f.DeveloperResult}),reg=developer.registerControlledDeveloper({events:host.bus},'g');
  const runner=new developer.ControlledDeveloperRunner(reg,host.bus,'owner');let observed=false;
  try{await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.ctx,{onTerminalProof:()=>{observed=true}}),/TERMINAL_PROOF_CAPABILITY_UNAVAILABLE/);
    assert.equal(host.spawns,0);assert.equal(observed,false);assert.equal(readFileSync(join(ws.work,'allowed.txt'),'utf8'),'before\n');
  }finally{runner.dispose();reg.dispose();cleanup(ws,host)}
});
await test('P14B — successful Developer output without terminal proof cannot return a handoff',async()=>{
  const ws=workspace(),p=packet(ws),host=fakeHost({ws,result:p.f.DeveloperResult}),emit=host.bus.emit.bind(host.bus);
  host.bus.emit=(name,data)=>{if(data?.method==='ping'&&data.success)data.data.capabilities.processTerminalProof={version:1,lifecycleArtifactVersion:3};emit(name,data)};
  const reg=developer.registerControlledDeveloper({events:host.bus},'g'),runner=new developer.ControlledDeveloperRunner(reg,host.bus,'owner');let observed=false;
  try{await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.ctx,{onTerminalProof:()=>{observed=true}}),/TERMINAL_PROOF_UNAVAILABLE/);
    assert.equal(host.spawns,1);assert.equal(observed,false);assert.equal(readFileSync(join(ws.repo,'allowed.txt'),'utf8'),'before\n');
  }finally{runner.dispose();reg.dispose();cleanup(ws,host)}
});

await test('P7-008 — declared files must match host-observed changes; Developer tests remain report data',async()=>{
  const ws=workspace(),p=packet(ws);p.f.DeveloperResult={...p.f.DeveloperResult,changedFiles:[],tests:[{schemaVersion:1,id:'reported',text:'Looks good',evidenceRefs:['evidence']}],evidenceRefs:['evidence']};
  const host=fakeHost({ws,result:p.f.DeveloperResult}),registration=developer.registerControlledDeveloper({events:host.bus},'generation'),runner=new developer.ControlledDeveloperRunner(registration,host.bus,'owner');
  await assert.rejects(runner.run(p.f.AssignmentEnvelope,p.ctx),error=>error.code==='DEVELOPER_CHANGED_FILES_MISMATCH');
  runner.dispose();registration.dispose();cleanup(ws,host);
});

test('Project Memory is injected by the real Developer runner without new writer permissions',async t=>{
 const ws=workspace(),p=packet(ws),host=fakeHost({ws,result:p.f.DeveloperResult});t.after(()=>cleanup(ws,host));
 const memory=await memoryForRole(ws.repo,host.state,p.f.AssignmentEnvelope),registration=developer.registerControlledDeveloper({events:host.bus},'memory-generation'),runner=new developer.ControlledDeveloperRunner(registration,host.bus,'owner');
 p.f.DeveloperResult.memoryProposals=[memory.proposal];
 try{const output=await runner.run(p.f.AssignmentEnvelope,p.ctx,{projectMemory:memory.projectMemory});assert.deepEqual(output.memoryProposals,[memory.proposal]);assert.equal('memoryProposals' in output.result,false);assert.ok(host.tasks[0].includes('\n'+memory.selection.text));assert.match(host.tasks[0],/structured_output is the separate required delivery protocol and is permitted/);assert.match(host.tasks[0],/ScenarioRepository/);assert.ok(memory.receipts.some(r=>r.receipt.delivery==='PROVIDER_ACKNOWLEDGED'))}
 finally{runner.dispose();registration.dispose()}
});

await test('domain profile reaches native Developer dispatch without replacing core guidance or authority (provider double)',async t=>{
  const ws=workspace(),{f,ctx}=packet(ws),host=fakeHost({ws,result:f.DeveloperResult});
  const developmentProfile={schemaVersion:1,id:'systemist_factory',common:['Preserve requirement source links'],phases:{Developer:['Domain method for Developer'],ProjectPlanning:['Planning only marker']}};
  const registration=developer.registerControlledDeveloper({events:host.bus},'generation');
  t.after(()=>{registration.dispose();cleanup(ws,host)});
  const output=await developer.runDeveloper(f.AssignmentEnvelope,{registration,events:host.bus,ownerSessionId:'owner',validationContext:ctx,developmentProfile});
  assert.deepEqual(output.result,f.DeveloperResult);
  assert.match(host.tasks[0],/Preserve requirement source links/);assert.match(host.tasks[0],/Domain method for Developer/);
  assert.doesNotMatch(host.tasks[0],/Planning only marker/);assert.match(host.tasks[0],/Technical PASS does not establish system requirement compliance/);
  assert.deepEqual(output.evidence.effectiveTools,['edit','read','structured_output','write']);
});
