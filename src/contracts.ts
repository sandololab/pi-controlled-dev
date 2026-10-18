// P4 data contracts only. Validation never authenticates a host, human or run.
import { copyJson, parseJson, canonicalize, hashCanonical, byteLength, ContractError } from './contract-json.js';
import type { Issue } from './contract-json.js';
import type { RuntimeRootMapping } from './runtime-root-binding.js';
import { object, list, literal, enumeration, integer, scalars, scalar } from './contract-schema.js';
import type { Infer, Schema } from './contract-schema.js';
import { localSemantics, crossSemantics, selfHash, fingerprint } from './contract-semantic.js';
export { canonicalize, canonicalBytes, hashCanonical, hashBytes, parseJson, ContractError } from './contract-json.js';
export type { Issue, Json } from './contract-json.js';

const { ID, Text, LongText, UInt, Hash, GitOID, Time, Path, Root, State, Role } = scalars;
const version = { schemaVersion: literal(1) };
const assignmentVersion = { schemaVersion: literal(2) };
const boolean = scalar<boolean>('BOOLEAN', v => typeof v === 'boolean');
const ids = (min: number, max: number) => list(ID, min, max);
const paths = (min: number, max: number) => list(Path, min, max);
const texts = (min: number, max: number) => list(Text, min, max);
const ArtifactRef = object('ArtifactRef', { ...version, id: ID, digest: Hash, relativeStorePath: Path, bytes: UInt, mediaType: Text });
const InputSource = object('InputSource', { ...version, snapshot: ArtifactRef }, { inline: LongText, path: Root });
const Requirement = object('Requirement', { ...version, id: ID, text: Text });
const Criterion = object('Criterion', { ...version, id: ID, requirementIds: ids(1,256), text: Text,
  method: enumeration('AUTOMATED','REVIEW','BOTH'), commandIds: ids(0,64), reviewInstruction: Text });
const CommandSpec = object('CommandSpec', { ...version, id: ID, executable: Root, argv: texts(0,64), timeoutMs: integer(1,2147483647), required: boolean });
const ScopeSpec = object('ScopeSpec', { ...version, repoRoot: Root, baseRef: Text, allowedPaths: paths(0,4096), deniedPaths: paths(0,4096), strongConfinementRequired: boolean });
const RetryPolicy = object('RetryPolicy', { ...version, maxReworkAttempts: UInt, maxInfrastructureRetries: integer(0,1), maxDispatches: integer(1,64), maxEscalationEpisodes: integer(1,4) });
const GatePolicy = object('GatePolicy', { ...version, beforeImplementation: boolean, onScopeChange: literal(true), onOracleDecision: boolean, beforeCompletion: boolean, onRetryExhausted: boolean });
const Observation = object('Observation', { ...version, id: ID, text: Text, evidenceRefs: ids(1,64) });
const Risk = object('Risk', { ...version, id: ID, text: Text, criterionIds: ids(0,256), blocking: boolean });
const Finding = object('Finding', { ...version, id: ID, text: Text, severity: enumeration('P0','P1','P2'), blocking: boolean, paths: paths(0,64), criterionIds: ids(0,256), evidenceRefs: ids(1,64) });
const Assessment = object('Assessment', { ...version, status: enumeration('PASS','FAIL','UNVERIFIABLE'), evidenceRefs: ids(0,64), reason: Text });
const CriterionAssessment = object('CriterionAssessment', { ...version, criterionId: ID, assessment: Assessment });
const DecisionRecord = object('DecisionRecord', { ...version, id: ID,
  kind: enumeration('ACCEPT_FINDING','DISMISS_FINDING','DEFER_RISK','RESOLVE_RISK','ADOPT_ADVICE','REJECT_ADVICE','RESOLVE_AMBIGUITY'),
  subjectId: ID, reason: Text, evidenceRefs: ids(1,64) }, { humanGateId: ID });
