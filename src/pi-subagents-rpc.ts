/** P5 transport only. Trusted host supplies pi.events and validators.
 * No workflow authority, persistence, retries, file reads, or fallback runners.
 * Receipts are observations: recheck integrity before consuming them. A late
 * conflicting reply/completion quarantines the session, never rewrites workflow state.
 */
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { types, isDeepStrictEqual } from 'node:util';
import { setTimeout, clearTimeout } from 'node:timers';
import type { Timeout } from 'node:timers';
import type { CapabilityEvidence } from './contracts.js';

export interface RpcEvents {
  on(name: string, listener: (data: unknown) => void): () => void;
  emit(name: string, data: unknown): void;
}
export type Method = 'ping' | 'spawn' | 'status' | 'interrupt' | 'stop' | 'resume';
export type ErrorCode = 'HOST_ENVIRONMENT_UNSUPPORTED' | 'RPC_UNAVAILABLE' | 'RPC_INCOMPATIBLE'
  | 'MALFORMED_REPLY' | 'TIMEOUT' | 'FOREIGN_REPLY' | 'DUPLICATE_CONFLICT' | 'MISSING_CAPABILITY'
  | 'SPAWN_REJECTED' | 'DISPATCH_OUTCOME_UNKNOWN' | 'MISSING_STRUCTURED_OUTPUT'
  | 'INVALID_STRUCTURED_OUTPUT' | 'UNKNOWN_RUN' | 'COMPLETION_CONFLICT' | 'FOREIGN_COMPLETION'
  | 'COMPLETION_PENDING' | 'RUN_NOT_SUCCESSFUL' | 'INVALID_INPUT' | 'TASK_REQUEST_LIMIT' | 'DISPOSED' | 'CAPACITY_EXCEEDED'
  | 'TERMINAL_PROOF_CAPABILITY_UNAVAILABLE' | 'TERMINAL_PROOF_UNAVAILABLE' | 'TERMINAL_PROOF_BINDING_INVALID';
export type RpcError = Readonly<{ code: ErrorCode; requestId?: string; runId?: string; providerCode?: string }>;
export type Result<T> = Readonly<{ ok: true; value: T; requestId?: string }>
  | Readonly<{ ok: false; error: RpcError; dispatchOutcome: 'NOT_SENT' | 'UNKNOWN' | 'REPLIED' }>;
export type Wire = null | undefined | boolean | number | string | readonly Wire[] | { readonly [key: string]: Wire };
type RecordData = { readonly [key: string]: Wire };
export type Handshake = Readonly<{
  status: 'VERIFIED' | 'UNVERIFIED' | 'INCOMPATIBLE' | 'UNAVAILABLE';
  scope: 'rpc-ping-only'; asyncStructuredOutput: 'UNVERIFIED';
  advertised?: RecordData; asyncComplete?: string; capabilities?: ProviderCapabilities; providerVersion?: string; error?: RpcError;
}>;
export type LiveTerminationMode = 'FULL' | 'OBSERVE_ONLY' | 'LOGICAL_ONLY' | 'UNAVAILABLE';
export type ProviderCapabilities = Readonly<{
  asyncSpawn:boolean; status:boolean; interrupt:boolean; stop:boolean; resume:boolean;
  processTerminalProof:boolean; asyncComplete:boolean;
}>;
export interface Environment {
  readonly sessionId: string;
  readonly environmentHash: string; // Host binds versions, configuration and environment to retained evidence.
  readonly piVersion: string;
  readonly subagentsVersion: string;
}
export interface SpawnInput {
  readonly agent: string; readonly task: string; readonly cwd: string;
  readonly timeoutMs: number; readonly outputSchema: RecordData;
}
export type Binding = Readonly<{ requestId: string; runId: string; agent: string; ownerSessionId: string }>;
export type Checked<T> = Readonly<{ ok: true; value: T; level: 'semantic-data-only' | 'probe-schema-only' }>
  | Readonly<{ ok: false }>;
