**English** · [Italiano](it/PROTOCOL.md)

# P1 — Controlled Workflow Normative Protocol

Historical specification status: **Operational Registration/RPC Binding amendment; its implementation/P6 was not included in that amendment**. `schemaVersion = 1`, except DATA-002 AssignmentEnvelope v2 and explicitly versioned later amendments. Historical phase statements below describe their original checkpoints, not current implementation certification; see [VALIDATION](VALIDATION.md).

Higher authority: [ARCHITECTURE](ARCHITECTURE.md), P0 with this amendment. Original P0 SHA-256, historical only: `bc7e8a646fd591cef3bfea90d0901925018f8bf25a7d1c82954291c80434e010`. Test obligations: [TEST-MATRIX](TEST-MATRIX.md).

## NOR-001 — Interpretation and boundaries

MUST/MUST NOT express normative requirements. This document refines P0 without replacing it. Stable IDs are never reused. Incompatible changes require a new schemaVersion and approval, without coercing historical data. Finite values/formats are P1 specification choices, not claims of verified Pi capabilities.

Only P0 global states exist. Child, evidence and gate states are data, not new workflow states. COMPLETED means a validated local candidate with durable patch/evidence, not original-checkout integration or publication. Later CPG-001 explicitly adds separately authorized project-level local integration. UNVERIFIED items remain unverified; see CAP-001 and the UV register. FUT-CONTRACT/INTEGRATION/RECOVERY/RELEASE are future test milestones, not authorization for numbered project phases.

## A. Global invariants

| ID | Non-negotiable invariant |
|---|---|
| INV-001 | Only Orchestrator validates/persists global state, approvals, counters and finding dispositions. |
| INV-002 | Children cannot select global state or declare COMPLETED; termination is evidence only. |
| INV-003 | Developer cannot authoritatively validate its own work; exploratory checks satisfy neither TESTING nor REVIEWING. |
| INV-004 | Reviewer is independent, fresh and read-only, and cannot correct the candidate it reviews. |
| INV-005 | Oracle is advisory, only for ambiguity, blockage or repeated failure; it approves no decision. |
| INV-006 | Scope expansion requires a valid onScopeChange gate and new specification revision. |
| INV-007 | Free text, arbitrarily extracted JSON and steering messages authorize no transition. |
| INV-008 | `ok: true`, child exit zero and dispatch receipts do not equal workflow success. |
| INV-009 | Missing, NOT_RUN, INVALID, FAILED or TIMED_OUT tests are not PASSED. Every required check must pass. |
| INV-010 | No model, child or model-callable tool can create human approval, including indirectly through a command. |
| INV-011 | Candidate/spec changes invalidate evidence/approval bound to the old identity; historical records remain. |
| INV-012 | Ambiguity, contradiction, unknown outcomes or unverified required capabilities prevent positive progress. |
| INV-013 | Scope defaults to deny; deny overrides allow. Children cannot be authorized to write the ledger, Git metadata or credentials. |
| INV-014 | One writer per canonical workspace; no validation/review while its candidate is mutating. |
| INV-015 | Task execution does not alter the original checkout, Pi or pi-subagents, or merge/push/publish. CPG-001 separately authorizes local project integration. |
| INV-016 | Results bind actual runtime-attributed task, assignment, attempt, role, session and run. Model-declared identity is insufficient. |
| INV-017 | Persisted counters never decrease; retries/escalations are finite and do not reset with session/spec changes. |
| INV-018 | Unknown intent outcomes require reconciliation before redispatch. No implicit protocol, runner or model fallback. |
| INV-019 | Only listed TR transitions are permitted, with expected revision and locks. COMPLETED/FAILED have no outgoing transition. |
| INV-020 | Required evidence cannot be merely a reference to an unavailable temporary artifact. |
| INV-021 | Mutation requires clean Git, a resolvable commit/ref and verifiable handoff/candidate. No automatic commit/stash repairs admission. |
| INV-022 | Contract objects are closed, versioned, structurally and semantically validated. |
| INV-023 | Reviewer PASS is necessary but insufficient; CMP-001 canComplete governs completion. |
| INV-024 | Tool allowlists, cwd and worktrees are not OS sandboxes. Required but unproven strong confinement blocks mutation. |
| INV-025 | Scout/Oracle cannot modify files. Controlled agents are leaves without delegation or unauthorized ambient extensions. |
| INV-026 | Human approval authorizes one precise decision, never waiver of correctness gates. Ambiguous specs/unverifiable criteria cannot reach READY. |

## B. Formal state machine

### STM-001 — States

| State | Operational meaning |
|---|---|
| PENDING | TaskSpec structurally accepted; analysis not started. |
| ANALYZING | Scout/preliminary checks, with Oracle only for an explicit trigger. |
| READY | Specification, scope and validation program frozen and unambiguous. |
| IMPLEMENTING | Authorized Developer assignment, including handoff collection before TESTING. |
| TESTING | Scope/digest rechecked and authoritative validation of a materialized candidate. |
| REVIEWING | Independent Reviewer or deterministic final reevaluation of its evidence. |
| REWORK | Attributed defect/admitted finding; no writes before another authorized assignment. |
| BLOCKED | Missing capability, integrity or information; no positive progress. |
| AWAITING_HUMAN | Pending gate with frozen resumeState. |
| COMPLETED | Positive terminal state justified by CMP-001. |
| FAILED | Negative terminal state retaining reason and available artifacts. |

### STM-002 — Common semantics for every TR row

Each row is `(source, target, actor=Orchestrator, guard/evidence, effect, invalidation, event, crash)`. Compact columns MUST inherit these definitions; they grant no implicit authority.

Common G0: exact state/revision, valid schema, task lock and workspace lock when mutable, authorized host actor, no identity conflict. Writes/dispatch require verified capability and durable intent. Unnamed side effects are forbidden. Malformed input is rejected before task creation without inventing a state.

Additional evidence:

- **A**: available input snapshots/hashes, remaining budgets, controlled Scout assignment.
- **R**: valid ScoutResult; ambiguities empty/resolved by durable decisions; verifiable criterion IDs/methods; nonempty required commands; frozen spec/scope. Mutation needs proven Git/capability admission before READY.
- **I**: R remains valid; required beforeImplementation gate satisfied; previous writer provably terminal; source/baseline integrity; remaining Developer budget; new scoped fresh assignment.
- **T**: valid attributed DeveloperResult without blockedReason; proven writer termination; complete durable handoff, exact base, validated patch and candidate materialized in IMPLEMENTING after writer exit. Scope/digest obtained before TESTING.
- **V**: materialized in-scope candidate; every required validation PASSED on current digest/spec; no mutation/unknown identity; verified independent Reviewer profile.
- **C**: all CMP-001 conditions recalculated true immediately before commit.
- **W**: concrete attributed defect, accepted in-scope finding, failure evidence, terminal writer; next attempt not yet consumed. Exhausted budgets may enter REWORK only to select escalation/failure, never to launch.
- **B**: identified technical/information reason and missing/contradictory evidence; no success inference.
- **H**: typed gate request, explicit GAT-001 target, frozen data/hash, no active/unreconciled writer. Without proven quiescence, enter BLOCKED first.
- **F**: final human rejection, unrecoverable violation or exhausted budget without an enabling decision. Stop/reconcile live runs; unknown runs stay BLOCKED without claiming successful cleanup.
- **U**: new evidence resolves the block, repository/process state is known and all target guards hold.
- **X**: recovery detects inconsistency while the last trustworthy state is nonterminal; preserve contradictory evidence.
- **GA**: verified distinct authority: authentic DirectHumanApproval or PA-001 PolicyDerivedAuthorization for an eligible v2 gate. Exact gate/hash/revision, single consumption and unchanged target guards. Oracle/exhausted-retry decisions remain human-only.

Permitted effects:

- **analyze**: freeze Scout assignment/intent, obtain result; Oracle only under RET-001.
- **ready**: freeze approved spec, scope and commands; no writer launch.
- **implement**: reserve counters, record intent, launch one Developer outside the original.
- **test**: recheck materialized candidate scope/digest and execute authorized commands. Handoff/materialization is a RECORD in IMPLEMENTING after writer termination, before TR-013.
- **review**: supply a fresh Reviewer packet; return from a final gate reuses valid review without automatic child launch.
- **rework**: persist findings/dispositions and bounded correction plan without file changes.
- **block**: suspend new effects, record reason, request safe stop/status when needed, preserve proof.
- **gate**: persist HumanGate and request explicit native Pi confirmation; no automatic answer.
- **fail/complete**: preserve durable evidence and terminal state; no merge/push/destructive cleanup.
- **resume**: consume the gate once and execute only the recorded target/continuation effect, never replay attributed spawns.

Invalidations:

- **N**: no new invalidation; freshness checks still apply.
- **E**: test/review/final evidence and candidate-bound gates cannot authorize a new candidate. The old basis remains historical.
- **S**: E plus previous analysis/spec approvals/assignments when specification changes; retain history.
- **Q**: quarantine evidence affected by the block until reconciled.
- **G**: consumed gate cannot be reused; approval remains evidence while hash/content match. Apply S/E as well if the decision changes spec/candidate.

Every row emits TransitionEvent with matching `transitionId`, `kind=TRANSITION`, source/target/revisions/reason/evidenceRefs. **CR-1**: WAL precedes snapshot; replay only complete synced events, external effects through separate intent. A committed event does not prove its external effect finished. Unknown outcomes require reconciliation, then an explicit recovery TR if inconsistent; no blind replay. See PST-001.

### STM-003 — Exhaustive transitions

All rows use Orchestrator, event and CR-1 from STM-002.

