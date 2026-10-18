import { verifyReviewerNoDispatchProof } from './run-quiescence.js';
import { verifiedRuntimeRootMappings } from './runtime-root-binding.js';
import { projectRuntimeImportLease } from './project-runtime-import.js';
import type { ProjectRuntimeImportCapability } from './project-runtime-import.js';
import { projectIdentity } from './project-identity.js';
import { resolveProjectStorage, ensureProjectStorageData } from './project-storage.js';
import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, fchmodSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { Buffer, isUtf8 } from 'node:buffer';
import { canonicalize, hashBytes, hashContract, parseJson as parseLimitedJson, validateContract, validateScalar, validateStructure } from './contracts.js';
import type { ArtifactRef, ContextRecord, TaskSpec, TransitionEvent, WorkflowState } from './contracts.js';
import { verifyTerminalProof } from './pi-subagents-rpc.js';
import { verifyTerminalCompletionPackage } from './completion-package.js';
import type { LockManager, WorkflowLocks } from './lock-manager.js';
import { CHANNEL_V2_MEDIA, checkPresentationChannel } from './gate-presentation.js';
import { createVerifiedStoreCache, VerifiedStoreCacheError } from './verified-store-cache.js';

export class StoreError extends Error { constructor(readonly code:string){super(code)} }
function fail(code:string):never{throw new StoreError(code)}
const parseJson=(value:string|Uint8Array)=>parseLimitedJson(value,64*1024*1024);
const bytes=(value:string|Uint8Array):Uint8Array=>typeof value==='string'?Buffer.from(value,'utf8'):value;
const same=(a:unknown,b:unknown)=>canonicalize(a)===canonicalize(b);
const inside=(root:string,path:string)=>path===root||(!relative(root,path).startsWith('..')&&!relative(root,path).startsWith('/'));

/** A mandatory trusted-host disclosure check, NOT a model-callable approval or secret detector.
 * Reject bytes whose safety cannot be established; never silently redact hashed evidence. */
export type ArtifactInspection=(content:Uint8Array,mediaType:string)=>'ACCEPT'|'REJECT';
export interface StoredLedger { readonly state:WorkflowState; readonly events:readonly TransitionEvent[];
  readonly records:readonly ContextRecord[]; readonly truncatedTailBytes:number }

