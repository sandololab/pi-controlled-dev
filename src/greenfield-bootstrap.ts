import { projectIdentity } from './project-identity.js';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, openSync, writeFileSync, closeSync, fsyncSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { canonicalize, hashBytes, hashCanonical, parseJson, validateScalar, validateStructure } from './contracts.js';
import type { ArtifactRef } from './contracts.js';
import { object, literal, enumeration, list, scalars, scalar } from './contract-schema.js';
import { checkMemorySchema, validateMemoryProposal, freezeMemory, memoryReference, MEMORY_PROPOSALS_WIRE, memoryPresentation } from './project-memory.js';
import type { ProjectMemoryProposal, ProjectMemoryReference } from './project-memory.js';
import { validatePlanningPortability } from './project-planning.js';
import type { ProjectGoal } from './project-planning.js';
import { ProjectMemoryRepository } from './project-memory-repository.js';
import { ProjectPlanningRepository } from './project-planning-repository.js';
import { DurableStore } from './store.js';
import type { ArtifactInspection } from './store.js';
import { CandidateGit, localRef } from './candidate-git.js';
import { LockManager } from './lock-manager.js';
import type { LockRecord } from './lock-manager.js';
import { createTrustedConfirmationRequest, presentTrustedConfirmation, consumeTrustedConfirmation, readTrustedConfirmationEvidence } from './trusted-confirmation.js';
import type { TrustedConfirmationRequest, TrustedConfirmationReceipt, HumanConfirmationChannel } from './trusted-confirmation.js';
import type { PreTaskProposalRequest } from './pre-task-proposal.js';

const MEDIA='application/vnd.pi-controlled-dev.greenfield-bootstrap+json';
const json=scalar<unknown>('JSON',()=>true);
const scoutSchema=object('GreenfieldTechnicalProposal',{schemaVersion:literal(1),phase:literal('GREENFIELD_PROPOSAL'),proposalOnly:literal(true),requestId:scalars.ID,requestHash:scalars.Hash,
  projectTitle:scalars.Text,initialBranch:scalars.ID,initialTechnicalChoices:list(json,0,4),missingDecisions:list(scalars.Text,0,8),explanation:scalars.Text});
export interface GreenfieldScoutMode {readonly preferences:readonly string[];readonly correction?:string;readonly previous?:GreenfieldTechnicalProposal}
export interface GreenfieldTechnicalProposal {readonly schemaVersion:1;readonly phase:'GREENFIELD_PROPOSAL';readonly proposalOnly:true;readonly requestId:string;readonly requestHash:string;
  readonly projectTitle:string;readonly initialBranch:string;readonly initialTechnicalChoices:readonly ProjectMemoryProposal[];readonly missingDecisions:readonly string[];readonly explanation:string}
const wireText={type:'string',minLength:1,maxLength:4096};
// Narrow the existing native memory wire fragments to the three bootstrap kinds.
// This describes the existing validators; it does not normalize or discard model fields.
const memoryChoiceWire=MEMORY_PROPOSALS_WIRE.items,nativeContentWire=memoryChoiceWire.properties.content.properties;
const greenfieldChoiceWire=(kind:'software-adr'|'project-convention'|'technical-constraint',keys:readonly(keyof typeof nativeContentWire)[])=>({
 ...memoryChoiceWire,properties:{...memoryChoiceWire.properties,recordKind:{const:kind},
  scope:{type:'object',additionalProperties:false,properties:{kind:{const:'repository'}},required:['kind']},
  content:{type:'object',additionalProperties:false,properties:Object.fromEntries(keys.map(key=>[key,
   key==='consequences'?{...nativeContentWire[key],minItems:1,maxItems:16}:key==='alternatives'?{...nativeContentWire[key],maxItems:16}:nativeContentWire[key]])),required:keys},
  evidenceRefs:{...memoryChoiceWire.properties.evidenceRefs,maxItems:0},relatedTaskRefs:{...memoryChoiceWire.properties.relatedTaskRefs,maxItems:0},relatedRecordRefs:{...memoryChoiceWire.properties.relatedRecordRefs,maxItems:0}}});
const greenfieldChoicesWire={type:'array',maxItems:4,items:{anyOf:[
 greenfieldChoiceWire('software-adr',['decisionKey','context','decision','rationale','consequences','alternatives']),
 greenfieldChoiceWire('project-convention',['convention','rationale']),
 greenfieldChoiceWire('technical-constraint',['constraint','rationale','consequences'])]}};
