import { scoutClarificationCoverage } from './scout-clarifications.js';
import { projectRuntimeImportLease } from './project-runtime-import.js';
import type { ProjectRuntimeImportCapability } from './project-runtime-import.js';
import { RUNTIME_ROOT_BINDING_MEDIA, verifiedRuntimeRootMappings, runtimeRootMappingFor, runtimeRootMatches } from './runtime-root-binding.js';
import type { RuntimeRootBinding } from './runtime-root-binding.js';
import { runQuiescent, runProofRef } from './run-quiescence.js';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { canonicalize, hashBytes, hashCanonical, hashContract, parseJson, validateScalar, validateStructure, validateContract } from './contracts.js';
import type { ArtifactRef, TaskSpec, HumanGate } from './contracts.js';
import { DurableStore } from './store.js';
import type { ArtifactInspection, StoredLedger } from './store.js';
import { LockManager } from './lock-manager.js';
import type { WorkflowLocks } from './lock-manager.js';
import { classifyRecoveryState, recoverLocks, reconciliationAttempts, reconciledTerminalAttempts, reconciledQuiescentAttempts, recordReconciliationAttempt } from './recovery.js';
import type { ReconciliationAttempt } from './recovery.js';
import { currentProcessIncarnation, inspectProcessOwner } from './process-incarnation.js';
import type { ProcessIncarnation } from './process-incarnation.js';
import type { RpcAdapter } from './pi-subagents-rpc.js';
import { verifyTerminalProof } from './pi-subagents-rpc.js';
import { DEVELOPER_LAUNCH_CONTRACT_HASH, CONTROLLED_DEVELOPER_NAME } from './controlled-developer.js';
import { ScopeGuard, workspaceManifest } from './scope-guard.js';
import { CandidateGit } from './candidate-git.js';
import { CandidatePromotionRepository } from './candidate-promotion-repository.js';
import { execFileSync } from 'node:child_process';
import { HOST_GIT_CONFIG, hostGitEnvironment } from './host-git-policy.js';
import { SCOUT_LAUNCH_CONTRACT_HASH, CONTROLLED_SCOUT_NAME } from './controlled-scout.js';
import { verifyTranscript, verifyTranscriptBytes, inventoryTree, inventoryHash, sourceFileIndex, DEFAULT_CONTROLLED_ROLE_TIMEOUT_MS } from './controlled-agent-runtime.js';

/** A failed read-only analysis may be explicitly repeated after takeover. An
 * aborted, unexecuted result call is not an accepted result or schema repair. */
export function scoutRecoveryData(ledger:StoredLedger,store:Pick<DurableStore,'read'|'agentDataRoot'>){
 const s=ledger.state,run=s.runs.at(-1),deny=():never=>{throw new Error('SCOUT_RECOVERY_UNAVAILABLE')};
 if(ledger.truncatedTailBytes||s.state!=='BLOCKED'||s.blockedReason!=='Scout dispatch/result failed'||s.candidate
   ||!run||run.role!=='Scout'||run.resultRef||!run.runId||!run.childSessionId||!run.terminalProofRef||run.requestId.startsWith('intent-')
   ||s.runs.some(r=>r.role!=='Scout'||r.status!=='TERMINAL'||!r.terminalProofRef||r.resultRef))deny();
 const get=(id:string)=>{const r=ledger.records.find(r=>r.id===id);if(!r||s.invalidEvidenceIds.includes(id))deny();
  const encoded=canonicalize(r!.value),ref:ArtifactRef=r!.kind==='ArtifactRef'?r!.value:{schemaVersion:1,id,digest:hashCanonical(r!.value),bytes:Buffer.byteLength(encoded,'utf8'),relativeStorePath:`artifacts/${id}`,mediaType:'application/json'};
  const raw=store.read(ref);if(r!.kind!=='ArtifactRef'&&Buffer.from(raw).toString('utf8')!==encoded)deny();return {record:r!,raw,ref};};
 const sr=get(s.spec.id),ar=get(run!.assignmentId),pr=get(run!.terminalProofRef!);
 if(sr.record.kind!=='TaskSpec'||ar.record.kind!=='AssignmentEnvelope')deny();
 const spec=sr.record.value as TaskSpec,a=ar.record.value as import('./contracts.js').AssignmentEnvelope;
 if(!validateStructure('TaskSpec',spec).ok||hashContract('TaskSpec',spec)!==s.specHash||spec.specHash!==s.specHash
   ||!validateStructure('AssignmentEnvelope',a).ok||hashContract('AssignmentEnvelope',a)!==a.assignmentHash
   ||a.taskId!==s.taskId||a.specHash!==s.specHash||a.role!=='Scout'||a.launchContractHash!==SCOUT_LAUNCH_CONTRACT_HASH||a.context!=='fresh'
   ||canonicalize(a.authority)!==canonicalize(['OP-01'])||a.attemptId!==run!.attemptId||a.repoRoot!==s.repoRoot||a.workRoot!==s.repoRoot
   ||a.baseRef!==spec.scope.baseRef||a.baseCommit!==undefined&&a.baseCommit!==s.baselineCommit||spec.scope.repoRoot!==s.repoRoot
   ||canonicalize(a.requirements)!==canonicalize(spec.requirements)||canonicalize(a.acceptanceCriteria)!==canonicalize(spec.acceptanceCriteria)
   ||canonicalize(a.constraints)!==canonicalize(spec.constraints)||canonicalize(a.validationCommands)!==canonicalize(spec.validationCommands)
   ||canonicalize(a.allowedPaths)!==canonicalize(spec.scope.allowedPaths)
   ||canonicalize(a.deniedPaths)!==canonicalize(spec.scope.deniedPaths)||s.counters.infrastructureRetries>=spec.retryPolicy.maxInfrastructureRetries
   ||s.counters.dispatches>=spec.retryPolicy.maxDispatches)deny();
 const proof=JSON.parse(Buffer.from(pr.raw).toString('utf8'));
 if(proof.terminalStatus!=='failed'||!verifyTerminalProof(proof,{role:'Scout',runId:run!.runId!,requestId:run!.requestId,
   ownerSessionId:run!.ownerSessionId,childSessionId:run!.childSessionId!}))deny();
 const path=run!.childSessionId!,stat=lstatSync(path);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16*1024*1024||realpathSync(path)!==path)deny();
 verifyTranscript(path,a.workRoot,CONTROLLED_SCOUT_NAME,['read','structured_output'],['read','structured_output']);
 const transcript=readFileSync(path),rows=transcript.toString('utf8').split('\n').filter(Boolean).map(row=>JSON.parse(row));
 for(const row of rows){const message=row.message;
   if(row.type!=='message'||message?.role!=='assistant'||!Array.isArray(message.content))continue;
   for(const part of message.content)if(part.type==='toolCall'&&part.name==='structured_output'){
     if(message.stopReason!=='aborted'||typeof part.id!=='string'||rows.some(result=>result.type==='message'
       &&['tool','toolResult'].includes(result.message?.role)&&result.message.toolCallId===part.id))deny();
   }
 }
 const git=new CandidateGit(s.repoRoot,store.agentDataRoot),targetRef=git.target();git.assertTarget(targetRef,s.baselineCommit);
 const inventory=inventoryTree(s.repoRoot);
 return {schemaVersion:1,action:'RETRY_READ_ONLY_ANALYSIS',taskId:s.taskId,specHash:s.specHash,assignmentId:a.assignmentId,
   terminalProofRef:pr.ref,transcriptDigest:hashBytes(transcript),baselineCommit:s.baselineCommit!,targetRef,
   repositoryInventoryHash:inventoryHash(inventory),sourceIndexHash:hashBytes(Buffer.from(sourceFileIndex(inventory),'utf8')),
   deadlineMs:DEFAULT_CONTROLLED_ROLE_TIMEOUT_MS,infrastructureRetriesBefore:s.counters.infrastructureRetries};
}

