**English** · [Italiano](it/PROJECT-PLANNING.md)

# Project Planning / Task Decomposition

Project Planning proposes what to develop and in which order. Project Memory preserves knowledge across tasks. ControlledTask executes and verifies one unit through the existing workflow: 11 states and 43 transitions. No role, writer, Orchestrator, TaskSpec contract or global authority is added.

## Project-level contracts

`ProjectGoal` preserves identity, revision, objective, constraints, expected success and digest. `PlannedTask` contains intent, rationale, scope and acceptance/validation intent, hard dependencies with explanations and memory references. It contains neither executable commands nor authorized file-level scope.

`ProjectPlan` preserves a DAG, strategy, identity/revision, goal reference and previous approved revision. Proposals reject open schemas, authority fields, duplicate IDs, semantically duplicate objectives, empty intents, duplicate edges, missing references, self-dependencies, incomplete rationale and cycles. Nonpositional IDs remain stable; host identity binding requires identical objective, scopeIntent and acceptanceIntent, including array order. Changing these fields requires a new identity and updated dependency references. Strategy, explanations, checks and edges may change without replacing identity. Scope overlap is a warning, not an error.

Proposed documents are immutable in the store. A correction creates a new DRAFT revision. The DRAFT/APPROVED/SUPERSEDED lifecycle is a projection of the atomic index and trusted receipts, not an operational state. Content digest excludes only `status` and `contentDigest`; approval instead binds the complete canonical payload, including DRAFT status, artifact reference, planId, revision, index digest and presentation. A persisted receipt authorizes that exact proposal. The previous revision becomes SUPERSEDED only after replacement approval. All revisions and removed identities remain inspectable.

## Input and Scout

The pre-task Scout's analytical mode reuses the same registration, RPC, read-only tools, transcript verification, terminal proof, isolation and inventory limits. There is no ProjectPlanner agent. The host selects Project Memory relevant to repository files, bounded to eight records and existing Scout limits, and rejects conflicts. The model returns only references to supplied memories; the host resolves digests and revisions.

`PlanningInputReceipt` binds goal revision/digest, baseline commit and inventory, selected memories with digests/revisions, actual context artifact, Scout analysis and resulting proposal. Memory dispatch receipts still distinguish intent from acknowledgement. They do not certify model understanding. Approval and selection reassess conflicts and stale references without silent replacements.

## Starting work and executions

`/controlled-dev project` opens the view; `project plan` reopens a saved draft without regenerating it or prepares a proposal when no draft exists; `project status` reads progress. Objective entry, correction and revision use the shared wizard panel with question, rationale and progress. The summary includes the overall objective and scrolls independently of actions. Canceling final confirmation returns to the plan, which remains editable. A Scout correction violating identity is not saved and offers a new correction request. The user explicitly chooses among READY tasks. Selection produces a process-local host capability containing a prefill: the normal Scout must reexamine the repository and propose concrete scope and checks. Normal formulation and creation confirmation remain mandatory. Planning does not start Developer.

Creation saves a `PlannedTaskExecutionLink` separate from TaskSpec, bound to plan revision/digest, planned identity/digest, TaskSpec identity/hash and baseline commit. The existing mutation guard serializes the link and control input. The link is published before executable input: a crash may leave a conservative reservation, never unlinked input permitting a second execution. A reservation without a ledger appears ACTIVE with an explanation of preparation/interruption and requires explicit verification. This version allows one execution per stable identity; a new attempt after failure requires a new approved task, while internal retries and rework remain in ControlledTask.

WAITING/READY/ACTIVE/COMPLETED/BLOCKED/FAILED are computed by reading actual ledgers through DurableStore.load. AWAITING_HUMAN and REVIEWING do not satisfy a dependency. A FAILED or BLOCKED predecessor leaves its successor WAITING and explains why. Planning itself introduces no scheduler, automatic runner or parallel task execution; approved autonomy is a separate capability.

Before formulating a successor, the host checks changes in authoritative handoffs and manifests of completed predecessors against the current repository manifest. It includes ancestors and uses the latest result along each branch: a legitimate later change may supersede earlier bytes. Creation, modification, deletion, rename and mode must match. The check does not depend on the old candidate's physical presence or trust model-declared changedFiles. A missing result causes PROJECT_BASELINE_NOT_READY, identifying the missing prerequisite and path. Candidate integration requires separate authority: planning alone performs no automatic copy, merge, commit or promotion.

## Persistence and human view

The `planning` namespace uses the same DurableStore, immutable artifacts, fsync, atomic replace/CAS and LockManager already used by memory. An index makes goals, proposals, input receipts, approvals, links and the current revision visible. Orphan artifacts after a crash do not become authoritative. Reload verifies integrity, identity, revision sequence, receipt bindings, supersession, DAG and link uniqueness. It introduces no database, WAL or recovery engine.

Project.md, Planning/Current Plan.md, Plan History, Planned Tasks and a single Obsidian Base index extend the same vault. Task rebuild also reconstructs planning and memory. Home links to the project. Notes show dependency rationale, technical knowledge and actual task links; Notes survives rebuild. Editing Markdown does not change the store, approve plans or modify states.

## Limits and verification

Planning is optional: projects without memory or plans and historical tasks without links retain the current workflow. Greenfield Bootstrap, Integration Checkpoints, candidate promotion and Systemist are separate capabilities. Structural validation cannot certify the full semantic quality of decomposition: the skill guides functional slicing and proportionate foundation tasks, but human review and correction remain necessary.

The suite adds a medium six-task fixture, negative DAGs, receipt forgery/staleness/headless checks, revisions, memory conflict/bounds, read-only Scout RPC, normal formulation, approved scope changes, process competition, derived states, actual workflow completion with declared provider/UI doubles, missing/present baselines, non-authoritative Markdown and separate-process reload. Test UI responses do not certify a new human TUI test. The historical STORE_COMPLETION_PACKAGE_MISSING issue remains outside scope; the probe must report its actual result.
