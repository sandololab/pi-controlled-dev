import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { installSourceLoader } from './load-source.mjs';
installSourceLoader();
const api=await import('../src/contracts.ts');
const {hashCanonical,canonicalize}=api;
const {fixtures}=await import('./contract-fixtures.mjs');
const {verifyBeforeCompletionFreshness,beforeCompletionStaleReason}=await import('../src/orchestrator.ts');
const {ProductionTaskInputError,diagnoseProductionBaseline,inspectProductionTaskInput,readProductionTaskInput,requestBeforeCompletionConfirmation,runProductionWorkflow}
  =await import('../src/production-bridge.ts');

const {LockManager}=await import('../src/lock-manager.ts');
const {ScopeGuard}=await import('../src/scope-guard.ts');

const H='a'.repeat(64),snapshot={gateId:'gate',taskId:'task',stateRevision:9,specHash:H,candidateDigest:H,
  candidateGeneration:1,approvedDataHash:H,completionPackageHash:H,sessionId:'session'};
const current={gateId:'gate',taskId:'task',state:'AWAITING_HUMAN',stateRevision:9,specHash:H,candidateDigest:H,
  candidateGeneration:1,approvedDataHash:H,completionPackageHash:H,sessionId:'session',taskLockHeld:true,workspaceLockHeld:true,gateStatus:'PENDING'};

test('P14F beforeCompletion freshness is conjunctive; stale/replay/lost-lock paths fail closed',()=>{
  assert.equal(verifyBeforeCompletionFreshness(snapshot,current),true);
  for(const patch of [{gateId:'other'},{taskId:'other'},{state:'REVIEWING'},{stateRevision:10},{specHash:'b'.repeat(64)},
    {candidateDigest:'b'.repeat(64)},{candidateGeneration:2},{approvedDataHash:'b'.repeat(64)},
    {completionPackageHash:'b'.repeat(64)},{sessionId:'other'},{taskLockHeld:false},{workspaceLockHeld:false},
    {gateStatus:'APPROVED'},{gateStatus:'CONSUMED'}])
    assert.equal(verifyBeforeCompletionFreshness(snapshot,{...current,...patch}),false,JSON.stringify(patch));
});

test('P14F.7 each freshness mismatch has a bounded precise reason',()=>{
  for(const [reason,patch] of [
    ['GATE_ID_CHANGED',{gateId:'other'}],['TASK_ID_CHANGED',{taskId:'other'}],['STATE_REVISION_CHANGED',{stateRevision:10}],
    ['SPEC_HASH_CHANGED',{specHash:'b'.repeat(64)}],['CANDIDATE_DIGEST_CHANGED',{candidateDigest:'b'.repeat(64)}],
    ['CANDIDATE_GENERATION_CHANGED',{candidateGeneration:2}],['APPROVED_DATA_HASH_CHANGED',{approvedDataHash:'b'.repeat(64)}],
    ['COMPLETION_PACKAGE_HASH_CHANGED',{completionPackageHash:'b'.repeat(64)}],['SESSION_CHANGED',{sessionId:'other'}],
    ['TASK_LOCK_LOST',{taskLockHeld:false}],['WORKSPACE_LOCK_LOST',{workspaceLockHeld:false}],['GATE_STATUS_CHANGED',{gateStatus:'INVALIDATED'}],
  ])assert.equal(beforeCompletionStaleReason(snapshot,{...current,...patch}),reason);
  assert.equal(beforeCompletionStaleReason(snapshot,current),null);
});

test('P14F approved data uses the normative canonical hash',()=>{
  const approved={schemaVersion:1,objective:'change',specHash:H,baselineCommit:'1'.repeat(40),candidateDigest:H,candidateGeneration:1,
    manifestRef:{id:'manifest'},patchRef:{id:'patch'},validation:[],reviewResult:{verdict:'PASS'},reviewRef:'review',residualRisks:[],decisions:[],completionPackageHash:H};
  assert.equal(hashCanonical(JSON.parse(canonicalize(approved))),hashCanonical(approved));
  assert.notEqual(hashCanonical({...approved,objective:'other'}),hashCanonical(approved));
});

