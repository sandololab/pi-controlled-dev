import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('src/state-machine.ts');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
});
const core = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const { STATES, TRANSITIONS, COMPLETION_CONDITIONS, evaluateTransition: evaluate } = core;
const states = ['PENDING', 'ANALYZING', 'READY', 'IMPLEMENTING', 'TESTING', 'REVIEWING',
  'REWORK', 'BLOCKED', 'AWAITING_HUMAN', 'COMPLETED', 'FAILED'];

// Independent oracle: the unchanged normative STM-003, NOT the production table.
const guardNames = {
  'B or X': 'B|X', 'I and admitted findings': 'I+findings',
  'A and recorded reanalysis need': 'A+reanalysis', 'U and A': 'U+A', 'U and W': 'U+W',
  'GA and resumeState=PENDING': 'GA', 'GA and resumeState=ANALYZING and A': 'GA+A',
  'GA and resumeState=READY and R': 'GA+R', 'GA and resumeState=IMPLEMENTING and I': 'GA+I',
  'GA and resumeState=REVIEWING and V': 'GA+V', 'GA and resumeState=REWORK and W': 'GA+W',
  'B or X, or GA with resumeState=BLOCKED': 'B|X|GA',
};
const invalidationNames = {
  'S if new spec, otherwise N': 'S-if-spec', 'G, S if new spec': 'G+S-if-spec',
  'Q; G if consumed': 'Q+G-if-consumed', 'Q; close gate': 'Q+close-gate',
};
const rows = read('docs/PROTOCOL.md').split('\n').filter(line => /^\| TR-\d{3} \|/.test(line))
  .map(line => line.split('|').slice(1, -1).map(s => s.trim()))
  .map(([id, from, to, guard, effect, invalidation]) =>
    [id, from, to, guardNames[guard] ?? guard, effect, invalidationNames[invalidation] ?? invalidation]);
assert.equal(rows.length, 43);

// These obligation lists are a test-side reading of STM-002, independent of
// implementation metadata. Fixtures attest only the obligations used by a TR.
const obligations = {
  G0: ['stateSchemaValid', 'taskLockHeld', 'identityConflictAbsent', 'hostAuthorityVerified', 'workspaceLockHeld'],
  A: ['inputSnapshotsAndHashesAvailable', 'dispatchBudgetRemaining', 'scoutAssignmentControlled'],
  R: ['scoutResultValid', 'ambiguitiesResolvedWithRecordedDecisions', 'criteriaIdsAndMethodsVerifiable',
    'requiredCommandsNonempty', 'specAndScopeFrozen', 'gitMutationPreconditionsVerified', 'mutationCapabilitiesVerified'],
  I: ['implementationGateSatisfiedIfRequired', 'writerTerminalProven', 'sourceIntegrityVerified',
    'developerBudgetRemaining', 'assignmentNewScopedFresh'],
  T: ['developerResultValidAttributedUnblocked', 'writerTerminalProven', 'handoffCompleteDurable',
    'baseExact', 'patchValidated', 'candidateMaterializedAfterWriterInImplementing', 'scopeChecked', 'candidateDigestAcquired'],
  V: ['candidateMaterializedInScope', 'requiredValidationHostPassedCurrent',
    'noMutationOrUnknownIdentity', 'reviewerIndependentFreshReadonlyVerified'],
  W: ['defectConcreteAttributed', 'findingAcceptedInScope', 'failureEvidenceAvailable', 'writerTerminalProven', 'nextAttemptNotConsumed'],
  B: ['technicalOrInformationReason', 'missingOrConflictingEvidenceIdentified'],
  H: ['gateRequestTyped', 'gateTargetAndDataFrozen', 'writerTerminalProven'],
  F: ['allRunsStoppedAndReconciled', 'unrecoverableViolation'],
  U: ['blockResolvedWithNewEvidence', 'repositoryAndProcessesKnown'],
  X: ['recoveryInconsistencyDetected', 'lastTrustedStateNonterminal', 'conflictingEvidencePreserved'],
  GA: ['humanOriginAndConfirmationVerified', 'decisionValid', 'gateNotSuperseded', 'sessionOwnershipReconciled', 'legalDecisionRevisionChain'],
};
const cmpIds = Array.from({ length: 18 }, (_, i) => `CMP-${String(i + 1).padStart(2, '0')}`);
const h = char => char.repeat(64);
const binding = () => ({ taskId: 'task-1', specHash: h('a'), candidate: { digest: h('b'), generation: 2 } });
const continuation = { PENDING: 'PREPARE', ANALYZING: 'ANALYZE', READY: 'PREPARE',
  IMPLEMENTING: 'IMPLEMENT', REVIEWING: 'REVIEW_FINAL', REWORK: 'REWORK', BLOCKED: 'RECONCILE' };
