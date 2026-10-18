import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSourceLoader } from './load-source.mjs';
import { fixtures, TIME } from './contract-fixtures.mjs';
installSourceLoader();
const api=await import('../src/contracts.ts');
const { DurableStore }=await import('../src/store.ts');
const { CentralOrchestrator }=await import('../src/orchestrator.ts');
function setup(t,inspect=()=> 'ACCEPT'){
  const root=mkdtempSync(join(tmpdir(),'controlled-store-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const repo=join(root,'repo'),data=join(root,'data');mkdirSync(repo);mkdirSync(data);
  const store=DurableStore.create(data,repo,'task',inspect),f=fixtures(api),source=store.put('source','input','text/plain');
  const spec={...f.TaskSpec,scope:{...f.TaskSpec.scope,repoRoot:repo},plan:{...f.InputSource,snapshot:source},currentTask:{...f.InputSource,snapshot:source}};
  spec.specHash=api.hashContract('TaskSpec',spec);
  const runner=async()=>{throw new Error('Unexpected dispatch: durable process proof unavailable')};
  const o=CentralOrchestrator.initialize(spec,{ownerSessionId:'owner',runners:{scout:runner},store,artifacts:[source],now:()=>TIME});
  return {root,repo,data,store,spec,o};
}
const overwrite=(path,content)=>{chmodSync(path,0o600);writeFileSync(path,content)};
// Storage-only RECORD fixture, not a workflow transition or a completion-authority fixture.
function record(store,o,reason='Storage-only diagnostic fixture'){
  const records=o.context().records,catalog=store.catalog(records),previous=o.state;
  const state={...previous,revision:previous.revision+1,lastEventId:'storage-event-1'};
  const event={schemaVersion:1,id:state.lastEventId,taskId:state.taskId,kind:'RECORD',recordType:'RECONCILED',actor:'Orchestrator',
    sourceState:previous.state,targetState:state.state,previousRevision:previous.revision,revision:state.revision,timestamp:TIME,
    reason,evidenceRefs:[catalog.id],invalidatedEvidenceIds:[],stateAfter:store.put('storage-state-1',api.canonicalize(state)),
    previousEventHash:o.events.at(-1).eventHash,eventHash:'0'.repeat(64)};
  event.eventHash=api.hashContract('TransitionEvent',event);store.commit(state,event,records);return {state,events:[...o.events,event]};
}
test('P14A durable CREATE and storage-only RECORD round-trip without chat or provider files',t=>{
  const {store,spec,o,repo}=setup(t);assert.equal(DurableStore.load(store.root).state.revision,0);
  const expected=record(store,o),loaded=DurableStore.load(store.root);
  assert.deepEqual(loaded.state,expected.state);assert.deepEqual(loaded.events,expected.events);assert.equal(loaded.truncatedTailBytes,0);
  assert.equal(api.hashBytes(store.read(o.state.spec)),o.state.spec.digest);assert.notEqual(o.state.spec.digest,spec.specHash);
  assert.deepEqual(JSON.parse(readFileSync(join(store.root,'spec.json'))),spec);
  assert.equal(loaded.state.runs.length,0); // No synthetic process proof.
  assert.equal(existsSync(join(repo,'state.json')),false);assert.equal(statSync(join(store.root,'state.json')).mode&0o777,0o600);
  assert.equal(statSync(join(store.root,'artifacts','spec')).mode&0o777,0o400);
});
test('P14A immutable artifact bytes, id, digest, size and media type are checked',t=>{
  const {store}=setup(t),ref=store.put('binary',new Uint8Array([0,255,42]),'application/octet-stream');
  assert.deepEqual([...store.read(ref)],[0,255,42]);assert.deepEqual(store.put('binary',new Uint8Array([0,255,42]),ref.mediaType),ref);
  assert.throws(()=>store.put('binary','different'),/METADATA_CONFLICT/);
  assert.throws(()=>store.read({...ref,bytes:99}),/METADATA_CONFLICT/);
  assert.throws(()=>store.read({...ref,digest:'0'.repeat(64)}),/METADATA_CONFLICT/);
  assert.throws(()=>store.read({...ref,mediaType:'text/plain'}),/METADATA_CONFLICT/);
});
test('P14A paths, source-store placement and symlink/hardlink artifacts fail closed',t=>{
  const {store,repo}=setup(t),ref=store.put('data','safe');
  for(const relativeStorePath of ['../escape','/absolute/escape','artifacts/../data','artifacts/a/b','memory/data'])
    assert.throws(()=>store.read({...ref,relativeStorePath}),/PATH|METADATA_CONFLICT/);
  assert.throws(()=>store.put('../escape','bad'),/INVALID/);
  assert.throws(()=>DurableStore.create(repo,repo,'another',()=> 'ACCEPT'),/ROOT_INVALID/);
  const path=join(store.root,ref.relativeStorePath),other=join(store.root,'outside');writeFileSync(other,'safe');rmSync(path);symlinkSync(other,path);
  assert.throws(()=>store.read(ref),/ALIAS/);rmSync(path);linkSync(other,path);assert.throws(()=>store.read(ref),/ALIAS/);
});
test('P14A missing or corrupted artifact prevents loading',t=>{
  const {store}=setup(t),path=join(store.root,'artifacts','source');overwrite(path,'wrong');
  assert.throws(()=>DurableStore.load(store.root),/INTEGRITY/);rmSync(path);assert.throws(()=>DurableStore.load(store.root),/ENOENT/);
});
test('P14A snapshot mismatch is refused rather than repaired',t=>{
  const {store,o}=setup(t);overwrite(join(store.root,'state.json'),JSON.stringify({...o.state,revision:99}));
  const before=readFileSync(join(store.root,'state.json'));assert.throws(()=>DurableStore.load(store.root),/SNAPSHOT_MISMATCH/);
  assert.deepEqual(readFileSync(join(store.root,'state.json')),before);
});
test('P14A TEST-029 subset: complete event corruption and duplicate revision are rejected',t=>{
  const {store,o}=setup(t),path=join(store.root,'events.jsonl'),original=readFileSync(path,'utf8');
  const changed={...o.events[0],reason:'changed'};overwrite(path,JSON.stringify(changed)+'\n');
  assert.throws(()=>DurableStore.load(store.root),/EVENT_HASH/);
  overwrite(path,original+original);assert.throws(()=>DurableStore.load(store.root),/EVENT_SEQUENCE/);
  overwrite(path,original+'{bad}\n');assert.throws(()=>DurableStore.load(store.root));
});
test('P14A TEST-029 subset: previous hash mismatch rejected even with recomputed event hash',t=>{
  const {store,o}=setup(t);const events=record(store,o).events,last=events.at(-1);
  last.previousEventHash='0'.repeat(64);last.eventHash=api.hashContract('TransitionEvent',last);
  overwrite(join(store.root,'events.jsonl'),events.map(e=>api.canonicalize(e)).join('\n')+'\n');
  assert.throws(()=>DurableStore.load(store.root),/EVENT_SEQUENCE/);
});
test('P14A later catalog cannot rewrite a historical state even with recomputed hashes',t=>{
  const {store,o}=setup(t),events=record(store,o).events,last=events.at(-1);
  const oldId=last.evidenceRefs[0],catalog=JSON.parse(readFileSync(join(store.root,'artifacts',oldId)));
  catalog.records.find(r=>r.id==='state-r0').value.ownerSessionId='foreign';
  const encoded=api.canonicalize(catalog),id=`catalog-${api.hashBytes(Buffer.from(encoded))}`;store.put(id,encoded);
  last.evidenceRefs=[id];last.eventHash=api.hashContract('TransitionEvent',last);
  overwrite(join(store.root,'events.jsonl'),events.map(e=>api.canonicalize(e)).join('\n')+'\n');
  assert.throws(()=>DurableStore.load(store.root),/RECORD_HISTORY_CONFLICT/);
});
test('P14A truncated tail is preserved, ignored by loader, and cannot receive an append',t=>{
  const {store,o}=setup(t),path=join(store.root,'events.jsonl');appendFileSync(path,'{"unfinished":');const before=readFileSync(path);
  const loaded=DurableStore.load(store.root);assert.equal(loaded.state.revision,0);assert.equal(loaded.truncatedTailBytes,14);
  assert.throws(()=>record(store,o),/TRUNCATED_TAIL/);assert.deepEqual(readFileSync(path),before);
});
test('P14A TEST-040 bounded subset: host rejects synthetic secrets/transcripts before persistence',t=>{
  const {store,o}=setup(t,raw=>/SYNTHETIC_SECRET|FULL_TRANSCRIPT/.test(Buffer.from(raw).toString())?'REJECT':'ACCEPT');
  for(const marker of ['SYNTHETIC_SECRET','FULL_TRANSCRIPT']){
    assert.throws(()=>store.put('unsafe',marker),/DISCLOSURE_REJECTED/);assert.equal(existsSync(join(store.root,'artifacts','unsafe')),false);
  }
  const before=readFileSync(join(store.root,'events.jsonl'));
  assert.throws(()=>record(store,o,'SYNTHETIC_SECRET in event reason'),/DISCLOSURE_REJECTED/);
  assert.deepEqual(readFileSync(join(store.root,'events.jsonl')),before);
  const safe=store.put('bounded-log','command exited 0; sensitive output omitted','text/plain');assert.ok(store.read(safe));
});
test('P14A durable dispatch is disabled without an acquired process-terminal proof',async t=>{
  const {store,o}=setup(t),before=readFileSync(join(store.root,'events.jsonl'));
  await assert.rejects(()=>o.analyze(0),/DURABLE_TERMINAL_PROOF_UNAVAILABLE/);
  assert.equal(o.state.revision,0);assert.equal(o.state.counters.dispatches,0);
  assert.deepEqual(readFileSync(join(store.root,'events.jsonl')),before);
});
test('P14A exclusive task creation is not resume or stale-owner recovery',t=>{
  const {data,repo}=setup(t);assert.throws(()=>DurableStore.create(data,repo,'task',()=> 'ACCEPT'),/EEXIST/);
});
test('P14A partial UTF-8 final line is ignored without rewriting any bytes',t=>{
  const {store}=setup(t),path=join(store.root,'events.jsonl');appendFileSync(path,Buffer.from([0x7b,0x22,0xe2,0x82]));
  const before=readFileSync(path);assert.equal(DurableStore.load(store.root).truncatedTailBytes,4);
  assert.deepEqual(readFileSync(path),before);
});
test('P14A TEST-029 bounded commit fault: synced WAL survives snapshot failure, handle becomes unusable',t=>{
  const {store,o}=setup(t),snapshot=readFileSync(join(store.root,'state.json'));
  mkdirSync(join(store.root,'state-1.tmp')); // Deterministic exclusive-create fault after WAL sync.
  assert.throws(()=>record(store,o),/EEXIST/);
  assert.equal(readFileSync(join(store.root,'events.jsonl'),'utf8').trim().split('\n').length,2);
  assert.deepEqual(readFileSync(join(store.root,'state.json')),snapshot);
  assert.throws(()=>store.put('later','no more effects'),/COMMIT_UNCERTAIN/);
  assert.throws(()=>DurableStore.load(store.root),/SNAPSHOT_MISMATCH/);
});
test('P14A terminal snapshot tampering never yields a COMPLETED attestation',t=>{
  const {store,o}=setup(t),path=join(store.root,'state.json');
  overwrite(path,JSON.stringify({...o.state,state:'COMPLETED',terminalReason:'forged',completionEvidenceRefs:['missing-package']}));
  assert.throws(()=>DurableStore.load(store.root));
  assert.equal(JSON.parse(readFileSync(path)).state,'COMPLETED'); // Loader never invents a repairing transition.
});
