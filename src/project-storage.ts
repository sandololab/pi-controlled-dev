import { lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { hashBytes, hashCanonical } from './contracts.js';
import type { StoredLedger } from './store.js';
import { projectIdentity } from './project-identity.js';
import { readProjectCustodian, PROJECT_CUSTODIAN_FOLDER, PROJECT_HUMAN_FOLDER } from './project-custodian.js';
import type { ProjectCustodian } from './project-custodian.js';
import { hostGitEnvironment } from './host-git-policy.js';

export class ProjectStorageError extends Error {constructor(readonly code:string){super(code)}}
function fail(code:string):never{throw new ProjectStorageError(code)}
const inside=(root:string,path:string)=>{const rel=relative(root,path);return rel===''||!rel.startsWith('..')&&!rel.startsWith('/')};
function directory(path:string):void{const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(path)!==path)fail('PROJECT_STORAGE_PATH_INVALID')}
function git(root:string,args:readonly string[]):string{return execFileSync('git',['--no-optional-locks','-C',root,'-c','core.fsmonitor=false',...args],
  {encoding:'utf8',timeout:10000,maxBuffer:1024*1024,env:hostGitEnvironment(),stdio:['ignore','pipe','pipe']}).trim()}
const contexts=new WeakSet<object>();
const acquiredCanaries=new WeakMap<object,string>();
/** Placement and read-only collection identity; never an execution authorization. */
export interface ProjectStorageContext {
  readonly projectId:string;readonly repoRoot:string;readonly machineDataRoot:string;
  readonly stateDataRoot:string;readonly projectRoot:string;readonly controlRoot:string;readonly humanRoot:string;
  readonly storageAnchor:string;readonly custodian?:ProjectCustodian;
}
/** A source-local exclusion exists only for a validated, untracked host namespace. */
export function projectCustodianRoot(repoRoot:string):string|undefined{
  const marker=readProjectCustodian(repoRoot);if(!marker)return undefined;
  try{if(git(repoRoot,['ls-files','--',PROJECT_CUSTODIAN_FOLDER])||git(repoRoot,['check-ignore','--',PROJECT_CUSTODIAN_FOLDER+'/'])!==PROJECT_CUSTODIAN_FOLDER+'/')fail('PROJECT_STORAGE_NAMESPACE_UNPROTECTED')}
  catch{fail('PROJECT_STORAGE_NAMESPACE_UNPROTECTED')}
  return join(repoRoot,PROJECT_CUSTODIAN_FOLDER);
}
export function resolveProjectStorage(machineDataRoot:string,repoRoot:string):ProjectStorageContext{
  const data=realpathSync(machineDataRoot),repo=realpathSync(repoRoot);
  if(data!==resolve(machineDataRoot)||repo!==repoRoot||inside(repo,data)||inside(data,repo))fail('PROJECT_STORAGE_ROOT_INVALID');
  directory(data);directory(repo);
  const custodian=readProjectCustodian(repo),local=custodian?projectCustodianRoot(repo):undefined;
  const projectId=custodian?.projectId??projectIdentity(repo),stateDataRoot=local?join(local,'state'):data;
  const context=Object.freeze({projectId,repoRoot:repo,machineDataRoot:data,stateDataRoot,
    projectRoot:join(stateDataRoot,'controlled-dev','projects',projectId),
    controlRoot:local?join(local,'control',projectId):join(data,'controlled-dev','control',projectId),
    humanRoot:local?join(repo,PROJECT_HUMAN_FOLDER):join(stateDataRoot,'controlled-dev','projects',projectId,'human'),
    storageAnchor:local??data,...(custodian?{custodian}: {})});
  contexts.add(context);if(local)acquiredCanaries.set(context,projectCustodianCanary(repo)!);return context;
}
/** Exact host-selected state root only. Missing directories can be created below
 * this acquired context; an arbitrary source directory never gets the exception. */
