import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,channel,git,inspect,api,ProposalBus,planningProposal} from './greenfield-bootstrap-fixture.mjs';
const {CurrentProject,discoverCurrentProject}=await import('../src/current-project.ts');
const {ProjectPlanningRepository}=await import('../src/project-planning-repository.ts');
const {default:extension}=await import('../extensions/controlled-dev.ts');
test('large source baseline batches exact bytes and modes across Git argv boundaries',async t=>{
 const f=fixture(t,{empty:true});
 for(let i=0;i<270;i++)writeFileSync(join(f.repo,`sample ${i}.py`),`# source ${i}\n`);
 writeFileSync(join(f.repo,'-leading-option.py'),'# literal path\n');
 const before=performance.now();
 await new CurrentProject(f.repo,f.data,inspect).prepare(channel());
 t.diagnostic(`271-file bootstrap: ${Math.round(performance.now()-before)} ms`);
 assert.equal(git(f.repo,'status','--porcelain'),'');
 assert.equal(git(f.repo,'ls-files','-z').split('\0').filter(Boolean).length,271);
 for(const i of [0,127,128,255,269])assert.equal(git(f.repo,'show',`HEAD:sample ${i}.py`),`# source ${i}`);
 assert.equal(git(f.repo,'show','HEAD:-leading-option.py'),'# literal path');
});
const output=q=>planningProposal({schemaVersion:1,phase:'PROJECT_PLANNING_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:api.hashCanonical(q),strategy:'Realizzare il risultato richiesto',plannedTasks:[{plannedTaskId:'first-capability',title:'Primo incremento',objective:q.objective,rationale:'Risultato richiesto',scopeIntent:['src/app.py'],acceptanceIntent:['La funzionalità richiesta è disponibile'],validationIntent:['Revisionare il comportamento'],dependsOn:[],dependencyRationale:[],relevantMemoryIds:[]}]});
function setup(t,options){const f=fixture(t,{empty:true,...options}),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;t.after(()=>old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old);return f}
function entry(t,f,ctx,initialize=extension){const bus=new ProposalBus(f.root,output),hooks=new Map(),notices=[];let command;
 initialize({events:bus,registerCommand(_name,value){command=value},getAllTools:()=>[],setActiveTools(){},on(name,fn){const hs=hooks.get(name)??[];hs.push(fn);hooks.set(name,hs);return()=>{}}});
 ctx.sessionManager.getSessionId=()=> 'owner';ctx.ui.notify=(message,type)=>notices.push({message,type});
 for(const fn of hooks.get('session_start'))fn({},ctx);t.after(()=>{for(const fn of hooks.get('session_shutdown'))fn()});return {bus,hooks,notices,run:args=>command.handler(args,ctx)};
}
test('project new reviews and corrects the current-folder draft without approving a plan or starting Developer',async t=>{
 const f=setup(t),ctx={...channel(),cwd:f.repo},inputs=['Realizzare un calcolatore locale','Deve funzionare anche su Windows'],dialogs=[];
 let confirmations=0;
 ctx.ui.confirm=async()=>{assert.equal(++confirmations,1,'Only the initial baseline is authorized');return true};
 ctx.ui.editor=async()=>{assert.ok(inputs.length,'No extra location or author question');return inputs.shift()};
 const actions=["Correct the proposal","Back"];
 ctx.ui.select=async(title,choices)=>{dialogs.push(title);const action=actions.shift();assert.ok(choices.includes(action),`${action}: ${choices}`);return action};
 const e=entry(t,f,ctx);await e.run('project new');
 assert.equal(e.notices.filter(n=>n.type==='error').length,0,JSON.stringify(e.notices));assert.equal(inputs.length,0);assert.equal(actions.length,0);
 const planning=ProjectPlanningRepository.open(f.data,f.repo,inspect);
 assert.equal(planning.history().length,2);assert.equal(planning.current(),undefined);assert.equal(planning.links().length,0);
 assert.equal(git(f.repo,'rev-list','--count','HEAD'),'1');assert.deepEqual(readdirSync(f.repo),['.git']);
 const spawns=e.bus.requests.filter(r=>r.method==='spawn');assert.equal(spawns.length,2);
 assert.ok(spawns.every(r=>r.params.cwd===f.repo));assert.match(spawns[1].params.task,/Deve funzionare anche su Windows/);
 assert.ok(dialogs.every(title=>title.includes(`Official folder\n${f.repo}`)));
 assert.ok(e.notices.some(n=>n.message.includes('Status: draft')&&n.message.includes(f.repo)));
});

for(const wizardInput of [false,true])test(`current-folder clarifications survive cancellation, retain both replies and never approve a plan (${wizardInput?'wizard':'editor'})`,async t=>{
 const f=setup(t),ctx={...channel(),cwd:f.repo},questions=['Quale compilatore vuoi usare?','Quale interfaccia vuoi usare?'],answers=['C++20 con CMake','CLI tramite argomenti'];
 let reopening=false,confirmations=0;const asked=[];
 ctx.ui.confirm=async()=>{assert.equal(++confirmations,1,'Clarification replies must not authorize a plan');return true};
 const input=async(title,prefill,presentation)=>{
  const question=presentation?.question??title.split('\n')[0];
  if(!questions.includes(question)){assert.equal(reopening,false);return 'Realizzare un calcolatore locale'}
  assert.equal(prefill,'');asked.push(question);
  return reopening?answers[questions.indexOf(question)]:undefined;
 };
 ctx.ui.editor=input;if(wizardInput)ctx.ui.wizardInput=input;
 ctx.ui.select=async(_title,choices)=>choices.includes("Resume clarifications")?"Resume clarifications":choices.includes("Back")?"Back":assert.fail(String(choices));
 const e=entry(t,f,ctx);e.bus.output=(q,params)=>{
  const goal=JSON.parse(params.task.split('\nGOAL=')[1].split('\nPREVIOUS=')[0]);
  const saved=goal.clarifications?.filter(q=>q.answer!==null)??[];
  assert.deepEqual(saved.map(q=>q.answer),answers.slice(0,saved.length));
  if(saved.length===2)return output(q);
  const index=saved.length;
  return {...output(q),design:null,plannedTasks:[],clarificationQuestions:[{questionId:`choice-${index}`,question:questions[index],why:'Serve a definire il risultato richiesto.'}]};
 };
 await e.run('project new');
 assert.equal(e.notices.filter(n=>n.type==='error').length,0,JSON.stringify(e.notices));
 let planning=ProjectPlanningRepository.open(f.data,f.repo,inspect);
 assert.equal(planning.history().length,0);assert.equal(planning.current(),undefined);assert.equal(planning.goals().at(-1).clarifications[0].answer,null);
 const before=e.bus.run;await e.run('project new');assert.equal(e.bus.run,before,'Cancelling a saved question must not redispatch Scout');
 reopening=true;await e.run('project new');
 assert.equal(e.notices.filter(n=>n.type==='error').length,0,JSON.stringify(e.notices));
 planning=ProjectPlanningRepository.open(f.data,f.repo,inspect);
 assert.deepEqual(planning.goals().at(-1).clarifications.map(q=>q.answer),answers);
 assert.equal(planning.history().length,1);assert.equal(planning.current(),undefined);assert.equal(planning.links().length,0);
 assert.equal(confirmations,1);assert.deepEqual(asked,[questions[0],questions[0],...questions]);
 assert.equal(git(f.repo,'status','--porcelain'),'');assert.deepEqual(readdirSync(f.repo),['.git']);
});
for(const empty of [true,false])test(`bare controlled-dev initializes one project in the current folder (empty=${empty}, real Git/provider double)`,async t=>{
 const f=setup(t);if(!empty){writeFileSync(join(f.repo,'library.py'),'def identity(value):\n    return value\n');mkdirSync(join(f.repo,'__pycache__'));writeFileSync(join(f.repo,'__pycache__','library.pyc'),'cache');writeFileSync(join(f.repo,'.env'),'PRIVATE_LOCAL_VALUE');mkdirSync(join(f.repo,'.pi'));writeFileSync(join(f.repo,'.pi','settings.json'),'{}');}
 const ctx={...channel(),cwd:f.repo},objective='Proseguire lo sviluppo con esportazione CSV';let questions=0;
 ctx.ui.editor=async title=>{questions++;assert.match(title,/result|achieve/i);return objective};
 const actions=["Approve the plan","Supervised mode","Back"];ctx.ui.select=async(_title,choices)=>{const action=actions.shift();assert.ok(choices.includes(action),`${action}: ${choices}`);return action};
 const e=entry(t,f,ctx);await e.run('');assert.equal(e.notices.filter(n=>n.type==='error').length,0,JSON.stringify(e.notices));assert.equal(questions,1);assert.equal(actions.length,0);
 const planning=ProjectPlanningRepository.open(f.data,f.repo,inspect),id=planning.projectId,approved=planning.current();assert.ok(approved);assert.equal(planning.goals().at(-1).objective,objective);assert.equal(git(f.repo,'status','--porcelain'),'');assert.equal(git(f.repo,'rev-list','--count','HEAD'),'1');assert.equal(discoverCurrentProject(f.repo),f.repo);
 assert.equal(existsSync(join(f.repo,'src')),false,'No source layout rewrite or child project');
 if(!empty){assert.equal(readFileSync(join(f.repo,'library.py'),'utf8'),'def identity(value):\n    return value\n');assert.equal(readFileSync(join(f.repo,'.env'),'utf8'),'PRIVATE_LOCAL_VALUE');assert.equal(git(f.repo,'ls-files'),'library.py');}
 if(empty){mkdirSync(join(f.repo,'__pycache__'));writeFileSync(join(f.repo,'__pycache__','later.pyc'),'later cache');writeFileSync(join(f.repo,'.env.local'),'PRIVATE_LATER_VALUE');assert.equal(git(f.repo,'status','--porcelain'),'','Later local files must not dirty the source baseline');}
 const before=git(f.repo,'rev-parse','HEAD');ctx.ui.editor=async()=>assert.fail('Saved project must reopen without questions');ctx.ui.select=async(_title,choices)=>choices.includes("Back")?"Back":assert.fail(String(choices));
 for(const alias of ['', 'project new','project open','project existing'])await e.run(alias);
 assert.equal(e.notices.filter(n=>n.type==='error').length,0,JSON.stringify(e.notices));assert.equal(ProjectPlanningRepository.open(f.data,f.repo,inspect).projectId,id);assert.equal(planning.current().contentDigest,approved.contentDigest);assert.equal(git(f.repo,'rev-parse','HEAD'),before);assert.equal(e.bus.requests.filter(r=>r.method==='spawn').length,1);
});
test('current-folder cancellation saves the goal without initializing Git or dispatching Scout',async t=>{
 const f=setup(t),ctx={...channel(false),cwd:f.repo};ctx.ui.editor=async()=> 'Realizzare una nuova funzionalità';ctx.ui.select=async()=>assert.fail('No menu before the objective');
 const e=entry(t,f,ctx);await e.run('');assert.equal(e.notices.filter(n=>n.type==='error').length,0,JSON.stringify(e.notices));assert.equal(existsSync(join(f.repo,'.git')),false);assert.deepEqual(readdirSync(f.repo),[]);assert.equal(e.bus.requests.filter(r=>r.method==='spawn').length,0);assert.equal(ProjectPlanningRepository.open(f.data,f.repo,inspect).goals().length,1);
});
test('interactive natural requests use the project dialog while extension notifications and commands remain separate',async t=>{
 const f=setup(t),ctx={...channel(),cwd:f.repo,isIdle:()=>true};let edits=0;ctx.ui.editor=async()=>{edits++;return 'Aggiungere esportazione CSV'};
 const actions=["Approve the plan","Supervised mode","Back"];ctx.ui.select=async(_title,choices)=>{const action=actions.shift();assert.ok(choices.includes(action));return action};
 const e=entry(t,f,ctx),input=e.hooks.get('input')[0];assert.deepEqual(await input({text:'Una domanda',source:'interactive'},ctx),{action:'continue'});
 await e.run('');const planning=ProjectPlanningRepository.open(f.data,f.repo,inspect),before=planning.current();
 ctx.ui.editor=async()=>assert.fail('Natural request must not be requested again');ctx.ui.select=async(_title,choices)=>{assert.ok(choices.includes("Back"));return "Back"};
 for(const event of [{text:'Scout concluso',source:'extension'},{text:'/controlled-dev status',source:'interactive'},{text:'Un messaggio remoto',source:'rpc'},{text:'',source:'interactive'},{text:'Descrizione con allegato',source:'interactive',images:[{}]}])assert.deepEqual(await input(event,ctx),{action:'continue'});
 assert.deepEqual(await input({text:'Aggiungi ricerca per nome mantenendo la API esistente',source:'interactive'},ctx),{action:'handled'});
 assert.equal(e.notices.filter(n=>n.type==='error').length,0,JSON.stringify(e.notices));assert.equal(edits,1);assert.equal(e.bus.run,2);assert.equal(planning.history().length,2);assert.equal(planning.goals().at(-1).objective,'Aggiungi ricerca per nome mantenendo la API esistente');assert.equal(planning.current().contentDigest,before.contentDigest);assert.equal(git(f.repo,'status','--porcelain'),'');
 await e.run('request Aggiungi un filtro per data');assert.equal(e.bus.run,3);assert.equal(planning.goals().at(-1).objective,'Aggiungi un filtro per data');assert.equal(discoverCurrentProject(f.repo),f.repo);
});
test('discovery opens an existing imported child and uses the Git root from nested directories',async t=>{
 const f=setup(t),child=join(f.repo,'asw_refactoring');mkdirSync(child);git(child,'init','-q');git(child,'commit','--allow-empty','-qm','Initial');mkdirSync(join(child,'src'));mkdirSync(join(f.repo,'original_sources'));
 assert.equal(discoverCurrentProject(f.repo),child);assert.equal(discoverCurrentProject(join(child,'src')),child);
 const ctx={...channel(),cwd:f.repo};ctx.ui.editor=async()=>undefined;ctx.ui.select=async()=>assert.fail('No project location menu');const e=entry(t,f,ctx);await e.run('');
 assert.equal(e.notices.filter(n=>n.type==='error').length,0,JSON.stringify(e.notices));assert.equal(existsSync(join(f.repo,'.git')),false);assert.ok(ProjectPlanningRepository.open(f.data,child,inspect));assert.equal(ProjectPlanningRepository.open(f.data,f.repo,inspect),undefined);
});
test('ambiguous discovery preserves all repositories and creates no parent project',async t=>{
 const f=setup(t);for(const name of ['one','two']){const child=join(f.repo,name);mkdirSync(child);git(child,'init','-q');git(child,'commit','--allow-empty','-qm','Initial')}
 assert.throws(()=>discoverCurrentProject(f.repo),/CURRENT_PROJECT_AMBIGUOUS/);const ctx={...channel(),cwd:f.repo};ctx.ui.editor=async()=>assert.fail('No arbitrary choice');ctx.ui.select=async()=>assert.fail('No arbitrary choice');const e=entry(t,f,ctx);await e.run('');
 assert.equal(e.notices.filter(n=>n.type==='error').length,1);assert.match(e.notices.at(-1).message,/multiple repositories/);assert.equal(existsSync(join(f.repo,'.git')),false);assert.equal(ProjectPlanningRepository.open(f.data,f.repo,inspect),undefined);
});
test('setup verifies the exact approved snapshot after confirmation without overwriting concurrent edits',async t=>{
 const f=setup(t);writeFileSync(join(f.repo,'app.py'),'before');const project=new CurrentProject(f.repo,f.data,inspect),ctx=channel();ctx.ui.confirm=async()=>{writeFileSync(join(f.repo,'app.py'),'changed');return true};
 await assert.rejects(project.prepare(ctx),/CURRENT_PROJECT_CHANGED/);assert.equal(existsSync(join(f.repo,'.git')),false);assert.equal(readFileSync(join(f.repo,'app.py'),'utf8'),'changed');
});

test('current-folder setup requests missing Git identity and changes only the local configuration',async t=>{
 const f=setup(t,{identity:false}),ctx={...channel(),cwd:f.repo};writeFileSync(join(f.repo,'app.py'),'print("ready")\n');
 const answers=['Continuare il programma','Local Developer','local@example.invalid'],questions=[];
 ctx.ui.editor=async title=>{questions.push(title);return answers.shift()};const actions=["Approve the plan","Supervised mode","Back"];ctx.ui.select=async(_title,choices)=>{const chosen=actions.shift();assert.ok(choices.includes(chosen));return chosen};
 const e=entry(t,f,ctx);await e.run('');assert.equal(e.notices.filter(n=>n.type==='error').length,0,JSON.stringify(e.notices));assert.equal(questions.length,3);assert.equal(git(f.repo,'config','--local','user.name'),'Local Developer');assert.equal(git(f.repo,'config','--local','user.email'),'local@example.invalid');assert.equal(readFileSync(join(f.repo,'app.py'),'utf8'),'print("ready")\n');
 assert.throws(()=>git(f.repo,'config','--global','--get','user.name'));assert.throws(()=>git(f.repo,'config','--global','--get','user.email'));
});

test('in-place baseline completes a real local Git integration while preserving ignored files',async t=>{
 const f=setup(t);writeFileSync(join(f.repo,'app.py'),'before\n');writeFileSync(join(f.repo,'.env'),'PRIVATE_LOCAL_VALUE');mkdirSync(join(f.repo,'__pycache__'));writeFileSync(join(f.repo,'__pycache__','app.pyc'),'cache');await new CurrentProject(f.repo,f.data,inspect).prepare(channel());
 const {CandidateGit}=await import('../src/candidate-git.ts'),{workspaceManifest}=await import('../src/scope-guard.ts');
 const g=new CandidateGit(f.repo,f.data),base=g.head(),ref='refs/heads/controlled-dev/current-folder',work=join(f.data,'candidate');g.addTaskWorktree(ref,base,work);writeFileSync(join(work,'app.py'),'after\n');const commit=g.candidateCommit(work,ref,base,workspaceManifest(work,base),'Candidate');g.bindCandidate(ref,commit,base);
 const merged=g.prepareMerge(join(f.data,'merge'),base,commit,'Integrate');g.apply(g.target(),base,merged,'current-folder-integration');
 assert.equal(g.head(),merged);assert.equal(readFileSync(join(f.repo,'app.py'),'utf8'),'after\n');assert.equal(readFileSync(join(f.repo,'.env'),'utf8'),'PRIVATE_LOCAL_VALUE');assert.equal(readFileSync(join(f.repo,'__pycache__','app.pyc'),'utf8'),'cache');assert.equal(git(f.repo,'status','--porcelain'),'');
});

test('bare entry reopens a prepared task without asking for the goal or launching another Scout',async t=>{
 const f=setup(t);writeFileSync(join(f.repo,'app.py'),'print("ready")\n');await new CurrentProject(f.repo,f.data,inspect).prepare(channel());
 const {createProductionTask,readProductionTaskInput}=await import('../src/production-bridge.ts'),{preTaskRequest,validatePreTaskProposal}=await import('../src/pre-task-proposal.ts');
 const ctx={...channel(),cwd:f.repo},objective='Aggiungere esportazione CSV';ctx.sessionManager.getSessionId=()=> 'owner';ctx.ui.editor=async(_title,prefill)=>prefill||objective;ctx.ui.select=async(_title,choices)=>choices.includes("Create the task")?"Create the task":"Next";
 const task=await createProductionTask(ctx,async(objective,hints)=>{const q=preTaskRequest(f.repo,objective,hints);return validatePreTaskProposal({schemaVersion:1,phase:'PRE_TASK_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:api.hashCanonical(q),relevantFiles:['app.py'],proposedScope:['app.py'],acceptanceCriteria:['Esportazione CSV disponibile'],existingTests:[],validations:[{kind:'REVIEW',description:'Revisionare esportazione CSV',paths:['app.py'],expectedLines:[]}],architectureFindings:[],designExpectations:[],ambiguities:[],risks:[],explanation:'Estendere il programma esistente'},q)});
 assert.equal(task.objective,objective);let reopened=0;ctx.ui.editor=async()=>assert.fail('Prepared task already has an objective');ctx.ui.select=async(title,choices)=>{assert.ok(title.startsWith('Saved work\n'));assert.ok(title.includes(objective));assert.deepEqual(choices,["Continue task","Project plan","Back"]);reopened++;return "Back"};
 const e=entry(t,f,ctx);await e.run('');assert.equal(e.notices.filter(n=>n.type==='error').length,0,JSON.stringify(e.notices));assert.equal(reopened,1);assert.equal(e.bus.requests.filter(r=>r.method==='spawn').length,0);assert.equal(readProductionTaskInput(ctx).spec.specHash,task.specHash);
});

test('host wrapper profile reaches the current-project native design planner (real Git/provider double)',async t=>{
 const {createControlledDevExtension}=await import('../src/host-api.ts');
 const f=setup(t),ctx={...channel(),cwd:f.repo},profile={schemaVersion:1,id:'systemist_factory',common:['Preserve requirement source links'],phases:{ProjectPlanning:['Link design increments to caller requirements'],TaskPlanning:['Task only marker']}};
 ctx.ui.editor=async()=> 'Proseguire lo sviluppo a partire dai requisiti disponibili';ctx.ui.select=async(_title,choices)=>choices.includes("Back")?"Back":assert.fail(String(choices));
 const e=entry(t,f,ctx,createControlledDevExtension(profile));profile.common[0]='Changed after wrapper creation';await e.run('');
 assert.equal(e.notices.filter(n=>n.type==='error').length,0,JSON.stringify(e.notices));
 const task=e.bus.requests.find(r=>r.method==='spawn').params.task;
 assert.match(task,/Preserve requirement source links/);assert.match(task,/Link design increments to caller requirements/);assert.match(task,/PACKAGE GUIDANCE/);
 assert.doesNotMatch(task,/Task only marker|Changed after wrapper creation/);assert.match(task,/Project Memory uses the existing native mechanism/);
 assert.equal(e.bus.run,1);assert.equal(git(f.repo,'status','--porcelain'),'');
});
