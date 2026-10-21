/**
 * Collect host-owned checks for one exact candidate under a frozen TaskSpec.
 * Commands come from the existing validation runner; this service does not
 * compile proposals, authorize execution or decide workflow transitions.
 */
import { canonicalize, hashContract, parseJson } from './contracts.js';
import type { TaskSpec, WorkflowState, ArtifactRef, ValidationResult } from './contracts.js';
import type { DurableStore } from './store.js';
import type { HostCommandOptions } from './host-command.js';
import { collectValidationEvidenceAsync } from './validation-runner.js';
import { runQuiescent } from './run-quiescence.js';

/** Executes required commands for one frozen candidate. Decision-making and
 * admission of these host-owned results remain with the coordinator. */
export class WorkflowValidationService {
  /**
   * Run required checks in order and stop at the first non-passing result.
   * Results remain bound to the candidate digest/generation supplied here.
   * @throws VALIDATION_PRECONDITION if state, specification or role termination
   * cannot be reconciled. Runner/storage errors propagate without inventing PASS.
   */
  async run(
    taskSpec: TaskSpec,
    workflowState: WorkflowState,
    store: DurableStore,
    options: HostCommandOptions = {},
  ): Promise<Readonly<{ results: readonly ValidationResult[]; artifacts: readonly ArtifactRef[] }>> {
    const candidate = workflowState.candidate;
    if (
      workflowState.state !== 'TESTING' || !candidate ||
      workflowState.specHash !== taskSpec.specHash ||
      hashContract('TaskSpec', taskSpec) !== taskSpec.specHash ||
      canonicalize(parseJson(store.read(workflowState.spec), 64 * 1024 * 1024)) !== canonicalize(taskSpec) ||
      workflowState.runs.some(run => !runQuiescent(run))
    ) {
      throw new Error('VALIDATION_PRECONDITION');
    }

    const results: ValidationResult[] = [];
    const artifacts: ArtifactRef[] = [];
    for (const command of taskSpec.validationCommands.filter(command => command.required)) {
      const evidence = await collectValidationEvidenceAsync(command, store, {
        taskId: taskSpec.taskId,
        specHash: taskSpec.specHash,
        candidate: {
          root: candidate.root,
          baseCommit: candidate.baseCommit,
          digest: candidate.digest,
          generation: candidate.generation,
        },
        criteria: taskSpec.acceptanceCriteria,
        createdAt: workflowState.createdAt,
        patchRef: candidate.patch.id,
      }, options);
      results.push(evidence.result);
      artifacts.push(...evidence.artifacts);
      if (evidence.result.status !== 'PASSED') break;
    }
    return Object.freeze({ results: Object.freeze(results), artifacts: Object.freeze(artifacts) });
  }
}
