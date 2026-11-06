# Reliability changes

**English** · [Italiano — piano e verifiche](it/RELIABILITY-PLAN.md)

The ordered implementation starts with review diagnostics and checkpoint
publication, then supervised commands and recovery, then verified read reuse.
The initial verification used synthetic repositories in temporary directories;
it started no source-refactoring session and created no state in the cleaned
source test project. A later real trial was authorized separately; see below.

## Service boundaries

The coordinator admits work, validates results and records transitions.
`workflow-result-store` publishes already captured candidate artifacts;
`workflow-checkpoint` acquires and publishes portable snapshots;
`workflow-validation` runs the approved checks;
`host-command` supervises command lifetimes and records their outcomes;
`human-gate-display` renders frozen confirmation data without authorizing it.
The registered role executor remains on the existing pi-subagents connection.
These services reuse the existing store, agents and native confirmations.

A result-publication error reports `PROJECT_RESULT_SAVE_FAILED` and retains the
captured candidate in the owned current session for an explicit saving retry.
A poisoned or corrupt store still requires reconciliation; an unsuccessful write
is never treated as successful publication.

A checkpoint error after candidate publication reports
`PROJECT_CHECKPOINT_SAVE_FAILED`. `/controlled-dev checkpoint` retries only
checkpoint acquisition/publication for the current owned task. It never starts
an agent, replenishes counters or grants a new lease. A failed release retains
protective permissions unless their verified retirement already occurred.

Review preflight retains `INVALID_REVIEW_PACKET` and the native no-send receipt,
with a bounded diagnostic field identifying the failed condition. Packet
contents are never inserted into diagnostics.

## Editorial comparison

The editorial package keeps a committed checkpoint successful even if later
maintenance fails, and separates a supervised local process from the TUI. Its Pi adapter also uses pi-subagents; its authorized codex-native adapter is
another model connection. Moving coordination to a separate process and choosing
a model connection are independent decisions. Those boundaries inform this
package. Its checkpoint rotation is not copied: the
controlled-development ledger still verifies historical states and artifacts.
Shared candidate storage remains an independent, compatible optimization.

## Supervised checks and recovery

New production checks run asynchronously in an owned local process group. The
service retains complete output up to a 4 MiB hard ceiling and stops a check
that exceeds the ceiling or its approved timeout. Display failures do not change
a command result. Lifecycle artifacts distinguish intent, start, close and proven
no-start outcomes. A host-owned epoch in the task history binds these operations
to the approved task, commands and working copy.

Recovery checks both agent records and host operations. A closed supervised
TESTING phase can be reconciled after the original owner has died, retaining
candidate identity and historical counters. A missing close record remains
uncertain; a corrupt record is rejected. There is no automatic retry on uncertain
execution and no inferred completion of tests. Existing legacy interruptions
retain their conservative recovery requirements.

Use **0.1.0-beta.4 or later** to read new asynchronous process proofs. Earlier
proofs remain readable. Do not downgrade a project containing new proofs.
Supervision is implemented for Linux with verified local process visibility.
The legacy synchronous host APIs remain for compatibility; they do not establish
new asynchronous recovery guarantees. Process groups cover members of the owned
group; this is not an operating-system sandbox for deliberately detached jobs.

## Verified read reuse

Review preparation validates data before reserving attempts. A malformed packet
leaves the candidate and model budget intact; the live Reviewer independently
checks the workspace again before dispatch. Status distinguishes reserved
attempts, identified provider runs, proven no-starts and unresolved outcomes.
These diagnostic counts never reset historical counters.

A review patch reuses its acquired manifests and reads payload only for written
files. ScopeGuard reuses a successful patch round-trip proof only for the same
private immutable baseline and exact patch/manifest bytes. Every observation
still checks current source, scope, workspace bytes and generation. A change
requires a new proof; a forbidden edit is rejected before reuse.

Artifact hashes are reused only while decoding one privately acquired snapshot.
Readers receive defensive copies; external readers have no reusable digest.
Physical content acquisition and the independent final namespace/content check
remain mandatory. No timestamp-only shortcut is used.

The foundational project-identity reader no longer imports candidate management,
breaking the former storage/identity/scope dependency cycle. Other legacy
recovery dependencies remain explicit; this change does not rewrite all formats
or move every synchronous filesystem/Git operation out of the TUI process.