function context(confirm,mode='tui'){
  let session='session';return {ctx:{mode,cwd:'/',sessionManager:{getSessionId:()=>session},ui:{notify(){},confirm}},setSession:value=>{session=value}};
}
test('P14F native false and UI exception are NOT_CONFIRMED test doubles, never approval',async()=>{
  assert.equal(await requestBeforeCompletionConfirmation(context(async()=>false).ctx,'{}'),false);
  assert.equal(await requestBeforeCompletionConfirmation(context(async()=>{throw new Error('escape')}).ctx,'{}'),false);
});
test('recovery commands use the shared confirmation frame and default cancellation performs no operation',async()=>{
  const {default:extension}=await import('../extensions/controlled-dev.ts');
  for(const action of ['repair','recover','reconcile','resume']){
    const handlers=new Map(),messages=[];let command,customCalls=0,fallbackCalls=0,frame;
    extension({registerCommand(_name,c){command=c.handler},events:{on(){return()=>{}},emit(name,r){
      if(name==='pi-subagents:runtime-agent-register:v1')r.result={ok:true,registration:{dispose(){}}};
    }},getAllTools:()=>[],setActiveTools(){},on(name,fn){handlers.set(name,fn)}});
    const ctx={cwd:'/unused-confirmation-test',mode:'tui',sessionManager:{getSessionId:()=> 'ui-host'},ui:{
      notify(message){messages.push(message)},async confirm(){fallbackCalls++;return false},
      custom:factory=>new Promise(resolve=>{
        customCalls++;
        const component=factory({requestRender(){},terminal:{rows:30}},null,null,resolve);
        frame=component.render(80);
        component.handleInput('\r');
      })}};
    handlers.get('session_start')({},ctx);
    await command(action,ctx);
    assert.equal(customCalls,1,action);assert.equal(fallbackCalls,0,action);
    assert.equal(frame[0],'Controlled Dev | Confirmation');
    const titles={repair:/Check the interrupted save\?/,recover:/Acquire control of the interrupted task\?/,reconcile:/Check the previous Reviewer's status\?/,resume:/Resume the task from the verified point\?/};
    assert.match(frame.join('\n'),titles[action]);
    if(action==='reconcile')assert.match(frame.join('\n'),/only a read-only check/);
    assert.match(frame.join('\n'),/No, go back/);assert.match(frame.join('\n'),/Yes, confirm/);
    assert.deepEqual(messages,[],`${action} must stop before accessing a task or dispatching work`);
    handlers.get('session_shutdown')();
  }
});
test('P14F native confirmation requires TUI, session, boolean true and unchanged host binding',async()=>{
  await assert.rejects(requestBeforeCompletionConfirmation(context(async()=>true,'json').ctx,'{}'),/HUMAN_CHANNEL_UNAVAILABLE/);
  await assert.rejects(requestBeforeCompletionConfirmation(context(async()=>true,'rpc').ctx,'{}'),/HUMAN_CHANNEL_UNAVAILABLE/);
  const missing=context(async()=>true);missing.setSession(undefined);await assert.rejects(requestBeforeCompletionConfirmation(missing.ctx,'{}'),/HUMAN_CHANNEL_UNAVAILABLE/);
  assert.equal(await requestBeforeCompletionConfirmation(context(async()=>1).ctx,'{}'),false);
  const changed=context(async()=>{changed.setSession('foreign');return true});assert.equal(await requestBeforeCompletionConfirmation(changed.ctx,'{}'),false);
  assert.equal(await requestBeforeCompletionConfirmation(context(async()=>true).ctx,'{}'),true);
});

function project(t){
  const root=mkdtempSync(join(tmpdir(),'production-task-input-')),data=mkdtempSync(join(tmpdir(),'production-control-'));
  const previous=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=data;
  t.after(()=>{if(previous===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=previous;
    rmSync(root,{recursive:true,force:true});rmSync(data,{recursive:true,force:true})});
  const control=join(data,'controlled-dev','control',api.hashBytes(Buffer.from(root)));mkdirSync(control,{recursive:true});
  const f=fixtures(api),spec={...f.TaskSpec,scope:{...f.ScopeSpec,repoRoot:root},validationCommands:[{...f.CommandSpec,executable:process.execPath,argv:['-e','process.exit(0)']}],
    humanGates:{...f.GatePolicy,beforeImplementation:false,onOracleDecision:false,onRetryExhausted:false}};
  spec.specHash=api.hashContract('TaskSpec',spec);return {root,data,control,path:join(control,'task.json'),spec};
}
const writeSpec=p=>writeFileSync(p.path,canonicalize(p.spec));

for(const kind of ['missing','symlink','directory','fifo','parent-symlink','regular'])test(`P14F.2 filesystem ordering: ${kind}`,async t=>{
  const p=project(t);
  if(kind==='symlink')symlinkSync(join(p.root,'absent-target'),p.path);
  if(kind==='directory')mkdirSync(p.path);
  if(kind==='fifo')execFileSync('mkfifo',[p.path]);
  if(kind==='parent-symlink'){
    const parent=join(p.data,'other');mkdirSync(parent);rmSync(p.control,{recursive:true});symlinkSync(parent,p.control);writeSpec(p);
  }
  if(kind==='regular')writeSpec(p);
  let reads=0,locks=0,dispatches=0;
  const original=fs.readFileSync;
  t.mock.method(fs,'readFileSync',(...args)=>{if(args[0]===p.path)reads++;return original(...args)});syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports()});
  t.mock.method(LockManager.prototype,'acquire',()=>{locks++;throw new Error('unexpected lock')});
  const host={ownerSessionId:'session',current:undefined,initialize(){dispatches++;throw new Error('unexpected dispatch')}};
  const ctx={...context(async()=>true).ctx,cwd:p.root};
  if(kind==='regular'){assert.equal(readProductionTaskInput(ctx).spec.specHash,p.spec.specHash);assert.equal(reads,1)}
  else{await assert.rejects(runProductionWorkflow(host,ctx),/CONTROLLED_DEV_TASK_INPUT_(MISSING|INVALID)/);assert.equal(reads,0)}
  assert.equal(locks,0);assert.equal(dispatches,0);
});

