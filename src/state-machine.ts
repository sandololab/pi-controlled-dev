/**
 * P3 internal, pure admission model — not an Orchestrator or a DATA-010 event.
 * Facts are host-supplied attestations, NOT authenticated evidence. No type or
 * boolean authenticates a host/human. Callers must validate real evidence and
 * re-evaluate under locks immediately before commit. Nothing here commits.
 * CREATE initializes PENDING at revision 0; RECORD preserves state and advances
 * revision, never mutates terminals. Neither operation is accepted by this API.
 */
export const STATES = Object.freeze([
  'PENDING', 'ANALYZING', 'READY', 'IMPLEMENTING', 'TESTING', 'REVIEWING',
  'REWORK', 'BLOCKED', 'AWAITING_HUMAN', 'COMPLETED', 'FAILED',
] as const);
export type State = typeof STATES[number];
export type Truth = boolean | 'unknown' | 'contradictory';

// Each name covers the whole named obligation in STM-002, not a child report.
const requirements = freeze({
  G0: ['stateSchemaValid', 'taskLockHeld', 'identityConflictAbsent', 'hostAuthorityVerified'],
  A: ['inputSnapshotsAndHashesAvailable', 'dispatchBudgetRemaining', 'scoutAssignmentControlled'],
  R: ['scoutResultValid', 'ambiguitiesResolvedWithRecordedDecisions', 'criteriaIdsAndMethodsVerifiable',
    'requiredCommandsNonempty', 'specAndScopeFrozen'],
  I: ['implementationGateSatisfiedIfRequired', 'writerTerminalProven', 'sourceIntegrityVerified',
    'developerBudgetRemaining', 'assignmentNewScopedFresh'],
  T: ['developerResultValidAttributedUnblocked', 'writerTerminalProven', 'handoffCompleteDurable',
    'baseExact', 'patchValidated', 'candidateMaterializedAfterWriterInImplementing',
    'scopeChecked', 'candidateDigestAcquired'],
  V: ['candidateMaterializedInScope', 'requiredValidationHostPassedCurrent',
    'noMutationOrUnknownIdentity', 'reviewerIndependentFreshReadonlyVerified'],
  W: ['defectConcreteAttributed', 'findingAcceptedInScope', 'failureEvidenceAvailable',
    'writerTerminalProven', 'nextAttemptNotConsumed'],
  B: ['technicalOrInformationReason', 'missingOrConflictingEvidenceIdentified'],
  H: ['gateRequestTyped', 'gateTargetAndDataFrozen', 'writerTerminalProven'],
  F: ['allRunsStoppedAndReconciled'],
  U: ['blockResolvedWithNewEvidence', 'repositoryAndProcessesKnown'],
  X: ['recoveryInconsistencyDetected', 'lastTrustedStateNonterminal', 'conflictingEvidencePreserved'],
  GA: ['humanOriginAndConfirmationVerified', 'decisionValid', 'gateNotSuperseded',
    'sessionOwnershipReconciled', 'legalDecisionRevisionChain'],
} as const);
const extraFacts = Object.freeze([
  'approvedPolicyAuthorizationVerified', 'workspaceLockHeld', 'gitMutationPreconditionsVerified', 'mutationCapabilitiesVerified',
  'effectCapabilitiesVerified', 'durableIntentRecorded',
  'findingsAdmitted', 'reanalysisNeedRecorded', 'specChangeAuthorized',
  'definitiveHumanRejection', 'unrecoverableViolation', 'budgetExhaustedWithoutResolution',
  'pendingSpecAccepted', 'inputStillNeedsAnalysis', 'suspendedQuiescentPoint',
  'scopeChangeProposed', 'oracleMaterialAdvice', 'oracleSpecOrCriteriaChange',
  'oracleFixInScope', 'reconciliationNeeded', 'finalReviewTestsRiskPatchValid',
  'finiteExhaustionActionWithoutBudgetIncrease', 'reviewerInfrastructureRetryCurrent',
] as const);
type Guard = keyof typeof requirements | 'C';
type Fact = typeof requirements[keyof typeof requirements][number] | typeof extraFacts[number];
export type Facts = Readonly<Partial<Record<Fact, Truth>>>;

