import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();

const {packageGuidance}=await import('../src/package-guidance.ts');
const {proposalDraft,PRE_TASK_OUTPUT_SCHEMA}=await import('../src/pre-task-proposal.ts');
const {wizardSummary}=await import('../src/task-wizard.ts');
const {STATES,TRANSITIONS}=await import('../src/state-machine.ts');
const developer=await import('../src/controlled-developer.ts');
const reviewer=await import('../src/controlled-reviewer.ts');
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const proposal=(architectureFindings,designExpectations)=>({schemaVersion:1,phase:'PRE_TASK_PROPOSAL',proposalOnly:true,
  requestId:'quality-request',requestHash:'a'.repeat(64),relevantFiles:['src/example.ts'],proposedScope:['src/example.ts'],
  acceptanceCriteria:['The requested behavior is preserved'],existingTests:[],validations:[{kind:'REVIEW',description:'Inspect the candidate design and behavior',paths:['src/example.ts'],expectedLines:[]}],
  architectureFindings,designExpectations,ambiguities:[],risks:[],explanation:'Contextual read-only proposal'});

test('software-design-quality skill loads as bounded guidance without authority',()=>{
  const source=read('skills/software-design-quality/SKILL.md'),guidance=packageGuidance('software-design-quality');
  assert.match(source,/^---\nname: software-design-quality\n/);assert.doesNotMatch(source,/^allowed-tools:/m);
  assert.match(guidance,/smallest coherent design/);assert.match(guidance,/grants no tools, scope, workflow authority or approval/);
  assert.ok(guidance.length<32768);
});

test('repository analysis and task planning expose contextual architecture findings and design expectations',()=>{
  const repository=read('skills/repository-analysis/SKILL.md'),planning=read('skills/task-planning/SKILL.md');
  assert.match(repository,/principal modules and layers/);assert.match(repository,/adapters, repositories, services, factories/);
  assert.match(repository,/architectureFindings/);assert.match(planning,/Design expectations/);assert.match(planning,/designExpectations/);
  assert.ok(Object.hasOwn(PRE_TASK_OUTPUT_SCHEMA.properties,'architectureFindings'));
  assert.ok(Object.hasOwn(PRE_TASK_OUTPUT_SCHEMA.properties,'designExpectations'));
});

test('positive reuse fixture preserves an existing ScenarioRepository instead of proposing a second persistence path',()=>{
  const draft=proposalDraft('Add scenario lookup',proposal(
    ['ScenarioRepository already owns scenario persistence behind the current repository boundary'],
    ['Reuse and extend ScenarioRepository; do not introduce a second persistence path']));
  const summary=wizardSummary(draft);
  assert.match(summary,/Observed architecture:[\s\S]*ScenarioRepository/);
  assert.match(summary,/Planned structure:[\s\S]*Reuse and extend ScenarioRepository/);
  assert.match(summary,/do not introduce a second persistence path/);
});

test('duplication fixture favors shared responsibility while rejecting accidental similarity',()=>{
  const draft=proposalDraft('Add a second event export',proposal(
    ['Event normalization is already centralized in normalizeRuntimeEvent'],
    ['Reuse normalizeRuntimeEvent for the shared transformation; keep conceptually distinct formatting local']));
  assert.match(wizardSummary(draft),/Reuse normalizeRuntimeEvent/);
  const guidance=packageGuidance('software-design-quality');
  assert.match(guidance,/meaningful duplication of rules, transformations, validation, invariants, algorithms or data access/);
  assert.match(guidance,/two short fragments look alike when they represent different responsibilities/);
});

test('overengineering fixture keeps a simple change direct',()=>{
  const draft=proposalDraft('Add one label',proposal(
    ['The current module renders labels with a direct pure function'],
    ['Extend the existing pure function; do not add Strategy, Factory, inheritance or a new interface']));
  const summary=wizardSummary(draft),guidance=packageGuidance('software-design-quality');
  assert.match(summary,/do not add Strategy, Factory, inheritance or a new interface/);
  assert.match(guidance,/Do not turn simple functional code into classes/);
  assert.match(guidance,/speculative framework/);
});

test('complex logic fixture requests rationale, invariants and edge cases without line-by-line comments',()=>{
  const draft=proposalDraft('Harden recovery reconciliation',proposal(
    ['Recovery reconciliation is fail-closed and compares durable process identities'],
    ['Document why reconciliation is fail-closed, the identity invariant and ambiguous terminal edge cases']));
  const summary=wizardSummary(draft),guidance=packageGuidance('software-design-quality');
  assert.match(summary,/identity invariant and ambiguous terminal edge cases/);
  assert.match(guidance,/reason, assumptions, strategy, important invariants and edge cases/);
  assert.match(guidance,/never narrate every obvious line/);
});

test('guidance is language-aware, names domain concepts clearly and defers to repository conventions',()=>{
  const guidance=packageGuidance('software-design-quality');
  assert.match(guidance,/when it fits the language and problem/);
  assert.match(guidance,/Choose names that reveal domain meaning/);
  assert.match(guidance,/public project architecture, established repository conventions, task-specific design expectations/);
  assert.match(guidance,/Follow the repository's documentation conventions/);
});

test('Developer and Reviewer retain existing authority while quality review covers reuse and overengineering',()=>{
  const review=packageGuidance('controlled-review');
  assert.match(review,/reuse of existing components, avoidable duplication, naming, responsibility boundaries/);
  assert.match(review,/unnecessary abstraction, class, interface or design pattern/);
  assert.deepEqual(developer.DEVELOPER_LAUNCH_CONTRACT.capabilityConstraints.operationIds,['OP-01','OP-02']);
  assert.deepEqual(reviewer.REVIEWER_LAUNCH_CONTRACT.capabilityConstraints.operationIds,['OP-01','OP-07']);
  assert.deepEqual(STATES.length,11);assert.deepEqual(TRANSITIONS.length,43);
});

test('validation planning uses repository quality tools and never adds universal dependencies',()=>{
  const guidance=packageGuidance('validation-planning');
  assert.match(guidance,/formatter or linter configuration, type checking, compiler warnings, static or complexity analysis/);
  assert.match(guidance,/Never add a dependency or universal quality tool automatically/);
});