/** New-task, single-host storage only. Loading is read-only, never replay/resume or lock recovery. */
export class DurableStore {
  readonly root:string; readonly agentDataRoot:string; readonly #inspect:ArtifactInspection;
  readonly #artifacts=new Map<string,ArtifactRef>();
  #revision=-1; #eventHash:string|undefined; #poisoned=false;
  private constructor(root:string,agentDataRoot:string,inspect:ArtifactInspection){this.root=root;this.agentDataRoot=agentDataRoot;this.#inspect=inspect}
  /** Project namespaces inherit the existing trusted-host disclosure policy. */
  get artifactInspection():ArtifactInspection{return this.#inspect}
  /** Artifact-only access to the existing legacy planning archive during native relocation.
   * No namespace creation, ledger reopening, path rebinding or workflow authority is granted.
   * The caller must hold its acquired handoff proposal/lease; this fixed machine path is needed
   * while the local placement marker is deliberately unpublished. */
  static legacyPlanningForHandoff(machineDataRoot:string,projectId:string,inspect:ArtifactInspection):DurableStore {
    if(!/^[a-f0-9]{64}$/.test(projectId)||typeof inspect!=='function')fail('STORE_INPUT_INVALID');
    const data=realpathSync(machineDataRoot);if(data!==resolve(machineDataRoot))fail('STORE_ROOT_INVALID');
    let root=data;for(const part of ['controlled-dev','projects',projectId,'planning']){root=join(root,part);directory(root)}
    directory(join(root,'artifacts'));return new DurableStore(root,data,inspect);
  }
  static create(agentDataRoot:string,repoRoot:string,taskId:string,inspect:ArtifactInspection):DurableStore{
    if(!validateScalar('ID',taskId).ok||typeof inspect!=='function')fail('STORE_INPUT_INVALID');
    const data=realpathSync(agentDataRoot),repo=realpathSync(repoRoot);
    if(data!==resolve(agentDataRoot)||repo!==repoRoot||inside(repo,data)||inside(data,repo))fail('STORE_ROOT_INVALID');
    const placement=resolveProjectStorage(data,repo);ensureProjectStorageData(placement,true);
    if(placement.custodian)syncDirectory(placement.storageAnchor);
    const project=placement.projectId;
    let root=placement.stateDataRoot;
    for(const part of ['controlled-dev','projects',project,'tasks']){
      root=join(root,part);
      try{mkdirSync(root,{mode:0o700})}catch(error){if((error as {code?:string}).code!=='EEXIST')throw error}
      directory(root);syncDirectory(dirname(root));
    }
    root=join(root,taskId);mkdirSync(root,{mode:0o700});syncDirectory(dirname(root));
    mkdirSync(join(root,'artifacts'),{mode:0o700});syncDirectory(root);
    return new DurableStore(root,data,inspect);
  }
  /** Host-owned project namespace. Uses the same artifact integrity and durability implementation;
   * no task ledger, WAL or workflow state is manufactured. Project writers use the existing workspace lock;
   * checkpoint-only artifact/index writes use its mutation guard with a separate run lease, never source authority. */
  static project(agentDataRoot:string,repoRoot:string,namespace:string,inspect:ArtifactInspection,create=false):DurableStore|undefined{
    if(!['memory','planning','promotion','integration','autonomy','workspace','context-investigations'].includes(namespace)||typeof inspect!=='function')fail('STORE_INPUT_INVALID');
    const data=realpathSync(agentDataRoot),repo=realpathSync(repoRoot);
    if(data!==resolve(agentDataRoot)||repo!==repoRoot||inside(repo,data)||inside(data,repo))fail('STORE_ROOT_INVALID');
    const placement=resolveProjectStorage(data,repo);if(!ensureProjectStorageData(placement,create))return undefined;
    if(create&&placement.custodian)syncDirectory(placement.storageAnchor);
    let root=placement.stateDataRoot;
    for(const part of ['controlled-dev','projects',placement.projectId,namespace,'artifacts']){
      root=join(root,part);
      if(create){try{mkdirSync(root,{mode:0o700});syncDirectory(dirname(root))}catch(error){if((error as {code?:string}).code!=='EEXIST')throw error}}
      try{directory(root)}catch(error){if(!create&&(error as {code?:string}).code==='ENOENT')return undefined;throw error}
    }
    return new DurableStore(dirname(root),data,inspect);
  }
  /** Pre-repository project artifacts use the same canonical immutable store and atomic index.
   * The host supplies a bounded identity, never a path or arbitrary namespace from a model. */
  static bootstrap(dataRoot:string,projectId:string,inspect:ArtifactInspection,create=false):DurableStore|undefined {
    return this.preRepository(dataRoot,projectId,'bootstrap',inspect,create);
  }
  static sourceImport(dataRoot:string,projectId:string,inspect:ArtifactInspection,create=false):DurableStore|undefined {
    return this.preRepository(dataRoot,projectId,'source-import',inspect,create);
  }
  private static preRepository(dataRoot:string,projectId:string,namespace:'bootstrap'|'source-import',inspect:ArtifactInspection,create:boolean):DurableStore|undefined {
    if(!/^[a-f0-9]{64}$/.test(projectId)||typeof inspect!=='function')fail('STORE_INPUT_INVALID');
    const data=realpathSync(dataRoot);if(data!==resolve(dataRoot))fail('STORE_ROOT_INVALID');let root=data;
    for(const part of ['controlled-dev','projects',projectId,namespace,'artifacts']){
      root=join(root,part);if(create){try{mkdirSync(root,{mode:0o700});syncDirectory(dirname(root))}catch(error){if((error as {code?:string}).code!=='EEXIST')throw error}}
      try{directory(root)}catch(error){if(!create&&(error as {code?:string}).code==='ENOENT')return undefined;throw error}
    }
    return new DurableStore(dirname(root),data,inspect);
  }
  /** A single atomic index is sufficient for project records. Immutable orphan artifacts after a crash
   * are harmless: only the index is current. CAS is meaningful only under the existing workspace lock. */
  readProjectIndex():ArtifactRef|undefined{
    let raw:Uint8Array;
    try{raw=readRegular(join(this.root,'index.json'))}catch(error){if((error as {code?:string}).code==='ENOENT')return undefined;throw error}
    if(raw.byteLength>32768)fail('STORE_INDEX_INVALID');
    const ref=parseJson(raw) as ArtifactRef;
    if(!validateStructure('ArtifactRef',ref).ok||canonicalize(ref)!==Buffer.from(raw).toString('utf8'))fail('STORE_INDEX_INVALID');
    // Missing referenced bytes are corruption, never an empty namespace.
    this.read(ref);return ref;
  }
  replaceProjectIndex(expected:ArtifactRef|undefined,next:ArtifactRef):void{
    this.#writable();if(!same(this.readProjectIndex()??null,expected??null))fail('STORE_REVISION_CONFLICT');
    this.read(next);const path=join(this.root,'index.json'),temp=join(this.root,`index-${randomUUID()}.tmp`);
    // Exclusive temporary file, fsync, rename and directory fsync reuse the task snapshot pattern.
    writeExclusive(temp,bytes(canonicalize(next)),false);renameSync(temp,path);syncDirectory(this.root);
  }
  /** Explicit host reopen, never WAL repair or replay. A fresh verified pair is mandatory. */
  static reopen(root:string,manager:LockManager,locks:WorkflowLocks,inspect:ArtifactInspection):DurableStore{
    if(!manager.verifyTaskLock(locks.task)||!manager.verifyWorkspaceLock(locks.workspace))fail('STORE_LOCK_AUTHORITY_INVALID');
    const ledger=DurableStore.load(root),data=dirname(dirname(manager.root));
    if(ledger.truncatedTailBytes||['COMPLETED','FAILED'].includes(ledger.state.state)||typeof inspect!=='function')fail('STORE_REOPEN_DENIED');
    const identity=manager.workspaceIdentity(ledger.state.repoRoot);
    if(locks.task.record.taskId!==ledger.state.taskId||locks.task.record.workspaceHash!==identity.workspaceHash||
      locks.workspace.record.workspaceHash!==identity.workspaceHash||root!==join(resolveProjectStorage(data,ledger.state.repoRoot).projectRoot,'tasks',ledger.state.taskId))fail('STORE_LOCK_AUTHORITY_INVALID');
    const store=new DurableStore(root,data,inspect);store.#revision=ledger.state.revision;store.#eventHash=ledger.events.at(-1)!.eventHash;
    for(const record of ledger.records)if(record.kind==='ArtifactRef')store.#artifacts.set(record.id,record.value);
    return store;
  }
  /** A relocated historical root is admitted only by a live native import
   * capability. Ordinary reopen retains its exact physical-root checks. */
  static reopenImported(capability:ProjectRuntimeImportCapability):DurableStore{
    const lease=projectRuntimeImportLease(capability),{ledger,manager,locks,taskRoot:root}=lease;
    const p=lease.proposal.payload,placement=resolveProjectStorage(lease.data,p.repoRoot);
    if(!same(DurableStore.load(root),ledger)||root!==join(placement.projectRoot,'tasks',p.taskId)
      ||locks.task.record.taskId!==p.taskId||locks.workspace.record.workspaceHash!==manager.workspaceIdentity(p.repoRoot).workspaceHash)fail('STORE_LOCK_AUTHORITY_INVALID');
    const store=new DurableStore(root,lease.data,lease.inspect);store.#revision=ledger.state.revision;store.#eventHash=ledger.events.at(-1)!.eventHash;
    for(const record of ledger.records)if(record.kind==='ArtifactRef')store.#artifacts.set(record.id,record.value);
    return store;
  }
  put(id:string,content:string|Uint8Array,mediaType='application/json'):ArtifactRef{
    this.#writable();
    const raw=bytes(content),ref:ArtifactRef={schemaVersion:1,id,digest:hashBytes(raw),bytes:raw.byteLength,
      relativeStorePath:`artifacts/${id}`,mediaType};
    if(!validateStructure('ArtifactRef',ref).ok)fail('STORE_ARTIFACT_INVALID');
    this.import(ref,raw);return Object.freeze(ref);
  }
  /** Import exact host-acquired bytes. A path or child claim alone never supplies content. */
  import(ref:ArtifactRef,content:string|Uint8Array):void{
    this.#writable();const raw=bytes(content),path=artifactPath(this.root,ref),prior=this.#artifacts.get(ref.id);
    if(prior&&!same(prior,ref))fail('STORE_ARTIFACT_METADATA_CONFLICT');
    if(raw.byteLength!==ref.bytes||hashBytes(raw)!==ref.digest)fail('STORE_ARTIFACT_INTEGRITY');
    if(this.#inspect(raw.slice(),ref.mediaType)!=='ACCEPT')fail('STORE_DISCLOSURE_REJECTED');
    try{lstatSync(path);readArtifact(this.root,ref);this.#artifacts.set(ref.id,{...ref});return}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error}
    try{writeExclusive(path,raw,true);syncDirectory(dirname(path));this.#artifacts.set(ref.id,{...ref})}catch(error){this.#poisoned=true;throw error}
  }
  read(ref:ArtifactRef):Uint8Array{
    const known=this.#artifacts.get(ref.id);if(known&&!same(known,ref))fail('STORE_ARTIFACT_METADATA_CONFLICT');
    return readArtifact(this.root,ref);
  }
  writeSpec(spec:TaskSpec):ArtifactRef{
    const ref=this.put('spec',canonicalize(spec));
    try{writeExclusive(join(this.root,'spec.json'),bytes(canonicalize(spec)),true);syncDirectory(this.root)}catch(error){this.#poisoned=true;throw error}
    return ref;
  }
  /** The catalog is hash-bound by its ID in event.evidenceRefs, before stateAfter/WAL.
   * ponytail: full bounded registry per revision; deduplicate catalogs only if size warrants it. */
  catalog(records:readonly ContextRecord[]):ArtifactRef{
    for(const record of records)verifyRefs(this.root,record.value);
    const content=canonicalize({schemaVersion:1,records});
    return this.put(`catalog-${hashBytes(bytes(content))}`,content);
  }
  commit(state:WorkflowState,event:TransitionEvent,records:readonly ContextRecord[]):void{
    this.#writable();
    if(event.revision!==this.#revision+1||event.previousEventHash!==this.#eventHash)fail('STORE_REVISION_CONFLICT');
    const catalog=catalogRef(this.root,event);const saved=parseCatalog(this.read(catalog));
    if(!same(saved,records))fail('STORE_CATALOG_MISMATCH');
    const previous=this.#revision<0?undefined:DurableStore.load(this.root);
    if(previous?.truncatedTailBytes)fail('STORE_TRUNCATED_TAIL_READ_ONLY');
    validateStep(this.root,state,event,records,previous);
    if(!same(parseJson(this.read(event.stateAfter)),state))fail('STORE_STATE_AFTER_MISMATCH');
    if(state.state==='COMPLETED')verifyTerminalSnapshot(this.root,state,records);
    if(this.#inspect(bytes(canonicalize(event)),'application/json')!=='ACCEPT')fail('STORE_DISCLOSURE_REJECTED');
    // stateAfter has already been written/synced by put. No external effect may precede this commit.
    try{
      const log=join(this.root,'events.jsonl');
      if(this.#revision>=0)regular(log);
      const fd=openSync(log,this.#revision<0?'wx':'a',0o600);
      try{writeFileSync(fd,canonicalize(event)+'\n');fsyncSync(fd)}finally{closeSync(fd)}
      syncDirectory(this.root);
      const temporary=join(this.root,`state-${state.revision}.tmp`);
      writeExclusive(temporary,bytes(canonicalize(state)),false);
      if(this.#revision>=0)regular(join(this.root,'state.json'));
      renameSync(temporary,join(this.root,'state.json'));syncDirectory(this.root);
      this.#revision=state.revision;this.#eventHash=event.eventHash;
    }catch(error){this.#poisoned=true;throw error}
  }
  /** Read-only artifact access for recovery classification, using the same integrity boundary. */
  static readArtifact(root:string,ref:ArtifactRef):Uint8Array{return readArtifact(root,ref)}
  /** Complete prefix only; an unterminated final line is preserved and never applied.
   * Snapshot lag is an error here: replay belongs to the separately authorized recovery phase. */
  static load(root:string):StoredLedger{
    try{return cachedLoad(root)}catch(error){if(error instanceof VerifiedStoreCacheError)fail(error.code);throw error}
  }
  /** Read-only verified WAL prefix for PST-002. Never uses the load cache and never
   * certifies a previous fsync or authorizes repair. */
  static readHistory(root:string):StoredLedger{return readVerifiedHistory(root)}
  #writable():void{if(this.#poisoned)fail('STORE_COMMIT_UNCERTAIN');directory(this.root);directory(join(this.root,'artifacts'))}
}
type LedgerReader=(path:string)=>Uint8Array;
// The reader is private host-acquired bytes, never caller/model-supplied data. All contract,
// history, artifact and terminal checks are the same for captured and ordinary WAL reads.
function readVerifiedHistory(root:string,reader?:LedgerReader):StoredLedger {
    directory(root);directory(join(root,'artifacts'));
    const log=reader?reader(join(root,'events.jsonl')):readRegular(join(root,'events.jsonl'));
    const end=log.lastIndexOf(10),prefix=log.slice(0,end+1),truncatedTailBytes=log.byteLength-end-1;
    if(!isUtf8(prefix))fail('STORE_LOG_UTF8');
    const lines=Buffer.from(prefix).toString('utf8').split('\n').slice(0,-1);
    if(!lines.length)fail('STORE_EMPTY_LOG');
    let ledger:StoredLedger|undefined;
    for(const line of lines){
      const parsed=parseJson(line),check=validateStructure('TransitionEvent',parsed);
      if(!check.ok)fail('STORE_EVENT_INVALID');const event=check.value;
      if(event.eventHash!==hashContract('TransitionEvent',event))fail('STORE_EVENT_HASH');
      const records=parseCatalog(readArtifact(root,catalogRef(root,event,reader),reader));
      const state=parseJson(readArtifact(root,event.stateAfter,reader)) as unknown as WorkflowState;
      validateStep(root,state,event,records,ledger,reader);
      ledger={state,events:[...(ledger?.events??[]),event],records,truncatedTailBytes};
    }
    const originalSpec=parseJson(reader?reader(join(root,'spec.json')):readRegular(join(root,'spec.json')));
    if(!ledger!.records.some(record=>record.kind==='TaskSpec'&&same(record.value,originalSpec)))fail('STORE_SPEC_MISMATCH');
    if(ledger!.state.state==='COMPLETED')verifyTerminalSnapshot(root,ledger!.state,ledger!.records,reader);
    return ledger!;
}
const cachedLoad=createVerifiedStoreCache<StoredLedger>((root,reader)=>{
  const ledger=readVerifiedHistory(root,reader),snapshot=parseJson(reader?reader(join(root,'state.json')):readRegular(join(root,'state.json')));
  if(!same(snapshot,ledger.state))fail('STORE_SNAPSHOT_MISMATCH');return ledger;
});
function validateStep(root:string,state:WorkflowState,event:TransitionEvent,records:readonly ContextRecord[],previous?:StoredLedger,reader?:LedgerReader):void{
  if(event.revision!==(previous?previous.state.revision+1:0)||event.previousEventHash!==previous?.events.at(-1)?.eventHash
    ||(previous&&['COMPLETED','FAILED'].includes(previous.state.state)))fail('STORE_EVENT_SEQUENCE');
  if(previous){
    const priorEvent=previous.events.at(-1)!;
    const history:readonly ContextRecord[]=[...previous.records,{id:priorEvent.stateAfter.id,kind:'WorkflowState',value:previous.state},
      {id:priorEvent.id,kind:'TransitionEvent',value:priorEvent}];
    for(const record of history){
      const preserved=records.filter(value=>value.id===record.id);
      if(preserved.length!==1||!same(preserved[0],record))fail('STORE_RECORD_HISTORY_CONFLICT');
    }
  }
  const metadata=new Map<string,ArtifactRef>();
  for(const record of records)verifyRefs(root,record.value,metadata,reader);
  verifyRefs(root,state,metadata,reader);verifyRefs(root,event,metadata,reader);
  const catalog=catalogRef(root,event,reader);
  const current:ContextRecord[]=[...records,{id:catalog.id,kind:'ArtifactRef',value:catalog},
    {id:event.stateAfter.id,kind:'WorkflowState',value:state},{id:event.id,kind:'TransitionEvent',value:event}];
  const context={records:current,specId:state.spec.id,stateId:event.stateAfter.id,
    ...(previous?{previousStateId:previous.events.at(-1)!.stateAfter.id}:{}),modelExtracted:false,
    runtimeRootMappings:verifiedRuntimeRootMappings(current,[...previous?.events??[],event],{read:ref=>readArtifact(root,ref,reader)})};
  if(!validateContract('WorkflowState',state,context).ok||!validateContract('TransitionEvent',event,context).ok)fail('STORE_STATE_INVALID');
  if(event.eventHash!==hashContract('TransitionEvent',event))fail('STORE_EVENT_HASH');
  for(const run of state.runs)if(run.status==='TERMINAL'){
    const ref=records.find(r=>r.id===run.terminalProofRef&&r.kind==='ArtifactRef')?.value as ArtifactRef|undefined;
    if(!ref||!run.runId||!run.childSessionId||!verifyTerminalProof(parseJson(readArtifact(root,ref,reader)),
      {runId:run.runId,role:run.role,requestId:run.requestId,ownerSessionId:run.ownerSessionId,childSessionId:run.childSessionId}))fail('STORE_TERMINAL_PROOF_INVALID');
  }
  for(const run of state.runs)if(run.status==='NOT_DISPATCHED'){
    const ref=records.find(r=>r.id===run.dispatchProofRef&&r.kind==='ArtifactRef')?.value as ArtifactRef|undefined;
    const assignment=records.find(r=>r.kind==='AssignmentEnvelope'&&r.value.assignmentId===run.assignmentId);
    if(!ref||assignment?.kind!=='AssignmentEnvelope'||!verifyReviewerNoDispatchProof(parseJson(readArtifact(root,ref,reader)),assignment.value,run))fail('STORE_NO_DISPATCH_PROOF_INVALID');
  }
  for(const record of records)if(record.kind==='HumanDecisionEvidence'){
    const channel=records.find(r=>r.id===record.value.trustedChannelEvidenceRef&&r.kind==='ArtifactRef');
    if(channel?.kind==='ArtifactRef'&&channel.value.mediaType===CHANNEL_V2_MEDIA){
      const gate=records.find(r=>r.id===record.value.gateId&&r.kind==='HumanGate');if(!gate||gate.kind!=='HumanGate')fail('STORE_GATE_MISSING');
      const p=checkPresentationChannel(parseJson(readArtifact(root,channel.value,reader)),gate.value,current,
        current.filter(r=>r.kind==='TransitionEvent').map(r=>r.value as TransitionEvent),{read:ref=>readArtifact(root,ref,reader)});
      if(record.value.displayedRevision!==p.workflowRevision||record.value.displayedDataHash!==p.displayedDataHash)fail('STORE_PRESENTATION_BINDING');
    }
  }
  const spec=parseJson(readArtifact(root,state.spec,reader));
  if(!validateContract('TaskSpec',spec,context).ok||!same(spec,records.find(r=>r.id===state.spec.id&&r.kind==='TaskSpec')?.value))fail('STORE_SPEC_INVALID');
}
function verifyTerminalSnapshot(root:string,state:WorkflowState,records:readonly ContextRecord[],reader?:LedgerReader):void{
  const packages=records.filter(r=>r.kind==='ArtifactRef'&&['application/vnd.pi-controlled-dev.terminal-completion-v2+json','application/vnd.pi-controlled-dev.terminal-completion-v3+json'].includes(r.value.mediaType)&&state.completionEvidenceRefs.includes(r.id));
  if(packages.length!==1)fail('STORE_COMPLETION_PACKAGE_MISSING');
  const ref=packages[0].value as ArtifactRef,packet=parseJson(readArtifact(root,ref,reader)) as any;
  verifyTerminalCompletionPackage(packet,state,records,{read:artifact=>readArtifact(root,artifact,reader)});
  const attestations=records.filter(r=>r.kind==='ArtifactRef'&&r.value.mediaType==='application/vnd.pi-controlled-dev.terminal-attestation+json'
    &&state.completionEvidenceRefs.includes(r.id));
  if(attestations.length!==1)fail('STORE_TERMINAL_ATTESTATION_MISSING');
  const attestation=parseJson(readArtifact(root,attestations[0].value as ArtifactRef,reader)) as any,{attestationHash,...body}=attestation;
  if(attestationHash!==hashBytes(bytes(canonicalize(body)))||body.taskId!==state.taskId||body.specHash!==state.specHash
    ||body.candidateDigest!==state.candidate?.digest||body.candidateGeneration!==state.candidate?.generation
    ||body.schemaVersion!==2||body.terminalCompletionPackageHash!==hashBytes(bytes(canonicalize(packet)))
    ||body.authorizationPackageHash!==packet.authorizationPackageHash||body.targetState!=='COMPLETED'
    ||Object.keys(body.facts??{}).length!==18||Object.values(body.facts).some(value=>value!==true))fail('STORE_TERMINAL_ATTESTATION_INVALID');
}
function parseCatalog(raw:Uint8Array):readonly ContextRecord[]{
  const value=parseJson(raw) as any;
  if(!value||Object.keys(value).sort().join(',')!=='records,schemaVersion'||value.schemaVersion!==1||!Array.isArray(value.records))fail('STORE_CATALOG_INVALID');
  return value.records;
}
function catalogRef(root:string,event:TransitionEvent,reader?:LedgerReader):ArtifactRef{
  const ids=event.evidenceRefs.filter(id=>/^catalog-[a-f0-9]{64}$/.test(id));if(ids.length!==1)fail('STORE_CATALOG_MISSING');
  const id=ids[0],raw=reader?reader(join(root,'artifacts',id)):readRegular(join(root,'artifacts',id));
  return {schemaVersion:1,id,digest:id.slice(8),bytes:raw.byteLength,relativeStorePath:`artifacts/${id}`,mediaType:'application/json'};
}
function verifyRefs(root:string,value:unknown,metadata=new Map<string,ArtifactRef>(),reader?:LedgerReader):void{
  if(!value||typeof value!=='object')return;
  if('relativeStorePath' in value){const ref=value as ArtifactRef;readArtifact(root,ref,reader);
    const prior=metadata.get(ref.id);if(prior&&!same(prior,ref))fail('STORE_ARTIFACT_METADATA_CONFLICT');metadata.set(ref.id,ref);return}
  for(const child of Object.values(value))verifyRefs(root,child,metadata,reader);
}
function artifactPath(root:string,ref:ArtifactRef):string{
  if(!validateStructure('ArtifactRef',ref).ok||ref.relativeStorePath!==`artifacts/${ref.id}`)fail('STORE_ARTIFACT_PATH');
  directory(root);directory(join(root,'artifacts'));return join(root,ref.relativeStorePath);
}
function readArtifact(root:string,ref:ArtifactRef,reader?:LedgerReader):Uint8Array{
  if(!validateStructure('ArtifactRef',ref).ok||ref.relativeStorePath!==`artifacts/${ref.id}`)fail('STORE_ARTIFACT_PATH');
  const raw=reader?reader(join(root,ref.relativeStorePath)):readRegular(artifactPath(root,ref));
  if(raw.byteLength!==ref.bytes||hashBytes(raw)!==ref.digest)fail('STORE_ARTIFACT_INTEGRITY');return raw;
}
function regular(path:string):void{
  const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)fail('STORE_FILE_ALIAS');
}
function directory(path:string):void{
  const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(path)!==path)fail('STORE_DIRECTORY_ALIAS');
}
function readRegular(path:string):Uint8Array{regular(path);return readFileSync(path)}
function writeExclusive(path:string,raw:Uint8Array,immutable:boolean):void{
  const fd=openSync(path,'wx',0o600);
  try{writeFileSync(fd,raw);if(immutable)fchmodSync(fd,0o400);fsyncSync(fd)}finally{closeSync(fd)}
}
// Fail closed on platforms/filesystems without directory sync; no weaker durability claim.
function syncDirectory(path:string):void{const fd=openSync(path,'r');try{fsyncSync(fd)}finally{closeSync(fd)}}
