import { projectIdentity } from './project-identity.js';
import { resolveProjectStorage, assertProjectStoragePath } from './project-storage.js';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { canonicalize, hashBytes, parseJson } from './contracts.js';
import { DurableStore } from './store.js';
import { validateRecoveryHistory } from './recovery.js';
import { currentProcessIncarnation, inspectProcessOwner } from './process-incarnation.js';
import { withRepairMutation } from './lock-manager.js';
import type { LockRecord } from './lock-manager.js';

export type StoreClassification='CLEAN'|'REPAIRABLE'|'AMBIGUOUS'|'CORRUPT';
export interface StoreInspection {classification:StoreClassification;reason:string;previousSnapshotRevision?:number;validWalRevision?:number;
  truncatedTailBytes?:number;automaticResumeAllowed:false;intents?:readonly {assignmentId:string;outcome:'COMPLETED'|'NOT_DISPATCHED'|'AMBIGUOUS'}[]}
export type RepairFault='afterAuthorization'|'afterWalSync'|'afterSnapshotSync'|'afterRename'|'beforeJournal'|'afterJournal';
const encode=(v:unknown)=>Buffer.from(canonicalize(v),'utf8');
const digest=(s:string)=>hashBytes(Buffer.from(s,'utf8'));
function directory(p:string){const s=lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(p)!==p)throw new Error('REPAIR_PATH_INVALID')}
function read(p:string):Uint8Array {const s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>64*1024*1024)throw new Error('REPAIR_FILE_INVALID');return readFileSync(p)}
function optional(p:string):Uint8Array|undefined {try{return read(p)}catch(e){if((e as {code?:string}).code==='ENOENT')return undefined;throw e}}
function sync(p:string){const fd=openSync(p,'r');try{fsyncSync(fd)}finally{closeSync(fd)}}
function save(p:string,raw:Uint8Array){const fd=openSync(p,'wx',0o600);try{writeFileSync(fd,raw);fsyncSync(fd)}finally{closeSync(fd)}sync(dirname(p))}
interface Authorization {schemaVersion:1;id:string;taskId:string;eventHash:string;previousSnapshotRevision:number;validWalRevision:number;
  previousFsyncStatus:'UNKNOWN';sourceWalHash:string;targetWalHash:string;sourceSnapshotHash:string|null;targetSnapshotHash:string;
  evidenceUsed:readonly string[];owner:unknown;oldLocks:readonly LockRecord[];reclaimedGuard?:string}
function completion(a:Authorization){return {schemaVersion:1,id:a.id,authorizationHash:hashBytes(encode(a)),previousSnapshotRevision:a.previousSnapshotRevision,
  validWalRevision:a.validWalRevision,previousFsyncStatus:'UNKNOWN',repairFsyncPerformed:true,rebuiltSnapshotRevision:a.validWalRevision,
  evidenceUsed:a.evidenceUsed,automaticResumeAllowed:false}}
