import {randomUUID} from 'node:crypto';
import {byteLength,canonicalize,hashCanonical,parseJson} from './contract-json.js';
import {validateScalar,validateStructure} from './contracts.js';
import type {ArtifactRef} from './contracts.js';
import {DurableStore} from './store.js';
import type {ArtifactInspection} from './store.js';
import {LockManager,LockError,withRepairMutation} from './lock-manager.js';
import {currentProcessIncarnation,inspectProcessOwner} from './process-incarnation.js';
import {closeSync,fsyncSync,lstatSync,openSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import type {LockHandle,LockRecord} from './lock-manager.js';
import {projectIdentity} from './project-identity.js';
import {CONTEXT_INVESTIGATION_LIMITS,contextInvestigationReads} from './context-investigation.js';

export interface InvestigationQuestion {readonly question:string;readonly why:string;readonly suggestedAnswer?:string}
export interface InvestigationAnswer {readonly question:string;readonly answer:string}
export interface InvestigationBinding {readonly kind:'planning'|'pre-task';readonly subjectId:string;readonly scopeDigest:string}
interface Snapshot {schemaVersion:1;binding:InvestigationBinding;revision:number;round:number;attempts:number;noProgress:number;
  seen:string[];pendingQuestions:InvestigationQuestion[];answers:InvestigationAnswer[];humanDigest:string;reservations:string[];answeredIndices:number[]}
interface Index {schemaVersion:1;projectId:string;revision:number;entries:{key:string;ref:ArtifactRef}[]}
export interface InvestigationOptions {readonly manager?:LockManager;readonly workspaceLock?:LockHandle;readonly fault?:(point:'afterArtifactBeforeIndexCAS')=>void}
const media='application/vnd.pi-controlled-dev.context-investigation+json';
const tokens=new WeakMap<object,{session:PersistentContextInvestigation;id:string}>();
const fail=(code='CONTEXT_INVESTIGATION_INVALID'):never=>{throw new Error(code)};
const clone=<T>(v:T)=>JSON.parse(canonicalize(v)) as T;
function question(q:InvestigationQuestion):void{
  if(!q||Object.keys(q).some(k=>!['question','why','suggestedAnswer'].includes(k))||!validateScalar('Text',q.question).ok||!q.question.trim()
    ||!validateScalar('Text',q.why).ok||(q.suggestedAnswer!==undefined&&!validateScalar('Text',q.suggestedAnswer).ok))fail();
}
/** Only an exact dead lease belonging to this namespace can be reclaimed.
 * Recovery uses the existing repair guard and a durable predecessor audit. */
function acquireContextWorkspace(manager:LockManager,repo:string):LockHandle{
  try{return manager.acquireWorkspace(repo)}catch(error){
    if(!(error instanceof LockError&&error.code==='WORKSPACE_LOCK_UNAVAILABLE')&&(error as {code?:string}).code!=='EEXIST')throw error;
    const {workspaceHash}=manager.workspaceIdentity(repo),path=join(manager.root,'workspaces',`${workspaceHash}.lock`);
    const read=()=>{const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16384)fail('CONTEXT_INVESTIGATION_RECOVERY_REQUIRED');return readFileSync(path).toString('utf8')};
    const raw=read(),expected=parseJson(raw,16384) as unknown as LockRecord;
    const allowed=['acquiredAt','kind','ownerSessionId','processIncarnation','runtimeGeneration','schemaVersion','token','workspaceHash'];
    if(Object.keys(expected).sort().join(',')!==allowed.sort().join(',')||expected.schemaVersion!==2||expected.kind!=='WORKSPACE'||expected.workspaceHash!==workspaceHash
      ||expected.ownerSessionId!=='context-investigation-host'||!/^context-[a-f0-9-]{36}$/.test(expected.runtimeGeneration)||!validateScalar('ID',expected.token).ok
      ||inspectProcessOwner(expected.processIncarnation).status!=='DEAD')throw error;
    withRepairMutation(manager.root,workspaceHash,()=>{
      if(read()!==raw||inspectProcessOwner(expected.processIncarnation).status!=='DEAD')fail('CONTEXT_INVESTIGATION_RECOVERY_REQUIRED');
      const successor=currentProcessIncarnation();if(!successor)fail('CONTEXT_INVESTIGATION_RECOVERY_REQUIRED');
      const audit=join(manager.root,'workspaces',`${workspaceHash}.${expected.token}.context-reclaimed`),fd=openSync(audit,'wx',0o600);
      try{writeFileSync(fd,canonicalize({schemaVersion:1,namespace:'context-investigations',previous:expected,successor,reclaimedAt:new Date().toISOString()}));fsyncSync(fd)}finally{closeSync(fd)}
      unlinkSync(path);const dir=openSync(dirname(path),'r');try{fsyncSync(dir)}finally{closeSync(dir)}
    });
    return manager.acquireWorkspace(repo);
  }
}
/** A project document namespace. Existing workspace lock, immutable artifacts and CAS;
 * no TaskSpec, workflow counters, source file or writer permission is created here. */
