import { isAcquiredLegacyReviewerProof } from './legacy-reviewer-preflight.js';
import { verifyReviewerNoDispatchProof } from './run-quiescence.js';
import type { ReviewerNoDispatchProof } from './run-quiescence.js';
import { runQuiescent, runQuiescenceProjection } from './run-quiescence.js';
import { projectIdentity } from './project-identity.js';
import { resolveProjectStorage, assertProjectStoragePath } from './project-storage.js';
import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { canonicalize, hashBytes, hashCanonical, parseJson, validateScalar } from './contracts.js';
import { DurableStore } from './store.js';
import type { StoredLedger } from './store.js';
import { liveLockRecord, withLockMutation } from './lock-manager.js';
import type { LockRecord } from './lock-manager.js';
import { inspectProcessOwner } from './process-incarnation.js';
import type { OwnerEvidence } from './process-incarnation.js';
import { currentProcessIncarnation } from './process-incarnation.js';
import { isAcquiredTerminalProof, verifyTerminalProof } from './pi-subagents-rpc.js';
import type { TerminalProof } from './pi-subagents-rpc.js';
export interface ReconciliationAttempt {readonly schemaVersion:1;readonly id:string;readonly taskId:string;readonly assignmentId:string;
  readonly runId:string|null;readonly oldStatus:string;readonly result:'UNRESOLVED'|'VERIFIED_TERMINAL'|'VERIFIED_NOT_DISPATCHED'|'CONTRADICTORY';readonly reason:string;
  readonly revision:number;readonly eventHash:string;readonly observedAt:string;readonly terminalProof?:TerminalProof;readonly noDispatchProof?:ReviewerNoDispatchProof;
  readonly authority:{readonly scope:'RECONCILIATION_AUDIT_ONLY';readonly sessionId:string;readonly processIncarnation:unknown;readonly oldOwners:unknown}}
export function reconciliationAttempts(dataRoot:string,ledger:StoredLedger):ReconciliationAttempt[]{
  const root=join(dataRoot,'controlled-dev','locks');directory(root);
  return readdirSync(root).filter(name=>/^reconciliation-[a-f0-9-]+\.json$/.test(name)).map(name=>{
    const path=join(root,name),s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>1024*1024)throw new Error('RECONCILIATION_AUDIT_INVALID');
    const a=parseJson(readFileSync(path),1024*1024) as unknown as ReconciliationAttempt;
    if(a.schemaVersion!==1||name!==`${a.id}.json`||a.authority?.scope!=='RECONCILIATION_AUDIT_ONLY')throw new Error('RECONCILIATION_AUDIT_INVALID');return a;
  }).filter(a=>a.taskId===ledger.state.taskId&&ledger.events.some(e=>e.revision===a.revision&&e.eventHash===a.eventHash));
}
export function reconciledTerminalAttempts(dataRoot:string,ledger:StoredLedger):ReconciliationAttempt[]{
  const attempts=reconciliationAttempts(dataRoot,ledger).filter(a=>a.eventHash===ledger.events.at(-1)!.eventHash);
  if(attempts.some(a=>a.result==='CONTRADICTORY'))throw new Error('RECONCILIATION_CONTRADICTORY');
  const verified=attempts.filter(a=>a.result==='VERIFIED_TERMINAL'),seen=new Map<string,string>();
  for(const a of verified){const proof=canonicalize([a.terminalProof?.terminalStatus,a.terminalProof?.provider]);
    if(seen.has(a.assignmentId)&&seen.get(a.assignmentId)!==proof)throw new Error('RECONCILIATION_CONTRADICTORY');seen.set(a.assignmentId,proof)}
  return verified.map(a=>{
    const run=ledger.state.runs.find(r=>r.assignmentId===a.assignmentId);
    if(!run||run.status==='INTENT'||run.status==='TERMINAL'||!run.runId||!run.childSessionId||a.runId!==run.runId||a.oldStatus!==run.status||
      !verifyTerminalProof(a.terminalProof,{runId:run.runId,role:run.role,requestId:run.requestId,ownerSessionId:run.ownerSessionId,childSessionId:run.childSessionId}))throw new Error('RECONCILIATION_PROOF_INVALID');return a;
  });
}
/** The legacy migration receipt is acquired while the original owner is alive and audited only after proven death.
 * This writes an audit under the existing mutation mutex, never workflow state or lock ownership. */
