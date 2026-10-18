import { basename, dirname, join, relative, resolve } from 'node:path';
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { canonicalize, hashBytes, hashCanonical, validateScalar } from './contracts.js';
import { CandidateGit } from './candidate-git.js';
import type { GitIdentity } from './candidate-git.js';
import { workspaceManifest } from './scope-guard.js';
import { DurableStore } from './store.js';
import type { ArtifactInspection } from './store.js';
import { LockManager } from './lock-manager.js';
import { consumeTrustedConfirmation, createTrustedConfirmationRequest, presentTrustedConfirmation } from './trusted-confirmation.js';
import type { HumanConfirmationChannel } from './trusted-confirmation.js';

export class SourceProjectError extends Error {constructor(readonly code:string,readonly path?:string){super(code)}}
const fail=(code:string):never=>{throw new SourceProjectError(code)};
const within=(a:string,b:string)=>{const r=relative(a,b);return !r||(!r.startsWith('..')&&!r.startsWith('/'))};
const excluded=new Set(['.git','.pi','.codex','.agents','node_modules','.venv','venv','__pycache__','.pytest_cache','.mypy_cache','.ruff_cache']);
const forbidden=new Set(['.ssh','.env','.npmrc','.netrc','credentials','credentials.json']);
function absent(path:string):boolean {try{lstatSync(path);return false}catch(error){if((error as {code?:string}).code==='ENOENT')return true;throw error}}
function directory(path:string):{dev:number;ino:number;birthtimeMs:string} {
 const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(path)!==path)fail('SOURCE_IMPORT_PATH_UNSAFE');
 return {dev:s.dev,ino:s.ino,birthtimeMs:String(s.birthtimeMs)};
}
function direct(path:string):void {for(let p=path;;p=dirname(p)){directory(p);if(p===dirname(p))break}}
function requiredDirectory(path:string,code:string):void {
 try{direct(path)}catch(error){if((error as {code?:string}).code==='ENOENT')throw new SourceProjectError(code,path);throw error}
}
export function validateSourceLocation(source:string):void {requiredDirectory(source,'SOURCE_IMPORT_SOURCE_MISSING')}
export function validateDestinationLocation(target:string):void {requiredDirectory(dirname(target),'SOURCE_IMPORT_PARENT_MISSING')}
interface SourceFile {readonly path:string;readonly digest:string;readonly bytes:number;readonly mode:'100644'|'100755'}
export interface SourceSnapshot {readonly files:readonly SourceFile[];readonly digest:string;readonly bytes:number;readonly excluded:readonly string[]}
/** Bounded, read-only inventory of regular source files. Never follows links or copies Git/config data. */
export function inspectSource(source:string,options:{allowEmpty?:boolean;excludeSensitive?:boolean}={}):SourceSnapshot {
 direct(source);const files:SourceFile[]=[],skipped:string[]=[],aliases=new Set<string>();let total=0,entries=0;
 const walk=(root:string,depth:number)=>{
  if(depth>64)fail('SOURCE_IMPORT_LIMIT');
  for(const name of readdirSync(join(source,root)).sort()){
   if(++entries>100000)fail('SOURCE_IMPORT_LIMIT');const path=root?`${root}/${name}`:name;
   if(excluded.has(name)||/\.py[co]$/.test(name)||(options.excludeSensitive&&(forbidden.has(name)||name==='.ssh'||name.startsWith('.env.')))){skipped.push(path);continue}
   if(forbidden.has(name)||!validateScalar('Path',path).ok)fail('SOURCE_IMPORT_PATH_UNSAFE');
   const full=join(source,path),s=lstatSync(full);
   if(s.isSymbolicLink())fail('SOURCE_IMPORT_PATH_UNSAFE');
   const alias=path.normalize('NFC').toLocaleLowerCase('en-US');if(aliases.has(alias))fail('SOURCE_IMPORT_PATH_UNSAFE');aliases.add(alias);
   if(s.isDirectory()){directory(full);walk(path,depth+1);continue}
   if(!s.isFile()||s.nlink!==1)fail('SOURCE_IMPORT_PATH_UNSAFE');
   if(s.size>32*1024*1024||(total+=s.size)>512*1024*1024)fail('SOURCE_IMPORT_LIMIT');
   const bytes=readFileSync(full);if(bytes.byteLength!==s.size)fail('SOURCE_IMPORT_CHANGED');
   files.push({path,digest:hashBytes(bytes),bytes:bytes.byteLength,mode:s.mode&0o111?'100755':'100644'});
  }
 };walk('',0);if(!files.length&&!options.allowEmpty)fail('SOURCE_IMPORT_EMPTY');
 return {files,digest:hashCanonical(files),bytes:total,excluded:skipped};
}
export interface SourceProjectProposal {
 readonly schemaVersion:1;readonly importId:string;readonly source:string;readonly target:string;readonly objective:string;
 readonly prefix:string;readonly sourceDigest:string;readonly fileCount:number;readonly bytes:number;
 readonly sourceDirectory:ReturnType<typeof directory>;readonly parentDirectory:ReturnType<typeof directory>;
 readonly localGitIdentity?:GitIdentity;
}
/** One host-confirmed import. Durable intent precedes writes; interrupted copies are retained,
 * never reset, overwritten, or silently replayed. Execution uses the normal planning/workflow. */
