import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,unlinkSync,rmSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {CandidateGit}=await import('../src/candidate-git.ts');
const {workspaceManifest}=await import('../src/scope-guard.ts');
const {hashCanonical}=await import('../src/contracts.ts');
const sha=(algorithm,raw)=>createHash(algorithm).update(raw).digest('hex');
const git=(repo,...argv)=>execFileSync('git',['-C',repo,...argv],{encoding:'utf8',env:{...process.env,GIT_AUTHOR_DATE:'2026-01-01T00:00:00Z',GIT_COMMITTER_DATE:'2026-01-01T00:00:00Z'}}).trimEnd();
function fixture(t,Class=CandidateGit,change=true){
  const root=mkdtempSync(join(tmpdir(),'candidate-batch-')),repo=join(root,'repo'),data=join(root,'data');mkdirSync(repo);mkdirSync(data);
  t.after(()=>rmSync(root,{recursive:true,force:true}));git(repo,'init','-q','-b','main');git(repo,'config','user.name','Fixture');git(repo,'config','user.email','fixture@example.invalid');
  mkdirSync(join(repo,'many'));for(let i=0;i<260;i++)writeFileSync(join(repo,'many',`${String(i).padStart(3,'0')}.txt`),`Baseline file ${i}\n`);
  writeFileSync(join(repo,'delete.txt'),'delete\n');writeFileSync(join(repo,'data.bin'),Buffer.from([0,255,17,128]));
  writeFileSync(join(repo,'enable.sh'),'#!/bin/sh\nexit 0\n');writeFileSync(join(repo,'disable.sh'),'#!/bin/sh\nexit 0\n');chmodSync(join(repo,'disable.sh'),0o755);
  git(repo,'add','.');git(repo,'commit','-qm','Equivalent benchmark baseline');
  const helper=new Class(repo,data),base=helper.head(),work=join(data,'candidate'),ref='refs/heads/controlled-dev/batch';helper.addTaskWorktree(ref,base,work);
  if(change){
    unlinkSync(join(work,'delete.txt'));writeFileSync(join(work,'data.bin'),Buffer.from([0,254,1,17,255]));
    chmodSync(join(work,'enable.sh'),0o755);chmodSync(join(work,'disable.sh'),0o644);
    writeFileSync(join(work,'new.bin'),Buffer.from([0,255,1,17]));writeFileSync(join(work,'-leading name é.txt'),'Raw new bytes\r\n');
    writeFileSync(join(work,'new-executable.sh'),'#!/bin/sh\nexit 0\n');chmodSync(join(work,'new-executable.sh'),0o755);
    writeFileSync(join(work,'many','128.txt'),'Changed across the second batch\n');
  }
  return {root,repo,data,work,helper,base,ref,manifest:workspaceManifest(work,base)};
}
function assertExactTree(f,commit){
  const rows=git(f.repo,'ls-tree','-r','-z',commit).split('\0').filter(Boolean).map(row=>{
    const tab=row.indexOf('\t'),[mode,type,oid]=row.slice(0,tab).split(' ');return {path:row.slice(tab+1),mode,type,oid};
  });
  assert.equal(rows.length,f.manifest.entries.length);const actual=new Map(rows.map(row=>[row.path,row]));
  for(const entry of f.manifest.entries){
    const raw=readFileSync(join(f.work,entry.path)),blob=sha('sha1',Buffer.concat([Buffer.from(`blob ${raw.length}\0`),raw]));
    assert.deepEqual(actual.get(entry.path),{path:entry.path,mode:entry.mode,type:'blob',oid:blob});
    assert.equal(entry.contentHash,sha('sha256',raw));
  }
  assert.equal(git(f.repo,'status','--porcelain=v1','--untracked-files=all'),'');assert.equal(f.helper.head(),f.base);assert.equal(f.helper.refHead(f.ref),f.base);
  assert.deepEqual(f.helper.parents(commit),[f.base]);assert.equal(hashCanonical(workspaceManifest(f.work,f.base)),hashCanonical(f.manifest));
  return {tree:f.helper.tree(commit),manifestDigest:hashCanonical(f.manifest),blobRows:rows};
}
test('candidateCommit hashes 266 files across batches while preserving raw blobs, deletion and executable mode transitions',t=>{
  const f=fixture(t);assert.ok(f.manifest.entries.length>256&&f.manifest.entries.length<300);
  const commit=f.helper.candidateCommit(f.work,f.ref,f.base,f.manifest,'Batch candidate');assertExactTree(f,commit);
  const expected=new Map(f.manifest.entries.map(e=>[e.path,e.mode]));assert.equal(expected.get('enable.sh'),'100755');assert.equal(expected.get('disable.sh'),'100644');assert.equal(expected.get('new-executable.sh'),'100755');assert.equal(expected.has('delete.txt'),false);
  assert.deepEqual(new Map(f.helper.changed(commit,f.base).map(c=>[c.path,c.kind])),new Map([
    ['delete.txt','D'],['data.bin','M'],['enable.sh','M'],['disable.sh','M'],['new.bin','A'],['-leading name é.txt','A'],['new-executable.sh','A'],['many/128.txt','M']]));
});
test('batch commit still rejects stale manifests and unsupported symlinks without moving refs, and no-op returns base',t=>{
  const unchanged=fixture(t,CandidateGit,false);assert.equal(unchanged.helper.candidateCommit(unchanged.work,unchanged.ref,unchanged.base,unchanged.manifest,'No-op'),unchanged.base);
  const f=fixture(t);writeFileSync(join(f.work,'new.bin'),'Concurrent edit');assert.throws(()=>f.helper.candidateCommit(f.work,f.ref,f.base,f.manifest,'Stale'),/GIT_CANDIDATE_CHANGED/);
  assert.equal(f.helper.refHead(f.ref),f.base);symlinkSync('new.bin',join(f.work,'link'));const symlinkManifest=workspaceManifest(f.work,f.base);
  assert.throws(()=>f.helper.candidateCommit(f.work,f.ref,f.base,symlinkManifest,'Unsupported'),/GIT_UNSUPPORTED_FILE/);assert.equal(f.helper.refHead(f.ref),f.base);
});
// Explicit, optional performance run against immutable v14, not required for an ordinary checkout.
if(process.env.PI_CANDIDATE_BATCH_BENCHMARK_REPORT)test('v14 and batched candidateCommit produce identical trees and manifest digests on equivalent real fixtures',async t=>{
  assert.ok(process.env.PI_CANDIDATE_BATCH_LEGACY_SOURCE,'Set PI_CANDIDATE_BATCH_LEGACY_SOURCE to the archived v14 src/candidate-git.ts file');
  const legacyUrl=pathToFileURL(resolve(process.env.PI_CANDIDATE_BATCH_LEGACY_SOURCE)),{CandidateGit:Legacy}=await import(legacyUrl.href);
  const results=[];
  for(let round=1;round<=2;round++)for(const label of round===1?['installed-v14','new-source']:['new-source','installed-v14']){
    const f=fixture(t,label==='installed-v14'?Legacy:CandidateGit),start=performance.now();
    const commit=f.helper.candidateCommit(f.work,f.ref,f.base,f.manifest,'Equivalent benchmark candidate'),elapsedMs=performance.now()-start,exact=assertExactTree(f,commit);
    results.push({round,label,entries:f.manifest.entries.length,elapsedMs,base:f.base,tree:exact.tree,manifestDigest:exact.manifestDigest,blobRows:exact.blobRows});
  }
  assert.equal(new Set(results.map(r=>r.base)).size,1);assert.equal(new Set(results.map(r=>r.tree)).size,1);assert.equal(new Set(results.map(r=>r.manifestDigest)).size,1);
  for(const result of results)assert.deepEqual(result.blobRows,results[0].blobRows);
  const median=label=>{const times=results.filter(r=>r.label===label).map(r=>r.elapsedMs);return times.reduce((sum,value)=>sum+value,0)/times.length;};
  const oldMs=median('installed-v14'),newMs=median('new-source');
  const report={schemaVersion:1,measuredAt:new Date().toISOString(),operation:'candidateCommit only; fixture setup and verification excluded',
    comparison:'Two alternating-order runs on equivalent isolated real Git fixtures; no extrapolation to the native ASW repository',
    installedSourceHash:sha('sha256',readFileSync(fileURLToPath(legacyUrl))),newSourceHash:sha('sha256',readFileSync(new URL('../src/candidate-git.ts',import.meta.url))),
    identicalBlobTreesAndManifestDigests:true,meanInstalledMs:oldMs,meanBatchedMs:newMs,speedup:oldMs/newMs,
    results:results.map(({blobRows,...result})=>({...result,blobRowsDigest:hashCanonical(blobRows)}))};
  writeFileSync(process.env.PI_CANDIDATE_BATCH_BENCHMARK_REPORT,JSON.stringify(report,null,2)+'\n');
  t.diagnostic(`candidateCommit: v14 mean ${oldMs.toFixed(2)} ms; batched mean ${newMs.toFixed(2)} ms; ${(oldMs/newMs).toFixed(2)}x`);
});