| ID | Source | Target | Guard/evidence | Effect | Invalidation |
|---|---|---|---|---|---|
| TR-001 | PENDING | ANALYZING | A | analyze | N |
| TR-002 | PENDING | AWAITING_HUMAN | H | gate | N |
| TR-003 | PENDING | FAILED | F | fail | Q |
| TR-004 | PENDING | BLOCKED | X | block | Q |
| TR-005 | ANALYZING | READY | R | ready | N |
| TR-006 | ANALYZING | BLOCKED | B or X | block | Q |
| TR-007 | ANALYZING | AWAITING_HUMAN | H | gate | N |
| TR-008 | ANALYZING | FAILED | F | fail | Q |
| TR-009 | READY | IMPLEMENTING | I | implement | E |
| TR-010 | READY | AWAITING_HUMAN | H | gate | N |
| TR-011 | READY | FAILED | F | fail | Q |
| TR-012 | READY | BLOCKED | X | block | Q |
| TR-013 | IMPLEMENTING | TESTING | T | test | N |
| TR-014 | IMPLEMENTING | REWORK | W | rework | E |
| TR-015 | IMPLEMENTING | BLOCKED | B or X | block | Q |
| TR-016 | IMPLEMENTING | AWAITING_HUMAN | H | gate | N |
| TR-017 | IMPLEMENTING | FAILED | F | fail | Q |
| TR-018 | TESTING | REVIEWING | V | review | N |
| TR-019 | TESTING | REWORK | W | rework | E |
| TR-020 | TESTING | BLOCKED | B or X | block | Q |
| TR-021 | TESTING | FAILED | F | fail | Q |
| TR-022 | REVIEWING | COMPLETED | C | complete | N |
| TR-023 | REVIEWING | REWORK | W | rework | E |
| TR-024 | REVIEWING | BLOCKED | B or X | block | Q |
| TR-025 | REVIEWING | AWAITING_HUMAN | H | gate | N |
| TR-026 | REVIEWING | FAILED | F | fail | Q |
| TR-027 | REWORK | IMPLEMENTING | I and admitted findings | implement | E |
| TR-028 | REWORK | ANALYZING | A and recorded reanalysis need | analyze | S |
| TR-029 | REWORK | BLOCKED | B or X | block | Q |
| TR-030 | REWORK | AWAITING_HUMAN | H | gate | N |
| TR-031 | REWORK | FAILED | F | fail | Q |
| TR-032 | BLOCKED | ANALYZING | U and A | analyze | S if new spec, otherwise N |
| TR-033 | BLOCKED | REWORK | U and W | rework | E |
| TR-034 | BLOCKED | AWAITING_HUMAN | H | gate | N |
| TR-035 | BLOCKED | FAILED | F | fail | Q |
| TR-036 | AWAITING_HUMAN | PENDING | GA and resumeState=PENDING | resume | G |
| TR-037 | AWAITING_HUMAN | ANALYZING | GA and resumeState=ANALYZING and A | resume/analyze | G, S if new spec |
| TR-038 | AWAITING_HUMAN | READY | GA and resumeState=READY and R | resume/ready | G |
| TR-039 | AWAITING_HUMAN | IMPLEMENTING | GA and resumeState=IMPLEMENTING and I | resume/implement | G+E |
| TR-040 | AWAITING_HUMAN | REVIEWING | GA and resumeState=REVIEWING and V | resume/review | G |
| TR-041 | AWAITING_HUMAN | REWORK | GA and resumeState=REWORK and W | resume/rework | G+E |
| TR-042 | AWAITING_HUMAN | BLOCKED | B or X, or GA with resumeState=BLOCKED | block | Q; G if consumed |
| TR-043 | AWAITING_HUMAN | FAILED | F | fail | Q; close gate |

Allowed P0 resumeState expansion: `{PENDING, ANALYZING, READY, IMPLEMENTING, REVIEWING, REWORK, BLOCKED}`. Approval cannot manufacture TESTING/COMPLETED/FAILED targets: they require TR-013/TR-022/TR-043 respectively. A gate cannot choose its own target.

Recovery on BLOCKED records reconciliation without a self-transition. Terminal states have no TR. A corrupt terminal ledger is rejected/quarantined by the loader, never exposed as valid completion or rewritten through an invented transition.

### STM-004 — Updates without state changes

Results, intent, run binding, counters, escalations, decisions and progress create RECORD events (DATA-010) and increment revision without changing `state`. Only Orchestrator may record:

- ANALYZING: Scout/Oracle, analysis and decisions.
- IMPLEMENTING: Developer, handoff, terminal proof and deterministic materialization after quiescence.
- TESTING: candidate, scope and ValidationResult.
- REVIEWING: ReviewResult, dispositions and final checks.
- REWORK/BLOCKED: reconciliation, diagnosis and conditional Oracle.
- AWAITING_HUMAN: gate decision/diagnostics only; no new child.
- PENDING/READY: diagnostics, snapshots and capability checks; no writer.
- Terminal states: no new mutating task record.

A failure before IMPLEMENTING rejects TR-009/027/039. READY has no generic fallback transition: incompatible admission changes are reconciliation inconsistency handled through TR-012. A scope request in TESTING first uses TR-020, then TR-034; TESTING→AWAITING_HUMAN is illegal.

## C. Data contracts

### DAT-000 — Common notation and validation

Notation means JSON Schema plus explicit semantic constraints. `?` is optional; all other fields are required. Every object, including nested objects, has `additionalProperties:false`. Null requires an explicit type. Missing is not false/zero/PASSED. No numeric-string coercion or removal of unknown fields. Named structures have schemaVersion 1 unless explicitly versioned (DATA-002 requires 2); no open dictionaries.

- `ID`: unique in its set, ASCII 1–128, `[A-Za-z0-9][A-Za-z0-9._-]*`.
- `Text`: nonempty UTF-8, max 4096 bytes, no NUL; `LongText`: max 65536 bytes.
- `UInt`: safe integer 0..9007199254740991; reject overflow; policy caps still apply.
- `Hash`: 64 lowercase hexadecimal SHA-256 digits; `GitOID`: repository-compatible 40/64 hex.
- `Time`: RFC3339 UTC ending Z; durations are UInt milliseconds; timeouts 1..2147483647 ms.
- `Path`: SCP-001 relative path, max 4096 bytes. `Root`: host-verified canonical absolute path, max 4096 bytes, never derived from child output.
- `State`: one of STM-001's eleven states. `Role`: Scout|Developer|Reviewer|Oracle.
- `List<T>[a..b]`: inclusive array cardinality; no duplicate IDs/references/paths.

Serialized limits: TaskSpec/AssignmentEnvelope 256 KiB each; each result 1 MiB; WorkflowState 4 MiB; TransitionEvent 1 MiB. Excess is invalid/BLOCKED, not semantically lossy truncation. Large data belongs in artifacts; hashes bind actual retained bytes. Contract packets/logs must not contain secrets.

Canonical object hashing uses UTF-8 JSON without whitespace, code-point-ordered keys, declared array order, integers only, no duplicate keys, no isolated Unicode surrogates or silent normalization. Quote/backslash are escaped; U+0000..001F use lowercase `\u00xx`; other characters remain literal. Exclude self-hash fields only where specified. Unrepresentable/colliding identities cause BLOCKED, never permissive normalization.

#### Canonical integer representation

Validated field-bounded integers use ASCII base-10 decimal: no plus sign, fraction, exponent or leading zero except zero itself; minus only for strictly negative values. IEEE-754 `-0` canonicalizes to `0`. Equivalent numeric values produce identical canonical bytes regardless of lexical JSON spelling. NaN, infinities, fractions and out-of-range values are invalid and never canonicalized. No floating-point support or parsing-limit change is introduced.

Normative examples show canonical text on the right. Negative values are permitted only in fields such as exitCode, never UInt:

```text
0   -> "0"
-0  -> "0"
1   -> "1"
-1  -> "-1"
42  -> "42"
```


### AUX-001 — Closed shared types

Every record implicitly includes `schemaVersion:1`; unmarked fields are required.

| Type | Fields and limits | Semantic constraints |
|---|---|---|
| ArtifactRef | id:ID, digest:Hash, relativeStorePath:Path, bytes:UInt, mediaType:Text | Path inside Orchestrator storage; verify digest/size; never read arbitrary child-suggested paths. |
| InputSource | inline?:LongText, path?:Root, snapshot:ArtifactRef | Exactly one of inline:LongText or path:Root, plus snapshot:ArtifactRef. Approved/read contents match snapshot bytes. Path is provenance, not write authority. |
| Requirement | id:ID, text:Text | Unique ID referenced by at least one criterion. |
| Criterion | id:ID, requirementIds:List<ID>[1..256], text:Text, method:AUTOMATED\|REVIEW\|BOTH, commandIds:List<ID>[0..64], reviewInstruction:Text | AUTOMATED/BOTH require nonempty commandIds, all required=true; REVIEW requires an empty array. All IDs resolve. Reviewer also checks AUTOMATED criteria. |
| CommandSpec | id:ID, executable:Root, argv:List<Text>[0..64], timeoutMs:UInt positive, required:boolean | cwd is always the candidate. No implicit shell/task interpolation. Exact executable/arguments require approval; stdout/stderr are not verdicts. Explicit shell commands require the same trust/approval and are never inferred. |
| ScopeSpec | repoRoot:Root, baseRef:Text, allowedPaths:List<Path>[0..4096], deniedPaths:List<Path>[0..4096], strongConfinementRequired:boolean | SCP-001 applies. Input omission normalizes baseRef to HEAD. Empty allow cannot permit mutation. |
| RetryPolicy | maxReworkAttempts:UInt, maxInfrastructureRetries:UInt, maxDispatches:UInt, maxEscalationEpisodes:UInt | Defaults 2,1,64,4; RET-001 and approved global ceilings apply. |
| GatePolicy | beforeImplementation:boolean, onScopeChange:true, onOracleDecision:boolean, beforeCompletion:boolean, onRetryExhausted:boolean | All default true; scope gate cannot be disabled. No policy lets a model approve. |
| Observation | id:ID, text:Text, evidenceRefs:List<ID>[1..64] | Existing evidence references; not standalone proof. |
| Risk | id:ID, text:Text, criterionIds:List<ID>[0..256], blocking:boolean | Blocking risk or unverifiable requirements prevent PASS/completion. |
| Finding | id:ID, text:Text, severity:P0\|P1\|P2, blocking:boolean, paths:List<Path>[0..64], criterionIds:List<ID>[0..256], evidenceRefs:List<ID>[1..64] | Concrete finding on the candidate, not new authority. |
| Assessment | status:PASS\|FAIL\|UNVERIFIABLE, evidenceRefs:List<ID>[0..64], reason:Text | PASS/FAIL require nonempty evidence; UNVERIFIABLE cannot satisfy a criterion. |
| CriterionAssessment | criterionId:ID, assessment:Assessment | Exactly one assessment for every TaskSpec criterion. |
| DecisionRecord | id:ID, kind:ACCEPT_FINDING\|DISMISS_FINDING\|DEFER_RISK\|RESOLVE_RISK\|ADOPT_ADVICE\|REJECT_ADVICE\|RESOLVE_AMBIGUITY, subjectId:ID, reason:Text, evidenceRefs:List<ID>[1..64], humanGateId?:ID | Orchestrator decision; cannot waive criteria. Scope/product tradeoffs require a gate. |
| RunRecord | assignmentId:ID, attemptId:ID, role:Role, requestId:ID, runId?:Text, childSessionId?:Text, ownerSessionId:Text, status:INTENT\|BOUND\|RUNNING\|TERMINAL\|UNKNOWN, terminalProofRef?:ID, resultRef?:ID | BOUND and later require runId; TERMINAL requires proof. Runtime supplies identities, not the child. |
| FailureRecord | id:ID, phase:State, category:INFRA\|TEST\|REVIEW\|SCOPE\|SCHEMA\|RECOVERY\|AMBIGUITY, code:ID, subjectIds:List<ID>[0..64], fingerprint:Hash, evidenceRefs:List<ID>[1..64] | RET-001 fingerprint; never change category to obtain more retries. |
| Counters | attempts:UInt, reworkAttempts:UInt, infrastructureRetries:UInt, dispatches:UInt, escalationEpisodes:UInt, oracleInvocations:UInt | Monotonic; each increment binds intent or an episode. |
| Escalation | id:ID, triggerFailureIds:List<ID>[1..64], question:Text, oracleAttemptId?:ID, resultRef?:ID, decisionId?:ID, closed:boolean | One Oracle dispatch per episode; closure requires a reasoned decision. |
| Candidate | root:Root, baseCommit:GitOID, digest:Hash, generation:UInt, manifest:ArtifactRef, patch:ArtifactRef, handoff:ArtifactRef, terminalProof:ArtifactRef | Recompute digest; root differs from original; generation increases even if rework restores earlier bytes. |
| CapabilityEvidence | id:ID, itemId:ID, status:VERIFIED\|UNVERIFIED\|FAILED, environmentHash:Hash, evidenceRefs:List<ID>[0..64] | VERIFIED requires a passed relevant check; changed environment/version invalidates attestation. |
| HumanDecisionEvidence | id:ID, gateId:ID, taskId:ID, decision:APPROVE\|REJECT\|ANSWER, answer?:Text, actorId:Text, channelId:ID, confirmationId:ID, displayedRevision:UInt, displayedDataHash:Hash, confirmedAt:Time, trustedChannelEvidenceRef:ID | Created only by the verified host confirmation channel; ANSWER requires answer text. Attested transport binds identity/revision/hash to that confirmation. GAT-002 separates historical v1 binding from v2 GatePresentation, without implicit migration. Untrusted model/file JSON is not proof; ANSWER is not APPROVE. |
| CandidateEntry | path:Path, kind:FILE\|SYMLINK, mode:100644\|100755\|120000, contentHash:Hash | mode is a string; kind/mode agree. Hash file bytes or link target without following it. |
| CandidateManifest | baseCommit:GitOID, entries:List<CandidateEntry>[0..100000] | Unique paths ordered by UTF-8 bytes; max 64 MiB manifest, otherwise BLOCKED. Each record includes schemaVersion in its digest. |