export class SourceProject {
 readonly data:string;readonly source:string;readonly target:string;readonly projectId:string;
 readonly #snapshots=new WeakMap<SourceProjectProposal,SourceSnapshot>();
 constructor(data:string,source:string,target:string,readonly inspect:ArtifactInspection,readonly fault?:(point:string)=>void){
  try{this.data=realpathSync(data)}catch(error){if((error as {code?:string}).code==='ENOENT')throw new SourceProjectError('SOURCE_IMPORT_PROFILE_MISSING',data);throw error}
  this.source=resolve(source);this.target=resolve(target);
  if(this.data!==resolve(data)||[source,target].some(p=>p.split(/[\\/]/).some(x=>['.','..',...excluded,...forbidden].includes(x))))fail('SOURCE_IMPORT_PATH_UNSAFE');
  validateSourceLocation(this.source);validateDestinationLocation(this.target);
  if(within(this.source,this.target)||within(this.target,this.source)||within(this.data,this.target)||within(this.target,this.data)||within(this.data,this.source)||within(this.source,this.data))fail('SOURCE_IMPORT_PATH_UNSAFE');
  this.projectId=hashBytes(Buffer.from(this.target));
 }
 #available(identity?:GitIdentity):void {
  const store=DurableStore.sourceImport(this.data,this.projectId,this.inspect);
  if(store?.readProjectIndex())fail('SOURCE_IMPORT_ALREADY_STARTED');
  if(!absent(this.target))fail('SOURCE_IMPORT_TARGET_EXISTS');
  CandidateGit.bootstrapPreflight(dirname(this.target),identity);
 }
 propose(objective:string,identity?:GitIdentity):SourceProjectProposal {
  const localGitIdentity=identity?Object.freeze({name:identity.name,email:identity.email}):undefined;
  this.#available(localGitIdentity);if(!validateScalar('Text',objective).ok)fail('PROJECT_GOAL_INVALID');const snapshot=inspectSource(this.source);
  const prefix=snapshot.files.some(f=>f.path==='__init__.py')?`src/${basename(this.source)}`:'';
  if(prefix&&!validateScalar('Path',prefix).ok)fail('SOURCE_IMPORT_PATH_UNSAFE');
  const proposal=Object.freeze({schemaVersion:1 as const,importId:`source-import-${randomUUID()}`,source:this.source,target:this.target,objective,prefix,sourceDigest:snapshot.digest,fileCount:snapshot.files.length,bytes:snapshot.bytes,sourceDirectory:directory(this.source),parentDirectory:directory(dirname(this.target)),...(localGitIdentity?{localGitIdentity}:{})});
  this.#snapshots.set(proposal,snapshot);return proposal;
 }
 narrative(p:SourceProjectProposal):string {
  const snapshot=this.#snapshots.get(p);if(!snapshot)throw new SourceProjectError('SOURCE_IMPORT_PROPOSAL_INVALID');
  return `Project from existing code\n\nSources\n${p.source}\n\nNew working folder\n${p.target}\n\nObjective\n${p.objective}\n\nFiles to copy: ${p.fileCount} files (${p.bytes} byte)${p.prefix?` under ${p.prefix}`:''}. Caches, local dependencies and tool metadata are excluded (${snapshot.excluded.length} entries).${p.localGitIdentity?`\n\nCommit identity\n${p.localGitIdentity.name} <${p.localGitIdentity.email}>\nIt will be saved only in this new project's local Git configuration.`:''}\n\nYou authorize the exact copy shown and creation of the local Git baseline on branch main. Original sources remain in their folder. After creation, planning opens for your objective; work proceeds according to the mode you approve.`;
 }
 async approve(ctx:HumanConfirmationChannel,p:SourceProjectProposal):Promise<string|undefined> {
  const snapshot=this.#snapshots.get(p);if(!snapshot)throw new SourceProjectError('SOURCE_IMPORT_PROPOSAL_INVALID');
  const fresh=()=>{this.#available(p.localGitIdentity);direct(this.source);direct(dirname(this.target));if(hashCanonical(directory(this.source))!==hashCanonical(p.sourceDirectory)||hashCanonical(directory(dirname(this.target)))!==hashCanonical(p.parentDirectory)||inspectSource(this.source).digest!==p.sourceDigest)fail('SOURCE_IMPORT_CHANGED')};
  fresh();const q=createTrustedConfirmationRequest({purpose:'source-project-import',subjectKind:'SourceProjectProposal',subjectId:p.importId,subjectRevision:1,action:'APPROVE',payload:p as any,presentation:{title:"Create the project from existing code",content:this.narrative(p)}});
  const receipt=await presentTrustedConfirmation(ctx,q);if(!receipt)return;
  const manager=new LockManager(this.data,'source-import-host',p.importId),lock=manager.acquireBootstrap(this.target);
  try{
   fresh();const store=DurableStore.sourceImport(this.data,this.projectId,this.inspect,true)!;
   const approval=consumeTrustedConfirmation(receipt,()=>{fresh();return q},store);
   // Capture approved bytes before creating the destination. No source content is ever written back.
   const captured=snapshot.files.map(file=>{
    const raw=readFileSync(join(this.source,file.path));if(hashBytes(raw)!==file.digest)fail('SOURCE_IMPORT_CHANGED');
    return {file,ref:store.put(`source-${hashCanonical(file)}`,raw,'application/octet-stream')};
   });fresh();
   const intent=store.put(p.importId,canonicalize({schemaVersion:1,proposal:p,approval,files:captured}));store.replaceProjectIndex(undefined,intent);this.fault?.('afterIntent');
   mkdirSync(this.target,{mode:0o700});const proof=directory(this.target);
   const own=()=>{if(!manager.verifyWorkspaceLock(lock)||hashCanonical(directory(this.target))!==hashCanonical(proof))fail('SOURCE_IMPORT_CHANGED')};
   const directories=new Set<string>([this.target]);
   for(const {file,ref} of captured){
    own();const dest=join(this.target,p.prefix,file.path),parent=dirname(dest),parts=relative(this.target,parent).split('/').filter(Boolean);let dir=this.target;
    for(const part of parts){dir=join(dir,part);if(!directories.has(dir)){mkdirSync(dir,{mode:0o700});directories.add(dir)}directory(dir)}
    const fd=openSync(dest,'wx',file.mode==='100755'?0o755:0o644);try{writeFileSync(fd,store.read(ref));fsyncSync(fd)}finally{closeSync(fd)}chmodSync(dest,file.mode==='100755'?0o755:0o644);
   }
   own();this.fault?.('afterCopy');CandidateGit.bootstrapInit(this.target,'main',this.data,p.localGitIdentity);
   const git=new CandidateGit(this.target,this.data),manifest=workspaceManifest(this.target,'0'.repeat(40));
   const expected=snapshot.files.map(f=>({path:p.prefix?`${p.prefix}/${f.path}`:f.path,mode:f.mode,contentHash:f.digest}));
   if(hashCanonical(manifest.entries.map(e=>({path:e.path,mode:e.mode,contentHash:e.contentHash})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0))!==hashCanonical(expected.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)))fail('SOURCE_IMPORT_CHANGED');
   own();const commit=git.importSourceBaseline(manifest);this.fault?.('afterBaseline');
   const result=store.put(`${p.importId}-result`,canonicalize({schemaVersion:1,intent,commit,target:this.target}));store.replaceProjectIndex(intent,result);
   const fd=openSync(this.target,'r');try{fsyncSync(fd)}finally{closeSync(fd)}return this.target;
  }finally{manager.release(lock)}
 }
}
