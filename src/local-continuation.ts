/** Orderly local authority handoff. Process-death recovery remains independent. */
import {existsSync,lstatSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {Buffer} from 'node:buffer';
import {canonicalize,hashCanonical} from './contracts.js';
import type {ArtifactRef} from './contracts.js';
import {DurableStore} from './store.js';
import type {ArtifactInspection,StoredLedger} from './store.js';
import {LockManager} from './lock-manager.js';
import type {WorkflowLocks} from './lock-manager.js';
import {runQuiescent} from './run-quiescence.js';
import {inspectHostCommandRecovery} from './host-command-recovery.js';

const prefix='local-release-complete-';
function deny():never{throw new Error('LOCAL_CONTINUATION_UNAVAILABLE')}
function quiescent(root:string,ledger:StoredLedger):void{
  if(ledger.truncatedTailBytes||['COMPLETED','FAILED'].includes(ledger.state.state)||ledger.state.runs.some(r=>!runQuiescent(r))
    ||inspectHostCommandRecovery(root,ledger).status!=='QUIESCENT')deny();
}
function sessionHeader(file:string|undefined,sessionId:string,repo:string):void{
  if(!file)deny();const stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>64*1024*1024)deny();
  const header=JSON.parse(Buffer.from(readFileSync(file)).toString('utf8').split('\n')[0]);
  if(header.type!=='session'||header.id!==sessionId||header.cwd!==repo)deny();
}
function json(path:string):any{
  const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>65536)deny();
  return JSON.parse(Buffer.from(readFileSync(path)).toString('utf8'));
}
/** Caller retires all in-memory admission before publishing anything releasable. */
export function releaseLocalContinuation(input:{store:DurableStore;manager:LockManager;locks:WorkflowLocks;sessionFile:string|undefined;retire:()=>void;assertCurrent:()=>void}):void{
  const {store,manager,locks}=input;
  const initial=DurableStore.load(store.root);quiescent(store.root,initial);
  sessionHeader(input.sessionFile,manager.ownerSessionId,initial.state.repoRoot);
  if(initial.state.ownerSessionId!==manager.ownerSessionId)deny();
  manager.releaseContinuation(locks,release=>{
    input.assertCurrent();const fresh=DurableStore.load(store.root);quiescent(store.root,fresh);
    if(canonicalize(fresh)!==canonicalize(initial))deny();
    input.retire();
    const record={schemaVersion:1,kind:'LOCAL_ORDERLY_RELEASE',taskId:fresh.state.taskId,repoRoot:fresh.state.repoRoot,
      ownerSessionId:manager.ownerSessionId,stateDigest:hashCanonical(fresh.state),eventHash:fresh.events.at(-1)!.eventHash,
      specHash:fresh.state.specHash,revision:fresh.state.revision,locks:{task:locks.task.record,workspace:locks.workspace.record}};
    const ref=store.put(`local-release-${locks.workspace.record.token}`,canonicalize(record));
    release();
    // Last publication, while the guard is still held. An incomplete release never qualifies.
    store.put(`${prefix}${locks.workspace.record.token}`,canonicalize({schemaVersion:1,kind:'LOCAL_RELEASE_COMPLETE',release:ref}));
  });
}
export function acquireLocalContinuation(data:string,root:string,sessionId:string,inspect:ArtifactInspection):
  {store:DurableStore;ledger:StoredLedger;manager:LockManager;locks:WorkflowLocks;recordRef:ArtifactRef}|undefined{
  const ledger=DurableStore.load(root),names=readdirSync(join(root,'artifacts')).filter(n=>n.startsWith(prefix));
  if(!names.length)return;
  quiescent(root,ledger);
  const choices=names.flatMap(name=>{
    const complete=json(join(root,'artifacts',name));
    if(complete.schemaVersion!==1||complete.kind!=='LOCAL_RELEASE_COMPLETE')deny();
    const record=JSON.parse(Buffer.from(DurableStore.readArtifact(root,complete.release)).toString('utf8'));
    if(record.schemaVersion!==1||record.kind!=='LOCAL_ORDERLY_RELEASE'||name!==prefix+record.locks?.workspace?.token)deny();
    return record.stateDigest===hashCanonical(ledger.state)&&record.eventHash===ledger.events.at(-1)!.eventHash?[{name,record,complete}]:[];
  });
  if(!choices.length)return;
  if(choices.length!==1)deny();
  const {name,record,complete}=choices[0],token=record.locks.workspace.token,claim=`local-release-consumed-${token}`;
  const manager=new LockManager(data,sessionId,`continuation-${token}`);
  const validate=()=>{
    const fresh=DurableStore.load(root);quiescent(root,fresh);
    if(canonicalize(fresh)!==canonicalize(ledger)||record.ownerSessionId!==sessionId||ledger.state.ownerSessionId!==sessionId
      ||record.taskId!==ledger.state.taskId||record.repoRoot!==ledger.state.repoRoot||record.specHash!==ledger.state.specHash
      ||record.revision!==ledger.state.revision||record.locks.task.ownerSessionId!==sessionId||record.locks.workspace.ownerSessionId!==sessionId
      ||record.locks.task.taskId!==ledger.state.taskId||record.locks.task.workspaceHash!==manager.workspaceIdentity(record.repoRoot).workspaceHash
      ||record.locks.workspace.workspaceHash!==record.locks.task.workspaceHash||record.locks.task.runtimeGeneration!==record.locks.workspace.runtimeGeneration
      ||canonicalize(JSON.parse(Buffer.from(DurableStore.readArtifact(root,complete.release)).toString('utf8')))!==canonicalize(record)
      ||canonicalize(json(join(root,'artifacts',name)))!==canonicalize(complete)||existsSync(join(root,'artifacts',claim)))deny();
    const hash=record.locks.workspace.workspaceHash;
    if(existsSync(join(manager.root,'workspaces',hash+'.lock'))||readdirSync(join(manager.root,'tasks')).some(n=>n.endsWith('.lock')&&json(join(manager.root,'tasks',n)).workspaceHash===hash))deny();
  };
  const acquired=manager.acquireContinuation(ledger.state.taskId,ledger.state.repoRoot,validate,locks=>{
    const store=DurableStore.reopen(root,manager,locks,inspect);
    const recordRef=store.put(claim,canonicalize({schemaVersion:1,kind:'LOCAL_RELEASE_CONSUMED',release:complete.release,
      sessionId,stateDigest:record.stateDigest,eventHash:record.eventHash,taskLock:locks.task.record,workspaceLock:locks.workspace.record}));
    return {store,recordRef};
  });
  return {...acquired.value,ledger,manager,locks:acquired.locks};
}
