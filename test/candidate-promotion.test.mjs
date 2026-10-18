import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,unlinkSync,existsSync,chmodSync,mkdirSync,mkdtempSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {completedFixture,Promotion,inspect,channel,git,api,reviewerDouble} from './candidate-promotion-fixture.mjs';
const model=await import('../src/candidate-promotion.ts');
const {CandidateGit,localRef}=await import('../src/candidate-git.ts');
const {workspaceManifest,ScopeGuard}=await import('../src/scope-guard.ts');
const {presentTrustedConfirmation}=await import('../src/trusted-confirmation.ts');
const {DurableStore}=await import('../src/store.ts');
const {rebuildHumanView,rebuildProjectPlanningView}=await import('../src/human-repository.ts');
const {showCandidatePromotion}=await import('../src/candidate-promotion-ui.ts');
const {ProjectPlanningRepository:Planning}=await import('../src/project-planning-repository.ts');
const {LockManager,withLockMutation}=await import('../src/lock-manager.ts');
const {STATES,TRANSITIONS}=await import('../src/state-machine.ts');
const lease=(f,fn,fault)=>Promotion.withLease(f.data,f.repo,inspect,fn,fault);
const head=f=>git(f.repo,'rev-parse','HEAD');
const clean=f=>assert.equal(git(f.repo,'status','--porcelain=v1','--untracked-files=all','--ignored'),'');
const confirm=async(repo,p,action='APPROVE')=>{const q=repo.prepareDecision(p.proposalId,action),r=await presentTrustedConfirmation(channel(),q);return {q,r}};