const RunRecord = object('RunRecord', { ...version, assignmentId: ID, attemptId: ID, role: Role, requestId: ID,
  ownerSessionId: Text, status: enumeration('INTENT','BOUND','RUNNING','TERMINAL','NOT_DISPATCHED','UNKNOWN') },
  { runId: Text, childSessionId: Text, terminalProofRef: ID, dispatchProofRef: ID, resultRef: ID });
const FailureRecord = object('FailureRecord', { ...version, id: ID, phase: State,
  category: enumeration('INFRA','TEST','REVIEW','SCOPE','SCHEMA','RECOVERY','AMBIGUITY'), code: ID,
  subjectIds: ids(0,64), fingerprint: Hash, evidenceRefs: ids(1,64) });
const Counters = object('Counters', { ...version, attempts: UInt, reworkAttempts: UInt, infrastructureRetries: UInt,
  dispatches: UInt, escalationEpisodes: UInt, oracleInvocations: UInt });
const Escalation = object('Escalation', { ...version, id: ID, triggerFailureIds: ids(1,64), question: Text, closed: boolean },
  { oracleAttemptId: ID, resultRef: ID, decisionId: ID });
const Candidate = object('Candidate', { ...version, root: Root, baseCommit: GitOID, digest: Hash, generation: UInt,
  manifest: ArtifactRef, patch: ArtifactRef, handoff: ArtifactRef, terminalProof: ArtifactRef });
const CapabilityEvidence = object('CapabilityEvidence', { ...version, id: ID, itemId: ID,
  status: enumeration('VERIFIED','UNVERIFIED','FAILED'), environmentHash: Hash, evidenceRefs: ids(0,64) });
const HumanDecisionEvidence = object('HumanDecisionEvidence', { ...version, id: ID, gateId: ID, taskId: ID,
  decision: enumeration('APPROVE','REJECT','ANSWER'), actorId: Text, channelId: ID, confirmationId: ID,
  displayedRevision: UInt, displayedDataHash: Hash, confirmedAt: Time, trustedChannelEvidenceRef: ID }, { answer: Text });
const CandidateEntry = object('CandidateEntry', { ...version, path: Path, kind: enumeration('FILE','SYMLINK'),
  mode: enumeration('100644','100755','120000'), contentHash: Hash });
const CandidateManifest = object('CandidateManifest', { ...version, baseCommit: GitOID, entries: list(CandidateEntry,0,100000) });
const TaskSpec = object('TaskSpec', { ...version, taskId: ID, specRevision: UInt, title: Text, objective: LongText,
  plan: InputSource, currentTask: InputSource, requirements: list(Requirement,1,256), acceptanceCriteria: list(Criterion,1,256),
  scope: ScopeSpec, constraints: texts(0,128), validationCommands: list(CommandSpec,1,64), humanGates: GatePolicy,
  retryPolicy: RetryPolicy, specHash: Hash }, { sourceApprovalGateId: ID });
const Context = enumeration('fresh','fork');
const ControlledContextPolicy = object('ControlledContextPolicy', { ...version, defaultContext: Context, allowedContexts: list(Context,1,2) });
const ControlledExtensionRef = object('ControlledExtensionRef', { ...version, id: ID, artifactHash: Hash });
const ControlledCapabilityConstraints = object('ControlledCapabilityConstraints', { ...version, operationIds: ids(0,14),
  mutationPolicy: enumeration('DENY','ASSIGNMENT_SCOPE'), scopePolicy: literal('SCP-001'), additionalRuntimePermissions: literal('NONE') });
const ControlledLaunchContract = object('ControlledLaunchContract', { ...version, controlledAgentId: ID,
  registrationProtocolVersion: literal(1), expectedRole: Role, baseSystemPromptHash: Hash,
  systemPromptMode: enumeration('replace','append'), contextPolicy: ControlledContextPolicy,
  allowedTools: ids(0,64), excludedTools: ids(0,64), allowNestedSubagents: literal(false),
  inheritProjectContext: boolean, inheritGlobalContext: boolean, inheritSkills: boolean,
  extensions: list(ControlledExtensionRef,0,16), subagentOnlyExtensions: list(ControlledExtensionRef,0,16),
  mutationTools: ids(0,64), internalProtocolTools: ids(0,1), capabilityConstraints: ControlledCapabilityConstraints });
