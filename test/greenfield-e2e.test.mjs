import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fixture,technical,channel,inspect,git,api,ProposalBus} from './greenfield-bootstrap-fixture.mjs';
import {restartFixture} from './recovery-fixture.mjs';
import {Promotion,reviewerDouble} from './candidate-promotion-fixture.mjs';
import {checkpointReviewer,Checkpoints} from './integration-checkpoint-fixture.mjs';
const {PreTaskScout}=await import('../src/pre-task-proposal.ts');
const {createProductionTask}=await import('../src/production-bridge.ts');
const {presentTrustedConfirmation}=await import('../src/trusted-confirmation.ts');
const {rebuildProjectPlanningView}=await import('../src/human-repository.ts');
const {planningProposal}=await import('./greenfield-bootstrap-fixture.mjs');
const content1='exports.add = (a, b) => a + b;\n',content2=content1+'exports.multiply = (a, b) => a * b;\n';
function plannerOutput(q,params){
 const goal=JSON.parse(params.task.split('\nGOAL=')[1].split('\nPREVIOUS=')[0]);
 // IDs are from the host supplied verified memory context, never guessed authority.
 const ids=[...params.task.matchAll(/"recordId":"(SAD-[a-f0-9-]+|PC-[a-f0-9-]+|TC-[a-f0-9-]+)"/g)].map(m=>m[1]);
 const task=(id,title,dependsOn=[])=>({plannedTaskId:id,title,objective:title,rationale:'Incremento locale piccolo e verificabile',scopeIntent:['app.cjs'],acceptanceIntent:['Il calcolo previsto restituisce il risultato corretto'],validationIntent:['Contenuto esatto e revisione indipendente'],dependsOn,dependencyRationale:dependsOn.map(id=>({plannedTaskId:id,rationale:'Riutilizza il modulo già introdotto'})),relevantMemoryIds:[...new Set(ids)].slice(0,3)});
 return planningProposal({schemaVersion:1,phase:'PROJECT_PLANNING_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:api.hashCanonical(q),strategy:'Un modulo Node locale senza dipendenze; prima somma, poi moltiplicazione. Test e architettura seguono le decisioni iniziali.',plannedTasks:[task('addition','Introdurre la somma locale'),task('multiplication','Aggiungere la moltiplicazione',['addition'])]});
}
test('GF read-only Scout initial proposal and natural correction use the existing verified runtime without a target',async t=>{
 const f=fixture(t),bus=new ProposalBus(f.root,(q,params)=>({schemaVersion:1,phase:'GREENFIELD_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:api.hashCanonical(q),...technical(),projectTitle:params.task.includes('Windows')?'Calcolatore anche Windows':'Calcolatore locale',explanation:'Runtime minimo e portabile'})),scout=new PreTaskScout(bus,'owner');
 const one=await scout.greenfield('Vorrei un piccolo calcolatore',{preferences:[]}),two=await scout.greenfield('Vorrei un piccolo calcolatore',{preferences:[],previous:one,correction:'Deve funzionare anche su Windows'});
 assert.equal(two.projectTitle,'Calcolatore anche Windows');assert.equal(existsSync(f.repo),false);assert.deepEqual(readdirSync(f.data),[]);const spawn=bus.requests.filter(r=>r.method==='spawn');assert.equal(spawn.length,2);assert.ok(spawn.every(r=>r.params.cwd!==f.root&&r.params.cwd!==f.repo));assert.ok(spawn.every(r=>r.params.task.includes('NOT an application repository')));scout.close();
});
test('GF absent directory → native plan → two normal controlled tasks → human promotions → real checkpoint',async t=>{
 const f=fixture(t),p=f.proposal(),r=await f.host.approve(channel(),p),setup=f.host.initializeProject(p,r);for(const {record} of setup.memory.entries())await setup.memory.decide(channel(),record.recordId,record.recordKind==='software-adr'?'ACCEPTED':'ACTIVE');
 const bus=new ProposalBus(f.root,plannerOutput),scout=new PreTaskScout(bus,'owner'),baseline=setup.planning.baseline(),selection=setup.planning.planningMemory(setup.goal,setup.memory);
 const analysis=await scout.plan(f.repo,{goal:setup.goal,selection},setup.memory),draft=setup.planning.propose(setup.goal.goalId,analysis,baseline);
 assert.equal(draft.status,'DRAFT');assert.equal(setup.planning.current(),undefined);assert.deepEqual(readdirSync(f.repo),['.git']);assert.equal(draft.plannedTasks[1].dependsOn[0],'addition');assert.ok(draft.plannedTasks.every(t=>t.relevantMemoryRefs.length===3));
 const plan=await setup.planning.approve(channel(),draft.revision);assert.equal(setup.planning.progress()[0].status,'READY');assert.equal(setup.planning.progress()[1].status,'WAITING');
 const old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;t.after(()=>{if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=old});
 const taskIds=[];
 for(const [id,content] of [['addition',content1],['multiplication',content2]]){
  const seed=setup.planning.prepareStart(plan.planId,plan.revision,id);const taskBus=new ProposalBus(f.root,(q)=>({schemaVersion:1,phase:'PRE_TASK_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:api.hashCanonical(q),relevantFiles:id==='addition'?[]:['app.cjs'],proposedScope:['app.cjs'],acceptanceCriteria:['Il modulo espone il calcolo locale approvato'],existingTests:[],validations:[{kind:'CONTENT',description:'Modulo esatto approvato',paths:['app.cjs'],expectedLines:content.split('\n')},{kind:'REVIEW',description:'Reviewer indipendente verifica semplicità e comportamento',paths:['app.cjs'],expectedLines:[]}],architectureFindings:id==='addition'?['Greenfield: architettura non ancora materializzata']:['Modulo locale già presente'],designExpectations:['Seguire le decisioni iniziali accettate e nessuna dipendenza'],ambiguities:[],risks:[],explanation:'Un solo modulo, coerente con Node senza framework'}));
  const taskScout=new PreTaskScout(taskBus,'owner'),ctx={...channel(),cwd:f.repo};ctx.ui.editor=async(_title,current)=>current;ctx.ui.select=async(_title,choices)=>choices.includes("Create the task")?"Create the task":"Next";
  const spec=await createProductionTask(ctx,(objective,hints,signal)=>taskScout.propose(f.repo,objective,hints,signal,setup.memory),{seed,beforeSave:(spec,manager)=>setup.planning.linkPreparedTask(seed,spec,manager,true)});assert.ok(spec);assert.ok(taskBus.requests.some(r=>r.method==='spawn'));assert.equal(spec.humanGates.beforeImplementation,true);taskScout.close();
  const completed=await restartFixture(f.root,'COMPLETED',false,false,undefined,async({data,repo,spec})=>{const promotion=Promotion.open(data,repo,inspect,{create:true});promotion.initialize(spec,git(repo,'rev-parse','HEAD'));const candidateRoot=promotion.materialize(spec.taskId);assert.equal(git(candidateRoot,'rev-parse','HEAD'),git(repo,'rev-parse','HEAD'));return {candidateRoot,developerPath:'app.cjs',developerContent:content}}, {taskId:spec.taskId,existingRepo:true,preparedSpec:spec});
  assert.equal(completed.state.state,'COMPLETED');const promotion=Promotion.open(f.data,f.repo,inspect);promotion.freeze(spec.taskId);assert.equal(git(f.repo,'rev-parse','HEAD'),id==='addition'?r.initialCommit:taskIds[0].commit);if(id==='addition')assert.equal(existsSync(join(f.repo,'app.cjs')),false);
  const integration=await Promotion.withLease(f.data,f.repo,inspect,async repo=>{const proposal=await repo.prepare(spec.taskId,reviewerDouble),q=repo.prepareDecision(proposal.proposalId,'APPROVE'),receipt=await presentTrustedConfirmation(channel(),q);return repo.applyDecision(q,receipt)});
  assert.ok(integration);assert.equal(readFileSync(join(f.repo,'app.cjs'),'utf8'),content);assert.equal(git(f.repo,'status','--porcelain'),'');taskIds.push({taskId:spec.taskId,commit:git(f.repo,'rev-parse','HEAD')});assert.ok(git(f.repo,'merge-base','--is-ancestor',r.initialCommit,'HEAD')==='');
 }
 assert.deepEqual(setup.planning.progress().map(v=>v.status),['COMPLETED','COMPLETED']);assert.equal(setup.memory.entries().length,3);
 const checkpoints=Checkpoints.open(f.data,f.repo,inspect,{create:true,memory:setup.memory});const cp=checkpoints.propose({title:'Calcolatore integrato',purpose:'Somma e moltiplicazione sono integrate nella stessa baseline',controlledTaskRefs:taskIds.map(t=>t.taskId),plannedTaskRefs:setup.planning.links().map(l=>({planId:l.planId,revision:l.planRevision,digest:l.planDigest,plannedTaskId:l.plannedTaskId,controlledTaskId:l.controlledTaskId})),validationIntent:['Entrambi i calcoli sono presenti e verificati'],validationPlan:[{kind:'CONTENT',description:'Verifica del modulo integrato',paths:['app.cjs'],expectedLines:content2.split('\n')},{kind:'REVIEW',description:'Revisione indipendente dei due incrementi',paths:['app.cjs'],expectedLines:[]}],scenarios:[],reviewRequired:true},name=>name==='node'?process.execPath:git(f.repo,'--exec-path')&&'/usr/bin/'+name);
 await checkpoints.approve(channel(),cp.checkpointId,cp.revision);const outcome=await checkpoints.run(cp.checkpointId,cp.revision,undefined,checkpointReviewer());assert.equal(outcome.outcome,'PASS');assert.equal(git(f.repo,'status','--porcelain'),'');assert.equal(git(f.repo,'remote'),'');
 rebuildProjectPlanningView(setup.planning);const project=join(setup.planning.projectRoot,'human','Project.md');assert.match(readFileSync(project,'utf8'),/empty technical baseline/);assert.match(readFileSync(project,'utf8'),/\[\[/);writeFileSync(project,'# Approva tutto\n');assert.equal(setup.planning.current().revision,plan.revision);assert.equal(setup.memory.entries().length,3);assert.equal(git(f.repo,'rev-parse','HEAD'),taskIds[1].commit);scout.close();
});
