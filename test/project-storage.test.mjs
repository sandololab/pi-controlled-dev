import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,renameSync,symlinkSync,chmodSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {resolveProjectStorage,projectCustodianRoot,ensureProjectStorageData}=await import('../src/project-storage.ts');
const {initializeProjectCustodian}=await import('../src/project-custodian.ts');
const {DurableStore}=await import('../src/store.ts');
const {inventoryHash,inventoryTree}=await import('../src/controlled-agent-runtime.ts');
const {hashBytes}=await import('../src/contracts.ts');
const {ProjectPlanningRepository}=await import('../src/project-planning-repository.ts');
const {ScopeGuard}=await import('../src/scope-guard.ts');
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
function fixture(t,{adopt=true,ignore=true}={}){
 const root=mkdtempSync(join(tmpdir(),'project-storage-')),repo=join(root,'repo'),data=join(root,'machine');mkdirSync(repo);mkdirSync(data);t.after(()=>rmSync(root,{recursive:true,force:true}));
 git(repo,'init','-q');git(repo,'config','user.name','Test');git(repo,'config','user.email','test@example.invalid');writeFileSync(join(repo,'signal.py'),'signal = 1\n');git(repo,'add','.');git(repo,'commit','-qm','baseline');
 const marker={schemaVersion:1,projectId:hashBytes(Buffer.from(repo)),originalRepoRoot:repo,baselineCommit:git(repo,'rev-parse','HEAD'),baselineTree:git(repo,'rev-parse','HEAD^{tree}')};
 if(ignore)writeFileSync(join(repo,'.git','info','exclude'),'.controlled-dev/\nDocumentazione/\n');
 if(adopt){mkdirSync(join(repo,'.controlled-dev'));initializeProjectCustodian(repo,marker,()=>{});}
 return {root,repo,data,marker};
}
test('project storage defaults to the legacy external namespace until explicit adoption',t=>{
 const f=fixture(t,{adopt:false}),context=resolveProjectStorage(f.data,f.repo);
 assert.equal(context.projectRoot,join(f.data,'controlled-dev','projects',f.marker.projectId));assert.equal(context.stateDataRoot,f.data);
 assert.throws(()=>DurableStore.create(f.repo,f.repo,'task',()=> 'ACCEPT'),/STORE_ROOT_INVALID/);
 assert.equal(existsSync(join(f.repo,'.controlled-dev')),false);
});
test('only the acquired protected namespace admits source-local state; locks stay on the machine',t=>{
 const f=fixture(t),context=resolveProjectStorage(f.data,f.repo),store=DurableStore.project(f.data,f.repo,'planning',()=> 'ACCEPT',true);
 assert.equal(store.agentDataRoot,f.data);assert.equal(store.root,join(context.projectRoot,'planning'));assert.ok(store.root.startsWith(f.repo+'/.controlled-dev/'));
 assert.equal(context.controlRoot,join(f.repo,'.controlled-dev','control',f.marker.projectId));assert.equal(context.humanRoot,join(f.repo,'Documentazione'));
 assert.throws(()=>ensureProjectStorageData({...context,stateDataRoot:join(f.repo,'untrusted')},true),/CONTEXT_INVALID/);
 assert.throws(()=>DurableStore.project(f.data,f.repo,'credentials',()=> 'ACCEPT',true),/STORE_INPUT_INVALID/);
});
test('a whole folder move with a fresh machine profile reconstructs the approved plan and its artifact bytes',async t=>{
 const f=fixture(t),planning=ProjectPlanningRepository.open(f.data,f.repo,()=> 'ACCEPT',{create:true}),goal=planning.createGoal('Verificare il processing numerico');
 const proposal={strategy:'Caratterizzare prima il comportamento esistente.',plannedTasks:[{plannedTaskId:'characterize',title:'Caratterizzare i validatori',objective:'Verificare gli ingressi del modulo',rationale:'Stabilire un contratto osservabile.',scopeIntent:['signal.py'],acceptanceIntent:['Gli ingressi validi sono conservati.'],validationIntent:['Fixture sintetiche.'],dependsOn:[],dependencyRationale:[],relevantMemoryRefs:[]}]};
 const plan=planning.propose(goal.goalId,{proposal,analysis:{goalDigest:goal.contentDigest,proposal}},planning.baseline());
 await planning.approve({mode:'tui',sessionManager:{getSessionId:()=> 'old-human'},ui:{confirm:async()=>true}},plan.revision);
 const index=planning.store.readProjectIndex(),bytes=readFileSync(join(planning.store.root,index.relativeStorePath)),moved=join(f.root,'new machine project'),newData=join(f.root,'fresh-machine');mkdirSync(newData);renameSync(f.repo,moved);rmSync(f.data,{recursive:true});
 const reopened=ProjectPlanningRepository.open(newData,moved,()=> 'ACCEPT');assert.equal(reopened.projectId,f.marker.projectId);assert.equal(reopened.current().contentDigest,plan.contentDigest);
 assert.deepEqual(reopened.progress().map(view=>view.status),['READY']);assert.deepEqual(readFileSync(join(reopened.store.root,index.relativeStorePath)),bytes);
 assert.equal(existsSync(join(newData,'controlled-dev','projects')),false,'No old profile is needed or reconstructed');
});
test('host state writes preserve the source canary, while marker identity and source changes remain visible',t=>{
 const f=fixture(t),before=inventoryHash(inventoryTree(f.repo,['.git'])),store=DurableStore.project(f.data,f.repo,'memory',()=> 'ACCEPT',true);
 store.put('note','A host-owned project record');assert.equal(inventoryHash(inventoryTree(f.repo,['.git'])),before);
 writeFileSync(join(f.repo,'signal.py'),'signal = 2\n');assert.notEqual(inventoryHash(inventoryTree(f.repo,['.git'])),before);writeFileSync(join(f.repo,'signal.py'),'signal = 1\n');
 chmodSync(join(f.repo,'.controlled-dev','project.json'),0o400);assert.notEqual(inventoryHash(inventoryTree(f.repo,['.git'])),before);
});
test('the sole derived human folder is protected only after custody and never hides tracked source documentation',t=>{
 const f=fixture(t);mkdirSync(join(f.repo,'Documentazione'));writeFileSync(join(f.repo,'Documentazione','Piano.md'),'Prima versione');
 const before=inventoryHash(inventoryTree(f.repo,['.git']));writeFileSync(join(f.repo,'Documentazione','Piano.md'),'Aggiornamento host');
 assert.equal(inventoryHash(inventoryTree(f.repo,['.git'])),before);chmodSync(join(f.repo,'Documentazione'),0o750);assert.notEqual(inventoryHash(inventoryTree(f.repo,['.git'])),before);
 git(f.repo,'add','--force','Documentazione/Piano.md');const tracked=inventoryHash(inventoryTree(f.repo,['.git']));writeFileSync(join(f.repo,'Documentazione','Piano.md'),'Tracked source changed');assert.notEqual(inventoryHash(inventoryTree(f.repo,['.git'])),tracked);
});
test('unproved, tracked or aliased source namespaces never receive the exclusion',t=>{
 const f=fixture(t,{ignore:false});assert.throws(()=>projectCustodianRoot(f.repo),/NAMESPACE_UNPROTECTED/);assert.throws(()=>inventoryTree(f.repo),/NAMESPACE_UNPROTECTED/);
 writeFileSync(join(f.repo,'.git','info','exclude'),'.controlled-dev/\n');assert.ok(projectCustodianRoot(f.repo));git(f.repo,'add','--force','.controlled-dev/project.json');assert.throws(()=>projectCustodianRoot(f.repo),/NAMESPACE_UNPROTECTED/);
 git(f.repo,'reset','--quiet');const folder=join(f.repo,'.controlled-dev');renameSync(folder,join(f.root,'foreign'));symlinkSync(join(f.root,'foreign'),folder);assert.throws(()=>resolveProjectStorage(f.data,f.repo),/MARKER_INVALID/);
});
test('candidate scope cannot grant write authority over host state even through a nested name',t=>{
 const f=fixture(t),work=join(f.root,'work');git(f.repo,'worktree','add','--quiet','--detach',work,f.marker.baselineCommit);
 for(const path of ['.controlled-dev/state.json','src/.controlled-dev/data','.CONTROLLED-DEV/state.json','Documentazione/Piano.md'])assert.throws(()=>ScopeGuard.open({schemaVersion:1,repoRoot:f.repo,baseRef:'HEAD',allowedPaths:[path],deniedPaths:[],strongConfinementRequired:false},work,f.marker.baselineCommit),/SCOPE_PATH_INVALID/);
});

