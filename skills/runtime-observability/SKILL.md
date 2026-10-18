---
name: runtime-observability
description: Diagnose a failed software validation with bounded runtime events, a minimal scoped correction, and the same validation rerun.
---

# Runtime observability

Use this skill when a Controlled Dev validation fails and a runtime sequence or intermediate value could explain it. The host owns validation and completion. Events and model analysis are evidence only; neither grants a PASS, changes scope, or approves a human gate.

1. Keep the original failed `ValidationResult` and its exact command identity. Inspect its exit status, host proof, and runtime evidence before making a diagnosis. A malformed, missing, truncated, secret-bearing, or incomplete event stream means `UNKNOWN`, not PASS.
2. Describe **observed facts**, **inferences**, and **unknowns** separately. A likely source location needs a cited event plus code context. If no causal event exists, say so and ask for a targeted next observation; do not invent a root cause.
3. If instrumentation is useful, use the existing approved candidate only. Change only allowed paths and mark removable diagnostic lines `CONTROLLED_DEV_TEMP_TRACE`. Do not capture environment variables, credentials, full files, arbitrary objects, or transcripts. Do not modify tests to hide the failure.
4. A child process can emit one JSON object per line, prefixed with `CONTROLLED_RUNTIME_EVENT ` on stdout or stderr. The host extracts these into a separate immutable JSONL artifact. An event uses `schemaVersion: "controlled.runtime-event.v1"`, ISO `timestamp`, `source`, `eventType`, `severity`, `correlationId`, and optional short `message`, flat scalar `data`, or finite numeric `metrics`. This is a technical interface for repository code, never a request for the user to write code or a test command.
5. Apply the smallest fix supported by the observed failure. Remove temporary instrumentation before final review. If the needed change leaves approved scope, stop for the normal scope-change path; an event never expands authority.
6. The host reruns the **same approved command** with the same scenario ID and command hash on the new candidate generation. Compare failure symptom, event types, metrics, exit result and residual anomalies. If input or environment assumptions differ, declare the comparison inconclusive.
7. Give the independent Reviewer the original failure, diagnosis, actual patch, current validation and before/after comparison. Reviewer checks that the fix addresses the failure, tests were not weakened, and temporary instrumentation is absent. Human confirmation and durable completion remain separate.

The loop uses the TaskSpec's existing rework and dispatch limits. Do not create an autonomous retry loop, a new command, or a second store. In the normal UI, explain a failed verification and the proposed next step in natural language; keep JSONL and artifact identifiers in technical details.
