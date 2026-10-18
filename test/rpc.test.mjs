import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRpc } from './load-rpc.mjs';
import { loadContracts } from './load-contracts.mjs';
import { fixtures, context } from './contract-fixtures.mjs';
const { RpcAdapter } = await loadRpc();
const contracts = await loadContracts();
const REQUEST = 'subagents:rpc:v1:request', PREFIX = 'subagents:rpc:v1:reply:', EVENT = 'subagent:async-complete';
const env = { sessionId: 'session-1', environmentHash: 'a'.repeat(64), piVersion: '0.87.1', subagentsVersion: '0.71.0' };
const hello = () => ({ version: 1, methods: ['ping','spawn','status','interrupt','stop','resume'], capabilities: { asyncSpawn: true, status: true, interrupt: true, stop: true, resume: true,
  processTerminalProof:{version:1,lifecycleArtifactVersion:3} }, events: { asyncComplete: EVENT }, session: { sessionId: env.sessionId, sessionFile: null } });
const schema = { type: 'object', properties: { nonce: { type: 'string', const: 'nonce' }, status: { const: 'ok' } }, required: ['nonce','status'], additionalProperties: false };
const input = () => ({ agent: 'reviewer', task: 'Static nonce only', cwd: '/', timeoutMs: 100, outputSchema: schema });
const valid = x => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).sort().join(',') === 'nonce,status' && x.nonce === 'nonce' && x.status === 'ok'
  ? { ok: true, value: x, level: 'probe-schema-only' } : { ok: false };
const completion = (runId = 'run-1') => ({ id: runId, runId, sessionId: env.sessionId, state: 'complete', success: true, exitCode: 0,
  results: [{ agent: 'reviewer', context: 'fresh', success: true, status: 'completed', structuredOutput: { nonce: 'nonce', status: 'ok' } }] });
