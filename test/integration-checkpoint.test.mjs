import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {integratedFixture,integrate,Checkpoints,Promotion,inspect,channel,git,api,checkpointReviewer,presentTrustedConfirmation} from './integration-checkpoint-fixture.mjs';
const model=await import('../src/integration-checkpoint.ts');
const {STATES,TRANSITIONS}=await import('../src/state-machine.ts');
const resolver=name=>name==='node'?process.execPath:'/usr/bin/'+name;
test('Checkpoint — real P1/P2 promotions and exact integrated M2, rerun and dirty primary',async t=>{
  const f=await integratedFixture({planning:true});assert.notEqual(f.m1,f.m2);
  const d=f.checkpoints.propose(f.proposal,resolver);assert.equal(d.status,'DRAFT');
  await t.test('no global state or transition added',()=>{assert.equal(STATES.length,11);assert.equal(TRANSITIONS.length,43)});
  await t.test('draft cannot run',()=>assert.rejects(f.checkpoints.run(d.checkpointId,1),/CHECKPOINT_DEFINITION_NOT_APPROVED/));
  await t.test('coverage resolves two real authenticated PromotionResults',()=>{const coverage=f.checkpoints.coverage(d,f.checkpoints.baseline());assert.deepEqual(coverage.map(c=>c.taskId),['P1','P2']);assert.ok(coverage.every(c=>c.integrationRequired&&c.promotionResultRef))});
  await t.test('headless approval refused',()=>assert.rejects(f.checkpoints.approve({...channel(),mode:'print'},d.checkpointId,1),/HUMAN_CHANNEL_UNAVAILABLE/));
  await t.test('forged approval refused',()=>{const q=f.checkpoints.prepareApproval(d.checkpointId,1);assert.throws(()=>f.checkpoints.applyApproval(q,{}),/TRUSTED_CONFIRMATION_RECEIPT_INVALID/)});
  await f.checkpoints.approve(channel(),d.checkpointId,1);
  let first;
  await t.test('M2 PASS has exact coverage, scenarios, runtime events, technical evidence and review',async()=>{first=await f.checkpoints.run(d.checkpointId,1,undefined,checkpointReviewer());assert.equal(first.outcome,'PASS',first.reason);assert.equal(first.baseline.commit,f.m2);
    for(const media of ['scenario-run','runtime-evidence','technical-evidence-bundle'])assert.ok(first.evidenceRefs.some(r=>r.mediaType.includes(media)));assert.ok(first.reviewRef);assert.equal(git(f.repo,'rev-parse','HEAD'),f.m2);assert.equal(git(f.repo,'status','--porcelain'),'')});
  await t.test('same Definition and baseline reruns with distinct ID and immutable history',async()=>{const second=await f.checkpoints.run(d.checkpointId,1,undefined,checkpointReviewer());assert.equal(second.outcome,'PASS',second.reason);assert.notEqual(second.checkpointRunId,first.checkpointRunId);assert.equal(f.checkpoints.runs().length,2);assert.equal(f.checkpoints.status().status,'VERIFIED')});
  await t.test('checkpoint artifact writes proceed while promotion holds its source lease',async()=>{await Promotion.withLease(f.data,f.repo,inspect,async()=>{const run=await f.checkpoints.run(d.checkpointId,1,undefined,checkpointReviewer());assert.equal(run.outcome,'PASS',run.reason)});});
  await t.test('dirty primary remains byte-identical and is excluded',async()=>{writeFileSync(join(f.repo,'file.txt'),'personal edit\n');writeFileSync(join(f.repo,'personal.txt'),'private\n');git(f.repo,'add','file.txt');const before=readFileSync(join(f.repo,'file.txt'));const status=git(f.repo,'status','--porcelain');
    const run=await f.checkpoints.run(d.checkpointId,1,undefined,checkpointReviewer());assert.equal(run.outcome,'PASS',run.reason);assert.deepEqual(readFileSync(join(f.repo,'file.txt')),before);assert.equal(git(f.repo,'status','--porcelain'),status);assert.equal(git(f.repo,'rev-parse','HEAD'),f.m2)});
  await t.test('real Project Plan links integrated and covered tasks without changing the DAG',()=>{const before=api.canonicalize(f.planRepository.current());rebuildIntegrationCheckpointView(f.checkpoints);const project=readFileSync(join(f.checkpoints.projectRoot,'human','Project.md'),'utf8');assert.match(project,/P1, P2/);assert.equal(f.checkpoints.definitions()[0].plannedTaskRefs.length,2);assert.equal(api.canonicalize(f.planRepository.current()),before)});
  await t.test('reloaded store preserves terminal runs and cannot acquire receipt authority',()=>{const reopened=Checkpoints.open(f.data,f.repo,inspect);assert.equal(reopened.runs().length,4);assert.equal(reopened.status().status,'VERIFIED');assert.equal(reopened.recover(first.checkpointRunId).outcome,'PASS');
    const good=reopened.store.readProjectIndex(),index=reopened.read(good),current=reopened.runs().at(-1),find=r=>r.evidenceRefs.map(ref=>({ref,value:ref.mediaType===model.CHECKPOINT_MEDIA?reopened.read(ref):null})).find(e=>e.value?.kind==='checkpoint-validation'&&e.value.scenarioHash);
    const previous=find(first),latest=find(current),altered={...latest.value,result:previous.value.result,artifacts:previous.value.artifacts};
    const envelope=reopened.store.put('negative-cross-run-envelope',api.canonicalize(altered),model.CHECKPOINT_MEDIA),record={...current,evidenceRefs:current.evidenceRefs.map(ref=>ref.id===latest.ref.id?envelope:ref)};
    const runRef=reopened.store.put('negative-cross-run-record',api.canonicalize(record),model.CHECKPOINT_MEDIA),bad=reopened.store.put('negative-cross-run-index',api.canonicalize({...index,runs:index.runs.map((ref,n)=>n===index.runs.length-1?runRef:ref)}),model.CHECKPOINT_MEDIA);
    reopened.store.replaceProjectIndex(good,bad);try{assert.throws(()=>Checkpoints.open(f.data,f.repo,inspect),/CHECKPOINT_VALIDATION_BINDING/)}finally{reopened.store.replaceProjectIndex(bad,good)}
  });
  await t.test('new revision is DRAFT while prior APPROVED content stays immutable',()=>{const next=f.checkpoints.propose({...f.proposal,purpose:'Un intento revisionato e distinto'},resolver,d.checkpointId);assert.equal(next.revision,2);assert.equal(next.status,'DRAFT');assert.equal(f.checkpoints.definitions()[0].contentDigest,d.contentDigest);assert.equal(f.checkpoints.definitions()[0].status,'APPROVED')});
  await t.test('wrong tree and foreign task are rejected before authority',()=>{assert.throws(()=>f.checkpoints.coverage(d,{...f.checkpoints.baseline(),tree:'0'.repeat(40)}),/CHECKPOINT_BASELINE_INVALID/);assert.throws(()=>f.checkpoints.coverage({...d,controlledTaskRefs:['absent'],scenarios:[]},f.checkpoints.baseline()),/ENOENT|CHECKPOINT_TASK/)});
  await t.test('no free shell proposal gains command authority',()=>{for(const c of [{...d.commands[0],argv:['reset','--hard']},{...d.commands[0],executable:'/bin/sh'}]){const altered={...d,commands:[c,...d.commands.slice(1)]};altered.contentDigest=model.definitionDigest(altered);assert.throws(()=>model.validateDefinition(altered),/CHECKPOINT_COMMAND_INVALID/)}
    const plan=[{kind:'REVIEW',description:'Verificare l’interazione in review',paths:[],expectedLines:[]}],altered={...d,validationPlan:plan,commands:model.checkpointCommands(plan,resolver),scenarios:[],reviewRequired:false};altered.contentDigest=model.definitionDigest(altered);
    assert.throws(()=>model.validateDefinition(altered),/CHECKPOINT_VALIDATION_PLAN_INVALID/);
    const reviewed={...altered,reviewRequired:true};reviewed.contentDigest=model.definitionDigest(reviewed);assert.equal(model.validateDefinition(reviewed).reviewRequired,true);
  });
  await t.test('unaccounted primary change between scenarios and review cannot yield PASS',async()=>{
    const personal=join(f.repo,'personal.txt'),bytes=readFileSync(personal),service=Checkpoints.open(f.data,f.repo,inspect,{fault(point){if(point==='afterScenario')writeFileSync(personal,'unexpected external write\n')}});
    try{const run=await service.run(d.checkpointId,1,undefined,checkpointReviewer());assert.equal(run.outcome,'BLOCKED');assert.match(run.reason,/CHECKPOINT_PRIMARY_CHANGED/)}finally{writeFileSync(personal,bytes)}
  });

});
test('Checkpoint — COMPLETED P2 not integrated cannot claim M1 coverage',async()=>{const f=await integratedFixture({secondIntegrated:false}),d=f.checkpoints.propose(f.proposal,resolver);assert.throws(()=>f.checkpoints.prepareApproval(d.checkpointId,1),/CHECKPOINT_INPUT_NOT_IN_BASELINE/);assert.equal(f.checkpoints.runs().length,0);assert.equal(git(f.repo,'rev-parse','HEAD'),f.m1)});