Every evidence ID resolves to a host-registered typed ArtifactRef; syntactically valid but unattributed IDs are invalid. References bind actual reads/traces, never arbitrary paths. HumanDecisionEvidence transport remains UNVERIFIED until UV-007 is satisfied.

RetryPolicy is configurable before the task: maxReworkAttempts 0..approved global ceiling (default 2), maxInfrastructureRetries 0..1 per task, maxDispatches 1..64, maxEscalationEpisodes 1..4. Caps cannot fall below consumed counters or be raised for an exhausted active task.

### DATA-001 — TaskSpec

| Field | Type | Meaning/validation |
|---|---|---|
| schemaVersion | 1 | Required. |
| taskId | ID | Durable identity, unchanged by retry. |
| specRevision | UInt | Starts at 0; new specification increments by one. |
| title | Text | Title. |
| objective | LongText | Bounded objective. |
| plan | InputSource | Inline or explicit path; no magic filename. |
| currentTask | InputSource | Explicit task snapshot. |
| requirements | List<Requirement>[1..256] | Unique IDs. |
| acceptanceCriteria | List<Criterion>[1..256] | Complete requirement coverage. |
| scope | ScopeSpec | Default deny. |
| constraints | List<Text>[0..128] | Cannot override invariants. |
| validationCommands | List<CommandSpec>[1..64] | At least one required=true. |
| humanGates | GatePolicy | Normalize defaults before hashing. |
| retryPolicy | RetryPolicy | Normalize defaults. |
| sourceApprovalGateId? | ID | Required for model-extracted requirements/criteria. |
| specHash | Hash | Canonical object hash excluding only specHash. |

Reject absent/unreadable/mismatched sources, duplicate/dangling IDs, criteria without methods, wrong hashes, contradictory constraints, unauthorized commands and unrepresentable scope. Structural validity without resolved ambiguity remains ANALYZING/BLOCKED, not READY. Source changes after freeze require a gate/reanalysis and immutable versions, never in-place specification updates.

### DATA-002 — AssignmentEnvelope

| Field | Type | Meaning/validation |
|---|---|---|
| schemaVersion | 2 | Required CLA-001 launchContractHash semantics; no v1 coercion. |
| assignmentId, taskId, attemptId | ID each | Distinct dispatch identity. |
| role | Role | One role. |
| specHash | Hash | Current frozen specification. |
| objective | LongText | Authorized subtask, not extra scope. |
| repoRoot | Root | Original provenance. |
| workRoot | Root | Actual permitted child root. |
| baseRef | Text | Approved ref, not an expression/raw SHA for pi-subagents allocation. |
| baseCommit? | GitOID | Required for Developer/Reviewer. |
| allowedPaths, deniedPaths | List<Path>[0..4096] each | Approved scope copy; allow grants no writes to a read-only role. |
| requirements, acceptanceCriteria | As TaskSpec | Exact relevant requirements; Reviewer gets all. |
| constraints, stopConditions | List<Text>[0..128], List<Text>[1..128] | Include scope/ambiguity/schema stops. |
| inputArtifactRefs | List<ID>[0..256] | Verified references only. |
| authority | List<ID>[0..16] | AUT-001 operations, subset of role grants. |
| validationCommands | List<CommandSpec>[0..64] | Developer exploration is not authoritative; Reviewer receives metadata/logs without execution permission. |
| context | fresh\|fork | Scout/Developer/Reviewer require fresh; Oracle fork only when verified. |
| candidateDigest?, candidateGeneration? | Hash, UInt | Both present or absent; required for Reviewer. |
| launchContractHash | Hash | Canonical SHA-256 of package-owned CLA-001, never provider launchContractDigest. |
| assignmentHash | Hash | Canonical hash excluding assignmentHash. |

Reject excess authority, non-subset scope, wrong candidate, forked Reviewer or inconsistent identity/hash. Resolve and recheck approved refs at launch to avoid moving HEAD.

### CLA-001 — ControlledLaunchContract (Controlled Launch Authority Contract)

Closed object, max 64 KiB, no optional/unknown fields. This deterministic pre-dispatch projection of package authority is not a provider-contract copy. Fixed names: Scout→`controlled.scout`, Developer→`controlled.developer`, Reviewer→`controlled.reviewer`, Oracle→`controlled.oracle`. Reject aliases, path-like names and names selected by TaskSpec/model.

| Field | Type/limit | Meaning |
|---|---|---|
| schemaVersion | 1 | Independent authority-contract version. |
| controlledAgentId | ID | Exact fixed role name. |
| registrationProtocolVersion | 1 | Event registration v1. |
| expectedRole | Role | Matches AssignmentEnvelope.role. |
| baseSystemPromptHash | Hash | SHA-256 of exact controlled base-prompt UTF-8 bytes, not task/provider-augmented prompt. |
| systemPromptMode | replace\|append | Minimum Scout/Reviewer/Oracle use replace; normal overrides cannot broaden it. |
| contextPolicy | ControlledContextPolicy | Assignment context must be a permitted member and satisfy DATA-002. |
| allowedTools, excludedTools | List<ID>[0..64] each | Explicit named allow/deny lists; no paths or implicit grants. |
| allowNestedSubagents | false | Controlled children are leaves. |
| inheritProjectContext, inheritGlobalContext, inheritSkills | boolean each | Explicit controlled values, not implicit host defaults. |
| extensions, subagentOnlyExtensions | List<ControlledExtensionRef>[0..16] each | Explicit ordered lists; no ambient discovery. |
| mutationTools | List<ID>[0..64] | Classification alone grants no tool/write access. |
| internalProtocolTools | List<ID>[0..1] | Exactly `["structured_output"]` for DATA-003..006; no other implicit internal tool. |
| capabilityConstraints | ControlledCapabilityConstraints | Logical authority separate from preferences/task scope. |

Closed nested schemaVersion-1 records:

- **ControlledContextPolicy**: `defaultContext:fresh|fork`, `allowedContexts:List<fresh|fork>[1..2]`; default must be listed. Scout/Developer/Reviewer use fresh and `["fresh"]`. Oracle may permit fork only under CAP-001/RET-001, without fallback. Policy changes change the hash.
- **ControlledExtensionRef**: `id:ID`, `artifactHash:Hash`. Package-controlled resource identity and immutable bundle digest covering required executable dependencies, host-resolved before dispatch. Not a provider path. Unverifiable resource/dependency closure blocks; entrypoint-only hashes with unknown dependencies are insufficient. Scout lists are empty.
- **ControlledCapabilityConstraints**: `operationIds:List<ID>[0..14]` limited to role ALLOW/ALLOW* OP-01..OP-14 (PROPOSE_ONLY is no grant); `mutationPolicy:DENY|ASSIGNMENT_SCOPE`; `scopePolicy:"SCP-001"`; `additionalRuntimePermissions:"NONE"`. Scout/Reviewer/Oracle use DENY; Developer uses ASSIGNMENT_SCOPE only with conditional OP-02. No global-state, original-write, delegation, merge/push/publish grant. No arbitrary native permissions. Unrepresentable required restrictions demand explicit revision or BLOCKED, never omission. Provider support/enforcement must be verified rather than inferred from package policy; AUT/SCP remain binding.

Set-like lists (allowed/excluded/mutation/internal tools, allowedContexts, operationIds) are duplicate-free and code-point sorted; reject malformed ordering rather than repair it. Extension lists preserve order and prohibit duplicate IDs. Mutating allows must match role/policy; `subagent` or equivalent delegation is forbidden. Every authority-sensitive definition field must be represented; new fields require version/amendment or blocking.

Definition mapping: name→controlledAgentId, tools→allowedTools, excludeTools→excludedTools, defaultContext→contextPolicy.defaultContext. Base prompt, mode, nesting, inheritance and mutation tools must match the contract/hashes. Extension refs resolve only verified immutable package resources, never task/model paths. InternalProtocolTools represents outputSchema protocol needs, not another arbitrary allowlist. AUT/SCP govern host/assignment and must not be sent as invented provider fields. Model/provider/thinking cannot alter authority projection. Unrepresentable authority-sensitive request fields block rather than silently disappear from hashing.

`launchContractHash = SHA256(canonicalJSON(ControlledLaunchContract))` under DAT-000, including every field; there is no self-hash. Immutable definitions produce the contract; verify prompt/resource hashes against actual bytes. Assignment hash includes launchContractHash and schemaVersion 2. Preserve a typed, host-resolvable contract ArtifactRef keyed by hash; verify name/role/context/hash before spawn. Hashing proves neither owner authenticity nor enforcement.

**Exclusions:** non-authority model/provider/thinking/fast preferences are neither fields nor indirect hash inputs. Preserve them as attributed execution metadata. Also exclude run IDs, timestamps, task text, volatile task/runtime scope paths, transcripts, model output and provider digests. Specific scope remains bound by specHash/assignmentHash/SCP-001. Authority changes alter the hash; lawful preference changes do not. This authorizes no model fallback.

**Compatibility:** DATA-002 v1 remains historical with its original semantics, not usable for new amended dispatches. Never relabel it v2 or replace its digest automatically. Other DATA records retain v1 and bind the new assignment through assignmentHash. At the amendment checkpoint, P4/P5 were neither changed nor declared compliant; later alignment required authorization/tests. The amendment itself started no migration/recovery/P6.


### REG-001 — RuntimeAgentRegistrationBoundary and Operational Binding

Public process-local event `pi-subagents:runtime-agent-register:v1` is emitted through `pi.events`, without importing `pi-subagents/agents`. Request `{version:1,name,definition}` receives synchronous `result`. Success requires `result.ok===true` and callable `registration.dispose`. No result means capability unavailable; incompatible/error results block required use. Never repair rejected definitions or search for installations/other launchers. Provider Error/disposer wire objects are not DAT-000 persistent JSON records.

Pi resolves packages by identity; project entries normally replace equivalent personal entries rather than loading duplicates. Trust the running Pi host, loaded extensions and loaded pi-subagents as infrastructure. Do not infer installations or count disk copies. Deliberately hostile host extensions imitating the contract are outside the normal threat model; observable anomalies remain fail-closed.