test('Promotion — real completed task, binding, exact commit, refusals and local integration',async t=>{
  const f=await completedFixture(),base=head(f),candidate=f.binding.candidateCommit;
  await t.test('11 states and 43 transitions remain',()=>{assert.equal(STATES.length,11);assert.equal(TRANSITIONS.length,43)});
  await t.test('completion is not integration',()=>{assert.equal(f.state.state,'COMPLETED');assert.equal(head(f),base);assert.equal(f.promotion.status('task').baselineReady,false)});
  await t.test('stable host branch and external worktree',()=>{assert.equal(git(f.state.candidate.root,'symbolic-ref','HEAD'),f.binding.candidateRef);assert.ok(!f.state.candidate.root.startsWith(f.repo+'/'));assert.ok(readFileSync(join(f.state.candidate.root,'.git'),'utf8').startsWith('gitdir: '))});
  await t.test('frozen tree equals the exact reviewed digest',()=>{const manifest=f.promotion.git.manifestAt(candidate,base,join(f.data,'digest-proof'));assert.equal(api.hashCanonical(manifest),f.state.candidate.digest);assert.equal(f.binding.candidateDigest,f.state.candidate.digest);assert.equal(f.binding.completedSpecHash,f.state.specHash)});
  await t.test('commit preserves candidate ancestry and configured identity',()=>{assert.deepEqual(f.promotion.git.parents(candidate),[base]);assert.equal(git(f.repo,'show','-s','--format=%an <%ae>',candidate),'Fixture <fixture@example.invalid>');assert.match(git(f.repo,'show','-s','--format=%s',candidate),/controlled-dev: complete task/)});
  await t.test('freeze is idempotent',()=>{assert.deepEqual(f.promotion.freeze('task'),f.binding);assert.equal(f.promotion.bindings().length,1)});
  await lease(f,async repo=>{
    const p=await repo.prepare('task');
    await t.test('exact explicit merge is prepared without target mutation',()=>{assert.deepEqual(repo.git.parents(p.integrationCommit),[base,candidate]);assert.equal(repo.git.tree(p.integrationCommit),repo.git.tree(candidate));assert.equal(head(f),base);clean(f)});
    await t.test('validation and reused review bind the integration commit',()=>{for(const ref of p.validationRefs){const v=api.parseJson(repo.store.read(ref),2e6);assert.equal(v.integrationCommit,p.integrationCommit);assert.equal(v.status,'PASS')}assert.equal(api.parseJson(repo.store.read(p.reviewRef),2e6).source,'COMPLETED_TASK_REVIEW')});
    await t.test('proposal narrative shows branch, files, checks and consequences',()=>{const text=model.promotionNarrative(p);assert.equal(p.title,DurableStore.load(f.storeRoot).records.find(r=>r.kind==='TaskSpec'&&r.id===f.state.spec.id).value.title);assert.match(text,/Destination\nmain/);assert.match(text,/file.txt · modified/);assert.match(text,/Independent review/);assert.ok(text.indexOf(p.integrationCommit)>text.indexOf("Technical details"))});
    await t.test('new authority records have no absolute worktree paths',()=>{for(const refs of Object.values(api.parseJson(repo.store.read(repo.store.readProjectIndex()),2e6)).filter(Array.isArray))for(const r of refs){const value=api.parseJson(repo.store.read(r),2e6);assert.doesNotThrow(()=>model.validatePromotionIndex({schemaVersion:1,projectId:f.binding.projectId,revision:0,bindings:[],proposals:[],intents:[],results:[],observations:[]}));assert.doesNotMatch(api.canonicalize(value),/\/tmp\/|\/home\/|\/media\/|[A-Za-z]:/)} });
    await t.test('forged JSON receipt is rejected',()=>{const q=repo.prepareDecision(p.proposalId,'APPROVE');assert.throws(()=>repo.applyDecision(q,{}),/TRUSTED_CONFIRMATION_RECEIPT_INVALID/);assert.equal(head(f),base)});
    await t.test('copied receipt with wrong task, target, candidate or merge never gains authority',async()=>{
      for(const field of ['subjectId','payloadDigest','requestDigest','presentationDigest']){const {q,r}=await confirm(repo,p),forged={...r,[field]:'forged'};assert.throws(()=>repo.applyDecision(q,forged),/TRUSTED_CONFIRMATION_RECEIPT_INVALID/);assert.equal(head(f),base)}
    });
    await t.test('a genuine receipt cannot approve a different native request',async()=>{const {r}=await confirm(repo,p),q=repo.prepareDecision(p.proposalId,'APPROVE');assert.throws(()=>repo.applyDecision(q,r),/TRUSTED_CONFIRMATION_STALE/);assert.equal(head(f),base)});
    await t.test('absolute paths cannot become promotion record authority',()=>{for(const title of [['','tmp','untrusted'].join('/'),['C:','Users','untrusted'].join(String.fromCharCode(92))])assert.throws(()=>model.validatePromotionProposal({...p,title}),/PROJECT_PLANNING_ABSOLUTE_PATH/)});
    await t.test('headless confirmation cannot authorize',async()=>{const q=repo.prepareDecision(p.proposalId,'APPROVE');await assert.rejects(presentTrustedConfirmation({...channel(),mode:'print'},q),/HUMAN_CHANNEL_UNAVAILABLE/);assert.equal(head(f),base)});
    await t.test('native cancellation leaves target unchanged',async()=>{const q=repo.prepareDecision(p.proposalId,'APPROVE');assert.equal(await presentTrustedConfirmation(channel(false),q),undefined);assert.equal(head(f),base)});
    await t.test('wrong task and unknown proposal cannot request approval',()=>{assert.throws(()=>repo.prepareDecision('another-task','APPROVE'),/PROMOTION_PROPOSAL_STALE/);assert.throws(()=>repo.binding('../task'),/PROMOTION_TASK_INVALID/)});
    await t.test('dirty target is refused without overwriting user bytes',async()=>{const {q,r}=await confirm(repo,p);writeFileSync(join(f.repo,'file.txt'),'user edit\n');assert.throws(()=>repo.applyDecision(q,r),/GIT_TARGET_DIRTY/);assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'user edit\n');writeFileSync(join(f.repo,'file.txt'),'base\n');clean(f)});
    await t.test('untracked target file is preserved and refused',()=>{writeFileSync(join(f.repo,'user.txt'),'personal');assert.throws(()=>repo.prepareDecision(p.proposalId,'APPROVE'),/GIT_TARGET_DIRTY/);assert.equal(readFileSync(join(f.repo,'user.txt'),'utf8'),'personal');unlinkSync(join(f.repo,'user.txt'))});
    await t.test('wrong official branch is refused without checkout',async()=>{const {q,r}=await confirm(repo,p);git(f.repo,'checkout','-qb','other');assert.throws(()=>repo.applyDecision(q,r),/GIT_WRONG_TARGET_BRANCH/);assert.equal(git(f.repo,'branch','--show-current'),'other');git(f.repo,'checkout','-q','main')});
    await t.test('in-progress Git operation is refused without clearing its metadata',()=>{const path=join(f.repo,'.git','MERGE_HEAD');writeFileSync(path,candidate+'\n');assert.throws(()=>repo.prepareDecision(p.proposalId,'APPROVE'),/GIT_OPERATION_IN_PROGRESS/);assert.equal(readFileSync(path,'utf8'),candidate+'\n');unlinkSync(path)});
    await t.test('rejection preserves completed task and candidate',async()=>{const {q,r}=await confirm(repo,p,'REJECT');assert.equal(repo.applyDecision(q,r),undefined);assert.equal(head(f),base);assert.equal(repo.git.refHead(f.binding.candidateRef),candidate);assert.equal(DurableStore.load(f.storeRoot).state.state,'COMPLETED');assert.equal(repo.observations().at(-1).code,'REJECTED')});
    await t.test('forged candidate ref prevents application',async()=>{const {q,r}=await confirm(repo,p);git(f.repo,'update-ref',f.binding.candidateRef,base,candidate);assert.throws(()=>repo.applyDecision(q,r),/PROMOTION_CANDIDATE_CHANGED/);assert.equal(head(f),base);git(f.repo,'update-ref',f.binding.candidateRef,candidate,base)});
    await t.test('primary TUI offers back, approve and reject',async()=>{let actions;await showCandidatePromotion({...channel(),ui:{confirm:async()=>{throw Error('Unexpected approval')},notify(){},select:async(_title,choices)=>{actions=choices;return "Back"}}},repo,'task');assert.deepEqual(actions,["Back","Approve","Reject"]);assert.equal(head(f),base)});
    const current=repo.status('task').proposal;
    await t.test('exact valid receipt applies prepared M1 and persists result',async()=>{const {q,r}=await confirm(repo,current);const result=repo.applyDecision(q,r);assert.equal(head(f),current.integrationCommit);assert.equal(result.resultingHead,current.integrationCommit);assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'after\n');clean(f);assert.equal(repo.results().length,1);assert.equal(repo.status('task').status,'INTEGRATED');assert.throws(()=>repo.applyDecision(q,r),/PROMOTION_APPROVAL_INVALID/)});
    await t.test('reload keeps integration and terminal package readable',()=>{const reopened=Promotion.open(f.data,f.repo,inspect);assert.equal(reopened.results().length,1);assert.equal(reopened.status('task').baselineReady,true);assert.equal(DurableStore.load(f.storeRoot).state.state,'COMPLETED');assert.deepEqual(repo.recover(),[])});
    await t.test('production status after integration does not claim an unchanged original',async()=>{const {renderProductionStatus,productionStatusPages}=await import('../src/production-bridge.ts'),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;try{const ctx={cwd:f.repo},status=renderProductionStatus(ctx,undefined,'task');assert.match(status,/original project folder/);assert.doesNotMatch(status,/The original project was not modified/);assert.doesNotMatch(productionStatusPages(ctx,undefined,'task').overview,/The original repository is unchanged/)}finally{if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=old}});
    await t.test('Markdown explains integration and edits have no authority',()=>{const view=rebuildHumanView(f.storeRoot),note=join(view.vaultRoot,'Tasks','Task task.md'),text=readFileSync(note,'utf8');assert.match(text,/## Project integration/);assert.match(text,/present in the target branch history/);assert.match(text,/Promotions\/Integrazione task/);writeFileSync(note,'Integrazione: non completata');assert.equal(repo.status('task').baselineReady,true);assert.equal(head(f),current.integrationCommit);rebuildHumanView(f.storeRoot);assert.match(readFileSync(note,'utf8'),/## Project integration/)});
  });
});

test('Promotion — advanced target, stale receipt, read-only review and exact new merge',async t=>{
  const f=await completedFixture({branch:'feature/development'}),base=head(f);
  await lease(f,async repo=>{
    const old=await repo.prepare('task'),{q,r}=await confirm(repo,old);
    writeFileSync(join(f.repo,'compatible.txt'),'target feature\n');git(f.repo,'add','compatible.txt');git(f.repo,'commit','-qm','target advanced');const advanced=head(f);
    await t.test('previous human receipt is stale',()=>{assert.throws(()=>repo.applyDecision(q,r),/PROMOTION_TARGET_STALE/);assert.equal(head(f),advanced);assert.equal(repo.results().length,0)});
    await t.test('fresh target context requires existing independent Reviewer',async()=>{await assert.rejects(repo.prepare('task'),/INTEGRATION_REVIEW_REQUIRED/);assert.equal(head(f),advanced)});
    await t.test('negative integration review prevents executable approval',async()=>{const failing={async reviewIntegration(...args){const r=await reviewerDouble.reviewIntegration(...args);return {...r,result:{...r.result,verdict:'FAIL'}}}};await assert.rejects(repo.prepare('task',failing),/INTEGRATION_REVIEW_FAILED/);assert.equal(head(f),advanced);assert.equal(repo.observations().at(-1).code,'INTEGRATION_REVIEW_FAILED')});
    let calls=0;const reviewer={async reviewIntegration(...args){calls++;return reviewerDouble.reviewIntegration(...args)}};
    const p=await repo.prepare('task',reviewer);
    await t.test('clean advanced merge reruns validation and review',()=>{assert.equal(calls,1);assert.equal(p.targetHead,advanced);assert.equal(p.taskBaseCommit,base);assert.deepEqual(repo.git.parents(p.integrationCommit),[advanced,f.binding.candidateCommit]);assert.equal(api.parseJson(repo.store.read(p.reviewRef),2e6).source,'controlled.reviewer')});
    await t.test('fresh exact approval preserves both histories and files',async()=>{const {q,r}=await confirm(repo,p);repo.applyDecision(q,r);assert.equal(head(f),p.integrationCommit);assert.equal(readFileSync(join(f.repo,'compatible.txt'),'utf8'),'target feature\n');assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'after\n');clean(f)});
  });
});

