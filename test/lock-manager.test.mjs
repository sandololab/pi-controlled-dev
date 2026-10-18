import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installSourceLoader } from './load-source.mjs';
installSourceLoader();
const { LockManager, LockError }=await import('../src/lock-manager.ts');
const { canComplete, verifiedCompletionLockFacts }=await import('../src/orchestrator.ts');
const { COMPLETION_CONDITIONS }=await import('../src/state-machine.ts');
function fixture(t){const root=mkdtempSync(join(tmpdir(),'controlled-lock-')),a=join(root,'a'),b=join(root,'b');
  for(const path of [a,b])mkdirSync(path);t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,a,b}}
const denied=code=>error=>error instanceof LockError&&error.code===code;

test('P14D task lock contention is exclusive, stale files are not reclaimed',t=>{const f=fixture(t),one=new LockManager(f.root,'s1','g1'),two=new LockManager(f.root,'s2','g2');
  const held=one.acquireTask('task',f.a);assert.equal(one.verifyTaskLock(held),true);
  assert.throws(()=>two.acquireTask('task',f.a),denied('TASK_LOCK_UNAVAILABLE'));one.release(held);
  const next=two.acquireTask('task',f.a);two.release(next);
  const stale=one.acquireTask('stale',f.a);one.release(stale);writeFileSync(stale.path,JSON.stringify(stale.record));
  assert.throws(()=>two.acquireTask('stale',f.a),denied('TASK_LOCK_UNAVAILABLE'));
});

test('P14D workspace identity blocks different tasks only on the same canonical root',t=>{const f=fixture(t),one=new LockManager(f.root,'s1','g1'),two=new LockManager(f.root,'s2','g2');
  const a=one.acquireWorkspace(f.a);assert.throws(()=>two.acquireWorkspace(f.a),denied('WORKSPACE_LOCK_UNAVAILABLE'));
  const b=two.acquireWorkspace(f.b);assert.equal(two.verifyWorkspaceLock(b),true);two.release(b);one.release(a);
});

test('P14D ownership is live-handle, token/session/generation bound and tamper/missing fail closed',t=>{const f=fixture(t),one=new LockManager(f.root,'s1','g1'),foreign=new LockManager(f.root,'s2','g2');
  const held=one.acquireTask('task',f.a);assert.equal(foreign.verifyTaskLock(held),false);
  const changed={...held.record,token:'00000000-0000-4000-8000-000000000000'};writeFileSync(held.path,JSON.stringify(changed));
  assert.throws(()=>one.verifyTaskLock(held),denied('LOCK_OWNERSHIP_LOST'));assert.throws(()=>one.release(held),denied('LOCK_OWNERSHIP_LOST'));
  writeFileSync(held.path,JSON.stringify(held.record));unlinkSync(held.path);assert.equal(one.verifyTaskLock(held),false);
});

test('P14D stale-handle ABA release cannot remove the next owner lock',t=>{const f=fixture(t),a=new LockManager(f.root,'a','ga'),b=new LockManager(f.root,'b','gb');
  const old=a.acquireTask('task',f.a);a.release(old);const current=b.acquireTask('task',f.a);a.release(old);
  assert.equal(b.verifyTaskLock(current),true);b.release(current);
});

test('P14D pair acquisition order unwinds workspace when task acquisition fails',t=>{const f=fixture(t),a=new LockManager(f.root,'a','ga'),b=new LockManager(f.root,'b','gb');
  const task=a.acquireTask('task',f.a);assert.throws(()=>b.acquire('task',f.a),denied('TASK_LOCK_UNAVAILABLE'));
  const workspace=a.acquireWorkspace(f.a);a.release(workspace);a.release(task);
});

test('P14D TEST-034 subset: uncertain create and release fail closed',t=>{const f=fixture(t),create=new LockManager(f.root,'a','ga',point=>{if(point==='afterExclusiveCreate')throw new Error('fault')});
  assert.throws(()=>create.acquireTask('task',f.a),denied('LOCK_CREATE_FAILED'));
  const clean=new LockManager(f.root,'b','gb');assert.throws(()=>clean.acquireTask('task',f.a),denied('TASK_LOCK_UNAVAILABLE'));
  const release=new LockManager(f.root,'c','gc',point=>{if(point==='beforeRelease')throw new Error('fault')}),held=release.acquireTask('other',f.a);
  assert.throws(()=>release.release(held),denied('LOCK_RELEASE_FAILED'));assert.equal(release.verifyTaskLock(held),true);
});

test('P14D CMP condition 1 is derived only from both live handles',t=>{const f=fixture(t),manager=new LockManager(f.root,'s','g'),state={state:'REVIEWING'};
  const facts=Object.fromEntries(Object.keys(COMPLETION_CONDITIONS).map(id=>[id,true]));facts['CMP-01']=false;assert.equal(canComplete(state,facts),false);
  const locks=manager.acquire('task',f.a);Object.assign(facts,verifiedCompletionLockFacts(manager,locks));assert.equal(canComplete(state,facts),true);
  manager.release(locks.task);Object.assign(facts,verifiedCompletionLockFacts(manager,locks));assert.equal(canComplete(state,facts),false);manager.release(locks.workspace);
});

test('P14D real-process O_EXCL contention has exactly one winner',async t=>{const f=fixture(t),path=join(f.root,'race.lock');
  const script=`const fs=require('node:fs');try{const fd=fs.openSync(process.argv[1],'wx');fs.writeFileSync(fd,process.pid+'');fs.fsyncSync(fd);fs.closeSync(fd);setTimeout(()=>process.exit(0),100)}catch(e){process.exit(e.code==='EEXIST'?2:3)}`;
  const run=()=>new Promise(resolve=>{const child=spawn(process.execPath,['-e',script,path],{stdio:'ignore'});child.on('exit',resolve)});
  const codes=await Promise.all([run(),run()]);assert.deepEqual([...codes].sort(),[0,2]);assert.ok(readFileSync(path,'utf8'));
});
