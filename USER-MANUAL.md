---
title: "pi-controlled-dev"
subtitle: "User manual — version 0.1.0-beta.2"
lang: en-US
toc-title: Contents
---

**English** · [Italiano](docs/it/USER-MANUAL.md) · [Documentation](docs/README.md)

# What is pi-controlled-dev?

pi-controlled-dev is a package for Pi Coding Agent. It delegates development to distinct roles, with explicit boundaries, verification and human decisions. This manual covers **0.1.0-beta.2**, a development beta; some interruptions require operator intervention.

All package interface text, generated explanations and role instructions use English. You may describe your objective in another language. Your words, source contents, exact evidence and historical records are preserved verbatim; they are not silently translated. English and Italian documentation both use the actual English menu labels.

# Current beta status

Available features include current-folder project setup, an empty technical baseline, a five-step task wizard, read-only pre-task Scout, checks proposed without writing code, editable summaries, separate status/activity/check/details views, explained recovery, cross-task Project Memory, approved Project Planning with dependencies/revisions, approved local Git integration, exact-commit Integration Checkpoints, native Pi confirmations and Controlled Autonomy under an explicitly approved policy.

Historical P17 testing completed one documentation task in a clean repository with real Pi, pi-subagents, Scout, Developer, Reviewer, two passing host checks and native human confirmations. The result remained in the candidate; the original was unchanged. That demonstrates that particular path, not all tasks or environments. Positive and negative regression tests cover the REVIEW-criterion `RESULT_SCHEMA_INVALID` issue. See [current validation results](docs/VALIDATION.md); historical passes are not certification of this revision.

The system proposes; you correct and authorize. The TUI does not decide scope, validation, completion, recovery or human gates.

# How often must I intervene?

Choose **Supervised mode** for normal individual confirmations, or explicitly choose **Controlled autonomy** and approve the exact plan and limits. Autonomy can develop, validate, rework within budgets, independently review and progressively integrate planned tasks, then verify the integrated baseline. Ordinary tests, permitted rework, positive review and integration covered by policy do not require repeated approval.

It stops for plan/architecture changes, extra scope, Git conflicts, unexpected dependencies, unresolved risk, exhausted budgets, unexpected external edits or processes whose termination cannot be proven. The screen explains what is integrated, why execution stopped and what decision is needed.

## Authorize the plan

In **Project plan**, read or correct the proposal and choose the mode. For Controlled autonomy, the package derives allowed files/directories and checks from Scout proposals against the current repository. Review tasks, branch, limits and stop conditions. One native dialog can approve the exact plan and policy with distinct evidence. Future candidates are authorized by policy within its limits; they are not attributed to you as new direct confirmations.

Task criteria and commands must stay within the approved plan/policy. An unprovable variation stops execution. Version 1 runs one task at a time in approved order; protected files and fixed boundaries remain protected.

## Follow, pause and resume

The automatic development view shows completed, active and waiting work. **P** requests a pause at the next safe boundary; **D** shows details; **Esc** hides the panel while work continues. Commands are `/controlled-dev project pause`, `resume`, `revoke`, `cancel` and `autonomy`.

Pause preserves the task and audit. Resume can reuse a valid plan, policy and baseline; changed external state or binding requires fresh approval. Revocation prevents new automatic actions. User changes are never automatically cleaned up.

A new project first requires setup decisions, then plan/policy approval. Setup creates no application code: development still goes through ControlledTask. The final summary identifies integrated tasks, final checks and project folder; it is not certification of the entire product.

## Initial limits

New-dependency checks inspect `package.json` dependency sections; names/versions must be explicitly allowed. Lockfile changes and other ecosystems' manifests require a decision. There is no universal dependency parser. Binding memory decisions remain human; lessons can be proposed as UNVERIFIED.

`Project.md`, the current plan and autonomy activity notes summarize progress without a note for every micro-action. Editing notes changes no authorization or result. Autonomous actions retain policy provenance; direct confirmations retain their own origin.

# What it is for

Use it for a focused document change or bug fix, a feature, or a larger software initiative decomposed into planned tasks. Each concrete task passes through development, checks and approval. Results are prepared in a separate working copy, with integration as a distinct step.

# Workflow at a glance

```text
Describe the objective
  → pre-task Scout proposes scope, criteria and checks
  → correct the proposal and confirm task creation
  → Scout analyzes the project
  → authorize implementation
  → Developer changes an isolated candidate
  → host checks scope and runs approved validations
  → Reviewer independently assesses the result
  → authorize completion when every condition is satisfied
  → COMPLETED: verified result in the candidate workspace
```

Uncertainty, errors or insufficient evidence stop the dependent step. Oracle advice and permitted corrections cannot bypass agreed boundaries.

Before edits, the host runs already-available approved checks on the working copy and supplies Developer with the actual commit and observed results. Developer reads those results without claiming to have executed the commands. A failing initial check prevents development. Tests/configuration to be created by the task are marked deferred, not PASS. Checks run again after edits; baseline evidence never replaces final-candidate evidence.

A Developer that returns a complete bounded-blocker report without changes or commands can be resumed in the same task only after evidence and unchanged copies are verified and fresh authorization is obtained. History and consumed attempts remain. These resumptions count against `maxReworkAttempts` and the total dispatch limit; they neither consume nor reset the separate infrastructure retry budget.

**COMPLETED does not mean the original project has changed.**

## Software design quality

Scout examines modules, responsibilities, boundaries, reusable components, conventions and configured quality tools, then proposes task-specific design expectations visible before task creation. Developer should reuse, extend, compose or parameterize existing code where appropriate. OOP, interfaces and patterns must solve a real problem in the current language/repository. Avoid artificial frameworks and unnecessary hierarchies, while avoiding duplication of genuinely shared logic, invariants, validation and transformations.

