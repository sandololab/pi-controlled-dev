import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { installSourceLoader } from './load-source.mjs';
import { fixtures } from './contract-fixtures.mjs';

installSourceLoader();
const { compileValidations } = await import('../src/validation-proposals.ts');
const { collectValidationEvidenceAsync, executeApprovedCommand } = await import('../src/validation-runner.ts');
const { preTaskRequest, validatePreTaskProposal } = await import('../src/pre-task-proposal.ts');
const { workspaceManifest } = await import('../src/scope-guard.ts');
const contracts = await import('../src/contracts.ts');
const { hashCanonical, hashContract, validateStructure } = contracts;
const { WorkflowValidationService } = await import('../src/workflow-validation.ts');
const { DurableStore } = await import('../src/store.ts');
const { REGRESSION_RUNNER } = await import('../src/regression-validation.ts');

const testFile = 'tests/expected.txt';
const testId = 'output-match';
const failure = 'wrong-output';
const verification = {
  kind: 'REGRESSION', description: 'Verify the public result', paths: [testFile], expectedLines: [],
  regression: { testId, expectedFailure: failure, criterion: 1 },
};
const draft = check => ({ criteria: ['The result matches the fixture'], validationPlan: [check] });
const resolve = name => name === 'node' ? process.execPath : '/usr/bin/git';

const shellRunner = `#!/bin/sh
set -eu
actual=$(cat result.txt)
expected=$(cat "$2")
if [ "$actual" = "$expected" ]; then
  printf '{"testId":"%s","outcome":"PASS"}\\n' "$1"
else
  printf '{"testId":"%s","outcome":"FAIL","failure":"wrong-output"}\\n' "$1"
fi
`;
const nodeRunner = `#!${process.execPath}
const fs = require('node:fs');
const [testId, file] = process.argv.slice(2);
const expected = fs.readFileSync(file, 'utf8');
const actual = fs.readFileSync('result.txt', 'utf8');
console.log(JSON.stringify(actual === expected
  ? {testId, outcome: 'PASS'}
  : {testId, outcome: 'FAIL', failure: 'wrong-output'}));
`;

function setup(t, runner, { baseValue = 'before', candidateValue = 'after' } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'generic-regression-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'candidate'), data = join(parent, 'data');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'tests'));
  mkdirSync(data);
  writeFileSync(join(root, REGRESSION_RUNNER), runner, { mode: 0o700 });
  writeFileSync(join(root, 'result.txt'), baseValue);
  const git = (...args) => execFileSync('/usr/bin/git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Baseline');
  const baseCommit = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'result.txt'), candidateValue);
  writeFileSync(join(root, testFile), 'after');
  return {
    root, git, baseCommit,
    store: DurableStore.create(data, root, 'regression-task', () => 'ACCEPT'),
  };
}

async function observe(fixture, check = verification) {
  const { root, baseCommit, store } = fixture;
  const command = compileValidations(draft(check), resolve)[1];
  assert.equal(validateStructure('CommandSpec', command).ok, true);
  const digest = hashCanonical(workspaceManifest(root, baseCommit));
  const result = await collectValidationEvidenceAsync(command, store, {
    taskId: 'regression-task', specHash: 'a'.repeat(64), regressionBaseline: baseCommit,
    candidate: { root, baseCommit, digest, generation: 1 }, criteria: [], createdAt: new Date().toISOString(),
  });
  const log = JSON.parse(Buffer.from(store.read(result.artifacts.find(ref => ref.id === result.result.logRef))).toString());
  return { ...result, log };
}

for (const [label, adapter] of [['shell', shellRunner], ['Node', nodeRunner]]) {
  test(`same approved inputs prove the fix with a ${label} adapter`, async t => {
    const fixture = setup(t, adapter);
    const { result, log } = await observe(fixture);
    assert.equal(result.status, 'PASSED', log.stderr);
    assert.match(result.reason, new RegExp(fixture.baseCommit + ' EXPECTED_FAILURE'));
    assert.match(result.reason, /candidate PASS/);
    assert.equal(result.candidateDigest, result.postCandidateDigest);
    assert.equal(fixture.git('show', 'HEAD:result.txt'), 'before');
    assert.equal(readFileSync(join(fixture.root, testFile), 'utf8'), 'after');
  });
}

test('the same executable test inputs are available in both copies', async t => {
  const fixture = setup(t, shellRunner.replace('set -eu', 'set -eu\n[ -x "$2" ]'));
  chmodSync(join(fixture.root, testFile), 0o700);
  const { result } = await observe(fixture);
  assert.equal(result.status, 'PASSED', result.reason);
});

