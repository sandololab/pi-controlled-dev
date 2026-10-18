import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,statSync,rmSync,existsSync,renameSync,symlinkSync} from 'node:fs';
import {join,relative,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {ProjectPlanningRepository:Repository}=await import('../src/project-planning-repository.ts');
const {consultProjectPlan,showProjectPlanning}=await import('../src/project-planning-ui.ts');
const {plannedTaskDetail,readPlannedExecution,readProjectPlanSnapshot}=await import('../src/project-plan-consultation.ts');
const {projectExecutionReason}=await import('../src/project-planning.ts');
const {rebuildProjectPlanningView,rebuildHumanView}=await import('../src/human-repository.ts');
const {DurableStore}=await import('../src/store.ts');
const {LockManager,withLockMutation}=await import('../src/lock-manager.ts');
const {restartFixture}=await import('./recovery-fixture.mjs');
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
const task=(id,title,dependsOn=[])=>({plannedTaskId:id,title,objective:`Realizzare ${title}`,rationale:`Motivazione prevista ${title}`,
  scopeIntent:['file.txt'],acceptanceIntent:['Il comportamento resta compatibile'],validationIntent:['Verifica mirata con dati sintetici'],
  dependsOn,dependencyRationale:dependsOn.map(plannedTaskId=>({plannedTaskId,rationale:'Serve il risultato precedente'})),relevantMemoryRefs:[],
  designIntent:['Riutilizzare la struttura esistente'],implementationSteps:['Preparare la verifica','Applicare la correzione']});
const proposal=()=>({strategy:'Piccoli risultati verificabili',plannedTasks:[task('first','Primo punto'),task('second','Secondo punto',['first'])]});
const channel=()=>({mode:'tui',sessionManager:{getSessionId:()=> 'human'},ui:{notify(){},confirm:async()=>true}});
function fixture(t){const root=mkdtempSync(join(tmpdir(),'plan-consultation-')),repo=join(root,'repo'),data=join(root,'data');mkdirSync(repo);mkdirSync(data);writeFileSync(join(repo,'file.txt'),'base\n');
  git(repo,'init','-q');git(repo,'add','.');git(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base');
  t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,repo,data,planning:Repository.open(data,repo,()=> 'ACCEPT',{create:true})};}
async function approve(planning,p=proposal()){
  const goal=planning.goals().at(-1)??planning.createGoal('Correggere la libreria conservando la compatibilità');
  const draft=planning.propose(goal.goalId,{proposal:p,analysis:{proposal:p}},planning.baseline());return planning.approve(channel(),draft.revision);
}
function digestTree(root){const files=[];const visit=path=>{for(const name of readdirSync(path)){const child=join(path,name),stat=statSync(child);if(stat.isDirectory())visit(child);else files.push([relative(root,child),createHash('sha256').update(readFileSync(child)).digest('hex')]);}};visit(root);return files.sort((a,b)=>a[0].localeCompare(b[0]));}
function scripted(actions,edits=[]){const calls=[];return {calls,...channel(),ui:{...channel().ui,
  select:async(title,options)=>{calls.push({title,options});const action=actions.shift();assert.ok(action===undefined||options.includes(action),`${action} not in ${options}`);return action;},
  editor:async(title,initial)=>{calls.push({title,initial});return edits.shift();}}};}
async function linkedFixture(t,checkpoint,customizePlan){const root=mkdtempSync(join(tmpdir(),'plan-linked-consultation-'));t.after(()=>rmSync(root,{recursive:true,force:true}));let planning;
  const f=await restartFixture(root,checkpoint,false,false,{},async({repo,data,spec})=>{
    planning=Repository.open(data,repo,()=> 'ACCEPT',{create:true});const p=proposal();p.plannedTasks[0].objective=spec.objective;customizePlan?.(p,spec);const plan=await approve(planning,p);
    const seed=planning.prepareStart(plan.planId,plan.revision,'first'),manager=new LockManager(data,'planning','link');
    withLockMutation(manager.root,planning.projectId,()=>planning.linkPreparedTask(seed,spec,manager,true));
  });t.after(()=>f.orchestrator?.dispose());return {root,planning,f};}

test('consulta del piano is a read-only menu route without editor, Scout, baseline preparation or notes',async t=>{
  const {planning,repo}=fixture(t);await approve(planning);const before=digestTree(planning.projectRoot),source=git(repo,'status','--porcelain');
  const ctx=scripted(["Consult the plan",'1. Primo punto — not started',"Back to plan","Refresh progress","Back"]);delete ctx.ui.editor;ctx.cwd=repo;
  ctx.prepareProjectBaseline=async()=>{throw new Error('Unexpected baseline mutation')};
  await showProjectPlanning(ctx,planning,{plan(){throw new Error('Unexpected Scout')}},undefined,'',()=>{throw new Error('Unexpected task creation')});
  const snapshot=readProjectPlanSnapshot(planning);assert.ok(Object.isFrozen(snapshot)&&Object.isFrozen(snapshot.points)&&Object.isFrozen(snapshot.points[0]));assert.equal(snapshot.points.length,2);assert.match(snapshot.summary,/Approved plan/);assert.match(snapshot.points[0].detail,/Motivazione prevista Primo punto/);
  assert.ok(ctx.calls[0].options.includes("Edit the plan"));assert.ok(!ctx.calls[0].options.includes("Review the plan"));
  assert.ok(ctx.calls.some(call=>call.title.includes("Implementation steps")&&call.title.includes("Planned checks")));
  assert.deepEqual(digestTree(planning.projectRoot),before);assert.equal(git(repo,'status','--porcelain'),source);assert.equal(planning.history().length,1);
});

test('native custom TUI selection reaches a linked task status and returns to plan without writes',async t=>{
  const {planning,f}=await linkedFixture(t,'READY'),before=digestTree(planning.projectRoot),screens=[],indices=[0,0,0,4,3];
  const ctx={...channel(),cwd:f.repo,ui:{...channel().ui,select:async()=>{throw new Error('Custom panel should be used')},
    custom:factory=>new Promise(resolve=>{const component=factory({terminal:{rows:44},requestRender(){}},null,null,resolve),index=indices.shift();assert.notEqual(index,undefined);
      for(let i=0;i<index;i++)component.handleInput('\x1b[C');screens.push(component.render(180).join('\n'));component.handleInput('\r');})}};
  await consultProjectPlan(ctx,planning);assert.equal(indices.length,0);assert.ok(screens.some(screen=>screen.includes("Linked task status")));
  assert.ok(screens.some(screen=>screen.includes('Task completion: not reached')));
  assert.ok(screens.some(screen=>screen.includes("Implementation steps")));assert.deepEqual(digestTree(planning.projectRoot),before);
});

test('verified durable results expose actual handoff files and distinguish task completion from integration',async t=>{
  const {planning,f}=await linkedFixture(t,'COMPLETED'),view=planning.progress()[0],before=digestTree(planning.projectRoot),read=readPlannedExecution(planning,view);
  assert.equal(read.available,true);assert.match(read.overview,/Task completion: verified/);assert.match(read.overview,/alone does not certify project integration/);
  assert.match(read.results,/file.txt — modified/);assert.match(read.results,/passed/);assert.match(read.results,/Positive \(PASS\)/);
  assert.match(read.decisions,/No recorded decisions/);assert.doesNotMatch(read.decisions,/Motivazione prevista/);assert.deepEqual(digestTree(planning.projectRoot),before);
  assert.doesNotMatch(read.overview,/CMP-001/);assert.equal(JSON.parse(read.technical).terminalReason,'CMP-001 satisfied from current durable evidence');
  // Presentation-only historical-reason double: the real ledger is loaded and never edited.
  const load=DurableStore.load;
  try{
    DurableStore.load=(root,...args)=>{const ledger=load(root,...args);return root===f.storeRoot?{...ledger,state:{...ledger.state,blockedReason:'Reviewer batch failed'}}:ledger;};
    const completed=planning.progress()[0],display=readPlannedExecution(planning,completed);
    assert.equal(completed.status,'COMPLETED');assert.doesNotMatch(completed.explanation,/Reviewer|blocker|independent review/);
    assert.match(display.overview,/Task completion: verified/);assert.doesNotMatch(display.overview,/Reviewer batch failed|Current reason|CMP-001/);
    assert.equal(JSON.parse(display.technical).blockedReason,'Reviewer batch failed');assert.deepEqual(digestTree(planning.projectRoot),before);
  }finally{DurableStore.load=load;}
});
test('current execution reasons depend on phase and known reasons use natural Italian without changing historical text',()=>{
  const raw='Reviewer batch failed';for(const state of ['COMPLETED','READY','AWAITING_HUMAN','IMPLEMENTING','REVIEWING'])assert.equal(projectExecutionReason({state,blockedReason:raw,terminalReason:'CMP-001 satisfied from current durable evidence'}),undefined);
  assert.match(projectExecutionReason({state:'BLOCKED',blockedReason:raw}),/Independent review could not be completed/);
  assert.doesNotMatch(projectExecutionReason({state:'BLOCKED',blockedReason:raw}),/Reviewer batch failed/);
  const state={state:'BLOCKED',blockedReason:'Unknown historical English failure'},saved=structuredClone(state);
  assert.match(projectExecutionReason(state),/Technical details/);assert.deepEqual(state,saved);
  assert.match(projectExecutionReason({state:'FAILED',blockedReason:raw,terminalReason:'Human definitive refusal; F verified'}),/The operator refused/);
});
test('implementation steps render one ordinal per row and preserve saved plan strings',()=>{
  const task=proposal().plannedTasks[0];task.implementationSteps=['1. Verificare il comportamento','  2) Applicare la correzione','Passo senza numero'];
  const before=structuredClone(task),plan={...proposal(),plannedTasks:[task]},view={task,status:'READY',explanation:'Da iniziare',links:[]};
  const display=plannedTaskDetail(plan,view);
  assert.match(display,/1\. Verificare il comportamento\n2\. Applicare la correzione\n3\. Passo senza numero/);assert.doesNotMatch(display,/1\. 1\.|2\.\s+2\)/);
  assert.deepEqual(task,before);
});

