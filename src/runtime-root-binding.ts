import { Buffer } from 'node:buffer';
import { canonicalize, hashBytes, hashCanonical, parseJson } from './contract-json.js';
import type { ArtifactRef, ContextRecord, TransitionEvent, WorkflowState } from './contracts.js';
import type { BoundedDeveloperCheckpointDescriptor } from './bounded-developer-checkpoint.js';
import { verifyTerminalProof } from './pi-subagents-rpc.js';
import { verifyTranscriptBytes } from './controlled-agent-runtime.js';

export const RUNTIME_ROOT_BINDING_MEDIA='application/vnd.pi-controlled-dev.runtime-root-binding+json';
interface RuntimeRootBindingPayloadBase {
 readonly projectId:string;readonly taskId:string;readonly specHash:string;
 readonly sourceRevision:number;readonly sourceEventHash:string;readonly sourceStateDigest:string;
 readonly projectOriginalRepoRoot:string;readonly historicalRepoRoot:string;readonly previousRepoRoot:string;readonly repoRoot:string;
 readonly previousCandidateRoot:string|null;readonly candidateRoot:string|null;
 readonly candidateDigest:string|null;readonly candidateGeneration:number|null;
 readonly sourceHead:string;readonly sourceTree:string;readonly sourceInventoryDigest:string;readonly humanDigest:string;readonly handoffDigest:string;
 readonly resumeState:WorkflowState['state'];
}
export interface RuntimeBoundedBaseline {
 readonly descriptor:BoundedDeveloperCheckpointDescriptor;readonly descriptorRelativePath:string;
 readonly transcriptRelativePath:string;readonly workRoot:string;
}
export type RuntimeRootBindingPayload=RuntimeRootBindingPayloadBase & (
 {readonly schemaVersion:1;readonly boundedBaseline?:never} |
 {readonly schemaVersion:2;readonly boundedBaseline:RuntimeBoundedBaseline}
);
export interface RuntimeRootBinding {
 readonly schemaVersion:1;readonly id:string;readonly payload:RuntimeRootBindingPayload;
 readonly confirmationRef:ArtifactRef;readonly handoffRef:ArtifactRef;
 readonly boundedBaselineRef?:ArtifactRef;readonly boundedTranscriptRef?:ArtifactRef;
}
export interface RuntimeRootMapping {readonly refId:string;readonly payload:RuntimeRootBindingPayload}
const mappings=new WeakSet<object>();
function fail():never{throw new Error('PROJECT_RUNTIME_BINDING_INVALID')}
function closed(v:unknown,keys:readonly string[]):asserts v is Record<string,unknown>{
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==[...keys].sort().join(','))fail();
}
const same=(a:unknown,b:unknown)=>canonicalize(a)===canonicalize(b);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const root=(v:unknown)=>typeof v==='string'&&v.startsWith('/')&&!/[\x00-\x1f\x7f]/.test(v)&&!v.split('/').some(p=>p==='.'||p==='..')&&v!=='/'&&!v.endsWith('/');
/** Data checks only. This never grants a lock, a writer permission or import authority. */
export function checkRuntimeRootBindingPayload(input:unknown):RuntimeRootBindingPayload{
 const version=(input as {schemaVersion?:unknown}|null)?.schemaVersion;
 closed(input,['schemaVersion','projectId','taskId','specHash','sourceRevision','sourceEventHash','sourceStateDigest','projectOriginalRepoRoot','historicalRepoRoot','previousRepoRoot','repoRoot','previousCandidateRoot','candidateRoot','candidateDigest','candidateGeneration','sourceHead','sourceTree','sourceInventoryDigest','humanDigest','handoffDigest','resumeState',...(version===2?['boundedBaseline']:[])]);
 const p=input as unknown as RuntimeRootBindingPayload;
 if(![1,2].includes(p.schemaVersion)||!hash(p.projectId)||!hash(p.specHash)||!hash(p.sourceEventHash)||!hash(p.sourceStateDigest)||!hash(p.handoffDigest)||!hash(p.sourceInventoryDigest)||!hash(p.humanDigest)
  ||typeof p.taskId!=='string'||!/^[-a-zA-Z0-9_.:]{1,128}$/.test(p.taskId)||!Number.isSafeInteger(p.sourceRevision)||p.sourceRevision<0
  ||![p.projectOriginalRepoRoot,p.historicalRepoRoot,p.previousRepoRoot,p.repoRoot].every(root)
  ||![p.sourceHead,p.sourceTree].every(x=>/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(x))
  ||!['PENDING','ANALYZING','READY','TESTING','REVIEWING','REWORK','BLOCKED'].includes(p.resumeState))fail();
 if(p.candidateRoot===null){if(p.previousCandidateRoot!==null||p.candidateDigest!==null||p.candidateGeneration!==null)fail()}
 else if(!root(p.candidateRoot)||!root(p.previousCandidateRoot)||p.candidateRoot===p.repoRoot||!hash(p.candidateDigest)
  ||!Number.isSafeInteger(p.candidateGeneration)||p.candidateGeneration!<1)fail();
 if(p.schemaVersion===2){
  closed(p.boundedBaseline,['descriptor','descriptorRelativePath','transcriptRelativePath','workRoot']);
  const baseline=p.boundedBaseline,d=checkBoundedDescriptor(baseline.descriptor);
  const prefix=`candidates/${p.taskId}/bounded-baselines/${p.sourceStateDigest}/`;
  if(p.candidateRoot!==null||!['BLOCKED','READY'].includes(p.resumeState)||!root(baseline.workRoot)
   ||[p.repoRoot,p.previousRepoRoot,p.historicalRepoRoot].some(r=>baseline.workRoot===r||baseline.workRoot.startsWith(r+'/'))
   ||baseline.descriptorRelativePath!==prefix+'descriptor.json'||baseline.transcriptRelativePath!==prefix+'transcript.jsonl'
   ||d.projectId!==p.projectId||d.taskId!==p.taskId||d.specHash!==p.specHash||d.stateRevision!==p.sourceRevision
   ||d.stateDigest!==p.sourceStateDigest||d.eventHash!==p.sourceEventHash||d.originalRepoRoot!==p.previousRepoRoot
   ||d.baselineCommit!==p.sourceHead||d.baselineTree!==p.sourceTree)fail();
 }
 return p;
}
/** The store verifies exact artifact bytes and the event chain first. Only that
 * reader can supply this process-local projection; a JSON copy is not a mapping. */
