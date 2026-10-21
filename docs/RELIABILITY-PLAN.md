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
