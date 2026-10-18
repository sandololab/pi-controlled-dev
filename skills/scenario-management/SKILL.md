---
name: scenario-management
description: Define repeatable technical scenarios using only host-approved checks.
---

# Scenario management

This guide helps describe a repeatable technical scenario. It is not workflow authority and grants no permissions, commands or approvals.

## Rules

- Link the scenario to a validation command already approved by the host. Do not propose unrestricted shell execution.
- Explain purpose, preparation, inputs, expected observations, linked criteria, required evidence and cleanup in English.
- Keep `scenarioId`, version/hash, command identity, candidate generation and digest explicit.
- If inputs, execution or expected observations change, create a new version. A historical run continues to identify the version that ran.
- A new run adds evidence; it does not overwrite previous runs.
- Compare two runs only when scenario, version and command match and the subsequent generation is actually newer.
- FAIL is technical evidence and can inform diagnosis and rework. It does not by itself mean final task failure.

Describe only what the evidence supports. The package preserves authority in the structured store.