export type RuntimeEvidence = Readonly<{
  context: 'fresh' | 'fork'; sessionFile?: string; launchResolvedExtensions?: RecordData;
  launchContractDigest?: string;
}>;
type RunStatus=Readonly<{runId:string;state:string|'UNKNOWN';reply:RecordData}>;
export type Acquired<T> = Readonly<{
  binding: Binding; value: T; kind: 'validated-transport-output'; workflowAccepted: false;
  providerAcceptance: Wire; runtimeEvidence: RuntimeEvidence;
}>;
export interface TerminalProof {
  readonly schemaVersion:1; readonly runId:string; readonly role:'Scout'|'Developer'|'Reviewer'|'Oracle';
  readonly requestId:string; readonly ownerSessionId:string; readonly childSessionId:string;
  readonly statusRequestId:string; readonly completionSessionId:string; readonly terminalStatus:'complete'|'failed'|'stopped';
  readonly observedAt:string; readonly source:'targeted-rpc-status';
  readonly provider:{readonly version:1;readonly state:'observed';readonly runId:string;readonly runnerProcessInstanceId:string;
    readonly observedAt:number;readonly instances:readonly {readonly kind:'runner';readonly processInstanceId:string;
      readonly closeObservedAt:number;readonly exitCode:number|null;readonly signal:string|null}[];readonly resumeDisposition:string};
}
export interface DispatchIdentity {
  readonly requestId:string; readonly ownerSessionId:string; readonly agent:string;
  readonly runId?:string; readonly childSessionId?:string;
}
export interface TerminalProofOptions {
  readonly onTerminalProof?:(proof:TerminalProof)=>void;
  readonly onDispatchIdentity?:(identity:DispatchIdentity)=>void;
}
const acquiredIdentities=new WeakSet<object>();
export function isAcquiredDispatchIdentity(identity:DispatchIdentity):boolean{return acquiredIdentities.has(identity)}
const acquiredProofs=new WeakSet<object>();
export function isAcquiredTerminalProof(proof:TerminalProof):boolean{return acquiredProofs.has(proof)}
/** Integrity/binding verification of a previously acquired projection, not authentication of arbitrary JSON. */
export function verifyTerminalProof(input:unknown,expected:Pick<TerminalProof,'runId'|'role'|'ownerSessionId'|'requestId'> & {childSessionId?:string}):input is TerminalProof{
  try{
    const p=snapshot(input) as any,keys=(value:any,names:string)=>record(value)&&Object.keys(value).sort().join(',')===names.split(',').sort().join(',');
    if(!keys(p,'schemaVersion,runId,role,requestId,ownerSessionId,childSessionId,statusRequestId,completionSessionId,terminalStatus,observedAt,source,provider')
      ||p.schemaVersion!==1||p.source!=='targeted-rpc-status'||!['Scout','Developer','Reviewer','Oracle'].includes(p.role)
      ||!['complete','failed','stopped'].includes(p.terminalStatus)||!/^\d{4}-\d\d-\d\dT.*Z$/.test(p.observedAt)||!Number.isFinite(Date.parse(p.observedAt)))return false;
    for(const k of ['runId','role','ownerSessionId','requestId','childSessionId','statusRequestId','completionSessionId'])if(!text(p[k]))return false;
    for(const [key,value] of Object.entries(expected))if(p[key]!==value)return false;
    const e=p.provider;if(!keys(e,'version,state,runId,runnerProcessInstanceId,observedAt,instances,resumeDisposition')||e.version!==1||e.state!=='observed'
      ||e.runId!==p.runId||!text(e.runnerProcessInstanceId)||!Number.isSafeInteger(e.observedAt)||e.observedAt<0||!text(e.resumeDisposition)
      ||!Array.isArray(e.instances)||e.instances.length!==1)return false;
    const i=e.instances[0];return keys(i,'kind,processInstanceId,closeObservedAt,exitCode,signal')&&i.kind==='runner'
      &&i.processInstanceId===e.runnerProcessInstanceId&&Number.isSafeInteger(i.closeObservedAt)&&i.closeObservedAt>=0&&i.closeObservedAt<=e.observedAt
      &&(i.exitCode===null||Number.isSafeInteger(i.exitCode))&&(i.signal===null||text(i.signal))&&(i.exitCode!==null||i.signal!==null);
  }catch{return false}
}
const REQUEST = 'subagents:rpc:v1:request';
const REPLY = 'subagents:rpc:v1:reply:';
// Controlled roles are leaf workers. The provider defaults the bridge to
// "always", which adds supervisor instructions even when its tool is excluded.
// Bind this per-launch override instead of changing the user's global profile.
const CONTROLLED_INTERCOM_BRIDGE = Object.freeze({ mode: 'off' });
const METHODS: readonly Method[] = ['ping', 'spawn', 'status', 'interrupt', 'stop', 'resume'];
const HOST_ERROR = 'Background children require a supported standalone Pi host or the installed npm package (@earendil-works/pi-coding-agent); neither is available.';
function record(v: Wire): v is RecordData { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function text(v: unknown): v is string { return typeof v === 'string' && v.length > 0 && v.length <= 65536 && !v.includes('\0'); }
export const MAX_TASK_REQUEST_BYTES=256*1024;
function taskText(v:unknown):v is string{return typeof v==='string'&&v.length>0&&!v.includes('\0')&&Buffer.byteLength(v,'utf8')<=MAX_TASK_REQUEST_BYTES}
function timeout(v: unknown): v is number { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= 2147483647; }
function failure(code: ErrorCode, dispatchOutcome: 'NOT_SENT' | 'UNKNOWN' | 'REPLIED' = 'NOT_SENT', ids: Omit<RpcError, 'code'> = {}): Result<never> {
  return Object.freeze({ ok: false, error: Object.freeze({ code, ...ids }), dispatchOutcome });
}
function success<T>(value: T, requestId?: string): Result<T> {
  return Object.freeze({ ok: true, value, ...(requestId ? { requestId } : {}) });
}
/** Inert bounded wire snapshot, NOT DAT-000 canonicalization. Provider telemetry
 * contains fractional costs and optional undefined fields; P4 remains unchanged.
 */
function snapshot(input: unknown): Wire {
  let nodes = 0, characters = 0;
  const active = new Set<object>();
  function copy(v: unknown, depth: number): Wire {
    if (++nodes > 32768 || depth > 48) throw new Error('WIRE_LIMIT');
    if (v === null || v === undefined || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      characters += v.length;
      if (characters > 1048576 || /[\uD800-\uDFFF]/u.test(v)) throw new Error('WIRE_STRING');
      return v;
    }
    if (typeof v !== 'object' || types.isProxy(v) || active.has(v)) throw new Error('WIRE_OBJECT');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== null && proto !== Object.prototype) throw new Error('WIRE_PROTOTYPE');
    const ds = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(v);
    for (const key of keys) {
      if (typeof key !== 'string' || !('value' in ds[key]) || (!ds[key].enumerable && !(array && key === 'length'))) throw new Error('WIRE_DESCRIPTOR');
      characters += key.length;
      if (characters > 1048576) throw new Error('WIRE_LIMIT');
    }
    active.add(v);
    let out: Wire;
    if (array) {
      const length = ds.length.value as number;
      if (length > 32768 || keys.length !== length + 1) throw new Error('WIRE_ARRAY');
      const items: Wire[] = [];
      for (let i = 0; i < length; i++) {
        if (!Object.hasOwn(ds, String(i))) throw new Error('WIRE_ARRAY');
        items.push(copy(ds[String(i)].value, depth + 1));
      }
      out = Object.freeze(items);
    } else out = Object.freeze(Object.fromEntries((keys as string[]).map(k => [k, copy(ds[k].value, depth + 1)])));
    active.delete(v); return out;
  }
  return copy(input, 0);
}
interface Pending {
  method: Method; reply?: Wire; result?: Result<RecordData>; timer?: Timeout; off?: () => void;
  resolve: (result: Result<RecordData>) => void;
}
interface Run { binding: Binding; context: 'fresh' | 'fork'; event?: RecordData; onDispatchIdentity?:TerminalProofOptions['onDispatchIdentity'] }