function attest(q, ...names) {
  for (const name of names) q.evidence.facts[name] = true;
}
function addGuard(q, name) {
  if (name === 'C') q.evidence.completion = Object.fromEntries(cmpIds.map(id => [id, true]));
  else attest(q, ...obligations[name]);
  if (name === 'I') addGuard(q, 'R');
}
function gate(q, target = 'READY', type, approval = false) {
  type ??= target === 'REVIEWING' ? 'beforeCompletion' : ['REWORK', 'BLOCKED'].includes(target) ? 'onOracleDecision' : 'beforeImplementation';
  q.gate = { id: 'gate-1', type, status: approval ? 'APPROVED' : 'PENDING', resumeState: target,
    continuation: continuation[target], binding: binding(), dataHash: h('c'), displayedRevision: approval ? 8 : 11 };
  attest(q, 'gateTargetAndDataFrozen');
  if (type === 'beforeImplementation') {
    if (['PENDING', 'ANALYZING'].includes(target)) attest(q, 'inputStillNeedsAnalysis');
    if (target === 'IMPLEMENTING') { attest(q, 'suspendedQuiescentPoint'); addGuard(q, 'I'); }
  }
  if (type === 'onScopeChange') {
    attest(q, 'scopeChangeProposed'); q.gate.proposedSpecHash = h('d');
    if (approval) { q.nextSpecHash = h('d'); attest(q, 'specChangeAuthorized'); }
  }
  if (type === 'onOracleDecision') {
    attest(q, 'oracleMaterialAdvice');
    attest(q, target === 'ANALYZING' ? 'oracleSpecOrCriteriaChange' : target === 'REWORK' ? 'oracleFixInScope' : 'reconciliationNeeded');
  }
  if (type === 'beforeCompletion') { attest(q, 'finalReviewTestsRiskPatchValid'); addGuard(q, 'V'); }
  if (type === 'beforeReviewerRedispatch') { attest(q, 'reviewerInfrastructureRetryCurrent'); addGuard(q, 'V'); }
  if (type === 'onRetryExhausted') attest(q, 'finiteExhaustionActionWithoutBudgetIncrease');
  if (approval) {
    addGuard(q, 'GA');
    const targetGuard = { ANALYZING: 'A', READY: 'R', IMPLEMENTING: 'I', REVIEWING: 'V', REWORK: 'W' }[target];
    if (targetGuard) addGuard(q, targetGuard);
    if (target === 'PENDING') attest(q, 'pendingSpecAccepted');
    if (target === 'BLOCKED') { attest(q, 'reconciliationNeeded'); addGuard(q, 'B'); }
    q.gate.decision = { kind: 'APPROVE', gateId: q.gate.id, binding: binding(), dataHash: h('c'),
      displayedRevision: 8, acceptedAgainstRevision: 8, recordedAtRevision: 9, consumed: false,
      ...(q.gate.proposedSpecHash ? { proposedSpecHash: q.gate.proposedSpecHash } : {}) };
  }
}
function fixture(row, branch = 'B', gateType) {
  if (typeof row === 'string') row = rows.find(r => r[0] === row);
  const [transition, state, target, guards, effect] = row;
  const q = { state, revision: 10, expectedRevision: 10, transition, binding: binding(),
    evidence: { revision: 10, binding: binding(), facts: {} },
    authority: { role: 'Orchestrator', origin: 'host', taskId: 'task-1' },
    workspaceMutable: true, mutationRequired: true, writer: 'terminal' };
  addGuard(q, 'G0');
  for (const g of (guards.includes('|') ? branch : guards).split('+')) {
    if (g === 'findings') attest(q, 'findingsAdmitted');
    else if (g === 'reanalysis') attest(q, 'reanalysisNeedRecorded');
    else addGuard(q, g);
  }
  if (['analyze', 'implement', 'test', 'review', 'resume/analyze', 'resume/implement'].includes(effect)) attest(q, 'effectCapabilitiesVerified', 'durableIntentRecorded');
  if (guards === 'H') gate(q, 'READY', gateType);
  if (state === 'AWAITING_HUMAN') {
    gate(q, target === 'FAILED' || (transition === 'TR-042' && branch !== 'GA') ? 'READY' : target, gateType,
      transition !== 'TR-043' && (transition !== 'TR-042' || branch === 'GA'));
    // Diagnostic B/X and F do not reuse a frozen approval as authority.
    if (transition === 'TR-043' || (transition === 'TR-042' && branch !== 'GA')) delete q.evidence.facts.gateTargetAndDataFrozen;
  }
  if (transition === 'TR-042') q.blockMode = branch === 'GA' ? 'consumeGate' : 'diagnostic';
  return q;
}
const yes = q => { const result = evaluate(q); assert.equal(result.admitted, true, JSON.stringify(result)); return result; };
const no = (q, reason) => {
  const result = evaluate(q); assert.equal(result.admitted, false, JSON.stringify(result));
  assert.ok(result.reasons.length);
  if (reason) assert.ok(result.reasons.includes(reason), JSON.stringify(result));
  assert.equal(result.target, undefined); return result;
};
const clone = value => structuredClone(value);
function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
function allFrozen(value) {
  if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(allFrozen); }
}

