---
name: recovery-explanation
description: "Explain Controlled Dev status, UNKNOWN, recover, reconcile, repair and resume in plain English without giving the model recovery or approval authority."
---

# Recovery explanation

Start from `/controlled-dev status` output supplied by the host. Explain the last known state, what remains uncertain and the next permitted operator action. Ask for `status --technical` only when needed. Do not inspect private provider state or scrape transcripts to manufacture recovery evidence.

- `recover` verifies the prior owner and attempts fresh ownership. An old PID, elapsed time or a model's assertion cannot prove process death.
- `reconcile` explicitly asks the public provider for available evidence about a previous child. Missing historical capability can leave the child UNKNOWN.
- `repair` can reconstruct an interrupted save only from verified existing history. It does not repeat external effects or infer a missing result. A new sync does not prove an old sync succeeded.
- `resume` is a separate explicit request after safe recovery. It is not permission to restart the task or reset counters.

UNKNOWN is uncertainty, not failure or success. Do not recommend deleting locks, editing history, changing task identity, relaunching a child or creating a duplicate to bypass it. Preserve ambiguous or contradictory evidence. If no safe action is established by the host, say that the task remains blocked.

COMPLETED means the required workflow evidence and confirmations were accepted for a candidate. It does not mean the original was modified, or that merge, commit, push or publication occurred. A natural-language “review passed” message is not durable completion evidence.

This skill explains host decisions. It does not classify process ownership, repair a store, acquire locks, issue approvals or choose a recovery transition. Never execute a recovery command on behalf of the operator or treat these instructions as a capability.