Names, responsibilities and side effects must remain understandable. Document non-obvious recovery, concurrency, locks, retries and fail-closed behavior through reasons, assumptions, invariants and edge cases. Reviewer checks reuse, duplication, complexity, documentation, dead code and overengineering; aesthetic preferences already governed by the formatter/linter are not reasons to block a task.

# Project Memory across tasks

Task memory explains one objective, candidate, validation, review and its decisions. Project Memory preserves technical knowledge useful across tasks; it is not a roadmap or milestone scheduler. For example, a decision to reuse an existing persistence repository can inform later Scout proposals, Developer boundaries and independent review. Each dispatch retains a receipt identifying the exact supplied memory versions.

## Four memory types

| Type | Meaning and lifecycle |
|---|---|
| Software Architecture Decision / Software ADR | Context, decision, rationale, alternatives, consequences, scope and evidence. PROPOSED is not binding; explicit human confirmation makes it ACCEPTED. Replacement preserves the old item as SUPERSEDED and links its successor. DEPRECATED retires it without requiring a replacement. |
| Technical Lesson | Experienced problem, cause, lesson, applicability and reconsideration conditions. Starts UNVERIFIED. A separate human decision can make it ACTIVE after evaluating evidence/scope. It remains advisory and grants no permission. Retirement/replacement preserves history. |
| Project Convention | Naming, module organization, error handling or another project practice. Prefer a reference to current configuration over copying all its rules. |
| Technical Constraint | Persistent compatibility, platform, dependency or protected-boundary constraint. This is software guidance, not a Systemist requirement or system architecture decision. |

## Read and decide

Open `/controlled-dev memory` or **Project memory**. Inspect meaning, status, scope and evidence before accepting, activating, rejecting, retiring or replacing a memory. Roles and trusted hosts can submit proposals under the same contract; roles cannot adopt them. Replacements present both changes and retain linked history. No, cancellation or dialog failure records no decision.

Memory approval is separate from task creation, implementation and completion; it changes neither candidate nor scope. A separate project-level decision needs a free workspace. If a task holds locks, finish or recover it through its proper path; do not delete locks or store data.

## Selection and receipts

Only current, relevant memories are selected. Lessons additionally require explicit loading conditions and usable evidence. Each role gets at most eight records. Scout/Developer limits are 12 KiB and 10,000 characters; Reviewer limits are 16 KiB and 12,000 characters. Long content can reduce the count. Omissions are reported; conflicting decisions on one topic require explicit resolution.

Reviewer receives the same identities, revisions and digests of decisions, conventions and constraints selected for Developer. If that basis changes, reevaluation is required. Relevant lessons may differ by role.

Missing or changed lesson evidence prevents its use as valid advice; the host can return it to UNVERIFIED. Evidence trouble on an accepted ADR is reported without automatically revoking the decision. Semantic invalidation conditions still require human judgment.

Task notes link the memory actually supplied. Structured receipts preserve record, revision, digest, selection reason, size and dispatch identity, distinguishing intent to supply context from provider acknowledgement. They do not prove the model understood or obeyed it.

Obsidian views include `Architecture`, `Lessons`, `Conventions`, `Constraints` and a Project Memory index, linked to tasks/evidence/predecessors/successors. JSON records remain authoritative. Writing ACCEPTED in Markdown neither accepts a proposal nor activates a lesson. Regeneration preserves personal `Notes`.

# From project to controlled tasks

A project has a broad software objective. A plan describes work and order. A planned task expresses intent, rationale, scope and validation intent. A ControlledTask is a concrete unit with approved files, criteria and checks against the current repository. Dependencies indicate required predecessors; Project Memory supplies knowledge without executing or duplicating the plan.

## Prepare and correct a plan

In an open project, type your objective in interactive chat, use `/controlled-dev request <description>`, or choose **New request**. Scout first uses available source and memory, asking only for information that affects the result, architecture or compatibility. You need not reproduce readable file inventories or configuration.

Answers are saved immediately; `/controlled-dev` resumes outstanding questions. Once context is sufficient, the proposal includes design, decision rationale, components/interfaces, data flows, compatibility, validation strategy, risks and per-task implementation steps. The complete design accompanies the TaskSpec supplied to agents.

Reusable decisions are proposed in existing Project Memory. **Design memory** uses normal memory controls to adopt, retire or replace them; changes trigger memory rereading and a fresh plan proposal. Plan approval alone leaves memory proposals unadopted.

Use `/controlled-dev project` or the advanced project/next-work entry; `/controlled-dev project plan` opens preparation/correction directly. For example, local synchronization might be split into protocol, discovery, transfer, conflict handling, UI and end-to-end checks. Each task must describe a meaningful verifiable increment. Justified infrastructure prerequisites are allowed; a giant task or arbitrary file/method checklist is not useful decomposition.

Correct in natural language: “combine these tasks”, “do this first”, “leave module X unchanged”, “separate UI and protocol”. Each correction creates a draft; Back can preserve it without approval. Native approval binds the exact objective, strategy, tasks, criteria, explained dependencies and memory references. A command or model answer cannot substitute for it.

## Revisions and discoveries

DRAFT becomes APPROVED only through confirmation; its content then stays immutable. New findings or constraints can motivate another draft. The previous plan becomes SUPERSEDED only when the replacement is approved. History retains removed work and past executions. Failure does not automatically delete/reorder the plan. Conflicting memory decisions must be resolved explicitly.

## Select the next work

`/controlled-dev project status` shows the current revision, counts, outcomes and ready choices. WAITING means a prerequisite is missing; READY means dependencies permit formulation; ACTIVE includes a linked running task or prepared TaskSpec. COMPLETED, BLOCKED and FAILED reflect the actual ControlledTask.

