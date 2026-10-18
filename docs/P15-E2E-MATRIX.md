# P15 E2E campaign — evidence ledger

**English** · [Italiano](it/P15-E2E-MATRIX.md)

> Historical report. Counts, phase status and PASS results below describe the P15 campaign, not the current package. See [current validation](VALIDATION.md). Raw evidence remains in the private archive.

This is an execution report, not a normative amendment. **P15.4 RESULT: PASS. P15 PHASE RESULT: PASS.** Real-host overlap is certified below and final full verification is green.
P16 is not started. The completed positive task is read-only historical evidence.

## Evidence levels

- **UNIT/FAKE**: deterministic structured outputs, process/transport doubles or isolated predicates. Not real-model/real-host evidence.
- **INTEGRATION**: production Orchestrator, real Git worktrees/ScopeGuard, real Node validation and durable store/gate/verifier where applicable, with explicitly identified controlled-role/TUI doubles. Not real-host human confirmation.
- **REAL-HOST**: actual Pi/pi-subagents controlled roles and native human confirmation; durable evidence, not parent narrative.
- **REAL-HOST + fault injection**: actual role execution, followed by a test-only host mutation in the candidate. Does not claim the model voluntarily violated scope.

The automated references below are executed by `npm test`; test titles identify exact entrypoints. Baseline on resumption: 313/313, no failure/skip, typecheck/package/normative hashes/audit/diff check PASS. Extended suite executed: 314/314 PASS, zero failure/skip; typecheck, package dry-run, normative hashes and diff check PASS. First final audit attempt returned npm HTTP 500 (UNAVAILABLE, not PASS); baseline audit had succeeded. After the probe-loading correction, full verification again passed at 314/314 with zero failure/skip, including audit (0 vulnerabilities). Following the Scout responsibility clarification: 315/315 PASS, zero failure/skip, typecheck/package/normative hashes/diff/audit PASS. Latest logs: system temporary root, `p15-scout-boundary-tests.log`, `p15-scout-boundary-typecheck.log`, `p15-scout-boundary-hashes.log`, `p15-scout-boundary-audit.log`.

## Matrix