const ControlledRegistrationEvidence = object('ControlledRegistrationEvidence', { ...version, id: ID, controlledAgentId: ID,
  expectedRole: Role, registrationProtocolVersion: literal(1), rpcVersion: literal(1), ownerSessionId: Text,
  runtimeGeneration: ID, launchContractHash: Hash, contractRef: ID, definitionRef: ID, accepted: literal(true),
  handleActiveAtObservation: literal(true), capabilityEvidenceRefs: ids(1,64) });
const AssignmentEnvelope = object('AssignmentEnvelope', { ...assignmentVersion, assignmentId: ID, taskId: ID, attemptId: ID, role: Role,
  specHash: Hash, objective: LongText, repoRoot: Root, workRoot: Root, baseRef: Text,
  allowedPaths: paths(0,4096), deniedPaths: paths(0,4096), requirements: list(Requirement,1,256), acceptanceCriteria: list(Criterion,1,256),
  constraints: texts(0,128), stopConditions: texts(1,128), inputArtifactRefs: ids(0,256), authority: ids(0,16),
  validationCommands: list(CommandSpec,0,64), context: Context, launchContractHash: Hash, assignmentHash: Hash },
  { baseCommit: GitOID, candidateDigest: Hash, candidateGeneration: UInt });
const result = { ...version, taskId: ID, assignmentId: ID, attemptId: ID, specHash: Hash, assignmentHash: Hash, evidenceRefs: ids(0,256) };
const ScoutResult = object('ScoutResult', { ...result, role: literal('Scout'), observations: list(Observation,0,128),
  relevantFiles: paths(0,1024), risks: list(Risk,0,128), ambiguities: texts(0,128), recommendedScope: ScopeSpec });
const DeveloperResult = object('DeveloperResult', { ...result, role: literal('Developer'), summary: Text,
  changedFiles: paths(0,4096), commandsRun: ids(0,64), tests: list(Observation,0,128), residualRisks: list(Risk,0,128) }, { blockedReason: Text });
const ReviewResult = object('ReviewResult', { ...result, role: literal('Reviewer'), verdict: enumeration('PASS','FAIL','BLOCKED'),
  reviewedTreeHash: Hash, candidateGeneration: UInt, criteria: list(CriterionAssessment,1,256), findings: list(Finding,0,256),
  scopeAssessment: Assessment, testAssessment: Assessment, actualChangesAssessment: Assessment,
  residualRisks: list(Risk,0,128), validationResultIds: ids(1,64) });
const OracleResult = object('OracleResult', { ...result, role: literal('Oracle'), escalationId: ID, diagnosis: Text,
  options: texts(1,16), recommendation: Text, unresolvedQuestions: texts(0,64), needsHumanDecision: boolean });
const WorkflowState = object('WorkflowState', { ...version, taskId: ID, packageVersion: Text, revision: UInt, state: State,
  spec: ArtifactRef, specHash: Hash, ownerSessionId: Text, repoRoot: Root, baselineEvidence: ids(0,64), runs: list(RunRecord,0,64),
  counters: Counters, failures: list(FailureRecord,0,256), escalations: list(Escalation,0,4), decisions: list(DecisionRecord,0,256),
  validations: ids(0,256), reviews: ids(0,256), results: ids(0,256), gates: ids(0,256), capabilities: list(CapabilityEvidence,0,64),
  invalidEvidenceIds: ids(0,1024), completionEvidenceRefs: ids(0,256), lastEventId: ID, createdAt: Time, updatedAt: Time },
  { baselineRef: Text, baselineCommit: GitOID, candidate: Candidate, pendingGateId: ID, blockedReason: Text, terminalReason: Text, runtimeBindingRef: ArtifactRef });
