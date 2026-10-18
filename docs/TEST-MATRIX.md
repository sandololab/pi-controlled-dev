**English** · [Italiano](it/TEST-MATRIX.md)

# P1 — Test Design, Traceability and Documentary Review

Historical status: amended test design, without new implementation/tests executed by that amendment. Existing P0–P5 were not recertified and P6 was not resumed. Later executable mappings are explicitly identified below. Current executed results are in [VALIDATION](VALIDATION.md).

Normative sources: [ARCHITECTURE](ARCHITECTURE.md) and [PROTOCOL](PROTOCOL.md). Original P0 historical SHA-256: `bc7e8a646fd591cef3bfea90d0901925018f8bf25a7d1c82954291c80434e010`, not a hash of the amended/translated document.

## 1. Conventions

Each TEST ID is an obligation. Parameterized tests must exercise every stated variant, not a representative subset. Expected PASS describes test behavior; uppercase workflow values retain contract semantics. Future milestones do not authorize numbered project phases: FUT-CONTRACT covers implemented contract/state/validator acceptance; FUT-INTEGRATION covers Pi/provider/roles/Git/checks/gates; FUT-RECOVERY covers restart/crash/reload claims; FUT-RELEASE covers reusable distribution.

Standard fixture F uses a temporary clean committed Git repository, valid approved spec, required command, separate candidate, controllable runner and private artifacts. Never mutate the development repository or installed Pi components as fixtures. Doubles do not attest real capabilities; integration also needs the actual supported runtime.

## 2. Test catalog

