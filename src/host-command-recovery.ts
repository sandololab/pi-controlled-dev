/**
 * Reconcile command journals with the workflow's recorded ownership epochs.
 * QUIESCENT describes this journal inspection, not permission to take over work:
 * recovery must still verify ownership and the remaining workflow evidence.
 * Missing terminal records stay UNKNOWN; inconsistent bindings stay INVALID.
 * This module never starts processes, edits the journal or releases locks.
 */
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize, hashBytes, hashCanonical, parseJson } from './contract-json.js';
import type { TaskSpec, WorkflowState, ContextRecord, TransitionEvent } from './contracts.js';
import type { ProcessIncarnation } from './process-incarnation.js';

export const HOST_SUPERVISION_MEDIA = 'application/vnd.pi-controlled-dev.host-supervision+json';
const MAX_RECOVERY_RECORD_BYTES = 16 * 1024;

export interface SupervisionEpoch {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly taskId: string;
  readonly specHash: string;
  readonly ownerSessionId: string;
  readonly owner: ProcessIncarnation;
  readonly phase: 'PRE_IMPLEMENTATION' | 'TESTING';
  readonly workRoot: string;
  readonly sourceRevision: number;
  readonly commandHashes: readonly string[];
}

interface Ledger {
  readonly state: WorkflowState;
  readonly records: readonly ContextRecord[];
  readonly events: readonly TransitionEvent[];
}

export interface HostRecoveryStatus {
  readonly status: 'QUIESCENT' | 'UNKNOWN' | 'INVALID';
  readonly supervisedTesting: boolean;
  readonly operations: number;
  readonly pending: readonly string[];
}

// These annotations describe the journal format, not trusted runtime evidence.
// Parsed records still have to pass the binding and lifecycle checks below.
interface CommandJournalRecord {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly phase: string;
  readonly supervisionEpochId: string;
  readonly taskId: string;
  readonly specHash: string;
  readonly commandHash: string;
  readonly cwd: string;
  readonly owner: ProcessIncarnation;
  readonly startedAt: string;
  readonly candidateDigest: string;
  readonly candidateGeneration: number;
  readonly pid?: number;
  readonly groupQuiescent?: boolean;
  readonly endedAt?: string;
}

function readRecoveryRecordBytes(path: string): Uint8Array {
  const fileStat = lstatSync(path);
  if (
    !fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.nlink !== 1 ||
    fileStat.size > MAX_RECOVERY_RECORD_BYTES || realpathSync(path) !== path
  ) {
    throw new Error('HOST_COMMAND_JOURNAL_INVALID');
  }
  return readFileSync(path);
}

function commandIdentity(record: CommandJournalRecord): object {
  // Lifecycle-specific fields differ between phases. These shared fields must
  // remain identical so records from different candidates cannot be combined.
  return {
    operationId: record.operationId,
    taskId: record.taskId,
    specHash: record.specHash,
    supervisionEpochId: record.supervisionEpochId,
    commandHash: record.commandHash,
    cwd: record.cwd,
    owner: record.owner,
    startedAt: record.startedAt,
    candidateDigest: record.candidateDigest,
    candidateGeneration: record.candidateGeneration,
  };
}

/** Read-only reconciliation. It cannot complete validation, release locks, start
 * processes or infer that an unjournaled spawn never happened. */
