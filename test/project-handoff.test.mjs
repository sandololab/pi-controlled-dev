import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {appendFileSync,chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,symlinkSync,truncateSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installSourceLoader} from './load-source.mjs';
import {fixtures,TIME} from './contract-fixtures.mjs';
installSourceLoader();
const api=await import('../src/contracts.ts');
const {hashBytes}=api;
const {DurableStore}=await import('../src/store.ts');
const {CentralOrchestrator}=await import('../src/orchestrator.ts');
const {LockManager}=await import('../src/lock-manager.ts');
const {presentTrustedConfirmation}=await import('../src/trusted-confirmation.ts');
const h=await import('../src/project-handoff.ts');
const {humanVaultRoot,readProjectCustodian}=await import('../src/project-custodian.ts');
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}).trim();
function fixture(t,inspect=()=> 'ACCEPT',repoParent){
  const root=mkdtempSync(join(tmpdir(),'pi-handoff-')),external=repoParent?mkdtempSync(join(repoParent,'pi-handoff-mount-')):undefined,repo=join(external??root,'repo'),machine=join(root,'profile');let manager,workspaceLock;
  t.after(()=>{try{if(manager&&workspaceLock)manager.release(workspaceLock)}finally{rmSync(root,{recursive:true,force:true});if(external)rmSync(external,{recursive:true,force:true})}});
  mkdirSync(repo);mkdirSync(machine);git(repo,'init','-q','--initial-branch=main');git(repo,'config','user.name','Test');git(repo,'config','user.email','test@example.invalid');
  writeFileSync(join(repo,'signal.py'),'signal = 1\n');git(repo,'add','signal.py');git(repo,'commit','-qm','source');
  const store=DurableStore.project(machine,repo,'planning',inspect,true),id=hashBytes(Buffer.from(repo)),source=join(machine,'controlled-dev','projects',id);
  mkdirSync(join(source,'human','Notes'),{recursive:true});mkdirSync(join(source,'human','Tasks'));writeFileSync(join(source,'human','Notes','personali.md'),'appunti personali\n');
  writeFileSync(join(source,'human','Tasks','task.md'),'[Note](../Notes/personali.md)\n');writeFileSync(join(source,'human','custom.canvas'),'personal unknown file\n');
  store.put('plan','original plan bytes','text/plain');
  const control=join(machine,'controlled-dev','control',id);mkdirSync(control,{recursive:true});writeFileSync(join(control,'task.json'),'unchanged selector bytes');
  manager=new LockManager(machine,'handoff-test','handoff-generation');workspaceLock=manager.acquireWorkspace(repo);
  const options={store,manager,workspaceLock,assertQuiescent(){}};
  const prepare=()=>h.prepareProjectHandoff({repoRoot:repo,machineDataRoot:machine});
  async function authorize(proposal=prepare()){
    const request=h.projectHandoffRequest(proposal),receipt=await presentTrustedConfirmation({mode:'tui',sessionManager:{getSessionId:()=> 'native-test'},ui:{async confirm(){return true}}},request);
    return h.authorizeProjectHandoff(proposal,receipt,options);
  }
  return {root,repo,machine,id,source,control,store,manager,workspaceLock,options,prepare,authorize};
}
function initialTask(f){
  const store=DurableStore.create(f.machine,f.repo,'task',()=> 'ACCEPT'),v=fixtures(api),source=store.put('source','input','text/plain');
  const spec={...v.TaskSpec,scope:{...v.TaskSpec.scope,repoRoot:f.repo},plan:{...v.InputSource,snapshot:source},currentTask:{...v.InputSource,snapshot:source}};
  spec.specHash=api.hashContract('TaskSpec',spec);
  const task=f.manager.acquireTask('task',f.repo);
  try{CentralOrchestrator.initialize(spec,{ownerSessionId:f.manager.ownerSessionId,lockManager:f.manager,locks:{workspace:f.workspaceLock,task},runners:{scout:async()=>{throw new Error('No provider dispatch in storage fixture')}},store,artifacts:[source],now:()=>TIME})}finally{f.manager.release(task)}return store;
}
test('candidate history budgets scale by task while an individual task still stops at the byte ceiling',async t=>{
  const f=fixture(t);h.completeProjectHandoff(await f.authorize());
  const root=join(f.repo,'.controlled-dev','candidates');mkdirSync(root,{recursive:true});
  const add=(task,start,end)=>{const folder=join(root,task);mkdirSync(folder,{recursive:true});for(let i=start;i<end;i++){const path=join(folder,`object-${i}`);writeFileSync(path,'');truncateSync(path,60*1024*1024)}};
  add('first-task',0,9);add('second-task',0,9);
  const inventory=h.projectHandoffNamespaceManifest(f.repo),objects=inventory.filter(f=>f.path.startsWith('.controlled-dev/candidates/'));
  assert.equal(objects.length,18);assert.ok(objects.reduce((n,f)=>n+f.bytes,0)>1024*1024*1024);
  assert.ok(objects.every(f=>/^[a-f0-9]{64}$/.test(f.digest)),'Every retained file is still hashed');
  add('first-task',9,18);assert.throws(()=>h.projectHandoffNamespaceManifest(f.repo),/PROJECT_HANDOFF_LIMIT/);
});
for(const changed of ['state','events','spec','artifact','mode','task-name','Git-head'])test(`exact acquired namespace refuses changed ${changed} before confirmation`,t=>{
  const f=fixture(t),store=initialTask(f),proposal=f.prepare();assert.equal(proposal.taskCount,1);
  if(changed==='state')appendFileSync(join(store.root,'state.json'),' ');
  if(changed==='events')appendFileSync(join(store.root,'events.jsonl'),' ');
  if(changed==='spec'){chmodSync(join(store.root,'spec.json'),0o600);appendFileSync(join(store.root,'spec.json'),' ')}
  if(changed==='artifact'){chmodSync(join(store.root,'artifacts','source'),0o600);writeFileSync(join(store.root,'artifacts','source'),'changed')}
  if(changed==='mode')chmodSync(join(store.root,'state.json'),0o400);
  if(changed==='task-name')renameSync(store.root,join(f.source,'tasks','renamed-task'));
  if(changed==='Git-head')git(f.repo,'commit','--allow-empty','-qm','new source commit');
  assert.throws(()=>h.projectHandoffRequest(proposal),/SOURCE_CHANGED/);assert.equal(existsSync(join(f.repo,'.controlled-dev')),false);
});
test('candidate path discovery tolerates a first checkpoint and refuses a corrupt existing pointer',async t=>{
  const f=fixture(t);h.completeProjectHandoff(await f.authorize());const pointer=join(f.repo,'.controlled-dev','handoff.json'),raw=readFileSync(pointer);
  assert.deepEqual(h.currentProjectHandoffCandidatePaths(f.repo),[]);rmSync(pointer);assert.deepEqual(h.currentProjectHandoffCandidatePaths(f.repo),[]);
  writeFileSync(pointer,'{"schemaVersion":1,"descriptorDigest":"broken"}');assert.throws(()=>h.currentProjectHandoffCandidatePaths(f.repo),/SEAL_CORRUPT/);
  writeFileSync(pointer,raw);writeFileSync(join(f.repo,'Documentazione','Notes','personali.md'),'changed after checkpoint');
  assert.throws(()=>h.readProjectHandoff(f.repo),/CHECKPOINT_STALE/);assert.deepEqual(h.currentProjectHandoffCandidatePaths(f.repo),[]);
});
test('native relocation keeps a single human collection and unchanged authoritative bytes',async t=>{
  const f=fixture(t),before=git(f.repo,'rev-parse','HEAD'),cap=await f.authorize();
  const record=h.completeProjectHandoff(cap);assert.equal(record.kind,'ADOPTION');
  assert.equal(existsSync(f.source),false);assert.equal(existsSync(f.control),false);
  const local=join(f.repo,'.controlled-dev','state','controlled-dev','projects',f.id);
  assert.equal(readFileSync(join(local,'planning','artifacts','plan'),'utf8'),'original plan bytes');
  assert.equal(existsSync(join(local,'human')),false);assert.equal(humanVaultRoot(local,f.repo),join(f.repo,'Documentazione'));
  assert.equal(readFileSync(join(f.repo,'Documentazione','Notes','personali.md'),'utf8'),'appunti personali\n');
  assert.equal(readFileSync(join(f.repo,'Documentazione','custom.canvas'),'utf8'),'personal unknown file\n');
  assert.equal(readFileSync(join(f.repo,'.controlled-dev','control',f.id,'task.json'),'utf8'),'unchanged selector bytes');
  assert.equal(git(f.repo,'rev-parse','HEAD'),before);assert.equal(git(f.repo,'status','--porcelain'),'');
  assert.equal(h.readProjectHandoff(f.repo).descriptorDigest.length,64);
  assert.throws(()=>h.completeProjectHandoff(cap),/AUTHORITY_INVALID/);
});
test('whole project move is readable with a new empty Pi profile',async t=>{
  const f=fixture(t);h.completeProjectHandoff(await f.authorize());f.manager.release(f.workspaceLock);
  const moved=join(f.root,'new machine project');renameSync(f.repo,moved);mkdirSync(join(f.root,'new empty profile'));
  assert.equal(readProjectCustodian(moved).projectId,f.id);assert.equal(h.readProjectHandoff(moved).projectId,f.id);
  assert.equal(readFileSync(join(moved,'Documentazione','Notes','personali.md'),'utf8'),'appunti personali\n');
});
test('production adoption uses native cancellation and then moves the sole collection',async t=>{
  const f=fixture(t);f.manager.release(f.workspaceLock);
  const {ProjectPlanningRepository}=await import('../src/project-planning-repository.ts');
  ProjectPlanningRepository.open(f.machine,f.repo,()=> 'ACCEPT',{create:true});
  const {adoptProductionProject}=await import('../src/production-bridge.ts');
  const old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.machine;
  t.after(()=>old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old);
  const ctx={mode:'tui',cwd:f.repo,sessionManager:{getSessionId:()=> 'native-adoption-test'},ui:{notify(){},async confirm(){return false}}};
  assert.equal(await adoptProductionProject(ctx),false);
  assert.equal(existsSync(join(f.repo,'.controlled-dev')),false);assert.equal(existsSync(f.source),true);
  ctx.ui.confirm=async()=>true;
  assert.equal(await adoptProductionProject(ctx),true);
  assert.equal(existsSync(f.source),false);
  assert.equal(readFileSync(join(f.repo,'Documentazione','Notes','personali.md'),'utf8'),'appunti personali\n');
  assert.equal(h.readProjectHandoff(f.repo).kind,'ADOPTION');
});
test('JSON copies of proposal and capability cannot acquire authority',async t=>{
  const f=fixture(t),proposal=f.prepare();assert.throws(()=>h.projectHandoffRequest({...proposal}),/UNACQUIRED/);
  const cap=await f.authorize(proposal);assert.throws(()=>h.completeProjectHandoff({...cap}),/AUTHORITY_INVALID/);
  assert.equal(existsSync(join(f.repo,'.controlled-dev')),false);
});
test('receipt persistence cannot silently rebaseline a concurrent personal edit',async t=>{
  let armed=false,f;f=fixture(t,()=>{if(armed){armed=false;writeFileSync(join(f.source,'human','Notes','personali.md'),'operator edit while saving receipt')}return 'ACCEPT'});
  const proposal=f.prepare(),request=h.projectHandoffRequest(proposal),receipt=await presentTrustedConfirmation({mode:'tui',sessionManager:{getSessionId:()=> 'native-receipt-race'},ui:{async confirm(){return true}}},request);
  armed=true;assert.throws(()=>h.authorizeProjectHandoff(proposal,receipt,f.options),/SOURCE_CHANGED/);
  assert.equal(readFileSync(join(f.source,'human','Notes','personali.md'),'utf8'),'operator edit while saving receipt');
  assert.equal(existsSync(join(f.repo,'.controlled-dev')),false);
});
test('a recovery receipt in the selected local archive cannot rebaseline other artifact bytes',async t=>{
  const f=fixture(t),cap=await f.authorize();
  assert.throws(()=>h.completeProjectHandoff(cap,{fault(point){if(point==='beforeCleanup'){rmSync(f.source,{recursive:true});rmSync(f.control,{recursive:true});throw new Error('restart after old archive cleanup')}}}),/restart after old archive cleanup/);
  const proposal=h.prepareProjectHandoffRecovery({repoRoot:f.repo,machineDataRoot:f.machine});assert.equal(proposal.recovery,'CLEANUP');
  const path=join(f.repo,'.controlled-dev','state','controlled-dev','projects',f.id,'planning','artifacts','plan');let armed=false;
  const store=h.openHandoffReceiptStore(proposal,()=>{if(armed){armed=false;chmodSync(path,0o600);writeFileSync(path,'concurrent local artifact edit')}return 'ACCEPT'});
  const receipt=await presentTrustedConfirmation({mode:'tui',sessionManager:{getSessionId:()=> 'native-local-receipt-race'},ui:{async confirm(){return true}}},h.projectHandoffRequest(proposal));
  armed=true;assert.throws(()=>h.authorizeProjectHandoff(proposal,receipt,{...f.options,store}),/SOURCE_CHANGED|RECOVERY_CHANGED/);
  assert.equal(readFileSync(path,'utf8'),'concurrent local artifact edit');assert.equal(existsSync(join(f.repo,'Documentazione','Notes','personali.md')),true);
});
test('recovery after old archive cleanup preserves the new receipt in the sole selected archive',async t=>{
  const f=fixture(t),cap=await f.authorize();
  assert.throws(()=>h.completeProjectHandoff(cap,{fault(point){if(point==='beforeCleanup'){rmSync(f.source,{recursive:true});rmSync(f.control,{recursive:true});throw new Error('cleanup restart')}}}),/cleanup restart/);
  const proposal=h.prepareProjectHandoffRecovery({repoRoot:f.repo,machineDataRoot:f.machine}),store=h.openHandoffReceiptStore(proposal,()=> 'ACCEPT');
  const receipt=await presentTrustedConfirmation({mode:'tui',sessionManager:{getSessionId:()=> 'native-local-cleanup'},ui:{async confirm(){return true}}},h.projectHandoffRequest(proposal));
  const recovered=h.recoverProjectHandoff(h.authorizeProjectHandoff(proposal,receipt,{...f.options,store}));assert.equal(recovered.action,'COMPLETED');
  assert.equal(existsSync(join(store.root,'artifacts',`confirmation-${receipt.confirmationInstance.id}`)),true);
  assert.equal(readFileSync(join(f.repo,'Documentazione','Notes','personali.md'),'utf8'),'appunti personali\n');assert.equal(existsSync(f.source),false);
});
test('lost lease or unresolved host run prevents relocation',async t=>{
  const f=fixture(t),cap=await f.authorize();f.manager.release(f.workspaceLock);
  assert.throws(()=>h.completeProjectHandoff(cap),/LEASE_LOST/);assert.equal(existsSync(f.source),true);
});
test('operator Notes changes during copying preserve the original and prevent publication',async t=>{
  const f=fixture(t),cap=await f.authorize();
  assert.throws(()=>h.completeProjectHandoff(cap,{fault(point){if(point==='afterCopy')writeFileSync(join(f.source,'human','Notes','personali.md'),'operator update')}}),/SOURCE_CHANGED/);
  assert.equal(readFileSync(join(f.source,'human','Notes','personali.md'),'utf8'),'operator update');
  assert.equal(existsSync(join(f.repo,'.controlled-dev','project.json')),false);
});
test('foreign destination and source aliases are refused before native changes',t=>{
  const f=fixture(t);mkdirSync(join(f.repo,'Documentazione'));writeFileSync(join(f.repo,'Documentazione','foreign.md'),'keep');
  assert.throws(()=>f.prepare(),/SOURCE_DIRTY|DESTINATION_EXISTS/);assert.equal(readFileSync(join(f.repo,'Documentazione','foreign.md'),'utf8'),'keep');
  rmSync(join(f.repo,'Documentazione'),{recursive:true});symlinkSync(join(f.repo,'signal.py'),join(f.source,'human','alias.md'));
  assert.throws(()=>f.prepare(),/FILE_INVALID/);
});
test('checkpoint refresh binds current Notes bytes and distinguishes released transfer',async t=>{
  const f=fixture(t);h.completeProjectHandoff(await f.authorize());
  writeFileSync(join(f.repo,'Documentazione','Notes','personali.md'),'new notes');assert.throws(()=>h.readProjectHandoff(f.repo),/CHECKPOINT_STALE/);
  let retired=false;const record=h.releaseProjectHandoff({repoRoot:f.repo,manager:f.manager,workspaceLock:f.workspaceLock,assertQuiescent(){},retireAuthority(){retired=true}});
  assert.equal(retired,true);assert.equal(f.manager.verifyWorkspaceLock(f.workspaceLock),false);
  assert.equal(record.kind,'CHECKPOINT');assert.equal(h.readProjectHandoff(f.repo).ownerDisposition,'RELEASED_FOR_TRANSFER');
});
test('runtime import reports personal document changes while authoritative state and selectors remain exact',async t=>{
  const f=fixture(t);h.completeProjectHandoff(await f.authorize());
  h.releaseProjectHandoff({repoRoot:f.repo,manager:f.manager,workspaceLock:f.workspaceLock,assertQuiescent(){},retireAuthority(){}});
  const human=join(f.repo,'Documentazione');writeFileSync(join(human,'Notes','personali.md'),'updated personal note');writeFileSync(join(human,'Notes','nuovi.md'),'new personal note');rmSync(join(human,'Tasks','task.md'));
  assert.throws(()=>h.readProjectHandoff(f.repo),/CHECKPOINT_STALE/);
  const read=h.readProjectHandoffForRuntimeImport(f.repo);assert.equal(read.record.ownerDisposition,'RELEASED_FOR_TRANSFER');
  assert.deepEqual(read.humanChanges,[{path:'Documentazione/Notes/nuovi.md',status:'ADDED'},{path:'Documentazione/Notes/personali.md',status:'CHANGED'},{path:'Documentazione/Tasks/task.md',status:'REMOVED'}]);
  assert.match(read.humanDigest,/^[a-f0-9]{64}$/);writeFileSync(join(human,'Notes','personali.md'),'another version of the same changed personal note');
  const next=h.readProjectHandoffForRuntimeImport(f.repo);assert.deepEqual(next.humanChanges,read.humanChanges);assert.notEqual(next.humanDigest,read.humanDigest);
  const selector=join(f.repo,'.controlled-dev','control',f.id,'task.json'),previous=readFileSync(selector);writeFileSync(selector,'changed selector');assert.throws(()=>h.readProjectHandoffForRuntimeImport(f.repo),/CHECKPOINT_STALE/);writeFileSync(selector,previous);
  const artifact=join(f.repo,'.controlled-dev','state','controlled-dev','projects',f.id,'planning','artifacts','plan');chmodSync(artifact,0o600);writeFileSync(artifact,'changed authority artifact');assert.throws(()=>h.readProjectHandoffForRuntimeImport(f.repo),/CHECKPOINT_STALE/);
  assert.equal(readFileSync(join(human,'Notes','personali.md'),'utf8'),'another version of the same changed personal note');
});
test('runtime import refuses aliased personal documents instead of following them',async t=>{
  const f=fixture(t);h.completeProjectHandoff(await f.authorize());symlinkSync(join(f.repo,'signal.py'),join(f.repo,'Documentazione','Notes','alias.md'));
  assert.throws(()=>h.readProjectHandoffForRuntimeImport(f.repo),/FILE_INVALID/);
});
test('profile and fixed-permission SSD use exact bytes with proved destination modes',{skip:!process.env.CONTROLLED_DEV_TEST_SSD},async t=>{
  const f=fixture(t,()=> 'ACCEPT',process.env.CONTROLLED_DEV_TEST_SSD),cap=await f.authorize();h.completeProjectHandoff(cap);
  const marker=h.readProjectHandoff(f.repo);assert.equal(marker.projectId,f.id);assert.equal(existsSync(f.source),false);
  assert.equal(readFileSync(join(f.repo,'Documentazione','Notes','personali.md'),'utf8'),'appunti personali\n');
  const journal=JSON.parse(readFileSync(join(f.repo,'.controlled-dev','migration.json'),'utf8'));
  assert.ok(['EXACT','FIXED'].includes(journal.fileModePolicy.kind));assert.equal(git(f.repo,'status','--porcelain'),'');
});
test('fixed-permission SSD interruption supports native rollback without losing Notes',{skip:!process.env.CONTROLLED_DEV_TEST_SSD},async t=>{
  const f=fixture(t,()=> 'ACCEPT',process.env.CONTROLLED_DEV_TEST_SSD),cap=await f.authorize();
  assert.throws(()=>h.completeProjectHandoff(cap,{fault(p){if(p==='afterPlacement')throw new Error('SSD interruption')}}),/SSD interruption/);
  const proposal=h.prepareProjectHandoffRecovery({repoRoot:f.repo,machineDataRoot:f.machine});
  const store=h.openHandoffReceiptStore(proposal,()=> 'ACCEPT');assert.equal(store.root,f.store.root);
  const result=h.recoverProjectHandoff(await f.authorize(proposal));assert.equal(result.action,'ROLLED_BACK');
  assert.equal(readFileSync(join(f.source,'human','Notes','personali.md'),'utf8'),'appunti personali\n');
  h.completeProjectHandoff(await f.authorize());assert.equal(h.readProjectHandoff(f.repo).projectId,f.id);
});
test('a caller-supplied disposition never substitutes for a real released lease',async t=>{
  const f=fixture(t);h.completeProjectHandoff(await f.authorize());
  const record=h.sealProjectHandoff({repoRoot:f.repo,manager:f.manager,workspaceLock:f.workspaceLock,assertQuiescent(){},ownerDisposition:'RELEASED_FOR_TRANSFER'});
  assert.equal(record.ownerDisposition,'LEASE_HELD_CHECKPOINT');assert.equal(record.ownerRelease,null);assert.equal(f.manager.verifyWorkspaceLock(f.workspaceLock),true);
  assert.throws(()=>h.releaseProjectHandoff({repoRoot:f.repo,manager:f.manager,workspaceLock:f.workspaceLock,assertQuiescent(){},retireAuthority(){throw new Error('authority still active')}}),/authority still active/);
  assert.equal(h.readProjectHandoff(f.repo).ownerDisposition,'LEASE_HELD_CHECKPOINT');
});
for(const point of ['afterCopy','afterPlacement','afterPublish'])test(`a new native confirmation recovers ${point} interruption with one collection`,async t=>{
  const f=fixture(t),first=await f.authorize();
  assert.throws(()=>h.completeProjectHandoff(first,{fault(p){if(p===point)throw new Error('simulated restart')}}),/simulated restart/);
  const proposal=h.prepareProjectHandoffRecovery({repoRoot:f.repo,machineDataRoot:f.machine});
  assert.equal(proposal.recovery,point==='afterPublish'?'CLEANUP':'ROLLBACK');
  const cap=await f.authorize(proposal),result=h.recoverProjectHandoff(cap);
  if(point!=='afterPublish'){
    assert.equal(result.action,'ROLLED_BACK');assert.equal(existsSync(join(f.repo,'Documentazione')),false);assert.equal(existsSync(f.source),true);
    h.completeProjectHandoff(await f.authorize());
  }else assert.equal(result.action,'COMPLETED');
  assert.equal(existsSync(f.source),false);assert.equal(readFileSync(join(f.repo,'Documentazione','Notes','personali.md'),'utf8'),'appunti personali\n');
  assert.equal(h.readProjectHandoff(f.repo).projectId,f.id);assert.equal(git(f.repo,'status','--porcelain'),'');
});
test('an interrupted first file copy rolls back only verified partial copies',async t=>{
  const f=fixture(t,raw=>{if(Buffer.from(raw).toString().includes('personal unknown file'))throw new Error('first-copy interruption');return 'ACCEPT'});
  const cap=await f.authorize();assert.throws(()=>h.completeProjectHandoff(cap),/first-copy interruption/);
  const proposal=h.prepareProjectHandoffRecovery({repoRoot:f.repo,machineDataRoot:f.machine});
  const result=h.recoverProjectHandoff(await f.authorize(proposal));assert.equal(result.action,'ROLLED_BACK');
  assert.equal(readFileSync(join(f.source,'human','custom.canvas'),'utf8'),'personal unknown file\n');
  assert.equal(existsSync(join(f.repo,'.controlled-dev')),false);
});
test('recovery refuses personal edits in either original or published collection',async t=>{
  const f=fixture(t),cap=await f.authorize();assert.throws(()=>h.completeProjectHandoff(cap,{fault(p){if(p==='afterPublish')throw new Error('restart')}}),/restart/);
  writeFileSync(join(f.source,'human','Notes','personali.md'),'operator edit');
  assert.throws(()=>h.prepareProjectHandoffRecovery({repoRoot:f.repo,machineDataRoot:f.machine}),/RECOVERY_CONFLICT/);
  assert.equal(readFileSync(join(f.source,'human','Notes','personali.md'),'utf8'),'operator edit');
  assert.equal(existsSync(join(f.repo,'Documentazione','Notes','personali.md')),true);
});