test('Promotion — conflict retains target and offers no proposal',async()=>{
  const f=await completedFixture();writeFileSync(join(f.repo,'file.txt'),'conflicting target\n');git(f.repo,'add','.');git(f.repo,'commit','-qm','conflict');const before=head(f);
  await lease(f,async repo=>{await assert.rejects(repo.prepare('task',reviewerDouble),/MERGE_CONFLICT/);assert.equal(head(f),before);assert.equal(repo.status('task').proposal,undefined);assert.equal(repo.status('task').status,'CONFLICT');assert.equal(repo.observations().at(-1).code,'MERGE_CONFLICT');clean(f)});
});

test('Promotion — integrated validation failure has evidence, no fixes and no executable proposal',async()=>{
  const f=await completedFixture({configure({spec}){spec.validationCommands[0]={...spec.validationCommands[0],argv:['-e',"const fs=require('fs');process.exit(fs.existsSync('incompatible.txt')?1:0)"]}}});
  writeFileSync(join(f.repo,'incompatible.txt'),'changes context');git(f.repo,'add','.');git(f.repo,'commit','-qm','incompatible but mergeable');const before=head(f);
  await lease(f,async repo=>{await assert.rejects(repo.prepare('task',reviewerDouble),/INTEGRATION_VALIDATION_FAILED/);assert.equal(head(f),before);const o=repo.observations().at(-1);assert.equal(o.code,'INTEGRATION_VALIDATION_FAILED');assert.ok(o.evidenceRefs.length);assert.equal(repo.status('task').proposal,undefined);assert.equal(readFileSync(join(f.state.candidate.root,'file.txt'),'utf8'),'after\n');clean(f)});
});