export function recordLegacyReviewerNoDispatchAttempt(dataRoot:string,storeRoot:string,sessionId:string,proof:ReviewerNoDispatchProof):ReconciliationAttempt{
 if(!isAcquiredLegacyReviewerProof(proof)||!proof.legacyProtocol||!validateScalar('Text',sessionId).ok)throw new Error('RECONCILIATION_PROOF_INVALID');
 const initial=inspect(dataRoot,storeRoot);
 if(!initial.ledger||!initial.root||!initial.workspaceHash||initial.recovery.lockOwnerStatus!=='DEAD')throw new Error('RECONCILIATION_AUTHORITY_UNAVAILABLE');
 return withLockMutation(initial.root,initial.workspaceHash,retain=>{
  const fresh=inspect(dataRoot,storeRoot,true),ledger=fresh.ledger,locks=fresh.locks;
  if(!ledger||canonicalize(ledger)!==canonicalize(initial.ledger)||canonicalize(locks)!==canonicalize(initial.locks)||locks?.length!==2
    ||proof.legacyProtocol!.ledgerRevision!==ledger.state.revision||proof.legacyProtocol!.ledgerEventHash!==ledger.events.at(-1)!.eventHash
    ||locks.some(l=>l.owner.status!=='DEAD'||canonicalize(l.record.processIncarnation)!==canonicalize(proof.legacyProtocol!.originalHost))
    ||hashCanonical(locks.map(l=>l.record))!==proof.legacyProtocol!.originalLocksHash)throw new Error('RECONCILIATION_AUTHORITY_UNAVAILABLE');
  const run=ledger.state.runs.find(r=>r.assignmentId===proof.assignmentId),record=ledger.records.find(r=>r.kind==='AssignmentEnvelope'&&r.value.assignmentId===proof.assignmentId);
  if(!run||run.status!=='UNKNOWN'||run.runId||run.childSessionId||record?.kind!=='AssignmentEnvelope'||!verifyReviewerNoDispatchProof(proof,record.value,{...run,status:'NOT_DISPATCHED',dispatchProofRef:'migration-audit'}))throw new Error('RECONCILIATION_PROOF_INVALID');
  const incarnation=currentProcessIncarnation();if(!incarnation)throw new Error('RECONCILIATION_AUTHORITY_UNAVAILABLE');
  const a:ReconciliationAttempt={schemaVersion:1,id:`reconciliation-${randomUUID()}`,taskId:ledger.state.taskId,assignmentId:run.assignmentId,runId:null,
    oldStatus:'UNKNOWN',result:'VERIFIED_NOT_DISPATCHED',reason:'FROZEN_LEGACY_FULL_MANIFEST_EXCEEDS_PRE_SPAWN_RPC_LIMIT',revision:ledger.state.revision,
    eventHash:ledger.events.at(-1)!.eventHash,observedAt:new Date().toISOString(),noDispatchProof:proof,
    authority:{scope:'RECONCILIATION_AUDIT_ONLY',sessionId,processIncarnation:incarnation,oldOwners:locks.map(l=>({record:l.record,deathProof:l.owner}))}};
  try{persist(join(fresh.root!,`${a.id}.json`),a)}catch(error){retain();throw error}return a;
 });
}
/** Persisted legacy receipts retain exact original protocol, assignment, candidate and event bindings. */
export function reconciledNoDispatchAttempts(dataRoot:string,ledger:StoredLedger):ReconciliationAttempt[]{
 const attempts=reconciliationAttempts(dataRoot,ledger).filter(a=>a.eventHash===ledger.events.at(-1)!.eventHash);
 if(attempts.some(a=>a.result==='CONTRADICTORY'))throw new Error('RECONCILIATION_CONTRADICTORY');
 return attempts.filter(a=>a.result==='VERIFIED_NOT_DISPATCHED').map(a=>{
  const run=ledger.state.runs.find(r=>r.assignmentId===a.assignmentId),record=ledger.records.find(r=>r.kind==='AssignmentEnvelope'&&r.value.assignmentId===a.assignmentId),proof=a.noDispatchProof,legacy=proof?.legacyProtocol;
  if(!run||run.status!=='UNKNOWN'||run.runId||run.childSessionId||a.runId!==null||a.oldStatus!=='UNKNOWN'||record?.kind!=='AssignmentEnvelope'||!proof||!legacy
    ||a.revision!==legacy.ledgerRevision||a.eventHash!==legacy.ledgerEventHash||!ledger.state.candidate||canonicalize(legacy.manifestRef)!==canonicalize(ledger.state.candidate.manifest)
    ||!verifyReviewerNoDispatchProof(proof,record.value,{...run,status:'NOT_DISPATCHED',dispatchProofRef:'migration-audit'})
    ||hashCanonical((a.authority.oldOwners as {record:LockRecord}[]).map(l=>l.record))!==legacy.originalLocksHash)throw new Error('RECONCILIATION_PROOF_INVALID');return a;
 });
}
export function reconciledQuiescentAttempts(dataRoot:string,ledger:StoredLedger):ReconciliationAttempt[]{return [...reconciledTerminalAttempts(dataRoot,ledger),...reconciledNoDispatchAttempts(dataRoot,ledger)]}
/** Restricted recovery authority: audit only, never permission to launch, mutate workflow or reclaim locks. */
export function recordReconciliationAttempt(dataRoot:string,storeRoot:string,sessionId:string,assignmentId:string,
  result:ReconciliationAttempt['result'],reason:string,proof?:TerminalProof):ReconciliationAttempt{
  if(!validateScalar('Text',sessionId).ok||!validateScalar('Text',reason).ok||!['UNRESOLVED','VERIFIED_TERMINAL','CONTRADICTORY'].includes(result)||
    (result!=='VERIFIED_TERMINAL'&&proof))throw new Error('RECONCILIATION_INPUT_INVALID');
  const initial=inspect(dataRoot,storeRoot);
  if(!initial.ledger||!initial.root||!initial.workspaceHash||initial.recovery.lockOwnerStatus!=='DEAD'||initial.ledger.state.runs.some(r=>r.status==='INTENT'))throw new Error('RECONCILIATION_AUTHORITY_UNAVAILABLE');
  return withLockMutation(initial.root,initial.workspaceHash,retain=>{
    const fresh=inspect(dataRoot,storeRoot,true),ledger=fresh.ledger,locks=fresh.locks;
    if(!ledger||canonicalize(ledger)!==canonicalize(initial.ledger)||canonicalize(locks)!==canonicalize(initial.locks)||locks?.length!==2||
      locks[0].record.kind!=='TASK'||locks[0].record.taskId!==ledger.state.taskId||locks[1].record.kind!=='WORKSPACE'||
      locks.some(l=>l.owner.status!=='DEAD'||l.record.workspaceHash!==fresh.workspaceHash||l.record.ownerSessionId!==ledger.state.ownerSessionId)||
      locks[0].record.runtimeGeneration!==locks[1].record.runtimeGeneration||canonicalize(locks[0].record.processIncarnation)!==canonicalize(locks[1].record.processIncarnation))throw new Error('RECONCILIATION_AUTHORITY_UNAVAILABLE');
    const run=ledger.state.runs.find(r=>r.assignmentId===assignmentId),incarnation=currentProcessIncarnation();
    if(!incarnation||!sessionId||!run||!['UNKNOWN','BOUND','RUNNING'].includes(run.status))throw new Error('RECONCILIATION_RUN_INVALID');
    if(result==='VERIFIED_TERMINAL'&&(!proof||!isAcquiredTerminalProof(proof)||!run.runId||!run.childSessionId||!verifyTerminalProof(proof,
      {runId:run.runId,role:run.role,requestId:run.requestId,ownerSessionId:run.ownerSessionId,childSessionId:run.childSessionId})))throw new Error('RECONCILIATION_PROOF_INVALID');
    const a:ReconciliationAttempt={schemaVersion:1,id:`reconciliation-${randomUUID()}`,taskId:ledger.state.taskId,assignmentId,runId:run.runId??null,
      oldStatus:run.status,result,reason,revision:ledger.state.revision,eventHash:ledger.events.at(-1)!.eventHash,observedAt:new Date().toISOString(),
      ...(proof?{terminalProof:proof}:{}),authority:{scope:'RECONCILIATION_AUDIT_ONLY',sessionId,processIncarnation:incarnation,oldOwners:locks.map(l=>({record:l.record,deathProof:l.owner}))}};
    try{persist(join(fresh.root!,`${a.id}.json`),a)}catch(error){retain();throw error}return a;
  });
}

