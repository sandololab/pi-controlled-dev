/**
 * Execute immutable host-approved commands and preserve their process history.
 * This service owns spawning, bounded output, termination and durable lifecycle
 * records. Workflow admission, retries and acceptance remain with the coordinator.
 * Linux process groups cover ordinary descendants; they do not isolate a program
 * that deliberately detaches itself. An unproven shutdown is never a successful check.
 */
import { hrtime, kill, platform } from 'node:process';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout, clearTimeout } from 'node:timers';
import { canonicalize, hashCanonical, validateStructure } from './contracts.js';
import type { CommandSpec, ArtifactRef } from './contracts.js';
import type { DurableStore } from './store.js';
import { currentProcessIncarnation } from './process-incarnation.js';

export interface HostCommandProgress {
  readonly phase: 'STARTING' | 'RUNNING' | 'FINISHED';
  readonly commandId: string;
  /** Monotonic duration; startedAt/endedAt separately retain wall-clock time. */
  readonly elapsedMs: number;
  readonly outputBytes: number;
  readonly description?: string;
}

export interface HostCommandOptions {
  readonly onProgress?: (event: HostCommandProgress) => void;
  readonly supervisionEpoch?: ArtifactRef;
}

export interface HostCommandOutcome {
  readonly pid: number;
  readonly status: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: { code: string };
}

export interface HostCommandExecution {
  readonly command: CommandSpec;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly child: HostCommandOutcome;
  readonly artifacts: readonly ArtifactRef[];
  readonly source: 'node-spawn';
}

export interface HostCommandBinding {
  readonly taskId: string;
  readonly specHash: string;
  readonly candidateDigest: string;
  readonly candidateGeneration: number;
}

const OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const activeStores = new WeakSet<object>();

/** Host-selected immutable argv only. The service records its own lifecycle and
 * never changes workflow state, retries an agent or interprets model text. */
export async function executeSupervisedCommand(
  command: CommandSpec,
  workRoot: string,
  store: DurableStore,
  binding: HostCommandBinding,
  options: HostCommandOptions = {},
): Promise<HostCommandExecution> {
  if (activeStores.has(store)) throw new Error('HOST_COMMAND_BUSY');
  activeStores.add(store);
  try {
    return await executeCommandLifecycle(command, workRoot, store, binding, options);
  } finally {
    activeStores.delete(store);
  }
}