export function verifiedRuntimeRootMappings(records:readonly ContextRecord[],events:readonly TransitionEvent[],reader:{read(ref:ArtifactRef):Uint8Array}):readonly RuntimeRootMapping[]{
 const result:RuntimeRootMapping[]=[];
 // Handoff manifests describe every host-owned namespace entry. Their existing
 // host file ceiling is 64 MiB; small binding and confirmation documents retain
 // their independent 1 MiB ceiling.
 const raw=(ref:ArtifactRef,maxBytes=1024*1024)=>{const bytes=reader.read(ref);if(bytes.byteLength!==ref.bytes||hashBytes(bytes)!==ref.digest)fail();return parseJson(bytes,maxBytes)};
 const bindings=records.filter((record):record is ContextRecord & {kind:'ArtifactRef'}=>record.kind==='ArtifactRef'&&record.value.mediaType===RUNTIME_ROOT_BINDING_MEDIA)
  .map(record=>{const b=raw(record.value) as unknown as RuntimeRootBinding;return {record,b,p:checkRuntimeRootBindingPayload(b.payload)}})
  .sort((a,b)=>a.p.sourceRevision-b.p.sourceRevision);
 for(const {record,b,p} of bindings){
  closed(b,['schemaVersion','id','payload','confirmationRef','handoffRef',...(p.schemaVersion===2?['boundedBaselineRef','boundedTranscriptRef']:[])]);
  if(b.schemaVersion!==1||b.id!==record.id)fail();
  const bindingRefs=[b.confirmationRef,b.handoffRef,...(p.schemaVersion===2?[b.boundedBaselineRef!,b.boundedTranscriptRef!]:[])];
  for(const ref of bindingRefs)if(!records.some(r=>r.kind==='ArtifactRef'&&r.id===ref.id&&same(r.value,ref)))fail();
  const evidence=raw(b.confirmationRef) as any;closed(evidence,['schemaVersion','request','receipt']);
  const q=evidence.request as any,r=evidence.receipt as any;
  if(evidence.schemaVersion!==1||!q||!r||q.schemaVersion!==1||r.schemaVersion!==1||q.purpose!=='project-runtime-import'
   ||q.subjectKind!=='project-runtime-binding'||q.subjectId!==p.taskId||q.subjectRevision!==p.sourceRevision||q.action!=='APPROVE'
   ||!same(q.payload,p)||q.payloadDigest!==hashCanonical(p)||r.decision!=='APPROVE'||r.action!=='APPROVE'
   ||r.requestDigest!==hashCanonical(q)||r.payloadDigest!==q.payloadDigest||r.presentationDigest!==hashCanonical(q.presentation)
   ||['purpose','subjectKind','subjectId','subjectRevision','confirmationId'].some(k=>r[k]!==q[k])
   ||!['ctx.ui.confirm','ctx.ui.custom'].includes(r.confirmationInstance?.source)||typeof r.confirmationInstance?.sessionId!=='string')fail();
  const seal=raw(b.handoffRef,64*1024*1024) as any;
  if(b.handoffRef.digest!==p.handoffDigest||seal.schemaVersion!==1||seal.projectId!==p.projectId||seal.originalRepoRoot!==p.projectOriginalRepoRoot
   ||seal.sourceHead!==p.sourceHead||seal.sourceTree!==p.sourceTree||seal.ownerDisposition!=='RELEASED_FOR_TRANSFER'
   ||!Array.isArray(seal.taskHeads)||!seal.taskHeads.some((h:any)=>h.taskId===p.taskId&&h.specHash===p.specHash
    &&h.stateRevision===p.sourceRevision&&h.stateDigest===p.sourceStateDigest&&h.eventHash===p.sourceEventHash))fail();
  const previous=records.find(x=>x.kind==='WorkflowState'&&x.value.taskId===p.taskId&&x.value.revision===p.sourceRevision);
  const source=events.find(e=>e.taskId===p.taskId&&e.revision===p.sourceRevision&&e.eventHash===p.sourceEventHash);
  const event=events.find(e=>e.taskId===p.taskId&&e.revision===p.sourceRevision+1&&e.kind==='RECORD'&&e.recordType==='RECONCILED'
   &&e.previousEventHash===p.sourceEventHash&&[b.id,...bindingRefs.map(r=>r.id)].every(id=>e.evidenceRefs.includes(id)));
  if(previous?.kind!=='WorkflowState'||!source||!event||hashCanonical(previous.value)!==p.sourceStateDigest
   ||previous.value.repoRoot!==p.previousRepoRoot||previous.value.specHash!==p.specHash
   ||!records.some(x=>x.kind==='TaskSpec'&&x.id===previous.value.spec.id&&x.value.specHash===p.specHash&&x.value.scope.repoRoot===p.historicalRepoRoot)
   ||previous.value.runs.some(run=>!['TERMINAL','NOT_DISPATCHED'].includes(run.status)))fail();
  const prior=previous.value.candidate;
  if((prior?.root??null)!==p.previousCandidateRoot||(prior?.digest??null)!==p.candidateDigest||(prior?.generation??null)!==p.candidateGeneration)fail();
  if(p.resumeState!==runtimeRebindResumeState(previous.value,records))fail();
  if(p.schemaVersion===2)verifyBoundedBaseline(b,p,seal,previous.value,records,events,reader,result);
  const next=records.find(x=>x.kind==='WorkflowState'&&x.value.taskId===p.taskId&&x.value.revision===p.sourceRevision+1);
  if(next?.kind!=='WorkflowState'||next.value.runtimeBindingRef?.id!==record.id||next.value.repoRoot!==p.repoRoot||next.value.state!==p.resumeState
    ||next.value.ownerSessionId!==r.confirmationInstance.sessionId||next.value.pendingGateId!==undefined
    ||!same(next.value.counters,previous.value.counters)||!same(next.value.runs,previous.value.runs)
    ||!same(next.value.spec,previous.value.spec)||next.value.baselineCommit!==previous.value.baselineCommit
    ||!same(next.value.candidate??null,prior?{...prior,root:p.candidateRoot}:null)
    ||[...previous.value.gates,...previous.value.validations,...previous.value.reviews].some(id=>!next.value.invalidEvidenceIds.includes(id)))fail();
  const mapping=Object.freeze({refId:record.id,payload:immutablePayload(p)});mappings.add(mapping);result.push(mapping);
 }
 return Object.freeze(result);
}
export function runtimeRebindResumeState(state:WorkflowState,records:readonly ContextRecord[]):WorkflowState['state']{
 if(state.state==='AWAITING_HUMAN'){
  const gate=records.find(r=>r.kind==='HumanGate'&&r.id===state.pendingGateId);
  if(gate?.kind!=='HumanGate')fail();
  return gate.value.resumeState==='IMPLEMENTING'?'READY':gate.value.resumeState==='REVIEWING'?'TESTING':gate.value.resumeState;
 }
 if(state.state==='REVIEWING')return 'TESTING';
 if(state.state==='IMPLEMENTING'){
  const developer=state.runs.findLast(run=>run.role==='Developer'&&run.status==='TERMINAL'&&run.resultRef);
  const result=records.find(r=>r.kind==='DeveloperResult'&&r.id===developer?.resultRef);
  if(!state.candidate||result?.kind!=='DeveloperResult'||result.value.blockedReason)fail();return 'TESTING';
 }
 if(['COMPLETED','FAILED'].includes(state.state))fail();
 return state.state;
}
export function runtimeRootMappingFor(state:WorkflowState,available:readonly RuntimeRootMapping[]|undefined):RuntimeRootMapping|undefined{
 if(!state.runtimeBindingRef)return undefined;
 const m=available?.find(m=>mappings.has(m)&&m.refId===state.runtimeBindingRef?.id&&m.payload.taskId===state.taskId&&m.payload.specHash===state.specHash&&m.payload.repoRoot===state.repoRoot);
 if(!m)fail();return m;
}
export function runtimeRootMatches(historical:string,physical:string,state:WorkflowState|undefined,available:readonly RuntimeRootMapping[]|undefined):boolean{
 if(historical===physical)return true;if(!state)return false;
 try{const m=runtimeRootMappingFor(state,available);return !!m&&m.payload.historicalRepoRoot===historical&&m.payload.repoRoot===physical}catch{return false}
}