const ValidationResult = object('ValidationResult', { ...version, id: ID, taskId: ID, commandId: ID, specHash: Hash,
  candidateDigest: Hash, candidateGeneration: UInt, commandHash: Hash,
  status: enumeration('PASSED','FAILED','NOT_RUN','INVALID','TIMED_OUT'), issuer: literal('Orchestrator'), reason: Text },
  { startedAt: Time, endedAt: Time, exitCode: integer(-2147483648,2147483647), durationMs: UInt,
    logRef: ID, processProofRef: ID, postCandidateDigest: Hash });
const HumanGate = object('HumanGate', { schemaVersion:scalar<1|2>('GATE_VERSION',v=>v===1||v===2), id: ID, taskId: ID,
  type: enumeration('beforeImplementation','onScopeChange','onOracleDecision','beforeCompletion','onRetryExhausted','beforeReviewerRedispatch'),
  requestedBy: literal('Orchestrator'), status: enumeration('PENDING','APPROVED','REJECTED','INVALIDATED','CONSUMED'),
  specHash: Hash, approvedData: ArtifactRef, approvedDataHash: Hash, stateRevision: UInt,
  resumeState: enumeration('PENDING','ANALYZING','READY','IMPLEMENTING','REVIEWING','REWORK','BLOCKED'),
  continuation: enumeration('ANALYZE','PREPARE','IMPLEMENT','REVIEW_FINAL','REWORK','RECONCILE'), requestedAt: Time },
  { proposedSpecHash: Hash, candidateDigest: Hash, candidateGeneration: UInt, decidedAt: Time,
    humanDecisionRef: ID, consumedEventId: ID, invalidationReason: Text, authorizationKind:enumeration('DirectHumanApproval','PolicyDerivedAuthorization'), policyAuthorizationRef:ID });
const TransitionEvent = object('TransitionEvent', { ...version, id: ID, taskId: ID, kind: enumeration('CREATE','TRANSITION','RECORD'),
  actor: literal('Orchestrator'), targetState: State, revision: UInt, timestamp: Time, reason: Text,
  evidenceRefs: ids(0,256), invalidatedEvidenceIds: ids(0,1024), stateAfter: ArtifactRef, eventHash: Hash },
  { transitionId: ID, recordType: enumeration('SPEC_SNAPSHOT','SPAWN_INTENT','RUN_BOUND','RESULT_RECEIVED','CANDIDATE_MATERIALIZED',
    'VALIDATION_RECORDED','REVIEW_RECORDED','GATE_DECIDED','ESCALATION_OPENED','DECISION_RECORDED','EVIDENCE_INVALIDATED','RECONCILED'),
    sourceState: State, previousRevision: UInt, previousEventHash: Hash });
const schemas = Object.freeze({ ArtifactRef, InputSource, Requirement, Criterion, CommandSpec, ScopeSpec, RetryPolicy, GatePolicy,
  Observation, Risk, Finding, Assessment, CriterionAssessment, DecisionRecord, RunRecord, FailureRecord, Counters, Escalation,
  Candidate, CapabilityEvidence, HumanDecisionEvidence, CandidateEntry, CandidateManifest, TaskSpec, ControlledContextPolicy,
  ControlledExtensionRef, ControlledCapabilityConstraints, ControlledLaunchContract, ControlledRegistrationEvidence, AssignmentEnvelope,
  ScoutResult, DeveloperResult, ReviewResult, OracleResult, WorkflowState, ValidationResult, HumanGate, TransitionEvent });