function baseline(t){
  const p=project(t),git=(...args)=>execFileSync('git',['-C',p.root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  writeFileSync(join(p.root,'file.txt'),'base\n');writeFileSync(join(p.root,'.gitignore'),'.pi/settings.json\n.pi/controlled-dev-task.json\n');
  git('init','-q');git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture');
  const commit=git('rev-parse','HEAD'),work=join(p.root,'..',`${p.root.split('/').at(-1)}-candidate`);
  git('worktree','add','--quiet','--detach',work,commit);t.after(()=>rmSync(work,{recursive:true,force:true}));
  return {...p,git,commit,work};
}
test('P14F.4 command records typed failure without parent fallback and retains UNKNOWN locks',async t=>{
  const b=baseline(t);writeSpec(b);
  const {default:extension}=await import('../extensions/controlled-dev.ts');
  const {ControlledScoutRunner,ControlledScoutError}=await import('../src/controlled-scout.ts');
  let attempts=0,command;const handlers=new Map(),messages=[];
  t.mock.method(ControlledScoutRunner.prototype,'run',async()=>{attempts++;throw new ControlledScoutError('INVALID_STRUCTURED_OUTPUT',
    {role:'Scout',contract:'DATA-003/ScoutResult',validationLayer:'structural',path:'$.relevantFiles[0]',reasonCode:'PATH',runId:'unknown-probe',outputClass:'object'})});
  extension({registerCommand(_name,c){command=c.handler},events:{on(){return()=>{}},emit(name,r){
    if(name==='pi-subagents:runtime-agent-register:v1')r.result={ok:true,registration:{dispose(){}}};
  }},getAllTools:()=>[{name:'read',sourceInfo:{source:'builtin',path:'<builtin:read>'}}],setActiveTools(){},
    on(name,fn){const list=handlers.get(name)??[];list.push(fn);handlers.set(name,list);return()=>{}}});
  const ctx={cwd:b.root,mode:'tui',sessionManager:{getSessionId:()=> 'test-host'},ui:{notify(m){messages.push(m)},async confirm(){assert.fail('no human gate')}}};
  for(const fn of handlers.get('session_start'))fn({},ctx);
  await command('run',ctx);assert.equal(attempts,1);assert.match(messages[0],/agent.*incomplete or invalid data/);assert.doesNotMatch(messages[0],/INVALID_STRUCTURED_OUTPUT/);
  await command('status --technical',ctx);const status=JSON.parse(messages[1]);
  assert.equal(status.state,'BLOCKED');assert.equal(status.lastFailure.reasonCode,'PATH');
  assert.equal(status.lastFailure.failure.category,'SCHEMA');assert.equal(status.lastFailure.route,'BLOCKED');
  assert.match(status.lastFailure.failure.fingerprint,/^[a-f0-9]{64}$/);
  assert.deepEqual(status.locks,{taskLockHeld:true,workspaceLockHeld:true});
  for(const toolName of ['subagents_enable','subagent_supervisor','write','edit','bash'])assert.equal(handlers.get('tool_call')[0]({toolName}).block,true);
  await command('run',ctx);assert.equal(attempts,1);await command('status --technical',ctx);assert.equal(JSON.parse(messages.at(-1)).lastFailure.code,'WORKFLOW_ALREADY_ACTIVE');
  for(const fn of handlers.get('session_shutdown'))fn({},ctx);
});

test('P14F.3 clean target admits external input and ScopeGuard with no local control files',t=>{
  const b=baseline(t);writeSpec(b);
  assert.equal(readProductionTaskInput({cwd:b.root}).spec.specHash,b.spec.specHash);
  assert.equal(fs.existsSync(join(b.root,'.pi')),false);
  const d=diagnoseProductionBaseline(b.root,'HEAD');assert.equal(d.reasonCode,'PASS');
  for(const field of ['gitStatus','indexState','untrackedState','ignoredState'])assert.equal(d[field],'');
  assert.doesNotThrow(()=>ScopeGuard.open(b.spec.scope,b.work,b.commit));
});
test('P14F.3 wrong repo-hash and arbitrary external files cannot select task input',t=>{
  const p=project(t),wrong=join(p.data,'controlled-dev','control','0'.repeat(64));mkdirSync(wrong);
  writeFileSync(join(wrong,'task.json'),canonicalize(p.spec));writeFileSync(join(p.data,'arbitrary.json'),canonicalize(p.spec));
  assert.throws(()=>readProductionTaskInput({cwd:p.root,path:join(p.data,'arbitrary.json')}),/CONTROLLED_DEV_TASK_INPUT_MISSING/);
  assert.equal(inspectProductionTaskInput({cwd:p.root}).exists,false);
});
test('P14F.3 wrong TaskSpec repo binding and data root inside target are rejected',t=>{
  const p=project(t);p.spec.scope.repoRoot=p.data;p.spec.specHash=api.hashContract('TaskSpec',p.spec);writeSpec(p);
  assert.throws(()=>readProductionTaskInput({cwd:p.root}),/CONTROLLED_DEV_TASK_INPUT_INVALID/);
  process.env.PI_CODING_AGENT_DIR=p.root;
  assert.throws(()=>readProductionTaskInput({cwd:p.root}),/CONTROLLED_DEV_TASK_INPUT_INVALID/);
});
test('P14F.2 clean HEAD and same-commit named ref resolve; unknown ref rejects',t=>{
  const b=baseline(t),d=diagnoseProductionBaseline(b.root,'HEAD');
  assert.equal(d.reasonCode,'PASS');assert.equal(d.headCommit,b.commit);assert.equal(d.resolvedBaseCommit,b.commit);
  assert.equal(d.indexState,'');assert.equal(d.untrackedState,'');assert.equal(d.gitStatus,'');
  b.git('branch','alias');assert.equal(diagnoseProductionBaseline(b.root,'alias').reasonCode,'PASS');
  assert.doesNotThrow(()=>ScopeGuard.open({...b.spec.scope,baseRef:'alias'},b.work,b.commit));
  assert.equal(diagnoseProductionBaseline(b.root,'absent-ref').reasonCode,'BASE_REF_UNRESOLVED');
});
for(const kind of ['tracked','index','untracked','ignored-controls','head-moved'])test(`P14F.2 baseline classification/P11 rejection: ${kind}`,t=>{
  const b=baseline(t),guard=ScopeGuard.open(b.spec.scope,b.work,b.commit);
  if(kind==='tracked'||kind==='index'){writeFileSync(join(b.root,'file.txt'),'changed\n');if(kind==='index')b.git('add','file.txt')}
  if(kind==='untracked')writeFileSync(join(b.root,'extra.txt'),'new');
  if(kind==='ignored-controls'){mkdirSync(join(b.root,'.pi'));writeFileSync(join(b.root,'.pi','controlled-dev-task.json'),canonicalize(b.spec));writeFileSync(join(b.root,'.pi','settings.json'),'{}')}
  if(kind==='head-moved')b.git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-qm','moved');
  const d=diagnoseProductionBaseline(b.root,'HEAD');
  // The original host predicate checks ref equality only; never mislabel this as its failure.
  assert.equal(d.reasonCode,'PASS');
  if(kind==='tracked')assert.match(d.gitStatus,/M file.txt/);
  if(kind==='index')assert.match(d.indexState,/file.txt/);
  if(kind==='untracked')assert.match(d.untrackedState,/extra.txt/);
  if(kind==='ignored-controls'){assert.equal(d.gitStatus,'');assert.match(d.ignoredState,/\.pi\/settings.json/);assert.match(d.ignoredState,/controlled-dev-task.json/)}
  if(kind==='head-moved')assert.notEqual(d.headCommit,b.commit);
  assert.throws(()=>guard.capture(1,'test-proof'),/SCOPE_ORIGINAL_CHANGED/);
  assert.throws(()=>ScopeGuard.open(b.spec.scope,b.work,b.commit),/SCOPE_BASELINE_INVALID/);
});

test('P14F.1 missing task input is typed, friendly, and leaks no raw ENOENT',t=>{
  const p=project(t),status=inspectProductionTaskInput({cwd:p.root});assert.deepEqual(status,{source:'host-control-plane',path:p.path,exists:false,valid:false});
  assert.throws(()=>readProductionTaskInput({cwd:p.root}),error=>error instanceof ProductionTaskInputError
    &&error.code==='CONTROLLED_DEV_TASK_INPUT_MISSING'&&error.message.includes(`Expected: ${p.path}`)&&!error.message.includes('ENOENT'));
});
test('P14F.1 malformed, unknown-field and semantic-invalid TaskSpec fail closed',t=>{
  const p=project(t);
  for(const input of ['{',{...p.spec,approved:true},{...p.spec,specHash:'0'.repeat(64)}]){
    writeFileSync(p.path,typeof input==='string'?input:JSON.stringify(input));
    assert.throws(()=>readProductionTaskInput({cwd:p.root}),/CONTROLLED_DEV_TASK_INPUT_INVALID/);
    assert.deepEqual(inspectProductionTaskInput({cwd:p.root}),{source:'host-control-plane',path:p.path,exists:true,valid:false});
  }
});
test('P14F.3 task path is host-derived outside repo and rejects symlinks',t=>{
  const p=project(t),outside=join(p.root,'outside.json');writeFileSync(outside,canonicalize(p.spec));symlinkSync(outside,p.path);
  assert.throws(()=>readProductionTaskInput({cwd:p.root}),/CONTROLLED_DEV_TASK_INPUT_INVALID/);
});
test('P14F.1 valid input reuses normalized semantic TaskSpec and reports only hash metadata',t=>{
  const p=project(t);writeSpec(p);const loaded=readProductionTaskInput({cwd:p.root});
  assert.equal(loaded.spec.specHash,p.spec.specHash);assert.equal(Object.isFrozen(loaded.spec),true);assert.equal(loaded.artifacts.length,1);
  assert.deepEqual(inspectProductionTaskInput({cwd:p.root}),{source:'host-control-plane',path:p.path,exists:true,valid:true,specHash:p.spec.specHash});
});
test('P14F.1 invalid input acquires no lock and dispatches no child',async t=>{
  const p=project(t);writeFileSync(p.path,'{}');let initialized=0;
  const host={ownerSessionId:'session',current:undefined,initialize(){initialized++;throw new Error('DISPATCHED')}};
  const ctx={mode:'tui',cwd:p.root,sessionManager:{getSessionId:()=> 'session'},ui:{notify(){},async confirm(){return true}}};
  await assert.rejects(runProductionWorkflow(host,ctx),/CONTROLLED_DEV_TASK_INPUT_INVALID/);assert.equal(initialized,0);
  assert.equal(execFileSync('find',[p.root,'-name','*.lock'],{encoding:'utf8'}).trim(),'');
});
test('P14F.1 unresolved baseline is typed before locks or dispatch',async t=>{
  const p=project(t);writeSpec(p);let initialized=0;
  const host={ownerSessionId:'session',current:undefined,initialize(){initialized++}};
  const ctx={mode:'tui',cwd:p.root,sessionManager:{getSessionId:()=> 'session'},ui:{notify(){},async confirm(){return true}}};
  await assert.rejects(runProductionWorkflow(host,ctx),e=>e.code==='CONTROLLED_DEV_TASK_BASELINE_INVALID'&&e.reasonCode==='HEAD_UNRESOLVED');assert.equal(initialized,0);
  assert.equal(execFileSync('find',[p.root,'-name','*.lock'],{encoding:'utf8'}).trim(),'');
});