For oversized work, choose **Break down the work** or `/controlled-dev project refine`. Select an unstarted item; Scout proposes one, two or three increments replacing only that item. The package preserves design/other tasks, updates dependencies and presents the complete revised plan for approval. No Developer or parallel writing starts. A broad remainder stays marked for further subdivision and cannot run as one assignment. If the task or its successors already link to execution, use ordinary plan revision; refinement cannot change those links. Source size informs estimation but cannot replace reading.

A **CANDIDATE_TEST** recipe can run Python tests created by the current task. Review configuration and files before creation. The host runs them in the candidate without caches/bytecode, automatic pytest plugin loading or extra options. Fixture-declared plugins remain possible. Missing files, empty collection or all-skipped tests do not pass; test-produced changes are not ignored. Saved historical recipes remain unchanged.

After a stop, first verify process termination through recovery. **Close blocked attempt** or `/controlled-dev close-attempt` requests confirmation to record FAILED, preserving candidates, logs and counters. No partial file is integrated. The project goal remains available for a smaller proposal. An already accepted Developer result or recorded candidate requires its own recovery path.

For new tasks, a predecessor must be COMPLETED and available in the baseline: its candidate commit must be in target history, or it must be a verifiable no-op. Pending review/confirmation is insufficient. When multiple tasks are ready, supervised mode asks which to formulate; it does not start parallel tasks.

**Continue the work** preserves plan intent while Scout reexamines current files, tests and architecture. Concrete scope/checks can be corrected before creation. Plan approval does not itself approve that TaskSpec; supervised creation, implementation, scope expansion and completion remain distinct.

Preparation immediately shows the planned objective/rationale, without editing code or yet creating the task. The execution link is stored outside TaskSpec; concurrent requests for the same identity are rejected. Version 1 permits one execution per planned identity; internal retries/rework stay in its ControlledTask. After failure, propose a new planned identity. An interruption between reservation/linking and TaskSpec persistence leaves a conservative reservation requiring inspection, not an automatic second launch.

## Completed prerequisites can still be absent from the baseline

Completion certifies the candidate. A successor remains WAITING until the predecessor commit is in target history. After approved integration it becomes READY if other prerequisites are satisfied, and still passes pre-task Scout and normal admission. Supervised mode uses individual confirmations; autonomy may authorize steps within policy.

Historical tasks without Git binding retain their prior baseline checks and remain readable/recoverable, without automatic promotion. Similar files or cherry-picked equivalents do not prove candidate ancestry; a manual merge that makes the exact candidate an ancestor is recognizable.

## Read plans and progress

`Project.md` summarizes the objective, current plan, task states and next steps. `Planning/Current Plan.md` explains strategy; `Plan History` retains revisions; `Planned Tasks` distinguish intent from linked execution, explaining dependencies/memory. One index Base filters state, dependencies, links and revision.

The current plan leads with observed progress and update time. The approved proposal retains its own date and observations, which do not override current task evidence. Task notes distinguish objective, available rationale, planned steps, expected result and checks; planned steps are not claims of completed work.

From the editor, **Alt+P** opens plan consultation and **Alt+S** task status. Ordinary commands may queue behind an active command. During **Prepare work**, Alt+P opens internal plan reading: Tab/left/right selects a point, Enter opens details, up/down scrolls. Esc returns from details to the list, then to waiting without cancellation. An arriving proposal waits until reading closes. Esc on the waiting screen itself cancels preparation.

Other panels retain their own keys; close them before using editor shortcuts. Panels appear one at a time, and consultation never replaces confirmation. Wait for a safe boundary before editing the plan.

Structured records remain authoritative. Markdown edits cannot change dependencies, approve plans or create tasks. `/controlled-dev rebuild-view` can regenerate planning, memory and task views even before the first task, preserving `Notes`. Planning is optional: `/controlled-dev new` still supports one task without a plan/memory. Systemist planning is outside this package.

# Open or create the current project

Start Pi in the project folder and use `/controlled-dev`. It reopens saved work or registers that same folder, without asking for a destination or assuming refactoring. Git subdirectories resolve to the repository root; a parent with one descendant repository opens it. With multiple descendants, start in the intended repository.

## First launch

Describe the desired feature, completion, fix, integration or refactoring, with preferences/constraints. The objective is saved before Scout starts. If Git is missing, confirmation presents folder, inventory and exclusions for a local baseline. Files keep location/content; an empty folder gets an empty technical baseline. Caches, local settings and known credential paths are excluded through local Git configuration. No application code is generated.

Missing Git name/email are requested and set locally after confirmation. Cancellation preserves the objective without initializing Git. Existing Git repositories without commits require you to prepare the initial commit.

## Plan and development

Scout proposes a plan that accepts natural-language corrections. After approval, **Continue the work** selects the only ready item or offers alternatives. The compact task proposal shows objective, result, allowed files, criteria and checks; notes/details are separate.

**Create the task** confirms the proposal and enters supervised workflow, retaining implementation/completion authorization. **Controlled autonomy** prepares sequence limits for review with the plan, then starts after confirmation. Both paths reuse agents, skills, memory, scenarios, instrumentation and independent review. Developers work in isolated copies; approved integration updates the official folder.

`/controlled-dev` reopens prepared/interrupted work before proposing more. `/controlled-dev project plan` requests new analysis/revision; `/controlled-dev menu` exposes advanced controls. `project new`, `project existing`, `project refactor` and `project open` are current-folder aliases.

## Preserve existing work

Dirty repositories may be opened/planned, but development needs a clean committed source baseline. The package neither removes, hides nor automatically commits existing changes. Git-ignored local files do not dirty that baseline.

Interrupted initialization preserves data/evidence and is not replayed automatically. If Git and the initial commit are complete, reopen and continue; otherwise inspect first. Recovery uses no destructive overwrite or deletion.

## Import a separate copy

