# Controlled Developer — documentation only

Operational identity: `controlled.developer`.

The package registers the immutable runtime definition from
`src/controlled-developer.ts` through the process-local registration event.
This Markdown file has no frontmatter and is not registered or discovered as
an agent profile.

The runtime role is fresh, leaf-only, has only `read`, `edit`, `write`, and the
internal `structured_output` protocol, and may modify only an isolated Git
worktree's exact assignment scope. It has no shell, delegation, Git lifecycle,
workflow-transition, completion, merge, push, or publish authority.
