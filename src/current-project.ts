import { existsSync, lstatSync, readdirSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { CandidateGit } from './candidate-git.js';
import type { GitIdentity } from './candidate-git.js';
import { hostGitEnvironment, HOST_GIT_CONFIG } from './host-git-policy.js';
import { inspectSource } from './source-project.js';
import { hashCanonical, canonicalize } from './contracts.js';
import { DurableStore } from './store.js';
import type { ArtifactInspection } from './store.js';
import { LockManager } from './lock-manager.js';
import { createTrustedConfirmationRequest, presentTrustedConfirmation, consumeTrustedConfirmation } from './trusted-confirmation.js';
import type { HumanConfirmationChannel } from './trusted-confirmation.js';
import { withProgress } from './controlled-ui.js';
import type { ControlledUI } from './controlled-ui.js';
declare const setTimeout:(callback:()=>void,milliseconds:number)=>unknown;

const skipped=new Set(['.git','.pi','.codex','.agents','.ssh','node_modules','.venv','venv','__pycache__','.pytest_cache','.mypy_cache','.ruff_cache']);
const localExclusions=['.pi/','.codex/','.agents/','.ssh/','node_modules/','.venv/','venv/','__pycache__/','.pytest_cache/','.mypy_cache/','.ruff_cache/','*.pyc','*.pyo','.env','.env.*','.npmrc','.netrc','credentials','credentials.json'];
const git=(root:string,...args:string[])=>execFileSync('git',['--no-optional-locks','-C',root,...HOST_GIT_CONFIG,...args],
  {encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024,env:hostGitEnvironment(),stdio:['ignore','pipe','pipe']}).trim();
/** One canonical project per folder/repository. Existing imported projects are discovered,
 * never silently shadowed by a new parent repository. No filesystem writes here. */
export function discoverCurrentProject(cwd:string):string {
  const root=realpathSync(cwd);
  if(!lstatSync(root).isDirectory())throw new Error('CURRENT_PROJECT_DIRECTORY_INVALID');
  try{return realpathSync(git(root,'rev-parse','--show-toplevel'))}catch(error){
    if((error as {code?:string}).code==='ENOENT')throw new Error('GIT_EXECUTABLE_UNAVAILABLE');
    // An existing broken Git marker must not be replaced by a new repository.
    for(let dir=root;;dir=dirname(dir)){if(existsSync(join(dir,'.git')))throw new Error('CURRENT_PROJECT_GIT_INVALID');if(dir===dirname(dir))break}
  }
  const found:string[]=[];let entries=0;
  const walk=(dir:string,depth:number)=>{
    for(const name of readdirSync(dir).sort()){
      if(++entries>100000)throw new Error('CURRENT_PROJECT_DISCOVERY_LIMIT');
      if(skipped.has(name))continue;
      const path=join(dir,name),stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink())continue;
      if(existsSync(join(path,'.git'))){
        try{if(realpathSync(git(path,'rev-parse','--show-toplevel'))!==path)throw new Error();found.push(path)}
        catch{throw new Error('CURRENT_PROJECT_GIT_INVALID')}
      }else {if(depth>=64)throw new Error('CURRENT_PROJECT_DISCOVERY_LIMIT');walk(path,depth+1)}
    }
  };
  walk(root,0);
  if(found.length>1)throw new Error('CURRENT_PROJECT_AMBIGUOUS');
  return found[0]??root;
}
const proof=(root:string)=>{const s=lstatSync(root);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(root)!==root)throw new Error('CURRENT_PROJECT_DIRECTORY_INVALID');return {dev:s.dev,ino:s.ino}};
const snapshotFor=(root:string)=>{const snapshot=inspectSource(root,{allowEmpty:true,excludeSensitive:true});return {...snapshot,excluded:snapshot.excluded.filter(path=>path!=='.git')}};
const inside=(a:string,b:string)=>{const r=relative(a,b);return !r||(!r.startsWith('..')&&!r.startsWith('/'))};
/** Prepare the current folder in place. Only Git metadata is written; application
 * files keep their paths and bytes. One durable intent guards interrupted setup. */
