**English** · [Italiano](it/SOURCE-REFACTORING.md)

# Current Projects and Existing Source Import

## Main entry point

`/controlled-dev` opens or registers the project in the current folder. Empty folders and existing source code use the same flow and accept any development objective. The older `project new`, `project existing`, `project refactor` and `project open` commands are aliases; they neither ask for a destination nor prefill a refactoring objective.

The containing Git root takes precedence over the subdirectory from which Pi starts. Without a containing repository, a single descendant repository is discovered and opened. Multiple descendant repositories prevent creation of a parent project: start Pi in the intended repository. The canonical path identifies one project in the Pi profile.

First launch asks for the desired result and saves it before analysis. If Git is absent, trusted `current-project-setup` confirmation binds the folder, inventory, identity, local exclusions and file count to creation of the local baseline. Files retain their locations, bytes and modes. Local `.git/info/exclude` entries exclude caches, settings and known credential paths, including files created later, without rewriting `.gitignore`. Empty folders are supported. Missing Git name/email are requested and configured locally only after confirmation.

Preparation records and plans are stored outside the project. Cancellation before preparation preserves the objective without initializing Git. An interruption after intent preserves evidence and requires verification; setup is not repeated automatically. A repository already initialized without commits requires an initial commit prepared by the user. Dirty repositories can be analyzed; an executable task requires clean source files. Ignored files in the official folder stay outside the source manifest, while all candidate writes remain checked.

After plan approval, **Continue the work** selects the sole ready item or offers the available choices. The task proposal combines the result, files, criteria and checks, preserves the known objective, and accepts natural-language corrections. Technical notes are available separately. After creation, supervised mode starts the normal workflow; autonomy, implementation, completion and integration retain their respective authorizations.

If the project has no adopted test configuration, the plan can include preparing one. Proposed tests are not evidence of execution: recipes distinguish exact contents, observed existing tests and review. A documentary baseline does not certify numerical behavior equivalence.

## Dialogue, design and memory

An open project accepts a new description directly in interactive chat or through `/controlled-dev request <description>`. Necessary questions and answers become ProjectGoal revisions linked to native analyses, and resume without asking again for saved answers. A ready proposal adds ProjectDesign and per-task designIntent/implementationSteps. Historical records without these fields remain readable. A context revision invalidates an earlier draft; a new request leaves the previous plan current until its replacement is approved.

Reusable design proposals use ProjectMemoryProposal and the existing memory repository, with deduplication on reopening. Adoption retains native memory confirmation and triggers fresh analysis with updated selection and receipts. The complete design also enters the TaskSpec plan snapshot; hints are split within text limits without truncation. Autonomy derives scope and CommandSpec from native per-task proposals, then starts the existing controller after plan and policy confirmation.

## Separate copy, on explicit request

`/controlled-dev project import` retains the explicit import wizard:

1. Choose a source and a nonexistent destination whose parent exists, separate from source folders, the profile and other repositories.
2. Describe the desired result; supply local Git name/email if missing.
3. Review files, exclusions, identity and destination; confirm copying and baseline creation.
4. Correct and approve the plan, then continue in supervised or autonomous mode.

A Python package containing `__init__.py` is copied into `src/<folder-name>`; other sources retain their layout. Import generates no tests, dependencies or manifests. Tests and configuration outside the selected source folder are not imported; the plan must account for preparing them.

## Import and authority

`SourceProject` captures a read-only inventory with file hashes and Git modes. It excludes `.git`, `.pi`, `.codex`, `.agents`, `node_modules`, `.venv`, `venv`, `__pycache__`, pytest/mypy/ruff caches and Python bytecode. Ambiguous paths, symlinks, hardlinks, special files and credential paths are rejected. Limits: 100,000 entries, 512 MiB total, 32 MiB per file and depth 64.

Trusted `source-project-import` confirmation binds source, destination, objective and the full inventory digest, directory identities, and any selected Git name/email. Identity values are validated without writing configuration during preflight; `--local` configuration is applied only after confirmation and destination Git initialization. The host rechecks state after confirmation and under the destination lock. It preserves exact bytes in DurableStore, applies the existing artifact inspection, and records intent before creating files. The separate `source-import` namespace uses the same immutable store and atomic index, adding no ControlledTask states.

The destination and each file are created exclusively. `CandidateGit.importSourceBaseline` uses the existing host Git executor: no templates, hooks, filters or remote. Every imported file enters the index even if an ignore rule would hide it. The baseline is a nonempty root commit. Project identity uses the canonical path; moving the folder does not automatically preserve its profile plan association.

