import { runQuiescent, runQuiescenceProjection } from './run-quiescence.js';
import { canonicalize, hashBytes, parseJson, validateScalar, validateStructure } from './contracts.js';
import type { ArtifactRef, ContextRecord, HumanGate, WorkflowState, TransitionEvent } from './contracts.js';
import type { ProcessIncarnation } from './process-incarnation.js';
export const PRESENTATION_MEDIA='application/vnd.pi-controlled-dev.gate-presentation+json';
export const CHANNEL_V2_MEDIA='application/vnd.pi-controlled-dev.human-channel-v2+json';
export function isHumanConfirmationSource(source:unknown):source is 'ctx.ui.confirm'|'ctx.ui.custom'{
  return source==='ctx.ui.confirm'||source==='ctx.ui.custom';
}
export interface GatePresentation {readonly schemaVersion:1;readonly id:string;readonly gateId:string;readonly taskId:string;
  readonly presentationGeneration:number;readonly workflowRevision:number;readonly displayedDataHash:string;
  readonly hostProcessIncarnation:ProcessIncarnation&{readonly schemaVersion:1};readonly hostSessionId:string;readonly presentedAt:string;
  readonly recoveryAuthorityRef?:ArtifactRef;readonly previousPresentationRef?:ArtifactRef}
interface Reader {read(ref:ArtifactRef):Uint8Array}
const equal=(a:unknown,b:unknown)=>canonicalize(a)===canonicalize(b);
function fail():never{throw new Error('GATE_PRESENTATION_INVALID')}
function closed(value:any,required:string[],optional:string[]=[]):void{
  if(!value||typeof value!=='object'||Array.isArray(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>![...required,...optional].includes(k)))fail();
}
function incarnation(value:any):void{
  closed(value,['schemaVersion','platform','bootId','pidNamespace','pid','startTicks']);
  if(value.schemaVersion!==1||value.platform!=='linux'||!Number.isSafeInteger(value.pid)||value.pid<=0||
    !/^[a-f0-9-]{36}$/.test(value.bootId)||!/^pid:\[\d+\]$/.test(value.pidNamespace)||!/^\d+$/.test(value.startTicks))fail();
}
export function checkGatePresentation(value:unknown):GatePresentation{
  const p=value as GatePresentation;
  closed(p,['schemaVersion','id','gateId','taskId','presentationGeneration','workflowRevision','displayedDataHash','hostProcessIncarnation','hostSessionId','presentedAt'],['recoveryAuthorityRef','previousPresentationRef']);
  if(p.schemaVersion!==1||!Number.isSafeInteger(p.presentationGeneration)||p.presentationGeneration<1||!validateScalar('UInt',p.workflowRevision).ok)fail();
  for(const key of ['id','gateId','taskId'] as const)if(!validateScalar('ID',p[key]).ok)fail();
  if(!validateScalar('Hash',p.displayedDataHash).ok||!validateScalar('Text',p.hostSessionId).ok||!validateScalar('Time',p.presentedAt).ok)fail();
  incarnation(p.hostProcessIncarnation);
  for(const ref of [p.recoveryAuthorityRef,p.previousPresentationRef])if(ref&&!validateStructure('ArtifactRef',ref).ok)fail();
  if(p.presentationGeneration>1&&(!p.previousPresentationRef||!p.recoveryAuthorityRef))fail();
  if(p.presentationGeneration===1&&p.previousPresentationRef)fail();return p;
}
function read(reader:Reader,ref:ArtifactRef):any{
  if(!validateStructure('ArtifactRef',ref).ok||ref.relativeStorePath!==`artifacts/${ref.id}`||ref.bytes>1024*1024)fail();
  const raw=reader.read(ref);if(raw.byteLength!==ref.bytes||hashBytes(raw)!==ref.digest)fail();return parseJson(raw,1024*1024);
}
/** Data verification, not minting runtime authority. Every authoritative presentation must be committed. */
export function gatePresentations(gate:HumanGate,records:readonly ContextRecord[],events:readonly TransitionEvent[],reader:Reader):readonly {ref:ArtifactRef;value:GatePresentation}[]{
  const result=records.filter(r=>r.kind==='ArtifactRef'&&r.value.mediaType===PRESENTATION_MEDIA).map(r=>{
    const ref=r.value as ArtifactRef;if(ref.bytes>65536)fail();return {ref,value:checkGatePresentation(read(reader,ref))};
  }).filter(r=>r.value.gateId===gate.id).sort((a,b)=>a.value.presentationGeneration-b.value.presentationGeneration);
  const states=new Map(records.filter(r=>r.kind==='WorkflowState').map(r=>[r.value.revision,r.value as WorkflowState]));
  for(const [index,item] of result.entries()){
    const p=item.value,prior=result[index-1],event=events.find(e=>e.revision===p.workflowRevision),state=states.get(p.workflowRevision);
    if(item.ref.id!==p.id||p.taskId!==gate.taskId||p.displayedDataHash!==gate.approvedDataHash||p.presentationGeneration!==index+1||
      !event?.evidenceRefs.includes(p.id)||!state||state.state!=='AWAITING_HUMAN'||state.pendingGateId!==gate.id||state.specHash!==gate.specHash||
      state.candidate?.digest!==gate.candidateDigest||state.candidate?.generation!==gate.candidateGeneration||state.ownerSessionId!==p.hostSessionId)fail();
    if(records.some(r=>r.kind==='HumanDecisionEvidence'&&r.value.gateId===gate.id&&r.value.displayedRevision<p.workflowRevision))fail();
    if(prior&&(!equal(p.previousPresentationRef,prior.ref)||p.workflowRevision<=prior.value.workflowRevision))fail();
    if(!p.recoveryAuthorityRef){if(index!==0||p.workflowRevision!==gate.stateRevision||event.kind!=='TRANSITION')fail()}
    else{
      if(event.kind!=='RECORD'||event.recordType!=='RECONCILED'||p.recoveryAuthorityRef.mediaType!=='application/vnd.pi-controlled-dev.takeover+json')fail();
      const takeover=read(reader,p.recoveryAuthorityRef),reclaim=read(reader,takeover.reclaimRef);
      closed(takeover,['schemaVersion','id','taskId','recoveryRecordId','classification','takeoverToken','previousOwnerSessionId','previousProcessIncarnation','processIncarnation','sessionId','acquiredAt','reason','revision','eventHash','reclaimRef','taskLock','workspaceLock']);
      if(takeover.id!==p.recoveryAuthorityRef.id||takeover.classification!=='STALE_LOCK_PROVABLE'||!validateScalar('Text',takeover.reason).ok||!validateScalar('Time',takeover.acquiredAt).ok||
        takeover.taskLock.kind!=='TASK'||takeover.workspaceLock.kind!=='WORKSPACE'||takeover.taskLock.taskId!==gate.taskId||
        takeover.taskLock.workspaceHash!==takeover.workspaceLock.workspaceHash||takeover.taskLock.ownerSessionId!==p.hostSessionId||takeover.workspaceLock.ownerSessionId!==p.hostSessionId||
        !equal(takeover.taskLock.processIncarnation,takeover.processIncarnation)||!equal(takeover.workspaceLock.processIncarnation,takeover.processIncarnation)||
        equal(takeover.previousProcessIncarnation,takeover.processIncarnation))fail();
      if(takeover.schemaVersion!==1||takeover.taskId!==gate.taskId||takeover.sessionId!==p.hostSessionId||
        !equal({schemaVersion:1,...takeover.processIncarnation},p.hostProcessIncarnation)||takeover.revision>=p.workflowRevision||
        !events.some(e=>e.revision===takeover.revision&&e.eventHash===takeover.eventHash)||
        reclaim.taskId!==gate.taskId||reclaim.eventHash!==takeover.eventHash||reclaim.revision!==takeover.revision||
        reclaim.id!==takeover.recoveryRecordId||reclaim.classification!=='STALE_LOCK_PROVABLE'||reclaim.authorization!=='RECLAIM_LOCK_PAIR_ONLY'||
        reclaim.oldOwners?.length!==2||reclaim.oldOwners.some((o:any)=>o.deathProof?.status!=='DEAD'||!equal(o.record.processIncarnation,takeover.previousProcessIncarnation)||
          o.record.ownerSessionId!==takeover.previousOwnerSessionId||o.record.workspaceHash!==takeover.taskLock.workspaceHash||
          [takeover.taskLock.token,takeover.workspaceLock.token].includes(o.record.token))||
        (prior&&!equal(prior.value.hostProcessIncarnation,{schemaVersion:1,...takeover.previousProcessIncarnation})))fail();
      const oldState=states.get(takeover.revision);
      if(!oldState||oldState.ownerSessionId!==takeover.previousOwnerSessionId||oldState.runs.some(r=>!runQuiescent(r))||
        !equal(reclaim.quiescenceProof,oldState.runs.map(runQuiescenceProjection))||
        !equal(oldState.counters,state.counters)||!equal(oldState.candidate??null,state.candidate??null)||oldState.specHash!==state.specHash)fail();
      const authEvent=events.find(e=>e.revision===takeover.revision+1),authState=states.get(takeover.revision+1);
      if(authEvent?.kind!=='RECORD'||authEvent.recordType!=='RECONCILED'||!authEvent.evidenceRefs.includes(p.recoveryAuthorityRef.id)||!authState||
        !equal(authState,{...oldState,ownerSessionId:p.hostSessionId,revision:authState.revision,lastEventId:authState.lastEventId,updatedAt:authState.updatedAt})||
        !equal(state,{...authState,revision:state.revision,lastEventId:state.lastEventId,updatedAt:state.updatedAt}))fail();
    }
  }
  return result;
}
export function checkPresentationChannel(channel:any,gate:HumanGate,records:readonly ContextRecord[],events:readonly TransitionEvent[],reader:Reader):GatePresentation{
  closed(channel,['schemaVersion','channel','source','sessionId','actorIdentity','providerConfirmationId','confirmationId','confirmedAt','gateId','taskId','displayedRevision','displayedDataHash','decision','presentationRef'],['answerHash']);
  if(channel.schemaVersion!==2||channel.channel!=='TUI'||!isHumanConfirmationSource(channel.source))fail();
  const p=gatePresentations(gate,records,events,reader).at(-1);
  if(!p||!equal(p.ref,channel.presentationRef)||channel.sessionId!==p.value.hostSessionId||channel.gateId!==gate.id||channel.taskId!==gate.taskId||
    channel.displayedRevision!==p.value.workflowRevision||channel.displayedDataHash!==p.value.displayedDataHash)fail();return p.value;
}
