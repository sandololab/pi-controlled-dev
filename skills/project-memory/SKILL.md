---
name: project-memory
description: "Use host-selected technical memory across tasks, distinguish decisions from advice, and propose verifiable updates without granting authority to Markdown or agents."
---

# Project Memory

Recall project memory during repository analysis, task formulation, implementation and independent review. The host selects a bounded set by current status, repository-relative scope, relevant files and explicit lesson loadWhen. Use only the supplied context; never scan the profile, memory store, obsolete records or all Markdown notes. Repository files remain observed facts, accepted Software ADRs remain software decisions, conventions describe project practice, technical constraints bind software boundaries, and lessons are advisory experience. None grants tools, expands task scope or overrides the human or the Orchestrator.

Use exact record IDs, revisions and digests when describing which memory influenced a task. Turn applicable decisions into short contextual Design expectations with stable references. Report omissions, PROJECT_MEMORY_CONFLICT, evidence stale and unavailable binding context explicitly; never choose a winner or silently ignore an accepted decision. A planned departure from an accepted ADR requires a new proposal and explicit human acceptance/supersession. The Reviewer assesses architectural consistency, conventions, technical constraints and whether relevant advisory lessons were considered, independently of the Developer.

When experience justifies a proposal, return the optional structured `memoryProposals` sidecar on ScoutResult, DeveloperResult or ReviewResult (maximum four). Each proposal has recordKind, title, scope, content, evidenceRefs, relatedTaskRefs and relatedRecordRefs. Do not supply status, authority, project identity or lifecycle fields: the host supplies those and creates only PROPOSED or UNVERIFIED records. The sidecar is separate from task result authority. Do not emit it in the separate PreTaskProposalResult protocol.

The separate ProjectPlanningProposal conversation also supports memoryProposals for reusable design decisions, conventions and constraints. Use [] while clarification is pending. No technical lesson or future ControlledTask evidence exists merely because a plan was proposed. The host reuses this same memory repository, selection, confirmation and receipt mechanism; approving a plan does not adopt its memory proposals. Do not duplicate accepted design decisions.

The four contents are explicit:

- software-adr: decisionKey, context, decision, rationale, consequences, alternatives;
- technical-lesson: problemKey, problem, cause, rule, loadWhen (terms and paths), invalidatedWhen;
- project-convention: convention, rationale and optionally sourcePath;
- technical-constraint: constraint, rationale, consequences.

Scope is `{kind: "repository"}` or `{kind: "directory"|"component", path: "relative/path"}`. Evidence references use an existing ID and digest; task evidence has kind, id, taskId, relativePath (`tasks/task-id/artifacts/artifact-id`) and digest. Repository-source references have kind, id, relativePath and digest. Do not fabricate hashes, cite unseen evidence or copy evidence bodies. Prefer existing configuration sources to duplicating formatter/linter rules. Related references describe identity and ownership; reserved Systemist reference kinds do not authorize writing Systemist records.

Software ADRs start PROPOSED and require native human confirmation to become ACCEPTED. Lessons start UNVERIFIED; activation requires explicit assessment of scope, evidence, loadWhen and invalidatedWhen, followed by native human confirmation. Passing tests establish integrity or mechanism behavior, never general truth. Supersession preserves both sides and their history. Retirement/deprecation leaves a tombstone. A stale lesson is excluded and can be demoted to UNVERIFIED by host evidence invalidation; stale ADR evidence is flagged without automatically reversing the accepted decision.

JSON in the existing store is authoritative. Markdown and Obsidian are a human projection; Notes are personal and non-authoritative. A memory receipt documents the exact submitted context and dispatch identity, not comprehension or obedience. A trusted human receipt confirms the exact project-level decision and does not approve task implementation or completion.