## Completed verification — 19 October 2026

The ordered stages are implemented in local development version `0.1.0-beta.4`.
The complete diagnostic run of all 70 portable files recorded **1,344 cases:
1,337 passed, 5 failed, 2 default skips**, in 25 minutes 59 seconds with four
file workers. It began before the final changes. Final affected groups passed
**145/145**, **14/14** and **42/42**; these overlap and must not be added.
All five reported failures have successful affected-suite reruns. This is combined
verification, not a second clean complete run after the last fix.

Two failures were fixture preparation deadlines, two were bilingual/manual
alignment. The remaining failure exposed accepted Scout evidence being checked
against the new Reviewer assignment. Its original Scout assignment is now checked,
with accepted-result and terminal-run requirements. Altered attribution and
unproven Scout termination remain rejected. The final 42-case group covers this
fix and the related review preflight.

TypeScript, package inventory, documentation links, diff checks and workspace
checks passed. At the end of that initial phase the cleaned test project retained its original 357 Python files,
with no added files or directories. No Pi session, real-model campaign, global
installation, push or publication was performed. Editorial source files were not
changed by this work; six editorial documents changed concurrently during the
read-only comparison.

This is an initial service extraction. The coordinator still has about 2,000
lines and legacy recovery dependencies; synchronous filesystem/Git work can still
occupy the TUI process. Moving that work to a separate local service while retaining
the existing pi-subagents adapter is the next responsiveness improvement for large
projects. The longest synthetic cases were the four-task greenfield project
(343 seconds), the guided two-task project (184 seconds), and already-applied
promotion recovery (176 seconds). They do not estimate real-model refactoring time.

## Real trial and code readability — October 19 update

The separately authorized trial uses the actual Pi TUI, GPT 6.1 sol with medium
reasoning and the local package. State and documentation live in the project;
credentials remain on the machine. Pi completed three investigations, requested
four operator decisions and produced a thirteen-task plan. The decisions and plan
were approved. The first task prepares verification before library changes;
this update does not claim that the refactoring is complete.

The readability review examined the actual Developer/Reviewer guidance, the
coordinator, planning, autonomy and the recently extracted services. It was not
a line-by-line review of every module. Explicit types, validated contracts,
separate role permissions and focused service boundaries are useful foundations.
Both roles receive the quality guidance; review includes maintainability as
well as functional evidence.

Command execution/recovery, candidate validation and result publication now use
descriptive local names, separate statements and explicit units. Examples include
`commandRecord`, `intentRecord`, `pendingOperations`, `stdoutChunks` and
`monotonicStartMs`. An internal type describes the journal record format without
granting trust to parsed input. Guidance now explicitly addresses variable,
function and class names, boolean conditions and numeric units. Reviewer findings
must cite the symbol and explain a concrete ambiguity, preserving compatible
public names and established domain notation.

Dense code remains in the coordinator, production bridge and several planning
and autonomy paths. Meaningful class names do not resolve excessive responsibility
on their own. Further changes should follow responsibility boundaries in small,
verified steps; reducing the physical line count is not a quality objective.

The readability changes preserve APIs, persisted fields, hashes, limits, counters
and authorization rules. Regression tests exercise real child processes, timeout,
excessive output, uncertain shutdown, altered/incomplete journals and saving
retries without another Developer.

This change passed **95/95 tests** for the services, roles and guidance, followed
by **80/80 tests** after adding assertions on guidance in dispatched role requests,
including package inventory and bilingual documentation. These groups overlap.
TypeScript, diff checks, workspace checks and both workspace tests also passed.
This is targeted verification, not another complete run of every suite.

### Proposal protocol consistency

The first real task was completed and integrated locally after 386 passing tests
and independent Reviewer PASS. Developer took 40.433 seconds and Reviewer 34.004
seconds. Only pytest configuration and the environment check were added; algorithms
were unchanged.

The next proposal exposed a package defect: the wire schema allowed `configPath`
on `EXISTING_TEST`, while host semantic validation rejected it. Scout delivered
a complete response in 80.739 seconds; the subsequent rejection was not an agent
failing to answer. An in-memory diagnostic isolated the field without accepting
or reusing the rejected response.

