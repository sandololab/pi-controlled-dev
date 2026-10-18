import { scoutClarificationCoverage } from './scout-clarifications.js';
import { runQuiescent, runProofRef, verifyReviewerNoDispatchProof } from './run-quiescence.js';
import { readPolicyAuthorization, POLICY_AUTHORIZATION_MEDIA } from './policy-authorization.js';
import { Buffer } from 'node:buffer';
import { canonicalize, hashBytes, hashCanonical, parseJson, validateContract, validateStructure } from './contracts.js';
import type { ArtifactRef, CandidateManifest, ContextRecord, DeveloperResult, HumanGate, HumanDecisionEvidence, ReviewResult, TaskSpec, TransitionEvent, ValidationResult, WorkflowState } from './contracts.js';
import { verifyTerminalProof } from './pi-subagents-rpc.js';
import { verifyValidationProcessProof } from './validation-runner.js';
import { CHANNEL_V2_MEDIA, checkPresentationChannel, isHumanConfirmationSource } from './gate-presentation.js';

export interface CompletionPackage {
  readonly schemaVersion:1;readonly taskId:string;readonly specHash:string;readonly specRef:ArtifactRef;readonly baselineCommit:string;
  readonly candidateDigest:string;readonly candidateGeneration:number;readonly manifestRef:ArtifactRef;readonly patchRef:ArtifactRef;
  readonly handoffRef:ArtifactRef;readonly candidateTerminalProofRef:ArtifactRef;readonly developerResultRef:ArtifactRef;
  readonly validationResultIds:readonly string[];readonly validationResultRefs:readonly ArtifactRef[];readonly validationArtifactRefs:readonly ArtifactRef[];
  readonly reviewId:string;readonly reviewRef:ArtifactRef;readonly reviewerTerminalProofRef:ArtifactRef;
  readonly gateIds:readonly string[];readonly gateRefs:readonly ArtifactRef[];readonly decisionIds:readonly string[];readonly decisionRefs:readonly ArtifactRef[];
  readonly completionEvidenceRefs:readonly ArtifactRef[];readonly packageHash:string;
}
export interface EvidenceReader {read(ref:ArtifactRef):Uint8Array}
const keys=['schemaVersion','taskId','specHash','specRef','baselineCommit','candidateDigest','candidateGeneration','manifestRef','patchRef','handoffRef',
  'candidateTerminalProofRef','developerResultRef','validationResultIds','validationResultRefs','validationArtifactRefs','reviewId','reviewRef',
  'reviewerTerminalProofRef','gateIds','gateRefs','decisionIds','decisionRefs','completionEvidenceRefs','packageHash'].sort().join(',');
