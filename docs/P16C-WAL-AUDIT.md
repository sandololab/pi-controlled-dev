**English** · [Italiano](it/P16C-WAL-AUDIT.md)

# P16C — Durable Model Audit Before Implementation

Historical outcome: **BLOCKED pending clarification of the fsync-confirmed rule**. This is an audit of the implementation at that time, not a statement that current repair is absent. No code, normative document or original historical store was changed by the audit. Later repair semantics are documented in [PROTOCOL](PROTOCOL.md).

## Baseline

- Complete suite: 365/365 PASS, no failures or skips.
- Historical probe on copies: 1/1 PASS; original inventory unchanged.
- Typecheck, package dry-run, dependency audit and `git diff --check`: PASS.
- Normative hashes: `<temporary-directory>/p16c-baseline-hashes.log`.
- Complete logs: `<temporary-directory>/p16c-baseline-*`.

## 1. Actual write order

### Artifacts and specification

Source: `src/store.ts`, `import`, `writeSpec`, `catalog`, `writeExclusive`.

1. Validate IDs, paths, metadata, byte digest/size and host disclosure checks.
2. If the file exists, verify existing bytes; never silently replace it.
3. Otherwise call `openSync(path, 'wx', 0600)`.
4. Call `writeFileSync(fd, bytes)`.
5. For immutable artifacts, call `fchmodSync(fd, 0400)`.
6. Call `fsyncSync(fd)`, then `closeSync(fd)`.
7. Sync the artifact's containing directory.
8. For the initial specification, persist `artifacts/spec`, then `spec.json`, syncing each; finally sync the task directory.

The complete ContextRecord catalog is written as a content-addressed artifact. Events reference the catalog; ArtifactRefs bind digest, size, path and mediaType. Media type is reference/catalog metadata, not an independent filesystem MIME value. Files have no kernel immutable flag: immutability is enforced by protocol, validation and applied permissions.

### Workflow commit

Sources: `src/orchestrator.ts:#commit`, `src/store.ts:commit`.

1. Build the next state, catalog and immutable `stateAfter`; artifacts are written and synced before the WAL.
2. Build the event with exact revision, previousEventHash, eventHash and references.
3. Verify catalog, history, schemas, sequence, artifacts, terminal proof and terminal completion when applicable.
4. Open `events.jsonl` with `wx` for CREATE, `a` for subsequent commits.
5. Write `canonicalJSON(event) + '\n'`.
6. Sync and close the WAL.
7. Sync the task directory.
8. Exclusively create `state-<revision>.tmp` in the control plane.
9. Write the canonical snapshot; sync and close the temporary file.
10. Verify existing `state.json` is a regular file, when present.
11. Call `renameSync(temp, state.json)`.
12. Sync the task directory.
13. Only now update the in-memory Store revision/eventHash and return.
14. Only after return update the Orchestrator's in-memory state.

The temporary name is deterministic per revision, not a UUID. It is neither committed state nor a versioned sync receipt. A residue causes a `wx` collision rather than automatic deletion.

### Dispatch INTENT and external effects

Source: `src/orchestrator.ts:#intent` and Scout/Developer/Reviewer/Oracle callers.

1. Freeze AssignmentEnvelope.
2. Commit `RECORD/SPAWN_INTENT`, adding the INTENT RunRecord and incrementing counters.
3. Call the runner only after commit returns.
4. After acquiring verified terminal proof, a new RECORD/RECONCILED updates the run while preserving history.
5. Record the accepted result separately.

Initial INTENT uses local request ID `intent-<attemptId>`; later RPC runId/childSessionId/requestId may be absent. Missing binding or results do not prove dispatch never occurred.

Host effects do not all share one admission/outcome protocol: rework records RECORD/RECONCILED with a descriptive reason before Git preparation; validation executes approved commands and then records results. Reason prose cannot become machine evidence of a particular effect. P16C must not replay effects to fill evidence gaps.

### Locks, guard and reclaim

Sources: `src/lock-manager.ts`, `src/recovery.ts`.

- Normal lock: exclusive guard → `wx` creation → token/incarnation metadata → write → file sync → close → directory sync → in-memory handle.
- The pair is acquired workspace first, task second, each under the shared guard. A workspace-only window therefore exists.
- Current guard: `wx` → one UUID → file sync → close → directory sync → protected operation.
- Guard release: compare token → unlink → directory sync. Uncertain outcomes retain it.
- Reclaim: fresh classification/verification under guard → write/sync authorization record → verify token/unlink task → directory sync → verify token/unlink workspace → directory sync → write/sync PAIR_RECLAIMED → release guard.
- P16B reconciliation journals use the same exclusive synced persistence and guard, but do not authorize repair.

The guard then contained only a token, without owner incarnation. Dead lock owners do not prove a different guard-owning process is dead. Legacy guards cannot be removed automatically using lock PIDs or age.

## 2. Observable crash points

| Point | Possible residue | Conservative consequence |
|---|---|---|
| During artifact write | Partial/orphan artifact | Not event or commit evidence |
| Artifact synced, before WAL | Valid artifacts without event | No authorized workflow revision |
| During WAL append | Tail without newline, possibly partial UTF-8 | Do not interpret as event |
| Complete line, before WAL sync | Valid visible WAL, earlier snapshot | Bytes alone do not prove prior sync |
| WAL sync returned, before temporary snapshot | Same valid WAL and earlier snapshot | Indistinguishable from preceding case in workflow store |
| During temporary snapshot write/sync | Partial/complete temporary file, old snapshot | Not committed; no blind promotion |
| Temporary sync returned, before rename | Complete temporary file, old snapshot | Potential causal evidence; normative role requires clarification |
| After rename, before directory sync | New visible snapshot | Visibility does not prove sync returned |
| After INTENT commit, before/during runner | INTENT without binding/outcome | Ambiguous effect; no redispatch |
| After effect, before its event | Possible orphan artifacts | No reconstruction of results, decisions or effects from chat/transcripts |
| After reclaim authorization | Audit present, locks still present | Do not infer unlink occurred |
| Between the two unlinks | Partial pair, residual guard | No blanket deletion |
| After unlink, before final record | Locks absent, authorization/guard present | Absence alone does not prove full outcome |