export type ContractMap = { [K in keyof typeof schemas]: Infer<typeof schemas[K]> };
export type ContractName = keyof ContractMap;
export type ArtifactRef = ContractMap['ArtifactRef'];
export type InputSource = ContractMap['InputSource'];
export type Requirement = ContractMap['Requirement'];
export type Criterion = ContractMap['Criterion'];
export type CommandSpec = ContractMap['CommandSpec'];
export type ScopeSpec = ContractMap['ScopeSpec'];
export type RetryPolicy = ContractMap['RetryPolicy'];
export type GatePolicy = ContractMap['GatePolicy'];
export type Observation = ContractMap['Observation'];
export type Risk = ContractMap['Risk'];
export type Finding = ContractMap['Finding'];
export type Assessment = ContractMap['Assessment'];
export type CriterionAssessment = ContractMap['CriterionAssessment'];
export type DecisionRecord = ContractMap['DecisionRecord'];
export type RunRecord = ContractMap['RunRecord'];
export type FailureRecord = ContractMap['FailureRecord'];
export type Counters = ContractMap['Counters'];
export type Escalation = ContractMap['Escalation'];
export type Candidate = ContractMap['Candidate'];
export type CapabilityEvidence = ContractMap['CapabilityEvidence'];
export type HumanDecisionEvidence = ContractMap['HumanDecisionEvidence'];
export type CandidateEntry = ContractMap['CandidateEntry'];
export type CandidateManifest = ContractMap['CandidateManifest'];
export type TaskSpec = ContractMap['TaskSpec'];
export type ControlledContextPolicy = ContractMap['ControlledContextPolicy'];
export type ControlledExtensionRef = ContractMap['ControlledExtensionRef'];
export type ControlledCapabilityConstraints = ContractMap['ControlledCapabilityConstraints'];
export type ControlledLaunchContract = ContractMap['ControlledLaunchContract'];
export type ControlledRegistrationEvidence = ContractMap['ControlledRegistrationEvidence'];
export type AssignmentEnvelope = ContractMap['AssignmentEnvelope'];
export type ResultEnvelope = Pick<ContractMap['ScoutResult'], keyof typeof result> & { readonly role: Role };
export type ScoutResult = ContractMap['ScoutResult'];
export type DeveloperResult = ContractMap['DeveloperResult'];
export type ReviewResult = ContractMap['ReviewResult'];
export type OracleResult = ContractMap['OracleResult'];
export type WorkflowState = ContractMap['WorkflowState'];
export type ValidationResult = ContractMap['ValidationResult'];
export type HumanGate = ContractMap['HumanGate'];
export type TransitionEvent = ContractMap['TransitionEvent'];
export type ID = string; export type Text = string; export type LongText = string; export type UInt = number;
export type Hash = string; export type GitOID = string; export type Time = string; export type Path = string; export type Root = string;
export type State = Infer<typeof scalars.State>; export type Role = Infer<typeof scalars.Role>;

// Explicit data context, never callbacks, filesystem access or an assertion of provenance.
// Registry IDs resolve references; selectors identify the intended spec/assignment/state.
// currentValidationIds is supplied explicitly: an old PASS is never selected implicitly.
// Registry values receive structural/local checks; cross-checks concern the selected
// contract, not reconstruction of a ledger or verification of an entire historical graph.
export type ContextRecord = { readonly [K in ContractName]: Readonly<{ id: string; kind: K; value: ContractMap[K] }> }[ContractName];
export type ValidationContext = Readonly<{
  records: readonly ContextRecord[];
  specId?: string; assignmentId?: string; stateId?: string; previousStateId?: string;
  currentValidationIds?: readonly string[]; globalReworkCap?: number; modelExtracted?: boolean;
  runtimeRootMappings?: readonly RuntimeRootMapping[];
}>;
export type Validation<T> = Readonly<{ ok: true; level: 'structural' | 'semantic-data-only'; value: T; externalVerification: 'NOT_PERFORMED' }>
  | Readonly<{ ok: false; errors: readonly Issue[] }>;
function failed(errors: Issue[]): Validation<never> { return Object.freeze({ ok: false, errors: Object.freeze(errors) }); }
function exception(error: unknown): Validation<never> {
  if (error instanceof ContractError) return failed([error.issue]);
  // Hostile inputs/resource exhaustion never become successful validation.
  return failed([Object.freeze({ stage: 'json', code: 'UNREADABLE_INPUT', path: '$' })]);
}
const limits: Partial<Record<ContractName, number>> = { TaskSpec: 256*1024, AssignmentEnvelope: 256*1024,
  ControlledLaunchContract: 64*1024, ControlledRegistrationEvidence: 64*1024, ScoutResult: 1024*1024, DeveloperResult: 1024*1024, ReviewResult: 1024*1024, OracleResult: 1024*1024,
  ValidationResult: 1024*1024, WorkflowState: 4*1024*1024, TransitionEvent: 1024*1024, CandidateManifest: 64*1024*1024 };