// CMP-001 1..18: one explicit, separately falsifiable proposition per entry.
export const COMPLETION_CONDITIONS = Object.freeze({
  'CMP-01': 'REVIEWING; valid version/revision/ledger; task/workspace locks; Orchestrator selects TR-022',
  'CMP-02': 'Validated current TaskSpec, matching source snapshots/hashes, no ambiguity or unverifiable criterion',
  'CMP-03': 'Required capabilities verified for current environment, versions and effective contracts',
  'CMP-04': 'Clean attributed Git baseline, exact baseCommit, candidate separate from original',
  'CMP-05': 'Valid structured DeveloperResult correlated to last authorized assignment, no blockedReason',
  'CMP-06': 'No active/unknown child, intent or writer; terminal proof and no concurrent mutations',
  'CMP-07': 'Complete durable handoff/patch/manifest; candidate round-trip including new and binary files',
  'CMP-08': 'Host scope PASS for whole diff/filesystem; no denied, outside-allow or original changes',
  'CMP-09': 'Recomputed digest/generation match verified candidate; no necessary quarantined evidence',
  'CMP-10': 'Nonempty required commands; every current authoritative validation PASSED with exact bindings, logs and proof',
  'CMP-11': 'Current schema-valid PASS review, independent role/session/run, proven fresh and read-only',
  'CMP-12': 'Review binds same spec/digest/generation and current tests; scope/test/actualChanges PASS',
  'CMP-13': 'Exactly one evidenced PASS per criterion; every requirement covered',
  'CMP-14': 'No blocking finding/risk or open material decision/escalation; reasoned residual-risk dispositions',
  'CMP-15': 'Authentic historical authority for past effects; final applicable gates current and consumed once; none pending/invalid/rejected',
  'CMP-16': 'Monotone bounded counters; no unresolved retry/policy violation or unapproved fallback',
  'CMP-17': 'All cited evidence available, intact, attributed, durable beyond retention; no secrets/full transcripts',
  'CMP-18': 'Completion packet spec/base/patch/candidate/validation/review/gate/decision IDs match commit snapshot',
} as const);
type CompletionId = keyof typeof COMPLETION_CONDITIONS;
export type CompletionFacts = Readonly<Partial<Record<CompletionId, Truth>>>;

type Effect = 'analyze' | 'ready' | 'implement' | 'test' | 'review' | 'rework' | 'block' | 'gate' | 'fail' | 'complete' | 'resume';
type Invalidation = 'N' | 'E' | 'S' | 'Q' | 'G';
type Rule = Invalidation | 'G+E' | 'S-if-spec' | 'G+S-if-spec' | 'Q+G-if-consumed' | 'Q+close-gate';
type GuardExpression = Guard | 'B|X' | 'I+findings' | 'A+reanalysis' | 'U+A' | 'U+W' | 'GA+A' | 'GA+R' | 'GA+I' | 'GA+V' | 'GA+W' | 'B|X|GA';

