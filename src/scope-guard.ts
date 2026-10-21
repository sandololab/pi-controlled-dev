import { HOST_GIT_CONFIG, hostGitEnvironment } from './host-git-policy.js';
import { projectCustodianRoot } from './project-storage.js';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { constants, accessSync, chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync,
  realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonicalize, hashCanonical, validateContract } from './contracts.js';
import type { ArtifactRef, Candidate, CandidateEntry, CandidateManifest, ScopeSpec } from './contracts.js';

export type ChangeKind = 'CREATE'|'MODIFY'|'DELETE'|'RENAME'|'MODE';
export interface CandidateChange { readonly kind:ChangeKind; readonly path:string; readonly fromPath?:string }
export interface ScopeCapture { readonly candidate:Candidate; readonly manifest:CandidateManifest; readonly digest:string;
  readonly generation:number; readonly changes:readonly CandidateChange[]; readonly changedFiles:readonly string[];
  readonly patch:string; readonly handoff:string; readonly artifacts:readonly ArtifactRef[] }
export interface AuthorizedReworkBase {
  readonly originalBaselineCommit:string; readonly baseCommit:string; readonly repoRoot:string; readonly workRoot:string;
  readonly candidateRoot:string; readonly candidateDigest:string; readonly candidateGeneration:number; readonly evidenceRefs:readonly string[];
}
const reworkBases=new WeakSet<object>();
export function isAuthorizedReworkBase(value:AuthorizedReworkBase):boolean{return reworkBases.has(value)}
export type ScopeGuardCode = 'SCOPE_BASELINE_INVALID'|'SCOPE_PATH_INVALID'|'SCOPE_VIOLATION'|'SCOPE_ALIAS_UNVERIFIABLE'
  |'GIT_IDENTITY_REQUIRED'|'SCOPE_WORKSPACE_CHANGED'|'SCOPE_ORIGINAL_CHANGED'|'SCOPE_PATCH_INVALID'|'SCOPE_GENERATION_INVALID'|'SCOPE_UNSUPPORTED_FILE';
export class ScopeGuardError extends Error { constructor(readonly code:ScopeGuardCode){super(code)} }

type Entry = CandidateEntry & { readonly bytes?:Uint8Array };
type DirIdentity = Readonly<{path:string;dev:number;ino:number}>;
const fixedNames=new Set(['.git','.pi','.controlled-dev','.ssh','.env','.npmrc','.netrc','credentials','credentials.json']);
const custodianScopes=new WeakMap<object,boolean>();