export function validateScalar<K extends keyof typeof scalars>(name: K, input: unknown): Validation<Infer<typeof scalars[K]>> {
  try {
    if (typeof name !== 'string' || !Object.hasOwn(scalars, name)) throw new ContractError('structural','UNKNOWN_SCALAR');
    const value = copyJson(input); const errors: Issue[] = [];
    scalars[name].check(value, '$', errors);
    return errors.length ? failed(errors) : Object.freeze({ ok: true, level: 'structural', value: value as Infer<typeof scalars[K]>, externalVerification: 'NOT_PERFORMED' });
  } catch (e) { return exception(e); }
}
const structuralCopies=new WeakMap<object,Map<ContractName,Validation<any>>>();
const locallyValidCopies=new WeakMap<object,Set<ContractName>>();
export function validateStructure<K extends ContractName>(name: K, input: unknown): Validation<ContractMap[K]> {
  try {
    if (typeof name !== 'string' || !Object.hasOwn(schemas, name)) throw new ContractError('structural','UNKNOWN_CONTRACT');
    const value = copyJson(input); const errors: Issue[] = [];
    const objectValue=value!==null&&typeof value==='object'?value:undefined;
    const cached=objectValue?structuralCopies.get(objectValue)?.get(name):undefined;
    if(cached)return cached;
    schemas[name].check(value, '$', errors);
    const limit = limits[name];
    if (limit !== undefined && byteLength(canonicalize(value)) > limit) errors.push(Object.freeze({ stage:'structural', code:'PAYLOAD_LIMIT', path:'$' }));
    const result:Validation<ContractMap[K]>=errors.length ? failed(errors) : Object.freeze({ ok:true, level:'structural', value:value as ContractMap[K], externalVerification:'NOT_PERFORMED' });
    if(objectValue&&result.ok){const cache=structuralCopies.get(objectValue)??new Map();cache.set(name,result);structuralCopies.set(objectValue,cache)}
    return result;
  } catch (e) { return exception(e); }
}
function local<K extends ContractName>(name: K, value: ContractMap[K], errors: Issue[], checkHash = true): void {
  // The value is a deep immutable copy returned by validateStructure. Cache
  // only context-free checks; cross-record semantics always run afresh below.
  if(checkHash&&locallyValidCopies.get(value)?.has(name))return;
  const before=errors.length;
  (schemas[name] as Schema<ContractMap[K]>).walk(value, '$', (n,v,p) => localSemantics(n as ContractName,v, p,errors,checkHash));
  if(checkHash&&errors.length===before){const cache=locallyValidCopies.get(value)??new Set();cache.add(name);locallyValidCopies.set(value,cache)}
}
export function validateContract<K extends ContractName>(name: K, input: unknown, context?: ValidationContext): Validation<ContractMap[K]> {
  try {
    const structural = validateStructure(name,input);
    if (!structural.ok) return structural;
    const errors: Issue[] = []; local(name,structural.value,errors);
    let ctx: ValidationContext = { records: [] };
    if (context !== undefined) {
      const descriptors=Object.getOwnPropertyDescriptors(context);
      if(Object.values(descriptors).some(d=>!Object.hasOwn(d,'value')))throw new ContractError('context','INVALID_CONTEXT');
      const runtimeRootMappings=descriptors.runtimeRootMappings?.value as ValidationContext['runtimeRootMappings'];
      if(runtimeRootMappings!==undefined&&!Array.isArray(runtimeRootMappings))throw new ContractError('context','INVALID_CONTEXT');
      const value = {...copyJson(Object.fromEntries(Object.entries(descriptors).filter(([k])=>k!=='runtimeRootMappings').map(([k,d])=>[k,d.value]))) as object,
        ...(runtimeRootMappings?{runtimeRootMappings}:{})} as ValidationContext;
      const allowed = ['records','specId','assignmentId','stateId','previousStateId','currentValidationIds','globalReworkCap','modelExtracted','runtimeRootMappings'];
      if (value === null || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.records)
        || Object.keys(value).some(k => !allowed.includes(k))) throw new ContractError('context','INVALID_CONTEXT');
      for (const k of ['specId','assignmentId','stateId','previousStateId'] as const)
        if (value[k] !== undefined && !validateScalar('ID',value[k]).ok) throw new ContractError('context','INVALID_CONTEXT',k);
      if (value.modelExtracted !== undefined && typeof value.modelExtracted !== 'boolean') throw new ContractError('context','INVALID_CONTEXT');
      if (value.globalReworkCap !== undefined && !validateScalar('UInt',value.globalReworkCap).ok) throw new ContractError('context','INVALID_CONTEXT');
      if (value.currentValidationIds !== undefined && (!Array.isArray(value.currentValidationIds)
        || value.currentValidationIds.some(id => !validateScalar('ID',id).ok)
        || new Set(value.currentValidationIds).size !== value.currentValidationIds.length)) throw new ContractError('context','INVALID_CONTEXT');
      const seen = new Set<string>();
      for (const record of value.records) {
        if (record === null || typeof record !== 'object' || Array.isArray(record)
          || Object.keys(record).sort().join(',') !== 'id,kind,value' || !validateScalar('ID',record.id).ok
          || seen.has(record.id)) throw new ContractError('context','INVALID_RECORD');
        seen.add(record.id);
        const s = validateStructure(record.kind,record.value);
        if (!s.ok) throw new ContractError('context','INVALID_RECORD',record.id);
        const e: Issue[] = []; local(record.kind,s.value,e);
        if (e.length) throw new ContractError('context','INVALID_RECORD',record.id);
      }
      ctx = value;
    }
    crossSemantics(name,structural.value,ctx,errors);
    return errors.length ? failed(errors) : Object.freeze({ ok:true, level:'semantic-data-only', value:structural.value, externalVerification:'NOT_PERFORMED' });
  } catch (e) { return exception(e); }
}
export function parseContract<K extends ContractName>(name: K, input: string | Uint8Array, context?: ValidationContext): Validation<ContractMap[K]> {
  try {
    if (typeof name !== 'string' || !Object.hasOwn(schemas,name)) throw new ContractError('structural','UNKNOWN_CONTRACT');
    return validateContract(name,parseJson(input,limits[name] ?? Number.MAX_SAFE_INTEGER),context);
  } catch (e) { return exception(e); }
}
/** Hash a structurally/local-valid record, ignoring only its own hash check.
 * Requires the self-hash field in valid Hash format (a placeholder is sufficient).
 * Does not accept the contract, authenticate it, or verify external references. */
