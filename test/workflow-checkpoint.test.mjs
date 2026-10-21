import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {installSourceLoader} from './load-source.mjs';
import {restartFixture} from './recovery-fixture.mjs';
installSourceLoader();
const api=await import('../src/contracts.ts');
const {WorkflowCheckpointService,WorkflowCheckpointError}=await import('../src/workflow-checkpoint.ts');
const {CandidatePromotionRepository}=await import('../src/candidate-promotion-repository.ts');
const {DurableStore}=await import('../src/store.ts');
const {errorPresentation}=await import('../src/controlled-ui.ts');
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();

test('a post-result checkpoint failure preserves the published candidate and retries saving without another Developer',async t=>{
 const root=mkdtempSync(join(tmpdir(),'checkpoint-post-result-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const repo=join(root,'repo'),data=join(root,'data');mkdirSync(repo);mkdirSync(data);
 git(repo,'init','-q','--initial-branch=main');git(repo,'config','user.name','Test');git(repo,'config','user.email','test@example.invalid');
 writeFileSync(join(repo,'file.txt'),'base\n');git(repo,'add','file.txt');git(repo,'commit','-qm','baseline');
 const base=git(repo,'rev-parse','HEAD');mkdirSync(join(repo,'.controlled-dev'));
 writeFileSync(join(repo,'.controlled-dev','project.json'),api.canonicalize({schemaVersion:1,projectId:api.hashBytes(Buffer.from(repo)),originalRepoRoot:repo,baselineCommit:base,baselineTree:git(repo,'rev-parse','HEAD^{tree}')}));
 writeFileSync(join(repo,'.git','info','exclude'),'/.controlled-dev/\n/Documentazione/\n');
 let workflow,taskRoot;const publish=WorkflowCheckpointService.prototype.publish;let failed=false;
 const fault=t.mock.method(WorkflowCheckpointService.prototype,'publish',function(input,...args){
  if(input.state.candidate&&!failed){failed=true;taskRoot=input.store.root;throw Object.assign(new Error('ENOSPC'),{code:'ENOSPC'})}
  return publish.call(this,input,...args);
 });
 await assert.rejects(restartFixture(root,'TESTING',false,false,{},async({spec})=>{
  const promotion=CandidatePromotionRepository.open(data,repo,()=> 'ACCEPT',{create:true});promotion.initialize(spec,base);return {candidateRoot:promotion.materialize('task')};
 },{existingRepo:true,onWorkflowCreated:o=>workflow=o}),error=>{
  assert.ok(error instanceof WorkflowCheckpointError);assert.equal(error.diagnostic.path,'ENOSPC');assert.match(errorPresentation(error).message,/checkpoint/);return true;
 });
 const before=DurableStore.load(taskRoot);assert.ok(before.state.candidate);assert.equal(before.state.state,'IMPLEMENTING');
 assert.equal(before.state.runs.filter(r=>r.role==='Developer').length,1);assert.ok(before.state.runs.every(r=>r.status==='TERMINAL'));
 assert.equal(before.events.filter(e=>e.recordType==='CANDIDATE_MATERIALIZED').length,1);
 assert.equal(before.events.some(e=>e.reason==='Developer dispatch/result failed'),false);
 fault.mock.restore();workflow.saveCheckpoint(workflow.state.revision);
 const after=DurableStore.load(taskRoot);assert.deepEqual(after,before);assert.deepEqual(workflow.state.counters,before.state.counters);
 workflow.dispose();
});

test('candidate artifact publication can be retried from the captured result without a second Developer',async t=>{
 const root=mkdtempSync(join(tmpdir(),'result-publication-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 let workflow,failed=false;const put=DurableStore.prototype.put;
 const fault=t.mock.method(DurableStore.prototype,'put',function(id,...rest){if(!failed&&id.startsWith('patch-')){failed=true;throw Object.assign(new Error('SYNTHETIC_WRITE_REFUSED'),{code:'EACCES'})}return put.call(this,id,...rest)});
 await assert.rejects(restartFixture(root,'TESTING',false,false,{},undefined,{onWorkflowCreated:o=>workflow=o}),error=>{assert.equal(error.code,'PROJECT_RESULT_SAVE_FAILED');return true});
 const before=workflow.state;assert.equal(before.state,'IMPLEMENTING');assert.equal(before.candidate,undefined);assert.equal(before.runs.filter(r=>r.role==='Developer').length,1);assert.ok(before.runs.every(r=>r.status==='TERMINAL'));
 fault.mock.restore();assert.equal(workflow.saveCheckpoint(workflow.state.revision),'LOCAL');
 assert.ok(workflow.state.candidate);assert.deepEqual(workflow.state.counters,before.counters);assert.equal(workflow.events.filter(e=>e.recordType==='CANDIDATE_MATERIALIZED').length,1);assert.equal(workflow.events.some(e=>e.reason==='Developer dispatch/result failed'),false);
});