// Literal transcription of STM-003. No inferred target rules or self-edges.
export const TRANSITIONS = freeze([
  ['TR-001', 'PENDING', 'ANALYZING', 'A', 'analyze', 'N'],
  ['TR-002', 'PENDING', 'AWAITING_HUMAN', 'H', 'gate', 'N'],
  ['TR-003', 'PENDING', 'FAILED', 'F', 'fail', 'Q'],
  ['TR-004', 'PENDING', 'BLOCKED', 'X', 'block', 'Q'],
  ['TR-005', 'ANALYZING', 'READY', 'R', 'ready', 'N'],
  ['TR-006', 'ANALYZING', 'BLOCKED', 'B|X', 'block', 'Q'],
  ['TR-007', 'ANALYZING', 'AWAITING_HUMAN', 'H', 'gate', 'N'],
  ['TR-008', 'ANALYZING', 'FAILED', 'F', 'fail', 'Q'],
  ['TR-009', 'READY', 'IMPLEMENTING', 'I', 'implement', 'E'],
  ['TR-010', 'READY', 'AWAITING_HUMAN', 'H', 'gate', 'N'],
  ['TR-011', 'READY', 'FAILED', 'F', 'fail', 'Q'],
  ['TR-012', 'READY', 'BLOCKED', 'X', 'block', 'Q'],
  ['TR-013', 'IMPLEMENTING', 'TESTING', 'T', 'test', 'N'],
  ['TR-014', 'IMPLEMENTING', 'REWORK', 'W', 'rework', 'E'],
  ['TR-015', 'IMPLEMENTING', 'BLOCKED', 'B|X', 'block', 'Q'],
  ['TR-016', 'IMPLEMENTING', 'AWAITING_HUMAN', 'H', 'gate', 'N'],
  ['TR-017', 'IMPLEMENTING', 'FAILED', 'F', 'fail', 'Q'],
  ['TR-018', 'TESTING', 'REVIEWING', 'V', 'review', 'N'],
  ['TR-019', 'TESTING', 'REWORK', 'W', 'rework', 'E'],
  ['TR-020', 'TESTING', 'BLOCKED', 'B|X', 'block', 'Q'],
  ['TR-021', 'TESTING', 'FAILED', 'F', 'fail', 'Q'],
  ['TR-022', 'REVIEWING', 'COMPLETED', 'C', 'complete', 'N'],
  ['TR-023', 'REVIEWING', 'REWORK', 'W', 'rework', 'E'],
  ['TR-024', 'REVIEWING', 'BLOCKED', 'B|X', 'block', 'Q'],
  ['TR-025', 'REVIEWING', 'AWAITING_HUMAN', 'H', 'gate', 'N'],
  ['TR-026', 'REVIEWING', 'FAILED', 'F', 'fail', 'Q'],
  ['TR-027', 'REWORK', 'IMPLEMENTING', 'I+findings', 'implement', 'E'],
  ['TR-028', 'REWORK', 'ANALYZING', 'A+reanalysis', 'analyze', 'S'],
  ['TR-029', 'REWORK', 'BLOCKED', 'B|X', 'block', 'Q'],
  ['TR-030', 'REWORK', 'AWAITING_HUMAN', 'H', 'gate', 'N'],
  ['TR-031', 'REWORK', 'FAILED', 'F', 'fail', 'Q'],
  ['TR-032', 'BLOCKED', 'ANALYZING', 'U+A', 'analyze', 'S-if-spec'],
  ['TR-033', 'BLOCKED', 'REWORK', 'U+W', 'rework', 'E'],
  ['TR-034', 'BLOCKED', 'AWAITING_HUMAN', 'H', 'gate', 'N'],
  ['TR-035', 'BLOCKED', 'FAILED', 'F', 'fail', 'Q'],
  ['TR-036', 'AWAITING_HUMAN', 'PENDING', 'GA', 'resume', 'G'],
  ['TR-037', 'AWAITING_HUMAN', 'ANALYZING', 'GA+A', 'resume/analyze', 'G+S-if-spec'],
  ['TR-038', 'AWAITING_HUMAN', 'READY', 'GA+R', 'resume/ready', 'G'],
  ['TR-039', 'AWAITING_HUMAN', 'IMPLEMENTING', 'GA+I', 'resume/implement', 'G+E'],
  ['TR-040', 'AWAITING_HUMAN', 'REVIEWING', 'GA+V', 'resume/review', 'G'],
  ['TR-041', 'AWAITING_HUMAN', 'REWORK', 'GA+W', 'resume/rework', 'G+E'],
  ['TR-042', 'AWAITING_HUMAN', 'BLOCKED', 'B|X|GA', 'block', 'Q+G-if-consumed'],
  ['TR-043', 'AWAITING_HUMAN', 'FAILED', 'F', 'fail', 'Q+close-gate'],
] as const satisfies readonly (readonly [string, State, State, GuardExpression, string, Rule])[]);
export type TransitionId = typeof TRANSITIONS[number][0];