## 3. Equivalent phases without new workflow states

These analytical names are not a new implemented enum:

- **NOT_STARTED**: no published commit event; preparatory artifacts authorize no progress.
- **EVENT_DURABLE**: complete append followed by successful WAL and directory sync return.
- **SNAPSHOT_DURABLE**: temporary file written/synced, renamed, and directory sync completed.
- **COMMITTED**: completion of SNAPSHOT_DURABLE in this implementation. Handle updates are in memory; no further persistent state is needed.
- **INTENT_DURABLE**: qualification of SPAWN_INTENT under the same commit protocol, not a universal intermediate phase. It proves neither effect start nor finish. The runner is called only after INTENT commit returns.

`#revision`, `#eventHash`, `#poisoned` and fsync return values are not persisted receipts and cannot be used by a successor after process death.

## 4. Existing loader checks

`DurableStore.load` reads only the newline-terminated prefix; rejects invalid UTF-8 there; checks eventHash, previousEventHash, continuous revisions, history preservation, contracts, immutable paths, artifact digest/size, original specification, terminal proof and COMPLETED attestation where applicable.

A tail without newline remains on disk and is not applied; further appends are rejected. At the audit baseline, snapshot and state derived from the last complete event had to match exactly: both WAL-ahead and snapshot-ahead were rejected without repair.

A valid hash proves integrity/binding, not execution of fsync. Timestamps, age and prose do not bridge that distinction.

## 5. Empirical fsync-window probe

Command: `node <temporary-directory>/p16c-fsync-window-probe.mjs`.

The worker uses real commits on temporary fixtures. Two separate executions receive SIGKILL:

1. After the complete revision-1 append, before WAL fsync.
2. After that WAL fsync returns, before the snapshot.

Both retain complete, hash-valid revision-1 WAL and revision-0 snapshots. All ten workflow-store files are byte-identical between cases; both loaders reject STORE_SNAPSHOT_MISMATCH. No repair or workflow effect was replayed.

The diagnostic uses Linux process crashes, not power loss. Lock tokens/incarnations differ naturally; those locks predate the commit and do not attest its sync phase. Knowledge held by the fault injector is not evidence in the store and cannot be supplied as a repair authority flag. Log: `<temporary-directory>/p16c-fsync-window-probe.log`.

## 6. Historical INTENT fixture

A separate inspection copied the historical `p15-live-positive` store and loaded that copy: ANALYZING, revision 2, one INTENT without runId, childSessionId, terminalProofRef or resultRef, and no durable result correlated to the exact assignment. The original inventory remained unchanged.

Read-only outcome: **ambiguous external effect**. This is not proof of no launch and authorizes neither retry, synthetic abort nor completion. It was not a new implemented P16C classifier. Log: `<temporary-directory>/p16c-historical-intent-inspect.log`.

## 7. Clarification required before implementation

STM-002/CR-1 prescribes replay of complete synced events; P16C requires fsync-confirmed events and forbids arbitrary resolution of ambiguity. The then-current format defined neither a sync receipt nor other evidence confirming sync for WAL-ahead/snapshot-behind.

The explicit alternatives were:

**A. Barrier in the repair process.** Authorize repair, under exclusion and after complete verification, to sync the existing WAL prefix and required data, then rebuild the snapshot from existing events. This makes the prefix durable now; it does not prove earlier sync succeeded. No new event or external effect is invented; ambiguous effects remain blocked.

**B. Evidence of prior sync.** Require an explicit receipt/version, or normatively define whether and when a complete correlated temporary snapshot can prove commit ordering. Legacy cases without sufficient proof remain AMBIGUOUS. Mere temporary-file presence is not promoted to authority.

Neither alternative was implicitly selected by this audit. Item 43 required stopping before introducing new semantics. Ownerless legacy guards and unproven INTENTs remain fail-closed, without deletion or replay.

## 8. Platform limits

The code uses file/directory fsync and same-directory rename in the control plane. Sync errors have no silent fallback. The probe is Linux-specific (`/proc`, SIGKILL). Process-crash tests do not certify power-loss durability, hardware caches, remote filesystems or mounts that ignore fsync. This audit adds no cross-platform or unverified-filesystem guarantees.

## Repeated final audit checks

Complete suite: **365/365 PASS**, no failures/cancellations/skips/todos. Historical probe: **1/1 PASS**, originals preserved. Typecheck, package dry-run, dependency audit (zero vulnerabilities) and `git diff --check`: PASS. ARCHITECTURE, PROTOCOL and TEST-MATRIX hashes matched the audit baseline. `git status --short` remained byte-identical, with 68 pre-existing tracked changes and ten untracked files. P16C created/modified no repository files and made no commit. Logs: `<temporary-directory>/p16c-final-*`.

## Historical outcome

P16C was not implemented at this audit checkpoint: the normative durability-evidence/barrier choice for WAL-ahead replay was outstanding. No repair, revision/counter change or provider query occurred. P17 had not begun. These historical results are not current-suite certification.