export class RpcAdapter {
  readonly #events: RpcEvents | undefined;
  readonly #environment: Environment;
  readonly #timeout: number;
  readonly #requests = new Map<string, Pending>();
  readonly #activeRequests = new Set<string>();
  readonly #completedReads = new Map<string, Pending>();
  readonly #runs = new Map<string, Run>();
  readonly #early = new Map<string, RecordData>();
  readonly #offs = new Set<() => void>();
  readonly #issues: RpcError[] = [];
  readonly #observers = new Set<(runId: string | undefined) => void>();
  #fault: RpcError | undefined;
  #closed = false;
  #pendingLaunches = 0;
  #hello: Handshake | undefined;
  #helloPromise: Promise<Handshake> | undefined;
  #sessionFile: string | undefined;
  #structuredObserved = false;

  constructor(events: RpcEvents | undefined, environment: Environment, timeoutMs = 5000) {
    const env = snapshot(environment);
    if (!record(env) || Object.keys(env).sort().join(',') !== 'environmentHash,piVersion,sessionId,subagentsVersion'
      || !text(env.sessionId) || !text(env.piVersion) || !text(env.subagentsVersion)
      || typeof env.environmentHash !== 'string' || !/^[a-f0-9]{64}$/.test(env.environmentHash) || !timeout(timeoutMs)) throw new TypeError('INVALID_RPC_OPTIONS');
    this.#environment = env as unknown as Environment;
    this.#events = events; this.#timeout = timeoutMs;
  }
  issues(): readonly RpcError[] { return Object.freeze([...this.#issues]); }
  observe(listener: (runId: string | undefined) => void): () => void {
    if (this.#closed || typeof listener !== 'function' || this.#observers.size >= 64) throw new TypeError('INVALID_OBSERVER');
    this.#observers.add(listener);
    return () => { this.#observers.delete(listener); };
  }
  #notify(runId?: string): void {
    for (const listener of this.#observers) {
      try { listener(runId); } catch { this.#fault ??= Object.freeze({ code: 'RPC_UNAVAILABLE' }); }
    }
  }
  integrity(): Result<true> { return this.#closed ? failure('DISPOSED') : this.#fault ? Object.freeze({ ok: false, error: this.#fault, dispatchOutcome: 'UNKNOWN' }) : success(true); }
  #note(error: RpcError, quarantine = false): void {
    if (this.#issues.length < 256) this.#issues.push(Object.freeze(error));
    else quarantine = true;
    if (quarantine) { this.#fault ??= Object.freeze(error); this.#notify(error.runId); }
  }
  #listen(name: string, listener: (v: unknown) => void): () => void {
    const off = this.#events!.on(name, listener);
    if (typeof off !== 'function') throw new Error('CLEANUP_UNAVAILABLE');
    this.#offs.add(off);
    return off;
  }
  #request(method: Method, params: RecordData = {}, beforeSend?:(requestId:string)=>void): Promise<Result<RecordData>> {
    const integrity = this.integrity();
    if (!integrity.ok) return Promise.resolve(integrity);
    if (!this.#events || typeof this.#events.on !== 'function' || typeof this.#events.emit !== 'function') return Promise.resolve(failure('RPC_UNAVAILABLE'));
    // Bound concurrent/uncertain requests, never the accumulated amount of work.
    // Mutating replies remain observed for this adapter's lifetime. Successful
    // read-only replies retain a bounded late-conflict window.
    if (this.#activeRequests.size >= 256) return Promise.resolve(failure('CAPACITY_EXCEEDED'));
    const requestId = randomUUID();
    if (this.#requests.has(requestId)) return Promise.resolve(failure('DUPLICATE_CONFLICT'));
    return new Promise<Result<RecordData>>(resolve => {
      const p: Pending = { method, resolve }; this.#requests.set(requestId, p);this.#activeRequests.add(requestId);
      const finish = (result: Result<RecordData>) => {
        if (p.result) return;
        p.result = result; clearTimeout(p.timer);
        if(result.ok||result.dispatchOutcome!=='UNKNOWN')this.#activeRequests.delete(requestId);
        if(result.ok&&['ping','status'].includes(method)){
          this.#requests.delete(requestId);this.#completedReads.set(requestId,p);
          while(this.#completedReads.size>128){const [id,expired]=this.#completedReads.entries().next().value!;expired.off?.();if(expired.off)this.#offs.delete(expired.off);this.#completedReads.delete(id)}
        }
        resolve(result);
      };
      let dispatched = false;
      try {
        p.off=this.#listen(REPLY + requestId, input => {
          if (this.#closed) return;
          let reply: Wire;
          try { reply = snapshot(input); } catch {
            if (p.result) this.#note({ code: 'MALFORMED_REPLY', requestId }, true);
            finish(failure('MALFORMED_REPLY', dispatched ? 'UNKNOWN' : 'NOT_SENT', { requestId })); return;
          }
          if (!record(reply) || reply.requestId !== requestId) {
            this.#note({ code: 'FOREIGN_REPLY', requestId });
            finish(failure('FOREIGN_REPLY', 'UNKNOWN', { requestId })); return;
          }
          if (p.reply !== undefined) {
            if (!isDeepStrictEqual(p.reply, reply)) this.#note({ code: 'DUPLICATE_CONFLICT', requestId }, true);
            return;
          }
          p.reply = reply;
          const keys = Object.keys(reply);
          if (reply.version !== 1 || (reply.method !== undefined && reply.method !== method)
            || typeof reply.success !== 'boolean' || keys.some(k => !['version','requestId','method','success','data','error'].includes(k))) {
            finish(failure('RPC_INCOMPATIBLE', 'UNKNOWN', { requestId })); return;
          }
          if (reply.success === false) {
            const e = reply.error;
            if (!record(e) || !text(e.code) || !text(e.message) || Object.hasOwn(reply, 'data')) { finish(failure('MALFORMED_REPLY', 'UNKNOWN', { requestId })); return; }
            // This is a structured provider error, never parsing run IDs or UI text.
            const code: ErrorCode = e.code === 'execution_failed' && e.message.endsWith(HOST_ERROR) ? 'HOST_ENVIRONMENT_UNSUPPORTED'
              : e.code === 'unsupported_version' || e.code === 'unsupported_method' ? 'RPC_INCOMPATIBLE'
              : e.code === 'not_found' ? 'UNKNOWN_RUN' : method === 'spawn' || method === 'resume' ? 'SPAWN_REJECTED' : 'RPC_UNAVAILABLE';
            finish(failure(code, method === 'spawn' || method === 'resume' ? 'UNKNOWN' : 'REPLIED', { requestId, providerCode: e.code })); return;
          }
          if (!record(reply.data) || Object.hasOwn(reply, 'error')) { finish(failure('MALFORMED_REPLY', 'UNKNOWN', { requestId })); return; }
          finish(success(reply.data, requestId));
        });
        p.timer = setTimeout(() => finish(failure(method === 'spawn' || method === 'resume' ? 'DISPATCH_OUTCOME_UNKNOWN' : 'TIMEOUT', 'UNKNOWN', { requestId })), this.#timeout);
        beforeSend?.(requestId);
        dispatched = true;
        this.#events!.emit(REQUEST, { version: 1, requestId, method, params });
      } catch {
        if (dispatched) this.#note({ code: 'DISPATCH_OUTCOME_UNKNOWN', requestId }, true);
        finish(failure(dispatched ? 'DISPATCH_OUTCOME_UNKNOWN' : 'RPC_UNAVAILABLE', dispatched ? 'UNKNOWN' : 'NOT_SENT', { requestId }));
      }
    }).then(result => {
      const current = this.integrity();
      return current.ok ? result : Object.freeze({ ...current, dispatchOutcome: 'UNKNOWN' });
    });
  }
  ping(): Promise<Result<RecordData>> { return this.#request('ping'); }
  handshake(): Promise<Handshake> {
    const integrity = this.integrity();
    if (!integrity.ok) return Promise.resolve(Object.freeze({ status: 'UNAVAILABLE', scope: 'rpc-ping-only', asyncStructuredOutput: 'UNVERIFIED', error: integrity.error }));
    return this.#helloPromise ??= this.#handshake();
  }
  async #handshake(): Promise<Handshake> {
    const reply = await this.ping();
    const base = { scope: 'rpc-ping-only', asyncStructuredOutput: 'UNVERIFIED' } as const;
    const integrity = this.integrity();
    if (!integrity.ok) return Object.freeze({ ...base, status: 'INCOMPATIBLE', error: integrity.error });
    if (!reply.ok) return Object.freeze({ ...base, status: reply.error.code === 'RPC_INCOMPATIBLE' ? 'INCOMPATIBLE' : 'UNAVAILABLE', error: reply.error });
    const p = reply.value, caps = p.capabilities, events = p.events, session = p.session, methods = p.methods;
    if (p.version !== 1 || !record(caps) || !Array.isArray(methods) || !record(session) || session.sessionId !== this.#environment.sessionId)
      return Object.freeze({ ...base, status: 'INCOMPATIBLE', error: { code: 'RPC_INCOMPATIBLE' as const } });
    if (methods.some(m => !text(m)) || new Set(methods).size !== methods.length
      || (events !== undefined && !record(events)) || (caps.events !== undefined && !record(caps.events))
      || (record(events) && ((events.request !== undefined && events.request !== REQUEST)
        || (events.replyPrefix !== undefined && events.replyPrefix !== REPLY)
        || (events.ready !== undefined && events.ready !== 'subagents:rpc:v1:ready'))))
      return Object.freeze({ ...base, status: 'INCOMPATIBLE', error: { code: 'RPC_INCOMPATIBLE' as const } });
    const a = record(events) ? events.asyncComplete : undefined;
    const b = record(caps.events) ? caps.events.asyncComplete : undefined;
    if ((a !== undefined && !text(a)) || (b !== undefined && !text(b)) || (a !== undefined && b !== undefined && a !== b))
      return Object.freeze({ ...base, status: 'INCOMPATIBLE', error: { code: 'RPC_INCOMPATIBLE' as const } });
    const name = a ?? b;
    if (session.sessionFile !== null && session.sessionFile !== undefined && !text(session.sessionFile))
      return Object.freeze({ ...base, status: 'INCOMPATIBLE', error: { code: 'RPC_INCOMPATIBLE' as const } });
    this.#sessionFile = typeof session.sessionFile === 'string' ? session.sessionFile : undefined;
    if (text(name)) try { this.#listen(name, value => this.#completion(value)); }
    catch { return Object.freeze({ ...base, status: 'UNAVAILABLE', error: { code: 'RPC_UNAVAILABLE' as const } }); }
    const has=(method:Method,capability:string)=>methods.includes(method)&&caps[capability]===true;
    const capabilities:ProviderCapabilities=Object.freeze({
      asyncSpawn:has('spawn','asyncSpawn'),status:has('status','status'),interrupt:has('interrupt','interrupt'),
      stop:has('stop','stop'),resume:has('resume','resume'),
      processTerminalProof:record(caps.processTerminalProof)&&caps.processTerminalProof.version===1&&caps.processTerminalProof.lifecycleArtifactVersion===3,
      asyncComplete:text(name),
    });
    const providerVersion=text(p.providerVersion)?p.providerVersion:undefined;
    this.#hello = Object.freeze({ ...base, status: 'VERIFIED', advertised: p, capabilities,
      ...(text(name)?{asyncComplete:name}:{}),...(providerVersion?{providerVersion}: {}) });
    return this.#hello;
  }
  capabilities():ProviderCapabilities|undefined{return this.#hello?.capabilities}
  providerVersion():string|undefined{return this.#hello?.providerVersion}
  liveTerminationMode():LiveTerminationMode{
    const c=this.capabilities();
    return !c?.status?'UNAVAILABLE':!c.processTerminalProof||!c.asyncComplete?'LOGICAL_ONLY':c.stop?'FULL':'OBSERVE_ONLY';
  }
  #ready(method:Exclude<Method,'ping'>,capability:keyof ProviderCapabilities,completion=false): Result<true> {
    const integrity = this.integrity();
    if(!integrity.ok)return integrity;
    const hello=this.#hello,caps=hello?.capabilities,methods=hello?.advertised?.methods;
    return hello?.status==='VERIFIED'&&Array.isArray(methods)&&methods.includes(method)&&caps?.[capability]===true&&(!completion||caps.asyncComplete)
      ?success(true):failure('MISSING_CAPABILITY');
  }
  spawn(input: SpawnInput, options:TerminalProofOptions={}): Promise<Result<Binding>> { return this.spawnWithContext(input, 'fresh',options); }
  async spawnWithContext(input: SpawnInput, context: 'fresh' | 'fork', options:TerminalProofOptions={}): Promise<Result<Binding>> {
    const ready = this.#ready('spawn','asyncSpawn',true); if (!ready.ok) return ready;
    let p: Wire;
    try { p = snapshot(input); } catch { return failure('INVALID_INPUT'); }
    if(record(p)&&typeof p.task==='string'&&Buffer.byteLength(p.task,'utf8')>MAX_TASK_REQUEST_BYTES)return failure('TASK_REQUEST_LIMIT');
    if (!record(p) || Object.keys(p).sort().join(',') !== 'agent,cwd,outputSchema,task,timeoutMs'
      || !text(p.agent) || !taskText(p.task) || !text(p.cwd) || !timeout(p.timeoutMs)
      || !record(p.outputSchema) || p.outputSchema.type !== 'object' || p.outputSchema.additionalProperties !== false
      || !['fresh','fork'].includes(context)) return failure('INVALID_INPUT');
    return this.#launch('spawn', { ...p, async: true, context, skill: false, mission: false,
      intercomBridge: CONTROLLED_INTERCOM_BRIDGE }, p.agent, context,options);
  }
  async #launch(method: 'spawn' | 'resume', params: RecordData, agent: string, context: 'fresh' | 'fork',options:TerminalProofOptions={}): Promise<Result<Binding>> {
    this.#pendingLaunches++;
    try {
      const r = await this.#request(method, params,requestId=>this.#dispatchIdentity({requestId,agent,ownerSessionId:this.#environment.sessionId},options.onDispatchIdentity));
      const integrity = this.integrity();
      if (!integrity.ok) return Object.freeze({ ...integrity, dispatchOutcome: 'UNKNOWN' });
      if (!r.ok) return r;
      const d = r.value.details;
      if (!record(d) || !text(d.asyncId) || d.runId !== d.asyncId || r.value.isError === true) return failure('DISPATCH_OUTCOME_UNKNOWN', 'UNKNOWN', { requestId: r.requestId });
      if (this.#runs.has(d.asyncId)) { this.#note({ code: 'DUPLICATE_CONFLICT', runId: d.asyncId }, true); return failure('DUPLICATE_CONFLICT', 'UNKNOWN'); }
      const binding = Object.freeze({ requestId: r.requestId!, runId: d.asyncId, agent, ownerSessionId: this.#environment.sessionId });
      const run: Run = { binding, context, onDispatchIdentity:options.onDispatchIdentity }; this.#runs.set(binding.runId, run);
      this.#dispatchIdentity(binding,run.onDispatchIdentity);
      const early = this.#early.get(binding.runId);
      if (early) { run.event = early; this.#bindChildSession(run,early); this.#early.delete(binding.runId); this.#notify(binding.runId); }
      return success(binding, binding.requestId);
    } finally { this.#pendingLaunches--; }
  }
  #dispatchIdentity(identity:DispatchIdentity,observe?:TerminalProofOptions['onDispatchIdentity']):void{
    if(!observe)return;
    const value=Object.freeze({...identity});acquiredIdentities.add(value);observe(value);
  }
  #bindChildSession(run:Run,event:RecordData):void{
    const children=event.results;
    if(!Array.isArray(children)||children.length!==1)return;
    const child=children[0];
    if(record(child)&&child.agent===run.binding.agent&&text(child.sessionFile))
      this.#dispatchIdentity({...run.binding,childSessionId:child.sessionFile},run.onDispatchIdentity);
  }
  #completion(input: unknown): void {
    if (this.#closed) return;
    let e: Wire;
    try { e = snapshot(input); } catch { this.#note({ code: 'COMPLETION_CONFLICT' }, true); return; }
    if (!record(e) || !text(e.runId) || e.id !== e.runId || (e.sessionId !== this.#environment.sessionId && (!this.#sessionFile || e.sessionId !== this.#sessionFile))) {
      this.#note({ code: 'FOREIGN_COMPLETION' }); return;
    }
    const run = this.#runs.get(e.runId), previous = run?.event ?? this.#early.get(e.runId);
    if (previous) {
      if (!isDeepStrictEqual(previous, e)) this.#note({ code: 'COMPLETION_CONFLICT', runId: e.runId }, true);
      return;
    }
    if (run) { run.event = e; try{this.#bindChildSession(run,e)}catch{this.#note({code:'DISPATCH_OUTCOME_UNKNOWN',runId:e.runId},true)} this.#notify(e.runId); }
    else if (this.#pendingLaunches) {
      if (this.#early.size >= 64) this.#note({ code: 'CAPACITY_EXCEEDED' }, true);
      else this.#early.set(e.runId, e);
    } else this.#note({ code: 'FOREIGN_COMPLETION', runId: e.runId });
  }
  /** Bound completion metadata, including failed runs. This observes runtime
   * identity only; it accepts no model output and proves no physical exit. */
  runtimeEvidence(runId:string):Result<RuntimeEvidence & {readonly state:'complete'|'failed'|'stopped';readonly completionSessionId:string}>{
    const integrity=this.integrity();if(!integrity.ok)return integrity;
    const run=this.#runs.get(runId);if(!run)return failure('UNKNOWN_RUN');
    const event=run.event;if(!event)return failure('COMPLETION_PENDING','UNKNOWN',{runId});
    if(!['complete','failed','stopped'].includes(String(event.state))||!text(event.sessionId)||!Array.isArray(event.results)||event.results.length!==1)return failure('FOREIGN_COMPLETION','UNKNOWN',{runId});
    const child=event.results[0];
    if(!record(child)||child.agent!==run.binding.agent||child.context!==run.context||!text(child.sessionFile)
      ||!record(child.launchResolvedExtensions))return failure('FOREIGN_COMPLETION','UNKNOWN',{runId});
    return success(Object.freeze({context:run.context,sessionFile:child.sessionFile,launchResolvedExtensions:child.launchResolvedExtensions,
      state:event.state as 'complete'|'failed'|'stopped',completionSessionId:event.sessionId}));
  }
  acquire<T>(runId: string, validate: (value: unknown) => Checked<T>): Result<Acquired<T>> {
    const integrity = this.integrity(); if (!integrity.ok) return integrity;
    const run = this.#runs.get(runId); if (!run) return failure('UNKNOWN_RUN');
    const e = run.event; if (!e) return failure('COMPLETION_PENDING', 'UNKNOWN', { runId });
    if (e.success !== true || e.state !== 'complete' || e.exitCode !== 0 || !Array.isArray(e.results) || e.results.length !== 1)
      return failure('RUN_NOT_SUCCESSFUL', 'REPLIED', { runId });
    const child = e.results[0];
    if (!record(child) || child.agent !== run.binding.agent || child.context !== run.context || child.success !== true || child.status !== 'completed') return failure('FOREIGN_COMPLETION', 'UNKNOWN', { runId });
    const extensions = child.launchResolvedExtensions;
    if (child.sessionFile !== undefined && !text(child.sessionFile)) return failure('FOREIGN_COMPLETION', 'UNKNOWN', { runId });
    if (extensions !== undefined && !record(extensions)) return failure('FOREIGN_COMPLETION', 'UNKNOWN', { runId });
    if (child.launchContractDigest !== undefined && !text(child.launchContractDigest)) return failure('FOREIGN_COMPLETION', 'UNKNOWN', { runId });
    if (child.structuredOutput === undefined) return failure('MISSING_STRUCTURED_OUTPUT', 'REPLIED', { runId });
    // Inferred acceptance is observational in the provider. Explicit failed gates
    // reject acquisition; neither category substitutes for the host's P4 validator.
    if (record(child.acceptance) && child.acceptance.explicit !== false
      && child.acceptance.status !== 'accepted' && child.acceptance.status !== 'not-required') return failure('RUN_NOT_SUCCESSFUL', 'REPLIED', { runId });
    try {
      const checked = validate(child.structuredOutput);
      if (!checked.ok || !['semantic-data-only','probe-schema-only'].includes(checked.level) || !isDeepStrictEqual(checked.value, child.structuredOutput)) return failure('INVALID_STRUCTURED_OUTPUT', 'REPLIED', { runId });
      const value = snapshot(checked.value) as T;
      const current = this.integrity(); if (!current.ok) return current;
      this.#structuredObserved = true;
      const runtimeEvidence = Object.freeze({ context: run.context,
        ...(typeof child.sessionFile === 'string' ? { sessionFile: child.sessionFile } : {}),
        ...(record(extensions) ? { launchResolvedExtensions: extensions } : {}),
        ...(typeof child.launchContractDigest === 'string' ? { launchContractDigest: child.launchContractDigest } : {}) });
      return success(Object.freeze({ binding: run.binding, value, kind: 'validated-transport-output', workflowAccepted: false,
        providerAcceptance: child.acceptance, runtimeEvidence }), run.binding.requestId);
    } catch { return failure('INVALID_STRUCTURED_OUTPUT', 'REPLIED', { runId }); }
  }
  terminalProofCapability():boolean{
    const caps=this.capabilities();return this.integrity().ok&&caps?.status===true&&caps.processTerminalProof&&caps.asyncComplete;
  }
  async withTerminalProof<T>(runId:string,result:Promise<T>,observe?:TerminalProofOptions['onTerminalProof'],waitMs=5_000):Promise<T>{
    try{return await result}finally{if(observe){const proof=await this.awaitTerminalProof(runId,waitMs);
      if(!proof.ok)throw new Error(proof.error.code);observe(proof.value)}}
  }
  async awaitTerminalProof(runId:string,waitMs=5_000):Promise<Result<TerminalProof>>{
    if(!text(runId)||!timeout(waitMs))return failure('INVALID_INPUT');
    if(!this.terminalProofCapability())return failure('TERMINAL_PROOF_CAPABILITY_UNAVAILABLE');
    if(!this.#runs.has(runId))return failure('UNKNOWN_RUN');
    const deadline=Date.now()+waitMs;let stopAttempted=false;
    while(Date.now()<deadline){
      const status=await this.status(runId);if(!status.ok)return status;
      if(['complete','failed','stopped'].includes(status.value.state)){
        const proof=this.#terminalProofFromStatus(runId,status.value,status.requestId);if(proof.ok)return proof;
        if(!['TERMINAL_PROOF_UNAVAILABLE','COMPLETION_PENDING'].includes(proof.error.code))return proof;
      }else if(['queued','running','paused'].includes(status.value.state)&&!stopAttempted&&this.capabilities()?.stop){
        stopAttempted=true;await this.stop(runId);
      }
      const remaining=deadline-Date.now();if(remaining<=0)break;
      await new Promise<void>(resolve=>setTimeout(resolve,Math.min(100,remaining)));
    }
    return failure('TERMINAL_PROOF_UNAVAILABLE','UNKNOWN',{runId});
  }
  async acquireTerminalProof(runId:string):Promise<Result<TerminalProof>>{
    if(!this.terminalProofCapability())return failure('TERMINAL_PROOF_CAPABILITY_UNAVAILABLE');
    const run=this.#runs.get(runId);if(!run)return failure('UNKNOWN_RUN');
    const status=await this.status(runId);if(!status.ok)return status;
    return this.#terminalProofFromStatus(runId,status.value,status.requestId);
  }
  #terminalProofFromStatus(runId:string,status:RunStatus,statusRequestId?:string):Result<TerminalProof>{
    const run=this.#runs.get(runId);if(!run)return failure('UNKNOWN_RUN');
    const event=run.event;
    if(!event||!['complete','failed','stopped'].includes(String(event.state))||!Array.isArray(event.results)||event.results.length!==1)
      return failure('TERMINAL_PROOF_UNAVAILABLE','UNKNOWN',{runId});
    const child=event.results[0],roles={ 'controlled.scout':'Scout','controlled.developer':'Developer','controlled.reviewer':'Reviewer','controlled.oracle':'Oracle' } as const;
    const role=roles[run.binding.agent as keyof typeof roles];
    if(!role||!record(child)||child.agent!==run.binding.agent||!text(child.sessionFile))return failure('TERMINAL_PROOF_BINDING_INVALID','UNKNOWN',{runId});
    if(status.state!==event.state||!text(statusRequestId))return failure('TERMINAL_PROOF_UNAVAILABLE','UNKNOWN',{runId});
    const details=status.reply.details,lifecycle=record(details)?details.lifecycleStatus:undefined,raw=record(lifecycle)?lifecycle.processTerminal:undefined;
    if(!record(raw)||raw.state!=='observed'||!Array.isArray(raw.instances))return failure('TERMINAL_PROOF_UNAVAILABLE','UNKNOWN',{runId});
    const provider={version:raw.version,state:raw.state,runId:raw.runId,runnerProcessInstanceId:raw.runnerProcessInstanceId,
      observedAt:raw.observedAt,resumeDisposition:raw.resumeDisposition,instances:raw.instances.map(i=>record(i)?{
        kind:i.kind,processInstanceId:i.processInstanceId,closeObservedAt:i.closeObservedAt,exitCode:i.exitCode,signal:i.signal}:null)};
    const proof=snapshot({schemaVersion:1,runId,role,requestId:run.binding.requestId,ownerSessionId:run.binding.ownerSessionId,
      childSessionId:child.sessionFile,statusRequestId,completionSessionId:event.sessionId,terminalStatus:event.state,
      observedAt:new Date().toISOString(),source:'targeted-rpc-status',provider});
    if(!verifyTerminalProof(proof,{runId,role,ownerSessionId:run.binding.ownerSessionId,requestId:run.binding.requestId}))
      return failure('TERMINAL_PROOF_BINDING_INVALID','UNKNOWN',{runId});
    if(!this.integrity().ok)return failure('TERMINAL_PROOF_UNAVAILABLE','UNKNOWN',{runId});
    acquiredProofs.add(proof as object);return success(proof as unknown as TerminalProof,statusRequestId);
  }
  async status(runId: string): Promise<Result<RunStatus>> {
    const ready = this.#ready('status','status'); if (!ready.ok) return ready;
    if (!text(runId)) return failure('INVALID_INPUT');
    const r = await this.#request('status', { id: runId }); if (!r.ok) return r;
    const snap = r.value.asyncSnapshot;
    const rows = record(snap) && snap.kind === 'pi-subagents.async-status-snapshot' && snap.version === 1 && Array.isArray(snap.runs)
      ? snap.runs.filter(x => record(x) && x.id === runId) : [];
    if (rows.length > 1) return failure('MALFORMED_REPLY', 'REPLIED', { requestId: r.requestId, runId });
    const row = rows[0];
    // This is provider-reported run state, NOT process-terminal proof or recovery.
    const state = record(row) && typeof row.state === 'string' && ['queued','running','complete','failed','paused','stopped'].includes(row.state) ? row.state : 'UNKNOWN';
    return success(Object.freeze({ runId, state, reply: r.value }), r.requestId);
  }
  interrupt(runId: string): Promise<Result<RecordData>> { return this.#control('interrupt', runId); }
  stop(runId: string): Promise<Result<RecordData>> { return this.#control('stop', runId); }
  #control(method: 'interrupt' | 'stop', runId: string): Promise<Result<RecordData>> {
    const ready = this.#ready(method,method);
    if (!ready.ok) return Promise.resolve(ready);
    if (!text(runId)) return Promise.resolve(failure('INVALID_INPUT'));
    // Never send prefixes or unbound IDs to mutating runtime methods.
    return this.#runs.has(runId) ? this.#request(method, { id: runId }) : Promise.resolve(failure('UNKNOWN_RUN'));
  }
  resume(runId: string, message: string): Promise<Result<Binding>> {
    const ready = this.#ready('resume','resume',true); if (!ready.ok) return Promise.resolve(ready);
    const run = this.#runs.get(runId);
    if (!run) return Promise.resolve(failure('UNKNOWN_RUN'));
    if (!text(message)) return Promise.resolve(failure('INVALID_INPUT'));
    // Provider RPC resume ignores launch overrides; its recovery descriptor
    // inherits bridge=off from this adapter's original spawn. Only known runs
    // can reach this branch, so no ambient/foreign run is resumed here.
    return this.#launch('resume', { id: runId, message }, run.binding.agent, run.context);
  }
  /** Draft P4 evidence. Artifact registration, provenance and retention belong
   * to the host; this API never claims that a supplied reference is authenticated. */
  evidence(id: string, itemId: 'rpc-ping' | 'rpc-async-structured-output', evidenceRefs: readonly string[]): CapabilityEvidence {
    const validId = (s: unknown) => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(s);
    if (!validId(id) || !['rpc-ping','rpc-async-structured-output'].includes(itemId) || evidenceRefs.length > 64 || evidenceRefs.some(r => !validId(r)) || new Set(evidenceRefs).size !== evidenceRefs.length) throw new TypeError('INVALID_EVIDENCE_REFERENCE');
    const observed = itemId === 'rpc-ping' ? this.#hello?.status === 'VERIFIED' : this.#structuredObserved;
    return Object.freeze({ schemaVersion: 1, id, itemId, status: this.#fault ? 'FAILED' : !this.#closed && observed && evidenceRefs.length ? 'VERIFIED' : 'UNVERIFIED', environmentHash: this.#environment.environmentHash, evidenceRefs: Object.freeze([...evidenceRefs]) });
  }
  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const [requestId, p] of this.#requests) {
      clearTimeout(p.timer);
      if (!p.result) { p.result = failure('DISPOSED', 'UNKNOWN', { requestId }); p.resolve(p.result); }
    }
    for (const off of this.#offs) off();
    this.#offs.clear(); this.#requests.clear();this.#activeRequests.clear();this.#completedReads.clear();this.#early.clear(); this.#runs.clear(); this.#observers.clear();
  }
}
