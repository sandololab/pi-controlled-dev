import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,rmSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {CandidateGit}=await import('../src/candidate-git.ts');
const {workspaceManifest}=await import('../src/scope-guard.ts');
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trimEnd();
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'candidate-filemode-')),repo=join(root,'repo'),data=join(root,'data');mkdirSync(repo);mkdirSync(data);t.after(()=>rmSync(root,{recursive:true,force:true}));
 git(repo,'init','-q','-b','main');git(repo,'config','user.name','Fixture');git(repo,'config','user.email','fixture@example.invalid');writeFileSync(join(repo,'keep.txt'),'base\n');writeFileSync(join(repo,'delete.txt'),'remove\n');writeFileSync(join(repo,'script.sh'),'#!/bin/sh\nexit 0\n');git(repo,'add','.');git(repo,'commit','-qm','base');git(repo,'config','core.filemode','false');
 const helper=new CandidateGit(repo,data),base=helper.head(),work=join(data,'work'),ref='refs/heads/controlled-dev/mode';helper.addTaskWorktree(ref,base,work);writeFileSync(join(work,'keep.txt'),'after\n');unlinkSync(join(work,'delete.txt'));writeFileSync(join(work,'new.bin'),Buffer.from([0,255,13]));chmodSync(join(work,'script.sh'),0o755);
 const commit=helper.candidateCommit(work,ref,base,workspaceManifest(work,base),'candidate');for(const path of ['keep.txt','delete.txt','script.sh'])chmodSync(join(repo,path),0o777);assert.equal(git(repo,'status','--porcelain'), '');return {repo,data,helper,base,commit,ref};
}
test('apply accepts physical executable bits ignored by Git while preserving exact content, deletion and versioned mode',t=>{
 const f=fixture(t);f.helper.apply('refs/heads/main',f.base,f.commit,'mode-apply');assert.equal(f.helper.head(),f.commit);assert.equal(readFileSync(join(f.repo,'keep.txt'),'utf8'),'after\n');assert.equal(existsSync(join(f.repo,'delete.txt')),false);assert.deepEqual(readFileSync(join(f.repo,'new.bin')),Buffer.from([0,255,13]));assert.match(git(f.repo,'ls-files','--stage','script.sh'),/^100755 /);assert.equal(git(f.repo,'status','--porcelain'), '');
});
test('apply with filemode false still rejects real bytes and staged versioned mode changes before advancing the target',t=>{
 const f=fixture(t);writeFileSync(join(f.repo,'keep.txt'),'operator bytes');assert.throws(()=>f.helper.apply('refs/heads/main',f.base,f.commit,'dirty-bytes'),/GIT_TARGET_DIRTY/);assert.equal(f.helper.head(),f.base);assert.equal(readFileSync(join(f.repo,'keep.txt'),'utf8'),'operator bytes');writeFileSync(join(f.repo,'keep.txt'),'base\n');git(f.repo,'update-index','--chmod=+x','keep.txt');assert.throws(()=>f.helper.apply('refs/heads/main',f.base,f.commit,'dirty-index-mode'),/PROMOTION_INDEX_AMBIGUOUS/);assert.equal(f.helper.head(),f.base);
});
test('physical chmod or inode replacement during proof remains a dirty-source failure even when core.filemode is false',t=>{
 for(const mutation of ['chmod','replace']){
  const f=fixture(t),manifestAt=f.helper.manifestAt.bind(f.helper);let once=false;f.helper.manifestAt=(...args)=>{const manifest=manifestAt(...args);if(!once){once=true;if(mutation==='chmod')chmodSync(join(f.repo,'keep.txt'),0o755);else{unlinkSync(join(f.repo,'keep.txt'));writeFileSync(join(f.repo,'keep.txt'),'base\n');chmodSync(join(f.repo,'keep.txt'),0o777)}}return manifest};
  assert.throws(()=>f.helper.apply('refs/heads/main',f.base,f.commit,'physical-'+mutation),/GIT_TARGET_DIRTY/);assert.equal(f.helper.head(),f.base);assert.equal(readFileSync(join(f.repo,'keep.txt'),'utf8'),'base\n');
 }
});
test('exact ref-first interrupted intent recovers with ignored physical executable bits without replaying the integration',t=>{
 const f=fixture(t);assert.throws(()=>f.helper.apply('refs/heads/main',f.base,f.commit,'interrupted',point=>{if(point==='afterRefUpdate')throw Error('crash') }),/crash/);assert.equal(f.helper.head(),f.commit);assert.equal(readFileSync(join(f.repo,'keep.txt'),'utf8'),'base\n');
 f.helper.apply('refs/heads/main',f.base,f.commit,'interrupted',undefined,true);assert.equal(f.helper.head(),f.commit);assert.equal(readFileSync(join(f.repo,'keep.txt'),'utf8'),'after\n');assert.equal(git(f.repo,'status','--porcelain'), '');
});