export function launchContractHash(input: ControlledLaunchContract): string {
  const valid = validateContract('ControlledLaunchContract', input);
  if (!valid.ok) throw new ContractError('semantic','INVALID_HASH_INPUT');
  return hashCanonical(valid.value);
}
export function hashContract<K extends 'TaskSpec' | 'AssignmentEnvelope' | 'TransitionEvent'>(name: K, input: ContractMap[K]): string {
  if (!['TaskSpec','AssignmentEnvelope','TransitionEvent'].includes(name)) throw new ContractError('structural','UNKNOWN_HASH_CONTRACT');
  const s = validateStructure(name,input);
  if (!s.ok) throw new ContractError('structural','INVALID_HASH_INPUT');
  const errors: Issue[] = []; local(name,s.value,errors,false);
  if (errors.length) throw new ContractError('semantic','INVALID_HASH_INPUT');
  return selfHash(name,s.value);
}
export function failureFingerprint(input: FailureRecord): string {
  const s = validateStructure('FailureRecord',input);
  if (!s.ok) throw new ContractError('structural','INVALID_HASH_INPUT');
  const errors: Issue[] = []; local('FailureRecord',s.value,errors,false);
  if (errors.length) throw new ContractError('semantic','INVALID_HASH_INPUT');
  return fingerprint(s.value);
}