test('unlinked or unavailable records never invent execution status, decisions or results',t=>{
  const {planning}=fixture(t),p={...proposal(),revision:1,status:'APPROVED'},view={task:p.plannedTasks[0],status:'READY',explanation:'Da iniziare',links:[]};
  assert.match(plannedTaskDetail(p,view),/A plan item is not an execution/);assert.equal(readPlannedExecution(planning,view).available,false);
  const linked={...view,links:[{controlledTaskId:'missing'}]},read=readPlannedExecution(planning,linked);assert.equal(read.available,false);assert.match(read.overview,/execution registry is not available yet/);assert.match(read.results,/unavailable/);
});

test('a corrupt linked snapshot is reported as unavailable and is never repaired by consultation',async t=>{
  const {planning,f}=await linkedFixture(t,'READY'),view=planning.progress()[0],path=join(f.storeRoot,'state.json');writeFileSync(path,'{}');
  const before=digestTree(planning.projectRoot),read=readPlannedExecution(planning,view);assert.equal(read.available,false);assert.match(read.overview,/Status, outcomes and changed files cannot be certified/);
  assert.match(read.technical,/STORE_SNAPSHOT_MISMATCH/);assert.deepEqual(digestTree(planning.projectRoot),before);
});

test('suggested clarification cancellation does not submit a default answer or call Scout',async t=>{
  const {planning,repo}=fixture(t),goal=planning.createGoal('Refactoring');planning.saveClarifications(goal,[{questionId:'q',question:'Quale compatibilità?',why:'Serve il contratto',suggestedAnswer:'Conserva API e dati',answer:null}]);
  const before=planning.goals(),ctx=scripted(["Resume clarifications"],[undefined]);ctx.cwd=repo;
  await showProjectPlanning(ctx,planning,{plan(){throw new Error('Unexpected Scout')}},undefined,'',()=>{});
  assert.equal(ctx.calls.at(-1).initial,'Conserva API e dati');assert.match(ctx.calls.at(-1).title,/Suggested answer: you may approve or edit it/);assert.deepEqual(planning.goals(),before);
});