test('P3-TEST-001 — 11 states and 43 normative transition rows', () => {
  assert.deepEqual(STATES, states);
  assert.deepEqual(TRANSITIONS, rows);
  assert.equal(new Set(TRANSITIONS.map(r => r[0])).size, 43);
  assert.deepEqual(rows.map(r => r[0]), Array.from({ length: 43 }, (_, i) => `TR-${String(i + 1).padStart(3, '0')}`));
  allFrozen(STATES); allFrozen(TRANSITIONS); allFrozen(COMPLETION_CONDITIONS);
});

test('P3-TEST-002 — all 121 state pairs, including every illegal pair', t => {
  let allowed = 0, denied = 0;
  for (const from of states) for (const to of states) {
    const row = rows.find(r => r[1] === from && r[2] === to);
    if (row) { assert.equal(yes(fixture(row)).target, to); allowed++; }
    else {
      // Attempt EVERY TR targeting the requested state under the wrong source.
      // No direct-target API is available as a fallback.
      for (const candidate of rows.filter(r => r[2] === to)) {
        const q = fixture(candidate); q.state = from; no(q);
      }
      const q = fixture('TR-001'); q.state = from; q.target = to; no(q, 'INVALID_INPUT');
      denied++;
    }
  }
  assert.equal(allowed, 43); assert.equal(denied, 78);
  t.diagnostic(`${allowed} allowed + ${denied} denied = 121 pairs`);
});