The wire schema now distinguishes the four closed validation variants and allows
`configPath` only on `CANDIDATE_TEST`. Guidance clarifies that an existing-suite
recipe runs the standard suite; its paths describe coverage rather than selecting
files. Rejection diagnostics can identify the bounded response field without
displaying response contents. Semantic checks, observed paths, authorization and
historical limits remain mandatory.

Verification passed **122/122 tests**, TypeScript, diff checks and **1/1** focused
test after the final message refinement. The installed Pi validator accepted four
valid variants and rejected four invalid ones plus the original real response.
This probe sent no model requests. Pi is restarted with the corrected package
before an explicit new preparation attempt.

### Source comments and verification order

The operator additionally required clear source comments. New or materially
changed files should explain module responsibility and boundaries. Non-obvious
public contracts and logic should document applicable units, effects, errors,
assumptions and invariants. Comments must agree with code rather than narrating it.

Comments were reviewed in nine service, Git identity and proposal modules.
Emitted JavaScript token comparison confirms these comment-only edits leave
executable code unchanged. **82/82 tests** passed for roles and guidance, including
delivery of the requirements to Developer and Reviewer; TypeScript passed.
This does not certify comments in every package file.

The next preparation succeeded with the corrected protocol. Its proposal still
required newly written tests to run before production edits, but Developer has
no command tool and host checks run after handoff. No task was created with that
unavailable interleaving. Planning guidance now requires separate verified
characterization and refactoring increments, retaining outcomes without inventing
an intermediate execution.

### Plan delivery and interrupted connections

A plan revision delivered 42,680 bytes using stored memory references where
Scout's output schema requires IDs. That response was rejected; subsequent
transport errors exhausted provider retries. The process ended after 300.834
seconds, before its ten-minute deadline, without manual interruption.

Previous-plan context now uses Scout's field vocabulary. Stored plan contents,
identities and digest remain unchanged; the prompt explains that the digest
identifies the original rather than this projection. Semantic admission and
approval of the new revision remain required.

Diagnostics recognize observed native `WebSocket error`, `terminated`,
`Connection error.` and `fetch failed` messages without treating model prose as
proof. Physical termination remains independently verified; presentation does
not claim an uncertain process has ended.

Verification passed **99/99 tests** for proposals/TUI, **81/81** for the complete
planning suite, **2/2** for context delivery and **1/1** for connection messages;
groups overlap. TypeScript and diff checks passed. The first version of the new
fixture assumed a mutable copy; it was corrected to respect immutable inert data.

The next planning trial uses project-local SSE configuration. Pi's actual settings
reader recognizes it. That probe sends no model request and does not establish
that network failures are resolved.


## Publication update — 21 October 2026

The beta.4 source and tests now have a fresh complete portable verification run.
The [current validation report](VALIDATION.md) records its exact counts, native
installation/connection probes, SSD checks and limits. The GitHub publication
keeps the earlier stages above as history and excludes raw trial sessions/state.
It does not complete the separate real refactoring trial or remove the remaining
synchronous filesystem/Git work. The user manuals include the Git update path and
minimum versions for reopening shared snapshots and asynchronous process evidence.

## READ-150

Scoped plan, based on public main db36e62810463c5e2382c84e5fdc4c6b65cf2ae9:
first correct historical test metadata and add negative cases, demonstrate the
canonical positive regression against the unchanged guard, then change only its
path literal. Run TypeScript and affected repository suites. Next test the exact
local candidate through native Pi 1.5 and the existing controlled workflow; stop
at any personal confirmation. Publication is conditional on both automated
checks and that exercise succeeding. Do not change Pi, pi-subagents or controls.
The engineer integrates and records observed results; internal review does not
replace independent acceptance. Failed checks retain the candidate and stop
publication rather than expanding this correction.

