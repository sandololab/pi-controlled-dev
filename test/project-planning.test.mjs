import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,readdirSync,chmodSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {installSourceLoader} from './load-source.mjs';
import {fixtures} from './contract-fixtures.mjs';
installSourceLoader();
const model=await import('../src/project-planning.ts');
const {ProjectPlanningRepository:Repository}=await import('../src/project-planning-repository.ts');
const {ProjectMemoryRepository}=await import('../src/project-memory-repository.ts');
const {LockManager,withLockMutation}=await import('../src/lock-manager.ts');
const api=await import('../src/contracts.ts');
const {presentTrustedConfirmation,createTrustedConfirmationRequest}=await import('../src/trusted-confirmation.ts');
const {DurableStore}=await import('../src/store.ts');
const {rebuildProjectPlanningView,rebuildHumanView}=await import('../src/human-repository.ts');
const {createProductionTask,readProductionTaskInput}=await import('../src/production-bridge.ts');
const {preTaskRequest,validatePreTaskProposal,PreTaskScout,PreTaskProposalError,PRE_TASK_SCOUT_NAME}=await import('../src/pre-task-proposal.ts');
const {validatePlanningScout,readRefinementScoutOutput,materializeRefinement,REFINEMENT_OUTPUT_SCHEMA,refinementPayloadBudget,REFINEMENT_PAYLOAD_BYTES}=await import('../src/project-planning-scout.ts');
const {projectStatus,showProjectPlanning}=await import('../src/project-planning-ui.ts');
const {restartFixture}=await import('./recovery-fixture.mjs');
const {planningProposal}=await import('./greenfield-bootstrap-fixture.mjs');
const ui=(yes=true)=>({mode:'tui',sessionManager:{getSessionId:()=> 'planning-human-double'},ui:{confirm:async()=>yes,notify(){}}});
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
function fixture(t){const root=mkdtempSync(join(tmpdir(),'project-planning-')),data=join(root,'data'),repo=join(root,'repo');mkdirSync(data);mkdirSync(repo);mkdirSync(join(repo,'src'));mkdirSync(join(repo,'src','storage'));writeFileSync(join(repo,'src','storage','repository.ts'),'export const version = 1;\n');writeFileSync(join(repo,'README.md'),'App locale\n');
 git(repo,'init','-q');git(repo,'add','.');git(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base');t.after(()=>rmSync(root,{recursive:true,force:true}));
 const planning=Repository.open(data,repo,()=> 'ACCEPT',{create:true});return {root,data,repo,planning};}
function task(id,title,dependsOn=[],objective=title){return {plannedTaskId:id,title,objective,rationale:`${title} rende utilizzabile e verificabile un incremento della sincronizzazione.`,scopeIntent:['modulo di sincronizzazione'],acceptanceIntent:[`Il comportamento ${title} è osservabile con dati locali.`],validationIntent:['Scenario ripetibile e fixture generica'],dependsOn,dependencyRationale:dependsOn.map(id=>({plannedTaskId:id,rationale:`Il comportamento richiede il risultato del prerequisito ${id}.`})),relevantMemoryRefs:[]};}
function medium(){return {strategy:'Introduciamo un protocollo verificabile, poi discovery e trasferimento indipendenti, quindi conflitti, interfaccia ed end-to-end.',plannedTasks:[
 task('protocol','Definire il protocollo locale'),task('discovery','Trovare peer compatibili',['protocol']),task('transfer','Trasferire dati in modo verificabile',['protocol']),
 task('conflicts','Risolvere modifiche concorrenti',['transfer']),task('ux','Mostrare lo stato dei peer',['discovery']),task('e2e','Verificare la sincronizzazione completa',['conflicts','ux'])]};}
function draft(planning,p=medium(),goal=planning.goals().at(-1)??planning.createGoal('Aggiungere sincronizzazione locale alla piccola applicazione')){
 return planning.propose(goal.goalId,{proposal:p,analysis:{schemaVersion:1,goalDigest:goal.contentDigest,proposal:p}},planning.baseline());}
async function approved(planning,p=medium()){const plan=draft(planning,p);return planning.approve(ui(),plan.revision);}
function refinementOutput(request,mode){
 const target=mode.previous.plannedTasks.find(t=>t.plannedTaskId===mode.refinement.targetTaskId);
 const first={...task('refine-a','Primo risultato',target.dependsOn,'Preparare la verifica circoscritta'),scopeIntent:['README.md'],designIntent:['Riutilizzare i confini esistenti'],implementationSteps:['Preparare la fixture sintetica']};
 const second={...task('refine-b','Secondo risultato',['refine-a'],'Verificare il risultato del target'),scopeIntent:['src/storage/repository.ts'],designIntent:['Conservare il contratto pubblico'],implementationSteps:['Verificare il risultato richiesto']};
 const wire=t=>{const {relevantMemoryRefs,...rest}=t;return {...rest,relevantMemoryIds:[]}};
 return {schemaVersion:1,phase:'PROJECT_REFINEMENT_PROPOSAL',proposalOnly:true,requestId:request.requestId,requestHash:api.hashCanonical(request),...mode.refinement,
  explanation:'Separare preparazione e verifica per contenere il lavoro di ogni invocazione.',replacementTasks:[wire(first),wire(second)],
  coverage:target.acceptanceIntent.map((_,acceptanceIndex)=>({acceptanceIndex,taskIds:['refine-a','refine-b'],rationale:'I due risultati insieme soddisfano il criterio originario.'}))};
}
function refinementAnalysis(planning,previous,targetTaskId){
 const goal=planning.goals().at(-1),mode={goal,previous,refinement:planning.prepareRefinement(previous.contentDigest,targetTaskId)},request=preTaskRequest(planning.repoRoot,goal.objective),refinement=refinementOutput(request,mode);
 return {mode,request,result:{proposal:materializeRefinement(refinement,mode),analysis:{schemaVersion:1,requestId:request.requestId,requestHash:api.hashCanonical(request),goalDigest:goal.contentDigest,previousPlanDigest:previous.contentDigest,refinement}}};
}

function specFor(repo,objective,taskId='task-planned'){
 const f=fixtures(api),s={...f.TaskSpec,taskId,objective,scope:{...f.TaskSpec.scope,repoRoot:repo},plan:f.InputSource,currentTask:f.InputSource};s.specHash=api.hashContract('TaskSpec',s);return s;
}
function link(planning,seed,spec){const manager=new LockManager(planning.store.agentDataRoot,'planning-test','link-fixture');return withLockMutation(manager.root,planning.projectId,()=>planning.linkPreparedTask(seed,spec,manager,true));}

test('PP realistic six-capability plan is a valid fork/join DAG with explicit rationale and overlap warnings',()=>{const p=model.validatePlanProposal(medium());assert.equal(p.plannedTasks.length,6);assert.equal(p.plannedTasks.filter(t=>t.dependsOn.includes('protocol')).length,2);assert.ok(model.scopeOverlapWarnings(p).length);assert.match(model.planNarrative(p),/Expected result/);});
for(const [name,mutate,code] of [
 ['self dependency',p=>{p.plannedTasks[0].dependsOn=['protocol']},'SELF_DEPENDENCY'],
 ['missing node',p=>{p.plannedTasks[0].dependsOn=['missing']},'MISSING_DEPENDENCY'],
 ['cycle',p=>{p.plannedTasks[0].dependsOn=['transfer'];p.plannedTasks[0].dependencyRationale=[{plannedTaskId:'transfer',rationale:'Ciclo'}]},'CYCLE'],
 ['duplicate edge',p=>{p.plannedTasks[1].dependsOn=['protocol','protocol']},'DUPLICATE_EDGE'],
 ['duplicate ID',p=>{p.plannedTasks[1].plannedTaskId='protocol'},'DUPLICATE_ID'],
 ['missing rationale',p=>{p.plannedTasks[1].dependencyRationale=[]},'DEPENDENCY_RATIONALE'],
 ['semantic duplicate',p=>{p.plannedTasks[1].objective=p.plannedTasks[0].objective},'DUPLICATE_MEANING'],
 ['empty objective',p=>{p.plannedTasks[0].objective=''},'SCHEMA_INVALID'],
 ['blank acceptance',p=>{p.plannedTasks[0].acceptanceIntent=['   ']},'EMPTY_INTENT'],
 ['empty plan',p=>{p.plannedTasks=[]},'SCHEMA_INVALID'],
 ['forged status',p=>{p.status='APPROVED'},'SCHEMA_INVALID'],
])test(`PP rejects ${name}`,()=>{const p=medium();mutate(p);assert.throws(()=>model.validatePlanProposal(p),new RegExp(code));});

test('PP goal, draft, canonical digests and receipt persist without modifying repository',t=>{const {planning,repo}=fixture(t),before=git(repo,'rev-parse','HEAD'),p=draft(planning),receipt=planning.inputs()[0];assert.equal(p.status,'DRAFT');assert.equal(planning.current(),undefined);assert.equal(p.contentDigest,model.planDigest(p));assert.equal(receipt.planDigest,p.contentDigest);assert.equal(receipt.baselineCommit,before);assert.deepEqual(receipt.memoryRefs,[]);assert.equal(receipt.memoryContextRef,null);assert.equal(git(repo,'status','--porcelain'), '');assert.throws(()=>model.validatePlan({...p,strategy:'tampered'}),/DIGEST/);});

test('PP approval uses exact host presentation and persistent evidence; plan approval grants no task approval',async t=>{const {planning}=fixture(t),p=draft(planning);let shown;const ctx=ui();ctx.ui.confirm=async(title,text)=>{shown=text;assert.equal(planning.current(),undefined);return true};const a=await planning.approve(ctx,p.revision);assert.equal(a.status,'APPROVED');assert.match(shown,/protocollo locale/);assert.match(shown,/Subject: ProjectPlan/);const index=JSON.parse(planning.store.read(planning.store.readProjectIndex())),packet=JSON.parse(planning.store.read(index.approvals[0]));assert.equal(packet.receipt.purpose,'project-plan-approval');assert.equal(packet.request.subjectRevision,1);assert.equal(packet.request.payload.plan.contentDigest,p.contentDigest);assert.equal(existsSync(join(planning.projectRoot,'tasks')),false);assert.deepEqual(planning.progress().map(v=>v.status),['READY','WAITING','WAITING','WAITING','WAITING','WAITING']);});

test('PP cancellation and headless fail closed and preserve draft',async t=>{const {planning}=fixture(t),p=draft(planning);assert.equal(await planning.approve(ui(false),p.revision),undefined);await assert.rejects(()=>planning.approve({...ui(),mode:'rpc'},p.revision),/HUMAN_CHANNEL_UNAVAILABLE/);assert.equal(planning.current(),undefined);});
for(const variant of ['copy','forged','wrong revision','modified payload','agent request'])test(`PP refuses approval ${variant}`,async t=>{const {planning}=fixture(t),p=draft(planning),q=planning.prepareApproval(p.revision),r=await presentTrustedConfirmation(ui(),q);
 if(variant==='copy')assert.throws(()=>planning.applyApproval(q,JSON.parse(JSON.stringify(r))),/RECEIPT_INVALID/);
 if(variant==='forged')assert.throws(()=>planning.applyApproval(q,{humanAccepted:true}),/RECEIPT_INVALID/);
 if(variant==='wrong revision')assert.throws(()=>planning.applyApproval({...q,subjectRevision:2},r),/APPROVAL_INVALID/);
 if(variant==='modified payload')assert.throws(()=>planning.applyApproval({...q,payload:{...q.payload,plan:{...p,strategy:'modified'}}},r),/APPROVAL_INVALID/);
 if(variant==='agent request')await assert.rejects(()=>presentTrustedConfirmation(ui(),JSON.parse(JSON.stringify(q))),/REQUEST_UNREGISTERED/);
 assert.equal(planning.current(),undefined);
});
test('PP stale approval burns receipt and cannot approve an older draft',async t=>{const {planning}=fixture(t),p=draft(planning),q=planning.prepareApproval(1),r=await presentTrustedConfirmation(ui(),q);draft(planning);assert.throws(()=>planning.applyApproval(q,r),/STALE/);assert.throws(()=>planning.prepareApproval(1),/STALE/);assert.equal(planning.current(),undefined);});
test('PP revision stays draft until approval and supersedes atomically preserving all history',async t=>{const {planning}=fixture(t),one=await approved(planning),p=medium();p.strategy='Una nuova scoperta suggerisce di verificare discovery prima del trasferimento.';p.plannedTasks[2].dependsOn.push('discovery');p.plannedTasks[2].dependencyRationale.push({plannedTaskId:'discovery',rationale:'Il trasferimento deve usare peer già scoperti.'});const two=draft(planning,p);assert.equal(planning.current().revision,1);assert.equal(two.status,'DRAFT');await planning.approve(ui(),2);assert.deepEqual(planning.history().map(p=>p.status),['SUPERSEDED','APPROVED']);assert.equal(planning.history()[0].contentDigest,one.contentDigest);assert.equal(planning.history()[0].plannedTasks[2].dependsOn.length,1);});
test('PP changed meaning receives a fresh host identity and dependencies follow it without changing earlier approval',async t=>{
 const {planning}=fixture(t);const original=await approved(planning),p=medium();p.plannedTasks[0].objective='Attività semanticamente diversa';
 const corrected=draft(planning,p),newId=corrected.plannedTasks[0].plannedTaskId;assert.notEqual(newId,'protocol');
 assert.equal(corrected.revision,2);assert.equal(planning.current().contentDigest,original.contentDigest);
 assert.equal(corrected.plannedTasks[1].plannedTaskId,'discovery');assert.deepEqual(corrected.plannedTasks[1].dependsOn,[newId]);assert.equal(corrected.plannedTasks[1].dependencyRationale[0].plannedTaskId,newId);
 assert.equal(planning.history()[0].plannedTasks[0].plannedTaskId,'protocol');await planning.approve(ui(),2);assert.equal(planning.progress()[0].status,'READY');
});
test('PP starts from current approved revision only and rejects removed/outdated activities',async t=>{const {planning}=fixture(t),one=await approved(planning),p=medium();p.plannedTasks=p.plannedTasks.filter(t=>!['ux','e2e'].includes(t.plannedTaskId));await planning.approve(ui(),draft(planning,p).revision);assert.throws(()=>planning.prepareStart(one.planId,1,'protocol'),/STALE/);assert.throws(()=>planning.prepareStart(one.planId,2,'ux'),/NOT_READY/);});
test('PP host start binds separate execution link and rejects duplicate seeds and fabricated authority',async t=>{const {planning,repo}=fixture(t),p=await approved(planning),seed=planning.prepareStart(p.planId,1,'protocol'),other=planning.prepareStart(p.planId,1,'protocol'),spec=specFor(repo,seed.objective);assert.throws(()=>link(planning,{...seed},spec),/AUTHORITY/);const l=link(planning,seed,spec);assert.equal(l.controlledTaskId,spec.taskId);assert.equal(l.planDigest,p.contentDigest);assert.equal(planning.progress()[0].status,'ACTIVE');assert.throws(()=>link(planning,other,{...spec,taskId:'another'}),/DUPLICATE_EXECUTION/);assert.equal(planning.links().length,1);assert.equal(planning.progress()[1].status,'WAITING');});

test('PP real pre-task proposal leads through normal wizard/confirmation to TaskSpec, never Developer',async t=>{const {planning,repo,data}=fixture(t),p=await approved(planning),seed=planning.prepareStart(p.planId,1,'protocol'),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=data;t.after(()=>{if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=old});let proposals=0,confirmations=0;const ctx={...ui(),cwd:repo};ctx.ui.editor=async(title,current)=>current;ctx.ui.select=async(title,choices)=>choices.includes("Create the task")?"Create the task":"Next";ctx.ui.confirm=async()=>{confirmations++;return true};
 const propose=async(objective,hints)=>{proposals++;assert.ok(hints.some(h=>h.includes("Expected result")));const q=preTaskRequest(repo,objective,hints);return validatePreTaskProposal({schemaVersion:1,phase:'PRE_TASK_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:api.hashCanonical(q),relevantFiles:['README.md'],proposedScope:['README.md'],acceptanceCriteria:['Documentare il protocollo locale'],existingTests:[],validations:[{kind:'REVIEW',description:'Revisione indipendente del protocollo',paths:['README.md'],expectedLines:[]}],architectureFindings:['La documentazione è nel README'],designExpectations:['Riutilizzare il formato esistente'],ambiguities:[],risks:[],explanation:'Scope corretto dopo lettura corrente'},q)};
 const spec=await createProductionTask(ctx,propose,{seed,beforeSave:(spec,manager)=>planning.linkPreparedTask(seed,spec,manager,true)});assert.equal(proposals,1);assert.equal(confirmations,1);assert.equal(readProductionTaskInput(ctx).spec.specHash,spec.specHash);assert.equal(spec.objective,seed.objective);assert.equal(spec.humanGates.beforeImplementation,true);assert.equal(existsSync(join(planning.projectRoot,'tasks')),false);assert.equal(planning.links()[0].controlledTaskId,spec.taskId);assert.equal(git(repo,'status','--porcelain'),'');
});

test('PP simultaneous processes cannot create two active links for the same identity',async t=>{const {planning,repo,data,root}=fixture(t),p=await approved(planning),seed=planning.prepareStart(p.planId,1,'protocol'),barrier=join(root,'barrier');mkdirSync(barrier);writeFileSync(join(barrier,'spec.json'),JSON.stringify(specFor(repo,seed.objective)));
 const workers=Array.from({length:2},()=>{const child=spawn(process.execPath,['test/project-planning-worker.mjs','race',data,repo,barrier],{cwd:process.cwd()});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);return {child,done:new Promise((r,j)=>child.on('close',code=>code===0?r(output):j(new Error(output))))};});
 t.after(()=>{for(const worker of workers)if(worker.child.exitCode===null)worker.child.kill('SIGTERM')});
 for(let count=0;readdirSync(barrier).filter(n=>n.startsWith('ready-')).length<2;count++){if(count>3000)throw new Error('race timeout');await new Promise(r=>setTimeout(r,10));}
 writeFileSync(join(barrier,'go'),'go');const results=await Promise.all(workers.map(w=>w.done));assert.equal(results.filter(s=>s.includes('LINKED')).length,1,results.join('\n'));assert.equal(results.filter(s=>s.includes('REFUSED')).length,1);assert.equal(planning.links().length,1);
});

async function taskProgressFixture(t,phase,withDesign=false){const root=mkdtempSync(join(tmpdir(),'planning-workflow-'));t.after(()=>rmSync(root,{recursive:true,force:true}));let planning,plan;
 const f=await restartFixture(root,phase,false,false,{},async({repo,data,spec})=>{
   planning=Repository.open(data,repo,()=> 'ACCEPT',{create:true});const p=medium();if(withDesign)p.design=csvDesign();p.plannedTasks[0]=task('protocol','Protocollo',[],spec.objective);plan=await approved(planning,p);const seed=planning.prepareStart(plan.planId,1,'protocol');link(planning,seed,spec);return undefined;
 });return {root,planning,plan,f};}
for(const phase of ['READY','AWAITING_HUMAN','UNKNOWN'])test(`PP real ControlledTask ${phase} cannot satisfy a successor dependency`,async t=>{const {planning,f}=await taskProgressFixture(t,phase);assert.equal(planning.progress()[1].status,'WAITING');assert.notEqual(planning.progress()[0].status,'COMPLETED');f.orchestrator.dispose();});

test('PP execution link survives a normally approved TaskSpec scope revision',async t=>{
 const {planning,f}=await taskProgressFixture(t,'READY'),o=f.orchestrator,original=planning.links()[0].specHash;
 t.after(()=>o.dispose());
 const proposed={...o.spec,specRevision:o.spec.specRevision+1,scope:{...o.spec.scope,allowedPaths:[...o.spec.scope.allowedPaths,'extra.txt']}};
 proposed.specHash=api.hashContract('TaskSpec',proposed);
 o.openOnScopeChange(o.state.revision,proposed,'Il protocollo necessita di una fixture aggiuntiva.','owner');
 const {presentHumanGate}=await import('../src/orchestrator.ts'),pending=o.pendingHumanGate;
 const receipt=await presentHumanGate({mode:'tui',sessionManager:{getSessionId:()=> 'owner'},ui:{confirm:async()=>true}},pending);
 o.acceptHumanDecision(pending.snapshot,receipt);
 assert.notEqual(o.state.specHash,original);assert.equal(planning.links()[0].specHash,original);
 assert.equal(planning.progress()[0].status,'ACTIVE');assert.equal(planning.progress()[1].status,'WAITING');
});

test('PP completed predecessor unlocks two options; baseline stays unsafe until result is explicitly available',async t=>{
 const {planning,plan,f,root}=await taskProgressFixture(t,'FINAL_GATE'),o=f.orchestrator;
 const {presentHumanGate}=await import('../src/orchestrator.ts');
 const pending=o.pendingHumanGate;assert.ok(pending);
 const receipt=await presentHumanGate({mode:'tui',sessionManager:{getSessionId:()=> 'owner'},ui:{confirm:async()=>true}},pending);
 o.acceptHumanDecision(pending.snapshot,receipt);const result=o.complete(o.state.revision);assert.equal(result.state.state,'COMPLETED');
 assert.equal(DurableStore.load(f.storeRoot).state.state,'COMPLETED');assert.deepEqual(planning.progress().slice(0,3).map(v=>v.status),['COMPLETED','READY','READY']);
 assert.throws(()=>planning.prepareStart(plan.planId,1,'discovery'),/PROJECT_BASELINE_NOT_READY/);assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'base\n');
 // Test-only external baseline integration, explicitly outside the planning runtime.
 writeFileSync(join(f.repo,'file.txt'),'after\n');git(f.repo,'add','file.txt');git(f.repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','external integration fixture');
 const successor=planning.prepareStart(plan.planId,1,'discovery');assert.ok(successor);assert.ok(planning.prepareStart(plan.planId,1,'transfer'));
 const authenticated=successor.hints.join('');assert.match(authenticated,/Evidence verified by the prerequisite task program/);assert.ok(o.state.validations.every(id=>authenticated.includes(id)));assert.ok(authenticated.includes(o.state.candidate.digest));assert.match(authenticated,/\"status\":\"PASSED\"/);assert.match(authenticated,/\"exitCode\":0/);assert.match(authenticated,/\"verdict\":\"PASS\"/);assert.ok(authenticated.includes(git(f.repo,'rev-parse','HEAD')));assert.doesNotThrow(()=>preTaskRequest(f.repo,successor.objective,successor.hints));
 const previous=planning.current(),revision=planning.propose(planning.goals()[0].goalId,{proposal:{strategy:'Nuova scoperta documentata senza cambiare il significato delle attività.',plannedTasks:previous.plannedTasks},analysis:{goalDigest:planning.goals()[0].contentDigest}},planning.baseline());await planning.approve(ui(),revision.revision);
 const worker=spawnSync(process.execPath,['test/project-planning-worker.mjs','reload',f.data,f.repo],{encoding:'utf8'});assert.equal(worker.status,0,worker.stderr);const restored=JSON.parse(worker.stdout);assert.equal(restored.progress[0].status,'COMPLETED');assert.equal(restored.links[0].controlledTaskId,'task');assert.deepEqual(restored.history.map(p=>p.status),['SUPERSEDED','APPROVED']);assert.equal(restored.links[0].planRevision,1);
 rebuildHumanView(f.storeRoot);const human=join(planning.projectRoot,'human');assert.ok(existsSync(join(human,'Project.md')));assert.match(readFileSync(join(human,'Planning','Planned Tasks','Attività protocol.md'),'utf8'),/\[\[Task task\]\]/);o.dispose();
});

test('PP human projection preserves Notes, history and links; Markdown changes have zero machine authority',async t=>{const {planning,data,repo}=fixture(t);await approved(planning);const changed=medium();changed.plannedTasks[2].dependsOn.push('discovery');changed.plannedTasks[2].dependencyRationale.push({plannedTaskId:'discovery',rationale:'Nuova dipendenza ancora da approvare.'});draft(planning,changed);const files=rebuildProjectPlanningView(planning),human=join(planning.projectRoot,'human');for(const name of ['Project.md','Planning/Current Plan.md','Indexes/Planned Tasks.base'])assert.ok(files.includes(name));assert.equal(readdirSync(join(human,'Planning','Plan History')).length,2);assert.doesNotMatch(readFileSync(join(human,'Planning','Planned Tasks','Attività transfer.md'),'utf8'),/Requires \[\[Attività discovery/);const before=api.canonicalize(planning.history());writeFileSync(join(human,'Planning','Current Plan.md'),'APPROVED: remove all dependencies');writeFileSync(join(human,'Notes','personal.md'),'Una nota personale');rebuildProjectPlanningView(planning);assert.equal(api.canonicalize(planning.history()),before);assert.equal(readFileSync(join(human,'Notes','personal.md'),'utf8'),'Una nota personale');assert.match(readFileSync(join(human,'Planning','Current Plan.md'),'utf8'),/Requires \[Definire il protocollo locale\]\(<Planned Tasks\/Attività protocol\.md>/);assert.match(projectStatus(planning),/Possible next tasks/);
 const reload=spawnSync(process.execPath,['test/project-planning-worker.mjs','reload',data,repo],{encoding:'utf8'});assert.equal(reload.status,0,reload.stderr);assert.deepEqual(JSON.parse(reload.stdout).history,planning.history());});

test('PP tampered approval/current index fails closed on separate reload',async t=>{const {planning,data,repo}=fixture(t);await approved(planning);const ref=planning.store.readProjectIndex(),index=JSON.parse(planning.store.read(ref));index.approvals=[];const corrupt=planning.store.put('tampered-index',api.canonicalize(index),model.PLANNING_MEDIA);planning.store.replaceProjectIndex(ref,corrupt);assert.throws(()=>Repository.open(data,repo,()=> 'ACCEPT'),/APPROVAL_MISSING/);});
for(const rootName of ['home','media','tmp','run/media'])test(`PP rejects machine path in ${rootName} narrative`,()=>{const p=medium();p.plannedTasks[0].scopeIntent=['Leggere '+['',rootName,'person','source'].join('/')];assert.throws(()=>model.validatePlanProposal(p),/ABSOLUTE_PATH/);});

test('PP portability allows HTTPS references and refuses Windows absolute paths',()=>{
 const p=medium();p.strategy+=' Riferimento al protocollo: https://example.invalid/protocol.';
 assert.doesNotThrow(()=>model.validatePlanProposal(p));
 p.plannedTasks[0].scopeIntent=['Leggere '+['C','\\Users\\developer\\source'].join(':')];
 assert.throws(()=>model.validatePlanProposal(p),/ABSOLUTE_PATH/);
});

async function memoryFixture(f){const memory=ProjectMemoryRepository.open(f.data,f.repo,()=> 'ACCEPT',{create:true}),scope={kind:'component',path:'src/storage'},contents={
 'software-adr':{decisionKey:'storage-access',context:'Esiste un repository di dati.',decision:'Sincronizzare attraverso il repository esistente.',rationale:'Un solo confine di persistenza.',consequences:['Nessun accesso diretto dalla UI.'],alternatives:[]},
 'technical-lesson':{problemKey:'generic-fixtures',problem:'Regressioni locali non ripetibili',cause:'Fixture legata a un nome di progetto',rule:'Usare una fixture generica per ogni difetto reale.',loadWhen:{terms:['sincronizzazione'],paths:['src/storage']},invalidatedWhen:['Il meccanismo di test cambia.']},
 'project-convention':{convention:'Nomi espliciti per il protocollo',rationale:'Messaggi leggibili nei test.'},
 'technical-constraint':{constraint:'Nessun secondo database',rationale:'Il repository esistente resta unico.',consequences:['Riutilizzare la persistenza.']}};
 for(const [recordKind,content] of Object.entries(contents)){
 const evidenceRefs=recordKind==='technical-lesson'?[{kind:'repository-source',id:'source',relativePath:'src/storage/repository.ts',digest:api.hashBytes(readFileSync(join(f.repo,'src','storage','repository.ts')))}]:[];
 const r=memory.propose({recordKind,title:recordKind,scope,content,evidenceRefs,relatedTaskRefs:[],relatedRecordRefs:[]},{role:'host'});await memory.decide(ui(),r.recordId,recordKind==='software-adr'?'ACCEPTED':'ACTIVE');}
 const outside=memory.propose({recordKind:'project-convention',title:'Fuori ambito',scope:{kind:'directory',path:'unrelated'},content:contents['project-convention'],evidenceRefs:[],relatedTaskRefs:[],relatedRecordRefs:[]},{role:'host'});await memory.decide(ui(),outside.recordId,'ACTIVE');return memory;
}
test('PP bounded planning memory includes four kinds, excludes foreign scope and binds input/context receipt',async t=>{const f=fixture(t),memory=await memoryFixture(f),planning=Repository.open(f.data,f.repo,()=> 'ACCEPT',{memory}),goal=planning.createGoal('Aggiungere sincronizzazione locale'),selection=planning.planningMemory(goal,memory);assert.equal(selection.selected.length,4);assert.ok(selection.totalBytes<=12288);assert.equal(new Set(selection.selected.map(s=>s.record.recordKind)).size,4);const p=medium();p.plannedTasks[0].relevantMemoryRefs=selection.selected.map(s=>s.reference);const plan=planning.propose(goal.goalId,{proposal:p,analysis:{goalDigest:goal.contentDigest},memorySelection:selection},planning.baseline());assert.equal(planning.inputs()[0].memoryRefs.length,4);await planning.approve(ui(),plan.revision);rebuildProjectPlanningView(planning);assert.match(readFileSync(join(planning.projectRoot,'human','Planning','Current Plan.md'),'utf8'),/\[\[ADR SAD-/);rebuildProjectPlanningView(planning);const home=readFileSync(join(planning.projectRoot,'human','Home.md'),'utf8');assert.equal(home.split("## Project technical memory").length,2);assert.equal(home.split("## Project planning").length,2);});
test('PP planning memory conflict remains local and cannot silently select a decision',async t=>{const f=fixture(t),memory=await memoryFixture(f),first=memory.entries().find(e=>e.record.recordKind==='software-adr').record;const proposal=Object.fromEntries(['recordKind','title','scope','content','evidenceRefs','relatedTaskRefs','relatedRecordRefs'].map(k=>[k,first[k]]));proposal.content={...proposal.content,decision:'Scrivere direttamente dal componente UI.'};const r=memory.propose(proposal,{role:'host'});await memory.decide(ui(),r.recordId,'ACCEPTED');const goal=f.planning.createGoal('Aggiungere sincronizzazione');assert.throws(()=>f.planning.planningMemory(goal,memory),/PROJECT_MEMORY_CONFLICT/);assert.equal(f.planning.current(),undefined);});
test('PP unknown memory references and invalid model binding cannot enter a plan',async t=>{const f=fixture(t),memory=await memoryFixture(f),goal=f.planning.createGoal('Aggiungere sincronizzazione'),selection=f.planning.planningMemory(goal,memory),p=medium();p.plannedTasks[0].relevantMemoryRefs=[{...selection.selected[0].reference,recordId:'guessed'}];assert.throws(()=>f.planning.propose(goal.goalId,{proposal:p,analysis:{},memorySelection:selection},f.planning.baseline()),/MEMORY_BINDING/);const q=preTaskRequest(f.repo,goal.objective),wire={schemaVersion:1,phase:'PROJECT_PLANNING_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:'a'.repeat(64),strategy:medium().strategy,plannedTasks:medium().plannedTasks.map(t=>{const {relevantMemoryRefs,...rest}=t;return {...rest,relevantMemoryIds:[]}})};assert.throws(()=>validatePlanningScout(wire,q,{goal,selection}),/SCOUT_BINDING/);});

for(const phase of ['BLOCKED','FAILED'])test(`PP stored ControlledTask ${phase} blocks dependencies with a human explanation and preserves plan`,async t=>{
 const {planning,repo,data}=fixture(t),plan=await approved(planning),seed=planning.prepareStart(plan.planId,1,'protocol'),store=DurableStore.create(data,repo,'task-planned',()=> 'ACCEPT'),source=store.put('source','input','text/plain');
 const spec=specFor(repo,seed.objective);spec.plan={schemaVersion:1,inline:'input',snapshot:source};spec.currentTask=spec.plan;spec.specHash=api.hashContract('TaskSpec',spec);link(planning,seed,spec);
 const {CentralOrchestrator}=await import('../src/orchestrator.ts'),o=CentralOrchestrator.initialize(spec,{ownerSessionId:'owner',store,artifacts:[source],runners:{scout:async()=>{throw new Error('no dispatch')}}});
 // Same storage-only failure fixture pattern as recovery-fixture; no planning status is writable.
 const state={...o.state,state:phase,revision:1,lastEventId:'stored-failure',...(phase==='BLOCKED'?{blockedReason:'Il protocollo richiede una decisione tecnica.'}:{terminalReason:'Il task non ha soddisfatto i criteri.'})},records=o.context().records,catalog=store.catalog(records);
 const event={schemaVersion:1,id:state.lastEventId,taskId:spec.taskId,kind:'TRANSITION',transitionId:phase==='BLOCKED'?'TR-004':'TR-003',actor:'Orchestrator',sourceState:'PENDING',targetState:phase,previousRevision:0,revision:1,timestamp:state.updatedAt,reason:'Stored task failure fixture',evidenceRefs:[catalog.id],invalidatedEvidenceIds:[],stateAfter:store.put('stored-failure-state',api.canonicalize(state)),previousEventHash:o.events[0].eventHash,eventHash:'0'.repeat(64)};
 event.eventHash=api.hashContract('TransitionEvent',event);store.commit(state,event,records);
 assert.equal(planning.progress()[0].status,phase);assert.equal(planning.progress()[1].status,'WAITING');assert.match(planning.progress()[1].explanation,new RegExp(phase==='BLOCKED'?"a decision is required":"unsuccessful attempt"));assert.equal(planning.current().contentDigest,plan.contentDigest);o.dispose();
});

// Public RPC/provider double. It exercises actual pre-task Scout registration, acquisition,
// read-only transcript checks and physical terminal proof; it is not a real-model certification.
class PlanningBus {
 listeners=new Map();requests=[];tools=['read','structured_output'];definition;output;
 constructor(root,repo){this.root=root;this.repo=repo;this.session=join(root,'planning-scout-session.jsonl')}
 on(name,fn){const group=this.listeners.get(name)??new Set();group.add(fn);this.listeners.set(name,group);return()=>group.delete(fn)}
 emit(name,data){
  if(name==='pi-subagents:runtime-agent-register:v1'){this.definition=data.definition;assert.equal(data.name,PRE_TASK_SCOUT_NAME);data.result={ok:true,registration:{dispose(){}}};return}
  if(name!=='subagents:rpc:v1:request'){for(const fn of this.listeners.get(name)??[])fn(data);return}
  this.requests.push(data);let value;
  if(data.method==='ping')value={version:1,methods:['ping','spawn','status','interrupt','stop','resume'],session:{sessionId:'owner',sessionFile:null},events:{asyncComplete:'subagent:async-complete'},capabilities:{asyncSpawn:true,status:true,interrupt:true,stop:true,resume:true,processTerminalProof:{version:1,lifecycleArtifactVersion:3}}};
  else if(data.method==='spawn'){
   const request=JSON.parse(data.params.task.split('\nREQUEST=')[1].split('\nrequestHash=')[0]);const p=medium();
   this.output=planningProposal({schemaVersion:1,phase:'PROJECT_PLANNING_PROPOSAL',proposalOnly:true,requestId:request.requestId,requestHash:api.hashCanonical(request),strategy:p.strategy,plannedTasks:p.plannedTasks.map(t=>{const {relevantMemoryRefs,...rest}=t;return {...rest,relevantMemoryIds:this.memoryIds??[]}})});
   if(data.params.task.includes('\nREFINEMENT_BINDING=')){
     const refinement=JSON.parse(data.params.task.split('\nREFINEMENT_BINDING=')[1].split('\nCORRECTION=')[0]),target=JSON.parse(data.params.task.split('\nTARGET=')[1].split('\nREFINEMENT_BINDING=')[0]);
     this.output=refinementOutput(request,{previous:{plannedTasks:[target]},refinement});
   }
   if(this.omit)delete (this.omit==='implementationSteps'?this.output.plannedTasks[0]:this.output)[this.omit];
   if(this.forge)this.output.status='APPROVED';
   if(this.transformOutput)this.output=this.transformOutput(this.output);
   writeFileSync(this.session,[{type:'session',cwd:this.repo},{type:'message',message:{role:'system',sections:{preamble:`<active_agent name="${PRE_TASK_SCOUT_NAME}"/>`},toolsAdded:this.tools.map(name=>({name}))}}].map(JSON.stringify).join('\n'));value={details:{asyncId:'planning-run',runId:'planning-run'}};
  }else value={details:{lifecycleStatus:{processTerminal:{version:1,state:'observed',runId:'planning-run',runnerProcessInstanceId:'instance',observedAt:1,instances:[{kind:'runner',processInstanceId:'instance',closeObservedAt:1,exitCode:0,signal:null}],resumeDisposition:'resumable'}}},asyncSnapshot:{version:1,kind:'pi-subagents.async-status-snapshot',runs:[{id:'planning-run',state:'complete'}]}};
  this.emit(`subagents:rpc:v1:reply:${data.requestId}`,{version:1,requestId:data.requestId,success:true,data:value});
  if(data.method==='spawn')this.emit('subagent:async-complete',{id:'planning-run',runId:'planning-run',sessionId:'owner',state:'complete',success:true,exitCode:0,results:[{agent:PRE_TASK_SCOUT_NAME,context:'fresh',sessionFile:this.session,status:'completed',success:true,structuredOutput:this.output,launchResolvedExtensions:{version:1,source:'launch-resolved',disableAmbientExtensions:true,configured:[],required:[],runtime:['structured-output'],effective:['structured-output']}}]});
 }
}
test('PP broad objective uses existing pre-task Scout, exact bounded memory dispatch and generation receipt',async t=>{
 const f=fixture(t),memory=await memoryFixture(f),planning=Repository.open(f.data,f.repo,()=> 'ACCEPT',{memory}),goal=planning.createGoal('Aggiungere sincronizzazione locale'),selection=planning.planningMemory(goal,memory),bus=new PlanningBus(f.root,f.repo);bus.memoryIds=selection.selected.map(s=>s.reference.recordId);
 const before=git(f.repo,'status','--porcelain'),baseline=planning.baseline(),analysis=await new PreTaskScout(bus,'owner').plan(f.repo,{goal,selection},memory),plan=planning.propose(goal.goalId,analysis,baseline);
 assert.equal(plan.status,'DRAFT');assert.equal(analysis.memorySelection.selected.length,4);assert.ok(analysis.memoryContextRef);assert.equal(planning.inputs()[0].memoryContextRef.digest,analysis.memoryContextRef.digest);assert.deepEqual(bus.requests.map(r=>r.method),['ping','spawn','status']);assert.deepEqual(bus.definition.tools,['read']);assert.equal(bus.definition.allowNestedSubagents,false);assert.equal(existsSync(join(planning.projectRoot,'tasks')),false);assert.equal(git(f.repo,'status','--porcelain'),before);
 const dispatched=bus.requests.find(r=>r.method==='spawn').params.task;assert.match(dispatched,/functional|capability/i);assert.match(dispatched,/PROJECT MEMORY/);assert.match(dispatched,/Sincronizzare attraverso/);
 assert.match(dispatched,/host resolves accidental reuse when meaning changes/);
});
for(const variant of ['forged approval','mutating tool'])test(`PP analytical Scout refuses ${variant}`,async t=>{const f=fixture(t),goal=f.planning.createGoal('Aggiungere sincronizzazione'),bus=new PlanningBus(f.root,f.repo);if(variant==='forged approval')bus.forge=true;else bus.tools.push('write');await assert.rejects(()=>new PreTaskScout(bus,'owner').plan(f.repo,{goal}));assert.equal(f.planning.current(),undefined);assert.equal(existsSync(join(f.planning.projectRoot,'tasks')),false);});
for(const field of ['design','clarificationQuestions','memoryProposals','implementationSteps'])test(`PP live Scout requires ${field} while historical planning records remain readable`,async t=>{
 const f=fixture(t),goal=f.planning.createGoal('Aggiungere sincronizzazione'),bus=new PlanningBus(f.root,f.repo);bus.omit=field;const scout=new PreTaskScout(bus,'owner');t.after(()=>scout.close());await assert.rejects(scout.plan(f.repo,{goal}),error=>{assert.equal(error.code,'PRE_TASK_PROPOSAL_INVALID');assert.equal(error.diagnostic.rpcCode,'INVALID_STRUCTURED_OUTPUT');assert.equal(error.diagnostic.terminationVerified,true);return true});assert.equal(f.planning.history().length,0);const legacy=draft(f.planning,medium(),goal);assert.equal(Repository.open(f.data,f.repo,()=> 'ACCEPT').history()[0].contentDigest,legacy.contentDigest);
});
test('PP natural-language correction creates a fresh draft and cancellation leaves current approved plan intact',async t=>{
 const f=fixture(t),current=await approved(f.planning);let corrected=false;const ctx={...ui(),cwd:f.repo};ctx.ui.editor=async()=> 'Questa parte deve venire prima';ctx.ui.select=async()=> "Back";
 const scout={async plan(_root,mode){corrected=mode.correction==='Questa parte deve venire prima';const p=medium();p.strategy='Ordine riesaminato dopo la correzione della persona.';return {proposal:p,analysis:{goalDigest:mode.goal.contentDigest,correction:mode.correction}}}};
 await showProjectPlanning(ctx,f.planning,scout,undefined,'plan',async()=>{throw new Error('No automatic task formulation')});assert.ok(corrected);assert.equal(f.planning.history().length,2);assert.equal(f.planning.current().contentDigest,current.contentDigest);assert.equal(f.planning.history()[1].status,'DRAFT');
});
test('PP refinement proposes smaller work without a new goal, writer dispatch or implicit plan approval',async t=>{
 const f=fixture(t),current=await approved(f.planning),goals=f.planning.goals();let requested;
 const ctx={...ui(),cwd:f.repo};ctx.ui.editor=async()=>assert.fail('Refinement uses the saved goal');ctx.ui.select=async(title,choices)=>title.startsWith("Which task do you want to split?")?choices[1]:"Back";
 const scout={async plan(_root,mode){requested=mode;const request=preTaskRequest(f.repo,mode.goal.objective),refinement=refinementOutput(request,mode);return {proposal:materializeRefinement(refinement,mode),analysis:{requestId:request.requestId,requestHash:api.hashCanonical(request),goalDigest:mode.goal.contentDigest,previousPlanDigest:mode.previous.contentDigest,correction:mode.correction,refinement}}}};
 await showProjectPlanning(ctx,f.planning,scout,undefined,'refine',async()=>assert.fail('No implementation authority'));
 assert.equal(requested.goal.goalId,goals.at(-1).goalId);assert.match(requested.correction,/a few files and a targeted check/);
 assert.match(requested.correction,/do not reset limits and counters/);assert.match(requested.correction,/does not authorize concurrent launches/);
 assert.deepEqual(f.planning.goals(),goals);assert.equal(f.planning.current().contentDigest,current.contentDigest);
 assert.equal(f.planning.history().at(-1).status,'DRAFT');assert.equal(f.planning.history().length,2);
});
test('PP delta refinement materializes a complete plan, rewires terminal dependencies and stores rationale before approval',async t=>{
 const f=fixture(t),initial={...medium(),design:csvDesign()},previous=await approved(f.planning,initial),baseline=f.planning.baseline();
 const {mode,request,result}=refinementAnalysis(f.planning,previous,'protocol');
 assert.equal(REFINEMENT_OUTPUT_SCHEMA.properties.replacementTasks.maxItems,3);
 assert.equal(Object.hasOwn(REFINEMENT_OUTPUT_SCHEMA.properties,'design'),false);assert.equal(Object.hasOwn(REFINEMENT_OUTPUT_SCHEMA.properties,'memoryProposals'),false);
 const value=readRefinementScoutOutput(result.analysis.refinement,request,mode);assert.ok(api.canonicalize(value).length<3000);
 const next=f.planning.propose(mode.goal.goalId,result,baseline);
 assert.deepEqual(next.design,previous.design);assert.equal(next.strategy,previous.strategy);assert.equal(next.plannedTasks.length,7);
 for(const task of previous.plannedTasks.filter(t=>!['protocol','discovery','transfer'].includes(t.plannedTaskId)))assert.deepEqual(next.plannedTasks.find(t=>t.plannedTaskId===task.plannedTaskId),task);
 for(const id of ['discovery','transfer'])assert.deepEqual(next.plannedTasks.find(t=>t.plannedTaskId===id).dependsOn,['refine-b']);
 assert.deepEqual(next.plannedTasks[0].dependsOn,[]);assert.deepEqual(next.plannedTasks[1].dependsOn,['refine-a']);
 assert.equal(f.planning.current().contentDigest,previous.contentDigest);assert.equal(f.planning.links().length,0);
 const stored=JSON.parse(f.planning.store.read(f.planning.inputs().at(-1).scoutAnalysisRef));assert.deepEqual(stored.refinement,result.analysis.refinement);
 assert.equal((await f.planning.approve(ui(false),next.revision)),undefined);assert.equal(f.planning.current().contentDigest,previous.contentDigest);
 await f.planning.approve(ui(),next.revision);assert.equal(f.planning.current().contentDigest,next.contentDigest);
});
test('PP delta refusal occurs before provider dispatch for foreign, stale and newly linked prepared bindings',async t=>{
 const f=fixture(t),previous=await approved(f.planning),goal=f.planning.goals().at(-1),bus=new PlanningBus(f.root,f.repo),scout=new PreTaskScout(bus,'owner');t.after(()=>scout.close());
 const binding=f.planning.prepareRefinement(previous.contentDigest,'protocol');
 await assert.rejects(scout.plan(f.repo,{goal,previous,refinement:{...binding}}),/NOT_PREPARED/);assert.equal(bus.requests.length,0);
 await assert.rejects(scout.plan(f.repo,{goal,previous,refinement:{...binding,targetTaskId:'foreign'}}),/BINDING/);assert.equal(bus.requests.length,0);
 const other=fixture(t);await assert.rejects(scout.plan(other.repo,{goal,previous,refinement:binding}),/NOT_PREPARED/);assert.equal(bus.requests.length,0);
 const seed=f.planning.prepareStart(previous.planId,previous.revision,'protocol');link(f.planning,seed,specFor(f.repo,seed.objective));
 await assert.rejects(scout.plan(f.repo,{goal,previous,refinement:binding}),/LINKED/);assert.equal(bus.requests.length,0);
 assert.throws(()=>f.planning.prepareRefinement(previous.contentDigest,'protocol'),/LINKED/);
 const fresh=f.planning.prepareRefinement(previous.contentDigest,'conflicts');await f.planning.approve(ui(),draft(f.planning).revision);
 await assert.rejects(scout.plan(f.repo,{goal,previous,refinement:fresh}),/STALE/);assert.equal(bus.requests.length,0);
});
test('PP delta current draft cannot be approved after its target was linked, and completed goal content cannot be substituted',async t=>{
 const f=fixture(t),previous=await approved(f.planning),{mode,request,result}=refinementAnalysis(f.planning,previous,'protocol'),drafted=f.planning.propose(mode.goal.goalId,result,f.planning.baseline());
 const seed=f.planning.prepareStart(previous.planId,previous.revision,'protocol');link(f.planning,seed,specFor(f.repo,seed.objective));
 assert.throws(()=>f.planning.prepareApproval(drafted.revision),/LINKED/);assert.equal(f.planning.current().contentDigest,previous.contentDigest);
 const forged=structuredClone(mode.goal);forged.objective='Different objective';delete forged.contentDigest;forged.contentDigest=model.goalDigest(forged);
 assert.throws(()=>validatePlanningScout(result.analysis.refinement,request,{...mode,goal:forged},true),/BINDING/);
 assert.equal(f.planning.links().length,1);
});
test('PP delta shape, bindings, coverage and dependency errors fail closed',async t=>{
 const f=fixture(t),previous=await approved(f.planning),{mode,request,result}=refinementAnalysis(f.planning,previous,'protocol'),value=result.analysis.refinement;
 const cases=[
  ['too many',v=>v.replacementTasks.push({...v.replacementTasks[0],plannedTaskId:'third'},{...v.replacementTasks[0],plannedTaskId:'fourth'}),/SCHEMA_INVALID/],
  ['payload',v=>{v.explanation='x'.repeat(25000)},/REFINEMENT_LIMIT/],
  ['stale',v=>{v.previousPlanDigest='a'.repeat(64)},/BINDING/],
  ['foreign request',v=>{v.requestId='foreign'},/BINDING/],
  ['omitted binding',v=>{delete v.targetTaskId},/SCHEMA_INVALID/],
  ['old ID',v=>{v.replacementTasks[0].plannedTaskId='protocol'},/IDENTITY/],
  ['coverage',v=>{v.coverage=[]},/SCHEMA_INVALID/],
  ['foreign coverage',v=>{v.coverage[0].taskIds=['foreign']},/COVERAGE/],
  ['external dependency',v=>{v.replacementTasks[0].dependsOn=['e2e']},/DEPENDENCY/],
  ['cycle',v=>{v.replacementTasks[0].dependsOn=['refine-b'];v.replacementTasks[0].dependencyRationale=[{plannedTaskId:'refine-b',rationale:'Cycle'}]},/CYCLE/],
 ];
 for(const [label,mutate,code] of cases){const hostile=structuredClone(value);mutate(hostile);assert.throws(()=>validatePlanningScout(hostile,request,mode,true),code,label)}
 const altered=structuredClone(result);altered.proposal.plannedTasks=altered.proposal.plannedTasks.filter(t=>t.plannedTaskId!=='e2e');
 assert.throws(()=>f.planning.propose(mode.goal.goalId,altered,f.planning.baseline()),/MATERIALIZATION/);assert.equal(f.planning.history().length,1);
 // A true no-op with complete delivery fields cannot claim a new increment.
 const previousTask=previous.plannedTasks[0],full={...previousTask,designIntent:['Existing design'],implementationSteps:['Existing step']};
 const samePlan={...previous,plannedTasks:[full,...previous.plannedTasks.slice(1)]};delete samePlan.contentDigest;samePlan.contentDigest=model.planDigest(samePlan);
 const sameMode={...mode,previous:samePlan,refinement:{...mode.refinement,previousPlanDigest:samePlan.contentDigest}};
 const noChange={...value,previousPlanDigest:samePlan.contentDigest,replacementTasks:[{...full,plannedTaskId:'fresh-no-change',relevantMemoryIds:[]}],coverage:[{acceptanceIndex:0,taskIds:['fresh-no-change'],rationale:'Same outcome'}]};delete noChange.replacementTasks[0].relevantMemoryRefs;
 assert.throws(()=>materializeRefinement(noChange,sameMode),/NO_CHANGE/);
});
test('PP delta preserves completed task, original proof link, counters and goal across approval and reload',async t=>{
 const {planning,plan,f}=await taskProgressFixture(t,'FINAL_GATE',true),o=f.orchestrator;t.after(()=>o.dispose());
 const {presentHumanGate}=await import('../src/orchestrator.ts'),pending=o.pendingHumanGate,receipt=await presentHumanGate({mode:'tui',sessionManager:{getSessionId:()=> 'owner'},ui:{confirm:async()=>true}},pending);
 o.acceptHumanDecision(pending.snapshot,receipt);o.complete(o.state.revision);
 const before=DurableStore.load(f.storeRoot).state,links=planning.links(),goals=planning.goals(),completed=planning.progress()[0].task;
 const {mode,result}=refinementAnalysis(planning,plan,'discovery'),next=planning.propose(mode.goal.goalId,result,planning.baseline());
 await planning.approve(ui(),next.revision);const reopened=Repository.open(f.data,f.repo,()=> 'ACCEPT');
 assert.deepEqual(reopened.current().design,plan.design);assert.deepEqual(reopened.current().plannedTasks.find(t=>t.plannedTaskId==='protocol'),completed);
 assert.equal(reopened.progress().find(v=>v.task.plannedTaskId==='protocol').status,'COMPLETED');assert.deepEqual(reopened.links(),links);assert.deepEqual(reopened.goals(),goals);
 assert.deepEqual(DurableStore.load(f.storeRoot).state.counters,before.counters);
 assert.deepEqual(reopened.current().plannedTasks.find(t=>t.plannedTaskId==='refine-a').dependsOn,['protocol']);
});
test('PP delta expansion beyond 64 tasks is rejected without truncation',async t=>{
 const f=fixture(t),tasks=Array.from({length:64},(_,i)=>({plannedTaskId:`part-${i}`,title:`Part ${i}`,objective:`Outcome ${i}`,rationale:'Reason',scopeIntent:['README.md'],acceptanceIntent:['Observable'],validationIntent:['Review'],dependsOn:[],dependencyRationale:[],relevantMemoryRefs:[]}));
 const previous=await approved(f.planning,{strategy:'Coverage',plannedTasks:tasks}),goal=f.planning.goals().at(-1),mode={goal,previous,refinement:f.planning.prepareRefinement(previous.contentDigest,'part-0')},request=preTaskRequest(f.repo,goal.objective),output=refinementOutput(request,mode);
 assert.throws(()=>validatePlanningScout(output,request,mode,true),/SCHEMA_INVALID/);
 assert.equal(f.planning.history().length,1);assert.equal(f.planning.current().plannedTasks.length,64);
});
test('PP delta actual Scout dispatch uses a compact delivery schema and keeps the full draft approval boundary',async t=>{
 const f=fixture(t),previous=await approved(f.planning,{...medium(),design:csvDesign()}),goal=f.planning.goals().at(-1),binding=f.planning.prepareRefinement(previous.contentDigest,'protocol'),bus=new PlanningBus(f.root,f.repo),scout=new PreTaskScout(bus,'owner');t.after(()=>scout.close());
 const baseline=f.planning.baseline(),analysis=await scout.plan(f.repo,{goal,previous,refinement:binding}),sent=bus.requests.find(r=>r.method==='spawn');
 assert.equal(sent.params.outputSchema.phase,undefined);assert.equal(sent.params.outputSchema.properties.phase.const,'PROJECT_REFINEMENT_PROPOSAL');assert.equal(sent.params.outputSchema.properties.replacementTasks.maxItems,3);
 assert.equal(Object.hasOwn(sent.params.outputSchema.properties,'design'),false);assert.ok(JSON.stringify(sent.params.outputSchema).length<5000);
 assert.match(sent.params.task,/24 KiB/);assert.match(sent.params.task,/8 KiB/);assert.match(sent.params.task,/Do not repeat design/);assert.doesNotMatch(sent.params.task,/PREVIOUS=|a concrete design and all planned tasks/);
 assert.deepEqual(sent.params.intercomBridge,{mode:'off'});assert.deepEqual(bus.definition.tools,['read']);assert.equal(bus.definition.allowNestedSubagents,false);
 const next=f.planning.propose(goal.goalId,analysis,baseline);assert.equal(next.status,'DRAFT');assert.equal(f.planning.current().contentDigest,previous.contentDigest);assert.equal(f.planning.links().length,0);
});
test('PP delta oversized delivery preserves the precise rejection and verified termination without accepting a draft',async t=>{
 const f=fixture(t),previous=await approved(f.planning),goal=f.planning.goals().at(-1),binding=f.planning.prepareRefinement(previous.contentDigest,'protocol'),bus=new PlanningBus(f.root,f.repo),scout=new PreTaskScout(bus,'owner');t.after(()=>scout.close());
 bus.transformOutput=output=>{output.replacementTasks.forEach(task=>task.rationale='r'.repeat(4000));output.explanation='';
   output.explanation='e'.repeat(12916-Buffer.byteLength(api.canonicalize(output)));assert.equal(Buffer.byteLength(api.canonicalize(output)),12916);return output;};
 await assert.rejects(()=>scout.plan(f.repo,{goal,previous,refinement:binding}),error=>{assert.equal(error.code,'PROJECT_REFINEMENT_LIMIT');assert.equal(error.diagnostic.validationCode,'PROJECT_REFINEMENT_LIMIT');assert.equal(error.diagnostic.rpcCode,'INVALID_STRUCTURED_OUTPUT');assert.equal(error.diagnostic.terminationVerified,true);return true});
 assert.equal(f.planning.history().length,1);assert.equal(f.planning.current().contentDigest,previous.contentDigest);assert.equal(f.planning.links().length,0);
 assert.equal(bus.requests.filter(r=>r.method==='spawn').length,1);
 assert.equal(REFINEMENT_OUTPUT_SCHEMA.properties.replacementTasks.items.properties.implementationSteps.maxItems,4);
 assert.equal(REFINEMENT_OUTPUT_SCHEMA.properties.replacementTasks.items.properties.implementationSteps.items.maxLength,160);
});
for(const reopened of [false,true])test(`PP correcting a ${reopened?'reopened':'live'} delta retains the approved base, bound feedback and full approval boundary`,async t=>{
 const f=fixture(t),previous=await approved(f.planning,{...medium(),design:csvDesign()}),goals=f.planning.goals();let first,dispatches=0;
 const deliver=mode=>{const request=preTaskRequest(f.repo,mode.goal.objective),output=refinementOutput(request,mode);
   const suffix=dispatches===0?'first':'corrected',mapping=new Map(output.replacementTasks.map(task=>[task.plannedTaskId,`${task.plannedTaskId}-${suffix}`]));
   for(const task of output.replacementTasks){task.plannedTaskId=mapping.get(task.plannedTaskId);task.dependsOn=task.dependsOn.map(id=>mapping.get(id)??id);task.dependencyRationale=task.dependencyRationale.map(edge=>({...edge,plannedTaskId:mapping.get(edge.plannedTaskId)??edge.plannedTaskId}));}
   output.coverage=output.coverage.map(entry=>({...entry,taskIds:entry.taskIds.map(id=>mapping.get(id))}));
   return {proposal:materializeRefinement(output,mode),analysis:{requestId:request.requestId,requestHash:api.hashCanonical(request),goalDigest:mode.goal.contentDigest,previousPlanDigest:mode.previous.contentDigest,correction:mode.correction??null,refinement:output}};};
 let planning=f.planning;
 if(reopened){const mode={goal:goals.at(-1),previous,refinement:planning.prepareRefinement(previous.contentDigest,'protocol')},result=deliver(mode);first=result.analysis.refinement;planning.propose(mode.goal.goalId,result,planning.baseline());dispatches=1;planning=Repository.open(f.data,f.repo,()=> 'ACCEPT');}
 const ctx={...ui(),cwd:f.repo};ctx.ui.editor=async()=> 'Rendi il secondo risultato più circoscritto';
 let reviews=0;ctx.ui.select=async(title,choices)=>{if(title.startsWith("Which task do you want to split?"))return choices[1];return reviews++===0?"Correct the proposal":"Back";};
 const scout={async plan(_root,mode){assert.equal(mode.previous.status,'APPROVED');assert.equal(mode.previous.contentDigest,previous.contentDigest);Repository.verifyPreparedRefinement(mode.refinement,f.repo);
   if(dispatches){assert.deepEqual(mode.refinementFeedback,first);assert.match(mode.correction,/secondo risultato/);}else assert.equal(mode.refinementFeedback,undefined);
   const result=deliver(mode);if(!dispatches)first=result.analysis.refinement;dispatches++;return result;}};
 await showProjectPlanning(ctx,planning,scout,undefined,reopened?'plan':'refine',async()=>assert.fail('No task dispatch'));
 assert.equal(dispatches,2);assert.equal(planning.history().length,3);assert.equal(planning.current().contentDigest,previous.contentDigest);assert.deepEqual(planning.goals(),goals);assert.equal(planning.links().length,0);
 const corrected=planning.history().at(-1);assert.equal(corrected.status,'DRAFT');assert.deepEqual(corrected.design,previous.design);assert.equal(corrected.plannedTasks[0].plannedTaskId,'refine-a-corrected');
});
test('PP delta correction feedback must share the approved target and stale saved feedback cannot dispatch',async t=>{
 const f=fixture(t),previous=await approved(f.planning),{mode,request,result}=refinementAnalysis(f.planning,previous,'protocol'),saved=f.planning.propose(mode.goal.goalId,result,f.planning.baseline());
 const feedback=f.planning.prepareRefinementCorrection(saved.revision);assert.equal(feedback.previous.contentDigest,previous.contentDigest);Repository.verifyPreparedRefinement(feedback.binding,f.repo);
 const hostile={...mode,refinementFeedback:{...feedback.proposal,targetTaskId:'transfer'}};
 assert.throws(()=>validatePlanningScout(result.analysis.refinement,request,hostile,true),/REFINEMENT_BINDING/);
 const bus=new PlanningBus(f.root,f.repo),scout=new PreTaskScout(bus,'owner');t.after(()=>scout.close());await assert.rejects(()=>scout.plan(f.repo,hostile),/REFINEMENT_BINDING/);assert.equal(bus.requests.length,0);
 const replacement=draft(f.planning,medium());await f.planning.approve(ui(),replacement.revision);
 assert.throws(()=>f.planning.prepareRefinementCorrection(saved.revision),/REFINEMENT_STALE/);assert.equal(bus.requests.length,0);
});
for(const retry of [false,true])test(`PP delta limit rejection offers an explicit ${retry?'retry':'return'} only after verified exit`,async t=>{
 const f=fixture(t),previous=await approved(f.planning);let dispatches=0,decisions=0;
 const error=new PreTaskProposalError('PROJECT_REFINEMENT_LIMIT',{phase:'PROJECT_PLANNING',runId:'failed-delta',rpcCode:'INVALID_STRUCTURED_OUTPUT',terminationVerified:true,validationCode:'PROJECT_REFINEMENT_LIMIT'});
 const ctx={...ui(),cwd:f.repo};ctx.ui.editor=async()=>assert.fail('No new goal or scope');ctx.ui.select=async(title,choices)=>{
   if(title.startsWith("Which task do you want to split?"))return choices[1];
   if(title.startsWith("Project analysis interrupted")){decisions++;assert.ok(choices.includes("Retry analysis"));return retry?"Retry analysis":"Back to project"}return "Back";};
 const scout={async plan(_root,mode){dispatches++;if(dispatches===1)throw error;assert.equal(mode.previous.contentDigest,previous.contentDigest);Repository.verifyPreparedRefinement(mode.refinement,f.repo);
   const request=preTaskRequest(f.repo,mode.goal.objective),refinement=refinementOutput(request,mode);return {proposal:materializeRefinement(refinement,mode),analysis:{requestId:request.requestId,requestHash:api.hashCanonical(request),previousPlanDigest:previous.contentDigest,refinement}};}};
 const run=()=>showProjectPlanning(ctx,f.planning,scout,undefined,'refine',async()=>assert.fail('No writer authority'));
 if(retry)await run();else await assert.rejects(run,error);
 assert.equal(decisions,1);assert.equal(dispatches,retry?2:1);assert.equal(f.planning.current().contentDigest,previous.contentDigest);assert.equal(f.planning.links().length,0);assert.equal(f.planning.history().length,retry?2:1);
 // The uncertain-exit case is independent of the exhausted investigation above.
 const fresh=fixture(t);await approved(fresh.planning);
 const uncertain={...ctx,cwd:fresh.repo,ui:{...ctx.ui,select:async(title,choices)=>{if(title.startsWith("Which task do you want to split?"))return choices[1];assert.fail('No retry offered while termination is uncertain')}}};
 await assert.rejects(()=>showProjectPlanning(uncertain,fresh.planning,{async plan(){throw new PreTaskProposalError('PROJECT_REFINEMENT_LIMIT',{...error.diagnostic,terminationVerified:false})}},undefined,'refine',async()=>assert.fail('No writer authority')),/PROJECT_REFINEMENT_LIMIT/);
});
test('PP delta proportional budget accepts a small overrun for three tasks and enforces each exact UTF-8 boundary',async t=>{
 const f=fixture(t),p=medium();p.plannedTasks[0].acceptanceIntent=['Outcome one','Outcome two','Outcome three','Outcome four'];
 const previous=await approved(f.planning,p),{mode,request,result}=refinementAnalysis(f.planning,previous,'protocol'),output=structuredClone(result.analysis.refinement);
 output.replacementTasks.push({...structuredClone(output.replacementTasks[1]),plannedTaskId:'refine-c',title:'Remaining work to refine',objective:'Preserve the residual outcome for a further refinement',scopeIntent:['docs/remaining.md'],dependsOn:['refine-b'],dependencyRationale:[{plannedTaskId:'refine-b',rationale:'Preserve the second result before remaining work'}],requiresRefinement:true});
 output.coverage=output.coverage.map(entry=>({...entry,taskIds:[...entry.taskIds,'refine-c']}));
 const padTo=bytes=>{const value=structuredClone(output);value.explanation='';for(const task of value.replacementTasks){task.rationale='r'.repeat(2500)}
   const remaining=bytes-Buffer.byteLength(api.canonicalize(value));assert.ok(remaining>0&&remaining<=4096);value.explanation='é'.repeat(Math.floor(remaining/2))+(remaining%2?'x':'');assert.equal(Buffer.byteLength(api.canonicalize(value)),bytes);return value;};
 assert.equal(refinementPayloadBudget(1,1),8448);assert.equal(refinementPayloadBudget(2,1),12544);assert.equal(refinementPayloadBudget(3,4),17408);assert.equal(REFINEMENT_PAYLOAD_BYTES,24576);
 assert.equal(validatePlanningScout(padTo(12916),request,mode,true).plannedTasks.length,8);
 const budget=refinementPayloadBudget(3,4),value=structuredClone(output);value.replacementTasks.forEach((task,i)=>{task.rationale='r'.repeat(4096);task.objective=`${i}`+'o'.repeat(399)});value.explanation='';
 value.explanation='e'.repeat(budget-Buffer.byteLength(api.canonicalize(value)));assert.ok(value.explanation.length<=4096);assert.equal(Buffer.byteLength(api.canonicalize(value)),budget);
 assert.equal(validatePlanningScout(value,request,mode,true).plannedTasks.length,8);value.explanation+='é';assert.throws(()=>validatePlanningScout(value,request,mode,true),/REFINEMENT_LIMIT/);
 const tooLarge=structuredClone(value);tooLarge.explanation='x'.repeat(25000);assert.throws(()=>validatePlanningScout(tooLarge,request,mode,true),/REFINEMENT_LIMIT/);
 assert.throws(()=>refinementPayloadBudget(4,4),/SCHEMA_INVALID/);assert.throws(()=>refinementPayloadBudget(3,17),/SCHEMA_INVALID/);
 assert.equal(f.planning.history().length,1);assert.equal(f.planning.links().length,0);
});
test('PP delta residual horizon retains coverage but cannot create a TaskSpec through direct or normal automatic preparation',async t=>{
 const f=fixture(t),previous=await approved(f.planning),{mode,request,result}=refinementAnalysis(f.planning,previous,'protocol'),output=structuredClone(result.analysis.refinement);
 output.replacementTasks[1].requiresRefinement=true;
 const proposal=validatePlanningScout(output,request,mode,true),next=f.planning.propose(mode.goal.goalId,{proposal,analysis:{...result.analysis,refinement:output}},f.planning.baseline());
 assert.match(f.planning.refinementNarrative(next.revision),/Previous task/);assert.match(f.planning.refinementNarrative(next.revision),/not evidence/);
 await f.planning.approve(ui(),next.revision);
 // The scheduler uses this same host preparation method; no alternate path or
 // model claim can turn a planning horizon into a writer assignment.
 const allResidual={strategy:'Preservare il lavoro ampio per il prossimo affinamento',plannedTasks:[{...task('remaining','Lavoro residuo'),requiresRefinement:true}]};
 const pending=draft(f.planning,allResidual);await f.planning.approve(ui(),pending.revision);
 assert.equal(f.planning.progress()[0].status,'READY');assert.match(f.planning.progress()[0].explanation,/Break down the work/);
 assert.throws(()=>f.planning.prepareStart(pending.planId,pending.revision,'remaining'),/PROJECT_TASK_REFINEMENT_REQUIRED/);
 assert.equal(f.planning.links().length,0);assert.equal(existsSync(join(f.planning.projectRoot,'tasks')),false);
 let prompts=0,started=0;const ctx={...ui(),cwd:f.repo};ctx.ui.editor=async()=>assert.fail('No new input');ctx.ui.select=async(title)=>{prompts++;assert.match(title,/The next work must be split/);return "Back"};
 await showProjectPlanning(ctx,f.planning,{plan(){assert.fail('No automatic model launch')}},undefined,'start',async()=>{started++});
 assert.equal(prompts,1);assert.equal(started,0);
 const onlyResidual={...output,replacementTasks:[output.replacementTasks[1]],coverage:[{acceptanceIndex:0,taskIds:['refine-b'],rationale:'All residual'}]};
 onlyResidual.replacementTasks[0].dependsOn=[];onlyResidual.replacementTasks[0].dependencyRationale=[];
 assert.throws(()=>validatePlanningScout(onlyResidual,request,mode,true),/REMAINDER/);
});
test('PP reopening a saved draft renders the goal and wizard panel without Scout dispatch or approval',async t=>{
 const {planning,repo}=fixture(t),saved=draft(planning);let prompts=0;const notifications=[];
 const ctx={...ui(),cwd:repo};ctx.ui.notify=message=>notifications.push(message);ctx.ui.editor=async()=>{throw new Error('No regeneration input')};ctx.ui.select=async()=>{throw new Error('Native custom panel expected')};ctx.ui.confirm=async()=>{throw new Error('No approval')};
 ctx.ui.custom=factory=>new Promise(resolve=>{
   prompts++;const c=factory({requestRender(){},terminal:{rows:42}},null,null,resolve);
   for(const width of [44,132]){
     const lines=c.render(width),text=lines.join('\n');assert.equal(lines[0],'Controlled Dev | Project plan');
     assert.match(text,/╭─+╮/);assert.match(text,/● ●/);assert.match(text,/Objective/);assert.match(text,/Read the proposed plan/);assert.match(text,/Official folder/);if(width===132)assert.ok(text.includes(repo));assert.ok(lines.every(line=>line.length<=width));
   }
   c.render(132);c.handleInput('\x1b[B');assert.match(c.render(132).join('\n'),/Text 2-/);c.handleInput('\x1b');
 });
 await showProjectPlanning(ctx,planning,{plan(){throw new Error('No Scout dispatch')}},undefined,'plan',async()=>{throw new Error('No task start')});
 assert.equal(prompts,1);assert.ok(notifications.some(message=>message.includes(`Official folder: ${repo}`)&&message.includes('Status: draft')&&message.includes('No task has started.')));assert.equal(planning.history().length,1);assert.equal(planning.history()[0].contentDigest,saved.contentDigest);assert.equal(planning.current(),undefined);
});
test('PP correction uses framed input and a cancelled final confirmation returns to plan review',async t=>{
 const {planning,repo}=fixture(t);draft(planning);const ctx={...ui(false),cwd:repo},actions=["Approve the plan","Correct the proposal","Back"];let corrections=0,analyses=0;
 ctx.ui.editor=async()=>{throw new Error('Use the wizard input')};ctx.ui.select=async()=>actions.shift();
 ctx.ui.wizardInput=async(_title,_prefill,p)=>{corrections++;assert.equal(p.section,"Project plan");assert.equal(p.step,1);assert.equal(p.total,2);assert.match(p.why,/new proposal/);return 'Verifica discovery prima del trasferimento'};
 const scout={async plan(_root,mode){analyses++;assert.equal(mode.previous.revision,1);assert.match(mode.correction,/discovery/);const p=medium();p.strategy='La strategia spiega il nuovo ordine.';return {proposal:p,analysis:{goalDigest:mode.goal.contentDigest,correction:mode.correction}}}};
 await showProjectPlanning(ctx,planning,scout,undefined,'plan',async()=>{throw new Error('No task start')});
 assert.equal(corrections,1);assert.equal(analyses,1);assert.equal(planning.history().length,2);assert.equal(planning.current(),undefined);assert.equal(actions.length,0);
});
test('PP natural-language revision normalizes a reused activity identity without asking for protocol repairs',async t=>{
 const {planning,repo}=fixture(t),current=await approved(planning),ctx={...ui(),cwd:repo};let analyses=0,corrections=0;
 ctx.ui.editor=async()=>{corrections++;return 'Cambia il risultato della prima attività'};ctx.ui.select=async(_title,choices)=>{assert.ok(choices.includes("Back"));return "Back"};
 const scout={async plan(_root,mode){analyses++;const p=medium();p.plannedTasks[0].objective='Un risultato differente';return {proposal:p,analysis:{goalDigest:mode.goal.contentDigest,correction:mode.correction}}}};
 await showProjectPlanning(ctx,planning,scout,undefined,'plan',async()=>{throw new Error('No task start')});
 assert.equal(analyses,1);assert.equal(corrections,1);assert.equal(planning.history().length,2);assert.notEqual(planning.history()[1].plannedTasks[0].plannedTaskId,'protocol');assert.equal(planning.current().contentDigest,current.contentDigest);
});

test('PP opens and proposes against dirty source without granting an executable baseline',async t=>{
 const {planning,repo}=fixture(t);writeFileSync(join(repo,'README.md'),'Local work in progress\n');
 const baseline=planning.baseline(),p=draft(planning);assert.ok(baseline.commit);await planning.approve(ui(),p.revision);
 assert.throws(()=>planning.prepareStart(p.planId,p.revision,'protocol'),/PROJECT_BASELINE_DIRTY/);assert.equal(readFileSync(join(repo,'README.md'),'utf8'),'Local work in progress\n');
});

const csvDesign=()=>({context:'La libreria locale espone dati senza esportazione CSV.',approach:'Riutilizzare il repository e aggiungere un servizio di esportazione.',decisions:['Usare CSV UTF-8 con intestazione, senza nuove dipendenze; JSON non soddisfa la richiesta.'],components:['src/export.ts: convertire i record in righe; repository esistente: fornire i record.'],dataFlow:['Repository → servizio CSV → file richiesto dall’utente.'],compatibility:['Conservare API e comportamento del repository.'],implementationSequence:['Definire escaping e intestazione.','Integrare il servizio e verificare record vuoti e caratteri speciali.'],validationStrategy:['Casi deterministici del formato CSV e review indipendente.'],risks:['L’escaping deve gestire virgole e virgolette.'],assumptions:['Nessuna dipendenza aggiuntiva.']});
test('PP conversation resumes only unanswered questions, binds detailed design and carries it into a real TaskSpec',async t=>{
 const f=fixture(t),{ProposalBus}=await import('./greenfield-bootstrap-fixture.mjs'),questions=[{questionId:'format',question:'Quale formato di esportazione ti serve?',why:'Determina il contratto dei dati.'},{questionId:'encoding',question:'Quale codifica devono usare i file?',why:'Serve a garantire compatibilità con il destinatario.'}];
 const bus=new ProposalBus(f.root,(q,params)=>{const goal=JSON.parse(params.task.split('\nGOAL=')[1].split('\nPREVIOUS=')[0]);
   const envelope={schemaVersion:1,phase:'PROJECT_PLANNING_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:api.hashCanonical(q),memoryProposals:[]};
   if(!goal.clarifications)return {...envelope,strategy:'Definire formato e codifica prima del design.',clarificationQuestions:questions,design:null,plannedTasks:[]};
   assert.deepEqual(goal.clarifications.map(q=>q.answer),['CSV con intestazione','UTF-8']);
   return {...envelope,strategy:'Integrare esportazione CSV nel repository corrente.',clarificationQuestions:[],design:csvDesign(),plannedTasks:[{...task('csv','Esportazione CSV',[],goal.objective),scopeIntent:['src/export.ts'],relevantMemoryIds:[],relevantMemoryRefs:undefined,designIntent:['Separare serializzazione e accesso al repository.'],implementationSteps:['Implementare escaping CSV.','Collegare i dati esistenti.','Verificare righe vuote e virgolette.']}]};
 });
 // Wire JSON cannot include optional undefined fields.
 const originalOutput=bus.output;bus.output=(...args)=>JSON.parse(JSON.stringify(originalOutput(...args)));
 let scout=new PreTaskScout(bus,'owner');t.after(()=>scout.close());const ctx={...ui(),cwd:f.repo,planningRequest:'Aggiungere esportazione dei dati'};ctx.ui.editor=async title=>{assert.equal(title.split("\n")[0],questions[0].question);return undefined};ctx.ui.select=async()=>assert.fail('No plan before context is complete');
 await showProjectPlanning(ctx,f.planning,scout,undefined,'request',async()=>assert.fail('No writer'));assert.equal(bus.run,2);assert.equal(f.planning.history().length,0);assert.equal(f.planning.goals().at(-1).clarifications.filter(q=>q.answer===null).length,2);
 scout.close();scout=new PreTaskScout(bus,'owner');let planning=Repository.open(f.data,f.repo,()=> 'ACCEPT');const asked=[];ctx.planningRequest=undefined;ctx.ui.editor=async title=>{asked.push(title.split("\n")[0]);return asked.length===1?'CSV con intestazione':undefined};
 await showProjectPlanning(ctx,planning,scout,undefined,'plan',async()=>assert.fail('No writer'));assert.equal(bus.run,2);assert.deepEqual(asked,questions.map(q=>q.question));assert.equal(planning.goals().at(-1).clarifications[0].answer,'CSV con intestazione');
 planning=Repository.open(f.data,f.repo,()=> 'ACCEPT');ctx.ui.editor=async title=>{assert.equal(title.split("\n")[0],questions[1].question);return 'UTF-8'};ctx.ui.select=async(_title,choices)=>{assert.ok(choices.includes("Approve the plan"));return "Approve the plan"};
 await showProjectPlanning(ctx,planning,scout,undefined,'plan',async()=>assert.fail('No implicit writer before authorization'));assert.equal(bus.run,3);
 const plan=planning.current(),goal=planning.goals().at(-1);assert.deepEqual(plan.design,csvDesign());assert.equal(plan.projectGoalRef.id,`${goal.goalId}-r${goal.revision}`);assert.equal(planning.inputs()[0].goalDigest,goal.contentDigest);assert.equal(goal.contextEvidenceRefs.length,1);assert.equal(JSON.parse(planning.store.read(goal.contextEvidenceRefs[0])).terminationVerified,true);
 assert.throws(()=>planning.saveClarifications(f.planning.goals()[0],[]),/PROJECT_GOAL_STALE/);const seed=planning.prepareStart(plan.planId,plan.revision,'csv');assert.ok(seed.hints.some(h=>h.includes('Repository → servizio CSV')));assert.ok(seed.hints.some(h=>h.includes('Implementare escaping CSV')));
 rebuildProjectPlanningView(planning);const human=readFileSync(join(planning.projectRoot,'human','Planning','Current Plan.md'),'utf8');assert.match(human,/Design and implementation/);assert.match(human,/CSV con intestazione/);assert.match(human,/Implementare escaping CSV/);
 const old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;t.after(()=>old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old);
 const taskBus=new ProposalBus(f.root,q=>{assert.ok(q.hints.some(h=>h.includes('Repository → servizio CSV')));return {schemaVersion:1,phase:'PRE_TASK_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:api.hashCanonical(q),relevantFiles:['src/storage/repository.ts'],proposedScope:['src/export.ts'],acceptanceCriteria:['CSV UTF-8 con intestazione e escaping corretto.'],existingTests:[],validations:[{kind:'REVIEW',description:'Controllare compatibilità ed escaping.',paths:['src/export.ts'],expectedLines:[]}],architectureFindings:['Riutilizzare il repository esistente.'],designExpectations:['Serializzazione separata dal repository; CSV UTF-8 con intestazione.'],ambiguities:[],risks:[],explanation:'Incremento coerente con il design.'}}),taskScout=new PreTaskScout(taskBus,'owner');t.after(()=>taskScout.close());ctx.ui.editor=async()=>assert.fail('Known objective');ctx.ui.select=async()=> "Create the task";
 const spec=await createProductionTask(ctx,(objective,hints)=>taskScout.propose(f.repo,objective,hints),{seed,beforeSave:(spec,manager)=>planning.linkPreparedTask(seed,spec,manager,true)});assert.equal(spec.objective,goal.objective);assert.ok(spec.constraints.some(c=>c.includes('Serializzazione separata')));assert.match(spec.plan.inline,/Repository → servizio CSV/);assert.match(spec.plan.inline,/Implementare escaping CSV/);assert.equal(readProductionTaskInput(ctx).spec.specHash,spec.specHash);assert.equal(planning.links().length,1);assert.equal(git(f.repo,'status','--porcelain'),'');
});

test('PP new natural request preserves the approved plan until the replacement is approved',async t=>{
 const f=fixture(t),before=await approved(f.planning),ctx={...ui(),cwd:f.repo,planningRequest:'Aggiungere una ricerca per nome'};ctx.ui.editor=async()=>assert.fail('The request is already supplied');ctx.ui.select=async()=> "Back";
 const scout={async plan(_root,mode){assert.equal(mode.goal.objective,ctx.planningRequest);assert.equal(mode.previous.contentDigest,before.contentDigest);return {proposal:{strategy:'Riutilizzare il repository per la ricerca.',design:csvDesign(),plannedTasks:[task('search','Ricerca per nome',[],ctx.planningRequest)]},analysis:{goalDigest:mode.goal.contentDigest}}}};
 await showProjectPlanning(ctx,f.planning,scout,undefined,'request',async()=>assert.fail('No writer'));assert.equal(f.planning.current().contentDigest,before.contentDigest);assert.equal(f.planning.goals().at(-1).objective,ctx.planningRequest);assert.equal(f.planning.history().length,2);
});

test('PP ambiguous context never becomes an executable plan or a mixed clarification/plan response',t=>{
 const f=fixture(t),goal=f.planning.createGoal('Esportare dati'),pending=f.planning.saveClarifications(goal,[{questionId:'format',question:'Quale formato?',why:'Determina il contratto.',answer:null}]);assert.throws(()=>f.planning.propose(pending.goalId,{proposal:medium(),analysis:{}},f.planning.baseline()),/PROJECT_CONTEXT_INCOMPLETE/);
 const request=preTaskRequest(f.repo,goal.objective),p=medium(),wire={schemaVersion:1,phase:'PROJECT_PLANNING_PROPOSAL',proposalOnly:true,requestId:request.requestId,requestHash:api.hashCanonical(request),strategy:p.strategy,plannedTasks:p.plannedTasks.map(({relevantMemoryRefs,...t})=>({...t,relevantMemoryIds:[]})),clarificationQuestions:[{questionId:'format',question:'Quale formato?',why:'Determina il contratto.'}],design:csvDesign()};assert.throws(()=>validatePlanningScout(wire,request,{goal}),/PROJECT_CLARIFICATION_INVALID/);assert.equal(f.planning.current(),undefined);assert.equal(f.planning.links().length,0);
});
test('PP updated context invalidates a prior draft and design changes receive new activity identities',async t=>{
 const f=fixture(t),goal=f.planning.createGoal('Esportare dati'),p={...medium(),design:csvDesign()};p.plannedTasks[0]={...p.plannedTasks[0],designIntent:['Serializzazione CSV'],implementationSteps:['Implementare CSV']};const old=draft(f.planning,p,goal);
 f.planning.saveClarifications(goal,[{questionId:'format',question:'Quale formato?',why:'Contratto pubblico',answer:'JSON'}]);assert.throws(()=>f.planning.prepareApproval(old.revision),/PROJECT_PLAN_CONTEXT_STALE/);
 assert.throws(()=>f.planning.propose(goal.goalId,{proposal:p,analysis:{goalDigest:goal.contentDigest}},f.planning.baseline()),/PROJECT_GOAL_STALE/);
 const next=structuredClone(p);next.plannedTasks[0].designIntent=['Serializzazione JSON'];next.plannedTasks[0].implementationSteps=['Implementare JSON'];const revised=draft(f.planning,next);assert.notEqual(revised.plannedTasks[0].plannedTaskId,old.plannedTasks[0].plannedTaskId);await f.planning.approve(ui(),revised.revision);assert.equal(f.planning.current().contentDigest,revised.contentDigest);
 const request=preTaskRequest(f.repo,goal.objective),wire={schemaVersion:1,phase:'PROJECT_PLANNING_PROPOSAL',proposalOnly:true,requestId:request.requestId,requestHash:api.hashCanonical(request),strategy:p.strategy,clarificationQuestions:[],plannedTasks:p.plannedTasks.map(({relevantMemoryRefs,...task})=>({...task,relevantMemoryIds:[]}))};assert.throws(()=>validatePlanningScout(wire,request,{goal}),/PROJECT_PLAN_DESIGN_INCOMPLETE/);
});
test('PP detailed design exceeding one hint remains exact and valid in native Scout context',async t=>{
 const f=fixture(t),proposal=medium();proposal.design=csvDesign();proposal.design.components=Array.from({length:10},(_,i)=>`src/component-${i}.ts: `+'Responsabilità e interfaccia. '.repeat(70));const p=draft(f.planning,proposal);await f.planning.approve(ui(),p.revision);const seed=f.planning.prepareStart(p.planId,p.revision,'protocol'),hints=model.projectTaskHints(p,p.plannedTasks[0]);assert.ok(hints.length>8);assert.ok(hints.every(h=>Buffer.byteLength(h)<=4096));assert.doesNotThrow(()=>preTaskRequest(f.repo,seed.objective,seed.hints));assert.ok(hints.join('').includes(api.canonicalize(p.design)));assert.match(seed.designContext,/src\/component-9/);
});
test('PP design proposals reuse Project Memory, survive reopen without duplicates and are selected after native adoption',async t=>{
 const f=fixture(t),{ProposalBus}=await import('./greenfield-bootstrap-fixture.mjs'),proposal={recordKind:'software-adr',title:'Formato CSV pubblico',scope:{kind:'repository'},content:{decisionKey:'export-format',context:'Serve interoperabilità locale.',decision:'Esportare CSV UTF-8 con intestazione.',rationale:'Compatibile con i destinatari richiesti.',consequences:['Gestire escaping CSV.'],alternatives:['JSON escluso dalla richiesta.']},evidenceRefs:[],relatedTaskRefs:[],relatedRecordRefs:[]};
 const bus=new ProposalBus(f.root,(q,params)=>{const hasMemory=params.task.includes('software-decision');return {schemaVersion:1,phase:'PROJECT_PLANNING_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:api.hashCanonical(q),strategy:'Integrare esportazione CSV',design:csvDesign(),clarificationQuestions:[],memoryProposals:hasMemory?[]:[proposal],plannedTasks:[{plannedTaskId:'csv',title:'Esportazione CSV',objective:'Esportare dati CSV',rationale:'Risultato richiesto',scopeIntent:['src/export.ts'],acceptanceIntent:['CSV UTF-8'],validationIntent:['Review del formato'],dependsOn:[],dependencyRationale:[],relevantMemoryIds:[],designIntent:['Riutilizzare il repository'],implementationSteps:['Implementare escaping']}]} });
 const scout=new PreTaskScout(bus,'owner');t.after(()=>scout.close());const ctx={...ui(),cwd:f.repo,planningRequest:'Esportare dati CSV'};ctx.ui.editor=async()=>assert.fail('Known request');ctx.ui.select=async()=> "Back";await showProjectPlanning(ctx,f.planning,scout,undefined,'request',async()=>assert.fail('No writer'));
 let memory=ProjectMemoryRepository.open(f.data,f.repo,()=> 'ACCEPT');assert.equal(memory.entries().length,1);assert.equal(memory.entries()[0].record.status,'PROPOSED');assert.equal(f.planning.history()[0].memoryProposals[0].content.decision,proposal.content.decision);assert.equal(f.planning.current(),undefined);
 const reopened=Repository.open(f.data,f.repo,()=> 'ACCEPT');ctx.planningRequest=undefined;await showProjectPlanning(ctx,reopened,scout,memory,'plan',async()=>assert.fail('No writer'));assert.equal(bus.run,1);assert.equal(memory.entries().length,1);
 const actions=["Saved decisions",null,"Accept the decision","Approve the plan"];ctx.ui.select=async(_title,choices)=>{const action=actions.shift();return action===null?choices[0]:(assert.ok(choices.includes(action),`${action}: ${choices}`),action)};await showProjectPlanning(ctx,reopened,scout,undefined,'plan',async()=>assert.fail('No writer'));
 assert.equal(actions.length,0);assert.equal(bus.run,2);memory=ProjectMemoryRepository.open(f.data,f.repo,()=> 'ACCEPT');assert.equal(memory.entries().length,1);assert.equal(memory.entries()[0].record.status,'ACCEPTED');assert.equal(reopened.current().memoryProposals.length,0);assert.equal(reopened.inputs().at(-1).memoryRefs[0].recordId,memory.entries()[0].record.recordId);assert.ok(reopened.prepareStart(reopened.current().planId,reopened.current().revision,'csv'));assert.equal(git(f.repo,'status','--porcelain'),'');
});

test('PP native acquisition preserves the size-limit cause and verified exit without adopting any rejected proposal',async t=>{
 const f=fixture(t),previous=await approved(f.planning),mode={goal:f.planning.goals().at(-1),previous,refinement:f.planning.prepareRefinement(previous.contentDigest,'protocol')},bus=new PlanningBus(f.root,f.repo);
 bus.transformOutput=output=>({...output,explanation:'あ'.repeat(4096),replacementTasks:output.replacementTasks.map(task=>({...task,rationale:'い'.repeat(4096)}))});
 const scout=new PreTaskScout(bus,'owner');t.after(()=>scout.close());
 await assert.rejects(scout.plan(f.repo,mode),error=>{assert.equal(error.code,'PROJECT_REFINEMENT_LIMIT');assert.equal(error.diagnostic.validationCode,'PROJECT_REFINEMENT_LIMIT');assert.equal(error.diagnostic.rpcCode,'INVALID_STRUCTURED_OUTPUT');assert.equal(error.diagnostic.terminationVerified,true);return true});
 assert.equal(f.planning.history().length,1);assert.equal(f.planning.current().contentDigest,previous.contentDigest);assert.equal(existsSync(join(f.planning.projectRoot,'tasks')),false);
});