test('human explicitly edits a suggested answer before it becomes saved context',async t=>{
  const {planning,repo}=fixture(t),goal=planning.createGoal('Refactoring');planning.saveClarifications(goal,[{questionId:'q',question:'Quale compatibilità?',why:'Serve il contratto',suggestedAnswer:'Conserva API e dati',answer:null}]);
  const ctx=scripted(["Resume clarifications","Back"],['Conserva API e formato JSON']);ctx.cwd=repo;let calls=0;
  await showProjectPlanning(ctx,planning,{async plan(_cwd,mode){calls++;assert.equal(mode.goal.clarifications[0].answer,'Conserva API e formato JSON');return {proposal:proposal(),analysis:{}};}},undefined,'',()=>{});
  assert.equal(calls,1);assert.equal(planning.goals().at(-1).clarifications[0].answer,'Conserva API e formato JSON');assert.equal(planning.goals().at(-1).clarifications[0].suggestedAnswer,'Conserva API e dati');
});

test('modifica del piano preserves the previous approved revision until a new approval',async t=>{
  const {planning,repo}=fixture(t),approved=await approve(planning),ctx=scripted(["Edit the plan","Back"],['Aggiungi un esempio sintetico']);ctx.cwd=repo;let calls=0;
  await showProjectPlanning(ctx,planning,{async plan(_cwd,mode){calls++;assert.equal(mode.previous.contentDigest,approved.contentDigest);assert.equal(mode.correction,'Aggiungi un esempio sintetico');return {proposal:{...proposal(),strategy:'Aggiornamento proposto'},analysis:{}};}},undefined,'',()=>{});
  assert.equal(calls,1);assert.equal(planning.current().contentDigest,approved.contentDigest);assert.equal(planning.history().at(-1).status,'DRAFT');
});