test('Promotion — no-op is baseline ready without an artificial merge',async()=>{
  const f=await completedFixture({noChange:true});assert.equal(f.binding.candidateCommit,f.binding.baseCommit);assert.equal(f.promotion.status('task').status,'NOT_REQUIRED');assert.equal(f.promotion.status('task').baselineReady,true);
  await lease(f,async repo=>{assert.equal(await repo.prepare('task'),undefined);assert.equal(repo.results().length,0);clean(f)});
});

test('Promotion — provable manual integration, cherry-pick ambiguity and retained branch',async t=>{
  const f=await completedFixture(),before=head(f);
  git(f.repo,'cherry-pick','--no-commit',f.binding.candidateCommit);git(f.repo,'commit','-qm','copied candidate without its identity');
  await t.test('different commit with identical bytes does not prove identity',()=>{assert.notEqual(head(f),f.binding.candidateCommit);assert.equal(f.promotion.status('task').baselineReady,false)});
  git(f.repo,'merge','--no-ff','--no-edit',f.binding.candidateCommit);
  await t.test('candidate ancestry proves externally integrated result',async()=>{assert.equal(f.promotion.status('task').status,'INTEGRATED');assert.equal(f.promotion.git.refHead(f.binding.candidateRef),f.binding.candidateCommit);await lease(f,async repo=>{const at=head(f);assert.equal(await repo.prepare('task'),undefined);assert.equal(head(f),at);assert.equal(repo.results().length,0)});assert.notEqual(head(f),before);clean(f)});
});

test('Promotion — Git input validation rejects ref/option/path injection',async t=>{
  for(const ref of ['--help','refs/heads/../main','refs/heads/main.lock','refs/heads/a//b','refs/tags/v1','refs/heads/a@{1}','refs/heads/.hidden','refs/heads/a.','refs/heads/a\nmain'])await t.test(ref,()=>assert.throws(()=>localRef(ref),/GIT_REF_INVALID/));
  for(const ref of ['refs/heads/main','refs/heads/master','refs/heads/development','refs/heads/feature/lan'])assert.equal(localRef(ref),ref);
});