function fail(code:string):never{throw new Error(code)}
function same(a:unknown,b:unknown):boolean{return canonicalize(a)===canonicalize(b)}
function refFor(id:string,records:readonly ContextRecord[]):ArtifactRef{
  const record=records.find(r=>r.id===id);if(!record)fail('COMPLETION_EVIDENCE_MISSING');
  if(record.kind==='ArtifactRef')return record.value;
  const content=canonicalize(record.value);return {schemaVersion:1,id,digest:hashCanonical(record.value),bytes:Buffer.byteLength(content,'utf8'),
    relativeStorePath:`artifacts/${id}`,mediaType:'application/json'};
}
function readJson(reader:EvidenceReader,ref:ArtifactRef):any{
  if(!validateStructure('ArtifactRef',ref).ok)fail('COMPLETION_ARTIFACT_INVALID');
  const raw=reader.read(ref);if(hashBytes(raw)!==ref.digest||raw.byteLength!==ref.bytes)fail('COMPLETION_ARTIFACT_INTEGRITY');
  return parseJson(raw,64*1024*1024);
}
function currentValidations(state:WorkflowState,spec:TaskSpec,records:readonly ContextRecord[]):ValidationResult[]{
  return spec.validationCommands.filter(c=>c.required).map(command=>{
    const current=[...state.validations].reverse().filter(id=>!state.invalidEvidenceIds.includes(id)).map(id=>records.find(r=>r.id===id&&r.kind==='ValidationResult')?.value as ValidationResult|undefined)
      .find(v=>v&&v.commandId===command.id&&v.specHash===spec.specHash&&v.candidateDigest===state.candidate?.digest&&v.candidateGeneration===state.candidate?.generation);
    if(!current||current.status!=='PASSED'||current.commandHash!==hashCanonical(command))fail('COMPLETION_VALIDATION_MISSING_OR_STALE');return current;
  });
}
export function buildCompletionPackage(state:WorkflowState,records:readonly ContextRecord[],reader:EvidenceReader):CompletionPackage{
  if(state.state!=='REVIEWING'||!state.candidate||!state.baselineCommit)fail('COMPLETION_STATE_INVALID');
  const spec=readJson(reader,state.spec) as TaskSpec,c=state.candidate;
  const developer=[...state.runs].reverse().find(r=>r.role==='Developer'),reviewer=[...state.runs].reverse().find(r=>r.role==='Reviewer');
  if(!developer?.resultRef||!reviewer?.resultRef||!reviewer.terminalProofRef)fail('COMPLETION_RESULT_MISSING');
  const validations=currentValidations(state,spec,records),refs=(ids:readonly string[])=>ids.map(id=>refFor(id,records));
  const body:Omit<CompletionPackage,'packageHash'>={schemaVersion:1,taskId:state.taskId,specHash:state.specHash,specRef:state.spec,baselineCommit:state.baselineCommit,
    candidateDigest:c.digest,candidateGeneration:c.generation,manifestRef:c.manifest,patchRef:c.patch,handoffRef:c.handoff,candidateTerminalProofRef:c.terminalProof,
    developerResultRef:refFor(developer.resultRef,records),validationResultIds:validations.map(v=>v.id),validationResultRefs:refs(validations.map(v=>v.id)),
    validationArtifactRefs:refs([...new Set(validations.flatMap(v=>[v.logRef!,v.processProofRef!]))]),reviewId:reviewer.resultRef,
    reviewRef:refFor(reviewer.resultRef,records),reviewerTerminalProofRef:refFor(reviewer.terminalProofRef,records),gateIds:state.gates,gateRefs:refs(state.gates),
    decisionIds:state.decisions.filter(d=>!state.invalidEvidenceIds.includes(d.id)).map(d=>d.id),
    decisionRefs:refs(state.decisions.filter(d=>!state.invalidEvidenceIds.includes(d.id)).map(d=>d.id)),completionEvidenceRefs:[]};
  const complete={...body,completionEvidenceRefs:refs(evidenceClosure(state,validations,records))};const packet=Object.freeze({...complete,packageHash:hashCanonical(complete)});
  verifyCompletionPackage(packet,state,records,reader);return packet;
}
function evidenceClosure(state:WorkflowState,validations:readonly ValidationResult[],records:readonly ContextRecord[]):string[]{
  // Include transitive cited record/artifact IDs, not unrelated provider artifacts or transcripts.
  const ids=new Set<string>([...state.baselineEvidence,...state.runs.flatMap(r=>[runProofRef(r)!,...(r.resultRef&&!state.invalidEvidenceIds.includes(r.resultRef)?[r.resultRef]:[])]),
    ...validations.map(v=>v.id),...state.gates,...state.decisions.filter(d=>!state.invalidEvidenceIds.includes(d.id)).map(d=>d.id),
    ...records.filter(r=>r.kind==='ArtifactRef'&&['application/vnd.pi-controlled-dev.memory-context-receipt+json','application/vnd.pi-controlled-dev.memory-proposal-reference+json','application/vnd.pi-controlled-dev.project-autonomy+json','application/vnd.pi-controlled-dev.trusted-confirmation+json'].includes(r.value.mediaType)).map(r=>r.id)]);
  const visit=(v:any):void=>{if(!v||typeof v!=='object')return;for(const [key,value] of Object.entries(v)){
    if(key==='evidenceRefs'&&Array.isArray(value))for(const id of value)ids.add(id);
    if(['logRef','processProofRef','humanDecisionRef','policyAuthorizationRef','trustedChannelEvidenceRef'].includes(key)&&typeof value==='string')ids.add(value);
    if(key==='relativeStorePath'&&typeof v.id==='string')ids.add(v.id);else if(value&&typeof value==='object')visit(value);
  }};
  for(const id of ids){const record=records.find(r=>r.id===id);if(!record)fail('COMPLETION_EVIDENCE_MISSING');visit(record.value)}
  return [...ids];
}
export function verifyCompletionPackage(input:unknown,state:WorkflowState,records:readonly ContextRecord[],reader:EvidenceReader):
  {readonly status:'COMPLETION_PACKAGE_VALID';readonly completion:'HUMAN_GATE_REQUIRED'}{
  const p=JSON.parse(canonicalize(input)) as CompletionPackage;
  if(!p||Object.keys(p).sort().join(',')!==keys||p.schemaVersion!==1||p.packageHash!==hashCanonical(Object.fromEntries(Object.entries(p).filter(([k])=>k!=='packageHash'))))fail('COMPLETION_PACKAGE_HASH');
  const c=state.candidate;if(!c||p.taskId!==state.taskId||p.specHash!==state.specHash||!same(p.specRef,state.spec)||p.baselineCommit!==state.baselineCommit
    ||p.baselineCommit!==c.baseCommit||p.candidateDigest!==c.digest||p.candidateGeneration!==c.generation||!same(p.manifestRef,c.manifest)
    ||!same(p.patchRef,c.patch)||!same(p.handoffRef,c.handoff)||!same(p.candidateTerminalProofRef,c.terminalProof))fail('COMPLETION_CANDIDATE_BINDING');
  const allRefs=[p.specRef,p.manifestRef,p.patchRef,p.handoffRef,p.candidateTerminalProofRef,p.developerResultRef,p.reviewRef,p.reviewerTerminalProofRef,
    ...p.validationResultRefs,...p.validationArtifactRefs,...p.gateRefs,...p.decisionRefs,...p.completionEvidenceRefs];
  const historical=new Set([...historicalGateEvidence(state,records),...historicalRuntimeEvidence(state,records,reader)]);
  for(const ref of allRefs){
    if(state.invalidEvidenceIds.includes(ref.id)&&!historical.has(ref.id))fail(`COMPLETION_EVIDENCE_INVALIDATED:${ref.id}`);
    if(!same(ref,refFor(ref.id,records)))fail('COMPLETION_ARTIFACT_BINDING');
    const raw=reader.read(ref);if(hashBytes(raw)!==ref.digest||raw.byteLength!==ref.bytes)fail('COMPLETION_ARTIFACT_INTEGRITY');
  }
  const spec=readJson(reader,p.specRef) as TaskSpec;
  const context={records,specId:state.spec.id,stateId:'completion-state',modelExtracted:false};
  const contextRecords=[...records.filter(r=>r.id!=='completion-state'),{id:'completion-state',kind:'WorkflowState' as const,value:state}];
  if(!validateContract('TaskSpec',spec,{...context,records:contextRecords}).ok)fail('COMPLETION_SPEC_INVALID');
  if(!scoutClarificationCoverage({spec,state,records,events:records.filter(r=>r.kind==='TransitionEvent').map(r=>r.value as TransitionEvent)},reader).covered)fail('COMPLETION_SCOUT_CLARIFICATION_UNRESOLVED');
  const manifest=readJson(reader,p.manifestRef) as CandidateManifest;
  if(!validateContract('CandidateManifest',manifest).ok||hashCanonical(manifest)!==c.digest||manifest.baseCommit!==p.baselineCommit)fail('COMPLETION_MANIFEST_INVALID');
  for(const run of state.runs){
    if(run.status==='NOT_DISPATCHED'){
      const assignment=records.find(r=>r.kind==='AssignmentEnvelope'&&r.value.assignmentId===run.assignmentId);
      if(assignment?.kind!=='AssignmentEnvelope'||!verifyReviewerNoDispatchProof(readJson(reader,refFor(run.dispatchProofRef!,records)),assignment.value,run))fail('COMPLETION_NO_DISPATCH_PROOF_INVALID');
      continue;
    }
    if(run.status!=='TERMINAL'||!run.runId||!run.childSessionId||!run.terminalProofRef)fail('COMPLETION_RUN_NOT_TERMINAL');
    if(!verifyTerminalProof(readJson(reader,refFor(run.terminalProofRef,records)),{runId:run.runId,role:run.role,requestId:run.requestId,
      ownerSessionId:run.ownerSessionId,childSessionId:run.childSessionId}))fail('COMPLETION_TERMINAL_PROOF_INVALID');
  }
  const developer=[...state.runs].reverse().find(r=>r.role==='Developer'),reviewer=state.runs.find(r=>r.resultRef===p.reviewId&&r.role==='Reviewer');
  if(!developer?.resultRef||developer.resultRef!==p.developerResultRef.id||!reviewer||p.reviewRef.id!==p.reviewId||!state.reviews.includes(p.reviewId)
    ||reviewer.terminalProofRef!==p.reviewerTerminalProofRef.id||developer.runId===reviewer.runId||developer.childSessionId===reviewer.childSessionId)fail('COMPLETION_REVIEW_BINDING');
  if(!same(readJson(reader,p.candidateTerminalProofRef),readJson(reader,refFor(developer.terminalProofRef!,records))))fail('COMPLETION_WRITER_PROOF_BINDING');
  const d=readJson(reader,p.developerResultRef) as DeveloperResult;
  if(d.blockedReason||!validateContract('DeveloperResult',d,{...context,records:contextRecords,assignmentId:developer.assignmentId}).ok)fail('COMPLETION_DEVELOPER_INVALID');
  const validations=currentValidations(state,spec,records);
  if(!same(evidenceClosure(state,validations,records).sort(),p.completionEvidenceRefs.map(ref=>ref.id).sort()))fail('COMPLETION_EVIDENCE_CLOSURE');
  if(!same(validations.map(v=>v.id),p.validationResultIds)||!same(p.validationResultRefs.map(r=>r.id),p.validationResultIds))fail('COMPLETION_VALIDATION_BINDING');
  for(const v of validations){
    if(!v.logRef||!v.processProofRef||!p.validationArtifactRefs.some(r=>r.id===v.logRef)||!p.validationArtifactRefs.some(r=>r.id===v.processProofRef)
      ||!same(v,readJson(reader,refFor(v.id,records)))||!validateContract('ValidationResult',v,{...context,records:contextRecords}).ok
      ||!verifyValidationProcessProof(readJson(reader,refFor(v.processProofRef!,records)),v,state,reader.read(refFor(v.logRef!,records))))fail('COMPLETION_VALIDATION_PROOF_INVALID');
  }
  for(const id of state.reviews.filter(id=>!state.invalidEvidenceIds.includes(id))){
    const current=records.find(r=>r.id===id&&r.kind==='ReviewResult')?.value as ReviewResult|undefined;
    if(current?.specHash===state.specHash&&current.reviewedTreeHash===c.digest&&current.candidateGeneration===c.generation&&current.verdict!=='PASS')fail('COMPLETION_REVIEW_INVALID');
  }
  const review=readJson(reader,p.reviewRef) as ReviewResult;
  if(review.verdict!=='PASS'||!validateContract('ReviewResult',review,{...context,records:contextRecords,assignmentId:reviewer.assignmentId,currentValidationIds:p.validationResultIds}).ok)fail('COMPLETION_REVIEW_INVALID');
  if(!same(p.gateIds,state.gates)||!same(p.gateRefs.map(r=>r.id),p.gateIds)||!same(p.decisionIds,state.decisions.filter(d=>!state.invalidEvidenceIds.includes(d.id)).map(d=>d.id))
    ||!same(p.decisionRefs.map(r=>r.id),p.decisionIds))fail('COMPLETION_GATE_OR_DECISION_BINDING');
  for(const ref of p.gateRefs){const gate=readJson(reader,ref) as HumanGate;
    if(!validateStructure('HumanGate',gate).ok||gate.taskId!==state.taskId)fail('COMPLETION_GATE_INVALID');}
  // No schema-valid JSON can authenticate a human. P14 supplies that separate authority.
  return Object.freeze({status:'COMPLETION_PACKAGE_VALID',completion:'HUMAN_GATE_REQUIRED'});
}

