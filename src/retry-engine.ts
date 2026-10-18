import { failureFingerprint } from './contracts.js';
import type { Counters, FailureRecord, RetryPolicy, State } from './contracts.js';

export type DispatchOutcome = 'KNOWN_FAILED' | 'UNKNOWN';
export type RetryAction = 'RETRY_INFRASTRUCTURE' | 'REWORK' | 'ESCALATE' | 'BLOCK' | 'FAIL' | 'HUMAN_DECISION_REQUIRED';
export type FailureSource = 'RPC_TRANSIENT' | 'VALIDATION_FAILED' | 'REVIEW_FAILED' | 'SCOPE_GUARD_FAILED'
  | 'SCHEMA_REJECTED' | 'RECOVERY_CONFLICT' | 'AMBIGUITY';
export interface FailureInput {
  readonly phase: State;
  readonly source: FailureSource;
  readonly code: string;
  readonly subjectIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}
export interface RetryProof {
  readonly dispatchOutcome: DispatchOutcome;
  readonly transientInfrastructure: boolean;
  readonly writerTerminal: boolean;
  readonly workspaceSafe: boolean;
  readonly sameProtocol: boolean;
  readonly concreteHumanResolution: boolean;
  readonly duplicateEscalation: boolean;
}
export interface RetryEvaluation {
  readonly input: FailureInput;
  readonly failures: readonly FailureRecord[];
  readonly counters: Counters;
  readonly policy: RetryPolicy;
  readonly proof: RetryProof;
}
export interface RetryOutcome {
  readonly action: RetryAction;
  readonly failure: FailureRecord;
  readonly occurrence: number;
  readonly reason: string;
}

const categories:Readonly<Record<FailureSource,FailureRecord['category']>>=Object.freeze({
  RPC_TRANSIENT:'INFRA',VALIDATION_FAILED:'TEST',REVIEW_FAILED:'REVIEW',SCOPE_GUARD_FAILED:'SCOPE',
  SCHEMA_REJECTED:'SCHEMA',RECOVERY_CONFLICT:'RECOVERY',AMBIGUITY:'AMBIGUITY',
});
export function classifyFailure(source:FailureSource):FailureRecord['category'] { return categories[source]; }

/** Pure RET-001 classifier. It records no state and performs no dispatch. */
export function evaluateFailure(request: RetryEvaluation): RetryOutcome {
  const draft: {
    schemaVersion: 1; id: string; phase: State; category: FailureRecord['category']; code: string;
    subjectIds: string[]; fingerprint: string; evidenceRefs: string[];
  } = {
    schemaVersion: 1,
    id: 'failure-pending',
    phase: request.input.phase,
    category: classifyFailure(request.input.source),
    code: request.input.code,
    subjectIds: [...request.input.subjectIds].sort(),
    fingerprint: '0'.repeat(64),
    evidenceRefs: [...request.input.evidenceRefs],
  };
  draft.fingerprint = failureFingerprint(draft);
  const occurrence = request.failures.filter(value => value.fingerprint === draft.fingerprint).length + 1;
  draft.id = `failure-${draft.fingerprint.slice(0,20)}-${occurrence}`;
  const result = (action: RetryAction, reason: string): RetryOutcome => freeze({ action, failure: draft, occurrence, reason });
  const exhausted = (reason: string) => result(request.proof.concreteHumanResolution ? 'HUMAN_DECISION_REQUIRED' : 'FAIL', reason);

  if (request.proof.dispatchOutcome === 'UNKNOWN') return result('BLOCK','UNKNOWN dispatch outcomes are never retryable');
  if (['SCOPE','SCHEMA','RECOVERY'].includes(draft.category)) return result('BLOCK',`${draft.category} failures require reconciliation`);
  if (occurrence >= 2) {
    if (!request.proof.duplicateEscalation && request.counters.escalationEpisodes < request.policy.maxEscalationEpisodes
      && request.counters.dispatches < request.policy.maxDispatches) return result('ESCALATE','Equivalent failure repeated');
    return exhausted('Equivalent failure cannot open another bounded escalation');
  }
  if (draft.category === 'AMBIGUITY') {
    if (!request.proof.duplicateEscalation && request.counters.escalationEpisodes < request.policy.maxEscalationEpisodes
      && request.counters.dispatches < request.policy.maxDispatches) return result('ESCALATE','Ambiguity requires advisory escalation before writing');
    return exhausted('Ambiguity escalation budget exhausted');
  }
  if (draft.category === 'INFRA') {
    const proven = request.proof.transientInfrastructure && request.proof.writerTerminal && request.proof.workspaceSafe && request.proof.sameProtocol;
    if (!proven) return result('BLOCK','Infrastructure retry preconditions are not proven');
    if (request.counters.infrastructureRetries < request.policy.maxInfrastructureRetries
      && request.counters.dispatches < request.policy.maxDispatches) return result('RETRY_INFRASTRUCTURE','One explicit same-protocol retry is admissible');
    return exhausted('Infrastructure retry budget exhausted');
  }
  if (draft.category === 'TEST' || draft.category === 'REVIEW') {
    if (request.counters.reworkAttempts < request.policy.maxReworkAttempts
      && request.counters.dispatches < request.policy.maxDispatches) return result('REWORK','Attributed candidate failure requires bounded rework');
    return exhausted('Rework budget exhausted');
  }
  return result('BLOCK','Failure category has no retry route');
}

function freeze<T>(value:T):T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