| ID | Scenario | Evidence level | Expected state/result | Actual / evidence refs |
|---|---|---|---|---|
| E2E-01 | Bounded happy path | REAL-HOST; INTEGRATION with role/TUI doubles | COMPLETED; immutable original; released locks; reload valid | Real positive PASS: campaign `p15-live-biF6Gs`, `real-host-positive-result.json`, `durable-verification.json`. Automated `terminal-evidence.test.mjs`: `P14F.7 durable affirmative...`. |
| E2E-02 | Implementation and completion approvals | REAL-HOST; INTEGRATION with role/TUI doubles | No writer before grant; two consumed gates; COMPLETED | Same real positive has both consumed gates. `P14G.3 TEST-042 both gate lifecycles complete through production bridge`. |
| E2E-03 | FAIL → gated rework → PASS | INTEGRATION with role/TUI doubles | REWORK then generation 2, historical invalidation, COMPLETED | Extended `P15 E2E-03 integration...` executes actual worktree rework, current host validation and durable terminalization. Same final bytes across generations are intentional; cumulative nontrivial patch coverage is additionally in `scope-guard.test.mjs`: `P12.4 — cumulative rework preserves a.txt...`. |
| E2E-04 | Scope expansion / refusal | INTEGRATION with role/TUI doubles | APPROVE → ANALYZING/new spec; REJECT → FAILED/no installation | `P14G.2A TEST-021...`, `P14G.2A onScopeChange REJECT...`, and scoped multi-gate completion. |
| E2E-05 | Oracle human decision | INTEGRATION with Oracle/TUI doubles | needsHumanDecision → gate; APPROVE → BLOCKED/RECONCILE only | `P14G.2B TEST-021 onOracleDecision...`; all three decisions, episode binding and no advisory authority. |
| E2E-06 | Exhaustion | INTEGRATION with role/TUI doubles; UNIT/FAKE retry policy | Only recorded legal continuation; unchanged caps/counters; UNKNOWN never retries | `P14G.2B TEST-021 onRetryExhausted...`, `P14G.2B no retry gate...`, retry-engine RET-001 tests. No grant of another writer. |
| E2E-07 | Parallel PASS/PASS | REAL-HOST PASS; UNIT/FAKE regression | Two attributed concurrent reviews on same candidate, writer excluded; no automatic completion | P15.4 campaign `${TMPDIR}/p154-overlap-9859dr1b/real-host-overlap-result.json`: measured conservative overlap 21,095 ms, independent PASS/PASS, terminal proofs, unchanged candidate and original. Existing `orchestrator-host-probe.ts`, host-only `PI_CONTROLLED_PARALLEL_PROBE=1`, fixed fanout 2. Final state REVIEWING / COMPLETION_NOT_YET_AUTHORIZED, not COMPLETED. |
| E2E-08 | Parallel disagreement | UNIT/FAKE | PASS+FAIL → REWORK only after quiescence; PASS+BLOCKED → BLOCKED | `P13 — FAIL plus PASS is not a majority vote...`, `P13 — BLOCKED plus PASS...`, failed sibling/UNKNOWN tests. |
| E2E-09 | Out-of-scope writer effect | INTEGRATION with role double; REAL-HOST + fault injection PASS | BLOCKED; no Reviewer/completion/retry; original unchanged | `P15 E2E-09 integration...` executes through `implement()` and actual ScopeGuard, not a standalone call. Manual `p15-negative-host-probe.ts` is explicit-load only. Automated injection pipeline PASS. Real-host PASS: `p15-negative-5F88hD/real-host-negative-result.json`, supported by durable reload and actual candidate-byte/hash checks; BLOCKED r13, no Reviewer/validation/retry/completion, original unchanged. First real-host attempt `p15-negative-rAchEi` did NOT inject: separate Pi extension module graphs meant the patched class was not the production class. Store reached AWAITING_HUMAN with Reviewer PASS; injection report absent. This is a probe failure, not ScopeGuard evidence. Corrected probe composes the production factory in its own graph. Second attempt `p15-negative-hRLrKl` stopped earlier: Scout declared inability to establish cumulative diff relative to HEAD; ADVISORY_REQUIRED left ANALYZING r4 with one terminal Scout, no gates or Developer, original unchanged and durable reload PASS. Injection was not reached; no real-host scope-negative PASS. Scout dispatch wording now separates host ScopeGuard verification from preimplementation ambiguity; returned ambiguities are never filtered. |
| E2E-10 | Invalid structured output | INTEGRATION with fake provider/command context | Fail closed, typed failure, no fallback write or implicit retry | `controlled-scout.test.mjs` invalid output/PATH diagnostics; `production-bridge.test.mjs`: `P14F.4 command records typed failure...`. No real-host invalid-result claim. |
| E2E-11 | UNKNOWN | INTEGRATION with role failure injection; UNIT/FAKE | BLOCKED, no retry/writer/completion; locks retained | `P14G.2B UNKNOWN prevents either gate...`; P12 UNKNOWN override tests; bridge UNKNOWN lock test. Interrupted real campaign `p15-live-KhlTl5` is unresolved INTENT evidence, not a recovered run. |
| E2E-12 | Stale human decision | INTEGRATION with TUI double | Stale rejected; no consumption | `P14F.7...`, `P14G.1 shared freshness...`, P14G.2A/2B TEST-019. |
| E2E-13 | Replay/fake approval | INTEGRATION with TUI/role doubles | Cross-gate/task/spec/candidate and duplicate consume denied | P14G TEST-019/020/021; scoped history attack cases; process-local receipt validation. |
| E2E-14 | JSON/RPC human gate | INTEGRATION with UI double | HUMAN_CHANNEL_UNAVAILABLE; no authority | `P14G.1 shared boundary rejects JSON/RPC...` and both P14G.2B TEST-019/020 cases. |
| E2E-15 | Terminal tamper | INTEGRATION with role/TUI doubles | Durable reload rejects patch, auth, terminal package, human decision and event-chain corruption | `P14G.3A TEST-042/046 scoped multi-gate...`: actual terminal store reload for each artifact class and final event hash; verifier-level material/linkage/replay tests retained. |
| E2E-16 | Interrupted gate | INTEGRATION with commit/TUI fault injection | Pending/decided-not-consumed stays incomplete; load has no recovery effects | `P14G.3 TEST-046 interruption...` cases. Consume/resume is one atomic transition; a fabricated half-resume is rejected by the scoped history test, not claimed as a valid recoverable state. |
| E2E-17 | Superseded authorization + scope chain + current writer/final gates | INTEGRATION with role/TUI doubles | Historical gate valid for its phase; current grants valid; COMPLETED/reload | `P14G.3A TEST-042/046 scoped multi-gate...`: implementation authorization A, two scope changes, current writer authorization, validation/review/final grant. |

