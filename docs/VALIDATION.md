# Validation status

**English** · [Italiano](it/VALIDATION.md)

This is a development beta. Historical campaign reports and current focused checks describe different revisions; earlier broad-suite failures remain explicitly recorded below.

## Beta.5 release preparation — 6 November 2026

Version **0.1.0-beta.5** prepares the previously merged implementation as a
GitHub development prerelease. There were no public tags or releases at the
preparation check; the preceding manifest was beta.4. Requirements and cases are
in [RELEASE-BETA5](RELIABILITY-PLAN.md#release-beta5).

The release delta changes README, current manual version labels, package/root
lockfile versions and release documentation only. All runtime sources, extension,
role instructions, skills, prompts and tests remain byte-identical to the merged
implementation. No dependency or permission change is included.

Executed for the release delta: TypeScript checking PASS; product-package and
language suites **7/7 PASS**, no skips; `git diff --check` PASS; npm pack dry-run
PASS with CHANGELOG.md included and no test directory, installed dependencies,
profile, session or credentials in the listed distribution. Manifest and root
lockfile versions agree; README/manuals identify beta.5. Native command syntax
was checked against the installed Pi 1.5.0 documentation, and continuation/close
conditions against the unchanged host implementation. No new Pi trial or full
historical test campaign was run for this documentation/metadata increment.

Previous behavioral evidence is reused: the final continuation/abandonment group
passed 23 distinct cases, and a real Pi 1.5.0 workflow reopened the same saved
session, recovered/resumed the same task without replaying Scout, produced its
output through Developer, passed both host commands and Reviewer, and reached
COMPLETED. These checks do not imply a clean full-suite beta.5 run, independent
external acceptance or production qualification. Crash without a completed
release, missing original session and uncertain child/host processes retain their
conservative recovery limits. See the final native proof below.

GitHub publication, tag and release creation remain pending at this checkpoint.
The [changelog](../CHANGELOG.md) supplies generic public release notes; private
trial logs, local paths and transcripts are not release assets.

## Pi 1.5 builtin read correction — 5 November 2026

Uncommitted candidate based on public main
`db36e62810463c5e2382c84e5fdc4c6b65cf2ae9` (beta.4). This is a scoped
follow-up, not a new release or a successful full acceptance campaign.
Requirements, design, test descriptions and traceability are in the existing
[reliability plan](RELIABILITY-PLAN.md#read-150).

- Baseline and candidate TypeScript checks passed with Node.js 24.22.0 and
  the existing TypeScript 5.9.3. The canonical positive regression failed
  against the unchanged guard, then passed after the one-literal correction.
- The focused READ-150/P12.1 isolation group passed **18/18**. Historical
  positive metadata now uses `builtin:read`; bracketed metadata is rejected
  explicitly. Origin, call interception and session restrictions are retained.
- Ten affected portable suites completed with **288 cases: 208 passed,
  80 failed**, exit 1. Failures were in recovery-resume (48), recovery (16),
  store-repair (15) and document snapshot integrity (1). The snapshot failure
  was corrected by preserving frozen normative files and retaining the scoped
  amendment in the mutable reliability plan; its isolated rerun passed **1/1**.
  No test hash or assertion was weakened. The 79 other failures remain unresolved;
  this is not a clean full run. Process-proof errors include
  `PROCESS_INCARNATION_UNAVAILABLE`, `OWNER_INCARNATION_UNAVAILABLE`,
  `RECONCILIATION_AUTHORITY_UNAVAILABLE` and `REPAIR_OWNER_UNCERTAIN`.
  The pre-WAL recovery case also fails with `PROCESS_INCARNATION_UNAVAILABLE`
  on an untouched archive of the base commit in this environment. That proves
  this representative failure predates the patch; it does not classify every
  remaining failure or authorize process/sandbox changes.
- Native Pi **1.5.0**, using the exact candidate source/test bytes as a local
  package and the existing separate profile, successfully called builtin read
  on the supplied four-value input. The controlled workflow then stopped at
  its project-commit-name question. No personal answer was supplied by an agent,
  no internal Developer output was produced, and the complete workflow has not
  passed. Final report/plan-only documentation amendments postdate this runtime
  copy; code and tests remain identical.

Internal static review found no concrete defect; it does not replace independent
acceptance. No changes to Pi, pi-subagents, permissions or confirmation controls
were made. No commit or push is authorized by these incomplete results. Raw
TUI/session data and machine-specific evidence remain outside the package.

## Publication verification — 21 October 2026

Version **0.1.0-beta.4** supersedes the public beta.2. The complete portable run
passed: **1,358 cases, 1,356 passed, 0 failed, 0 cancelled,
2 default skips**, across all 70 files listed by `npm test`. The run used four
isolated file workers; `npm test` uses the same files serially. Source and test
bytes remained fixed for this run. The skipped SSD cases were also executed
separately on the actual SSD: **2/2 passed**.

TypeScript checking and the isolated native tarball install/reinstall probe
passed. Native Pi loaded the extension, 12 skills and 3 prompts; headless commands
retained the required native-confirmation refusal. A separate integration probe
used installed Pi and pi-subagents with an intentionally unreachable local
endpoint: it verified the parent boundary, actual detached connection failure
and proven termination, with no real-model request. These probes used fresh
profiles, not the operator's personal credentials or active projects.

The portable checks ran on Linux with Node.js 22.22.1, npm 9.2.0 and TypeScript
5.9.3. The native probes used Pi 1.3.0 and pi-subagents 0.79.1. Public capability
checks remain authoritative; these version observations do not guarantee every
past or future provider. Synchronous filesystem/Git phases still exist, as
explained in the [reliability plan](RELIABILITY-PLAN.md).

The update includes shared candidate payloads, supervised asynchronous host
checks, result/checkpoint persistence separated from agent failures, prepared
review validation, and consistent proposal/memory delivery. Fresh confirmations,
exact candidate checks, process evidence and historical budgets remain required.
Shared snapshots require beta.3 or later; new asynchronous process evidence
requires beta.4 or later on every machine that resumes the project.

The complete logs, incoming/final diffs, source hashes, native-probe results and
publication commit are retained in the author's external verification archive.
Earlier reports below retain their original results. Raw sessions, credentials,
private runtime state and verification logs are excluded from the public package.
This publication does not certify completion of the separate real refactoring
trial or a new real-model acceptance campaign.

## Historical reliability verification — 19 October 2026

Local development revision **0.1.0-beta.4**, not published or globally installed.
The complete diagnostic run recorded **1,344 cases: 1,337 passed, 5 failed,
2 default skips**, across all 70 portable test files in 25 minutes 59 seconds.
It started before the final changes. Final affected groups passed **145/145**,
**14/14** and **42/42**; groups overlap and must not be summed. All five reported
failures have successful reruns. No second complete run after the last correction
is claimed.

Two failures were fixture preparation deadlines, two concerned bilingual documents
and manual versions. The fifth exposed accepted Scout evidence being checked
against the new Reviewer assignment. Original assignment binding, accepted-result
membership and proven Scout termination are now checked together; negative cases
retain rejection of altered or unproven evidence. TypeScript, inventory, links,
diff and workspace checks passed. No real-model or new native Pi installation
campaign was run for this revision. The source test project remains clean and
byte-identical (357 Python files). See the [implementation plan](RELIABILITY-PLAN.md)
for stages, timings and remaining synchronous filesystem/Git limitations.

Verified with Node.js 22.23.3, npm 10.9.9 and TypeScript 5.9.3 on Linux.

## Previous verification — 18 October 2026

Final verification covers **1,305 distinct portable cases: 1,303 passed, 0 remaining failures, 2 default skips**, across a complete run and a final affected-suite rerun. The complete run itself recorded **1,302 passed, 1 failed, 2 skipped**. Its only failure came from a directory-substitution fixture that deleted and recreated a folder: the filesystem could reuse the same inode. The fixture now retains the original directory outside the worktree and asserts a distinct replacement; the complete Scope Guard suite then passed **13/13**. No runtime code changed after the complete run. This is combined coverage, not a claim of a single clean full run. TypeScript checking, package inventory, English-language checks and an isolated native Pi install/reinstall probe also passed. The probe verifies one extension, 12 skills and 3 prompts, and confirms that headless use cannot bypass the native confirmation.

Verified on Linux with Node.js 22.22.1, npm 9.2.0, TypeScript 5.9.3 and native Pi 1.3.0.

The higher total reflects suites that previously stopped during import and now execute their individual cases. The full run uses every portable test file listed in `npm test`, with eight isolated file workers. Each check uses synthetic fixtures, unique temporary folders and a separate Pi profile. The default `npm test` command runs the same files serially.

The two tests skipped by default require `CONTROLLED_DEV_TEST_SSD`. They were also run separately against the actual SSD test area: **2/2 passed**. This checks file bytes, destination mode policy and rollback while preserving personal Notes. It does not certify another operating system or a real-model workflow on a second computer.

## Corrections

- Contract validation now depends on the pure `runtime-root-mapping` module. The operational root-binding verifier still checks retained artifacts, transcripts and terminal proofs before recording a process-local mapping. Contract tests keep their bounded import list and prohibit filesystem, RPC and timer dependencies.
- Orderly project shutdown now preserves the verified baseline of a Developer stopped without effects. Repeated transfers retain the original evidence bytes and counter history. Recovery evidence is bound to the current runtime import; a retired READY authorization requires a new native confirmation before one new attempt can start.
- Missing task-local autonomy artifacts produce the existing typed integrity error. A historical artifact identity remains readable without migration or replacement.
- Canceling before analysis avoids creating an investigation store. Session replacement cannot publish an executable task. Already recorded read-only investigation evidence remains available, and synthetic sensitive input is checked for absence from persisted files.
- Integration fixtures now start from a valid module and passing adopted checks. The checkpoint's exact-content criteria still require the implemented components. The RPC double reads the canonical packet independently of appended role guidance.
- Tests now exercise the current English labels and consumed gate references. Scout cancellation waits for actual dispatch before canceling; viewport checks account for native Pi controls; independent failure cases use separate investigation budgets. Tests await asynchronous session shutdown before removing their fixtures. Real blockers are checked before READY admission.

These changes preserve scope enforcement, mandatory validation, independent review, human confirmation and retry limits. No real-model acceptance campaign is claimed for this revision. Installation/loader checks use an isolated native Pi profile and deterministic test responses.

## Preserved history

The earlier complete baseline before localization recorded **1,055 tests: 1,015 passed, 38 failed, 2 skipped**. Later diagnostic attempts and targeted reruns are retained together with the final verification logs, source hashes and publication commit in the author's external evidence archive. Those originals have not been rewritten to show a later success. Raw sessions, credentials and machine-specific logs are excluded from the public package.

The P15 and P16C reports remain historical reports. Their earlier PASS results do not replace the current checks above.

## Reproduce

Use Linux, Node.js >=22.19.0, npm and Git:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack --dry-run --ignore-scripts
```

`test/product-install.test.mjs`, `test/recovery-historical.test.mjs` and `npm run test:pi-integration` need explicit external inputs/installations. They are outside the portable suite; see the README and the corresponding test files. The repository remains `UNLICENSED` and npm publication remains disabled.


## Scoped Git setup delegation — 5 November 2026

The authorized GIT-DELEGATE increment preserves the READ-150 delta. TypeScript
passed. In a read-only-root Bubblewrap process with a fresh temporary /tmp,
current-project and trusted-confirmation tests reported 55 cases: 54 passed and
one failed in the existing CandidateGit.apply process-incarnation evidence.
The same single integration case fails on the intact public baseline with the
same json:NON_JSON:$.processIncarnation error. The ordinary run first encountered
an existing ancestor Git marker in the execution temporary directory; no such
metadata was removed or changed.

After correcting a test import-order issue exposed by name-filtered execution,
all 16 targeted GD cases and sensitive autonomy approval/cancellation/forgery
cases passed. The 27 trusted-confirmation cases passed in the broader invocation.
The 18 read-isolation results and 112-case recovery comparison remain earlier
evidence and were not rerun. The identity is required both at issuance and when
reading persisted delegation; author/committer are fixed in the delegated commit
process so global author settings cannot replace the authorized identity.

Native Pi 1.5 reload succeeded in the existing operator-owned session. The trusted
host issued the narrow delegation through Pi's existing host shell, in the same
project/profile confinement (the Codex shell's different ancestor Git markers
prevented issuance there). No launcher, model tool or human receipt was added.
The saved delegation has digest
`e21be4f22ab8554c5f485e1bd6357704dba7ba304461a0dea74f3f07d959a08d`.
The subsequent /controlled-dev invocation autonomously initialized exactly one
Git commit, `57e0685bfac6196597c39dee2e550226409af74e`. Its durable workspace result
references HostDelegatedAuthorization and that delegation.

The next planning step stopped before dispatch with SOURCE_INDEX_LIMIT: the
project's source file list (including local vendor package files) exceeds the
existing 64 KiB bound. The existing planner builds its inventory from all tracked
files before applying task hints, so a narrower natural-language objective does
not remove this prerequisite. No limit was raised, file hidden, source deleted
or further package correction introduced. The Developer has not run and the
required output is absent; no publication or final cleanup is claimed. See the
[requirements and traceability](RELIABILITY-PLAN.md#git-delegate-1) and
[host API usage](SOURCE-REFACTORING.md#host-delegated-local-git-preparation).


Final checkpoint: the persisted-author fix was already present in the loaded
candidate. Three pertinent author regressions were rerun and passed: absent
author, malformed author, and global user/author/committer changes. Native MCP
verification confirmed the loaded current-project/candidate-git/extension/test
hashes match the tested candidate, both Git author and committer match the
stored explicit delegation, exactly one initial commit exists, and the Developer
output is absent. The SOURCE_INDEX_LIMIT blocker remains unchanged.

Generated baseline-only node_modules were removed after the completed baseline
comparisons. Baseline source, compact evidence, candidate, runtime vendor, input,
rollback copies, profiles/credentials and the operator session remain preserved.


## Progressive source index — 5 November 2026

INDEX-64 preserves the previous read/delegation delta. Typecheck passed.
The affected pre-task/Scout/Developer invocation reported 125 cases: 122 passed,
3 failed with PROCESS_INCARNATION_UNAVAILABLE at personal-gate creation. These
three cases remain unresolved and were not silently reclassified as passing;
no correction was made to process identity or confirmations. The pre-task suite
passed 44/44. Final index regressions passed 4/4 (overlapping earlier cases):
legacy byte fingerprint, oversize partial map, complete linked directory/file
catalog with long Unicode paths and no lost/duplicate eligible paths, and
readable artifact delivery with unchanged source and tools. Static review found
no concrete defect; it does not replace independent acceptance.

After native /reload, the real Scout cad18d37-6ea5-4089-b88d-d545c68bfce6
completed in 38 seconds using openai-codex/gpt-6.1-sol. Its transcript records
successful read results for both directories-0 and files-0 of catalog digest
3ee380d41abf4a7d4d3f948243d40fe968e5d7a5b58ffbc0e5698f40f44b5271,
then prova-autonomia/input.txt and pertinent project files, followed by a
structured proposal. Catalog reachability by the real read-only Scout is thus
observed, not inferred from host-side file creation. The TUI now displays
Read the proposed plan, draft revision 1 for the saved minimal objective.
Inputs stop at Approve the plan: plan/limits remain personal decisions.
The Developer has not started; no result or package commit/push is claimed.
Only the local test package was synchronized; session and credentials persist.



## Authorized native operator and current recovery boundary — 6 November 2026

ConfirmationChannel is the canonical type; HumanConfirmationChannel remains a
source-compatible alias. Neither mode/session/ui nor the native receipt asserts
a named person or physical human presence. Existing session/method/digest/
freshness/one-time-consumption behavior is unchanged. Typecheck passed and the
existing trusted-confirmation suite passed 27/27. No historical fixture format
was changed for this clarification. The redundant operational-approval module
and its consumers/tests were withdrawn after preserving their candidate/state.

The delegated Ingegnere used real MCP/TUI to approve plan revision 2 and its
Controlled Autonomy policy. Native ctx.ui.custom receipts are saved with exact
request/display/session binding; the operator was the Ingegnere, not Stefano.
A native clarification kept the single-file objective and corrected a separate
proposal issue: vendored package.json is not a root-level NPM_TEST suite. The
existing proposal validator was not modified. The real workflow Scout completed
and its result was accepted.

Task task-b60ba139-c60a-43bd-92b5-bec1435c2f40 stopped at BLOCKED revision 12 before
any Developer dispatch: Scope baseline could not be proven. Native read-only
diagnosis identified ignored .pi/settings.json in the original project; its
worktree was clean. The same two local package registrations were moved to the
existing isolated Ingegnere profile, retaining backups and all other profile
settings. No dependency identity, install, launcher, permission or guard changed.
After native reload, the same ScopeGuard.open accepts the baseline.

The existing task recovery still returns SCOPE_BASELINE_RECOVERY_UNAVAILABLE:
scopeBaselineRecoveryData requires prior.originalTreeHash to equal the complete
current inventory, which includes the removed project-local configuration. A
native project resume stopped safely without re-running Scout or starting the
Developer. No stored hash, receipt, counter or task ledger was edited to bypass
this boundary. The input is unchanged; the result file is absent. The full
Developer/verification/integration proof and package publication remain pending.
The already-open maintenance consultation remains on the same assignment.


## Required project-local package configuration restored — 6 November 2026

The profile registration described above was a temporary diagnostic arrangement,
not the required final setup and not validation of project-local package loading.
The project .pi/settings.json and isolated profile settings were restored byte for
byte from their preserved copies; the profile packages list is empty again.
A native reload succeeded without restarting Pi. Native MCP diagnosis then read
the same two relative project-local package registrations. The complete original
inventory returned exactly to
e301f86c3d38a51966a5e371e4061d54a72854581cc4e8d39f4bfc1e74787697.

Git check-ignore identifies .git/info/exclude line 20 (/.pi), and the file is not
tracked by baseline 955ea7c4fd76353fed7c065cce8f310499fb48a6. With the required
local configuration restored, ScopeGuard.open again returns SCOPE_BASELINE_INVALID;
task revision 12 remains BLOCKED, with zero Developer runs and no result file.
The prior ACCEPT observation applies only to the withdrawn temporary layout.

Code inspection distinguishes baseline content from writable scope: a tracked
.pi/settings.json can be part of the clean baseline; fixedNames forbids changing
that path through a task. Ordinary Git tracking/commit needs no guard exception.
However, committing this file creates a new Git baseline, whereas both saved task
and isolated worktree are bound to 955ea7c4fd76353fed7c065cce8f310499fb48a6.
ScopeGuard.open checks all three HEAD/base values; scopeBaselineRecoveryData also
checks the old baseline and inventory. Staging alone leaves an unclean original
source. No ordinary staging/commit sequence updates those saved bindings.

No commit, index flags, replacement refs, saved baseline edits, new task identity
or code change was used to bypass this boundary. The maintenance consultation
now concerns the required local configuration and its native baseline handling,
not moving packages into a profile. Full Developer proof and publication remain
incomplete. Existing tests were not repeated for this operational restoration.


The later instruction 0e2b5759 explicitly permits native abandonment and a new
internal execution of the same minimal case, preserving the failed attempt and
without a new Paperclip task or additional recovery development. That ordinary
path was attempted with /controlled-dev close-attempt and the exact saved task ID.
It stopped before the confirmation: TAKEOVER_OWNER_DEATH_UNPROVEN. Native status
reports STORE_CLEAN, LOCK_OWNER_UNCERTAIN, owner LIVE, reason OWNER_STILL_LIVE,
safeReclaimPossible=false and zero uncertain children.

After reload the fresh extension has no in-memory orchestrator. close-attempt
uses recoverProductionWorkflow, which must first restore one through
takeOverWorkflow. That requires old-owner-death evidence; abandonRecovered also
requires this recovery authority. No native close confirmation was reached and
no task termination, Git commit or fresh execution occurred. The original Pi
process remains open as required. No restart, lock deletion or forged death
evidence was used. This is a distinct live-owner handoff limitation; neither
recovery development nor a change to saved baseline values was performed.

## Local orderly continuation and post-result abandonment — 6 November 2026

LC-1..3 and PRA-1/2 are implemented. Orderly shutdown requires a genuinely persisted Pi session, exact current state, quiescent child/host operations and the existing lock pair. Retirement precedes durable release; completion is published last under the existing guard. Acquisition validates and consumes that release once before exposing fresh authority to the same persistent session. Process-death classification is unchanged. Missing/incomplete release, mismatched owner and uncertain processes remain blocked.

Typecheck and diff checking pass. Twenty prior confined cases passed (10 continuation, eight lock-manager and two checkpoint cases), plus one existing generation-2 process-death presentation regression. Two additional post-result regressions pass: confirmed abandonment preserves candidate, Developer/Reviewer evidence, TaskSpec and counters while recording FAILED and releasing locks; candidate mutations before/during confirmation and an uncertain host journal prevent closure/release. The original negative assertion incorrectly expected an unchanged ledger on mutation; the existing guard correctly appends EVIDENCE_INVALIDATED. The corrected assertion verifies that precise append, unchanged prior history/results and retained locks. No protection was weakened. There are 23 distinct affected passing cases; historical broader campaigns are not claimed passed.

The first native diagnostic exposed a gate-presentation validator omission after successful recovery across changed PID namespace labels. The validator now verifies the consumed local release and exact presentation lineage; the pending-gate integration regression passes. The next diagnostic preserved actual Developer output but exposed inconsistent prepared criteria versus approved commands. Both unsuccessful attempts and their evidence remain preserved outside the package.

Native post-result closure of the authorized isolated failed attempt then succeeded as FAILED, with candidate/results/counters unchanged. A new proposal in the same existing test source folder was checked before creation approval: one editable text file, one exact-content criterion, standard diff checking and a matching native CONTENT command. The frozen specification matched that preview; no external script execution was required.

The final real Pi 1.5.0 proof used the existing profile, local packages, confinement and four MCP tools. The session was genuinely persisted, one Scout completed, the task paused before Developer in AWAITING_HUMAN revision 9, and Pi quit normally with a complete release. Explicit reopening of the same session followed by native recover reached revision 10 with identical Scout and counters. Native resume dispatched one Developer; it created only the requested short text file with the exact trailing newline. Both approved commands passed. One Reviewer returned PASS and the ordinary final confirmation completed the same task at revision 42. All children were terminal, no Scout was replayed, and no result was integrated into the original test source.

Raw session/task/run identifiers, ledgers, candidate copies and detailed trial artifacts are retained in SAN-106 evidence rather than distributed with the package. All 99 candidate/runtime TypeScript sources matched during the proof; all 74 protected historical task/lock/configuration files were restored/verified byte-for-byte. Only redundant test dependency copies were removed after normal Pi exit. No credentials were read, copied or hashed.

Crash recovery without a completed orderly release and recovery of the historical owner whose original session file is missing remain outside this verified feature. Publication remains subject to the explicitly authorized channel and exact tested tree.