test('P3-TEST-003 — each TR and every required fact; AND/OR and extra guards', t => {
  let positives = 0, negatives = 0;
  for (const row of rows) for (const branch of row[3].includes('|') ? row[3].split('|') : ['B']) {
    const q = fixture(row, branch); yes(q); positives++;
    for (const key of Object.keys(q.evidence.facts)) for (const value of [false, 'unknown', undefined, 'contradictory']) {
      const bad = clone(q);
      if (value === undefined) delete bad.evidence.facts[key]; else bad.evidence.facts[key] = value;
      no(bad); negatives++;
    }
    if (row[3].includes('B|X')) {
      const either = fixture(row, 'B'); addGuard(either, 'X');
      for (const key of obligations.B) either.evidence.facts[key] = false;
      yes(either);
      for (const key of obligations.X) either.evidence.facts[key] = false;
      no(either);
    }
  }
  // F is its own OR: one cause suffices, none does not.
  for (const row of rows.filter(r => r[3] === 'F')) {
    for (const cause of ['definitiveHumanRejection', 'unrecoverableViolation', 'budgetExhaustedWithoutResolution']) {
      const q = fixture(row); delete q.evidence.facts.unrecoverableViolation;
      attest(q, cause); yes(q); positives++;
      for (const value of [false, 'unknown', undefined, 'contradictory']) {
        const bad = clone(q);
        if (value === undefined) delete bad.evidence.facts[cause]; else bad.evidence.facts[cause] = value;
        no(bad); negatives++;
      }
    }
  }
  // Conditional spec-change authorization, and every gate-type condition.
  const variants = [];
  const specChange = fixture('TR-032'); specChange.nextSpecHash = h('d'); attest(specChange, 'specChangeAuthorized'); variants.push(specChange);
  const gateCases = {
    beforeImplementation: ['PENDING', 'ANALYZING', 'READY', 'IMPLEMENTING'],
    onScopeChange: ['ANALYZING'], onOracleDecision: ['ANALYZING', 'REWORK', 'BLOCKED'],
    beforeCompletion: ['REVIEWING'], onRetryExhausted: ['ANALYZING', 'REWORK', 'BLOCKED'],
  };
  for (const [type, targets] of Object.entries(gateCases)) for (const target of targets) {
    const request = fixture('TR-002'); gate(request, target, type); variants.push(request);
    const row = rows.find(r => r[1] === 'AWAITING_HUMAN' && r[2] === target);
    variants.push(fixture(row, target === 'BLOCKED' ? 'GA' : 'B', type));
  }
  for (const q of variants) {
    yes(q); positives++;
    for (const key of Object.keys(q.evidence.facts)) for (const value of [false, 'unknown', undefined, 'contradictory']) {
      const bad = clone(q);
      if (value === undefined) delete bad.evidence.facts[key]; else bad.evidence.facts[key] = value;
      no(bad); negatives++;
    }
  }
  const nonmutating = fixture('TR-005'); nonmutating.mutationRequired = false;
  delete nonmutating.evidence.facts.gitMutationPreconditionsVerified;
  delete nonmutating.evidence.facts.mutationCapabilitiesVerified; yes(nonmutating);
  t.diagnostic(`${positives} positive TR/branch fixtures; ${negatives} individual false/unknown/missing/contradictory fact cases`);
});

test('P3-TEST-004 — G0 and closed runtime input boundary', () => {
  for (const role of ['Scout', 'Developer', 'Reviewer', 'Oracle', 'Human']) {
    const q = fixture('TR-001'); q.authority.role = role; no(q, 'AUTHORITY_DENIED');
  }
  for (const origin of ['child', 'human']) {
    const q = fixture('TR-001'); q.authority.origin = origin; no(q, 'AUTHORITY_DENIED');
  }
  const foreign = fixture('TR-001'); foreign.authority.taskId = 'foreign'; no(foreign, 'AUTHORITY_DENIED');
  for (const key of obligations.G0) { const q = fixture('TR-001'); q.evidence.facts[key] = false; no(q); }
  const readOnly = fixture('TR-001'); readOnly.workspaceMutable = false;
  delete readOnly.evidence.facts.workspaceLockHeld; yes(readOnly);
  for (const value of [null, [], 'Orchestrator', true, {}, () => true]) no(value, 'INVALID_INPUT');
  for (const key of Object.keys(fixture('TR-001'))) {
    const q = fixture('TR-001'); delete q[key]; no(q, 'INVALID_INPUT');
  }
  for (const path of [[], ['authority'], ['binding'], ['binding', 'candidate'], ['evidence'], ['evidence', 'facts']]) {
    const q = fixture('TR-001'); let obj = q;
    for (const key of path) obj = obj[key];
    obj.guardPassed = true; no(q, 'INVALID_INPUT');
  }
  for (const value of ['true', 1, null, {}, [], () => true]) {
    const q = fixture('TR-001'); q.evidence.facts.stateSchemaValid = value; no(q, 'INVALID_INPUT');
  }
  const getter = fixture('TR-001'); Object.defineProperty(getter, 'state', { get() { throw Error('must not execute'); }, enumerable: true });
  no(getter, 'INVALID_INPUT');
  const inherited = Object.create(fixture('TR-001')); no(inherited, 'INVALID_INPUT');
  const symbol = fixture('TR-001'); symbol[Symbol('authority')] = true; no(symbol, 'INVALID_INPUT');
});