/** Narrow pre-writer recovery: preserve the accepted Scout and the consumed old
 * approval. The host-selected promotion binding is the only worktree authority.
 * This observation does not authorize a writer or repair any source bytes. */
export function scopeBaselineRecoveryData(ledger:StoredLedger,store:Pick<DurableStore,'read'|'agentDataRoot'>){
 const s=ledger.state,deny=():never=>{throw new Error('SCOPE_BASELINE_RECOVERY_UNAVAILABLE')};
 if(ledger.truncatedTailBytes||!['BLOCKED','AWAITING_HUMAN','READY'].includes(s.state)
   ||s.blockedReason!=='Scope baseline could not be proven'||s.candidate||s.runs.length!==1
   ||s.runs[0].role!=='Scout'||s.runs[0].status!=='TERMINAL'||!s.runs[0].resultRef||!s.runs[0].terminalProofRef
   ||s.counters.attempts!==1||s.counters.dispatches!==1
   ||ledger.records.some(r=>r.kind==='AssignmentEnvelope'&&r.value.role!=='Scout'))deny();
 const block=ledger.events.findLast(e=>e.transitionId==='TR-012'&&e.reason==='Scope baseline could not be proven');
 if(!block||block.sourceState!=='READY'||block.targetState!=='BLOCKED'
   ||ledger.events.slice(ledger.events.indexOf(block)+1).some(e=>e.recordType==='SPAWN_INTENT'))deny();
 const specRecord=ledger.records.find(r=>r.id===s.spec.id&&r.kind==='TaskSpec');
 if(specRecord?.kind!=='TaskSpec')deny();const spec=specRecord!.value as TaskSpec;
 if(spec.specHash!==s.specHash||hashContract('TaskSpec',spec)!==s.specHash||spec.scope.repoRoot!==s.repoRoot
   ||canonicalize(spec)!==Buffer.from(store.read(s.spec)).toString('utf8')||s.counters.dispatches>=spec.retryPolicy.maxDispatches)deny();
 const approved=ledger.records.filter(r=>r.kind==='HumanGate'&&r.value.type==='beforeImplementation'&&r.value.status==='CONSUMED'
   &&r.value.humanDecisionRef&&r.value.consumedEventId&&ledger.events.some(e=>e.id===r.value.consumedEventId&&e.revision<block!.revision)).at(-1);
 if(approved?.kind!=='HumanGate'||approved.value.specHash!==s.specHash||s.invalidEvidenceIds.includes(approved.id))deny();
 const oldGate=approved!.value as HumanGate;
 const prior=JSON.parse(Buffer.from(store.read(oldGate.approvedData)).toString('utf8'));
 const originalTreeHash=inventoryHash(inventoryTree(s.repoRoot,['.git']));
 if(prior.specHash!==s.specHash||prior.baselineCommit!==s.baselineCommit||prior.originalTreeHash!==originalTreeHash)deny();
 const promotion=CandidatePromotionRepository.open(store.agentDataRoot,s.repoRoot,()=> 'ACCEPT');
 if(!promotion)deny();const bound=promotion!.bindingEvidence(s.taskId),b=bound.binding;
 if(b.specHash!==s.specHash||b.baseCommit!==s.baselineCommit||b.candidateCommit||b.taskId!==s.taskId)deny();
 promotion!.git.assertTarget(b.targetRef,s.baselineCommit);
 const workRoot=promotion!.worktree(s.taskId);
 ScopeGuard.open(spec.scope,workRoot,s.baselineCommit!,0);
 const branch=execFileSync('git',['--no-optional-locks','-C',workRoot,'-c',`core.hooksPath=${promotion!.git.hooks}`,...HOST_GIT_CONFIG,
   'symbolic-ref','--quiet','HEAD'],{encoding:'utf8',timeout:10000,maxBuffer:4096,env:hostGitEnvironment()}).trim();
 if(branch!==b.candidateRef||promotion!.git.refHead(b.candidateRef)!==s.baselineCommit)deny();
 const stat=lstatSync(workRoot);
 return {schemaVersion:1,action:'REAUTHORIZE_UNSTARTED_DEVELOPER',taskId:s.taskId,specHash:s.specHash,
   blockedEventId:block!.id,blockedEventHash:block!.eventHash,blockedRevision:block!.revision,
   previousApprovalId:approved!.id,previousApprovalHash:oldGate.approvedDataHash,
   baselineCommit:s.baselineCommit!,targetRef:b.targetRef,candidateRef:b.candidateRef,promotionBindingRef:bound.ref,workRoot,
   workRootIdentity:{dev:stat.dev,ino:stat.ino},worktreeHash:inventoryHash(inventoryTree(workRoot,['.git'])),
   originalTreeHash,scoutResultId:s.runs[0].resultRef,scoutTerminalProofRef:s.runs[0].terminalProofRef,
   attempts:s.counters.attempts,dispatches:s.counters.dispatches};
}