/** Descriptor data remain historical evidence, never a reused writer permission. */
function checkBoundedDescriptor(input:unknown):BoundedDeveloperCheckpointDescriptor{
 closed(input,['schemaVersion','kind','projectId','taskId','specHash','stateRevision','stateDigest','eventHash','assignmentId','assignmentHash','resultRef','terminalProofRef','originalRepoRoot','originalWorkRoot','originalTranscriptPath','baselineCommit','baselineTree','manifestDigest','manifestBytes','transcriptDigest','transcriptBytes','previousApprovalId','previousApprovalHash','sourceCanaryDigest']);
 const d=input as unknown as BoundedDeveloperCheckpointDescriptor;
 if(d.schemaVersion!==1||d.kind!=='BOUNDED_DEVELOPER_BASELINE'
  ||![d.projectId,d.specHash,d.stateDigest,d.eventHash,d.assignmentHash,d.manifestDigest,d.transcriptDigest,d.previousApprovalHash,d.sourceCanaryDigest].every(hash)
  ||![d.taskId,d.assignmentId,d.previousApprovalId].every(v=>typeof v==='string'&&/^[-a-zA-Z0-9_.:]{1,128}$/.test(v))
  ||![d.originalRepoRoot,d.originalWorkRoot,d.originalTranscriptPath].every(root)||d.originalWorkRoot===d.originalRepoRoot
  ||![d.baselineCommit,d.baselineTree].every(v=>typeof v==='string'&&/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(v))
  ||!Number.isSafeInteger(d.stateRevision)||d.stateRevision<0
  ||!Number.isSafeInteger(d.manifestBytes)||d.manifestBytes<0||d.manifestBytes>64*1024*1024
  ||!Number.isSafeInteger(d.transcriptBytes)||d.transcriptBytes<0||d.transcriptBytes>16*1024*1024)fail();
 for(const ref of [d.resultRef,d.terminalProofRef]){
  closed(ref,['schemaVersion','id','digest','relativeStorePath','bytes','mediaType']);
  if(ref.schemaVersion!==1||typeof ref.id!=='string'||!/^[-a-zA-Z0-9_.:]{1,128}$/.test(ref.id)||ref.relativeStorePath!==`artifacts/${ref.id}`
   ||!hash(ref.digest)||!Number.isSafeInteger(ref.bytes)||ref.bytes<0||typeof ref.mediaType!=='string'||!ref.mediaType)fail();
 }return d;
}
function immutablePayload(p:RuntimeRootBindingPayload):RuntimeRootBindingPayload{
 const copy=JSON.parse(canonicalize(p));
 const freeze=(v:any):any=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v)}return v};
 return freeze(copy);
}
function verifyBoundedBaseline(b:RuntimeRootBinding,p:RuntimeRootBindingPayload & {schemaVersion:2},seal:any,previous:WorkflowState,records:readonly ContextRecord[],events:readonly TransitionEvent[],reader:{read(ref:ArtifactRef):Uint8Array},priorMappings:readonly RuntimeRootMapping[]):void{
 const baseline=p.boundedBaseline,d=baseline.descriptor,descriptorRef=b.boundedBaselineRef!,transcriptRef=b.boundedTranscriptRef!;
 const bytes=(ref:ArtifactRef,max:number)=>{const raw=reader.read(ref);if(raw.byteLength!==ref.bytes||raw.byteLength>max||hashBytes(raw)!==ref.digest)fail();return raw};
 const descriptorRaw=bytes(descriptorRef,32768),transcriptRaw=bytes(transcriptRef,16*1024*1024);
 if(descriptorRef.digest!==hashCanonical(d)||!same(parseJson(descriptorRaw,32768),d)
  ||transcriptRef.digest!==d.transcriptDigest||transcriptRef.bytes!==d.transcriptBytes||hashBytes(transcriptRaw)!==d.transcriptDigest
  ||!Array.isArray(seal.namespaceManifest))fail();
 try{verifyTranscriptBytes(transcriptRaw,d.originalWorkRoot,'controlled.developer',['read','edit','write','structured_output'],['read','structured_output'])}catch{fail()}
 const prefix=baseline.descriptorRelativePath.slice(0,-'descriptor.json'.length);
 for(const [path,digest,size] of [[baseline.descriptorRelativePath,descriptorRef.digest,descriptorRef.bytes],[prefix+'manifest.json',d.manifestDigest,d.manifestBytes],[baseline.transcriptRelativePath,d.transcriptDigest,d.transcriptBytes]] as const){
  const rows=seal.namespaceManifest.filter((f:any)=>f.path===`.controlled-dev/${path}`);if(rows.length!==1||rows[0].digest!==digest||rows[0].bytes!==size)fail();
 }
 const priorMapping=previous.runtimeBindingRef?runtimeRootMappingFor(previous,priorMappings):undefined;
 const get=(id:string,historicalGate=false)=>{const r=records.find(r=>r.id===id);if(!r||previous.invalidEvidenceIds.includes(id)&&(!historicalGate||!priorMapping))fail();return r};
 const exactRef=(ref:ArtifactRef)=>{const r=get(ref.id),encoded=canonicalize(r.value);
  const actual:ArtifactRef=r.kind==='ArtifactRef'?r.value:{schemaVersion:1,id:r.id,digest:hashCanonical(r.value),bytes:Buffer.byteLength(encoded,'utf8'),relativeStorePath:`artifacts/${r.id}`,mediaType:'application/json'};
  if(!same(actual,ref))fail();return r;};
 const run=previous.runs.at(-1),a=get(d.assignmentId),result=exactRef(d.resultRef);
 if(!['BLOCKED','AWAITING_HUMAN','READY'].includes(previous.state)||previous.blockedReason!=='Developer reported a bounded blocker'||previous.candidate||previous.baselineCommit!==d.baselineCommit
  ||!run||run.role!=='Developer'||run.status!=='TERMINAL'||run.assignmentId!==d.assignmentId||run.resultRef!==d.resultRef.id
  ||run.terminalProofRef!==d.terminalProofRef.id||run.childSessionId!==d.originalTranscriptPath||!previous.results.includes(d.resultRef.id)
  ||a.kind!=='AssignmentEnvelope'||result.kind!=='DeveloperResult')fail();
 const assignment=a.value,r=result.value;
 if(assignment.assignmentHash!==d.assignmentHash||hashCanonical(Object.fromEntries(Object.entries(assignment).filter(([key])=>key!=='assignmentHash')))!==d.assignmentHash
  ||assignment.role!=='Developer'||assignment.taskId!==p.taskId||assignment.specHash!==p.specHash||!runtimeRootMatches(assignment.repoRoot,d.originalRepoRoot,previous,priorMappings)
  ||assignment.workRoot!==d.originalWorkRoot||assignment.baseCommit!==d.baselineCommit||assignment.attemptId!==run.attemptId
  ||assignment.candidateDigest!==undefined||assignment.candidateGeneration!==undefined||!same(assignment.authority,['OP-01','OP-02'])
  ||r.taskId!==p.taskId||r.specHash!==p.specHash||r.assignmentId!==d.assignmentId||r.assignmentHash!==d.assignmentHash||r.attemptId!==run.attemptId
  ||typeof r.blockedReason!=='string'||!r.blockedReason||r.changedFiles.length||r.commandsRun.length)fail();
 for(const prior of previous.runs){
  if(prior.status!=='TERMINAL'||!prior.runId||!prior.childSessionId||!prior.terminalProofRef||prior.requestId.startsWith('intent-'))fail();
  const proof=get(prior.terminalProofRef);if(proof.kind!=='ArtifactRef')fail();const raw=bytes(proof.value,1024*1024),terminal=parseJson(raw,1024*1024);
  if(!verifyTerminalProof(terminal,{runId:prior.runId,requestId:prior.requestId,role:prior.role,ownerSessionId:prior.ownerSessionId,childSessionId:prior.childSessionId})
   ||prior===run&&(terminal as {terminalStatus:string}).terminalStatus!=='complete')fail();
 }exactRef(d.terminalProofRef);
 const block=events.findLast(e=>e.taskId===p.taskId&&e.revision<=p.sourceRevision&&e.transitionId==='TR-015'&&e.reason==='Developer reported a bounded blocker');
 if(!block||block.sourceState!=='IMPLEMENTING'||block.targetState!=='BLOCKED'
  ||events.some(e=>e.taskId===p.taskId&&e.revision>block.revision&&e.revision<=p.sourceRevision&&e.recordType==='SPAWN_INTENT'))fail();
 const gate=get(d.previousApprovalId,true);if(gate.kind!=='HumanGate'||gate.value.type!=='beforeImplementation'||gate.value.status!=='CONSUMED'
  ||gate.value.specHash!==p.specHash||gate.value.approvedDataHash!==d.previousApprovalHash||!gate.value.consumedEventId
  ||!events.some(e=>e.id===gate.value.consumedEventId&&e.taskId===p.taskId&&e.revision<block.revision))fail();
 const approved=gate.value.approvedData;const canary=parseJson(bytes(approved,1024*1024),1024*1024) as any;
 if(approved.digest!==d.previousApprovalHash||canary.specHash!==p.specHash||canary.baselineCommit!==d.baselineCommit||canary.originalTreeHash!==d.sourceCanaryDigest)fail();
}