| Requirement | Design/code | Planned verification | Results |
|---|---|---|---|
| READ-150-1 | [isolateParentTools](../extensions/controlled-dev.ts) canonical name/origin/path check | READ-150-A/B, controlled-developer suite | [Observed checks and limits](VALIDATION.md#pi-15-builtin-read-correction--5-november-2026) |
| READ-150-2 | Existing hook and tool-call boundary retained | READ-150-C, existing isolation fixtures using canonical metadata | [Observed checks and limits](VALIDATION.md#pi-15-builtin-read-correction--5-november-2026) |
| READ-150-3 | Existing native controlled workflow, no new implementation | READ-150-D | [Observed checks and limits](VALIDATION.md#pi-15-builtin-read-correction--5-november-2026) |

The [index](README.md#builtin-read-compatibility-correction) defines document
applicability; only executed checks belong in [validation](VALIDATION.md).

The normative architecture/protocol/test-matrix documents are frozen publication
snapshots verified by scaffold hashes. This compatibility amendment keeps those
bytes intact and records its scoped specification/design/test plan here.

### READ-150 requirements and design

System need: Pi 1.5's parent coordinator must read project files while the
independent Developer remains the only model role allowed to implement changes.
READ-150-1 requires the `read` name, `sourceInfo.source === 'builtin'` and the
canonical `sourceInfo.path === 'builtin:read'` together. Extension namesakes,
missing metadata and legacy synthetic paths confer no capability.
READ-150-2 preserves the existing session-lifetime exposure filter and
`tool_call` rejection of every other tool, including after late activation or
child completion. The design changes only the path literal in
`isolateParentTools`; no permissive alias or fallback is added.
READ-150-3 requires a separate native Pi exercise with actual parent reading and
a short Developer-produced file under the package's existing controls.
See [plan and traceability](RELIABILITY-PLAN.md#read-150) and
[test cases](#read-150-test-descriptions).

### READ-150 test descriptions

Scope and acceptance come from [READ-150 requirements](#read-150-requirements-and-design);
sequence and coverage are in the [development plan](RELIABILITY-PLAN.md#read-150).

- READ-150-A: using the repository parent API harness, expose Pi 1.5 canonical
  `read`/`builtin`/`builtin:read`; session start and subsequent turns must retain
  read and allow its callback. The uncorrected guard must fail this case.
- READ-150-B: vary extension origin with canonical path, missing origin/path/all
  metadata, wrong path, old bracketed path and wrong tool name. No read capability
  is exposed; force-reactivated read remains blocked without executing its callback.
- READ-150-C: reactivate write, edit, bash and unknown tools after the filter.
  The existing call gate must block each; session start/new turn must restore
  only canonical read. Existing notification/disposal isolation cases still pass.
- READ-150-D: use the already authorized project/profile, local candidate package
  and native Pi 1.5 TUI. Observe a successful parent read, then /controlled-dev
  produces a brief verifiable file via its internal Developer and prescribed
  checking. Status, prose or a manually created output do not pass. Stop input
  at personal confirmations; retain exact candidate identity and actual outcome
  in the issue report. No successful result is claimed before observation.

The executable isolation cases are in
[controlled-developer tests](../test/controlled-developer.test.mjs).
[Observed results](VALIDATION.md#pi-15-builtin-read-correction--5-november-2026)
retain the failed broader campaign and incomplete native workflow separately.


## GIT-DELEGATE-1

### Requirements and bounded design

System need: an explicitly authorized local Git baseline must not require a
second personal confirmation. GIT-DELEGATE-1 permits only `initialize-local-git`
for one canonical project and its observed directory identity, source snapshot,
local exclusions and an explicit Git author. The trusted host supplies an external mandate
reference; model text and agent/RPC commands cannot issue this delegation.
GIT-DELEGATE-2 rejects absent authority (retaining the existing human path),
changed/replaced folders, source changes, a different author, operation or project,
and source boundary violations before Git writes. GIT-DELEGATE-3 leaves plan,
autonomy limits, access, destruction and integration decisions unchanged.

Design: extend [CurrentProject](../src/current-project.ts) with a host-code-only
delegation issuer, reusing the existing workspace lock, immutable DurableStore
artifacts and workspace index. The existing CandidateGit import primitive receives the
explicit author only for this delegated baseline and fixes author/committer in
its commit process environment; global author.* settings cannot replace it.
A typed host-delegation record binds the exact
project/snapshot/identity and a mandate reference. Preparation consumes that
record into the ordinary intent/result journal, marking host authority distinctly
from a human receipt. No new namespace, generic gate bypass, launcher, service,
model tool or signing/credential mechanism is introduced. The trust boundary is
the existing host-owned profile store; trusted host code is responsible for
checking the external mandate before issuance. Project files and model output
are not authority. The delegation does not authorize later workflow gates.

### Development and test plan

Preserve READ-150 and frozen normative snapshots. Implement only issuance and
consumption in the current-project module, document the host API in the existing
manual, and extend [current-project cases](../test/current-project.test.mjs).
Run typecheck and the affected current-project/trusted-confirmation/planning
boundary cases; reuse earlier read and recovery results without rerunning them.
Then replace only changed package files in the authorized test project, reload
through Pi's native command, issue one exact host delegation from the recorded
mandate, and observe autonomous Git preparation through the real MCP/TUI.
Continue the saved minimal Developer task; stop only at actual personal gates.
Publication still requires the real Developer result and pertinent checks.

| Requirement | Planned code | Test description | Result |
|---|---|---|---|
| GIT-DELEGATE-1 | CurrentProject host issuer and prepare | GD-A: real Git setup without human callback; durable host authority and exact baseline | [Executed checks and remaining native exercise](VALIDATION.md#scoped-git-setup-delegation--5-november-2026) |
| GIT-DELEGATE-2 | exact binding and fresh checks under workspace lock | GD-B: absent delegation, wrong root/operation/identity, changed/replaced directory and source/symlink boundary rejected without Git writes | [Executed checks and remaining native exercise](VALIDATION.md#scoped-git-setup-delegation--5-november-2026) |
| GIT-DELEGATE-3 | existing trusted-confirmation/planning boundaries unchanged | GD-C: delegated preparation followed by plan confirmation; serialized delegation is not a trusted human receipt | [Executed checks and remaining native exercise](VALIDATION.md#scoped-git-setup-delegation--5-november-2026) |
| GIT-DELEGATE-4 | existing Pi reload and native workflow | GD-D: real MCP Git baseline then Developer-generated prova-autonomia/risultato-san106.md, checked by package | [Executed checks and remaining native exercise](VALIDATION.md#scoped-git-setup-delegation--5-november-2026) |

The existing [index](README.md) maps system/software requirements, design, plan
and tests to this section; [validation](VALIDATION.md) records only observed
results. No database or external interface change is needed. The host API and
profile-store trust boundary are described here and in the current-project guide.


## INDEX-64

### Requirements and design

The authorized increment removes SOURCE_INDEX_LIMIT as an admission limit for a
valid inventory. INDEX-64-1 retains the full host TreeInventory and binds every
view/page to its inventoryHash; the legacy small-project sourceFileIndex JSON
remains byte-identical. INDEX-64-2 bounds each initial view and artifact page,
without claiming sourceIndexComplete for partial views. INDEX-64-3 provides
directory/range discovery and linked pages covering all eligible file paths,
including long Unicode paths; vendor/local package paths remain accessible but
are ordered after project-owned paths. Fixed Git/dependency-cache exclusions
remain explicit discovery exclusions, not deletion from the full canary.
INDEX-64-4 requires the real Scout to reach the complete catalog through existing
read access to exact host-generated artifacts, without a new tool/mount, source
write, database or service. Index metadata is discovery only, never authority or
proof of reading source contents. Sensitive confirmations and the previous
read/delegation implementation remain unchanged.

Design: a source-file-index helper computes deterministic compact views. For
large inventories it writes immutable bounded file pages and directory pages
through the existing DurableStore put primitive. Page chains and directory
entries identify global ranges and first file pages, with complete/partial flags
and one inventory digest. The initial map prioritizes project paths and points
to the first directory/file pages. Existing read supports absolute file paths
and offset/limit; host prompts allow only the exact advertised catalog artifacts
in addition to their existing source scope, never other profile files. Stores
remain outside source/work trees, preserving unchanged-tree canaries and Git
status. PreTaskScout receives the existing project planning/memory store; runtime
Scout/Developer receive the task store through existing runner options. Recovery
uses the pure deterministic view for its fingerprint and creates no artifacts.

### Increment and tests

Implement helper and update all consumers, then typecheck and affected index,
pre-task and runner tests only. INDEX-64-A preserves small JSON bytes. INDEX-64-B
uses an inventory exceeding 64 KiB, long/Unicode paths, many directories and local
packages; traverses every linked page, checks exact set coverage/no duplicates,
bounds, digest and view completeness, plus directory-to-file references.
INDEX-64-C verifies dispatch includes a real readable catalog and unchanged
source/tools; no-store misuse must not silently advertise inaccessible pages.
INDEX-64-D uses native reload and real MCP/Pi Scout on the previously blocked
project, then the saved minimal Developer result and package checks. Personal
plan/limits decisions remain personal; no simulated children or result files.

| Requirement | Planned module | Cases | Result |
|---|---|---|---|
| INDEX-64-1 | [source-file-index helper](../src/source-file-index.ts), runtime re-export, recovery consumer | INDEX-64-A/B | [Executed checks and native decision](VALIDATION.md#progressive-source-index--5-november-2026) |
| INDEX-64-2 | bounded view/page serialization and explicit completeness | INDEX-64-A/B | [Executed checks and native decision](VALIDATION.md#progressive-source-index--5-november-2026) |
| INDEX-64-3 | deterministic folder ranges, local-package ordering, links | INDEX-64-B | [Executed checks and native decision](VALIDATION.md#progressive-source-index--5-november-2026) |
| INDEX-64-4 | pre-task/Scout/Developer runner artifact-store wiring | INDEX-64-C/D | [Executed checks and native decision](VALIDATION.md#progressive-source-index--5-november-2026) |

This reuses the existing [documentation index](README.md),
[validation report](VALIDATION.md) and task evidence. Frozen normative documents
are unchanged. Only new observed failures may justify an affected rerun; earlier
read18, Git delegation and historical recovery campaigns are not repeated.


## CONFIRMATION-OPERATOR

The native channel verifies TUI mode, session and method identity, exact request
and display digests, freshness and one-time consumption. It does not detect
physical human presence or identify the person operating the terminal. An
authorized delegated operator may therefore use the authentic TUI within its
external mandate; decisions must be attributed honestly to that operator.

Minimal design: expose ConfirmationChannel, retain HumanConfirmationChannel as
a source-compatible alias, clarify transport semantics without changing receipt
formats, historical fixtures, humanGates fields or any gate checks. No additional
host approval infrastructure. CO-A: typecheck and existing trusted-confirmation
regressions; CO-B: actual TUI plan/autonomy decisions by the delegated operator
and the minimal Developer task. Sensitive decisions outside the mandate remain
reserved. Outcomes remain pending. This supersedes the previous assumption that
the type name alone required Stefano to operate every planning confirmation.


CO-A executed: typecheck and 27/27 trusted-confirmation cases pass. CO-B reached
real plan/autonomy approval and accepted Scout result, but Developer remains
blocked by the distinct unchanged-tree recovery boundary. See [current native
evidence](VALIDATION.md#authorized-native-operator-and-current-recovery-boundary--6-november-2026).

## LOCAL-CONTINUATION — authorized 6 November 2026

Origin: SAN-106 comment 6b46d977, report r15. LC-1: a quiescent local workflow can release exact authority on orderly Pi shutdown and continue after reopening the same persisted Pi session, even across PID namespaces. LC-2: durable ledger/spec/event/lock bindings, irreversible old-host retirement and the existing mutation guard admit one successor only. LC-3: live/unknown child or host operation, partial release, mismatched owner or consumed release stay blocked. Process-death classification and existing scope/confirmation checks remain unchanged.

Design: reuse the checkpoint boundary and durable artifact store; local release completion is published last under one guard, after retirement and exact pair removal. Acquisition and immutable consumption are serialized under that guard before a RecoveryAuthority is exposed. A failed mutation retains the guard and locks. No new service, launcher, configuration or approval tier. The original blocked SAN-106 task is preserved.

Implementation order: local checkpoint/release, exact single-consumer acquisition, native recover integration, focused tests, then one native saved-session/task continuation in an isolated directory already inside the authorized project mount. Publication requires successful real work and relevant checks.

Traceability: LC-1 -> shutdown/checkpoint/recovery -> same-owner resume test and real TUI. LC-2 -> exact pair/guard/consume -> concurrency, stale token/head and replay tests. LC-3 -> quiescence/full durable record -> live/unknown/partial-release failures. Results are pending; no test is claimed passed here.


LC-1/2/3 implemented and focused checks passed. Actual same-session/same-task recovery dispatched one Developer without replaying the accepted Scout; both frozen package checks passed. Full task completion remains blocked by a distinct prepared criterion/command mismatch and the existing post-result abandonment restriction. See [executed results and limits](VALIDATION.md#local-orderly-continuation-and-post-result-abandonment--6-november-2026). Crash recovery without a completed orderly release and the original missing-session task remain outside this handoff.


## POST-RESULT-ABANDON — authorized 6 November 2026

Origin SAN-106 comment 180f27a0. PRA-1: explicitly abandon a recovered BLOCKED attempt with candidate/results as FAILED, preserving TaskSpec, results, candidate and counters; no integration or result approval. PRA-2: retain verified recovery authority, current revision/session, candidate verification and child/host-command quiescence before and after the native confirmation; release locks only after the durable terminal state. Minimal change: remove the bridge's obsolete no-result restriction and add the existing candidate-current check at both sides of abandonRecovered confirmation. Tests: successful post-result abandonment preserves evidence and releases locks; uncertain child/host journal or mutated candidate denies without release. Native proof then closes only the isolated failed attempt and reuses the same folder for a CONTENT-consistent saved-session workflow. No new service, policy, permissions or runtime approval tier. Results pending.


PRA-1/2 executed: typecheck and 2/2 new confined cases pass; native post-result closure preserved all work as FAILED. The subsequent same-folder, saved-session task completed as r42 after exact-ID reopen and recover/resume with a single Scout, Developer output, two passing commands and Reviewer PASS. See the final [validation results](VALIDATION.md#local-orderly-continuation-and-post-result-abandonment--6-november-2026). The latest successful proof supersedes earlier pending/blocked statuses without removing their history.


## RELEASE-BETA5

Scope: publish the already merged implementation as development prerelease
0.1.0-beta.5 and document its verified operating procedure. No runtime, dependency,
permission or persisted-format change. The previous manifest is beta.4; public
tags and releases were absent at planning time.

REL5-1: README explains project-local installation, initial Pi session persistence,
orderly shutdown, explicit same-ID reopen and separate recover/resume operations.
REL5-2: README explains native post-result abandonment and conservative refusal
for uncertain children, changed candidates and incomplete releases after crashes.
REL5-3: manifest, lockfile, current manual versions and published release metadata
agree on beta.5; historical verification versions retain their original meaning.
REL5-4: release notes identify included changes, actual checks and limits without
private trial data, local paths, credentials or transcripts.

Design and allocation: README and current manual version labels satisfy REL5-1/2;
package.json and the root lockfile fields satisfy REL5-3. CHANGELOG.md supplies
release notes for REL5-4 and is included in the existing package file list.
Documentation index links this plan and the observed validation report. Existing
interfaces and storage require no additional design or database document.

Sequence: verify remote base and conventions; prepare documentation/metadata;
check versions, local links, package inventory and relevant product/language
regressions plus typecheck. Preserve all runtime source/test bytes from the
merged implementation; reuse its previous behavioral and native Pi evidence.
Then publish on a dedicated branch, inspect PR and checks, merge with exact head,
and create the prerelease on the final merged commit through authorized supported
operations. Unsupported connector operations must be reported rather than
substituted with guessed tool names or an alternative writing channel.

| Requirement | Implementation | Planned verification | Result |
|---|---|---|---|
| REL5-1 | [README](../README.md) | Verify command syntax against installed Pi 1.5.0 and existing continuation guards | [Executed release checks](VALIDATION.md#beta5-release-preparation--6-november-2026) |
| REL5-2 | [README](../README.md) | Compare documented close/recovery conditions with host implementation | [Executed release checks](VALIDATION.md#beta5-release-preparation--6-november-2026) |
| REL5-3 | [manifest](../package.json), [lockfile](../package-lock.json), current manuals | Product package regressions and version equality | [Executed release checks](VALIDATION.md#beta5-release-preparation--6-november-2026) |
| REL5-4 | [changelog](../CHANGELOG.md), [validation](VALIDATION.md) | Package inventory, local links, generic public text review, source-byte identity | [Executed release checks](VALIDATION.md#beta5-release-preparation--6-november-2026) |

See the [documentation index](README.md). Observed checks are recorded in
[validation](VALIDATION.md#beta5-release-preparation--6-november-2026). GitHub publication and release
creation remain unexecuted at this planning checkpoint.