test('a passing baseline or unrelated runner failure never counts as reproduction', async t => {
  const passing = await observe(setup(t, shellRunner, { baseValue: 'after' }));
  assert.equal(passing.result.status, 'INVALID');
  assert.match(passing.result.reason, /baseline .* PASS/);
  const unrelated = await observe(setup(t, shellRunner), {
    ...verification, regression: { ...verification.regression, expectedFailure: 'different-defect' },
  });
  assert.equal(unrelated.result.status, 'INVALID');
  assert.match(unrelated.result.reason, /baseline .* INCONCLUSIVE/);
  const processFailure = await observe(setup(t, '#!/bin/sh\nexit 3\n'));
  assert.equal(processFailure.result.status, 'INVALID');
  assert.match(processFailure.result.reason, /candidate INCONCLUSIVE/);
});

test('the adapter must come unchanged from the baseline', async t => {
  const fixture = setup(t, shellRunner);
  writeFileSync(join(fixture.root, REGRESSION_RUNNER), nodeRunner);
  const { result, log } = await observe(fixture);
  assert.equal(result.status, 'INVALID');
  assert.match(log.stderr, /Regression runner changed/);
});

test('Scout may pair scoped files and an observed executable runner with a real criterion', t => {
  const { root } = setup(t, shellRunner);
  const request = preTaskRequest(root, 'Fix the result');
  const proposal = {
    schemaVersion: 1, phase: 'PRE_TASK_PROPOSAL', proposalOnly: true,
    requestId: request.requestId, requestHash: hashCanonical(request),
    relevantFiles: [REGRESSION_RUNNER], proposedScope: ['result.txt', testFile],
    acceptanceCriteria: ['The output is correct'], existingTests: [], validations: [verification],
    architectureFindings: [], designExpectations: [], ambiguities: [], risks: [], explanation: 'Use the existing runner.',
  };
  assert.doesNotThrow(() => validatePreTaskProposal(proposal, request));
  for (const invalid of [
    { ...proposal, relevantFiles: [] },
    { ...proposal, proposedScope: [...proposal.proposedScope, REGRESSION_RUNNER] },
    { ...proposal, validations: [{ ...verification, paths: ['result.txt'] }] },
    { ...proposal, validations: [{ ...verification, regression: { ...verification.regression, criterion: 2 } }] },
  ]) assert.throws(() => validatePreTaskProposal(invalid, request), /PRE_TASK_PROPOSAL_INVALID/);
});

test('promotion rechecks the candidate only and does not supply fresh baseline proof', t => {
  const { root } = setup(t, shellRunner, { baseValue: 'after' });
  const validationCommands = compileValidations(draft(verification), resolve);
  const fixture = fixtures(contracts);
  const spec = { ...fixture.TaskSpec, validationCommands,
    acceptanceCriteria: [{ ...fixture.Criterion, commandIds: [validationCommands[1].id] }] };
  spec.specHash = hashContract('TaskSpec', spec);
  const { child } = executeApprovedCommand(spec, validationCommands[1].id, root);
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /"base":"recheck".*"before":"NOT_RUN","after":"PASS"/);
});

test('workflow verification uses its original baseline even when the candidate base has advanced', async t => {
  const { root, git, baseCommit, store } = setup(t, shellRunner);
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Candidate generation');
  const candidateBase = git('rev-parse', 'HEAD');
  const fixture = fixtures(contracts);
  const commands = compileValidations(draft(verification), resolve);
  const spec = { ...fixture.TaskSpec, taskId: 'regression-task', validationCommands: commands,
    acceptanceCriteria: [{ ...fixture.Criterion, commandIds: [commands[1].id] }] };
  spec.specHash = hashContract('TaskSpec', spec);
  const specRef = store.writeSpec(spec);
  const digest = hashCanonical(workspaceManifest(root, candidateBase));
  const state = { ...fixture.WorkflowState, state: 'TESTING', taskId: spec.taskId,
    specHash: spec.specHash, spec: specRef, baselineCommit: baseCommit, runs: [],
    candidate: { ...fixture.Candidate, root, baseCommit: candidateBase, digest, generation: 2 } };
  const { results } = await new WorkflowValidationService().run(spec, state, store);
  assert.deepEqual(results.map(result => result.status), ['PASSED', 'PASSED']);
  assert.match(results[1].reason, new RegExp(baseCommit + ' EXPECTED_FAILURE'));
  assert.equal(results[1].candidateDigest, digest);
  assert.equal(results[1].candidateGeneration, 2);
});