A Controlled Runtime Agent is the package's fixed name/immutable definition, registered process-locally and resolved/executed through RPC in that same runtime, with handle cleanup. Runtime registration is the only controlled source; `agents/*.md` are unregistered documentation/templates. Registration launches nothing and grants no global authority.

**EXTENSION-OWNED:** base prompt/mode, tools/exclusions, nesting, context policy, project/global/skill inheritance, extensions/subagent-only extensions, mutation tools and relevant permission/capability constraints. Every required field must be supported and verified; ordinary configuration cannot broaden authority. **OPERATOR-CONFIGURABLE:** documented model/provider/thinking/fast preferences that do not change authority. Indirect changes to tools/context/inheritance are escalation. Internal provider output/acceptance/bridge prompt augmentations are distinct from the base prompt and grant no extra CLA-001 tools.

Operational binding in one Pi session/runtime requires: (1) accepted registration v1, (2) exact controlled name, (3) package-produced definition, (4) active handle, (5) same-process RPC v1, (6) RPC resolves that exact runtime name, (7) valid spawn runId, (8) correlated completion, (9) attributed structured output, (10) no EVD-001 post-launch identity/authority contradiction. No extra provider owner-ID equality is required.

Before spawn, the host locally binds handle, definition snapshot, contract artifact/hash, session and runtime generation and verifies points 1–6. Points 7–10 complete binding after launch. This is no provider authentication token/full attestation; a receipt alone is insufficient.

Closed **ControlledRegistrationEvidence**, schemaVersion 1, max 64 KiB: `id:ID`, `controlledAgentId:ID`, `expectedRole:Role`, `registrationProtocolVersion:1`, `rpcVersion:1`, `ownerSessionId:Text`, `runtimeGeneration:ID`, `launchContractHash:Hash`, `contractRef:ID`, `definitionRef:ID`, `accepted:true`, `handleActiveAtObservation:true`, `capabilityEvidenceRefs:List<ID>[1..64]`. References are attributed host ArtifactRefs. ownerSessionId is the host session, runtimeGeneration the local package generation, not undisclosed provider internals. Recheck handle liveness in memory before each dispatch; a persisted record/model JSON is insufficient. Never invent providerOwnerId/executorOwnerId.

Receipts expose no full definition snapshot/digest, source metadata, uniqueness or internal provider identity; never attribute those properties to them. Theoretical multiple responders alone do not block. Concrete incompatible/contradictory replies do; identical duplicates may be idempotent only if every other check agrees.

Block observed duplicate names/aliases, static-profile ambiguity, contradictory registration, unresolved runtime names, unexpected runtime source/tools/context/extensions/delegation, unattributable output, invalid handles and unreconciled session/runtime replacement. Static collisions may be discovered after registration depending on cwd; prior acceptance does not override RPC rejection. Unexpected post-launch source quarantines evidence and prevents new dispatch. Never rename/sanitize names or broaden IDs merely because a provider accepts path-like names.

Register at session startup with a compatible service. Keep handles only in the current runtime; dispose on shutdown/reload, remove bindings and close owned listeners. Test idempotence. New runtime/session requires fresh registration, never deserialized old handles. Dispose neither stops an existing run nor authorizes UNKNOWN retry; RPC/PST-001 reconciliation still applies. Normal lifecycle is not advanced recovery.

### SCOUT-001 — Minimum controlled.scout contract

Fixed `controlled.scout`, expectedRole Scout, bounded package base prompt, replace mode, default/assignment context fresh, allowedContexts `[fresh]`. allowedTools `[read]`; excludedTools `[bg_wait,contact_supervisor,watchdog_diff]` in canonical order. All other tools, including write/edit/bash/subagent, are denied. No nesting or inheritance; extension/subagent-only/mutation lists empty. internalProtocolTools `[structured_output]`; operationIds `[OP-01]`, mutationPolicy DENY, scopePolicy SCP-001, additionalRuntimePermissions NONE. No external runner, machine binding or state/scope/publication grant. Unsupported required fields block.

Output is DATA-003 with DAT-RESULT, revalidated and correlated to assignment/run/session. recommendedScope remains PROPOSE_ONLY. Children cannot repair unresolved ambiguities. The exact prompt hash derives from an implemented/authorized definition, never an invented amendment placeholder. The amendment itself created no operational profile.

### EVD-001 — Independent post-launch verification and provider digests

Using attributable runtime evidence, independently verify runtime identity/source, effective fresh context, full effective tool registry (not merely invoked tools), extensions, no-delegation and structured-output attribution. For read-only roles, compare before/after file hashes, inventory, differences and relevant metadata, including additions/deletions/renames. Read-only canaries are required. A history canary is no absolute leakage proof; an allowlist is no OS sandbox. Unobservable required properties remain UNVERIFIED and prevent acceptance. Receipt/name/hash alone cannot establish PASS.

Spike artifacts are experimental evidence, not a new authorized production API. Integration must document/test provenance without private imports. P4 data validation does not authenticate transport; Orchestrator retains global authority.

Preserve package launchContractHash separately from provider launchContractDigest values, including issuer, field/level (spawn/main completion/child), run/session and original-byte references. Provider digests are not universal trust roots. Never copy them into the package hash, normalize them to agree or impose cross-domain equality without a future specification proving identical bytes/objects.

Open historical issue: provider launchContractDigest consistency under operator model/provider/thinking overrides, observed in 0.72.1; cause unresolved. Differences across provider levels are retained and do not alone block independently proven authority/identity. They also do not prove equivalence. Contradictions in the same correlated evidence field, wrong package hash, mismatched source/tools/context or missing required proof still block. Spec/candidate/assignment hashes and contradictory duplicate completion rules have no exception.

### DAT-RESULT — Common result envelope

DATA-003..006 all contain `schemaVersion:1`, taskId/assignmentId/attemptId as ID, exact typed Role, specHash/assignmentHash as Hash and `evidenceRefs:List<ID>[0..256]`. Orchestrator binds actual run/session through RunRecord, not model attestation. Wrong schema/role/assignment, missing refs, contradictory duplicates, absent runtime structured output or ambiguous transport identity invalidate results. JSON printed as prose cannot replace verified structuredOutput. Validity is not acceptance.

### DATA-003 — ScoutResult

| Field | Type | Meaning/validation |
|---|---|---|
| observations | List<Observation>[0..128] | Evidence-backed facts. |
| relevantFiles | List<Path>[0..1024] | Files actually inspectable in the repository. |
| risks | List<Risk>[0..128] | Declared risks; explicitly empty when none. |
| ambiguities | List<Text>[0..128] | Nonempty ambiguities block READY until resolved. |
| recommendedScope | ScopeSpec | PROPOSE_ONLY; cannot overwrite TaskSpec. |

A run that writes files violates INV-025 and invalidates its evidence even if transport succeeded.

### DATA-004 — DeveloperResult

| Field | Type | Meaning/validation |
|---|---|---|
| summary | Text | Report, not global verdict. |
| changedFiles | List<Path>[0..4096] | Declared changes compared with actual differences. |
| commandsRun | List<ID>[0..64] | Permitted attributable exploratory commands. |
| tests | List<Observation>[0..128] | Exploratory reports, never authoritative ValidationResult. |
| residualRisks | List<Risk>[0..128] | Must not hide blockers. |
| blockedReason? | Text | Presence prevents progress to TESTING. |

Runtime/host collects handoff and patch; report paths cannot invent them. Missing lists, inconsistent changed-file claims or completed:true invalidate the result.

### DATA-005 — ReviewResult

| Field | Type | Meaning/validation |
|---|---|---|
| verdict | PASS\|FAIL\|BLOCKED | REV-001. |
| reviewedTreeHash | Hash | Retained P0 name: SCP-002 candidate digest, not merely Git HEAD. |
| candidateGeneration | UInt | Assigned generation. |
| criteria | List<CriterionAssessment>[1..256] | Exact complete coverage; no missing/duplicate criterion. |
| findings | List<Finding>[0..256] | Concrete evidence. |
| scopeAssessment | Assessment | Scope and actual changes, not only Developer claims. |
| testAssessment | Assessment | Required checks and attribution. |
| actualChangesAssessment | Assessment | Actual baseline-to-candidate differences. |
| residualRisks | List<Risk>[0..128] | Required risk assessment, including an explicit empty array. |
| validationResultIds | List<ID>[1..64] | Current results inspected by Reviewer. |

PASS contradicted by FAIL/UNVERIFIABLE, blocking findings, missing criteria or mismatched digest is invalid. Developer/Reviewer run and session identities must differ regardless of profile/model name.

### DATA-006 — OracleResult

| Field | Type | Meaning/validation |
|---|---|---|
| escalationId | ID | Matching open episode. |
| diagnosis | Text | Bounded advice. |
| options | List<Text>[1..16] | Alternatives, not executable instructions. |
| recommendation | Text | Reasoned proposed choice. |
| unresolvedQuestions | List<Text>[0..64] | Cannot be presumed resolved. |
| needsHumanDecision | boolean | True requires a gate; false cannot waive policy/ambiguity gates. |

Missing episode, unauthorized invocation or added authority/state fields invalidate the result. Only an Orchestrator DecisionRecord can adopt advice; scope/product choices require a human.

### DATA-007 — WorkflowState

| Field | Type | Meaning/validation |
|---|---|---|
| schemaVersion | 1 | Persisted version. |
| taskId | ID | Existing task. |
| packageVersion | Text | Version writing the ledger. |
| revision | UInt | Starts at 0; each event increments by one. |
| state | State | Current state. |
| spec | ArtifactRef | Durable normalized TaskSpec. |
| specHash | Hash | Matches content. |
| ownerSessionId | Text | Runtime owner. |
| repoRoot | Root | Canonical identity. |
| baselineRef? | Text | Verified ref when available. |
| baselineCommit? | GitOID | Required before a writer. |
| baselineEvidence | List<ID>[0..64] | Status/index/untracked/base-digest evidence. |
| candidate? | Candidate | Absent until materialization. |
| runs | List<RunRecord>[0..64] | Includes intent without runId. |
| counters | Counters | Monotonic. |
| failures | List<FailureRecord>[0..256] | Never reset by retry. |
| escalations | List<Escalation>[0..4] | Bounded episodes. |
| decisions | List<DecisionRecord>[0..256] | Authority audit. |
| validations, reviews, results, gates | List<ID>[0..256] each | Typed artifacts, not prose. |
| pendingGateId? | ID | Required only in AWAITING_HUMAN. |
| capabilities | List<CapabilityEvidence>[0..64] | Capabilities required for the current action. |
| invalidEvidenceIds | List<ID>[0..1024] | Retains invalidated history. |
| blockedReason? | Text | Required in BLOCKED. |
| terminalReason? | Text | Required in FAILED/COMPLETED. |
| completionEvidenceRefs | List<ID>[0..256] | Nonempty in COMPLETED under CMP-001. |
| lastEventId | ID | Committed event matching revision. |
| createdAt, updatedAt | Time each | Revision defines causal order, not wall clock alone. |

CREATE initializes PENDING at revision 0 with zero counters, without a fictitious prior state. Reject terminal states with live/unknown runs, incompatible pending gates, unattributable refs/candidates, impossible counters or revision/event disagreement. Invalid terminal state is never exposed as success.

### DATA-008 — ValidationResult