const {spawn,spawnSync}=await import('node:child_process');
const {completedFixture}=await import('./candidate-promotion-fixture.mjs');
const {checkpointMemory}=await import('./integration-checkpoint-fixture.mjs');
const {Bus}=await import('./integration-review-rpc-fixture.mjs');
const {registerControlledReviewer,ControlledReviewerRunner}=await import('../src/controlled-reviewer.ts');
const {rebuildIntegrationCheckpointView}=await import('../src/human-repository.ts');
const worker=(f,...args)=>spawnSync(process.execPath,['test/integration-checkpoint-worker.mjs',`checkpoint-${args[0]}`,f.data,f.repo,...args.slice(1)],{encoding:'utf8'});
test('Checkpoint — real validation failure, immutable evidence, no rollback and exact approval revisions',async t=>{
  const f=await integratedFixture(),head=git(f.repo,'rev-parse','HEAD'),bad={...f.proposal,validationPlan:[{kind:'CONTENT',description:'Un’interazione richiesta ma assente',paths:['file.txt'],expectedLines:['missing interaction','']}],scenarios:[]};
  const d=f.checkpoints.propose(bad,resolver);await f.checkpoints.approve(channel(),d.checkpointId,1);
  await t.test('executed failed check gives FAIL with retained evidence and unchanged baseline',async()=>{const r=await f.checkpoints.run(d.checkpointId,1,undefined,checkpointReviewer());assert.equal(r.outcome,'FAIL',r.reason);assert.ok(r.evidenceRefs.length);assert.equal(git(f.repo,'rev-parse','HEAD'),head);assert.equal(git(f.repo,'status','--porcelain'),'');const runRef=f.checkpoints.store.readProjectIndex();assert.ok(runRef);assert.equal(f.checkpoints.status().status,'FAILED')});
  await t.test('human notes explain failure and are not authoritative',()=>{const files=rebuildIntegrationCheckpointView(f.checkpoints);assert.ok(files.includes('Project.md'));assert.ok(files.includes('Indexes/Integration Checkpoints.base'));
    const r=f.checkpoints.runs()[0],note=join(f.checkpoints.projectRoot,'human','Integration','Runs',r.checkpointRunId+'.md');assert.match(readFileSync(note,'utf8'),/A check failed/);writeFileSync(note,'PASS');assert.equal(f.checkpoints.runs()[0].outcome,'FAIL');rebuildIntegrationCheckpointView(f.checkpoints);assert.match(readFileSync(note,'utf8'),/FAIL/)});
  await t.test('revision and coverage change invalidates previously issued receipt',async()=>{const next=f.checkpoints.propose(f.proposal,resolver,d.checkpointId),q=f.checkpoints.prepareApproval(d.checkpointId,2),receipt=await presentTrustedConfirmation(channel(),q);
    f.checkpoints.propose({...f.proposal,controlledTaskRefs:['P1'],scenarios:[]},resolver,d.checkpointId);assert.throws(()=>f.checkpoints.applyApproval(q,receipt),/CHECKPOINT_APPROVAL_STALE/);assert.equal(f.checkpoints.definitions()[0].status,'APPROVED');assert.equal(next.status,'DRAFT')});
  await t.test('separate reload process preserves immutable FAIL and revision history',()=>{const p=worker(f,'reload');assert.equal(p.status,0,p.stderr+p.stdout);const state=JSON.parse(p.stdout);assert.equal(state.runs[0].outcome,'FAIL');assert.equal(state.definitions.length,3)});
});
test('Checkpoint — existing registered Reviewer, terminal proof, exact packet and fail-closed provider behavior',async t=>{
  const f=await integratedFixture(),memory=await checkpointMemory(f);f.checkpoints=Checkpoints.open(f.data,f.repo,inspect,{memory});const d=f.checkpoints.propose(f.proposal,resolver);await f.checkpoints.approve(channel(),d.checkpointId,1);
  const bus=new Bus(f.root),registration=registerControlledReviewer({events:bus},'checkpoint-rpc'),runner=new ControlledReviewerRunner(registration,bus,'owner');
  try{
    await t.test('production Reviewer API returns PASS bound to checkpoint packet and exact M2',async()=>{const r=await f.checkpoints.run(d.checkpointId,1,undefined,runner);assert.equal(r.outcome,'PASS',r.reason);assert.ok(r.reviewerDispatchRef);assert.ok(r.reviewerTerminalRef);assert.ok(r.reviewPacketRef);assert.equal(bus.packet.baseline.commit,f.m2);assert.equal(bus.packet.selectedTaskResults.length,2);assert.match(bus.task,/PACKAGE GUIDANCE/);assert.match(bus.task,/Checkpoint evidence review/);assert.equal(d.relevantMemoryRefs.length,4);const contexts=r.evidenceRefs.filter(ref=>ref.mediaType.includes('memory-context+json')).map(ref=>f.checkpoints.read(ref));assert.ok(contexts.every(c=>c.selected.length===4));assert.equal(new Set(contexts[0].selected.map(s=>s.record.recordKind)).size,4);const receipts=r.evidenceRefs.filter(ref=>ref.mediaType.includes('memory-context-receipt'));assert.ok(receipts.length);const currentIndex=memory.store.readProjectIndex();assert.ok(currentIndex);});
    await t.test('unavailable result gives BLOCKED, never false PASS',async()=>{const r=await f.checkpoints.run(d.checkpointId,1,undefined,{async reviewIntegration(){throw Error('provider unavailable')}});assert.equal(r.outcome,'BLOCKED');assert.match(r.reason,/cannot be verified/)});
    await t.test('uncertain terminality blocks duplicate Reviewer dispatch on rerun',async()=>{let calls=0;const unavailable={async reviewIntegration(_r,_w,_p,options){calls++;options.onDispatchIdentity({requestId:'unknown-request',ownerSessionId:'owner',agent:'controlled.reviewer',runId:'unknown-run'});throw Error('connection lost')}};
      const r=await f.checkpoints.run(d.checkpointId,1,undefined,unavailable);assert.equal(r.outcome,'BLOCKED');const again=await f.checkpoints.run(d.checkpointId,1,undefined,unavailable);assert.equal(again.outcome,'BLOCKED');assert.match(again.reason,/TERMINALITY_UNKNOWN/);assert.equal(calls,1)});
  }finally{runner.dispose();registration.dispose()}
});
test('Checkpoint — actual crash/restart, partial evidence stages and competing processes',async t=>{
  const f=await integratedFixture();
  for(const point of ['afterCreated','afterValidation','afterScenario','duringEvidencePersistence','beforeFinalOutcome'])await t.test(`crash ${point} remains incomplete until explicit BLOCKED recovery`,async()=>{
    const d=f.checkpoints.propose({...f.proposal,reviewRequired:false},resolver);await f.checkpoints.approve(channel(),d.checkpointId,1);
    const child=worker(f,'crash',d.checkpointId,'1',point);assert.equal(child.status,73,child.stdout+child.stderr);
    const incomplete=f.checkpoints.runs().at(-1);assert.equal(incomplete.outcome,null);assert.equal(incomplete.finishedAt,null);
    if(['afterValidation','afterScenario','beforeFinalOutcome'].includes(point))assert.ok(incomplete.evidenceRefs.length);const recovered=worker(f,'recover',incomplete.checkpointRunId);assert.equal(recovered.status,0,recovered.stdout+recovered.stderr);assert.equal(JSON.parse(recovered.stdout).outcome,'BLOCKED');
    assert.equal(f.checkpoints.runs().at(-1).outcome,'BLOCKED');assert.equal(git(f.repo,'rev-parse','HEAD'),f.m2);
    if(point==='duringEvidencePersistence'){const next=worker(f,'run',d.checkpointId,'1');assert.equal(next.status,0,next.stdout+next.stderr);assert.match(JSON.parse(next.stdout).reason,/COMMAND_TERMINALITY_UNKNOWN/);}
  });
  await t.test('crash after persisted terminal PASS preserves outcome and permits a distinct rerun',async()=>{
    const d=f.checkpoints.propose({...f.proposal,reviewRequired:false},resolver);await f.checkpoints.approve(channel(),d.checkpointId,1);
    const child=worker(f,'crash',d.checkpointId,'1','afterFinalOutcome');assert.equal(child.status,73,child.stdout+child.stderr);const finished=f.checkpoints.runs().at(-1);assert.equal(finished.outcome,'PASS');
    const recovered=worker(f,'recover',finished.checkpointRunId);assert.equal(recovered.status,0,recovered.stdout+recovered.stderr);assert.deepEqual(JSON.parse(recovered.stdout),finished);
    const next=worker(f,'run',d.checkpointId,'1');assert.equal(next.status,0,next.stdout+next.stderr);assert.equal(JSON.parse(next.stdout).outcome,'PASS');assert.notEqual(JSON.parse(next.stdout).checkpointRunId,finished.checkpointRunId);
  });
  await t.test('same definition/commit concurrent lease rejects second process without collision',async()=>{
    const d=f.checkpoints.propose({...f.proposal,reviewRequired:false},resolver);await f.checkpoints.approve(channel(),d.checkpointId,1);
    const child=spawn(process.execPath,['test/integration-checkpoint-worker.mjs','checkpoint-hold',f.data,f.repo,d.checkpointId,'1'],{stdio:['ignore','pipe','pipe']});let out='';
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('lock fixture timeout')),30000);child.stdout.on('data',b=>{out+=b;if(out.includes('LOCKED')){clearTimeout(timer);resolve()}});child.on('error',reject);child.on('exit',()=>{if(!out.includes('LOCKED'))reject(Error(out))})});
    try{const second=worker(f,'run',d.checkpointId,'1');assert.equal(second.status,1);assert.match(second.stdout,/TASK_LOCK_UNAVAILABLE/);assert.equal(f.checkpoints.runs().at(-1).outcome,null)}
    finally{child.kill('SIGKILL');await new Promise(r=>child.once('exit',r))}
    const recovery=worker(f,'recover',f.checkpoints.runs().at(-1).checkpointRunId);assert.equal(recovery.status,0,recovery.stdout+recovery.stderr);
  });
});
test('Checkpoint — real approved M3 during M2 read-only Reviewer keeps M2 PASS and current status STALE',async()=>{
  const f=await integratedFixture();const {IntegrationPrimaryCanary}=await import('../src/integration-primary-canary.ts');const primaryCanary=new IntegrationPrimaryCanary(f.data,f.repo,inspect);await completedFixture({root:f.root,existingRepo:true,taskId:'P3',developerContent:'exports.a = () => 2;\nexports.b = () => 3;\nexports.c = () => 4;\n'});
  const d=f.checkpoints.propose(f.proposal,resolver);await f.checkpoints.approve(channel(),d.checkpointId,1);let promoted=false;
  const service=f.checkpoints,bus=new Bus(f.root),registration=registerControlledReviewer({events:bus},'checkpoint-advancing-target'),runner=new ControlledReviewerRunner(registration,bus,'owner');
  bus.mutate=()=>{if(!promoted){const p=spawnSync(process.execPath,['test/candidate-promotion-worker.mjs','promotion-approve',f.data,f.repo,'none','P3'],{encoding:'utf8'});assert.equal(p.status,0,p.stdout+p.stderr);promoted=true}};
  let run;try{run=await service.run(d.checkpointId,1,service.baseline(),runner)}finally{runner.dispose();registration.dispose()}
  assert.equal(run.outcome,'PASS',run.reason);assert.equal(run.baseline.commit,f.m2);assert.notEqual(git(f.repo,'rev-parse','HEAD'),f.m2);assert.equal(service.status().status,'STALE');assert.equal(service.runs()[0].outcome,'PASS');
  rebuildIntegrationCheckpointView(service);assert.match(readFileSync(join(service.projectRoot,'human','Project.md'),'utf8'),/earlier project version/);
  assert.equal(primaryCanary.verify(),true);const path=join(f.repo,'file.txt'),original=readFileSync(path);
  git(f.repo,'update-index','--assume-unchanged','file.txt');writeFileSync(path,'unaccounted hidden bytes\n');
  try{assert.equal(git(f.repo,'status','--porcelain'),'');assert.equal(primaryCanary.verify(),false,'Git index flags cannot conceal primary byte changes after approved promotion')}finally{writeFileSync(path,original);git(f.repo,'update-index','--no-assume-unchanged','file.txt')}
  assert.equal(primaryCanary.verify(),true);
});


