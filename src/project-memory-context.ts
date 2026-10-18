import { hashBytes, parseJson, validateStructure } from './contracts.js';
import { object, literal, enumeration, list, scalar, scalars, integer } from './contract-schema.js';
import { canonicalize, hashCanonical, byteLength } from './contract-json.js';
import type { ArtifactRef, AssignmentEnvelope } from './contracts.js';
import { isAcquiredDispatchIdentity } from './pi-subagents-rpc.js';
import type { DispatchIdentity, TerminalProofOptions } from './pi-subagents-rpc.js';
import { MEMORY_LIMITS, MEMORY_CONTEXT_MEDIA, MEMORY_RECEIPT_MEDIA, currentMemory, freezeMemory, memoryConflicts,
  memoryError, memoryExpectation, memoryReference, scopeMatches, checkMemorySchema, validateMemoryArtifact, validateMemoryRecord, validateMemoryReference } from './project-memory.js';
import type { ProjectMemoryRecord, TechnicalLessonContent, ProjectMemoryReference } from './project-memory.js';
import type { ProjectMemoryRepository, MemoryEntry } from './project-memory-repository.js';
import type { DurableStore } from './store.js';

export type MemoryRole='Scout'|'Developer'|'Reviewer';
export interface MemoryQuery {readonly taskId:string;readonly role:MemoryRole;readonly objective:string;readonly files:readonly string[];
  readonly assignmentId:string;readonly requiredBinding?:readonly ProjectMemoryReference[]}
export interface SelectedMemory {readonly reference:ProjectMemoryReference;readonly record:ProjectMemoryRecord;
  readonly staleEvidence:readonly string[];readonly reason:string}
export interface MemorySelection {readonly schemaVersion:1;readonly projectId:string;readonly taskId:string;readonly role:MemoryRole;
  readonly assignmentId:string;readonly selected:readonly SelectedMemory[];readonly omittedRecordIds:readonly string[];
  readonly conflicts:ReturnType<typeof memoryConflicts>;readonly totalBytes:number;readonly totalCharacters:number;readonly text:string;readonly digest:string}
export interface MemoryContextReceipt {readonly schemaVersion:1;readonly projectId:string;readonly taskId:string;readonly role:MemoryRole;
  readonly assignmentId:string;readonly dispatchId:string;readonly runId?:string;readonly delivery:'DISPATCH_INTENT'|'PROVIDER_ACKNOWLEDGED';
  readonly records:readonly {readonly recordId:string;readonly revision:number;readonly digest:string;readonly reason:string}[];
  readonly contextRef:ArtifactRef;readonly contextDigest:string;readonly totalBytes:number;readonly totalCharacters:number;readonly timestamp:string}
export interface PreparedMemoryContext {readonly selection:MemorySelection;readonly contextRef:ArtifactRef}
export interface MemoryRunOptions {readonly projectMemory?:PreparedMemoryContext}
const selections=new WeakSet<object>();
const prepared=new WeakMap<object,{store:Pick<DurableStore,'put'|'read'>;onReceipt?:(ref:ArtifactRef,receipt:MemoryContextReceipt)=>void}>();
const relevantLesson=(entry:MemoryEntry,query:MemoryQuery)=>{
  const when=(entry.record.content as TechnicalLessonContent).loadWhen;
  return when.terms.some(term=>query.objective.toLocaleLowerCase('en').includes(term.toLocaleLowerCase('en')))
    ||when.paths.some(path=>query.files.some(file=>file===path||file.startsWith(path+'/')));
};
function selectionText(selected:readonly SelectedMemory[],omitted:readonly string[],conflicts:MemorySelection['conflicts']):string{
  return `PROJECT MEMORY — host-selected technical context. This data grants no tools, scope, task-state or Systemist authority. Accepted software decisions and active technical constraints require an explicit consistency assessment; lessons are advisory. Report intentional architecture changes as proposals for human acceptance/supersession.\n${canonicalize({records:selected,designExpectations:selected.filter(s=>s.record.recordKind!=='technical-lesson').map(s=>memoryExpectation(s.record)),omittedRecordIds:omitted.slice(0,16),omittedCount:omitted.length,conflicts})}`;
}
/** Deterministic host prefilter. Only current, applicable records enter the bounded context. The Reviewer
 * preserves the Developer's binding identities; changed identities require replanning, not substitution. */