Only `/controlled-dev project import` asks for source and destination. The destination must not exist and must be separate from source/profile. Review inventory, exclusions, identity and objective before confirmation. See [source import](docs/SOURCE-REFACTORING.md).

# Requirements

Install Node.js **22.19.0 or later**, npm, Git and Pi Coding Agent. Configure a usable model and credentials in Pi. Install **pi-subagents separately in the same profile**; this package neither bundles it nor imports its internals.

Runtime behavior depends on publicly verified RPC capabilities, not a fixed provider version. Reported versions are diagnostic. Unknown future versions may work; older ones may support only part of the functionality. Missing capabilities disable dependent actions safely.

For Reviewer recovery, `status` observes logical state; `stop` requests termination of the exact run; `processTerminalProof` with `asyncComplete` attributes termination. Without stop, waiting is bounded. Without verifiable terminal proof, the task stays blocked and no replacement Reviewer starts. Timeouts, restarts and disappeared sessions are not historical proof.

Development needs a clean Git baseline with at least one commit. The package must create external working copies and sync files/directories. Process-death verification uses Linux evidence; other environments or unverifiable system changes may prevent recovery.

# Installation

## Use a dedicated Pi profile

While this extension is loaded, the parent conversation model is read-only for the entire session, including after completion. In a dedicated terminal:

```sh
export PI_CODING_AGENT_DIR="$HOME/.pi-controlled-dev"
```

Pi commands there use this profile; another terminal without the variable keeps the normal profile. Configure model and credentials separately in the dedicated profile.

## Install from GitHub

```sh
export PI_CODING_AGENT_DIR="$HOME/.pi-controlled-dev"
pi install git:github.com/sandololab/pi-controlled-dev
pi install npm:pi-subagents
pi list
```

This follows the public repository's default branch. To pin a verified revision, append `@COMMIT_SHA` to the Git source, replacing the placeholder. A pinned commit does not advance on updates. Commands are documented for Pi 1.3.0; see [validation status](docs/VALIDATION.md).

## Alternative tarball installation

For a tarball in Downloads:

```sh
npm install --prefix "$HOME/.local/share/pi-controlled-dev" \
  --ignore-scripts --omit=dev --omit=optional \
  "$HOME/Downloads/pi-controlled-dev-0.1.0-beta.2.tgz"
pi install "$HOME/.local/share/pi-controlled-dev/node_modules/pi-controlled-dev"
pi install npm:pi-subagents
pi list
```

Pi loads the installed package directory. npm registry publication is unnecessary. Keep package/profile outside the target repository and outside a directory containing that repository. This tutorial uses a profile installation rather than project-local package configuration.

# First run

Start `pi` from the project root, then `/controlled-dev`. Describe the objective if missing; Git setup is proposed only when needed. Existing projects reopen their saved plan/work. If agent runtime is unavailable, install pi-subagents in that profile and restart Pi. Saved project information does not substitute for a working runtime.

Before development, decide which local changes to commit. The package preserves existing files; do not install it or its Pi profile inside the target repository.

# Create a task

Use `/controlled-dev new`. The wizard has five steps:

1. **Objective:** describe the desired result. Pre-task Scout reads source/relevant guidance without writes or commands; no TaskSpec exists yet.
2. **Scope:** inspect exact allowed files, including new ones. A planned directory is design intent; the concrete task lists individual files. Edit accepts up to 4,096 relative paths, one per line, within result capacity. No outside paths, `..`, `.git` or wildcards.
3. **Criteria:** edit verifiable results, one per line.
4. **Checks:** inspect proposed validation; request a Scout correction in natural language without writing programs/commands.
5. **Summary:** review everything, edit a field or choose **Create the task**, followed by separate native confirmation.

**Next** and **Back** retain values. Editing prefills existing text; Esc in the editor retains the old value. Esc in navigation proposes cancellation, which can be declined. The session-local task draft is discarded on cancellation or Pi exit.

Use left/right or Tab to choose actions, Enter to open, up/down or PgUp/PgDn to scroll, and Ctrl+J for an editor newline. Changing the objective or requesting correction causes fresh Scout analysis. Back without a change does not repeat analysis.

Esc during Scout requests stop, waits for termination verification and discards the result. Uncertain termination prevents reuse; no fallback task is created.

Supported checks include exact contents, observed existing npm/pytest/Cargo/Maven/Gradle/Make tests, candidate tests and independent review. Fixed host recipes never interpret natural language as code. Diff checking is always included but alone proves no functional correctness. Repository tests execute candidate code: review the proposal before authorizing it.

Only after confirmation does the host build, validate and persist configuration: in the Pi profile for older projects, or `.controlled-dev` after storage adoption. You need not write JavaScript, shell, argv or JSON. Creation does not replace implementation/completion gates; there is no public editor for frozen TaskSpec. A prepared, active or incomplete task prevents a second one in the same project.

# Start the task

Use `/controlled-dev run`. The host locates the current project's task, verifies the environment, acquires exclusive control and dispatches Scout. Developer requires the guided authorization before writing a separate copy. Do not repeat `run` to recover an interrupted task; use recovery commands.

# The four roles

| Role | Responsibility |
|---|---|
| Scout | Read the project, gather relevant facts, identify risks/ambiguities; no writes. |
| Developer | Implement within approved candidate paths; no shell or agent spawning. Test claims do not replace host execution. |
| Reviewer | Independently inspect candidate and criteria; accept, request changes or block. No writes or unilateral completion. |
| Oracle | Advise only where the workflow permits. No authorization, replacement Reviewer or approval on your behalf. |

# Human confirmations

Confirmations appear in Pi's native panel, using wizard framing when supported. The default is **No**; select explicitly and confirm. Commands, model messages and “approved” files are not confirmation.