/** Eligibility is read-only, not retry authority. Recheck the immutable ledger and
 * external transcript at presentation, consumption and before a new writer. Only
 * initial dispatches with no effects are supported; partial work is never reset. */
export function developerRecoveryData(ledger:StoredLedger,store:Pick<DurableStore,'read'|'agentDataRoot'>){
  const s=ledger.state,run=s.runs.at(-1),deny=():never=>{throw new Error('DEVELOPER_RECOVERY_UNAVAILABLE')};
  if(ledger.truncatedTailBytes||!['BLOCKED','AWAITING_HUMAN','READY'].includes(s.state)
    ||s.blockedReason!=='Developer dispatch/result failed'||s.candidate||s.runs.some(r=>!runQuiescent(r))
    ||s.runs.some(r=>r.role==='Developer'&&r.resultRef)
    ||!run||run.role!=='Developer'||run.resultRef||!run.runId||!run.childSessionId||!run.terminalProofRef||run.requestId.startsWith('intent-'))deny();
  const record=(id:string)=>{const r=ledger.records.find(r=>r.id===id);if(!r||s.invalidEvidenceIds.includes(id))deny();
    const bytes=canonicalize(r!.value),ref:ArtifactRef=r!.kind==='ArtifactRef'?r!.value:{schemaVersion:1,id,digest:hashCanonical(r!.value),
      bytes:Buffer.byteLength(bytes,'utf8'),relativeStorePath:`artifacts/${id}`,mediaType:'application/json'};
    return {record:r!,ref,raw:store.read(ref)};};
  const specRecord=record(s.spec.id),assignmentRecord=record(run!.assignmentId),proof=record(run!.terminalProofRef!);
  if(specRecord.record.kind!=='TaskSpec'||assignmentRecord.record.kind!=='AssignmentEnvelope')deny();
  const spec=specRecord.record.value as TaskSpec,assignment=assignmentRecord.record.value as import('./contracts.js').AssignmentEnvelope;
  if(!validateStructure('TaskSpec',spec).ok||hashContract('TaskSpec',spec)!==s.specHash||spec.specHash!==s.specHash
    ||canonicalize(spec)!==Buffer.from(store.read(s.spec)).toString('utf8')||spec.scope.repoRoot!==s.repoRoot
    ||!validateStructure('AssignmentEnvelope',assignment).ok||hashContract('AssignmentEnvelope',assignment)!==assignment.assignmentHash
    ||assignment.taskId!==s.taskId||assignment.role!=='Developer'||assignment.specHash!==s.specHash||assignment.attemptId!==run!.attemptId
    ||assignment.baseCommit!==s.baselineCommit||assignment.baseRef!==spec.scope.baseRef||assignment.repoRoot!==s.repoRoot
    ||assignment.candidateDigest!==undefined||assignment.candidateGeneration!==undefined
    ||canonicalize(assignment.allowedPaths)!==canonicalize(spec.scope.allowedPaths)
    ||canonicalize(assignment.deniedPaths)!==canonicalize(spec.scope.deniedPaths)
    ||canonicalize(assignment.requirements)!==canonicalize(spec.requirements)
    ||canonicalize(assignment.acceptanceCriteria)!==canonicalize(spec.acceptanceCriteria)
    ||canonicalize(assignment.constraints)!==canonicalize(spec.constraints)
    ||canonicalize(assignment.validationCommands)!==canonicalize(spec.validationCommands)
    ||canonicalize(assignment.authority)!==canonicalize(['OP-01','OP-02'])
    ||assignment.launchContractHash!==DEVELOPER_LAUNCH_CONTRACT_HASH||assignment.context!=='fresh'
    ||s.counters.dispatches>=spec.retryPolicy.maxDispatches)deny();
  const terminal=JSON.parse(Buffer.from(proof.raw).toString('utf8'));
  if(terminal.terminalStatus!=='failed'||!verifyTerminalProof(terminal,{runId:run!.runId!,requestId:run!.requestId,role:'Developer',
    ownerSessionId:run!.ownerSessionId,childSessionId:run!.childSessionId!}))deny();
  const path=run!.childSessionId!,stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>2*1024*1024||realpathSync(path)!==path)deny();
  const transcript=readFileSync(path),rows=Buffer.from(transcript).toString('utf8').split('\n').filter(Boolean).map(row=>JSON.parse(row));
  const assistants=rows.filter(row=>row.type==='message'&&row.message?.role==='assistant');
  if(!rows.some(row=>row.type==='session'&&row.cwd===assignment.workRoot)||!assistants.length
    ||rows.some(row=>row.type==='message'&&(['tool','toolResult'].includes(row.message?.role)
      ||Array.isArray(row.message?.content)&&row.message.content.some((c:any)=>c.type==='toolCall')))
    ||assistants.some(row=>row.message.stopReason!=='error'||!['fetch failed','WebSocket error'].includes(row.message.errorMessage)
      ||!Array.isArray(row.message.content)||row.message.content.length))deny();
  const git=new CandidateGit(s.repoRoot,store.agentDataRoot),targetRef=git.target();git.assertTarget(targetRef,s.baselineCommit);
  ScopeGuard.open(spec.scope,assignment.workRoot,s.baselineCommit!,0);
  const worktreeDigest=hashCanonical(workspaceManifest(assignment.workRoot,s.baselineCommit!));
  if(worktreeDigest!==hashCanonical(workspaceManifest(s.repoRoot,s.baselineCommit!)))deny();
  const base={schemaVersion:1,action:'RETRY_INFRASTRUCTURE',taskId:s.taskId,specHash:s.specHash,baselineCommit:s.baselineCommit,targetRef,
    assignmentId:run!.assignmentId,assignmentHash:assignment.assignmentHash,attemptId:run!.attemptId,requestId:run!.requestId,runId:run!.runId,
    terminalProofRef:proof.ref,transcriptDigest:hashBytes(transcript),worktreeDigest,launchContractHash:assignment.launchContractHash,
    failureCode:'DEVELOPER_CONNECTION_FAILED',providerError:assistants.at(-1)!.message.errorMessage as string,
    dispatches:s.counters.dispatches,maxInfrastructureRetries:spec.retryPolicy.maxInfrastructureRetries};
  const authorization=ledger.records.find(r=>r.id===`developer-retry-${run!.assignmentId}`);
  if(authorization){
    if(authorization.kind!=='ArtifactRef'||s.invalidEvidenceIds.includes(authorization.id))deny();
    const saved=JSON.parse(Buffer.from(store.read(authorization!.value as ArtifactRef)).toString('utf8'));
    const expected={...base,infrastructureRetriesBefore:s.counters.infrastructureRetries-1,infrastructureRetriesAfter:s.counters.infrastructureRetries};
    const failure=s.failures.at(-1);
    if(!failure||failure.phase!=='IMPLEMENTING'||failure.category!=='INFRA'||failure.code!==base.failureCode
      ||!failure.subjectIds.includes(base.assignmentId)||!failure.evidenceRefs.includes(base.terminalProofRef.id))deny();
    if(canonicalize(saved)!==canonicalize(expected)||expected.infrastructureRetriesBefore<0
      ||expected.infrastructureRetriesAfter>spec.retryPolicy.maxInfrastructureRetries)deny();
    return {...expected,retryAuthorizationRef:authorization!.value as ArtifactRef};
  }
  if(s.state!=='BLOCKED'||s.counters.infrastructureRetries>=spec.retryPolicy.maxInfrastructureRetries)deny();
  return {...base,infrastructureRetriesBefore:s.counters.infrastructureRetries,infrastructureRetriesAfter:s.counters.infrastructureRetries+1};
}