| Field | Type | Meaning/validation |
|---|---|---|
| schemaVersion | 1 | Required. |
| id, taskId, commandId | ID each | TaskSpec command identity. |
| specHash, candidateDigest | Hash each | Required binding even for NOT_RUN. |
| candidateGeneration | UInt | Exact generation. |
| commandHash | Hash | Canonical CommandSpec hash. |
| status | PASSED\|FAILED\|NOT_RUN\|INVALID\|TIMED_OUT | VAL-001. |
| issuer | Orchestrator | Constant. |
| startedAt?, endedAt? | Time | Required when the process started/ended. |
| exitCode? | integer -2147483648..2147483647 | Absent when unknown; never invent zero. |
| durationMs? | UInt | Host-measured. |
| logRef? | ID | Durable artifact; required for started execution. |
| processProofRef? | ID | Required for accepted terminal outcome. |
| postCandidateDigest? | Hash | Required for PASSED and equal to initial digest. |
| reason | Text | Explicit reason, including success. |

No ValidationResult is created before a candidate exists; record a block instead of a fictitious digest.

### DATA-009 — HumanGate

| Field | Type | Meaning/validation |
|---|---|---|
| schemaVersion | 1 or 2 | V1 remains direct-human; v2 requires explicit authorizationKind. |
| id, taskId | ID each | Unique, never reused. |
| type | beforeImplementation\|onScopeChange\|onOracleDecision\|beforeCompletion\|onRetryExhausted\|beforeReviewerRedispatch | GAT-001 policy. |
| requestedBy | Orchestrator | Children can propose, not create approval. |
| status | PENDING\|APPROVED\|REJECTED\|INVALIDATED\|CONSUMED | Gate data, not global state. |
| specHash | Hash | Specification current at request. |
| proposedSpecHash? | Hash | Required for onScopeChange. |
| candidateDigest?, candidateGeneration? | Hash, UInt | Both or neither; required when candidate exists. |
| approvedData | ArtifactRef | Exact frozen content. DirectHumanApproval displays it individually; policy binds it without claiming individual human presentation. |
| approvedDataHash | Hash | Equals artifact digest. |
| stateRevision | UInt | Immutable creation revision in AWAITING_HUMAN. New presentation CAS uses GAT-002 GatePresentation.workflowRevision, never rewrites the original snapshot. |
| resumeState | STM-003 set | GAT-001 further restricts targets by type. |
| continuation | ANALYZE\|PREPARE\|IMPLEMENT\|REVIEW_FINAL\|REWORK\|RECONCILE | Fixed continuation, not arbitrary code; must match target. |
| requestedAt | Time | Required. |
| decidedAt? | Time | Required when a decision is available. |
| humanDecisionRef? | ID | Trusted human-channel attestation, not a model-held token. |
| authorizationKind? | DirectHumanApproval\|PolicyDerivedAuthorization | Required in v2; forbidden in v1. |
| policyAuthorizationRef? | ID ArtifactRef | Only policy v2; mutually exclusive with humanDecisionRef. |
| consumedEventId? | ID | Required for CONSUMED. |
| invalidationReason? | Text | Required for INVALIDATED. |

Reject approval without origin evidence, stale revisions/hashes, invalid targets, reuse or altered data. REJECTED does not automatically mean FAILED: Orchestrator selects only a justified legal TR.

### DATA-010 — TransitionEvent

| Field | Type | Meaning/validation |
|---|---|---|
| schemaVersion | 1 | Required. |
| id, taskId | ID each | Unique identities. |
| kind | CREATE\|TRANSITION\|RECORD | Discriminant. |
| transitionId? | ID | Required only for TRANSITION; one listed TR. |
| recordType? | SPEC_SNAPSHOT\|SPAWN_INTENT\|RUN_BOUND\|RESULT_RECEIVED\|CANDIDATE_MATERIALIZED\|VALIDATION_RECORDED\|REVIEW_RECORDED\|GATE_DECIDED\|ESCALATION_OPENED\|DECISION_RECORDED\|EVIDENCE_INVALIDATED\|RECONCILED | Required only for RECORD. |
| actor | Orchestrator | Constant; human/child requester is represented in evidence, not actor. |
| sourceState? | State | Absent for CREATE, required otherwise. |
| targetState | State | PENDING for CREATE; equals source for RECORD. |
| previousRevision? | UInt | Absent for CREATE, required otherwise. |
| revision | UInt | 0 for CREATE; previousRevision+1 otherwise. |
| timestamp | Time | Not the sole ordering source. |
| reason | Text | Explicit rationale. |
| evidenceRefs | List<ID>[0..256] | Must satisfy TR/record guards. |
| invalidatedEvidenceIds | List<ID>[0..1024] | Never deletes history. |
| stateAfter | ArtifactRef | Complete immutable subsequent snapshot, written/synced before WAL. |
| previousEventHash? | Hash | Absent for CREATE; causal chain otherwise. |
| eventHash | Hash | Canonical hash excluding eventHash. |

WAL and referenced historical snapshots reconstruct state without untyped field patches. stateAfter contains lastEventId but not eventHash, avoiding circularity. Missing/incomplete/contradictory events authorize neither replay nor side effects.

## D. AUT-001 — Authority matrix (default DENY)

ALLOW* means conditional permission. PROPOSE_ONLY grants no effect/transition. Human describes operations through the package, not restrictions on actions outside it. CPG-001 later adds separately authorized project-level integration, without child grants.

| Operation / ID | Orchestrator | Scout | Developer | Reviewer | Oracle | Human |
|---|---|---|---|---|---|---|
| read repository / OP-01 | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| modify candidate / OP-02 | ALLOW* | DENY | ALLOW* | DENY | DENY | PROPOSE_ONLY |
| modify original workspace / OP-03 | DENY | DENY | DENY | DENY | DENY | DENY |
| spawn sub-agent / OP-04 | ALLOW* | DENY | DENY | DENY | DENY | PROPOSE_ONLY |
| change scope / OP-05 | ALLOW* | PROPOSE_ONLY | PROPOSE_ONLY | PROPOSE_ONLY | PROPOSE_ONLY | ALLOW* |
| run authoritative validation / OP-06 | ALLOW | DENY | DENY | DENY | DENY | PROPOSE_ONLY |
| issue review verdict / OP-07 | DENY | DENY | DENY | ALLOW | DENY | DENY |
| request rework / OP-08 | ALLOW | PROPOSE_ONLY | PROPOSE_ONLY | PROPOSE_ONLY | PROPOSE_ONLY | PROPOSE_ONLY |
| approve human gate / OP-09 | DENY | DENY | DENY | DENY | DENY | ALLOW* |
| transition workflow / OP-10 | ALLOW | DENY | DENY | DENY | DENY | PROPOSE_ONLY |
| mark completed / OP-11 | ALLOW* | DENY | DENY | DENY | DENY | DENY |
| merge / OP-12 | DENY | DENY | DENY | DENY | DENY | DENY |
| push / OP-13 | DENY | DENY | DENY | DENY | DENY | DENY |
| publish / OP-14 | DENY | DENY | DENY | DENY | DENY | DENY |

OP-02 Orchestrator permits deterministic patch materialization only, never semantic correction; Developer requires an IMPLEMENTING assignment in its own in-scope checkout. OP-04 requires verified budgets/capabilities/intent/leaf profile. OP-05 lets Human authorize new data; only Orchestrator persists the new spec after gate/reanalysis. OP-09 requires the trusted authenticated human channel; recording gives Orchestrator no approval authority. OP-11 requires TR-022/CMP-001.


## E. Scope contract

### SCP-001 — Paths and baseline

- repoRoot is the original's frozen canonical realpath. Working/candidate roots are separate, owned and never aliases of it.
- baseRef is HEAD or a supported named ref, not a revision expression/raw allocation SHA. Preserve resolved baseCommit and recheck before/after allocation; movement blocks.
- Allow/deny lists contain **exact files**, not globs/prefixes/regexes or implicit directory expansion. New files must already be listed; renames require allowed source and destination, deletion its allowed path, and mode changes count as edits.
- Default deny; deny overrides allow. Reject empty/absolute paths, `.`/`..` segments, double slash, backslash, NUL, drive/UNC and ambiguous aliases. No silent cleaning. Comparisons are case-sensitive; filesystem case/Unicode collisions block.
- Symlink reads require verified in-root targets; no writes through symlink components or initial-minimum symlink creation/modification. Hash existing links as target bytes without following. Required external targets block. For new paths verify nearest existing parent realpath and every component before creation; test TOCTOU rather than relying solely on preflight.
- Dirty/staged/unattributable untracked baselines prevent writers, without automatic stash/commit. Pre-existing ignored files remain subject to policy; provision explicitly or block interference with candidate/validation.
- Developer-created untracked files are edits: require allow, patch/manifest capture and digest inclusion. Git diff alone is no full inventory.
- Git metadata, ledger/artifact storage, credentials and external roots are fixed child-write denials. Dependencies/logs/build outputs use declared separate roots, without hiding source from hashing.
- Unsupported submodules, special/non-UTF-8 files, unverifiable hardlinks/aliases or unrepresentable patches block rather than lose content.

### SCP-002 — Candidate digest and handoff

CandidateManifest/AUX-001 uses closed versioned entries sorted by UTF-8 path, with string Git modes `100644|100755|120000`. FILE hashes complete bytes, including binary data; SYMLINK hashes target bytes without following. Include all tracked/new candidate files regardless of ignore, excluding Git metadata only; provisioned logs/dependencies are outside the root. Empty directories are not represented. Missing required bytes/files make digest unknown.

`candidateDigest = SHA256(canonical({schemaVersion:1, baseCommit, entries:manifest}))`. Bind monotonic generation as well: returning to an old digest cannot revive old-generation evidence. specHash remains a separate binding.

Before TESTING prove writer termination, durably copy/verify handoff/patch/manifest, reconstruct the exact candidate from baseCommit and compare complete contents. Missing data, lost binary content or unknown processes block. Never assume a child worktree survives cleanup.

Rework starts from the prior approved candidate's local ref; assignment baseCommit identifies that intermediate base. Candidate.baseCommit and WorkflowState.baselineCommit retain the original task baseline. Host materializes the incremental patch and retains aggregate handoff history, producing a cumulative original-to-current patch without semantic edits. Manifest digest always uses the original baseline; scope/review cover the complete cumulative diff. Ref preparation/round-trip remain subject to UV-004; no original-checkout commit.

Recheck digest/generation/spec before/after validation, review, human decisions and before TR-022. Unexpected mutation invalidates E/Q and blocks; never rewrite old report digests. Rework creates a new generation with new test/review evidence.

## F. VAL-001 — Validation contract

| Status | Exact condition |
|---|---|
| PASSED | Approved command actually executed by host; proven process termination, exitCode=0, durable log, correct spec/command/digest/generation and unchanged post-digest. |
| FAILED | Attributed terminal execution with nonzero exit and no timeout, with artifacts/provenance. Tests must signal failure through nonzero exit; the minimum does not reinterpret prose to correct zero exit. |
| NOT_RUN | No validation process started; missing prerequisite/decision recorded. Never synthetic exitCode=0. |
| TIMED_OUT | Command deadline exceeded; interrupt and collect log/terminal proof. Missing termination keeps workflow BLOCKED even after recording timeout. |
| INVALID | Wrong hash/command/provenance, untrustworthy artifact, changed digest, contradictory or unavailable result. Overrides claimed PASSED/FAILED. |

