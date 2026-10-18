import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFileSync,chmodSync,linkSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,symlinkSync,truncateSync,utimesSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installSourceLoader} from './load-source.mjs';
import {fixtures,TIME} from './contract-fixtures.mjs';
installSourceLoader();
const api=await import('../src/contracts.ts');
const {DurableStore}=await import('../src/store.ts');
const {CentralOrchestrator}=await import('../src/orchestrator.ts');
const {createVerifiedStoreCache}=await import('../src/verified-store-cache.ts');
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'verified-store-')),repo=join(root,'repo'),data=join(root,'data');mkdirSync(repo);mkdirSync(data);
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const store=DurableStore.create(data,repo,'task',()=> 'ACCEPT'),v=fixtures(api),source=store.put('source','input','text/plain');
  const spec={...v.TaskSpec,scope:{...v.TaskSpec.scope,repoRoot:repo},plan:{...v.InputSource,snapshot:source},currentTask:{...v.InputSource,snapshot:source}};spec.specHash=api.hashContract('TaskSpec',spec);
  const o=CentralOrchestrator.initialize(spec,{ownerSessionId:'owner',runners:{scout:async()=>{throw new Error('No provider dispatch')}},store,artifacts:[source],now:()=>TIME});
  // A genuine second record leaves the original state artifact as historical evidence.
  const records=o.context().records,catalog=store.catalog(records),state={...o.state,revision:1,lastEventId:'storage-only-event'};
  const event={schemaVersion:1,id:state.lastEventId,taskId:'task',kind:'RECORD',recordType:'RECONCILED',actor:'Orchestrator',sourceState:'PENDING',targetState:'PENDING',previousRevision:0,revision:1,timestamp:TIME,reason:'Storage fixture',evidenceRefs:[catalog.id],invalidatedEvidenceIds:[],stateAfter:store.put('state-1',api.canonicalize(state)),previousEventHash:o.events[0].eventHash,eventHash:'0'.repeat(64)};event.eventHash=api.hashContract('TransitionEvent',event);store.commit(state,event,records);
  return {root,repo,data,store};
}
test('cached data is isolated from mutations to state, events, records and nested arrays',t=>{
  const f=fixture(t),expected=DurableStore.readHistory(f.store.root),first=DurableStore.load(f.store.root);
  first.state.ownerSessionId='poisoned';first.state.runs.push({status:'TERMINAL'});first.events[0].reason='poisoned';first.records[0].value={poison:true};
  assert.deepEqual(DurableStore.load(f.store.root),expected);
});
for(const kind of ['ancient-artifact','snapshot','spec','WAL'])test(`a cache hit never conceals ${kind} corruption with unchanged latest revision`,t=>{
  const f=fixture(t);DurableStore.load(f.store.root);
  const name={'ancient-artifact':'artifacts/state-r0',snapshot:'state.json',spec:'spec.json',WAL:'events.jsonl'}[kind],path=join(f.store.root,name);chmodSync(path,0o600);
  if(kind==='WAL'){const events=readFileSync(path,'utf8').trim().split('\n');const first=JSON.parse(events[0]);first.reason='tampered old event';events[0]=JSON.stringify(first);writeFileSync(path,events.join('\n')+'\n')}
  else if(kind==='snapshot'){const state=JSON.parse(readFileSync(path,'utf8'));state.ownerSessionId='tampered';writeFileSync(path,JSON.stringify(state))}
  else writeFileSync(path,'corruption');
  assert.throws(()=>DurableStore.load(f.store.root));if(kind!=='snapshot')assert.throws(()=>DurableStore.readHistory(f.store.root));
});
test('WAL prefix cache notices partial new tail and does not discard or repair it',t=>{
  const f=fixture(t);DurableStore.load(f.store.root);const path=join(f.store.root,'events.jsonl');appendFileSync(path,'{partial');const bytes=readFileSync(path);
  assert.equal(DurableStore.load(f.store.root).truncatedTailBytes,8);assert.deepEqual(readFileSync(path),bytes);
});
test('snapshot mismatch does not bypass the independent fresh WAL reader used by repair',t=>{
  const f=fixture(t),old=DurableStore.load(f.store.root),path=join(f.store.root,'state.json');writeFileSync(path,JSON.stringify({...old.state,revision:99}));
  assert.throws(()=>DurableStore.load(f.store.root),/SNAPSHOT_MISMATCH/);assert.deepEqual(DurableStore.readHistory(f.store.root).state,old.state);
});
for(const kind of ['file-mode','new-name','file-inode','directory-inode','ancestor-mode'])test(`exact physical namespace changes invalidate cache data: ${kind}`,t=>{
  const f=fixture(t);let decodes=0;const load=createVerifiedStoreCache((_root,read)=>{decodes++;return {value:Buffer.from(read(join(f.store.root,'state.json'))).toString('utf8')}});
  load(f.store.root);load(f.store.root);assert.equal(decodes,1);
  if(kind==='file-mode')chmodSync(join(f.store.root,'state.json'),0o400);
  if(kind==='new-name')writeFileSync(join(f.store.root,'extra'),'unknown personal file');
  if(kind==='file-inode'){const path=join(f.store.root,'state.json'),raw=readFileSync(path);rmSync(path);writeFileSync(path,raw)}
  if(kind==='directory-inode'){const path=join(f.store.root,'artifacts'),old=join(f.root,'old-artifacts');renameSync(path,old);mkdirSync(path);for(const name of ['unused'])writeFileSync(join(path,name),'file')}
  if(kind==='ancestor-mode')chmodSync(f.data,0o700);
  load(f.store.root);assert.equal(decodes,2);
});
for(const kind of ['symlink','hardlink','parent-alias'])test(`cached ledger refuses ${kind} aliases`,t=>{
  const f=fixture(t);DurableStore.load(f.store.root);
  if(kind==='parent-alias'){const old=join(f.root,'real-data');renameSync(f.data,old);symlinkSync(old,f.data);assert.throws(()=>DurableStore.load(f.store.root),/ALIAS/);return}
  const path=join(f.store.root,'artifacts','source'),other=join(f.root,'same-bytes');writeFileSync(other,readFileSync(path));rmSync(path);(kind==='symlink'?symlinkSync:linkSync)(other,path);
  assert.throws(()=>DurableStore.load(f.store.root),/ALIAS/);
});
test('cold verification reads acquired bytes and refuses concurrent filesystem changes',t=>{
  const root=mkdtempSync(join(tmpdir(),'store-cache-change-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const path=join(root,'value');writeFileSync(path,'old');
  const load=createVerifiedStoreCache((_root,read)=>{writeFileSync(path,'new');assert.equal(Buffer.from(read(path)).toString(),'old');return {ok:true}});
  assert.throws(()=>load(root),/NAMESPACE_CHANGED/);
});
test('in-place ABA with restored content and mtime never returns an unchecked cached result',t=>{
  const root=mkdtempSync(join(tmpdir(),'store-cache-aba-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const path=join(root,'value');writeFileSync(path,'original');
  const load=createVerifiedStoreCache((_root,read)=>{const raw=read(path);writeFileSync(path,'temporary');writeFileSync(path,raw);utimesSync(path,new Date(0),new Date(0));return {value:Buffer.from(raw).toString()}});
  assert.throws(()=>load(root),/NAMESPACE_CHANGED/);
});
test('private cache evicts after eight entries and oversized valid namespaces use uncached reads',t=>{
  const root=mkdtempSync(join(tmpdir(),'store-cache-bounds-'));t.after(()=>rmSync(root,{recursive:true,force:true}));let decodes=0;
  const load=createVerifiedStoreCache((path,read)=>{decodes++;return {value:read?Buffer.from(read(join(path,'value'))).toString():readFileSync(join(path,'value'),'utf8')}});
  for(let i=0;i<9;i++){const path=join(root,String(i));mkdirSync(path);writeFileSync(join(path,'value'),'valid');load(path)}
  assert.equal(decodes,9);load(join(root,'0'));assert.equal(decodes,10);
  const large=join(root,'large');mkdirSync(large);writeFileSync(join(large,'value'),'valid');writeFileSync(join(large,'unused-large'),'');truncateSync(join(large,'unused-large'),65*1024*1024);
  load(large);load(large);assert.equal(decodes,12);
});
