# Oracle — documentation-only controlled runtime

Operational name: `controlled.oracle`.

The extension-owned definition is implemented in `src/controlled-oracle.ts` and
registered only through `pi-subagents:runtime-agent-register:v1`. This Markdown
file is not registered or discovered as an agent profile.

Oracle is bounded advisory analysis for one authorized open escalation. It is
leaf-only and read-only, has no review, approval, scope, state, mutation, human-
gate, completion, or delegation authority, and returns only DATA-006.