export const GREENFIELD_OUTPUT_SCHEMA={type:'object',additionalProperties:false,properties:{schemaVersion:{const:1},phase:{const:'GREENFIELD_PROPOSAL'},proposalOnly:{const:true},requestId:wireText,requestHash:wireText,
  projectTitle:wireText,initialBranch:wireText,initialTechnicalChoices:greenfieldChoicesWire,missingDecisions:{type:'array',items:wireText,maxItems:8},explanation:wireText},required:['schemaVersion','phase','proposalOnly','requestId','requestHash','projectTitle','initialBranch','initialTechnicalChoices','missingDecisions','explanation']} as const;
function fail(code:string):never{throw new Error(code)}
function choices(input:readonly unknown[]):readonly ProjectMemoryProposal[]{return input.map(v=>{const p=validateMemoryProposal(v);
  if(p.recordKind==='technical-lesson'||p.scope.kind!=='repository'||p.evidenceRefs.length||p.relatedTaskRefs.length||p.relatedRecordRefs.length||'sourcePath' in p.content)fail('GREENFIELD_CHOICE_INVALID');return p;})}
export function validateGreenfieldScout(input:unknown,request:PreTaskProposalRequest):GreenfieldTechnicalProposal {
  const v=checkMemorySchema(scoutSchema,input,65536);if(v.requestId!==request.requestId||v.requestHash!==hashCanonical(request))fail('GREENFIELD_SCOUT_BINDING');
  localRef(`refs/heads/${v.initialBranch}`);validatePlanningPortability(v);return freezeMemory({...v,initialTechnicalChoices:choices(v.initialTechnicalChoices)}) as GreenfieldTechnicalProposal;
}
interface DirectoryProof {readonly dev:number;readonly ino:number;readonly birthtimeMs:string;readonly mode:number}
interface TargetState {readonly kind:'ABSENT'|'EMPTY';readonly parent:DirectoryProof;readonly directory:DirectoryProof|null}
export interface GreenfieldBootstrapProposal {readonly schemaVersion:1;readonly bootstrapId:string;readonly projectId:string;readonly revision:number;readonly projectTitle:string;readonly projectObjective:string;
 readonly preferences:readonly string[];readonly targetLocation:{readonly anchorId:string;readonly relativePath:string};readonly targetState:TargetState;readonly initialBranch:string;readonly baselineStrategy:'EMPTY_ROOT_COMMIT';
 readonly initialTechnicalChoices:readonly ProjectMemoryProposal[];readonly createdAt:string;readonly contentDigest:string}
export interface GreenfieldBootstrapIntent {readonly schemaVersion:1;readonly bootstrapId:string;readonly proposalRef:ArtifactRef;readonly approvalRef:ArtifactRef;readonly owner:LockRecord;readonly createdAt:string}
export interface GreenfieldBootstrapResult {readonly schemaVersion:1;readonly projectId:string;readonly bootstrapId:string;readonly target:{readonly projectId:string;readonly relativePath:'.'};
 readonly initialCommit:string;readonly initialTree:string;readonly branch:string;readonly intentRef:ArtifactRef;readonly approvalRef:ArtifactRef;readonly projectSetupRef:ArtifactRef|null;readonly createdAt:string}
