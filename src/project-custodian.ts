import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { canonicalize, hashBytes, parseJson } from './contracts.js';
import { hostGitEnvironment } from './host-git-policy.js';

/** Placement metadata only. Historical contracts and approvals retain their original bytes. */
export interface ProjectCustodian {
  readonly schemaVersion:1;
  readonly projectId:string;
  readonly originalRepoRoot:string;
  readonly baselineCommit:string;
  readonly baselineTree:string;
}
export const PROJECT_CUSTODIAN_FOLDER='.controlled-dev';
export const PROJECT_HUMAN_FOLDER='Documentazione';
export class ProjectCustodianError extends Error {constructor(readonly code:string){super(code)}}
function fail(code:string):never {throw new ProjectCustodianError(code)}
function git(repo:string,args:readonly string[]):string {
  try{return execFileSync('git',['--no-optional-locks','-C',repo,'-c','core.fsmonitor=false','-c','submodule.recurse=false',...args],
    {encoding:'utf8',timeout:30000,maxBuffer:1024*1024,env:hostGitEnvironment(),stdio:['ignore','pipe','pipe']}).trim()}
  catch{fail('PROJECT_CUSTODIAN_GIT_BINDING_INVALID')}
}
function regularJson(path:string):unknown {
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>4096||realpathSync(path)!==path)fail('PROJECT_CUSTODIAN_MARKER_INVALID');
  const bytes=readFileSync(path);if(bytes.byteLength>4096)fail('PROJECT_CUSTODIAN_MARKER_INVALID');
  const value=parseJson(bytes,4096);
  if(canonicalize(value)!==Buffer.from(bytes).toString('utf8'))fail('PROJECT_CUSTODIAN_MARKER_INVALID');
  return value;
}
function greenfieldIdentity(repo:string,projectId:string):boolean {
  const path=join(repo,'.git','controlled-dev-project.json');
  let value:unknown;try{value=regularJson(path)}catch{return false}
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const record=value as Record<string,unknown>;
  if(Object.keys(record).sort().join(',')!=='baselineCommit,projectId,schemaVersion'||record.schemaVersion!==1||record.projectId!==projectId
    ||typeof record.baselineCommit!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(record.baselineCommit))return false;
  const baseline=record.baselineCommit;
  try{return git(repo,['rev-list','--parents','-n','1',baseline])===baseline&&!git(repo,['ls-tree','-r','--name-only',baseline])
    &&git(repo,['show','-s','--format=%B',baseline])===`chore: initialize project baseline\n\nControlled-Dev-Project: ${projectId}`
    &&git(repo,['merge-base','--is-ancestor',baseline,'HEAD'])===''}catch{return false}
}
/** Verifies a copied project using its immutable Git baseline, never its new absolute path.
 * This identifies the collection; it grants no workflow or filesystem-write authority. */
export function validateProjectCustodian(repoRoot:string,input:unknown):ProjectCustodian {
  const repo=resolve(repoRoot);
  if(repo!==repoRoot||realpathSync(repo)!==repo||!lstatSync(repo).isDirectory())fail('PROJECT_CUSTODIAN_ROOT_INVALID');
  const dotGit=join(repo,'.git'),stat=lstatSync(dotGit);
  if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(dotGit)!==dotGit||git(repo,['rev-parse','--show-toplevel'])!==repo)fail('PROJECT_CUSTODIAN_ROOT_INVALID');
  if(!input||typeof input!=='object'||Array.isArray(input))fail('PROJECT_CUSTODIAN_MARKER_INVALID');
  const value=input as Record<string,unknown>;
  if(Object.keys(value).sort().join(',')!=='baselineCommit,baselineTree,originalRepoRoot,projectId,schemaVersion'||value.schemaVersion!==1
    ||typeof value.projectId!=='string'||!/^[a-f0-9]{64}$/.test(value.projectId)
    ||typeof value.originalRepoRoot!=='string'||!value.originalRepoRoot.startsWith('/')||resolve(value.originalRepoRoot)!==value.originalRepoRoot
    ||value.originalRepoRoot.length>4096||/[\u0000-\u001f\u007f]/.test(value.originalRepoRoot)
    ||typeof value.baselineCommit!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.baselineCommit)
    ||typeof value.baselineTree!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.baselineTree))fail('PROJECT_CUSTODIAN_MARKER_INVALID');
  if(value.projectId!==hashBytes(Buffer.from(value.originalRepoRoot,'utf8'))&&!greenfieldIdentity(repo,value.projectId))fail('PROJECT_CUSTODIAN_IDENTITY_INVALID');
  if(git(repo,['rev-parse',`${value.baselineCommit}^{tree}`])!==value.baselineTree||git(repo,['merge-base','--is-ancestor',value.baselineCommit,'HEAD'])!=='')fail('PROJECT_CUSTODIAN_GIT_BINDING_INVALID');
  return Object.freeze(value as unknown as ProjectCustodian);
}
export function readProjectCustodian(repoRoot:string):ProjectCustodian|undefined {
  const folder=join(repoRoot,PROJECT_CUSTODIAN_FOLDER),path=join(folder,'project.json');
  let stat;try{stat=lstatSync(folder)}catch(error){if((error as {code?:string}).code==='ENOENT')return undefined;throw error}
  if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(folder)!==folder)fail('PROJECT_CUSTODIAN_MARKER_INVALID');
  try{lstatSync(path)}catch(error){if((error as {code?:string}).code==='ENOENT')fail('PROJECT_CUSTODIAN_ADOPTION_INCOMPLETE');throw error}
  return validateProjectCustodian(repoRoot,regularJson(path));
}
/** Final IO sink of the native host's adoption flow, after it has preserved the same collection.
 * The mandatory callback must verify the exact consumed native confirmation, workspace lease,
 * quiescence and copied state/candidate snapshot. Placement grants no runtime or rebind authority.
 * The host creates and proves the fixed metadata directory before calling this sink. */
