# Changelog

## [0.1.0-beta.5] - 2026-11-06

Development prerelease following the beta.4 package revision. No production
qualification or clean full-suite acceptance is claimed.

### Changes

- Recognize Pi 1.5's canonical builtin read metadata while retaining builtin
  origin checks, write/execute interception and the parent read-only boundary.
- Allow explicitly delegated local Git preparation bound to the exact project
  and commit identity; sensitive decisions retain their applicable confirmations.
- Preserve complete source inventories with compact initial maps and progressive,
  bounded catalog pages, including large and Unicode path sets.
- Clarify ConfirmationChannel as an authorized-operator transport; retain the
  compatible type alias and existing receipt/session/digest/consumption checks.
- Continue a local workflow after orderly quiescent shutdown and explicit reopen
  of the same persisted Pi session, using exact durable release and single
  consumption through native recover/resume.
- Permit native abandonment of eligible BLOCKED attempts with results, recording
  FAILED while preserving candidates, results, logs and counters.
- Update the README with project-local installation, initial session persistence,
  same-ID continuation, native close-attempt and conservative failure limits.

### Verification

TypeScript checking passed for the merged implementation. Focused read,
Git-delegation, catalog and confirmation regressions are documented in the
[validation report](docs/VALIDATION.md). The final continuation/abandonment group
contains 23 distinct passing cases. A real Pi 1.5.0 task persisted its session,
closed normally before Developer, reopened the same ID, recovered/resumed the
same task without replaying Scout, produced the exact output through Developer,
passed both host checks and received Reviewer PASS before COMPLETED.

This release preparation changes documentation and package metadata only; its
additional packaging/documentation checks passed: typecheck, seven product/
language cases, diff checking and npm pack dry-run; see validation for details. No runtime dependency is added. Earlier broad-suite failures remain
explicitly documented; historical beta.4 full-suite results are not beta.5 full
acceptance results.

### Limits

A crash without a completed orderly release, missing original session data,
live/uncertain children or uncertain host commands cannot be treated as a clean
handoff. Process-death recovery remains separate and can be blocked across PID
namespaces. Changed candidates and stale/replayed authority remain rejected.
A terminal confirmation does not establish a named human's presence. The
package's internal Reviewer does not replace external acceptance, operating-system
isolation or production qualification. No private logs or trial bundles are
release assets.
