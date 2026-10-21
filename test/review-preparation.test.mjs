import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {restartFixture} from './recovery-fixture.mjs';

test('invalid host review preparation preserves model budgets and leaves the valid candidate ready for review',async t=>{
 const root=mkdtempSync(join(tmpdir(),'review-preparation-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const f=await restartFixture(root,'TESTING'),o=f.orchestrator,c=o.candidateCapture,before=o.state;
 await assert.rejects(o.review(before.revision,{candidateManifest:c.manifest,diff:c.patch,changedFiles:c.changedFiles,handoff:c.handoff,residualRisks:[],evidenceRefs:['missing-review-evidence']}),error=>{
  assert.equal(error.code,'INVALID_REVIEW_PACKET');assert.equal(error.diagnostic.path,'evidenceRefs.missing-review-evidence.identity');return true;
 });
 assert.deepEqual(o.state,before);assert.equal(o.state.runs.filter(r=>r.role==='Reviewer').length,0);
 const result=await o.review(o.state.revision,{candidateManifest:c.manifest,diff:c.patch,changedFiles:c.changedFiles,handoff:c.handoff,residualRisks:[],evidenceRefs:['source']});
 assert.equal(result.state.runs.filter(r=>r.role==='Reviewer').length,1);assert.equal(o.state.counters.dispatches,before.counters.dispatches+1);
});