function historicalGateEvidence(state:WorkflowState,records:readonly ContextRecord[]):Set<string>{
  const ids=new Set<string>();
  for(const r of records)if(r.kind==='HumanGate'&&state.gates.includes(r.id)){
    ids.add(r.id);if(r.value.humanDecisionRef)ids.add(r.value.humanDecisionRef);if(r.value.policyAuthorizationRef)ids.add(r.value.policyAuthorizationRef);
  }
  return ids; // Historical invalidation is checked against its own event by evaluateHumanGateHistory, never reused as current authority.
}
function historicalRuntimeEvidence(state:WorkflowState,records:readonly ContextRecord[],reader:EvidenceReader):Set<string>{
  const ids=new Set<string>();
  for(const record of records)if(record.kind==='ArtifactRef'&&record.value.mediaType==='application/vnd.pi-controlled-dev.runtime-comparison+json')try{
    const comparison=readJson(reader,record.value),before=records.find(r=>r.id===comparison.before?.validationId&&r.kind==='ValidationResult')?.value as ValidationResult|undefined,
      after=records.find(r=>r.id===comparison.after?.validationId&&r.kind==='ValidationResult')?.value as ValidationResult|undefined;
    if(comparison.conclusion!=='RESOLVED'||!before||!after||before.status==='PASSED'||after.status!=='PASSED'
      ||before.specHash!==state.specHash||after.specHash!==state.specHash||before.commandId!==after.commandId||before.commandHash!==after.commandHash
      ||before.candidateGeneration>=after.candidateGeneration||after.candidateDigest!==state.candidate?.digest||after.candidateGeneration!==state.candidate?.generation
      ||comparison.before.validationId!==before.id||comparison.after.validationId!==after.id||comparison.before.evidenceId===comparison.after.evidenceId
      ||!state.invalidEvidenceIds.includes(before.id)||state.invalidEvidenceIds.includes(after.id))continue;
    for(const id of [before.id,comparison.before.evidenceId,comparison.before.eventLogRef])ids.add(id);
  }catch{}
  return ids;
}