The plan-to-TaskSpec handoff retains the instance that issued the `PlannedTaskSeed`. Reopening a repository creates a new instance and does not transfer that capability. This binding also applies to greenfield bootstrap.

## Interruptions and limits

Project planning allows Scout up to ten minutes; a single-task proposal and bootstrap retain their own two-minute limits. The host notification deadline adds fifteen seconds without preempting the provider timeout. After notification, the package briefly polls the same run for physical runner exit evidence: result publication can precede that evidence. Missing or inconsistent proof leaves quarantine active; a timeout never becomes confirmation.

If analysis fails before a proposal, project and objective remain saved. A model `fetch failed` error appears as a connection problem. **Retry analysis** is offered only after checking the preceding run's physical termination, session binding, read-only tools and extension configuration. Retry requires an explicit choice, reuses the objective and does not recreate the copy. With uncertain termination, the session retains the old RPC binding: another `/controlled-dev project plan` rechecks exact termination and the original inventory before allowing analysis. Logical notifications, waiting and partial answers cannot release the run. Interrupted results are discarded. Technical details preserve RPC code, run, session and verification status without provider content.

After leaving the panel, use `/controlled-dev project plan` in the selected project. After reload, use `/controlled-dev` from its working folder or a parent containing that sole repository. The parent remains read-only after errors; notifications do not authorize `subagents_enable` or direct work outside the package.

For a block left by an earlier version, inspect the run identified in technical details with `/subagents-fleet` and stop it if active. After confirmed termination, use `/reload` and `/controlled-dev` in the existing folder. The objective remains in project storage. Do not repeat import or use task recovery: before proposal and formulation there is no TaskSpec.

`/subagents-doctor` checks runtime availability, directories, capabilities and bridge; it makes no model-service request. Zero active runs and healthy directories do not prove the child's connection works. A missing `chain-runs` directory in a single analysis does not identify the cause of `fetch failed`. The Scout session log is the diagnostic source. If ordinary Pi responses also fail, check the parent connection; otherwise compare the child's runtime and network configuration. Retrying analysis cannot by itself repair a persistent connection failure.

Import has no automatic replay engine. Existing intent rejects another import to the same destination. Copy and evidence remain for manual inspection; there is no reset, deletion or overwrite. If Git and baseline are complete, `/controlled-dev` can resume planning from the imported folder. Opening it neither certifies nor rewrites incomplete import intent.

Creation confirmation does not approve the plan, policy, TaskSpec or results. Supervised execution starts the selected individual task; a full autonomous sequence requires an explicit policy.

## Verification scope

Automated fixtures use real Git and the verified Scout runtime with declared provider/UI doubles. They check import bytes/modes, exclusions, cancellation, binding, staleness, interruptions and native TaskSpec formulation. Production responses require design, clarifications, memory proposals and per-task steps; fixtures use those same fields. Negative tests reject incomplete live responses while historical records remain compatible. These checks do not certify personal wizard testing or refactoring with real models.

Dialogue tests cover remaining clarifications, natural requests, concurrent context revisions, complete design transmission, native memory deduplication and rereading after adoption. Autonomy tests cover per-task limits, real TaskSpec creation after initial confirmation, cancellation and additional scope without launch, dependency order and final checks without superseded intermediate contents. Project Memory tests include normal role receipts; instrumentation executes the program before and after the correction in the candidate.

Current-folder tests cover empty folders, in-place sources, reopening projects/prepared tasks, missing local identity, ambiguous descendants, concurrent changes during confirmation, later caches and real Git integration preserving ignored files. Planning and Reviewer have separate tests for natural corrections, read-only dirty sources and newly authorized directories. Historical interrupted suite runs are not reported as passing; see [validation status](VALIDATION.md) for current results. Successful planning with a real model service remains unverified.

`npm run test:pi-integration` separately checks installed Pi and pi-subagents. It requires `PI_TEST_HOST_ROOT` and `PI_TEST_SUBAGENTS_ROOT`, pointing to their package directories. It uses a temporary profile, a non-terminal interface and a deliberately unreachable local endpoint, with installed RPC transport and runtime. It checks the parent's native hook boundary and requires child failure diagnostics after verified physical termination. Incompatible dependencies visibly fail rather than skip. This also does not certify successful planning with a real model service.
