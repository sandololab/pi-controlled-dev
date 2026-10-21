import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { hashBytes, hashCanonical } from './contracts.js';
import { currentProcessIncarnation, inspectProcessOwner } from './process-incarnation.js';
import type { ProcessIncarnation } from './process-incarnation.js';

export type LockKind='TASK'|'WORKSPACE';
export type LockErrorCode='LOCK_INPUT_INVALID'|'TASK_LOCK_UNAVAILABLE'|'WORKSPACE_LOCK_UNAVAILABLE'|'LOCK_CREATE_FAILED'|'LOCK_OWNERSHIP_LOST'|'LOCK_RELEASE_FAILED';
export class LockError extends Error{constructor(readonly code:LockErrorCode){super(code)}}
export interface LockRecord{readonly schemaVersion:1|2;readonly processIncarnation?:ProcessIncarnation;readonly kind:LockKind;readonly taskId?:string;readonly workspaceHash:string;
  readonly ownerSessionId:string;readonly runtimeGeneration:string;readonly token:string;readonly acquiredAt:string}
export interface LockHandle{readonly kind:LockKind;readonly path:string;readonly record:LockRecord}
export interface WorkflowLocks{readonly workspace:LockHandle;readonly task:LockHandle}
const active=new WeakSet<object>();
const id=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const hash=(value:string)=>hashBytes(Buffer.from(value,'utf8'));
const same=(a:LockRecord,b:LockRecord)=>JSON.stringify(a)===JSON.stringify(b);