export class ContextInvestigationRepository {
  private constructor(readonly store:DurableStore,readonly repoRoot:string,readonly options:InvestigationOptions){}
  static open(data:string,repo:string,inspect:ArtifactInspection,options:InvestigationOptions={}):ContextInvestigationRepository{
    const manager=options.manager??new LockManager(data,'context-investigation-host',`context-${randomUUID()}`),lock=options.workspaceLock??acquireContextWorkspace(manager,repo);
    try{if(!manager.verifyWorkspaceLock(lock)||lock.record.workspaceHash!==manager.workspaceIdentity(repo).workspaceHash)fail('CONTEXT_INVESTIGATION_LOCK_REQUIRED');return new ContextInvestigationRepository(DurableStore.project(data,repo,'context-investigations',inspect,true)!,repo,options)}
    finally{if(!options.workspaceLock)manager.release(lock)}
  }
  #write<T>(fn:()=>T):T{
    const manager=this.options.manager??new LockManager(this.store.agentDataRoot,'context-investigation-host',`context-${randomUUID()}`),lock=this.options.workspaceLock??acquireContextWorkspace(manager,this.repoRoot);
    try{if(!manager.verifyWorkspaceLock(lock)||lock.record.workspaceHash!==manager.workspaceIdentity(this.repoRoot).workspaceHash)fail('CONTEXT_INVESTIGATION_LOCK_REQUIRED');return fn()}
    finally{if(!this.options.workspaceLock)manager.release(lock)}
  }
  #read(ref:ArtifactRef):any{
    if(!validateStructure('ArtifactRef',ref).ok||ref.mediaType!==media||ref.relativeStorePath!==`artifacts/${ref.id}`)fail();
    const v=parseJson(this.store.read(ref),1024*1024);if(hashCanonical(v)!==ref.digest)fail();return v;
  }
  #index():{ref:ArtifactRef|undefined;value:Index}{
    const ref=this.store.readProjectIndex();if(!ref)return {ref,value:{schemaVersion:1,projectId:projectIdentity(this.repoRoot),revision:0,entries:[]}};
    const v=this.#read(ref) as Index;
    if(Object.keys(v).sort().join(',')!=='entries,projectId,revision,schemaVersion'||v.schemaVersion!==1||v.projectId!==projectIdentity(this.repoRoot)
      ||!Number.isSafeInteger(v.revision)||v.revision<1||!Array.isArray(v.entries)||v.entries.length>256||new Set(v.entries.map(e=>e.key)).size!==v.entries.length)fail();
    for(const e of v.entries)if(Object.keys(e).sort().join(',')!=='key,ref'||!validateScalar('Hash',e.key).ok||!validateStructure('ArtifactRef',e.ref).ok)fail();
    return {ref,value:v};
  }
  bind(binding:InvestigationBinding):PersistentContextInvestigation{
    if(!binding||Object.keys(binding).sort().join(',')!=='kind,scopeDigest,subjectId'||!['planning','pre-task'].includes(binding.kind)
      ||!validateScalar('ID',binding.subjectId).ok||!validateScalar('Hash',binding.scopeDigest).ok)fail();
    return new PersistentContextInvestigation(this,Object.freeze(clone(binding)));
  }
  read(binding:InvestigationBinding):Snapshot{
    const key=hashCanonical(binding),entry=this.#index().value.entries.find(e=>e.key===key);
    if(!entry)return {schemaVersion:1,binding:clone(binding),revision:0,round:0,attempts:0,noProgress:0,seen:[],pendingQuestions:[],answers:[],humanDigest:hashCanonical([]),reservations:[],answeredIndices:[]};
    const s=this.#read(entry.ref) as Snapshot;
    if(Object.keys(s).sort().join(',')!=='answeredIndices,answers,attempts,binding,humanDigest,noProgress,pendingQuestions,reservations,revision,round,schemaVersion,seen'||s.schemaVersion!==1||canonicalize(s.binding)!==canonicalize(binding)
      ||[s.revision,s.round,s.attempts,s.noProgress].some(n=>!Number.isSafeInteger(n)||n<0)||s.round>256||s.attempts>3||s.noProgress>3
      ||!Array.isArray(s.seen)||s.seen.length>4096||new Set(s.seen).size!==s.seen.length||s.seen.some(h=>!validateScalar('Hash',h).ok)
      ||!Array.isArray(s.pendingQuestions)||s.pendingQuestions.length>128||!Array.isArray(s.answers)||s.answers.length>256
      ||!Array.isArray(s.answeredIndices)||new Set(s.answeredIndices).size!==s.answeredIndices.length||s.answeredIndices.some(i=>!Number.isSafeInteger(i)||i<0||i>=s.pendingQuestions.length)
      ||!Array.isArray(s.reservations)||s.reservations.length>3||s.reservations.some(id=>!validateScalar('ID',id).ok)||!validateScalar('Hash',s.humanDigest).ok)fail();
    for(const q of s.pendingQuestions)question(q);
    for(const a of s.answers)if(Object.keys(a).sort().join(',')!=='answer,question'||!validateScalar('Text',a.question).ok||!validateScalar('Text',a.answer).ok||!a.answer.trim())fail();
    if(binding.kind==='planning'&&s.answers.length)fail();return clone(s);
  }
  mutate<T>(binding:InvestigationBinding,fn:(state:Snapshot)=>T):T{return this.#write(()=>{
    const index=this.#index(),s=this.read(binding),result=fn(s);s.revision++;
    const raw=canonicalize(s);if(byteLength(raw)>1024*1024)fail('CONTEXT_INVESTIGATION_LIMIT');
    const key=hashCanonical(binding),ref=this.store.put(`investigation-${hashCanonical(s)}`,raw,media);
    const entries=[...index.value.entries.filter(e=>e.key!==key),{key,ref}];if(entries.length>256)fail('CONTEXT_INVESTIGATION_LIMIT');
    const next={...index.value,revision:index.value.revision+1,entries},indexRef=this.store.put(`context-index-${hashCanonical(next)}`,canonicalize(next),media);
    this.options.fault?.('afterArtifactBeforeIndexCAS');
    this.store.replaceProjectIndex(index.ref,indexRef);return result;
  })}
}
export class PersistentContextInvestigation {
  constructor(readonly repository:ContextInvestigationRepository,readonly binding:InvestigationBinding){}
  snapshot(){return this.repository.read(this.binding)}
  canInvestigate(){const s=this.snapshot();return s.attempts<CONTEXT_INVESTIGATION_LIMITS.attempts&&s.noProgress<CONTEXT_INVESTIGATION_LIMITS.consecutiveWithoutNewReads}
  reserve():object{
    const id=`investigation-${randomUUID()}`;
    this.repository.mutate(this.binding,s=>{if(s.attempts>=3||s.noProgress>=2)fail('CONTEXT_INVESTIGATION_OPERATOR_REQUIRED');s.attempts++;s.noProgress++;s.reservations.push(id)});
    const token=Object.freeze({});tokens.set(token,{session:this,id});return token;
  }
  finish(token:object,result?:object,questions:readonly InvestigationQuestion[]=[]){
    const held=tokens.get(token);if(!held||held.session!==this)throw new Error('CONTEXT_INVESTIGATION_RESERVATION_INVALID');tokens.delete(token);
    for(const q of questions)question(q);
    return this.repository.mutate(this.binding,s=>{
      if(!s.reservations.includes(held.id))fail('CONTEXT_INVESTIGATION_RESERVATION_INVALID');s.reservations=s.reservations.filter(id=>id!==held.id);
      const reads=result?contextInvestigationReads(result):[],newFacts=reads.filter(h=>!s.seen.includes(h)).length;
      const seen=[...new Set([...s.seen,...reads])];if(seen.length>4096)fail('CONTEXT_INVESTIGATION_LIMIT');s.seen=seen;
      if(newFacts)s.noProgress=0;if(result){s.pendingQuestions=clone([...questions]);s.answeredIndices=[];}
      return Object.freeze({retry:s.attempts<3&&s.noProgress<2,attempts:s.attempts,noProgress:s.noProgress,newFacts});
    });
  }
  ensureOperatorQuestion():readonly InvestigationQuestion[]{
    const state=this.snapshot();if(state.pendingQuestions.length)return state.pendingQuestions;
    const questions=[{question:"What information or decision would you like to add to resume the analysis?",why:"The available attempts have been exhausted. Some may have stopped before delivering a question. You can clarify the request or return to the project; reopening the screen does not reset the limit."}];
    return this.repository.mutate(this.binding,s=>{if(!s.pendingQuestions.length){s.pendingQuestions=questions;s.answeredIndices=[];}return clone(s.pendingQuestions)});
  }
  /** Host UI only, after explicit submission. Planning answers remain solely in ProjectGoal.
   * Never call on suggestions, cancel, opening the dialog, or model/RPC output. */
  confirmAnswers(answers:readonly InvestigationAnswer[],planning=false){
    if(!answers.length||planning!==(this.binding.kind==='planning'))fail();
    for(const a of answers)if(!validateScalar('Text',a.question).ok||!validateScalar('Text',a.answer).ok||!a.answer.trim())fail();
    const digest=hashCanonical(answers);
    this.repository.mutate(this.binding,s=>{
      if(s.humanDigest===digest)return;if(s.round>=256)fail('CONTEXT_INVESTIGATION_LIMIT');
      s.humanDigest=digest;s.round++;s.attempts=0;s.noProgress=0;s.reservations=[];s.pendingQuestions=[];s.answeredIndices=[];
      if(!planning)s.answers=clone([...answers]);
    });
  }
  savePreTaskAnswer(index:number,answer:InvestigationAnswer){
    if(this.binding.kind!=='pre-task'||!validateScalar('Text',answer.question).ok||!validateScalar('Text',answer.answer).ok||!answer.answer.trim())fail();
    this.repository.mutate(this.binding,s=>{if(s.pendingQuestions[index]?.question!==answer.question||s.answeredIndices.includes(index))fail();if(s.answers.length>=256)fail('CONTEXT_INVESTIGATION_LIMIT');s.answers.push(clone(answer));s.answeredIndices.push(index)});
  }
}