export type RecoveryClassification='CLEAN_TERMINAL'|'CLEAN_NONTERMINAL'|'INTERRUPTED_WITH_PROVEN_TERMINAL_CHILDREN'|
  'INTERRUPTED_WITH_UNKNOWN_CHILD'|'STALE_LOCK_PROVABLE'|'LOCK_OWNER_UNCERTAIN'|'STORE_INCONSISTENT';
export interface RecoveryStatus {readonly required:boolean;readonly classification:RecoveryClassification;
  readonly lockOwnerStatus:'LIVE'|'DEAD'|'UNCERTAIN'|'NONE';readonly safeReclaimPossible:boolean;
  readonly automaticResumeAllowed:false;readonly reason:string}
interface Inspection {recovery:RecoveryStatus;ledger?:StoredLedger;root?:string;workspaceHash?:string;
  locks?:{path:string;record:LockRecord;owner:OwnerEvidence}[]}
const hash=(text:string)=>hashBytes(Buffer.from(text,'utf8'));
const status=(classification:RecoveryClassification,lockOwnerStatus:RecoveryStatus['lockOwnerStatus'],reason:string):RecoveryStatus=>
  ({required:classification!=='CLEAN_TERMINAL',classification,lockOwnerStatus,safeReclaimPossible:classification==='STALE_LOCK_PROVABLE',automaticResumeAllowed:false,reason});
