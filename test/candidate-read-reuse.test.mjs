import test from 'node:test';
import assert from 'node:assert/strict';
import fs,{mkdtempSync,mkdirSync,writeFileSync,readFileSync,renameSync,chmodSync,rmSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {ScopeGuard,workspaceManifest,workspacePatch,workspacePatchFromManifests}=await import('../src/scope-guard.ts');
const {createVerifiedStoreCache,acquiredFileDigest}=await import('../src/verified-store-cache.ts');
const {hashBytes}=await import('../src/contracts.ts');
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
function fixture(t){const root=mkdtempSync(join(tmpdir(),'candidate-read-reuse-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const repo=join(root,'repo'),work=join(root,'work');mkdirSync(repo);git(repo,'init','-q');git(repo,'config','user.name','Test');git(repo,'config','user.email','test@example.invalid');writeFileSync(join(repo,'changed.bin'),new Uint8Array([0,255,1]));writeFileSync(join(repo,'renamed.txt'),'rename');for(let i=0;i<200;i++)writeFileSync(join(repo,`unchanged-${i}.txt`),'unchanged');git(repo,'add','.');git(repo,'commit','-qm','baseline');const base=git(repo,'rev-parse','HEAD');git(repo,'worktree','add','-q','--detach',work,base);return {root,repo,work,base}}
test('canonical patches reuse verified manifests and read only actual written files',t=>{
 const f=fixture(t);writeFileSync(join(f.work,'changed.bin'),new Uint8Array([0,254,2]));renameSync(join(f.work,'renamed.txt'),join(f.work,'new-name.txt'));writeFileSync(join(f.work,'created.txt'),'new');
 const before=workspaceManifest(f.repo,f.base),after=workspaceManifest(f.work,f.base),expected=workspacePatch(f.repo,f.work),read=fs.readFileSync;const reads=[];
 t.mock.method(fs,'readFileSync',(path,...args)=>{reads.push(String(path));return read(path,...args)});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports()});
 assert.equal(workspacePatchFromManifests(f.work,before,after),expected);assert.equal(reads.length,3);assert.equal(reads.some(p=>p.includes('unchanged-')),false);
});
test('manifest reuse still rejects file bytes or permissions changed after acquisition',t=>{
 const f=fixture(t);writeFileSync(join(f.work,'changed.bin'),'changed');const before=workspaceManifest(f.repo,f.base),after=workspaceManifest(f.work,f.base);writeFileSync(join(f.work,'changed.bin'),'tampered');assert.throws(()=>workspacePatchFromManifests(f.work,before,after),/SCOPE_WORKSPACE_CHANGED/);writeFileSync(join(f.work,'changed.bin'),'changed');chmodSync(join(f.work,'changed.bin'),0o755);assert.throws(()=>workspacePatchFromManifests(f.work,before,after),/SCOPE_WORKSPACE_CHANGED/);
});
test('acquired artifact hashes exist only inside one private verified decode',t=>{
 const root=mkdtempSync(join(tmpdir(),'acquired-digest-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const file=join(root,'artifact');writeFileSync(file,'actual bytes');let savedReader;
 const read=createVerifiedStoreCache((_root,reader)=>{savedReader=reader;const raw=reader(file);raw[0]=0;assert.equal(Buffer.from(reader(file)).toString('utf8'),readFileSync(file,'utf8'));const fresh=reader(file);assert.equal(acquiredFileDigest(reader,file),hashBytes(fresh));assert.equal(acquiredFileDigest(()=>raw,file),undefined);return {content:Buffer.from(fresh).toString('utf8')}});
 assert.deepEqual(read(root),{content:'actual bytes'});assert.equal(acquiredFileDigest(savedReader,file),undefined);writeFileSync(file,'changed bytes');assert.deepEqual(read(root),{content:'changed bytes'});
});

test('an unchanged candidate reuses its private patch round-trip proof while live scope checks remain mandatory',t=>{
 const f=fixture(t),scope={schemaVersion:1,repoRoot:f.repo,baseRef:'HEAD',allowedPaths:['changed.bin'],deniedPaths:[],strongConfinementRequired:false};
 const guard=ScopeGuard.open(scope,f.work,f.base);writeFileSync(join(f.work,'changed.bin'),'first change');
 const temp=fs.mkdtempSync;let roundTrips=0;t.mock.method(fs,'mkdtempSync',(prefix,...args)=>{if(String(prefix).includes('controlled-scope-roundtrip-'))roundTrips++;return temp(prefix,...args)});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports()});
 const first=guard.capture(1,'first terminal proof'),again=guard.capture(1,'fresh integrity observation');assert.equal(first.digest,again.digest);assert.equal(roundTrips,1);
 writeFileSync(join(f.work,'unchanged-1.txt'),'outside scope');assert.throws(()=>guard.capture(1,'after forbidden write'),/SCOPE_VIOLATION/);assert.equal(roundTrips,1);
 writeFileSync(join(f.work,'unchanged-1.txt'),'unchanged');writeFileSync(join(f.work,'changed.bin'),'second change');assert.throws(()=>guard.capture(1,'stale generation'),/SCOPE_GENERATION_INVALID/);
 assert.notEqual(guard.capture(2,'second terminal proof').digest,first.digest);assert.equal(roundTrips,2);
});