export class CurrentProject {
  readonly root:string;readonly data:string;
  constructor(root:string,data:string,readonly inspect:ArtifactInspection){
    this.root=realpathSync(root);this.data=realpathSync(data);proof(this.root);proof(this.data);
    if(inside(this.root,this.data)||inside(this.data,this.root))throw new Error('CURRENT_PROJECT_DIRECTORY_INVALID');
    if(discoverCurrentProject(this.root)!==this.root)throw new Error('CURRENT_PROJECT_DIRECTORY_INVALID');
  }
  hasBaseline():boolean {try{git(this.root,'rev-parse','--verify','HEAD');return true}catch{return false}}
  preflight(identity?:GitIdentity):void {
    if(this.hasBaseline())return;
    if(existsSync(join(this.root,'.git')))throw new Error('CURRENT_PROJECT_UNBORN');
    CandidateGit.bootstrapPreflight(this.root,identity);
  }
  async prepare(ctx:HumanConfirmationChannel,identity?:GitIdentity):Promise<boolean>{
    if(this.hasBaseline())return true;
    this.preflight(identity);
    const snapshot=snapshotFor(this.root),directory=proof(this.root);
    const store=()=>DurableStore.project(this.data,this.root,'workspace',this.inspect,true)!;
    if(DurableStore.project(this.data,this.root,'workspace',this.inspect)?.readProjectIndex())throw new Error('CURRENT_PROJECT_SETUP_INTERRUPTED');
    const payload={schemaVersion:1,setupId:`workspace-${randomUUID()}`,root:this.root,directory,snapshotDigest:hashCanonical(snapshot),fileCount:snapshot.files.length,bytes:snapshot.bytes,localExclusions,...(identity?{identity}:{})};
    const fresh=()=>{
      this.preflight(identity);
      if(hashCanonical(proof(this.root))!==hashCanonical(directory)||hashCanonical(snapshotFor(this.root))!==payload.snapshotDigest)throw new Error('CURRENT_PROJECT_CHANGED');
    };
    const request=createTrustedConfirmationRequest({purpose:'current-project-setup',subjectKind:'CurrentProject',subjectId:payload.setupId,subjectRevision:1,action:'APPROVE',payload:payload as any,
      presentation:{title:"Prepare the project in the current folder",content:`Project folder\n${this.root}\n\nLocal Git history will be initialized with ${snapshot.files.length} files (${snapshot.bytes} bytes). Existing files will keep their location and content. No copies or project subfolders will be created.\n\nExcluded caches, local settings and credentials: ${snapshot.excluded.length} entries.${identity?`\nCommit author: ${identity.name} <${identity.email}> (local configuration).`:''}\n\nA plan will be proposed after this preparation.`}});
    const receipt=await presentTrustedConfirmation(ctx,request);if(!receipt)return false;
    const manager=new LockManager(this.data,'current-project-host',payload.setupId),lock=manager.acquireWorkspace(this.root);
    try{
      fresh();const artifacts=store();if(artifacts.readProjectIndex())throw new Error('CURRENT_PROJECT_SETUP_INTERRUPTED');
      const approval=consumeTrustedConfirmation(receipt,()=>{fresh();return request},artifacts);
      const intent=artifacts.put(payload.setupId,canonicalize({payload,snapshot,approval}));artifacts.replaceProjectIndex(undefined,intent);
      fresh();CandidateGit.bootstrapInit(this.root,'main',this.data,identity);
      // Local exclusions never alter the user's .gitignore or application files.
      const escaped=(path:string)=>'/'+path.replace(/[\\*?\[\]#! ]/g,c=>'\\'+c);
      mkdirSync(join(this.root,'.git','info'),{recursive:true});writeFileSync(join(this.root,'.git','info','exclude'),[...localExclusions,...snapshot.excluded.map(escaped)].join('\n')+'\n');
      const candidate=new CandidateGit(this.root,this.data);
      const verify=()=>{if(!manager.verifyWorkspaceLock(lock)||hashCanonical(proof(this.root))!==hashCanonical(directory)||hashCanonical(snapshotFor(this.root))!==payload.snapshotDigest)throw new Error('CURRENT_PROJECT_CHANGED')};
      const manifest={schemaVersion:1 as const,baseCommit:'0'.repeat(40),entries:snapshot.files.map(f=>({schemaVersion:1 as const,path:f.path,kind:'FILE' as const,mode:f.mode,contentHash:f.digest}))};
      const commit=candidate.importSourceBaseline(manifest,verify);
      const result=artifacts.put(`${payload.setupId}-result`,canonicalize({intent,commit,root:this.root}));artifacts.replaceProjectIndex(intent,result);
      return true;
    }finally{manager.release(lock)}
  }
}

export async function prepareCurrentProject(ctx:HumanConfirmationChannel&{ui:ControlledUI},project:CurrentProject):Promise<boolean>{
  if(project.hasBaseline())return true;
  const session=ctx.sessionManager.getSessionId();
  const check=()=>{if(ctx.sessionManager.getSessionId()!==session)throw new Error('HUMAN_CHANNEL_UNAVAILABLE')};
  let identity:GitIdentity|undefined;
  while(true){
    try{project.preflight(identity);break}catch(error){
      if(!['GIT_IDENTITY_REQUIRED','GIT_IDENTITY_INVALID'].includes((error as {code?:string}).code??''))throw error;
      const name=await ctx.ui.editor?.("What name do you want to use for this project's commits?",identity?.name??'');check();if(!name?.trim())return false;
      const email=await ctx.ui.editor?.("What email do you want to use for this project's commits?",identity?.email??'');check();if(!email?.trim())return false;
      identity={name:name.trim(),email:email.trim()};
    }
  }
  check();return withProgress(ctx.ui,()=> "Status: Preparing the local baseline\nExisting content is being checked and recorded in Git. Wait for the result.",async()=>{
    // Let the terminal paint the progress widget before synchronous Git work.
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    return project.prepare(ctx,identity);
  });
}