/** A valid bounded result is not an infrastructure failure. Repeating it requires
 * a fresh human gate, unchanged physical copies and a finite result-based budget. */
export function boundedDeveloperRecoveryData(ledger:StoredLedger,store:Pick<DurableStore,'read'|'agentDataRoot'>){
 const s=ledger.state,run=s.runs.at(-1),deny=():never=>{throw new Error('BOUNDED_DEVELOPER_RECOVERY_UNAVAILABLE')};
 if(ledger.truncatedTailBytes||!['BLOCKED','AWAITING_HUMAN','READY'].includes(s.state)||s.blockedReason!=='Developer reported a bounded blocker'
   ||s.candidate||!run||run.role!=='Developer'||!run.resultRef||!run.runId||!run.childSessionId||!run.terminalProofRef
   ||run.requestId.startsWith('intent-')||s.runs.some(r=>!runQuiescent(r)||r.status!=='TERMINAL'))deny();
 const get=(id:string)=>{const r=ledger.records.find(r=>r.id===id);if(!r||s.invalidEvidenceIds.includes(id))deny();
   const encoded=canonicalize(r!.value),ref:ArtifactRef=r!.kind==='ArtifactRef'?r!.value:{schemaVersion:1,id,digest:hashCanonical(r!.value),bytes:Buffer.byteLength(encoded,'utf8'),relativeStorePath:`artifacts/${id}`,mediaType:'application/json'};
   const raw=store.read(ref);if(r!.kind!=='ArtifactRef'&&Buffer.from(raw).toString('utf8')!==encoded)deny();return {record:r!,raw,ref};};
 const sr=get(s.spec.id),ar=get(run!.assignmentId),rr=get(run!.resultRef!);
 if(sr.record.kind!=='TaskSpec'||ar.record.kind!=='AssignmentEnvelope'||rr.record.kind!=='DeveloperResult')deny();
 const spec=sr.record.value as TaskSpec,a=ar.record.value as import('./contracts.js').AssignmentEnvelope,r=rr.record.value as import('./contracts.js').DeveloperResult;
 const records=[...ledger.records,{id:'bounded-recovery-state',kind:'WorkflowState' as const,value:s}];
 const runtimeRootMappings=s.runtimeBindingRef?verifiedRuntimeRootMappings(records,ledger.events,store):undefined;
 const mapping=runtimeRootMappingFor(s,runtimeRootMappings),p=mapping?.payload;
 const portable=p?.schemaVersion===2&&p.boundedBaseline.descriptor.assignmentId===a.assignmentId?p.boundedBaseline:undefined;
 const context={records,specId:s.spec.id,assignmentId:a.assignmentId,stateId:'bounded-recovery-state',modelExtracted:false,...(runtimeRootMappings?{runtimeRootMappings}:{})};
 if(!validateContract('TaskSpec',spec,context).ok||hashContract('TaskSpec',spec)!==s.specHash||spec.specHash!==s.specHash||!runtimeRootMatches(spec.scope.repoRoot,s.repoRoot,s,runtimeRootMappings)
   ||!validateContract('AssignmentEnvelope',a,context).ok||hashContract('AssignmentEnvelope',a)!==a.assignmentHash
   ||!runtimeRootMatches(a.repoRoot,s.repoRoot,s,runtimeRootMappings)||a.baseCommit!==s.baselineCommit||a.baseRef!==spec.scope.baseRef||a.candidateDigest!==undefined||a.candidateGeneration!==undefined
   ||a.launchContractHash!==DEVELOPER_LAUNCH_CONTRACT_HASH||a.context!=='fresh'||canonicalize(a.authority)!==canonicalize(['OP-01','OP-02'])
   ||a.attemptId!==run!.attemptId||a.role!=='Developer'||!validateContract('DeveloperResult',r,context).ok
   ||!r.blockedReason||r.changedFiles.length||r.commandsRun.length||!s.results.includes(run!.resultRef!)
   ||s.counters.dispatches>=spec.retryPolicy.maxDispatches)deny();
 for(const priorRun of s.runs){
   if(!priorRun.runId||!priorRun.childSessionId||!priorRun.terminalProofRef||priorRun.requestId.startsWith('intent-'))deny();
   const terminal=JSON.parse(Buffer.from(get(priorRun.terminalProofRef!).raw).toString('utf8'));
   if(!verifyTerminalProof(terminal,{runId:priorRun.runId!,requestId:priorRun.requestId,role:priorRun.role,ownerSessionId:priorRun.ownerSessionId,childSessionId:priorRun.childSessionId!})
     ||priorRun===run&&terminal.terminalStatus!=='complete')deny();
 }
 const acceptedBlocked=s.runs.filter(prior=>prior.role==='Developer'&&prior.resultRef&&ledger.records.some(record=>record.id===prior.resultRef&&record.kind==='DeveloperResult'&&!!record.value.blockedReason)).length;
 const boundedRetriesBefore=acceptedBlocked-1,maxBoundedRetries=spec.retryPolicy.maxReworkAttempts;
 if(boundedRetriesBefore<0||boundedRetriesBefore>=maxBoundedRetries)deny();
 let transcript:Uint8Array,transcriptArtifactRef:ArtifactRef|undefined;
 const workRoot=portable?.workRoot??a.workRoot;
 if(portable){
   const binding=JSON.parse(Buffer.from(get(s.runtimeBindingRef!.id).raw).toString('utf8')) as RuntimeRootBinding;
   if(!binding.boundedTranscriptRef||!binding.boundedBaselineRef||!sameRuntimePayload(binding.payload,p!)
     ||portable.descriptor.assignmentHash!==a.assignmentHash||portable.descriptor.originalWorkRoot!==a.workRoot
     ||portable.descriptor.originalTranscriptPath!==run!.childSessionId||portable.descriptor.resultRef.id!==run!.resultRef
     ||portable.descriptor.terminalProofRef.id!==run!.terminalProofRef)deny();
   const evidence=get(binding.boundedTranscriptRef!.id);if(!sameRuntimePayload(evidence.ref,binding.boundedTranscriptRef!))deny();
   transcript=evidence.raw;transcriptArtifactRef=evidence.ref;
   verifyTranscriptBytes(transcript,a.workRoot,CONTROLLED_DEVELOPER_NAME,['read','edit','write','structured_output'],['read','structured_output']);
 }else{
   const path=run!.childSessionId!,stat=lstatSync(path);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16*1024*1024||realpathSync(path)!==path)deny();
   verifyTranscript(path,a.workRoot,CONTROLLED_DEVELOPER_NAME,['read','edit','write','structured_output'],['read','structured_output']);
   transcript=readFileSync(path);
 }
 const block=ledger.events.findLast(e=>e.transitionId==='TR-015'&&e.reason==='Developer reported a bounded blocker');
 if(!block||block.sourceState!=='IMPLEMENTING'||block.targetState!=='BLOCKED'
   ||ledger.events.slice(ledger.events.indexOf(block)+1).some(e=>e.recordType==='SPAWN_INTENT'))deny();
 const approval=ledger.records.filter(record=>record.kind==='HumanGate'&&record.value.type==='beforeImplementation'&&record.value.status==='CONSUMED'
   &&record.value.specHash===s.specHash&&record.value.consumedEventId&&ledger.events.some(e=>e.id===record.value.consumedEventId&&e.revision<block!.revision)).at(-1);
 if(approval?.kind!=='HumanGate')deny();
 // Import retires the old writer approval. Its consumed bytes remain a historical
 // canary only when an authenticated current binding covers this exact blocker
 // on the unchanged host paths. A new human gate is still required below.
 let historicalApprovalBindingRef:ArtifactRef|undefined;
 if(s.invalidEvidenceIds.includes(approval!.id)){
   if(!mapping||!p||(!portable&&p.previousRepoRoot!==s.repoRoot)||p.repoRoot!==s.repoRoot||p.historicalRepoRoot!==spec.scope.repoRoot
     ||(!portable&&p.resumeState!=='BLOCKED')||(portable&&!['BLOCKED','READY'].includes(p.resumeState))||p.sourceRevision<block!.revision||p.previousCandidateRoot!==null||p.candidateRoot!==null)deny();
   historicalApprovalBindingRef=s.runtimeBindingRef;
 }
 const oldGate=approval!.value as HumanGate;
 const prior=JSON.parse(Buffer.from(store.read(oldGate.approvedData)).toString('utf8'));
 const originalTreeHash=inventoryHash(inventoryTree(s.repoRoot,['.git']));
 const historicalSourceCanaryDigest=portable?.descriptor.sourceCanaryDigest;
 if(prior.specHash!==s.specHash||prior.baselineCommit!==s.baselineCommit||prior.originalTreeHash!==(historicalSourceCanaryDigest??originalTreeHash)
   ||portable&&(portable.descriptor.previousApprovalId!==approval!.id||portable.descriptor.previousApprovalHash!==oldGate.approvedDataHash))deny();
 const git=new CandidateGit(s.repoRoot,store.agentDataRoot),targetRef=git.target();git.assertTarget(targetRef,s.baselineCommit);
 const guard=ScopeGuard.open({...spec.scope,repoRoot:s.repoRoot},workRoot,s.baselineCommit!,0);
 const worktreeDigest=hashCanonical(workspaceManifest(workRoot,s.baselineCommit!));
 if(worktreeDigest!==hashCanonical(guard.baselineManifest())||portable&&worktreeDigest!==portable.descriptor.manifestDigest)deny();
 const workStat=lstatSync(workRoot);
 return {schemaVersion:1,action:'REAUTHORIZE_BOUNDED_DEVELOPER',taskId:s.taskId,specHash:s.specHash,assignmentId:a.assignmentId,assignmentHash:a.assignmentHash,
   resultRef:rr.ref,terminalProofRef:get(run!.terminalProofRef!).ref,blockedEventId:block!.id,blockedEventHash:block!.eventHash,
   previousApprovalId:approval!.id,previousApprovalHash:oldGate.approvedDataHash,...(historicalApprovalBindingRef?{historicalApprovalBindingRef}:{}),
   ...(historicalSourceCanaryDigest?{historicalSourceCanaryDigest}:{}),...(transcriptArtifactRef?{transcriptArtifactRef}:{}),baselineCommit:s.baselineCommit!,targetRef,workRoot,
   workRootIdentity:{dev:workStat.dev,ino:workStat.ino,mode:workStat.mode},worktreeDigest,worktreeHash:inventoryHash(inventoryTree(workRoot,['.git'])),originalTreeHash,transcriptDigest:hashBytes(transcript),
   blockedReason:r.blockedReason,boundedRetriesBefore,boundedRetriesAfter:boundedRetriesBefore+1,maxBoundedRetries,
   attempts:s.counters.attempts,dispatches:s.counters.dispatches,infrastructureRetries:s.counters.infrastructureRetries};
}
function sameRuntimePayload(a:unknown,b:unknown):boolean{return canonicalize(a)===canonicalize(b)}