Priority: unknown integrity/provenance→INVALID; otherwise timeout→TIMED_OUT, not started→NOT_RUN, nonzero exit→FAILED, all positive conditions→PASSED. Signal/abort with unknown exit and insufficient proof is INVALID. Missing ValidationResult is an unsatisfied obligation.

Each required command has exactly one current authoritative result selected by the latest VALIDATION_RECORDED for commandId/specHash/digest/generation. Preserve old failures; never select old success over a failed rerun. Optional commands cannot replace required criterion coverage; zero required commands is forbidden. No cross-generation memoization. Tests that alter source invalidate the candidate; generated output belongs in approved separate directories.

## G. REV-001 — Review contract

Review requires V and a packet containing full spec, actual diff, manifest/digest/generation, all required ValidationResults, handoff and risks. Reviewer is fresh, independent and verified read-only, without generic shell.

- **PASS**: every criterion has evidence-backed PASS; scope/test/actual-change assessments pass; exact candidate binding; no blocking finding/risk; nonblocking residual risks explicitly listed. Orchestrator records dispositions before completion.
- **FAIL**: demonstrated concrete candidate/test/scope defect or unmet criterion, with reproducible/cited finding. Orchestrator evaluates W/blocking; Reviewer does not repair.
- **BLOCKED**: missing/ambiguous information, unverifiable criterion or impossible inspection. Orchestrator cannot upgrade it to PASS.

Schema-invalid results are protocol errors, not usable semantic FAIL. Missing criteria invalidate PASS. Reviewer cannot edit data/tests to pass. Blocking findings require a coherent new result or authorized reanalysis, never a prose override.

### REV-001A — Risk disposition (DecisionRecord schemaVersion:1)

RESOLVE_RISK preserves the Risk/historical result while attesting that current authoritative evidence satisfies its condition. It is neither deletion nor acceptance/deferral. DEFER_RISK explicitly retains a truly residual nonblocking risk with rationale; scope/product tradeoffs still need their gate and cannot override criteria.

Use existing closed fields subjectId, nonempty reason and evidenceRefs. References must include exactly one WorkflowState snapshot matching current specHash/digest/generation, the current Developer/Reviewer result containing the identical Risk, and supporting evidence. Free text supplies no binding. Incompatible duplicate IDs are invalid. schemaVersion remains 1 with an explicitly extended enum; older readers reject unknown kinds without coercion.

Only host-side Orchestrator records DATA-010 RECORD/DECISION_RECORDED. Reviewer supplies proof, Developer decides nothing, Oracle advises; human APPROVE is no automatic disposition. Minimum automatic RESOLVE_RISK applies only to nonblocking `host-validation-pending` with nonempty criterionIds. Every criterion needs required commands and current host PASSED results with matching spec/digest/generation, approved commandHash, logs/proof and non-invalidated references. Cite those results. Other conditions need an explicit normative rule, not prose inference.

Each current Developer/Reviewer risk requires exactly one valid current disposition. RESOLVE_RISK plus DEFER_RISK, or conflicting dispositions for one risk/snapshot, block. Changed spec/digest/generation/evidence validity makes dispositions stale; retain history without reusing its authority. Missing/stale/conflicting dispositions make CMP-14 false even for nonblocking risk. No disposition permits blocking risk. Persist dispositions before freezing beforeCompletion material; never reopen historical gates.

## H. RET-001 — Retry and escalation

- **Attempt:** every admitted child assignment has a fresh attemptId. Increment attempts/dispatches durably before launch; unknown outcomes remain consumed.
- **Rework attempt:** later Developer assignments correcting previous output increment reworkAttempts before launch. Default two beyond the first. Proven INFRA retries before work started are new attempts/dispatches, but not rework.
- **Infrastructure retry:** at most one per task, restrictable to zero, with the same protocol/runner/model/semantic assignment. Require proven transient failure, no live writer and preserved diff or clean tree. Unknown is not proven transient. Persist RETRY_INFRASTRUCTURE, but it alone grants no dispatch: a terminal Reviewer without verdict also needs beforeReviewerRedispatch. No automatic tool/protocol-error loops.
- **Failure fingerprint:** canonical SHA-256 of `{phase, category, code, sorted subjectIds}`. Exclude timestamps, volatile logs and attemptId; include stable test/criterion/path refs. Derive counts from ledger without session/spec resets. Two equivalent failures trigger escalation before another attempt.
- **Escalation episode:** ID, triggers and concrete question, for ambiguity before writes, two equivalent failures or conflicting evidence. At most four per task, also within dispatch cap. Close only through DecisionRecord. No duplicate episode for the same unresolved block without new evidence to evade limits.
- **Oracle:** one dispatch per episode, advisory session; fork only with verified capability, otherwise explicitly select a fresh packet before launch. No same-episode retry; failure blocks/requires human decision. Never routine reviewer/writer.
- **Exhaustion:** never exceed caps. A concrete enabling decision and onRetryExhausted may enter AWAITING_HUMAN through a legal TR, without increasing budgets. It may authorize reconciliation without new writing, rejection or a distinct future task, never reopen a terminal task. With no finite legal action, fail after quiescence.

TaskSpec freezes ceilings. Scout/Reviewer/reanalysis also consume dispatch budget; state cycles create no free attempts. Reanalysis requires new evidence or a resolved question, not identical repeated payload. Human waiting is no active retry and launches no child. No autonomous loop without bounded consumption or a new human decision.

## I. GAT-001 — Human gates

Orchestrator requests/persists gates; roles/Human may propose need but cannot construct approved gates. DirectHumanApproval comes only from explicit host-verified Pi TUI choice. Model booleans/tokens are invalid. Current path is `ctx.ui.custom`; `ctx.ui.confirm` supports historical channels/hosts without custom UI. Both require the same active session, still-current approved content and explicit positive choice. No, Esc, expiry and errors create no decision. Distinct v2 PolicyDerivedAuthorization verifies/consumes approved plan/policy authority under PA-001, without attributing another individual human choice. All gate guards remain.

| Type | Trigger and approved material | resumeState / continuation |
|---|---|---|
| beforeImplementation | First writer and later writers after approved spec/candidate changes; specHash, scope, base, commands, risks, and model-extraction approval when needed. | PENDING/ANALYZING for unanalyzed input; READY for TR-009; IMPLEMENTING only from quiescent suspension satisfying I. |
| onScopeChange | Requested allow/deny/requirement changes expanding authority; old/proposed spec hashes, diff and reason. Always enabled. | ANALYZING; install new spec only after approval, never direct implementation. |
| onOracleDecision | Material/unresolved Oracle tradeoff, resultRef, selected option and spec/candidate consequences. | ANALYZING for spec/criteria changes, REWORK for in-scope fixes, BLOCKED for reconciliation. |
| beforeCompletion | Already-valid independent PASS/checks; candidate digest/generation, specHash, review/test/risk dispositions and durable patch. | REVIEWING / REVIEW_FINAL, then recalculate CMP-001. |
| onRetryExhausted | Counters/caps, failures and identified finite enabling decision without cap increase. | ANALYZING/REWORK/BLOCKED only with a legal finite action; otherwise FAILED without a fictitious gate. |
| beforeReviewerRedispatch | Fully bound, terminal prior Reviewer without verdict; admitted INFRA failure/RETRY_INFRASTRUCTURE, unchanged current spec/candidate/validation/runtime evidence, no UNKNOWN runs, valid budget/locks. | BLOCKED→TR-034→AWAITING_HUMAN; APPROVE uses TR-040→REVIEWING. Dialog does not dispatch; normal admission creates the fresh Reviewer. |

Exact continuation map: PENDING/READY→PREPARE, ANALYZING→ANALYZE, IMPLEMENTING→IMPLEMENT, REVIEWING→REVIEW_FINAL, REWORK→REWORK, BLOCKED→RECONCILE. Model-extracted data requires beforeImplementation approval even if routine pre-writer confirmation is disabled. Scope approval accepts proposedSpecHash without retroactively validating old evidence.

H must hold before AWAITING_HUMAN. Do not retain an active writer waiting for approval; structured questions terminate in a report/block and the host prepares a later assignment after decision. Supervisor contact cannot bypass contracts.

Gate stateRevision identifies the original waiting view. Historical channel v1 uses its revision CAS; v2 uses current GatePresentation revision under GAT-002. Material changes require invalidation/new gate/confirmation; only expressly authorized rebinding preserves a gate. Decision persistence/consumption legitimately advances revision without retroactively invalidating unchanged decisions; event/presentation chains prove single use.

Spec/candidate/generation changes, stale validation/runtime proof, superseded gates or unreconciled old sessions invalidate authority for new effects. Consumed implementation approval documents that assignment's entry basis, not future output; scope approval documents old→new. Reviewer redispatch authorizes only a fresh Reviewer, not Developer, rework, validation, scope or completion, preserving evidence and consuming a new Reviewer attempt/dispatch with fresh assignment/attempt/request/run/child-session/session identities. Historical authority stays readable without authorizing a new writer/candidate. beforeCompletion separately binds the final candidate. Final rejection satisfies F; ambiguous answers block. Headless/RPC without a human channel stays waiting; disabling optional gates cannot waive scope or ambiguity.

Recheck Reviewer-redispatch conditions before creation, consumption and dispatch: applicable recovery lease, locks, exact previous Reviewer/spec/digest/generation, terminal proof, immutable spec and PASS validation/log/process/runtime/comparison bytes. Any false condition denies it. Reviewer FAIL/BLOCKED/PASS, schema errors, scope violations, mutation and UNKNOWN are not eligible infrastructure failures. Cancel/No records nothing; ANSWER does not approve; REJECT follows TR-043.


### GAT-002 — Immutable gates and presentation after verified takeover (P16B.1)

**HumanGate identity differs from GatePresentation.** Gate defines material decision; presentation identifies one host display instance. Session change alone creates no authority. Gate id/task/type, spec/proposed-spec, candidate digest/generation, approvedData/ref/hash/bytes, resumeState/continuation, requestedAt and original stateRevision remain immutable. Material changes require a new gate; a session change alone does not.

**GatePresentation v1** is a closed host-owned ArtifactRef document, mediaType `application/vnd.pi-controlled-dev.gate-presentation+json`, max 64 KiB. Required: `schemaVersion:1`, `id:ID`, `gateId:ID`, `taskId:ID`, positive UInt presentationGeneration, UInt workflowRevision, Hash displayedDataHash, ProcessIncarnation hostProcessIncarnation, Text hostSessionId, Time presentedAt. Optional: ArtifactRef recoveryAuthorityRef and previousPresentationRef. Verify complete referenced bytes/digests/control-plane paths; IDs/copied JSON are insufficient. A presentation authorizes a display request, not a claim the person saw or decided it; actual positive TUI choice is separate.

**ProcessIncarnation v1** is process-lifetime evidence, not user identity: `schemaVersion:1`, `platform:linux`, Text bootId/pidNamespace, positive UInt pid, decimal-Text startTicks. It versions P16A evidence rather than adding authentication. Unverifiable environments cannot rebind. PID, age, changed session, reload or caller booleans cannot prove death; equivalent serialization cannot authenticate a process.