test('P3-TEST-005 — revisions and overflow', () => {
  for (const key of ['revision', 'expectedRevision']) for (const value of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '10']) {
    const q = fixture('TR-001'); q[key] = value; no(q, 'INVALID_INPUT');
  }
  const mismatch = fixture('TR-001'); mismatch.expectedRevision++; no(mismatch, 'REVISION_MISMATCH');
  for (const revision of [0, 17, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]) {
    const q = fixture('TR-001'); q.revision = q.expectedRevision = q.evidence.revision = revision;
    if (revision === Number.MAX_SAFE_INTEGER) no(q, 'REVISION_OVERFLOW');
    else assert.equal(yes(q).proposedRevision, revision + 1);
  }
});

test('P3-TEST-006 — determinism, deep immutability, no shared decisions', () => {
  for (const row of rows) {
    const q = deepFreeze(fixture(row)); const snapshot = clone(q);
    const a = yes(q), b = yes(q); assert.deepEqual(a, b); assert.notEqual(a, b);
    allFrozen(a); assert.deepEqual(q, snapshot);
    const bad = clone(q); bad.expectedRevision = 9; deepFreeze(bad);
    const badSnapshot = clone(bad); const denied = no(bad); allFrozen(denied);
    assert.deepEqual(bad, badSnapshot); assert.deepEqual(yes(q), a);
    assert.throws(() => { a.binding.candidate.generation = 999; }, TypeError);
    const mutable = fixture(row); const previous = yes(mutable);
    mutable.binding.candidate.generation++; assert.equal(previous.binding.candidate.generation, 2);
  }
});

test('P3-TEST-007 — descriptors only, all invalidations and conditional branches', () => {
  for (const row of rows) {
    const q = fixture(row), d = yes(q);
    assert.deepEqual(d.consequences.effects, row[4].split('/'));
    const expected = { 'S-if-spec': ['N'], 'G+S-if-spec': ['G'], 'Q+G-if-consumed': ['Q'], 'Q+close-gate': ['Q'] }[row[5]] ?? row[5].split('+');
    assert.deepEqual(d.consequences.invalidations, expected);
    assert.equal(d.consequences.preserveHistory, true);
    assert.equal(d.consequences.commit, 'host-must-revalidate-and-serialize');
    assert.deepEqual(d.consequences.beforeExternalEffects, ['verify-capabilities', 'commit-durable-intent']);
    assert.equal(d.kind, 'transition-admission-only'); assert.equal(d.stateAfter, undefined);
  }
  const changed = fixture('TR-032'); changed.nextSpecHash = h('d'); attest(changed, 'specChangeAuthorized');
  assert.deepEqual(yes(changed).consequences.invalidations, ['S']);
  const resumed = fixture('TR-037'); gate(resumed, 'ANALYZING', 'onScopeChange', true);
  assert.deepEqual(yes(resumed).consequences.invalidations, ['G', 'S']);
  for (const tr of ['TR-039', 'TR-041']) assert.deepEqual(yes(fixture(tr)).consequences.invalidations, ['G', 'E']);
  const consumed = yes(fixture('TR-042', 'GA'));
  assert.deepEqual(consumed.consequences.invalidations, ['Q', 'G']); assert.equal(consumed.consequences.gate, 'consume');
  assert.equal(yes(fixture('TR-042')).consequences.gate, 'none');
  const resumeWithX = fixture('TR-042', 'GA');
  for (const key of obligations.B) delete resumeWithX.evidence.facts[key];
  no(resumeWithX, 'NO_VALID_B_OR_X');
  addGuard(resumeWithX, 'X');
  assert.deepEqual(yes(resumeWithX).consequences.invalidations, ['Q', 'G']);
  assert.equal(yes(fixture('TR-043')).consequences.gate, 'close');
  const wrong = fixture('TR-005'); wrong.nextSpecHash = h('d'); no(wrong, 'SPEC_CHANGE_NOT_ALLOWED');
});