## Real positive evidence (preserved)

Campaign directory under the system temporary root: `p15-live-biF6Gs`.
Task `p15-live-positive`, COMPLETED revision 27. Three terminal roles: Scout, Developer, Reviewer; no Oracle. Both native human gates consumed. RESOLVE_RISK persisted. All 18 attested CMP facts true. Original HEAD/branch/index/tracked bytes/modes/untracked/ignored match the pre-run snapshot; candidate contains `after\n`. Both lock files absent after terminal commit. Read-only durable reload PASS.

Authorization hash: `a8c29d84579456c2c0cc6f8f643a89cdc90ed8d1da6ad4a1bfc5b5a16bb464d1`.
Terminal hash: `2d9c83c13993e90dfa77a341f5258679b5c77fc5c78325a328498ef649e1ef08`.
Unequal hashes are expected; terminal references exact authorization hash. Later P14H presentation changes are not retroactively attributed to this historical run.

## Negative procedure and authority boundary

Use a new repo/B0/task/control path/external package copy. Only `allowed.txt` is authorized; `forbidden.txt` starts as a protected tracked file. The explicit test extension waits for the real Developer to return, writes an external injection intent report, then changes `forbidden.txt` in that exact isolated candidate. It does not patch ScopeGuard, mutate child results, fabricate approval, or write the original. The normal production capture must reject the effect. Report the actual state, run statuses and locks; BLOCKED is not forced into FAILED. No manual lock deletion.

Parent prose (including requests to merge/apply) is never workflow evidence. Model tools remain read-only. The probe has no model-callable tool or approval entrypoint and is excluded from the package archive.

## Real negative evidence

Campaign `p15-negative-5F88hD`: **PASS — REAL-HOST with host-controlled fault injection**, not a spontaneous model violation. Evidence files under that campaign directory: `scope-injection.json`, `durable-verification.json`, `real-host-negative-result.json`; runnable assertion check: `verify-negative.py` (result is exclusively created, never overwritten).

Production `implement()` rejected the injected effect with SCOPE_GUARD_FAILED; durable state is BLOCKED revision 13, reason `Candidate scope/integrity failed`. Scout and Developer are TERMINAL with durable process proofs. The beforeImplementation gate was approved through native confirmation and consumed at event-r8. The actual candidate contains `allowed.txt=after\n` and the forbidden-file bytes matching the injection hash; no candidate was admitted. No Reviewer, validation, Oracle, rework or infrastructure retry was dispatched. Original HEAD/branch/index/files/modes/untracked/ignored match the baseline snapshot. Both locks remain held by the recorded owner at verification; no release or recovery was attempted.

The operator also reported parent fetch failures/retries and a denied `subagents_enable` call (`PARENT_MUTATION_ISOLATION`). Those parent messages are not workflow retries, authorization or evidence of changes. The durable workflow dispatch count remains exactly two.

## P15.4 real-host overlap certification

Under the system temporary root: report `p154-overlap-9859dr1b/real-host-overlap-result.json`; raw evidence: `host-report.json`, `runtime.jsonl`, independent session transcripts under `sessions/`; runnable check from the campaign directory: `python3 verify-overlap.py`.

New external package copy, task `p154-overlap-9859dr1b`, target `${TMPDIR}/controlled-orchestrator-real-5Ip6AK/original`, B0 `b78b5387887be29ae8a83719e400d3e8189a0f65`, fresh automatic lock namespace. Only the external probe taskId differs from the existing probe; no production feature changed. Scout and one Developer terminated, host ScopeGuard admitted generation 1, and host validation passed before the review batch. Existing probe command is `/usr/bin/true`; exact fixture bytes are additionally asserted by the host and inspected by both Reviewers. This certifies overlap, not validation-command quality or durable completion.