interface Progress {schemaVersion:1;stage:'INTENT'|'DIRECTORY'|'GIT'|'PREPARED'|'BASELINE';directory:DirectoryProof|null;gitDigest:string|null;commit:string|null}
interface Index {schemaVersion:1;proposalRef:ArtifactRef;intentRef:ArtifactRef;progressRef:ArtifactRef;resultRef:ArtifactRef|null}
const same=(a:unknown,b:unknown)=>canonicalize(a)===canonicalize(b);
const within=(a:string,b:string)=>{const p=relative(a,b);return !p||(!p.startsWith('..')&&!p.startsWith('/'))};
const proof=(path:string):DirectoryProof=>{const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(path)!==path)fail('GREENFIELD_PATH_UNSAFE');return {dev:s.dev,ino:s.ino,birthtimeMs:String(s.birthtimeMs),mode:s.mode}};
function sync(path:string):void{const fd=openSync(path,'r');try{fsyncSync(fd)}finally{closeSync(fd)}}
function closed(v:any,keys:string[]):void{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.sort().join(','))fail('GREENFIELD_ARTIFACT_INVALID')}
function validateProposal(input:unknown):GreenfieldBootstrapProposal{
  const p=checkMemorySchema(object('GreenfieldBootstrapProposal',{schemaVersion:literal(1),bootstrapId:scalars.ID,projectId:scalars.Hash,revision:scalars.UInt,projectTitle:scalars.Text,projectObjective:scalars.Text,
    preferences:list(scalars.Text,0,16),targetLocation:object('TargetLocation',{anchorId:scalars.Hash,relativePath:scalars.Path}),targetState:json,initialBranch:scalars.ID,baselineStrategy:literal('EMPTY_ROOT_COMMIT'),
    initialTechnicalChoices:list(json,0,4),createdAt:scalars.Time,contentDigest:scalars.Hash}),input,65536) as GreenfieldBootstrapProposal;
  const {contentDigest,...body}=p;localRef(`refs/heads/${p.initialBranch}`);
  if(p.revision<1||hashCanonical(body)!==contentDigest||p.targetLocation.relativePath.includes('/'))fail('GREENFIELD_PROPOSAL_INVALID');
  closed(p.targetState,['kind','parent','directory']);if(!['ABSENT','EMPTY'].includes(p.targetState.kind)||(p.targetState.kind==='ABSENT')!==(p.targetState.directory===null))fail('GREENFIELD_PROPOSAL_INVALID');
  for(const d of [p.targetState.parent,p.targetState.directory].filter(Boolean)){closed(d,['dev','ino','birthtimeMs','mode']);if(Object.entries(d!).some(([key,n])=>key==='birthtimeMs'?typeof n!=='string'||!/^\d+(\.\d+)?$/.test(n):typeof n!=='number'||!Number.isSafeInteger(n)||n<0))fail('GREENFIELD_PROPOSAL_INVALID')}
  choices(p.initialTechnicalChoices);validatePlanningPortability(p);return freezeMemory(p);
}
function gitDigest(repo:string,branch?:string):string{
 const root=join(repo,'.git'),rows:unknown[]=[['.',proof(root)]];
 const walk=(dir:string,depth=0)=>{if(depth>16)fail('GREENFIELD_RECOVERY_AMBIGUOUS');for(const name of readdirSync(dir).sort()){
   const path=join(dir,name),s=lstatSync(path);if(s.isSymbolicLink()||(!s.isDirectory()&&(!s.isFile()||s.nlink!==1||s.size>16*1024*1024))||rows.length>4096)fail('GREENFIELD_RECOVERY_AMBIGUOUS');if(branch&&['index','controlled-dev-project.json',`refs/heads/${branch}`,`logs/refs/heads/${branch}`,'logs/HEAD'].includes(relative(root,path))){if(!s.isFile())fail('GREENFIELD_RECOVERY_AMBIGUOUS');continue}
   if(s.isDirectory()){if(!branch||!['logs','logs/refs','logs/refs/heads'].includes(relative(root,path)))rows.push([relative(root,path),proof(path)]);walk(path,depth+1)}
   else{if(!s.isFile()||s.nlink!==1||s.size>16*1024*1024)fail('GREENFIELD_RECOVERY_AMBIGUOUS');rows.push([relative(root,path),s.mode,hashBytes(readFileSync(path))])}
 }};walk(root);return hashCanonical(rows);
}
/** Project-level artifacts and effect reconciliation only. Task states and task authority are untouched. */
export class GreenfieldBootstrap {
 readonly target:string;readonly data:string;readonly location:GreenfieldBootstrapProposal['targetLocation'];
 #latest?:GreenfieldBootstrapProposal;readonly #requests=new WeakMap<object,GreenfieldBootstrapProposal>();
 constructor(data:string,target:string,readonly inspect:ArtifactInspection,readonly fault?:(point:string)=>void){
  this.data=realpathSync(data);if(this.data!==resolve(data)||typeof target!=='string'||!target.trim()||target.split(/[\\/]/).some(p=>['..','.','.git','.pi','.codex','.agents','.ssh'].includes(p))||target.includes('\0'))fail('GREENFIELD_PATH_UNSAFE');
  this.target=resolve(target);const parent=dirname(this.target),leaf=basename(this.target);
  if(realpathSync(parent)!==parent||!validateScalar('Path',leaf).ok||['.git','.pi','.codex','.agents','.ssh'].includes(leaf)||within(this.data,this.target)||within(this.target,this.data))fail('GREENFIELD_PATH_UNSAFE');
  for(let p=parent;;p=dirname(p)){proof(p);if(existsSync(join(p,'.git')))CandidateGit.assertOutsideGit(p);if(p===dirname(p))break}
  this.location={anchorId:hashBytes(Buffer.from(parent)),relativePath:leaf};
 }
 #state():TargetState {
  const parent=proof(dirname(this.target));
  if(!existsSync(this.target)){try{lstatSync(this.target);fail('GREENFIELD_PATH_UNSAFE')}catch(e){if((e as {code?:string}).code!=='ENOENT')throw e}return {kind:'ABSENT',parent,directory:null}}
  const directory=proof(this.target),entries=readdirSync(this.target);
  if(entries.includes('.git'))fail(CandidateGit.bootstrapExisting(this.target)?'GREENFIELD_ALREADY_INITIALIZED':'GREENFIELD_UNBORN_UNSUPPORTED');
  if(entries.length)fail('GREENFIELD_TARGET_NOT_EMPTY');return {kind:'EMPTY',parent,directory};
 }
 propose(objective:string,technical:Pick<GreenfieldTechnicalProposal,'projectTitle'|'initialBranch'|'initialTechnicalChoices'|'missingDecisions'>,preferences:readonly string[]=[]):GreenfieldBootstrapProposal{
  if(technical.missingDecisions.length)fail('GREENFIELD_DECISION_REQUIRED');CandidateGit.bootstrapPreflight(dirname(this.target));
  const body={schemaVersion:1 as const,bootstrapId:this.#latest?.bootstrapId??`bootstrap-${randomUUID()}`,projectId:this.#latest?.projectId??hashBytes(Buffer.from(randomUUID())),revision:(this.#latest?.revision??0)+1,
   projectTitle:technical.projectTitle,projectObjective:objective,preferences,targetLocation:this.location,targetState:this.#state(),initialBranch:technical.initialBranch,baselineStrategy:'EMPTY_ROOT_COMMIT' as const,
   initialTechnicalChoices:technical.initialTechnicalChoices,createdAt:new Date().toISOString()};
  return this.#latest=validateProposal({...body,contentDigest:hashCanonical(body)});
 }
 narrative(p:GreenfieldBootstrapProposal):string{return `Create a new project\n\nProject\n${p.projectTitle}\n\nWhere\n${this.target}\n\nObjective\n${p.projectObjective}\n\nProposed setup\n${p.initialTechnicalChoices.map(c=>c.title+'\n'+memoryPresentation({...c,status:'PROPOSED',authorityKind:'proposal'})).join('\n\n')||"No additional material technical decisions."}\n\nAn initial technical version of the project will be created on branch ${p.initialBranch}. This provides a safe starting point for all subsequent changes.\n\nYou are authorizing pi-controlled-dev ${p.targetState.kind==='ABSENT'?"to create this directory, ":''}to initialize a local Git repository and create the initial empty baseline. This operation does not install dependencies or develop the application yet.\n\nInitial decisions require the normal Project Memory confirmations. After initialization, you can review the development plan before starting the first task.`}
 prepare(p:GreenfieldBootstrapProposal):TrustedConfirmationRequest {
  if(p!==this.#latest)fail('GREENFIELD_PROPOSAL_STALE');this.#fresh(p);
  const q=createTrustedConfirmationRequest({purpose:'greenfield-bootstrap',subjectKind:'GreenfieldBootstrapProposal',subjectId:p.bootstrapId,subjectRevision:p.revision,action:'APPROVE',payload:p as any,presentation:{title:"Create a new project",content:this.narrative(p)}});
  this.#requests.set(q,p);return q;
 }
 #fresh(p:GreenfieldBootstrapProposal):void {if(p!==this.#latest||!same(this.location,p.targetLocation)||!same(this.#state(),p.targetState))fail('GREENFIELD_TARGET_STALE');CandidateGit.bootstrapPreflight(dirname(this.target))}
 async approve(ctx:HumanConfirmationChannel,p:GreenfieldBootstrapProposal):Promise<GreenfieldBootstrapResult|undefined>{const q=this.prepare(p),receipt=await presentTrustedConfirmation(ctx,q);return receipt?this.apply(q,receipt):undefined}
 #lease(recover=false):{manager:LockManager;lock:ReturnType<LockManager['acquireBootstrap']>}{
  const manager=new LockManager(this.data,`greenfield-bootstrap-${randomUUID()}`,`bootstrap-${randomUUID()}`);let lock;
  try{lock=manager.acquireBootstrap(this.target)}catch(error){if(!recover||(error as {code?:string}).code!=='WORKSPACE_LOCK_UNAVAILABLE')throw error;
   const path=join(manager.root,'workspaces',`${manager.bootstrapIdentity(this.target).workspaceHash}.lock`),s=lstatSync(path);
   if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>16384)throw error;const owner=parseJson(readFileSync(path),16384) as unknown as LockRecord;
   if(!owner.ownerSessionId.startsWith('greenfield-bootstrap-'))throw error;manager.reclaimProjectWorkspace(this.target,owner);lock=manager.acquireBootstrap(this.target);
  }return {manager,lock};
 }
 apply(q:TrustedConfirmationRequest,receipt:TrustedConfirmationReceipt):GreenfieldBootstrapResult{
  const p=this.#requests.get(q);if(!p)fail('GREENFIELD_APPROVAL_INVALID');this.#requests.delete(q);const {manager,lock}=this.#lease();
  try{this.#fresh(p);if(this.pending())fail('GREENFIELD_RECOVERY_REQUIRED');
   const store=DurableStore.bootstrap(this.data,p.projectId,this.inspect,true)!;
   const approvalRef=consumeTrustedConfirmation(receipt,()=>{this.#fresh(p);return q},store),proposalRef=this.#put(store,p);
   const intent:GreenfieldBootstrapIntent={schemaVersion:1,bootstrapId:p.bootstrapId,proposalRef,approvalRef,owner:lock.record,createdAt:new Date().toISOString()},intentRef=this.#put(store,intent);
   const index:Index={schemaVersion:1,proposalRef,intentRef,progressRef:this.#put(store,{schemaVersion:1,stage:'INTENT',directory:null,gitDigest:null,commit:null}),resultRef:null};this.#save(store,undefined,index);this.fault?.('afterIntent');
   return this.#continue(store,index,p,manager,lock);
  }finally{manager.release(lock)}
 }
 #put(store:DurableStore,value:unknown):ArtifactRef {validatePlanningPortability(value);return store.put(`bootstrap-${hashCanonical(value)}`,canonicalize(value),MEDIA)}
 #read(store:DurableStore,ref:ArtifactRef):any {if(!validateStructure('ArtifactRef',ref).ok||ref.mediaType!==MEDIA||ref.bytes>65536)fail('GREENFIELD_ARTIFACT_INVALID');const v=parseJson(store.read(ref),65536);if(hashCanonical(v)!==ref.digest)fail('GREENFIELD_ARTIFACT_INVALID');validatePlanningPortability(v);return v}
 #save(store:DurableStore,base:ArtifactRef|undefined,index:Index):void{store.replaceProjectIndex(base,this.#put(store,index))}
 #load(store:DurableStore,portableRead=false):{index:Index;proposal:GreenfieldBootstrapProposal;intent:GreenfieldBootstrapIntent;progress:Progress}{
  const ref=store.readProjectIndex();if(!ref)fail('GREENFIELD_INTENT_MISSING');const index=this.#read(store,ref) as Index;closed(index,['schemaVersion','proposalRef','intentRef','progressRef','resultRef']);
  const p=validateProposal(this.#read(store,index.proposalRef)),intent=this.#read(store,index.intentRef) as GreenfieldBootstrapIntent,progress=this.#read(store,index.progressRef) as Progress;
  closed(intent,['schemaVersion','bootstrapId','proposalRef','approvalRef','owner','createdAt']);closed(progress,['schemaVersion','stage','directory','gitDigest','commit']);
  if(index.schemaVersion!==1||intent.schemaVersion!==1||progress.schemaVersion!==1||intent.bootstrapId!==p.bootstrapId||!same(intent.proposalRef,index.proposalRef)||(!same(p.targetLocation,this.location)&&!(portableRead&&index.resultRef&&projectIdentity(this.target)===p.projectId))||basename(dirname(store.root))!==p.projectId||!['INTENT','DIRECTORY','GIT','PREPARED','BASELINE'].includes(progress.stage))fail('GREENFIELD_ARTIFACT_INVALID');
  const evidence=parseJson(store.read(intent.approvalRef),135168) as any;
  const q=evidence.request;readTrustedConfirmationEvidence(store,intent.approvalRef,q);
  if(q.purpose!=='greenfield-bootstrap'||q.subjectId!==p.bootstrapId||q.subjectRevision!==p.revision||q.action!=='APPROVE'||!same(q.payload,p))fail('GREENFIELD_APPROVAL_INVALID');
  if(intent.owner.kind!=='WORKSPACE'||intent.owner.workspaceHash!==hashBytes(Buffer.from(this.target))&&!portableRead||!intent.owner.ownerSessionId.startsWith('greenfield-bootstrap-')||!validateScalar('Time',intent.createdAt).ok)fail('GREENFIELD_ARTIFACT_INVALID');
  if(index.resultRef)this.#result(store,index,p);return {index,proposal:p,intent,progress};
 }
 pending():string|undefined{
  const root=join(this.data,'controlled-dev','projects');if(!existsSync(root))return;
  const names=readdirSync(root);if(names.length>4096)fail('GREENFIELD_DISCOVERY_LIMIT');let found:string|undefined;
  for(const id of names.filter(n=>/^[a-f0-9]{64}$/.test(n))){const store=DurableStore.bootstrap(this.data,id,this.inspect);if(!store?.readProjectIndex())continue;
   const index=this.#read(store,store.readProjectIndex()!) as Index,p=validateProposal(this.#read(store,index.proposalRef));
   if(same(p.targetLocation,this.location)&&!index.resultRef){if(found)fail('GREENFIELD_RECOVERY_AMBIGUOUS');found=id}
  }return found;
 }
 recover(projectId:string):GreenfieldBootstrapResult{
  const store=DurableStore.bootstrap(this.data,projectId,this.inspect);if(!store)fail('GREENFIELD_INTENT_MISSING');const first=this.#load(store),{manager,lock}=this.#lease(true);
  try{const loaded=this.#load(store);if(!same(first.index,loaded.index))fail('GREENFIELD_RECOVERY_AMBIGUOUS');return this.#continue(store,loaded.index,loaded.proposal,manager,lock)}finally{manager.release(lock)}
 }
 #result(store:DurableStore,index:Index,p:GreenfieldBootstrapProposal):GreenfieldBootstrapResult{
  const r=this.#read(store,index.resultRef!) as GreenfieldBootstrapResult;closed(r,['schemaVersion','projectId','bootstrapId','target','initialCommit','initialTree','branch','intentRef','approvalRef','projectSetupRef','createdAt']);
  const intent=this.#read(store,index.intentRef) as GreenfieldBootstrapIntent;
  if(r.projectSetupRef){const setup=this.#read(store,r.projectSetupRef);closed(setup,['schemaVersion','bootstrapId','projectGoalRef','projectMemoryRefs','projectPlanRef']);if(setup.schemaVersion!==1||setup.bootstrapId!==p.bootstrapId||!validateStructure('ArtifactRef',setup.projectGoalRef).ok||!Array.isArray(setup.projectMemoryRefs)||setup.projectMemoryRefs.some((ref:any)=>ref.projectId!==p.projectId)||setup.projectPlanRef&&!validateStructure('ArtifactRef',setup.projectPlanRef).ok)fail('GREENFIELD_ARTIFACT_INVALID')}
  if(r.schemaVersion!==1||r.projectId!==p.projectId||r.bootstrapId!==p.bootstrapId||!same(r.target,{projectId:p.projectId,relativePath:'.'})||r.branch!==p.initialBranch||!same(r.intentRef,index.intentRef)||!same(r.approvalRef,intent.approvalRef)||!validateScalar('GitOID',r.initialCommit).ok||!validateScalar('GitOID',r.initialTree).ok||!validateScalar('Time',r.createdAt).ok)fail('GREENFIELD_ARTIFACT_INVALID');return freezeMemory(r);
 }
 #continue(store:DurableStore,index:Index,p:GreenfieldBootstrapProposal,manager:LockManager,lock:ReturnType<LockManager['acquireBootstrap']>):GreenfieldBootstrapResult{
  let progress=this.#read(store,index.progressRef) as Progress;
  const own=()=>{if(!manager.verifyWorkspaceLock(lock)||!same(proof(dirname(this.target)),p.targetState.parent))fail('GREENFIELD_RECOVERY_AMBIGUOUS')};
  const save=(next:Progress)=>{own();const base=store.readProjectIndex();progress=next;index={...index,progressRef:this.#put(store,next)};this.#save(store,base,index)};
  const directory=()=>{own();if(!progress.directory||!same(proof(this.target),progress.directory)||readdirSync(this.target).some(n=>n!=='.git'))fail('GREENFIELD_RECOVERY_AMBIGUOUS')};
  if(index.resultRef){const r=this.#result(store,index,p);CandidateGit.verifyProjectIdentity(this.target,p.projectId,r.initialCommit);return r}
  own();
  if(progress.stage==='INTENT'){
   if(!same(this.#state(),p.targetState))fail('GREENFIELD_TARGET_STALE');
   if(p.targetState.kind==='ABSENT'){mkdirSync(this.target,{mode:0o700});sync(dirname(this.target))}
   save({...progress,stage:'DIRECTORY',directory:proof(this.target)});this.fault?.('afterDirectory');
  }
  if(progress.stage==='DIRECTORY'){
   directory();if(readdirSync(this.target).length)fail('GREENFIELD_RECOVERY_AMBIGUOUS');CandidateGit.bootstrapPreflight(dirname(this.target));
   mkdirSync(join(this.target,'.git'),{mode:0o700});sync(this.target);CandidateGit.bootstrapInit(this.target,p.initialBranch,this.data);directory();const git=new CandidateGit(this.target,this.data);git.assertUnborn(p.initialBranch);
   save({...progress,stage:'GIT',gitDigest:gitDigest(this.target)});this.fault?.('afterGitInit');
  }
  directory();const git=new CandidateGit(this.target,this.data);
  if(progress.stage==='GIT'){
   if(gitDigest(this.target)!==progress.gitDigest)fail('GREENFIELD_RECOVERY_AMBIGUOUS');git.assertUnborn(p.initialBranch);
   git.bootstrapCommit(p.projectId,commit=>{save({...progress,stage:'PREPARED',commit,gitDigest:gitDigest(this.target,p.initialBranch)});this.fault?.('afterCommitPrepared')});
  }else if(progress.stage==='PREPARED'){
   if(gitDigest(this.target,p.initialBranch)!==progress.gitDigest)fail('GREENFIELD_RECOVERY_AMBIGUOUS');
   let head:string|undefined;try{head=git.head()}catch{}
   if(!head){git.assertUnborn(p.initialBranch);git.bootstrapBind(progress.commit!)}else if(head!==progress.commit)fail('GREENFIELD_RECOVERY_AMBIGUOUS');else {git.assertBootstrapReflogs(p.initialBranch,progress.commit!);git.bootstrapRestoreIndex(progress.commit!);}
  }
  if(progress.stage==='PREPARED'){
   directory();git.assertTarget(`refs/heads/${p.initialBranch}`,progress.commit!);git.assertBootstrapReflogs(p.initialBranch,progress.commit!);CandidateGit.verifyProjectIdentity(this.target,p.projectId,progress.commit!);
   const marker=join(this.target,'.git','controlled-dev-project.json'),content=canonicalize({schemaVersion:1,projectId:p.projectId,baselineCommit:progress.commit});
   if(existsSync(marker)){const s=lstatSync(marker);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>4096||readFileSync(marker).toString('utf8')!==content)fail('GREENFIELD_RECOVERY_AMBIGUOUS')}
   else{const fd=openSync(marker,'wx',0o600);try{writeFileSync(fd,content);fsyncSync(fd)}finally{closeSync(fd)}sync(dirname(marker))}
   save({...progress,stage:'BASELINE',gitDigest:gitDigest(this.target)});this.fault?.('afterInitialCommit');
  }
  directory();if(progress.stage!=='BASELINE'||gitDigest(this.target)!==progress.gitDigest)fail('GREENFIELD_RECOVERY_AMBIGUOUS');git.assertTarget(`refs/heads/${p.initialBranch}`,progress.commit!);
  const intent=this.#read(store,index.intentRef) as GreenfieldBootstrapIntent,r:GreenfieldBootstrapResult={schemaVersion:1,projectId:p.projectId,bootstrapId:p.bootstrapId,target:{projectId:p.projectId,relativePath:'.'},initialCommit:progress.commit!,initialTree:git.tree(progress.commit!),branch:p.initialBranch,intentRef:index.intentRef,approvalRef:intent.approvalRef,projectSetupRef:null,createdAt:new Date().toISOString()};
  own();const base=store.readProjectIndex();index={...index,resultRef:this.#put(store,r)};this.#save(store,base,index);return this.#result(store,index,p);
 }
 /** Native project APIs retain their separate approval semantics. This prepares proposals only. */
 initializeProject(p:GreenfieldBootstrapProposal,r:GreenfieldBootstrapResult):{goal:ProjectGoal;memory:ProjectMemoryRepository;planning:ProjectPlanningRepository;memoryRefs:readonly ProjectMemoryReference[]}{
  const store=DurableStore.bootstrap(this.data,p.projectId,this.inspect);if(!store)fail('GREENFIELD_RESULT_MISSING');const loaded=this.#load(store);
  if(!loaded.index.resultRef||!same({...this.#result(store,loaded.index,loaded.proposal),projectSetupRef:null},{...r,projectSetupRef:null})||!same(p,loaded.proposal))fail('GREENFIELD_RESULT_INVALID');CandidateGit.verifyProjectIdentity(this.target,p.projectId,r.initialCommit);
  const memory=ProjectMemoryRepository.open(this.data,this.target,this.inspect,{create:true})!,planning=ProjectPlanningRepository.open(this.data,this.target,this.inspect,{create:true,memory})!;
  let goal=planning.goals().find(g=>g.objective===p.projectObjective&&g.title===p.projectTitle&&same(g.constraints,p.preferences));
  if(!goal)goal=planning.createGoal(p.projectObjective,p.projectTitle,p.preferences);
  for(const choice of p.initialTechnicalChoices){if(!memory.entries().some(e=>e.record.origin.taskId===p.bootstrapId&&same({recordKind:e.record.recordKind,title:e.record.title,scope:e.record.scope,content:e.record.content,evidenceRefs:e.record.evidenceRefs,relatedTaskRefs:e.record.relatedTaskRefs,relatedRecordRefs:e.record.relatedRecordRefs},choice)))memory.propose(choice,{role:'host',taskId:p.bootstrapId})}
  this.recordSetup(p.projectId,goal,memory,planning);
  return {goal,memory,planning,memoryRefs:memory.entries().filter(e=>e.record.origin.taskId===p.bootstrapId).map(e=>memoryReference(e.record,e.ref))};
 }
 recordSetup(projectId:string,goal:ProjectGoal,memory:ProjectMemoryRepository,planning:ProjectPlanningRepository):void{
  const {manager,lock}=this.#lease();try{
   const store=DurableStore.bootstrap(this.data,projectId,this.inspect)!;const loaded=this.#load(store);if(!loaded.index.resultRef||goal.projectId!==projectId||memory.projectId!==projectId||planning.projectId!==projectId)fail('GREENFIELD_RESULT_INVALID');
   const nativeIndex=parseJson(planning.store.read(planning.store.readProjectIndex()!),2*1024*1024) as any;
   const projectGoalRef=nativeIndex.goals.find((ref:ArtifactRef)=>ref.id===`${goal.goalId}-r${goal.revision}`);if(!projectGoalRef)fail('GREENFIELD_RESULT_INVALID');
   const projectMemoryRefs=memory.entries().filter(e=>e.record.origin.taskId===loaded.proposal.bootstrapId).map(e=>memoryReference(e.record,e.ref));
   const setup={schemaVersion:1,bootstrapId:loaded.proposal.bootstrapId,projectGoalRef,projectMemoryRefs,projectPlanRef:nativeIndex.plans.at(-1)??null};
   const projectSetupRef=this.#put(store,setup),r=this.#result(store,loaded.index,loaded.proposal);if(!same(r.projectSetupRef,projectSetupRef))this.#save(store,store.readProjectIndex(),{...loaded.index,resultRef:this.#put(store,{...r,projectSetupRef})});
  }finally{manager.release(lock)}
 }
 proposal(projectId:string,portableRead=false):GreenfieldBootstrapProposal{const store=DurableStore.bootstrap(this.data,projectId,this.inspect);if(!store)fail('GREENFIELD_INTENT_MISSING');return this.#load(store,portableRead).proposal}
}