test('Promotion — hooks/signing policy and bounded host-only command surface',async()=>{
  const root=mkdtempSync(join(tmpdir(),'promotion-hooks-')),repo=join(root,'repo'),data=join(root,'data');mkdirSync(repo);mkdirSync(data);git(repo,'init','-q','-b','main');git(repo,'config','user.name','Fixture');git(repo,'config','user.email','fixture@example.invalid');writeFileSync(join(repo,'file.txt'),'base');git(repo,'add','.');git(repo,'commit','-qm','base');
  const hook=join(repo,'.git','hooks','post-checkout'),marker=join(root,'hook-executed');writeFileSync(hook,`#!/bin/sh\ntouch '${marker}'\n`);chmodSync(hook,0o755);git(repo,'config','commit.gpgsign','true');git(repo,'config','merge.gpgsign','true');
  const config=readFileSync(join(repo,'.git','config'),'utf8'),g=new CandidateGit(repo,data),b=g.head(),ref='refs/heads/controlled-dev/safe',work=join(data,'candidate');g.addTaskWorktree(ref,b,work);writeFileSync(join(work,'file.txt'),'candidate');const c=g.candidateCommit(work,ref,b,workspaceManifest(work,b),'controlled-dev: complete safe');g.bindCandidate(ref,c,b);g.prepareMerge(join(data,'integration'),b,c,'controlled-dev: integrate safe');assert.equal(existsSync(marker),false);assert.equal(readFileSync(join(repo,'.git','config'),'utf8'),config);
  const source=join(data,'rework-source'),rework=join(data,'rework'),reworkRef='refs/heads/controlled-dev/rework-policy';g.addTaskWorktree(reworkRef,b,source);const guard=ScopeGuard.open({schemaVersion:1,repoRoot:repo,baseRef:'HEAD',allowedPaths:['file.txt'],deniedPaths:[],strongConfinementRequired:false},source,b);writeFileSync(join(source,'file.txt'),'reworked candidate');const captured=guard.capture(1,'fixture-terminal-proof'),prepared=guard.prepareRework(captured,rework);assert.equal(git(repo,'show','-s','--format=%an <%ae>',prepared.baseCommit),'Fixture <fixture@example.invalid>');assert.equal(existsSync(marker),false);assert.equal(readFileSync(join(repo,'.git','config'),'utf8'),config);
  git(repo,'config','user.name','');assert.throws(()=>g.identity(),/GIT_IDENTITY_REQUIRED/);assert.throws(()=>guard.prepareRework(captured,join(data,'missing-identity-rework')),/GIT_IDENTITY_REQUIRED/);git(repo,'config','filter.unsafe.clean','echo unsafe');assert.throws(()=>new CandidateGit(repo,data),/GIT_EXTERNAL_DRIVER_UNSUPPORTED/);
  const code=readFileSync(new URL('../src/candidate-git.ts',import.meta.url),'utf8');assert.doesNotMatch(code,/\['(?:push|pull|fetch|remote|reset|rebase|cherry-pick)'/);assert.doesNotMatch(code,/execSync|shell:true/);assert.match(code,/GIT_COMMAND_NOT_ALLOWED/);
});

test('Promotion — exact Git commit includes binary, additions, deletions and executable mode, rejecting changed manifest',()=>{
  const root=mkdtempSync(join(tmpdir(),'promotion-exact-')),repo=join(root,'repo'),data=join(root,'data');mkdirSync(repo);mkdirSync(data);git(repo,'init','-q','-b','development');git(repo,'config','user.name','Fixture');git(repo,'config','user.email','fixture@example.invalid');writeFileSync(join(repo,'keep.txt'),'baseline');writeFileSync(join(repo,'remove.txt'),'remove');git(repo,'add','.');git(repo,'commit','-qm','base');
  const g=new CandidateGit(repo,data),base=g.head(),ref='refs/heads/controlled-dev/exact',work=join(data,'candidate');g.addTaskWorktree(ref,base,work);unlinkSync(join(work,'remove.txt'));writeFileSync(join(work,'new.bin'),new Uint8Array([0,255,1,17]));writeFileSync(join(work,'run.sh'),'#!/bin/sh\nexit 0\n');chmodSync(join(work,'run.sh'),0o755);const manifest=workspaceManifest(work,base);writeFileSync(join(work,'keep.txt'),'unexpected');assert.throws(()=>g.candidateCommit(work,ref,base,manifest,'exact'),/GIT_CANDIDATE_CHANGED/);assert.equal(g.refHead(ref),base);writeFileSync(join(work,'keep.txt'),'baseline');const commit=g.candidateCommit(work,ref,base,manifest,'exact');g.bindCandidate(ref,commit,base);
  assert.equal(api.hashCanonical(g.manifestAt(commit,base,join(data,'proof'))),api.hashCanonical(manifest));assert.deepEqual(g.changed(commit,base).map(c=>[c.kind,c.path]),[['A','new.bin'],['D','remove.txt'],['A','run.sh']]);assert.equal(g.head(),base);assert.match(git(repo,'ls-tree',commit,'run.sh'),/^100755 blob /);
});

test('Promotion — no-op freezing does not require an identity for a nonexistent new commit',()=>{
  const root=mkdtempSync(join(tmpdir(),'promotion-noop-')),repo=join(root,'repo'),data=join(root,'data');mkdirSync(repo);mkdirSync(data);git(repo,'init','-q','-b','main');writeFileSync(join(repo,'file.txt'),'base');git(repo,'add','.');git(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base');git(repo,'config','user.name','');const g=new CandidateGit(repo,data),base=g.head(),ref='refs/heads/controlled-dev/noop',work=join(data,'candidate');g.addTaskWorktree(ref,base,work);assert.equal(g.candidateCommit(work,ref,base,workspaceManifest(work,base),'noop'),base);assert.equal(g.head(),base);
});

test('Promotion — unbound historical tasks remain readable and not autopromoted',async()=>{
  const {restartFixture}=await import('./recovery-fixture.mjs'),root=mkdtempSync(join(tmpdir(),'promotion-legacy-')),f=await restartFixture(root,'COMPLETED');const repo=Promotion.open(f.data,f.repo,inspect,{create:true});assert.equal(repo.status('task').status,'LEGACY_CANDIDATE_NOT_AUTOPROMOTABLE');assert.throws(()=>repo.freeze('task'),/LEGACY_CANDIDATE_NOT_AUTOPROMOTABLE/);assert.equal(DurableStore.load(f.storeRoot).state.state,'COMPLETED');assert.equal(repo.bindings().length,0);
});

test('Promotion — planning waits for integration, then exposes normal TaskSpec preparation',async()=>{
  let planning,plan;
  const f=await completedFixture({async configure({repo,data,spec}){
    planning=Planning.open(data,repo,inspect,{create:true});const goal=planning.createGoal('Due incrementi verificabili');const task=(id,title,dependsOn=[])=>({plannedTaskId:id,title,objective:id==='p1'?spec.objective:'Usare il risultato del primo incremento',rationale:'Incremento necessario al risultato',scopeIntent:['file.txt'],acceptanceIntent:['Risultato verificato'],validationIntent:['Verifica del task'],dependsOn,dependencyRationale:dependsOn.map(id=>({plannedTaskId:id,rationale:'Richiede il codice del predecessore nella baseline'})),relevantMemoryRefs:[]});
    const draft=planning.propose(goal.goalId,{proposal:{strategy:'Integrare il primo risultato prima del successivo',plannedTasks:[task('p1','Primo'),task('p2','Secondo',['p1'])]},analysis:{source:'planning-double'}},planning.baseline());await planning.approve(channel(),draft.revision);plan=planning.current();const seed=planning.prepareStart(plan.planId,plan.revision,'p1'),manager=new LockManager(data,'planning-host','planning-link');
    withLockMutation(manager.root,manager.workspaceIdentity(repo).workspaceHash,()=>planning.linkPreparedTask(seed,spec,manager,true));
  }});
  assert.equal(planning.progress()[0].status,'COMPLETED');assert.equal(planning.progress()[0].baselineReady,false);assert.equal(planning.progress()[1].status,'WAITING');assert.throws(()=>planning.prepareStart(plan.planId,plan.revision,'p2'),/PROJECT_TASK_NOT_READY/);
  rebuildProjectPlanningView(planning);let project=readFileSync(join(planning.projectRoot,'human','Project.md'),'utf8');assert.match(project,/ready to integrate into the project with your authorization/);
  await lease(f,async repo=>{const p=await repo.prepare('task'),{q,r}=await confirm(repo,p);repo.applyDecision(q,r)});
  assert.equal(planning.progress()[1].status,'READY');const seed=planning.prepareStart(plan.planId,plan.revision,'p2');assert.equal(seed.objective,'Usare il risultato del primo incremento');assert.equal('specHash' in seed,false);assert.equal(planning.links().length,1);
  rebuildHumanView(f.storeRoot);rebuildProjectPlanningView(planning);project=readFileSync(join(planning.projectRoot,'human','Project.md'),'utf8');assert.match(project,/present in the target branch history/);const current=readFileSync(join(planning.projectRoot,'human','Planning','Current Plan.md'),'utf8');assert.match(current,/\[Secondo\].* — not started/);clean(f);
});

test('Promotion — separate-process crash/reload recovers only the exact durable intent',async t=>{
  const f=await completedFixture(),base=head(f),worker=new URL('./candidate-promotion-worker.mjs',import.meta.url);
  const run=(mode,point)=>spawnSync(process.execPath,[worker.pathname,'promotion-'+mode,f.data,f.repo,...(point?[point]:[])],{encoding:'utf8',timeout:180000});
  await t.test('crash after prepared integration has no approval or target update',()=>{const r=run('approve','afterIntegrationPreparation');assert.equal(r.status,73,r.stdout+r.stderr);assert.equal(head(f),base);assert.equal(f.promotion.results().length,0)});
  await t.test('recovery before intent does not invent approval',()=>{const r=run('recover');assert.equal(r.status,0,r.stdout+r.stderr);assert.deepEqual(JSON.parse(r.stdout.trim()).results,[]);assert.equal(head(f),base)});
  await t.test('crash after confirmation but before intent needs a fresh approval',()=>{const r=run('approve','afterHumanApproval');assert.equal(r.status,73,r.stdout+r.stderr);assert.equal(head(f),base);const recovery=run('recover');assert.equal(recovery.status,0,recovery.stdout+recovery.stderr);assert.deepEqual(JSON.parse(recovery.stdout.trim()).results,[])});
  await t.test('durable intent is published before any target mutation',()=>{const r=run('approve','afterPromotionIntent');assert.equal(r.status,73,r.stdout+r.stderr);assert.equal(head(f),base)});
  await t.test('crash following ref CAS leaves an identifiable interrupted operation',()=>{const r=run('recover','afterRefUpdate');assert.equal(r.status,73,r.stdout+r.stderr);assert.notEqual(head(f),base);assert.equal(f.promotion.results().length,0);assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'base\n');assert.equal(f.promotion.status('task').baselineReady,false)});
  await t.test('recovery updates files to the already authorized merge',()=>{const expected=head(f),r=run('recover','afterWorktreeUpdate');assert.equal(r.status,73,r.stdout+r.stderr);assert.equal(head(f),expected);assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'after\n')});
  await t.test('crash before result persistence is reconciled without another merge',()=>{const expected=head(f),r=run('recover','beforePromotionResult');assert.equal(r.status,73,r.stdout+r.stderr);assert.equal(head(f),expected);assert.equal(f.promotion.results().length,0)});
  await t.test('third-process result publication and repeated recovery are idempotent',()=>{const expected=head(f),r=run('recover');assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(JSON.parse(r.stdout.trim()).results.length,1);assert.equal(head(f),expected);assert.equal(f.promotion.results().length,1);clean(f);const again=run('recover');assert.equal(again.status,0,again.stdout+again.stderr);assert.deepEqual(JSON.parse(again.stdout.trim()).results,[]);assert.equal(head(f),expected)});
});

