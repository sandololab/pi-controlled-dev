import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installSourceLoader} from './load-source.mjs';
import {git,api} from './candidate-promotion-fixture.mjs';
import {fixtures} from './contract-fixtures.mjs';
installSourceLoader();
const {CandidateGit}=await import('../src/candidate-git.ts');
const {workspaceManifest}=await import('../src/scope-guard.ts');
const {registerControlledReviewer,ControlledReviewerRunner,REVIEWER_RUNTIME_DEFINITION}=await import('../src/controlled-reviewer.ts');

// Declared RPC/provider double: live adapter, operational registration, schema acquisition,
// terminal-proof and transcript enforcement are real; no real-model verdict is claimed.
import {Bus} from './integration-review-rpc-fixture.mjs';
function setup(profile){
  const root=mkdtempSync(join(tmpdir(),'promotion-review-')),repo=join(root,'repo'),data=join(root,'data'),work=join(data,'integration');mkdirSync(repo);mkdirSync(data);git(repo,'init','-q','-b','main');git(repo,'config','user.name','Fixture');git(repo,'config','user.email','fixture@example.invalid');writeFileSync(join(repo,'file.txt'),'base\n');git(repo,'add','.');git(repo,'commit','-qm','base');
  const g=new CandidateGit(repo,data),base=g.head(),candidate=join(data,'candidate'),ref='refs/heads/controlled-dev/review';g.addTaskWorktree(ref,base,candidate);writeFileSync(join(candidate,'file.txt'),'candidate\n');const c=g.candidateCommit(candidate,ref,base,workspaceManifest(candidate,base),'candidate');g.bindCandidate(ref,c,base);
  writeFileSync(join(repo,'advanced.txt'),'target\n');git(repo,'add','.');git(repo,'commit','-qm','advanced');const commit=g.prepareMerge(work,g.head(),c,'prepared integration'),packet={taskId:'task',integrationCommit:commit,integrationDigest:api.hashCanonical(workspaceManifest(work,commit)),criteria:fixtures(api).TaskSpec.acceptanceCriteria};
  const bus=new Bus(root,work),registration=registerControlledReviewer({events:bus},'integration-review-fixture'),runner=new ControlledReviewerRunner(registration,bus,'owner',undefined,undefined,profile);return {root,repo,work,g,bus,registration,runner,packet};
}
test('Integration review — existing Reviewer registration and fresh read-only operational proof',async()=>{const f=setup();try{const result=await f.runner.reviewIntegration(f.repo,f.work,f.packet);assert.equal(result.result.verdict,'PASS');assert.equal(result.packetDigest,api.hashCanonical(f.packet));assert.match(result.terminalProofDigest,/^[a-f0-9]{64}$/);assert.deepEqual(result.invokedTools,['read']);assert.equal(result.candidateUnchanged,true);assert.equal(result.originalWorkspaceUnchanged,true);assert.doesNotMatch(api.canonicalize(result),/\/tmp\//)}finally{f.runner.dispose();f.registration.dispose()}});
for(const mode of ['WRONG_BINDING','MISSING_CRITERION','EXTRA_AUTHORITY'])test(`Integration review — rejects ${mode}`,async()=>{const f=setup();f.bus.mode=mode;try{await assert.rejects(f.runner.reviewIntegration(f.repo,f.work,f.packet));assert.equal(git(f.repo,'status','--porcelain'),'')}finally{f.runner.dispose();f.registration.dispose()}});
test('Integration review — read-only FAIL is retained as data',async()=>{const f=setup();f.bus.mode='FAIL';try{assert.equal((await f.runner.reviewIntegration(f.repo,f.work,f.packet)).result.verdict,'FAIL')}finally{f.runner.dispose();f.registration.dispose()}});
test('Integration review — mutative tool exposure invalidates transcript',async()=>{const f=setup();f.bus.tools=['read','write','structured_output'];try{await assert.rejects(f.runner.reviewIntegration(f.repo,f.work,f.packet))}finally{f.runner.dispose();f.registration.dispose()}});
for(const which of ['work','repo'])test(`Integration review — detects ${which} byte mutation`,async()=>{const f=setup();f.bus.mutate=()=>writeFileSync(join(f[which],'file.txt'),'unapproved bytes');try{await assert.rejects(f.runner.reviewIntegration(f.repo,f.work,f.packet),/READ_ONLY_CANARY_CHANGED/)}finally{f.runner.dispose();f.registration.dispose()}});
test('Integration review — forged continuity callback cannot waive primary integrity',async()=>{const f=setup();f.bus.mutate=()=>writeFileSync(join(f.repo,'file.txt'),'unapproved bytes');try{await assert.rejects(f.runner.reviewIntegration(f.repo,f.work,f.packet,{primaryContinuity:{verify(){return true}}}),/READ_ONLY_CANARY_CHANGED/)}finally{f.runner.dispose();f.registration.dispose()}});

test('domain profile reaches integration review with unchanged technical result contract (real Git/provider double)',async t=>{
 const f=setup({schemaVersion:1,id:'systemist_factory',common:['Preserve requirement source links'],phases:{IntegrationReview:['Review requested technical evidence'],Reviewer:['Task review only marker']}});
 t.after(()=>{f.runner.dispose();f.registration.dispose();rmSync(f.root,{recursive:true,force:true})});
 const result=await f.runner.reviewIntegration(f.repo,f.work,f.packet);
 assert.equal(result.result.verdict,'PASS');assert.equal(result.packetDigest,api.hashCanonical(f.packet));
 assert.match(f.bus.task,/Preserve requirement source links/);assert.match(f.bus.task,/Review requested technical evidence/);assert.doesNotMatch(f.bus.task,/Task review only marker/);
 assert.equal(result.originalWorkspaceUnchanged,true);assert.deepEqual(result.invokedTools,['read']);
});
