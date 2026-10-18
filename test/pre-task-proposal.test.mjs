import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installSourceLoader } from './load-source.mjs';
installSourceLoader();
const {planningProposal}=await import('./greenfield-bootstrap-fixture.mjs');
const {PreTaskScout,preTaskRequest,validatePreTaskProposal,proposalDraft,PRE_TASK_SCOUT_NAME,TASK_PROPOSAL_TIMEOUT_MS}=await import('../src/pre-task-proposal.ts');
const {hashCanonical}=await import('../src/contract-json.ts');
const {validateContract}=await import('../src/contracts.ts');
const {inventoryTree,sourceFileIndex}=await import('../src/controlled-agent-runtime.ts');
const EVENT='subagent:async-complete',REQUEST='subagents:rpc:v1:request';
const proposal=q=>({schemaVersion:1,phase:'PRE_TASK_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:hashCanonical(q),relevantFiles:['README.md'],proposedScope:['README.md'],acceptanceCriteria:['Document the objective'],existingTests:[],validations:[{kind:'REVIEW',description:'Reviewer verifies the documented objective',paths:['README.md'],expectedLines:[]}],architectureFindings:['The repository keeps user documentation in README.md'],designExpectations:['Extend the existing documentation instead of adding a parallel guide'],ambiguities:[],risks:[],explanation:'Proposal for user editing, not authority'});
// Public provider/runtime double, explicitly NOT a real Scout or human E2E certification.
class Bus {
  listeners=new Map();requests=[];definition;output;tools=['read','structured_output'];disposed=false;invalid=false;
  constructor(root,repo){this.root=root;this.repo=repo;this.session=join(root,'provider-session.jsonl')}
  on(name,fn){const s=this.listeners.get(name)??new Set();s.add(fn);this.listeners.set(name,s);return()=>s.delete(fn)}
  emit(name,data){
    if(name==='pi-subagents:runtime-agent-register:v1'){assert.equal(data.name,PRE_TASK_SCOUT_NAME);this.definition=data.definition;data.result={ok:true,registration:{dispose:()=>{this.disposed=true}}};return}
    if(name!==REQUEST){for(const f of this.listeners.get(name)??[])f(data);return}
    this.requests.push(data);let value;
    if(data.method==='ping')value={version:1,methods:['ping','spawn','status','interrupt','stop','resume'],session:{sessionId:'owner',sessionFile:null},events:{asyncComplete:EVENT},capabilities:{asyncSpawn:true,status:true,interrupt:true,stop:true,resume:true,processTerminalProof:{version:1,lifecycleArtifactVersion:3}}};
    else if(data.method==='spawn'){
      assert.equal(data.params.cwd,this.repo);assert.equal(data.params.context,'fresh');
      this.runState=this.failed?'failed':'complete';
      const q=JSON.parse(data.params.task.split('\nREQUEST=')[1].split('\nrequestHash=')[0]);this.output=(this.proposalFactory??proposal)(q);if(this.invalid)this.output.authority=true;
      writeFileSync(this.session,[{type:'session',cwd:this.repo},{type:'message',message:{role:'system',sections:{preamble:`<active_agent name="${PRE_TASK_SCOUT_NAME}"/>`},toolsAdded:this.tools.map(name=>({name}))}},...(this.failed?[{type:'message',message:{role:'assistant',stopReason:'error',errorMessage:'fetch failed',content:[]}}]:[])].map(JSON.stringify).join('\n'));
      value={details:{asyncId:'proposal-run',runId:'proposal-run'}};
    }else value={details:{lifecycleStatus:{processTerminal:{version:1,state:'observed',runId:this.foreignProof?'foreign-run':'proposal-run',runnerProcessInstanceId:'instance',observedAt:1,instances:[{kind:'runner',processInstanceId:'instance',closeObservedAt:1,exitCode:this.runState==='failed'?1:0,signal:null}],resumeDisposition:'resumable'}}},asyncSnapshot:{version:1,kind:'pi-subagents.async-status-snapshot',runs:[{id:'proposal-run',state:this.statusOverride??this.runState}]}};
    if(this.noProof&&data.method!=='spawn'&&data.method!=='ping')delete value.details.lifecycleStatus.processTerminal;
    this.emit(`subagents:rpc:v1:reply:${data.requestId}`,{version:1,requestId:data.requestId,success:true,data:value});
    if(data.method==='spawn')this.emit(EVENT,{id:'proposal-run',runId:'proposal-run',sessionId:'owner',state:this.failed?'failed':'complete',success:!this.failed,exitCode:this.failed?1:0,results:[{agent:PRE_TASK_SCOUT_NAME,context:this.foreignContext?'fork':'fresh',sessionFile:this.session,status:this.failed?'failed':'completed',success:!this.failed,...(this.failed?{}:{structuredOutput:this.output}),launchResolvedExtensions:{version:1,source:'launch-resolved',disableAmbientExtensions:true,configured:[],required:[],runtime:['structured-output'],effective:['structured-output']}}]});
    if(data.method==='spawn')this.afterSpawn?.();
  }
}
function setup(t){const root=mkdtempSync(join(tmpdir(),'pre-task-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const repo=join(root,'repo');mkdirSync(repo);writeFileSync(join(repo,'README.md'),'Before\n');return {root,repo,bus:new Bus(root,repo)}}
test('provider fetch failure is diagnosed separately from malformed output and a verified exit permits a fresh explicit attempt',async t=>{
 const {root,repo,bus}=setup(t),scout=new PreTaskScout(bus,'owner');bus.failed=true;
 await assert.rejects(scout.propose(repo,'Document the objective'),error=>error.code==='PRE_TASK_PROVIDER_CONNECTION_FAILED'&&error.diagnostic.rpcCode==='RUN_NOT_SUCCESSFUL'&&error.diagnostic.terminationVerified&&error.diagnostic.sessionFile===bus.session&&error.diagnostic.phase==='TASK_PROPOSAL');
 assert.equal(bus.requests.filter(r=>r.method==='stop').length,0);assert.deepEqual(readdirSync(root).sort(),['provider-session.jsonl','repo']);bus.failed=false;
 assert.equal((await scout.propose(repo,'Document the objective')).proposalOnly,true);assert.equal(bus.requests.filter(r=>r.method==='spawn').length,2);assert.equal(readFileSync(join(repo,'README.md'),'utf8'),'Before\n');scout.close();
});
for(const kind of ['noProof','foreignProof','foreignContext','statusOverride'])test(`failed Scout ${kind} cannot make a subsequent attempt safe`,async t=>{
 const {repo,bus}=setup(t),scout=new PreTaskScout(bus,'owner');bus.failed=true;bus[kind]=kind==='statusOverride'?'complete':true;
 await assert.rejects(scout.propose(repo,'Document the objective'),error=>error.code==='PRE_TASK_PROPOSAL_UNCERTAIN'&&!error.diagnostic.terminationVerified);
 bus.failed=false;await assert.rejects(scout.propose(repo,'Document the objective'),/UNAVAILABLE/);assert.equal(bus.requests.filter(r=>r.method==='spawn').length,1);assert.equal(bus.requests.filter(r=>r.method==='stop').length,1);scout.close();
});
test('connection failure stays visible when physical termination cannot be confirmed, without granting retry',async t=>{
 const {repo,bus}=setup(t),scout=new PreTaskScout(bus,'owner'),{errorPresentation}=await import('../src/controlled-ui.ts');bus.failed=true;bus.foreignProof=true;
 await assert.rejects(scout.propose(repo,'Document the objective'),error=>{
  assert.equal(error.code,'PRE_TASK_PROPOSAL_UNCERTAIN');assert.equal(error.diagnostic.providerFailure,'CONNECTION_FAILED');assert.equal(error.diagnostic.terminationVerified,false);
  assert.match(errorPresentation(error).message,/fetch failed/);assert.equal(error.diagnostic.statusState,'failed');return true;
 });
 await assert.rejects(scout.propose(repo,'Document the objective'),/UNAVAILABLE/);assert.equal(bus.requests.filter(r=>r.method==='spawn').length,1);scout.close();
});
test('a physically terminated failed Scout with unexpected tools remains quarantined',async t=>{
 const {repo,bus}=setup(t),scout=new PreTaskScout(bus,'owner');bus.failed=true;bus.tools.push('write');await assert.rejects(scout.propose(repo,'Document the objective'),/UNEXPECTED_EFFECTIVE_TOOLS/);
 await assert.rejects(scout.propose(repo,'Document the objective'),/UNAVAILABLE/);assert.equal(bus.requests.filter(r=>r.method==='spawn').length,1);scout.close();
});
test('an explicit new analysis rechecks a late bound physical exit without reusing the interrupted output',async t=>{
 const {repo,bus}=setup(t),scout=new PreTaskScout(bus,'owner');bus.failed=true;bus.noProof=true;
 await assert.rejects(scout.propose(repo,'Document the objective'),error=>error.code==='PRE_TASK_PROPOSAL_UNCERTAIN');
 assert.equal(bus.disposed,false);assert.equal(bus.requests.filter(r=>r.method==='spawn').length,1);const offset=bus.requests.length;
 bus.noProof=false;bus.failed=false;
 assert.equal((await scout.propose(repo,'Document the objective')).proposalOnly,true);
 assert.deepEqual(bus.requests.slice(offset).map(r=>r.method),['status','ping','spawn','status']);
 assert.equal(bus.requests.filter(r=>r.method==='stop').length,1);assert.equal(bus.requests.filter(r=>r.method==='spawn').length,2);
 assert.equal(readFileSync(join(repo,'README.md'),'utf8'),'Before\n');assert.equal(bus.disposed,true);scout.close();
});
for(const failed of [false,true])test(`publication before physical close is reconciled in the same attempt (failed=${failed})`,async t=>{
 const {repo,bus}=setup(t),scout=new PreTaskScout(bus,'owner');bus.failed=failed;bus.noProof=true;
 // The real provider publishes results before its runner close is observed.
 bus.afterSpawn=()=>setTimeout(()=>{bus.noProof=false},100);
 if(failed)await assert.rejects(scout.propose(repo,'Document the objective'),error=>error.code==='PRE_TASK_PROVIDER_CONNECTION_FAILED'&&error.diagnostic.terminationVerified&&error.diagnostic.statusState==='failed'&&error.diagnostic.processTerminalState==='observed');
 else assert.equal((await scout.propose(repo,'Document the objective')).proposalOnly,true);
 assert.equal(bus.requests.filter(r=>r.method==='spawn').length,1);assert.ok(bus.requests.filter(r=>r.method==='status').length>=2);
 assert.equal(bus.requests.filter(r=>r.method==='stop').length,0);scout.close();
});
test('late terminal evidence cannot release quarantine when the original repository changed',async t=>{
 const {repo,bus}=setup(t),scout=new PreTaskScout(bus,'owner');bus.failed=true;bus.noProof=true;
 await assert.rejects(scout.propose(repo,'Document the objective'),/UNCERTAIN/);bus.noProof=false;bus.failed=false;
 writeFileSync(join(repo,'README.md'),'Changed while uncertain\n');
 await assert.rejects(scout.propose(repo,'Document the objective'),/READ_ONLY_VIOLATION/);
 assert.equal(bus.requests.filter(r=>r.method==='spawn').length,1);scout.close();
});
test('pre-task Scout succeeds without TaskSpec, task store, lock, candidate or workflow counters; results are not workflow evidence',async t=>{
  const {root,repo,bus}=setup(t),before=inventoryTree(repo),scout=new PreTaskScout(bus,'owner');
  const result=await scout.propose(repo,'Document the objective');
  assert.equal(result.proposalOnly,true);assert.deepEqual(inventoryTree(repo),before);
  assert.deepEqual(result.architectureFindings,['The repository keeps user documentation in README.md']);
  assert.deepEqual(result.designExpectations,['Extend the existing documentation instead of adding a parallel guide']);
  assert.deepEqual(readdirSync(root).sort(),['provider-session.jsonl','repo']);
  for(const name of ['TaskSpec','AssignmentEnvelope','ScoutResult','WorkflowState'])assert.equal(validateContract(name,result).ok,false,name);
  for(const key of ['attempts','dispatches','retry','rework','oracleInvocations','taskId','specHash','assignmentId'])assert.equal(key in result,false,key);
  assert.deepEqual(bus.requests.map(r=>r.method),['ping','spawn','status']);
  assert.equal(bus.requests.find(r=>r.method==='spawn').params.timeoutMs,TASK_PROPOSAL_TIMEOUT_MS);
  assert.equal(TASK_PROPOSAL_TIMEOUT_MS,300000);
  assert.deepEqual(bus.definition.tools,['read']);assert.equal(bus.definition.inheritSkills,false);assert.equal(bus.definition.inheritProjectContext,false);assert.equal(bus.definition.inheritGlobalContext,false);assert.equal(bus.definition.allowNestedSubagents,false);
  assert.equal(bus.disposed,true);
});
test('recorded assets cannot crowd source and configuration out of the planning hints',async t=>{
 const {repo,bus}=setup(t);mkdirSync(join(repo,'a-recordings'));
 for(let i=0;i<650;i++)writeFileSync(join(repo,'a-recordings',`${i}.wav`),'recorded asset');
 mkdirSync(join(repo,'src'));writeFileSync(join(repo,'src','processing.py'),'def process(value): return value\n');
 writeFileSync(join(repo,'pyproject.toml'),'[tool.pytest.ini_options]\n');
 const scout=new PreTaskScout(bus,'owner');t.after(()=>scout.close());
 await scout.propose(repo,'Refactor signal processing');
 const prompt=bus.requests.find(request=>request.method==='spawn').params.task;
 assert.match(prompt,/"src\/processing\.py"/);assert.match(prompt,/"pyproject\.toml"/);
 assert.equal(prompt.includes('"a-recordings/'),false);
 assert.match(prompt,/"otherFileCount":650/);
});
test('source discovery exceeds the former 600-file cap without truncation and reports explicit capacity failure',()=>{
 const inventory=new Map(Array.from({length:750},(_,i)=>[`src/module_${String(i).padStart(4,'0')}.py`,'f\t420\t1\thash']));
 inventory.set('recordings/mission.wav','f\t420\t1\thash');inventory.set('.git/config','f\t420\t1\thash');
 const index=JSON.parse(sourceFileIndex(inventory));assert.equal(index.sourceFileCount,750);assert.equal(index.otherFileCount,1);
 assert.equal(index.sourceByteCount,750);assert.deepEqual(index.sourceFileBytes[0],['src/module_0000.py',1]);
 assert.equal(index.sourceIndexComplete,true);assert(index.sourceFiles.includes('src/module_0749.py'));assert.equal(index.sourceFiles.some(p=>p.startsWith('.git/')),false);
 const oversized=new Map(Array.from({length:750},(_,i)=>[`src/${'x'.repeat(100)}_${i}.py`,'f\t420\t1\thash']));
 assert.throws(()=>sourceFileIndex(oversized),error=>error.code==='SOURCE_INDEX_LIMIT');
});
test('pre-task closed output rejects authority, root overrides, traversal, guessed tests and foreign request binding',t=>{
  const {repo}=setup(t),q=preTaskRequest(repo,'Document the objective');
  for(const patch of [{authority:true},{repoRoot:'/'},{proposedScope:['../escape']},{requestHash:'a'.repeat(64)},{architectureFindings:['x'.repeat(4001)]},{existingTests:[{mechanism:'NPM_TEST',configPath:'package.json',explanation:'guessed'}]}])assert.throws(()=>validatePreTaskProposal({...proposal(q),...patch},q));
});
test('invalid Scout proposal and unexpected mutating runtime tools fail closed without task/store/lock effects',async t=>{
  for(const mode of ['invalid','tools']){const {root,repo,bus}=setup(t);if(mode==='invalid')bus.invalid=true;else bus.tools.push('write');
    const scout=new PreTaskScout(bus,'owner');await assert.rejects(scout.propose(repo,'Document the objective'));
    assert.deepEqual(readdirSync(root).sort(),['provider-session.jsonl','repo']);assert.equal(readFileSync(join(repo,'README.md'),'utf8'),'Before\n');assert.equal(bus.disposed,mode==='invalid');scout.close();
  }
});
test('proposal draft is independently editable and workflow Scout still rejects it without AssignmentEnvelope',async t=>{
  const {repo,bus}=setup(t),q=preTaskRequest(repo,'Document the objective'),r=validatePreTaskProposal(proposal(q),q),draft=proposalDraft(q.objective,r);
  draft.scope.push('other.md');draft.criteria[0]='Changed criterion';draft.validationPlan[0].description='Changed verification';
  assert.deepEqual(r.proposedScope,['README.md']);assert.equal(r.acceptanceCriteria[0],'Document the objective');
  assert.deepEqual(draft.architectureFindings,r.architectureFindings);assert.deepEqual(draft.designExpectations,r.designExpectations);
  assert.equal('taskId' in draft,false);assert.equal(validateContract('TaskSpec',draft).ok,false);
  const {ControlledScoutRunner}=await import('../src/controlled-scout.ts');
  const runner=new ControlledScoutRunner({active:()=>true,runtimeGeneration:'fixture'},bus,'owner');
  try{await assert.rejects(runner.run(draft,{records:[],modelExtracted:false}),e=>e.code==='INVALID_ASSIGNMENT');assert.deepEqual(bus.requests,[])}finally{runner.dispose()}
});

test('cancelling an in-flight proposal stops its exact run and discards the result without creating a task',async t=>{
  const {root,repo,bus}=setup(t),controller=new AbortController();bus.afterSpawn=()=>controller.abort();
  await assert.rejects(new PreTaskScout(bus,'owner').propose(repo,'Document the objective',[],controller.signal),/CANCELLED/);
  assert.equal(bus.requests.find(r=>r.method==='stop').params.id,'proposal-run');assert.deepEqual(readdirSync(root).sort(),['provider-session.jsonl','repo']);
});

test('cancelled or closed pre-task session dispatches nothing and leaves no task',async t=>{
  const {root,repo,bus}=setup(t),scout=new PreTaskScout(bus,'owner'),controller=new AbortController();controller.abort();
  await assert.rejects(scout.propose(repo,'Document the objective',[],controller.signal),/CANCELLED/);
  scout.close();await assert.rejects(scout.propose(repo,'Document the objective'),/UNAVAILABLE/);
  assert.deepEqual(bus.requests,[]);assert.deepEqual(readdirSync(root),['repo']);
});
test('closing a quarantined proposal drops its retained provider registration and prevents retries',async t=>{
 const {repo,bus}=setup(t),scout=new PreTaskScout(bus,'owner');bus.failed=true;bus.noProof=true;
 await assert.rejects(scout.propose(repo,'Document the objective'),/UNCERTAIN/);scout.close();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(bus.disposed,true);
 await assert.rejects(scout.propose(repo,'Document the objective'),/UNAVAILABLE/);
 assert.equal(bus.requests.filter(r=>r.method==='spawn').length,1);
});

test('public new connects native wizard to read-only pre-task Scout before freezing TaskSpec (provider double)',async t=>{
  const {execFileSync}=await import('node:child_process');
  const {root,repo,bus}=setup(t),data=join(root,'profile');mkdirSync(data);
  const old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=data;t.after(()=>{if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=old});
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();git('init','-q');git('add','README.md');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Fixture');
  const before=git('rev-parse','HEAD'),handlers=new Map(),messages=[];let command;
  const originalEmit=bus.emit.bind(bus);bus.emit=(name,value)=>{if(name==='pi-subagents:runtime-agent-register:v1'&&value.name!==PRE_TASK_SCOUT_NAME){value.result={ok:true,registration:{dispose(){}}};return}originalEmit(name,value)};
  const {default:extension}=await import('../extensions/controlled-dev.ts');
  extension({events:bus,registerCommand(_name,c){command=c.handler},on(name,fn){const list=handlers.get(name)??[];list.push(fn);handlers.set(name,list);return()=>{}},getAllTools:()=>[],setActiveTools(){}});
  const ctx={mode:'tui',cwd:repo,sessionManager:{getSessionId:()=> 'owner'},ui:{notify:m=>messages.push(m),editor:async()=> 'Document the objective',select:async(_title,options)=>options[0],confirm:async()=>true}};
  for(const fn of handlers.get('session_start'))fn({},ctx);
  await command('new',ctx);
  const {readProductionTaskInput}=await import('../src/production-bridge.ts');const {spec}=readProductionTaskInput(ctx);
  assert.equal(spec.objective,'Document the objective');assert.equal(spec.acceptanceCriteria[0].method,'REVIEW');assert.deepEqual(spec.acceptanceCriteria[0].commandIds,[]);
  assert.equal(spec.humanGates.beforeImplementation,true);assert.equal(spec.humanGates.beforeCompletion,true);
  assert.deepEqual(spec.validationCommands[0].argv,['diff','--check']);assert.equal(bus.requests.filter(r=>r.method==='spawn').length,1);
  assert.equal(bus.requests.find(r=>r.method==='spawn').params.agent,PRE_TASK_SCOUT_NAME);assert.equal(git('rev-parse','HEAD'),before);assert.equal(git('status','--porcelain'),'');
  assert.match(messages.at(-1),/Task prepared/);for(const fn of handlers.get('session_shutdown'))fn({},ctx);
});

for(const recovery of ['retry in panel','return and retry command'])test(`failed project planning preserves goal, reports connection error and supports ${recovery}`,async t=>{
 const {execFileSync}=await import('node:child_process'),{ProjectPlanningRepository}=await import('../src/project-planning-repository.ts'),{default:extension}=await import('../extensions/controlled-dev.ts');
 const {root,repo,bus}=setup(t),data=join(root,'profile');mkdirSync(data);const old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=data;t.after(()=>old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old);
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git('init','-q');git('add','README.md');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Baseline');
 const before=git('rev-parse','HEAD'),planning=ProjectPlanningRepository.open(data,repo,()=> 'ACCEPT',{create:true}),goal=planning.createGoal('Proseguire lo sviluppo del progetto');bus.failed=true;
 bus.proposalFactory=q=>planningProposal({schemaVersion:1,phase:'PROJECT_PLANNING_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:hashCanonical(q),strategy:'Completare gli incrementi richiesti',plannedTasks:[{plannedTaskId:'documentation',title:'Documentazione',objective:'Documentare il risultato',rationale:'Risultato osservabile',scopeIntent:['README.md'],acceptanceIntent:['La guida spiega il risultato'],validationIntent:['Review della guida'],dependsOn:[],dependencyRationale:[],relevantMemoryIds:[]}]});
 const emit=bus.emit.bind(bus);bus.emit=(name,value)=>{if(name==='pi-subagents:runtime-agent-register:v1'&&value.name!==PRE_TASK_SCOUT_NAME){value.result={ok:true,registration:{dispose(){}}};return}emit(name,value)};
 const hooks=new Map(),notices=[],actions=[recovery==='retry in panel'?"Retry analysis":"Back to project"];let command;
 extension({events:bus,registerCommand(_name,value){command=value},on(name,fn){const list=hooks.get(name)??[];list.push(fn);hooks.set(name,list);return()=>{}},getAllTools:()=>[{name:'read',sourceInfo:{source:'builtin',path:'<builtin:read>'}}],setActiveTools(){}});
 const ctx={mode:'tui',cwd:repo,sessionManager:{getSessionId:()=> 'owner'},ui:{notify:(message,type)=>notices.push({message,type}),editor:async()=>assert.fail('Goal already saved'),confirm:async()=>assert.fail('No approval requested'),select:async(title,options)=>{const action=actions.shift();assert.ok(options.includes(action),action);if(title.startsWith("Project analysis interrupted")){assert.equal(bus.requests.filter(r=>r.method==='spawn').length,1);if(action==="Retry analysis"){bus.failed=false;actions.push("Back")}}return action}}};
 for(const hook of hooks.get('session_start'))hook({},ctx);t.after(()=>{for(const hook of hooks.get('session_shutdown'))hook({},ctx)});await command.handler('project plan',ctx);
 assert.equal(bus.requests.find(r=>r.method==='spawn').params.timeoutMs,600000);
 if(recovery==='return and retry command'){
  assert.ok(notices.some(n=>n.type==='error'&&n.message.includes('fetch failed')));await command.handler('status --technical',ctx);const technical=JSON.parse(notices.at(-1).message);assert.equal(technical.lastFailure.code,'PRE_TASK_PROVIDER_CONNECTION_FAILED');assert.equal(technical.lastFailure.diagnostic.phase,'PROJECT_PLANNING');assert.equal(technical.lastFailure.diagnostic.terminationVerified,true);assert.equal(technical.lastFailure.diagnostic.sessionFile,bus.session);
  const event={messages:[{role:'system',sections:{preamble:'Parent prompt'}}]},response=hooks.get('context_with_system')[0](event);assert.ok(response.messages[0].sections['controlled-dev-boundary'].includes('do not try subagents_enable'));assert.ok(response.messages[0].sections['controlled-dev-boundary'].includes('Do not ask the user to paste the saved objective again'));assert.equal(event.messages[0].sections['controlled-dev-boundary'],undefined);assert.equal(hooks.get('tool_call')[0]({toolName:'subagents_enable'}).block,true);
  assert.equal(bus.requests.filter(r=>r.method==='spawn').length,1);bus.failed=false;actions.push("Back");await command.handler('project plan',ctx);
 }
 const reopened=ProjectPlanningRepository.open(data,repo,()=> 'ACCEPT');assert.equal(reopened.goals().length,1);assert.equal(reopened.goals()[0].contentDigest,goal.contentDigest);assert.equal(reopened.history().length,1,JSON.stringify({notices,methods:bus.requests.map(r=>r.method)}));assert.equal(reopened.history()[0].status,'DRAFT');assert.equal(reopened.current(),undefined);assert.equal(bus.requests.filter(r=>r.method==='spawn').length,2);assert.equal(git('rev-parse','HEAD'),before);assert.equal(git('status','--porcelain'),'');assert.equal(actions.length,0);
});

 test('real Scout prose scope is rejected; observed names and simple new paths remain supported',t=>{
  const {repo,root}=setup(t),q=preTaskRequest(repo,'Document usage');
  const check=scope=>validatePreTaskProposal({...proposal(q),proposedScope:scope},q);
  assert.throws(()=>check(['Modificare esclusivamente README.md, aggiungendo una breve sezione intitolata "Usage".']),/PRE_TASK_PROPOSAL_INVALID/);
  writeFileSync(join(repo,'User Guide.md'),'Existing');
  assert.deepEqual(check(['User Guide.md','docs/new/usage.md']).proposedScope,['User Guide.md','docs/new/usage.md']);
  mkdirSync(join(repo,'existing-directory'));assert.throws(()=>check(['existing-directory']),/PRE_TASK_PROPOSAL_INVALID/);
  const largeScope=Array.from({length:350},(_,i)=>`new/module_${i}.py`);
  assert.deepEqual(check(largeScope).proposedScope,largeScope);
  symlinkSync(root,join(repo,'outside'));
  assert.throws(()=>check(['outside/new.md']),/PRE_TASK_PROPOSAL_INVALID/);
  assert.throws(()=>check(['README.md/new.md']),/PRE_TASK_PROPOSAL_INVALID/);
});

// Real pre-task transport code with the already declared provider and human test doubles.
test('Project Memory reaches pre-task Scout and becomes bounded stable design expectations',async t=>{
 const {root,repo,bus}=setup(t);const {memoryForRole}=await import('./project-memory-fixture.mjs');
 const f=await memoryForRole(repo,root,{taskId:'task-8',role:'Scout',assignmentId:'pre-task-8',objective:'Document the persistence boundary',allowedPaths:['README.md']});
 const result=await new PreTaskScout(bus,'owner').propose(repo,'Document the persistence boundary',['README.md'],undefined,f.repo);
 const task=bus.requests.find(r=>r.method==='spawn').params.task;
 assert.match(task,/PROJECT MEMORY/);assert.match(task,/ScenarioRepository/);assert.ok(task.includes(f.record.recordId));
 assert.ok(result.designExpectations.some(text=>text.includes(f.record.recordId)&&text.includes('ScenarioRepository')));
 const {readMemoryContextReceipt}=await import('../src/project-memory-context.ts');
 const receipts=readdirSync(join(f.repo.store.root,'artifacts')).filter(id=>id.startsWith('memory-receipt-')).map(id=>{
   const raw=readFileSync(join(f.repo.store.root,'artifacts',id));return readMemoryContextReceipt(f.repo.store,{schemaVersion:1,id,digest:hashCanonical(JSON.parse(raw)),bytes:raw.length,relativeStorePath:`artifacts/${id}`,mediaType:'application/vnd.pi-controlled-dev.memory-context-receipt+json'});
 });
 assert.ok(receipts.some(r=>r.delivery==='PROVIDER_ACKNOWLEDGED'&&r.role==='Scout'&&r.records[0].recordId===f.record.recordId));
 assert.equal(readFileSync(join(repo,'README.md'),'utf8'),'Before\n');
});

const prospectiveProposal=(q,relevantFiles=[],proposedScope=['src/app.cjs'])=>({...proposal(q),relevantFiles,proposedScope,
  acceptanceCriteria:['The new module provides the requested local behavior'],
  validations:[{kind:'REVIEW',description:'Independently review the new module',paths:[...proposedScope],expectedLines:[]}],
  architectureFindings:relevantFiles.length?['Only the listed existing files are observed']:['No pertinent application files exist yet'],
  designExpectations:['Create only the paths admitted by the authorized TaskSpec'],explanation:'Prospective paths are suggested scope, not observed files or authority'});

test('empty greenfield Git baseline → native pre-task proposal with no observed files and prospective scope is valid',async t=>{
  const {execFileSync}=await import('node:child_process');
  const {repo,bus}=setup(t);rmSync(join(repo,'README.md'));
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
  git('init','-q');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','Empty baseline');
  assert.equal(git('ls-tree','-r','--name-only','HEAD'),'');const head=git('rev-parse','HEAD');
  bus.proposalFactory=q=>prospectiveProposal(q,[],['src/app.cjs','test/app.test.cjs']);
  const result=await new PreTaskScout(bus,'owner').propose(repo,'Create the first local module');
  assert.deepEqual(result.relevantFiles,[]);assert.deepEqual(result.proposedScope,['src/app.cjs','test/app.test.cjs']);
  assert.equal(git('rev-parse','HEAD'),head);assert.equal(git('status','--porcelain'),'');
  const spawn=bus.requests.find(r=>r.method==='spawn');
  assert.match(spawn.params.outputSchema.properties.relevantFiles.description,/must already exist/);
  assert.match(spawn.params.outputSchema.properties.proposedScope.description,/may be created/);
  assert.match(spawn.params.task,/relevantFiles=\[\]/);assert.match(bus.definition.systemPrompt,/future files/);
});

test('existing observed file and prospective nested paths coexist in their distinct existing fields',t=>{
  const {repo}=setup(t),q=preTaskRequest(repo,'Add a new component');
  const value=prospectiveProposal(q,['README.md'],['README.md','src/new/component.cjs','test/new/component.test.cjs']);
  const result=validatePreTaskProposal(value,q);
  assert.deepEqual(result.relevantFiles,['README.md']);assert.deepEqual(result.proposedScope,value.proposedScope);
  assert.equal(readFileSync(join(repo,'README.md'),'utf8'),'Before\n');assert.deepEqual(readdirSync(repo),['README.md']);
});

test('a nonexistent declared existing relevant file is rejected in both empty and existing repositories',t=>{
  for(const empty of [false,true]){
    const {repo}=setup(t);if(empty)rmSync(join(repo,'README.md'));const q=preTaskRequest(repo,'Create a new file');
    assert.throws(()=>validatePreTaskProposal(prospectiveProposal(q,['src/new.cjs'],['src/new.cjs']),q));
    assert.deepEqual(validatePreTaskProposal(prospectiveProposal(q,[],['src/new.cjs']),q).relevantFiles,[]);
  }
});

test('existing relevant files remain regular observed files; directories and symlinks cannot masquerade as them',t=>{
  const {repo,root}=setup(t);mkdirSync(join(repo,'directory'));symlinkSync(join(repo,'README.md'),join(repo,'alias.md'));
  symlinkSync(root,join(repo,'outside'));const q=preTaskRequest(repo,'Create a new component');
  for(const path of ['directory','alias.md','outside/missing.cjs'])assert.throws(()=>validatePreTaskProposal(prospectiveProposal(q,[path]),q));
  for(const path of ['outside/new.cjs','README.md/new.cjs','../escape.cjs',join(root,'escape.cjs')])assert.throws(()=>validatePreTaskProposal(prospectiveProposal(q,[],[path]),q));
});

test('historical v1 proposal shape and existing repository behavior remain unchanged without added fields',t=>{
  const {repo}=setup(t),q=preTaskRequest(repo,'Document the objective'),legacy=proposal(q);
  const encoded=JSON.stringify(legacy),loaded=JSON.parse(encoded);
  assert.deepEqual(validatePreTaskProposal(loaded,q),legacy);assert.equal(JSON.stringify(loaded),encoded);
  assert.equal(loaded.schemaVersion,1);assert.deepEqual(proposalDraft(q.objective,loaded).scope,['README.md']);
  assert.throws(()=>validatePreTaskProposal({...loaded,existingRelevantFiles:['README.md']},q));
});

test('draft conversion uses proposedScope, not observed relevantFiles, and cannot itself grant TaskSpec authority',t=>{
  const {repo}=setup(t),q=preTaskRequest(repo,'Create a component');
  const result=validatePreTaskProposal(prospectiveProposal(q,['README.md'],['src/app.cjs']),q),draft=proposalDraft(q.objective,result);
  assert.deepEqual(draft.scope,['src/app.cjs']);assert.deepEqual(draft.criteria,result.acceptanceCriteria);
  assert.deepEqual(draft.validationPlan[0].paths,['src/app.cjs']);assert.equal(draft.scope.includes('README.md'),false);
  assert.equal(validateContract('TaskSpec',draft).ok,false);draft.scope.push('other.cjs');assert.deepEqual(result.proposedScope,['src/app.cjs']);
});

test('native TaskSpec creation retains prospective scope on empty and existing baselines with all normal gates',async t=>{
  const {execFileSync}=await import('node:child_process');const {createProductionTask,readProductionTaskInput}=await import('../src/production-bridge.ts');
  for(const empty of [true,false]){
    const {root,repo,bus}=setup(t);if(empty)rmSync(join(repo,'README.md'));
    const data=join(root,'profile');mkdirSync(data);const old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=data;
    try{
      const git=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8'}).trim();git('init','-q');git('add','.');
      git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','Baseline');const head=git('rev-parse','HEAD');
      bus.proposalFactory=q=>prospectiveProposal(q,empty?[]:['README.md'],['src/app.cjs','test/app.test.cjs']);
      let confirmations=0;const ctx={mode:'tui',cwd:repo,sessionManager:{getSessionId:()=> 'owner'},ui:{notify(){},editor:async()=> 'Create the first local component',select:async(_title,options)=>options[0],confirm:async()=>{confirmations++;return true}}};
      const scout=new PreTaskScout(bus,'owner');try{await createProductionTask(ctx,(objective,hints,signal)=>scout.propose(repo,objective,hints,signal))}finally{scout.close()}
      const {spec}=readProductionTaskInput(ctx);assert.deepEqual(spec.scope.allowedPaths,['src/app.cjs','test/app.test.cjs']);
      assert.equal(spec.scope.allowedPaths.includes('README.md'),false);for(const flag of ['beforeImplementation','onScopeChange','onOracleDecision','beforeCompletion','onRetryExhausted'])assert.equal(spec.humanGates[flag],true);
      assert.equal(confirmations,1);assert.deepEqual(spec.validationCommands[0].argv,['diff','--check']);
      assert.equal(git('rev-parse','HEAD'),head);assert.equal(git('status','--porcelain'),'');
    }finally{if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=old}
  }
});

test('ScopeGuard admits creation only inside the actual TaskSpec scope, never merely because a proposal mentions it',async t=>{
  const {execFileSync}=await import('node:child_process');const {ScopeGuard}=await import('../src/scope-guard.ts');
  const {loadContracts}=await import('./load-contracts.mjs');const {fixtures}=await import('./contract-fixtures.mjs');const api=await loadContracts();
  for(const allowed of [true,false]){
    const {repo,root}=setup(t),work=join(root,'work'),q=preTaskRequest(repo,'Create a new module');
    const result=validatePreTaskProposal(prospectiveProposal(q,['README.md'],['new.cjs','unapproved.cjs']),q);
    const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8'}).trim();git(repo,'init','-q');git(repo,'add','.');
    git(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Baseline');const head=git(repo,'rev-parse','HEAD');git(repo,'worktree','add','--quiet','--detach',work,head);
    const f=fixtures(api),spec={...f.TaskSpec,scope:{...f.TaskSpec.scope,repoRoot:repo,baseRef:'HEAD',allowedPaths:['new.cjs'],deniedPaths:[]}};spec.specHash=api.hashContract('TaskSpec',spec);
    const guard=ScopeGuard.open(spec.scope,work,head);writeFileSync(join(work,allowed?'new.cjs':'unapproved.cjs'),'exports.value = 1;\n');
    assert.ok(result.proposedScope.includes('unapproved.cjs'));
    if(allowed)assert.deepEqual(guard.capture(1,'fixture terminal proof').changedFiles,['new.cjs']);
    else assert.throws(()=>guard.capture(1,'fixture terminal proof'),e=>e.code==='SCOPE_VIOLATION');
    assert.equal(git(repo,'rev-parse','HEAD'),head);assert.equal(git(repo,'status','--porcelain'),'');
  }
});

test('domain profile reaches native task planning with the existing core methodology (provider double)',async t=>{
 const {repo,bus}=setup(t),profile={schemaVersion:1,id:'systemist_factory',common:['Preserve requirement source links'],phases:{TaskPlanning:['Technical evidence requested by caller'],Developer:['Implementation only marker']}};
 const scout=new PreTaskScout(bus,'owner',profile);t.after(()=>scout.close());profile.common[0]='Changed after construction';
 const result=await scout.propose(repo,'Document the objective'),task=bus.requests.find(r=>r.method==='spawn').params.task;
 assert.equal(result.proposalOnly,true);assert.match(task,/Preserve requirement source links/);assert.match(task,/Technical evidence requested by caller/);
 assert.doesNotMatch(task,/Implementation only marker|Changed after construction/);assert.match(task,/PACKAGE GUIDANCE/);assert.match(task,/Project Memory remain binding/);
 assert.deepEqual(bus.definition.tools,['read']);assert.equal(bus.definition.inheritSkills,false);
});