test('Promotion — task A and B in separate processes cannot both mutate the same expected target',async()=>{
  const f=await completedFixture(),b=await completedFixture({root:f.root,existingRepo:true,taskId:'taskB'}),worker=new URL('./candidate-promotion-worker.mjs',import.meta.url),before=head(f);
  assert.notEqual(f.binding.candidateRef,b.binding.candidateRef);assert.equal(b.binding.baseCommit,before);
  let oldB;await lease(b,async service=>{oldB=await service.prepare('taskB')});
  const owner=spawn(process.execPath,[worker.pathname,'promotion-approve-hold',f.data,f.repo,'','task'],{stdio:['ignore','pipe','pipe']});
  try{await new Promise((resolve,reject)=>{owner.once('error',reject);owner.once('exit',code=>reject(Error('Promotion owner exited '+code)));owner.stdout.on('data',chunk=>{if(String(chunk).includes('LOCKED'))resolve()})});
    const second=spawnSync(process.execPath,[worker.pathname,'promotion-approve',f.data,f.repo,'','taskB'],{encoding:'utf8',timeout:30000});assert.equal(second.status,1,second.stdout+second.stderr);assert.match(second.stdout,/LOCK_OWNERSHIP_LOST|WORKSPACE_LOCK_UNAVAILABLE/);assert.equal(head(f),before);
  }finally{owner.kill('SIGKILL');await new Promise(resolve=>owner.once('exit',resolve))}
  const recovery=spawnSync(process.execPath,[worker.pathname,'promotion-recover',f.data,f.repo],{encoding:'utf8',timeout:180000});assert.equal(recovery.status,0,recovery.stdout+recovery.stderr);assert.equal(JSON.parse(recovery.stdout.trim()).results.length,1);assert.notEqual(head(f),before);clean(f);
  assert.throws(()=>b.promotion.git.apply(b.binding.targetRef,oldB.targetHead,oldB.integrationCommit,'stale-taskB'),/PROMOTION_TARGET_STALE/);
  const current=head(f),successor=spawnSync(process.execPath,[worker.pathname,'promotion-approve',f.data,f.repo,'','taskB'],{encoding:'utf8',timeout:180000});assert.equal(successor.status,0,successor.stdout+successor.stderr);const result=JSON.parse(successor.stdout.trim()).result;assert.equal(result.taskId,'taskB');assert.equal(result.previousHead,current);assert.equal(result.resultingHead,head(f));assert.equal(b.promotion.results().length,2);const currentProposal=b.promotion.status('taskB').proposal;assert.deepEqual(currentProposal.changedFiles,[]);assert.match(model.promotionNarrative(currentProposal),/No files change/);assert.equal(b.promotion.status('taskB').baselineReady,true);clean(f);
});

