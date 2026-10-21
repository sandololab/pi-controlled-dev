import { verifyGitProjectIdentity } from './git-project-identity.js';
import { randomUUID } from 'node:crypto';
import { projectCustodianRoot } from './project-storage.js';
import { execFileSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { canonicalize, hashBytes, hashCanonical, parseJson, validateScalar, validateStructure } from './contracts.js';
import type { CandidateManifest } from './contracts.js';
import { workspaceManifest, sourceManifest } from './scope-guard.js';
import { currentProcessIncarnation, inspectProcessOwner } from './process-incarnation.js';
import { HOST_GIT_CONFIG, hostGitEnvironment } from './host-git-policy.js';
export class CandidateGitError extends Error {constructor(readonly code:string){super(code)}}
function fail(code:string):never{throw new CandidateGitError(code)}
export interface GitIdentity {readonly name:string;readonly email:string}
export function validateGitIdentity(identity:GitIdentity):void {
  if(!identity||[identity.name,identity.email].some(value=>typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>256||/[<>\u0000-\u001f\u007f-\u009f]/.test(value))||/\s/.test(identity.email))fail('GIT_IDENTITY_INVALID');
}
const oid=(value:string)=>{if(!validateScalar('GitOID',value).ok||value!==value.toLowerCase())fail('GIT_COMMIT_INVALID');return value};
export function localRef(value:string):string {
  if(!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(value)||value.includes('..')||value.includes('//')||value.includes('@{')||value.split('/').some(p=>!p||p.endsWith('.')||p.endsWith('.lock')||p.startsWith('.')))fail('GIT_REF_INVALID');return value;
}
const inside=(a:string,b:string)=>{const p=relative(a,b);return p===''||(!p.startsWith('..')&&!p.startsWith('/'))};
const SHARED_SNAPSHOT_STORAGE='{"schemaVersion":2,"objects":"../../.objects"}\n';
export interface SnapshotStorageProgress {readonly phase:'verify'|'share'|'cleanup';readonly completed:number;readonly total:number;readonly removedBytes?:number;readonly removedFiles?:number}
/** Host-only bounded primitives. No model/caller supplied Git command executor is exported. */
export class CandidateGit {
  readonly hooks:string;
  constructor(readonly repo:string,readonly data:string){
    if(realpathSync(repo)!==repo||realpathSync(data)!==data||inside(repo,data)||inside(data,repo))fail('GIT_ROOT_INVALID');
    this.hooks=join(data,'controlled-dev','empty-git-hooks');mkdirSync(this.hooks,{recursive:true});if(realpathSync(this.hooks)!==this.hooks||readdirSync(this.hooks).length)fail('GIT_ROOT_INVALID');
    if(this.#run(repo,['rev-parse','--show-toplevel'])!==repo)fail('GIT_ROOT_INVALID');
    const settings=this.#run(repo,['config','--null','--list']).split('\0').map(row=>row.split('\n')[0]);
    if(settings.some(key=>/^(filter\..*\.(clean|smudge|process)|merge\..*\.driver|core\.fsmonitor)$/.test(key)))fail('GIT_EXTERNAL_DRIVER_UNSUPPORTED');
  }
  #run(cwd:string,args:readonly string[],input?:string|Uint8Array,extra:Record<string,string>={}):string {return CandidateGit.#execute(cwd,this.hooks,args,input,extra)}
  static #execute(cwd:string,hooks:string,args:readonly string[],input?:string|Uint8Array,extra:Record<string,string>={},identity?:GitIdentity):string {
    if(!['ls-tree','show','rev-parse','config','var','symbolic-ref','rev-list','merge-base','status','update-ref','worktree','ls-files','hash-object','update-index','write-tree','commit-tree','merge','diff-tree','diff-index','read-tree','init'].includes(args[0]))fail('GIT_COMMAND_NOT_ALLOWED');
    const env={...hostGitEnvironment(),...extra};
    if(identity)validateGitIdentity(identity);
    try{return execFileSync('git',['-C',cwd,'-c',`core.hooksPath=${hooks}`,...HOST_GIT_CONFIG,...(identity?['-c',`user.name=${identity.name}`,'-c',`user.email=${identity.email}`]:[]),...args],
      {encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024,env,stdio:input===undefined?['ignore','pipe','pipe']:['pipe','pipe','pipe'],...(input===undefined?{}:{input})}).replace(/\n$/,'')}
    catch{fail('GIT_OPERATION_FAILED')}
  }
  /** Bootstrap uses this same private executor; no caller-supplied argv is exposed. */
  static bootstrapExisting(repo:string):boolean {try{CandidateGit.#execute(repo,'',['rev-parse','--verify','HEAD']);return true}catch{return false}}
  static assertOutsideGit(parent:string):void {
    try{CandidateGit.#execute(parent,'',['rev-parse','--absolute-git-dir']);fail('GREENFIELD_NESTED_REPOSITORY')}catch(error){if(error instanceof CandidateGitError&&error.code==='GREENFIELD_NESTED_REPOSITORY')throw error}
  }
  static bootstrapPreflight(parent:string,identity?:GitIdentity):void {if(identity)validateGitIdentity(identity);CandidateGit.assertOutsideGit(parent);CandidateGit.#identity(parent,'',identity)}

  static #identity(cwd:string,hooks:string,identity?:GitIdentity):void {
    try{for(const key of ['user.name','user.email'])if(!CandidateGit.#execute(cwd,hooks,['config','--get',key],undefined,{},identity).trim())fail('GIT_IDENTITY_REQUIRED');
      for(const kind of ['GIT_AUTHOR_IDENT','GIT_COMMITTER_IDENT'])if(!/^.+ <[^<>\n]+> \d+ [+-]\d+$/.test(CandidateGit.#execute(cwd,hooks,['var',kind],undefined,{},identity)))fail('GIT_IDENTITY_REQUIRED');
    }catch{fail('GIT_IDENTITY_REQUIRED')}
  }
  static bootstrapInit(repo:string,branch:string,data:string,identity?:GitIdentity):void {
    if(identity)validateGitIdentity(identity);
    localRef(`refs/heads/${branch}`);
    const hooks=join(data,'controlled-dev','empty-git-hooks');mkdirSync(hooks,{recursive:true});
    if(realpathSync(hooks)!==hooks||readdirSync(hooks).length)fail('GIT_ROOT_INVALID');
    CandidateGit.#execute(repo,hooks,['init','--quiet','--template=','--initial-branch='+branch,'.']);
    if(identity){
      CandidateGit.#execute(repo,hooks,['config','--local','--replace-all','user.name',identity.name]);
      CandidateGit.#execute(repo,hooks,['config','--local','--replace-all','user.email',identity.email]);
      CandidateGit.#identity(repo,hooks);
    }
  }
  assertUnborn(branch:string):void {
    if(this.target()!==localRef(`refs/heads/${branch}`))fail('GREENFIELD_RECOVERY_AMBIGUOUS');
    let head=false;try{this.head();head=true}catch{}if(head||this.#run(this.repo,['ls-files','-z'])||this.#run(this.repo,['status','--porcelain=v1','-z','--untracked-files=all','--ignored']))fail('GREENFIELD_RECOVERY_AMBIGUOUS');
    this.assertNoOperation();
  }
  bootstrapCommit(projectId:string,prepared:(commit:string)=>void):string {
    if(!/^[a-f0-9]{64}$/.test(projectId))fail('GREENFIELD_PROJECT_ID_INVALID');this.identity();
    const tree=oid(this.#run(this.repo,['hash-object','-w','-t','tree','--stdin'],''));
    const commit=oid(this.#run(this.repo,['commit-tree',tree,'-m',`chore: initialize project baseline\n\nControlled-Dev-Project: ${projectId}`]));
    prepared(commit);this.bootstrapBind(commit);return commit;
  }
  bootstrapBind(commit:string):void {this.#run(this.repo,['update-ref',this.target(),oid(commit),'0'.repeat(commit.length)]);this.#run(this.repo,['read-tree',commit])}
  /** Import an exact host-observed source snapshot as the first, non-empty commit.
   * Hash raw bytes without attributes/filters; ignore rules cannot hide imported files. */
  importSourceBaseline(manifest:CandidateManifest,verify?:()=>void):string {
    this.identity();this.assertNoOperation();
    let exists=false;try{this.head();exists=true}catch{}if(exists||this.#run(this.repo,['ls-files','-z']))fail('SOURCE_IMPORT_BASELINE_EXISTS');
    const unchanged=verify??(()=>{if(hashCanonical(workspaceManifest(this.repo,manifest.baseCommit))!==hashCanonical(manifest))fail('SOURCE_IMPORT_CHANGED')});unchanged();
    for(const entry of manifest.entries){
      if(entry.kind!=='FILE'||!validateScalar('Path',entry.path).ok||entry.path.split('/').includes('.git'))fail('GIT_UNSUPPORTED_FILE');
    }
    // Bound argv size and write the index once. Updating it for every file made
    // imports quadratic and froze the terminal on repositories with many assets.
    const index:string[]=[];
    for(let offset=0;offset<manifest.entries.length;offset+=128){
      const batch=manifest.entries.slice(offset,offset+128);
      const hashes=this.#run(this.repo,['hash-object','-w','--no-filters','--',...batch.map(entry=>entry.path)]).split('\n');
      if(hashes.length!==batch.length)fail('GIT_OPERATION_FAILED');
      batch.forEach((entry,i)=>index.push(`${entry.mode} ${oid(hashes[i])}\t${entry.path}\0`));
    }
    if(index.length)this.#run(this.repo,['update-index','-z','--index-info'],index.join(''));
    const tree=oid(this.#run(this.repo,['write-tree']));
    unchanged();
    const commit=oid(this.#run(this.repo,['commit-tree',tree,'-m','chore: import existing source baseline']));
    this.bootstrapBind(commit);this.assertTarget(this.target(),commit);return commit;
  }
  assertBootstrapReflogs(branch:string,commit:string):void {
    localRef(`refs/heads/${branch}`);oid(commit);
    for(const name of ['logs/HEAD',`logs/refs/heads/${branch}`]){
      const path=join(this.repo,'.git',name);if(!existsSync(path))continue;const s=lstatSync(path);
      if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>16384)fail('GREENFIELD_RECOVERY_AMBIGUOUS');
      const raw=readFileSync(path).toString('utf8');if(raw.split('\n').length!==2||!raw.startsWith('0'.repeat(commit.length)+' '+commit+' ')||!/^.+ <[^<>\n]+> \d+ [+-]\d+(?:\t[^\n]*)?\n$/.test(raw.slice(commit.length*2+2)))fail('GREENFIELD_RECOVERY_AMBIGUOUS');
    }
  }
  bootstrapRestoreIndex(commit:string):void {const path=join(this.repo,'.git','index');try{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>16*1024*1024)fail('GREENFIELD_RECOVERY_AMBIGUOUS')}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error}if(this.#run(this.repo,['ls-files','-z']))fail('GREENFIELD_RECOVERY_AMBIGUOUS');this.#run(this.repo,['read-tree',oid(commit)])}
  static verifyProjectIdentity(repo:string,projectId:string,baseline:string):void {
    try{verifyGitProjectIdentity(repo,projectId,oid(baseline),args=>CandidateGit.#execute(repo,'',args))}
    catch(error){if((error as {code?:string}).code==='GREENFIELD_PROJECT_ID_INVALID')fail('GREENFIELD_PROJECT_ID_INVALID');throw error}
  }

  head(cwd=this.repo):string{return oid(this.#run(cwd,['rev-parse','--verify','HEAD']))}
  refHead(ref:string):string{return oid(this.#run(this.repo,['rev-parse','--verify',localRef(ref)]))}
  target():string {try{return localRef(this.#run(this.repo,['symbolic-ref','--quiet','HEAD']))}catch{fail('GIT_LOCAL_TARGET_REQUIRED')}}
  tree(commit:string):string{return oid(this.#run(this.repo,['rev-parse',`${oid(commit)}^{tree}`]))}
  pathsAt(commit:string):readonly string[]{
    const paths=this.#run(this.repo,['ls-tree','-r','--name-only','-z',oid(commit)]).split('\0').filter(Boolean);
    if(paths.some(path=>!validateScalar('Path',path).ok))fail('GIT_FORBIDDEN_CHANGE');return paths;
  }
  fileAt(commit:string,path:string):string {
    if(!validateScalar('Path',path).ok||path.split('/').includes('.git'))fail('GIT_FORBIDDEN_CHANGE');
    return this.#run(this.repo,['show',`${oid(commit)}:${path}`]);
  }
  parents(commit:string):string[]{return this.#run(this.repo,['rev-list','--parents','-n','1',oid(commit)]).split(' ').slice(1).map(oid)}
  ancestor(parent:string,child:string):boolean {try{this.#run(this.repo,['merge-base','--is-ancestor',oid(parent),oid(child)]);return true}catch{return false}}
  assertTarget(ref:string,head?:string):void {
    if(this.target()!==localRef(ref))fail('GIT_WRONG_TARGET_BRANCH');if(head&&this.head()!==oid(head))fail('PROMOTION_TARGET_STALE');
    this.assertNoOperation();
    if(this.#run(this.repo,['status','--porcelain=v1','-z','--untracked-files=all']))fail('GIT_TARGET_DIRTY');
  }
  assertNoOperation():void{
    const gitDir=this.#run(this.repo,['rev-parse','--absolute-git-dir']);
    for(const entry of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply','sequencer'])if(existsSync(join(gitDir,entry)))fail('GIT_OPERATION_IN_PROGRESS');
  }
  identity():void {CandidateGit.#identity(this.repo,this.hooks)}
  addTaskWorktree(ref:string,base:string,root:string):void {
    localRef(ref);oid(base);this.#path(root);let existing:string|undefined;try{existing=this.refHead(ref)}catch{}
    if(existing&&existing!==base)fail('GIT_CANDIDATE_REF_COLLISION');if(!existing)this.#run(this.repo,['update-ref',ref,base,'0'.repeat(base.length)]);
    if(!existsSync(root))this.#run(this.repo,['worktree','add','--quiet',root,ref.slice('refs/heads/'.length)]);
    if(realpathSync(root)!==root||this.head(root)!==base||this.#run(root,['symbolic-ref','HEAD'])!==ref||lstatSync(join(root,'.git')).isDirectory())fail('GIT_CANDIDATE_WORKTREE_INVALID');
  }
  #path(root:string):void {if(resolve(root)!==root||inside(this.repo,root)||!inside(this.data,root))fail('GIT_WORKTREE_PATH_INVALID');mkdirSync(dirname(root),{recursive:true});if(realpathSync(dirname(root))!==dirname(root))fail('GIT_WORKTREE_PATH_INVALID')}
  detached(root:string,commit:string):void {this.#path(root);if(existsSync(root))fail('GIT_WORKTREE_EXISTS');this.#run(this.repo,['worktree','add','--quiet','--detach',root,oid(commit)])}
  /** Cleanup only of clean detached worktrees beneath the external data root.
   * Generated files or edits keep the worktree available for explicit inspection. */
  assertDetachedBaseline(root:string,commit:string):void {
    this.#path(root);if(this.head(root)!==oid(commit)||!this.#indexMatches(commit,root))fail('GIT_CHECKPOINT_BASELINE_CHANGED');
    let attached=false;try{this.#run(root,['symbolic-ref','--quiet','HEAD']);attached=true}catch{}
    if(attached||this.#run(root,['rev-parse','--path-format=absolute','--git-common-dir'])!==this.#run(this.repo,['rev-parse','--path-format=absolute','--git-common-dir']))fail('GIT_CHECKPOINT_BASELINE_CHANGED');
  }
  removeDetached(root:string):void {
    this.#path(root);if(!existsSync(root))return;
    if(this.#run(root,['rev-parse','--path-format=absolute','--git-common-dir'])!==this.#run(this.repo,['rev-parse','--path-format=absolute','--git-common-dir']))fail('GIT_WORKTREE_PATH_INVALID');
    let attached=false;try{this.#run(root,['symbolic-ref','--quiet','HEAD']);attached=true}catch{}
    if(attached)fail('GIT_WORKTREE_PATH_INVALID');this.#run(this.repo,['worktree','remove',root]);
  }
  manifestAt(commit:string,base:string,root:string):CandidateManifest {this.detached(root,commit);return workspaceManifest(root,oid(base))}
  /** A checkpoint is data only. It does not approve a relocated task or grant a writer lease.
   * The host keeps this payload inside the project custodian and reconstructs local Git
   * worktrees after separately confirming the new physical roots. */
  captureCandidateSnapshot(root:string,manifest:CandidateManifest,snapshotRoot:string):void {this.#captureSnapshot(root,manifest,snapshotRoot,false)}
  captureCandidateSnapshotStaged(root:string,manifest:CandidateManifest,snapshotRoot:string):void {this.#captureSnapshot(root,manifest,snapshotRoot,true)}
  #captureSnapshot(root:string,manifest:CandidateManifest,snapshotRoot:string,staged:boolean):void {
    this.#path(root);this.#snapshotPath(snapshotRoot,true,staged);this.#snapshotManifest(manifest);
    if(hashCanonical(workspaceManifest(root,manifest.baseCommit))!==hashCanonical(manifest))fail('GIT_CANDIDATE_CHANGED');
    if(existsSync(snapshotRoot)){this.#readSnapshot(snapshotRoot,manifest,staged);if(hashCanonical(workspaceManifest(root,manifest.baseCommit))!==hashCanonical(manifest))fail('GIT_CANDIDATE_CHANGED');return}
    const staging=snapshotRoot+'.pending-'+randomUUID();if(existsSync(staging))fail('GIT_SNAPSHOT_EXISTS');
    mkdirSync(staging,{mode:0o700});const objects=this.#sharedSnapshotObjects(staging,true,staged);
    for(const entry of manifest.entries){
      const path=join(root,entry.path),stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>512*1024*1024||realpathSync(path)!==path)fail('GIT_UNSUPPORTED_FILE');
      const bytes=readFileSync(path);if(hashBytes(bytes)!==entry.contentHash)fail('GIT_CANDIDATE_CHANGED');
      const blob=join(objects,entry.contentHash);
      if(existsSync(blob)){if(hashBytes(this.#snapshotBytes(blob,512*1024*1024))!==entry.contentHash)fail('GIT_SNAPSHOT_DIGEST_MISMATCH')}
      else this.#snapshotWrite(blob,bytes);
    }
    this.#snapshotWrite(join(staging,'manifest.json'),canonicalize(manifest));
    this.#snapshotWrite(join(staging,'storage.json'),SHARED_SNAPSHOT_STORAGE);
    this.#readSnapshot(staging,manifest,staged);
    if(hashCanonical(workspaceManifest(root,manifest.baseCommit))!==hashCanonical(manifest))fail('GIT_CANDIDATE_CHANGED');
    for(const directory of [objects,staging]){const fd=openSync(directory,'r');try{fsyncSync(fd)}finally{closeSync(fd)}}
    renameSync(staging,snapshotRoot);const fd=openSync(dirname(snapshotRoot),'r');try{fsyncSync(fd)}finally{closeSync(fd)}
  }
  /** Restore only a fresh external worktree from an exact previously observed manifest.
   * Imported history and counters remain immutable; the caller must obtain a new host
   * root-binding confirmation before passing this worktree to a controlled runner. */
  restoreCandidateSnapshot(snapshotRoot:string,root:string,ref:string,manifest:CandidateManifest,expectedRefHead:string=manifest.baseCommit):void {
    this.#snapshotPath(snapshotRoot);this.#path(root);this.#snapshotManifest(manifest);
    if(existsSync(root))fail('GIT_WORKTREE_EXISTS');const blobs=this.#readSnapshot(snapshotRoot,manifest);
    const baseRows=this.#run(this.repo,['ls-tree','-r','-z',oid(manifest.baseCommit)]).split('\0').filter(Boolean);
    if(baseRows.some(row=>!/^100(?:644|755) blob /.test(row)))fail('GIT_SNAPSHOT_BASELINE_UNSUPPORTED');
    const basePaths=baseRows.map(row=>row.slice(row.indexOf('\t')+1));
    const baseFiles=new Set(basePaths),candidateFiles=new Set(manifest.entries.map(entry=>entry.path));
    const hasFileParent=(path:string,files:Set<string>)=>path.split('/').slice(0,-1).some((_,i,parts)=>files.has(parts.slice(0,i+1).join('/')));
    if(basePaths.some(path=>hasFileParent(path,candidateFiles))||manifest.entries.some(entry=>hasFileParent(entry.path,baseFiles)))fail('GIT_SNAPSHOT_LAYOUT_UNSUPPORTED');
    if(this.refHead(localRef(ref))!==oid(expectedRefHead))fail('GIT_CANDIDATE_REF_CHANGED');
    // A copied .git may still register an old absolute worktree. Detached restore
    // preserves the snapshot without granting or stealing the historical branch.
    this.detached(root,manifest.baseCommit);
    const wanted=new Set(manifest.entries.map(entry=>entry.path));
    for(const path of this.#run(root,['ls-files','-z']).split('\0').filter(Boolean))if(!wanted.has(path)){
      const target=join(root,path),stat=lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)fail('GIT_UNSUPPORTED_FILE');unlinkSync(target);
    }
    for(const entry of manifest.entries){
      const path=join(root,entry.path);mkdirSync(dirname(path),{recursive:true});if(realpathSync(dirname(path))!==dirname(path))fail('GIT_SNAPSHOT_PATH_INVALID');
      if(existsSync(path)){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)fail('GIT_UNSUPPORTED_FILE')}
      // Git has already checked out the baseline. Preserve byte-identical files
      // rather than rewriting thousands of unchanged assets during restoration.
      const wantedMode=entry.mode==='100755'?0o755:0o644;
      if(!existsSync(path)||hashBytes(readFileSync(path))!==entry.contentHash)writeFileSync(path,readFileSync(blobs.get(entry.contentHash)!));
      if((lstatSync(path).mode&0o777)!==wantedMode)chmodSync(path,wantedMode);
    }
    if(hashCanonical(workspaceManifest(root,manifest.baseCommit))!==hashCanonical(manifest))fail('GIT_SNAPSHOT_DIGEST_MISMATCH');
  }
  verifyCandidateSnapshot(snapshotRoot:string,manifest:CandidateManifest):void {this.#snapshotPath(snapshotRoot);this.#snapshotManifest(manifest);this.#readSnapshot(snapshotRoot,manifest)}
  verifyCandidateSnapshotStaged(snapshotRoot:string,manifest:CandidateManifest):void {this.#snapshotPath(snapshotRoot,false,true);this.#snapshotManifest(manifest);this.#readSnapshot(snapshotRoot,manifest,true)}
  #snapshotPath(root:string,createParents=false,staged=false):void {
    const custodian=staged?undefined:projectCustodianRoot(this.repo);if(!staged&&!custodian)fail('GIT_SNAPSHOT_CUSTODIAN_REQUIRED');
    const anchor=staged?this.data:this.repo,parent=staged?join(this.data,'controlled-dev','project-handoff-staging'):join(custodian!,'candidates');
    if(resolve(root)!==root||!inside(parent,root)||root===parent)fail('GIT_SNAPSHOT_PATH_INVALID');
    // The custodian chooses the project root; every directory traversed here must
    // remain a real local directory, never a symlink or an alias outside it.
    for(const part of relative(anchor,dirname(root)).split('/')){
      if(!part||part==='.'||part==='..')fail('GIT_SNAPSHOT_PATH_INVALID');
    }
    let directory=anchor;for(const part of relative(anchor,dirname(root)).split('/')){directory=join(directory,part);if(!existsSync(directory)){if(!createParents)fail('GIT_SNAPSHOT_INVALID');mkdirSync(directory,{mode:0o700})}const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(directory)!==directory)fail('GIT_SNAPSHOT_PATH_INVALID')}
    if(existsSync(root)){const stat=lstatSync(root);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(root)!==root)fail('GIT_SNAPSHOT_PATH_INVALID')}
  }
  #snapshotManifest(manifest:CandidateManifest):void {
    if(!validateStructure('CandidateManifest',manifest).ok||manifest.entries.some(entry=>entry.kind!=='FILE'||!['100644','100755'].includes(entry.mode)||entry.path.split('/').some(part=>['.git','.controlled-dev'].includes(part)))
      ||new Set(manifest.entries.map(entry=>entry.path)).size!==manifest.entries.length)fail('GIT_SNAPSHOT_MANIFEST_INVALID');
  }
  #snapshotWrite(path:string,bytes:string|Uint8Array):void {const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd)}finally{closeSync(fd)}}
  #snapshotBytes(path:string,max:number):ReturnType<typeof readFileSync>{const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>max||realpathSync(path)!==path)fail('GIT_SNAPSHOT_INVALID');return readFileSync(path)}
  #sharedSnapshotObjects(root:string,create=false,staged=false):string{
    const objects=join(dirname(dirname(root)),'.objects');
    this.#snapshotPath(join(objects,'object-path-check'),create,staged);return objects;
  }
  *#snapshotReadSteps(root:string,manifest:CandidateManifest,staged=false):Generator<void,Map<string,string>> {
    const names=readdirSync(root).sort().join(','),shared=['manifest.json,storage.json','manifest.json,objects,storage.json'].includes(names);
    if(!shared&&names!=='manifest.json,objects')fail('GIT_SNAPSHOT_INVALID');
    if(shared&&this.#snapshotBytes(join(root,'storage.json'),4096).toString('utf8')!==SHARED_SNAPSHOT_STORAGE)fail('GIT_SNAPSHOT_INVALID');
    const raw=this.#snapshotBytes(join(root,'manifest.json'),64*1024*1024),parsed=parseJson(raw,64*1024*1024);
    if(canonicalize(parsed)!==canonicalize(manifest)||canonicalize(parsed)!==raw.toString('utf8'))fail('GIT_SNAPSHOT_DIGEST_MISMATCH');
    const objects=shared?this.#sharedSnapshotObjects(root,false,staged):join(root,'objects'),stat=lstatSync(objects);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(objects)!==objects)fail('GIT_SNAPSHOT_INVALID');
    if(shared&&existsSync(join(root,'objects'))){const legacy=lstatSync(join(root,'objects'));if(!legacy.isDirectory()||legacy.isSymbolicLink()||realpathSync(join(root,'objects'))!==join(root,'objects'))fail('GIT_SNAPSHOT_INVALID')}
    const hashes=[...new Set(manifest.entries.map(entry=>entry.contentHash))].sort();
    if(!shared&&canonicalize(readdirSync(objects).sort())!==canonicalize(hashes))fail('GIT_SNAPSHOT_INVALID');
    const blobs=new Map<string,string>();let total=0;
    for(const hash of hashes){const bytes=this.#snapshotBytes(join(objects,hash),512*1024*1024);total+=bytes.byteLength;if(total>2*1024*1024*1024)fail('GIT_SNAPSHOT_LIMIT');if(hashBytes(bytes)!==hash)fail('GIT_SNAPSHOT_DIGEST_MISMATCH');blobs.set(hash,join(objects,hash));yield}
    return blobs;
  }
  #readSnapshot(root:string,manifest:CandidateManifest,staged=false):Map<string,string>{const steps=this.#snapshotReadSteps(root,manifest,staged);let next;do{next=steps.next()}while(!next.done);return next.value}
  /** Read-only inspection and format migration share the actual snapshot reader.
   * The caller owns the project lease; no stored JSON becomes action authority. */
  async inspectSnapshotStorage(root:string,manifest:CandidateManifest,boundary:()=>Promise<void>=async()=>{},progress?:(value:SnapshotStorageProgress)=>void){
    this.#snapshotPath(root);this.#snapshotManifest(manifest);const steps=this.#snapshotReadSteps(root,manifest);let next,completed=0;
    const total=new Set(manifest.entries.map(e=>e.contentHash)).size;
    while(!(next=steps.next()).done){progress?.({phase:'verify',completed:++completed,total});await boundary()}
    const shared=existsSync(join(root,'storage.json')),legacy=join(root,'objects'),legacyBlobs=shared?new Map<string,string>():next.value;
    if(shared&&existsSync(legacy))for(const hash of readdirSync(legacy).sort()){
      if(!next.value.has(hash))fail('GIT_SNAPSHOT_INVALID');const path=join(legacy,hash);
      if(hashBytes(this.#snapshotBytes(path,512*1024*1024))!==hash)fail('GIT_SNAPSHOT_DIGEST_MISMATCH');legacyBlobs.set(hash,path);await boundary();
    }
    return {shared,blobs:next.value,legacyBlobs};
  }
  async shareSnapshotStorage(root:string,manifest:CandidateManifest,boundary:()=>Promise<void>,progress?:(value:SnapshotStorageProgress)=>void):Promise<{removedBytes:number;removedFiles:number}>{
    const before=await this.inspectSnapshotStorage(root,manifest,boundary,progress),objects=this.#sharedSnapshotObjects(root,true);let completed=0;
    for(const [hash,path] of before.blobs){
      await boundary();const bytes=this.#snapshotBytes(path,512*1024*1024);if(hashBytes(bytes)!==hash)fail('GIT_SNAPSHOT_DIGEST_MISMATCH');
      const destination=join(objects,hash);
      if(existsSync(destination)){if(hashBytes(this.#snapshotBytes(destination,512*1024*1024))!==hash)fail('GIT_SNAPSHOT_DIGEST_MISMATCH')}
      else this.#snapshotWrite(destination,bytes);
      progress?.({phase:'share',completed:++completed,total:before.blobs.size});
    }
    const fd=openSync(objects,'r');try{fsyncSync(fd)}finally{closeSync(fd)}
    await boundary();
    if(!before.shared){
      // A crash before atomic publication leaves the original container readable.
      // The unreferenced temporary is outside that container and is never removed
      // by automatic cleanup, just like other unknown saved evidence.
      const temp=join(dirname(root),`shared-format-${randomUUID()}.pending`);
      this.#snapshotWrite(temp,SHARED_SNAPSHOT_STORAGE);renameSync(temp,join(root,'storage.json'));
      const fd=openSync(root,'r');try{fsyncSync(fd)}finally{closeSync(fd)}
      const parent=openSync(dirname(root),'r');try{fsyncSync(parent)}finally{closeSync(parent)}
    }
    // The shared representation is fully durable and independently readable
    // before removing any duplicate. A pause leaves either representation usable.
    let removedBytes=0,removedFiles=0;const legacy=join(root,'objects');
    if(existsSync(legacy)){
      completed=0;
      for(const hash of before.blobs.keys()){
        await boundary();const path=join(legacy,hash);
        if(existsSync(path)){
          const bytes=this.#snapshotBytes(path,512*1024*1024);
          if(hashBytes(bytes)!==hash||hashBytes(this.#snapshotBytes(join(objects,hash),512*1024*1024))!==hash)fail('GIT_SNAPSHOT_DIGEST_MISMATCH');
          unlinkSync(path);removedBytes+=bytes.byteLength;removedFiles++;
        }
        progress?.({phase:'cleanup',completed:++completed,total:before.blobs.size,removedBytes,removedFiles});
      }
      if(readdirSync(legacy).length)fail('GIT_SNAPSHOT_INVALID');rmdirSync(legacy);
      const fd=openSync(root,'r');try{fsyncSync(fd)}finally{closeSync(fd)}
    }
    await this.inspectSnapshotStorage(root,manifest,boundary,progress);return {removedBytes,removedFiles};
  }
  candidateCommit(root:string,ref:string,base:string,manifest:CandidateManifest,message:string):string {
    localRef(ref);oid(base);if(this.#run(root,['symbolic-ref','HEAD'])!==ref||this.head(root)!==base||this.refHead(ref)!==base)fail('GIT_CANDIDATE_REF_CHANGED');
    if(hashCanonical(workspaceManifest(root,base))!==hashCanonical(manifest))fail('GIT_CANDIDATE_CHANGED');
    const entries=new Set(manifest.entries.map(e=>e.path)),index:string[]=[];
    for(const path of this.#run(root,['ls-files','-z']).split('\0').filter(Boolean))
      if(!entries.has(path))index.push(`0 ${'0'.repeat(base.length)}\t${path}\0`);
    // Hash bounded batches and update the index once, as in source import. The
    // complete before/after manifest checks still detect concurrent changes.
    for(let offset=0;offset<manifest.entries.length;offset+=128){
      const batch=manifest.entries.slice(offset,offset+128);
      if(batch.some(entry=>entry.kind!=='FILE'))fail('GIT_UNSUPPORTED_FILE');
      const hashes=this.#run(root,['hash-object','-w','--no-filters','--',...batch.map(entry=>entry.path)]).split('\n');
      if(hashes.length!==batch.length)fail('GIT_OPERATION_FAILED');
      batch.forEach((entry,i)=>index.push(`${entry.mode} ${oid(hashes[i])}\t${entry.path}\0`));
    }
    if(index.length)this.#run(root,['update-index','-z','--index-info'],index.join(''));
    const tree=oid(this.#run(root,['write-tree']));if(hashCanonical(workspaceManifest(root,base))!==hashCanonical(manifest))fail('GIT_CANDIDATE_CHANGED');
    if(tree===this.tree(base))return base;this.identity();return oid(this.#run(root,['commit-tree',tree,'-p',base,'-m',message]));
  }
  bindCandidate(ref:string,commit:string,base:string):void {const current=this.refHead(ref);if(current===commit)return;if(current!==base)fail('GIT_CANDIDATE_REF_CHANGED');this.#run(this.repo,['update-ref',localRef(ref),oid(commit),oid(base)])}
  prepareMerge(root:string,head:string,candidate:string,message:string):string {
    this.identity();this.detached(root,head);
    try{this.#run(root,['merge','--no-ff','--no-commit','--no-edit','--no-verify',oid(candidate)])}catch{if(this.#run(root,['ls-files','-u','-z']))fail('MERGE_CONFLICT');fail('GIT_MERGE_PREPARATION_FAILED')}
    const tree=oid(this.#run(root,['write-tree'])),commit=oid(this.#run(root,['commit-tree',tree,'-p',oid(head),'-p',oid(candidate),'-m',message]));
    this.#run(root,['update-ref','--no-deref','HEAD',commit,oid(head)]);
    const dir=this.#run(root,['rev-parse','--absolute-git-dir']);for(const name of ['MERGE_HEAD','MERGE_MSG','MERGE_MODE','AUTO_MERGE']){const p=join(dir,name);if(existsSync(p))unlinkSync(p)}
    if(this.head(root)!==commit||this.#run(root,['status','--porcelain=v1','-z','--untracked-files=all','--ignored']))fail('GIT_INTEGRATION_TREE_CHANGED');return commit;
  }
  changed(commit:string,base:string):readonly {path:string;kind:string}[]{
    const rows=this.#run(this.repo,['diff-tree','--no-commit-id','--name-status','--no-renames','-r','-z',oid(base),oid(commit)]).split('\0').filter(Boolean),out:{path:string;kind:string}[]=[];
    for(let i=0;i<rows.length;i+=2){const kind=rows[i],path=rows[i+1];if(!['A','M','D','T'].includes(kind)||!validateScalar('Path',path).ok||path.split('/').some(p=>['.git','.pi','.ssh','.env','.npmrc','.netrc','credentials','credentials.json'].includes(p)))fail('GIT_FORBIDDEN_CHANGE');out.push({kind,path})}return out;
  }
  #indexMatches(commit:string,root=this.repo):boolean {try{this.#run(root,['diff-index','--cached','--quiet',oid(commit),'--']);return true}catch{return false}}
  /** Durable intent identifies ref-first interruption. Git's index lock prevents ordinary checkout races.
   * Two-tree read-tree refuses overwritten local edits. No reset/stash/rollback is performed. */
  apply(ref:string,old:string,commit:string,intentId:string,fault?:(point:string)=>void,recover=false):void {
    localRef(ref);oid(old);oid(commit);if(!validateScalar('ID',intentId).ok)fail('PROMOTION_INTENT_INVALID');if(this.target()!==ref)fail('GIT_WRONG_TARGET_BRANCH');this.assertNoOperation();
    const head=this.head();if(head!==old&&(!recover||head!==commit))fail('PROMOTION_TARGET_STALE');
    const index=resolve(this.repo,this.#run(this.repo,['rev-parse','--git-path','index'])),lock=index+'.lock',lease={source:'controlled-dev-promotion',intentId,processIncarnation:currentProcessIncarnation()};
    if(existsSync(lock)){if(!recover)fail('GIT_INDEX_LOCKED');const stat=lstatSync(lock);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)fail('GIT_INDEX_LOCKED');
      const prior=JSON.parse(readFileSync(lock).toString('utf8'));if(prior.source!==lease.source||prior.intentId!==intentId||inspectProcessOwner(prior.processIncarnation).status!=='DEAD')fail('GIT_INDEX_LOCKED');unlinkSync(lock);}
    const fd=openSync(lock,'wx',0o600);try{writeFileSync(fd,canonicalize(lease));fsyncSync(fd)}finally{closeSync(fd)}
    const alternate=join(dirname(index),`controlled-promotion-${intentId}.index`);
    let alternateOwned=false;
    const ownLock=()=>{const s=lstatSync(lock);return s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.size<=16384&&readFileSync(lock).toString('utf8')===canonicalize(lease)};
    try{
      const stat=lstatSync(index);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>32*1024*1024)fail('PROMOTION_INDEX_AMBIGUOUS');
      if(existsSync(alternate)){const s=lstatSync(alternate);if(!recover||!s.isFile()||s.isSymbolicLink()||s.nlink!==1)fail('PROMOTION_INDEX_AMBIGUOUS')}
      let expected=this.#indexMatches(commit)?commit:this.#indexMatches(old)?old:fail('PROMOTION_INDEX_AMBIGUOUS'),rebuildIndex=false;
      const proof=join(this.data,'controlled-dev','workspaces','promotion-check-'+intentId+'-'+Date.now());
      // Include both trees so additions, deletions and interrupted checkouts remain
      // observable while local ignored caches and credentials stay outside Git.
      const paths=[...new Set([...this.pathsAt(old),...this.pathsAt(commit)])];
      const observed=()=>{const manifest=sourceManifest(this.repo,old,paths),identities=paths.map(path=>{try{const stat=lstatSync(join(this.repo,path));return {path,dev:String(stat.dev),ino:String(stat.ino),nlink:String(stat.nlink),mode:String(stat.mode),size:String(stat.size),mtimeMs:String(stat.mtimeMs),ctimeMs:String(stat.ctimeMs)}}catch(error){if((error as {code?:string}).code==='ENOENT')return {path,missing:true};throw error}});return {manifest,canary:hashCanonical({entries:manifest.entries,identities})}};
      const physical=observed();let ignorePhysicalModes=false;try{ignorePhysicalModes=this.#run(this.repo,['config','--bool','--get','core.filemode'])==='false'}catch{}
      // A filesystem may expose all regular files as executable while Git explicitly
      // ignores that physical bit. The independently checked stage-zero index still
      // binds every versioned mode. Directory/symlink modes are never normalized.
      const comparable=(manifest:CandidateManifest)=>hashCanonical(manifest.entries.map(entry=>ignorePhysicalModes&&entry.kind==='FILE'?{...entry,mode:'100644'}:entry));
      const actual=comparable(physical.manifest);
      if(actual!==comparable(this.manifestAt(expected,old,proof))){
        if(!recover||head!==commit||expected!==old||actual!==comparable(this.manifestAt(commit,old,proof+'-new')))fail('GIT_TARGET_DIRTY');
        // The complete new tree is present but the old index survived the crash. Rebuild
        // only the index after proving every byte; partial or user-edited trees are refused.
        expected=commit;rebuildIndex=true;
      }
      if(!ownLock())fail('GIT_INDEX_LOCK_OWNERSHIP_LOST');
      if(this.target()!==ref||this.refHead(ref)!==head)fail('PROMOTION_TARGET_STALE');
      if(observed().canary!==physical.canary)fail('GIT_TARGET_DIRTY');
      alternateOwned=true;writeFileSync(alternate,readFileSync(index));
      if(head===old){this.#run(this.repo,['update-ref',ref,commit,old]);fault?.('afterRefUpdate')}
      if(expected!==commit)this.#run(this.repo,['read-tree','-u','-m',old,commit],undefined,{GIT_INDEX_FILE:alternate});
      if(rebuildIndex)this.#run(this.repo,['read-tree',commit],undefined,{GIT_INDEX_FILE:alternate});
      if(!ownLock())fail('GIT_INDEX_LOCK_OWNERSHIP_LOST');if(this.target()!==ref||this.refHead(ref)!==commit)fail('PROMOTION_TARGET_STALE');
      const af=openSync(alternate,'r');try{fsyncSync(af)}finally{closeSync(af)}renameSync(alternate,index);const dir=openSync(dirname(index),'r');try{fsyncSync(dir)}finally{closeSync(dir)}fault?.('afterWorktreeUpdate');
      if(!this.#indexMatches(commit)||this.#run(this.repo,['status','--porcelain=v1','-z','--untracked-files=all']))fail('PROMOTION_RESULT_INCONSISTENT');
    }finally{if(alternateOwned&&existsSync(alternate)&&!lstatSync(alternate).isSymbolicLink())unlinkSync(alternate);if(existsSync(lock)){if(!ownLock())fail('GIT_INDEX_LOCK_OWNERSHIP_LOST');unlinkSync(lock)}}
  }
}