export type ResumeAction='NO_ACTION_TERMINAL'|'REMAIN_BLOCKED'|'OPERATOR_RECONCILIATION_REQUIRED'|'RESUME_FROM_DURABLE_STATE'|
  'HUMAN_ACTION_REQUIRED'|'CHILD_RECONCILIATION_REQUIRED'|'P16C_REPAIR_REQUIRED';
function reviewerRedispatchCheckpoint(ledger:StoredLedger):boolean{
  const s=ledger.state,failure=s.failures.at(-1),reviewer=s.runs.findLast(run=>run.role==='Reviewer');
  if(!s.candidate||!failure||failure.phase!=='REVIEWING'||failure.category!=='INFRA'||!reviewer||!runQuiescent(reviewer)||reviewer.resultRef
    ||reviewer.status==='TERMINAL'&&(!reviewer.runId||!reviewer.childSessionId||reviewer.requestId.startsWith('intent-'))
    ||!failure.subjectIds.includes(reviewer.assignmentId)||!failure.evidenceRefs.includes(runProofRef(reviewer)!)
    ||s.counters.infrastructureRetries<1||s.counters.infrastructureRetries>s.counters.attempts
    ||s.counters.dispatches>=((ledger.records.find(record=>record.kind==='TaskSpec'&&record.id===s.spec.id)?.value as TaskSpec|undefined)?.retryPolicy.maxDispatches??0)
    ||!ledger.records.some(record=>record.kind==='ArtifactRef'&&record.id===`retry-authorization-${failure.id}`))return false;
  if(s.state==='BLOCKED')return s.blockedReason==='Reviewer batch failed';
  if(s.state!=='REVIEWING')return false;
  const gate=[...s.gates].reverse().map(id=>ledger.records.find(record=>record.kind==='HumanGate'&&record.id===id))
    .find(record=>record?.kind==='HumanGate'&&record.value.type==='beforeReviewerRedispatch'&&record.value.status==='CONSUMED');
  if(gate?.kind!=='HumanGate'||!gate.value.consumedEventId)return false;
  const index=ledger.events.findIndex(event=>event.id===gate.value.consumedEventId);
  return index>=0&&!ledger.events.slice(index+1).some(event=>event.recordType==='SPAWN_INTENT');
}
export function classifyResumeAction(dataRoot:string,storeRoot:string):{action:ResumeAction;lastSafeState:string;automaticResumeAllowed:false;message:string} {
  let ledger:StoredLedger;try{ledger=DurableStore.load(storeRoot)}catch{return {action:'P16C_REPAIR_REQUIRED',lastSafeState:'UNVERIFIED',automaticResumeAllowed:false,message:"Incomplete or inconsistent store; no automatic repair."}}
  const s=ledger.state,r=classifyRecoveryState(dataRoot,storeRoot).recovery;
  let action:ResumeAction;
  if(ledger.truncatedTailBytes||r.classification==='STORE_INCONSISTENT'||s.runs.some(run=>run.status==='INTENT'))action='P16C_REPAIR_REQUIRED';
  else if(['COMPLETED','FAILED'].includes(s.state))action='NO_ACTION_TERMINAL';
  else if(s.runs.some(run=>!runQuiescent(run))){
    let reconciled:ReconciliationAttempt[]=[];try{reconciled=reconciledQuiescentAttempts(dataRoot,ledger)}catch{}
    action=s.runs.every(run=>runQuiescent(run)||reconciled.some(a=>a.assignmentId===run.assignmentId))?'OPERATOR_RECONCILIATION_REQUIRED':'CHILD_RECONCILIATION_REQUIRED';
  }
  else if(s.state==='BLOCKED'){
    let developer=false,scout=false,scope=false,bounded=false;const store={agentDataRoot:dataRoot,read:(ref:ArtifactRef)=>DurableStore.readArtifact(storeRoot,ref)};
    try{developerRecoveryData(ledger,store);developer=true}catch{}
    try{scoutRecoveryData(ledger,store);scout=true}catch{}
    try{scopeBaselineRecoveryData(ledger,store);scope=true}catch{}
    try{boundedDeveloperRecoveryData(ledger,store);bounded=true}catch{}
    action=reviewerRedispatchCheckpoint(ledger)||developer||scout||scope||bounded?'RESUME_FROM_DURABLE_STATE':'REMAIN_BLOCKED';
  }
  else if(s.state==='AWAITING_HUMAN'){
    const gate=ledger.records.find(v=>v.id===s.pendingGateId&&v.kind==='HumanGate');
    action=gate?.kind==='HumanGate'&&gate.value.status==='PENDING'&&!ledger.records.some(v=>v.kind==='HumanDecisionEvidence'&&v.value.gateId===gate.value.id)?'HUMAN_ACTION_REQUIRED':'P16C_REPAIR_REQUIRED';
  }else if(s.state==='REVIEWING'&&reviewerRedispatchCheckpoint(ledger))action='RESUME_FROM_DURABLE_STATE';
  else if(s.runtimeBindingRef&&s.state==='TESTING'&&s.candidate)action='RESUME_FROM_DURABLE_STATE';
  else if(['IMPLEMENTING','TESTING','REVIEWING','REWORK'].includes(s.state))action='P16C_REPAIR_REQUIRED';
  else if(s.state==='ANALYZING'){
    const run=[...s.runs].reverse().find(run=>run.role==='Scout'),result=ledger.records.find(v=>v.id===run?.resultRef&&v.kind==='ScoutResult');
    const spec=ledger.records.find(v=>v.id===s.spec.id&&v.kind==='TaskSpec');
    const coverage=spec?.kind==='TaskSpec'?scoutClarificationCoverage({spec:spec.value,state:s,records:ledger.records,events:ledger.events},
      {read:(ref:ArtifactRef)=>DurableStore.readArtifact(storeRoot,ref)}):undefined;
    action=!run?'RESUME_FROM_DURABLE_STATE':result?.kind==='ScoutResult'&&coverage?.status!=='INVALID_EVIDENCE'&&coverage!==undefined
      ?'RESUME_FROM_DURABLE_STATE':'OPERATOR_RECONCILIATION_REQUIRED';
  }else action='RESUME_FROM_DURABLE_STATE';
  const messages:Record<ResumeAction,string>={NO_ACTION_TERMINAL:"Task ended: verification only, no resume.",REMAIN_BLOCKED:"Task blocked: explicit operator reconciliation required.",
    OPERATOR_RECONCILIATION_REQUIRED:"New verifiable evidence is required before continuing.",RESUME_FROM_DURABLE_STATE:"Durable checkpoint: explicit resume is possible only after verified takeover.",
    HUMAN_ACTION_REQUIRED:"A human decision is required in a new verified TUI presentation.",CHILD_RECONCILIATION_REQUIRED:"Termination of an agent from the previous execution cannot be established with certainty. The task will not resume automatically. No new agent will start.",P16C_REPAIR_REQUIRED:"Cannot resume: store repair is required."};
  let legacyReceipt=false;try{legacyReceipt=reconciledQuiescentAttempts(dataRoot,ledger).some(a=>a.result==='VERIFIED_NOT_DISPATCHED')}catch{}
  const message=legacyReceipt&&action==='OPERATOR_RECONCILIATION_REQUIRED'?"The package verified that the previous review request was never sent. Work and completed checks are preserved. Perform explicit recovery before confirming another review attempt.":action==='RESUME_FROM_DURABLE_STATE'&&s.state==='BLOCKED'&&s.blockedReason==='Developer dispatch/result failed'
    ?"The Developer stopped because of a connection error without effects. In the owning session, use /controlled-dev resume: the attempt allowed by policy requires a new confirmation. After a restart, run /controlled-dev recover first."
    :action==='RESUME_FROM_DURABLE_STATE'&&s.blockedReason==='Scope baseline could not be proven'
    ?"Development stopped before the Developer started. The package rechecked the approved baseline and the same isolated copy. Recovery preserves the analysis and counters; a new explicit confirmation is required before development starts."
    :action==='RESUME_FROM_DURABLE_STATE'&&s.state==='ANALYZING'?"The saved analysis can be resumed in the new session. Any questions require confirmed answers before development; the accepted Scout analysis is not repeated.":messages[action];
  return {action,lastSafeState:s.state,automaticResumeAllowed:false,message:`Task interrupted. Last verified state: ${s.state}. ${message}`};
}
export interface RecoveryAuthority {readonly taskId:string;readonly recoveryRecordId:string;readonly processIncarnation:ProcessIncarnation;
  readonly classification:string;readonly takeoverToken:string;readonly acquiredAt:string;readonly sessionId:string;readonly recordRef:ArtifactRef}