Implementation approval covers objective, paths and checks. Scope-extension approval covers newly proposed paths; a proposal or rejection grants no extra access. Accepting Oracle advice permits the specified reconciliation, not automatic new development. Decisions after retry exhaustion preserve all counters/limits. Completion approval follows validation and independent review and still does not update the original repository.

No, Escape and dialog failure grant no approval. To revisit a valid pending request:

```text
/controlled-dev decide APPROVE
/controlled-dev decide REJECT
/controlled-dev decide ANSWER I would like to clarify the required text
```

Each requires native confirmation. REJECT is final rejection; ANSWER records clarification without approval. These words sent merely to the model have no workflow authority.

# Inspect status

`/controlled-dev status` opens **Overview**, **Activity**, **Checks** and **Technical details**. Left/right or Tab switches views (1–4 are shortcuts); up/down or PgUp/PgDn scrolls; Esc closes. Views observe host state without authorizing actions.

Overview presents objective, status, result and required decisions/recovery. Activity orders Scout, Developer, validation, Reviewer and confirmations. Checks separates criteria, automated checks and independent review. Technical details contains full paths, codes and internal references. Progress shows observed phases, not estimated percentages.

Use the advanced menu for task start, pending decisions and recovery explanations. Admission remains the engine's responsibility. `/controlled-dev status --technical` supports deeper diagnosis; historical tasks may require an explicit task ID.

# Diagnose failing checks

The host records process results and bounded structured runtime events emitted by tests. It does not indiscriminately read environment variables, credentials or arbitrary files. Output/events are bounded and redacted before storage; common-secret redaction is not universal detection, so avoid confidential test data.

Checks shows outcomes, observations, cautious hypotheses and missing information; Activity shows when evidence was collected; Technical details links logs/artifacts. Explanations cannot turn failures into passes.

Permitted rework requires fresh authorization in supervised mode. Developer may add temporary traces/counters only in approved candidate files. Diagnostic-only traces must leave the final result; permanent logging changes require ordinary review. Extra files still require scope approval.

After correction, the host reruns **the same check**, preserves before/after evidence and gives Reviewer outcomes/events/metrics plus the actual patch. Reviewer checks for bypassed validation. Existing rework limits apply; incomplete execution/evidence blocks completion. No JSONL, code or test command is required from the user to start diagnosis.

# Where changes are made

The original repository remains the **official project**. New tasks use a stable Git candidate branch and an isolated external **candidate workspace**. Worktrees are host-managed technical areas; Developer cannot run Git or write `.git`. Rework retains the task's branch.

Technical status exposes `candidate.root`. Candidate generation increases when a new version is produced. Do not edit a running candidate: checks bind its exact contents. After completion, the verified result is frozen in a candidate commit, without changing the target. Inspect/preserve it or choose **Integrate into project**. Branch and worktree remain available for audit/recovery.

# What COMPLETED means

COMPLETED requires a produced candidate, passing required checks, accepted independent review, and demonstrated authorizations: direct human confirmations or actions derived from an approved plan/policy. Integration is separate. This certifies the agreed task boundaries and checks, not absence of every bug. Choose criteria appropriate to the project's importance.

# Integrate into the project

Choose **Integrate into project** or `/controlled-dev integrate`, optionally with a task ID. This also supports standalone tasks without Project Planning.

The host prepares an explicit merge in a technical worktree against current target HEAD and repeats task checks. An advanced target requires fresh read-only review by the existing Reviewer. When target/content match the already-reviewed candidate, task review can be reused. This is task integration evidence, not a global project verdict.

Supervised mode presents objective, target branch, added/modified/removed files, checks and review. **Approve**, **Reject** and **Back** retain distinct meanings; approval requires trusted native confirmation. Model output or headless commands cannot approve. Autonomy may derive authorization from an approved plan/policy within its limits.

Approval applies the exact prepared/verified commit locally, updates the original folder and verifies a clean Git state. No manual copying is needed. Rejection leaves the task COMPLETED and candidate available, without target changes.

The official folder must be clean, on the expected branch, without ongoing Git operations. HEAD changes after proposal require fresh preparation, checks and approval. Conflicts or failed checks block integration and preserve evidence; there is no automatic conflict correction.

Explicit Git name/email are required. The host uses configured identity without changing permanent configuration. Hooks and signing are disabled only for these noninteractive operations; external filters/merge drivers are unsupported. No remote is contacted.

An exact approval-bound intent is saved before application. Reopening integration after interruption can finish/reconcile that same authorized operation. Ambiguous Git/filesystem state stops for intervention; there is no hard reset, stash, rollback or aggressive branch deletion.

# Verify integrated results together

An **Integration Checkpoint** checks whether integrated components work together on one exact project version. The sequence is task completion → authorized Git integration → new baseline → integration verification. Completing all planned tasks, integrating them and verifying the baseline are separate facts. Checkpoints are optional for normal standalone tasks.

## Propose and approve a checkpoint

Open the integration-check entry in advanced checks or `/controlled-dev project check`. Select integrated results, explain why they should be checked together and choose checks available in the commit. Existing scenarios can be included when their exact command matches the selected checks.

The summary binds included tasks, branch/commit, checks, scenario versions and independent review. Native approval covers that exact definition. Change purpose, coverage or checks through a new revision and approval. Individual commands need no separate confirmation after the complete definition is approved.

COMPLETED alone is insufficient: integration evidence and Git ancestry are checked. A no-op task needs demonstrated completion and unnecessary integration. A missing contribution prevents approval or blocks execution.

## Run explicitly

Choose the action to run an approved checkpoint. A definition describes intent; each run has a separate identity and exact commit. The same intent can be rerun after project advancement, retaining previous runs and showing the new baseline.

Checks use a temporary detached Git worktree, separate from the official folder. Uncommitted local edits are excluded. Tests/builds can create temporary files there; if ordinary worktree removal is prevented, the copy is retained for inspection and explicit cleanup rather than forcibly deleted.

