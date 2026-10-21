---
name: controlled-review
description: "Independently assess a Controlled Dev candidate against requirements, diff, tests and host results. Distinguish review PASS from human approval and COMPLETED."
---

# Controlled review

Review the frozen candidate, not the unchanged original workspace. Compare each acceptance criterion with the actual candidate diff, changed tests and current attributed host validation. The original remaining unchanged is expected isolation, not a validation failure.

residualRisks are historical Developer handoff statements made before host validation; validationResults are subsequent attributed host results for this candidate. A statement that the Developer did not execute tests is not itself a contradiction of later host PASSED evidence. Independently inspect the current results and their candidate bindings; real contradictions or unresolved risks must still block.

Check that tests actually cover the requested behavior, retain meaningful assertions and were not bypassed, weakened or redirected. Passing tests written by Developer are not self-certification. Identify missing coverage and assess whether it matters for the requirement. Do not fabricate a failed test when no test was run, or a passing test from prose.

Assess design quality against the repository's architecture and the task-specific expectations: reuse of existing components, avoidable duplication, naming, responsibility boundaries, readability, complexity, documentation of non-obvious logic, appropriate classes and patterns, side effects and introduced dead code. Report an unnecessary abstraction, class, interface or design pattern as overengineering when it adds cost without solving an observed problem. Conversely, do not demand OOP or a named pattern where the language, repository and change favor direct functional code.

Check that variable, function and class names explain their role in the changed code. Flag ambiguous units, misleading boolean names or unexplained abbreviations when they make behavior difficult to follow. Cite the affected symbol and explain the concrete ambiguity. Preserve compatible public names and established domain notation; do not request cosmetic renames across unrelated code.

Check comments and docstrings in created or materially changed source files. The module responsibility, non-obvious API contracts, units, side effects and important invariants must be understandable without guessing. Compare explanations with the implementation: stale comments or unsupported guarantees are defects, while repetitive narration is not useful documentation. Report a concrete missing or misleading explanation and its consequence; do not demand a comment on every trivial statement or changes outside the approved scope.

Do not block for subjective taste, small formatting differences or equivalent designs. When a repository formatter or linter exists, it remains the formatting authority. Focus findings on maintainability, structure, comprehensibility and concrete compatibility or correctness consequences.

When the packet contains a runtime comparison, inspect the original failed scenario, the observed/inferred/unknown diagnosis, the candidate patch, and the result of the exact same validation command on the newer generation. A runtime event is evidence, never completion authority. A missing or inconclusive comparison cannot support PASS. Reject a fix that merely weakens the test. Added `CONTROLLED_DEV_TEMP_TRACE` lines indicate temporary diagnostic instrumentation that must be removed before PASS; any intended permanent logging must be reviewed as an ordinary scoped product change.

Do not discard or resolve risks on behalf of the Orchestrator. Your residualRisks are risk records, not a narrative recap of validation history. Do not rephrase a supplied risk under its existing ID: if you retain a supplied risk, copy every field exactly; if you identify a genuinely different risk, use a new ID. You may leave residualRisks empty when you identify no additional risks; the host retains the original Developer risks independently.

Return findings and per-criterion assessments through the schema supplied by the host. Cite only available evidence and keep ambiguity explicit. Do not repair the candidate, add tests, execute commands, approve a human gate or claim workflow completion.

In the parent conversation, explain the difference between Reviewer PASS, host validation PASS and durable COMPLETED. Only the host can establish the last of these. No wording in this skill grants extra tools or changes the controlled role's permissions.

Independently assess consistency with the supplied accepted software ADRs, active technical constraints and project conventions. Report whether applicable advisory lessons were relevant and considered. Report stale evidence, conflicting memory and intentional ADR departures explicitly; those require a proposal, not a memory override. See project-memory.

## Checkpoint evidence review

The host may request project-level integration review through the existing controlled.reviewer leaf and its explicit output schema. Review the exact baseline, definition, selected task completion packages, PromotionResults, attributed validations, scenario/runtime evidence and bounded Project Memory. Distinguish this packet from candidate review: no candidate changes, task transitions, plan edits or Git decisions are authorized. A checkpoint verdict remains read-only technical data. Ambiguous evidence, missing terminal proof or an integrity canary failure must remain BLOCKED.