export function initializeProjectCustodian(repoRoot:string,input:ProjectCustodian,assertAuthorized:()=>void):ProjectCustodian {
  if(typeof assertAuthorized!=='function')fail('PROJECT_CUSTODIAN_AUTHORIZATION_REQUIRED');
  assertAuthorized();const value=validateProjectCustodian(repoRoot,input),folder=join(repoRoot,PROJECT_CUSTODIAN_FOLDER),path=join(folder,'project.json');
  const stat=lstatSync(folder);
  if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(folder)!==folder)fail('PROJECT_CUSTODIAN_MARKER_INVALID');
  let present=false;try{lstatSync(path);present=true}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error}
  if(present){const prior=readProjectCustodian(repoRoot)!;if(canonicalize(prior)!==canonicalize(value))fail('PROJECT_CUSTODIAN_ALREADY_BOUND');return prior}
  const temp=join(folder,`project-${randomUUID()}.tmp`),fd=openSync(temp,'wx',0o600);
  try{writeFileSync(fd,canonicalize(value));fsyncSync(fd)}finally{closeSync(fd)}
  try{
    assertAuthorized();validateProjectCustodian(repoRoot,value);
    let collision=false;try{lstatSync(path);collision=true}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error}
    if(collision)fail('PROJECT_CUSTODIAN_ALREADY_BOUND');
    renameSync(temp,path);const directory=openSync(folder,'r');try{fsyncSync(directory)}finally{closeSync(directory)}
  }catch(error){try{unlinkSync(temp)}catch{}throw error}
  return readProjectCustodian(repoRoot)!;
}
/** The same generated collection has exactly one selected location. */
export function humanVaultRoot(projectRoot:string,repoRoot:string):string {
  // A task ledger retains its historical root. Resolve placement from the exact current
  // capsule layout, never by replacing arbitrary prefixes in a historical contract.
  const capsuleRepo=dirname(dirname(dirname(dirname(dirname(projectRoot)))));
  if(projectRoot===join(capsuleRepo,PROJECT_CUSTODIAN_FOLDER,'state','controlled-dev','projects',basename(projectRoot))){
    const custodian=readProjectCustodian(capsuleRepo);
    if(!custodian||basename(projectRoot)!==custodian.projectId||realpathSync(projectRoot)!==projectRoot
      ||![capsuleRepo,custodian.originalRepoRoot].includes(repoRoot))fail('PROJECT_CUSTODIAN_ROOT_INVALID');
    return join(capsuleRepo,PROJECT_HUMAN_FOLDER);
  }
  return readProjectCustodian(repoRoot)?join(repoRoot,PROJECT_HUMAN_FOLDER):join(projectRoot,'human');
}
/** Existing folders are checked before the generator writes through its selected location. */
export function assertHumanVaultLocation(projectRoot:string,repoRoot:string):string {
  const root=humanVaultRoot(projectRoot,repoRoot);
  if(existsSync(root)){const stat=lstatSync(root);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(root)!==root)fail('PROJECT_HUMAN_VAULT_INVALID')}
  else{try{if(lstatSync(root).isSymbolicLink())fail('PROJECT_HUMAN_VAULT_INVALID')}catch(error){if(error instanceof ProjectCustodianError)throw error}}
  if(basename(root)===PROJECT_HUMAN_FOLDER){
    const repo=dirname(root);
    if(git(repo,['ls-files','--',PROJECT_HUMAN_FOLDER]))fail('PROJECT_HUMAN_VAULT_TRACKED');
    try{if(git(repo,['check-ignore','--no-index','--',`${PROJECT_HUMAN_FOLDER}/`])!==`${PROJECT_HUMAN_FOLDER}/`)fail('PROJECT_HUMAN_VAULT_NOT_IGNORED')}
    catch{fail('PROJECT_HUMAN_VAULT_NOT_IGNORED')}
  }
  return root;
}