function directory(path:string):void {const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(path)!==path)throw new Error('RECOVERY_PATH_INVALID')}
function exists(path:string):boolean {try{lstatSync(path);return true}catch(error){if((error as {code?:string}).code==='ENOENT')return false;throw error}}
function lock(path:string):LockRecord|undefined {
  if(!exists(path))return undefined;
  const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>16384)throw new Error('RECOVERY_LOCK_INVALID');
  const value=parseJson(readFileSync(path),16384) as unknown as LockRecord;
  if(!value||![1,2].includes(value.schemaVersion)||!['TASK','WORKSPACE'].includes(value.kind)||
    !/^[a-f0-9]{64}$/.test(value.workspaceHash)||typeof value.token!=='string'||!value.token||
    typeof value.ownerSessionId!=='string'||typeof value.runtimeGeneration!=='string'||typeof value.acquiredAt!=='string')throw new Error('RECOVERY_LOCK_INVALID');
  return value;
}
export function validateRecoveryHistory(ledger:StoredLedger):void {
  const runs=ledger.state.runs;
  if(ledger.state.counters.dispatches!==runs.length||new Set(runs.map(r=>r.assignmentId)).size!==runs.length||
    new Set(runs.filter(r=>r.runId).map(r=>r.runId)).size!==runs.filter(r=>r.runId).length)throw new Error('RECOVERY_HISTORY_INVALID');
  const states=[ledger.state,...ledger.records.filter(r=>r.kind==='WorkflowState').map(r=>r.value)].sort((a,b)=>a.revision-b.revision);
  for(const run of runs)if(states.find(state=>state.runs.some(r=>r.assignmentId===run.assignmentId))?.ownerSessionId!==run.ownerSessionId)throw new Error('RECOVERY_HISTORY_INVALID');
  const historical=ledger.records.flatMap(r=>r.kind==='WorkflowState'?[...r.value.runs]:r.kind==='RunRecord'?[r.value]:[]);
  for(const old of historical){const current=runs.find(r=>r.assignmentId===old.assignmentId);
    if(!current||current.attemptId!==old.attemptId||current.role!==old.role||current.ownerSessionId!==old.ownerSessionId||
      (old.status==='TERMINAL'&&(current.status!=='TERMINAL'||current.runId!==old.runId||current.terminalProofRef!==old.terminalProofRef))||
      (old.status==='NOT_DISPATCHED'&&(current.status!=='NOT_DISPATCHED'||current.dispatchProofRef!==old.dispatchProofRef)))throw new Error('RECOVERY_HISTORY_INVALID');
  }
}
function inspect(dataRoot:string,storeRoot:string,underGuard=false):Inspection {
  let ledger:StoredLedger,root:string,workspaceHash:string;
  try {
    directory(dataRoot);if(resolve(dataRoot)!==dataRoot)throw new Error();
    ledger=DurableStore.load(storeRoot);if(ledger.truncatedTailBytes)throw new Error();
    validateRecoveryHistory(ledger);
    const spec=ledger.records.find(r=>r.kind==='TaskSpec'&&r.id===ledger.state.spec.id);
    if(!spec||spec.kind!=='TaskSpec')throw new Error();
    workspaceHash=hash(spec.value.scope.repoRoot);
    const placement=resolveProjectStorage(dataRoot,spec.value.scope.repoRoot),project=join(placement.projectRoot,'tasks',ledger.state.taskId);
    if(project!==storeRoot)throw new Error();
    assertProjectStoragePath(placement,storeRoot);
    root=join(dataRoot,'controlled-dev','locks');
  }catch{return {recovery:status('STORE_INCONSISTENT','UNCERTAIN','DURABLE_STORE_NOT_COHERENT')}}
  const base={ledger,root,workspaceHash};
  try {
    directory(root);directory(join(root,'tasks'));directory(join(root,'workspaces'));
    const guarded=!underGuard&&exists(join(root,'workspaces',`${workspaceHash}.guard`));
    const paths=[join(root,'tasks',`${hash(`${workspaceHash}\0${ledger.state.taskId}`)}.lock`),join(root,'workspaces',`${workspaceHash}.lock`)];
    const locks=paths.flatMap(path=>{const record=lock(path);return record?[{path,record,owner:liveLockRecord(record)?
      {status:'LIVE' as const,reason:'LIVE_P14D_HANDLE'}:inspectProcessOwner(record.schemaVersion===2?record.processIncarnation:undefined)}]:[]});
    if(guarded)return {...base,locks,recovery:status('LOCK_OWNER_UNCERTAIN',locks.some(l=>l.owner.status==='LIVE')?'LIVE':'UNCERTAIN','LOCK_MUTATION_OR_PARTIAL_RECOVERY_PENDING')};
    const reconciled=reconciledQuiescentAttempts(dataRoot,ledger);
    const unknownChild=ledger.state.runs.some(run=>!runQuiescent(run)&&!reconciled.some(a=>a.assignmentId===run.assignmentId))||
      ['IMPLEMENTING','TESTING','REVIEWING','REWORK'].includes(ledger.state.state);
    // These phases can contain synchronous host subprocesses without a durable terminal record.
    // RunRecord quiescence alone cannot prove their death; P16A deliberately refuses reclaim.
    // load() validates every terminal proof and all historical event/catalog/state bindings.
    if(locks.length===0)return {...base,locks,recovery:status(unknownChild?'INTERRUPTED_WITH_UNKNOWN_CHILD':
      ['COMPLETED','FAILED'].includes(ledger.state.state)?'CLEAN_TERMINAL':
      ['PENDING','READY','AWAITING_HUMAN'].includes(ledger.state.state)?'CLEAN_NONTERMINAL':'INTERRUPTED_WITH_PROVEN_TERMINAL_CHILDREN',
      'NONE',unknownChild?'UNRESOLVED_RUN_OR_INTENT':'NO_LOCKS_NO_AUTOMATIC_RESUME')};
    const owner=locks.some(l=>l.owner.status==='LIVE')?'LIVE':locks.every(l=>l.owner.status==='DEAD')?'DEAD':'UNCERTAIN';
    if(unknownChild)return {...base,locks,recovery:status('INTERRUPTED_WITH_UNKNOWN_CHILD',owner,'UNRESOLVED_RUN_OR_INTENT')};
    if(locks.length!==2||locks[0].record.kind!=='TASK'||locks[0].record.taskId!==ledger.state.taskId||locks[1].record.kind!=='WORKSPACE'||
      locks.some(l=>l.record.workspaceHash!==workspaceHash||l.record.ownerSessionId!==ledger.state.ownerSessionId)||
      locks[0].record.runtimeGeneration!==locks[1].record.runtimeGeneration||
      canonicalize(locks[0].record.processIncarnation??null)!==canonicalize(locks[1].record.processIncarnation??null))
      return {...base,locks,recovery:status('LOCK_OWNER_UNCERTAIN',owner,'LOCK_PAIR_INCOMPLETE_OR_CONTRADICTORY')};
    for(const name of readdirSync(join(root,'tasks')))if(name.endsWith('.lock')&&join(root,'tasks',name)!==paths[0]&&lock(join(root,'tasks',name))?.workspaceHash===workspaceHash)
      return {...base,locks,recovery:status('LOCK_OWNER_UNCERTAIN',owner,'OTHER_TASK_LOCK_ON_WORKSPACE')};
    return {...base,locks,recovery:status(owner==='DEAD'?'STALE_LOCK_PROVABLE':'LOCK_OWNER_UNCERTAIN',owner,
      owner==='DEAD'?'OWNER_DEAD_ALL_RUNS_PROVEN_TERMINAL':owner==='LIVE'?'OWNER_STILL_LIVE':'OWNER_DEATH_NOT_PROVEN')};
  }catch{return {...base,recovery:status('LOCK_OWNER_UNCERTAIN','UNCERTAIN','LOCK_EVIDENCE_UNREADABLE')}}
}
/** Read-only host API. No supplied ownerDead/reclaim flag or model evidence is accepted. */
export function classifyRecoveryState(dataRoot:string,storeRoot:string):{readonly recovery:RecoveryStatus} {
  return {recovery:inspect(dataRoot,storeRoot).recovery};
}
function syncDirectory(path:string):void{const fd=openSync(path,'r');try{fsyncSync(fd)}finally{closeSync(fd)}}
function persist(path:string,value:unknown):void {
  const content=canonicalize(value)+'\n';if(Buffer.byteLength(content,'utf8')>1024*1024)throw new Error('RECOVERY_EVIDENCE_TOO_LARGE');
  const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,content);fsyncSync(fd)}finally{closeSync(fd)}syncDirectory(dirname(path));
}
export type RecoveryFaultPoint='beforeMutex'|'afterAuthorization'|'afterTaskRemoval'|'beforeWorkspaceRemoval';
/** Explicit trusted-host operation; intentionally has no orchestrator, runner, gate or continuation access. */
export function recoverLocks(dataRoot:string,storeRoot:string,fault?:(point:RecoveryFaultPoint)=>void):
  {readonly recovery:RecoveryStatus;readonly reclaimed:boolean;readonly auditId?:string} {
  const initial=inspect(dataRoot,storeRoot);
  if(!initial.recovery.safeReclaimPossible)return {recovery:initial.recovery,reclaimed:false};
  fault?.('beforeMutex');
  return withLockMutation(initial.root!,initial.workspaceHash!,retain=>{
    const fresh=inspect(dataRoot,storeRoot,true);
    if(!fresh.recovery.safeReclaimPossible||canonicalize(fresh.locks)!==canonicalize(initial.locks))
      return {recovery:status('LOCK_OWNER_UNCERTAIN','UNCERTAIN','RECOVERY_RACE_OR_OWNERSHIP_CHANGED'),reclaimed:false};
    const auditId=`recovery-${randomUUID()}`,path=join(fresh.root!,`${auditId}.json`);
    // Retain the exclusive guard on ANY uncertain authorization/removal/outcome commit.
    let complete=false;
    try {
      const reconciled=reconciledQuiescentAttempts(dataRoot,fresh.ledger!),proofIds=new Map(reconciled.map(a=>[a.assignmentId,`terminal-${a.id}`]));
      persist(path,{schemaVersion:1,id:auditId,taskId:fresh.ledger!.state.taskId,revision:fresh.ledger!.state.revision,
        eventHash:fresh.ledger!.events.at(-1)!.eventHash,classification:fresh.recovery.classification,
        authorization:'RECLAIM_LOCK_PAIR_ONLY',automaticResumeAllowed:false,
        oldOwners:fresh.locks!.map(l=>({record:l.record,deathProof:l.owner})),...(reconciled.length?{reconciliationProofs:reconciled}:{}),
        quiescenceProof:fresh.ledger!.state.runs.map(run=>runQuiescenceProjection(runQuiescent(run)?run:reconciled.find(a=>a.assignmentId===run.assignmentId)?.result==='VERIFIED_NOT_DISPATCHED'?{...run,status:'NOT_DISPATCHED',dispatchProofRef:`dispatch-${reconciled.find(a=>a.assignmentId===run.assignmentId)!.id}`}:{...run,terminalProofRef:proofIds.get(run.assignmentId)!}))});
      fault?.('afterAuthorization');
      for(const [index,item] of fresh.locks!.entries()){
        if(index===1)fault?.('beforeWorkspaceRemoval');
        if(canonicalize(lock(item.path)??null)!==canonicalize(item.record))throw new Error('RECOVERY_OWNERSHIP_CHANGED');
        unlinkSync(item.path);syncDirectory(dirname(item.path));
        if(index===0)fault?.('afterTaskRemoval');
      }
      persist(join(fresh.root!,`${auditId}-complete.json`),{schemaVersion:1,id:auditId,outcome:'PAIR_RECLAIMED',automaticResumeAllowed:false});
      complete=true;
      return {recovery:inspect(dataRoot,storeRoot,true).recovery,reclaimed:true,auditId};
    }finally{if(!complete)retain()}
  });
}