test('P3-TEST-008 — gate types, targets, continuations, binding and consumption', () => {
  const targets = { beforeImplementation: ['PENDING', 'ANALYZING', 'READY', 'IMPLEMENTING'],
    onScopeChange: ['ANALYZING'], onOracleDecision: ['ANALYZING', 'REWORK', 'BLOCKED'],
    beforeCompletion: ['REVIEWING'], onRetryExhausted: ['ANALYZING', 'REWORK', 'BLOCKED'], beforeReviewerRedispatch:['REVIEWING'] };
  for (const [type, allowed] of Object.entries(targets)) for (const target of states) {
    const q = fixture(type === 'beforeReviewerRedispatch' ? 'TR-034' : 'TR-002'); gate(q, target, type);
    if (allowed.includes(target)) {
      yes(q);
      for (const value of Object.values(continuation).filter(c => c !== continuation[target])) {
        const bad = clone(q); bad.gate.continuation = value; no(bad);
      }
    } else no(q);
  }
  const final = fixture('TR-040'); const d = yes(final);
  assert.equal(d.target, 'REVIEWING'); assert.equal(d.consequences.review, 'reevaluate-existing');
  assert.equal(yes(fixture('TR-018')).consequences.review, 'fresh-packet');
  for(const transition of ['TR-002','TR-007','TR-010','TR-025','TR-030']){
    const wrongSource=fixture(transition);gate(wrongSource,'REVIEWING','beforeReviewerRedispatch');
    no(wrongSource,'REVIEWER_REDISPATCH_REQUIRES_BLOCKED');
  }
  const redispatch=fixture('TR-040');gate(redispatch,'REVIEWING','beforeReviewerRedispatch',true);yes(redispatch);
  delete redispatch.evidence.facts.reviewerInfrastructureRetryCurrent;no(redispatch,'UNSATISFIED:reviewerInfrastructureRetryCurrent');
  const scope = fixture('TR-037'); gate(scope, 'ANALYZING', 'onScopeChange', true); yes(scope);
  const changedProposal = clone(scope);
  changedProposal.nextSpecHash = changedProposal.gate.proposedSpecHash = h('e');
  no(changedProposal, 'STALE_GATE_DECISION');
  scope.gate.resumeState = 'READY'; scope.gate.continuation = 'PREPARE'; no(scope);
  for (const kind of ['ANSWER', 'REJECT']) { const q = clone(final); q.gate.decision.kind = kind; no(q); }
  for (const status of ['PENDING', 'CONSUMED', 'REJECTED', 'INVALIDATED']) { const q = clone(final); q.gate.status = status; no(q); }
  const consumed = clone(final); consumed.gate.decision.consumed = true; no(consumed);
  for (const location of ['binding', 'decision']) for (const key of ['specHash', 'digest', 'generation', 'taskId']) {
    const q = clone(final); const b = location === 'binding' ? q.gate.binding : q.gate.decision.binding;
    if (key === 'digest') b.candidate.digest = h('e');
    else if (key === 'generation') b.candidate.generation++;
    else b[key] = key === 'specHash' ? h('e') : 'other-task';
    no(q);
  }
  const data = clone(final); data.gate.dataHash = h('e'); no(data);
  assert.equal(d.consequences.gateBinding.dataHash, final.gate.dataHash);
  for (const path of [['gate'], ['gate', 'decision']]) {
    const original = clone(final); let obj = original;
    for (const key of path) obj = obj[key];
    for (const key of Object.keys(obj)) {
      const bad = clone(final); let nested = bad;
      for (const part of path) nested = nested[part];
      delete nested[key]; no(bad);
    }
  }
  const target = clone(final); target.gate.resumeState = 'READY'; no(target);
  for (const tr of ['TR-036', 'TR-037', 'TR-038', 'TR-039', 'TR-040', 'TR-041', 'TR-042']) {
    const q = fixture(tr, tr === 'TR-042' ? 'GA' : 'B');
    const required = { 'TR-036': 'pendingSpecAccepted', 'TR-037': 'scoutAssignmentControlled', 'TR-038': 'scoutResultValid',
      'TR-039': 'assignmentNewScopedFresh', 'TR-040': 'requiredValidationHostPassedCurrent',
      'TR-041': 'findingAcceptedInScope', 'TR-042': 'reconciliationNeeded' }[tr];
    delete q.evidence.facts[required]; no(q);
  }
});