**Ordering/CAS:** normal gate and generation-1 presentation (no previous/recovery refs) share the commit entering AWAITING_HUMAN, with workflowRevision=gate.stateRevision. Obtain choice only after sync. Later presentations are RECORD/RECONCILED in the same state, incrementing revision by exactly one without material changes. workflowRevision equals that record's stateAfter revision; never force revisions to match sessions or rewrite the gate's original revision. Require previous presentation and generation+1 without skips/forks/duplicates. CAS demands current revision exactly equals workflowRevision. Any intervening event, including diagnostics, makes a displayed request stale; no receipt reuse/revision rewrite.

**Independent rebinding prerequisites:** coherent store, compatible P16A classification, proven old-owner death, all-child quiescence, applicable reclaim, exclusive takeover and fresh task/workspace locks. Gate must remain PENDING without any accepted HumanDecisionEvidence. Durable recoveryAuthorityRef includes task, previous/new incarnation/session, classification, death/quiescence/reclaim refs, reason, starting revision/eventHash and new lock tokens. Operational authority is a current host-only handle under exclusion, never a copied record. Recovery proof→takeover authority→presentation; a presentation cannot retroactively prove takeover. Only the current lock/authority winner may CAS generation N+1.

**Decision binding:** HumanDecisionEvidence remains v1. New trustedChannelEvidenceRef points to a closed channel **schemaVersion:2**, preserving v1 fields and requiring ArtifactRef presentationRef. source distinguishes verified `ctx.ui.custom`/`ctx.ui.confirm`, not arbitrary sources. channelId/confirmationId retain semantics. displayedRevision matches presentation.workflowRevision, displayedDataHash matches unchanged approvedDataHash. Verify exact presentation ID/generation, gate/task, actual TUI hostSessionId, revision/hash/confirmationId and that it remains current. The decision is the first GATE_DECIDED after workflowRevision. Receipts are single-use and never revive after a later generation; reject HUMAN_DECISION_STALE/REPLAY or equivalent. Approval belongs to the proven current presentation, not necessarily the original session or an arbitrary merely current session.

**Explicit compatibility:** historical v1 channels/gates without presentation retain original same-session verification; no implicit reinterpretation/migration. A genuinely pending undecided legacy gate may receive its first explicit presentation only through verified takeover: generation 1, required recoveryAuthorityRef, no previousPresentationRef, RECORD/RECONCILED linked to the original. This is explicit adoption, not rewritten history. Later generations increment normally. presentationRef in v1 or missing in v2 is an error.

**Already-decided gates:** CONSUMED/INVALIDATED/REJECTED and any gate with a durable APPROVE/REJECT/ANSWER cannot be presented again. Persisted unconsumed decisions follow P16B only with reconstructible guards/commit evidence, otherwise P16C. No new decision or implicit consumption. Incomplete WAL/commits and unresolved INTENT remain P16C; this amendment itself implements no repair.

**Terminal verification:** reconstruct the whole original gate/presentation or explicit adoption, owner-death/classification/quiescence/reclaim/takeover, native confirmation, HumanDecisionEvidence and consumption chain. Verify monotonic generations, uniquely current presentation at decision, decision/consume revisions and no receipt reuse. Original-owner direct comparison remains only for v1; v2 requires the full chain rather than removing session checks. Later takeover preserves consumed historical authority for its exact old data without making it reusable.

**UI/authority:** display the same P14H material again. An optional note outside authorized data may explain: “This task resumed after a restart. The previous decision was not recorded.” It adds no approval. Headless/JSON/RPC stays HUMAN_ACTION_REQUIRED; takeover confirms nothing. Only host creates presentations/generations/recovery refs/rebinding. Models, children, prose and copied records grant no authority. No new strong user identity, workflow state, transition, role, retry/scope rule or gate meaning is introduced.

## J. CMP-001 — Completion predicate

`canComplete(state, evidence)` is true **if and only if all eighteen conditions hold together**:

1. Current state REVIEWING; valid version/revision/ledger, task/workspace locks owned, Orchestrator selects TR-022.
2. Current validated TaskSpec and matching source snapshots/hashes; no open ambiguity or requirement/criterion without a verification method.
3. Required capabilities verified for current environment, versions and effective contracts.
4. Attributed clean Git baseline, exact baseCommit, candidate separate from original.
5. Valid structured DeveloperResult bound to the latest authorized Developer assignment, without blockedReason.
6. No active/unknown child, intent or writer; terminal proof and no concurrent mutation.
7. Complete durable handoff/patch/manifest and verified reconstruction, including binary/new files.
8. Host scope PASS over complete diff/filesystem; no denied, outside-allow or original changes.
9. Recomputed current digest/generation match the verified candidate; no required quarantined evidence.
10. At least one required command, and every required command has current authoritative PASSED with exact spec/digest/generation/commandHash and durable log/proof.
11. Current valid PASS ReviewResult; Reviewer role/session/run independent from Developer, proven fresh/read-only context.
12. Review binds identical spec/digest/generation and current validation; scope/test/actual-change assessments PASS.
13. Exactly one evidence-backed PASS CriterionAssessment for every criterion and complete requirement coverage.
14. No blocking finding/risk or open material escalation/decision. Every relevant current result risk has exactly one current valid RESOLVE_RISK or DEFER_RISK under REV-001A, with distinct semantics, rationale and evidence.
15. Past effects have authentic consumed gates for their authorized data at that time. Every gate still applicable to final spec/candidate, including required beforeCompletion, is authentic, current and consumed once. No required pending/invalidated/rejected gate; historical authority cannot approve the current result.
16. Monotonic counters within limits; no unresolved retry/policy violation or unauthorized fallback.
17. All cited evidence available, intact, attributed and preserved beyond temporary retention, without secrets/full transcripts in the ledger.
18. Completion package precisely identifies spec, base, patch, candidate, validation/review/gate/decision IDs, all matching TR-022's committed snapshot.

Unknown means false; no voting/majority rule. Human approval and Reviewer PASS cannot override false conditions. Serialize checks/commit; observed changes reject TR-022. Later missing/corrupt artifacts make terminal attestation unavailable without rewriting immutable terminal state.

### CMP-002 — AuthorizationPackage and TerminalCompletionPackage (P14G.3A)

Separate hash domains prevent circularity:

- **AuthorizationPackage v1** freezes before beforeCompletion: taskId, specHash/ref, baselineCommit, candidate digest/generation, manifest/patch/handoff, Developer results, validation IDs/refs/log/proof, review ID/ref/proof, risks/dispositions and prior material decisions. Content-addressed refs bind bytes. Exclude this gate's future decision/receipt/consumption and future terminal package.
- Hash canonical AuthorizationPackage without a self-hash. approvedData contains its ref/hash; gate approvedDataHash and decision displayedDataHash transitively bind those canonical bytes. Human authorizes that existing material.
- **TerminalCompletionPackage v2** is explicitly versioned and built after decision, consumption and return to REVIEWING. Include AuthorizationPackage ref/hash, beforeCompletion gateRef, HumanDecisionEvidence ref, consumed event ref, all decision/completion-evidence refs, final evidence package and task/spec/candidate/generation/COMPLETED target binding. Hash without a self-hash. Durable attestation contains that hash and TR-022 references the attestation, avoiding terminal-event self-reference.

Historical CompletionPackage v1 remains an evidence bundle, never implicitly migrated/reinterpreted as v2. Historical live records remain unchanged and do not certify the new contract.

CMP-15 requires exactly one authentic current consumed final authorization plus applicable gate history, **not equality between authorization and terminal package hashes**. Recompute both, verify transitive confirmation binding and compare the entire final material projection. Spec/candidate/generation/manifest/patch/validation/review/risks/dispositions/material decisions cannot change after approval; changes require new package/gate. Only authorization/terminalization facts may be added.

History distinguishes never-applicable, satisfied/consumed, negative or ANSWER with legal continuation, invalidated/superseded, pending and incomplete gates. Not every historical gate must remain current/CONSUMED. Each writer binds exact entry spec/base/scope/authority; each scope installation binds old→new; Oracle binds episode; exhaustion continuation binds episode/fingerprint/cap. REJECT/ANSWER are not positive authority. Contradictions, duplicate decisions, reused receipts, wrong bindings and impossible consumption fail closed. Verification reads artifacts/events/store only; loading never completes missing decisions/consumption/resume. Atomic consumption+resume requires no invented intermediate state/TR.

Historical P14G.3 circularity probe: approved hash `7564167085295286560f569f36b9711f3d098e819f063b59fc8f9bd71bbe6315`, terminal hash `826ff66f4cc0ec4c8b563f06955be2d74e4103df1747178a0fcc83f48e3fe6bc`; gateIds respectively empty and containing the consumed beforeCompletion. Inequality is valid; explicit binding and identical material content are mandatory. State/transition/authority/retry/scope/RESOLVE_RISK semantics stay unchanged.

## PST-001 — Persistence, effects and recovery

Use local task store, state.json, events.jsonl, specification snapshots, artifacts and task/workspace locks; no database/server. Sensitive files are private; no full transcripts. Selective redaction must preserve required facts. Secrets that cannot reliably be sanitized block artifact export/acceptance.

Commit order: write/sync immutable stateAfter → append/sync complete event → write/sync temporary snapshot → rename state.json and sync directory where verified/supported. No external effect before committed intent. Orphan pre-WAL artifacts have no authority. WAL-ahead recovery reconstructs without relaunch. Preserve but do not apply truncated tails; contradictory complete prefixes block/quarantine. PST-002 defines the explicit durability barrier for repair.

Dispatch intent binds assignment/attempt/request and increments counters. Bind returned run/session only when unambiguous. Crash/timeout before binding is UNKNOWN, not proof of no launch; reconcile exact-session status/receipts or block. Identical completion duplicates are idempotent; contradictions, unreconcilable ordering or foreign runs block completion.

Locks use exclusive creation and owner metadata. PID/age alone do not prove death; unknown owners retain locks. Reload/session replacement reconstructs ledger, resubscribes and reconciles, never inferring exit from silence. Changed ownership without a verified path blocks for intervention.

### PST-002 — P16C.1: explicit repair of an existing WAL prefix

Complete visible bytes do not prove earlier fsync succeeded. Explicit host repair may make existing data durable **now**, without attesting old sync. Startup/status only classify CLEAN, REPAIRABLE, AMBIGUOUS or CORRUPT; no automatic mutation/resume.

Under exclusion of repair and ordinary mutators, reverify encoding, complete records, hash chain, continuous revisions, transitions, every artifact/metadata, absence of contradictions and a snapshot exactly matching an earlier state in the same history. Then sync existing WAL → deterministically rebuild snapshot → sync new snapshot → atomic replacement → directory sync → separate durable repair record. Record prior snapshot revision, valid WAL revision, previous fsync status UNKNOWN, repair fsync performed true, rebuilt revision and evidence. Add no workflow event/revision, rewrite no history and reset no counter.

Snapshot-ahead is STORE_INCONSISTENT. Wrong hashes, revision gaps, invalid events, absent artifacts or contradictory evidence prohibit reconstruction. Exclude incomplete trailing bytes only after verifying the complete prefix and retaining original bytes for audit.

New sync cannot prove external outcomes. Unproven dispatch, writes, validation, review, HumanDecision or provider effects make repair/resume denied, RECOVERY_AMBIGUOUS. Never replay children, checks, review, confirmations or external mutations. Proven unexecuted/completed INTENT requires durable proof of the exact effect; ambiguous INTENT stays blocked. Missing binding/results, orphan artifacts and prose do not prove nonexecution.

