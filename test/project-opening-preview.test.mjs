import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {recoveryFixture}=await import('./recovery-fixture.mjs');
const {productionOpeningTaskPreview}=await import('../src/production-bridge.ts');
const {DurableStore}=await import('../src/store.ts');
test('opening uses a verified terminal ledger without replaying repair history; nonterminal, missing and damaged ledgers remain distinct',t=>{
 const root=mkdtempSync(join(tmpdir(),'opening-preview-')),f=recoveryFixture(root,'FAILED'),old=process.env.PI_CODING_AGENT_DIR;
 process.env.PI_CODING_AGENT_DIR=f.data;
 t.after(()=>{process.env.PI_CODING_AGENT_DIR=old;if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;f.manager.release(f.locks.task);f.manager.release(f.locks.workspace);rmSync(root,{recursive:true,force:true})});
 const history=DurableStore.readHistory;DurableStore.readHistory=()=>assert.fail('Preview must not classify or repair history');
 try{assert.deepEqual(productionOpeningTaskPreview({cwd:f.repo},'task'),{taskId:'task',terminal:true});assert.equal(productionOpeningTaskPreview({cwd:f.repo},'prepared-not-started'),undefined)}finally{DurableStore.readHistory=history}
 const statePath=join(f.storeRoot,'state.json'),bytes=readFileSync(statePath);writeFileSync(statePath,'{invalid');assert.throws(()=>productionOpeningTaskPreview({cwd:f.repo},'task'));writeFileSync(statePath,bytes);
 symlinkSync(join(root,'missing'),join(f.storeRoot,'..','aliased'));assert.throws(()=>productionOpeningTaskPreview({cwd:f.repo},'aliased'));
 const otherRoot=mkdtempSync(join(tmpdir(),'opening-preview-pending-')),pending=recoveryFixture(otherRoot);process.env.PI_CODING_AGENT_DIR=pending.data;
 t.after(()=>{pending.manager.release(pending.locks.task);pending.manager.release(pending.locks.workspace);rmSync(otherRoot,{recursive:true,force:true})});
 assert.deepEqual(productionOpeningTaskPreview({cwd:pending.repo},'task'),{taskId:'task',terminal:false});
});