## Interpret outcomes

| Outcome | Meaning |
|---|---|
| PASS | Required checks, selected scenarios and required review succeeded on the exact reported commit. Not certification of every behavior, system requirement or release. |
| FAIL | An executed check or review found a problem. Evidence remains available; no automatic fix, merge reversal or commit removal occurs. Create a controlled correction task. |
| BLOCKED | Conditions/evidence are insufficient: missing integration, unavailable command/scenario, missing terminal proof, etc. It is neither success nor necessarily a failed software test. |
| STALE | A successful run covers an earlier commit. It remains PASS there, but does not certify the current version. |

If approved promotion advances target during checks, the checkpoint continues on its original isolated commit. A durable promotion chain can explain legitimate advancement. Unexplained official-folder changes remain ambiguous and block certification. Checkpoints do not hold a target lock throughout or automatically prevent later promotions.

## Evidence, memory and notes

Results link definition, commit/tree, tasks/promotions, checks, scenarios, runtime observations and review. Relevant technical memory may be supplied within traced limits; checkpoints neither edit memory nor automatically activate lessons.

Human views include `Integration/Checkpoints`, `Integration/Runs`, evidence links, and current-baseline/checkpoint summaries in `Project.md` and the current plan. One additional Base compares runs/dates/baselines. Changing Markdown FAIL to PASS has no effect on stored authority.

## Interrupted checks

Phases and partial evidence persist. The recovery action can recognize a provably dead owner and record a block without inventing PASS/FAIL or relaunching agents. Finished results remain immutable even when residual ownership is released. If a command or Reviewer lacks terminal proof, another equivalent run stays blocked.

Checkpoints implement no task, promotion or system requirement assessment and add no workflow states. The Pi parent remains read-only; Developer remains the software writer inside normal ControlledTask.

# Scope limits

Supported flows include existing Git projects, current-folder setup and explicit separate source import. Nested repositories and pre-existing unborn Git repositories are outside development admission. The package does no push, fetch, pull, publication, release, remote integration or pull request. Users authorize local integration directly or through policy; the host executes it.

# Recover after interruption

After Pi/computer closure, durable information may allow safe recovery; missing process evidence or changed systems can leave it blocked. For profile-stored projects, use the same project/profile. For adopted projects, preserve the complete project folder.

Start with `/controlled-dev status`. If it admits recovery:

```text
/controlled-dev recover
/controlled-dev status
/controlled-dev resume
```

`recover` verifies the previous owner and attempts new locks. `resume` separately continues from an admitted safe point. Neither resets attempts nor repeats recorded work. `/controlled-dev reconcile` requests fresh public-service evidence about an old agent; the command itself is no proof and may leave the task blocked.

After session change, a valid pending confirmation may be presented again. Old answers cannot be recycled for a different request.

# Repair an incomplete save

The event journal may be ahead of the summary after interruption. If complete events and their evidence are verifiable, `/controlled-dev repair` can rebuild the snapshot. It does **not** repeat Developer, tests, review, confirmations or external effects, and readable history alone does not prove work finished.

After successful repair, inspect status; recover and resume remain separate. Contradictory data or missing evidence denies repair. Do not manually remove journal files, locks or task data. A fresh durability barrier can sync existing data without claiming an earlier fsync succeeded.

# When an earlier agent stays UNKNOWN

UNKNOWN means termination cannot be proven. No automatic replacement starts, because another agent could still be active. Silence, age or prose do not prove exit. Request `/controlled-dev reconcile`; insufficient historical service evidence leaves the task blocked. Renaming the task or deleting locks is not a valid workaround.

# Common errors and messages

| Condition | What to do |
|---|---|
| No active task | Check the folder; use `/controlled-dev new` if appropriate. Do not create internal configuration manually. |
| Invalid Git repository | Open the correct root or use `/controlled-dev` to prepare it. Do not use artificial paths to bypass admission. |
| Dirty repository | Deliberately preserve/commit or set aside your work. Do not discard it merely to pass admission. |
| pi-subagents unavailable | Install in the right profile, restart and check public capabilities. Do not copy provider internals or forge success. |
| Task already active | Inspect/manage the existing task rather than overwrite or duplicate it. |
| Scope violation | Preserve evidence and inspect the block. Do not grant retrospective permission or treat the candidate as verified. |
| UNKNOWN | Reconcile; accept that missing proof can remain blocking. |
| Recovery required | Use admitted `recover`, not a fresh `run`. |
| Repair required | Inspect status and use admitted `repair`; never hand-edit storage. |
| BLOCKED | Read the reason and use supported decisions; it grants neither success nor unlimited retry. |
| Confirmation required | Read the native panel and decide explicitly; asking the model to say “approved” is insufficient. |

## RESULT_SCHEMA_INVALID after positive review

The generic code means an object failed package validation. A historical manual probe found a specific bug: a review-only criterion lacked a validation-command link when a “validation still required” risk disposition was recorded. Candidate checks and Reviewer passed, but durable state remained REVIEWING, not COMPLETED.

Current code handles REVIEW criteria through independent review of the current candidate; regression tests complete the task and reject stale, missing or invalidated proof. The generic code can still represent other errors and is never ignored. Preserve a blocked historical task and inspect status/technical details. Do not rerun, edit frozen criteria/evidence, apply an uncompleted candidate or use repair to bypass a construction bug.

A statement that changes were not applied to the host workspace can be expected: the original remains unchanged until approved integration. Completion certifies the candidate; promotion updates the official project separately.

# Safety and limitations

Parent model tools remain read-only for the loaded extension's whole session, including completion and late notifications. Use a separate normal Pi session/profile for unrestricted coding.

