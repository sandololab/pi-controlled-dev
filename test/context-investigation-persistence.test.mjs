import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {ContextInvestigationRepository:Repository}=await import('../src/context-investigation-repository.ts');
const {recordContextInvestigationReads,contextInvestigationScopeDigest}=await import('../src/context-investigation.ts');
const {hashCanonical}=await import('../src/contract-json.ts');
const {LockManager}=await import('../src/lock-manager.ts');
const {taskWizard}=await import('../src/task-wizard.ts');
const {ProjectPlanningRepository,plannedSeedInvestigationBinding}=await import('../src/project-planning-repository.ts');
const {showProjectPlanning}=await import('../src/project-planning-ui.ts');
const {productionAutonomyDriver}=await import('../src/project-autonomy-production.ts');
const binding=(id='same-seed',scope=['file.txt'],kind='pre-task')=>({kind,subjectId:id,scopeDigest:contextInvestigationScopeDigest(scope)});
const question={question:'Quale formato deve restare compatibile?',why:'I file non definiscono questa preferenza.',suggestedAnswer:'JSON'};
const question2={question:'Quale codifica?',why:'Serve un’altra decisione.',suggestedAnswer:'UTF-8'};
function fixture(t){const root=mkdtempSync(join(tmpdir(),'persistent-investigation-')),repo=join(root,'repo'),data=join(root,'data');mkdirSync(repo);mkdirSync(data);writeFileSync(join(repo,'file.txt'),'base\n');t.after(()=>rmSync(root,{recursive:true,force:true}));const open=()=>Repository.open(data,repo,()=> 'ACCEPT');return {root,repo,data,open,session:(b=binding())=>open().bind(b)};}
function read(f,path,content){writeFileSync(join(f.repo,path),content);const transcript=join(f.root,'read.jsonl'),id=randomUUID();writeFileSync(transcript,[{message:{role:'assistant',content:[{type:'toolCall',name:'read',id,arguments:{path}}]}},{message:{role:'toolResult',toolName:'read',toolCallId:id,isError:false,content:[{type:'text',text:content}]}}].map(JSON.stringify).join('\n'));return recordContextInvestigationReads({},transcript,f.repo);}
const advance=(session,result={},questions=[question])=>session.finish(session.reserve(),result,questions);
const loader=new URL('./load-source.mjs',import.meta.url).href,moduleURL=new URL('../src/context-investigation-repository.ts',import.meta.url).href,lockURL=new URL('../src/lock-manager.ts',import.meta.url).href;
function worker(f,body){return `import {installSourceLoader} from ${JSON.stringify(loader)};installSourceLoader();const {ContextInvestigationRepository:Repository}=await import(${JSON.stringify(moduleURL)});const {LockManager}=await import(${JSON.stringify(lockURL)});const data=${JSON.stringify(f.data)},repo=${JSON.stringify(f.repo)},binding=${JSON.stringify(binding())};${body}`;}
function crash(f,body){const result=spawnSync(process.execPath,['--input-type=module','--eval',worker(f,body)],{encoding:'utf8',timeout:15000});assert.ifError(result.error);assert.equal(result.signal,'SIGKILL',result.stdout+result.stderr);}
function ui(actions=[],answers=[]){const calls=[];return {calls,notify(message){calls.push({message})},select:async(title,options)=>{const action=actions.shift();assert.ok(action===undefined||options.includes(action));calls.push({title,options});return action},editor:async(title,initial)=>{calls.push({title,initial});return answers.shift()}};}
const proposal=()=>({schemaVersion:1,phase:'PRE_TASK_PROPOSAL',proposalOnly:true,requestId:'request',requestHash:'a'.repeat(64),relevantFiles:['file.txt'],proposedScope:['file.txt'],acceptanceCriteria:['Compatibilità conservata'],existingTests:[],validations:[{kind:'REVIEW',description:'Controlla la compatibilità',paths:['file.txt'],expectedLines:[]}],architectureFindings:[],designExpectations:[],ambiguities:[],risks:[],explanation:'Proposta in sola lettura'});