test('planning investigates unanswered context before asking the operator and does not mistake paraphrases for progress',async t=>{
  const {planning,repo}=fixture(t),ctx=scripted([],[undefined]);ctx.cwd=repo;ctx.planningRequest='Refactoring compatibile';let calls=0;
  const questions=[{questionId:'q',question:'Quale versione deve restare compatibile?',why:'I file non definiscono la preferenza',suggestedAnswer:'API attuale'}];
  await showProjectPlanning(ctx,planning,{async plan(_cwd,mode){calls++;assert.equal(planning.goals().at(-1).clarifications,undefined);
    if(calls===1)assert.equal(mode.investigationQuestions,undefined);else assert.deepEqual(mode.investigationQuestions,questions);
    return {clarificationQuestions:questions,analysis:{explanation:calls===1?'Manca un dato':'Lo stesso dato è ancora necessario'}};
  }},undefined,'',()=>{throw new Error('Unexpected task creation')});
  assert.equal(calls,2);assert.equal(planning.goals().at(-1).clarifications[0].answer,null);assert.equal(ctx.calls.filter(call=>call.initial!==undefined).length,1);assert.equal(planning.history().length,0);
});

test('a repeated unanswered detail preserves the earlier human answer and resets only the investigation round',async t=>{
  const {planning,repo}=fixture(t),ctx=scripted([],['Mantieni API attuale',undefined]);ctx.cwd=repo;ctx.planningRequest='Refactoring compatibile';let calls=0;
  const questions=[{questionId:'q',question:'Quale compatibilità?',why:'Specifica quali chiamate devono funzionare'}];
  await showProjectPlanning(ctx,planning,{async plan(_cwd,mode){calls++;
    if(calls>2)assert.equal(mode.goal.clarifications[0].answer,'Mantieni API attuale');
    return {clarificationQuestions:questions,analysis:{explanation:'Manca un dettaglio preciso'}};
  }},undefined,'',()=>{});
  assert.equal(calls,4);const saved=planning.goals().at(-1).clarifications;assert.equal(saved.length,2);assert.equal(saved[0].answer,'Mantieni API attuale');assert.equal(saved[1].answer,null);
  assert.notEqual(saved[0].questionId,saved[1].questionId);assert.match(ctx.calls.at(-1).title,/Previous answer preserved: Mantieni API attuale/);
});