Repair journal/guard are private host metadata, not model-supplied authority. Interrupted repair requires renewed owner-death/token/source/destination verification; insufficiently identified legacy guards stay ambiguous. Repair grants no resume authority; P16A/P16B takeover and normal locks remain required. Eleven states, 43 transitions, roles, scope, retries and gates remain unchanged.

## CAP-001 — Integration capabilities and limits

REG-001 is the public process-local registration boundary; event-bus RPC v1 is the sole P0 execution boundary, with async-only spawn. No private imports, unsupported manage operations or slash-output parsing. Handshake verifies actual methods/events/contracts. Require and revalidate structured output; ok:true without it is unusable. Process termination, child result and accepted workflow are distinct facts.

No runtime pi-subagents dependency/peer, even optional; no root/subpath import, Node/global/home lookup, NODE_PATH, resolution symlink, vendoring/copy or auto-install/upgrade. The package loads without the service; users independently choose how to load it in Pi. Absent service means capability unavailable and no child, without installation-directory assumptions.

Minimum: registration v1, RPC v1, async spawn, correlated completion and required structured output. Verify behavior, not advertisements/version alone. Experimental baseline was 0.72.1; earlier versions may work if they satisfy the same checks, with earliest historical release undetermined. Changed version/config/environment invalidates relevant attestation and requires verification, never automatic upgrade. CLA/REG pre/post-launch binding and EVD authority checks assume no imported preflight API. Missing required proof blocks.

### Inherited UNVERIFIED register

These are final-package obligations, not capability promotions by the historical amendment. UV-002/003/009/010 remained UNVERIFIED. P5 evidence for the observed UV-001 RPC/output subset is neither erased nor generalized. Future variants below were not executed by that amendment.

| ID | P0 origin and obligation | Tests | Milestone | Until proven |
|---|---|---|---|---|
| UV-001 | §§1.6,1.8,14.1: ping→spawn→event→status/receipt, exact correlation/schema-valid structured output, events versus capabilities | TEST-025,026,027 | FUT-INTEGRATION; FUT-RECOVERY reconciliation | Block result use/progress. |
| UV-002 | §§1.2,1.9,2.2,14.2: runtime registration, operational RPC binding, collisions/source attribution | TEST-031,032 | FUT-INTEGRATION | No unproven role launch. |
| UV-003 | §§2.2,7,14.3: definition ownership, effective tools/context/extensions/no-delegation, independent proof/canary, no preference-driven authority expansion | TEST-004,005,006,032,033 | FUT-INTEGRATION | Block unverifiable authority. |
| UV-004 | §§7,14.4: clean committed Git, child cleanup, patch capture/round-trip, rework refs, binary/untracked files | TEST-010,011,012,013 | FUT-INTEGRATION | Analysis permitted; mutation blocked. |
| UV-005 | §§11,14.5: multiprocess locks/stale owners, sync/rename/crash on target filesystem | TEST-028,029,030,034 | FUT-RECOVERY | No mutation/safe-recovery claim. |
| UV-006 | §§11,14.6: reload/replacement ordering, prior-session ownership/reconciliation | TEST-027,028,029,035 | FUT-RECOVERY | Unknown runs block redispatch. |
| UV-007 | §§9,16: human-origin command/confirmation, indirect attacks, headless | TEST-019,020,021 | FUT-INTEGRATION | Stay waiting; no synthetic approval. |
| UV-008 | §§7,16: child path guard, symlink/TOCTOU, required confinement without shell-sandbox claims | TEST-007,008,009,033 | FUT-INTEGRATION | Block missing capability; require external strong isolation where specified. |
| UV-009 | §13: different Pi installations without runtime dependency/import/Node resolution; process-local protocols | TEST-031,036 | FUT-RELEASE | Unverified combination is not certified for distribution/use. |
| UV-010 | §§1.4,1.9: actual fresh context including Scout, history canary, explicit fork, no fallback and deadlines | TEST-014,037,038 | FUT-INTEGRATION | Block Scout/Developer/Reviewer without fresh proof; Oracle fresh only explicitly verified, never fallback after fork failure. |
| UV-011 | §§1.8,11,16: terminal proof, retention and complete audit reconstruction | TEST-012,028,029,035,039,040 | FUT-RECOVERY | Unknown writer prevents test/review; absent artifacts block. |
| UV-012 | §§1.5,1.8: actual fan-out temporal overlap | TEST-041 | FUT-INTEGRATION only if parallelism enabled | Parallel feature disabled; serial minimum independent. |

P0 §14.7–10 are not one-time universal guarantees: future versions need handshake (TEST-025), OS security is an external condition (TEST-033), commands require explicit trust (TEST-015/016), and LLM/schema checks cannot guarantee semantic truth (TEST-017/018/042 test protocol only). No test certifies universally correct review.

## DOC-REVIEW — P1 review

Original P1 review is historical in TEST-MATRIX §6. The amendment changed only three normative documents including P0; internal review/traceability is in §8. It ran no implementation tests, promoted no capability and authorized no executable P0–P5 changes/P6. Core invariants, 43 TR, AUT-001 and CMP-001 remained. Expose future contradictions as BLOCKING ISSUE, never bypass them through implicit schemas/transitions.

## CPG-001 — Project-level Candidate Promotion

CandidateGitBinding connects initial task/spec, targetRef/B0 and stable candidateRef. Freezing adds verified commit/digest/generation/final spec, preserving historical CompletionPackage. Host builds a commit from the exact manifest and compares a fresh checkout before publishing binding. Validate refs/paths/OIDs; private allowlisted host primitives construct Git arguments, never model text.

CandidatePromotionProposal binds project/task, current target HEAD, candidate commit/digest, integration commit/tree/digest, changed files, validation/review refs. The isolated merge has ordered parents targetHead/candidateCommit. Conflicts, failed validation or negative review prevent executable proposals. Advanced targets require new checks/independent review; identical baseline/tree can reuse terminal task review.

SUPERVISED uses trusted candidate-promotion confirmation without a new global gate. APPROVE consumes a live capability, persists the exact receipt and publishes intent before mutation. REJECT preserves task/candidate; Cancel/Back authorizes nothing. Changed ref/commit/tree/evidence/HEAD invalidates the decision. Headless fails closed. BOUNDED_AUTONOMOUS uses distinct PA-001 policy authority.

Ref update is CAS old targetHead→integrationCommit. An exclusive Git index serializes ordinary checkouts; two-tree read-tree applies files without hard reset and rejects unexpected local bytes. Publish result only after exact branch/HEAD and clean index/worktree verification. A valid crash-surviving intent can reconcile when target is old HEAD or exact integrationCommit. Reclaim dead leases using process incarnation/current repair guard, never age/PID alone. Old index with entirely new tree may reconcile after byte-exact proof; partial/ambiguous states block. No recomputed merge, rollback or remote operation.

## PA-001 — Project Autonomy / Bounded Autonomous Execution

Explicit amendment authorized 2026-10-04. Policy authority is distinct from a new direct human confirmation. Preserve eleven states/43 transitions; no new global state, role or Orchestrator.

SUPERVISED retains v1/native confirmations. BOUNDED_AUTONOMOUS requires exact APPROVED ProjectPlan and ProjectAutonomyPolicy through Trusted Human Confirmation. One interaction may show both exact contents, with distinct durable requests/receipts. Menu choices, Markdown and model JSON approve nothing.

Policy v1 binds project/policy identity/revision/digest, plan identity/revision/digest, local branch/initial baseline, admitted tasks/per-task limits, protected paths, exact CommandSpecs, allowed actions, binding memory, expected dependency changes, escalation conditions and final-check recipes. Limit 64 tasks; relative literal prefixes may end in /**, without universal glob algebra. ScopeGuard still requires concrete files and actual-diff verification. DRAFT/APPROVED/SUPERSEDED/REVOKED are document lifecycle states.

Controller observes progress, selects the approved plan's first READY task and uses native APIs. One task at a time, only admitted tasks. Reuse exact linked identities instead of duplicating them. Pre-task Scout examines current repository. V1 requires exact objective/acceptance text, contained scope and exact commands; uncertain semantic equivalence escalates.

PolicyDerivedAuthorization binds exact policy and real policy/plan approval refs, revisions/digests, plan/run/action/subject/digest/checks and ALLOWED. Separate AutonomyActionResult binds effects to native proof; authorization remains immutable. Escalation records ESCALATE/BLOCK and HumanInterruption with required decision, phase, integrated work, safe options, mandatory status and technical details. Process-registered execution capabilities are noncopyable/single-use. Every consumption/new writer rechecks revocation, plan, memory and current baseline chain. Historical records grant no new effect.

V2 DATA-009/GAT-001/GA permits policy authority only for beforeImplementation (including native-proven no-effect Developer retry), onScopeChange limited to policy-contained allowedPath additions without requirement/criterion/command/constraint/deny/budget changes, beforeCompletion and beforeReviewerRedispatch. Quiescence, target, CAS, locks, generation/hash, budgets and native terminal proof remain mandatory. Fabricate no HumanDecisionEvidence/TrustedConfirmationReceipt. Oracle and exhausted-retry decisions remain human-only.

Direct-human TerminalCompletionPackage v2 retains humanDecisionRef. Policy-derived v3 instead has authorizationKind/policyAuthorizationRef, without humanDecisionRef. Verify exact envelope and policy/real-approval closure; all CMP-001 predicates remain. GatePresentation/render records do not attest human dialogue for a policy action.

CandidatePromotionIntent v2 distinguishes authority and binds the concrete proposal to policy authorization, not a fictional human integrationCommit approval. One Git/validation/Reviewer/apply pipeline remains. IntegrationCheckpoint authorizes exact definition/ref/baseline through policy without inventing a Definition receipt. Native coverage/review remain; autonomous v1 adds no out-of-policy scenarios.

Target advances only through same-run native PromotionResults and exact policy decisions. External HEAD, wrong branch or dirty official folder pauses; no stash/reset/rollback/force/remote. Recovery may finish audit of an already-performed Git effect, but new effects need current capabilities. Controller death proves no role termination; reuse native incarnation/locks/store/recovery. Restored policy writers require fresh policy verification, never replay historical capabilities.

Binding Project Memory decisions remain human. A new task-attributed binding proposal interrupts before the next authorized action, including writing; changed accepted bindings invalidate policy. UNVERIFIED lessons remain advisory. Dependency v1 compares package.json dependency sections against explicitly allowed names/versions; changed lockfiles/other dependency manifests need decisions. It is no universal import/network/supply-chain scanner.

Manual pause occurs at the next safe boundary; revoke prevents new dispatch; cancel preserves evidence/results. Resume without reapproval requires current bindings and exact recovery; stale policy needs renewed approval. TUI/Markdown are views, not authority. Positive conclusion means approved work integrated and checkpoint PASS on current commit, not all requirements or a release.

Native gates remain active; recovery applies only to tasks already authorized by that run. Promotion requires same-run completion and exact native proposal; direct-human/other-run promotions do not join its autonomous chain. Native NOT_REQUIRED is valid only when binding, verified completion and current baseline agree; record an already-present result without Git mutation, invented merge or new human receipt.