test('Promotion — recovery refuses dirty files, wrong branch, changed HEAD and modified merge object binding',async t=>{
  const f=await completedFixture(),worker=new URL('./candidate-promotion-worker.mjs',import.meta.url),before=head(f);
  const run=(mode,point)=>spawnSync(process.execPath,[worker.pathname,'promotion-'+mode,f.data,f.repo,...(point?[point]:[])],{encoding:'utf8',timeout:180000});
  assert.equal(run('approve','afterPromotionIntent').status,73);
  await t.test('wrong branch during recovery is preserved',()=>{git(f.repo,'checkout','-qb','other');const r=run('recover');assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stdout,/GIT_WRONG_TARGET_BRANCH/);assert.equal(git(f.repo,'branch','--show-current'),'other');git(f.repo,'checkout','-q','main')});
  await t.test('user edits after intent are preserved',()=>{writeFileSync(join(f.repo,'file.txt'),'personal edits');const r=run('recover');assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stdout,/GIT_TARGET_DIRTY/);assert.equal(readFileSync(join(f.repo,'file.txt'),'utf8'),'personal edits');assert.equal(head(f),before);writeFileSync(join(f.repo,'file.txt'),'base\n')});
  await t.test('changed target cannot be overwritten by an old intent',()=>{writeFileSync(join(f.repo,'new-target.txt'),'external change');git(f.repo,'add','.');git(f.repo,'commit','-qm','target advanced after intent');const advanced=head(f),r=run('recover');assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stdout,/PROMOTION_TARGET_STALE/);assert.equal(head(f),advanced);assert.equal(f.promotion.results().length,0);clean(f)});
  await t.test('modified integration commit in durable proposal fails integrity',()=>{const index=api.parseJson(f.promotion.store.read(f.promotion.store.readProjectIndex()),2e6),ref=index.proposals.at(-1),path=join(f.promotion.store.root,ref.relativeStorePath),original=readFileSync(path);const proposal=api.parseJson(original,2e6);chmodSync(path,0o600);writeFileSync(path,api.canonicalize({...proposal,integrationCommit:'0'.repeat(40)}));chmodSync(path,0o400);const at=head(f),r=run('recover');assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stdout,/STORE_ARTIFACT_INTEGRITY/);assert.equal(head(f),at);chmodSync(path,0o600);writeFileSync(path,original);chmodSync(path,0o400)});
});

