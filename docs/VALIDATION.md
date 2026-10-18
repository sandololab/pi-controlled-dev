# Validation status

**English** · [Italiano](it/VALIDATION.md)

This is a development beta, not a stable release. English interface text and bilingual documentation do not resolve the pre-existing runtime failures listed below. Historical campaign reports describe earlier revisions.

## Publication checks — 18 October 2026

The full portable-suite baseline before localization ran **1,055 tests: 1,015 passed, 38 failed, 2 skipped** on Linux with Node.js 22.22.1 and TypeScript 5.9.3. This is a complete baseline run, not a claim of a passing release. Type checking, package creation and an isolated native Pi loader/install probe passed. The loader probe used synthetic responses and made no model calls.

The English revision is checked separately for status rendering, preservation of literal user/evidence text, linked bilingual documentation, the 43 protocol transitions, archive contents and affected UI/flow tests. Full and targeted rerun logs remain in the author's external validation archive. Checks performed with test time limits are distinguished from completed runs; a timeout is never counted as a pass.

### Completed checks for the English revision

| Check | Result |
|---|---|
| Language, document links, protocol, project memory and generated notes | 77/77 passed |
| Targeted confirmations, promotion presentation and status rendering | 30/30 passed |
| Final confirmation and autonomy summary | 2/2 passed |
| Failed validation → bounded correction → repeated validation | 1/1 passed |
| TypeScript check, package creation, isolated native Pi install/reinstall | Passed |
| Scaffold metadata/inventory/import checks | 5/6 passed; known contract-loader failure remains |

The broader runtime run included time-limited suites and was followed by targeted corrections/reruns. It is not reported as an all-green full-suite result. Logs preserve unsuccessful attempts as well as final passing checks.

## Known baseline failures

- The contract test loader rejects an operational import reached through `runtime-root-binding` (`Unapproved P4 module: pi-subagents-rpc`). This affects several contract/role/RPC/orchestrator/retry/scope suites and a scaffold test. Its isolation boundary is not widened simply to obtain a passing report.
- Some candidate-promotion and integration-checkpoint fixtures stop at `DISPATCH_OUTCOME_UNKNOWN` or `DEVELOPER_BASELINE_FAILED` instead of reaching the intended review path.
- Repeated project transfer can return proposal schema version 1 where the bounded-baseline test requires version 2.
- Planning-limit, autonomy history/task-identity, runtime-import worker and some UI cancellation/session-replacement cases fail. A design-guidance assertion also needs separate review.

These are recorded failures, not supported happy-path guarantees. The package remains beta while they are unresolved. Earlier all-green P15/P16 reports must not be used as current certification.

## Reproduce

Use Linux, Node.js >=22.19.0, npm and Git:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack --dry-run --ignore-scripts
```

Tests use synthetic fixtures and unique temporary directories. Native Pi probes must use an isolated profile. Installation and historical-recovery probes require explicit external inputs and are documented in the README and their test files; they are outside the portable suite. No new real-model campaign or human acceptance run is claimed for this publication.