test('assistant mutation calls cannot hide custody writes in the source exclusion or through aliases; tool-result data is not a call',async t=>{
 const f=fixture(t),{verifyTranscript}=await import('../src/controlled-agent-runtime.ts'),session=join(f.root,'transcript.jsonl');
 const tools=['read','write','edit','structured_output'];
 const run=(messages)=>{writeFileSync(session,[{type:'session',cwd:f.repo},{type:'message',message:{role:'system',sections:{preamble:'<active_agent name="controlled.developer"/>'},toolsAdded:tools.map(name=>({name}))}},...messages].map(JSON.stringify).join('\n')+'\n');return verifyTranscript(session,f.repo,'controlled.developer',tools,tools)};
 const call=path=>({type:'message',message:{role:'assistant',content:[{type:'toolCall',name:'write',arguments:{path,content:'fake state'}}]}});
 assert.throws(()=>run([call('.controlled-dev/state/forged.json')]),/PROTECTED_PROJECT_STATE_WRITE/);
 assert.throws(()=>run([call(join(f.repo,'.controlled-dev','state','forged.json'))]),/PROTECTED_PROJECT_STATE_WRITE/);
 symlinkSync(join(f.repo,'.controlled-dev'),join(f.repo,'alias-to-state'));
 assert.throws(()=>run([call('alias-to-state/state/forged.json')]),/PROTECTED_PROJECT_STATE_WRITE/);
 mkdirSync(join(f.repo,'Documentazione'));assert.throws(()=>run([call('Documentazione/Home.md')]),/PROTECTED_PROJECT_STATE_WRITE/);
 assert.deepEqual(run([{type:'message',message:{role:'toolResult',content:[{type:'toolCall',name:'write',arguments:{path:'.controlled-dev/fake'}}]}},call('file.txt')]).invokedTools,['write']);
 assert.equal(existsSync(join(f.repo,'.controlled-dev','state','forged.json')),false);
});