Both independent fresh sessions received candidate `fc65c407e6b99c03b4aad3e9104c772063d1db05022a9f4b4833fcd9d41fc11d`, generation 1, spec `286373dbe3f39ffe4ebf823b5c77674fdb2c349f55079822e3876a12af77a75c`, and identical validation evidence. Distinct assignment/attempt/request/run IDs and terminal proofs are retained in the report. Tools were limited to `read` and `structured_output`; transcript inspection confirms no peer history/output or cross-review communication.

UTC windows from runtime transcript events (first read tool-result through structured-output completion, conservative subintervals of actual execution):
- A `2bc68b86-8916-47d6-823d-b79368d17e40`: `2026-09-28T16:56:51.600Z` → `2026-09-28T16:57:18.802Z`, PASS.
- B `9470ab34-208e-40b3-a983-4a5f7576338d`: `2026-09-28T16:56:57.707Z` → `2026-09-28T16:57:23.176Z`, PASS.
- Both strict overlap inequalities hold; overlap **21,095 ms**. Report also retains session-start and attributed terminal-observation times; none are model-generated timing claims.

Writer admission during review was denied by the production host guard (`ORCHESTRATOR_STATE_INVALID`) without counter changes. Budget admission is whole-batch before intents: 2 used + 2 requested <= 8. Separate attempts/dispatches/RunRecords increased totals from 2 to 4. Production aggregation waits for all settled results, routes any BLOCKED/FAIL without majority semantics, and returned the equivalent all-PASS outcome `COMPLETION_NOT_YET_AUTHORIZED`. Both Reviewers were terminal before result acceptance; no task continuation/completion was attempted. Pre/post candidate inventories and digest agree. Original T0–T3 HEAD/index/checkout bytes/modes/inventory agree, including untracked/ignored; worktree registration metadata is not mistaken for original checkout mutation. Locks are preserved; no reclaim/recovery attempted.

## P15.4 final verification

Baseline and final suite: **315/315 PASS**, zero failed/skipped/cancelled; typecheck, package dry-run, frozen normative hashes and diff check PASS. Final audit PASS, zero vulnerabilities. Logs: campaign subdirectory `final-verification-retry/`; audit success is `audit-retry.json`. An initial final-suite failure was solely the machine-local-path rule in this evidence document, corrected to portable report references. A later npm audit HTTP 500 was retained as unavailable evidence and retried successfully; it was not counted as PASS. Baseline's first test invocation exceeded its caller deadline; the complete rerun passed before any fixture launch.

E2E matrix complete at the evidence levels explicitly listed above; historical real-host positive/negative results remain PASS. P2–P14 regressions PASS. No product feature or normative hash changed. Next authorized phase: P16; **NEXT PHASE STARTED: NO**.

## P16 boundary

- Real-host scope-negative `p15-negative-5F88hD` is now PASS after two unsuccessful setup/admission attempts, which remain historical non-PASS evidence. `p15-negative-hRLrKl` is preserved at ANALYZING; do not resume it automatically or clear its locks. `p15-negative-rAchEi` is preserved at AWAITING_HUMAN, original unchanged, no negative PASS claimed. Loader isolation was reproduced locally: same-graph class identity true, separate-extension identity false. Load only the combined negative-probe entrypoint plus pi-subagents, not the production entrypoint separately. Every campaign uses new B0/repo hash/task namespace and an external copy.
- P15.4 closes the missing real measured P13 overlap proof: **TEST-041 PASS; UV-012 VERIFIED** for this real-host campaign. This evidence update supersedes the historical unverified status without changing frozen normative documents/hashes.
- Matrix rows retain their actual evidence levels; integration doubles are not retroactively claimed as real-host runs.
- Stale-lock reclaim, takeover, automatic cross-restart reconciliation, WAL repair and interrupted INTENT recovery: **DEFERRED TO P16**. Existing interrupted task stores/locks are preserved.