test('Promotion — crash between frozen binding and candidate ref remains recoverable through the menu',async()=>{
  const f=await completedFixture({freeze:false}),before=head(f),worker=new URL('./candidate-promotion-worker.mjs',import.meta.url);
  const crashed=spawnSync(process.execPath,[worker.pathname,'promotion-freeze',f.data,f.repo,'afterCandidateBinding'],{encoding:'utf8',timeout:180000});assert.equal(crashed.status,73,crashed.stdout+crashed.stderr);
  const binding=f.promotion.binding('task');assert.notEqual(binding.candidateCommit,before);assert.equal(f.promotion.git.refHead(binding.candidateRef),before);assert.equal(f.promotion.status('task').status,'STALE');assert.equal(f.promotion.status('task').baselineReady,false);assert.equal(f.promotion.integrationChoices().length,1);
  await lease(f,async service=>{const p=await service.prepare('task');assert.equal(p.candidateCommit,binding.candidateCommit);assert.equal(service.git.refHead(binding.candidateRef),binding.candidateCommit);assert.equal(head(f),before);assert.equal(service.results().length,0)});clean(f);
});

test('Promotion — real rework keeps one stable task branch and freezes the cumulative final generation',()=>{
  const root=mkdtempSync(join(tmpdir(),'promotion-rework-')),worker=new URL('./candidate-promotion-worker.mjs',import.meta.url),run=mode=>spawnSync(process.execPath,[worker.pathname,'promotion-rework-'+mode,root],{encoding:'utf8',timeout:480000});
  const created=run('create');assert.equal(created.status,0,created.stdout+created.stderr);const f=JSON.parse(created.stdout.trim());assert.equal(f.state.state,'READY');assert.equal(f.state.candidate.generation,1);const inProgress=Promotion.open(f.data,f.repo,inspect);assert.equal(inProgress.status('task').status,'NOT_READY');assert.deepEqual(inProgress.integrationChoices(),[]);
  const resumed=run('resume');assert.equal(resumed.status,0,resumed.stdout+resumed.stderr);const final=JSON.parse(resumed.stdout.trim()).state;assert.equal(final.state,'COMPLETED');assert.equal(final.candidate.generation,f.state.candidate.generation+1);assert.equal(final.candidate.root,f.state.candidate.root);
  const p=Promotion.open(f.data,f.repo,inspect),binding=p.binding('task');assert.equal(binding.candidateRef,f.binding.candidateRef);assert.equal(binding.baseCommit,f.binding.baseCommit);assert.equal(binding.candidateGeneration,final.candidate.generation);assert.equal(binding.candidateDigest,final.candidate.digest);assert.equal(git(f.repo,'for-each-ref','--format=%(refname)','refs/heads/controlled-dev'),binding.candidateRef);assert.equal(git(f.repo,'rev-parse','HEAD'),binding.baseCommit);assert.equal(readFileSync(join(final.candidate.root,'file.txt'),'utf8'),'after rework\n');clean(f);
});