| Test | Protocol | Scenario, action and expected result | Type | Milestone |
|---|---|---|---|---|
| TEST-001 | INV-019; STM-001..004; TR-001..043 | Exercise every listed transition with satisfied guards, negate each guard separately and try every unlisted pair of eleven states. Only explicit TRs with exact actor, effects, invalidations and events succeed; terminals remain immutable. | unit | FUT-CONTRACT |
| TEST-002 | INV-001,002,008; AUT-001; CMP-001 | From IMPLEMENTING, submit child completed:true, COMPLETED prose or ok:true and attempt global writes/transitions. Reject extra fields/results and all child completion authority, even with zero exit. | security | FUT-INTEGRATION |
| TEST-003 | INV-003; VAL-001; DATA-004,008 | Present Developer claims that tests passed without host validation. Exploratory reports are not ValidationResult; V/C remain false. | unit | FUT-CONTRACT |
| TEST-004 | INV-004,014; AUT-001; REG-001; EVD-001; REV-001; UV-003 | Register a fresh read-only Reviewer on an immutable candidate with independent runtime/canary evidence. Attempt edit/write/bash, extension/report mutation and inspect the filesystem. Mutating tools are unavailable/denied; observed mutation invalidates review and blocks. | security | FUT-INTEGRATION |
| TEST-005 | INV-025; REG-001; CLA-001; SCOUT-001; EVD-001; DATA-003; UV-002,003 | Register controlled.scout through the real process-local service without consumer provider dependency. Exercise registration→RPC→binding→completion→ScoutResult with hostile write/create/delete/rename/delegation requests and mutating provider variants. Verify runtime source/full registry and unchanged hashes/inventory/metadata; only read and structured_output. Revalidate/attribute output; recommendedScope is proposal only. Missing proof/mutation blocks; receipt alone is insufficient. | security | FUT-INTEGRATION |
| TEST-006 | INV-005,025; REG-001; EVD-001; RET-001; DATA-006 | Run registered Oracle only on authorized escalation, with independent runtime/canary checks. Attempt edits, spawning, approval, scope/state changes, then ordinary advice. Deny effects; accept advice only as data without automatic unblocking. | security | FUT-INTEGRATION |
| TEST-007 | INV-006,013; SCP-001; GAT-001 | Allow one file, deny another also present in allow, and omit a third. Try modify/create/delete/mode changes and renames across combinations. Deny wins, default deny holds, rename requires both paths; scope expansion requires gate/reanalysis. | security | FUT-INTEGRATION |
| TEST-008 | INV-013; SCP-001 | Try valid relative paths and traversal, absolute, UNC, drive, backslash, NUL, Unicode/case aliases at input and actual access, including new files. Reject without permissive normalization/outside writes; unverifiable collisions block. | security | FUT-INTEGRATION |
| TEST-009 | INV-013,024; SCP-001; UV-008 | Use internal/external symlinks, replaceable parents and absent new files. Attempt writes through links, parent swaps between check/use and unverifiable hardlinks/aliases. Reject escapes; uncertain guard/TOCTOU blocks rather than passing initial preflight. | security | FUT-INTEGRATION |
| TEST-010 | INV-021; SCP-001; UV-004 | Try clean committed Git, dirty/staged/untracked sources, unborn/non-Git repositories and moving/unresolvable refs. Writer admission requires the exact clean baseline; no automatic stash/commit or mutation of original/peer packages. | integration | FUT-INTEGRATION |
| TEST-011 | INV-011,021; SCP-001,002; UV-004 | From a clean base with normal/binary/new files and authorized rename/mode/delete, capture Developer patch, remove child worktree and reconstruct. Require identical complete manifest/digest; missing binary/untracked data or moved ref blocks; original stays unchanged. | integration | FUT-INTEGRATION |
| TEST-012 | INV-012,020; SCP-002; UV-004,011 | With apparently finished child but unknown terminal proof, missing patch or expired artifacts, request materialization/TESTING. Never rely on old child cwd or test beside an unknown writer; block and preserve evidence. | integration | FUT-INTEGRATION |
| TEST-013 | INV-011,014; SCP-002; CMP-001 | Alter normal/new/binary files and executable modes before/after validation/review/gates/final commit; restore old bytes in a later generation. Detect every change and invalidate old proof; identical digest in new generation does not revive it. | integration | FUT-INTEGRATION |
| TEST-014 | INV-004,016; DATA-002,005; REV-001; UV-010 | Try Reviewer/Developer same run/session, fork and independent fresh contexts. Verify cold-start packet and absence of Developer history. Only fresh independent review qualifies; same model alone is allowed, same run/session is not. Unknown/leaking context blocks. | integration | FUT-INTEGRATION |
| TEST-015 | INV-009,026; DATA-001,008; VAL-001 | Use a candidate, required command and actual-execution recorder. Exercise zero/nonzero exit, nonexecution, deadline, abort and empty required lists. Only complete proof passes; classify other outcomes under VAL-001 and deny completion for each negative. | integration | FUT-INTEGRATION |
| TEST-016 | INV-009,011,016; VAL-001 | Corrupt command/spec/digest/generation/log/process binding separately in apparent PASS; claim Developer issuer, modify source during checks or reuse an earlier rerun. Reject/INVALID without rewriting bindings; no interpolation or choosing old success over latest failure. | security | FUT-INTEGRATION |
| TEST-017 | INV-007,022,023; DATA-005; REV-001 | From valid ReviewResult, omit/duplicate criteria, add fields, use invalid enums, combine PASS with blocking/UNVERIFIABLE findings, or print JSON only as prose. Reject schema/semantics without permissive parsing/completion. | unit | FUT-CONTRACT |
| TEST-018 | INV-004,011,023; REV-001; CMP-001 | Submit valid-schema review for the wrong candidate digest/test IDs, then correct PASS with another required gate absent. First blocks; second still has canComplete=false. | unit | FUT-CONTRACT |
| TEST-019 | INV-010,011; GAT-001; DATA-009 | After showing an unconsumed gate, change spec/digest/generation/revision/material or reuse a consumed decision. Reject stale/replayed approval and require current confirmation. Legitimate decision-persistence/consumption events do not retroactively invalidate unchanged evidence. | integration | FUT-INTEGRATION |
| TEST-020 | INV-010; AUT-001; GAT-001; UV-007 | Give models/children correct gate/task/session/hash and attempt tools, indirect slash commands, fake booleans/attestations or user-approved prose. No authority without explicit native host TUI choice and exact session/data/presentation binding; expose no model-callable approval tool. | security | FUT-INTEGRATION |
| TEST-021 | INV-006,010,026; GAT-001; TR-002,007,010,016,025,030,034,036..043 | Parameterize the five original gates across TUI/headless and approve/reject/incomplete answer; try illegal resume targets and disabling scope gates. Preserve frozen targets/guards; final returns REVIEWING, scope returns ANALYZING, untrusted headless waits, checks cannot be bypassed. | integration | FUT-INTEGRATION |
| TEST-022 | INV-017; RET-001 | With caps 2 rework/1 infrastructure/64 dispatch/4 escalation, consume budgets and attempt decrement, session/spec reset, mid-task cap increase or overflow. Reject all reductions/excess; unknown intent stays consumed; no exhausted writer or unbounded loop. | unit | FUT-CONTRACT |
| TEST-023 | INV-005,017; RET-001 | Compare two equivalent failures with different times/logs and one distinct failure. Same semantic failures have identical fingerprints and escalate before retry. Reject a second Oracle in one episode, duplicate identical episodes and excess budgets. | unit | FUT-CONTRACT |
| TEST-024 | INV-005,017,018,026; RET-001; GAT-001 | Contrast proven transient infrastructure failure with ambiguous timeout, exhausted budgets with/without finite enabling decisions, model/runner fallback and Oracle advice. Permit only one same-protocol quiescent infrastructure retry; unknown blocks, approval raises no cap, no remaining legal action leads to FAILED. | integration | FUT-INTEGRATION |
| TEST-025 | INV-012,018; CAP-001; UV-001 | Against real compatible Pi/provider, vary absent service, changed version and incompatible ping/capability shapes. Verify bounded spawn→status→completion and actual events/capabilities positions. Prove correlation or block before dependent child effects; no invented APIs/fallback. | integration | FUT-INTEGRATION |
| TEST-026 | INV-007,008,016,022; DAT-RESULT; UV-001 | Process ok:true with missing/invalid structuredOutput, JSON prose and valid structured output. Acquire only attributed schema-valid structured fields; others block even with zero exit/prose artifacts. | integration | FUT-INTEGRATION |
| TEST-027 | INV-012,016,018; CAP-001; PST-001; UV-001,006 | Deliver duplicate, foreign, contradictory, reordered and pre-binding completions with reconcilable/unreconcilable status. Identical duplicates are idempotent; ambiguous ones cause no transition, exact reconciliation or block, never double acceptance. | recovery | FUT-RECOVERY |
| TEST-028 | INV-018,019; PST-001; UV-005,006,011 | Crash before intent, after intent/before spawn, after spawn/before binding, after binding and completion. Durable intent without exact outcome remains unknown; no blind redispatch/counter refund; reconcile one run or block. | recovery | FUT-RECOVERY |
| TEST-029 | INV-001,012,019,020; DATA-007,010; PST-001 | Inject crashes around artifact/WAL sync and snapshot rename; truncate tails, corrupt complete prefix/hash/revisions and load corrupt terminal stores. Apply only complete valid history, never repeat effects; quarantine invalid terminal attestation without invented TR. | recovery | FUT-RECOVERY |
| TEST-030 | INV-014,017; PST-001; UV-005 | Race two processes/tasks on one workspace with live, proven-dead, reused-PID and unknown owners. Permit one writer; no age/PID-only reclaim; preserve unknown locks and monotonic counters. | recovery | FUT-RECOVERY |
| TEST-031 | INV-015; REG-001; CAP-001; UV-002,009 | Install/load final path/tarball packages in temporary Pi/two repositories, with independently installed provider or absent service. No provider dependency/peer/import, auto-install/upgrade/fallback or Pi/provider modification. Compatible process-local service works without directory/method/disk-copy knowledge. | E2E | FUT-INTEGRATION; repeat FUT-RELEASE |
| TEST-032 | INV-012,025; DATA-002; REG-001; CLA-001; EVD-001; CAP-001; UV-002,003 | Exercise real registration with absent/incompatible service, runtime duplicate/alias/static-name collision, invalid definition, user/project overrides and simulated incompatible responders. Require full accepted registration→exact name→RPC run→completion→attributed output→verified authority binding without provider owner-ID equality. Test every §2.1 variant, lifecycle and lawful preferences. No handle reuse/fallback/provider-digest equality. | security | FUT-INTEGRATION |
| TEST-033 | INV-024,025; SCP-001; CAP-001; UV-003,008 | Try required strong isolation with/without evidence and forbidden custom tools/providers in a trusted host with generic shell. No false sandbox claim; deny unsupported authority and block strong-confinement work without proof. | security | FUT-INTEGRATION |
| TEST-034 | INV-012,019; PST-001; UV-005 | Fault every exclusive-create, fsync, rename and directory-sync operation for persistence/locks. Uncertain commit permits no subsequent effects; retain prior state or valid reconstruction with visible failure. | recovery | FUT-RECOVERY |
| TEST-035 | INV-016,018,020; PST-001; UV-006,011 | Reload/shutdown while a detached run is active, lose prior runtime session and remove temporary artifacts only in fixtures. Resubscribe/request status/resume; silence never permits relaunch, unproven ownership blocks and missing durable evidence denies completion. | recovery | FUT-RECOVERY |
| TEST-036 | INV-015,020; NOR-001; REG-001; CAP-001; UV-009 | Inspect final tarball in another root/environment with separately configured/absent provider. Reject runtime provider dependency/import/lookup/NODE_PATH/links/vendoring/auto-install, static registration of agents/*.md, logs/secrets/temp data. Retain one runtime definition source and one RPC executor. | E2E | FUT-RELEASE |
| TEST-037 | INV-004,018; DATA-002; SCOUT-001; EVD-001; CAP-001; UV-010 | Use persisted/unpersisted parents and parent-only history canaries, runtime Scout/other roles and fork-default overrides. Test explicit fresh and omitted-context probes, verify actual session/context, and force Oracle fork failure. No observed child canary or model-only isolation claim; fresh roles remain independent and no silent fallback occurs. | integration | FUT-INTEGRATION |
| TEST-038 | INV-012,017,018; RET-001; CAP-001; UV-010 | Exceed run/tool deadlines and runtime budgets with controlled writer; test stop/interrupt/resume. Timeout is no safe checkpoint, replacement writer needs terminal proof, stopped runs cannot resume and budgets/fallback rules remain enforced. | integration | FUT-INTEGRATION |
| TEST-039 | INV-016,020; DATA-007,010; PST-001; UV-011 | Reconstruct a task with retries, FAIL/PASS reviews, Oracle, decisions and gates solely from state/WAL/referenced artifacts. Recover exact state/counters/results/authority/correlations without chat, separating invalidated history from current evidence. | recovery | FUT-RECOVERY |
| TEST-040 | INV-020; PST-001; CMP-001; UV-011 | Use synthetic secrets, large transcripts and expiring provider retention. Capture only necessary durable redacted proof; remove fixture temporaries. No secrets/full transcripts; unpreservable required proof blocks rather than silently disappearing. | security | FUT-RECOVERY |
| TEST-041 | INV-014; CAP-001; UV-012 | Only if future parallelism is enabled, fan out two read-only roles and measure actual overlap with attributed proof; attempt two writers. Require distinct results/verified overlap or disable the feature; always deny shared-workspace concurrent writers. Serial minimum is independent. | integration | FUT-INTEGRATION |
| TEST-042 | INV-009,023,026; CMP-001 | Accept one complete eighteen-condition CMP bundle, then independently falsify/make unknown every condition. Exercise historical Risk preservation, current host PASS and persisted RESOLVE_RISK versus residual DEFER_RISK. Reject stale/missing/invalidated proof, wrong criterion/spec/digest/generation, unauthorized resolver, conflicting/duplicate dispositions and generation reuse. No majority/human override. | unit | FUT-CONTRACT |
| TEST-043 | INV-006,011,022,026; DATA-001; SCP-001 | Normalize inline/file JSON/Markdown TaskSpecs with arbitrary filenames and source versions; change sources after READY, omit criterion methods or use unapproved model extraction. Freeze snapshots, require extraction approval and gate/reanalysis for changes; no PLAN/CURRENT naming assumption. | unit | FUT-CONTRACT |
| TEST-044 | INV-016,022; DAT-000; AUX-001; DATA-001..010 | For every closed/nested contract, test valid boundaries, missing/extra fields, unknown versions, coercion/null, overflow, duplicate/dangling IDs, wrong hashes and oversize payloads. Canonicalize valid equivalent numeric spellings and positive/negative integers where allowed; 0/-0 have identical bytes/hash. Reject fractions, NaN/infinities and out-of-range values without canonicalization or silent repair. | unit | FUT-CONTRACT |
| TEST-045 | INV-001,002,005,015; AUT-001 | Exercise all six identities across fourteen AUT operations, conditional grants and merely JSON-declared roles. Admit only real explicit conditional authority; PROPOSE_ONLY has no effect. Task-level original mutation/merge/push/publish remain denied; separate CPG rules govern project promotion. | security | FUT-INTEGRATION |
| TEST-046 | INV-001,010,018; GAT-001; PST-001 | Crash around human confirmation, event sync, snapshot, decision persistence, consumption and resume. No fabricated approval/double consumption; unpersisted human output is not presumed. Resume needs proof or renewed confirmation. | recovery | FUT-RECOVERY |
| TEST-047 | INV-019; STM-002,003; PST-001 | For each of 43 TRs, inject every CR-1 crash boundary with controlled guards/effects/WAL. Recover exact transition once with correct invalidation; reconcile/block unknown effects without implicit transitions. | recovery | FUT-RECOVERY |
| TEST-048 | INV-003,004,008,011,015,023; CMP-001 | Run complete Scout→Developer→validation→review→rework→validation→review→gate→completion with a small fixture and real human gates. Require complete candidate evidence; original/peer packages unchanged, stale proof never reused and no task-level merge/push. | E2E | FUT-RELEASE |

### 2.1 Amendment variants and executable mappings

TEST-032 independently covers absent service/owner (no result/child/install/fallback), unsupported version, malformed/asynchronous receipt, model/TaskSpec-selected nonfixed names, invalid definition, accepted registration/live handle, same-process RPC resolving the exact name, valid runId, correlated completion/structured output, effective identity/authority, runtime duplicates/aliases, cwd-dependent static ambiguity, unexpected source, invalid handles and unreconciled session/runtime replacement. Acceptance never overrides later RPC rejection. Nonserializable handles/contracts are not provider JSON attestations; registration/executor owner-ID equality is not required.

Optional multi-responder negatives inject contradictory replies in both orders; concrete contradiction blocks, hypothetical possibility alone does not. Identical duplicates are idempotent only without other contradictions. Broader tools/exclusions, nesting, context, inheritance, extensions/subagent-only extensions, mutation policy, permissions or base prompt must be rejected. Required unsupported/unverifiable fields block. Lawful model/provider/thinking/documented fast preferences must remain configurable without changing CLA-001 authority; actual capability changes still block.

Lifecycle variants: startup registration, double dispose, formerly registered name no longer resolving, fresh registration, shutdown/reload cleanup and new runtime/session without old listeners/handles. Dispose proves no running-child exit and grants no UNKNOWN retry; TEST-028/035 cover recovery.

**P16A partial executable mapping:** recovery.test.mjs covers TEST-028 unknown intents/no redispatch; 029 inconsistent/missing-proof classification without repair; 030 real Node owner live/dead/uncertain states, Linux incarnation, PID reuse, pair reclaim, ABA and races; 034 durable authorization before unlink, faults/residual guards; 035/039/046 unchanged state/counters/gates. classifyRecoveryState/recoverLocks grant no resume/consumption/dispatch. Optional recovery-historical.test.mjs copies explicitly supplied stores and verifies original inventories unchanged; missing-lock fixtures exist only in copies. Storage terminal proof is a declared fixture; owner death/reclaim uses real processes. This does not certify all FUT-RECOVERY/UV-005.

**P16B.1/GAT-002** extends existing TEST-019/020/021/030/035/039/042/044/046, without new IDs: immutable gate versus durable presentation, normal generation 1, verified A→B takeover/generation 2 with unchanged approvedData and new B confirmation. Same old gate/new session without takeover/presentation remains SESSION_CHANGED. Reject stale generation-1 receipts after 2, foreign gate/task, old sessions, copied records, circular/unproven takeover, duplicate N+1 and missing/contradictory proof/ref/digest/revision. TEST-044 checks closed GatePresentation v1, ProcessIncarnation v1 and channel v2; channel v1 remains historical without migration. TEST-046 distinguishes undecided pending, explicit legacy adoption, persisted/unconsumed decisions, ineligible consumed/invalidated/rejected/answered gates and incomplete commits. TEST-042 verifies full original→death/recovery/reclaim→takeover→presentation→decision→consume history; TEST-021 preserves exact P14H material and headless HUMAN_ACTION_REQUIRED. These normative requirements need executed evidence before PASS.

**P16B partial implementation evidence:** recovery-resume.test.mjs covers cross-process exclusive takeover after actual owner kill, ANALYZING→READY without replay, persisted spec, generation-2 presentation/new-session confirmation, completion preserving candidate/consumed gates, TR-035 abandonment, UNKNOWN/no redispatch, unconsumed persisted decision, unproven absent locks and terminal no-op. It also covers terminal Reviewer A without verdict, durable public terminal evidence, RETRY_INFRASTRUCTURE, beforeReviewerRedispatch, approval without direct launch and fresh Reviewer B without replaying Developer/validation. terminal-evidence.test.mjs covers FAIL/BLOCKED/PASS/UNKNOWN, stale/replay/session, modified candidate/runtime evidence, rejection/answer/counters, before/after preservation and separate final approval. Leaves/providers are declared deterministic doubles; owner/successor/fixture Reviewer processes, Git/worktrees, locks/WAL and validation subprocesses are real. Historical probes cannot invent legacy death/ownership evidence or certify real-provider reliability/all P16B.

**P14G.3A/CMP-002** extends TEST-042: freeze AuthorizationPackage A before confirmation, approve HA, consume, then build TerminalCompletionPackage v2 T referencing A/HA. HA≠HT is positive; T is not required before confirmation. Mutate each package/hash/decision/ref/candidate/generation/validation/review binding and require rejection. No v1 migration. Historical 75641670…/826ff66f… probe documents circularity.

Multi-gate TEST-042 covers implementation on spec A, scope A→B, implementation on B and current completion, with all eighteen conditions true. Negate each condition and test missing applicable gates, stale writers, missing scope approval, wrong Oracle episode/exhaustion fingerprint, unconsumed/stale/wrong-candidate final approval, reused receipts and conflicting decisions. TEST-046 covers create/persist/decide/consume, read-only reload, no double consumption and interruptions before decision/after persistence. Atomic consume/resume cannot expose a fabricated half-effect history. Loading never consumes, resumes, releases locks or dispatches.

TEST-044 applies DAT-000 to CLA/REG and AssignmentEnvelope v2: deterministic canonical hashes, actual prompt/resource bytes, coherent ID/role/context, complete sorted authority lists. Every authority-field change alters hash; lawful preferences do not enter it. Added volatile run/time/task/path/provider-digest/output fields are rejected. Reject v1 relabeling, provider hash substitution and missing contract artifacts. The historical amendment itself did not alter P4 executable tests.

TEST-026/032 distinguish package authority hash, spec/assignment/candidate digests and provider launchContractDigest. Preserve spawn/main-completion/child differences with issuer/level and no normalization/cross-domain equality. Provider divergence alone neither proves equivalence nor blocks independently verified authority; wrong package hash, contradictory effective authority or missing proof still blocks. TEST-027 still rejects contradictory duplicate correlated fields.

## 3. Traceability of all P0 acceptance criteria

AC-P0-01..34 identify the original §15 obligations in order, not new authority IDs. Packaging/registration amendments retain all 34 obligations. The English architecture enumerates the same order.

| Architecture obligation | Protocol | Tests |
|---|---|---|
| AC-P0-01 Install from path/tarball without runtime provider dependency; service supplied separately. | NOR-001; REG-001; CAP-001; UV-009 | TEST-031,036 |
| AC-P0-02 No machine-local absolute paths or development-repository requirements. | NOR-001; DATA-001; CAP-001 | TEST-031,036,043 |
| AC-P0-03 Verified registration/RPC Operational Binding; absent service unavailable, incompatible/contradictory evidence blocked, no child/auto-install. | REG-001; CAP-001; INV-012; UV-001,002 | TEST-025,026,032 |
| AC-P0-04 No Pi/pi-subagents modification. | INV-015; AUT-001 | TEST-031,036,048 |
| AC-P0-05 Reject every illegal state transition. | INV-019; STM-001..004; TR-001..043 | TEST-001,047 |
| AC-P0-06 Only Orchestrator writes global state. | INV-001; AUT-001; DATA-010 | TEST-002,045,047 |
| AC-P0-07 Invalid schema, missing/failed tests/review, scope/digest mismatch or pending required gates prevent completion. | INV-007..012,023; CMP-001 | TEST-007,015,017,018,019,020,026,042 |
| AC-P0-08 Crash recovery duplicates neither spawn nor approval. | INV-018; PST-001; GAT-001 | TEST-027,028,046 |
| AC-P0-09 Corruption/inconsistency blocks. | INV-012,019; STM-003; PST-001 | TEST-029,034,047 |
| AC-P0-10 Scout/Reviewer/Oracle cannot mutate canaries. | INV-004,005,025; AUT-001 | TEST-004,005,006 |
| AC-P0-11 Developer lacks delegation and global completion authority. | INV-002,025; DATA-002; AUT-001 | TEST-002,032,045 |
| AC-P0-12 Reviewer is fresh, independent and cannot correct its candidate. | INV-004; DATA-005; REV-001 | TEST-004,014,037 |
| AC-P0-13 Reject same-run/session Developer review. | INV-016; DATA-005; REV-001 | TEST-014 |
| AC-P0-14 Block traversal, symlink escape, outside-allow and denied paths. | INV-013; SCP-001; UV-008 | TEST-007,008,009 |
| AC-P0-15 Detect unattributable dirty baselines. | INV-021; SCP-001 | TEST-010 |
| AC-P0-16 One writer per checkout. | INV-014; PST-001 | TEST-030,041 |
| AC-P0-17 Test worktree handoff/reconstruction after child cleanup on committed clean fixtures. | SCP-002; STM-002 guard T; UV-004 | TEST-011,012 |
| AC-P0-18 Bind tests/review/completion to exact candidate digest including new/binary files; incomplete patches block. | INV-011; SCP-002; VAL-001; REV-001; CMP-001 | TEST-011,012,013,016,018 |
| AC-P0-19 Never claim generic-shell path confinement; required strong isolation must be proven externally. | INV-024; SCP-001; CAP-001; UV-008 | TEST-009,033 |
| AC-P0-20 Exclude temporary artifacts from published packages. | INV-020; NOR-001; CAP-001 | TEST-036,040 |
| AC-P0-21 Bind authorized commands to exact tree/digest. | DATA-008; VAL-001; SCP-002 | TEST-015,016 |
| AC-P0-22 Timeout, nonzero exit or nonexecution prevents completion. | INV-009; VAL-001; CMP-001 | TEST-015,016,038,042 |
| AC-P0-23 Schema-valid Reviewer PASS is necessary but insufficient. | INV-023; DATA-005; REV-001; CMP-001 | TEST-017,018,042 |
| AC-P0-24 Rework invalidates old-tree test/review/approval evidence. | INV-011; STM-002 E/S; SCP-002; GAT-001 | TEST-013,019,048 |
| AC-P0-25 Persist monotonic retry caps. | INV-017; RET-001; DATA-007 | TEST-022,028,030 |
| AC-P0-26 Repeated failure fingerprints trigger defined escalation. | RET-001; AUX-001 FailureRecord/Escalation | TEST-023,024 |
| AC-P0-27 Oracle stays advisory and cannot unblock material decisions automatically. | INV-005,006,026; DATA-006; RET-001; GAT-001 | TEST-006,021,024 |
| AC-P0-28 Reject stale revision/hash approval. | INV-010,011; DATA-009; GAT-001 | TEST-019,046 |
| AC-P0-29 Reject model/child/indirect-command approval without a trusted human confirmation. | INV-010; AUT-001; GAT-001; UV-007 | TEST-020,021 |
| AC-P0-30 Never disguise exhaustion as success. | INV-017; RET-001; CMP-001 | TEST-022,024,042 |
| AC-P0-31 Reconstruct state, attempts, decisions, checks, review, escalation and approvals from ledger/artifacts. | DATA-007,010; PST-001 | TEST-029,039,046 |
| AC-P0-32 Correlate external runs with request/run/role/attempt. | INV-016; AUX-001 RunRecord; CAP-001; PST-001 | TEST-025,026,027,028,039 |
| AC-P0-33 Keep secrets/full transcripts outside the ledger. | INV-020; DAT-000; PST-001 | TEST-036,040 |
| AC-P0-34 Cover crashes around spawn, completion, state writes and human gates. | STM-002 CR-1; PST-001; GAT-001 | TEST-027,028,029,035,046,047 |

## 4. Invariant and P1 coverage

| Invariant | Tests |
|---|---|
| INV-001 | TEST-002,029,045,047 |
| INV-002 | TEST-002,045 |
| INV-003 | TEST-003,048 |
| INV-004 | TEST-004,014,018,037,048 |
| INV-005 | TEST-006,023,024,045 |
| INV-006 | TEST-007,021,043 |
| INV-007 | TEST-017,026 |
| INV-008 | TEST-002,026,048 |
| INV-009 | TEST-015,016,042 |
| INV-010 | TEST-019,020,021,046 |
| INV-011 | TEST-013,016,018,019,043,048 |
| INV-012 | TEST-012,025,027,029,034,038 |
| INV-013 | TEST-007,008,009 |
| INV-014 | TEST-004,013,030,041 |
| INV-015 | TEST-031,036,045,048 |
| INV-016 | TEST-014,016,026,027,035,039,044 |
| INV-017 | TEST-022,023,024,030,038 |
| INV-018 | TEST-024,025,027,028,035,037,038,046 |
| INV-019 | TEST-001,028,029,034,047 |
| INV-020 | TEST-012,029,035,036,039,040 |
| INV-021 | TEST-010,011 |
| INV-022 | TEST-017,026,043,044 |
| INV-023 | TEST-017,018,042,048 |
| INV-024 | TEST-009,033 |
| INV-025 | TEST-005,006,032,033,045 |
| INV-026 | TEST-015,021,024,042,043 |

TEST-044 covers every field/limit/semantic constraint of DATA-001..010 and nested records; targeted suites cover interactions. TEST-001 exercises positive/negative cases for every TR, TEST-047 every crash boundary, TEST-045 the full authority matrix, and TEST-042 each completion condition independently.

### Explicit required negative scenarios

| Rejection | Test |
|---|---|
| Illegal transition | TEST-001 |
| Developer claims COMPLETED | TEST-002 |
| Reviewer writes files | TEST-004 |
| Scout writes files | TEST-005 |
| Outside-scope edits | TEST-007 |
| Path traversal | TEST-008 |
| Symlink escape | TEST-009 |
| Check never executed | TEST-015 |
| Failed check | TEST-015 |
| Invalid ReviewResult | TEST-017 |
| Wrong reviewed candidate digest | TEST-018 |
| Stale human approval | TEST-019 |
| Model-origin approval | TEST-020 |
| Excess retry | TEST-022 |
| Missing/invalid RPC structured output | TEST-026 |
| Ambiguous completion | TEST-027 |
| Crash between spawn intent and run binding | TEST-028 |
| Inconsistent-state recovery | TEST-029 |

Required coverage is **18/18 negative scenarios**, explicitly parameterized or dedicated.

## 5. UNVERIFIED and fail-closed

PROTOCOL CAP-001 retains all UV-001..012, with tests/milestones/defaults. This covers ping/event shapes, structured output, registration/binding/source, authority versus provider digests, human origin, symlink/TOCTOU, patch/rework reconstruction, reload ownership, provider-independent packaging, fresh/fork, terminal proof/retention and unmeasured parallelism.

Historical amendment status for all twelve was UNVERIFIED: required RPC output/authority/ownership blocks; unproven roles do not launch; Git/handoff/confinement failures prevent writes; unproven lock/durability prevents recovery claims; human-origin absence stays AWAITING_HUMAN; unverified package/runtime combinations are uncertified; absent durable proof prevents completion; parallel features stay disabled without affecting the serial minimum. The observed P5 UV-001 subset remains separate historical evidence. Spike results cannot replace final-package tests, and failures cannot silently change P0.

## 6. Original P1 documentary review — historical

This was the author's internal documentary review, not delegated independent review or runtime testing. Its statements about unchanged P0 and absent implementation describe that original delivery only.

Eight checks: completeness (ten contracts, 26 invariants, 43 TR and all authority/scope/validation/review/retry/gate/completion/persistence sections); unambiguous default-deny authority; no implicit transitions; all 34 acceptance mappings; all eighteen required negatives; twelve open UV items with evidence/milestone/default; no premature implementation (only two P1 documents, original P0 hash unchanged); exact completion evidence through eighteen CMP predicates/stateAfter/TEST-042/048. All were documentarily covered, without resolving UV capabilities.

Consistency checks prohibited child-self-authenticated human schemas, direct scope-to-implementation, rewriting old bindings, unknown-intent retry, RECORD self-transitions and free analysis/review dispatches.

Corrections after first reading: move materialization to late IMPLEMENTING before TR-013; distinguish historical writer authority from final candidate approval; specify human/manifest records, original-baseline hashing through rework, exact continuations and required AUTOMATED/BOTH commands; use command exit status rather than invented prose parsing; align installation/reconciliation milestones and escape table unions.

Second internal review checked all eight conditions, every TR and the complete positive path including rework and initial/final gates. No P0 conflict was found and no P0 change was required then. Read-only checks found unique 26 INV/43 TR/10 DATA/12 UV/48 TEST/34 AC-P0 IDs, valid references, complete mappings and consistent tables/fences. Repository then contained only existing ARCHITECTURE plus new PROTOCOL/TEST-MATRIX outside Git. Temporary checking code was not added to the package.

**Historical PHASE RESULT: PASS**, specification only. No implementation started or next phase authorized by that review; twelve UV items remained open. These are historical facts, not instructions overriding later authorized work.

## 7. Original P1 boundaries

P1 delivered contracts/test design, not executable integration proof. No extension, profile, manifest, adapter, Orchestrator, store, guard or runner was implemented in that phase. Future capabilities needed authorized implementation and their milestone tests. Proven P0 contradictions required a blocking issue rather than an implicit architecture change.

## 8. Operational Registration/RPC Binding amendment review

The author's documentary review changed only ARCHITECTURE, PROTOCOL and TEST-MATRIX, not P4/P5 APIs/validators or P6 implementation. It checked eleven conditions: no runtime provider dependency/resolution; user installation freedom; one runtime-owned definition source; one RPC execution boundary; lawful preferences separate from authority; deterministic package-owned hash/DATA-002 v2; separately preserved provider digests; fail-closed concrete anomalies; normal lifecycle distinct from recovery; complete operational binding without invented owner identity; coherent P0/P1 with unchanged core state/authority/completion rules.

Registration evidence is host-acquired local binding, not an invented full provider attestation. Concrete incompatible responders block; theoretical possibility alone does not. Added records/v2 were not declared implemented. Documentary hash-pinning tests could require later authorized maintenance; no executable test was changed or claimed passing by that amendment.

**Historical AMENDMENT RESULT: PASS**, documentary only. No new VERIFIED capability, provider-digest cause unresolved, no implementation change/P6 resumption. Independently proven authority can remain valid despite different provider digest domains.

Reviewer-redispatch integrity regressions in terminal-evidence.test.mjs alter spec/validation/process/terminal proof before the gate, cancel without authority and lose locks after approval without dispatch/counter increases. Restored paths need the same checks.

## Candidate Promotion — additional executable matrix

candidate-promotion.test.mjs uses real repositories/commits/branches/worktrees/merges and verified terminal ledgers, with declared provider/UI doubles distinct from native human evidence. Coverage includes binding/digest/tree/identity, separate completion, no-op, generic branches, advanced targets, conflicts, failed validation, stale/wrong/forged/replayed receipts, dirty/untracked/wrong branch, rejection, actual manual ancestry versus ambiguous cherry-picks, Markdown views and WAITING→READY through normal TaskSpec preparation.

candidate-promotion-worker.mjs checks lease exclusion, crashes around intent/ref/file updates, reload and idempotent result publication across processes. Merge review reuses the same read-only Reviewer with RPC/terminal/transcript/canary checks. Existing memory/planning/confirmation/recovery/historical-task regressions remain required in the serial suite. Eleven states/43 TR remain; packed runtime excludes fixtures/worktrees. Native human TUI testing uses an innocuous temporary project and actual personal confirmations; automated results cannot substitute. This phase does not certify checkpoints, greenfield, remotes or universally correct review.

## PA-TEST — Project Autonomy amendment (2026-10-04)

project-autonomy.test.mjs and project-autonomy-e2e.test.mjs supplement all baseline suites. Declared doubles do not certify real people/models.

| Group | Required evidence |
|---|---|
| Policy boundary | One plan/policy dialog with distinct proofs; reject forgery/copy/wrong revisions/scope/plan/target digests/cancellation/revocation. |
| Admission | Native Scout host boundary with provider double; exact objective/intent, contained scope/commands; no synthetic HumanDecisionEvidence. |
| Gates/completion | Native in/out-policy scope gates, ADR proposal before writer, v1 compatibility, exclusive v2 policy refs, human-only Oracle/exhaustion, verifiable terminal v2/v3 closure, unchanged 11/43. |
| Staleness | Current plan/memory/branch/HEAD/dirty checks; advisory lessons grant no authority. |
| Dependencies | Exact package.json name/version changes; unsupported manifests require decisions. |
| Workflow | Real bounded rework/exhaustion, terminal Reviewer A without verdict then B, no B on uncertainty, no-effect Developer recovery, zero routine confirmations. |
| Controller | Approved serial order, finite limits, pause/resume/revoke/cancel and durable escalation without hidden choices. |
| Existing-project E2E | Four controlled tasks, separate provider-double processes, real validation/native scope/review, four Git integrations and final checkpoint; one initial dialog, zero per-task. |
| Greenfield E2E | Separate bootstrap/native memory decisions, then plan/policy approval and the same autonomous path. |
| Exception | P1 integrated, P2 outside scope: safe pause, no out-of-limit writer, preserve P1. |
| Recovery | Actual controller SIGKILL after P1, reload/resume P2 without redundant approval; account for already-applied promotion once; stale/uncertain bindings grant no new effect; exact controller lease. |
| Human UX | Explicit mode, explained policy, pause/details/progress, Project/current-plan/activity/summary without routine digests. |
| Regression | All historical, greenfield, checkpoint, promotion, planning, memory, confirmation, ControlledTask and recovery suites. |

Manual human and real-model probes remain separate. Unavailable providers are not PASS. Final reports must state actual executed counts and failures/skips explicitly; a successful campaign requires zero failures/skips and declared limits. PA tests also reject disabled native gates and foreign-run tasks before writing, and check native NOT_REQUIRED with unchanged HEAD, one initial approval and final checkpoint PASS.

TEST-042 includes CMP-14 for current, host-persisted risk resolution and CMP-15 for every applicable consumed authorization in the multi-gate history. Both remain among the 18 individually negated completion conditions.
