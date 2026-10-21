import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {CandidateGit}=await import('../src/candidate-git.ts');
const {workspaceManifest}=await import('../src/scope-guard.ts');
const {canonicalize,hashCanonical}=await import('../src/contracts.ts');
const {DurableStore}=await import('../src/store.ts');
const {withProjectWorkspaceLease}=await import('../src/lock-manager.ts');
const h=await import('../src/project-handoff.ts');
const c=await import('../src/candidate-storage.ts');
const {presentTrustedConfirmation}=await import('../src/trusted-confirmation.ts');
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
const ctx=(repo,yes=true)=>({mode:'tui',cwd:repo,sessionManager:{getSessionId:()=> 'native-storage-fixture'},ui:{notify(){},confirm:async()=>yes}});
async function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'pi-storage-')),repo=join(root,'project'),data=join(root,'profile');mkdirSync(repo);mkdirSync(data);t.after(()=>rmSync(root,{recursive:true,force:true}));
 git(repo,'init','-qb','main');git(repo,'config','user.name','Fixture');git(repo,'config','user.email','test@example.invalid');writeFileSync(join(repo,'shared.wav'),Buffer.alloc(12000,7));writeFileSync(join(repo,'signal.py'),'signal = 1\n');git(repo,'add','.');git(repo,'commit','-qm','source');
 const store=DurableStore.project(data,repo,'planning',()=> 'ACCEPT',true);store.put('original-plan','original plan','text/plain');
 await withProjectWorkspaceLease(data,repo,async(manager,workspaceLock)=>{const p=h.prepareProjectHandoff({repoRoot:repo,machineDataRoot:data});const r=await presentTrustedConfirmation(ctx(repo),h.projectHandoffRequest(p));h.completeProjectHandoff(h.authorizeProjectHandoff(p,r,{store,manager,workspaceLock,assertQuiescent(){}}))});
 const helper=new CandidateGit(repo,data),base=helper.head(),work=join(data,'work');helper.addTaskWorktree('refs/heads/controlled-dev/storage-fixture',base,work);const snapshots=[];
 for(let i=1;i<=2;i++){
  writeFileSync(join(work,'signal.py'),`signal = ${i+1}\n`);const manifest=workspaceManifest(work,base),snapshot=join(repo,'.controlled-dev','candidates','task',hashCanonical(manifest));helper.captureCandidateSnapshot(work,manifest,snapshot);
  mkdirSync(join(snapshot,'objects'));for(const hash of new Set(manifest.entries.map(e=>e.contentHash)))cpSync(join(dirname(dirname(snapshot)),'.objects',hash),join(snapshot,'objects',hash));rmSync(join(snapshot,'storage.json'));snapshots.push({manifest,snapshot});
 }
 rmSync(join(repo,'.controlled-dev','candidates','.objects'),{recursive:true});
 await withProjectWorkspaceLease(data,repo,async(manager,workspaceLock)=>h.releaseProjectHandoff({repoRoot:repo,manager,workspaceLock,assertQuiescent(){},retireAuthority(){}}));
 const receiptStore=DurableStore.project(data,repo,'planning',()=> 'ACCEPT',false);
 return{root,repo,data,helper,base,snapshots,receiptStore};
}
const noop=async()=>{};
async function prepare(f){const p=await c.prepareCandidateStorageReduction(f.repo,f.data,noop);const request=c.candidateStorageReductionRequest(p),receipt=await presentTrustedConfirmation(ctx(f.repo),request);return{p,request,receipt}}
test('native maintenance shares old payloads, reseals, and survives relocation to an empty profile',async t=>{
 const f=await fixture(t),{reduceProductionProjectStorage}=await import('../src/production-bridge.ts'),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;t.after(()=>old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old);
 const plan=readFileSync(join(f.receiptStore.root,'artifacts','original-plan')),head=f.helper.head();await reduceProductionProjectStorage(ctx(f.repo));
 const release=h.readProjectHandoffForRuntimeImport(f.repo);assert.equal(release.record.ownerDisposition,'RELEASED_FOR_TRANSFER');assert.equal(f.helper.head(),head);assert.deepEqual(readFileSync(join(f.receiptStore.root,'artifacts','original-plan')),plan);
 for(const s of f.snapshots){assert.equal(existsSync(join(s.snapshot,'objects')),false);assert.ok(existsSync(join(s.snapshot,'storage.json')));assert.equal(readFileSync(join(s.snapshot,'manifest.json'),'utf8'),canonicalize(s.manifest))}
 assert.equal(readdirSync(join(f.repo,'.controlled-dev','candidates','.objects')).length,3);
 const copy=join(f.root,'moved project'),empty=join(f.root,'empty profile');cpSync(f.repo,copy,{recursive:true});mkdirSync(empty);assert.equal(h.readProjectHandoffForRuntimeImport(copy).record.taskHeads.length,0);
 const helper=new CandidateGit(copy,empty),last=f.snapshots[1];helper.restoreCandidateSnapshot(join(copy,'.controlled-dev','candidates','task',hashCanonical(last.manifest)),join(empty,'restored'),'refs/heads/controlled-dev/storage-fixture',last.manifest);assert.equal(hashCanonical(workspaceManifest(join(empty,'restored'),f.base)),hashCanonical(last.manifest));
});
test('cancel leaves the exact namespace and released checkpoint unchanged',async t=>{
 const f=await fixture(t),{reduceProductionProjectStorage}=await import('../src/production-bridge.ts'),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;t.after(()=>old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old);
 const before=canonicalize(h.projectHandoffNamespaceManifest(f.repo)),pointer=readFileSync(join(f.repo,'.controlled-dev','handoff.json'));await reduceProductionProjectStorage(ctx(f.repo,false));assert.equal(canonicalize(h.projectHandoffNamespaceManifest(f.repo)),before);assert.deepEqual(readFileSync(join(f.repo,'.controlled-dev','handoff.json')),pointer);
});
test('copied proposals, copied receipts and namespace changes never authorize cleanup',async t=>{
 const f=await fixture(t),a=await prepare(f);await assert.rejects(c.applyCandidateStorageReduction({...a.p},a.receipt,f.receiptStore,()=>{},noop),/PROPOSAL_INVALID/);
 await assert.rejects(c.applyCandidateStorageReduction(a.p,{...a.receipt},f.receiptStore,()=>{},noop),/RECEIPT_INVALID/);
 const b=await prepare(f);writeFileSync(join(f.snapshots[0].snapshot,'extra'),'concurrent change');await assert.rejects(c.applyCandidateStorageReduction(b.p,b.receipt,f.receiptStore,()=>{},noop),/STORAGE_CHANGED/);assert.ok(existsSync(join(f.snapshots[0].snapshot,'objects')));
});
test('pause during cleanup preserves readable snapshots and reports only removed files; fresh confirmation resumes',async t=>{
 const f=await fixture(t),a=await prepare(f);let removed=0;const report=await c.applyCandidateStorageReduction(a.p,a.receipt,f.receiptStore,()=>{},async()=>{if(removed)throw new Error('CANDIDATE_STORAGE_PAUSED')},p=>removed=p.removedFiles??removed);
 assert.equal(report.status,'PAUSED');assert.equal(report.removedFiles,1);assert.ok(report.removedBytes>0);
 for(const s of f.snapshots)await f.helper.inspectSnapshotStorage(s.snapshot,s.manifest,noop);
 const b=await prepare(f),done=await c.applyCandidateStorageReduction(b.p,b.receipt,f.receiptStore,()=>{},noop);assert.equal(done.status,'COMPLETE');assert.equal(done.providerCalls,0);assert.equal(report.removedFiles+done.removedFiles,4);
 await assert.rejects(c.applyCandidateStorageReduction(a.p,a.receipt,f.receiptStore,()=>{},noop),/PROPOSAL_INVALID/);
});
test('loss of lease authority stops before deleting any original payload',async t=>{
 const f=await fixture(t),a=await prepare(f);await assert.rejects(c.applyCandidateStorageReduction(a.p,a.receipt,f.receiptStore,()=>{throw new Error('PROJECT_HANDOFF_LEASE_LOST')},noop),/LEASE_LOST/);assert.ok(f.snapshots.every(s=>readdirSync(join(s.snapshot,'objects')).length===2));
});

test('normal close preserves an exact released checkpoint; changed personal notes still get a new verified seal',async t=>{
 const f=await fixture(t),{releaseProductionProjectStorage}=await import('../src/production-bridge.ts'),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=f.data;t.after(()=>old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old);
 const pointer=readFileSync(join(f.repo,'.controlled-dev','handoff.json')),count=readdirSync(join(f.repo,'.controlled-dev','handoffs')).length;
 await releaseProductionProjectStorage({cwd:f.repo});assert.deepEqual(readFileSync(join(f.repo,'.controlled-dev','handoff.json')),pointer);assert.equal(readdirSync(join(f.repo,'.controlled-dev','handoffs')).length,count);
 writeFileSync(join(f.repo,'Documentazione','personal.md'),'personal note added after release\n');
 await releaseProductionProjectStorage({cwd:f.repo});assert.notDeepEqual(readFileSync(join(f.repo,'.controlled-dev','handoff.json')),pointer);assert.equal(readFileSync(join(f.repo,'Documentazione','personal.md'),'utf8'),'personal note added after release\n');assert.equal(h.readProjectHandoff(f.repo).ownerDisposition,'RELEASED_FOR_TRANSFER');
});
