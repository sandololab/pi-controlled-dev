**English** · [Italiano](it/TRUSTED-CONFIRMATION.md)

# Trusted Human Confirmation Boundary

This internal primitive makes trusted TUI confirmation transport reusable. It does not implement Project Memory or add states, transitions, global authority or agent tools. The human remains the decision authority; the Orchestrator remains the sole task-state authority.

## Separation of responsibilities

`requestHumanConfirmation` contains the native path previously internal to the Orchestrator: it requires TUI and session, uses `ctx.ui.custom` or `ctx.ui.confirm`, accepts only boolean true and checks that session, mode and UI method have not changed. `confirmHumanDisplay` and `presentHumanGate` use this same transport.

The task contract is unchanged. `presentHumanGate` still requires a registered gate. `acceptHumanDecision` retains its entire admission logic: current gate, TaskSpec, revision, locks, `AWAITING_HUMAN`, current presentation, stale protections and single-use receipt. A generic receipt cannot replace it. `GatePresentation` and historical channel documents are unchanged.

## Host-only use

Trusted code builds a request with `createTrustedConfirmationRequest`. Allowed purposes are `task-human-gate`, `project-memory-approval`, `project-plan-approval`, `candidate-promotion`, `integration-checkpoint` and `greenfield-bootstrap`. Consumers apply their domain rules, and approvals remain separate. Purposes grant no permissions.

A request contains schemaVersion, local confirmationId, purpose, subjectKind, subjectId, subjectRevision, action, canonical payload, payloadDigest and presentation. The host must prepare a complete explanation faithful to the payload; transport cannot prove semantic equivalence. Action, subject, revision and cancellation meaning are appended. The presentation digest includes the title and entire logical content supplied to the renderer; it does not certify pixels, complete scrolling or human reading. Characters the renderer would remove are rejected.

The payload is limited to 64 KiB canonical bytes, presentation to 64 KiB, request to 129 KiB and evidence to 132 KiB. JSON copies are inert and deeply frozen. Only the object registered in the same process may be presented, once. These APIs are not registered as tools or RPC endpoints; role modules do not import them. As in the existing trust model, the Pi host and loaded extensions are trusted: a hostile in-process extension is outside the threat model.

`presentTrustedConfirmation` confirms the exact request text and returns a receipt only after native true. APPROVE, REJECT and ANSWER are explicit actions selected by the host and shown to the human; ANSWER must include its exact content in payload and explanation. False, Esc, timeout, nonboolean responses and lost bindings do not record a decision. The production module contains no simulation.

The receipt binds purpose, subject, revision, action, payload digest, presentation digest and entire request digest. confirmationInstance contains a local ID, host session and UI source. It invents no personal identity, signature or provider confirmation ID.

## Persistence and consumption

`consumeTrustedConfirmation` requires the original receipt, a reader for the exact current request and the existing store with `put`/`read`. It consumes the capability before I/O, checks freshness and channel, persists request and receipt as one canonical artifact, verifies reread bytes, then rechecks freshness and channel. It returns ArtifactRef only after these checks. Errors also burn the capability.

The consumer must hold its existing locks/CAS, include ArtifactRef in its durable update and apply the authoritative action only after return. The boundary modifies no domain object, interprets neither APPROVE nor REJECT and creates no WAL. The consumer is responsible for correct `put`/`read`, durability, local decision and atomicity of its update. Atomicity between artifact and future action is not assumed: a crash may leave an orphan artifact, which does not authorize replay.

`readTrustedConfirmationEvidence` verifies canonical integrity and correlation of a historical artifact with the exact expected request. It does not independently authenticate arbitrary JSON: provenance from a trusted store is required. A digest proves integrity, not human origin. Reload does not register the receipt or restore a consumable capability. After a crash, the consumer must verify its durable state; a new action requires a new human confirmation.

`test/trusted-human-probe.ts` remains diagnostic only and is not distributed in the runtime package. Its responses, booleans and serialized copies cannot be consumed as authoritative receipts.

## Fixtures and verification

`test/project-confirmation-host-probe.ts` contains only `ProjectMemoryProposalFixture`, not Project Memory models or a store. The fixture uses `DurableStore.put` and supports a native TUI test by explicitly loading the probe in Pi and invoking `/project-confirmation-fixture`. It restricts the parent to read-only, rejects headless use and retains artifacts in a temporary area separate from the repository. It is not distributed in the runtime package.

Automated tests use declared UI doubles to check approval, rejection, answers, cancellation, sessions, replay, forgery and request changes. The fixture also checks persistence and rereading in a new process without restoring authority. These tests do not establish real human confirmation.

This primitive required no normative ARCHITECTURE, PROTOCOL or TEST-MATRIX changes: normative gates continue through the existing path, and extraction preserves semantics. The host transport is an internal primitive without changes to the global 11/43 model. README and manual describe the capabilities actually available.