/** Material projection. Gate lifecycle artifacts are audit facts, not a candidate change. */
export function authorizationPackage(packet:CompletionPackage,records:readonly ContextRecord[]){
  const {packageHash:_hash,gateIds:_gates,gateRefs:_gateRefs,completionEvidenceRefs:_closure,schemaVersion:_v,...material}=packet;
  const developer=records.find(r=>r.id===packet.developerResultRef.id&&r.kind==='DeveloperResult')?.value as DeveloperResult|undefined;
  const review=records.find(r=>r.id===packet.reviewId&&r.kind==='ReviewResult')?.value as ReviewResult|undefined;
  if(!developer||!review)fail('AUTHORIZATION_RESULT_MISSING');
  const materialEvidenceRefs=packet.completionEvidenceRefs.filter(ref=>{
    const record=records.find(r=>r.id===ref.id);
    return record?.kind!=='HumanGate'&&record?.kind!=='HumanDecisionEvidence'
      &&!['application/vnd.pi-controlled-dev.approved-data+json','application/vnd.pi-controlled-dev.human-channel+json',CHANNEL_V2_MEDIA,
        'application/vnd.pi-controlled-dev.authorization+json',POLICY_AUTHORIZATION_MEDIA,'application/vnd.pi-controlled-dev.project-autonomy+json','application/vnd.pi-controlled-dev.trusted-confirmation+json'].includes(ref.mediaType);
  }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return {schemaVersion:1 as const,kind:'AuthorizationPackage' as const,...material,materialEvidenceRefs,
    residualRisks:[...developer.residualRisks,...review.residualRisks],
    riskDispositions:records.filter(r=>packet.decisionIds.includes(r.id)&&r.kind==='DecisionRecord').map(r=>r.value)};
}
export interface GateHistoryEvaluation {
  readonly applicableGateTypes:readonly HumanGate['type'][];
  readonly satisfiedGateAuthorizations:readonly HumanGate[];
  readonly unsatisfiedGateRequirements:readonly string[];
  readonly invalidAuthorizations:readonly string[];
  readonly dispositions:readonly {gateId:string;status:string}[];
  readonly finalBeforeCompletionAuthorization?:HumanGate;
  readonly valid:boolean;
}
/** Pure, durable-only authority evaluation. No transcript, locks, dispatch or recovery. */
export function evaluateHumanGateHistory(state:WorkflowState,records:readonly ContextRecord[],reader:EvidenceReader,currentAuthorizationHash?:string):GateHistoryEvaluation{
  const applicable=new Set<HumanGate['type']>(['beforeCompletion']),satisfied:HumanGate[]=[],missing:string[]=[],invalid:string[]=[],dispositions:{gateId:string;status:string}[]=[];
  const events=records.filter(r=>r.kind==='TransitionEvent').map(r=>r.value as TransitionEvent).sort((a,b)=>a.revision-b.revision);
  const states=new Map<number,WorkflowState>(records.filter(r=>r.kind==='WorkflowState').map(r=>[(r.value as WorkflowState).revision,r.value as WorkflowState]));states.set(state.revision,state);
  const get=(id:string,kind:ContextRecord['kind']):any=>{const found=records.filter(r=>r.id===id&&r.kind===kind);if(found.length!==1)fail('HISTORY_RECORD_MISSING_OR_DUPLICATE');return found[0].value};
  if(new Set(records.map(r=>r.id)).size!==records.length)invalid.push('DUPLICATE_HISTORY_RECORD');
  if(!events.length||events.at(-1)!.revision<state.revision-1)invalid.push('INCOMPLETE_EVENT_HISTORY');
  for(const [index,event] of events.entries()){
    try{
      if(event.revision!==index||event.previousEventHash!==events[index-1]?.eventHash)fail('EVENT_SEQUENCE');
      readJson(reader,refFor(event.id,records));
      const after=states.get(event.revision);
      if(!after||after.state!==event.targetState||!same(readJson(reader,event.stateAfter),after))fail('EVENT_STATE_BINDING');
    }catch{invalid.push(`EVENT_INTEGRITY:${event.id}`)}
  }
  const gates=records.filter(r=>r.kind==='HumanGate'),roots=gates.filter(r=>r.id===(r.value as HumanGate).id);
  const decisions=records.filter(r=>r.kind==='HumanDecisionEvidence').map(r=>r.value as HumanDecisionEvidence);
  const confirmations=new Set<string>(),channels=new Set<string>();
  for(const decision of decisions){
    if(confirmations.has(decision.confirmationId)||channels.has(decision.trustedChannelEvidenceRef))invalid.push('REPLAYED_HUMAN_DECISION');
    confirmations.add(decision.confirmationId);channels.add(decision.trustedChannelEvidenceRef);
    if(!roots.some(r=>(r.value as HumanGate).id===decision.gateId))invalid.push('ORPHAN_HUMAN_DECISION');
  }
  const dataById=new Map<string,any>();
  const rootMappings=verifiedRuntimeRootMappings(records,events,reader);
  for(const root of roots){const gate=root.value as HumanGate;applicable.add(gate.type);
    try{
      if(['PENDING','APPROVED'].includes(gate.status)&&state.invalidEvidenceIds.includes(root.id)){
        const replaced=events.find(e=>e.recordType==='RECONCILED'&&e.invalidatedEvidenceIds.includes(root.id)&&e.revision>gate.stateRevision);
        const imported=replaced&&states.get(replaced.revision),mapping=imported&&runtimeRootMappingFor(imported,rootMappings);
        if(mapping&&replaced!.evidenceRefs.includes(mapping.refId)&&mapping.payload.sourceRevision+1===replaced!.revision){
          if(!same(readJson(reader,refFor(root.id,records)),gate))fail('GATE_INTEGRITY');
          dispositions.push({gateId:gate.id,status:'SUPERSEDED_BY_ROOT_REBIND'});continue;
        }
      }
      const requestState=states.get(gate.stateRevision),request=events.find(e=>e.revision===gate.stateRevision);
      const latest=state.gates.map(id=>gates.find(r=>r.id===id)).filter(r=>(r?.value as HumanGate|undefined)?.id===gate.id);
      if(latest.length!==1||!requestState||!request||requestState.state!=='AWAITING_HUMAN'||requestState.pendingGateId!==root.id
        ||!request.evidenceRefs.includes(root.id)||gate.status!=='PENDING'||gate.taskId!==state.taskId||gate.specHash!==requestState.specHash
        ||gate.candidateDigest!==requestState.candidate?.digest||gate.candidateGeneration!==requestState.candidate?.generation)fail('GATE_REQUEST_BINDING');
      const current=latest[0]!.value as HumanGate,data=readJson(reader,gate.approvedData);dataById.set(gate.id,data);
      if(hashCanonical(data)!==gate.approvedDataHash)fail('GATE_DISPLAY_HASH');
      for(const version of gates.filter(r=>(r.value as HumanGate).id===gate.id)){
        const {status,decidedAt,humanDecisionRef,policyAuthorizationRef,consumedEventId,invalidationReason,...fixed}=version.value as HumanGate;
        const {status:_s,...original}=gate;
        if(!same(fixed,original)||!validateStructure('HumanGate',version.value).ok)fail('GATE_HISTORY_MUTATED');
      }
      const ds=decisions.filter(d=>d.gateId===gate.id);
      let d:any,channel:any,presentation:any,decisionRevision=gate.stateRevision;
      const derived=gate.authorizationKind==='PolicyDerivedAuthorization';
      if(derived){
        if(ds.length||current.humanDecisionRef||['onOracleDecision','onRetryExhausted'].includes(gate.type))fail('POLICY_GATE_AUTHORITY');
        if(!current.policyAuthorizationRef){if(current.status!=='PENDING')fail('MISSING_GATE_DECISION');missing.push(gate.id);continue}
        const authorization=readPolicyAuthorization(reader,get(current.policyAuthorizationRef,'ArtifactRef'),gate.type),subject=authorization.subject as any;
        if(subject.gateId!==gate.id||subject.specHash!==gate.specHash||subject.stateRevision!==gate.stateRevision||subject.approvedDataHash!==gate.approvedDataHash
          ||!same(subject.approvedData,data))fail('POLICY_GATE_BINDING');
        d={id:current.policyAuthorizationRef,decision:'APPROVE'};
      }else{
        if(ds.length>1)fail('CONTRADICTORY_GATE_DECISIONS');
        if(!ds.length){if(current.status!=='PENDING')fail('MISSING_GATE_DECISION');missing.push(gate.id);dispositions.push({gateId:gate.id,status:'PENDING'});continue}
        d=ds[0];const channelRef=get(d.trustedChannelEvidenceRef,'ArtifactRef');channel=readJson(reader,channelRef);
        presentation=channelRef.mediaType===CHANNEL_V2_MEDIA?checkPresentationChannel(channel,gate,records,events,reader):undefined;
        if(!presentation&&(channelRef.mediaType!=='application/vnd.pi-controlled-dev.human-channel+json'||channel.schemaVersion!==1||channel.presentationRef!==undefined))fail('HUMAN_CHANNEL_TYPE');
        decisionRevision=presentation?.workflowRevision??gate.stateRevision;
      }
      if(gate.type==='onOracleDecision'||gate.type==='onRetryExhausted'){
        const episode=requestState.escalations.find(e=>e.id===data.escalationEpisodeId);
        if(!episode||!same(data.episode,episode)||!same(data.counters,requestState.counters))fail('EPISODE_BINDING');
        if(gate.type==='onOracleDecision'){
          const run=requestState.runs.find(r=>r.role==='Oracle'&&r.attemptId===episode.oracleAttemptId);
          if(!run?.resultRef||!same(get(run.resultRef,'OracleResult'),data.OracleResult)||!data.OracleResult.needsHumanDecision)fail('ORACLE_EPISODE_BINDING');
        }else{
          const spec=get(requestState.spec.id,'TaskSpec'),c=requestState.counters,p=spec.retryPolicy,last=requestState.failures.at(-1);
          const exhausted=c.dispatches>=p.maxDispatches||(['TEST','REVIEW'].includes(last?.category??'')&&c.reworkAttempts>=p.maxReworkAttempts)
            ||(last?.category==='INFRA'&&c.infrastructureRetries>=p.maxInfrastructureRetries);
          if(!exhausted||!spec.humanGates.onRetryExhausted||!same(data.policy,p)||data.failureFingerprint!==last?.fingerprint
            ||!episode.triggerFailureIds.includes(data.lastFailure?.id)||!same(data.lastFailure,last)||!episode.closed||!episode.decisionId
            ||!same(data.resolution,get(episode.decisionId,'DecisionRecord'))||data.resolution.kind!=='RESOLVE_AMBIGUITY')fail('RETRY_FINGERPRINT_BINDING');
        }
      }
      if(gate.type==='beforeReviewerRedispatch'){
        const reviewer=requestState.runs.findLast(r=>r.role==='Reviewer'),failure=requestState.failures.at(-1),authorization=readJson(reader,data.retryAuthorizationRef);
        const validations=data.validationIds?.map((id:string)=>get(id,'ValidationResult')) as ValidationResult[]|undefined;
        if(!reviewer||!runQuiescent(reviewer)||reviewer.resultRef
          ||requestState.runs.some(r=>!runQuiescent(r))||!failure||failure.id!==data.failureId||failure.phase!=='REVIEWING'||failure.category!=='INFRA'
          ||!failure.subjectIds.includes(reviewer.assignmentId)||!failure.evidenceRefs.includes(runProofRef(reviewer)!)
          ||data.specHash!==requestState.specHash||data.candidateDigest!==requestState.candidate?.digest||data.candidateGeneration!==requestState.candidate?.generation
          ||!same(data.previousReviewer,{assignmentId:reviewer.assignmentId,attemptId:reviewer.attemptId,requestId:reviewer.requestId,...(reviewer.status==='NOT_DISPATCHED'?{dispatchProofRef:reviewer.dispatchProofRef}:{runId:reviewer.runId,childSessionId:reviewer.childSessionId,terminalProofRef:reviewer.terminalProofRef})})||authorization.action!=='RETRY_INFRASTRUCTURE'
          ||authorization.failureId!==failure.id||authorization.reviewerAssignmentId!==reviewer.assignmentId
          ||authorization.candidateDigest!==requestState.candidate?.digest||authorization.candidateGeneration!==requestState.candidate?.generation
          ||authorization.infrastructureRetriesAfter!==requestState.counters.infrastructureRetries||!validations?.length
          ||validations.some(v=>v.status!=='PASSED'||v.specHash!==requestState.specHash||v.candidateDigest!==requestState.candidate?.digest
            ||v.candidateGeneration!==requestState.candidate?.generation||requestState.invalidEvidenceIds.includes(v.id))
          ||!(data.runtimeEvidenceRefs as unknown[])?.length||!(data.runtimeEvidenceRefs as string[]).every(id=>records.some(r=>r.id===id&&r.kind==='ArtifactRef')))
          fail('REVIEWER_REDISPATCH_BINDING');
      }
      if(!derived&&(!validateStructure('HumanDecisionEvidence',d).ok||d.taskId!==gate.taskId||d.displayedRevision!==decisionRevision
        ||d.displayedDataHash!==gate.approvedDataHash||current.humanDecisionRef!==d.id
        ||channel.channel!=='TUI'||(presentation?!isHumanConfirmationSource(channel.source):channel.source!=='ctx.ui.confirm')
        ||channel.sessionId!==(presentation?.hostSessionId??requestState.ownerSessionId)
        ||(!presentation&&gate.type==='beforeCompletion'&&gate.specHash===state.specHash&&gate.candidateDigest===state.candidate?.digest&&channel.sessionId!==state.ownerSessionId)
        ||channel.confirmationId!==d.confirmationId||channel.gateId!==gate.id||channel.taskId!==gate.taskId
        ||channel.displayedRevision!==decisionRevision||channel.displayedDataHash!==gate.approvedDataHash||channel.decision!==d.decision
        ||channel.actorIdentity!==null||channel.providerConfirmationId!==null||channel.answerHash!==(d.answer===undefined?undefined:hashCanonical(d.answer))))fail('HUMAN_CHANNEL_BINDING');
      const decisionEvent=events.find(e=>e.revision===decisionRevision+1),afterDecision=states.get(decisionRevision+1);
      if(!decisionEvent||decisionEvent.recordType!=='GATE_DECIDED'||!decisionEvent.evidenceRefs.includes(d.id)||!afterDecision
        ||afterDecision.state!=='AWAITING_HUMAN'||!afterDecision.pendingGateId)fail('GATE_DECISION_SEQUENCE');
      const resume=events.find(e=>e.revision===decisionRevision+2),after=states.get(decisionRevision+2);
      if(!resume||!after){missing.push(gate.id);dispositions.push({gateId:gate.id,status:'DECIDED_NOT_RESUMED'});continue}
      if(resume.sourceState!=='AWAITING_HUMAN'||resume.targetState!==after.state||!resume.evidenceRefs.includes(d.id)||after.pendingGateId)fail('GATE_RESUME_SEQUENCE');
      if(d.decision!=='APPROVE'){
        if(current.consumedEventId||resume.transitionId!==(d.decision==='REJECT'?'TR-043':'TR-042')
          ||after.state!==(d.decision==='REJECT'?'FAILED':'BLOCKED')||current.status!==(d.decision==='REJECT'?'REJECTED':'INVALIDATED'))fail('NEGATIVE_DECISION_AUTHORITY');
        dispositions.push({gateId:gate.id,status:d.decision});continue;
      }
      const transition=gate.type==='beforeCompletion'||gate.type==='beforeReviewerRedispatch'?'TR-040':gate.type==='beforeImplementation'?'TR-038':gate.type==='onScopeChange'?'TR-037':'TR-042';
      if(current.status!=='CONSUMED'||current.consumedEventId!==resume.id||resume.transitionId!==transition||after.state!==gate.resumeState
        ||!resume.evidenceRefs.includes(latest[0]!.id))fail('IMPOSSIBLE_GATE_CONSUMPTION');
      if(gate.type==='onScopeChange'&&(data.currentSpecHash!==gate.specHash||data.proposedSpecHash!==gate.proposedSpecHash||after.specHash!==gate.proposedSpecHash))fail('SCOPE_CHAIN');
      if(state.invalidEvidenceIds.includes(latest[0]!.id)){
        if(!events.some(e=>e.revision>resume.revision&&e.invalidatedEvidenceIds.includes(latest[0]!.id)))fail('UNEXPLAINED_INVALIDATION');
        dispositions.push({gateId:gate.id,status:'SUPERSEDED'});
      }else dispositions.push({gateId:gate.id,status:'CONSUMED'});
      satisfied.push(current);
    }catch(error){invalid.push(`${gate.id}:${(error as Error).message}`)}
  }
  for(const id of state.gates)if(!gates.some(r=>r.id===id&&roots.some(root=>root.id===(r.value as HumanGate).id)))invalid.push('MISSING_GATE_HISTORY');
  const writerApprovals=new Set<string>();
  for(const e of events){const before=states.get(e.revision-1),after=states.get(e.revision);if(!before||!after)continue;
    if(after.pendingGateId&&!gates.some(r=>r.id===after.pendingGateId))missing.push(`pending:${e.id}`);
    if(before.specHash!==after.specHash&&!satisfied.some(g=>g.type==='onScopeChange'&&g.consumedEventId===e.id&&g.specHash===before.specHash&&g.proposedSpecHash===after.specHash))missing.push(`scope:${e.id}`);
    if(e.transitionId==='TR-009'||e.transitionId==='TR-027'){
      const spec=records.find(r=>r.id===before.spec.id&&r.kind==='TaskSpec')?.value as TaskSpec|undefined;
      if(!spec){invalid.push('WRITER_SPEC_MISSING');continue}
      if(spec.humanGates.beforeImplementation||before.runtimeBindingRef){applicable.add('beforeImplementation');
        const matching=satisfied.filter(g=>g.type==='beforeImplementation'&&g.specHash===before.specHash&&g.stateRevision+2<=before.revision
          &&!writerApprovals.has(g.id)).sort((a,b)=>b.stateRevision-a.stateRevision);
        const gate=matching[0],data=gate?dataById.get(gate.id):undefined;
        const intent=states.get(e.revision+1),run=intent?.runs.find(r=>r.role==='Developer'&&!before.runs.some(old=>old.assignmentId===r.assignmentId));
        const assignment=run?records.find(r=>r.id===run.assignmentId&&r.kind==='AssignmentEnvelope')?.value as any:undefined;
        if(!data||!assignment||assignment.specHash!==before.specHash||!same(data.plannedDeveloperAuthority,assignment.authority)
          ||data.baselineCommit!==before.baselineCommit||!runtimeRootMatches(spec.scope.repoRoot,data.scope?.repoRoot,before,rootMappings)
          ||!same(data.scope,{...spec.scope,repoRoot:data.scope?.repoRoot})||!same(data.validationCommands,spec.validationCommands)
          ||!same(data.requirements,spec.requirements)||!same(data.candidate??null,before.candidate??null))missing.push(`writer:${e.id}`);
        if(gate)writerApprovals.add(gate.id);
      }
    }
  }
  for(const run of state.runs.filter(r=>r.role==='Oracle'&&r.resultRef)){
    const result=records.find(r=>r.id===run.resultRef&&r.kind==='OracleResult')?.value as any;
    if(result?.needsHumanDecision){applicable.add('onOracleDecision');
      if(!roots.some(r=>{const g=r.value as HumanGate;return g.type==='onOracleDecision'&&dataById.get(g.id)?.escalationEpisodeId===result.escalationId
        &&decisions.some(d=>d.gateId===g.id)}))missing.push(`oracle:${result.escalationId}`);
    }
  }
  const finals=satisfied.filter(g=>g.type==='beforeCompletion'&&!state.invalidEvidenceIds.some(id=>id===`${g.id}-consumed`||id===g.humanDecisionRef)
    &&g.specHash===state.specHash&&g.candidateDigest===state.candidate?.digest&&g.candidateGeneration===state.candidate?.generation
    &&(!currentAuthorizationHash||dataById.get(g.id)?.authorizationPackageHash===currentAuthorizationHash));
  if(finals.length!==1||state.pendingGateId)missing.push('CURRENT_BEFORE_COMPLETION');
  return {applicableGateTypes:[...applicable].sort(),satisfiedGateAuthorizations:satisfied,unsatisfiedGateRequirements:missing,
    invalidAuthorizations:invalid,dispositions,...(finals.length===1?{finalBeforeCompletionAuthorization:finals[0]}:{}),valid:!missing.length&&!invalid.length};
}

export function buildTerminalCompletionPackage(packet:CompletionPackage,state:WorkflowState,records:readonly ContextRecord[],reader:EvidenceReader){
  const material=authorizationPackage(packet,records),history=evaluateHumanGateHistory(state,records,reader,hashCanonical(material)),gate=history.finalBeforeCompletionAuthorization;
  if(!history.valid||!gate)fail('HUMAN_GATE_REQUIRED');
  const approved=readJson(reader,gate.approvedData),auth=readJson(reader,approved.authorizationPackageRef);
  if(approved.authorizationPackageHash!==hashCanonical(auth)||!same(auth,material))fail('AUTHORIZATION_MATERIAL_CHANGED');
  const gateRecord=records.find(r=>r.kind==='HumanGate'&&state.gates.includes(r.id)&&same(r.value,gate));
  if(!gateRecord)fail('HUMAN_GATE_REQUIRED');
  return {...(gate.authorizationKind==='PolicyDerivedAuthorization'?{schemaVersion:3 as const,authorizationKind:'PolicyDerivedAuthorization' as const,policyAuthorizationRef:refFor(gate.policyAuthorizationRef!,records)}:{schemaVersion:2 as const,humanDecisionRef:refFor(gate.humanDecisionRef!,records)}),kind:'TerminalCompletionPackage' as const,authorizationPackageRef:approved.authorizationPackageRef as ArtifactRef,
    authorizationPackageHash:approved.authorizationPackageHash as string,beforeCompletionGateRef:refFor(gateRecord.id,records),
    consumedEventRef:refFor(gate.consumedEventId!,records),
    finalDecisionRefs:packet.decisionRefs,completionEvidenceRefs:packet.completionEvidenceRefs,executionPackage:packet,
    terminalStateBinding:{taskId:state.taskId,specHash:state.specHash,candidateDigest:state.candidate!.digest,candidateGeneration:state.candidate!.generation,targetState:'COMPLETED'}};
}
export function verifyTerminalCompletionPackage(input:unknown,state:WorkflowState,records:readonly ContextRecord[],reader:EvidenceReader):void{
  const packet=input as ReturnType<typeof buildTerminalCompletionPackage>;
  if(![2,3].includes(packet?.schemaVersion)||packet.kind!=='TerminalCompletionPackage')fail('TERMINAL_CONTRACT_VERSION');
  verifyCompletionPackage(packet.executionPackage,state,records,reader);
  if(!same(packet,buildTerminalCompletionPackage(packet.executionPackage,state,records,reader)))fail('TERMINAL_AUTHORIZATION_LINKAGE');
  for(const ref of [packet.authorizationPackageRef,packet.beforeCompletionGateRef,packet.schemaVersion===3?packet.policyAuthorizationRef:packet.humanDecisionRef,packet.consumedEventRef])readJson(reader,ref);
}
import { verifiedRuntimeRootMappings, runtimeRootMappingFor, runtimeRootMatches } from './runtime-root-binding.js';