function inspect(data:string,root:string,underGuard=false){
  if(resolve(data)!==data)throw new Error('REPAIR_PATH_INVALID');directory(data);
  const ledger=DurableStore.readHistory(root),state=ledger.state,workspaceHash=digest(state.repoRoot);validateRecoveryHistory(ledger);
  const placement=resolveProjectStorage(data,state.repoRoot);
  if(root!==join(placement.projectRoot,'tasks',state.taskId))throw new Error('REPAIR_PATH_INVALID');
  assertProjectStoragePath(placement,root);
  const lockRoot=join(data,'controlled-dev','locks');directory(lockRoot);directory(join(lockRoot,'tasks'));directory(join(lockRoot,'workspaces'));
  const wal=read(join(root,'events.jsonl')),prefix=wal.slice(0,wal.byteLength-ledger.truncatedTailBytes),snapshot=optional(join(root,'state.json'));
  let previousSnapshotRevision=-1;
  if(snapshot){const value=parseJson(snapshot,64*1024*1024) as any;previousSnapshotRevision=value?.revision;
    if(!Number.isSafeInteger(previousSnapshotRevision)||previousSnapshotRevision<0||previousSnapshotRevision>state.revision)throw new Error('STORE_INCONSISTENT');
    const old=previousSnapshotRevision===state.revision?state:ledger.records.find(r=>r.kind==='WorkflowState'&&r.value.revision===previousSnapshotRevision)?.value;
    if(!old||canonicalize(value)!==canonicalize(old))throw new Error('STORE_INCONSISTENT');
  }
  const target=encode(state),pending:Authorization[]=[];
  for(const name of readdirSync(root).filter(n=>/^repair-[a-f0-9-]{36}\.json$/.test(n))){
    const a=parseJson(read(join(root,name)),1024*1024) as unknown as Authorization;
    if(a.schemaVersion!==1||name!==`${a.id}.json`||a.taskId!==state.taskId||a.previousFsyncStatus!=='UNKNOWN'||!Array.isArray(a.evidenceUsed)||!Array.isArray(a.oldLocks))throw new Error('REPAIR_JOURNAL_INVALID');
    const event=ledger.events.find(e=>e.revision===a.validWalRevision);
    if(!event||event.eventHash!==a.eventHash||event.stateAfter.digest!==a.targetSnapshotHash||
      canonicalize(a.evidenceUsed)!==canonicalize(ledger.events.filter(e=>e.revision<=a.validWalRevision).map(e=>e.eventHash)))throw new Error('REPAIR_JOURNAL_INVALID');
    const backup=read(join(root,`${a.id}.wal`)),backupEnd=backup.lastIndexOf(10)+1;
    if(hashBytes(backup)!==a.sourceWalHash||hashBytes(backup.slice(0,backupEnd))!==a.targetWalHash||!Number.isSafeInteger(a.previousSnapshotRevision)||
      a.previousSnapshotRevision< -1||a.previousSnapshotRevision>a.validWalRevision)throw new Error('REPAIR_JOURNAL_INVALID');
    if(a.sourceSnapshotHash===null){if(a.previousSnapshotRevision!==-1)throw new Error('REPAIR_JOURNAL_INVALID')}
    else {const old=read(join(root,`${a.id}.snapshot`));if(hashBytes(old)!==a.sourceSnapshotHash||
      (parseJson(old,64*1024*1024) as any).revision!==a.previousSnapshotRevision)throw new Error('REPAIR_JOURNAL_INVALID')}
    const done=optional(join(root,`${a.id}.complete.json`));
    if(done){if(canonicalize(parseJson(done,1024*1024))!==canonicalize(completion(a)))throw new Error('REPAIR_JOURNAL_INVALID');continue}
    if(a.eventHash!==ledger.events.at(-1)!.eventHash||a.validWalRevision!==state.revision||a.targetWalHash!==hashBytes(prefix)||a.targetSnapshotHash!==hashBytes(target)||
      ![a.sourceWalHash,a.targetWalHash].includes(hashBytes(wal))||![a.sourceSnapshotHash,a.targetSnapshotHash].includes(snapshot?hashBytes(snapshot):null)||
      hashBytes(read(join(root,`${a.id}.wal`)))!==a.sourceWalHash)throw new Error('REPAIR_JOURNAL_CONTRADICTORY');
    if(a.sourceSnapshotHash!==null&&hashBytes(read(join(root,`${a.id}.snapshot`)))!==a.sourceSnapshotHash)throw new Error('REPAIR_JOURNAL_CONTRADICTORY');
    pending.push(a);
  }
  if(pending.length>1)throw new Error('REPAIR_JOURNAL_CONTRADICTORY');
  const intents=state.runs.map(r=>({assignmentId:r.assignmentId,outcome:r.status==='TERMINAL'?'COMPLETED' as const:r.status==='NOT_DISPATCHED'&&r.dispatchProofRef?'NOT_DISPATCHED' as const:'AMBIGUOUS' as const}));
  // No inference from prose, unreferenced artifacts, absence of results, or process death.
  const changedStates=[state,...ledger.records.filter(r=>r.kind==='WorkflowState'&&r.value.revision>=previousSnapshotRevision).map(r=>r.value as typeof state)];
  let ambiguous=intents.some(i=>i.outcome==='AMBIGUOUS')||(state.state!=='COMPLETED'&&changedStates.some(s=>['IMPLEMENTING','TESTING','REVIEWING','REWORK'].includes(s.state)));
  const guard=optional(join(lockRoot,'workspaces',`${workspaceHash}.guard`));
  if(guard&&!underGuard){try{const g=parseJson(guard,16384) as any;
    ambiguous ||= g.schemaVersion!==2||g.workspaceHash!==workspaceHash||inspectProcessOwner(g.processIncarnation).status!=='DEAD';
  }catch{ambiguous=true}}
  const changed=previousSnapshotRevision!==state.revision||ledger.truncatedTailBytes>0||pending.length>0||!!guard;
  const classification:StoreClassification=ambiguous?'AMBIGUOUS':changed?'REPAIRABLE':'CLEAN';
  return {ledger,wal,prefix,snapshot,target,lockRoot,workspaceHash,pending,guard,
    status:{classification,reason:ambiguous?'RECOVERY_AMBIGUOUS':changed?'EXPLICIT_REPAIR_REQUIRED':'STORE_CLEAN',previousSnapshotRevision,
      validWalRevision:state.revision,truncatedTailBytes:ledger.truncatedTailBytes,automaticResumeAllowed:false as const,intents}};
}
/** Read-only. CLEAN describes storage, not permission to resume or start an effect. */
export function classifyStore(data:string,root:string):StoreInspection {
  try{return inspect(data,root).status}catch(error){return {classification:'CORRUPT',reason:(error as Error).message,automaticResumeAllowed:false}}
}
function deadPair(v:ReturnType<typeof inspect>){
  const {state}=v.ledger,paths=[join(v.lockRoot,'tasks',`${digest(`${v.workspaceHash}\0${state.taskId}`)}.lock`),join(v.lockRoot,'workspaces',`${v.workspaceHash}.lock`)];
  const present=paths.map(p=>{const raw=optional(p);return raw?parseJson(raw,16384) as unknown as LockRecord:undefined});
  const candidates:{id:string;locks:LockRecord[]}[]=[];
  for(const name of readdirSync(v.lockRoot).filter(n=>/^recovery-[a-f0-9-]{36}\.json$/.test(n))){
    const a=parseJson(read(join(v.lockRoot,name)),1024*1024) as any;
    if(a.taskId!==state.taskId||a.revision!==state.revision||a.eventHash!==v.ledger.events.at(-1)!.eventHash)continue;
    if(a.schemaVersion!==1||name!==`${a.id}.json`||a.authorization!=='RECLAIM_LOCK_PAIR_ONLY'||a.classification!=='STALE_LOCK_PROVABLE'||
      a.automaticResumeAllowed!==false||a.oldOwners?.length!==2)throw new Error('REPAIR_RECLAIM_EVIDENCE_INVALID');
    const old=a.oldOwners.map((o:any)=>o.record) as LockRecord[];
    if(present.some((p,i)=>p&&canonicalize(p)!==canonicalize(old[i])))continue;
    const done=optional(join(v.lockRoot,`${a.id}-complete.json`));
    if(done){if(present.some(Boolean)||canonicalize(parseJson(done,1024*1024))!==canonicalize({schemaVersion:1,id:a.id,outcome:'PAIR_RECLAIMED',automaticResumeAllowed:false}))throw new Error('REPAIR_RECLAIM_CONTRADICTORY')}
    candidates.push({id:a.id,locks:old});
  }
  if(candidates.length>1)throw new Error('REPAIR_RECLAIM_CONTRADICTORY');
  const candidate=candidates[0],locks=candidate?.locks??present;
  if(locks.some(l=>!l))throw new Error('REPAIR_OWNER_UNCERTAIN');
  const pair=locks as LockRecord[];
  if(pair[0].kind!=='TASK'||pair[0].taskId!==state.taskId||pair[1].kind!=='WORKSPACE'||pair.some(l=>l.schemaVersion!==2||l.workspaceHash!==v.workspaceHash||
    !l.token||l.ownerSessionId!==state.ownerSessionId||inspectProcessOwner(l.processIncarnation).status!=='DEAD')||
    pair[0].runtimeGeneration!==pair[1].runtimeGeneration||canonicalize(pair[0].processIncarnation)!==canonicalize(pair[1].processIncarnation))throw new Error('REPAIR_OWNER_UNCERTAIN');
  for(const name of readdirSync(join(v.lockRoot,'tasks')).filter(n=>n.endsWith('.lock'))){const p=join(v.lockRoot,'tasks',name);
    if(p!==paths[0]&&(parseJson(read(p),16384) as any).workspaceHash===v.workspaceHash)throw new Error('REPAIR_OWNER_UNCERTAIN')}
  return {locks:pair,paths,...(candidate?{reclaimId:candidate.id}:{})};
}
/** Explicit host-only storage repair. Never launches, calls a provider, decides a gate, or resumes. */
export function repairStore(data:string,root:string,fault?:(point:RepairFault)=>void){
  const initial=inspect(data,root);
  if(initial.status.classification==='AMBIGUOUS')throw new Error('RECOVERY_AMBIGUOUS');
  if(initial.status.classification==='CLEAN')return {repaired:false,status:initial.status};
  const oldLocks=deadPair(initial),incarnation=currentProcessIncarnation();if(!incarnation)throw new Error('REPAIR_OWNER_UNCERTAIN');
  return withRepairMutation(initial.lockRoot,initial.workspaceHash,(retain,reclaimedGuard)=>{
    const fresh=inspect(data,root,true);
    if(fresh.pending.some(a=>inspectProcessOwner(a.owner as Parameters<typeof inspectProcessOwner>[0]).status!=='DEAD'||canonicalize(a.oldLocks)!==canonicalize(oldLocks.locks)))throw new Error('REPAIR_JOURNAL_AUTHORITY_INVALID');
    if(fresh.status.classification==='AMBIGUOUS'||hashBytes(fresh.wal)!==hashBytes(initial.wal)||
      (fresh.snapshot?hashBytes(fresh.snapshot):null)!==(initial.snapshot?hashBytes(initial.snapshot):null)||canonicalize(deadPair(fresh))!==canonicalize(oldLocks))throw new Error('REPAIR_RACE');
    if(oldLocks.reclaimId&&!reclaimedGuard)throw new Error('REPAIR_RECLAIM_GUARD_UNPROVEN');
    if(!reclaimedGuard&&!fresh.pending.length&&!fresh.ledger.truncatedTailBytes&&fresh.status.previousSnapshotRevision===fresh.ledger.state.revision)
      return {repaired:false,status:{...fresh.status,classification:'CLEAN' as const,reason:'STORE_CLEAN'}};
    let complete=false;
    try{
      let a=fresh.pending[0];
      if(!a){
        const id=`repair-${randomUUID()}`;
        save(join(root,`${id}.wal`),fresh.wal);if(fresh.snapshot)save(join(root,`${id}.snapshot`),fresh.snapshot);
        a={schemaVersion:1,id,taskId:fresh.ledger.state.taskId,eventHash:fresh.ledger.events.at(-1)!.eventHash,
          previousSnapshotRevision:fresh.status.previousSnapshotRevision,validWalRevision:fresh.ledger.state.revision,previousFsyncStatus:'UNKNOWN',
          sourceWalHash:hashBytes(fresh.wal),targetWalHash:hashBytes(fresh.prefix),sourceSnapshotHash:fresh.snapshot?hashBytes(fresh.snapshot):null,
          targetSnapshotHash:hashBytes(fresh.target),evidenceUsed:fresh.ledger.events.map(e=>e.eventHash),owner:incarnation,oldLocks:oldLocks.locks,...(reclaimedGuard?{reclaimedGuard}:{})};
        save(join(root,`${id}.json`),encode(a));
      }
      fault?.('afterAuthorization');
      // Sync existing bytes first. A preserved tail is excluded by atomic replacement, never parsed as an event.
      sync(join(root,'events.jsonl'));sync(root);
      if(fresh.ledger.truncatedTailBytes){const temp=join(root,`${a.id}.${randomUUID()}.wal.tmp`);save(temp,fresh.prefix);renameSync(temp,join(root,'events.jsonl'));sync(root)}
      fault?.('afterWalSync');
      const temp=join(root,`${a.id}.${randomUUID()}.snapshot.tmp`);save(temp,fresh.target);fault?.('afterSnapshotSync');
      renameSync(temp,join(root,'state.json'));fault?.('afterRename');sync(root);
      DurableStore.load(root);fault?.('beforeJournal');save(join(root,`${a.id}.complete.json`),encode(completion(a)));fault?.('afterJournal');
      if(oldLocks.reclaimId){
        for(const [index,path] of oldLocks.paths.entries()){
          const raw=optional(path);if(!raw)continue;
          if(canonicalize(parseJson(raw,16384))!==canonicalize(oldLocks.locks[index]))throw new Error('REPAIR_RECLAIM_RACE');
          unlinkSync(path);sync(dirname(path));
        }
        const path=join(fresh.lockRoot,`${oldLocks.reclaimId}-complete.json`);
        if(!optional(path))save(path,encode({schemaVersion:1,id:oldLocks.reclaimId,outcome:'PAIR_RECLAIMED',automaticResumeAllowed:false}));
      }
      complete=true;return {repaired:true,repairId:a.id,status:{...fresh.status,classification:'CLEAN' as const,reason:'STORE_REPAIRED',truncatedTailBytes:0}};
    }finally{if(!complete)retain()}
  });
}