test('Checkpoint — scenario FAIL preserves real baseline and temporary output without automatic cleanup',async()=>{
  const f=await integratedFixture();
  writeFileSync(join(f.repo,'integration.cjs'),"const fs=require('node:fs'),assert=require('node:assert/strict'),m=require('./file.txt');assert.equal(m.a()+m.b(),5);const p='.checkpoint-counter',n=fs.existsSync(p)?Number(fs.readFileSync(p,'utf8')):0;fs.writeFileSync(p,String(n+1));if(n)process.exit(1);\n");
  git(f.repo,'add','integration.cjs');git(f.repo,'commit','-qm','fixture repeat-sensitive integration scenario');const head=git(f.repo,'rev-parse','HEAD');
  const d=f.checkpoints.propose({...f.proposal,validationPlan:f.proposal.validationPlan.slice(0,1)},resolver);await f.checkpoints.approve(channel(),d.checkpointId,1);
  const r=await f.checkpoints.run(d.checkpointId,1,undefined,checkpointReviewer());assert.equal(r.outcome,'FAIL',r.reason);
  const scenarios=r.evidenceRefs.filter(ref=>ref.mediaType.includes('scenario-run')).map(ref=>f.checkpoints.read(ref));assert.ok(scenarios.some(s=>s.result==='FAIL'));assert.equal(git(f.repo,'rev-parse','HEAD'),head);assert.equal(git(f.repo,'status','--porcelain'),'');
  assert.equal(readFileSync(join(f.checkpoints.worktree(r),'.checkpoint-counter'),'utf8'),'2');
});
