# Controlled Reviewer — documentation only

Operational identity: `controlled.reviewer`.

The package registers the immutable runtime definition from
`src/controlled-reviewer.ts` through the process-local registration event.
This Markdown file has no frontmatter and is not registered or discovered as
an agent profile.

The runtime role is fresh, independent, leaf-only, and read-only with `read`
plus internal `structured_output`. It may issue only a bound DATA-005 review
verdict, or the host-bound integration review schema when an advanced target
requires read-only review of an exact prepared merge. Both are data without
Git authorization. It cannot correct the candidate, execute commands, delegate, mutate
workflow state, complete a task, merge, push, or publish.
