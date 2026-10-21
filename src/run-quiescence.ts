import type { ArtifactRef, AssignmentEnvelope, RunRecord } from './contracts.js';
/** A local host receipt is distinct from evidence of a child process exiting. */
export interface ReviewerNoDispatchProof {
  readonly schemaVersion:1; readonly source:'reviewer-host-before-spawn'; readonly taskId:string;
  readonly specHash:string; readonly assignmentId:string; readonly assignmentHash:string; readonly attemptId:string;
  readonly ownerSessionId:string; readonly runtimeGeneration:string; readonly launchContractHash:string;
  readonly candidateDigest:string; readonly candidateGeneration:number; readonly code:string; readonly observedAt:string;
  readonly legacyProtocol?:LegacyReviewerPreflightEvidence;
}
export interface LegacyReviewerPreflightEvidence {readonly schemaVersion:1;readonly method:'FROZEN_FULL_MANIFEST_REQUEST_LIMIT';
 readonly installedPackageDigest:string;readonly reviewerSourceHash:string;readonly rpcSourceHash:string;readonly bridgeSourceHash:string;readonly requestLimit:262144;
 readonly manifestRef:ArtifactRef;readonly manifestByteLowerBound:number;readonly originalHost:{readonly platform:'linux';readonly bootId:string;readonly pidNamespace:string;readonly pid:number;readonly startTicks:string};
 readonly originalLocksHash:string;readonly originalParentPid:number;readonly originalParentStartTicks:string;readonly originalSessionHeaderHash:string;readonly installedRoot:string;readonly bridgePath:string;
 readonly launchStartedAt:string;readonly ledgerRevision:number;readonly ledgerEventHash:string}
export function runQuiescent(run:RunRecord):boolean {
  return run.status==='TERMINAL'&&!!run.terminalProofRef||run.status==='NOT_DISPATCHED'&&!!run.dispatchProofRef;
}
export function runProofRef(run:RunRecord):string|undefined{return run.status==='NOT_DISPATCHED'?run.dispatchProofRef:run.terminalProofRef}
export function runQuiescenceProjection(run:RunRecord){return run.status==='NOT_DISPATCHED'
  ?{assignmentId:run.assignmentId,dispatchProofRef:run.dispatchProofRef}
  :{assignmentId:run.assignmentId,runId:run.runId,terminalProofRef:run.terminalProofRef}}
/** Checks persisted receipt data and bindings; arbitrary JSON never authenticates a live receipt. */
export function verifyReviewerNoDispatchProof(input:unknown,assignment:AssignmentEnvelope,run:RunRecord):input is ReviewerNoDispatchProof {
 const p=input as ReviewerNoDispatchProof;
 const keys='assignmentHash,assignmentId,attemptId,candidateDigest,candidateGeneration,code,launchContractHash,observedAt,ownerSessionId,runtimeGeneration,schemaVersion,source,specHash,taskId';
 return !!p&&typeof p==='object'&&Object.keys(p).filter(k=>k!=='legacyProtocol').sort().join(',')===keys&&p.schemaVersion===1&&p.source==='reviewer-host-before-spawn'
  &&assignment.role==='Reviewer'&&run.role==='Reviewer'&&run.status==='NOT_DISPATCHED'&&!run.runId&&!run.childSessionId&&!run.resultRef&&!run.terminalProofRef
  &&run.requestId===`intent-${assignment.attemptId}`&&p.taskId===assignment.taskId&&p.specHash===assignment.specHash
  &&p.assignmentId===assignment.assignmentId&&p.assignmentHash===assignment.assignmentHash&&p.attemptId===assignment.attemptId&&run.attemptId===p.attemptId
  &&run.assignmentId===p.assignmentId&&run.ownerSessionId===p.ownerSessionId&&p.launchContractHash===assignment.launchContractHash
  &&p.candidateDigest===assignment.candidateDigest&&p.candidateGeneration===assignment.candidateGeneration
  &&typeof p.runtimeGeneration==='string'&&p.runtimeGeneration.length>0&&p.runtimeGeneration.length<=256
  &&(!Object.hasOwn(p,'legacyProtocol')||!!p.legacyProtocol&&verifyLegacyReviewerEvidence(p.legacyProtocol,assignment)&&p.code==='TASK_REQUEST_LIMIT')
  &&typeof p.code==='string'&&/^[A-Z][A-Z0-9_]{0,255}$/.test(p.code)&&typeof p.observedAt==='string'&&Number.isFinite(Date.parse(p.observedAt));
}

function verifyLegacyReviewerEvidence(e:LegacyReviewerPreflightEvidence,a:AssignmentEnvelope):boolean{
 const keys='bridgePath,bridgeSourceHash,installedPackageDigest,installedRoot,launchStartedAt,ledgerEventHash,ledgerRevision,manifestByteLowerBound,manifestRef,method,originalHost,originalLocksHash,originalParentPid,originalParentStartTicks,originalSessionHeaderHash,requestLimit,rpcSourceHash,schemaVersion,reviewerSourceHash'.split(',').sort().join(',');
 return !!e&&Object.keys(e).sort().join(',')===keys&&e.schemaVersion===1&&e.method==='FROZEN_FULL_MANIFEST_REQUEST_LIMIT'&&e.requestLimit===262144
  &&e.installedPackageDigest==='46ffc4b1979b124665d41dc7646589ee780bb04754279b656aa973d1f568c76f'
  &&e.reviewerSourceHash==='e9faec2bde26eaf07c7716ab2cd6931ded74162e7f85e410d7cfda0bb84d54ee'
  &&e.rpcSourceHash==='5302821f1af0a55c12e19ffa1c28f87dc04c3f23829ea367b60cc2b6eb3b1827'
  &&e.bridgeSourceHash==='f2dfaf9e32f7aa4ae7a7c24571b6df6500bf2207dffcd96f64af929ce4b8da01'
  &&e.manifestRef?.digest===a.candidateDigest&&e.manifestByteLowerBound>e.requestLimit&&e.manifestByteLowerBound<=e.manifestRef.bytes
  &&e.originalHost?.platform==='linux'&&Number.isSafeInteger(e.originalHost.pid)&&e.originalHost.pid>0&&/^\d+$/.test(e.originalHost.startTicks)
  &&/^[a-f0-9]{64}$/.test(e.originalLocksHash)&&/^[a-f0-9]{64}$/.test(e.originalSessionHeaderHash)
  &&/^[a-f0-9-]{36}$/.test(e.originalHost.bootId)&&/^pid:\[\d+\]$/.test(e.originalHost.pidNamespace)
  &&Number.isSafeInteger(e.originalParentPid)&&e.originalParentPid>0&&/^\d+$/.test(e.originalParentStartTicks)
  &&Number.isSafeInteger(e.manifestByteLowerBound)&&Number.isSafeInteger(e.ledgerRevision)&&e.ledgerRevision>=0&&/^[a-f0-9]{64}$/.test(e.ledgerEventHash)
  &&Number.isFinite(Date.parse(e.launchStartedAt));
}

/** Diagnostic counts retain historical reservations and distinguish a proven
 * no-send outcome from a provider run identity. They never replenish budgets. */
export function runExecutionCounts(runs:readonly RunRecord[]){
 return Object.freeze({reserved:runs.length,identifiedRuns:runs.filter(r=>!!r.runId).length,
   provenNotStarted:runs.filter(r=>r.status==='NOT_DISPATCHED'&&!!r.dispatchProofRef).length,
   uncertain:runs.filter(r=>!runQuiescent(r)).length});
}