export interface Binding {
  readonly taskId: string;
  readonly specHash: string;
  readonly candidate?: Readonly<{ digest: string; generation: number }>;
}
export interface GateContext {
  readonly authorizationKind?:'DirectHumanApproval'|'PolicyDerivedAuthorization';
  readonly id: string;
  readonly type: 'beforeImplementation' | 'onScopeChange' | 'onOracleDecision' | 'beforeCompletion' | 'onRetryExhausted' | 'beforeReviewerRedispatch';
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'INVALIDATED' | 'CONSUMED';
  readonly resumeState: State;
  readonly continuation: 'PREPARE' | 'ANALYZE' | 'IMPLEMENT' | 'REVIEW_FINAL' | 'REWORK' | 'RECONCILE';
  readonly binding: Binding;
  readonly proposedSpecHash?: string;
  readonly dataHash: string;
  readonly displayedRevision: number;
  readonly decision?: Readonly<{
    kind: 'APPROVE' | 'REJECT' | 'ANSWER';
    gateId: string;
    binding: Binding;
    dataHash: string;
    proposedSpecHash?: string;
    displayedRevision: number;
    // CAS revision at acceptance, before writing the decision RECORD.
    acceptedAgainstRevision: number;
    recordedAtRevision: number;
    consumed: boolean;
  }>;
}
export interface EvaluationInput {
  readonly state: State;
  readonly revision: number;
  readonly expectedRevision: number;
  readonly transition: TransitionId;
  readonly binding: Binding;
  readonly evidence: Readonly<{ revision: number; binding: Binding; facts: Facts; completion?: CompletionFacts }>;
  readonly authority: Readonly<{ role: 'Orchestrator' | 'Scout' | 'Developer' | 'Reviewer' | 'Oracle' | 'Human'; origin: 'host' | 'child' | 'human'; taskId: string }>;
  readonly workspaceMutable: boolean;
  readonly mutationRequired: boolean;
  readonly writer: 'terminal' | 'active' | 'unknown';
  readonly nextSpecHash?: string;
  readonly gate?: GateContext;
  // Explicitly select whether TR-042 consumes a gate; never infer consumption
  // from the mere presence of an approval alongside a diagnostic B/X branch.
  readonly blockMode?: 'diagnostic' | 'consumeGate';
}
export interface Admission {
  readonly admitted: true;
  readonly kind: 'transition-admission-only';
  readonly transition: TransitionId;
  readonly source: State;
  readonly target: State;
  readonly previousRevision: number;
  readonly proposedRevision: number;
  readonly binding: Binding;
  readonly nextSpecHash?: string;
  readonly consequences: Readonly<{
    effects: readonly Effect[];
    invalidations: readonly Invalidation[];
    gate: 'none' | 'request' | 'consume' | 'close';
    gateBinding?: Readonly<Pick<GateContext, 'id' | 'type' | 'dataHash' | 'proposedSpecHash' | 'displayedRevision' | 'resumeState' | 'continuation'>>;
    review: 'none' | 'fresh-packet' | 'reevaluate-existing';
    preserveHistory: true;
    beforeExternalEffects: readonly ['verify-capabilities', 'commit-durable-intent'];
    commit: 'host-must-revalidate-and-serialize';
  }>;
}
export type Decision = Admission | Readonly<{ admitted: false; reasons: readonly string[] }>;

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function object(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return typeof key === 'string' && 'value' in descriptor && descriptor.enumerable;
  });
}
function shape(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  return object(value) && required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
const uint = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const member = (value: unknown, choices: readonly string[]): boolean => typeof value === 'string' && choices.includes(value);
function bindingShape(value: unknown): value is Binding {
  return shape(value, ['taskId', 'specHash'], ['candidate']) && id(value.taskId) && hash(value.specHash) &&
    (!Object.hasOwn(value, 'candidate') || (shape(value.candidate, ['digest', 'generation']) &&
      hash(value.candidate.digest) && uint(value.candidate.generation)));
}
function sameBinding(a: Binding, b: Binding): boolean {
  return a.taskId === b.taskId && a.specHash === b.specHash &&
    a.candidate?.digest === b.candidate?.digest && a.candidate?.generation === b.candidate?.generation;
}
function copyBinding(a: Binding): Binding {
  return { taskId: a.taskId, specHash: a.specHash, ...(a.candidate ? { candidate: { ...a.candidate } } : {}) };
}
const continuations = Object.freeze({ PENDING: 'PREPARE', ANALYZING: 'ANALYZE', READY: 'PREPARE',
  IMPLEMENTING: 'IMPLEMENT', REVIEWING: 'REVIEW_FINAL', REWORK: 'REWORK', BLOCKED: 'RECONCILE' } as const);
const gateTargets = freeze({
  beforeImplementation: ['PENDING', 'ANALYZING', 'READY', 'IMPLEMENTING'],
  onScopeChange: ['ANALYZING'], onOracleDecision: ['ANALYZING', 'REWORK', 'BLOCKED'],
  beforeCompletion: ['REVIEWING'], onRetryExhausted: ['ANALYZING', 'REWORK', 'BLOCKED'],
  beforeReviewerRedispatch: ['REVIEWING'],
} as const);
function gateShape(value: unknown): value is GateContext {
  if (!shape(value, ['id', 'type', 'status', 'resumeState', 'continuation', 'binding', 'dataHash', 'displayedRevision'], ['decision', 'proposedSpecHash','authorizationKind']) ||
    (Object.hasOwn(value,'authorizationKind')&&!member(value.authorizationKind,['DirectHumanApproval','PolicyDerivedAuthorization']))|| !id(value.id) || !member(value.type, Object.keys(gateTargets)) ||
    !member(value.status, ['PENDING', 'APPROVED', 'REJECTED', 'INVALIDATED', 'CONSUMED']) ||
    !member(value.resumeState, STATES) || !member(value.continuation, Object.values(continuations)) ||
    !bindingShape(value.binding) || !hash(value.dataHash) || !uint(value.displayedRevision) ||
    (Object.hasOwn(value, 'proposedSpecHash') && !hash(value.proposedSpecHash))) return false;
  if (!Object.hasOwn(value, 'decision')) return true;
  const d = value.decision;
  return shape(d, ['kind', 'gateId', 'binding', 'dataHash', 'displayedRevision', 'acceptedAgainstRevision', 'recordedAtRevision', 'consumed'], ['proposedSpecHash']) &&
    (!Object.hasOwn(d, 'proposedSpecHash') || hash(d.proposedSpecHash)) &&
    member(d.kind, ['APPROVE', 'REJECT', 'ANSWER']) && id(d.gateId) && bindingShape(d.binding) && hash(d.dataHash) &&
    uint(d.displayedRevision) && uint(d.acceptedAgainstRevision) && uint(d.recordedAtRevision) && typeof d.consumed === 'boolean';
}
function factsShape(value: unknown, keys: readonly string[]): boolean {
  return shape(value, [], keys) && Object.values(value).every(v => v === true || v === false || v === 'unknown' || v === 'contradictory');
}
function inputShape(value: unknown): value is EvaluationInput {
  if (!shape(value, ['state', 'revision', 'expectedRevision', 'transition', 'binding', 'evidence', 'authority',
    'workspaceMutable', 'mutationRequired', 'writer'], ['nextSpecHash', 'gate', 'blockMode'])) return false;
  const e = value.evidence, a = value.authority;
  return member(value.state, STATES) && typeof value.transition === 'string' && uint(value.revision) && uint(value.expectedRevision) &&
    bindingShape(value.binding) && shape(e, ['revision', 'binding', 'facts'], ['completion']) && uint(e.revision) && bindingShape(e.binding) &&
    factsShape(e.facts, [...Object.values(requirements).flat(), ...extraFacts]) &&
    (!Object.hasOwn(e, 'completion') || factsShape(e.completion, Object.keys(COMPLETION_CONDITIONS))) &&
    shape(a, ['role', 'origin', 'taskId']) && member(a.role, ['Orchestrator', 'Scout', 'Developer', 'Reviewer', 'Oracle', 'Human']) &&
    member(a.origin, ['host', 'child', 'human']) && id(a.taskId) &&
    typeof value.workspaceMutable === 'boolean' && typeof value.mutationRequired === 'boolean' &&
    member(value.writer, ['terminal', 'active', 'unknown']) &&
    (!Object.hasOwn(value, 'gate') || gateShape(value.gate)) &&
    (!Object.hasOwn(value, 'nextSpecHash') || hash(value.nextSpecHash)) &&
    (!Object.hasOwn(value, 'blockMode') || member(value.blockMode, ['diagnostic', 'consumeGate']));
}

/** Runtime boundary accepts unknown plain data, validates only this P3 API. */
export function evaluateTransition(input: EvaluationInput | unknown): Decision {
  const reject = (...reasons: string[]): Decision => freeze({ admitted: false as const, reasons });
  if (!inputShape(input)) return reject('INVALID_INPUT');
  const q = input;
  const row = TRANSITIONS.find(([tr]) => tr === q.transition);
  if (!row) return reject('UNKNOWN_TRANSITION');
  const [tr, source, target, expression, effect, rule] = row;
  if (q.state === 'COMPLETED' || q.state === 'FAILED') return reject('TERMINAL_STATE');
  if (source !== q.state) return reject('SOURCE_MISMATCH');
  if (q.expectedRevision !== q.revision) return reject('REVISION_MISMATCH');
  if (q.revision === Number.MAX_SAFE_INTEGER) return reject('REVISION_OVERFLOW');
  if (q.evidence.revision !== q.revision || !sameBinding(q.binding, q.evidence.binding)) return reject('STALE_EVIDENCE');
  if (q.authority.role !== 'Orchestrator' || q.authority.origin !== 'host' || q.authority.taskId !== q.binding.taskId) return reject('AUTHORITY_DENIED');
  if ((tr === 'TR-042') !== (q.blockMode !== undefined)) return reject('BLOCK_BRANCH_REQUIRED_ONLY_FOR_TR_042');
  if ((source === 'AWAITING_HUMAN' || target === 'AWAITING_HUMAN') !== (q.gate !== undefined)) return reject('GATE_CONTEXT_MISMATCH');
  const changed = q.nextSpecHash !== undefined && q.nextSpecHash !== q.binding.specHash;
  if (q.nextSpecHash !== undefined && (!changed || !['TR-028', 'TR-032', 'TR-037'].includes(tr))) return reject('SPEC_CHANGE_NOT_ALLOWED');
  const facts = q.evidence.facts;
  const need = (...names: Fact[]): string[] => names.filter(name => facts[name] !== true).map(name => `UNSATISFIED:${name}`);
  const common = need(...requirements.G0);
  if (q.workspaceMutable) common.push(...need('workspaceLockHeld'));
  if (changed) common.push(...need('specChangeAuthorized'));
  if (common.length) return reject(...common);

  function guard(g: Guard): string[] {
    if(g==='GA'&&facts.approvedPolicyAuthorizationVerified===true&&q.gate?.authorizationKind==='PolicyDerivedAuthorization'&&!['onOracleDecision','onRetryExhausted'].includes(q.gate.type))return need(...requirements.GA.filter(n=>n!=='humanOriginAndConfirmationVerified'));
    if (g === 'C') {
      const reasons = Object.keys(COMPLETION_CONDITIONS).filter(key => q.evidence.completion?.[key as CompletionId] !== true).map(key => `UNSATISFIED:${key}`);
      if (q.state !== 'REVIEWING' || tr !== 'TR-022') reasons.push('COMPLETION_CONTEXT');
      reasons.push(...need('workspaceLockHeld'));
      if (!q.binding.candidate) reasons.push('CANDIDATE_REQUIRED');
      if (q.writer !== 'terminal') reasons.push('WRITER_NOT_TERMINAL');
      // Contradictory shared facts cannot coexist with a positive CMP bundle.
      for (const name of ['writerTerminalProven', 'requiredValidationHostPassedCurrent', 'developerResultValidAttributedUnblocked',
        'reviewerIndependentFreshReadonlyVerified', 'noMutationOrUnknownIdentity', 'requiredCommandsNonempty',
        'ambiguitiesResolvedWithRecordedDecisions', 'criteriaIdsAndMethodsVerifiable', 'specAndScopeFrozen',
        'gitMutationPreconditionsVerified', 'mutationCapabilitiesVerified', 'handoffCompleteDurable', 'baseExact',
        'patchValidated', 'candidateMaterializedAfterWriterInImplementing', 'candidateMaterializedInScope',
        'scopeChecked', 'candidateDigestAcquired', 'sourceIntegrityVerified', 'finalReviewTestsRiskPatchValid'] as const) {
        if (Object.hasOwn(facts, name) && facts[name] !== true) reasons.push(`CONTRADICTORY:${name}`);
      }
      return reasons;
    }
    const reasons = need(...requirements[g]);
    if (['I', 'T', 'V', 'W', 'H'].includes(g) && q.writer !== 'terminal') reasons.push('WRITER_NOT_TERMINAL');
    if (g === 'R' && q.mutationRequired) reasons.push(...need('gitMutationPreconditionsVerified', 'mutationCapabilitiesVerified'));
    if (g === 'I') {
      reasons.push(...guard('R'));
      if (!q.mutationRequired || !q.workspaceMutable) reasons.push('MUTATION_CONTEXT_REQUIRED');
    }
    if ((g === 'T' || g === 'V') && !q.binding.candidate) reasons.push('CANDIDATE_REQUIRED');
    if (g === 'V') {
      for (const name of ['writerTerminalProven', 'requiredCommandsNonempty', 'scopeChecked', 'candidateDigestAcquired'] as const) {
        if (Object.hasOwn(facts, name) && facts[name] !== true) reasons.push(`CONTRADICTORY:${name}`);
      }
    }
    if (g === 'F') {
      if (!['definitiveHumanRejection', 'unrecoverableViolation', 'budgetExhaustedWithoutResolution'].some(name => facts[name as Fact] === true)) reasons.push('FAILURE_CAUSE_REQUIRED');
      if (q.writer !== 'terminal') reasons.push('WRITER_NOT_TERMINAL');
    }
    if (g === 'H' || g === 'GA') reasons.push(...gateChecks(g));
    return reasons;
  }
  function gateChecks(mode: 'H' | 'GA'): string[] {
    const gate = q.gate;
    if (!gate) return ['GATE_REQUIRED'];
    const errors: string[] = [];
    const resume = gate.resumeState;
    if (!(gateTargets[gate.type] as readonly string[]).includes(resume) ||
      !Object.hasOwn(continuations, resume) || continuations[resume as keyof typeof continuations] !== gate.continuation) errors.push('GATE_TARGET_OR_CONTINUATION');
    if (!sameBinding(q.binding, gate.binding)) errors.push('STALE_GATE_BINDING');
    errors.push(...need('gateTargetAndDataFrozen'));
    if (gate.type === 'onScopeChange') {
      errors.push(...need('scopeChangeProposed'));
      if (!gate.proposedSpecHash || gate.proposedSpecHash === gate.binding.specHash ||
        (mode === 'GA' && q.nextSpecHash !== gate.proposedSpecHash)) errors.push('SCOPE_PROPOSAL_MISMATCH');
    } else if (gate.proposedSpecHash !== undefined && (gate.type !== 'onOracleDecision' || resume !== 'ANALYZING')) {
      errors.push('UNEXPECTED_GATE_PROPOSAL');
    }
    if (mode === 'GA' && changed && gate.proposedSpecHash !== q.nextSpecHash) errors.push('UNAPPROVED_SPEC_CHANGE');
    if (gate.type === 'beforeImplementation') {
      if (resume === 'PENDING' || resume === 'ANALYZING') errors.push(...need('inputStillNeedsAnalysis'));
      if (resume === 'IMPLEMENTING') errors.push(...need('suspendedQuiescentPoint'), ...guard('I'));
    }
    if (gate.type === 'onOracleDecision') {
      errors.push(...need('oracleMaterialAdvice'));
      if (resume === 'ANALYZING') errors.push(...need('oracleSpecOrCriteriaChange'));
      if (resume === 'REWORK') errors.push(...need('oracleFixInScope'));
      if (resume === 'BLOCKED') errors.push(...need('reconciliationNeeded'));
    }
    if (gate.type === 'beforeCompletion') errors.push(...need('finalReviewTestsRiskPatchValid'), ...guard('V'));
    if (gate.type === 'onRetryExhausted') errors.push(...need('finiteExhaustionActionWithoutBudgetIncrease'));
    if (gate.type === 'beforeReviewerRedispatch') {
      errors.push(...need('reviewerInfrastructureRetryCurrent'), ...guard('V'));
      if (mode === 'H' && q.state !== 'BLOCKED') errors.push('REVIEWER_REDISPATCH_REQUIRES_BLOCKED');
    }
    if (mode === 'H') {
      if (gate.status !== 'PENDING' || gate.decision !== undefined || gate.displayedRevision !== q.revision + 1) errors.push('GATE_REQUEST_CONTEXT');
      return errors;
    }
    if (resume !== target) errors.push('RESUME_TARGET_MISMATCH');
    if (q.writer !== 'terminal') errors.push('WRITER_NOT_TERMINAL');
    const d = gate.decision;
    if (gate.status !== 'APPROVED' || !d || d.kind !== 'APPROVE' || d.consumed) errors.push('GATE_NOT_UNCONSUMED_APPROVAL');
    if (d && (d.gateId !== gate.id || !sameBinding(d.binding, gate.binding) || d.dataHash !== gate.dataHash ||
      d.proposedSpecHash !== gate.proposedSpecHash ||
      d.displayedRevision !== gate.displayedRevision || d.acceptedAgainstRevision !== gate.displayedRevision ||
      d.recordedAtRevision !== d.acceptedAgainstRevision + 1 || d.recordedAtRevision > q.revision)) errors.push('STALE_GATE_DECISION');
    // Later legal RECORD revisions are allowed only with the external chain
    // attestation above. Consumption never changes the caller's gate object.
    if (resume === 'PENDING') errors.push(...need('pendingSpecAccepted'));
    if (resume === 'ANALYZING') errors.push(...guard('A'));
    if (resume === 'READY') errors.push(...guard('R'));
    if (resume === 'IMPLEMENTING') errors.push(...guard('I'));
    if (resume === 'REVIEWING') errors.push(...guard('V'));
    if (resume === 'REWORK') errors.push(...guard('W'));
    if (resume === 'BLOCKED') errors.push(...need('reconciliationNeeded'), ...blockReasons());
    return errors;
  }
  function blockReasons(): string[] {
    const b = guard('B'), x = guard('X');
    return b.length && x.length ? ['NO_VALID_B_OR_X', ...b, ...x] : [];
  }

  const consumes = source === 'AWAITING_HUMAN' && (tr === 'TR-042' ? q.blockMode === 'consumeGate' : tr !== 'TR-043');
  let errors: string[];
  if (expression === 'B|X' || (expression === 'B|X|GA' && !consumes)) {
    errors = blockReasons();
  } else if (expression === 'B|X|GA') errors = guard('GA');
  else errors = expression.split('+').flatMap(part => part === 'findings' ? need('findingsAdmitted') :
    part === 'reanalysis' ? need('reanalysisNeedRecorded') : guard(part as Guard));
  // G0: these effects include a future external write/dispatch. The assertions
  // concern only the supplied model; execution still requires host revalidation.
  if (['analyze', 'implement', 'test', 'review', 'resume/analyze', 'resume/implement'].includes(effect)) {
    errors.push(...need('effectCapabilitiesVerified', 'durableIntentRecorded'));
  }
  if (errors.length) return reject(...new Set(errors));

  let invalidations: Invalidation[];
  switch (rule) {
    case 'S-if-spec': invalidations = [changed ? 'S' : 'N']; break;
    case 'G+S-if-spec': invalidations = changed ? ['G', 'S'] : ['G']; break;
    case 'G+E': invalidations = ['G', 'E']; break;
    case 'Q+G-if-consumed': invalidations = consumes ? ['Q', 'G'] : ['Q']; break;
    case 'Q+close-gate': invalidations = ['Q']; break;
    default: invalidations = [rule];
  }
  return freeze({
    admitted: true, kind: 'transition-admission-only', transition: tr, source, target,
    previousRevision: q.revision, proposedRevision: q.revision + 1, binding: copyBinding(q.binding),
    ...(q.nextSpecHash ? { nextSpecHash: q.nextSpecHash } : {}),
    consequences: {
      effects: effect.split('/') as Effect[], invalidations,
      gate: consumes ? 'consume' : tr === 'TR-043' ? 'close' : target === 'AWAITING_HUMAN' ? 'request' : 'none',
      ...(q.gate ? { gateBinding: {
        id: q.gate.id, type: q.gate.type, dataHash: q.gate.dataHash, displayedRevision: q.gate.displayedRevision,
        resumeState: q.gate.resumeState, continuation: q.gate.continuation,
        ...(q.gate.proposedSpecHash ? { proposedSpecHash: q.gate.proposedSpecHash } : {}),
      } } : {}),
      review: tr === 'TR-040' ? 'reevaluate-existing' : tr === 'TR-018' ? 'fresh-packet' : 'none',
      preserveHistory: true, beforeExternalEffects: ['verify-capabilities', 'commit-durable-intent'],
      commit: 'host-must-revalidate-and-serialize',
    },
  });
}