test('P3-TEST-009 — display/CAS/decision RECORD/consumption revision separation', () => {
  const q = fixture('TR-040'); yes(q); // displayed 8, accepted against 8, recorded 9, evaluated 10
  q.revision = q.expectedRevision = q.evidence.revision = 20; yes(q);
  q.evidence.facts.legalDecisionRevisionChain = 'unknown'; no(q);
  for (const key of ['displayedRevision', 'acceptedAgainstRevision', 'recordedAtRevision']) {
    const bad = fixture('TR-040'); bad.gate.decision[key]++; no(bad);
  }
  const stale = fixture('TR-040'); stale.gate.displayedRevision++; no(stale);
  const beforeRecord = fixture('TR-040'); beforeRecord.revision = beforeRecord.expectedRevision = beforeRecord.evidence.revision = 8; no(beforeRecord);
  const edited = fixture('TR-040'); edited.gate.decision.dataHash = h('d'); no(edited);
  const repeated = fixture('TR-040'); const result = yes(repeated);
  repeated.revision = repeated.expectedRevision = repeated.evidence.revision = result.proposedRevision;
  repeated.gate.decision.consumed = true; no(repeated);
});

test('P3-TEST-010 — all 18 completion propositions independently necessary', t => {
  assert.deepEqual(Object.keys(COMPLETION_CONDITIONS), cmpIds);
  yes(fixture('TR-022'));
  let denied = 0;
  for (const key of cmpIds) for (const value of [false, 'unknown', undefined, 'contradictory']) {
    const q = fixture('TR-022');
    if (value === undefined) delete q.evidence.completion[key]; else q.evidence.completion[key] = value;
    no(q, `UNSATISFIED:${key}`); denied++;
  }
  for (const state of states.filter(s => s !== 'REVIEWING')) {
    const q = fixture('TR-022'); q.state = state; no(q);
  }
  const absent = fixture('TR-022'); delete absent.evidence.completion; no(absent);
  const contradictory = fixture('TR-022'); contradictory.evidence.facts.requiredValidationHostPassedCurrent = false; no(contradictory);
  t.diagnostic(`18 propositions; ${denied} individual negative variants; 10 wrong source states`);
});

test('P3-TEST-011 — reports, PASS, human approval and target setters cannot complete', () => {
  for (const report of [{ developerReport: 'all tests passed' }, { ok: true }, { exitCode: 0 }, { reviewVerdict: 'PASS' }, { humanApproved: true }]) {
    const q = fixture('TR-022'); delete q.evidence.completion;
    Object.assign(q.evidence, report); no(q, 'INVALID_INPUT');
    delete q.evidence[Object.keys(report)[0]]; no(q);
  }
  const developer = fixture('TR-018'); delete developer.evidence.facts.requiredValidationHostPassedCurrent;
  no(developer, 'UNSATISFIED:requiredValidationHostPassedCurrent');
  const direct = fixture('TR-022'); direct.target = 'COMPLETED'; no(direct, 'INVALID_INPUT');
});

