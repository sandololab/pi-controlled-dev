import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installSourceLoader} from './load-source.mjs';
import {fixtures} from './contract-fixtures.mjs';
import {recoveryFixture} from './recovery-fixture.mjs';
installSourceLoader();
const {createProductionTask,readProductionTaskInput,renderProductionStatus,productionStatusPages}=await import('../src/production-bridge.ts');
const api=await import('../src/contracts.ts');
const {hashContract}=api;
const {DurableStore}=await import('../src/store.ts');
const {default:extension}=await import('../extensions/controlled-dev.ts');
function setup(t,options={}){
  const root=mkdtempSync(join(tmpdir(),'p17-ux-')),repo=join(root,'repo'),data=join(root,'profile');mkdirSync(repo);mkdirSync(data);
  const old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=data;
  t.after(()=>{if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=old;rmSync(root,{recursive:true,force:true})});
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
  if(!options.noGit){git('init','-q');writeFileSync(join(repo,'README.md'),'Demo\n');git('add','README.md');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','Initial')}
  const editors=options.editors??['Aggiungi una riga a README.md'];
  const notifications=[],confirmations=[];
  const ctx={mode:'tui',cwd:repo,sessionManager:{getSessionId:()=> 'session'},ui:{notify(m){notifications.push(m)},
    async input(){return undefined},async editor(){return editors.shift()},async select(title,options){return options[0]},async confirm(title,message){confirmations.push([title,message]);return title==="Create the task?"||title==='Cancel preparation?'}}};
  return {root,repo,data,git,ctx,notifications,confirmations};
}
function command(ctx){const handlers=new Map(),commands=new Map();let rpc=0,active=[];
  extension({events:{on(){return()=>{}},emit(){rpc++}},registerCommand(name,value){commands.set(name,value)},
    on(name,fn){handlers.set(name,[...(handlers.get(name)??[]),fn]);return()=>{}},getAllTools:()=>[{name:'read',sourceInfo:{source:'builtin',path:'<builtin:read>'}}],setActiveTools(value){active=value}});
  for(const fn of handlers.get('session_start'))fn({},ctx);
  return {run:(text)=>commands.get('controlled-dev').handler(text,ctx),rpc:()=>rpc,active:()=>active};
}
test('an active operation permits read-only project consultation and status, while a second mutation stays blocked',async t=>{
 const f=setup(t);let close,started;const waiting=new Promise(resolve=>started=resolve),titles=[];
 f.ctx.ui.select=async(title,options)=>{titles.push(title);if(title.startsWith("Choose an action")){started();return new Promise(resolve=>close=resolve)}return options.includes("Back")?"Back":undefined};
 const c=command(f.ctx),main=c.run('menu');await waiting;const rpc=c.rpc();
 const snapshot=()=>readdirSync(f.data,{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>[join(entry.parentPath,entry.name),readFileSync(join(entry.parentPath,entry.name),'utf8')]);
 const before=snapshot();await c.run('project consult');await c.run('project status');await c.run('status');
 assert.ok(titles.some(title=>title.startsWith("Consult the plan")));assert.ok(titles.some(title=>title.startsWith("Project status")));
 assert.deepEqual(snapshot(),before);assert.equal(c.rpc(),rpc);
 await c.run('project plan');assert.match(f.notifications.at(-1),/View the plan/);assert.equal(c.rpc(),rpc);
 close(undefined);await main;
});
test('P17 public first run is readable; missing service denies run without weakening parent isolation',async t=>{
  const f=setup(t),c=command(f.ctx);await c.run('status');assert.match(f.notifications[0],/No Controlled Dev task in progress/);assert.match(f.notifications[0],/controlled-dev new/);
  assert.doesNotMatch(f.notifications[0],/specHash|DATA-001/);assert.deepEqual(c.active(),['read']);
  await c.run('run');assert.match(f.notifications.at(-1),/pi-subagents/);
});
test('P17 public new builds validated spec outside repo, preserves baseline, requires separate human gates',async t=>{
  const f=setup(t),before=f.git('rev-parse','HEAD'),c=command(f.ctx);await createProductionTask(f.ctx,propose);
  const {spec,path}=readProductionTaskInput(f.ctx);assert.ok(path.startsWith(f.data));assert.equal(spec.specHash,hashContract('TaskSpec',spec));
  assert.equal(spec.scope.repoRoot,f.repo);assert.deepEqual(spec.scope.allowedPaths,['README.md']);assert.equal(spec.scope.baseRef,'HEAD');assert.equal(f.git('rev-parse','HEAD'),before);
  assert.deepEqual(spec.constraints,['Architecture finding: README.md è la guida esistente','Design expectation: Estendere la guida esistente']);
  assert.equal(spec.humanGates.beforeImplementation,true);assert.equal(spec.humanGates.beforeCompletion,true);
  assert.equal(f.git('status','--porcelain=v1','--untracked-files=all'),'');assert.deepEqual(readdirSync(f.repo).sort(),['.git','README.md']);
  await c.run('status');assert.match(f.notifications.at(-1),/Task ready to start/);assert.match(f.notifications.at(-1),/Aggiungi una riga/);
  await c.run('new');assert.match(f.notifications.at(-1),/already ready/);assert.equal(readProductionTaskInput(f.ctx).spec.taskId,spec.taskId);
});
const propose=async objective=>({schemaVersion:1,phase:'PRE_TASK_PROPOSAL',proposalOnly:true,requestId:'fixture',requestHash:'a'.repeat(64),relevantFiles:['README.md'],proposedScope:['README.md'],acceptanceCriteria:['README.md contiene la riga richiesta'],existingTests:[],validations:[{kind:'REVIEW',description:'Controlla il risultato richiesto',paths:['README.md'],expectedLines:[]}],architectureFindings:['README.md è la guida esistente'],designExpectations:['Estendere la guida esistente'],ambiguities:[],risks:[],explanation:"Proposal"});
for(const [name,options,reason] of [
  ['no git',{noGit:true},/Invalid Git repository/],
  ['sensitive input',{editors:['SYNTHETIC_SECRET']},/cannot be exported safely/],
])test(`P17 new rejects ${name} without creating task data`,async t=>{
  const f=setup(t,options);await assert.rejects(createProductionTask(f.ctx,propose),reason);
  assert.throws(()=>readProductionTaskInput(f.ctx),error=>error.code==='CONTROLLED_DEV_TASK_INPUT_MISSING');
  for(const entry of readdirSync(f.data,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()))assert.doesNotMatch(readFileSync(join(entry.parentPath,entry.name),'utf8'),/SYNTHETIC_SECRET/);
});
test('P17 dirty repo rejected; cancellation leaves no draft; non-TUI cannot create tasks',async t=>{
  const f=setup(t);writeFileSync(join(f.repo,'README.md'),'dirty');await assert.rejects(createProductionTask(f.ctx,propose),/unsaved changes/);
  writeFileSync(join(f.repo,'README.md'),'Demo\n');f.ctx.ui.editor=async()=>undefined;f.ctx.ui.select=async(_title,options)=>options.includes("Discard draft")?"Discard draft":undefined;assert.equal(await createProductionTask(f.ctx,propose),undefined);
  assert.deepEqual(readdirSync(f.data),[]);await assert.rejects(createProductionTask({...f.ctx,mode:'rpc'},propose),/HUMAN_CHANNEL_UNAVAILABLE/);
});
test('P17 readable state labels and completed/candidate rendering use a read-only view, not execution authority',()=>{
  const f=fixtures(api),labels={ANALYZING:"Task analysis",IMPLEMENTING:"Implementation in progress",REVIEWING:"Independent review",AWAITING_HUMAN:"Waiting for your confirmation",COMPLETED:"Completed"};
  for(const [state,label] of Object.entries(labels)){
    const view={state:{...f.WorkflowState,state,candidate:f.Candidate},events:[],context:()=>({records:[{id:f.WorkflowState.spec.id,kind:'TaskSpec',value:f.TaskSpec}]})};
    const text=renderProductionStatus({},view);assert.ok(text.includes(label));assert.match(text,/Working copy:/);
    assert.match(text,/Last completed step:/);assert.match(text,/Working version:/);
    if(state==='COMPLETED'){
      assert.match(text,/completed and verified/);assert.match(text,/original project was not modified/);assert.match(text,/not merged, committed, pushed or published/);
      const pages=productionStatusPages({cwd:process.cwd()},view);
      assert.match(pages.overview,/Objective\n/);assert.match(pages.overview,/\n\nTask status\nCompleted/);
      assert.match(pages.overview,/\n\nResult\n/);assert.doesNotMatch(pages.overview,/Candidate workspace:/);
      assert.match(pages.technical,/candidate/);
    }
  }
});
test('P17 activity and checks summarize verified milestones in separated sections',()=>{
  const f=fixtures(api),view={state:{...f.WorkflowState,state:'COMPLETED',candidate:f.Candidate},events:[
    {kind:'CREATE',revision:0,targetState:'PENDING'},
    {kind:'TRANSITION',revision:1,sourceState:'PENDING',targetState:'ANALYZING'},
    {kind:'TRANSITION',revision:2,sourceState:'ANALYZING',targetState:'READY'},
    {kind:'TRANSITION',revision:3,sourceState:'READY',targetState:'IMPLEMENTING'},
    {kind:'RECORD',revision:4,recordType:'CANDIDATE_MATERIALIZED',targetState:'IMPLEMENTING'},
    {kind:'TRANSITION',revision:5,sourceState:'TESTING',targetState:'REVIEWING'},
    {kind:'TRANSITION',revision:6,sourceState:'REVIEWING',targetState:'COMPLETED'},
  ],context:()=>({records:[{id:f.WorkflowState.spec.id,kind:'TaskSpec',value:f.TaskSpec}]})};
  const pages=productionStatusPages({cwd:process.cwd()},view);
  assert.match(pages.activity,/Scout · Task analysis started\n\nScout · Analysis completed/);
  assert.match(pages.activity,/Developer · Working copy produced/);
  assert.match(pages.activity,/Completed/);
  assert.doesNotMatch(pages.activity,/recorded data|TR-\d+/);
  assert.match(pages.checks,/Acceptance criteria/);
  assert.match(pages.checks,/Automated checks/);
});
test('P17 recovery/repair rendering explains uncertainty and interrupted saving without storage jargon',t=>{
  const root=mkdtempSync(join(tmpdir(),'p17-status-')),f=recoveryFixture(root,'BLOCKED'),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;
  t.after(()=>{if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=old;rmSync(root,{recursive:true,force:true})});
  const ctx={cwd:f.repo},before=readFileSync(join(f.storeRoot,'events.jsonl'));
  assert.match(renderProductionStatus(ctx),/controlled-dev recover/);
  const prior=DurableStore.load(f.storeRoot).events[0];writeFileSync(join(f.storeRoot,'state.json'),readFileSync(join(f.storeRoot,prior.stateAfter.relativeStorePath)));
  const text=renderProductionStatus(ctx);assert.match(text,/Saving the task was interrupted/);assert.match(text,/controlled-dev repair/);assert.doesNotMatch(text,/WAL|fsync|snapshot/);
  assert.deepEqual(readFileSync(join(f.storeRoot,'events.jsonl')),before);
});
test('P17 blocked unknown role status names the exact safe recovery effect',t=>{
  const root=mkdtempSync(join(tmpdir(),'p17-unknown-status-')),f=recoveryFixture(root,'BLOCKED','UNKNOWN'),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;
  t.after(()=>{if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=old;rmSync(root,{recursive:true,force:true})});
  const text=renderProductionStatus({cwd:f.repo});
  assert.match(text,/Objective\n/);assert.match(text,/\n\nTask status\n/);assert.match(text,/\n\nConfirmations and recovery\n/);
  assert.match(text,/no authorization is pending/);assert.match(text,/Next safe action: \/controlled-dev reconcile/);
  assert.match(text,/terminal state of the Scout previous is unverified/);assert.match(text,/read-only consultation only/);
  assert.match(text,/does not start new agents or checks and does not modify the working copy/);
});
test('P17 session replacement during prompts cannot persist a task',async t=>{
  const f=setup(t);f.ctx.ui.confirm=async title=>{if(title==="Create the task?"){f.ctx.sessionManager.getSessionId=()=> 'other';return true}return false};
  await assert.rejects(createProductionTask(f.ctx,propose),/session changed/);
  assert.throws(()=>readProductionTaskInput(f.ctx),error=>error.code==='CONTROLLED_DEV_TASK_INPUT_MISSING');
  assert.equal(readdirSync(f.data,{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile()).some(entry=>entry.parentPath.split('/').includes('tasks')||entry.name==='task.json'),false,'Saved read-only investigation evidence must not become an executable task');
});

test('P17 blocked review reports current host checks without counting stale or invalid results',()=>{
  const f=fixtures(api),state={...f.WorkflowState,state:'BLOCKED',blockedReason:'Reviewer batch failed',candidate:f.Candidate,validations:['validation']};
  const records=[{id:state.spec.id,kind:'TaskSpec',value:f.TaskSpec},{id:'validation',kind:'ValidationResult',value:f.ValidationResult}];
  const view={state,events:[],context:()=>({records})};
  let text=renderProductionStatus({},view);
  assert.match(text,/Automated checks on the current copy: 1 passed out of 1 planned/);
  assert.match(text,/Independent review: incomplete/);
  assert.match(text,/Completion: not reached/);
  records[1]={...records[1],value:{...f.ValidationResult,candidateGeneration:0}};
  text=renderProductionStatus({},view);assert.match(text,/0 passed out of 1 planned/);
  records[1]={...records[1],value:f.ValidationResult};state.invalidEvidenceIds=['validation'];
  assert.match(renderProductionStatus({},view),/0 passed out of 1 planned/);
});
