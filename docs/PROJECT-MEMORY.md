**English** · [Italiano](it/PROJECT-MEMORY.md)

# Project Memory

Project Memory preserves software architecture decisions, technical lessons, conventions and constraints across tasks. Structured records in the project-level store's `memory/` namespace are authoritative; the Obsidian repository explains them, and personal annotations remain non-authoritative.

## Persistence and authority

`ProjectMemoryRepository` reuses `DurableStore` for canonical artifacts, integrity verification, synchronization and atomic snapshots. The single current index points to immutable records; previous revisions remain in history. SAD/TL/PC/TC IDs include a UUID, do not depend on Markdown names and are not reallocated. A crash may leave orphan artifacts excluded from the current index. There is no alternative WAL, ledger or recovery mechanism. `LockManager` workspace locks serialize mutations. During a task, role proposals use the lock already held by the host; separate TUI decisions require a free workspace.

The host creates only PROPOSED ADRs, conventions and constraints, or UNVERIFIED lessons. Acceptance, activation, supersession and retirement/deprecation require the native Trusted Human Confirmation Boundary. The payload includes the project, expected snapshot and complete revisions to update. The receipt is consumed under lock and persisted before the snapshot. Reload verifies that each authoritative current revision binds to a confirmation committed in the index. An orphan confirmation artifact does not promote records. A person assesses meaning and evidence; hashes and tests do not certify a lesson's truth.

ADRs: PROPOSED, ACCEPTED, SUPERSEDED, DEPRECATED. Lessons: UNVERIFIED, ACTIVE, SUPERSEDED, RETIRED. Conventions and constraints: PROPOSED, ACTIVE, SUPERSEDED, RETIRED. Supersession updates the replacement and previous memory together; both relationships remain verifiable. Retired, deprecated and superseded records remain as tombstones.

## Applicability and context

Repository, directory or component scope uses relative paths only. A component is initially identified by its path; there is no semantic classifier. The host prefilter considers current status, scope and relevant files. Lessons additionally require an explicit loadWhen match, such as a term in the objective or a relevant path, and current evidence. Evidence refers to original task, scenario, run, bundle, validation, review, artifact or repository configuration bytes; it is not copied. A digest mismatch excludes the lesson from context. `invalidateLessons()` returns it to UNVERIFIED while preserving history; an accepted ADR remains ACCEPTED and reports stale evidence. InvalidatedWhen describes assumptions to reassess: it is not an automatic NLP engine.

Structural conflicts between current records with the same decisionKey/problemKey and overlapping scope produce PROJECT_MEMORY_CONFLICT, without an automatic winner. Context limits are eight records per role: Scout/Developer 12 KiB and 10,000 characters; Reviewer 16 KiB and 12,000 characters. Deterministic selection prioritizes binding memories and identifies omissions. Reviewer preserves the identities/revisions/digests of binding records selected for Developer; if they changed or exceed the limits, dispatch fails explicitly. Lessons may differ between roles.

Even without an archive, every workflow dispatch records an empty selection and its receipt in the task store without creating the memory namespace. Existing historical ledgers need no retrospective receipts. Selection produces an exact context artifact. Runners append it to the actual RPC prompt. MemoryContextReceipt records task, role, assignment, request ID, run ID when available, record IDs/revisions/digests, sizes, rationale and timestamp. DISPATCH_INTENT preserves intent before sending; PROVIDER_ACKNOWLEDGED establishes that the provider acknowledged that dispatch. Receipts are immutable artifacts already synchronized in the store. References enter the ledger through the next run observation or terminal/error reconciliation, without a separate task event for each receipt. Receipts do not prove understanding, code compliance or human reading. Scout distinguishes observations from memory; planning derives bounded contextual expectations with references; Reviewer explicitly assesses architectural divergence. The completion package contains receipt and proposal references, without the entire archive or a new completion predicate.

## Proposals, TUI and Obsidian

Scout, Developer and Reviewer may return an optional memoryProposals sidecar separate from normative result contracts. Its closed validator permits only the four software kinds and prevents self-assigned status/authority. The host records origin and task and retains non-authoritative proposals only. PreTaskProposalResult remains separate and does not accept this sidecar. A trusted host may use `propose()` with the same contract. `/controlled-dev memory` lets a person read, accept/activate, retire or supersede a proposal through the human dialog; invoking the command is not approval.

`rebuildHumanView` also regenerates Architecture, Lessons, Conventions and Constraints; `rebuildProjectMemoryView` permits separate regeneration. A Project Memory Base filters by kind, status and scope. Wikilinks connect actually available task/evidence notes, related memories and replacements. Notes is not overwritten. Manual Markdown edits never enter an authoritative load.

## Compatibility and boundaries

The namespace is optional: historical tasks require neither memory nor new TaskSpec/AssignmentEnvelope fields. The state machine remains 11/43; the parent remains read-only, Developer the sole semantic writer in the candidate, and Reviewer independent. Generic receipts do not replace acceptHumanDecision. Systemist kinds are permitted only as references owned by Systemist: this package does not write requirement interpretation, System ADR or system evidence assessment. Project Planning, Greenfield and Integration Checkpoints are outside this capability's scope.

A historical test may encounter STORE_COMPLETION_PACKAGE_MISSING on legacy stores already incompatible with the previous baseline; Project Memory does not repair this preexisting issue.