/** Exclusive-create locks only. Existing locks are never reclaimed by age, PID, or session metadata. */
export class LockManager{
  readonly root:string;
  constructor(dataRoot:string,readonly ownerSessionId:string,readonly runtimeGeneration:string,
    readonly fault?:(point:'afterExclusiveCreate'|'beforeRelease')=>void){
    if(!id.test(runtimeGeneration)||!ownerSessionId||ownerSessionId.length>4096)throw new LockError('LOCK_INPUT_INVALID');
    const data=realpathSync(dataRoot);if(data!==resolve(dataRoot))throw new LockError('LOCK_INPUT_INVALID');
    this.root=join(data,'controlled-dev','locks');
    for(const path of [join(data,'controlled-dev'),this.root,join(this.root,'tasks'),join(this.root,'workspaces')]){
      try{mkdirSync(path,{mode:0o700})}catch(error){if((error as {code?:string}).code!=='EEXIST')throw error}
      const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(path)!==path)throw new LockError('LOCK_INPUT_INVALID');
      syncDirectory(dirname(path));
    }
  }
  workspaceIdentity(workspaceRoot:string):{canonicalRoot:string;workspaceHash:string}{
    const canonicalRoot=realpathSync(workspaceRoot);if(canonicalRoot!==resolve(workspaceRoot))throw new LockError('LOCK_INPUT_INVALID');
    return {canonicalRoot,workspaceHash:hash(canonicalRoot)};
  }
  /** Only the final absent leaf is permitted; the canonical parent must already exist. */
  bootstrapIdentity(target:string):{canonicalRoot:string;workspaceHash:string}{
    if(resolve(target)!==target||realpathSync(dirname(target))!==dirname(target))throw new LockError('LOCK_INPUT_INVALID');
    if(existsSync(target))return this.workspaceIdentity(target);
    return {canonicalRoot:target,workspaceHash:hash(target)};
  }
  acquireBootstrap(target:string):LockHandle {
    const {workspaceHash}=this.bootstrapIdentity(target);
    return withLockMutation(this.root,workspaceHash,()=>this.#acquire('WORKSPACE',join(this.root,'workspaces',`${workspaceHash}.lock`),workspaceHash));
  }
  acquireWorkspace(workspaceRoot:string):LockHandle{
    const {workspaceHash}=this.workspaceIdentity(workspaceRoot);
    return withLockMutation(this.root,workspaceHash,()=>this.#acquire('WORKSPACE',join(this.root,'workspaces',`${workspaceHash}.lock`),workspaceHash));
  }
  acquireTask(taskId:string,workspaceRoot:string):LockHandle{
    if(!id.test(taskId))throw new LockError('LOCK_INPUT_INVALID');
    const {workspaceHash}=this.workspaceIdentity(workspaceRoot),key=hash(`${workspaceHash}\0${taskId}`);
    return withLockMutation(this.root,workspaceHash,()=>this.#acquire('TASK',join(this.root,'tasks',`${key}.lock`),workspaceHash,taskId));
  }
  acquire(taskId:string,workspaceRoot:string):WorkflowLocks{
    const workspace=this.acquireWorkspace(workspaceRoot);
    try{return Object.freeze({workspace,task:this.acquireTask(taskId,workspaceRoot)})}
    catch(error){this.release(workspace);throw error}
  }
  verifyWorkspaceLock(handle:LockHandle):boolean{return this.#verify(handle,'WORKSPACE')}
  verifyTaskLock(handle:LockHandle):boolean{return this.#verify(handle,'TASK')}
  /** Project operations have no task lock. Reclaim only the exact dead host lease,
   * serialized by the same generation-claim repair guard as workflow recovery. */
  reclaimProjectWorkspace(workspaceRoot:string,expected:LockRecord):void{
    const {workspaceHash}=expected.ownerSessionId.startsWith('greenfield-bootstrap-')?this.bootstrapIdentity(workspaceRoot):this.workspaceIdentity(workspaceRoot),path=join(this.root,'workspaces',`${workspaceHash}.lock`);
    if(expected.kind!=='WORKSPACE'||expected.workspaceHash!==workspaceHash||!['candidate-promotion-','greenfield-bootstrap-'].some(prefix=>expected.ownerSessionId.startsWith(prefix)))throw new LockError('LOCK_INPUT_INVALID');
    withRepairMutation(this.root,workspaceHash,()=>{
      const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16384)throw new LockError('LOCK_OWNERSHIP_LOST');
      const current=JSON.parse(Buffer.from(readFileSync(path)).toString('utf8')) as LockRecord;
      if(!same(current,expected)||inspectProcessOwner(current.processIncarnation).status!=='DEAD')throw new LockError('LOCK_OWNERSHIP_LOST');
      const audit=join(this.root,'workspaces',`${workspaceHash}.${expected.token}.reclaimed`),fd=openSync(audit,'wx',0o600);
      try{writeFileSync(fd,JSON.stringify({schemaVersion:1,previous:expected,successor:currentProcessIncarnation(),reclaimedAt:new Date().toISOString()}));fsyncSync(fd)}finally{closeSync(fd)}
      unlinkSync(path);syncDirectory(dirname(path));
    });
  }
  /** Exact dead checkpoint lease only; generation-claim guard serializes takeover.
   * Host death never proves Reviewer terminality or a checkpoint outcome. */
  reclaimCheckpointTask(workspaceRoot:string,expected:LockRecord):boolean {
    return this.#reclaimProjectTask(workspaceRoot,expected,'checkpoint-','integration-checkpoint-');
  }
  reclaimAutonomyTask(workspaceRoot:string,expected:LockRecord):boolean {
    return this.#reclaimProjectTask(workspaceRoot,expected,'autonomy-run-','autonomy-controller-');
  }
  #reclaimProjectTask(workspaceRoot:string,expected:LockRecord,taskPrefix:string,ownerPrefix:string):boolean {
    const {workspaceHash}=this.workspaceIdentity(workspaceRoot),taskId=expected.taskId;
    if(expected.kind!=='TASK'||expected.workspaceHash!==workspaceHash||!taskId?.startsWith(taskPrefix)
      ||!expected.ownerSessionId.startsWith(ownerPrefix))throw new LockError('LOCK_INPUT_INVALID');
    const path=join(this.root,'tasks',`${hash(`${workspaceHash}\0${taskId}`)}.lock`);
    return withRepairMutation(this.root,workspaceHash,()=>{
      if(!existsSync(path))return false;const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16384)throw new LockError('LOCK_OWNERSHIP_LOST');
      const current=JSON.parse(Buffer.from(readFileSync(path)).toString('utf8')) as LockRecord;
      if(hashCanonical(current)!==hashCanonical(expected)||inspectProcessOwner(current.processIncarnation).status!=='DEAD')throw new LockError('LOCK_OWNERSHIP_LOST');
      const audit=join(this.root,'tasks',`${hash(`${workspaceHash}\0${taskId}`)}.${expected.token}.reclaimed`),fd=openSync(audit,'wx',0o600);
      try{writeFileSync(fd,JSON.stringify({schemaVersion:1,previous:expected,successor:currentProcessIncarnation(),reclaimedAt:new Date().toISOString()}));fsyncSync(fd)}finally{closeSync(fd)}
      unlinkSync(path);syncDirectory(dirname(path));return true;
    });
  }
  release(handle:LockHandle):void{
    if(!active.has(handle))return;
    withLockMutation(this.root,handle.record.workspaceHash,()=>{
      if(!this.#verify(handle,handle.kind))throw new LockError('LOCK_OWNERSHIP_LOST');
      try{this.fault?.('beforeRelease');unlinkSync(handle.path);syncDirectory(dirname(handle.path));active.delete(handle);inspectLive.delete(handle.record.token)}catch{throw new LockError('LOCK_RELEASE_FAILED')}
    });
  }
  releaseAll(locks:WorkflowLocks):void{
    // Reverse acquisition order. A failed task release leaves workspace held fail-closed.
    this.release(locks.task);this.release(locks.workspace);
  }
  #acquire(kind:LockKind,path:string,workspaceHash:string,taskId?:string):LockHandle{
    const processIncarnation=currentProcessIncarnation();
    const record:LockRecord=Object.freeze({schemaVersion:2,...(processIncarnation?{processIncarnation}:{}),kind,...(taskId?{taskId}:{}),workspaceHash,ownerSessionId:this.ownerSessionId,
      runtimeGeneration:this.runtimeGeneration,token:randomUUID(),acquiredAt:new Date().toISOString()});
    let fd:number;
    try{fd=openSync(path,'wx',0o600)}catch(error){
      if((error as {code?:string}).code==='EEXIST')throw new LockError(kind==='TASK'?'TASK_LOCK_UNAVAILABLE':'WORKSPACE_LOCK_UNAVAILABLE');
      throw new LockError('LOCK_CREATE_FAILED');
    }
    try{this.fault?.('afterExclusiveCreate');writeFileSync(fd,JSON.stringify(record));fsyncSync(fd);closeSync(fd);syncDirectory(dirname(path))}
    catch{try{closeSync(fd!)}catch{}throw new LockError('LOCK_CREATE_FAILED')}
    const handle=Object.freeze({kind,path,record});active.add(handle);inspectLive.add(record.token);return handle;
  }
  #verify(handle:LockHandle,kind:LockKind):boolean{
    if(!active.has(handle)||handle.kind!==kind||handle.record.kind!==kind||handle.record.ownerSessionId!==this.ownerSessionId
      ||handle.record.runtimeGeneration!==this.runtimeGeneration)return false;
    try{
      const stat=lstatSync(handle.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16384)throw new LockError('LOCK_OWNERSHIP_LOST');
      const value=JSON.parse(Buffer.from(readFileSync(handle.path)).toString('utf8')) as LockRecord;
      if(!same(value,handle.record))throw new LockError('LOCK_OWNERSHIP_LOST');return true;
    }catch(error){if((error as {code?:string}).code==='ENOENT')return false;if(error instanceof LockError)throw error;throw new LockError('LOCK_OWNERSHIP_LOST')}
  }
}
/** All current lock mutations and recovery use this exclusive workspace guard.
 * ponytail: a crashed guard stays blocked until later operator reconciliation. */