This is tool control inside a trusted Pi process, not an operating-system sandbox. A malicious host extension or destructive validation program is not made safe by the workflow. Avoid passwords/tokens/keys in tasks; artifact inspection is not universal secret recognition. Process-crash probes cannot guarantee every filesystem, hardware cache or power-loss behavior. Missing authority or evidence causes a stop rather than invented success.

# Updates and reinstallation

For GitHub installation, close active sessions, select the same Pi profile and run:

```sh
pi update git:github.com/sandololab/pi-controlled-dev
```

Then restart Pi. Publishing a commit does not automatically update another computer. Commit-pinned sources remain pinned. In Pi 1.3.0, bare `pi update` updates Pi itself; `pi update --extensions` updates all packages.

For tarballs, close active sessions and reinstall the desired tarball into the same prefix. Preserve the Pi profile and candidate copies for older projects; for adopted projects preserve the full folder including hidden files.

Task data is separate from installed package files: the Pi profile for older projects, `.controlled-dev` for adopted ones. Reinstallation is not a workflow reset and deletes no history. Never update while a process is writing. A new version cannot make missing evidence recoverable automatically.

# Removal

In the same profile, GitHub installations use:

```sh
pi remove git:github.com/sandololab/pi-controlled-dev
```

For the alternative tarball installation:

```sh
pi remove "$HOME/.local/share/pi-controlled-dev/node_modules/pi-controlled-dev"
```

After closing sessions, remove installed files if desired:

```sh
npm uninstall --prefix "$HOME/.local/share/pi-controlled-dev" pi-controlled-dev
```

Keep needed profile/candidate history or entire adopted project folders. Uninstalling neither completes nor cancels/reconciles uncertain agents. Do not delete active task data.

# Frequently asked questions

**Why cannot the parent Pi model write?** The extension protects the entire session. Use the ordinary profile or a session without it.

**Must I know JSON, hashes or IDs?** No. The wizard constructs internal data; technical details support advanced diagnosis.

**Must I write tests myself?** No. Describe expected results; Scout proposes checks and the host builds supported recipes. Developer can change tests within scope; passing them still requires independent review.

**Can I correct a field?** Yes: Back or the corresponding Edit action preserves other draft values. Creation still needs final confirmation.

**Is Reviewer PASS already COMPLETED?** No. Validation, authorization and final host predicates must also hold.

**Can I edit a waiting candidate?** No. Changing content invalidates evidence tied to it.

**Can I integrate after COMPLETED?** New tasks with Git binding support **Integrate into project** and native approval. Historical tasks without binding remain readable without automatic promotion.

**Is the public repository open source?** Source is viewable on GitHub, but remains `UNLICENSED` until the author chooses a license. `private: true` prevents npm registry publication; it does not control GitHub visibility.

# Tutorial: request a change without writing tests

Prepare a clean Git repository with a commit and `README.md` containing `Before` followed by a newline. Start Pi there using the dedicated profile; add no package control files.

Open `/controlled-dev new` and enter:

> Add the line After below Before in README.md. Change only README.md. The result must contain exactly these two lines with a final newline.

Review the proposed scope, criteria and checks. If necessary request: “Check the exact content automatically and retain independent review.” From the summary, try **Edit criteria**, return, then create the task and use `/controlled-dev run`. Read implementation/completion confirmations.

True completion is host state COMPLETED after validation, review and authorization. The candidate contains:

```text
Before
After
```

The original still contains only `Before` and stays Git-clean until integration. Technical status gives the candidate path. A model answer or correct-looking proposal is not a durable result. `/controlled-dev-task` is a separate text-assistance template, not task creation.

# Skills and text assistance

The package includes twelve guides:

| Skill | Purpose |
|---|---|
| `repository-analysis` | Observe source/configuration/risks without editing. |
| `validation-planning` | Propose checks, prefer existing tests, distinguish proposals from execution. |
| `controlled-review` | Compare requirements, candidate, checks and host evidence independently. |
| `task-planning` | Formulate objective, allowed files and expected results. |
| `recovery-explanation` | Explain blocks without bypassing controls/deleting data. |
| `runtime-observability` | Interpret bounded events, separating facts, hypotheses and limits. |
| `scenario-management` | Describe repeatable scenarios bound to approved host checks. |
| `evidence-management` | Organize evidence/readable reports without granting authority. |
| `software-design-quality` | Proportionate reuse, naming, documentation and design without forced patterns. |
| `project-planning` | Decompose objectives, explain dependencies, propose reviewable revisions. |
| `greenfield-bootstrap` | Propose initial choices/minimal architecture without application writes or permissions. |
| `project-memory` | Retrieve relevant accepted/advisory memory and propose changes without adoption. |

Observation, task-specific expectations, general design guidance, implementation and independent review remain separate responsibilities. Established repository conventions take precedence over generic guide defaults. You may invoke `/skill:validation-planning`; Pi normally selects relevant skills. A dedicated profile reduces name conflicts.

Three text templates are available:

```text
/controlled-dev-task Add the line After to README.md
/controlled-dev-recovery Explain this UNKNOWN status
/controlled-dev-result Explain Reviewer PASS versus COMPLETED
```

They provide conversational assistance, not workflow commands: no TaskSpec, controlled launch, repair or confirmation is created. Host supplies relevant package guidance explicitly to controlled roles; Scout, Developer and Reviewer do not inherit global/project skills. Pre-task Scout may read repository guidance as untrusted data; a skill grants no tool or command authority.

# Read evidence in Obsidian

One Markdown collection is used: older projects store it under the Pi profile's `controlled-dev/projects/<project-id>/human`; adopted projects use `Documentazione` inside the project. Open the path shown by the TUI as an Obsidian vault. The historical directory name is retained for compatibility; newly generated explanations are English.