interface Lease {store:DurableStore;ledger:StoredLedger;spec:TaskSpec;manager:LockManager;locks:WorkflowLocks;claimed:boolean;reconciliations:ReconciliationAttempt[];
 runtimeBinding?:{ref:ArtifactRef;value:RuntimeRootBinding}}
const authorities=new WeakMap<object,Lease>();
/** A transfer release and a new native local decision replace ownership only.
 * Neither previous approvals nor counters are reset or replayed. */
export function takeOverImportedWorkflow(capability:ProjectRuntimeImportCapability):RecoveryAuthority {
 const acquired=projectRuntimeImportLease(capability,true),p=acquired.proposal.payload;
 const incarnation=currentProcessIncarnation();if(!incarnation)throw new Error('OWNER_INCARNATION_UNAVAILABLE');
 const store=DurableStore.reopenImported(capability);
 store.import(acquired.confirmationRef,acquired.confirmationRaw);
 const baseline=acquired.boundedBaselineEvidence;
 if(baseline){store.import(baseline.descriptorRef,baseline.descriptorRaw);store.import(baseline.transcriptRef,baseline.transcriptRaw)}
 const handoffRef=store.put(`handoff-import-${p.handoffDigest}`,acquired.handoffRaw,'application/vnd.pi-controlled-dev.project-handoff+json');
 const value:RuntimeRootBinding={schemaVersion:1,id:`runtime-binding-${randomUUID()}`,payload:p,confirmationRef:acquired.confirmationRef,handoffRef,
  ...(baseline?{boundedBaselineRef:baseline.descriptorRef,boundedTranscriptRef:baseline.transcriptRef}:{})};
 const ref=store.put(value.id,canonicalize(value),RUNTIME_ROOT_BINDING_MEDIA),token=randomUUID(),acquiredAt=new Date().toISOString();
 const document={schemaVersion:1,id:`takeover-${token}`,taskId:p.taskId,classification:'VERIFIED_PORTABLE_IMPORT',sessionId:acquired.sessionId,
  processIncarnation:incarnation,acquiredAt,revision:p.sourceRevision,eventHash:p.sourceEventHash,runtimeBindingRef:ref,
  taskLock:acquired.locks.task.record,workspaceLock:acquired.locks.workspace.record};
 const recordRef=store.put(document.id,canonicalize(document),'application/vnd.pi-controlled-dev.takeover+json');
 const authority=Object.freeze({taskId:p.taskId,recoveryRecordId:document.id,processIncarnation:incarnation,classification:document.classification,
  takeoverToken:token,acquiredAt,sessionId:acquired.sessionId,recordRef});
 authorities.set(authority,{store,ledger:acquired.ledger,spec:acquired.spec,manager:acquired.manager,locks:acquired.locks,claimed:false,reconciliations:[],runtimeBinding:{ref,value}});return authority;
}
function read(path:string):any{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>1024*1024)throw new Error('RECOVERY_EVIDENCE_INVALID');return parseJson(readFileSync(path),1024*1024)}
/** Host-selected paths/session; JSON, model booleans and copied records are never handles. */
export function takeOverWorkflow(dataRoot:string,storeRoot:string,sessionId:string,reason:string,inspect:ArtifactInspection):RecoveryAuthority {
  if(!validateScalar('Text',sessionId).ok||!validateScalar('Text',reason).ok)throw new Error('TAKEOVER_INPUT_INVALID');
  const action=classifyResumeAction(dataRoot,storeRoot).action;
  if(['NO_ACTION_TERMINAL','P16C_REPAIR_REQUIRED','CHILD_RECONCILIATION_REQUIRED'].includes(action))throw new Error(action);
  const incarnation=currentProcessIncarnation();if(!incarnation)throw new Error('OWNER_INCARNATION_UNAVAILABLE');
  const ledger=DurableStore.load(storeRoot),s=ledger.state;
  const reclaimed=recoverLocks(dataRoot,storeRoot),lockRoot=join(dataRoot,'controlled-dev','locks');
  const ids=reclaimed.auditId?[reclaimed.auditId]:readdirSync(lockRoot).filter(v=>/^recovery-[a-f0-9-]+\.json$/.test(v)).map(v=>v.slice(0,-5));
  let death:any,recoveryRecordId:string|undefined;
  for(const id of ids){try{const evidence=read(join(lockRoot,`${id}.json`)),done=read(join(lockRoot,`${id}-complete.json`));
    if(evidence.taskId===s.taskId&&evidence.revision===s.revision&&evidence.eventHash===ledger.events.at(-1)!.eventHash&&
      evidence.classification==='STALE_LOCK_PROVABLE'&&evidence.authorization==='RECLAIM_LOCK_PAIR_ONLY'&&done.id===id&&done.outcome==='PAIR_RECLAIMED'&&
      evidence.oldOwners?.length===2&&evidence.oldOwners.every((o:any)=>o.record.ownerSessionId===s.ownerSessionId&&inspectProcessOwner(o.record.processIncarnation).status==='DEAD')){
        death=evidence;recoveryRecordId=id;break;
      }
  }catch{}}
  if(!death||!recoveryRecordId)throw new Error('TAKEOVER_OWNER_DEATH_UNPROVEN');
  const manager=new LockManager(dataRoot,sessionId,`takeover-${randomUUID()}`),locks=manager.acquire(s.taskId,s.repoRoot);
  // On any uncertain durable takeover, retain both ordinary locks: another host cannot silently proceed.
  const latest=DurableStore.load(storeRoot);if(canonicalize(latest)!==canonicalize(ledger))throw new Error('TAKEOVER_REVISION_CHANGED');
  const store=DurableStore.reopen(storeRoot,manager,locks,inspect),specRecord=ledger.records.find(r=>r.id===s.spec.id&&r.kind==='TaskSpec');
  if(!specRecord||specRecord.kind!=='TaskSpec')throw new Error('TAKEOVER_SPEC_MISSING');
  const token=randomUUID(),acquiredAt=new Date().toISOString(),reclaimRef=store.put(`reclaim-${token}`,canonicalize(death),'application/vnd.pi-controlled-dev.reclaim+json');
  const document={schemaVersion:1,id:`takeover-${token}`,taskId:s.taskId,recoveryRecordId,classification:'STALE_LOCK_PROVABLE',takeoverToken:token,
    previousOwnerSessionId:s.ownerSessionId,previousProcessIncarnation:death.oldOwners[0].record.processIncarnation,processIncarnation:incarnation,sessionId,
    acquiredAt,reason,revision:s.revision,eventHash:ledger.events.at(-1)!.eventHash,reclaimRef,
    taskLock:locks.task.record,workspaceLock:locks.workspace.record};
  const recordRef=store.put(document.id,canonicalize(document),'application/vnd.pi-controlled-dev.takeover+json');
  const authority=Object.freeze({taskId:s.taskId,recoveryRecordId,processIncarnation:incarnation,classification:document.classification,takeoverToken:token,acquiredAt,sessionId,recordRef});
  authorities.set(authority,{store,ledger,spec:specRecord.value,manager,locks,claimed:false,reconciliations:reconciledQuiescentAttempts(dataRoot,ledger)});return authority;
}
export function recoveryLease(authority:RecoveryAuthority,claim=false):Lease {
  const lease=authorities.get(authority);
  if(!lease||inspectProcessOwner(authority.processIncarnation).status!=='LIVE'||!lease.manager.verifyTaskLock(lease.locks.task)||
    !lease.manager.verifyWorkspaceLock(lease.locks.workspace))throw new Error('RECOVERY_AUTHORITY_INVALID');
  if(hashCanonical(JSON.parse(Buffer.from(lease.store.read(authority.recordRef)).toString('utf8'))) !==authority.recordRef.digest)throw new Error('TAKEOVER_RECORD_INVALID');
  if(claim){if(lease.claimed)throw new Error('RECOVERY_AUTHORITY_ALREADY_CLAIMED');lease.claimed=true}
  return lease;
}
/** Explicit host request only; status/load never invokes this operation. Cached attempts prevent automatic repeat queries. */
export async function reconcileUnknownChildren(dataRoot:string,storeRoot:string,rpc?:RpcAdapter,sessionId?:string,recheck=false){
  const ledger=DurableStore.load(storeRoot),observations=[];
  if(ledger.truncatedTailBytes||ledger.state.runs.some(r=>r.status==='INTENT'))throw new Error('P16C_REPAIR_REQUIRED');
  const prior=reconciliationAttempts(dataRoot,ledger);
  for(const run of ledger.state.runs.filter(r=>r.status==='UNKNOWN'||r.status==='RUNNING'||r.status==='BOUND')){
    const previous=prior.find(a=>a.assignmentId===run.assignmentId&&a.eventHash===ledger.events.at(-1)!.eventHash);
    if(previous&&(!recheck||previous.result!=='UNRESOLVED')){observations.push(previous);continue}
    // Compatibility for the old diagnostic API: without a trusted host session it cannot write.
    if(!sessionId){observations.push({assignmentId:run.assignmentId,proofAvailable:false});continue}
    // RPC v1 has no public completion replay or historical process-terminal proof.
    // Current-session status cannot re-bind a prior request/child/role tuple, so
    // recovery must remain UNKNOWN even when the new provider supports live proof.
    void rpc;
    observations.push(recordReconciliationAttempt(dataRoot,storeRoot,sessionId,run.assignmentId,'UNRESOLVED','PROVIDER_HISTORY_UNAVAILABLE'));
  }
  return {resume:classifyResumeAction(dataRoot,storeRoot),observations};
}