class Fake {
  listeners = new Map(); requests = []; serial = 0; pingData = hello(); handler;
  on(name, callback) { const set = this.listeners.get(name) ?? new Set(); set.add(callback); this.listeners.set(name, set); return () => { set.delete(callback); if (!set.size) this.listeners.delete(name); }; }
  emit(name, data) {
    if (name === REQUEST) {
      this.requests.push(data);
      if (this.handler?.(data) === true) return;
      const result = data.method === 'ping' ? this.pingData : ['spawn','resume'].includes(data.method) ? { details: { asyncId: `run-${++this.serial}`, runId: `run-${this.serial}` } }
        : data.method === 'status' ? { asyncSnapshot: { version: 1, kind: 'pi-subagents.async-status-snapshot', runs: [{ id: data.params.id, state: 'complete' }] } } : { acknowledged: true };
      this.reply(data, result);
    } else for (const listener of [...(this.listeners.get(name) ?? [])]) listener(data);
  }
  reply(q, data, extra = {}) { this.emit(PREFIX + q.requestId, { version: 1, requestId: q.requestId, method: q.method, success: true, data, ...extra }); }
  reject(q, code, message) { this.emit(PREFIX + q.requestId, { version: 1, requestId: q.requestId, method: q.method, success: false, error: { code, message } }); }
  get count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
async function ready(t, fake = new Fake(), ms = 100) {
  const rpc = new RpcAdapter(fake, env, ms);
  t.after(() => { rpc.dispose(); assert.equal(fake.count, 0); });
  assert.equal((await rpc.handshake()).status, 'VERIFIED');
  return { rpc, fake };
}
async function launched(t) { const pair = await ready(t); const r = await pair.rpc.spawn(input()); assert.equal(r.ok, true); return { ...pair, binding: r.value }; }

test('P5-001 TEST-025 — absent transport, absent ping, no fallback or child dispatch', async () => {
  const absent = new RpcAdapter(undefined, env, 5);
  assert.equal((await absent.handshake()).status, 'UNAVAILABLE'); absent.dispose();
  const fake = new Fake(); fake.handler = () => true;
  const rpc = new RpcAdapter(fake, env, 5);
  assert.equal((await rpc.handshake()).error.code, 'TIMEOUT');
  assert.equal((await rpc.spawn(input())).error.code, 'MISSING_CAPABILITY');
  assert.deepEqual(fake.requests.map(x => x.method), ['ping']); rpc.dispose(); assert.equal(fake.count, 0);
});
test('P5-002 TEST-025 — protocol compatibility is separate from optional provider capabilities', async () => {
  for (const mutate of [p => { p.version = 2; }, p => { p.session.sessionId = 'foreign'; }]) {
    const fake = new Fake(); mutate(fake.pingData); const rpc = new RpcAdapter(fake, env);
    assert.notEqual((await rpc.handshake()).status, 'VERIFIED'); assert.equal((await rpc.spawn(input())).ok, false);
    assert.equal(fake.requests.length, 1); rpc.dispose(); assert.equal(fake.count, 0);
  }
  for (const mutate of [p => { p.methods = ['ping','status']; }, p => { p.capabilities.asyncSpawn = false; }, p => { delete p.events.asyncComplete; }]) {
    const fake = new Fake(); mutate(fake.pingData); const rpc = new RpcAdapter(fake, env); const hs=await rpc.handshake();
    assert.equal(hs.status,'VERIFIED');assert.equal((await rpc.spawn(input())).error.code,'MISSING_CAPABILITY');
    rpc.dispose();assert.equal(fake.count,0);
  }
  for (const nestedOnly of [true, false]) {
    const fake = new Fake(); fake.pingData.capabilities.events = { asyncComplete: EVENT };
    if (nestedOnly) delete fake.pingData.events;
    const rpc = new RpcAdapter(fake, env); const hs = await rpc.handshake();
    assert.equal(hs.status, 'VERIFIED'); assert.equal(hs.scope, 'rpc-ping-only'); assert.equal(hs.asyncStructuredOutput, 'UNVERIFIED'); rpc.dispose();
  }
  const fake = new Fake(); fake.pingData.capabilities.events = { asyncComplete: 'different' };
  const rpc = new RpcAdapter(fake, env); assert.equal((await rpc.handshake()).status, 'INCOMPATIBLE'); rpc.dispose();
});
test('capability matrix and version diagnostics never select operational authority',async()=>{
  const cases=[
    ['full','99.0.0-future',()=>{},'FULL'],
    ['no stop','99.0.0-future',p=>{p.methods=p.methods.filter(v=>v!=='stop');p.capabilities.stop=false},'OBSERVE_ONLY'],
    ['no terminal proof','0.1.0-old',p=>delete p.capabilities.processTerminalProof,'LOGICAL_ONLY'],
    ['status only','0.1.0-old',p=>{p.methods=['ping','status'];p.capabilities={status:true}},'LOGICAL_ONLY'],
    ['no status','99.0.0-future',p=>{p.methods=['ping'];p.capabilities={}},'UNAVAILABLE'],
    ['old sufficient','0.1.0-old',()=>{},'FULL'],
  ];
  for(const [label,providerVersion,mutate,mode] of cases){
    const fake=new Fake();fake.pingData.providerVersion=providerVersion;mutate(fake.pingData);
    const rpc=new RpcAdapter(fake,{...env,subagentsVersion:label});const hs=await rpc.handshake();
    assert.equal(hs.status,'VERIFIED',label);assert.equal(rpc.providerVersion(),providerVersion,label);assert.equal(rpc.liveTerminationMode(),mode,label);
    assert.equal(rpc.capabilities().status,fake.pingData.methods.includes('status')&&fake.pingData.capabilities.status===true,label);
    rpc.dispose();
  }
});
test('full capability path stops an active exact run and waits for observed process-terminal proof',async t=>{
  const {rpc,fake}=await ready(t),states=new Map(),stops=[];
  const launched=await rpc.spawn({...input(),agent:'controlled.reviewer'});assert.equal(launched.ok,true);states.set(launched.value.runId,'running');
  fake.handler=q=>{
    if(q.method==='stop'){
      stops.push(q.params.id);states.set(q.params.id,'failed');fake.reply(q,{acknowledged:true});
      const event=completion(q.params.id);event.state='failed';event.success=false;event.exitCode=1;event.results[0].agent='controlled.reviewer';event.results[0].sessionFile='/public/reviewer-a.jsonl';
      queueMicrotask(()=>fake.emit(EVENT,event));return true;
    }
    if(q.method==='status'){
      const state=states.get(q.params.id);fake.reply(q,{details:{lifecycleStatus:{processTerminal:{version:1,state:state==='failed'?'observed':'unknown',runId:q.params.id,
        runnerProcessInstanceId:'runner-a',observedAt:2,instances:state==='failed'?[{kind:'runner',processInstanceId:'runner-a',closeObservedAt:1,exitCode:1,signal:null}]:[],resumeDisposition:'not-resumable'}}},
        asyncSnapshot:{version:1,kind:'pi-subagents.async-status-snapshot',runs:[{id:q.params.id,state}]}});return true;
    }
    return false;
  };
  const proof=await rpc.awaitTerminalProof(launched.value.runId,500);assert.equal(proof.ok,true);assert.deepEqual(stops,[launched.value.runId]);
  assert.equal(proof.value.provider.state,'observed');assert.equal(proof.value.runId,launched.value.runId);
});
test('status plus terminal proof without stop performs bounded observation only',async t=>{
  const fake=new Fake();fake.pingData.methods=fake.pingData.methods.filter(v=>v!=='stop');fake.pingData.capabilities.stop=false;
  const {rpc}=await ready(t,fake),states=new Map(),stops=[];const launched=await rpc.spawn({...input(),agent:'controlled.reviewer'});states.set(launched.value.runId,'running');
  fake.handler=q=>{
    if(q.method==='stop'){stops.push(q.params.id);return true}
    if(q.method==='status'){const state=states.get(q.params.id);fake.reply(q,{details:{lifecycleStatus:{processTerminal:{version:1,state:state==='failed'?'observed':'unknown',runId:q.params.id,
      runnerProcessInstanceId:'runner-b',observedAt:2,instances:state==='failed'?[{kind:'runner',processInstanceId:'runner-b',closeObservedAt:1,exitCode:1,signal:null}]:[],resumeDisposition:'not-resumable'}}},
      asyncSnapshot:{version:1,kind:'pi-subagents.async-status-snapshot',runs:[{id:q.params.id,state}]}});return true}return false};
  setTimeout(()=>{states.set(launched.value.runId,'failed');const event=completion(launched.value.runId);event.state='failed';event.success=false;event.exitCode=1;
    event.results[0].agent='controlled.reviewer';event.results[0].sessionFile='/public/reviewer-a.jsonl';fake.emit(EVENT,event)},20);
  const proof=await rpc.awaitTerminalProof(launched.value.runId,500);assert.equal(proof.ok,true);assert.deepEqual(stops,[]);assert.equal(rpc.liveTerminationMode(),'OBSERVE_ONLY');
});
test('P5-003 TEST-025 — unsupported host is not incompatible RPC; rejection never retries', async t => {
  const { rpc, fake } = await ready(t);
  fake.handler = q => { fake.reject(q, 'execution_failed', 'Background children require a supported standalone Pi host or the installed npm package (@earendil-works/pi-coding-agent); neither is available.'); return true; };
  const r = await rpc.spawn(input()); assert.equal(r.error.code, 'HOST_ENVIRONMENT_UNSUPPORTED'); assert.equal(r.dispatchOutcome, 'UNKNOWN');
  assert.deepEqual(fake.requests.map(x => x.method), ['ping', 'spawn']);
  fake.handler = q => { fake.reject(q, 'execution_failed', 'Other launch failure'); return true; };
  assert.equal((await rpc.spawn(input())).error.code, 'SPAWN_REJECTED');
  for (const data of [{ text: 'run-1 spawned successfully' }, { details: { asyncId: 'one', runId: 'two' } }, { isError: true, details: { asyncId: 'one', runId: 'one' } }]) {
    fake.handler = q => { fake.reply(q, data); return true; };
    const unknown = await rpc.spawn(input()); assert.equal(unknown.error.code, 'DISPATCH_OUTCOME_UNKNOWN'); assert.equal(unknown.dispatchOutcome, 'UNKNOWN');
  }
});
test('P5-004 — exact request correlation, immutable snapshots, foreign/malformed replies', async t => {
  const { rpc, fake } = await ready(t);
  fake.handler = q => { fake.reply(q, {}, { requestId: 'foreign' }); return true; };
  assert.equal((await rpc.ping()).error.code, 'FOREIGN_REPLY');
  fake.handler = q => { fake.reply(q, {}, { method: 'stop' }); return true; };
  assert.equal((await rpc.ping()).error.code, 'RPC_INCOMPATIBLE');
  let getterCalls = 0;
  fake.handler = q => { const bad = {}; Object.defineProperty(bad, 'requestId', { get() { getterCalls++; return q.requestId; } }); fake.emit(PREFIX + q.requestId, bad); return true; };
  assert.equal((await rpc.ping()).error.code, 'MALFORMED_REPLY'); assert.equal(getterCalls, 0);
  const ids = fake.requests.map(x => x.requestId); assert.equal(new Set(ids).size, ids.length);
});
test('P5-005 — identical replies idempotent; late conflicts quarantine already returned observations', async t => {
  const { rpc, fake, binding } = await launched(t);
  const q = fake.requests.at(-1), data = { details: { asyncId: binding.runId, runId: binding.runId } };
  fake.reply(q, data); assert.equal(rpc.integrity().ok, true);
  fake.reply(q, { details: { asyncId: 'other', runId: 'other' } });
  assert.equal(rpc.integrity().error.code, 'DUPLICATE_CONFLICT');
  fake.emit(EVENT, completion(binding.runId)); assert.equal(rpc.acquire(binding.runId, valid).ok, false);
  assert.notEqual((await rpc.handshake()).status, 'VERIFIED');
});
test('P5-006 — bounded dispatch timeout is UNKNOWN, not permission to redispatch', async t => {
  const { rpc, fake } = await ready(t, new Fake(), 5);
  fake.handler = () => true;
  const result = await rpc.spawn(input()); assert.equal(result.error.code, 'DISPATCH_OUTCOME_UNKNOWN'); assert.equal(result.dispatchOutcome, 'UNKNOWN');
  assert.equal(fake.requests.filter(q => q.method === 'spawn').length, 1);
  assert.equal((await rpc.status('unknown')).error.code, 'TIMEOUT');
});
test('P5-007 TEST-026 — structured, attributed, independently validated output only', async t => {
  const cases = [
    [e => {}, true],
    [e => { delete e.results[0].structuredOutput; }, 'MISSING_STRUCTURED_OUTPUT'],
    [e => { e.results[0].output = JSON.stringify(e.results[0].structuredOutput); delete e.results[0].structuredOutput; }, 'MISSING_STRUCTURED_OUTPUT'],
    [e => { e.results[0].structuredOutput = { nonce: 'wrong', status: 'ok' }; }, 'INVALID_STRUCTURED_OUTPUT'],
    [e => { e.results[0].structuredOutput.extra = true; }, 'INVALID_STRUCTURED_OUTPUT'],
    [e => { e.results[0].structuredOutput = JSON.stringify(e.results[0].structuredOutput); }, 'INVALID_STRUCTURED_OUTPUT'],
    [e => { e.results[0].structuredOutput = null; }, 'INVALID_STRUCTURED_OUTPUT'],
    [e => { e.results[0].agent = 'worker'; }, 'FOREIGN_COMPLETION'],
    [e => { e.results[0].context = 'fork'; }, 'FOREIGN_COMPLETION'],
    [e => { e.success = false; }, 'RUN_NOT_SUCCESSFUL'],
    [e => { e.state = 'running'; }, 'RUN_NOT_SUCCESSFUL'],
    [e => { e.exitCode = 1; }, 'RUN_NOT_SUCCESSFUL'],
    [e => { e.results[0].acceptance = { explicit: true, status: 'rejected' }; }, 'RUN_NOT_SUCCESSFUL'],
  ];
  for (const [mutate, expected] of cases) {
    const { rpc, fake, binding } = await launched(t); const e = completion(binding.runId); mutate(e); fake.emit(EVENT, e);
    const r = rpc.acquire(binding.runId, valid);
    if (expected === true) { assert.equal(r.ok, true); assert.equal(r.value.workflowAccepted, false); assert.ok(Object.isFrozen(r.value.value)); }
    else assert.equal(r.error.code, expected);
  }
});
test('P5-008 — no permissive repairs, structural-only validators or boolean success', async t => {
  const { rpc, fake, binding } = await launched(t); fake.emit(EVENT, completion(binding.runId));
  for (const validator of [() => true, () => ({ ok: true, level: 'structural', value: { nonce: 'nonce', status: 'ok' } }), () => ({ ok: true, level: 'semantic-data-only', value: { repaired: true } }), () => { throw new Error(); }])
    assert.equal(rpc.acquire(binding.runId, validator).error.code, 'INVALID_STRUCTURED_OUTPUT');
});
test('P5-009 TEST-027 partial — identical, foreign session/run and conflicting completion', async t => {
  const { rpc, fake, binding } = await launched(t); const e = completion(binding.runId);
  fake.emit(EVENT, { ...e, sessionId: 'foreign' }); fake.emit(EVENT, completion('other'));
  assert.equal(rpc.acquire(binding.runId, valid).error.code, 'COMPLETION_PENDING');
  let notices = 0; const off = rpc.observe(() => { notices++; });
  fake.emit(EVENT, e); fake.emit(EVENT, structuredClone(e)); assert.equal(notices, 1);
  assert.equal(rpc.acquire(binding.runId, valid).ok, true);
  const conflict = structuredClone(e); conflict.results[0].structuredOutput.nonce = 'other'; fake.emit(EVENT, conflict);
  assert.equal(rpc.acquire(binding.runId, valid).error.code, 'COMPLETION_CONFLICT'); off();
});
test('P5-010 TEST-027 partial — before binding, contradictory early events, unresolvable order', async t => {
  for (const conflict of [false, true]) {
    const { rpc, fake } = await ready(t);
    fake.handler = q => {
      if (q.method !== 'spawn') return false;
      fake.emit(EVENT, completion());
      if (conflict) fake.emit(EVENT, { ...completion(), success: false });
      fake.reply(q, { details: { runId: 'run-1', asyncId: 'run-1' } }); return true;
    };
    const r = await rpc.spawn(input());
    assert.equal(r.ok, !conflict);
    if (!conflict) assert.equal(rpc.acquire(r.value.runId, valid).ok, true);
  }
  const { rpc, fake } = await ready(t);
  fake.emit(EVENT, completion()); // Not attributable to any pending request.
  const r = await rpc.spawn(input());
  assert.equal(rpc.acquire(r.value.runId, valid).error.code, 'COMPLETION_PENDING');
});
test('P5-011 — status/control primitives: exact ID, UNKNOWN without structured state, no recovery', async t => {
  const { rpc, fake, binding } = await launched(t);
  assert.equal((await rpc.status(binding.runId)).value.state, 'complete');
  fake.handler = q => { if (q.method === 'status') { fake.reply(q, { text: 'Run completed successfully' }); return true; } return false; };
  assert.equal((await rpc.status(binding.runId)).value.state, 'UNKNOWN');
  assert.equal((await rpc.interrupt(binding.runId)).ok, true); assert.equal((await rpc.stop(binding.runId)).ok, true);
  const before = fake.requests.length;
  assert.equal((await rpc.resume('foreign', 'Continue')).error.code, 'UNKNOWN_RUN');
  assert.equal((await rpc.interrupt('run')).error.code, 'UNKNOWN_RUN');
  assert.equal((await rpc.stop('all')).error.code, 'UNKNOWN_RUN');
  assert.equal(fake.requests.length, before);
  const resumed = await rpc.resume(binding.runId, 'Explicit host request'); assert.equal(resumed.ok, true); assert.notEqual(resumed.value.runId, binding.runId);
  fake.handler = q => { fake.reject(q, 'not_found', 'No exact run'); return true; };
  assert.equal((await rpc.status('absent')).error.code, 'UNKNOWN_RUN');
});
test('P5-012 — P4-compatible evidence drafts; advertisement alone never verifies async output', async t => {
  const { rpc, fake, binding } = await launched(t);
  assert.equal(rpc.evidence('e1', 'rpc-async-structured-output', ['proof']).status, 'UNVERIFIED');
  fake.emit(EVENT, completion(binding.runId)); assert.equal(rpc.acquire(binding.runId, valid).ok, true);
  assert.equal(rpc.evidence('e2', 'rpc-async-structured-output', []).status, 'UNVERIFIED');
  const e = rpc.evidence('e3', 'rpc-async-structured-output', ['proof']);
  assert.equal(e.status, 'VERIFIED'); assert.equal(contracts.validateStructure('CapabilityEvidence', e).ok, true);
  assert.equal(e.environmentHash, env.environmentHash);
});
test('P5-013 — cleanup after success, timeout, pending request, repeated disposal; inert constructor', async () => {
  for (let i = 0; i < 20; i++) {
    const fake = new Fake(); const rpc = new RpcAdapter(fake, env, 10);
    assert.equal(fake.count, 0); assert.equal(fake.requests.length, 0);
    await rpc.handshake(); fake.handler = () => true;
    const pending = rpc.spawn(input()); rpc.dispose(); rpc.dispose();
    const disposed = await pending;
    assert.equal(disposed.ok, false); assert.equal(disposed.dispatchOutcome, 'UNKNOWN'); assert.equal(fake.count, 0);
    assert.equal((await rpc.ping()).error.code, 'DISPOSED');
  }
});
test('P5-014 — hostile/bounded inputs, telemetry fractions, immutable wire copies', async t => {
  const { rpc, fake, binding } = await launched(t);
  for (const bad of [{ ...input(), action: 'create' }, { ...input(), timeoutMs: 0 }, { ...input(), outputSchema: {} }, new Proxy(input(), { get() { throw new Error('must not execute'); } })])
    assert.equal((await rpc.spawn(bad)).error.code, 'INVALID_INPUT');
  const e = completion(binding.runId); e.cost = 0.0123; fake.emit(EVENT, e); e.results[0].structuredOutput.nonce = 'mutated';
  assert.equal(rpc.acquire(binding.runId, valid).ok, true);
  const huge = {}; huge.circular = huge; fake.emit(EVENT, huge); assert.equal(rpc.integrity().ok, false);
});
test('controlled leaf dispatch disables the supervisor bridge without admitting caller overrides', async t => {
  const { rpc, fake } = await ready(t);
  for (const intercomBridge of [{ mode: 'always' }, { mode: 'fork-only' }, { mode: 'off' }]) {
    const count = fake.requests.length;
    const denied = await rpc.spawn({ ...input(), intercomBridge });
    assert.equal(denied.error.code, 'INVALID_INPUT');
    assert.equal(denied.dispatchOutcome, 'NOT_SENT');
    assert.equal(fake.requests.length, count);
  }
  for (const context of ['fresh', 'fork']) {
    const launched = await rpc.spawnWithContext(input(), context);
    assert.equal(launched.ok, true);
    const request = fake.requests.at(-1);
    assert.equal(request.method, 'spawn');
    assert.deepEqual(request.params.intercomBridge, { mode: 'off' });
    assert.equal(request.params.context, context);
    assert.ok(Object.isFrozen(request.params.intercomBridge));
    assert.equal((await rpc.resume(launched.value.runId, 'Explicit continuation')).ok, true);
    // RPC resume inherits the original spawn descriptor. The provider's
    // resume wire does not support a new intercomBridge override.
    assert.deepEqual(Object.keys(fake.requests.at(-1).params).sort(), ['id', 'message']);
  }
});
test('complete task requests above 64 KiB are transported, while UTF-8 overflow is explicit and undispatched',async t=>{
 const {rpc,fake}=await ready(t),value='🙂'.repeat(30000);
 const sent=await rpc.spawn({...input(),task:value});assert.equal(sent.ok,true);
 assert.equal(fake.requests.find(r=>r.method==='spawn').params.task,value);
 const count=fake.requests.length,result=await rpc.spawn({...input(),task:'🙂'.repeat(65537)});
 assert.equal(result.ok,false);assert.equal(result.error.code,'TASK_REQUEST_LIMIT');assert.equal(result.dispatchOutcome,'NOT_SENT');assert.equal(fake.requests.length,count);
});
test('P5-015 — shared request boundary rejects conflicts before every API returns', async t => {
  for (const method of ['ping', 'status', 'interrupt', 'stop']) {
    const { rpc, fake } = await launched(t);
    fake.handler = q => { fake.reply(q, { acknowledged: true }); fake.reply(q, { acknowledged: false }); return true; };
    const r = await rpc[method]('run-1'); assert.equal(r.error.code, 'DUPLICATE_CONFLICT'); assert.equal(r.dispatchOutcome, 'UNKNOWN');
  }
});
test('P5-016 TEST-026 — P4 semantic contract validator binds assignment/attempt; no workflow acceptance', async t => {
  const f = fixtures(contracts);
  f.AssignmentEnvelope.role = 'Scout'; f.AssignmentEnvelope.authority = ['OP-01'];
  f.AssignmentEnvelope.assignmentHash = contracts.hashContract('AssignmentEnvelope', f.AssignmentEnvelope);
  f.ScoutResult.assignmentHash = f.AssignmentEnvelope.assignmentHash;
  const ctx = context(f);
  const outputSchema = { type: 'object', additionalProperties: false, properties: Object.fromEntries(Object.keys(f.ScoutResult).map(k => [k, {}])), required: Object.keys(f.ScoutResult) };
  for (const attemptId of ['attempt', 'foreign-attempt']) {
    const { rpc, fake } = await ready(t);
    const r = await rpc.spawn({ ...input(), agent: 'scout', outputSchema }); assert.equal(r.ok, true);
    const e = completion(r.value.runId); e.results[0].agent = 'scout'; e.results[0].structuredOutput = { ...f.ScoutResult, attemptId };
    fake.emit(EVENT, e);
    const acquired = rpc.acquire(r.value.runId, value => contracts.validateContract('ScoutResult', value, ctx));
    assert.equal(acquired.ok, attemptId === 'attempt');
    if (acquired.ok) assert.equal(acquired.value.workflowAccepted, false);
    else assert.equal(acquired.error.code, 'INVALID_STRUCTURED_OUTPUT');
  }
});
test('P5-017 — productive read-only calls exceed the former total cap with bounded observers', async t => {
  const { rpc, fake } = await ready(t);
  for (let i = 0; i < 700; i++) assert.equal((await rpc.ping()).ok, true);
  assert.equal(fake.requests.length,701);assert.equal(fake.count,129);
  fake.reply(fake.requests.at(-1),{changed:true});
  assert.equal(rpc.integrity().error.code,'DUPLICATE_CONFLICT');
});
test('P5-017 — unresolved requests retain capacity and all listeners until disposal', async t => {
  const { rpc, fake } = await ready(t,undefined,60000);fake.handler=()=>true;
  const pending=Array.from({length:256},()=>rpc.ping());
  assert.equal((await rpc.ping()).error.code, 'CAPACITY_EXCEEDED');
  assert.equal(fake.requests.length,257);assert.equal(fake.count,258);
  rpc.dispose();for(const result of await Promise.all(pending))assert.equal(result.error.code,'DISPOSED');
  assert.equal(fake.count,0);
});
test('mutating replies retain late-conflict detection beyond the read-only history window',async t=>{
  const {rpc,fake}=await ready(t);const run=await rpc.spawn(input());assert.equal(run.ok,true);
  const original=fake.requests.find(r=>r.method==='spawn');
  for(let i=0;i<700;i++)assert.equal((await rpc.ping()).ok,true);
  fake.reply(original,{details:{asyncId:'foreign',runId:'foreign'}});
  assert.equal(rpc.integrity().error.code,'DUPLICATE_CONFLICT');
});

test('Reviewer request identity is observed before send, run before wait, child before terminal proof',async t=>{
  const {rpc,fake}=await ready(t),identities=[];
  fake.handler=q=>{if(q.method==='spawn')assert.equal(identities.at(-1).requestId,q.requestId)};
  const result=await rpc.spawn(input(),{onDispatchIdentity:value=>identities.push(value)});
  assert.equal(result.ok,true);assert.equal(identities.length,2);
  assert.equal(identities[0].runId,undefined);assert.equal(identities[1].runId,result.value.runId);
  const event=completion(result.value.runId);event.results[0].sessionFile='/public/child.jsonl';
  event.state='failed';event.success=false;
  fake.emit(EVENT,event);
  assert.equal(identities.at(-1).childSessionId,'/public/child.jsonl');
  assert.equal(rpc.acquire(result.value.runId,valid).error.code,'RUN_NOT_SUCCESSFUL');
});
test('durability failure before send prevents dispatch; after reply never retries',async t=>{
  const {rpc,fake}=await ready(t);
  const denied=await rpc.spawn(input(),{onDispatchIdentity(){throw new Error('store unavailable')}});
  assert.equal(denied.ok,false);assert.equal(fake.requests.filter(q=>q.method==='spawn').length,0);
  await assert.rejects(rpc.spawn(input(),{onDispatchIdentity(v){if(v.runId)throw new Error('store unavailable')}}),/store unavailable/);
  assert.equal(fake.requests.filter(q=>q.method==='spawn').length,1);
});
test('dispatch timeout retains exact request without invented run or session',async t=>{
  const {rpc,fake}=await ready(t,new Fake(),10),observed=[];
  fake.handler=q=>q.method==='spawn';
  const result=await rpc.spawn(input(),{onDispatchIdentity:v=>observed.push(v)});
  assert.equal(result.ok,false);assert.equal(result.error.code,'DISPATCH_OUTCOME_UNKNOWN');
  assert.equal(observed.length,1);assert.equal(observed[0].requestId,result.error.requestId);
  assert.equal(observed[0].runId,undefined);assert.equal(observed[0].childSessionId,undefined);
});

test('explicit fresh Reviewer dispatch has fresh request, run and child session identities',async t=>{
  const {rpc,fake}=await ready(t),attempts=[];
  for(let i=0;i<2;i++){
    const seen=[],r=await rpc.spawn(input(),{onDispatchIdentity:v=>seen.push(v)});assert.equal(r.ok,true);
    const event=completion(r.value.runId);event.results[0].sessionFile=`/public/child-${i}.jsonl`;
    fake.emit(EVENT,event);attempts.push(seen.at(-1));
  }
  for(const key of ['requestId','runId','childSessionId'])assert.notEqual(attempts[0][key],attempts[1][key]);
  assert.equal(fake.requests.filter(q=>q.method==='spawn').length,2);
});
