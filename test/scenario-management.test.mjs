import assert from 'node:assert/strict';
import test from 'node:test';
import {installSourceLoader} from './load-source.mjs';
import {fixtures} from './contract-fixtures.mjs';
installSourceLoader();
const api=await import('../src/contracts.ts');
const scenarioApi=await import('../src/scenario-management.ts');
const runtimeApi=await import('../src/runtime-observability.ts');

function setup(){
  const f=fixtures(api),now='2026-10-01T10:00:00.000Z';
  const scenario=scenarioApi.createExecutableScenario(f.TaskSpec,'check',now);
  const runtime={schemaVersion:1,id:'runtime-evidence-one',taskId:f.ValidationResult.taskId,validationId:f.ValidationResult.id,
    scenarioId:'check',commandHash:f.ValidationResult.commandHash,candidateDigest:f.ValidationResult.candidateDigest,
    candidateGeneration:f.ValidationResult.candidateGeneration,startedAt:now,endedAt:now,exitCode:0,status:'PASSED',complete:true,
    eventCount:1,eventLogRef:'runtime-events-one',redactions:0,summary:"The check passed.",importantObservations:['Processo: PASSED.'],
    metrics:{durationMs:1},diagnosis:{observed:['Processo: PASSED.'],inferred:[],unknown:[]}};
  const ref=(id,mediaType='application/json')=>({schemaVersion:1,id,digest:'a'.repeat(64),relativeStorePath:`artifacts/${id}`,bytes:1,mediaType});
  const run=scenarioApi.createScenarioRun(scenario,f.ValidationResult,runtime,ref(runtime.id),ref(runtime.eventLogRef,'application/x-ndjson'));
  return{f,now,scenario,runtime,run,ref};
}

test('executable scenario schema binds an approved command and explicit criteria',()=>{
  const {f,scenario}=setup();
  assert.equal(scenarioApi.validateExecutableScenario(scenario),true);
  assert.deepEqual(scenario.criterionIds,['criterion']);
  assert.equal(scenario.execution.commandHash,api.hashCanonical(f.CommandSpec));
  assert.equal(scenarioApi.commandForScenario(scenario,f.TaskSpec.validationCommands).id,'check');
  assert.throws(()=>scenarioApi.createExecutableScenario(f.TaskSpec,'free-shell'),/SCENARIO_COMMAND_NOT_APPROVED/);
  assert.equal(scenarioApi.validateExecutableScenario({...scenario,scenarioHash:'0'.repeat(64)}),false);
});

test('material scenario changes require a new version and hash',()=>{
  const {scenario}=setup();
  const {scenarioHash,version,lifecycle,createdAt,updatedAt,...material}=scenario;
  const changed=scenarioApi.nextScenarioVersion(scenario,{...material,inputs:['Input aggiornato e ripetibile.']},'2026-10-01T11:00:00.000Z');
  assert.equal(changed.version,2);assert.notEqual(changed.scenarioHash,scenario.scenarioHash);
  assert.throws(()=>scenarioApi.nextScenarioVersion(scenario,material),/SCENARIO_VERSION_UNCHANGED/);
  const executed=scenarioApi.transitionScenarioLifecycle(scenario,'EXECUTED','2026-10-01T11:00:00.000Z');assert.equal(executed.lifecycle,'EXECUTED');
  assert.equal(executed.scenarioHash,scenario.scenarioHash);assert.throws(()=>scenarioApi.transitionScenarioLifecycle(executed,'DRAFT'),/SCENARIO_LIFECYCLE_INVALID/);
});

test('scenario runs are append-only identities and reject stale candidates',()=>{
  const {run}=setup();
  assert.equal(scenarioApi.validateScenarioRun(run),true);
  scenarioApi.assertCurrentScenarioRun(run,{digest:run.candidateDigest,generation:run.candidateGeneration});
  assert.throws(()=>scenarioApi.assertCurrentScenarioRun(run,{digest:'b'.repeat(64),generation:2}),/SCENARIO_RUN_STALE_CANDIDATE/);
  const later={...run,runId:'scenario-run-two',candidateGeneration:2,startedAt:'2026-10-01T12:00:00.000Z',endedAt:'2026-10-01T12:00:01.000Z'};
  assert.equal(scenarioApi.scenarioRunsComparable(run,later),true);
  assert.equal(scenarioApi.scenarioRunsComparable(run,{...later,scenarioHash:'b'.repeat(64)}),false);
});

test('technical evidence maps every criterion explicitly and never infers list position',()=>{
  const {f,scenario,run}=setup(),bundle=scenarioApi.createTechnicalEvidenceBundle(scenario,[run],f.TaskSpec.acceptanceCriteria);
  assert.equal(scenarioApi.validateTechnicalEvidenceBundle(bundle),true);
  assert.deepEqual(bundle.criterionEvidence.map(value=>value.criterionId),['criterion']);
  assert.equal(bundle.criterionEvidence[0].status,'PASSED');
  assert.ok(bundle.criterionEvidence[0].evidenceRefs.includes(f.ValidationResult.id));
  const {scenarioHash,lifecycle,createdAt,updatedAt,version,...material}=scenario,unknownMaterial={...material,criterionIds:['unknown']};
  const unknown={...unknownMaterial,scenarioHash:scenarioApi.scenarioVersionHash(unknownMaterial),lifecycle,createdAt,updatedAt,version};
  assert.throws(()=>scenarioApi.createTechnicalEvidenceBundle(unknown,[{...run,scenarioHash:unknown.scenarioHash}],f.TaskSpec.acceptanceCriteria),/EVIDENCE_CRITERION_UNKNOWN/);
});

test('before/after binding requires the exact scenario version, command and validation identities',()=>{
  const {f,scenario,run}=setup(),before={...run,runId:'scenario-run-before',result:'FAIL',candidateGeneration:1,
    validationResultRefs:['validation-before'],runtimeEvidenceRefs:['runtime-before','events-before']},after={...run,runId:'scenario-run-after',candidateGeneration:2,
    validationResultRefs:['validation-after'],runtimeEvidenceRefs:['runtime-after','events-after']};
  const row={schemaVersion:runtimeApi.RUNTIME_EVENT_SCHEMA,timestamp:'2026-10-01T10:00:00.000Z',source:'fixture',eventType:'failed',severity:'ERROR',correlationId:'check'};
  const comparison={schemaVersion:1,scenarioId:'check',commandHash:run.commandHash,
    before:{evidenceId:'runtime-before',validationId:'validation-before',eventLogRef:'events-before',generation:1,status:'FAILED',diagnosis:{observed:[],inferred:[],unknown:[]},events:[row]},
    after:{evidenceId:'runtime-after',validationId:'validation-after',eventLogRef:'events-after',generation:2,status:'PASSED',diagnosis:{observed:[],inferred:[],unknown:[]},events:[]},
    eventTypeChanges:['failed: 1 → 0'],metricChanges:[],residualAnomalies:[],conclusion:'RESOLVED'};
  const bundle=scenarioApi.createTechnicalEvidenceBundle(scenario,[after],f.TaskSpec.acceptanceCriteria);
  const bound=scenarioApi.bindBeforeAfter(bundle,before,after,comparison,'runtime-comparison-after');
  assert.equal(bound.beforeAfterComparisonRef,'runtime-comparison-after');assert.deepEqual(bound.runIds,['scenario-run-after','scenario-run-before']);
  assert.throws(()=>scenarioApi.bindBeforeAfter(bundle,{...before,commandHash:'b'.repeat(64)},after,comparison,'runtime-comparison-after'),/SCENARIO_COMPARISON_INCOMPATIBLE/);
});
