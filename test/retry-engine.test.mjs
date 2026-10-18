import assert from 'node:assert/strict';
import test from 'node:test';
import { installSourceLoader } from './load-source.mjs';
import { loadContracts } from './load-contracts.mjs';
import { fixtures } from './contract-fixtures.mjs';
installSourceLoader();
const { evaluateFailure }=await import('../src/retry-engine.ts');
const api=await loadContracts();
const f=fixtures(api);
const sources={INFRA:'RPC_TRANSIENT',TEST:'VALIDATION_FAILED',REVIEW:'REVIEW_FAILED',SCOPE:'SCOPE_GUARD_FAILED',SCHEMA:'SCHEMA_REJECTED',RECOVERY:'RECOVERY_CONFLICT',AMBIGUITY:'AMBIGUITY'};
const input=(category='TEST',code='FAILED',subjectIds=['criterion'])=>({phase:'TESTING',source:sources[category],code,subjectIds,evidenceRefs:['evidence']});
const proof=(overrides={})=>({dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:false,writerTerminal:true,workspaceSafe:true,sameProtocol:true,
  concreteHumanResolution:false,duplicateEscalation:false,...overrides});
const evaluate=(category,overrides={})=>evaluateFailure({input:input(category),failures:overrides.failures??[],counters:overrides.counters??f.Counters,
  policy:overrides.policy??f.RetryPolicy,proof:proof(overrides.proof)});

test('P12 RET-001 — canonical fingerprint ignores volatile evidence and orders stable subjects',()=>{
  const a=evaluateFailure({input:input('TEST','FAILED',['z','a']),failures:[],counters:f.Counters,policy:f.RetryPolicy,proof:proof()});
  const b=evaluateFailure({input:{...input('TEST','FAILED',['a','z']),evidenceRefs:['other']},failures:[],counters:f.Counters,policy:f.RetryPolicy,proof:proof()});
  assert.equal(a.failure.fingerprint,b.failure.fingerprint);assert.deepEqual(a.failure.subjectIds,['a','z']);
  assert.equal(a.failure.id,`failure-${a.failure.fingerprint.slice(0,20)}-1`);assert.ok(Object.isFrozen(a));
});

test('P12 TEST-022/024 — UNKNOWN never retries; infrastructure retry needs every proof and budget',()=>{
  assert.equal(evaluate('INFRA',{proof:{dispatchOutcome:'UNKNOWN',transientInfrastructure:true}}).action,'BLOCK');
  for(const missing of ['transientInfrastructure','writerTerminal','workspaceSafe','sameProtocol'])
    assert.equal(evaluate('INFRA',{proof:{transientInfrastructure:true,[missing]:false}}).action,'BLOCK');
  assert.equal(evaluate('INFRA',{proof:{transientInfrastructure:true}}).action,'RETRY_INFRASTRUCTURE');
  assert.equal(evaluate('INFRA',{proof:{transientInfrastructure:true},counters:{...f.Counters,infrastructureRetries:1}}).action,'FAIL');
  assert.equal(evaluate('INFRA',{proof:{transientInfrastructure:true,concreteHumanResolution:true},counters:{...f.Counters,infrastructureRetries:1}}).action,'HUMAN_DECISION_REQUIRED');
});

for(const [cap,used,expected] of [[0,0,'FAIL'],[1,0,'RETRY_INFRASTRUCTURE'],[1,1,'FAIL']])
  test(`P12.3 — same proven INFRA cap=${cap} used=${used}: ${expected}, pure counters`,()=>{
    const counters={...f.Counters,infrastructureRetries:used},before=structuredClone(counters);
    const result=evaluate('INFRA',{policy:{...f.RetryPolicy,maxInfrastructureRetries:cap},counters,proof:{transientInfrastructure:true}});
    assert.equal(result.failure.category,'INFRA');assert.equal(result.action,expected);assert.deepEqual(counters,before);
  });

test('P12 TEST-023 — repeated equivalent failure escalates before another attempt and deduplicates episodes',()=>{
  const first=evaluate('TEST');assert.equal(first.action,'REWORK');
  const second=evaluate('TEST',{failures:[first.failure]});assert.equal(second.occurrence,2);assert.equal(second.action,'ESCALATE');
  assert.equal(evaluate('TEST',{failures:[first.failure],proof:{duplicateEscalation:true}}).action,'FAIL');
});

test('P12 routing — TEST/REVIEW rework, ambiguity escalates, SCOPE/SCHEMA/RECOVERY block',()=>{
  assert.equal(evaluate('TEST').action,'REWORK');assert.equal(evaluate('REVIEW').action,'REWORK');assert.equal(evaluate('AMBIGUITY').action,'ESCALATE');
  for(const category of ['SCOPE','SCHEMA','RECOVERY'])assert.equal(evaluate(category).action,'BLOCK');
  assert.equal(evaluate('TEST',{counters:{...f.Counters,reworkAttempts:2}}).action,'FAIL');
  assert.equal(evaluate('TEST',{counters:{...f.Counters,dispatches:64},proof:{concreteHumanResolution:true}}).action,'HUMAN_DECISION_REQUIRED');
});