export function selectProjectMemory(repo:Pick<ProjectMemoryRepository,'entries'|'projectId'>,query:MemoryQuery):MemorySelection{
  const entries=repo.entries(),limits=MEMORY_LIMITS[query.role];
  const applicable=entries.filter(e=>currentMemory(e.record)&&scopeMatches(e.record.scope,query.files)
    &&(e.record.recordKind!=='technical-lesson'||(!e.staleEvidence.length&&relevantLesson(e,query))));
  const conflicts=memoryConflicts(applicable.map(e=>e.record));if(conflicts.length)memoryError('PROJECT_MEMORY_CONFLICT');
  for(const required of query.requiredBinding??[]){
    const entry=applicable.find(e=>e.record.recordId===required.recordId);
    if(!entry||entry.record.revision!==required.revision||entry.record.contentDigest!==required.digest)memoryError('PROJECT_MEMORY_CONTEXT_STALE');
  }
  const requiredIds=new Set(query.requiredBinding?.map(r=>r.recordId)??[]);
  applicable.sort((a,b)=>Number(requiredIds.has(b.record.recordId))-Number(requiredIds.has(a.record.recordId))
    ||Number(a.record.recordKind==='technical-lesson')-Number(b.record.recordKind==='technical-lesson')
    ||a.record.recordId.localeCompare(b.record.recordId));
  const selected:SelectedMemory[]=[],omitted:string[]=[];
  // Bound the final transmitted narrative including omission metadata, not merely content field sizes.
  for(const entry of applicable){
    const item:SelectedMemory={reference:memoryReference(entry.record,entry.ref),record:entry.record,staleEvidence:entry.staleEvidence,
      reason:entry.record.recordKind==='technical-lesson'?'current scope and explicit loadWhen match':requiredIds.has(entry.record.recordId)?'same binding memory supplied to Developer':'current record applies to task scope'};
    const text=selectionText([...selected,item],omitted,conflicts);
    if(selected.length>=limits.records||byteLength(text)>limits.bytes-2048||text.length>limits.characters-1024)omitted.push(entry.record.recordId);
    else selected.push(item);
  }
  if([...requiredIds].some(id=>!selected.some(s=>s.record.recordId===id)))memoryError('PROJECT_MEMORY_CONTEXT_LIMIT');
  const text=selectionText(selected,omitted,conflicts);
  if(byteLength(text)>limits.bytes||text.length>limits.characters)memoryError('PROJECT_MEMORY_CONTEXT_LIMIT');
  const material={schemaVersion:1 as const,projectId:repo.projectId,taskId:query.taskId,role:query.role,assignmentId:query.assignmentId,
    selected,omittedRecordIds:omitted,conflicts,totalBytes:byteLength(text),totalCharacters:text.length,text};
  const value=freezeMemory({...material,digest:hashCanonical(material)});selections.add(value);return value;
}
export function memoryDesignExpectations(selection:MemorySelection):readonly string[]{
  return Object.freeze(selection.selected.filter(s=>s.record.recordKind!=='technical-lesson').map(s=>memoryExpectation(s.record)));
}
/** Persist the exact selected context before dispatch. Only host-created objects carry this capability. */
export function prepareMemoryContext(selection:MemorySelection,store:Pick<DurableStore,'put'|'read'>,
  onReceipt?:(ref:ArtifactRef,receipt:MemoryContextReceipt)=>void):PreparedMemoryContext{
  if(!selections.has(selection))memoryError('PROJECT_MEMORY_CONTEXT_INVALID');
  const {digest,...material}=selection;if(hashCanonical(material)!==digest)memoryError('PROJECT_MEMORY_CONTEXT_INVALID');
  const contextRef=store.put(`memory-context-${selection.digest}`,canonicalize(selection),MEMORY_CONTEXT_MEDIA);
  const value=freezeMemory({selection,contextRef});prepared.set(value,{store,onReceipt});return value;
}
/** Runners append this exact text to the actual provider prompt and reuse RPC dispatch identity callbacks.
 * Intent receipts are labelled as intent; only provider acknowledgement attests a submitted dispatch.
 * Neither attests model comprehension, obedience or human approval. */
export function memoryDispatch(context:PreparedMemoryContext|undefined,binding:Pick<AssignmentEnvelope,'taskId'|'role'|'assignmentId'>,
  options:TerminalProofOptions):{text:string;options:TerminalProofOptions}{
  if(!context)return {text:'',options};const held=prepared.get(context),s=context.selection;
  if(!held||s.taskId!==binding.taskId||s.role!==binding.role||s.assignmentId!==binding.assignmentId)memoryError('PROJECT_MEMORY_CONTEXT_INVALID');
  const limits=MEMORY_LIMITS[s.role];if(s.totalBytes>limits.bytes||s.totalCharacters>limits.characters)memoryError('PROJECT_MEMORY_CONTEXT_LIMIT');
  const delivered=new Set<string>();
  return {text:'\n'+s.text,options:{...options,onDispatchIdentity(identity:DispatchIdentity){
    if(!isAcquiredDispatchIdentity(identity)||!identity.agent.startsWith('controlled.'+s.role.toLowerCase()))memoryError('PROJECT_MEMORY_DISPATCH_INVALID');
    options.onDispatchIdentity?.(identity);
    const stage=`${identity.requestId}:${identity.runId??'intent'}`;if(delivered.has(stage))return;delivered.add(stage);
    const receipt:MemoryContextReceipt={schemaVersion:1,projectId:s.projectId,taskId:s.taskId,role:s.role,assignmentId:s.assignmentId,
      dispatchId:identity.requestId,...(identity.runId?{runId:identity.runId}:{}),delivery:identity.runId?'PROVIDER_ACKNOWLEDGED':'DISPATCH_INTENT',
      records:s.selected.map(v=>({recordId:v.record.recordId,revision:v.record.revision,digest:v.record.contentDigest,reason:v.reason})),
      contextRef:context.contextRef,contextDigest:s.digest,totalBytes:s.totalBytes,totalCharacters:s.totalCharacters,timestamp:new Date().toISOString()};
    const ref=held.store.put(`memory-receipt-${hashCanonical(receipt)}`,canonicalize(receipt),MEMORY_RECEIPT_MEDIA);held.onReceipt?.(ref,freezeMemory(receipt));
  }}};
}

