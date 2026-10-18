import { captureCandidateCheckpoint } from './candidate-checkpoints.js';
import { captureBoundedDeveloperCheckpoint } from './bounded-developer-checkpoint.js';
import { captureDeveloperBaseline, createReviewerBaselineContext } from './developer-baseline.js';
import type { DeveloperBaselineEvidence } from './developer-baseline.js';
import { sealProjectHandoff, releaseProjectHandoff, currentProjectHandoffCandidatePaths } from './project-handoff.js';
import { readProjectCustodian } from './project-custodian.js';
import { createScoutClarificationRequest, consumeScoutClarification, scoutClarificationCoverage, createScoutClarificationDelivery } from './scout-clarifications.js';
import { verifiedRuntimeRootMappings, runtimeRootMappingFor } from './runtime-root-binding.js';
import { createTrustedConfirmationRequest, consumeTrustedConfirmation, readTrustedConfirmationEvidence, TRUSTED_CONFIRMATION_MEDIA } from './trusted-confirmation.js';
import type { ScoutAnswerImpact, ScoutClarificationContext } from './scout-clarifications.js';
import type { TrustedConfirmationRequest, TrustedConfirmationReceipt } from './trusted-confirmation.js';
import { runQuiescent, runProofRef, verifyReviewerNoDispatchProof } from './run-quiescence.js';
import type { ReviewerNoDispatchProof } from './run-quiescence.js';
import { resolveDevelopmentProfile } from './development-profile.js';
import type { DevelopmentProfile } from './development-profile.js';
import { consumePolicyCapability, assertPolicyCapabilityCurrent, POLICY_AUTHORIZATION_MEDIA } from './policy-authorization.js';
import type { PolicyAuthorizationCapability } from './policy-authorization.js';
import { projectIdentity } from './project-identity.js';
import { ProjectMemoryRepository } from './project-memory-repository.js';
import { prepareMemoryContext, selectProjectMemory } from './project-memory-context.js';
import type { PreparedMemoryContext, MemoryRunOptions } from './project-memory-context.js';
import { MEMORY_CONTEXT_MEDIA } from './project-memory.js';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { requestHumanConfirmation } from './trusted-confirmation.js';
import type { HumanConfirmationChannel, ConfirmationSource } from './trusted-confirmation.js';
import { execFileSync } from 'node:child_process';
import { inventoryHash, inventoryTree } from './controlled-agent-runtime.js';
import { mkdtempSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { canonicalize, hashBytes, hashCanonical, hashContract, validateContract, validateStructure, validateScalar } from './contracts.js';
import type { ArtifactRef, AssignmentEnvelope, Candidate, CandidateManifest, ContextRecord, DecisionRecord, DeveloperResult, FailureRecord,
  HumanDecisionEvidence, HumanGate, OracleResult, ReviewResult, Risk, Role, RunRecord, ScoutResult, TaskSpec, TransitionEvent, ValidationContext,
  ValidationResult, WorkflowState } from './contracts.js';
import { COMPLETION_CONDITIONS, evaluateTransition } from './state-machine.js';
import type { CompletionFacts, Facts, TransitionId } from './state-machine.js';
import { freezeTaskSpec } from './task-spec.js';
import { currentValidationEvidence } from './contract-semantic.js';
import { SCOUT_LAUNCH_CONTRACT_HASH, runScout } from './controlled-scout.js';
import type { ControlledRegistration, ScoutRun, ScoutRunOptions } from './controlled-scout.js';
import { DEVELOPER_LAUNCH_CONTRACT_HASH, runDeveloper } from './controlled-developer.js';
import type { ControlledDeveloperRegistration, DeveloperRun, DeveloperRunOptions } from './controlled-developer.js';
import { isAcquiredReviewerNoDispatchProof, REVIEWER_LAUNCH_CONTRACT_HASH, runReviewer } from './controlled-reviewer.js';
import type { ControlledReviewerRegistration, ReviewPacket, ReviewerRun, ReviewerRunOptions } from './controlled-reviewer.js';
import { ORACLE_LAUNCH_CONTRACT_HASH, oraclePacketHash, runOracle } from './controlled-oracle.js';
import type { ControlledOracleRegistration, OracleEscalationPacket, OracleRun, OracleRunOptions } from './controlled-oracle.js';
import { isAcquiredDispatchIdentity, isAcquiredTerminalProof, verifyTerminalProof } from './pi-subagents-rpc.js';
import type { RpcEvents, TerminalProof, TerminalProofOptions } from './pi-subagents-rpc.js';
import { ScopeGuard, ScopeGuardError } from './scope-guard.js';
import { DurableStore } from './store.js';
import { isExecutedValidation, runApprovedValidation, verifyValidationProcessProof } from './validation-runner.js';
import { compareRuntimeEvidence, parseRuntimeJsonl, temporaryInstrumentationResidue } from './runtime-observability.js';
import type { RuntimeComparison, RuntimeEvidence, RuntimeEvent } from './runtime-observability.js';
import { bindBeforeAfter, EVIDENCE_BUNDLE_MEDIA_TYPE, SCENARIO_MEDIA_TYPE, SCENARIO_RUN_MEDIA_TYPE,
  validateExecutableScenario, validateScenarioRun, validateTechnicalEvidenceBundle } from './scenario-management.js';
import type { ExecutableScenario, ScenarioRun, TechnicalEvidenceBundle } from './scenario-management.js';
import { authorizationPackage, buildTerminalCompletionPackage, buildCompletionPackage, verifyCompletionPackage } from './completion-package.js';
import type { ScopeCapture, AuthorizedReworkBase } from './scope-guard.js';
import { evaluateFailure } from './retry-engine.js';
import type { FailureInput, RetryOutcome, RetryProof } from './retry-engine.js';
import { LockManager } from './lock-manager.js';
import type { WorkflowLocks } from './lock-manager.js';
import { recoveryLease, classifyResumeAction, developerRecoveryData, scoutRecoveryData, scopeBaselineRecoveryData, boundedDeveloperRecoveryData } from './recovery-resume.js';
import type { RecoveryAuthority } from './recovery-resume.js';
import { currentProcessIncarnation } from './process-incarnation.js';
import { PRESENTATION_MEDIA, CHANNEL_V2_MEDIA, checkGatePresentation, gatePresentations } from './gate-presentation.js';
import { refreshHumanView, shouldRefreshHumanView } from './human-repository.js';

export type OrchestratorDecision = 'CONTINUE_TO_READY' | 'HUMAN_GATE_REQUIRED' | 'HUMAN_DECISION_REQUIRED' | 'DISPATCH_DEVELOPER'
  | 'VALIDATION_REQUIRED' | 'DISPATCH_REVIEWER' | 'RETRY_INFRASTRUCTURE' | 'REWORK_REQUIRED' | 'ADVISORY_REQUIRED' | 'BLOCKED'
  | 'FAILED' | 'COMPLETION_NOT_YET_AUTHORIZED';
export type OrchestratorErrorCode = 'ORCHESTRATOR_TASK_INVALID' | 'ORCHESTRATOR_STATE_INVALID'
  | 'ORCHESTRATOR_REVISION_CONFLICT' | 'ASSIGNMENT_CONSTRUCTION_FAILED' | 'ROLE_CAPABILITY_UNAVAILABLE'
  | 'RESULT_ATTRIBUTION_MISMATCH' | 'RESULT_SCHEMA_INVALID' | 'RESULT_CONTRADICTORY'
  | 'HUMAN_GATE_REQUIRED' | 'VALIDATION_REQUIRED' | 'VALIDATION_FAILED' | 'REWORK_REQUIRED'
  | 'ADVISORY_REQUIRED' | 'COMPLETION_NOT_YET_AUTHORIZED' | 'ORCHESTRATOR_BLOCKED' | 'SCOPE_GUARD_FAILED' | 'DEVELOPER_BASELINE_FAILED'
  | 'DURABLE_TERMINAL_PROOF_UNAVAILABLE' | 'SCOPE_CHANGE_NOT_EXPANSION' | 'SCOPE_CHANGE_PROTOCOL_VIOLATION';
export class OrchestratorError extends Error { constructor(readonly code: OrchestratorErrorCode,readonly reasonCode?:string) { super(code); } }

export interface RoleDispatchers {
  readonly scout?: (assignment: AssignmentEnvelope, context: ValidationContext, options?: ScoutRunOptions) => Promise<ScoutRun>;
  readonly developer?: (assignment: AssignmentEnvelope, context: ValidationContext, options?: DeveloperRunOptions) => Promise<DeveloperRun>;
  readonly reviewer?: (assignment: AssignmentEnvelope, packet: ReviewPacket, context: ValidationContext, options?: ReviewerRunOptions) => Promise<ReviewerRun>;
  readonly oracle?: (assignment: AssignmentEnvelope, packet: OracleEscalationPacket, context: ValidationContext, options?: OracleRunOptions) => Promise<OracleRun>;
}
export interface RegisteredRuntimes {
  readonly developmentProfile?: DevelopmentProfile;
  readonly events: RpcEvents; readonly ownerSessionId: string;
  readonly scout: ControlledRegistration; readonly developer: ControlledDeveloperRegistration;
  readonly reviewer: ControlledReviewerRegistration; readonly oracle: ControlledOracleRegistration;
}
const terminalDispatchers=new WeakSet<object>();
export function registeredRoleDispatchers(runtime: RegisteredRuntimes): RoleDispatchers {
  const developmentProfile=resolveDevelopmentProfile(runtime.developmentProfile);
  const dispatchers=Object.freeze({
    scout: (assignment: AssignmentEnvelope, validationContext: ValidationContext, options?: ScoutRunOptions) =>
      runScout(assignment,{registration:runtime.scout,events:runtime.events,ownerSessionId:runtime.ownerSessionId,validationContext,options,developmentProfile}),
    developer: (assignment: AssignmentEnvelope, validationContext: ValidationContext, options?: DeveloperRunOptions) =>
      runDeveloper(assignment,{registration:runtime.developer,events:runtime.events,ownerSessionId:runtime.ownerSessionId,validationContext,options,developmentProfile}),
    reviewer: (assignment: AssignmentEnvelope, packet: ReviewPacket, validationContext: ValidationContext, options?: ReviewerRunOptions) =>
      runReviewer(assignment,packet,{registration:runtime.reviewer,events:runtime.events,ownerSessionId:runtime.ownerSessionId,validationContext,options,developmentProfile}),
    oracle: (assignment: AssignmentEnvelope, packet: OracleEscalationPacket, validationContext: ValidationContext, options?: OracleRunOptions) =>
      runOracle(assignment,packet,{registration:runtime.oracle,events:runtime.events,ownerSessionId:runtime.ownerSessionId,validationContext,options,developmentProfile}),
  });
  terminalDispatchers.add(dispatchers);return dispatchers;
}

export interface AssignmentOptions {
  readonly workRoot?: string; readonly baseRef?:string; readonly baseCommit?: string; readonly candidateDigest?: string; readonly candidateGeneration?: number;
  readonly context?: 'fresh' | 'fork'; readonly inputArtifactRefs?: readonly string[];
}
const authority: Readonly<Record<Role, readonly string[]>> = Object.freeze({ Scout:['OP-01'], Developer:['OP-01','OP-02'],
  Reviewer:['OP-01','OP-07'], Oracle:['OP-01'] });
const launchHash: Readonly<Record<Role,string>> = Object.freeze({ Scout:SCOUT_LAUNCH_CONTRACT_HASH,
  Developer:DEVELOPER_LAUNCH_CONTRACT_HASH, Reviewer:REVIEWER_LAUNCH_CONTRACT_HASH, Oracle:ORACLE_LAUNCH_CONTRACT_HASH });

/** Pure deterministic DATA-002 factory; operational capability is checked separately before dispatch. */
export function createAssignment(spec: TaskSpec, state: WorkflowState, role: Role, options: AssignmentOptions = {}): AssignmentEnvelope {
  try {
    const ordinal=state.counters.attempts+1,repoRoot=state.runtimeBindingRef?state.repoRoot:spec.scope.repoRoot,
      workRoot=options.workRoot??(role==='Reviewer'&&state.candidate?state.candidate.root:repoRoot);
    const candidateDigest=options.candidateDigest??state.candidate?.digest,candidateGeneration=options.candidateGeneration??state.candidate?.generation;
    const token=hashCanonical({taskId:spec.taskId,specHash:spec.specHash,role,ordinal,revision:state.revision,workRoot,
      ...(candidateDigest?{candidateDigest}:{}),...(candidateGeneration!==undefined?{candidateGeneration}:{})}).slice(0,24);
    const objective=role==='Developer'?`${spec.objective} Perform the change only inside workRoot; never modify repoRoot.`
      :role==='Reviewer'?`Independently review whether the candidate satisfies: ${spec.objective}`:spec.objective;
    const value:any={schemaVersion:2,assignmentId:`assignment-${token}`,taskId:spec.taskId,attemptId:`attempt-${token}`,role,
      specHash:spec.specHash,objective,repoRoot,workRoot,baseRef:options.baseRef??spec.scope.baseRef,
      allowedPaths:[...spec.scope.allowedPaths],deniedPaths:[...spec.scope.deniedPaths],requirements:clone(spec.requirements),
      acceptanceCriteria:clone(spec.acceptanceCriteria),constraints:[...spec.constraints],
      stopConditions:['Stop on ambiguity, invalid evidence, scope expansion, or unavailable authority'],
      inputArtifactRefs:[...new Set(options.inputArtifactRefs??[spec.plan.snapshot.id,spec.currentTask.snapshot.id])],authority:[...authority[role]],
      // Command metadata resolves criterion references for every role; execution authority remains role-bound.
      validationCommands:clone(spec.validationCommands),
      context:options.context??'fresh',launchContractHash:launchHash[role],assignmentHash:'0'.repeat(64)};
    const baseCommit=options.baseCommit??state.baselineCommit;
    if(role==='Developer'||role==='Reviewer')value.baseCommit=baseCommit;
    if(role==='Reviewer'||(role==='Developer'&&options.candidateDigest!==undefined)){
      value.candidateDigest=options.candidateDigest??state.candidate?.digest;
      value.candidateGeneration=options.candidateGeneration??state.candidate?.generation;
    }
    const shape=validateStructure('AssignmentEnvelope',value);if(!shape.ok)throw new OrchestratorError('ASSIGNMENT_CONSTRUCTION_FAILED');
    value.assignmentHash=hashContract('AssignmentEnvelope',value);
    return Object.freeze(value) as AssignmentEnvelope;
  } catch (error) { if (error instanceof OrchestratorError) throw error; throw new OrchestratorError('ASSIGNMENT_CONSTRUCTION_FAILED'); }
}

export function allResidualRisksDisposed(state:WorkflowState,context:ValidationContext,events:readonly TransitionEvent[]):boolean{
  const records=context.records;
  const sources=['Developer','Reviewer'].map(role=>[...state.runs].reverse().find(r=>r.role===role)?.resultRef);
  const risks=records.filter(r=>sources.includes(r.id)&&(r.kind==='DeveloperResult'||r.kind==='ReviewResult'))
    .flatMap(r=>(r.value as DeveloperResult|ReviewResult).residualRisks);
  return risks.every(risk=>{
    if(risk.blocking||!records.some(r=>r.id===risk.id&&r.kind==='Risk'&&canonicalize(r.value)===canonicalize(risk)))return false;
    const decisions=state.decisions.filter(d=>d.subjectId===risk.id&&['RESOLVE_RISK','DEFER_RISK'].includes(d.kind)
      &&d.evidenceRefs.some(id=>{const r=records.find(r=>r.id===id&&r.kind==='WorkflowState');const bound=r?.value as WorkflowState|undefined;
        return bound?.specHash===state.specHash&&!!bound?.candidate&&bound.candidate.digest===state.candidate?.digest
          &&bound.candidate.generation===state.candidate?.generation}));
    return decisions.length===1&&!state.invalidEvidenceIds.includes(decisions[0].id)&&records.some(r=>r.id===decisions[0].id&&r.kind==='DecisionRecord'&&canonicalize(r.value)===canonicalize(decisions[0]))
      &&validateContract('DecisionRecord',decisions[0],context).ok
      &&events.some(e=>e.taskId===state.taskId&&e.actor==='Orchestrator'&&e.kind==='RECORD'&&e.recordType==='DECISION_RECORDED'&&e.evidenceRefs.includes(decisions[0].id));
  });
}

export class OrchestratorHost {
  #current: CentralOrchestrator | undefined;
  constructor(readonly ownerSessionId:string,readonly runners:RoleDispatchers){}
  initialize(taskInput:unknown,options:Omit<InitializeOptions,'ownerSessionId'|'runners'>={}):CentralOrchestrator{
    if(this.#current)throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    return this.#current=CentralOrchestrator.initialize(taskInput,{...options,ownerSessionId:this.ownerSessionId,runners:this.runners});
  }
  restore(authority:RecoveryAuthority):CentralOrchestrator{
    if(this.#current||authority.sessionId!==this.ownerSessionId)throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    return this.#current=CentralOrchestrator.restore(authority,this.runners);
  }
  get current():CentralOrchestrator|undefined{return this.#current}
  dispose():void{this.#current?.dispose();this.#current=undefined}
}

export interface CandidateGuard { capture(generation:number,terminalProof:string):ScopeCapture;
  prepareRework?(source:ScopeCapture,workRoot:string):AuthorizedReworkBase;
  finishRework?(base:AuthorizedReworkBase,terminalProof:string):ScopeCapture;
}
export interface InitializeOptions {
  readonly ownerSessionId: string; readonly runners: RoleDispatchers; readonly artifacts?: readonly ArtifactRef[];
  /** Production may provide a session-bound manager; otherwise a real isolated manager is used for in-memory tests. */
  readonly lockManager?:LockManager; readonly locks?:WorkflowLocks;
  /** Host opt-in; externally supplied artifact bytes must already exist in this store. */
  readonly store?: DurableStore;
  readonly baselineRef?: string; readonly baselineCommit?: string; readonly now?: () => string;
  /** Host opt-in only for an environment with measured TEST-041 evidence (or its explicit probe). */
  readonly parallelReviewEnabled?: boolean;
  /** Trusted host test seam; production defaults to ScopeGuard.open. */
  readonly scopeGuardFactory?: (spec:TaskSpec,workRoot:string,baseCommit:string,previousGeneration:number)=>CandidateGuard;
}
export interface CandidateFixture { readonly candidate: Candidate; readonly artifacts: readonly ArtifactRef[] }
export interface ReviewHostPacket {
  readonly candidateManifest: CandidateManifest; readonly diff: string; readonly changedFiles: readonly string[];
  readonly handoff: string; readonly residualRisks: readonly Risk[]; readonly evidenceRefs: readonly string[];
}
export interface DecisionResult<T=undefined> { readonly decision: OrchestratorDecision; readonly state: WorkflowState; readonly value?: T }
interface ReviewerRetryAuthorization {readonly schemaVersion:1;readonly action:'RETRY_INFRASTRUCTURE';readonly taskId:string;
  readonly specHash:string;readonly candidateDigest:string;readonly candidateGeneration:number;readonly failureId:string;
  readonly reviewerAssignmentId:string;readonly reviewerAttemptId:string;readonly requestId:string;readonly runId?:string;
  readonly childSessionId?:string;readonly terminalProofRef?:string;readonly dispatchProofRef?:string;readonly infrastructureRetriesBefore:number;
  readonly infrastructureRetriesAfter:number;readonly dispatches:number;readonly evidenceRefs:readonly string[]}
export interface HumanGateSnapshot {readonly gateId:string;readonly taskId:string;readonly stateRevision:number;readonly specHash:string;
  readonly proposedSpecHash?:string;readonly candidateDigest?:string;readonly candidateGeneration?:number;readonly approvedDataHash:string;
  readonly completionPackageHash?:string;readonly sessionId:string;readonly presentationRef?:ArtifactRef}
export type BeforeCompletionSnapshot=HumanGateSnapshot;
export type ImplementedHumanGate=HumanGate['type'];
export const HUMAN_GATE_DECISIONS=Object.freeze({
  beforeImplementation:Object.freeze(['APPROVE','REJECT','ANSWER'] as const),
  onScopeChange:Object.freeze(['APPROVE','REJECT','ANSWER'] as const),
  onOracleDecision:Object.freeze(['APPROVE','REJECT','ANSWER'] as const),
  onRetryExhausted:Object.freeze(['APPROVE','REJECT','ANSWER'] as const),
  beforeCompletion:Object.freeze(['APPROVE','REJECT','ANSWER'] as const),
  beforeReviewerRedispatch:Object.freeze(['APPROVE','REJECT','ANSWER'] as const),
});
export interface HumanGateRequest {readonly gateType:ImplementedHumanGate;readonly snapshot:HumanGateSnapshot;readonly displayText:string}
export interface HumanDecisionChoice {readonly decision:'APPROVE'|'REJECT'|'ANSWER';readonly answer?:string}
export type HumanGateChannel=HumanConfirmationChannel;
export interface TrustedHumanDecision extends HumanDecisionChoice {readonly snapshot:HumanGateSnapshot;readonly confirmationId:string;readonly confirmedAt:string}
const humanRequests=new WeakSet<object>(),humanReceipts=new WeakMap<object,{ctx:HumanGateChannel;source:ConfirmationSource}>();
export async function confirmHumanDisplay(ctx:HumanGateChannel,display:string,title='Controlled development: approve before completion'):Promise<boolean>{
  return !!await requestHumanConfirmation(ctx,display,title);
}
export const HUMAN_GATE_TITLES:Readonly<Record<ImplementedHumanGate,string>>=Object.freeze({
  beforeImplementation:"Authorize implementation?",onScopeChange:"A scope extension is required",
  onOracleDecision:"A decision is required",beforeCompletion:"Ready to complete the task",
  onRetryExhausted:"Automatic attempts exhausted",beforeReviewerRedispatch:"Review interrupted"});
/** Human-readable projection of frozen data, never a new authorization payload. */
export function humanGateDisplay(request:HumanGateRequest,choice:HumanDecisionChoice):string{
  const d=JSON.parse(request.displayText);
  // Escape control/bidi characters in frozen user/child text; never interpret it as terminal markup.
  const text=(v:unknown)=>String(v??"Unavailable").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);
  const lines=["Objective:",text(d.objective)];
  const validationDescriptions=(commands:readonly any[],criteria:readonly any[]=[],requirements:readonly any[]=[])=>{
    const reviews=criteria.filter(c=>c.method==='REVIEW').map(c=>`Independent review: ${text(c.text)}`);
    if(!commands.length)return reviews;
    const recipes=commands.map(command=>{
      const executable=String(command.executable??'').split('/').at(-1),argv=JSON.stringify(command.argv);
      if(executable==='git'&&argv==='["diff","--check"]')return "Diff formatting check; it does not prove the text is correct.";
      if(executable==='npm'&&argv==='["test"]')return "Run the project's configured test suite in the candidate copy.";
      return undefined;
    });
    if(recipes.every(Boolean))return [...recipes as string[],...reviews];
    const linked=criteria.filter(c=>(c.commandIds??[]).some((id:string)=>commands.some(command=>command.id===id)));
    if(linked.length)return linked.map(c=>typeof c.text==='string'&&c.text.trim()?`Check that ${text(c.text)}`:`Automated check required by criterion ${text(c.id)}`);
    const descriptions=requirements.filter(r=>typeof r.text==='string'&&r.text.trim()).map(r=>`Check that ${text(r.text)}`);
    return descriptions.length?descriptions:["Planned automated check; criterion description unavailable."];
  };
  const section=(title:string,items:readonly string[])=>lines.push('',`${title}:`,...(items.length?items.map(x=>`- ${x}`):["- None"]));
  const risks=d.residualRisks??d.knownRisks??[],decisions=d.decisions??[];
  const riskLines=risks.map((r:any)=>{
    const dispositions=decisions.filter((x:any)=>x.subjectId===r.id);
    const resolved=!r.blocking&&dispositions.length===1&&dispositions[0].kind==='RESOLVE_RISK';
    const deferred=!r.blocking&&dispositions.length===1&&dispositions[0].kind==='DEFER_RISK';
    const description=r.id==='host-validation-pending'?"The host was expected to run validation.":text(r.text);
    return `${description} Status: ${resolved?(r.id==='host-validation-pending'?"resolved — validation passed":"resolved"):deferred?"residual risk accepted and deferred":r.blocking?"blocking":"unresolved"}.`;
  });
  let question='';
  switch(request.gateType){
    case 'beforeImplementation':
      if(d.developerRecovery)lines.push('',"The previous Developer stopped because of a connection error, before executing tools.",
        "The worktree still matches the baseline. The previous attempt remains in the journal.",
        `Recovery attempt ${d.developerRecovery.infrastructureRetriesAfter} of ${d.developerRecovery.maxInfrastructureRetries} allowed by the task. Canceling the dialog keeps this request pending.`,
        "If you approve, a new Developer will start in the same worktree with the same scope.");
      if(d.boundedDeveloperRecovery)section("Why another attempt is needed",[
        "The previous Developer reported a blocker without changing files or running commands. Its result remains in history.",
        `Reported reason: ${text(d.boundedDeveloperRecovery.blockedReason)}`,
        "The package verified that the agents terminated and that the project and isolated copy remain unchanged.",
        "The package will run the approved automated checks in the isolated copy; the Developer will read their outcomes. Subsequent checks will run again.",
        `New attempt after a blocker: ${d.boundedDeveloperRecovery.boundedRetriesAfter} of ${d.boundedDeveloperRecovery.maxBoundedRetries}. Previously used attempts remain counted.`]);
      section("Editable files/paths in the candidate copy",(d.allowedPaths??[]).map(text));
      section("Forbidden files/paths",(d.deniedPaths??[]).map(text));
      section("Planned checks",validationDescriptions(d.validationCommands??[],d.acceptanceCriteria??[],d.requirements??[]));
      if(d.validationFailure)section("Why a correction is needed",[text(d.validationFailure)]);
      if(d.scoutClarifications?.length)section("Confirmed clarifications",(d.scoutClarifications??[]).map((a:any)=>`Question ${a.ambiguityIndex+1}: ${text(a.ambiguityText)}\nAnswer: ${text(a.answer)}`));
      section("Known risks",riskLines);
      if(d.scopeBaselineRecovery)section("Why confirmation is needed again",[
        "The previous baseline check stopped development before the Developer started.",
        "The package rechecked the same project version and isolated copy. The approved analysis is preserved.",
        "The previous confirmation remains in history. This new confirmation authorizes development to start within the same boundaries."]);
      question=d.developerRecovery||d.boundedDeveloperRecovery?"Do you authorize another Developer attempt?":d.scopeBaselineRecovery?"Do you authorize development after the baseline check?":"Do you authorize the Developer to start these changes?";break;
    case 'beforeCompletion':{
      section("Verified changes",(d.changedFiles??[]).map(text));
      if(d.changedFiles?.length)lines.push("- No other files changed");
      const validation=d.validation??[];
      lines.push('',"Checks:",validation.length&&validation.every((v:any)=>v.status==='PASSED')?"✓ Automated checks passed":"✗ Automated checks failed or unavailable",
        `${d.reviewResult?.verdict==='PASS'?'✓':'✗'} Reviewer: ${text(d.reviewResult?.verdict)}`);
      const unresolved=risks.some((r:any)=>r.blocking||decisions.filter((x:any)=>x.subjectId===r.id&&['RESOLVE_RISK','DEFER_RISK'].includes(x.kind)).length!==1);
      lines.push(unresolved?"✗ Unresolved risks: see below":"✓ No unresolved residual risks");
      if(riskLines.length)section("Risks and decisions",riskLines);
      question="Do you approve completion of this task?";break;
    }
    case 'beforeReviewerRedispatch':{
      lines.push('',d.previousReviewer?.dispatchProofRef?"The previous review request was not sent: the package verified this before allowing recovery.":"The previous Reviewer did not complete the check because of a technical problem.",
        "The candidate has not changed. Previously executed checks remain valid.",'',"If you continue:",
        "- a new Reviewer will start;","- the Developer will not run again;","- tests will not be repeated;",
        "- no changes will be applied to the original project.",'',"Technical details:",
        `Previous Reviewer: ${text(d.previousReviewer?.assignmentId)}`,
        `Infrastructure error: ${text(d.failureCode)}`,
        `Candidate: generation ${text(d.candidateGeneration)}, digest ${text(d.candidateDigest)}`,
        `Current checks: ${(d.validationIds??[]).map(text).join(', ')||"unavailable"}`);
      question="Do you want to start a new Reviewer?";break;
    }
    case 'onScopeChange':{
      section("Current scope",(d.oldAllowedPaths??[]).map(text));
      const changes:string[]=[];
      for(const path of d.proposedAllowedPaths??[])if(!(d.oldAllowedPaths??[]).includes(path))changes.push(`+ ${text(path)}`);
      for(const path of d.oldAllowedPaths??[])if(!(d.proposedAllowedPaths??[]).includes(path))changes.push(`− ${text(path)}`);
      for(const path of d.oldDeniedPaths??[])if(!(d.proposedDeniedPaths??[]).includes(path))changes.push(`+ Previously forbidden permission: ${text(path)}`);
      for(const r of d.proposedRequirements??[])if(!(d.oldRequirements??[]).some((old:any)=>canonicalize(old)===canonicalize(r)))changes.push(`+ Requirement: ${text(r.text)}`);
      for(const r of d.exactRemovals?.requirements??[])changes.push(`− Requirement: ${text(r.text)}`);
      for(const [key,label] of [['acceptanceCriteria',"Criterion"],['constraints',"Constraint"],['validationCommands','Validation']] as const){
        for(const [set,sign] of [[d.exactAdditions,'+'],[d.exactRemovals,'−']] as const)for(const item of set?.[key]??[])
          changes.push(`${sign} ${label}: ${key==='validationCommands'
            ?validationDescriptions([item],d.affectedAcceptanceCriteria?.[sign==='+'?'proposed':'old']??[],sign==='+'?d.proposedRequirements??[]:d.oldRequirements??[]).join('; ')
            :text(typeof item==='string'?item:item.text)}`);
      }
      const authorityLabels:Record<string,string>={STRONG_CONFINEMENT_RELAXED:"Strong confinement no longer required",OBJECTIVE_CHANGED:"Objective changed",INPUT_SOURCE_CHANGED:"Task sources changed"};
      for(const change of d.authorityChanges??[]){
        if(authorityLabels[change])changes.push(`! ${authorityLabels[change]}`);
        if(change.startsWith('HUMAN_GATE_DISABLED:'))changes.push(`! Human confirmation disabled: ${HUMAN_GATE_TITLES[change.split(':')[1] as ImplementedHumanGate]}`);
      }
      lines.push('',"New requested scope — changes:",...(changes.length?changes:["No detailed changes available"]));
      section("Resulting scope",(d.proposedAllowedPaths??[]).map(text));
      section("Forbidden paths after the change",(d.proposedDeniedPaths??[]).map(text));
      lines.push('',"Reason:",text(d.reason),'',"Approval installs the new specification and requires reanalysis; it does not start a writer.");
      question="Do you authorize this scope change?";break;
    }
    case 'onOracleDecision':
      lines.push('',"Problem:",text(d.ambiguity),'',"Options:",...(d.options??[]).map((o:string,i:number)=>`${String.fromCharCode(65+i)}. ${text(o)}`),
        '',"Oracle recommendation:",text(d.recommendation),'',"Consequences:",text(d.consequences),
        '',"Oracle provides a recommendation; the user makes the decision.",
        "Approval permits reconciliation only: it does not authorize implementation or retry.");
      question="Do you accept the recommendation for reconciliation only?";break;
    case 'onRetryExhausted':{
      const c=d.counters??{};
      const failureLabels:Record<string,string>={TEST:"Validation failed",REVIEW:"Review failed",INFRA:"Execution failed because of an infrastructure problem",AMBIGUITY:"Unresolved ambiguity",SCOPE:"Scope violation",SCHEMA:"Invalid result",RECOVERY:"State requires reconciliation"};
      const failure=failureLabels[d.lastFailure?.category]??"Unclassified error";
      lines.push('',"What failed:",failure,"Latest error:",failure,
        '',`Attempts made: ${text(c.attempts??d.attempts)}`,`Starts: ${text(c.dispatches??d.dispatches)}`,
        `Corrections: ${text(c.reworkAttempts??d.reworkAttempts)}`,`Infrastructure retries: ${text(c.infrastructureRetries??d.infrastructureRetries)}`);
      section("Permitted continuations",(d.legalContinuations??[]).map((v:string)=>v==='RECONCILE'?"Reconciliation by the Orchestrator; task still blocked":text(v)));
      lines.push('',"Approval does not increase budgets or reset counters.");
      question="Do you authorize reconciliation only, without further attempts?";break;
    }
  }
  lines.push('',"The original repository will not be modified automatically.","No automatic commit, merge, push, publish or apply.");
  if(choice.decision==='REJECT')lines.push('',"You are choosing a final rejection: the task will end with outcome FAILED.");
  if(choice.decision==='ANSWER')lines.push('',"Exact answer:",JSON.stringify(choice.answer),"The answer is NOT approval; the task will remain blocked.");
  lines.push('',"No/Esc cancels the dialog; it does not record a rejection.",'',choice.decision==='REJECT'?"Do you want to permanently reject this request?":
    choice.decision==='ANSWER'?"Do you want to send this answer without authorizing the request?":question);
  return lines.join('\n');
}
/** The sole production confirmation boundary. Choice/answer are untrusted until the exact display is confirmed. */
export async function presentHumanGate(ctx:HumanGateChannel,request:HumanGateRequest,choice:HumanDecisionChoice={decision:'APPROVE'}):Promise<TrustedHumanDecision|undefined>{
  if(ctx?.mode!=='tui'||(typeof ctx.ui?.custom!=='function'&&typeof ctx.ui?.confirm!=='function')||!ctx.sessionManager?.getSessionId())throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  if(!humanRequests.has(request)||!choice||Object.keys(choice).some(k=>!['decision','answer'].includes(k))
    ||!(HUMAN_GATE_DECISIONS[request.gateType] as readonly string[]).includes(choice.decision)
    ||(choice.decision==='ANSWER'?!validateScalar('Text',choice.answer).ok:choice.answer!==undefined))throw new Error('HUMAN_DECISION_INVALID');
  if(ctx.sessionManager.getSessionId()!==request.snapshot.sessionId)throw new HumanDecisionStaleError('SESSION_CHANGED');
  // Copy before await: a caller cannot mutate the chosen decision or text during the dialog.
  const selected=Object.freeze({...choice});
  const display=humanGateDisplay(request,selected);
  const source=await requestHumanConfirmation(ctx,display,HUMAN_GATE_TITLES[request.gateType]);
  if(ctx.sessionManager.getSessionId()!==request.snapshot.sessionId)throw new HumanDecisionStaleError('SESSION_CHANGED');
  if(!source)return undefined; // Cancel/false is NOT a REJECT decision.
  const receipt=Object.freeze({...selected,snapshot:request.snapshot,confirmationId:`local-${randomUUID()}`,confirmedAt:new Date().toISOString()});
  humanReceipts.set(receipt,{ctx,source});return receipt;
}
export interface HumanGateFreshness {readonly gateId:string|null;readonly taskId:string;readonly state:'AWAITING_HUMAN'|string;readonly stateRevision:number;
  readonly specHash:string;readonly proposedSpecHash?:string;readonly candidateDigest?:string;readonly candidateGeneration?:number;readonly approvedDataHash:string;
  readonly completionPackageHash?:string;readonly sessionId:string;readonly taskLockHeld:boolean;readonly workspaceLockHeld:boolean;readonly gateStatus:string}
export class HumanDecisionStaleError extends Error {
  readonly code='HUMAN_DECISION_STALE';
  constructor(readonly reasonCode:string,readonly predicates:readonly string[]=[]){super('HUMAN_DECISION_STALE')}
}
export type BeforeCompletionFreshness=HumanGateFreshness;
export function humanGateStaleReason(snapshot:HumanGateSnapshot,current:HumanGateFreshness):string|null{
  const checks:readonly [string,boolean][]=[
    ['GATE_ID_CHANGED',current.gateId===snapshot.gateId],['TASK_ID_CHANGED',current.taskId===snapshot.taskId],
    ['STATE_REVISION_CHANGED',current.stateRevision===snapshot.stateRevision],['SPEC_HASH_CHANGED',current.specHash===snapshot.specHash],
    ['PROPOSED_SPEC_HASH_CHANGED',current.proposedSpecHash===snapshot.proposedSpecHash],
    ['CANDIDATE_DIGEST_CHANGED',current.candidateDigest===snapshot.candidateDigest],
    ['CANDIDATE_GENERATION_CHANGED',current.candidateGeneration===snapshot.candidateGeneration],
    ['APPROVED_DATA_HASH_CHANGED',current.approvedDataHash===snapshot.approvedDataHash],
    ['COMPLETION_PACKAGE_HASH_CHANGED',current.completionPackageHash===snapshot.completionPackageHash],
    ['SESSION_CHANGED',current.sessionId===snapshot.sessionId],['TASK_LOCK_LOST',current.taskLockHeld],
    ['WORKSPACE_LOCK_LOST',current.workspaceLockHeld],['GATE_STATUS_CHANGED',current.gateStatus==='PENDING'],
    ['WORKFLOW_STATE_CHANGED',current.state==='AWAITING_HUMAN']];
  return checks.find(([,valid])=>!valid)?.[0]??null;
}
export const beforeCompletionStaleReason=humanGateStaleReason;
export function verifyBeforeCompletionFreshness(snapshot:BeforeCompletionSnapshot,current:BeforeCompletionFreshness):boolean{
  return beforeCompletionStaleReason(snapshot,current)===null;
}
export interface ApprovedCompletionData {readonly schemaVersion:1;readonly objective:string;readonly specHash:string;readonly baselineCommit:string;
  readonly candidateDigest:string;readonly candidateGeneration:number;readonly manifestRef:ArtifactRef;readonly patchRef:ArtifactRef;
  readonly validation:readonly {readonly id:string;readonly commandId:string;readonly status:string;readonly logRef:string;readonly processProofRef:string}[];
  readonly reviewResult:ReviewResult;readonly reviewRef:string;readonly residualRisks:readonly Risk[];readonly decisions:readonly DecisionRecord[];readonly changedFiles:readonly string[];
  readonly authorizationPackageHash:string;readonly authorizationPackageRef:ArtifactRef}
export interface ApprovedReviewerRedispatchData {readonly schemaVersion:1;readonly objective:string;readonly specHash:string;
  readonly candidateDigest:string;readonly candidateGeneration:number;readonly validationIds:readonly string[];
  readonly runtimeEvidenceRefs:readonly string[];readonly runtimeComparisonRef?:string;readonly failureId:string;readonly failureCode:string;
  readonly retryAuthorizationRef:ArtifactRef;readonly previousReviewer:Readonly<{assignmentId:string;attemptId:string;requestId:string;
    runId?:string;childSessionId?:string;terminalProofRef?:string;dispatchProofRef?:string}>;readonly evidenceRefs:readonly string[]}
type SpecRequirement=TaskSpec['requirements'][number];type SpecCriterion=TaskSpec['acceptanceCriteria'][number];
type SpecCommand=TaskSpec['validationCommands'][number];
export interface ScopeChangeSet {readonly allowedPaths:readonly string[];readonly deniedPaths:readonly string[];
  readonly requirements:readonly SpecRequirement[];readonly acceptanceCriteria:readonly SpecCriterion[];
  readonly constraints:readonly string[];readonly validationCommands:readonly SpecCommand[]}
export interface ScopeChangeAnalysis {readonly requiresHumanGate:boolean;readonly additions:ScopeChangeSet;readonly removals:ScopeChangeSet;
  readonly authorityChanges:readonly string[];readonly affectedAcceptanceCriteria:Readonly<{old:readonly SpecCriterion[];proposed:readonly SpecCriterion[]}>}
export interface ApprovedScopeChangeData {readonly schemaVersion:1;readonly objective:string;readonly currentSpecHash:string;readonly proposedSpecHash:string;
  readonly oldDeniedPaths:readonly string[];readonly proposedDeniedPaths:readonly string[];
  readonly oldAllowedPaths:readonly string[];readonly proposedAllowedPaths:readonly string[];
  readonly oldRequirements:readonly SpecRequirement[];readonly proposedRequirements:readonly SpecRequirement[];
  readonly authorityChanges:readonly string[];readonly exactAdditions:ScopeChangeSet;readonly exactRemovals:ScopeChangeSet;
  readonly reason:string;readonly affectedAcceptanceCriteria:ScopeChangeAnalysis['affectedAcceptanceCriteria']}
const fixedDeniedNames=new Set(['.git','.pi','.ssh','.env','.npmrc','.netrc','credentials','credentials.json']);
const isFixedDeniedPath=(path:string)=>path.split('/').some(part=>fixedDeniedNames.has(part));
function exactChanges<T>(oldValues:readonly T[],newValues:readonly T[]):Readonly<{additions:readonly T[];removals:readonly T[]}>{
  const old=new Set(oldValues.map(canonicalize)),next=new Set(newValues.map(canonicalize));
  return Object.freeze({additions:Object.freeze(newValues.filter(value=>!old.has(canonicalize(value))).map(clone)),
    removals:Object.freeze(oldValues.filter(value=>!next.has(canonicalize(value))).map(clone))});
}
/** Host-side classification only. Descriptive reason/model text never participates in this decision. */
export function analyzeScopeChange(current:TaskSpec,proposed:TaskSpec):ScopeChangeAnalysis{
  const allowed=exactChanges(current.scope.allowedPaths,proposed.scope.allowedPaths),denied=exactChanges(current.scope.deniedPaths,proposed.scope.deniedPaths);
  const requirements=exactChanges(current.requirements,proposed.requirements),criteria=exactChanges(current.acceptanceCriteria,proposed.acceptanceCriteria);
  const constraints=exactChanges(current.constraints,proposed.constraints),commands=exactChanges(current.validationCommands,proposed.validationCommands);
  const authorityChanges:string[]=[];
  if(allowed.additions.length)authorityChanges.push('ALLOWED_PATHS_ADDED');
  if(denied.removals.length)authorityChanges.push('DENY_RESTRICTIONS_REMOVED');
  if(requirements.additions.length)authorityChanges.push('REQUIREMENTS_ADDED_OR_EXPANDED');
  if(criteria.additions.length)authorityChanges.push('ACCEPTANCE_CRITERIA_ADDED_OR_EXPANDED');
  if(constraints.removals.length)authorityChanges.push('CONSTRAINTS_REMOVED');
  if(commands.additions.length)authorityChanges.push('VALIDATION_COMMAND_AUTHORITY_ADDED_OR_CHANGED');
  if(current.scope.strongConfinementRequired&&!proposed.scope.strongConfinementRequired)authorityChanges.push('STRONG_CONFINEMENT_RELAXED');
  for(const gate of ['beforeImplementation','onOracleDecision','beforeCompletion','onRetryExhausted'] as const)
    if(current.humanGates[gate]&&!proposed.humanGates[gate])authorityChanges.push(`HUMAN_GATE_DISABLED:${gate}`);
  if(current.objective!==proposed.objective)authorityChanges.push('OBJECTIVE_CHANGED');
  if(canonicalize(current.plan)!==canonicalize(proposed.plan)||canonicalize(current.currentTask)!==canonicalize(proposed.currentTask))authorityChanges.push('INPUT_SOURCE_CHANGED');
  const changedRequirementIds=new Set([...requirements.additions,...requirements.removals].map(value=>value.id));
  const changedCriterionIds=new Set([...criteria.additions,...criteria.removals].map(value=>value.id));
  const affected=(values:readonly SpecCriterion[])=>values.filter(value=>changedCriterionIds.has(value.id)||value.requirementIds.some(id=>changedRequirementIds.has(id)));
  const set=(a:typeof allowed.additions,d:typeof denied.additions,r:typeof requirements.additions,c:typeof criteria.additions,
    x:typeof constraints.additions,v:typeof commands.additions):ScopeChangeSet=>Object.freeze({allowedPaths:a,deniedPaths:d,requirements:r,
      acceptanceCriteria:c,constraints:x,validationCommands:v});
  return Object.freeze({requiresHumanGate:authorityChanges.length>0,
    additions:set(allowed.additions,denied.additions,requirements.additions,criteria.additions,constraints.additions,commands.additions),
    removals:set(allowed.removals,denied.removals,requirements.removals,criteria.removals,constraints.removals,commands.removals),
    authorityChanges:Object.freeze(authorityChanges),affectedAcceptanceCriteria:Object.freeze({old:Object.freeze(affected(current.acceptanceCriteria).map(clone)),
      proposed:Object.freeze(affected(proposed.acceptanceCriteria).map(clone))})});
}
type ChildOutput = ScoutRun | DeveloperRun | ReviewerRun | OracleRun;

export class CentralOrchestrator {
  readonly #records=new Map<string,ContextRecord>(); readonly #events:TransitionEvent[]=[]; readonly #assignments=new Map<string,AssignmentEnvelope>();
  readonly #acceptedRuns=new Map<string,string>(); readonly #runners:RoleDispatchers; readonly #ownerSessionId:string; readonly #now:()=>string;
  readonly #scopeGuardFactory:(spec:TaskSpec,workRoot:string,baseCommit:string,previousGeneration:number)=>CandidateGuard;
  readonly #parallelReviewEnabled:boolean; readonly #store:DurableStore|undefined;readonly #lockManager:LockManager;readonly #locks:WorkflowLocks;
  readonly #memoryContexts=new Map<string,PreparedMemoryContext>();
  #humanRequest:HumanGateRequest|undefined;
  #policyGateMode=false;
  #retired=false;
  #policyRecoveryWriter=false;
  #policyWriterCheck:(()=>void)|undefined;
  #presentation:ArtifactRef|undefined;
  #recoveryAuthority:RecoveryAuthority|undefined;
  #writerApproval:{readonly gate:HumanGate;readonly dataHash:string}|undefined;
  #spec:TaskSpec; #specRecordId='spec'; #state:WorkflowState; #stateRecordId='state-r0'; #previousStateRecordId:string|undefined; #guard?:CandidateGuard; #capture?:ScopeCapture;
  private constructor(spec:TaskSpec,options:InitializeOptions,recovery?:RecoveryAuthority){
    this.#store=options.store;
    this.#lockManager=options.lockManager??new LockManager(options.store?.agentDataRoot??mkdtempSync(join(tmpdir(),'controlled-dev-locks-')),
      options.ownerSessionId,`runtime-${randomUUID()}`);
    this.#locks=options.locks??this.#lockManager.acquire(spec.taskId,spec.scope.repoRoot);
    if(!this.#lockManager.verifyTaskLock(this.#locks.task)||!this.#lockManager.verifyWorkspaceLock(this.#locks.workspace))
      throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    this.#parallelReviewEnabled=options.parallelReviewEnabled===true;
    this.#spec=spec;this.#runners=options.runners;this.#ownerSessionId=options.ownerSessionId;this.#now=options.now??(()=>new Date().toISOString());
    this.#scopeGuardFactory=options.scopeGuardFactory??((task,workRoot,baseCommit,previousGeneration)=>ScopeGuard.open({...task.scope,repoRoot:this.#state.repoRoot},workRoot,baseCommit,previousGeneration));
    if(recovery){
      const {ledger}=recoveryLease(recovery);this.#recoveryAuthority=recovery;
      this.#state=ledger.state;this.#specRecordId=ledger.state.spec.id;this.#stateRecordId=ledger.events.at(-1)!.stateAfter.id;
      this.#previousStateRecordId=ledger.events.at(-2)?.stateAfter.id;
      for(const record of ledger.records)this.#records.set(record.id,record);
      this.#events.push(...ledger.events);
      const catalog=this.#store!.catalog(ledger.records);this.#addRecord(catalog.id,'ArtifactRef',catalog);
      this.#addRecord(this.#stateRecordId,'WorkflowState',this.#state);this.#addRecord(ledger.events.at(-1)!.id,'TransitionEvent',ledger.events.at(-1)!);
      for(const record of ledger.records)if(record.kind==='AssignmentEnvelope')this.#assignments.set(record.value.assignmentId,record.value);
      for(const run of this.#state.runs)if(run.runId&&run.resultRef)this.#acceptedRuns.set(run.runId,canonicalize(this.#recordValue(run.resultRef)));
      const imported=recoveryLease(recovery).runtimeBinding;
      if(imported){
        const importedRefs=[imported.ref,imported.value.confirmationRef,imported.value.handoffRef,
          ...(imported.value.boundedBaselineRef&&imported.value.boundedTranscriptRef?[imported.value.boundedBaselineRef,imported.value.boundedTranscriptRef]:[])];
        for(const ref of importedRefs)this.#addRecord(ref.id,'ArtifactRef',ref);
        this.#addRecord(recovery.recordRef.id,'ArtifactRef',recovery.recordRef);
        const invalidated=[...this.#state.gates,...this.#state.validations,...this.#state.reviews];
        this.#commit('RECORD',"New folder verified and authorized locally; previous confirmations and checks preserved in history",state=>{
          const {pendingGateId:_pending,...rest}=state,p=imported.value.payload;
          return {...rest,repoRoot:p.repoRoot,runtimeBindingRef:imported.ref,ownerSessionId:options.ownerSessionId,state:p.resumeState,
            revision:state.revision+1,...(state.candidate?{candidate:{...state.candidate,root:p.candidateRoot!}}:{}),
            invalidEvidenceIds:[...new Set([...state.invalidEvidenceIds,...invalidated])]};
        },{recordType:'RECONCILED',invalidatedEvidenceIds:invalidated,evidenceRefs:[...importedRefs.map(ref=>ref.id),recovery.recordRef.id]});
      }
      if(this.#state.candidate){
        const c=this.#state.candidate,read=(ref:ArtifactRef)=>Buffer.from(this.#store!.read(ref)).toString('utf8');
        const guard=ScopeGuard.restore({...spec.scope,repoRoot:this.#state.repoRoot},c,read(c.terminalProof)),observed=guard.capture(c.generation,read(c.terminalProof));
        if(observed.patch!==read(c.patch)||canonicalize(observed.manifest)!==read(c.manifest))throw new OrchestratorError('SCOPE_GUARD_FAILED');
        this.#guard=guard;this.#capture={...observed,candidate:c,handoff:read(c.handoff),artifacts:[c.manifest,c.patch,c.handoff,c.terminalProof]};
      }
      this.#addRecord(recovery.recordRef.id,'ArtifactRef',recovery.recordRef);
      const reconciliations=recoveryLease(recovery).reconciliations,refs=[recovery.recordRef.id];
      for(const a of reconciliations){
        const attempt=this.#store!.put(a.id,canonicalize(a),'application/vnd.pi-controlled-dev.reconciliation-attempt+json');
        const noDispatch=a.result==='VERIFIED_NOT_DISPATCHED',proofId=noDispatch?`dispatch-${a.id}`:`terminal-${a.id}`;
        const proof=this.#store!.put(proofId,canonicalize(noDispatch?a.noDispatchProof:a.terminalProof),noDispatch?'application/vnd.pi-controlled-dev.no-dispatch+json':'application/json');
        const audit=this.#store!.put(`commit-${a.id}`,canonicalize({schemaVersion:1,taskId:a.taskId,assignmentId:a.assignmentId,runId:a.runId,
          oldStatus:a.oldStatus,newStatus:noDispatch?'NOT_DISPATCHED':'TERMINAL',observedAt:a.observedAt,attemptRef:attempt,...(noDispatch?{dispatchProofRef:proof}:{terminalProofRef:proof}),recoveryAuthorityRef:recovery.recordRef}),
          'application/vnd.pi-controlled-dev.reconciliation+json');
        for(const ref of [attempt,proof,audit]){this.#addRecord(ref.id,'ArtifactRef',ref);refs.push(ref.id)}
      }
      if(!imported)this.#record('RECONCILED',this.#state.revision,'Verified host takeover and exact run reconciliation; no workflow effect replay',state=>({...state,ownerSessionId:options.ownerSessionId,
        runs:state.runs.map(run=>{const a=reconciliations.find(a=>a.assignmentId===run.assignmentId);return a?a.result==='VERIFIED_NOT_DISPATCHED'?{...run,status:'NOT_DISPATCHED' as const,dispatchProofRef:`dispatch-${a.id}`}:{...run,status:'TERMINAL' as const,terminalProofRef:`terminal-${a.id}`}:run})}),refs);
      if(reconciliations.some(a=>a.result==='VERIFIED_NOT_DISPATCHED'))this.recordReviewerInfrastructureFailure({code:'TASK_REQUEST_LIMIT',dispatchOutcome:'NOT_SENT'},this.#state.revision);
      if(!imported&&this.#state.state==='READY'){
        const approval=[...this.#state.gates].reverse().map(id=>this.#recordValue(id,'HumanGate') as HumanGate)
          .find(g=>g.type==='beforeImplementation'&&g.status==='CONSUMED'&&g.consumedEventId===ledger.state.lastEventId);
        if(approval){this.#writerApproval={gate:approval,dataHash:approval.approvedDataHash};if(approval.authorizationKind==='PolicyDerivedAuthorization'){this.#policyRecoveryWriter=true;this.#policyWriterCheck=()=>{throw new Error('POLICY_RECOVERY_REAUTHORIZATION_REQUIRED')};}}
      }
      return;
    }
    for(const artifact of [spec.plan.snapshot,spec.currentTask.snapshot,...(options.artifacts??[])])this.#addRecord(artifact.id,'ArtifactRef',artifact);
    const timestamp=this.#now(),eventId='event-r0';
    this.#state={schemaVersion:1,taskId:spec.taskId,packageVersion:'0.0.0-dev',revision:0,state:'PENDING',
      spec:this.#store?.writeSpec(spec)??memoryArtifact('spec',canonicalize(spec),spec.specHash),specHash:spec.specHash,ownerSessionId:options.ownerSessionId,
      repoRoot:spec.scope.repoRoot,...(options.baselineRef?{baselineRef:options.baselineRef}:{}),...(options.baselineCommit?{baselineCommit:options.baselineCommit}:{}),
      baselineEvidence:[],runs:[],counters:{schemaVersion:1,attempts:0,reworkAttempts:0,infrastructureRetries:0,dispatches:0,escalationEpisodes:0,oracleInvocations:0},
      failures:[],escalations:[],decisions:[],validations:[],reviews:[],results:[],gates:[],capabilities:[],invalidEvidenceIds:[],completionEvidenceRefs:[],
      lastEventId:eventId,createdAt:timestamp,updatedAt:timestamp};
    this.#addRecord('spec','TaskSpec',spec);
    const records=[...this.#records.values()],catalog=this.#store?.catalog(records);
    if(catalog)this.#addRecord(catalog.id,'ArtifactRef',catalog);
    const stateAfter=this.#artifact(this.#stateRecordId,canonicalize(this.#state));
    const draft:any={schemaVersion:1,id:eventId,taskId:spec.taskId,kind:'CREATE',actor:'Orchestrator',targetState:'PENDING',revision:0,
      timestamp,reason:this.#store?'Normalized TaskSpec persisted':'Normalized TaskSpec accepted in memory',evidenceRefs:catalog?[catalog.id]:[],invalidatedEvidenceIds:[],stateAfter,eventHash:'0'.repeat(64)};
    draft.eventHash=hashContract('TransitionEvent',draft);const event=Object.freeze(draft) as TransitionEvent;
    this.#store?.commit(this.#state,event,records);
    if(this.#store&&shouldRefreshHumanView(event))refreshHumanView(this.#store.root,{machineDataRoot:this.#store.agentDataRoot});
    this.#events.push(event);this.#addRecord('spec','TaskSpec',spec);this.#addRecord(this.#stateRecordId,'WorkflowState',this.#state);this.#addRecord(event.id,'TransitionEvent',event);
    this.#assertState();
  }
  static initialize(taskInput:unknown,options:InitializeOptions):CentralOrchestrator{
    try{
      const artifacts=[...(options.artifacts??[])];
      const context:ValidationContext={records:artifacts.map(value=>({id:value.id,kind:'ArtifactRef' as const,value})),modelExtracted:false};
      const spec=freezeTaskSpec(taskInput,context);return new CentralOrchestrator(spec,options);
    }catch(error){if(error instanceof OrchestratorError)throw error;throw new OrchestratorError('ORCHESTRATOR_TASK_INVALID')}
  }
  static restore(authority:RecoveryAuthority,runners:RoleDispatchers):CentralOrchestrator{
    const lease=recoveryLease(authority,true);
    return new CentralOrchestrator(lease.spec,{ownerSessionId:authority.sessionId,runners,store:lease.store,lockManager:lease.manager,locks:lease.locks},authority);
  }
  resumeRecovered():DecisionResult{
    if(!this.#recoveryAuthority||!this.#store)throw new Error('RECOVERY_AUTHORITY_REQUIRED');
    this.#cas(this.#state.revision);this.#requireQuiescent();
    const action=classifyResumeAction(this.#store.agentDataRoot,this.#store.root).action;
    if(action==='HUMAN_ACTION_REQUIRED')return {decision:'HUMAN_GATE_REQUIRED',state:this.state};
    if(action!=='RESUME_FROM_DURABLE_STATE')throw new Error(action);
    if(this.#state.state==='BLOCKED'&&this.#state.blockedReason==='Scout dispatch/result failed'){
      const data=scoutRecoveryData(DurableStore.load(this.#store.root),this.#store);
      this.#requireDispatch('scout');
      const ref=this.#store.put(`scout-recovery-${randomUUID()}`,canonicalize({...data,recoveryAuthorityRef:this.#recoveryAuthority.recordRef}));this.#addRecord(ref.id,'ArtifactRef',ref);
      const routed=this.routeFailure({phase:'ANALYZING',source:'RPC_TRANSIENT',code:'SCOUT_READ_ONLY_INTERRUPTED',subjectIds:[data.assignmentId],evidenceRefs:[data.terminalProofRef.id,ref.id]},
        {dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:true,writerTerminal:true,workspaceSafe:true,sameProtocol:true,concreteHumanResolution:false,duplicateEscalation:false},this.#state.revision);
      if(routed.decision!=='RETRY_INFRASTRUCTURE')throw new Error('SCOUT_RECOVERY_UNAVAILABLE');
      this.#transition('TR-032',this.#state.revision,this.#facts('U','A','effect'),'Explicit read-only retry after verified takeover, terminal child and unchanged baseline');
      return {decision:'CONTINUE_TO_READY',state:this.state};
    }
    if(this.#state.state==='BLOCKED'&&this.canOpenBeforeDeveloperRecovery())return {decision:'HUMAN_GATE_REQUIRED',state:this.state};
    if(this.#state.state==='BLOCKED'&&this.canOpenBeforeScopeBaselineRecovery())return {decision:'HUMAN_GATE_REQUIRED',state:this.state};
    if(this.#state.state==='BLOCKED'&&this.canOpenBeforeBoundedDeveloperRecovery())return {decision:'HUMAN_GATE_REQUIRED',state:this.state};
    if(this.#state.state==='BLOCKED'&&this.canOpenBeforeReviewerRedispatch())return {decision:'HUMAN_GATE_REQUIRED',state:this.state};
    if(this.#state.state==='REVIEWING'&&this.reviewerRedispatchAuthorized())return {decision:'DISPATCH_REVIEWER',state:this.state};
    if(this.#state.state==='ANALYZING'&&this.#latestResult('Scout')){
      if(!this.scoutClarifications().covered)return {decision:'ADVISORY_REQUIRED',state:this.state};
      try{this.verifyScoutClarificationDelivery()}catch(error){if(error instanceof Error&&error.message==='SCOUT_CLARIFICATION_DELIVERY_LIMIT')return {decision:'ADVISORY_REQUIRED',state:this.state};throw error}
      return this.ready(this.#state.revision);
    }
    return {decision:this.#state.state==='READY'?'DISPATCH_DEVELOPER':'CONTINUE_TO_READY',state:this.state};
  }
  async abandonRecovered(ctx:HumanGateChannel,reason:string):Promise<void>{
    if(!this.#recoveryAuthority||!this.#store||this.#state.state!=='BLOCKED'||!validateScalar('Text',reason).ok)throw new Error('RECOVERY_ABANDON_DENIED');
    this.#cas(this.#state.revision);this.#requireQuiescent();const revision=this.#state.revision;
    if(ctx.sessionManager.getSessionId()!==this.#ownerSessionId)throw new HumanDecisionStaleError('SESSION_CHANGED');
    const source=await requestHumanConfirmation(ctx,`Close attempt ${this.spec.taskId} as incomplete?\nReason: ${reason}\nThe task will be recorded as FAILED. Candidate copies and logs remain preserved. The project objective remains available for a new proposal. No gate is approved.`,"Close this attempt?");
    if(!source)return;
    this.#cas(revision);this.#requireQuiescent();
    if(ctx.sessionManager.getSessionId()!==this.#ownerSessionId)throw new HumanDecisionStaleError('SESSION_CHANGED');
    const ref=this.#store.put(`abandon-${randomUUID()}`,canonicalize({schemaVersion:1,taskId:this.spec.taskId,revision,reason,
      decision:'ABANDON',source,sessionId:this.#ownerSessionId,recoveryAuthorityRef:this.#recoveryAuthority.recordRef}),
      'application/vnd.pi-controlled-dev.operator-reconciliation+json');this.#addRecord(ref.id,'ArtifactRef',ref);
    this.#record('DECISION_RECORDED',revision,'Operator definitive refusal after verified takeover',state=>state,[ref.id]);
    this.#transition('TR-035',this.#state.revision,{...this.#facts('F'),budgetExhaustedWithoutResolution:false,definitiveHumanRejection:true},reason);
    this.#lockManager.releaseAll(this.#locks);
  }
  representPendingGate(ctx:HumanGateChannel):HumanGateRequest{
    if(ctx?.mode!=='tui'||(typeof ctx.ui?.custom!=='function'&&typeof ctx.ui?.confirm!=='function'))throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
    if(ctx.sessionManager?.getSessionId()!==this.#ownerSessionId)throw new HumanDecisionStaleError('SESSION_CHANGED');
    if(!this.#recoveryAuthority||!this.#store||this.#state.state!=='AWAITING_HUMAN')throw new Error('RECOVERY_PRESENTATION_DENIED');
    this.#cas(this.#state.revision);this.#requireQuiescent();
    const gate=this.#recordValue(this.#state.pendingGateId!,'HumanGate') as HumanGate;
    if(gate.status!=='PENDING'||[...this.#records.values()].some(r=>r.kind==='HumanDecisionEvidence'&&r.value.gateId===gate.id))throw new Error('GATE_ALREADY_DECIDED');
    if(gate.specHash!==this.#state.specHash||gate.candidateDigest!==this.#state.candidate?.digest||gate.candidateGeneration!==this.#state.candidate?.generation)throw new HumanDecisionStaleError('GATE_BINDING_CHANGED');
    if(this.#state.candidate)this.#verifyCandidateCurrent();
    const previous=gatePresentations(gate,[...this.#records.values()],this.#events,this.#store).at(-1);
    if(previous?.value.recoveryAuthorityRef?.id===this.#recoveryAuthority.recordRef.id)throw new Error('PRESENTATION_ALREADY_CURRENT');
    const ref=this.#newPresentation(gate,this.#state.revision+1,previous);
    this.#record('RECONCILED',this.#state.revision,'Pending gate explicitly re-presented after verified takeover',state=>state,[ref.id]);
    return this.#requestForGate(gate,ref);
  }
  lockStatus():Readonly<{taskLockHeld:boolean;workspaceLockHeld:boolean}>{
    return Object.freeze({taskLockHeld:this.#lockManager.verifyTaskLock(this.#locks.task),
      workspaceLockHeld:this.#lockManager.verifyWorkspaceLock(this.#locks.workspace)});
  }
  get spec():TaskSpec{return this.#spec}
  /** Host callback reuses the live workspace lease. Never exposed as a model tool. */
  withProjectLease<T>(action:(manager:LockManager,workspace:WorkflowLocks['workspace'])=>T):T{
    if(!this.#lockManager.verifyWorkspaceLock(this.#locks.workspace))throw new Error('PROJECT_LOCK_REQUIRED');
    return action(this.#lockManager,this.#locks.workspace);
  }
  get state():WorkflowState{return clone(this.#state)}
  get requiresLocalWriterConfirmation():boolean{return this.spec.humanGates.beforeImplementation||!!this.#state.runtimeBindingRef}
  get events():readonly TransitionEvent[]{return Object.freeze(this.#events.map(value=>clone(value)))}
  get candidateCapture():ScopeCapture|undefined{return this.#capture?clone(this.#capture):undefined}
  dispose():void{
    if(this.#retired)return;
    if(this.#store&&readProjectCustodian(this.#state.repoRoot)&&this.#state.runs.every(runQuiescent)
      &&this.#lockManager.verifyTaskLock(this.#locks.task)&&this.#lockManager.verifyWorkspaceLock(this.#locks.workspace)){
      this.#saveProjectCheckpoint(true);return;
    }
    // A live/uncertain child keeps its incarnation records for verified takeover.
    if(['COMPLETED','FAILED'].includes(this.#state.state)&&this.#state.runs.every(runQuiescent))
      this.#lockManager.releaseAll(this.#locks);
  }
  /** Automatic host-only persistence, after real role quiescence and publication.
   * A checkpoint records data integrity; it grants no future execution authority. */
  #saveProjectCheckpoint(release=false):void{
    if(!this.#store||!readProjectCustodian(this.#state.repoRoot))return;
    this.#cas(this.#state.revision);this.#requireQuiescent();
    const previous=currentProjectHandoffCandidatePaths(this.#state.repoRoot);
    const descriptors=previous.filter(path=>!path.startsWith(`candidates/${this.spec.taskId}/checkpoints/`));
    if(this.#state.candidate){
      const saved=captureCandidateCheckpoint(this.#state.repoRoot,this.#store.root,this.#store.agentDataRoot,
        {manager:this.#lockManager,workspaceLock:this.#locks.workspace});
      descriptors.push(`candidates/${this.spec.taskId}/checkpoints/${saved.descriptorDigest}.json`);
    }else if(['BLOCKED','AWAITING_HUMAN','READY'].includes(this.#state.state)&&this.#state.blockedReason==='Developer reported a bounded blocker'){
      // Persist the verified no-effects baseline before sealing/releasing custody.
      // The checkpoint preserves evidence; import still requires fresh approval.
      captureBoundedDeveloperCheckpoint(this.#state.repoRoot,this.#store.root,this.#store.agentDataRoot,
        {manager:this.#lockManager,workspaceLock:this.#locks.workspace,inspect:this.#store.artifactInspection});
    }
    const assertQuiescent=()=>{
      this.#requireQuiescent();
      const tasksRoot=dirname(this.#store!.root);
      for(const id of readdirSync(tasksRoot)){
        if(!validateScalar('ID',id).ok)throw new Error('PROJECT_HANDOFF_SOURCE_CHANGED');
        const root=join(tasksRoot,id),stat=lstatSync(root);
        if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(root)!==root)throw new Error('PROJECT_HANDOFF_SOURCE_CHANGED');
        const ledger=DurableStore.load(root);
        if(ledger.truncatedTailBytes||ledger.state.runs.some(run=>!runQuiescent(run)))throw new Error('PROJECT_HANDOFF_ROLE_NOT_QUIESCENT');
        if(id===this.spec.taskId&&ledger.state.revision!==this.#state.revision)throw new Error('PROJECT_CHECKPOINT_STALE');
      }
    };
    const input={repoRoot:this.#state.repoRoot,manager:this.#lockManager,workspaceLock:this.#locks.workspace,
      assertQuiescent,candidateDescriptors:descriptors};
    if(release)releaseProjectHandoff({...input,retireAuthority:()=>this.retireForProjectTransfer()});
    else sealProjectHandoff(input);
  }
  /** Called by orderly project release, before the workspace lease is removed.
   * Once retired this host cannot dispatch or mutate this workflow again. */
  retireForProjectTransfer():void{
    this.#cas(this.#state.revision);this.#requireQuiescent();if(this.#state.candidate)this.#verifyCandidateCurrent();
    if(!this.#store||!this.#lockManager.verifyTaskLock(this.#locks.task)||!this.#lockManager.verifyWorkspaceLock(this.#locks.workspace))throw new Error('PROJECT_TRANSFER_AUTHORITY_INVALID');
    this.#retired=true;this.#writerApproval=undefined;this.#humanRequest=undefined;this.#presentation=undefined;
    this.#lockManager.release(this.#locks.task);
  }
  context(assignment?:AssignmentEnvelope,currentValidationIds?:readonly string[],stateOverride?:WorkflowState):ValidationContext{
    const records=[...this.#records.values()];
    if(assignment&&!records.some(record=>record.id===assignment.assignmentId))records.push({id:assignment.assignmentId,kind:'AssignmentEnvelope',value:assignment});
    if(stateOverride)records.push({id:'state-operational',kind:'WorkflowState',value:stateOverride});
    return Object.freeze({records,specId:this.#specRecordId,...(assignment?{assignmentId:assignment.assignmentId}:{}),
      stateId:stateOverride?'state-operational':this.#stateRecordId,...(this.#previousStateRecordId?{previousStateId:this.#previousStateRecordId}:{}),
      ...(currentValidationIds?{currentValidationIds}:{}),modelExtracted:false,
      ...(this.#store?{runtimeRootMappings:verifiedRuntimeRootMappings(records,this.#events,this.#store)}:{})});
  }

  async analyze(expectedRevision:number,options:ScoutRunOptions={}):Promise<DecisionResult<ScoutResult>>{
    this.#cas(expectedRevision);this.#requireDispatch('scout');
    if(this.#state.state==='PENDING')this.#transition('TR-001',expectedRevision,this.#facts('A','effect'));
    else if(this.#state.state!=='ANALYZING'||this.#latestResult('Scout'))throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    const assignment=createAssignment(this.spec,this.#state,'Scout');this.#registerAssignment(assignment);this.#intent(assignment,this.#state.revision);
    try{
      const output=await this.#runners.scout!(assignment,this.context(assignment),{...options,...this.#terminalOptions(assignment)});this.acceptChildResult(assignment,output,this.#state.revision);
      return Object.freeze({decision:output.result.ambiguities.length?'ADVISORY_REQUIRED':'CONTINUE_TO_READY',state:this.state,value:output.result});
    }catch(error){this.#unknown(assignment,'Scout dispatch/result failed');this.#blockCurrent('Scout dispatch/result failed');throw error}
  }
  #scoutClarificationContext():ScoutClarificationContext{return {spec:this.spec,state:this.#state,records:[...this.#records.values()],events:this.#events}}
  scoutClarifications(){return scoutClarificationCoverage(this.#scoutClarificationContext(),this.#store??{read(){throw new Error('SCOUT_CLARIFICATION_STORE_REQUIRED')}})}
  #clarificationDelivery(){
    if(!this.scoutClarifications().covered)throw new OrchestratorError('ADVISORY_REQUIRED','SCOUT_CLARIFICATION_REQUIRED');
    return createScoutClarificationDelivery(this.#scoutClarificationContext(),this.#store??{read(){throw new Error('SCOUT_CLARIFICATION_STORE_REQUIRED')}});
  }
  verifyScoutClarificationDelivery():void{this.#clarificationDelivery()}
  #clarificationRefs():readonly string[]{return this.#clarificationDelivery()?.evidenceRefs??[]}
  createScoutAnswer(index:number,answer:string,impact:ScoutAnswerImpact,impactReason:string,expectedRevision:number,sessionId:string):TrustedConfirmationRequest{
    this.#cas(expectedRevision);this.#requireQuiescent();
    if(!this.#store||this.#state.state!=='ANALYZING'||this.#state.pendingGateId||sessionId!==this.#ownerSessionId
      ||!this.#lockManager.verifyTaskLock(this.#locks.task)||!this.#lockManager.verifyWorkspaceLock(this.#locks.workspace))throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    const coverage=this.scoutClarifications();
    if(coverage.status==='INVALID_EVIDENCE'||(!coverage.missingIndices.includes(index)&&!coverage.answers.some(a=>a.ambiguityIndex===index)))throw new OrchestratorError('ADVISORY_REQUIRED','SCOUT_CLARIFICATION_INVALID');
    return createScoutClarificationRequest(this.#scoutClarificationContext(),index,answer,impact,impactReason);
  }
  acceptScoutAnswer(request:TrustedConfirmationRequest,receipt:TrustedConfirmationReceipt,expectedRevision:number):void{
    this.#cas(expectedRevision);this.#requireQuiescent();
    if(!this.#store||this.#state.state!=='ANALYZING'||this.#state.pendingGateId
      ||receipt.confirmationInstance.sessionId!==this.#ownerSessionId||!this.#lockManager.verifyTaskLock(this.#locks.task)
      ||!this.#lockManager.verifyWorkspaceLock(this.#locks.workspace))throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    const coverage=this.scoutClarifications(),index=(request.payload as unknown as {ambiguityIndex:number}).ambiguityIndex;
    const oldAnswer=coverage.answers.find(a=>a.ambiguityIndex===index);
    if(!coverage.missingIndices.includes(index)&&!oldAnswer)throw new OrchestratorError('ADVISORY_REQUIRED','SCOUT_CLARIFICATION_INVALID');
    const oldDecision=oldAnswer?this.#state.decisions.find(d=>!this.#state.invalidEvidenceIds.includes(d.id)&&d.subjectId===oldAnswer.scoutResultId
      &&d.evidenceRefs.some(id=>{const r=this.#records.get(id);return r?.kind==='ArtifactRef'&&d.id===`scout-answer-${hashCanonical({answer:oldAnswer,ref:r.value}).slice(0,24)}`})):undefined;
    if(oldAnswer&&!oldDecision)throw new OrchestratorError('ADVISORY_REQUIRED','SCOUT_CLARIFICATION_INVALID');
    const acquired=consumeScoutClarification(request,receipt,()=>this.#scoutClarificationContext(),this.#store);
    this.#addRecord(acquired.confirmationRef.id,'ArtifactRef',acquired.confirmationRef);
    this.#addRecord(acquired.decision.id,'DecisionRecord',acquired.decision);
    const invalidated=oldDecision?[oldDecision.id]:[];
    this.#commit('RECORD',"Operator answer confirmed for the Scout's frozen question",
      state=>({...state,revision:state.revision+1,decisions:[...state.decisions,acquired.decision],invalidEvidenceIds:[...state.invalidEvidenceIds,...invalidated]}),
      {recordType:'DECISION_RECORDED',invalidatedEvidenceIds:invalidated,evidenceRefs:[...acquired.decision.evidenceRefs,...invalidated]});
  }
  ready(expectedRevision:number):DecisionResult{
    this.#cas(expectedRevision);
    const scout=this.#latestResult('Scout') as ScoutResult|undefined;
    if(!scout||!this.scoutClarifications().covered||scout.risks.some(r=>r.blocking))throw new OrchestratorError('ADVISORY_REQUIRED',scout?.risks.some(r=>r.blocking)?'SCOUT_BLOCKING_RISK':'SCOUT_CLARIFICATION_REQUIRED');
    this.verifyScoutClarificationDelivery();
    if(!this.#runners.developer||!this.#runners.reviewer)throw new OrchestratorError('ROLE_CAPABILITY_UNAVAILABLE');
    if(!this.#state.baselineCommit)throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    this.#transition('TR-005',expectedRevision,this.#facts('R'));
    return Object.freeze({decision:'DISPATCH_DEVELOPER',state:this.state});
  }
  async implement(expectedRevision:number,workRoot:string,options:DeveloperRunOptions={}):Promise<DecisionResult<DeveloperResult>>{
    this.#cas(expectedRevision);this.#requireWriterApproval();
    const retryRoot=this.developerRecoveryWorktree()??this.scopeBaselineRecoveryWorktree()??this.boundedDeveloperRecoveryWorktree();
    if(retryRoot&&workRoot!==retryRoot)throw new HumanDecisionStaleError('IMPLEMENTATION_DATA_CHANGED');
    if(this.#state.candidate)throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    this.#requireDispatch('developer');
    try{this.#guard=this.#scopeGuardFactory(this.spec,workRoot,this.#state.baselineCommit!,0)}catch(error){
      if(error instanceof ScopeGuardError){this.#transition('TR-012',expectedRevision,this.#facts('X'),'Scope baseline could not be proven');throw new OrchestratorError('SCOPE_GUARD_FAILED')}throw error}
    const baselineEvidence=this.#acquireDeveloperBaseline(workRoot);
    this.#transition('TR-009',this.#state.revision,this.#facts('R','I','effect'));this.#writerApproval=undefined;
    const assignment=createAssignment(this.spec,this.#state,'Developer',{workRoot,inputArtifactRefs:[this.spec.plan.snapshot.id,this.spec.currentTask.snapshot.id,...this.#clarificationRefs(),...(baselineEvidence?.evidenceRefs??[])]});this.#registerAssignment(assignment);this.#intent(assignment,this.#state.revision);
    try{
      const output=await this.#runners.developer!(assignment,this.context(assignment),{...options,baselineEvidence,scoutClarifications:this.#clarificationDelivery(),...this.#terminalOptions(assignment)});this.acceptChildResult(assignment,output,this.#state.revision);
      if(output.result.blockedReason){this.#transition('TR-015',this.#state.revision,this.#facts('B'),'Developer reported a bounded blocker');return Object.freeze({decision:'BLOCKED',state:this.state,value:output.result})}
      const terminal=this.#terminalBytes(assignment,output);
      this.#capture=this.#guard.capture(1,terminal);this.#recordCapture(this.#capture,this.#state.revision,terminal);
      return Object.freeze({decision:'VALIDATION_REQUIRED',state:this.state,value:output.result});
    }catch(error){this.#unknown(assignment,'Developer dispatch/result failed');this.#blockCurrent(error instanceof ScopeGuardError?'Candidate scope/integrity failed':'Developer dispatch/result failed');
      if(error instanceof ScopeGuardError)throw new OrchestratorError('SCOPE_GUARD_FAILED');throw error}
  }
  async rework(expectedRevision:number,workRoot:string,options:DeveloperRunOptions={}):Promise<DecisionResult<DeveloperResult>>{
    this.#cas(expectedRevision);const gated=this.requiresLocalWriterConfirmation;
    if((this.#state.state!=='REWORK'&&!(gated&&this.#state.state==='READY'))||!this.#guard||!this.#capture)throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    if(this.#state.counters.reworkAttempts>=this.spec.retryPolicy.maxReworkAttempts)throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    if(gated)this.#requireWriterApproval();
    this.#requireDispatch('developer');
    if(this.#state.runs.some(run=>!runQuiescent(run))||!this.#guard.prepareRework||!this.#guard.finishRework)
      throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    this.#verifyCandidateCurrent();
    this.#record('RECONCILED',this.#state.revision,'Host intent: prepare current candidate as isolated rework base',state=>state);
    let base:AuthorizedReworkBase;
    try{base=this.#guard.prepareRework(this.#capture,workRoot)}catch(error){this.#blockCurrent('Rework source/base preparation failed');throw error}
    const baselineEvidence=this.#acquireDeveloperBaseline(base.workRoot,base.baseCommit,true);
    this.#transition(gated?'TR-009':'TR-027',this.#state.revision,this.#facts('R','I','W','effect'),'Bounded rework admitted');
    this.#writerApproval=undefined;
    const assignment=createAssignment(this.spec,this.#state,'Developer',{workRoot:base.workRoot,baseRef:'HEAD',baseCommit:base.baseCommit,
      candidateDigest:base.candidateDigest,candidateGeneration:base.candidateGeneration,
      inputArtifactRefs:[this.spec.plan.snapshot.id,this.spec.currentTask.snapshot.id,...base.evidenceRefs,...this.#clarificationRefs(),...(baselineEvidence?.evidenceRefs??[])]});this.#registerAssignment(assignment);
    this.#intent(assignment,this.#state.revision,true);
    try{
      const output=await this.#runners.developer!(assignment,this.context(assignment),{...options,baselineEvidence,scoutClarifications:this.#clarificationDelivery(),reworkBase:base,
        ...(this.#latestRuntimeDiagnosis()?{runtimeDiagnosis:this.#latestRuntimeDiagnosis()}:{}),...this.#terminalOptions(assignment)});this.acceptChildResult(assignment,output,this.#state.revision);
      if(output.result.blockedReason){this.#transition('TR-015',this.#state.revision,this.#facts('B'),'Developer reported a bounded blocker');return Object.freeze({decision:'BLOCKED',state:this.state,value:output.result})}
      const terminal=this.#terminalBytes(assignment,output);
      this.#capture=this.#guard.finishRework(base,terminal);this.#recordCapture(this.#capture,this.#state.revision,terminal);
      return Object.freeze({decision:'VALIDATION_REQUIRED',state:this.state,value:output.result});
    }catch(error){this.#unknown(assignment,'Rework dispatch/result failed');this.#blockCurrent(error instanceof ScopeGuardError?'Candidate scope/integrity failed':'Rework dispatch/result failed');
      if(error instanceof ScopeGuardError)throw new OrchestratorError('SCOPE_GUARD_FAILED');throw error}
  }
  #acquireDeveloperBaseline(workRoot:string,baseCommit?:string,allowKnownFailure=false):DeveloperBaselineEvidence|undefined{
    if(!this.#store)return undefined;
    this.#requireQuiescent();
    let acquired:ReturnType<typeof captureDeveloperBaseline>;
    try{acquired=captureDeveloperBaseline(this.spec,this.#state,workRoot,this.#store,{...(baseCommit?{baseCommit}:{})})}
    catch(error){this.#blockDeveloperBaseline('Initial host verification could not prove unchanged workspace');throw error}
    for(const ref of acquired.artifacts)this.#addRecord(ref.id,'ArtifactRef',ref);
    this.#record('RECONCILED',this.#state.revision,'Initial host checks acquired on the unchanged Developer worktree; post-change validation remains required',state=>state,[acquired.evidence.packageRef.id]);
    if(!acquired.complete||!acquired.passed&&!allowKnownFailure){this.#blockDeveloperBaseline('Initial host verification did not pass; no Developer dispatched');throw new OrchestratorError('DEVELOPER_BASELINE_FAILED')}
    return acquired.evidence;
  }
  #blockDeveloperBaseline(reason:string):void{
    // Before IMPLEMENTING, a disproved prerequisite follows existing TR-012;
    // no Developer attempt or generic READY-to-BLOCKED transition is invented.
    if(this.#state.state==='READY')this.#transition('TR-012',this.#state.revision,this.#facts('X'),reason);
    else this.#blockCurrent(reason);
  }
  recordCandidate(fixture:CandidateFixture,expectedRevision:number):DecisionResult<Candidate>{
    this.#cas(expectedRevision);if(!this.#capture||canonicalize(fixture.candidate)!==canonicalize(this.#capture.candidate)
      ||canonicalize(fixture.artifacts)!==canonicalize(this.#capture.artifacts))throw new OrchestratorError('SCOPE_GUARD_FAILED');
    return Object.freeze({decision:'VALIDATION_REQUIRED',state:this.state,value:this.#capture.candidate});
  }
  testing(expectedRevision:number):DecisionResult{
    this.#cas(expectedRevision);this.#requireQuiescent();const developer=this.#latestResult('Developer') as DeveloperResult|undefined;
    if(!developer||developer.blockedReason||!this.#state.candidate)throw new OrchestratorError('VALIDATION_REQUIRED');
    this.#transition('TR-013',expectedRevision,this.#facts('T','effect'));this.#saveProjectCheckpoint();
    return Object.freeze({decision:'VALIDATION_REQUIRED',state:this.state});
  }
  validateApproved(expectedRevision:number):DecisionResult<readonly ValidationResult[]>{
    this.#cas(expectedRevision);this.#requireQuiescent();this.#verifyCandidateCurrent();
    if(!this.#store)throw new OrchestratorError('VALIDATION_REQUIRED');
    const inputs:ValidationResult[]=[],artifacts:ArtifactRef[]=[];
    for(const command of this.spec.validationCommands.filter(c=>c.required)){
      const acquired=runApprovedValidation(this.spec,this.#state,command.id,this.#store);inputs.push(acquired.result);artifacts.push(...acquired.artifacts);
      if(acquired.result.status!=='PASSED')break;
    }
    return this.recordValidations(inputs,artifacts,expectedRevision);
  }
  completionPackage(expectedRevision:number):{readonly status:'COMPLETION_PACKAGE_VALID';readonly completion:'HUMAN_GATE_REQUIRED';readonly artifact:ArtifactRef}{
    this.#cas(expectedRevision);this.#requireQuiescent();this.#verifyCandidateCurrent();
    if(!this.#store||this.#state.state!=='REVIEWING')throw new OrchestratorError('COMPLETION_NOT_YET_AUTHORIZED');
    const packet=buildCompletionPackage(this.#state,[...this.#records.values()],this.#store);
    const artifact=this.#store.put(`completion-${packet.packageHash.slice(0,24)}`,canonicalize(packet),'application/vnd.pi-controlled-dev.completion+json');
    this.#addRecord(artifact.id,'ArtifactRef',artifact);
    const oldPackages=new Set([...this.#records.values()].filter(r=>r.kind==='ArtifactRef'
      &&r.value.mediaType==='application/vnd.pi-controlled-dev.completion+json').map(r=>r.id));
    this.#record('RECONCILED',expectedRevision,'Completion package verified; human authority still required',state=>({...state,
      completionEvidenceRefs:[...new Set([artifact.id,...state.completionEvidenceRefs.filter(id=>!oldPackages.has(id)),...packet.completionEvidenceRefs.map(ref=>ref.id)])]}),[artifact.id]);
    const verified=verifyCompletionPackage(packet,this.#state,[...this.#records.values()],this.#store);
    return Object.freeze({...verified,artifact});
  }
  get pendingHumanGate():HumanGateRequest|undefined{return this.#humanRequest}
  humanGateStatus():Readonly<{type:HumanGate['type'];status:HumanGate['status'];decision?:HumanDecisionEvidence['decision']}>|undefined{
    const id=this.#state.pendingGateId??this.#state.gates.at(-1);if(!id)return undefined;
    const gate=this.#recordValue(id,'HumanGate') as HumanGate;
    const decision=gate.humanDecisionRef?(this.#recordValue(gate.humanDecisionRef,'HumanDecisionEvidence') as HumanDecisionEvidence).decision:undefined;
    return Object.freeze({type:gate.type,status:gate.status,...(decision?{decision}:{})});
  }
  #implementationData(){
    if(this.spec.specHash!==this.#state.specHash||hashContract('TaskSpec',this.spec)!==this.#state.specHash)
      throw new HumanDecisionStaleError('SPEC_HASH_CHANGED');
    const git=(...args:string[])=>execFileSync('git',['--no-optional-locks','-C',this.#state.repoRoot,...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
    try{if(git('rev-parse','HEAD')!==this.#state.baselineCommit||git('rev-parse','--verify',`${this.spec.scope.baseRef}^{commit}`)!==this.#state.baselineCommit
      ||git('status','--porcelain=v1','--untracked-files=all'))throw new Error();
    }catch{throw new HumanDecisionStaleError('BASELINE_CHANGED')}
    const scout=this.#latestResult('Scout') as ScoutResult|undefined;
    if(!scout||!this.scoutClarifications().covered||scout.risks.some(r=>r.blocking))
      throw new OrchestratorError('ADVISORY_REQUIRED',!scout?'SCOUT_RESULT_MISSING':scout.ambiguities.length?'SCOUT_AMBIGUITY':'SCOUT_BLOCKING_RISK');
    return Object.freeze({schemaVersion:1,objective:this.spec.objective,specHash:this.spec.specHash,baselineCommit:this.#state.baselineCommit,
      baseRef:this.spec.scope.baseRef,scope:{...this.spec.scope,repoRoot:this.#state.repoRoot},allowedPaths:this.spec.scope.allowedPaths,deniedPaths:this.spec.scope.deniedPaths,
      requirements:this.spec.requirements,validationCommands:this.spec.validationCommands,plannedDeveloperAuthority:authority.Developer,
      knownRisks:[...scout.risks,...((this.#latestResult('Developer') as DeveloperResult|undefined)?.residualRisks??[]),
        ...((this.#latestResult('Reviewer') as ReviewResult|undefined)?.residualRisks??[])],knownBlockers:[],scoutClarifications:this.scoutClarifications().answers,
      ...(this.#state.candidate?{candidate:this.#state.candidate,findings:(this.#latestResult('Reviewer') as ReviewResult|undefined)?.findings??[]}:{}),
      ...(this.#latestRuntimeDiagnosis()?{validationFailure:this.#latestRuntimeDiagnosis()}:{}),
      ...(this.#developerRetryRef()?{developerRecovery:this.#developerRecoveryData()}:{}),
      ...(this.#scopeBaselineRecoveryRef()?{scopeBaselineRecovery:this.#scopeBaselineRecoveryData()}:{}),
      ...(this.#boundedDeveloperRecoveryRef()?{boundedDeveloperRecovery:this.#boundedDeveloperRecoveryData(),baselineExecution:{executor:'HOST',timing:'BEFORE_AND_AFTER_DEVELOPMENT',agentUses:'VERIFIED_HOST_RESULTS'}}:{}),
      originalTreeHash:inventoryHash(inventoryTree(this.#state.repoRoot,['.git']))});
  }
  #developerRetryRef(){const run=this.#state.runs.at(-1);return run?.role==='Developer'&&!run.resultRef?this.#records.get(`developer-retry-${run.assignmentId}`):undefined}
  #scopeBaselineRecoveryRef(){
    if([...this.#records.values()].some(r=>r.kind==='AssignmentEnvelope'&&r.value.role==='Developer'))return;
    return [...this.#records.values()].findLast(r=>r.kind==='ArtifactRef'&&r.id.startsWith('scope-baseline-recovery-'));
  }
  #scopeBaselineRecoveryData(){
    if(!this.#store||!this.#lockManager.verifyTaskLock(this.#locks.task)||!this.#lockManager.verifyWorkspaceLock(this.#locks.workspace))throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    const ledger=DurableStore.load(this.#store.root);
    if(canonicalize(ledger.state)!==canonicalize(this.#state))throw new HumanDecisionStaleError('PERSISTED_STATE_CHANGED');
    const data=scopeBaselineRecoveryData(ledger,this.#store),saved=this.#scopeBaselineRecoveryRef();
    if(saved?.kind==='ArtifactRef'){
      if(this.#state.invalidEvidenceIds.includes(saved.id)||Buffer.from(this.#store.read(saved.value)).toString('utf8')!==canonicalize(data))throw new HumanDecisionStaleError('IMPLEMENTATION_DATA_CHANGED');
      return {...data,proofRef:saved.value};
    }return data;
  }
  canOpenBeforeScopeBaselineRecovery():boolean{
    if(this.#state.state!=='BLOCKED'||this.#state.pendingGateId)return false;
    try{this.#scopeBaselineRecoveryData();return true}catch{return false}
  }
  openBeforeScopeBaselineRecovery(expectedRevision:number,sessionId:string):HumanGateRequest{
    this.#cas(expectedRevision);this.#requireQuiescent();
    if(this.#policyGateMode||sessionId!==this.#ownerSessionId||!this.canOpenBeforeScopeBaselineRecovery())throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    this.#requireDispatch('developer');
    if(!this.#scopeBaselineRecoveryRef()){
      const data=this.#scopeBaselineRecoveryData(),ref=this.#store!.put(`scope-baseline-recovery-${data.blockedEventId}`,canonicalize(data));
      this.#addRecord(ref.id,'ArtifactRef',ref);
      this.#record('RECONCILED',this.#state.revision,'Host re-proved unchanged scope baseline before any Developer dispatch; fresh human authorization required',state=>state,[ref.id]);
    }
    return this.#createHumanGate('beforeImplementation',canonicalize(this.#implementationData()),sessionId);
  }
  scopeBaselineRecoveryWorktree():string|undefined{
    if(!this.#scopeBaselineRecoveryRef())return;
    return this.#scopeBaselineRecoveryData().workRoot;
  }
  #developerRecoveryData(){
    if(!this.#store||!this.#lockManager.verifyTaskLock(this.#locks.task)||!this.#lockManager.verifyWorkspaceLock(this.#locks.workspace))
      throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    const ledger=DurableStore.load(this.#store.root);
    if(canonicalize(ledger.state)!==canonicalize(this.#state))throw new HumanDecisionStaleError('PERSISTED_STATE_CHANGED');
    return developerRecoveryData(ledger,this.#store);
  }
  #boundedDeveloperRecoveryId(assignmentId:string):string{
    return this.#state.runtimeBindingRef
      ?`bounded-developer-recovery-${hashCanonical({assignmentId,runtimeBindingId:this.#state.runtimeBindingRef.id})}`
      :`bounded-developer-recovery-${assignmentId}`;
  }
  #boundedDeveloperRecoveryRef(){
    const run=this.#state.runs.at(-1);
    return run?.role==='Developer'&&run.resultRef?this.#records.get(this.#boundedDeveloperRecoveryId(run.assignmentId)):undefined;
  }
  #boundedDeveloperRecoveryData(){
    if(!this.#store||!this.#lockManager.verifyTaskLock(this.#locks.task)||!this.#lockManager.verifyWorkspaceLock(this.#locks.workspace))throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    const ledger=DurableStore.load(this.#store.root);
    if(canonicalize(ledger.state)!==canonicalize(this.#state))throw new HumanDecisionStaleError('PERSISTED_STATE_CHANGED');
    const data=boundedDeveloperRecoveryData(ledger,this.#store),saved=this.#boundedDeveloperRecoveryRef();
    if(saved?.kind==='ArtifactRef'){
      if(this.#state.invalidEvidenceIds.includes(saved.id)||Buffer.from(this.#store.read(saved.value)).toString('utf8')!==canonicalize(data))throw new HumanDecisionStaleError('IMPLEMENTATION_DATA_CHANGED');
      return {...data,proofRef:saved.value};
    }return data;
  }
  canOpenBeforeBoundedDeveloperRecovery():boolean{
    const importedReady=this.#state.state==='READY'&&!!this.#state.runtimeBindingRef&&!this.#writerApproval;
    if((this.#state.state!=='BLOCKED'&&!importedReady)||this.#state.pendingGateId)return false;
    try{this.#boundedDeveloperRecoveryData();return true}catch{return false}
  }
  openBeforeBoundedDeveloperRecovery(expectedRevision:number,sessionId:string):HumanGateRequest{
    this.#cas(expectedRevision);this.#requireQuiescent();
    if(this.#policyGateMode||sessionId!==this.#ownerSessionId||!this.canOpenBeforeBoundedDeveloperRecovery())throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    this.#requireDispatch('developer');
    if(!this.#boundedDeveloperRecoveryRef()){
      const data=this.#boundedDeveloperRecoveryData(),ref=this.#store!.put(this.#boundedDeveloperRecoveryId(data.assignmentId),canonicalize(data));
      this.#addRecord(ref.id,'ArtifactRef',ref);
      this.#record('RECONCILED',this.#state.revision,'Unchanged copies and accepted bounded Developer result verified; fresh human authorization required',state=>state,[ref.id]);
    }
    return this.#createHumanGate('beforeImplementation',canonicalize(this.#implementationData()),sessionId);
  }
  boundedDeveloperRecoveryWorktree():string|undefined{
    if(!this.#boundedDeveloperRecoveryRef())return;
    return this.#boundedDeveloperRecoveryData().workRoot;
  }
  canOpenBeforeDeveloperRecovery():boolean{
    if(this.#state.state!=='BLOCKED'||this.#state.blockedReason!=='Developer dispatch/result failed'||this.#state.pendingGateId)return false;
    try{this.#developerRecoveryData();return true}catch{return false}
  }
  openBeforeDeveloperRecovery(expectedRevision:number,sessionId:string):HumanGateRequest{
    this.#cas(expectedRevision);this.#requireQuiescent();
    if(sessionId!==this.#ownerSessionId||!this.canOpenBeforeDeveloperRecovery())throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    const data=this.#developerRecoveryData();
    if(!('retryAuthorizationRef' in data)){
      const routed=this.routeFailure({phase:'IMPLEMENTING',source:'RPC_TRANSIENT',code:data.failureCode,
        subjectIds:[data.assignmentId],evidenceRefs:[data.terminalProofRef.id]},
        {dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:true,writerTerminal:true,workspaceSafe:true,sameProtocol:true,
          concreteHumanResolution:false,duplicateEscalation:false},this.#state.revision);
      if(routed.decision!=='RETRY_INFRASTRUCTURE')throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
      const ref=this.#store!.put(`developer-retry-${data.assignmentId}`,canonicalize(data));this.#addRecord(ref.id,'ArtifactRef',ref);
      this.#record('RECONCILED',this.#state.revision,this.#policyGateMode?'Bounded Developer connection retry admitted; new policy authorization required':'Bounded Developer connection retry admitted; new human approval required',state=>state,[ref.id]);
    }
    this.#requireDispatch('developer');
    return this.#createHumanGate('beforeImplementation',canonicalize(this.#implementationData()),sessionId);
  }
  /** Host lookup only; a caller cannot replace the worktree bound to the new confirmation. */
  developerRecoveryWorktree():string|undefined{
    if(!this.#developerRetryRef())return;
    this.#developerRecoveryData();return this.#assignments.get(this.#state.runs.at(-1)!.assignmentId)!.workRoot;
  }
  #requireWriterApproval():void{
    this.#policyWriterCheck?.();
    if(!this.requiresLocalWriterConfirmation&&!this.#developerRetryRef()&&!this.#scopeBaselineRecoveryRef()&&!this.#boundedDeveloperRecoveryRef())return;
    const approval=this.#writerApproval;
    if(!approval||this.#state.state!=='READY'||(approval.gate.consumedEventId!==this.#state.lastEventId&&
      !(this.#recoveryAuthority&&this.#events.at(-1)?.evidenceRefs.includes(this.#recoveryAuthority.recordRef.id)&&this.#events.at(-2)?.id===approval.gate.consumedEventId)))throw new OrchestratorError('HUMAN_GATE_REQUIRED');
    if(approval.gate.specHash!==this.#state.specHash||hashCanonical(this.#implementationData())!==approval.dataHash)
      throw new HumanDecisionStaleError('IMPLEMENTATION_DATA_CHANGED');
    if(!this.#lockManager.verifyTaskLock(this.#locks.task))throw new HumanDecisionStaleError('TASK_LOCK_LOST');
    if(!this.#lockManager.verifyWorkspaceLock(this.#locks.workspace))throw new HumanDecisionStaleError('WORKSPACE_LOCK_LOST');
  }
  policyWriterReauthorizationRequired():boolean{return this.#policyRecoveryWriter}
  openPolicyGate(type:'beforeImplementation'|'beforeCompletion'|'beforeReviewerRedispatch'|'onScopeChange',revision:number,sessionId:string,proposed?:unknown,reason='In-bound scope adjustment'):HumanGateRequest{
    if(this.#policyGateMode)throw new Error('POLICY_GATE_REENTRANT');this.#policyGateMode=true;
    try{switch(type){case 'beforeImplementation':return this.openBeforeImplementation(revision,sessionId);
      case 'beforeCompletion':return this.openBeforeCompletion(revision,sessionId);
      case 'beforeReviewerRedispatch':return this.openBeforeReviewerRedispatch(revision,sessionId);
      case 'onScopeChange':return this.openOnScopeChange(revision,proposed,reason,sessionId);}}
    finally{this.#policyGateMode=false}
  }
  openPolicyDeveloperRecovery(revision:number,sessionId:string):HumanGateRequest{
    if(this.#policyGateMode)throw new Error('POLICY_GATE_REENTRANT');this.#policyGateMode=true;
    try{return this.openBeforeDeveloperRecovery(revision,sessionId)}finally{this.#policyGateMode=false}
  }
  openBeforeImplementation(expectedRevision:number,sessionId:string):HumanGateRequest{
    this.#cas(expectedRevision);this.#requireQuiescent();
    if(this.#state.state==='READY'&&this.canOpenBeforeBoundedDeveloperRecovery())return this.openBeforeBoundedDeveloperRecovery(expectedRevision,sessionId);
    if(!this.requiresLocalWriterConfirmation||!['READY','REWORK'].includes(this.#state.state))throw new OrchestratorError('HUMAN_GATE_REQUIRED');
    this.#requireDispatch('developer');
    if(this.#state.state==='REWORK'){
      if(this.#state.counters.reworkAttempts>=this.spec.retryPolicy.maxReworkAttempts)throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
      this.#verifyCandidateCurrent();
    }
    return this.#createHumanGate('beforeImplementation',canonicalize(this.#implementationData()),sessionId);
  }
  openOnScopeChange(expectedRevision:number,proposedInput:unknown,reason:string,sessionId:string):Readonly<HumanGateRequest&{approvedData:ApprovedScopeChangeData}>{
    this.#cas(expectedRevision);this.#requireQuiescent();
    if(!this.#store||!['ANALYZING','READY'].includes(this.#state.state)||sessionId!==this.#ownerSessionId||!validateScalar('Text',reason).ok)
      throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    let proposed:TaskSpec;
    try{proposed=freezeTaskSpec(proposedInput,{records:[...this.#records.values()],modelExtracted:false})}
    catch{throw new OrchestratorError('ORCHESTRATOR_TASK_INVALID')}
    if(proposed.taskId!==this.spec.taskId||proposed.specRevision!==this.spec.specRevision+1
      ||proposed.scope.repoRoot!==this.spec.scope.repoRoot||proposed.scope.baseRef!==this.spec.scope.baseRef
      ||canonicalize(proposed.retryPolicy)!==canonicalize(this.spec.retryPolicy)
      ||proposed.scope.allowedPaths.some(isFixedDeniedPath)||proposed.scope.deniedPaths.some(isFixedDeniedPath))
      throw new OrchestratorError('SCOPE_CHANGE_PROTOCOL_VIOLATION');
    const analysis=analyzeScopeChange(this.spec,proposed);
    if(!analysis.requiresHumanGate)throw new OrchestratorError('SCOPE_CHANGE_NOT_EXPANSION');
    const specId=`spec-${proposed.specHash}`,specRef=this.#store.put(specId,canonicalize(proposed));
    this.#addRecord(specId,'TaskSpec',proposed);
    const approvedData:ApprovedScopeChangeData=Object.freeze({schemaVersion:1,objective:proposed.objective,currentSpecHash:this.spec.specHash,proposedSpecHash:proposed.specHash,
      oldDeniedPaths:[...this.spec.scope.deniedPaths],proposedDeniedPaths:[...proposed.scope.deniedPaths],
      oldAllowedPaths:Object.freeze([...this.spec.scope.allowedPaths]),proposedAllowedPaths:Object.freeze([...proposed.scope.allowedPaths]),
      oldRequirements:Object.freeze(this.spec.requirements.map(clone)),proposedRequirements:Object.freeze(proposed.requirements.map(clone)),
      authorityChanges:analysis.authorityChanges,exactAdditions:analysis.additions,exactRemovals:analysis.removals,reason,
      affectedAcceptanceCriteria:analysis.affectedAcceptanceCriteria});
    if(canonicalize(JSON.parse(Buffer.from(this.#store.read(specRef)).toString('utf8')))!==canonicalize(proposed))throw new HumanDecisionStaleError('PROPOSED_SPEC_HASH_CHANGED');
    return this.#createHumanGate<ApprovedScopeChangeData>('onScopeChange',canonicalize(approvedData),sessionId,proposed.specHash);
  }
  #advisoryData(type:'onOracleDecision'|'onRetryExhausted',episodeId:string){
    this.#requireQuiescent();
    const episode=this.#state.escalations.find(e=>e.id===episodeId);
    if(!episode)throw new OrchestratorError('ADVISORY_REQUIRED');
    const failures=this.#state.failures.filter(f=>episode.triggerFailureIds.includes(f.id));
    if(!failures.length)throw new OrchestratorError('ADVISORY_REQUIRED');
    const resultRun=this.#state.runs.find(r=>r.role==='Oracle'&&r.attemptId===episode.oracleAttemptId);
    const oracle=resultRun?.resultRef?this.#recordValue(resultRun.resultRef,'OracleResult') as OracleResult:undefined;
    const common={schemaVersion:1,objective:this.spec.objective,escalationEpisodeId:episode.id,episode,failures,ambiguity:episode.question,
      specHash:this.spec.specHash,candidate:this.#state.candidate??null,counters:this.#state.counters,policy:this.spec.retryPolicy,
      evidenceRefs:[...new Set(failures.flatMap(f=>f.evidenceRefs))],legalContinuations:['RECONCILE'],
      consequences:'Return to BLOCKED for host reconciliation only; no dispatch, spec change or budget increase.',
      residualRisks:((this.#latestResult('Developer') as DeveloperResult|undefined)?.residualRisks??[])};
    if(type==='onOracleDecision'){
      if(episode.closed||!oracle?.needsHumanDecision||oracle.specHash!==this.spec.specHash
        ||this.#state.invalidEvidenceIds.includes(resultRun!.resultRef!))throw new OrchestratorError('ADVISORY_REQUIRED');
      return {...common,OracleResult:oracle,options:oracle.options,recommendation:oracle.recommendation,rationale:oracle.diagnosis,
        evidenceRefs:[...new Set([...common.evidenceRefs,resultRun!.resultRef!,...oracle.evidenceRefs])]};
    }
    const last=this.#state.failures.at(-1)!,c=this.#state.counters,p=this.spec.retryPolicy;
    const exhausted=c.dispatches>=p.maxDispatches||(['TEST','REVIEW'].includes(last.category)&&c.reworkAttempts>=p.maxReworkAttempts)
      ||(last.category==='INFRA'&&c.infrastructureRetries>=p.maxInfrastructureRetries);
    // Reconciliation is legal only with a concrete, recorded resolution; an exhausted counter alone is not an alternative.
    const resolution=this.#state.decisions.find(d=>d.id===episode.decisionId&&d.kind==='RESOLVE_AMBIGUITY');
    if(!this.spec.humanGates.onRetryExhausted||!exhausted||!episode.closed||!resolution
      ||!episode.triggerFailureIds.includes(last.id)||['SCOPE','SCHEMA','RECOVERY'].includes(last.category)
      ||this.#state.invalidEvidenceIds.includes(resolution.id))throw new OrchestratorError('ADVISORY_REQUIRED');
    return {...common,failureFingerprint:last.fingerprint,failureCategory:last.category,lastFailure:last,resolution,
      attempts:c.attempts,dispatches:c.dispatches,infrastructureRetries:c.infrastructureRetries,reworkAttempts:c.reworkAttempts,
      escalationEpisodes:this.#state.escalations,evidenceRefs:[...common.evidenceRefs,resolution.id,...resolution.evidenceRefs]};
  }
  openOnOracleDecision(expectedRevision:number,episodeId:string,sessionId:string):HumanGateRequest{
    this.#cas(expectedRevision);
    return this.#createHumanGate('onOracleDecision',canonicalize(this.#advisoryData('onOracleDecision',episodeId)),sessionId);
  }
  openOnRetryExhausted(expectedRevision:number,episodeId:string,sessionId:string):HumanGateRequest{
    this.#cas(expectedRevision);
    return this.#createHumanGate('onRetryExhausted',canonicalize(this.#advisoryData('onRetryExhausted',episodeId)),sessionId);
  }
  #reviewerRedispatchData():ApprovedReviewerRedispatchData{
    if(!this.#store||!['BLOCKED','AWAITING_HUMAN','REVIEWING'].includes(this.#state.state)||this.#state.blockedReason!=='Reviewer batch failed')
      throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    this.#cas(this.#state.revision);this.#requireQuiescent();
    if(!this.#lockManager.verifyTaskLock(this.#locks.task)||!this.#lockManager.verifyWorkspaceLock(this.#locks.workspace))
      throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    this.#verifyCandidateCurrent();
    // Re-read immutable bytes at gate creation, approval and dispatch, including after restart.
    const readRecord=(id:string):Uint8Array=>{
      const record=this.#records.get(id);if(!record)throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
      const content=canonicalize(record.value);
      const ref:ArtifactRef=record.kind==='ArtifactRef'?record.value:{schemaVersion:1,id,digest:hashCanonical(record.value),
        bytes:Buffer.byteLength(content,'utf8'),relativeStorePath:`artifacts/${id}`,mediaType:'application/json'};
      return this.#store!.read(ref);
    };
    if(canonicalize(JSON.parse(Buffer.from(this.#store.read(this.#state.spec)).toString('utf8')))!==canonicalize(this.spec))
      throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    if(this.spec.specHash!==this.#state.specHash||hashContract('TaskSpec',this.spec)!==this.#state.specHash||!this.#requiredValidationsPassed()
      ||this.#state.counters.dispatches>=this.spec.retryPolicy.maxDispatches)throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    const previousReviewer=this.#state.runs.findLast(run=>run.role==='Reviewer');
    if(!previousReviewer||!runQuiescent(previousReviewer)||previousReviewer.resultRef)throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    const proofRef=runProofRef(previousReviewer)!;
    const assignment=this.#assignments.get(previousReviewer.assignmentId);
    if(!assignment||assignment.attemptId!==previousReviewer.attemptId||assignment.specHash!==this.spec.specHash
      ||assignment.candidateDigest!==this.#state.candidate?.digest||assignment.candidateGeneration!==this.#state.candidate?.generation
      ||!(previousReviewer.status==='NOT_DISPATCHED'
        ?verifyReviewerNoDispatchProof(JSON.parse(Buffer.from(readRecord(proofRef)).toString('utf8')),assignment,previousReviewer)
        :previousReviewer.runId&&previousReviewer.childSessionId&&!previousReviewer.requestId.startsWith('intent-')&&verifyTerminalProof(JSON.parse(Buffer.from(readRecord(proofRef)).toString('utf8')),
          {runId:previousReviewer.runId,role:'Reviewer',requestId:previousReviewer.requestId,ownerSessionId:previousReviewer.ownerSessionId,childSessionId:previousReviewer.childSessionId})))
      throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    const failure=this.#state.failures.at(-1);
    if(!failure||failure.phase!=='REVIEWING'||failure.category!=='INFRA'||!failure.subjectIds.includes(previousReviewer.assignmentId)
      ||!failure.evidenceRefs.includes(proofRef))throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    const candidate=this.#state.candidate!,authorizationId=`retry-authorization-${failure.id}`,authorizationRecord=this.#records.get(authorizationId);
    if(authorizationRecord?.kind!=='ArtifactRef')throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    let authorization:ReviewerRetryAuthorization;
    try{authorization=JSON.parse(Buffer.from(this.#store.read(authorizationRecord.value)).toString('utf8')) as ReviewerRetryAuthorization}catch{throw new OrchestratorError('ORCHESTRATOR_BLOCKED')}
    const expectedAuthorization:ReviewerRetryAuthorization={schemaVersion:1,action:'RETRY_INFRASTRUCTURE',taskId:this.spec.taskId,specHash:this.spec.specHash,
      candidateDigest:candidate.digest,candidateGeneration:candidate.generation,failureId:failure.id,reviewerAssignmentId:previousReviewer.assignmentId,
      reviewerAttemptId:previousReviewer.attemptId,...reviewerDispatchBinding(previousReviewer),
      infrastructureRetriesBefore:this.#state.counters.infrastructureRetries-1,infrastructureRetriesAfter:this.#state.counters.infrastructureRetries,
      dispatches:this.#state.counters.dispatches,evidenceRefs:[...failure.evidenceRefs]};
    if(authorization.action!=='RETRY_INFRASTRUCTURE'||canonicalize(authorization)!==canonicalize(expectedAuthorization)
      ||authorization.infrastructureRetriesBefore<0||authorization.infrastructureRetriesAfter>this.spec.retryPolicy.maxInfrastructureRetries)
      throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    const current=this.#currentValidations(),runtime=current.map(value=>this.#runtimeForValidation(value));
    for(const validation of current){
      if(validation.status!=='PASSED'||!validation.logRef||!validation.processProofRef
        ||canonicalize(JSON.parse(Buffer.from(readRecord(validation.id)).toString('utf8')))!==canonicalize(validation)
        ||!verifyValidationProcessProof(JSON.parse(Buffer.from(readRecord(validation.processProofRef)).toString('utf8')),
          validation,this.#state,readRecord(validation.logRef)))throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    }
    if(runtime.some(value=>!value?.evidence.complete))throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    const runtimeEvidenceRefs=runtime.flatMap(value=>[value!.ref.id,value!.eventRef.id]);
    const comparison=this.#currentRuntimeComparison();let runtimeComparisonRef:string|undefined;
    if(comparison){
      const after=runtime.find(value=>value!.evidence.id===comparison.after.evidenceId);
      const beforeRecord=this.#records.get(comparison.before.validationId);
      if(beforeRecord?.kind!=='ValidationResult')throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
      const before=this.#runtimeForValidation(beforeRecord.value);
      if(!after||comparison.after.validationId!==after.evidence.validationId||comparison.after.eventLogRef!==after.eventRef.id
        ||comparison.after.generation!==candidate.generation||comparison.after.status!=='PASSED'||comparison.conclusion!=='RESOLVED')
        throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
      if(!before?.evidence.complete||canonicalize(compareRuntimeEvidence(before.evidence,before.events,after.evidence,after.events))!==canonicalize(comparison))
        throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
      runtimeEvidenceRefs.unshift(before.ref.id,before.eventRef.id);
      runtimeComparisonRef=`runtime-comparison-${comparison.after.validationId.slice('validation-'.length)}`;
      if(this.#records.get(runtimeComparisonRef)?.kind!=='ArtifactRef')throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    }
    const evidenceRefs=[...new Set([failure.id,...failure.evidenceRefs,authorizationRecord.id,...current.flatMap(value=>[value.id,value.logRef!,value.processProofRef!]),
      ...runtimeEvidenceRefs,...(runtimeComparisonRef?[runtimeComparisonRef]:[])])];
    return Object.freeze({schemaVersion:1,objective:this.spec.objective,specHash:this.spec.specHash,candidateDigest:candidate.digest,
      candidateGeneration:candidate.generation,validationIds:Object.freeze(current.map(value=>value.id)),runtimeEvidenceRefs:Object.freeze(runtimeEvidenceRefs),
      ...(runtimeComparisonRef?{runtimeComparisonRef}:{}),failureId:failure.id,failureCode:failure.code,retryAuthorizationRef:authorizationRecord.value,
      previousReviewer:Object.freeze({assignmentId:previousReviewer.assignmentId,attemptId:previousReviewer.attemptId,...reviewerDispatchBinding(previousReviewer)}),
      evidenceRefs:Object.freeze(evidenceRefs)});
  }
  canOpenBeforeReviewerRedispatch():boolean{try{this.#reviewerRedispatchData();return this.#state.state==='BLOCKED'&&!this.#state.pendingGateId}catch{return false}}
  openBeforeReviewerRedispatch(expectedRevision:number,sessionId:string):Readonly<HumanGateRequest&{approvedData:ApprovedReviewerRedispatchData}>{
    this.#cas(expectedRevision);if(sessionId!==this.#ownerSessionId||this.#state.state!=='BLOCKED')throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
    return this.#createHumanGate<ApprovedReviewerRedispatchData>('beforeReviewerRedispatch',canonicalize(this.#reviewerRedispatchData()),sessionId);
  }
  openBeforeCompletion(expectedRevision:number,sessionId:string):Readonly<HumanGateRequest&{approvedData:ApprovedCompletionData}>{
    this.#cas(expectedRevision);this.#requireQuiescent();this.#verifyCandidateCurrent();
    if(!this.#store||this.#state.state!=='REVIEWING'||!this.spec.humanGates.beforeCompletion||sessionId!==this.#ownerSessionId)
      throw new OrchestratorError('COMPLETION_NOT_YET_AUTHORIZED');
    if(!allResidualRisksDisposed(this.#state,this.context(),this.#events))throw new OrchestratorError('ADVISORY_REQUIRED');
    const completion=this.completionPackage(expectedRevision),packet=JSON.parse(Buffer.from(this.#store.read(completion.artifact)).toString('utf8'));
    const authorization=authorizationPackage(packet,[...this.#records.values()]),authorizationPackageHash=hashCanonical(authorization);
    const authorizationPackageRef=this.#store.put(`authorization-${authorizationPackageHash.slice(0,24)}`,canonicalize(authorization),'application/vnd.pi-controlled-dev.authorization+json');
    this.#addRecord(authorizationPackageRef.id,'ArtifactRef',authorizationPackageRef);
    const candidate=this.#state.candidate!,review=this.#latestResult('Reviewer') as ReviewResult;
    const developer=this.#latestResult('Developer') as DeveloperResult;
    const approvedData:ApprovedCompletionData=Object.freeze({schemaVersion:1,objective:this.spec.objective,specHash:this.spec.specHash,
      baselineCommit:this.#state.baselineCommit!,candidateDigest:candidate.digest,candidateGeneration:candidate.generation,
      manifestRef:candidate.manifest,patchRef:candidate.patch,validation:this.#currentValidations().map(v=>Object.freeze({id:v.id,commandId:v.commandId,
        status:v.status,logRef:v.logRef!,processProofRef:v.processProofRef!})),reviewResult:review,reviewRef:this.#state.reviews.at(-1)!,
      residualRisks:Object.freeze([...developer.residualRisks,...review.residualRisks]),decisions:Object.freeze([...this.#state.decisions]),
      changedFiles:Object.freeze([...this.#capture!.changedFiles]),authorizationPackageHash,authorizationPackageRef});
    return this.#createHumanGate<ApprovedCompletionData>('beforeCompletion',canonicalize(approvedData),sessionId);
  }
  #createHumanGate<T extends object>(gateType:ImplementedHumanGate,approvedDataBytes:string,sessionId:string,proposedSpecHash?:string):Readonly<HumanGateRequest&{approvedData:T}>{
    this.#requireQuiescent();
    if(this.spec.specHash!==this.#state.specHash||hashContract('TaskSpec',this.spec)!==this.#state.specHash)
      throw new HumanDecisionStaleError('SPEC_HASH_CHANGED');
    const approvedData=JSON.parse(approvedDataBytes) as T;
    if(canonicalize(approvedData)!==approvedDataBytes)throw new Error('HUMAN_DECISION_INVALID');
    const advisory=gateType==='onOracleDecision'||gateType==='onRetryExhausted',redispatch=gateType==='beforeReviewerRedispatch';
    const developerRecovery=gateType==='beforeImplementation'&&(Object.hasOwn(approvedData,'developerRecovery')||Object.hasOwn(approvedData,'scopeBaselineRecovery')||Object.hasOwn(approvedData,'boundedDeveloperRecovery'))&&this.#state.state==='BLOCKED';
    const final=gateType==='beforeCompletion',scope=gateType==='onScopeChange',rework=!final&&!scope&&!redispatch&&this.#state.state==='REWORK';
    if(advisory&&!['ANALYZING','REWORK','BLOCKED'].includes(this.#state.state))throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    const source=redispatch||developerRecovery?'BLOCKED':advisory||scope?this.#state.state:final?'REVIEWING':rework?'REWORK':'READY';
    const resume=redispatch?'REVIEWING':advisory?'BLOCKED':final?'REVIEWING':scope?'ANALYZING':'READY';
    const transition=redispatch||developerRecovery?'TR-034':advisory?(source==='ANALYZING'?'TR-007':source==='REWORK'?'TR-030':'TR-034'):final?'TR-025':scope?(source==='READY'?'TR-010':'TR-007'):rework?'TR-030':'TR-010';
    if(scope&&!proposedSpecHash)throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    if(!this.#store||sessionId!==this.#ownerSessionId||this.#state.state!==source||this.#state.pendingGateId)
      throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    const candidate=this.#state.candidate;
    // Internal snapshot transport retains its old field name; its value is exclusively the authorization hash.
    const completionPackageHash=final?(approvedData as unknown as ApprovedCompletionData).authorizationPackageHash:undefined;
    const approved=this.#store.put(`approved-data-${hashCanonical(approvedData).slice(0,24)}`,approvedDataBytes,
      'application/vnd.pi-controlled-dev.approved-data+json');
    if(approved.digest!==hashCanonical(approvedData))throw new HumanDecisionStaleError('APPROVED_DATA_HASH_CHANGED');
    this.#addRecord(approved.id,'ArtifactRef',approved);
    const displayedRevision=this.#state.revision+1,gateId=`gate-${randomUUID()}`,now=this.#now();
    const gate:HumanGate=Object.freeze({schemaVersion:this.#policyGateMode?2:1,...(this.#policyGateMode?{authorizationKind:'PolicyDerivedAuthorization' as const}:{}),id:gateId,taskId:this.spec.taskId,type:gateType,requestedBy:'Orchestrator',status:'PENDING',
      specHash:this.spec.specHash,...(proposedSpecHash?{proposedSpecHash}:{}),approvedData:approved,approvedDataHash:approved.digest,
      stateRevision:displayedRevision,resumeState:resume,continuation:advisory?'RECONCILE':final||redispatch?'REVIEW_FINAL':scope?'ANALYZE':'PREPARE',requestedAt:now,
      ...(candidate?{candidateDigest:candidate.digest,candidateGeneration:candidate.generation}:{})});
    this.#addRecord(gateId,'HumanGate',gate);
    const binding={taskId:this.spec.taskId,specHash:this.spec.specHash,...(candidate?{candidate:{digest:candidate.digest,generation:candidate.generation}}:{})};
    const gateContext={id:gateId,type:gate.type,status:gate.status,resumeState:gate.resumeState,continuation:gate.continuation,binding,
      ...(proposedSpecHash?{proposedSpecHash}:{}),dataHash:gate.approvedDataHash,displayedRevision};
    const supplied={...this.#facts(final||redispatch?'V':scope?'A':'R'),gateRequestTyped:true,gateTargetAndDataFrozen:true,writerTerminalProven:true,
      finalReviewTestsRiskPatchValid:true,...(scope?{scopeChangeProposed:true}:{}),
      ...(redispatch?{reviewerInfrastructureRetryCurrent:true}:{}),
      ...(advisory?{oracleMaterialAdvice:true,reconciliationNeeded:true,finiteExhaustionActionWithoutBudgetIncrease:true}:{})};
    const admitted=evaluateTransition({state:this.#state.state,revision:this.#state.revision,expectedRevision:this.#state.revision,transition,binding,
      evidence:{revision:this.#state.revision,binding,facts:supplied},authority:{role:'Orchestrator',origin:'host',taskId:this.spec.taskId},
      workspaceMutable:true,mutationRequired:false,writer:'terminal',gate:gateContext});
    if(!admitted.admitted)throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    const presentation=this.#newPresentation(gate,displayedRevision);
    this.#commit('TRANSITION',`${gateType} human decision requested`,state=>({...state,state:'AWAITING_HUMAN',revision:displayedRevision,
      gates:[...state.gates,gateId],pendingGateId:gateId}),{transitionId:transition,invalidatedEvidenceIds:[],evidenceRefs:[approved.id,gateId,presentation.id]});
    const committed=DurableStore.load(this.#store.root).state;
    if(canonicalize(committed)!==canonicalize(this.#state))throw new HumanDecisionStaleError('PERSISTED_STATE_CHANGED');
    const snapshot=Object.freeze({gateId,taskId:this.spec.taskId,stateRevision:committed.revision,specHash:this.spec.specHash,
      ...(proposedSpecHash?{proposedSpecHash}:{}),...(candidate?{candidateDigest:candidate.digest,candidateGeneration:candidate.generation}:{}),approvedDataHash:approved.digest,
      ...(completionPackageHash?{completionPackageHash}:{}),sessionId,presentationRef:presentation});
    const request=Object.freeze({gateType,snapshot,approvedData,displayText:approvedDataBytes});
    humanRequests.add(request);this.#humanRequest=request;this.#presentation=presentation;return request;
  }
  #newPresentation(gate:HumanGate,revision:number,previous?:{ref:ArtifactRef;value:{presentationGeneration:number}}):ArtifactRef{
    if(!this.#store)throw new Error('DURABLE_STATE_UNAVAILABLE');
    const incarnation=currentProcessIncarnation();if(!incarnation)throw new Error('PROCESS_INCARNATION_UNAVAILABLE');
    const isRebinding=revision!==gate.stateRevision;
    if(isRebinding&&!this.#recoveryAuthority)throw new Error('RECOVERY_AUTHORITY_REQUIRED');
    const value=checkGatePresentation({schemaVersion:1,id:`presentation-${randomUUID()}`,gateId:gate.id,taskId:gate.taskId,
      presentationGeneration:(previous?.value.presentationGeneration??0)+1,workflowRevision:revision,displayedDataHash:gate.approvedDataHash,
      hostProcessIncarnation:{schemaVersion:1,...incarnation},hostSessionId:this.#ownerSessionId,presentedAt:this.#now(),
      ...(isRebinding?{recoveryAuthorityRef:this.#recoveryAuthority!.recordRef}:{}),...(previous?{previousPresentationRef:previous.ref}:{})});
    const ref=this.#store.put(value.id,canonicalize(value),PRESENTATION_MEDIA);this.#addRecord(ref.id,'ArtifactRef',ref);return ref;
  }
  #requestForGate(gate:HumanGate,ref:ArtifactRef):HumanGateRequest{
    const p=checkGatePresentation(JSON.parse(Buffer.from(this.#store!.read(ref)).toString('utf8'))),displayText=Buffer.from(this.#store!.read(gate.approvedData)).toString('utf8');
    const data=JSON.parse(displayText);if(hashCanonical(data)!==gate.approvedDataHash)throw new Error('GATE_DATA_CHANGED');
    const snapshot:HumanGateSnapshot=Object.freeze({gateId:gate.id,taskId:gate.taskId,stateRevision:p.workflowRevision,specHash:gate.specHash,
      approvedDataHash:gate.approvedDataHash,sessionId:p.hostSessionId,presentationRef:ref,...(gate.proposedSpecHash?{proposedSpecHash:gate.proposedSpecHash}:{}),
      ...(gate.candidateDigest?{candidateDigest:gate.candidateDigest,candidateGeneration:gate.candidateGeneration}:{}),
      ...(gate.type==='beforeCompletion'?{completionPackageHash:data.authorizationPackageHash}:{})});
    const request=Object.freeze({gateType:gate.type,snapshot,displayText});humanRequests.add(request);this.#humanRequest=request;this.#presentation=ref;return request;
  }
  acceptHumanDecision(snapshot:HumanGateSnapshot,receipt:TrustedHumanDecision):HumanDecisionEvidence{
    if(!receipt||!humanReceipts.has(receipt))throw new Error('HUMAN_DECISION_INVALID');
    return this.#acceptDecision(snapshot,receipt) as HumanDecisionEvidence;
  }
  /** Host-only policy capability; never mint or consume a human receipt here. */
  acceptPolicyAuthorization(snapshot:HumanGateSnapshot,capability:PolicyAuthorizationCapability):void{
    const gate=this.#recordValue(snapshot.gateId,'HumanGate') as HumanGate;
    if(['onOracleDecision','onRetryExhausted'].includes(gate.type))throw new Error('POLICY_GATE_FORBIDDEN');
    this.#acceptDecision(snapshot,undefined,capability);
  }
  #acceptDecision(snapshot:HumanGateSnapshot,input:TrustedHumanDecision|undefined,policy?:PolicyAuthorizationCapability){
    const decisionKind=policy?'APPROVE':input?.decision;
    const answer=policy?undefined:input?.answer;
    const confirmedAt=policy?policy.authorization.createdAt:input?.confirmedAt;
    if(!confirmedAt||!decisionKind)throw new Error('AUTHORIZATION_INVALID');
    let sessionId=this.#ownerSessionId,source:unknown;
    if(!policy){
      if(!input||!humanReceipts.has(input))throw new Error('HUMAN_DECISION_INVALID');
      const held=humanReceipts.get(input)!;humanReceipts.delete(input);
      if(held.ctx.mode!=='tui')throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
      if(canonicalize(input.snapshot)!==canonicalize(snapshot))throw new HumanDecisionStaleError('CONFIRMATION_BINDING_CHANGED');
      sessionId=held.ctx.sessionManager.getSessionId()??'';source=held.source;
    }
    this.#humanRequest=undefined;
    this.#cas(this.#state.revision);
    this.#requireQuiescent();
    if(!this.#store)throw new HumanDecisionStaleError('DURABLE_STATE_UNAVAILABLE');
    if(sessionId!==this.#ownerSessionId)throw new HumanDecisionStaleError('SESSION_CHANGED');
    if(this.spec.specHash!==snapshot.specHash||hashContract('TaskSpec',this.spec)!==snapshot.specHash)
      throw new HumanDecisionStaleError('SPEC_HASH_CHANGED');
    const persisted=DurableStore.load(this.#store.root);
    if(persisted.truncatedTailBytes||canonicalize(persisted.state)!==canonicalize(this.#state))
      throw new HumanDecisionStaleError('PERSISTED_STATE_CHANGED');
    let pending:HumanGate;try{pending=this.#recordValue(snapshot.gateId,'HumanGate') as HumanGate}catch{throw new HumanDecisionStaleError('GATE_ID_CHANGED')}
    if(!!policy!==(pending.authorizationKind==='PolicyDerivedAuthorization'))throw new Error('GATE_AUTHORITY_KIND');
    const final=pending.type==='beforeCompletion',scope=pending.type==='onScopeChange',redispatch=pending.type==='beforeReviewerRedispatch';
    const advisory=pending.type==='onOracleDecision'||pending.type==='onRetryExhausted';
    if(!Object.hasOwn(HUMAN_GATE_DECISIONS,pending.type)
      ||!(HUMAN_GATE_DECISIONS[pending.type as ImplementedHumanGate] as readonly string[]).includes(decisionKind))throw new Error('HUMAN_DECISION_INVALID');
    const packageRecord=snapshot.completionPackageHash?[...this.#records.values()].find(r=>r.kind==='ArtifactRef'&&r.value.mediaType==='application/vnd.pi-controlled-dev.authorization+json'
      &&r.id===`authorization-${snapshot.completionPackageHash!.slice(0,24)}`):undefined;
    const staleReason=humanGateStaleReason(snapshot,{gateId:this.#state.pendingGateId??null,taskId:this.#state.taskId,state:this.#state.state,
      stateRevision:this.#state.revision,specHash:this.#state.specHash,proposedSpecHash:pending.proposedSpecHash,candidateDigest:this.#state.candidate?.digest,
      candidateGeneration:this.#state.candidate?.generation,approvedDataHash:pending.approvedDataHash,
      completionPackageHash:final?(packageRecord?snapshot.completionPackageHash:''):undefined,sessionId,
      taskLockHeld:this.#lockManager.verifyTaskLock(this.#locks.task),workspaceLockHeld:this.#lockManager.verifyWorkspaceLock(this.#locks.workspace),gateStatus:pending.status});
    if(staleReason)throw new HumanDecisionStaleError(staleReason);
    if(!snapshot.presentationRef||!this.#presentation||canonicalize(snapshot.presentationRef)!==canonicalize(this.#presentation))throw new HumanDecisionStaleError('PRESENTATION_CHANGED');
    const approvedBytes=this.#store.read(pending.approvedData),approvedData=JSON.parse(Buffer.from(approvedBytes).toString('utf8')) as ApprovedCompletionData|ApprovedScopeChangeData|ApprovedReviewerRedispatchData;
    if(hashCanonical(approvedData)!==snapshot.approvedDataHash)throw new HumanDecisionStaleError('APPROVED_DATA_HASH_CHANGED');
    if(policy&&(Object.hasOwn(approvedData,'scopeBaselineRecovery')||Object.hasOwn(approvedData,'boundedDeveloperRecovery')))throw new OrchestratorError('HUMAN_GATE_REQUIRED');
    let proposed:TaskSpec|undefined,proposedRef:ArtifactRef|undefined;
    if(final){
      const completion=approvedData as ApprovedCompletionData;
      if(completion.authorizationPackageHash!==snapshot.completionPackageHash||!packageRecord
        ||canonicalize(completion.authorizationPackageRef)!==canonicalize(packageRecord.value))
        throw new HumanDecisionStaleError('COMPLETION_PACKAGE_HASH_CHANGED');
      const packageBody=JSON.parse(Buffer.from(this.#store.read(packageRecord.value as ArtifactRef)).toString('utf8'));
      if(hashCanonical(packageBody)!==snapshot.completionPackageHash)
        throw new HumanDecisionStaleError('COMPLETION_PACKAGE_HASH_CHANGED');
    }else if(scope){
      const data=approvedData as ApprovedScopeChangeData,specId=`spec-${pending.proposedSpecHash}`;
      try{proposed=this.#recordValue(specId,'TaskSpec') as TaskSpec;proposedRef=[...this.#records.values()].find(r=>r.id===specId&&r.kind==='TaskSpec')
        ?{schemaVersion:1,id:specId,digest:hashCanonical(proposed),relativeStorePath:`artifacts/${specId}`,bytes:Buffer.byteLength(canonicalize(proposed),'utf8'),mediaType:'application/json'}:undefined}
      catch{throw new HumanDecisionStaleError('PROPOSED_SPEC_HASH_CHANGED')}
      const analysis=analyzeScopeChange(this.spec,proposed),expected:ApprovedScopeChangeData={schemaVersion:1,objective:proposed.objective,currentSpecHash:this.spec.specHash,
        oldDeniedPaths:[...this.spec.scope.deniedPaths],proposedDeniedPaths:[...proposed.scope.deniedPaths],
        proposedSpecHash:proposed.specHash,oldAllowedPaths:[...this.spec.scope.allowedPaths],proposedAllowedPaths:[...proposed.scope.allowedPaths],
        oldRequirements:this.spec.requirements.map(clone),proposedRequirements:proposed.requirements.map(clone),authorityChanges:analysis.authorityChanges,
        exactAdditions:analysis.additions,exactRemovals:analysis.removals,reason:data.reason,affectedAcceptanceCriteria:analysis.affectedAcceptanceCriteria};
      if(!analysis.requiresHumanGate||pending.proposedSpecHash!==snapshot.proposedSpecHash||proposed.specHash!==snapshot.proposedSpecHash
        ||hashContract('TaskSpec',proposed)!==proposed.specHash||canonicalize(expected)!==canonicalize(data)||!proposedRef)
        throw new HumanDecisionStaleError('PROPOSED_SPEC_HASH_CHANGED');
      try{if(canonicalize(JSON.parse(Buffer.from(this.#store.read(proposedRef)).toString('utf8')))!==canonicalize(proposed))throw new Error()}
      catch{throw new HumanDecisionStaleError('PROPOSED_SPEC_HASH_CHANGED')}
    }else if(redispatch){
      if(hashCanonical(this.#reviewerRedispatchData())!==snapshot.approvedDataHash)
        throw new HumanDecisionStaleError('REVIEWER_REDISPATCH_DATA_CHANGED');
    }else if(advisory){
      const data=approvedData as unknown as {escalationEpisodeId:string};
      if(hashCanonical(this.#advisoryData(pending.type as 'onOracleDecision'|'onRetryExhausted',data.escalationEpisodeId))!==snapshot.approvedDataHash)
        throw new HumanDecisionStaleError('ADVISORY_DATA_CHANGED');
    }else if(hashCanonical(this.#implementationData())!==snapshot.approvedDataHash)throw new HumanDecisionStaleError('IMPLEMENTATION_DATA_CHANGED');
    if(snapshot.candidateDigest!==undefined){
      try{const capture=this.#guard?.capture(snapshot.candidateGeneration!,'post-dialog-freshness');if(!capture||capture.digest!==snapshot.candidateDigest)throw new Error()}
      catch{throw new HumanDecisionStaleError('CANDIDATE_INTEGRITY_CHANGED')}
    }
    let channel:ArtifactRef,decision:HumanDecisionEvidence|{id:string;decision:'APPROVE';confirmedAt:string};
    if(policy){
      const subject=policy.authorization.subject as any;
      if(canonicalize(subject.spec)!==canonicalize(this.spec)||subject.gateId!==pending.id||subject.stateRevision!==snapshot.stateRevision||subject.approvedDataHash!==snapshot.approvedDataHash
        ||subject.specHash!==snapshot.specHash||canonicalize(subject.approvedData)!==canonicalize(approvedData))throw new Error('POLICY_GATE_BINDING');
      channel=consumePolicyCapability(policy,pending.type,subject,this.#store);
      for(const ref of [policy.authorization.policyRef,policy.authorization.policyApprovalRef,policy.authorization.planApprovalRef,channel])this.#addRecord(ref.id,'ArtifactRef',ref);
      decision={id:channel.id,decision:'APPROVE',confirmedAt};
    }else{
      const confirmationId=input!.confirmationId;
      channel=this.#store.put(`human-channel-${confirmationId}`,canonicalize({schemaVersion:2,channel:'TUI',source,presentationRef:snapshot.presentationRef,
      sessionId,actorIdentity:null,providerConfirmationId:null,confirmationId,confirmedAt,gateId:pending.id,taskId:this.spec.taskId,
      displayedRevision:snapshot.stateRevision,displayedDataHash:snapshot.approvedDataHash,decision:decisionKind,
      ...(answer!==undefined?{answerHash:hashCanonical(answer)}:{})}),
      CHANNEL_V2_MEDIA);this.#addRecord(channel.id,'ArtifactRef',channel);
      decision=Object.freeze({schemaVersion:1,id:`decision-${randomUUID()}`,gateId:pending.id,taskId:this.spec.taskId,
      decision:decisionKind,...(answer!==undefined?{answer:answer}:{}),actorId:'UNAVAILABLE',channelId:'pi-tui',confirmationId,displayedRevision:snapshot.stateRevision,
      displayedDataHash:snapshot.approvedDataHash,confirmedAt,trustedChannelEvidenceRef:channel.id});
    if(!validateContract('HumanDecisionEvidence',decision,this.context()).ok)throw new Error('HUMAN_DECISION_INVALID');
    this.#addRecord(decision.id,'HumanDecisionEvidence',decision);
    }
    if(decisionKind!=='APPROVE'){
      const ref=`${pending.id}-${decisionKind==='ANSWER'?'answered':'rejected'}`;
      const gate:HumanGate={...pending,status:decisionKind==='ANSWER'?'INVALIDATED':'REJECTED',decidedAt:confirmedAt,humanDecisionRef:decision.id,
        ...(decisionKind==='ANSWER'?{invalidationReason:'Human answer requires Orchestrator re-evaluation; not an approval'}:{})};
      this.#addRecord(ref,'HumanGate',gate);
      this.#record('GATE_DECIDED',snapshot.stateRevision,`Pi TUI ${decisionKind} recorded; no approval`,state=>({...state,
        gates:state.gates.map(id=>id===snapshot.gateId?ref:id),pendingGateId:ref}),[pending.approvedData.id,channel.id,decision.id,ref]);
      const binding={taskId:this.spec.taskId,specHash:this.spec.specHash,...(this.#state.candidate?{candidate:{digest:this.#state.candidate.digest,generation:this.#state.candidate.generation}}:{})};
      // GAT-001: confirmed definitive refusal selects F; an answer only identifies missing approval (B).
      const rejected=decisionKind==='REJECT',transition=rejected?'TR-043':'TR-042';
      const admitted=evaluateTransition({state:this.#state.state,revision:this.#state.revision,expectedRevision:this.#state.revision,transition,binding,
        evidence:{revision:this.#state.revision,binding,facts:rejected?{...this.#facts('F'),budgetExhaustedWithoutResolution:false,definitiveHumanRejection:true}:this.#facts('B')},authority:{role:'Orchestrator',origin:'host',taskId:this.spec.taskId},
        workspaceMutable:true,mutationRequired:false,writer:'terminal',...(!rejected?{blockMode:'diagnostic' as const}:{}),
        gate:{id:pending.id,type:pending.type,status:gate.status,resumeState:pending.resumeState,continuation:pending.continuation,
          binding,...(pending.proposedSpecHash?{proposedSpecHash:pending.proposedSpecHash}:{}),dataHash:pending.approvedDataHash,displayedRevision:snapshot.stateRevision}});
      if(!admitted.admitted)throw new HumanDecisionStaleError('GATE_TRANSITION_GUARD_REJECTED',admitted.reasons);
      this.#commit('TRANSITION',`Human ${decisionKind}; Orchestrator must re-evaluate, no writer authorized`,state=>{
        const {pendingGateId:_pending,...rest}=state;return {...rest,state:rejected?'FAILED':'BLOCKED',revision:state.revision+1,
          ...(rejected?{terminalReason:'Human definitive refusal; F verified'}:{blockedReason:'Human ANSWER requires re-evaluation; approval not granted'})} as WorkflowState;
      },{transitionId:transition,invalidatedEvidenceIds:[],evidenceRefs:[ref,decision.id]});
      this.#writerApproval=undefined;if(rejected)this.#lockManager.releaseAll(this.#locks);return decision;
    }
    const approvedRef=`${pending.id}-approved`,approvedGate:HumanGate=Object.freeze({...pending,status:'APPROVED',decidedAt:confirmedAt,...(policy?{schemaVersion:2 as const,authorizationKind:'PolicyDerivedAuthorization' as const,policyAuthorizationRef:decision.id}:{humanDecisionRef:decision.id})});
    this.#addRecord(approvedRef,'HumanGate',approvedGate);
    this.#record('GATE_DECIDED',snapshot.stateRevision,policy?'Policy-derived authorization durably recorded':'Pi TUI affirmative confirmation durably recorded',state=>({...state,
      gates:state.gates.map(id=>id===snapshot.gateId?approvedRef:id),pendingGateId:approvedRef}),[...new Set([pending.approvedData.id,channel.id,decision.id,approvedRef])]);
    const candidate=this.#state.candidate,binding={taskId:this.spec.taskId,specHash:this.spec.specHash,...(candidate?{candidate:{digest:candidate.digest,generation:candidate.generation}}:{})};
    const gateContext={...(policy?{authorizationKind:'PolicyDerivedAuthorization' as const}:{}),id:pending.id,type:pending.type,status:'APPROVED' as const,resumeState:pending.resumeState,continuation:pending.continuation,binding,
      ...(pending.proposedSpecHash?{proposedSpecHash:pending.proposedSpecHash}:{}),dataHash:pending.approvedDataHash,displayedRevision:snapshot.stateRevision,
      decision:{kind:'APPROVE' as const,gateId:pending.id,binding,...(pending.proposedSpecHash?{proposedSpecHash:pending.proposedSpecHash}:{}),
        dataHash:pending.approvedDataHash,displayedRevision:snapshot.stateRevision,acceptedAgainstRevision:snapshot.stateRevision,
        recordedAtRevision:snapshot.stateRevision+1,consumed:false}};
    const supplied={...this.#facts(...(scope?['A','effect'] as const:[final||redispatch?'V':'R'] as const)),humanOriginAndConfirmationVerified:!policy,approvedPolicyAuthorizationVerified:!!policy,decisionValid:true,gateNotSuperseded:true,
      sessionOwnershipReconciled:true,legalDecisionRevisionChain:true,gateTargetAndDataFrozen:true,finalReviewTestsRiskPatchValid:true,
      ...(scope?{scopeChangeProposed:true,specChangeAuthorized:true}: {}),
      ...(redispatch?{reviewerInfrastructureRetryCurrent:true}:{}),
      ...(advisory?{...this.#facts('B'),oracleMaterialAdvice:true,reconciliationNeeded:true,finiteExhaustionActionWithoutBudgetIncrease:true}:{})};
    const transition=advisory?'TR-042':final||redispatch?'TR-040':scope?'TR-037':'TR-038';
    const admitted=evaluateTransition({state:this.#state.state,revision:this.#state.revision,expectedRevision:this.#state.revision,transition,binding,
      evidence:{revision:this.#state.revision,binding,facts:supplied},authority:{role:'Orchestrator',origin:'host',taskId:this.spec.taskId},workspaceMutable:true,
      mutationRequired:false,writer:'terminal',...(advisory?{blockMode:'consumeGate' as const}:{}),...(scope?{nextSpecHash:proposed!.specHash}:{}),gate:gateContext});
    if(!admitted.admitted)throw new HumanDecisionStaleError('GATE_TRANSITION_GUARD_REJECTED',Object.freeze(admitted.reasons.slice(0,16)));
    const consumedEventId=`event-r${this.#state.revision+1}`,consumedRef=`${pending.id}-consumed`;
    const consumed:HumanGate=Object.freeze({...approvedGate,status:'CONSUMED',consumedEventId});this.#addRecord(consumedRef,'HumanGate',consumed);
    const invalidated=scope?[...new Set([...this.#state.validations,...this.#state.reviews,...this.#state.results,...this.#state.decisions.map(value=>value.id),
      ...this.#state.completionEvidenceRefs,...this.#state.gates.filter(id=>id!==approvedRef).flatMap(id=>{const gate=this.#recordValue(id,'HumanGate') as HumanGate;
        return [id,...(gate.humanDecisionRef?[gate.humanDecisionRef]:[])];})])]:[];
    const previousSpec=this.#spec,previousSpecRecordId=this.#specRecordId;
    if(scope){this.#spec=proposed!;this.#specRecordId=proposedRef!.id;this.#writerApproval=undefined}
    try{this.#commit('TRANSITION',`${pending.type} approval consumed once`,state=>{const {pendingGateId:_pending,...rest}=state;
      const base={...rest,state:pending.resumeState,...(advisory?{blockedReason:'Human accepted reconciliation only; host must re-evaluate without retry authority'}:{}),revision:state.revision+1,gates:state.gates.map(id=>id===approvedRef?consumedRef:id),
        invalidEvidenceIds:[...new Set([...state.invalidEvidenceIds,...invalidated])]};
      if(!scope)return base as WorkflowState;
      const {candidate:_candidate,...withoutCandidate}=base;return {...withoutCandidate,spec:proposedRef!,specHash:proposed!.specHash} as WorkflowState;
    },{transitionId:transition,invalidatedEvidenceIds:invalidated,evidenceRefs:[consumedRef,decision.id,...(scope?[proposedRef!.id]:[])]})}
    catch(error){if(scope){this.#spec=previousSpec;this.#specRecordId=previousSpecRecordId}throw error}
    if(scope){this.#guard=undefined;this.#capture=undefined}
    else if(!final&&!advisory&&!redispatch){this.#writerApproval={gate:consumed,dataHash:pending.approvedDataHash};this.#policyRecoveryWriter=false;this.#policyWriterCheck=policy?()=>assertPolicyCapabilityCurrent(policy):undefined;}
    else if(advisory)this.#writerApproval=undefined;
    return decision;
  }
  complete(expectedRevision:number):DecisionResult{
    this.#cas(expectedRevision);if(!this.#store||this.#state.state!=='REVIEWING')throw new OrchestratorError('COMPLETION_NOT_YET_AUTHORIZED');
    const packaged=this.completionPackage(expectedRevision),packet=JSON.parse(Buffer.from(this.#store.read(packaged.artifact)).toString('utf8'));
    const facts=this.#completionFacts(packet);
    if(!canComplete(this.#state,facts))throw new OrchestratorError('COMPLETION_NOT_YET_AUTHORIZED');
    const terminal=buildTerminalCompletionPackage(packet,this.#state,[...this.#records.values()],this.#store);
    const terminalCompletionPackageHash=hashCanonical(terminal),terminalRef=this.#store.put(`terminal-${terminalCompletionPackageHash.slice(0,24)}`,
      canonicalize(terminal),`application/vnd.pi-controlled-dev.terminal-completion-v${terminal.schemaVersion}+json`);this.#addRecord(terminalRef.id,'ArtifactRef',terminalRef);
    const attestationBody={schemaVersion:2,taskId:this.spec.taskId,specHash:this.spec.specHash,candidateDigest:this.#state.candidate!.digest,
      candidateGeneration:this.#state.candidate!.generation,terminalCompletionPackageHash,authorizationPackageHash:terminal.authorizationPackageHash,targetState:'COMPLETED',facts};
    const attestation=this.#store.put(`terminal-attestation-${hashCanonical(attestationBody).slice(0,24)}`,canonicalize({...attestationBody,
      attestationHash:hashCanonical(attestationBody)}),'application/vnd.pi-controlled-dev.terminal-attestation+json');this.#addRecord(attestation.id,'ArtifactRef',attestation);
    this.#record('RECONCILED',this.#state.revision,'Terminal attestation prepared from current facts',state=>({...state,
      completionEvidenceRefs:[...new Set([...state.completionEvidenceRefs,terminalRef.id,attestation.id])]}),[terminalRef.id,attestation.id]);
    const binding={taskId:this.spec.taskId,specHash:this.spec.specHash,candidate:{digest:this.#state.candidate!.digest,generation:this.#state.candidate!.generation}};
    const supplied={...this.#facts('V'),finalReviewTestsRiskPatchValid:true};
    const admitted=evaluateTransition({state:this.#state.state,revision:this.#state.revision,expectedRevision:this.#state.revision,transition:'TR-022',binding,
      evidence:{revision:this.#state.revision,binding,facts:supplied,completion:this.#completionFacts(packet)},authority:{role:'Orchestrator',origin:'host',taskId:this.spec.taskId},
      workspaceMutable:true,mutationRequired:false,writer:'terminal'});
    if(!admitted.admitted)throw new OrchestratorError('COMPLETION_NOT_YET_AUTHORIZED');
    this.#commit('TRANSITION','CMP-001 satisfied from current durable evidence',state=>({...state,state:'COMPLETED',revision:state.revision+1,terminalReason:'CMP-001 satisfied from current durable evidence'}),
      {transitionId:'TR-022',invalidatedEvidenceIds:[],evidenceRefs:[packaged.artifact.id,attestation.id]});
    if(this.#store&&readProjectCustodian(this.#state.repoRoot))this.#saveProjectCheckpoint(true);else this.#lockManager.releaseAll(this.#locks);return Object.freeze({decision:'CONTINUE_TO_READY',state:this.state});
  }
  recordValidations(inputs:readonly ValidationResult[],artifacts:readonly ArtifactRef[],expectedRevision:number):DecisionResult<readonly ValidationResult[]>{
    this.#cas(expectedRevision);if(this.#state.state!=='TESTING'||!this.#state.candidate)throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    this.#verifyCandidateCurrent();
    for(const artifact of artifacts)this.#addRecord(artifact.id,'ArtifactRef',artifact);
    if(new Set(inputs.map(value=>value.commandId)).size!==inputs.length){
      this.#blockCurrent('Conflicting authoritative validation set');throw new OrchestratorError('RESULT_CONTRADICTORY');
    }
    const accepted:ValidationResult[]=[];
    for(const input of inputs){if(this.#store&&!isExecutedValidation(input))throw new OrchestratorError('RESULT_ATTRIBUTION_MISMATCH');
      const checked=validateContract('ValidationResult',input,this.context(undefined,undefined));if(!checked.ok)throw new OrchestratorError('RESULT_SCHEMA_INVALID');
      if(this.#state.validations.includes(checked.value.id)){
        if(canonicalize(this.#recordValue(checked.value.id,'ValidationResult'))!==canonicalize(checked.value)){
          this.#blockCurrent('Contradictory validation replay');throw new OrchestratorError('RESULT_CONTRADICTORY');
        }
        accepted.push(checked.value);continue;
      }
      const superseded=this.#currentValidations().filter(value=>value.commandId===checked.value.commandId).map(value=>value.id);
      const previous=this.#state.validations.map(id=>this.#records.get(id)).filter((record):record is ContextRecord&{kind:'ValidationResult'}=>
        record?.kind==='ValidationResult'&&record.value.commandId===checked.value.commandId&&record.value.candidateGeneration<checked.value.candidateGeneration)
        .map(record=>record.value).findLast(value=>value.status!=='PASSED');
      const currentRuntime=this.#runtimeForValidation(checked.value),previousRuntime=previous?this.#runtimeForValidation(previous):undefined;
      let comparisonRef:ArtifactRef|undefined,beforeAfterBundleRef:ArtifactRef|undefined;
      if(this.#store&&currentRuntime&&previousRuntime){
        const comparison=compareRuntimeEvidence(previousRuntime.evidence,previousRuntime.events,currentRuntime.evidence,currentRuntime.events);
        comparisonRef=this.#store.put(`runtime-comparison-${checked.value.id.slice('validation-'.length)}`,canonicalize(comparison),
          'application/vnd.pi-controlled-dev.runtime-comparison+json');this.#addRecord(comparisonRef.id,'ArtifactRef',comparisonRef);
        const currentScenario=this.#scenarioForValidation(checked.value),previousScenario=previous?this.#scenarioForValidation(previous):undefined;
        if(currentScenario&&previousScenario&&currentScenario.scenario.scenarioHash===previousScenario.scenario.scenarioHash){
          const bundle=bindBeforeAfter(currentScenario.bundle,previousScenario.run,currentScenario.run,comparison,comparisonRef.id);
          beforeAfterBundleRef=this.#store.put(bundle.bundleId,canonicalize(bundle),EVIDENCE_BUNDLE_MEDIA_TYPE);
          this.#addRecord(beforeAfterBundleRef.id,'ArtifactRef',beforeAfterBundleRef);
        }
      }
      const scenarioRefs=this.#scenarioForValidation(checked.value)?.refs??[];
      this.#addRecord(checked.value.id,'ValidationResult',checked.value);accepted.push(checked.value);
      if(superseded.length)this.#record('EVIDENCE_INVALIDATED',this.#state.revision,'Later host acquisition superseded validation',
        state=>({...state,invalidEvidenceIds:[...new Set([...state.invalidEvidenceIds,...superseded])]}),superseded);
      this.#record('VALIDATION_RECORDED',this.#state.revision,`Host validation ${checked.value.status}`,state=>({...state,validations:[...state.validations,checked.value.id]}),
        [checked.value.id,...(currentRuntime?[currentRuntime.ref.id,currentRuntime.eventRef.id]:[]),...scenarioRefs,
          ...(comparisonRef?[comparisonRef.id]:[]),...(beforeAfterBundleRef?[beforeAfterBundleRef.id]:[])]);}
    this.#saveProjectCheckpoint();
    const allPassed=this.#requiredValidationsPassed();
    if(!allPassed){this.#transition('TR-020',this.#state.revision,this.#facts('B'),'Required host validation did not pass');return Object.freeze({decision:'BLOCKED',state:this.state,value:Object.freeze(accepted)})}
    return Object.freeze({decision:'DISPATCH_REVIEWER',state:this.state,value:Object.freeze(accepted)});
  }
  #reviewRefs(host:ReviewHostPacket):readonly string[]{
    const candidate=this.#state.candidate!;
    const comparison=this.#currentRuntimeComparison(),scenario=this.#currentScenarioEvidence();
    return Object.freeze([...new Set([...this.#reviewBaselineContext()?.evidenceRefs??[],...this.#clarificationRefs(),...host.evidenceRefs.filter(id=>!this.#state.invalidEvidenceIds.includes(id)),
      candidate.manifest.id,candidate.patch.id,candidate.handoff.id,candidate.terminalProof.id,
      ...this.#currentValidations().flatMap(value=>[value.id,value.logRef!,value.processProofRef!,
        ...this.#runtimeRefsForValidation(value.id)]),
      ...(comparison?[comparison.before.evidenceId,comparison.before.eventLogRef]:[]),...(scenario?.refs??[])])]);
  }
  #reviewBaselineContext(){return this.#store?createReviewerBaselineContext(this.spec,this.#state,[...this.#records.values()],this.#store):undefined}
  #currentScenarioEvidence():Readonly<{scenarios:readonly ExecutableScenario[];runs:readonly ScenarioRun[];bundles:readonly TechnicalEvidenceBundle[];refs:readonly string[]}>|undefined{
    if(!this.#store||!this.#state.candidate)return undefined;
    const currentIds=new Set(this.#currentValidations().map(value=>value.id)),read=(record:ContextRecord&{kind:'ArtifactRef'})=>{
      try{return JSON.parse(Buffer.from(this.#store!.read(record.value)).toString('utf8')) as unknown}catch{return undefined}
    };
    const artifacts=[...this.#records.values()].filter((record):record is ContextRecord&{kind:'ArtifactRef'}=>record.kind==='ArtifactRef');
    const runs=artifacts.filter(record=>record.value.mediaType===SCENARIO_RUN_MEDIA_TYPE).map(record=>({record,value:read(record)}))
      .filter((item):item is {record:ContextRecord&{kind:'ArtifactRef'};value:ScenarioRun}=>validateScenarioRun(item.value)&&item.value.candidateDigest===this.#state.candidate!.digest
        &&item.value.candidateGeneration===this.#state.candidate!.generation&&item.value.validationResultRefs.every(id=>currentIds.has(id)));
    const runIds=new Set(runs.map(item=>item.value.runId));
    const scenarios=artifacts.filter(record=>record.value.mediaType===SCENARIO_MEDIA_TYPE).map(record=>({record,value:read(record)}))
      .filter((item):item is {record:ContextRecord&{kind:'ArtifactRef'};value:ExecutableScenario}=>{
        if(!validateExecutableScenario(item.value))return false;const scenario=item.value;
        return runs.some(run=>run.value.scenarioHash===scenario.scenarioHash);
      });
    const bundles=artifacts.filter(record=>record.value.mediaType===EVIDENCE_BUNDLE_MEDIA_TYPE).map(record=>({record,value:read(record)}))
      .filter((item):item is {record:ContextRecord&{kind:'ArtifactRef'};value:TechnicalEvidenceBundle}=>validateTechnicalEvidenceBundle(item.value)&&item.value.runIds.some(id=>runIds.has(id))&&item.value.validationResultRefs.every(id=>currentIds.has(id)));
    if(!runs.length||!scenarios.length||!bundles.length)return undefined;
    return Object.freeze({scenarios:Object.freeze(scenarios.map(item=>item.value)),runs:Object.freeze(runs.map(item=>item.value)),
      bundles:Object.freeze(bundles.map(item=>item.value)),refs:Object.freeze([...scenarios,...runs,...bundles].map(item=>item.record.id))});
  }
  #runtimeRefsForValidation(id:string):readonly string[]{
    const event=this.#events.findLast(value=>value.kind==='RECORD'&&value.recordType==='VALIDATION_RECORDED'&&value.evidenceRefs.includes(id));
    return event?.evidenceRefs.filter(ref=>ref.startsWith('runtime-'))??[];
  }
  #scenarioForValidation(value:ValidationResult):Readonly<{scenario:ExecutableScenario;run:ScenarioRun;bundle:TechnicalEvidenceBundle;refs:readonly string[]}>|undefined{
    if(!this.#store)return undefined;const token=value.id.replace(/^validation-/,''),runRecord=this.#records.get(`scenario-run-${token}`);
    if(runRecord?.kind!=='ArtifactRef'||runRecord.value.mediaType!==SCENARIO_RUN_MEDIA_TYPE)return undefined;
    const read=(record:ContextRecord&{kind:'ArtifactRef'})=>JSON.parse(Buffer.from(this.#store!.read(record.value)).toString('utf8')) as unknown;
    const run=read(runRecord);if(!validateScenarioRun(run)||!run.validationResultRefs.includes(value.id))return undefined;
    const scenarioRecord=this.#records.get(`scenario-${run.scenarioHash.slice(0,24)}`);
    if(scenarioRecord?.kind!=='ArtifactRef'||scenarioRecord.value.mediaType!==SCENARIO_MEDIA_TYPE)return undefined;
    const scenario=read(scenarioRecord);if(!validateExecutableScenario(scenario)||scenario.scenarioHash!==run.scenarioHash)return undefined;
    const bundleRecord=[...this.#records.values()].find(record=>record.kind==='ArtifactRef'&&record.value.mediaType===EVIDENCE_BUNDLE_MEDIA_TYPE&&(()=>{
      try{const item=read(record);return validateTechnicalEvidenceBundle(item)&&item.runIds.length===1&&item.runIds[0]===run.runId}catch{return false}
    })());
    if(bundleRecord?.kind!=='ArtifactRef')return undefined;const bundle=read(bundleRecord);
    if(!validateTechnicalEvidenceBundle(bundle))return undefined;
    return Object.freeze({scenario,run,bundle,refs:Object.freeze([scenarioRecord.id,runRecord.id,bundleRecord.id])});
  }
  #runtimeForValidation(value:ValidationResult):{evidence:RuntimeEvidence;events:readonly RuntimeEvent[];ref:ArtifactRef;eventRef:ArtifactRef}|undefined{
    if(!this.#store)return undefined;
    const token=value.id.slice('validation-'.length),refRecord=this.#records.get(`runtime-evidence-${token}`),eventRecord=this.#records.get(`runtime-events-${token}`);
    if(refRecord?.kind!=='ArtifactRef'||eventRecord?.kind!=='ArtifactRef')return undefined;
    const evidence=JSON.parse(Buffer.from(this.#store.read(refRecord.value)).toString('utf8')) as RuntimeEvidence;
    if(evidence.id!==refRecord.id||evidence.validationId!==value.id||evidence.taskId!==value.taskId||evidence.scenarioId!==value.commandId||evidence.commandHash!==value.commandHash
      ||evidence.candidateDigest!==value.candidateDigest||evidence.candidateGeneration!==value.candidateGeneration
      ||evidence.status!==value.status||evidence.eventLogRef!==eventRecord.id)throw new OrchestratorError('RESULT_ATTRIBUTION_MISMATCH');
    const events=parseRuntimeJsonl(this.#store.read(eventRecord.value));
    if(evidence.eventCount!==events.length)throw new OrchestratorError('RESULT_ATTRIBUTION_MISMATCH');
    return {evidence,events,ref:refRecord.value,eventRef:eventRecord.value};
  }
  #currentRuntimeComparison():RuntimeComparison|undefined{
    if(!this.#store)return undefined;
    for(const value of [...this.#currentValidations()].reverse()){
      const token=value.id.slice('validation-'.length),record=this.#records.get(`runtime-comparison-${token}`);
      if(record?.kind==='ArtifactRef')return JSON.parse(Buffer.from(this.#store.read(record.value)).toString('utf8')) as RuntimeComparison;
    }
    return undefined;
  }
  #latestRuntimeDiagnosis():string|undefined{
    const candidate=this.#state.candidate;
    const record=this.#state.validations.map(id=>this.#records.get(id)).findLast(value=>value?.kind==='ValidationResult'
      &&value.value.status!=='PASSED'&&value.value.candidateGeneration===candidate?.generation&&value.value.candidateDigest===candidate?.digest);
    if(record?.kind!=='ValidationResult')return undefined;
    const runtime=this.#runtimeForValidation(record.value);
    if(!runtime)return undefined;
    const diagnosis=runtime.evidence.diagnosis;
    return [...diagnosis.observed.map(value=>`Observed: ${value}`),...diagnosis.inferred.map(value=>`Hypothesis: ${value}`),
      ...diagnosis.unknown.map(value=>`To verify: ${value}`)].join(' ').slice(0,2048);
  }
  buildReviewPacket(assignment:AssignmentEnvelope,host:ReviewHostPacket):ReviewPacket{
    if(!this.#capture||canonicalize(this.#state.candidate)!==canonicalize(this.#capture.candidate)
      ||assignment.specHash!==this.spec.specHash||assignment.candidateDigest!==this.#capture.digest
      ||assignment.candidateGeneration!==this.#capture.generation||assignment.baseCommit!==this.#capture.candidate.baseCommit
      ||canonicalize(host.candidateManifest)!==canonicalize(this.#capture.manifest)||host.diff!==this.#capture.patch
      ||canonicalize([...host.changedFiles].sort())!==canonicalize(this.#capture.changedFiles))throw new OrchestratorError('SCOPE_GUARD_FAILED');
    const validations=this.#currentValidations(),scenarioEvidence=this.#currentScenarioEvidence();
    return Object.freeze({schemaVersion:1,taskId:this.spec.taskId,assignmentId:assignment.assignmentId,specHash:this.spec.specHash,
      candidateDigest:this.#state.candidate!.digest,candidateGeneration:this.#state.candidate!.generation,requirements:this.spec.requirements,
      acceptanceCriteria:this.spec.acceptanceCriteria,diff:this.#capture.patch,changedFiles:this.#capture.changedFiles,candidateManifest:this.#capture.manifest,
      validationResults:Object.freeze(validations),handoff:this.#capture.handoff,residualRisks:Object.freeze([...host.residualRisks]),
      evidenceRefs:this.#reviewRefs(host),...(this.#currentRuntimeComparison()?{runtimeComparison:this.#currentRuntimeComparison()}: {}),
      ...(scenarioEvidence?{scenarioEvidence:{scenarios:scenarioEvidence.scenarios,runs:scenarioEvidence.runs,bundles:scenarioEvidence.bundles}}:{})});
  }
  #reviewerRedispatchApproval():{gate:HumanGate;data:ApprovedReviewerRedispatchData}|undefined{
    if(this.#state.state!=='REVIEWING')return undefined;
    const gate=[...this.#state.gates].reverse().map(id=>{try{return this.#recordValue(id,'HumanGate') as HumanGate}catch{return undefined}})
      .find(value=>value?.type==='beforeReviewerRedispatch'&&value.status==='CONSUMED');
    if(!gate||!gate.consumedEventId)return undefined;
    const eventIndex=this.#events.findIndex(event=>event.id===gate.consumedEventId);
    if(eventIndex<0||this.#events.slice(eventIndex+1).some(event=>event.recordType==='SPAWN_INTENT'))return undefined;
    try{
      const data=JSON.parse(Buffer.from(this.#store!.read(gate.approvedData)).toString('utf8')) as ApprovedReviewerRedispatchData;
      if(hashCanonical(data)!==gate.approvedDataHash||hashCanonical(this.#reviewerRedispatchData())!==gate.approvedDataHash)return undefined;
      return {gate,data};
    }catch{return undefined}
  }
  reviewerRedispatchAuthorized():boolean{return this.#reviewerRedispatchApproval()!==undefined}
  #importedReviewPayload(){
    const c=this.#state.candidate;if(!this.#state.runtimeBindingRef||!c||!this.#requiredValidationsPassed())throw new Error('PROJECT_IMPORTED_REVIEW_CONFIRMATION_REQUIRED');
    return {schemaVersion:1,taskId:this.spec.taskId,specHash:this.spec.specHash,runtimeBindingRef:this.#state.runtimeBindingRef,
      repoRoot:this.#state.repoRoot,candidateRoot:c.root,candidateDigest:c.digest,candidateGeneration:c.generation,
      validationIds:this.#currentValidations().map(v=>v.id)};
  }
  createImportedReviewRequest(sessionId:string):TrustedConfirmationRequest|undefined{
    this.#cas(this.#state.revision);this.#requireQuiescent();if(!this.#state.runtimeBindingRef)return undefined;
    if(!this.#store||this.#state.state!=='TESTING'||sessionId!==this.#ownerSessionId)throw new Error('PROJECT_IMPORTED_REVIEW_CONFIRMATION_REQUIRED');
    this.#verifyCandidateCurrent();const payload=this.#importedReviewPayload();
    return createTrustedConfirmationRequest({purpose:'project-runtime-import',subjectKind:'project-imported-review',subjectId:this.spec.taskId,
      subjectRevision:this.#state.revision,action:'APPROVE',payload,presentation:{title:"Start the review in the current folder?",
      content:`Task: ${this.spec.title}\nFolder: ${this.#state.repoRoot}\nWorking copy: ${payload.candidateDigest}, version ${payload.candidateGeneration}.\nAutomated checks rerun here: ${payload.validationIds.join(', ')}.\nThe review will use this copy and this new evidence. Dispatches already used: ${this.#state.counters.dispatches} out of ${this.spec.retryPolicy.maxDispatches}.`}});
  }
  acceptImportedReview(request:TrustedConfirmationRequest,receipt:TrustedConfirmationReceipt):void{
    this.#cas(request.subjectRevision);this.#requireQuiescent();
    if(!this.#store||this.#state.state!=='TESTING'||request.purpose!=='project-runtime-import'||request.subjectKind!=='project-imported-review'
      ||request.subjectId!==this.spec.taskId||receipt.confirmationInstance.sessionId!==this.#ownerSessionId)throw new Error('PROJECT_IMPORTED_REVIEW_CONFIRMATION_REQUIRED');
    const ref=consumeTrustedConfirmation(receipt,()=>{this.#cas(request.subjectRevision);this.#verifyCandidateCurrent();
      if(canonicalize(request.payload)!==canonicalize(this.#importedReviewPayload()))throw new Error('PROJECT_RUNTIME_IMPORT_STALE');return request},this.#store);
    this.#addRecord(ref.id,'ArtifactRef',ref);this.#record('DECISION_RECORDED',this.#state.revision,"Review in the new folder confirmed by the operator",s=>s,[ref.id,this.#state.runtimeBindingRef!.id]);
  }
  #importedReviewApproved():boolean{
    if(!this.#state.runtimeBindingRef)return true;
    if(!this.#store)return false;const payload=this.#importedReviewPayload();
    for(const r of [...this.#records.values()].reverse()){
      if(r.kind!=='ArtifactRef'||r.value.mediaType!==TRUSTED_CONFIRMATION_MEDIA||this.#state.invalidEvidenceIds.includes(r.id))continue;
      try{const raw=JSON.parse(Buffer.from(this.#store.read(r.value)).toString('utf8')),q=raw.request;
        if(q.purpose!=='project-runtime-import'||q.subjectKind!=='project-imported-review'||q.subjectId!==this.spec.taskId||canonicalize(q.payload)!==canonicalize(payload))continue;
        readTrustedConfirmationEvidence(this.#store,r.value,q);
        const index=this.#events.findIndex(e=>e.recordType==='DECISION_RECORDED'&&e.revision===q.subjectRevision+1&&e.evidenceRefs.includes(r.id)&&e.evidenceRefs.includes(this.#state.runtimeBindingRef!.id));
        if(index>=0&&!this.#events.slice(index+1).some(e=>e.recordType==='SPAWN_INTENT'))return true;
      }catch{}
    }return false;
  }
  async redispatchReviewer(expectedRevision:number,options:ReviewerRunOptions={}):Promise<DecisionResult<ReviewResult>>{
    this.#cas(expectedRevision);const approval=this.#reviewerRedispatchApproval(),capture=this.#capture;
    if(!approval||!capture)throw new OrchestratorError('HUMAN_GATE_REQUIRED');
    const developer=this.#latestResult('Developer') as DeveloperResult|undefined;
    if(!developer)throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    const result=await this.#reviewBatch(1,expectedRevision,{candidateManifest:capture.manifest,diff:capture.patch,changedFiles:capture.changedFiles,
      handoff:capture.handoff,residualRisks:developer.residualRisks,evidenceRefs:approval.data.evidenceRefs},options,true);
    return Object.freeze({...result,value:result.value![0]});
  }
  async review(expectedRevision:number,host:ReviewHostPacket,options:ReviewerRunOptions={}):Promise<DecisionResult<ReviewResult>>{
    if(!this.#importedReviewApproved())throw new Error('PROJECT_IMPORTED_REVIEW_CONFIRMATION_REQUIRED');
    const result=await this.#reviewBatch(1,expectedRevision,host,options,false);return Object.freeze({...result,value:result.value![0]});
  }
  /** Explicit opt-in: exactly two independent read-only Reviewers; serial review remains the default. */
  async reviewParallel(expectedRevision:number,host:ReviewHostPacket,options:ReviewerRunOptions={}):Promise<DecisionResult<readonly ReviewResult[]>>{
    if(!this.#importedReviewApproved())throw new Error('PROJECT_IMPORTED_REVIEW_CONFIRMATION_REQUIRED');
    if(!this.#parallelReviewEnabled)throw new OrchestratorError('ROLE_CAPABILITY_UNAVAILABLE');
    return this.#reviewBatch(2,expectedRevision,host,options,false);
  }
  async #reviewBatch(count:1|2,expectedRevision:number,host:ReviewHostPacket,options:ReviewerRunOptions,redispatch:boolean):Promise<DecisionResult<readonly ReviewResult[]>>{
    this.#cas(expectedRevision);this.#requireDispatch('reviewer',count);this.#verifyCandidateCurrent();
    if(!this.#requiredValidationsPassed())throw new OrchestratorError('VALIDATION_FAILED');
    if(redispatch&&!this.#reviewerRedispatchApproval())throw new OrchestratorError('HUMAN_GATE_REQUIRED');
    if(!redispatch&&this.#state.state!=='TESTING')throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    // Project ordinals only to allocate distinct identities; no state/counter change before whole-batch admission.
    const batch=Array.from({length:count},(_,i)=>{
      const assignment=createAssignment(this.spec,{...this.#state,counters:{...this.#state.counters,attempts:this.#state.counters.attempts+i}},
        'Reviewer',{inputArtifactRefs:this.#reviewRefs(host)});
      const packet=this.buildReviewPacket(assignment,host);this.#registerAssignment(assignment);return {assignment,packet};
    });
    if(!redispatch)this.#transition('TR-018',expectedRevision,this.#facts('V','effect'));
    for(const {assignment} of batch)this.#intent(assignment,this.#state.revision);
    const contexts=batch.map(({assignment})=>this.context(assignment,this.#currentValidations().map(value=>value.id)));
    // Never reject early: even a failed sibling must wait for the whole cohort to settle before routing rework.
    const settled=await Promise.allSettled(batch.map(({assignment,packet},i)=>Promise.resolve().then(()=>
      this.#runners.reviewer!(assignment,packet,contexts[i],{...options,baselineContext:this.#reviewBaselineContext(),scoutClarifications:this.#clarificationDelivery(),...this.#terminalOptions(assignment)}))));
    const results:ReviewResult[]=[];let failure:unknown;
    try{
      this.#verifyCandidateCurrent();
      for(let i=0;i<settled.length;i++){
        const item=settled[i];try{
          if(item.status==='rejected')throw item.reason;
          this.acceptChildResult(batch[i].assignment,item.value,this.#state.revision);results.push(item.value.result);
        }catch(error){failure??=error??new OrchestratorError('ORCHESTRATOR_BLOCKED');this.#unknown(batch[i].assignment,'Reviewer dispatch/result failed')}
      }
      if(failure!==undefined)throw failure;
      if(this.#state.state!=='REVIEWING')throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
      const value=Object.freeze(results);
      if(results.some(result=>result.verdict==='BLOCKED')){
        this.#transition('TR-024',this.#state.revision,this.#facts('B'),'A Reviewer could not establish a verdict');
        return Object.freeze({decision:'BLOCKED',state:this.state,value});
      }
      if(results.some(result=>result.verdict==='FAIL')){
        for(const result of results)for(const finding of result.findings)this.#addRecord(finding.id,'Finding',finding);
        this.#transition('TR-023',this.#state.revision,this.#facts('W'),'Reviewer finding requires bounded rework; no majority vote');
        return Object.freeze({decision:'REWORK_REQUIRED',state:this.state,value});
      }
      // In-memory routing fixtures have no durable candidate bytes. Production
      // workflows always have a store and a ScopeGuard canonical patch.
      const comparison=this.#currentRuntimeComparison(),residue=this.#store?temporaryInstrumentationResidue(this.#capture?.patch??''):[];
      if(residue.length||comparison&&comparison.conclusion!=='RESOLVED'){
        this.#transition('TR-024',this.#state.revision,this.#facts('B'),residue.length
          ?'Temporary diagnostic instrumentation remains in the candidate'
          :'Same-scenario runtime comparison is incomplete');
        return Object.freeze({decision:'BLOCKED',state:this.state,value});
      }
      const decision=this.spec.humanGates.beforeCompletion?'HUMAN_GATE_REQUIRED':'COMPLETION_NOT_YET_AUTHORIZED';
      return Object.freeze({decision,state:this.state,value});
    }catch(error){for(const {assignment} of batch)this.#unknown(assignment,'Reviewer batch failed');this.#blockCurrent('Reviewer batch failed');throw error}
  }
  routeFailure(input:FailureInput,proof:RetryProof,expectedRevision:number):DecisionResult<RetryOutcome>{
    this.#cas(expectedRevision);const duplicateEscalation=this.#state.escalations.some(episode=>episode.triggerFailureIds
      .some(id=>this.#state.failures.find(value=>value.id===id)?.fingerprint===this.#fingerprint(input))&&!episode.closed);
    // Ledger quiescence is authoritative; caller assertions cannot reconcile a run.
    const unresolved=this.#state.runs.some(run=>!runQuiescent(run));
    const outcome=evaluateFailure({input,failures:this.#state.failures,counters:this.#state.counters,policy:this.spec.retryPolicy,
      proof:{...proof,dispatchOutcome:unresolved?'UNKNOWN':proof.dispatchOutcome,
        writerTerminal:!unresolved&&this.#state.runs.length>0&&proof.writerTerminal,
        duplicateEscalation:proof.duplicateEscalation||duplicateEscalation}});
    const checked=validateContract('FailureRecord',outcome.failure,this.context());if(!checked.ok)throw new OrchestratorError('RESULT_SCHEMA_INVALID');
    this.#addRecord(outcome.failure.id,'FailureRecord',checked.value);
    let retryAuthorization:ArtifactRef|undefined;
    if(outcome.action==='RETRY_INFRASTRUCTURE'&&checked.value.phase==='REVIEWING'&&this.#state.candidate){
      const reviewer=this.#state.runs.findLast(run=>run.role==='Reviewer');
      if(reviewer&&runQuiescent(reviewer)&&!reviewer.resultRef&&checked.value.subjectIds.includes(reviewer.assignmentId)
        &&checked.value.evidenceRefs.includes(runProofRef(reviewer)!)){
        const authorization:ReviewerRetryAuthorization={schemaVersion:1,action:'RETRY_INFRASTRUCTURE',taskId:this.spec.taskId,specHash:this.spec.specHash,
          candidateDigest:this.#state.candidate.digest,candidateGeneration:this.#state.candidate.generation,failureId:checked.value.id,
          reviewerAssignmentId:reviewer.assignmentId,reviewerAttemptId:reviewer.attemptId,...reviewerDispatchBinding(reviewer),infrastructureRetriesBefore:this.#state.counters.infrastructureRetries,
          infrastructureRetriesAfter:this.#state.counters.infrastructureRetries+1,dispatches:this.#state.counters.dispatches,evidenceRefs:[...checked.value.evidenceRefs]};
        retryAuthorization=this.#artifact(`retry-authorization-${checked.value.id}`,canonicalize(authorization));
        this.#addRecord(retryAuthorization.id,'ArtifactRef',retryAuthorization);
      }
    }
    this.#record('RECONCILED',expectedRevision,outcome.reason,state=>({...state,failures:[...state.failures,checked.value],
      counters:outcome.action==='RETRY_INFRASTRUCTURE'?{...state.counters,infrastructureRetries:state.counters.infrastructureRetries+1}:state.counters}),
      [...input.evidenceRefs,...(retryAuthorization?[retryAuthorization.id]:[])]);
    if(outcome.action==='REWORK'&&!['REWORK'].includes(this.#state.state)){
      const transition:Partial<Record<WorkflowState['state'],TransitionId>>={IMPLEMENTING:'TR-014',TESTING:'TR-019',REVIEWING:'TR-023',BLOCKED:'TR-033'};
      const id=transition[this.#state.state];if(id)this.#transition(id,this.#state.revision,id==='TR-033'?this.#facts('U','W'):this.#facts('W'),outcome.reason);else this.#blockCurrent(outcome.reason);
    }else if(outcome.action==='BLOCK')this.#blockCurrent(outcome.reason);
    else if(outcome.action==='FAIL')this.#failCurrent(outcome.reason);
    const decision:OrchestratorDecision=outcome.action==='REWORK'?'REWORK_REQUIRED':outcome.action==='ESCALATE'?'ADVISORY_REQUIRED':outcome.action==='FAIL'?'FAILED':outcome.action==='BLOCK'?'BLOCKED':outcome.action;
    return Object.freeze({decision,state:this.state,value:outcome});
  }
  recordReviewerInfrastructureFailure(error:unknown,expectedRevision:number):DecisionResult<RetryOutcome>|undefined{
    this.#cas(expectedRevision);
    if(this.#state.state!=='BLOCKED'||this.#state.blockedReason!=='Reviewer batch failed'
      ||this.#state.counters.infrastructureRetries>=this.spec.retryPolicy.maxInfrastructureRetries
      ||this.#state.counters.dispatches>=this.spec.retryPolicy.maxDispatches)return undefined;
    const code=typeof error==='object'&&error!==null&&typeof (error as {code?:unknown}).code==='string'
      ?(error as {code:string}).code:error instanceof Error?error.message:'';
    const infrastructureCodes=new Set(['RPC_UNAVAILABLE','TIMEOUT','COMPLETION_TIMEOUT','RUN_NOT_SUCCESSFUL','DISPOSED','TASK_REQUEST_LIMIT','REVIEW_WORKSPACE_INVALID','fetch failed','WebSocket error']);
    if(!infrastructureCodes.has(code))return undefined;
    const reviewer=this.#state.runs.findLast(run=>run.role==='Reviewer');
    if(!reviewer||!runQuiescent(reviewer)||reviewer.resultRef)return undefined;
    if(reviewer.status==='TERMINAL'&&(!reviewer.runId||!reviewer.childSessionId||reviewer.requestId.startsWith('intent-')))return undefined;
    const proofRef=runProofRef(reviewer)!;
    this.#verifyCandidateCurrent();
    return this.routeFailure({phase:'REVIEWING',source:'RPC_TRANSIENT',code,subjectIds:[reviewer.assignmentId],evidenceRefs:[proofRef]},
      {dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:true,writerTerminal:true,workspaceSafe:true,sameProtocol:true,
        concreteHumanResolution:false,duplicateEscalation:false},this.#state.revision);
  }
  openEscalation(failure:FailureRecord,question:string,expectedRevision:number):DecisionResult{
    this.#cas(expectedRevision);if(!['ANALYZING','REWORK','BLOCKED'].includes(this.#state.state))throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    const checked=validateContract('FailureRecord',failure,this.context());if(!checked.ok)throw new OrchestratorError('RESULT_SCHEMA_INVALID');
    const matching=this.#state.failures.filter(value=>value.fingerprint===checked.value.fingerprint);
    const triggers=[...new Set([...matching.map(value=>value.id),checked.value.id])].sort();
    const signature=hashCanonical({fingerprint:checked.value.fingerprint,question});
    if(this.#state.counters.escalationEpisodes>=this.spec.retryPolicy.maxEscalationEpisodes
      ||this.#state.escalations.some(value=>hashCanonical({fingerprint:this.#state.failures.find(f=>value.triggerFailureIds.includes(f.id))?.fingerprint,question:value.question})===signature))
      throw new OrchestratorError('ADVISORY_REQUIRED');
    this.#addRecord(failure.id,'FailureRecord',checked.value);const id=`escalation-${signature.slice(0,24)}`;
    this.#record('ESCALATION_OPENED',expectedRevision,'Explicit bounded advisory episode opened',state=>({...state,
      failures:state.failures.some(value=>value.id===checked.value.id)?state.failures:[...state.failures,checked.value],
      escalations:[...state.escalations,{schemaVersion:1,id,triggerFailureIds:triggers,question,closed:false}],
      counters:{...state.counters,escalationEpisodes:state.counters.escalationEpisodes+1}}),[failure.id]);
    return Object.freeze({decision:'ADVISORY_REQUIRED',state:this.state});
  }
  resolveHostValidationRisks(expectedRevision:number):void{
    this.#cas(expectedRevision);this.#requireQuiescent();this.#verifyCandidateCurrent();
    if(!this.#store||this.#state.state!=='REVIEWING'||this.#state.gates.some(id=>{
      // Verified root rebinding preserves superseded gates as history. They
      // neither authorize this execution nor prevent its fresh final gate.
      if(this.#state.runtimeBindingRef&&this.#state.invalidEvidenceIds.includes(id)
        &&runtimeRootMappingFor(this.#state,this.context().runtimeRootMappings))return false;
      const gate=this.#recordValue(id,'HumanGate') as HumanGate;return !['beforeImplementation','onScopeChange','beforeReviewerRedispatch'].includes(gate.type)||gate.status!=='CONSUMED';
    }))throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    // Verify authoritative validation, review, proof and artifact closure without publishing a new package.
    buildCompletionPackage(this.#state,[...this.#records.values()],this.#store);
    // Validate all current risk identities before persisting any disposition. Never rename or merge conflicting records.
    const risks=new Map<string,string>();
    for(const role of ['Developer','Reviewer'] as const)for(const risk of (this.#latestResult(role) as DeveloperResult|ReviewResult|undefined)?.residualRisks??[]){
      const bytes=canonicalize(risk),prior=risks.get(risk.id),record=this.#records.get(risk.id);
      if((prior!==undefined&&prior!==bytes)||(record&&(record.kind!=='Risk'||canonicalize(record.value)!==bytes)))
        throw new OrchestratorError('RESULT_CONTRADICTORY','RISK_ID_CONTENT_CONFLICT');
      risks.set(risk.id,bytes);
    }
    for(const role of ['Developer','Reviewer'] as const){
      const source=[...this.#state.runs].reverse().find(r=>r.role===role)?.resultRef;
      const result=this.#latestResult(role) as DeveloperResult|ReviewResult|undefined;
      for(const risk of result?.residualRisks??[]){
        if(risk.id!=='host-validation-pending')continue;
        this.#addRecord(risk.id,'Risk',risk);
        if(this.#state.decisions.some(d=>d.subjectId===risk.id)){
          if(!allResidualRisksDisposed(this.#state,this.context(),this.#events))throw new OrchestratorError('RESULT_CONTRADICTORY');
          continue;
        }
        const reviewer=this.#state.runs.findLast(r=>r.role==='Reviewer');
        const reviewRequired=risk.criterionIds.some(id=>this.spec.acceptanceCriteria.find(c=>c.id===id)?.method==='REVIEW');
        const refs=[...new Set([this.#stateRecordId,source!,risk.id,...this.#currentValidations().map(v=>v.id),
          ...(reviewRequired&&reviewer?.resultRef?[reviewer.resultRef]:[])])];
        const decision:DecisionRecord={schemaVersion:1,id:`risk-decision-${hashCanonical({risk,refs}).slice(0,24)}`,kind:'RESOLVE_RISK',subjectId:risk.id,
          reason:'Host verified the required executable validations and, for REVIEW criteria, current independent Reviewer coverage on this exact spec and candidate generation.',evidenceRefs:refs};
        const checked=validateContract('DecisionRecord',decision,this.context());
        if(!checked.ok)throw new OrchestratorError('RESULT_SCHEMA_INVALID');
        this.#addRecord(decision.id,'DecisionRecord',decision);
        this.#record('DECISION_RECORDED',this.#state.revision,'Host resolved historical validation-pending risk with current evidence',
          state=>({...state,decisions:[...state.decisions,decision]}),[decision.id,...refs]);
      }
    }
  }
  recordDecision(decision:DecisionRecord,escalationId:string,expectedRevision:number):DecisionResult<DecisionRecord>{
    if(['RESOLVE_RISK','DEFER_RISK'].includes(decision.kind))throw new OrchestratorError('RESULT_ATTRIBUTION_MISMATCH');
    this.#cas(expectedRevision);const escalation=this.#state.escalations.find(value=>value.id===escalationId);
    if(!escalation||escalation.closed)throw new OrchestratorError('ADVISORY_REQUIRED');
    const checked=validateContract('DecisionRecord',decision,this.context());if(!checked.ok)throw new OrchestratorError('RESULT_SCHEMA_INVALID');
    this.#addRecord(checked.value.id,'DecisionRecord',checked.value);
    this.#record('DECISION_RECORDED',expectedRevision,'Orchestrator disposition closed escalation',state=>({...state,
      decisions:[...state.decisions,checked.value],escalations:state.escalations.map(value=>value.id===escalationId?{...value,closed:true,decisionId:checked.value.id}:value)}),checked.value.evidenceRefs);
    return Object.freeze({decision:'HUMAN_DECISION_REQUIRED',state:this.state,value:checked.value});
  }
  async consultOracle(escalationId:string,unresolvedAmbiguities:readonly string[],evidenceRefs:readonly string[],expectedRevision:number,
    context:'fresh'|'fork'='fresh',options:OracleRunOptions={}):Promise<DecisionResult<OracleResult>>{
    this.#cas(expectedRevision);this.#requireDispatch('oracle');const escalation=this.#state.escalations.find(value=>value.id===escalationId);
    if(!escalation||escalation.closed||escalation.oracleAttemptId)throw new OrchestratorError('ADVISORY_REQUIRED');
    const assignment=createAssignment(this.spec,this.#state,'Oracle',{context,inputArtifactRefs:evidenceRefs});this.#registerAssignment(assignment);
    this.#record('SPAWN_INTENT',expectedRevision,'Oracle advisory dispatch intent',state=>({...state,
      escalations:state.escalations.map(value=>value.id===escalationId?{...value,oracleAttemptId:assignment.attemptId}:value),
      runs:[...state.runs,intentRun(assignment,this.#ownerSessionId)],counters:{...state.counters,attempts:state.counters.attempts+1,
        dispatches:state.counters.dispatches+1,oracleInvocations:state.counters.oracleInvocations+1}}));
    const body:Omit<OracleEscalationPacket,'packetHash'>={schemaVersion:1,taskId:this.spec.taskId,assignmentId:assignment.assignmentId,
      escalationId,question:escalation.question,objective:this.spec.objective,requirements:this.spec.requirements,
      acceptanceCriteria:this.spec.acceptanceCriteria,constraints:this.spec.constraints,
      triggerFailures:escalation.triggerFailureIds.map(id=>this.#state.failures.find(value=>value.id===id)!),evidenceRefs,unresolvedAmbiguities};
    const packet=Object.freeze({...body,packetHash:oraclePacketHash(body)});
    try{
      const output=await this.#runners.oracle!(assignment,packet,this.context(assignment),{...options,...this.#terminalOptions(assignment)});this.acceptChildResult(assignment,output,this.#state.revision);
      if(output.result.needsHumanDecision&&this.#store)this.openOnOracleDecision(this.#state.revision,escalationId,this.#ownerSessionId);
      return Object.freeze({decision:output.result.needsHumanDecision?'HUMAN_DECISION_REQUIRED':'ADVISORY_REQUIRED',state:this.state,value:output.result});
    }catch(error){this.#unknown(assignment,'Oracle dispatch/result failed');this.#blockCurrent('Oracle dispatch/result failed');throw error}
  }

  acceptChildResult(assignment:AssignmentEnvelope,output:ChildOutput,expectedRevision:number):string{
    this.#cas(expectedRevision);const evidence=output.evidence as ChildOutput['evidence'],result=output.result as ScoutResult|DeveloperResult|ReviewResult|OracleResult;
    if(evidence.ownerSessionId!==this.#ownerSessionId||!evidence.runId||!evidence.requestId||!evidence.childSessionId
      ||evidence.launchContractHash!==assignment.launchContractHash||result.taskId!==assignment.taskId||result.assignmentId!==assignment.assignmentId
      ||result.attemptId!==assignment.attemptId||result.role!==assignment.role||result.specHash!==assignment.specHash||result.assignmentHash!==assignment.assignmentHash
      ||this.#state.runs.some(run=>run.assignmentId!==assignment.assignmentId&&(run.runId===evidence.runId||run.childSessionId===evidence.childSessionId||run.requestId===evidence.requestId)))
      throw new OrchestratorError('RESULT_ATTRIBUTION_MISMATCH');
    const encoded=canonicalize(result),prior=this.#acceptedRuns.get(evidence.runId);
    if(prior!==undefined){if(prior===encoded)return `result-${hashCanonical(result).slice(0,24)}`;this.#blockCurrent('Contradictory result replay');throw new OrchestratorError('RESULT_CONTRADICTORY')}
    const recordedRun=this.#state.runs.find(run=>run.assignmentId===assignment.assignmentId);
    const proof=this.#store?this.#recordValue(recordedRun?.terminalProofRef??'', 'ArtifactRef') as ArtifactRef
      :this.#artifact(`proof-${hashCanonical(evidence).slice(0,24)}`,canonicalize(evidence));
    if(this.#store&&!verifyTerminalProof(JSON.parse(Buffer.from(this.#store.read(proof)).toString('utf8')),
      {runId:evidence.runId,role:assignment.role,ownerSessionId:this.#ownerSessionId,requestId:evidence.requestId,childSessionId:evidence.childSessionId}))
      throw new OrchestratorError('RESULT_ATTRIBUTION_MISMATCH');
    const resultId=`result-${hashCanonical(result).slice(0,24)}`;
    const run:RunRecord={schemaVersion:1,assignmentId:assignment.assignmentId,attemptId:assignment.attemptId,role:assignment.role,
      requestId:evidence.requestId,runId:evidence.runId,childSessionId:evidence.childSessionId,ownerSessionId:evidence.ownerSessionId,
      status:'TERMINAL',terminalProofRef:proof.id,resultRef:resultId};
    const proposed={...this.#state,runs:this.#state.runs.map(value=>value.assignmentId===assignment.assignmentId?run:value)};
    const contract=assignment.role==='Scout'?'ScoutResult':assignment.role==='Developer'?'DeveloperResult':assignment.role==='Reviewer'?'ReviewResult':'OracleResult';
    const records=[...this.#records.values(),...(this.#records.has(proof.id)?[]:[{id:proof.id,kind:'ArtifactRef' as const,value:proof}]),{id:resultId,kind:contract as any,value:result} as ContextRecord];
    const context:ValidationContext={records:[...records,{id:'state-operational',kind:'WorkflowState',value:proposed}],specId:this.#specRecordId,assignmentId:assignment.assignmentId,
      stateId:'state-operational',...(this.#previousStateRecordId?{previousStateId:this.#previousStateRecordId}:{}),
      ...(this.#store?{runtimeRootMappings:verifiedRuntimeRootMappings(records,this.#events,this.#store)}:{}),
      ...(assignment.role==='Reviewer'?{currentValidationIds:this.#currentValidations().map(value=>value.id)}:{}),modelExtracted:false};
    const checked=validateContract(contract as any,result,context);if(!checked.ok)throw new OrchestratorError('RESULT_SCHEMA_INVALID');
    if(this.#store){const runtime=this.#store.put(`runtime-${hashCanonical(evidence).slice(0,24)}`,canonicalize(evidence));this.#addRecord(runtime.id,'ArtifactRef',runtime)}
    this.#addRecord(proof.id,'ArtifactRef',proof);this.#addRecord(resultId,contract as any,result as any);this.#acceptedRuns.set(evidence.runId,encoded);
    this.#record(assignment.role==='Reviewer'?'REVIEW_RECORDED':'RESULT_RECEIVED',expectedRevision,'Attributed child result accepted',state=>({...state,
      runs:state.runs.map(value=>value.assignmentId===assignment.assignmentId?run:value),results:[...state.results,resultId],
      ...(assignment.role==='Reviewer'?{reviews:[...state.reviews,resultId]}:{})}),[proof.id,resultId]);
    if(this.#store&&'memoryProposals' in output&&output.memoryProposals?.length){
      const repo=ProjectMemoryRepository.open(this.#store.agentDataRoot,this.#state.repoRoot,this.#store.artifactInspection,
        {create:true,manager:this.#lockManager,workspaceLock:this.#locks.workspace})!;
      for(const proposal of output.memoryProposals){
        const record=repo.propose(proposal,{role:assignment.role as 'Scout'|'Developer'|'Reviewer',taskId:assignment.taskId});
        const ref=this.#store.put(`memory-proposal-${record.recordId}`,canonicalize({schemaVersion:1,projectId:record.projectId,
          recordKind:record.recordKind,recordId:record.recordId,revision:record.revision,digest:record.contentDigest}),
          'application/vnd.pi-controlled-dev.memory-proposal-reference+json');
        this.#addRecord(ref.id,'ArtifactRef',ref);this.#record('RECONCILED',this.#state.revision,'Non-authoritative project memory proposal retained',state=>state,[ref.id]);
      }
    }
    return resultId;
  }

  #completionFacts(packet:ReturnType<typeof buildCompletionPackage>):CompletionFacts{
    const candidate=this.#state.candidate,scout=this.#latestResult('Scout') as ScoutResult|undefined;
    const developer=this.#latestResult('Developer') as DeveloperResult|undefined,review=this.#latestResult('Reviewer') as ReviewResult|undefined;
    const validations=this.#currentValidations(),required=this.spec.validationCommands.filter(c=>c.required);
    let gateHistoryValid=false;
    try{buildTerminalCompletionPackage(packet,this.#state,[...this.#records.values()],this.#store!);gateHistoryValid=true}catch{}
    let packageValid=false,candidateCurrent=false;
    try{verifyCompletionPackage(packet,this.#state,[...this.#records.values()],this.#store!);packageValid=true}catch{}
    try{const current=this.#guard?.capture(candidate!.generation,'completion-freshness');candidateCurrent=!!current&&current.digest===candidate!.digest}catch{}
    const criteria=review?.criteria??[];
    const values:Record<keyof typeof COMPLETION_CONDITIONS,boolean>={
      'CMP-01':this.#state.state==='REVIEWING'&&this.#lockManager.verifyTaskLock(this.#locks.task)&&this.#lockManager.verifyWorkspaceLock(this.#locks.workspace),
      'CMP-02':!!scout&&this.scoutClarifications().covered&&validateContract('TaskSpec',this.spec,this.context()).ok,
      'CMP-03':terminalDispatchers.has(this.#runners)&&this.#state.runs.length>=3,
      'CMP-04':!!candidate&&!!this.#state.baselineCommit&&candidate.baseCommit===this.#state.baselineCommit&&candidate.root!==this.#state.repoRoot,
      'CMP-05':!!developer&&!developer.blockedReason&&validateStructure('DeveloperResult',developer).ok&&developer.specHash===this.spec.specHash,
      'CMP-06':this.#state.runs.length>0&&this.#state.runs.every(runQuiescent),
      'CMP-07':!!candidate&&!!this.#capture&&candidate.digest===this.#capture.digest&&packageValid,
      'CMP-08':candidateCurrent,
      'CMP-09':candidateCurrent&&!!candidate&&candidate.generation>0,
      'CMP-10':required.length>0&&required.every(c=>validations.filter(v=>v.commandId===c.id&&v.status==='PASSED'&&!!v.logRef&&!!v.processProofRef).length===1),
      'CMP-11':!!review&&review.verdict==='PASS'&&validateStructure('ReviewResult',review).ok,
      'CMP-12':!!review&&!!candidate&&review.specHash===this.spec.specHash&&review.reviewedTreeHash===candidate.digest
        &&review.candidateGeneration===candidate.generation&&[review.scopeAssessment,review.testAssessment,review.actualChangesAssessment].every(a=>a.status==='PASS'),
      'CMP-13':criteria.length===this.spec.acceptanceCriteria.length&&this.spec.acceptanceCriteria.every(c=>criteria.filter(a=>a.criterionId===c.id&&a.assessment.status==='PASS').length===1),
      'CMP-14':review?.findings.length===0&&allResidualRisksDisposed(this.#state,this.context(),this.#events)&&this.#state.escalations.every(e=>e.closed),
      'CMP-15':gateHistoryValid,
      'CMP-16':this.#state.counters.reworkAttempts<=this.spec.retryPolicy.maxReworkAttempts
        &&this.#state.counters.infrastructureRetries<=this.spec.retryPolicy.maxInfrastructureRetries
        &&this.#state.counters.dispatches<=this.spec.retryPolicy.maxDispatches&&this.#state.escalations.every(e=>e.closed),
      'CMP-17':packageValid,
      'CMP-18':packageValid,
    };
    return Object.freeze(values);
  }
  #terminalOptions(assignment:AssignmentEnvelope):ReviewerRunOptions & MemoryRunOptions{
    if(!this.#store)return {};
    return {...(this.#memoryContexts.has(assignment.assignmentId)?{projectMemory:this.#memoryContexts.get(assignment.assignmentId)}:{}),onDispatchIdentity:identity=>{
      if(!isAcquiredDispatchIdentity(identity)||identity.ownerSessionId!==this.#ownerSessionId||identity.agent!==`controlled.${assignment.role.toLowerCase()}`)
        throw new OrchestratorError('RESULT_ATTRIBUTION_MISMATCH');
      const prior=this.#state.runs.find(run=>run.assignmentId===assignment.assignmentId);
      if(!prior||!['INTENT','BOUND','RUNNING','UNKNOWN'].includes(prior.status)
        ||prior.runId&&prior.runId!==identity.runId||prior.childSessionId&&prior.childSessionId!==identity.childSessionId
        ||!prior.requestId.startsWith('intent-')&&prior.requestId!==identity.requestId
        ||this.#state.runs.some(run=>run.assignmentId!==assignment.assignmentId&&(run.requestId===identity.requestId
          ||identity.runId&&run.runId===identity.runId||identity.childSessionId&&run.childSessionId===identity.childSessionId)))
        throw new OrchestratorError('RESULT_ATTRIBUTION_MISMATCH');
      this.#record('RUN_BOUND',this.#state.revision,'Correlated provider dispatch identity durably acquired',state=>({...state,
        runs:state.runs.map(run=>run.assignmentId===assignment.assignmentId?{...run,requestId:identity.requestId,
          ...(identity.runId?{runId:identity.runId,status:'BOUND' as const}:{}),
          ...(identity.childSessionId?{childSessionId:identity.childSessionId}:{})}:run)}));
    },onNoDispatchProof:(proof:ReviewerNoDispatchProof)=>{
      const prior=this.#state.runs.find(run=>run.assignmentId===assignment.assignmentId);
      const closed=prior?{...prior,status:'NOT_DISPATCHED' as const,dispatchProofRef:'host-receipt'}:undefined;
      if(!closed||prior!.status!=='INTENT'||!isAcquiredReviewerNoDispatchProof(proof)||!verifyReviewerNoDispatchProof(proof,assignment,closed))
        throw new OrchestratorError('RESULT_ATTRIBUTION_MISMATCH');
      const ref=this.#store!.put(`dispatch-proof-${hashCanonical(proof).slice(0,24)}`,canonicalize(proof),'application/vnd.pi-controlled-dev.no-dispatch+json');
      this.#addRecord(ref.id,'ArtifactRef',ref);
      this.#record('RECONCILED',this.#state.revision,'Host verified Reviewer failure before any spawn request',state=>({...state,
        runs:state.runs.map(run=>run.assignmentId===assignment.assignmentId?{...run,status:'NOT_DISPATCHED' as const,dispatchProofRef:ref.id}:run)}),[ref.id]);
    },onTerminalProof:(proof:TerminalProof)=>{
      if(!isAcquiredTerminalProof(proof)||!verifyTerminalProof(proof,{runId:proof.runId,requestId:proof.requestId,
        role:assignment.role,ownerSessionId:this.#ownerSessionId}))throw new OrchestratorError('RESULT_ATTRIBUTION_MISMATCH');
      const intent=this.#state.runs.find(run=>run.assignmentId===assignment.assignmentId);
      if(!intent||!['INTENT','BOUND','RUNNING','UNKNOWN'].includes(intent.status)
        ||intent.runId&&intent.runId!==proof.runId||intent.childSessionId&&intent.childSessionId!==proof.childSessionId
        ||!intent.requestId.startsWith('intent-')&&intent.requestId!==proof.requestId||this.#state.runs.some(run=>run.assignmentId!==assignment.assignmentId&&
        (run.runId===proof.runId||run.requestId===proof.requestId||run.childSessionId===proof.childSessionId)))throw new OrchestratorError('RESULT_ATTRIBUTION_MISMATCH');
      const ref=this.#store!.put(`candidate-proof-${hashCanonical(proof).slice(0,24)}`,canonicalize(proof));this.#addRecord(ref.id,'ArtifactRef',ref);
      this.#record('RECONCILED',this.#state.revision,'Targeted RPC process-terminal proof durably acquired',state=>({...state,
        runs:state.runs.map(run=>run.assignmentId===assignment.assignmentId?{...run,status:'TERMINAL',runId:proof.runId,requestId:proof.requestId,
          childSessionId:proof.childSessionId,terminalProofRef:ref.id}:run)}),[ref.id]);
    }};
  }
  #terminalBytes(assignment:AssignmentEnvelope,output:ChildOutput):string{
    if(!this.#store)return canonicalize(output.evidence);
    const run=this.#state.runs.find(run=>run.assignmentId===assignment.assignmentId);
    const ref=this.#recordValue(run?.terminalProofRef??'','ArtifactRef') as ArtifactRef;
    return Buffer.from(this.#store.read(ref)).toString('utf8');
  }
  #recordCapture(capture:ScopeCapture,expectedRevision:number,terminalEvidence:string):void{
    if(this.#store){
      const source=capture.candidate;
      const manifest=this.#store.put(source.manifest.id,canonicalize(capture.manifest),source.manifest.mediaType);
      const patch=this.#store.put(source.patch.id,capture.patch,source.patch.mediaType);
      const handoff=this.#store.put(source.handoff.id,capture.handoff,source.handoff.mediaType);
      const terminalProof=this.#store.put(source.terminalProof.id,terminalEvidence,source.terminalProof.mediaType);
      for(const [old,current] of [[source.manifest,manifest],[source.patch,patch],[source.handoff,handoff],[source.terminalProof,terminalProof]])
        if(old.digest!==current.digest||old.bytes!==current.bytes)throw new OrchestratorError('SCOPE_GUARD_FAILED');
      capture={...capture,candidate:{...source,manifest,patch,handoff,terminalProof},artifacts:[manifest,patch,handoff,terminalProof]};
      this.#capture=capture;
    }
    for(const artifact of capture.artifacts)this.#addRecord(artifact.id,'ArtifactRef',artifact);
    const checked=validateContract('Candidate',capture.candidate,this.context());if(!checked.ok)throw new OrchestratorError('SCOPE_GUARD_FAILED');
    this.#record('CANDIDATE_MATERIALIZED',expectedRevision,'Host ScopeGuard materialized candidate',state=>({...state,candidate:checked.value}),capture.artifacts.map(value=>value.id));
    this.#saveProjectCheckpoint();
  }
  #verifyCandidateCurrent():void{
    try{const current=this.#guard?.capture(this.#state.candidate!.generation,'candidate-integrity-recheck');
      if(!current||current.digest!==this.#state.candidate!.digest)throw new ScopeGuardError('SCOPE_WORKSPACE_CHANGED');
    }catch(error){if(error instanceof ScopeGuardError){const invalidated=[...this.#state.validations,...this.#state.reviews];
      if(invalidated.length)this.#record('EVIDENCE_INVALIDATED',this.#state.revision,'Candidate identity changed',state=>({...state,invalidEvidenceIds:[...new Set([...state.invalidEvidenceIds,...invalidated])]}),invalidated);
      this.#blockCurrent('Candidate mutated after materialization');throw new OrchestratorError('SCOPE_GUARD_FAILED')}throw error}
  }
  #unknown(assignment:AssignmentEnvelope,reason:string):void{
    const run=this.#state.runs.find(value=>value.assignmentId===assignment.assignmentId);
    if(run&&['INTENT','BOUND','RUNNING'].includes(run.status))this.#record('RECONCILED',this.#state.revision,reason,state=>({...state,
      runs:state.runs.map(value=>value.assignmentId===assignment.assignmentId?{...value,status:'UNKNOWN'}:value)}));
  }
  #intent(assignment:AssignmentEnvelope,expectedRevision:number,rework=false):void{
    this.#record('SPAWN_INTENT',expectedRevision,`${assignment.role} dispatch intent`,state=>({...state,runs:[...state.runs,intentRun(assignment,this.#ownerSessionId)],
      counters:{...state.counters,attempts:state.counters.attempts+1,dispatches:state.counters.dispatches+1,
        reworkAttempts:state.counters.reworkAttempts+(rework?1:0)}}));
  }
  #transition(id:TransitionId,expectedRevision:number,supplied:Facts,reason:string=id):void{
    this.#cas(expectedRevision);const binding={taskId:this.spec.taskId,specHash:this.spec.specHash,...(this.#state.candidate?{candidate:{digest:this.#state.candidate.digest,generation:this.#state.candidate.generation}}:{})};
    const admitted=evaluateTransition({state:this.#state.state,revision:this.#state.revision,expectedRevision,transition:id,binding,
      evidence:{revision:this.#state.revision,binding,facts:supplied},authority:{role:'Orchestrator',origin:'host',taskId:this.spec.taskId},
      workspaceMutable:true,mutationRequired:['TR-005','TR-009','TR-013','TR-018','TR-023','TR-027','TR-039'].includes(id),writer:'terminal'});
    if(!admitted.admitted)throw new OrchestratorError(admitted.reasons.includes('REVISION_MISMATCH')?'ORCHESTRATOR_REVISION_CONFLICT':'ORCHESTRATOR_STATE_INVALID');
    const invalidated=admitted.consequences.invalidations.includes('E')?[...this.#state.validations,...this.#state.reviews]:[];
    this.#commit('TRANSITION',reason,state=>({...state,state:admitted.target,revision:admitted.proposedRevision,
      ...(admitted.target==='BLOCKED'?{blockedReason:reason}:{}),...(admitted.target==='FAILED'?{terminalReason:reason}:{}),invalidEvidenceIds:[...new Set([...state.invalidEvidenceIds,...invalidated])]}),
      {transitionId:id,invalidatedEvidenceIds:invalidated,evidenceRefs:[]});
  }
  #record(type:NonNullable<TransitionEvent['recordType']>,expectedRevision:number,reason:string,mutate:(state:WorkflowState)=>WorkflowState,
    evidenceRefs:readonly string[]=[]):void{
    this.#cas(expectedRevision);if(['COMPLETED','FAILED'].includes(this.#state.state))throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    this.#commit('RECORD',reason,state=>({...mutate(state),revision:state.revision+1}),{recordType:type,invalidatedEvidenceIds:[],evidenceRefs});
  }
  #commit(kind:'TRANSITION'|'RECORD',reason:string,mutate:(state:WorkflowState)=>WorkflowState,
    extra:{transitionId?:string;recordType?:NonNullable<TransitionEvent['recordType']>;invalidatedEvidenceIds:readonly string[];evidenceRefs:readonly string[]}):void{
    const previous=this.#state,eventId=`event-r${previous.revision+1}`,timestamp=this.#now();
    const next={...mutate(clone(previous)),lastEventId:eventId,updatedAt:timestamp};
    // An interrupted pre-WAL publication may leave an immutable artifact for
    // this revision. New durable attempts identify their exact bytes instead
    // of overwriting it or treating an orphan as a committed state.
    const nextText=canonicalize(next),nextId=`state-r${previous.revision+1}${this.#store?'-'+hashBytes(Buffer.from(nextText)):''}`;
    const records=[...this.#records.values()],catalog=this.#store?.catalog(records);
    if(catalog)this.#addRecord(catalog.id,'ArtifactRef',catalog);
    const stateAfter=this.#artifact(nextId,nextText);const prior=this.#events.at(-1)!;
    const draft:any={schemaVersion:1,id:eventId,taskId:this.spec.taskId,kind,actor:'Orchestrator',sourceState:previous.state,targetState:next.state,
      previousRevision:previous.revision,revision:next.revision,timestamp,reason,evidenceRefs:[...extra.evidenceRefs,...(catalog?[catalog.id]:[])],invalidatedEvidenceIds:[...extra.invalidatedEvidenceIds],
      stateAfter,previousEventHash:prior.eventHash,...(extra.transitionId?{transitionId:extra.transitionId}:{}),...(extra.recordType?{recordType:extra.recordType}:{}),eventHash:'0'.repeat(64)};
    draft.eventHash=hashContract('TransitionEvent',draft);const event=Object.freeze(draft) as TransitionEvent;
    if(!validateStructure('WorkflowState',next).ok||!validateStructure('TransitionEvent',event).ok)throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    this.#store?.commit(next,event,records);
    if(this.#store&&shouldRefreshHumanView(event))refreshHumanView(this.#store.root,{machineDataRoot:this.#store.agentDataRoot});
    this.#state=Object.freeze(next);this.#previousStateRecordId=this.#stateRecordId;this.#stateRecordId=nextId;this.#events.push(event);this.#addRecord(nextId,'WorkflowState',this.#state);this.#addRecord(event.id,'TransitionEvent',event);this.#assertState();
  }
  #blockCurrent(reason:string):void{
    const tr:Partial<Record<WorkflowState['state'],TransitionId>>={ANALYZING:'TR-006',IMPLEMENTING:'TR-015',TESTING:'TR-020',REVIEWING:'TR-024',REWORK:'TR-029'};
    const id=tr[this.#state.state];if(id)this.#transition(id,this.#state.revision,this.#facts('B'),reason);
  }
  #failCurrent(reason:string):void{
    const tr:Partial<Record<WorkflowState['state'],TransitionId>>={PENDING:'TR-003',ANALYZING:'TR-008',READY:'TR-011',IMPLEMENTING:'TR-017',TESTING:'TR-021',REVIEWING:'TR-026',REWORK:'TR-031',BLOCKED:'TR-035'};
    const id=tr[this.#state.state];if(!id)throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');
    this.#transition(id,this.#state.revision,this.#facts('F'),reason);this.#lockManager.releaseAll(this.#locks);
  }
  #fingerprint(input:FailureInput):string{return evaluateFailure({input,failures:[],counters:this.#state.counters,policy:this.spec.retryPolicy,
    proof:{dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:false,writerTerminal:false,workspaceSafe:false,sameProtocol:false,concreteHumanResolution:false,duplicateEscalation:false}}).failure.fingerprint}
  #registerAssignment(assignment:AssignmentEnvelope):void{
    const checked=validateContract('AssignmentEnvelope',assignment,this.context());if(!checked.ok)throw new OrchestratorError('ASSIGNMENT_CONSTRUCTION_FAILED');
    this.#assignments.set(assignment.assignmentId,assignment);this.#addRecord(assignment.assignmentId,'AssignmentEnvelope',assignment);
    if(this.#store&&assignment.role!=='Oracle'){
      const repo=ProjectMemoryRepository.open(this.#store.agentDataRoot,this.#state.repoRoot,this.#store.artifactInspection,
        {manager:this.#lockManager,workspaceLock:this.#locks.workspace});
      {
        const source=repo??{projectId:projectIdentity(this.#state.repoRoot),entries:()=>[]};
        const developer=this.#state.runs.findLast(r=>r.role==='Developer'&&r.resultRef);
        const previous=assignment.role==='Reviewer'&&developer?[...this.#records.values()].filter(r=>r.kind==='ArtifactRef'&&r.value.mediaType===MEMORY_CONTEXT_MEDIA)
          .map(r=>JSON.parse(Buffer.from(this.#store!.read((r as ContextRecord&{kind:'ArtifactRef'}).value)).toString('utf8')))
          .find(r=>r.role==='Developer'&&r.assignmentId===developer.assignmentId):undefined;
        const scout=this.#latestResult('Scout') as ScoutResult|undefined;
        const selection=selectProjectMemory(source,{taskId:assignment.taskId,role:assignment.role,assignmentId:assignment.assignmentId,
          objective:this.spec.objective,files:[...new Set([...this.spec.scope.allowedPaths,...(scout?.relevantFiles??[])])],
          ...(previous?{requiredBinding:previous.selected.filter((r:any)=>r.record.recordKind!=='technical-lesson').map((r:any)=>r.reference)}:{})});
        const memory=prepareMemoryContext(selection,this.#store,(ref,receipt)=>{
          this.#addRecord(memory.contextRef.id,'ArtifactRef',memory.contextRef);this.#addRecord(ref.id,'ArtifactRef',ref);
          // Immutable receipt bytes are already durable. The next existing run observation or
          // terminal/failure reconciliation commits these refs; memory adds no separate task event.
        });
        this.#memoryContexts.set(assignment.assignmentId,memory);
      }
    }

  }
  #latestResult(role:Role):ScoutResult|DeveloperResult|ReviewResult|OracleResult|undefined{
    for(let i=this.#state.runs.length-1;i>=0;i--){const run=this.#state.runs[i];if(run.role===role&&run.resultRef&&!this.#state.invalidEvidenceIds.includes(run.resultRef))
      return this.#recordValue(run.resultRef) as any}
  }
  #currentValidations():readonly ValidationResult[]{return selectCurrentValidationEvidence(this.spec,this.#state,
    this.#state.validations.map(id=>this.#recordValue(id,'ValidationResult') as ValidationResult))}
  #requiredValidationsPassed():boolean{const current=this.#currentValidations();return this.spec.validationCommands.filter(value=>value.required)
    .every(command=>current.filter(value=>value.commandId===command.id&&value.status==='PASSED').length===1)}
  #recordValue(id:string,kind?:ContextRecord['kind']):unknown{const record=this.#records.get(id);if(!record||(kind&&record.kind!==kind))throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID');return record.value}
  #addRecord(id:string,kind:ContextRecord['kind'],value:any):void{const existing=this.#records.get(id);if(existing){if(existing.kind!==kind||canonicalize(existing.value)!==canonicalize(value))throw new OrchestratorError('RESULT_CONTRADICTORY');return}if(this.#store&&kind!=='ArtifactRef')this.#store.put(id,canonicalize(value));this.#records.set(id,{id,kind,value} as ContextRecord)}
  #requireQuiescent():void{
    if(this.#state.runs.some(run=>!runQuiescent(run)))throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
  }
  #requireDispatch(role:keyof RoleDispatchers,count=1):void{
    if(this.#store&&!terminalDispatchers.has(this.#runners))throw new OrchestratorError('DURABLE_TERMINAL_PROOF_UNAVAILABLE');
    this.#requireQuiescent();
    if(!this.#runners[role])throw new OrchestratorError('ROLE_CAPABILITY_UNAVAILABLE');
    if(this.#state.counters.dispatches+count>this.spec.retryPolicy.maxDispatches)throw new OrchestratorError('ORCHESTRATOR_BLOCKED');
  }
  #facts(...groups:Parameters<typeof facts>):Facts{return Object.freeze({...facts(...groups),
    taskLockHeld:this.#lockManager.verifyTaskLock(this.#locks.task),workspaceLockHeld:this.#lockManager.verifyWorkspaceLock(this.#locks.workspace)})}
  #cas(expected:number):void{if(this.#retired)throw new Error('PROJECT_RUNTIME_AUTHORITY_RETIRED');if(this.#recoveryAuthority)recoveryLease(this.#recoveryAuthority);if(expected!==this.#state.revision)throw new OrchestratorError('ORCHESTRATOR_REVISION_CONFLICT')}
  #artifact(id:string,content:string):ArtifactRef{return this.#store?.put(id,content)??memoryArtifact(id,content)}
  #assertState():void{const checked=validateContract('WorkflowState',this.#state,this.context());if(!checked.ok)throw new OrchestratorError('ORCHESTRATOR_STATE_INVALID')}
}

/** Ledger order is authoritative. Different records for one command in a single
 * acquisition are rejected at ingress, never resolved by preferring PASS. */
export function selectCurrentValidationEvidence(spec:TaskSpec,state:WorkflowState,records:readonly ValidationResult[]):readonly ValidationResult[]{
  try{return currentValidationEvidence(spec,state,records)}catch{throw new OrchestratorError('RESULT_CONTRADICTORY')}
}

// Pure CMP proposition evaluator, not a validation-record selector or completion authority.
export function canComplete(state:WorkflowState,evidence:CompletionFacts):boolean{
  return state.state==='REVIEWING'&&Object.keys(COMPLETION_CONDITIONS).every(id=>evidence[id as keyof CompletionFacts]===true);
}
export function verifiedCompletionLockFacts(manager:LockManager,locks:WorkflowLocks):Pick<CompletionFacts,'CMP-01'>{
  return {'CMP-01':manager.verifyTaskLock(locks.task)&&manager.verifyWorkspaceLock(locks.workspace)};
}
function facts(...groups:('A'|'R'|'I'|'T'|'V'|'W'|'B'|'U'|'X'|'F'|'effect')[]):Facts{
  const names:Record<string,readonly string[]>={
    A:['inputSnapshotsAndHashesAvailable','dispatchBudgetRemaining','scoutAssignmentControlled'],
    R:['scoutResultValid','ambiguitiesResolvedWithRecordedDecisions','criteriaIdsAndMethodsVerifiable','requiredCommandsNonempty','specAndScopeFrozen','gitMutationPreconditionsVerified','mutationCapabilitiesVerified'],
    I:['implementationGateSatisfiedIfRequired','writerTerminalProven','sourceIntegrityVerified','developerBudgetRemaining','assignmentNewScopedFresh'],
    T:['developerResultValidAttributedUnblocked','writerTerminalProven','handoffCompleteDurable','baseExact','patchValidated','candidateMaterializedAfterWriterInImplementing','scopeChecked','candidateDigestAcquired'],
    V:['candidateMaterializedInScope','requiredValidationHostPassedCurrent','noMutationOrUnknownIdentity','reviewerIndependentFreshReadonlyVerified'],
    W:['defectConcreteAttributed','findingAcceptedInScope','findingsAdmitted','failureEvidenceAvailable','writerTerminalProven','nextAttemptNotConsumed'],
    B:['technicalOrInformationReason','missingOrConflictingEvidenceIdentified'],U:['blockResolvedWithNewEvidence','repositoryAndProcessesKnown'],X:['recoveryInconsistencyDetected','lastTrustedStateNonterminal','conflictingEvidencePreserved'],
    F:['allRunsStoppedAndReconciled','budgetExhaustedWithoutResolution'],effect:['effectCapabilitiesVerified','durableIntentRecorded']};
  return Object.freeze(Object.fromEntries(['stateSchemaValid','identityConflictAbsent','hostAuthorityVerified',
    'gitMutationPreconditionsVerified','mutationCapabilitiesVerified',...groups.flatMap(group=>names[group])].map(name=>[name,true]))) as Facts;
}
function intentRun(assignment:AssignmentEnvelope,ownerSessionId:string):RunRecord{return Object.freeze({schemaVersion:1,assignmentId:assignment.assignmentId,
  attemptId:assignment.attemptId,role:assignment.role,requestId:`intent-${assignment.attemptId}`,ownerSessionId,status:'INTENT'})}
function memoryArtifact(id:string,content:string,digest=hashCanonical(content)):ArtifactRef{return Object.freeze({schemaVersion:1,id,digest,
  relativeStorePath:`memory/${id}.json`,bytes:Buffer.byteLength(content,'utf8'),mediaType:'application/json'})}
function clone<T>(value:T):T{return JSON.parse(canonicalize(value)) as T}

function reviewerDispatchBinding(run:RunRecord){return run.status==='NOT_DISPATCHED'?{requestId:run.requestId,dispatchProofRef:run.dispatchProofRef!}:{requestId:run.requestId,runId:run.runId!,childSessionId:run.childSessionId!,terminalProofRef:run.terminalProofRef!}}