/** Host-side, fail-closed SCP-001/SCP-002 guard. It never trusts DeveloperResult.changedFiles. */
export class ScopeGuard {
  readonly repoRoot:string; readonly workRoot:string; readonly baseCommit:string; readonly #scope:ScopeSpec;
  readonly #originalDigest:string; readonly #originalIdentity:string; readonly #baseline:ReadonlyMap<string,Entry>; readonly #parents:readonly DirIdentity[];
  readonly #issued=new Map<number,string>(); #highestGeneration:number;
  readonly #reworks=new Map<AuthorizedReworkBase,{source:ScopeCapture;parents:readonly DirIdentity[]}>();
  #handoffChain:readonly string[]=[];
  private constructor(scope:ScopeSpec,workRoot:string,baseCommit:string,repoRoot:string,baseline:ReadonlyMap<string,Entry>,originalDigest:string,parents:readonly DirIdentity[],previousGeneration:number){
    this.#scope=scope;this.workRoot=workRoot;this.baseCommit=baseCommit;this.repoRoot=repoRoot;this.#baseline=baseline;
    this.#originalDigest=originalDigest;this.#originalIdentity=originalIdentity(repoRoot);this.#parents=parents;this.#highestGeneration=previousGeneration;
  }
  static open(scope:ScopeSpec,workRootInput:string,baseCommitInput:string,previousGeneration=0):ScopeGuard{
    try{
      if(scope.strongConfinementRequired||!Number.isSafeInteger(previousGeneration)||previousGeneration<0)fail('SCOPE_BASELINE_INVALID');
      const repoRoot=canonicalRoot(scope.repoRoot),workRoot=canonicalRoot(workRootInput);
      if(repoRoot===workRoot||isInside(repoRoot,workRoot)||isInside(workRoot,repoRoot)||baseCommitInput.length<40)fail('SCOPE_BASELINE_INVALID');
      accessSync(workRoot,constants.R_OK|constants.W_OK);
      if(canonicalRoot(git(repoRoot,['rev-parse','--show-toplevel']))!==repoRoot||canonicalRoot(git(workRoot,['rev-parse','--show-toplevel']))!==workRoot)fail('SCOPE_BASELINE_INVALID');
      const baseCommit=git(repoRoot,['rev-parse','--verify',`${scope.baseRef}^{commit}`]);
      if(baseCommit!==baseCommitInput||git(repoRoot,['rev-parse','HEAD'])!==baseCommit||git(workRoot,['rev-parse','HEAD'])!==baseCommit)fail('SCOPE_BASELINE_INVALID');
      if(originalStatus(repoRoot)||git(workRoot,['status','--porcelain=v1','-z','--untracked-files=all','--ignored']))fail('SCOPE_BASELINE_INVALID');
      const common=canonicalRoot(resolve(repoRoot,git(repoRoot,['rev-parse','--git-common-dir'])));
      if(common!==canonicalRoot(resolve(workRoot,git(workRoot,['rev-parse','--git-common-dir']))))fail('SCOPE_BASELINE_INVALID');
      const tracked=git(repoRoot,['ls-files','-z','--stage']);
      if(tracked.split('\0').some(line=>line&&line.startsWith('160000 ')))fail('SCOPE_UNSUPPORTED_FILE');
      const original=scanTracked(repoRoot),baseline=scan(workRoot);
      if(entriesDigest(original)!==entriesDigest(baseline))fail('SCOPE_BASELINE_INVALID');
      const trackedPaths=tracked.split('\0').filter(Boolean).map(line=>line.slice(line.indexOf('\t')+1)).sort(compareUtf8);
      if(canonicalize(trackedPaths)!==canonicalize([...baseline.keys()].sort(compareUtf8)))fail('SCOPE_BASELINE_INVALID');
      validateScopePaths(scope,baseline);
      return new ScopeGuard(scope,workRoot,baseCommit,repoRoot,baseline,entriesDigest(original),parentIdentities(workRoot,scope.allowedPaths),previousGeneration);
    }catch(error){if(error instanceof ScopeGuardError)throw error;fail('SCOPE_BASELINE_INVALID')}
  }
  /** Reattach to existing bytes; never clean, apply a patch, or regenerate the candidate. */
  static restore(scope:ScopeSpec,candidate:Candidate,terminalProof:string):ScopeGuard{
    const repo=canonicalRoot(scope.repoRoot),work=canonicalRoot(candidate.root),base=candidate.baseCommit;
    if(scope.strongConfinementRequired||repo===work||isInside(repo,work)||isInside(work,repo)||
      git(repo,['rev-parse','HEAD'])!==base||git(repo,['rev-parse','--verify',`${scope.baseRef}^{commit}`])!==base||
      git(work,['rev-parse','HEAD'])!==base||originalStatus(repo)||
      canonicalRoot(resolve(repo,git(repo,['rev-parse','--git-common-dir'])))!==canonicalRoot(resolve(work,git(work,['rev-parse','--git-common-dir']))))fail('SCOPE_BASELINE_INVALID');
    const baseline=scanTracked(repo);validateScopePaths(scope,baseline);
    const guard=new ScopeGuard(scope,work,base,repo,baseline,entriesDigest(baseline),parentIdentities(work,scope.allowedPaths),candidate.generation);
    if(guard.capture(candidate.generation,terminalProof).digest!==candidate.digest)fail('SCOPE_WORKSPACE_CHANGED');return guard;
  }
  /** Read-only source baseline already proven against the complete isolated copy
   * by open(); retains the approved Git modes on filesystems with fixed modes. */
  baselineManifest():CandidateManifest{return manifestOf(this.baseCommit,this.#baseline)}
  capture(generation:number,terminalProof:string):ScopeCapture{
    if(!Number.isSafeInteger(generation)||generation<1)fail('SCOPE_GENERATION_INVALID');
    verifyParentIdentities(this.workRoot,this.#parents);
    if(git(this.repoRoot,['rev-parse','HEAD'])!==this.baseCommit||git(this.repoRoot,['rev-parse','--verify',`${this.#scope.baseRef}^{commit}`])!==this.baseCommit
      || originalStatus(this.repoRoot)||entriesDigest(scanTracked(this.repoRoot))!==this.#originalDigest||originalIdentity(this.repoRoot)!==this.#originalIdentity)fail('SCOPE_ORIGINAL_CHANGED');
    if(git(this.workRoot,['rev-parse','HEAD'])!==this.baseCommit)fail('SCOPE_WORKSPACE_CHANGED');
    const current=scan(this.workRoot);validateNoAliases(current);const changes=changesBetween(this.#baseline,current);
    for(const change of changes){
      const paths=change.fromPath?[change.fromPath,change.path]:[change.path];
      if(paths.some(path=>!allowed(path,this.#scope)))fail('SCOPE_VIOLATION');
      const before=this.#baseline.get(change.fromPath??change.path),after=current.get(change.path);
      if(before?.kind==='SYMLINK'||after?.kind==='SYMLINK')fail('SCOPE_VIOLATION');
    }
    verifyParentIdentities(this.workRoot,this.#parents);
    const manifest=manifestOf(this.baseCommit,current),checked=validateContract('CandidateManifest',manifest);
    if(!checked.ok)fail('SCOPE_UNSUPPORTED_FILE');
    const digest=hashCanonical(checked.value),prior=this.#issued.get(generation);
    if(generation<this.#highestGeneration||generation>this.#highestGeneration+1||(prior!==undefined&&prior!==digest))fail('SCOPE_GENERATION_INVALID');
    if(prior===undefined){this.#issued.set(generation,digest);this.#highestGeneration=generation}
    const patch=buildPatch(this.#baseline,current),handoff=canonicalize({schemaVersion:1,baseCommit:this.baseCommit,digest,generation,changes,
      ...(this.#handoffChain.length?{previousHandoffs:this.#handoffChain}:{})});
    verifyPatch(this.#baseline,patch,manifest);
    const manifestRef=artifact(`manifest-${digest.slice(0,24)}`,canonicalize(manifest),'application/json');
    const patchRef=artifact(`patch-${digest.slice(0,24)}-g${generation}`,patch,'application/vnd.pi-controlled-dev.patch+json');
    const handoffRef=artifact(`handoff-${digest.slice(0,24)}-g${generation}`,handoff,'application/json');
    const proofRef=artifact(`candidate-proof-${sha(terminalProof).slice(0,24)}`,terminalProof,'application/json');
    const candidate:Candidate=Object.freeze({schemaVersion:1,root:this.workRoot,baseCommit:this.baseCommit,digest,generation,
      manifest:manifestRef,patch:patchRef,handoff:handoffRef,terminalProof:proofRef});
    return Object.freeze({candidate,manifest:checked.value,digest,generation,changes:Object.freeze(changes),
      changedFiles:Object.freeze([...new Set(changes.flatMap(change=>change.fromPath?[change.fromPath,change.path]:[change.path]))].sort(compareUtf8)),
      patch,handoff,artifacts:Object.freeze([manifestRef,patchRef,handoffRef,proofRef])});
  }
  /** Host-only materialization of the exact current candidate, never a caller-selected commit/ref. */
  prepareRework(source:ScopeCapture,workRootInput:string):AuthorizedReworkBase{
    const observed=this.capture(source.generation,'rework-source-check');
    if(source.generation!==this.#highestGeneration||observed.digest!==source.digest||source.patch!==observed.patch
      ||canonicalize(source.manifest)!==canonicalize(observed.manifest)
      ||source.candidate.root!==this.workRoot||source.candidate.baseCommit!==this.baseCommit)fail('SCOPE_GENERATION_INVALID');
    const workRoot=resolve(workRootInput);
    if(workRoot!==workRootInput||canonicalRoot(dirname(workRoot))!==dirname(workRoot)||workRoot===this.repoRoot||workRoot===this.workRoot
      ||isInside(this.repoRoot,workRoot)||isInside(this.workRoot,workRoot))fail('SCOPE_BASELINE_INVALID');
    try{lstatSync(workRoot);fail('SCOPE_BASELINE_INVALID')}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error}
    if(source.manifest.entries.some(entry=>entry.kind!=='FILE'))fail('SCOPE_UNSUPPORTED_FILE');
    let taskBranch=false;try{taskBranch=git(this.workRoot,['symbolic-ref','--quiet','HEAD']).startsWith('refs/heads/controlled-dev/')}catch{}
    if(taskBranch)try{for(const key of ['user.name','user.email'])if(!git(this.workRoot,['config','--get',key]).trim())fail('GIT_IDENTITY_REQUIRED');
      for(const kind of ['GIT_AUTHOR_IDENT','GIT_COMMITTER_IDENT'])git(this.workRoot,['var',kind]);
    }catch{fail('GIT_IDENTITY_REQUIRED')}
    git(this.workRoot,['worktree','add','--quiet','--detach',workRoot,this.baseCommit]);
    applyPatch(workRoot,source.patch);
    if(hashCanonical(manifestOf(this.baseCommit,scan(workRoot)))!==source.digest)fail('SCOPE_PATCH_INVALID');
    for(const path of this.#baseline.keys())if(!source.manifest.entries.some(entry=>entry.path===path))git(workRoot,['update-index','--force-remove','--',path]);
    for(const entry of source.manifest.entries){
      const oid=git(workRoot,['hash-object','-w','--no-filters','--',entry.path]);
      git(workRoot,['update-index','--add','--cacheinfo',entry.mode,oid,entry.path]);
    }
    const tree=git(workRoot,['write-tree']);
    // New task branches use the configured identity. Historical detached rework
    // retains its explicit synthetic technical identity for compatibility.
    const identity=taskBranch?[]:['-c','user.name=ControlledDev','-c','user.email=controlled@example.invalid'];
    const baseCommit=git(workRoot,[...identity,'commit-tree',tree,'-p',this.baseCommit,
      '-m',`Controlled rework generation ${source.generation} digest ${source.digest}`]);
    git(workRoot,['update-ref','--no-deref','HEAD',baseCommit,this.baseCommit]);
    if(git(workRoot,['status','--porcelain=v1','-z','--untracked-files=all','--ignored']))fail('SCOPE_BASELINE_INVALID');
    this.capture(source.generation,'rework-source-recheck');
    const base=Object.freeze({originalBaselineCommit:this.baseCommit,baseCommit,repoRoot:this.repoRoot,workRoot,candidateRoot:this.workRoot,
      candidateDigest:source.digest,candidateGeneration:source.generation,evidenceRefs:Object.freeze(source.artifacts.map(value=>value.id))});
    reworkBases.add(base);this.#reworks.set(base,{source,parents:parentIdentities(workRoot,this.#scope.allowedPaths)});return base;
  }
  finishRework(base:AuthorizedReworkBase,terminalProof:string):ScopeCapture{
    const preparation=this.#reworks.get(base);
    if(!preparation||base.candidateGeneration!==this.#highestGeneration)fail('SCOPE_GENERATION_INVALID');
    if(this.capture(base.candidateGeneration,'rework-source-recheck').digest!==base.candidateDigest)fail('SCOPE_WORKSPACE_CHANGED');
    if(canonicalRoot(base.workRoot)!==base.workRoot||git(base.workRoot,['rev-parse','HEAD'])!==base.baseCommit)fail('SCOPE_WORKSPACE_CHANGED');
    verifyParentIdentities(base.workRoot,preparation.parents);
    const current=scan(base.workRoot),changes=changesBetween(this.#baseline,current);
    for(const change of changes){
      if([change.path,...(change.fromPath?[change.fromPath]:[])].some(path=>!allowed(path,this.#scope))
        ||current.get(change.path)?.kind==='SYMLINK'||this.#baseline.get(change.fromPath??change.path)?.kind==='SYMLINK')fail('SCOPE_VIOLATION');
    }
    const cumulative=buildPatch(this.#baseline,current),manifest=manifestOf(this.baseCommit,current);
    verifyPatch(this.#baseline,cumulative,manifest);
    // The source candidate stays at B0; only deterministic host materialization writes its cumulative successor.
    const incremental=buildPatch(scan(this.workRoot),current);
    verifyParentIdentities(this.workRoot,this.#parents);applyPatch(this.workRoot,incremental);
    if(hashCanonical(manifestOf(this.baseCommit,scan(this.workRoot)))!==hashCanonical(manifest))fail('SCOPE_PATCH_INVALID');
    this.#handoffChain=[...this.#handoffChain,preparation.source.handoff];
    const capture=this.capture(base.candidateGeneration+1,terminalProof);this.#reworks.delete(base);reworkBases.delete(base);return capture;
  }
}

function validateScopePaths(scope:ScopeSpec,entries:ReadonlyMap<string,Entry>):void{
  custodianScopes.set(scope,projectCustodianRoot(scope.repoRoot)!==undefined);
  for(const path of [...scope.allowedPaths,...scope.deniedPaths]){
    validatePath(path);if(isFixedDenied(path)||isCustodianHumanPath(path,scope))fail('SCOPE_PATH_INVALID');
    const parts=path.split('/');let cursor='';
    for(const part of parts.slice(0,-1)){cursor=cursor?`${cursor}/${part}`:part;if(entries.get(cursor)?.kind==='SYMLINK')fail('SCOPE_ALIAS_UNVERIFIABLE')}
  }
  validateNoAliases(entries,new Set([...scope.allowedPaths,...scope.deniedPaths]));
}
function validatePath(path:string):void{
  if(!path||path.startsWith('/')||path.includes('\\')||path.includes('\0')||path.includes('//')||/^[A-Za-z]:/.test(path)
    ||path.startsWith('//')||path.split('/').some(part=>part===''||part==='.'||part==='..')||Buffer.byteLength(path,'utf8')>4096)fail('SCOPE_PATH_INVALID');
}
function isFixedDenied(path:string):boolean{return path.split('/').some(part=>fixedNames.has(part.toLowerCase()))}
function isCustodianHumanPath(path:string,scope:ScopeSpec):boolean{return custodianScopes.get(scope)===true&&path.split('/')[0].toLowerCase()==='documentazione'}
function allowed(path:string,scope:ScopeSpec):boolean{return !isFixedDenied(path)&&!isCustodianHumanPath(path,scope)&&scope.allowedPaths.includes(path)&&!scope.deniedPaths.includes(path)}
function scanTracked(root:string):ReadonlyMap<string,Entry>{
  const staged=git(root,['ls-files','--stage','-z']).split('\0').filter(Boolean);
  const indexed=new Map<string,string>();
  for(const row of staged){const match=/^(100644|100755|120000) [a-f0-9]+ 0\t(.+)$/s.exec(row);
    if(!match)fail('SCOPE_BASELINE_INVALID');indexed.set(match[2],match[1]);}
  const entries=scan(root,new Set(indexed.keys()));
  // Filesystems which cannot represent executable bits may report every source
  // file executable. Git's clean, stage-zero index supplies source modes there.
  // Candidate modes and the original physical identity remain independently
  // observed: this does not hide a later chmod or an out-of-scope candidate edit.
  let ignoresPhysicalModes=false;try{ignoresPhysicalModes=git(root,['config','--bool','--get','core.filemode'])==='false'}catch{}
  if(!ignoresPhysicalModes)return entries;
  return new Map([...entries].map(([path,entry])=>[path,entry.kind==='FILE'
    ?Object.freeze({...entry,mode:indexed.get(path) as '100644'|'100755'}):entry]));
}
function scan(root:string,paths?:ReadonlySet<string>):ReadonlyMap<string,Entry>{
  const found=new Map<string,Entry>();
  const included=paths?new Set([...paths].flatMap(path=>path.split('/').map((_,i,parts)=>parts.slice(0,i+1).join('/')))):undefined;
  function walk(rel:string):void{
    const names=readdirSync(rel?join(root,rel):root).sort(compareUtf8);
    for(const name of names){const path=rel?`${rel}/${name}`:name;if(path==='.git'||included&&!included.has(path))continue;validatePath(path);
      const full=join(root,...path.split('/')),stat=lstatSync(full);
      if(stat.isDirectory()){walk(path);continue}
      if(stat.isSymbolicLink()){const target=readlinkSync(full);found.set(path,Object.freeze({schemaVersion:1,path,kind:'SYMLINK',mode:'120000',contentHash:sha(target)}));continue}
      if(!stat.isFile()||stat.nlink!==1)fail('SCOPE_UNSUPPORTED_FILE');
      const bytes=readFileSync(full),mode=(stat.mode&0o111?'100755':'100644') as '100755'|'100644';
      found.set(path,Object.freeze({schemaVersion:1,path,kind:'FILE',mode,contentHash:sha(bytes),bytes:new Uint8Array(bytes)}));
    }
  }
  walk('');validateNoAliases(found);return found;
}
function validateNoAliases(entries:ReadonlyMap<string,Entry>,extra=new Set<string>()):void{
  const seen=new Map<string,string>();for(const path of [...entries.keys(),...extra]){const alias=path.normalize('NFC').toLocaleLowerCase('en-US'),prior=seen.get(alias);if(prior!==undefined&&prior!==path)fail('SCOPE_ALIAS_UNVERIFIABLE');seen.set(alias,path)}
}
function manifestOf(baseCommit:string,entries:ReadonlyMap<string,Entry>):CandidateManifest{return Object.freeze({schemaVersion:1,baseCommit,
  entries:Object.freeze([...entries.values()].map(({bytes:_,...entry})=>entry).sort((a,b)=>compareUtf8(a.path,b.path)))})}
function changesBetween(before:ReadonlyMap<string,Entry>,after:ReadonlyMap<string,Entry>):CandidateChange[]{
  const deleted=[...before.keys()].filter(path=>!after.has(path)),created=[...after.keys()].filter(path=>!before.has(path)),changes:CandidateChange[]=[];
  const used=new Set<string>();
  for(const fromPath of deleted){const old=before.get(fromPath)!;const matches=created.filter(path=>!used.has(path)&&sameEntry(old,after.get(path)!));
    if(matches.length===1){used.add(matches[0]);changes.push(Object.freeze({kind:'RENAME',path:matches[0],fromPath}))}else changes.push(Object.freeze({kind:'DELETE',path:fromPath}))}
  for(const path of created)if(!used.has(path))changes.push(Object.freeze({kind:'CREATE',path}));
  for(const path of before.keys()){const old=before.get(path),now=after.get(path);if(!now)continue;
    if(old!.kind!==now.kind||old!.contentHash!==now.contentHash)changes.push(Object.freeze({kind:'MODIFY',path}));
    else if(old!.mode!==now.mode)changes.push(Object.freeze({kind:'MODE',path}));}
  return changes.sort((a,b)=>compareUtf8(a.fromPath??a.path,b.fromPath??b.path)||compareUtf8(a.path,b.path));
}
function sameEntry(a:Entry,b:Entry):boolean{return a.kind===b.kind&&a.mode===b.mode&&a.contentHash===b.contentHash}
/** Independently reconstruct the P11 patch from host-observed roots, including untracked/binary bytes. */
export function workspacePatch(repoRoot:string,workRoot:string):string{return buildPatch(scanTracked(repoRoot),scan(workRoot))}
/** Reconstruct the canonical patch from already acquired manifests. Read bytes
 * only for actual writes, checking each against the exact acquired content hash.
 * This is data verification, not permission to apply the patch. */
export function workspacePatchFromManifests(workRoot:string,before:CandidateManifest,after:CandidateManifest):string {
  if(!validateContract('CandidateManifest',before).ok||!validateContract('CandidateManifest',after).ok||before.baseCommit!==after.baseCommit)fail('SCOPE_PATCH_INVALID');
  const oldEntries=new Map(before.entries.map(entry=>[entry.path,entry])),newEntries=new Map<string,Entry>(after.entries.map(entry=>[entry.path,entry]));
  for(const change of changesBetween(oldEntries,newEntries)){
    if(change.kind==='DELETE')continue;const entry=newEntries.get(change.path)!;
    if(entry.kind!=='FILE')fail('SCOPE_PATCH_INVALID');
    const path=join(workRoot,...entry.path.split('/')),stat=lstatSync(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||realpathSync(path)!==path||(stat.mode&0o111?'100755':'100644')!==entry.mode)fail('SCOPE_WORKSPACE_CHANGED');
    const bytes=readFileSync(path);if(sha(bytes)!==entry.contentHash)fail('SCOPE_WORKSPACE_CHANGED');newEntries.set(entry.path,Object.freeze({...entry,bytes}));
  }
  return buildPatch(oldEntries,newEntries);
}
function buildPatch(before:ReadonlyMap<string,Entry>,after:ReadonlyMap<string,Entry>):string{
  const operations=changesBetween(before,after).flatMap(change=>{
    if(change.kind==='RENAME')return [{op:'delete',path:change.fromPath},{op:'write',path:change.path,mode:after.get(change.path)!.mode,hex:hex(after.get(change.path)!.bytes!)}];
    if(change.kind==='DELETE')return [{op:'delete',path:change.path}];const entry=after.get(change.path)!;
    return [{op:'write',path:change.path,mode:entry.mode,hex:hex(entry.bytes!)}];
  });return canonicalize({schemaVersion:1,operations});
}
export function workspaceManifest(root:string,originalBaselineCommit:string):CandidateManifest{return manifestOf(originalBaselineCommit,scan(root))}
/** Compare physical source bytes for an explicit host-observed set of Git paths.
 * Missing paths remain missing; unrelated ignored files never enter this manifest. */
export function sourceManifest(root:string,baseCommit:string,paths:readonly string[]):CandidateManifest{
  for(const path of paths)validatePath(path);
  return manifestOf(baseCommit,scan(root,new Set(paths)));
}
/** Checkpoints protect exactly the committed source tree. Untracked build/test artifacts
 * may be generated in the isolated worktree and never become baseline source authority. */
export function trackedWorkspaceManifest(root:string,commit:string):CandidateManifest {
  const paths=new Set(git(root,['ls-tree','-r','--name-only','-z',commit]).split('\0').filter(Boolean));
  if(git(root,['rev-parse','HEAD'])!==commit)fail('SCOPE_BASELINE_INVALID');
  return manifestOf(commit,scan(root,paths));
}
function applyPatch(root:string,patch:string):void{
  const value=JSON.parse(patch) as {operations:{op:string;path:string;mode?:string;hex?:string}[]};
  for(const op of value.operations){validatePath(op.path);if(isFixedDenied(op.path))fail('SCOPE_VIOLATION');const full=join(root,...op.path.split('/'));
    if(op.op==='delete')unlinkSync(full);else{mkdirSync(dirname(full),{recursive:true});writeFileSync(full,unhex(op.hex!));chmodSync(full,op.mode==='100755'?0o755:0o644)}}
}
const verifiedPatchRounds=new WeakMap<object,Set<string>>();
/** A round-trip proof belongs to immutable private baseline bytes and exact
 * patch/manifest bytes. Live workspace, scope and source checks always run first. */
function verifyPatch(baseline:ReadonlyMap<string,Entry>,patch:string,expected:CandidateManifest):void{
  const key=hashCanonical({patch,expected});if(verifiedPatchRounds.get(baseline)?.has(key))return;
  const root=mkdtempSync(join(tmpdir(),'controlled-scope-roundtrip-'));
  try{
    for(const entry of baseline.values()){if(entry.kind!=='FILE')continue;const full=join(root,...entry.path.split('/'));mkdirSync(dirname(full),{recursive:true});writeFileSync(full,entry.bytes!);chmodSync(full,entry.mode==='100755'?0o755:0o644)}
    applyPatch(root,patch);
    if(canonicalize(manifestOf(expected.baseCommit,scan(root)))!==canonicalize(expected))fail('SCOPE_PATCH_INVALID');
  }catch(error){if(error instanceof ScopeGuardError)throw error;fail('SCOPE_PATCH_INVALID')}finally{rmSync(root,{recursive:true,force:true})}
  const proofs=verifiedPatchRounds.get(baseline)??new Set<string>();if(proofs.size>=64){const oldest=proofs.values().next().value;if(oldest!==undefined)proofs.delete(oldest)}proofs.add(key);verifiedPatchRounds.set(baseline,proofs);
}
function parentIdentities(root:string,paths:readonly string[]):readonly DirIdentity[]{const unique=new Set<string>();for(const path of paths){let p=dirname(path);while(p!=='.'){unique.add(p);p=dirname(p)}}
  return Object.freeze([...unique].sort(compareUtf8).filter(path=>{try{return lstatSync(join(root,...path.split('/'))).isDirectory()}catch{return false}}).map(path=>{const s=lstatSync(join(root,...path.split('/')));return Object.freeze({path,dev:s.dev,ino:s.ino})}))}
function verifyParentIdentities(root:string,parents:readonly DirIdentity[]):void{for(const parent of parents){try{const s=lstatSync(join(root,...parent.path.split('/')));if(!s.isDirectory()||s.dev!==parent.dev||s.ino!==parent.ino)fail('SCOPE_ALIAS_UNVERIFIABLE')}catch(error){if(error instanceof ScopeGuardError)throw error;fail('SCOPE_ALIAS_UNVERIFIABLE')}}}
function artifact(id:string,content:string,mediaType:string):ArtifactRef{return Object.freeze({schemaVersion:1,id,digest:sha(content),relativeStorePath:`memory/${id}`,bytes:Buffer.byteLength(content,'utf8'),mediaType})}
function originalIdentity(root:string):string{
  const gitDir=git(root,['rev-parse','--absolute-git-dir']);
  const paths=git(root,['ls-files','-z']).split('\0').filter(Boolean),parents=parentIdentities(root,paths);
  return hashCanonical({tree:entriesDigest(scan(root,new Set(paths))),parents,files:paths.map(path=>{const stat=lstatSync(join(root,path));return {path,dev:stat.dev,ino:stat.ino,mode:stat.mode,nlink:stat.nlink}}),git:['HEAD','index'].map(path=>{
    const full=join(gitDir,path);return {path,mode:lstatSync(full).mode,hash:sha(readFileSync(full))};})});
}
/** Ignored local caches may coexist with the source baseline, but project-local
 * Pi controls must never silently alter a fresh or restored controlled task. */
function originalStatus(root:string):string{
  const status=git(root,['status','--porcelain=v1','-z','--untracked-files=all','--ignored']);
  return status.split('\0').filter(row=>row&&(!row.startsWith('!! ')||row.slice(3)==='.pi'||row.slice(3).startsWith('.pi/'))).join('\0');
}
function entriesDigest(entries:ReadonlyMap<string,Entry>):string{return hashCanonical(manifestOf('0'.repeat(40),entries).entries)}
function canonicalRoot(path:string):string{const real=realpathSync(path);if(real!==resolve(path)||real.includes('\n'))fail('SCOPE_BASELINE_INVALID');return real}
function isInside(parent:string,child:string):boolean{const rel=relative(parent,child);return rel!==''&&!rel.startsWith('..')&&rel!==child}
const hostHooks=mkdtempSync(join(tmpdir(),'controlled-dev-host-hooks-'));
function git(cwd:string,args:readonly string[]):string{
  if(realpathSync(hostHooks)!==hostHooks||readdirSync(hostHooks).length)fail('SCOPE_BASELINE_INVALID');
  return execFileSync('git',['-C',cwd,'-c',`core.hooksPath=${hostHooks}`,...HOST_GIT_CONFIG,...args],{encoding:'utf8',timeout:10_000,maxBuffer:64*1024*1024,env:hostGitEnvironment()}).replace(/\n$/,'');
}
function sha(value:string|Uint8Array):string{return createHash('sha256').update(value).digest('hex')}
function hex(bytes:Uint8Array):string{return [...bytes].map(value=>value.toString(16).padStart(2,'0')).join('')}
function unhex(value:string):Uint8Array{if(value.length%2)fail('SCOPE_PATCH_INVALID');const out=new Uint8Array(value.length/2);for(let i=0;i<out.length;i++){const n=Number.parseInt(value.slice(i*2,i*2+2),16);if(!Number.isFinite(n))fail('SCOPE_PATCH_INVALID');out[i]=n}return out}
function compareUtf8(a:string,b:string):number{const aa=Buffer.from(a),bb=Buffer.from(b);for(let i=0;i<Math.min(aa.length,bb.length);i++)if(aa[i]!==bb[i])return aa[i]-bb[i];return aa.length-bb.length}
function fail(code:ScopeGuardCode):never{throw new ScopeGuardError(code)}