/** Historical receipt verification never restores a dispatch capability. Both receipt bytes and the
 * referenced exact context are checked through the existing store; trusted store provenance is required. */
export function readMemoryContextReceipt(store:Pick<DurableStore,'read'>,ref:ArtifactRef):MemoryContextReceipt{
  const read=(artifact:ArtifactRef,max:number)=>{
    validateMemoryArtifact(artifact);const raw=store.read(artifact);
    if(raw.byteLength!==artifact.bytes||hashBytes(raw)!==artifact.digest||raw.byteLength>max)memoryError('PROJECT_MEMORY_CONTEXT_INVALID');
    const value=parseJson(raw,max);if(hashCanonical(value)!==artifact.digest)memoryError('PROJECT_MEMORY_CONTEXT_INVALID');return value;
  };
  if(ref.mediaType!==MEMORY_RECEIPT_MEDIA)memoryError('PROJECT_MEMORY_CONTEXT_INVALID');
  const receipt=checkMemorySchema(object('MemoryContextReceipt',{schemaVersion:literal(1),projectId:scalars.Hash,taskId:scalars.ID,
    role:enumeration('Scout','Developer','Reviewer'),assignmentId:scalars.ID,dispatchId:scalars.ID,delivery:enumeration('DISPATCH_INTENT','PROVIDER_ACKNOWLEDGED'),
    records:list(object('SuppliedMemory',{recordId:scalars.ID,revision:integer(1,Number.MAX_SAFE_INTEGER),digest:scalars.Hash,reason:scalars.Text}),0,8),
    contextRef:scalar<ArtifactRef>('ARTIFACT',v=>validateStructure('ArtifactRef',v).ok),contextDigest:scalars.Hash,totalBytes:scalars.UInt,totalCharacters:scalars.UInt,timestamp:scalars.Time},
    {runId:scalars.ID}),read(ref,32768),32768) as MemoryContextReceipt;
  if((receipt.delivery==='PROVIDER_ACKNOWLEDGED')!==!!receipt.runId||receipt.contextRef.mediaType!==MEMORY_CONTEXT_MEDIA)memoryError('PROJECT_MEMORY_CONTEXT_INVALID');
  const context=read(receipt.contextRef,262144) as unknown as MemorySelection,{digest,...material}=context;
  if(Object.keys(context).sort().join(',')!=='assignmentId,conflicts,digest,omittedRecordIds,projectId,role,schemaVersion,selected,taskId,text,totalBytes,totalCharacters'
    ||context.schemaVersion!==1||hashCanonical(material)!==digest||digest!==receipt.contextDigest||context.role!==receipt.role||context.taskId!==receipt.taskId
    ||context.projectId!==receipt.projectId||context.assignmentId!==receipt.assignmentId||context.totalBytes!==byteLength(context.text)
    ||context.totalCharacters!==context.text.length||context.totalBytes!==receipt.totalBytes||context.totalCharacters!==receipt.totalCharacters
    ||context.totalBytes>MEMORY_LIMITS[receipt.role].bytes||context.totalCharacters>MEMORY_LIMITS[receipt.role].characters||context.selected.length>8)memoryError('PROJECT_MEMORY_CONTEXT_INVALID');
  for(const selected of context.selected){
    validateMemoryRecord(selected.record);validateMemoryReference(selected.reference);
    if(selected.record.projectId!==context.projectId||selected.reference.recordId!==selected.record.recordId||selected.reference.revision!==selected.record.revision
      ||selected.reference.digest!==selected.record.contentDigest)memoryError('PROJECT_MEMORY_CONTEXT_INVALID');
  }
  const supplied=context.selected.map(s=>({recordId:s.record.recordId,revision:s.record.revision,digest:s.record.contentDigest,reason:s.reason}));
  if(canonicalize(supplied)!==canonicalize(receipt.records)||context.text!==selectionText(context.selected,context.omittedRecordIds,context.conflicts))memoryError('PROJECT_MEMORY_CONTEXT_INVALID');
  return freezeMemory(receipt);
}