export function withLockMutation<T>(root:string,workspaceHash:string,action:(retain:()=>void)=>T):T {
  if(!/^[a-f0-9]{64}$/.test(workspaceHash))throw new LockError('LOCK_INPUT_INVALID');
  const path=join(root,'workspaces',`${workspaceHash}.guard`);
  const token=JSON.stringify({schemaVersion:2,token:randomUUID(),workspaceHash,processIncarnation:currentProcessIncarnation()});
  const fd=openSync(path,'wx',0o600);let retained=false;
  try{writeFileSync(fd,token);fsyncSync(fd)}catch(error){retained=true;throw error}finally{closeSync(fd)}
  try{syncDirectory(dirname(path));return action(()=>{retained=true})}
  finally{if(!retained){if(Buffer.from(readFileSync(path)).toString('utf8')!==token)throw new LockError('LOCK_OWNERSHIP_LOST');unlinkSync(path);syncDirectory(dirname(path))}}
}
/** PST-002: immutable generation claims serialize dead-guard takeover, including competing repairers.
 * Claims are never removed: a stale observer cannot win again for an old guard generation.
 * ponytail: at most 32 interrupted claimants; beyond that require operator investigation. */
export function withRepairMutation<T>(root:string,workspaceHash:string,action:(retain:()=>void,reclaimedGuard?:string)=>T):T {
  if(!/^[a-f0-9]{64}$/.test(workspaceHash))throw new LockError('LOCK_INPUT_INVALID');
  const dir=join(root,'workspaces'),path=join(dir,`${workspaceHash}.guard`);
  const read=(p:string)=>{const s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>16384)throw new Error('RECOVERY_AMBIGUOUS');
    return Buffer.from(readFileSync(p)).toString('utf8')};
  let original:string|undefined;
  try{original=read(path)}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error}
  if(original!==undefined){
    let candidate=original,won=false;
    for(let depth=0;depth<32;depth++){
      let old:any;try{old=JSON.parse(candidate)}catch{throw new Error('RECOVERY_AMBIGUOUS')}
      if(old.schemaVersion!==2||old.workspaceHash!==workspaceHash||typeof old.token!=='string'||
        !/^[a-f0-9-]{36}$/.test(old.token)||inspectProcessOwner(old.processIncarnation).status!=='DEAD')throw new Error('RECOVERY_AMBIGUOUS');
      const claim=join(dir,`${workspaceHash}.${old.token}.claim`),incarnation=currentProcessIncarnation();
      if(!incarnation)throw new Error('RECOVERY_AMBIGUOUS');
      let fd:number;
      try{fd=openSync(claim,'wx',0o600)}catch(error){if((error as {code?:string}).code!=='EEXIST')throw error;candidate=read(claim);continue}
      try{writeFileSync(fd,JSON.stringify({schemaVersion:2,token:randomUUID(),workspaceHash,processIncarnation:incarnation}));fsyncSync(fd)}finally{closeSync(fd)}
      syncDirectory(dir);won=true;break;
    }
    if(!won||read(path)!==original)throw new Error('RECOVERY_RACE');
    unlinkSync(path);syncDirectory(dir);
  }
  return withLockMutation(root,workspaceHash,retain=>action(retain,original));
}
export function liveLockRecord(record:LockRecord):boolean{return inspectLive.has(record.token)}
const inspectLive=new Set<string>();
function syncDirectory(path:string):void{const fd=openSync(path,'r');try{fsyncSync(fd)}finally{closeSync(fd)}}

/** Hold one project lease across host maintenance and native confirmation.
 * Reclaim only a verified dead process incarnation, never a lease by age. */
export async function withProjectWorkspaceLease<T>(data:string,repo:string,action:(manager:LockManager,lock:LockHandle)=>Promise<T>,options:{readonly retainLeaseOnFailure?:boolean}={}):Promise<T>{
  const manager=new LockManager(data,`candidate-promotion-${randomUUID()}`,`promotion-${randomUUID()}`);let lock:LockHandle;
  try{lock=manager.acquireWorkspace(repo)}catch(error){
    if((error as {code?:string}).code!=='WORKSPACE_LOCK_UNAVAILABLE')throw error;
    const path=join(manager.root,'workspaces',`${manager.workspaceIdentity(repo).workspaceHash}.lock`),stat=lstatSync(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16384)throw error;
    const prior=JSON.parse(readFileSync(path).toString('utf8')) as LockRecord;
    manager.reclaimProjectWorkspace(repo,prior);lock=manager.acquireWorkspace(repo);
  }
  let completed=false;
  try{const result=await action(manager,lock);completed=true;return result}
  finally{if(completed||options.retainLeaseOnFailure!==true)manager.release(lock)}
}