export function ensureProjectStorageData(context:ProjectStorageContext,create:boolean):boolean{
  if(!contexts.has(context))fail('PROJECT_STORAGE_CONTEXT_INVALID');
  if(context.custodian&&projectCustodianRoot(context.repoRoot)!==context.storageAnchor)fail('PROJECT_STORAGE_CONTEXT_INVALID');
  if(context.custodian&&acquiredCanaries.get(context)!==projectCustodianCanary(context.repoRoot))fail('PROJECT_STORAGE_CONTEXT_INVALID');
  if(context.stateDataRoot===context.storageAnchor)return true;
  if(context.stateDataRoot!==join(context.storageAnchor,'state'))fail('PROJECT_STORAGE_CONTEXT_INVALID');
  try{if(create){try{mkdirSync(context.stateDataRoot,{mode:0o700})}catch(error){if((error as {code?:string}).code!=='EEXIST')throw error}}directory(context.stateDataRoot);return true}
  catch(error){if(!create&&(error as {code?:string}).code==='ENOENT')return false;throw error}
}
/** Validate existing parents without an unbounded walk toward a different root. */
export function assertProjectStoragePath(context:ProjectStorageContext,path:string):void{
  if(!contexts.has(context)||resolve(path)!==path||!inside(context.projectRoot,path))fail('PROJECT_STORAGE_PATH_INVALID');
  if(context.custodian&&acquiredCanaries.get(context)!==projectCustodianCanary(context.repoRoot))fail('PROJECT_STORAGE_CONTEXT_INVALID');
  for(let current=path;;current=dirname(current)){directory(current);if(current===context.storageAnchor)break;if(current===dirname(current))fail('PROJECT_STORAGE_PATH_INVALID')}
}
/** Stable physical canary for the immutable namespace boundary and marker.
 * Mutable host records are checked by DurableStore, not confused with source edits. */
export function projectProtectedFolderCanaries(repoRoot:string):ReadonlyMap<string,string>{
  const root=projectCustodianRoot(repoRoot);if(!root)return new Map();
  const path=join(root,'project.json'),folder=lstatSync(root),marker=lstatSync(path);
  const custodial=hashCanonical({root:{dev:folder.dev,ino:folder.ino,mode:folder.mode},
    marker:{dev:marker.dev,ino:marker.ino,mode:marker.mode,nlink:marker.nlink,digest:hashBytes(readFileSync(path))}});
  const found=new Map([[PROJECT_CUSTODIAN_FOLDER,custodial]]),human=join(repoRoot,PROJECT_HUMAN_FOLDER);
  let stat;try{stat=lstatSync(human)}catch(error){if((error as {code?:string}).code==='ENOENT')return found;throw error}
  if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(human)!==human)fail('PROJECT_STORAGE_PATH_INVALID');
  // Existing tracked documentation is source, never silently excluded.
  if(!git(repoRoot,['ls-files','--',PROJECT_HUMAN_FOLDER])){
    let ignored=false;try{ignored=git(repoRoot,['check-ignore','--',PROJECT_HUMAN_FOLDER+'/'])===PROJECT_HUMAN_FOLDER+'/'}catch{}
    if(ignored)found.set(PROJECT_HUMAN_FOLDER,hashCanonical({custodial,dev:stat.dev,ino:stat.ino,mode:stat.mode}));
  }
  return found;
}
export function projectCustodianCanary(repoRoot:string):string|undefined{
  return projectProtectedFolderCanaries(repoRoot).get(PROJECT_CUSTODIAN_FOLDER);
}
/** Read-only physical lookup from an exact custody layout. This never grants
 * execution in place of a historical TaskSpec root. */
export function physicalProjectRootForTask(taskRoot:string,historicalRepoRoot:string,ledger?:StoredLedger):string{
 if(resolve(taskRoot)!==taskRoot)fail('PROJECT_STORAGE_PATH_INVALID');
 const projectRoot=dirname(dirname(taskRoot)),projects=dirname(projectRoot),controlled=dirname(projects),state=dirname(controlled),custodian=dirname(state),repo=dirname(custodian);
 const marker=readProjectCustodian(repo);
 if(marker){
  if(projectRoot!==join(repo,PROJECT_CUSTODIAN_FOLDER,'state','controlled-dev','projects',marker.projectId)
   ||dirname(taskRoot)!==join(projectRoot,'tasks')||!projectCustodianRoot(repo)
   ||(![repo,marker.originalRepoRoot].includes(historicalRepoRoot)&&!taskOriginVerified(taskRoot,historicalRepoRoot,ledger)))fail('PROJECT_STORAGE_PATH_INVALID');
  directory(taskRoot);return repo;
 }
 return historicalRepoRoot;
}

/** The caller supplies a ledger already verified by DurableStore.load. This only
 * permits historical reads in the exact physical custody namespace, never dispatch. */
function taskOriginVerified(taskRoot:string,historicalRepoRoot:string,ledger:StoredLedger|undefined):boolean{
 if(!ledger||join(dirname(taskRoot),ledger.state.taskId)!==taskRoot||ledger.truncatedTailBytes)return false;
 const spec=ledger.records.find(r=>r.kind==='TaskSpec'&&r.id===ledger.state.spec.id);
 const created=ledger.events[0],initial=ledger.records.find(r=>r.kind==='WorkflowState'&&r.value.revision===0);
 return spec?.kind==='TaskSpec'&&spec.value.specHash===ledger.state.specHash&&spec.value.scope.repoRoot===historicalRepoRoot
   &&created?.kind==='CREATE'&&created.taskId===ledger.state.taskId
   &&initial?.kind==='WorkflowState'&&initial.value.taskId===ledger.state.taskId;
}
