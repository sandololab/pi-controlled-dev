**English** · [Italiano](it/PROJECT-AUTONOMY.md)

# Project Autonomy / Bounded Autonomous Execution

Supervised mode continues to request normal confirmations. Controlled Autonomy requires an explicit choice: a person approves the exact plan and a policy with verifiable limits. The same dialog may present both while preserving independent evidence.

## Flow

Project Plan → pre-task Scout → TaskSpec within policy → ControlledTask → validation/rework → Reviewer → completion → Candidate Promotion → next task → final Integration Checkpoint.

The policy does not approve every future candidate as though it had been shown. Each action records PolicyDerivedAuthorization and current deterministic checks. No model can activate a policy or produce executable capabilities from copied JSON. Task states and transitions remain 11 and 43.

The menu offers execution mode selection during final plan review. In the production flow, pre-task Scouts propose scope and checks read-only; the host verifies that files fit within planned boundaries and compiles only existing permitted recipes. Manual path or command entry is not required. One native confirmation binds the exact plan and policy, then starts the existing controller. `project auto` starts an already approved policy; `project pause`, `resume`, `revoke`, `cancel` and `autonomy` manage the run. In the live panel, P requests pause at the next safe boundary, D opens details, and Esc hides the panel while work continues.

Design and implementation steps reach both the pre-task Scout and the plan snapshot in TaskSpec. The normal workflow preserves Project Memory selection and receipts, role skills, scenarios, instrumentation, validation, rework, Reviewer and integration. Planning may propose decisions in the same Project Memory; adoption requires the normal memory path and new analysis with updated context.

## Version 1 limits

- Recovery adopts only tasks already admitted by that same run; historical tasks or tasks completed outside it remain supervised. Gates cannot be disabled.
- A candidate without changes reuses the native NOT_REQUIRED result: the baseline already satisfies the task, without creating a merge or false receipt.
- Sequential execution, plan order among READY tasks, at most 64 authorized tasks.
- Literal relative folder/file boundaries, with an optional terminal `/**` in policy. ScopeGuard still receives concrete files, without new glob semantics.
- Objective and acceptance intent must match PlannedTask text exactly. Proof of semantic equivalence is not delegated to a model.
- Exact CommandSpecs derive from native proposals, with mandatory review and diff checks and observed tests among available host recipes. An essential variation during execution requires a new decision.
- A final checkpoint with exact recipes, mandatory review and only the run's tasks. No implicit additional scenarios.
- In package.json, added or changed dependency names/versions must be explicitly planned; changed manifests from other ecosystems and lockfiles cause conservative escalation. Not all imports or network operations are analyzed.
- A binding memory proposal requires a human decision; UNVERIFIED lessons do not automatically become ACTIVE.

## Interruptions

Plan/architecture changes, additional scope, Git conflicts, unexpected dependencies, exhausted budgets, risks or ambiguities, external/dirty baselines, revocation and uncertain termination produce HumanInterruption. The view shows what is already integrated, the required decision and safe options; none is automatically selected.

Pause/resume preserves the audit trail. Policy can be revoked; completed results remain verifiable. Recovery reuses native primitives with exact identities: historical proofs do not authorize a new writer. No reset, stash, rollback, force update or remote Git.

## Audit and views

DurableStore is authoritative. Gate v2 and TerminalCompletionPackage v3 identify policy authority without humanDecisionRef; old direct-human v1/v2 records retain their semantics. PromotionIntent v2 and checkpoint approvals bind the exact concrete subject to the policy.

Project.md, Current Plan and a single Autonomy Activity explain mode, progress, results and interruptions. Editing them does not change authorizations. Digests and receipts belong in technical details, not repeated requests.

## Manual check to perform personally

In a harmless fixture repository, open Pi and `/controlled-dev project plan`. Request four small increments to a local file, choose **Controlled Autonomy**, review design, planned files and proposed checks, read the plan and policy, and confirm once. Verify progress, zero per-task confirmations, P for pause at a safe boundary, resume with current bindings and a final summary for the verified commit. In a second fixture, deliberately request an out-of-bounds file: the system must stop while preserving already integrated results. Greenfield first requires bootstrap and any separate memory decisions.

Automated fixtures use declared provider and human-channel doubles, with real Git/processes/validation. They do not replace human testing or real-model testing. Their status is reported separately in validation reports.

Workflow state revisions such as `state-r11` belong to one ControlledTask. Their immutable copies in the project Autonomy store use `autonomy-task-state-<hash>` derived canonically from the autonomy run, planned task, controlled task, artifact kind and local revision. The host reads the source only from the task namespace bound by the verified authorization and preserves the exact bytes and digest. This changes evidence addressing only, not policy authority or transitions. Valid historical effect references retain their original names and load/recover without migration. Exact effect recording remains idempotent for crash recovery; consumed action capabilities still reject replay, and differing bytes cannot overwrite an existing identity.