async function executeCommandLifecycle(
  command: CommandSpec,
  workRoot: string,
  store: DurableStore,
  binding: HostCommandBinding,
  options: HostCommandOptions,
): Promise<HostCommandExecution> {
  if (platform !== 'linux' || !currentProcessIncarnation()) throw new Error('HOST_COMMAND_SUPERVISION_UNAVAILABLE');
  if (!validateStructure('CommandSpec', command).ok) throw new Error('VALIDATION_PRECONDITION');

  const operationId = `host-command-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const monotonicStartMs = monotonicTimeMs();
  const artifacts: ArtifactRef[] = [];
  const identity = {
    schemaVersion: 1,
    operationId,
    ...binding,
    ...(options.supervisionEpoch ? { supervisionEpochId: options.supervisionEpoch.id } : {}),
    commandHash: hashCanonical(command),
    cwd: workRoot,
    owner: currentProcessIncarnation() ?? null,
    startedAt,
  };
  const appendJournalRecord = (phase: string, data: object): void => {
    const record = { ...identity, phase, ...data };
    const artifact = store.put(`${operationId}-${phase.toLowerCase()}`, canonicalize(record), 'application/vnd.pi-controlled-dev.host-command+json');
    artifacts.push(artifact);
  };
  const reportProgress = (phase: HostCommandProgress['phase'], outputBytes: number): void => {
    try {
      options.onProgress?.(Object.freeze({
        phase,
        commandId: command.id,
        elapsedMs: Math.max(0, monotonicTimeMs() - monotonicStartMs),
        outputBytes,
      }));
    } catch { /* Presentation cannot change a process outcome. */ }
  };

  // A crash between spawn and STARTED must leave evidence of a possible process,
  // rather than allowing recovery to infer that nothing was launched.
  appendJournalRecord('INTENT', {});
  reportProgress('STARTING', 0);
  const result = await new Promise<{ child: HostCommandOutcome; endedAt: string }>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      // A dedicated process group lets timeout handling stop ordinary children
      // as well as the command. argv is passed directly, without a shell parser.
      child = spawn(command.executable, [...command.argv], {
        cwd: workRoot, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      appendJournalRecord('NOT_STARTED', { reason: 'SPAWN_FAILED' });
      reject(error);
      return;
    }

    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    let outputBytes = 0;
    let errorCode: string | undefined;
    let hasSpawned = false;
    let journalFailure: unknown;
    let isTerminationUnproven = false;
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
    let progressTimer: ReturnType<typeof setTimeout> | undefined;

    const stopProcessGroup = (): void => {
      if (!child.pid) return;
      try {
        kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if ((error as { code?: string }).code !== 'ESRCH') journalFailure ??= error;
      }
    };
    const terminate = (reason: string): void => {
      if (isTerminationUnproven) return;
      errorCode ??= reason;
      stopProcessGroup();
      if (!shutdownTimer) {
        shutdownTimer = setTimeout(() => {
          isTerminationUnproven = true;
          if (progressTimer) clearTimeout(progressTimer);
          try {
            appendJournalRecord('UNCERTAIN', {
              pid: child.pid ?? null,
              errorCode: errorCode ?? 'HOST_COMMAND_TERMINATION_UNPROVEN',
              observedAt: new Date().toISOString(),
            });
          } catch { /* Retain the original unclosed intent. */ }
          reject(new Error('HOST_COMMAND_TERMINATION_UNPROVEN'));
        }, 2000);
      }
    };
    const appendOutput = (chunks: Uint8Array[], chunk: Uint8Array): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > OUTPUT_LIMIT_BYTES) {
        terminate('ENOBUFS');
        return;
      }
      chunks.push(chunk);
    };
    child.stdout?.on('data', (chunk: Uint8Array) => appendOutput(stdoutChunks, chunk));
    child.stderr?.on('data', (chunk: Uint8Array) => appendOutput(stderrChunks, chunk));
    const handleStreamFailure = (error: unknown): void => {
      journalFailure ??= error;
      terminate('HOST_COMMAND_STREAM_FAILED');
    };
    child.stdout?.on('error', handleStreamFailure);
    child.stderr?.on('error', handleStreamFailure);

    const commandTimer = setTimeout(() => terminate('ETIMEDOUT'), command.timeoutMs);
    const reportRunning = (): void => {
      reportProgress('RUNNING', outputBytes);
      progressTimer = setTimeout(reportRunning, 250);
    };
    child.once('spawn', () => {
      hasSpawned = true;
      try {
        appendJournalRecord('STARTED', { pid: child.pid });
      } catch (error) {
        journalFailure = error;
        terminate('HOST_COMMAND_JOURNAL_FAILED');
      }
      reportRunning();
    });
    // The parent may exit while descendants retain pipes or continue writing.
    // Stop that group before treating stream closure as a terminal observation.
    child.once('exit', () => stopProcessGroup());
    child.once('error', (error: { code?: string }) => { errorCode ??= error.code ?? 'SPAWN_FAILED'; });
    child.once('close', async (status: number | null, signal: string | null) => {
      clearTimeout(commandTimer);
      if (shutdownTimer) clearTimeout(shutdownTimer);
      if (progressTimer) clearTimeout(progressTimer);
      const groupQuiescent = !!child.pid && await waitForGroupExit(child.pid);
      const endedAt = new Date().toISOString();
      if (hasSpawned && !groupQuiescent) errorCode ??= 'HOST_COMMAND_GROUP_UNCERTAIN';
      try {
        appendJournalRecord(hasSpawned ? 'CLOSED' : 'NOT_STARTED', {
          pid: child.pid ?? null, status, signal, errorCode: errorCode ?? null, groupQuiescent, endedAt,
        });
        if (journalFailure) throw journalFailure;
        if (!hasSpawned || !Number.isSafeInteger(child.pid) || child.pid! <= 0) throw new Error('VALIDATION_TERMINAL_PROOF_UNAVAILABLE');
        reportProgress('FINISHED', outputBytes);
        resolve({
          endedAt,
          child: {
            pid: child.pid!, status, signal,
            stdout: decodeOutput(stdoutChunks),
            stderr: decodeOutput(stderrChunks),
            ...(errorCode ? { error: { code: errorCode } } : {}),
          },
        });
      } catch (error) {
        reject(error);
      }
    });
  });
  return Object.freeze({
    command, startedAt, endedAt: result.endedAt, child: result.child,
    artifacts: Object.freeze(artifacts), source: 'node-spawn' as const,
  });
}

// Monotonic elapsed time; wall clocks are retained separately for audit.
function monotonicTimeMs(): number {
  return Number(hrtime.bigint()) / 1e6;
}

function decodeOutput(chunks: readonly Uint8Array[]): string {
  // A UTF-8 character may span data events; decode only after joining the bytes.
  const output = new Uint8Array(chunks.reduce((totalBytes, chunk) => totalBytes + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Buffer.from(output).toString('utf8');
}

/** Same local observation domain as lock recovery. Zombies cannot execute writes. */
export function hostProcessGroupQuiescent(groupId: number): boolean {
  try {
    const initialIncarnation = currentProcessIncarnation();
    if (!initialIncarnation || !Number.isSafeInteger(groupId) || groupId <= 0) return false;
    for (const processId of readdirSync('/proc')) {
      if (!/^\d+$/.test(processId)) continue;
      let processStat: string;
      try {
        processStat = readFileSync(`/proc/${processId}/stat`).toString('utf8');
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') continue;
        return false;
      }
      const commandNameEnd = processStat.lastIndexOf(')');
      if (commandNameEnd < 0) return false;
      const statFields = processStat.slice(commandNameEnd + 2).split(' ');
      // /proc stat fields after the command name: state, parent PID, group ID.
      if (Number(statFields[2]) === groupId && !['Z', 'X'].includes(statFields[0])) return false;
    }
    return canonicalize(initialIncarnation) === canonicalize(currentProcessIncarnation());
  } catch {
    return false;
  }
}

async function waitForGroupExit(groupId: number): Promise<boolean> {
  const deadlineMs = monotonicTimeMs() + 1000;
  do {
    if (hostProcessGroupQuiescent(groupId)) return true;
    await new Promise<void>(resolve => setTimeout(resolve, 20));
  } while (monotonicTimeMs() < deadlineMs);
  return false;
}
