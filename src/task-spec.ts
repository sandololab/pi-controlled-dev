import { canonicalize, validateContract } from './contracts.js';
import type { TaskSpec, ValidationContext } from './contracts.js';

export class TaskSpecError extends Error { constructor(readonly code = 'ORCHESTRATOR_TASK_INVALID') { super(code); } }

/** Accepts an already-normalized DATA-001 object. It never extracts prose or reads files. */
export function freezeTaskSpec(input: unknown, context: ValidationContext): TaskSpec {
  const checked = validateContract('TaskSpec', input, context);
  if (!checked.ok) throw new TaskSpecError();
  return deepFreeze(JSON.parse(canonicalize(checked.value)) as TaskSpec);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