test('P3-TEST-012 — no CREATE, RECORD, state patch, implicit block or terminal mutation', () => {
  for (const transition of ['CREATE', 'RECORD', 'TR-000', 'TR-044', 'BLOCKED']) {
    const q = fixture('TR-001'); q.transition = transition; no(q, 'UNKNOWN_TRANSITION');
  }
  for (const key of ['patch', 'stateAfter', 'recordType']) { const q = fixture('TR-001'); q[key] = { state: 'COMPLETED' }; no(q); }
  for (const state of ['COMPLETED', 'FAILED', 'BLOCKED']) for (const row of rows.filter(r => r[2] === state)) {
    const q = fixture(row); q.state = state; no(q);
  }
  const pending = fixture('TR-004'); delete pending.evidence.facts.recoveryInconsistencyDetected; addGuard(pending, 'B'); no(pending);
  const ready = fixture('TR-012'); delete ready.evidence.facts.recoveryInconsistencyDetected; addGuard(ready, 'B'); no(ready);
});

test('P3-TEST-013 — writer, handoff, bindings, capabilities and bounded admission', () => {
  for (const tr of ['TR-009', 'TR-013', 'TR-018', 'TR-022', 'TR-025', 'TR-039', 'TR-040']) for (const writer of ['active', 'unknown']) {
    const q = fixture(tr); q.writer = writer; no(q, 'WRITER_NOT_TERMINAL');
  }
  for (const [tr, key] of [['TR-013', 'handoffCompleteDurable'], ['TR-009', 'mutationCapabilitiesVerified'],
    ['TR-001', 'dispatchBudgetRemaining'], ['TR-027', 'developerBudgetRemaining'], ['TR-018', 'effectCapabilitiesVerified']]) {
    const q = fixture(tr); q.evidence.facts[key] = false; no(q, `UNSATISFIED:${key}`);
  }
  for (const row of rows) for (const part of ['spec', 'digest', 'generation', 'revision', 'task']) {
    const q = fixture(row);
    if (part === 'spec') q.evidence.binding.specHash = h('e');
    if (part === 'digest') q.evidence.binding.candidate.digest = h('e');
    if (part === 'generation') q.evidence.binding.candidate.generation++;
    if (part === 'revision') q.evidence.revision++;
    if (part === 'task') q.evidence.binding.taskId = 'other';
    no(q, 'STALE_EVIDENCE');
  }
  // W can enter REWORK with budget exhausted; I cannot launch from it.
  const rework = fixture('TR-019'); rework.evidence.facts.developerBudgetRemaining = false; yes(rework);
  const implementation = fixture('TR-027'); implementation.evidence.facts.developerBudgetRemaining = false; no(implementation);
});

test('P3-TEST-014 — import safety and untouched integration boundaries', () => {
  // AST check: no imports or dynamic/process/timer/clock/network capabilities.
  const tree = ts.createSourceFile('state-machine.ts', source, ts.ScriptTarget.Latest, true);
  const forbidden = new Set(['process', 'globalThis', 'global', 'require', 'eval', 'Function', 'Date',
    'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'fetch', 'WebSocket', 'random']);
  function visit(node) {
    assert.ok(!ts.isImportDeclaration(node) && !ts.isImportEqualsDeclaration(node));
    assert.ok(node.kind !== ts.SyntaxKind.ImportKeyword);
    if (ts.isIdentifier(node)) assert.ok(!forbidden.has(node.text), node.text);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval',
    `await import(${JSON.stringify('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))});`],
  { encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  // The pure reducer stays frozen; metadata and ScopeGuard have their own
  // behavioral and distribution suites and may evolve independently.
  const excluded = {
    'tsconfig.json': '6828823d22b14122f1c6202e9116b5018d8898c4a2ea84a98f280f591563a598',
    'src/state-machine.ts': '10dfff8cbd0d7a2891b242987ade85bd3564bc609d16c4c2d41586b88a51b5e2',
  };
  for (const [path, hash] of Object.entries(excluded)) assert.equal(createHash('sha256').update(read(path)).digest('hex'), hash, path);
});