test('reopening preserves reservations, finite limits and cumulative A-B-A reads across explicit human rounds',t=>{
 const f=fixture(t);assert.equal(advance(f.session(),read(f,'a.py','A')).newFacts,1);assert.equal(advance(f.session(),read(f,'b.py','B')).newFacts,1);assert.equal(advance(f.session(),read(f,'a.py','A')).newFacts,0);assert.equal(f.session().canInvestigate(),false);
 const before=f.session().snapshot();assert.throws(()=>f.session().reserve(),/OPERATOR_REQUIRED/);assert.deepEqual(f.session().snapshot(),before);
 f.session().confirmAnswers([{question:question.question,answer:'Mantieni JSON'}]);assert.equal(f.session().snapshot().round,1);assert.equal(f.session().snapshot().seen.length,2);
 assert.equal(advance(f.session(),read(f,'b.py','B')).newFacts,0);assert.equal(advance(f.session(),{}).retry,false);const repeated=f.session().snapshot();f.session().confirmAnswers([{question:question.question,answer:'Mantieni JSON'}]);assert.equal(f.session().snapshot().attempts,repeated.attempts);
 assert.equal(f.session(binding('different-seed')).snapshot().attempts,0);const ordered=f.session(binding('ordered',['b.py','a.py']));advance(ordered);assert.equal(f.session(binding('ordered',['a.py','b.py','a.py'])).snapshot().attempts,1);assert.equal(f.session(binding('same-seed',['another.txt'])).snapshot().attempts,0);assert.ok(f.open().store.root.startsWith(f.data+'/'));assert.equal(readdirSync(f.repo).includes('controlled-dev'),false);
});
test('provider failure and copied/model result metadata consume attempts and never manufacture new reads',t=>{
 const f=fixture(t),s=f.session();s.finish(s.reserve());assert.equal(f.session().snapshot().attempts,1);assert.equal(advance(f.session(),JSON.parse(JSON.stringify(read(f,'a.py','A')))).newFacts,0);assert.equal(f.session().canInvestigate(),false);assert.throws(()=>s.finish({}),/RESERVATION_INVALID/);assert.throws(()=>s.confirmAnswers([]),/INVALID/);
});
test('real process death after reservation CAS retains its cost and reclaims only the exact dead namespace lease',t=>{
 const f=fixture(t);crash(f,`let armed=false;const manager=new LockManager(data,'context-investigation-host','context-00000000-0000-0000-0000-000000000001',point=>{if(armed&&point==='beforeRelease')process.kill(process.pid,'SIGKILL')});const r=Repository.open(data,repo,()=> 'ACCEPT',{manager});armed=true;r.bind(binding).reserve();`);
 const s=f.session();assert.equal(s.snapshot().attempts,1);assert.equal(s.snapshot().noProgress,1);assert.equal(s.snapshot().reservations.length,1);
 const dir=join(f.data,'controlled-dev','locks','workspaces'),audits=readdirSync(dir).filter(name=>name.endsWith('.context-reclaimed'));assert.equal(audits.length,1);const audit=JSON.parse(readFileSync(join(dir,audits[0]),'utf8'));assert.equal(audit.namespace,'context-investigations');assert.equal(audit.previous.ownerSessionId,'context-investigation-host');assert.ok(audit.successor.pid>0);
 advance(s);assert.equal(f.session().canInvestigate(),false);assert.equal(f.session().snapshot().attempts,2);
});
test('real death between immutable finish artifacts and index CAS retains the reserved attempt and ignores orphan artifacts',t=>{
 const f=fixture(t);crash(f,`let armed=false;const r=Repository.open(data,repo,()=> 'ACCEPT',{fault:()=>{if(armed)process.kill(process.pid,'SIGKILL')}});const s=r.bind(binding),token=s.reserve();armed=true;s.finish(token,{},[{question:'Unpublished question',why:'Must not replace the index'}]);`);
 const s=f.session();assert.equal(s.snapshot().attempts,1);assert.equal(s.snapshot().pendingQuestions.length,0);assert.equal(s.snapshot().reservations.length,1);assert.ok(readdirSync(join(f.open().store.root,'artifacts')).length>=4);advance(s);assert.equal(f.session().snapshot().attempts,2);
});
test('LIVE, UNKNOWN and unrelated owners cannot be reclaimed or alter the investigation index',t=>{
 for(const mode of ['live','unknown','foreign']){const f=fixture(t);f.session();const manager=new LockManager(f.data,mode==='foreign'?'project-planning-host':'context-investigation-host',`context-${randomUUID()}`),lock=manager.acquireWorkspace(f.repo);
  if(mode==='unknown'){const old=JSON.parse(readFileSync(lock.path,'utf8'));old.processIncarnation={pid:999999};writeFileSync(lock.path,JSON.stringify(old));}
  const bytes=readFileSync(lock.path);assert.throws(()=>f.open(),/WORKSPACE_LOCK_UNAVAILABLE/);assert.deepEqual(readFileSync(lock.path),bytes);assert.equal(readdirSync(join(manager.root,'workspaces')).filter(n=>n.endsWith('.context-reclaimed')).length,0);if(mode!=='unknown')manager.release(lock);
 }
});
test('concurrent process reservations cannot overspend the same binding; all published attempts survive reload',async t=>{
 const f=fixture(t);f.session();const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','--eval',worker(f,`try{Repository.open(data,repo,()=> 'ACCEPT').bind(binding).reserve();console.log('reserved')}catch(error){console.log('blocked:'+error.message)}`)]);let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('close',code=>{try{assert.equal(code,0,err);resolve(out.trim())}catch(error){reject(error)}})});
 const results=await Promise.all([run(),run(),run()]),committed=results.filter(r=>r==='reserved').length;assert.ok(committed>=1&&committed<=2);const published=f.session().snapshot().attempts;assert.ok(published>=committed&&published<=2);assert.equal(f.session().snapshot().reservations.length,published);if(published===1)advance(f.session());assert.equal(f.session().canInvestigate(),false);assert.throws(()=>f.session().reserve(),/OPERATOR_REQUIRED/);
});
test('wizard cancellation/reopen asks saved questions before any Scout and partial explicit answers survive',async t=>{
 const f=fixture(t),factory=()=>f.session(),initial={objective:'Refactoring',hints:[],compact:true};let calls=0;const propose=async()=>{calls++;return {...proposal(),clarificationQuestions:[question,question2]}};
 assert.equal(await taskWizard(ui([],['Conserva JSON',undefined]),propose,initial,factory),undefined);assert.equal(calls,2);const before=f.session().snapshot();assert.equal(before.answers.length,1);assert.deepEqual(before.answeredIndices,[0]);
 const cancelled=ui([],[undefined]);assert.equal(await taskWizard(cancelled,propose,initial,factory),undefined);assert.equal(calls,2);assert.deepEqual(f.session().snapshot(),before);assert.equal(cancelled.calls.find(c=>c.initial!==undefined).initial,'UTF-8');
 const result=await taskWizard(ui(["Create the task"],['UTF-8']),async(_objective,hints)=>{calls++;assert.match(hints.join('\n'),/Conserva JSON/);assert.match(hints.join('\n'),/UTF-8/);return proposal()},initial,factory);assert.equal(calls,3);assert.deepEqual(result.clarifications.map(a=>a.answer),['Conserva JSON','UTF-8']);assert.equal(f.session().snapshot().round,1);assert.equal(f.session().snapshot().attempts,1);
});
test('wizard errors keep attempts; reopening cannot grant unlimited failed Scout runs',async t=>{
 const f=fixture(t),initial={objective:'Refactoring',hints:[],compact:true};let calls=0;const failing=async()=>{calls++;throw new Error('provider failed')};await assert.rejects(taskWizard(ui(),failing,initial,()=>f.session()),/provider failed/);await assert.rejects(taskWizard(ui(),failing,initial,()=>f.session()),/provider failed/);assert.equal(await taskWizard(ui([],[undefined]),failing,initial,()=>f.session()),undefined);assert.equal(calls,2);assert.equal(f.session().snapshot().attempts,2);assert.equal(f.session().snapshot().pendingQuestions.length,1);
});
function planningFixture(t){const f=fixture(t),git=(...args)=>execFileSync('git',['-C',f.repo,...args],{encoding:'utf8'}).trim();git('init','-q');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base');return {...f,planning:ProjectPlanningRepository.open(f.data,f.repo,()=> 'ACCEPT',{create:true})};}
test('planning cancellation/reopen preserves operator questions without another investigation or duplicate Goal answers',async t=>{
 const f=planningFixture(t);let calls=0;const scout={async plan(){calls++;return {clarificationQuestions:[{questionId:'q',...question}],analysis:{note:'Still uncertain'}}}};
 await showProjectPlanning({mode:'tui',cwd:f.repo,sessionManager:{getSessionId:()=> 'human'},planningRequest:'Refactoring',ui:ui([],[undefined])},f.planning,scout,undefined,'',()=>{});assert.equal(calls,2);
 const reopened=ProjectPlanningRepository.open(f.data,f.repo,()=> 'ACCEPT');await showProjectPlanning({mode:'tui',cwd:f.repo,sessionManager:{getSessionId:()=> 'human'},ui:ui(["Resume clarifications"],[undefined])},reopened,scout,undefined,'',()=>{});assert.equal(calls,2);assert.equal(reopened.goals().at(-1).clarifications.length,1);assert.equal(reopened.goals().at(-1).clarifications[0].answer,null);
 const goal=reopened.goals().at(-1),s=f.session({kind:'planning',subjectId:goal.goalId,scopeDigest:hashCanonical({constraints:[],scope:['whole-project'],target:null})});assert.equal(s.snapshot().answers.length,0);assert.equal(s.snapshot().attempts,2);
});
test('host seed binding is stable across capabilities, rejects copies and stops autonomy on its first saved doubt',async t=>{
 const f=planningFixture(t),goal=f.planning.createGoal('Refactoring'),task={plannedTaskId:'point',title:'Correzione',objective:'Correggere il formato JSON',rationale:"Compatibility",scopeIntent:['file.txt'],acceptanceIntent:['Formato invariato'],validationIntent:['Test mirato'],dependsOn:[],dependencyRationale:[],relevantMemoryRefs:[],designIntent:['Conservare la struttura esistente'],implementationSteps:['Correggere']},p={strategy:'Piccoli passi',plannedTasks:[task]},draft=f.planning.propose(goal.goalId,{proposal:p,analysis:{}},f.planning.baseline());
 const plan=await f.planning.approve({mode:'tui',sessionManager:{getSessionId:()=> 'human'},ui:{confirm:async()=>true,notify(){}}},draft.revision),a=f.planning.prepareStart(plan.planId,plan.revision,'point'),b=f.planning.prepareStart(plan.planId,plan.revision,'point');assert.deepEqual(plannedSeedInvestigationBinding(a),plannedSeedInvestigationBinding(b));assert.throws(()=>plannedSeedInvestigationBinding(JSON.parse(JSON.stringify(a))),/AUTHORITY/);
 const policy={plan:{digest:plan.contentDigest},taskBounds:[{plannedTaskId:'point',allowedPaths:['file.txt'],protectedPaths:[],validationCommands:[]}]},host={current:undefined,dispose(){}},ctx={mode:'tui',cwd:f.repo,sessionManager:{getSessionId:()=> 'human'},ui:ui()},fakeAutonomy={store:f.planning.store,repoRoot:f.repo,planning:()=>f.planning,run:()=>({}),assertCurrent:()=>policy};let runs=0;const previous=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;
 try{const driver=productionAutonomyDriver(ctx,fakeAutonomy,host,{async propose(){runs++;return {...proposal(),clarificationQuestions:[question]}}});await assert.rejects(driver.execute('point','run'),/OPERATOR_REQUIRED/);await assert.rejects(driver.execute('point','run'),/OPERATOR_REQUIRED/);assert.equal(runs,1);const s=f.session({kind:'pre-task',...plannedSeedInvestigationBinding(a)});assert.equal(s.snapshot().attempts,1);assert.equal(s.snapshot().pendingQuestions[0].question,question.question);}finally{if(previous===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=previous;}
});

test('a valid workspace handle for another repository cannot create the investigation namespace',t=>{
 const f=fixture(t),other=join(f.root,'other');mkdirSync(other);const manager=new LockManager(f.data,'context-investigation-host',`context-${randomUUID()}`),workspaceLock=manager.acquireWorkspace(other);
 try{const before=readdirSync(join(f.data,'controlled-dev')).sort();assert.throws(()=>Repository.open(f.data,f.repo,()=> 'ACCEPT',{manager,workspaceLock}),/LOCK_REQUIRED/);assert.deepEqual(readdirSync(join(f.data,'controlled-dev')).sort(),before);assert.equal(manager.verifyWorkspaceLock(workspaceLock),true);}finally{manager.release(workspaceLock)}
});