The advanced regeneration action or `/controlled-dev rebuild-view` reuses that collection and shows its full path. `Home.md` links tasks/results; `Tasks`, `Scenarios`, `Runs`, `Evidence`, `Reviews` and `Decisions` contain English generated explanations with stable frontmatter/wikilinks. `Indexes` contains optional `.base` views. Bases improves navigation but is unnecessary for reading.

JSON state, identities, hashes, validation, review and confirmations remain authoritative. Markdown changes grant no authority. A task's **Design choices** section appears only when Developer recorded significant design rationale; it remains an explanation derived from records.

Use linked `Notes` files for personal annotations. They are created once and never rewritten by regeneration. If projection fails, workflow state is unchanged and the view is marked stale. Obsidian CLI is optional; no Obsidian plugin, Pi launcher or JSON Canvas is included. Wikilinks already express task → scenario → run → evidence → review.

# Keep the project in its own folder

Choose the advanced storage-adoption action or `/controlled-dev project adopt`. Work must be stopped, agents verified and Git clean. Native confirmation covers moving task state, plan, memory, evidence, documents, personal notes and verified candidate copies. Credentials and personal Pi settings remain on the computer.

The existing human collection moves to `Documentazione`; no duplicate collection is created. Structured state/candidates go into `.controlled-dev`. Both are locally excluded from Git and protected from agent source edits. Exclusion keeps them on disk; backups/transfers must explicitly include them.

Bytes are verified before publishing new storage and before removing old storage. Concurrent personal edits stop the operation. After interruption, use `/controlled-dev project recover-storage`; fresh confirmation can finish cleanup or remove only verified temporary copies. Unexpected data blocks the operation; do not delete retained folders manually.

Transfer the complete project, including `.git`, `.controlled-dev` and `Documentazione`; tracked files alone are insufficient. The new computer needs Pi, this package, compatible pi-subagents and its own credentials. Copied data proves neither old-agent termination nor renewed local authority.

For unfinished transferred work, or work saved/released by normal closure even in the same folder, choose **Resume transferred project** or `/controlled-dev project resume-storage`. Without a task ID it lists verifiable saved tasks; an ID may also be supplied.

Fresh confirmation presents previous/current locations, preserved work and personal-note changes. It authorizes local restoration/control; old confirmations do not authorize the new execution. Required checks and decisions are reacquired. Unverifiable storage or uncertain old-agent termination leaves dependent work stopped.

Storage adoption has historical real-Pi evidence. Reading after relocation with an empty profile is tested. Full real-model resumption on a second computer still needs dedicated verification.

# Optional technical concepts

| Term | Meaning |
|---|---|
| TaskSpec | Structured task created by the wizard. |
| Candidate | Separate project copy containing the proposed result. |
| Generation | Candidate version distinguishing evidence for different contents. |
| Hash | Data fingerprint; alone proves neither approval nor execution. |
| Lock | Exclusive ownership boundary; age does not authorize deletion. |
| Recovery | Verify/reacquire control while preserving history. |
| WAL | Event journal written before the summary. |
| Snapshot | Summarized task state. |
| fsync | Request to make written data durable; repair may repeat it without claiming prior success. |
| Terminal proof | Structured process-termination evidence, not automatically an accepted/correct result. |

Data belongs to the Pi profile's `controlled-dev` or an adopted project's `.controlled-dev`, not the installed package folder.

# Prototype limits

The wizard does not accept arbitrary executables/arguments. Unsupported checks require review or future host support; missing required executables prevent task creation.

Read-only protection inventories allow 100,000 entries with separate 512 MiB budgets for project files and Git data. Ignored files are included except host-recognized protected package storage. Source import allows 100,000 entries, 512 MiB total and 32 MiB per file. Storage adoption allows 100,000 entries and 1 GiB per acquired inventory, with 64 MiB per file. Exceeding limits stops the operation rather than weakening checks.

Progress shows observed phases. Synchronous checks/copies may keep the last phase visible until host return; large inventories can take minutes. Historical native probes cover a simple model task, completion panel, local integration and storage adoption, not all repositories/environments. Session, displayed data and decisions remain host-controlled.

Refinement expects one complete proposal, around 8 KiB recommended; the effective limit scales with tasks/results up to 24 KiB. Small recommended-size overruns are allowed. Content is not truncated and split submissions are unnecessary.

# Plans and missing information

**Consult the plan** or `/controlled-dev project consult` reads the current plan without analysis. Select an item for output, prerequisites, planned steps and linked task; inspect recorded status, files, checks and decisions. Missing data is explicitly unavailable. Candidate completion and project integration are shown separately.

While an agent works, use editor Alt+P/Alt+S or the preparation panel's internal consultation described above. Reading does not interrupt the agent. Wait for the active operation to stop before **Edit the plan**. A correction produces a reviewable proposal; consultation/correction alone cannot authorize development.

Before asking, agents inspect project files. Each round allows at most three investigations; after two consecutive rounds without new reads, remaining questions are presented. Attempts are recorded before dispatch: closing, cancellation or interruption does not refund them. Reopening preserves counts/questions. A new round begins after explicit submission of required answers; already-read content remains in progress accounting. Rereading/paraphrasing is not new progress, and observed reading does not guarantee understanding.

Questions explain why an answer is needed. Suggested answers are proposals you can approve/edit; cancellation leaves them unanswered. The host reevaluates answers and asks remaining questions before creation. Summaries preserve operator clarifications.

## Clarifications during execution

An unresolved question in an approved task stops its dependent action. The TUI presents the exact question and lets you edit/review an answer before native confirmation. A suggestion is never accepted by cancellation. Confirmed answers remain in task decisions and reach Developer/Reviewer. They grant no implementation permission: approved scope, requirements and gates still apply. Changes to files or requirements require a revised task proposal; the host neither invents that revision nor continues autonomously.