export function inspectHostCommandRecovery(taskRoot: string, ledger: Ledger): HostRecoveryStatus {
  const invalid = (): HostRecoveryStatus => Object.freeze({
    status: 'INVALID', supervisedTesting: false, operations: 0, pending: Object.freeze([]),
  });

  try {
    const workflowState = ledger.state;
    const epochs = new Map<string, SupervisionEpoch>();
    // Imported work starts a new ownership interval. Older records remain
    // checked history; only current-interval operations enter the pending set.
    // Corrupt history still invalidates inspection rather than being ignored.
    const bindingRevision = workflowState.runtimeBindingRef
      ? ledger.events.findLast(event => event.evidenceRefs.includes(workflowState.runtimeBindingRef!.id))?.revision ?? -1
      : -1;
    const currentSpec = ledger.records.find(record => record.kind === 'TaskSpec' && record.id === workflowState.spec.id)?.value as TaskSpec | undefined;
    if (!currentSpec) return invalid();

    for (const record of ledger.records) {
      if (record.kind !== 'ArtifactRef' || record.value.mediaType !== HOST_SUPERVISION_MEDIA) continue;
      const artifact = record.value;
      if (artifact.relativeStorePath !== `artifacts/${artifact.id}`) return invalid();
      const recordBytes = readRecoveryRecordBytes(join(taskRoot, artifact.relativeStorePath));
      if (hashBytes(recordBytes) !== artifact.digest || recordBytes.byteLength !== artifact.bytes) return invalid();

      const epoch = parseJson(recordBytes, MAX_RECOVERY_RECORD_BYTES) as unknown as SupervisionEpoch;
      const epochSpec = ledger.records.find(record => record.kind === 'TaskSpec' && record.value.specHash === epoch.specHash)?.value as TaskSpec | undefined;
      if (
        epoch.schemaVersion !== 1 || epoch.id !== artifact.id || epoch.taskId !== workflowState.taskId ||
        !epochSpec || !epoch.owner || !['PRE_IMPLEMENTATION', 'TESTING'].includes(epoch.phase) ||
        canonicalize(epoch.commandHashes) !== canonicalize(epochSpec.validationCommands.filter(command => command.required).map(command => hashCanonical(command))) ||
        !ledger.events.some(event => event.recordType === 'RECONCILED' && event.previousRevision === epoch.sourceRevision && event.evidenceRefs.includes(artifact.id))
      ) {
        return invalid();
      }
      epochs.set(artifact.id, epoch);
    }

    const operations = new Map<string, Map<string, CommandJournalRecord>>();
    for (const fileName of readdirSync(join(taskRoot, 'artifacts'))) {
      if (!/^host-command-[a-f0-9-]{36}-(?:intent|started|closed|not_started|uncertain)$/.test(fileName)) continue;
      const recordBytes = readRecoveryRecordBytes(join(taskRoot, 'artifacts', fileName));
      const commandRecord = parseJson(recordBytes, MAX_RECOVERY_RECORD_BYTES) as unknown as CommandJournalRecord;
      const epoch = epochs.get(commandRecord.supervisionEpochId);
      if (
        !epoch || commandRecord.schemaVersion !== 1 ||
        fileName !== `${commandRecord.operationId}-${String(commandRecord.phase).toLowerCase()}` ||
        commandRecord.taskId !== epoch.taskId || commandRecord.specHash !== epoch.specHash ||
        commandRecord.cwd !== epoch.workRoot || !epoch.commandHashes.includes(commandRecord.commandHash) ||
        canonicalize(commandRecord.owner) !== canonicalize(epoch.owner)
      ) {
        return invalid();
      }
      // Retired runtime history, even if a Pi session ID is reused.
      if (epoch.ownerSessionId !== workflowState.ownerSessionId || epoch.sourceRevision < bindingRevision) continue;

      const phases = operations.get(commandRecord.operationId) ?? new Map<string, CommandJournalRecord>();
      if (phases.has(commandRecord.phase)) return invalid();
      phases.set(commandRecord.phase, commandRecord);
      operations.set(commandRecord.operationId, phases);
    }

    const pendingOperations: string[] = [];
    for (const [operationId, phases] of operations) {
      const intentRecord = phases.get('INTENT');
      const closedRecord = phases.get('CLOSED');
      const notStartedRecord = phases.get('NOT_STARTED');
      const startedRecord = phases.get('STARTED');
      if (!intentRecord || (closedRecord && notStartedRecord)) return invalid();
      if ([...phases.values()].some(record => canonicalize(commandIdentity(record)) !== canonicalize(commandIdentity(intentRecord)))) return invalid();

      if (closedRecord) {
        if (
          !startedRecord || closedRecord.pid !== startedRecord.pid || closedRecord.groupQuiescent !== true ||
          !Number.isSafeInteger(closedRecord.pid) || closedRecord.pid! <= 0 || !Number.isFinite(Date.parse(closedRecord.endedAt!))
        ) {
          return invalid();
        }
      } else if (!notStartedRecord) {
        pendingOperations.push(operationId);
      }
    }

    const supervisedTesting = [...epochs.values()].some(epoch =>
      epoch.sourceRevision >= bindingRevision && epoch.phase === 'TESTING' &&
      epoch.specHash === workflowState.specHash && epoch.ownerSessionId === workflowState.ownerSessionId &&
      epoch.workRoot === workflowState.candidate?.root,
    );
    return Object.freeze({
      status: pendingOperations.length ? 'UNKNOWN' : 'QUIESCENT',
      supervisedTesting,
      operations: operations.size,
      pending: Object.freeze(pendingOperations.sort()),
    });
  } catch {
    return invalid();
  }
}