test('human plan export leads with observed completion and labels the unchanged stale proposal with its actual approval time',async t=>{
 const {planning,f}=await linkedFixture(t,'COMPLETED',p=>{p.strategy='Nessuna attività completata secondo lo stato fornito nella proposta.';p.plannedTasks[0].implementationSteps=['1. Preparare il controllo','2) Eseguire il caso sintetico'];p.plannedTasks[0].rationale='Serve fissare la compatibilità prima di correggere il codice.';});
 const before=planning.history(),ledger=DurableStore.load(f.storeRoot),plan=planning.current(),approval=JSON.parse(planning.store.read(planning.approvalEvidence(plan.planId,plan.revision)));
 const result=rebuildHumanView(f.storeRoot),path=join(result.vaultRoot,'Planning','Current Plan.md'),text=readFileSync(path,'utf8');
 assert.ok(text.indexOf('1 tasks completed out of 2')>=0);assert.ok(text.indexOf('1 tasks completed out of 2')<text.indexOf('Nessuna attività completata secondo'));assert.match(text,/## Current situation/);assert.match(text,/The strategy, analysis and assumptions below describe that moment/);assert.ok(text.includes("Approved on "+approval.receipt.confirmedAt));
 assert.match(text,/## Observed progress and integration/);assert.match(text,/Status: completed/);assert.match(text,/Project integration:/);assert.doesNotMatch(text,/1\. 1\.|2\. 2\)/);
 const matches=[...text.matchAll(/\]\(<([^>]+\.md)>\)/g)];assert.ok(matches.length>=3);for(const match of matches){assert.ok(!match[1].startsWith('/'));assert.ok(existsSync(resolve(dirname(path),decodeURIComponent(match[1]))),match[1]);}
 const point=readFileSync(join(result.vaultRoot,'Planning','Planned Tasks','Attività first.md'),'utf8');assert.match(point,/\]\(<\.\.\/\.\.\/Tasks\/Task task\.md>\)/);
 const taskText=readFileSync(join(result.vaultRoot,'Tasks','Task task.md'),'utf8');assert.match(taskText,/Serve fissare la compatibilità prima di correggere il codice/);assert.match(taskText,/## Planned steps[\s\S]*1\. Preparare il controllo\n2\. Eseguire il caso sintetico/);assert.match(taskText,/does not certify that the steps have already been performed/);assert.deepEqual(planning.history(),before);assert.deepEqual(DurableStore.load(f.storeRoot),ledger);
});
test('historic plan export keeps its own scope and never borrows the current plan progress',async t=>{
 const {planning}=fixture(t),original=await approve(planning),next=proposal();next.plannedTasks=[next.plannedTasks[0]];next.strategy='Piano ridotto al primo punto';await approve(planning,next);
 const before=planning.history();rebuildProjectPlanningView(planning);const vault=join(planning.projectRoot,'human'),historyPath=join(vault,'Planning','Plan History',`Piano ${original.planId} r1.md`),old=readFileSync(historyPath,'utf8'),current=readFileSync(join(vault,'Planning','Current Plan.md'),'utf8');
 assert.match(old,/This note preserves revision 1; it does not describe current progress/);assert.match(old,/Secondo punto/);assert.doesNotMatch(old,/## Current situation|## Observed progress/);assert.match(old,/\]\(<\.\.\/Planned Tasks\/Attività second\.md>\)/);assert.match(old,/\]\(<\.\.\/Current Plan\.md>\)/);assert.match(current,/0 tasks completed out of 1/);assert.doesNotMatch(current,/Secondo punto/);assert.deepEqual(planning.history(),before);
});

test('a relocated human collection regenerates only Documentazione and preserves the same personal notes',async t=>{
 const {planning,repo}=fixture(t);await approve(planning);rebuildProjectPlanningView(planning);const previous=join(planning.projectRoot,'human'),target=join(repo,'Documentazione');writeFileSync(join(previous,'Notes','operator.md'),'Annotazione conservata.\n');renameSync(previous,target);
 mkdirSync(join(repo,'.controlled-dev'));const baseline=git(repo,'rev-parse','HEAD');writeFileSync(join(repo,'.controlled-dev','project.json'),JSON.stringify({schemaVersion:1,projectId:planning.projectId,originalRepoRoot:repo,baselineCommit:baseline,baselineTree:git(repo,'rev-parse',baseline+'^{tree}')},Object.keys({schemaVersion:1,projectId:'',originalRepoRoot:'',baselineCommit:'',baselineTree:''}).sort()));
 writeFileSync(join(repo,'.git','info','exclude'),'/.controlled-dev/\n/Documentazione/\n');
 const before=planning.history();rebuildProjectPlanningView(planning);assert.equal(existsSync(previous),false);assert.equal(readFileSync(join(target,'Notes','operator.md'),'utf8'),'Annotazione conservata.\n');assert.match(readFileSync(join(target,'Planning','Current Plan.md'),'utf8'),/## Current situation/);assert.deepEqual(planning.history(),before);
});

test('human generation rejects a nested vault alias without writing outside the selected collection',async t=>{
 const {planning,root}=fixture(t);await approve(planning);const outside=join(root,'outside'),vault=join(planning.projectRoot,'human');mkdirSync(outside);mkdirSync(vault);mkdirSync(join(vault,'Planning'));symlinkSync(outside,join(vault,'Planning','Plan History'));writeFileSync(join(outside,'preserve.txt'),'operator bytes');
 assert.throws(()=>rebuildProjectPlanningView(planning),/HUMAN_PROJECTION_PATH_INVALID/);assert.equal(readFileSync(join(outside,'preserve.txt'),'utf8'),'operator bytes');assert.deepEqual(readdirSync(outside),['preserve.txt']);
});
