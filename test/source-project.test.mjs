import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, channel, git, inspect, api, ProposalBus, planningProposal } from './greenfield-bootstrap-fixture.mjs';
const { SourceProject, inspectSource }=await import('../src/source-project.ts');
const { DurableStore }=await import('../src/store.ts');
const { showSourceProject }=await import('../src/source-project-ui.ts');
const { PreTaskScout, preTaskRequest, validatePreTaskProposal }=await import('../src/pre-task-proposal.ts');
const { ProjectPlanningRepository }=await import('../src/project-planning-repository.ts');
const { createProductionTask, readProductionTaskInput, productionOpenProject, productionProjectHasBaseline }=await import('../src/production-bridge.ts');
const { errorPresentation }=await import('../src/controlled-ui.ts');
const { productionAutonomy }=await import('../src/project-autonomy-production.ts');
const { default: extension }=await import('../extensions/controlled-dev.ts');
const planOutput=q=>planningProposal({schemaVersion:1,phase:'PROJECT_PLANNING_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:api.hashCanonical(q),strategy:'Incrementi che preservano la libreria',plannedTasks:[{plannedTaskId:'signal-cleanup',title:'Ripulire il segnale',objective:'Ripulire il segnale conservando identity',rationale:'Responsabilità locale',scopeIntent:['src/asw/base/signal.py'],acceptanceIntent:['identity conserva il comportamento'],validationIntent:['Review della compatibilità'],dependsOn:[],dependencyRationale:[],relevantMemoryIds:[]}]});
function sourceFixture(t,options){
 const f=fixture(t,options),source=join(f.root,'asw');mkdirSync(source);mkdirSync(join(source,'base'));
 writeFileSync(join(source,'__init__.py'),'from .base.signal import identity\n');writeFileSync(join(source,'base','signal.py'),'def identity(value):\n    return value\n');
 mkdirSync(join(source,'__pycache__'));writeFileSync(join(source,'__pycache__','signal.pyc'),'cache');
 const host=new SourceProject(f.data,source,f.repo,inspect);
 return {...f,source,host,proposal:()=>host.propose('Rifattorizzare tutta la libreria conservando API e comportamento')};
}
test('source import creates a clean Git project containing the exact Python package, excluding caches',async t=>{
 const f=sourceFixture(t),before=inspectSource(f.source),p=f.proposal();assert.equal(existsSync(f.repo),false);assert.equal(p.fileCount,2);assert.equal(p.prefix,'src/asw');
 assert.equal(await f.host.approve(channel(),p),f.repo);assert.equal(inspectSource(f.source).digest,before.digest);assert.equal(existsSync(join(f.source,'.git')),false);
 assert.deepEqual(git(f.repo,'ls-files').split('\n'),['src/asw/__init__.py','src/asw/base/signal.py']);
 assert.equal(git(f.repo,'status','--porcelain','--ignored'),'');assert.equal(git(f.repo,'branch','--show-current'),'main');assert.equal(git(f.repo,'rev-list','--count','HEAD'),'1');assert.equal(git(f.repo,'remote'),'');
 assert.deepEqual(readFileSync(join(f.repo,'src/asw/base/signal.py')),readFileSync(join(f.source,'base/signal.py')));
 const store=DurableStore.sourceImport(f.data,p.target?api.hashBytes(Buffer.from(p.target)):null,inspect),result=JSON.parse(store.read(store.readProjectIndex())),intent=JSON.parse(store.read(result.intent)),receipt=JSON.parse(store.read(intent.approval));
 assert.equal(result.commit,git(f.repo,'rev-parse','HEAD'));assert.equal(receipt.request.purpose,'source-project-import');assert.equal(receipt.request.payload.sourceDigest,before.digest);assert.equal(intent.files.length,2);
});
test('source wizard passes exact approved autonomy to the existing runner callback without a supervised task prompt',async t=>{
 const f=sourceFixture(t),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;t.after(()=>old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old);
 const bus=new ProposalBus(f.root,planOutput),scout=new PreTaskScout(bus,'owner');t.after(()=>scout.close());let starts=0;
 const ctx={...channel(),cwd:f.root,autonomyPlanning:true,onAutonomyApproved:async id=>{starts++;const repo=productionAutonomy({cwd:f.repo});assert.equal(repo.policies().find(p=>p.policy.policyId===id).status,'APPROVED');assert.equal(repo.planning().current().status,'APPROVED')}};
 const inputs=[f.source,f.repo,'Rifattorizzare tutta la libreria','src/asw/**',''],actions=["Create the project","Approve the plan","Controlled Autonomy","Diff check and review"];
 ctx.ui.editor=async()=>{assert.ok(inputs.length);return inputs.shift()};ctx.ui.select=async(_title,options)=>{assert.ok(actions.length,'Unexpected supervised prompt');const action=actions.shift();assert.ok(options.includes(action),action);return action};
 await showSourceProject(ctx,scout,(source,target)=>new SourceProject(f.data,source,target,inspect),root=>ProjectPlanningRepository.open(f.data,root,inspect,{create:true}),()=>{},async()=>assert.fail('Supervised start after autonomy'));
 assert.equal(starts,1);assert.equal(inputs.length,0);assert.equal(actions.length,0);
});
test('public imported-project autonomy analyzes the selected destination and needs no manual bounds',async t=>{
 const f=sourceFixture(t),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;t.after(()=>old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old);let preparations=0;
 const bus=new ProposalBus(f.root,(q,params)=>{if(params.outputSchema.properties.phase.const==='PROJECT_PLANNING_PROPOSAL')return planOutput(q);preparations++;assert.equal(params.cwd,f.repo);return {schemaVersion:1,phase:'PRE_TASK_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:api.hashCanonical(q),relevantFiles:['src/asw/base/signal.py'],proposedScope:['src/asw/base/signal.py'],acceptanceCriteria:['identity conserva il comportamento'],existingTests:[],validations:[{kind:'REVIEW',description:'Review della compatibilità',paths:[],expectedLines:[]}],architectureFindings:['Libreria Python importata'],designExpectations:['Conservare identity'],ambiguities:[],risks:[],explanation:'Ambito già previsto nel piano'}}),hooks=new Map(),notices=[];let command,confirmations=0;
 extension({events:bus,registerCommand(_name,value){command=value},getAllTools:()=>[],setActiveTools(){},on(name,fn){const hs=hooks.get(name)??[];hs.push(fn);hooks.set(name,hs);return()=>{}}});const ctx={...channel(),cwd:f.source};ctx.sessionManager.getSessionId=()=> 'owner';ctx.ui.confirm=async()=>++confirmations===1;ctx.ui.notify=(message,type)=>notices.push({message,type});
 const answers=[f.source,f.repo,'Rifattorizzare la libreria'],actions=["Create the project","Approve the plan","Controlled Autonomy","Back"];ctx.ui.editor=async()=>{assert.ok(answers.length,'Unexpected manual scope input');return answers.shift()};ctx.ui.select=async(_title,choices)=>{const action=actions.shift();assert.ok(choices.includes(action),`${action}: ${choices}`);return action};for(const hook of hooks.get('session_start'))hook({},ctx);t.after(()=>{for(const hook of hooks.get('session_shutdown'))hook()});
 await command.handler('project import',ctx);assert.equal(notices.filter(n=>n.type==='error').length,0,JSON.stringify(notices));assert.equal(answers.length,0);assert.equal(actions.length,0);assert.equal(preparations,1);assert.equal(confirmations,2);assert.equal(ProjectPlanningRepository.open(f.data,f.repo,inspect).current(),undefined);assert.equal(productionAutonomy({cwd:f.repo}).policies()[0].status,'DRAFT');assert.equal(git(f.repo,'status','--porcelain'),'');assert.equal(inspectSource(f.source).files.length,2);
});
for(const entry of ['project import'])test(`explicit ${entry} copies source only on request and current-folder reopening preserves an approved plan`,async t=>{
 const f=sourceFixture(t),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;t.after(()=>old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old);
 const bus=new ProposalBus(f.root,planOutput),hooks=new Map(),notices=[];let command;
 extension({events:bus,registerCommand(_name,value){command=value},getAllTools:()=>[],setActiveTools(){},on(name,fn){const handlers=hooks.get(name)??[];handlers.push(fn);hooks.set(name,handlers);return()=>{}}});
 const ctx={...channel(),cwd:f.source};ctx.sessionManager.getSessionId=()=> 'owner';
 const objective='Completare la generazione del codice della libreria',inputs=[f.source,f.repo,objective],actions=["Create the project","Approve the plan","Supervised mode","Back to project"];
 ctx.ui.editor=async(_title,prefill)=>{assert.ok(inputs.length,'Unexpected editor');if(inputs.length===1)assert.equal(prefill,'','Existing source must not prefill a refactoring goal');return inputs.shift()};ctx.ui.select=async(_title,options)=>{const action=actions.shift();assert.ok(options.includes(action),action);return action};ctx.ui.notify=(message,type)=>notices.push({message,type});
 for(const hook of hooks.get('session_start'))hook({},ctx);t.after(()=>{for(const hook of hooks.get('session_shutdown'))hook()});
 await command.handler(entry,ctx);assert.equal(notices.filter(n=>n.type==='error').length,0,JSON.stringify(notices));const planning=ProjectPlanningRepository.open(f.data,f.repo,inspect),approved=planning.current();assert.ok(approved);assert.equal(actions.length,0);
 const goal=planning.goals().at(-1);assert.equal(goal.objective,objective);assert.equal(goal.title,objective);assert.deepEqual(goal.constraints,[]);assert.deepEqual(goal.successIntent,[objective]);
 // Same public command after opening a new Pi session: no new goal/revision or Scout request.
 ctx.cwd=f.repo;for(const hook of hooks.get('session_start'))hook({},ctx);actions.push("Back");await command.handler('project open',ctx);
 assert.equal(notices.filter(n=>n.type==='error').length,0,JSON.stringify(notices));assert.equal(planning.current().contentDigest,approved.contentDigest);assert.equal(bus.requests.filter(r=>r.method==='spawn').length,1);
 actions.push("Back");await command.handler('project status',ctx);assert.equal(actions.length,0);assert.equal(notices.filter(n=>n.type==='error').length,0);
});
test('legacy refactor entry uses the current folder and keeps the objective free',async t=>{
 const f=sourceFixture(t),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;t.after(()=>old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old);const hooks=new Map(),notices=[];let command,questions=0;
 extension({events:{on(){return()=>{}},emit(){}},registerCommand(_name,value){command=value},getAllTools:()=>[],setActiveTools(){},on(name,fn){const hs=hooks.get(name)??[];hs.push(fn);hooks.set(name,hs);return()=>{}}});
 const ctx={...channel(),cwd:f.source};ctx.sessionManager.getSessionId=()=> 'owner';ctx.ui.editor=async(_title,prefill)=>{questions++;assert.equal(prefill,'');return undefined};ctx.ui.select=async()=>assert.fail('Cancelled before review');ctx.ui.notify=(message,type)=>notices.push({message,type});
 for(const hook of hooks.get('session_start'))hook({},ctx);t.after(()=>{for(const hook of hooks.get('session_shutdown'))hook()});await command.handler('project refactor',ctx);
 assert.equal(questions,1);assert.equal(notices.filter(n=>n.type==='error').length,0);assert.equal(existsSync(f.repo),false);assert.equal(existsSync(join(f.source,'.git')),false);assert.ok(ProjectPlanningRepository.open(f.data,f.source,inspect));
});
test('existing source can lead to a new feature module and its normal TaskSpec without refactoring constraints',async t=>{
 const f=sourceFixture(t),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;t.after(()=>old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old);
 const objective='Aggiungere esportazione CSV dei segnali',path='src/asw/export.py',bus=new ProposalBus(f.root,(q,params)=>{
  assert.equal(q.objective,objective);assert.deepEqual(q.hints,[objective]);assert.ok(params.task.includes('Existing source is a starting point, not a request to refactor.'));
  const goal=JSON.parse(params.task.split('\nGOAL=')[1].split('\nPREVIOUS=')[0]);assert.deepEqual(goal.constraints,[]);assert.deepEqual(goal.successIntent,[objective]);assert.equal(goal.objective,objective);
  const output=planOutput(q);output.strategy='Estendere la libreria con esportazione CSV';Object.assign(output.plannedTasks[0],{plannedTaskId:'csv-export',title:'Esportazione CSV',objective,rationale:'Nuova funzionalità richiesta',scopeIntent:[path],acceptanceIntent:['I segnali possono essere esportati in CSV'],validationIntent:['Review del formato CSV']});return output;
 }),scout=new PreTaskScout(bus,'owner');t.after(()=>scout.close());const inputs=[f.source,f.repo,objective],actions=["Create the project","Approve the plan","Prepare and start a ready task"];let started=0,questions=0;
 const ctx={...channel(),cwd:f.root};ctx.ui.editor=async()=>assert.fail('Use framed questions');ctx.ui.wizardInput=async(_title,prefill,presentation)=>{questions++;assert.equal(presentation.total,3);assert.equal(presentation.step,questions);assert.equal(presentation.section,"Start from existing code");if(questions===3){assert.equal(prefill,'');assert.ok(presentation.question.includes('build'));assert.ok(presentation.why.includes('feature'))}return inputs.shift()};
 ctx.ui.select=async(_title,options)=>{const action=actions.length?actions.shift():options[0];assert.ok(options.includes(action));return action};ctx.ui.confirm=async(title,message)=>{assert.doesNotMatch(title,/refactoring/i);if(title.includes('existing code')){assert.ok(message.includes(objective));assert.doesNotMatch(message,/refactoring/i)}return true};
 await showSourceProject(ctx,scout,(source,target)=>new SourceProject(f.data,source,target,inspect),root=>ProjectPlanningRepository.open(f.data,root,inspect,{create:true}),()=>{},async(root,seed,planning)=>{
  started++;assert.equal(seed.objective,objective);assert.equal(existsSync(join(root,path)),false);
  const taskCtx={...channel(),cwd:root};taskCtx.ui.editor=async(_title,prefill)=>prefill;taskCtx.ui.select=async(_title,choices)=>choices.includes("Create the task")?"Create the task":"Next";
  const propose=async(objective,hints)=>{const q=preTaskRequest(root,objective,hints);return validatePreTaskProposal({schemaVersion:1,phase:'PRE_TASK_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:api.hashCanonical(q),relevantFiles:['src/asw/base/signal.py'],proposedScope:[path],acceptanceCriteria:['I segnali possono essere esportati in CSV'],existingTests:[],validations:[{kind:'REVIEW',description:'Review del formato CSV',paths:[path],expectedLines:[]}],architectureFindings:['Pacchetto Python esistente'],designExpectations:['Integrare esportazione con il formato del segnale'],ambiguities:[],risks:[],explanation:'Sviluppare la nuova funzionalità'},q)};
  const spec=await createProductionTask(taskCtx,propose,{seed,beforeSave:(spec,manager)=>planning.linkPreparedTask(seed,spec,manager,true)});assert.equal(spec.objective,objective);assert.deepEqual(spec.scope.allowedPaths,[path]);assert.equal(readProductionTaskInput(taskCtx).spec.specHash,spec.specHash);assert.equal(planning.links()[0].controlledTaskId,spec.taskId);
 });
 assert.equal(started,1);assert.equal(questions,3);assert.equal(actions.length,0);assert.equal(existsSync(join(f.source,'.git')),false);assert.equal(git(f.repo,'status','--porcelain'),'');
});
test('project plan without Git prepares the current folder and preserves the previously entered goal',async t=>{
 const f=sourceFixture(t),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;t.after(()=>old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old);
 const goal='Analizzare classi e funzioni ed eliminare concetti duplicati';ProjectPlanningRepository.open(f.data,f.source,inspect,{create:true}).createGoal(goal);
 const bus=new ProposalBus(f.root,planOutput),hooks=new Map(),notices=[];let command;
 extension({events:bus,registerCommand(_name,value){command=value},getAllTools:()=>[],setActiveTools(){},on(name,fn){const hs=hooks.get(name)??[];hs.push(fn);hooks.set(name,hs);return()=>{}}});
 const ctx={...channel(),cwd:f.source};ctx.sessionManager.getSessionId=()=> 'owner';
 const actions=["Approve the plan","Supervised mode","Back"];let question=0;
 ctx.ui.editor=async()=>{question++;assert.fail('The saved objective needs no new question')};
 ctx.ui.select=async(_title,options)=>{const action=actions.shift();assert.ok(options.includes(action),action);return action};ctx.ui.notify=(message,type)=>notices.push({message,type});
 for(const hook of hooks.get('session_start'))hook({},ctx);t.after(()=>{for(const hook of hooks.get('session_shutdown'))hook()});
 await command.handler('project plan',ctx);assert.equal(notices.filter(n=>n.type==='error').length,0,JSON.stringify(notices));assert.equal(actions.length,0);
 assert.equal(ProjectPlanningRepository.open(f.data,f.source,inspect).goals().at(-1).objective,goal);assert.equal(existsSync(join(f.source,'.git')),true);assert.equal(existsSync(f.repo),false);assert.equal(question,0);
});
test('missing source and destination parent remain editable in their wizard steps and show the exact path',async t=>{
 const f=sourceFixture(t),missing=join(f.root,'missing'),target=join(missing,'refactor'),inputs=[missing,f.source,target,f.repo,'Refactoring'],warnings=[],actions=["Back"];let factories=0;
 const ctx={...channel(),cwd:f.root};ctx.ui.editor=async()=>inputs.shift();ctx.ui.select=async(_title,options)=>{const action=actions.shift();assert.ok(options.includes(action));return action};ctx.ui.notify=(message,type)=>{if(type==='warning')warnings.push(message)};
 await showSourceProject(ctx,{},(source,target)=>{factories++;return new SourceProject(f.data,source,target,inspect)},()=>assert.fail('No project before approval'),()=>assert.fail('No selected project'),async()=>assert.fail('No task'));
 assert.equal(factories,1);assert.equal(warnings.length,2);assert.ok(warnings.every(w=>w.includes(missing)));assert.ok(warnings[0].includes('source folder'));assert.ok(warnings[1].includes('parent folder'));assert.equal(existsSync(f.repo),false);assert.deepEqual(readdirSync(f.data),[]);
});
test('filesystem missing-path diagnostics retain context without terminal controls',()=>{
 const error=Object.assign(new Error('file missing'),{code:'ENOENT',path:'src/\x1b[31mmissing.py'}),p=errorPresentation(error);
 assert.equal(p.code,'ENOENT');assert.equal(p.path,'src/missing.py');assert.ok(p.message.includes('Path: src/missing.py'));assert.doesNotMatch(p.message,/\x1b/);
});
test('missing Git is reported as an executable problem rather than copied into a source workflow',t=>{
 const f=sourceFixture(t),old=process.env.PATH;process.env.PATH='';t.after(()=>old===undefined?delete process.env.PATH:process.env.PATH=old);
 assert.throws(()=>productionProjectHasBaseline({cwd:f.source}),e=>e.code==='GIT_EXECUTABLE_UNAVAILABLE'&&e.path==='git');
});
test('ordinary repository roots keep their layout, executable modes and files hidden by ignore rules',async t=>{
 const f=fixture(t),source=join(f.root,'source');mkdirSync(source);writeFileSync(join(source,'.gitignore'),'*.dat\n');writeFileSync(join(source,'sample.dat'),Buffer.from([0,255,7]));writeFileSync(join(source,'runner.sh'),'#!/bin/sh\nexit 0\n');chmodSync(join(source,'runner.sh'),0o755);
 const host=new SourceProject(f.data,source,f.repo,inspect),p=host.propose('Pulire il codice');assert.equal(p.prefix,'');await host.approve(channel(),p);
 assert.match(git(f.repo,'ls-tree','HEAD'),/100755 blob .*runner.sh/);assert.ok(git(f.repo,'ls-files').includes('sample.dat'));assert.equal(git(f.repo,'status','--porcelain','--ignored'),'');
});
test('cancelled import and unavailable human channel do not create destination or import data',async t=>{
 const f=sourceFixture(t),p=f.proposal();assert.equal(await f.host.approve(channel(false),p),undefined);assert.equal(existsSync(f.repo),false);assert.deepEqual(readdirSync(f.data),[]);
 await assert.rejects(()=>f.host.approve({...channel(),mode:'rpc'},p),/HUMAN_CHANNEL_UNAVAILABLE/);assert.equal(existsSync(f.repo),false);
});
test('copied proposals cannot grant import authority',async t=>{const f=sourceFixture(t);await assert.rejects(()=>f.host.approve(channel(),structuredClone(f.proposal())),/PROPOSAL_INVALID/);assert.equal(existsSync(f.repo),false)});
for(const change of ['source','destination','session'])test(`source import refuses ${change} changing during confirmation`,async t=>{
 const f=sourceFixture(t),p=f.proposal(),ctx=channel();let session='human';ctx.sessionManager.getSessionId=()=>session;
 ctx.ui.confirm=async()=>{if(change==='source')writeFileSync(join(f.source,'base/signal.py'),'changed\n');if(change==='destination'){mkdirSync(f.repo);writeFileSync(join(f.repo,'mine'),'keep')}if(change==='session')session='other';return true};
 if(change==='session')assert.equal(await f.host.approve(ctx,p),undefined);else await assert.rejects(()=>f.host.approve(ctx,p),/CHANGED|TARGET_EXISTS/);assert.equal(existsSync(join(f.repo,'.git')),false);if(change==='destination')assert.equal(readFileSync(join(f.repo,'mine'),'utf8'),'keep');
});
for(const kind of ['nested target','overlap','source symlink','file symlink','target symlink','control data','credential'])test(`source import refuses ${kind} before mutation`,t=>{
 const f=sourceFixture(t);let source=f.source,target=f.repo;
 if(kind==='nested target'){const parent=join(f.root,'existing');mkdirSync(parent);git(parent,'init','-q');target=join(parent,'child')}
 if(kind==='overlap')target=join(source,'child');if(kind==='source symlink'){const link=join(f.root,'link');symlinkSync(source,link);source=link}
 if(kind==='file symlink')symlinkSync(join(source,'__init__.py'),join(source,'linked.py'));
 if(kind==='target symlink')symlinkSync(source,target);
 if(kind==='control data')target=join(f.data,'project');if(kind==='credential')writeFileSync(join(source,'.env'),'secret');
 assert.throws(()=>new SourceProject(f.data,source,target,inspect).propose('Refactoring'),/PATH_UNSAFE|TARGET_EXISTS|NESTED_REPOSITORY/);assert.equal(existsSync(join(f.source,'.git')),false);
});
test('missing Git identity fails before an import starts',t=>{const f=sourceFixture(t,{identity:false});assert.throws(f.proposal,/IDENTITY_REQUIRED/);assert.equal(existsSync(f.repo),false);assert.deepEqual(readdirSync(f.data),[])});
test('approved explicit identity is bound to the import and saved only in the new repository',async t=>{
 const f=sourceFixture(t,{identity:false}),identity={name:'Nome scelto',email:'scelto@example.invalid'},p=f.host.propose('Refactoring',identity);identity.name='Changed after proposal';
 assert.equal(p.localGitIdentity.name,'Nome scelto');assert.ok(Object.isFrozen(p.localGitIdentity));assert.ok(f.host.narrative(p).includes('Nome scelto <scelto@example.invalid>'));assert.equal(existsSync(f.repo),false);assert.equal(existsSync(join(f.home,'.gitconfig')),false);assert.deepEqual(readdirSync(f.data),[]);
 await f.host.approve(channel(),p);assert.equal(git(f.repo,'config','--local','--get','user.name'),'Nome scelto');assert.equal(git(f.repo,'config','--local','--get','user.email'),'scelto@example.invalid');
 assert.equal(git(f.repo,'show','-s','--format=%an <%ae>|%cn <%ce>'),'Nome scelto <scelto@example.invalid>|Nome scelto <scelto@example.invalid>');assert.equal(existsSync(join(f.home,'.gitconfig')),false);assert.equal(existsSync(join(f.source,'.git')),false);
 const store=DurableStore.sourceImport(f.data,api.hashBytes(Buffer.from(f.repo)),inspect),result=JSON.parse(store.read(store.readProjectIndex())),intent=JSON.parse(store.read(result.intent)),receipt=JSON.parse(store.read(intent.approval));assert.deepEqual(receipt.request.payload.localGitIdentity,p.localGitIdentity);
});
test('cancelled explicit identity import leaves both source and Git configuration untouched',async t=>{
 const f=sourceFixture(t,{identity:false}),p=f.host.propose('Refactoring',{name:'Autore',email:'autore@example.invalid'});assert.equal(await f.host.approve(channel(false),p),undefined);
 assert.equal(existsSync(f.repo),false);assert.equal(existsSync(join(f.home,'.gitconfig')),false);assert.equal(existsSync(join(f.source,'.git')),false);assert.deepEqual(readdirSync(f.data),[]);
});
test('invalid explicit identity fails before creating any project or durable intent',t=>{
 const f=sourceFixture(t,{identity:false});for(const identity of [{name:'',email:'a@b'},{name:'Autore\nInjected',email:'a@b'},{name:'<Autore>',email:'a@b'},{name:'Autore',email:'a b'},{name:'Autore',email:'a'.repeat(257)}])assert.throws(()=>f.host.propose('Refactoring',identity),/GIT_IDENTITY_INVALID/);
 assert.equal(existsSync(f.repo),false);assert.equal(existsSync(join(f.home,'.gitconfig')),false);assert.deepEqual(readdirSync(f.data),[]);
});
test('wizard without inherited identity asks for author details and proceeds to an approved plan',async t=>{
 const f=sourceFixture(t,{identity:false}),bus=new ProposalBus(f.root,planOutput),scout=new PreTaskScout(bus,'owner');t.after(()=>scout.close());const inputs=[f.source,f.repo,'Refactoring completo','Autore scelto','autore@example.invalid'],actions=["Create the project","Approve the plan","Back to project"],notices=[];let selected;
 const ctx={...channel(),cwd:f.root};ctx.ui.editor=async(title)=>{assert.ok(inputs.length);if(inputs.length===2)assert.ok(title.includes('name'));if(inputs.length===1)assert.ok(title.includes('email'));return inputs.shift()};ctx.ui.select=async(_title,options)=>{const action=actions.shift();assert.ok(options.includes(action),action);return action};ctx.ui.notify=(message,type)=>notices.push({message,type});
 await showSourceProject(ctx,scout,(source,target)=>new SourceProject(f.data,source,target,inspect),root=>ProjectPlanningRepository.open(f.data,root,inspect,{create:true}),root=>selected=root,async()=>assert.fail('No supervised task selected'));
 assert.equal(selected,f.repo);assert.equal(inputs.length,0);assert.equal(actions.length,0);assert.ok(ProjectPlanningRepository.open(f.data,f.repo,inspect).current());assert.equal(git(f.repo,'config','--local','--get','user.email'),'autore@example.invalid');assert.equal(existsSync(join(f.home,'.gitconfig')),false);assert.equal(notices.filter(n=>n.type==='error').length,0);
});
test('cancelling author entry keeps the wizard free of filesystem side effects',async t=>{
 const f=sourceFixture(t,{identity:false}),inputs=[f.source,f.repo,'Refactoring',undefined],ctx={...channel(),cwd:f.root};ctx.ui.editor=async()=>inputs.shift();ctx.ui.select=async()=>assert.fail('No confirmation after cancel');
 await showSourceProject(ctx,{},(source,target)=>new SourceProject(f.data,source,target,inspect),()=>assert.fail('No planning'),()=>assert.fail('No selected project'),async()=>assert.fail('No task'));
 assert.equal(inputs.length,0);assert.equal(existsSync(f.repo),false);assert.equal(existsSync(join(f.home,'.gitconfig')),false);assert.deepEqual(readdirSync(f.data),[]);
});
for(const point of ['afterIntent','afterCopy','afterBaseline'])test(`interruption at ${point} preserves evidence and refuses silent replay`,async t=>{
 const f=sourceFixture(t),host=new SourceProject(f.data,f.source,f.repo,inspect,p=>{if(p===point)throw new Error('fault-double')});await assert.rejects(()=>host.approve(channel(),host.propose('Refactoring')),/fault-double/);
 assert.throws(()=>new SourceProject(f.data,f.source,f.repo,inspect).propose('Refactoring'),/ALREADY_STARTED/);assert.equal(existsSync(join(f.source,'.git')),false);
 const store=DurableStore.sourceImport(f.data,api.hashBytes(Buffer.from(f.repo)),inspect);assert.ok(store.readProjectIndex());
 if(point==='afterBaseline'){const old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;t.after(()=>old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old);productionOpenProject(f.repo);assert.equal(git(f.repo,'rev-list','--count','HEAD'),'1')}
});
test('UI import → real read-only planning Scout → approved plan → normal TaskSpec in the selected project',async t=>{
 const f=sourceFixture(t),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;t.after(()=>old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old);
 const bus=new ProposalBus(f.root,(q,params)=>{
  assert.equal(params.cwd,f.repo);assert.ok(params.task.includes('src/asw/base/signal.py'));
  return planOutput(q);
 }),scout=new PreTaskScout(bus,'owner');t.after(()=>scout.close());let selected,started=0;const actions=["Create the project","Approve the plan","Prepare and start a ready task"],inputs=[f.source,f.repo,'Rifattorizzare tutta la libreria'];
 const ctx={...channel(),cwd:f.root};ctx.ui.editor=async(_title,prefill)=>inputs.length?inputs.shift():prefill;
 ctx.ui.select=async(_title,options)=>{const action=actions.length?actions.shift():options[0];assert.ok(options.includes(action),action);return action};
 await showSourceProject(ctx,scout,(source,target)=>new SourceProject(f.data,source,target,inspect),root=>ProjectPlanningRepository.open(f.data,root,inspect,{create:true}),root=>selected=root,async(root,seed,planning)=>{
  started++;assert.equal(root,f.repo);
  const taskCtx={...channel(),cwd:root};taskCtx.ui.editor=async(_title,prefill)=>prefill;taskCtx.ui.select=async(_title,choices)=>choices.includes("Create the task")?"Create the task":"Next";
  const propose=async(objective,hints)=>{const q=preTaskRequest(root,objective,hints);return validatePreTaskProposal({schemaVersion:1,phase:'PRE_TASK_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:api.hashCanonical(q),relevantFiles:['src/asw/base/signal.py'],proposedScope:['src/asw/base/signal.py'],acceptanceCriteria:['identity conserva il comportamento'],existingTests:[],validations:[{kind:'REVIEW',description:'Review della compatibilità',paths:['src/asw/base/signal.py'],expectedLines:[]}],architectureFindings:['Pacchetto Python importato in src/asw'],designExpectations:['Preservare identity'],ambiguities:[],risks:[],explanation:'Refactoring locale'},q)};
  const spec=await createProductionTask(taskCtx,propose,{seed,beforeSave:(spec,manager)=>planning.linkPreparedTask(seed,spec,manager,true)});assert.equal(spec.scope.repoRoot,root);assert.equal(readProductionTaskInput(taskCtx).spec.specHash,spec.specHash);assert.equal(planning.links()[0].controlledTaskId,spec.taskId);
 });
 assert.equal(selected,f.repo);assert.equal(started,1);assert.equal(bus.requests.filter(r=>r.method==='spawn').length,1);assert.equal(existsSync(join(f.source,'.git')),false);assert.equal(git(f.repo,'status','--porcelain'),'');
});
