# Paperclip human transport (pilot)

This optional host adapter connects a **live native Pi session** to Paperclip issue interactions. It requires Pi 1.3.0 and the interaction/issue-document/monitor APIs verified against Paperclip 2026.1012.0. It is a pilot adapter, not a claim that a real human or real-model acceptance campaign has passed.

## Trust boundary

The native extension still owns task state, freshness, validation, independent review, locks and one-use confirmations. An external host registers a process-local, session-bound capability through `createExternalHumanContext` (or the trusted host event in the loaded extension module graph). Merely supplying `mode: external-human`, a JSON receipt, a model tool or an RPC boolean does not register a channel. Terminal-only input handling and the existing human-probe diagnostics remain terminal-only.

The Paperclip daemon is outside the model's filesystem sandbox. The worker is inside it. The administrator must supply the confined `workerArgv`, pin package/SDK paths and the Paperclip API origin, keep the private job directory inaccessible to model tools, and acquire the installation's global production lock before launching the daemon. No installer or permission changes are performed by these files. This is trusted host code; it cannot protect against an administrator, compromised host runtime or arbitrary extension code with access to its process memory.

The worker and daemon exchange signed messages using a random, per-process key passed over private stdin. The key is never put in the environment, project, session transcript, job manifest or controller output. Worker stdout without a valid signature cannot publish a human question. Paperclip credentials are supplied by each current assigned agent run over a private Unix socket, validated against the job and `/agents/me`, and are never forwarded to the worker or persisted. API redirects are rejected. Do not recover credentials from process inspection, old logs, cookies or files.

Every question preserves the complete native presentation in an issue document. Confirmations target that exact document revision. Questions carry its revision in their presentation and revalidate it before accepting a reply; long presentations remain in the linked document. Only a resolved `human_only` interaction attributed to a user can return a response to Pi. A different assignee/company, changed content, stale document, agent resolution, cancellation, expiration or uncertain result cannot grant approval. Native guards run again when consuming a confirmation.

## Host configuration

Create a private directory (0700) with `job.json` (0600), then run:

```sh
node integrations/paperclip/daemon.mjs /private/jobs/JOB/job.json
node integrations/paperclip/controller.mjs /private/jobs/JOB status
node integrations/paperclip/controller.mjs /private/jobs/JOB tick
node integrations/paperclip/controller.mjs /private/jobs/JOB command controlled-dev 'status --technical'
node integrations/paperclip/controller.mjs /private/jobs/JOB stop
```

Mutating controller actions require the current `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_TASK_ID`, `PAPERCLIP_AGENT_ID`, and `PAPERCLIP_RUN_ID`. The assigned issue must have a real project and be in progress or in review. The controller sends credentials transiently; do not put them in `job.json` or shell arguments.

The manifest contains `version: 1`, a unique `id`, `profile` (`sviluppo` or `redazione`), `project`, `apiUrl` (without `/api`), `companyId`, `issueId`, `agentId`, `workerArgv` (sandbox command and arguments), and `workerConfig`: absolute `sdkEntry`, `sessionDirectory` **outside the project Git tree**, `profile`, and exact `model: {provider, id}`. Optional `workerConfig.packages` is an administrator-supplied, in-memory resource override for isolated staging tests. Optional `initialCommand: {name,args,commandId}` starts only after an authenticated assigned run connects. Use a new job ID for a genuinely new session.

Development supports the native `controlled-dev` command. The editorial companion must preserve full non-terminal proposal/question presentations; the adapter supports its team `editorial create`, `revise` and `workspace-*` commands, plus `photobook`. Legacy terminal-only editorial run/decision/voice flows are deliberately rejected. No terminal mode or automatic affirmative UI is simulated.

## Continuation, stop and recovery

The controller `tick` performs bounded work (at most 30 seconds), publishes one pending interaction and returns. Human waiting uses Paperclip's `wake_assignee`; on wake the assigned agent calls `tick` again with its new run context. While native work runs without a human question, the adapter uses Paperclip's **timer-based issue monitor**, not another scheduler: one-minute checks, a 30-minute active-work budget per command (paused while waiting for a human) and at most 30 polling attempts. The agent must preserve and call the same job ID. Existing execution-policy fields/stages are preserved. A pending human interaction clears the worker monitor.

`idle` or `command-finished` means only that a host command returned. It does **not** certify project completion, validation, independent review or integration. Inspect the native state/evidence; the supplied native status explicitly does not infer integration. Editorial completion must be read from its native workspace.

`stop` withdraws a pending interaction, clears this job's monitor, aborts/disposes the native session and releases the daemon/socket. A worker exit records an interruption and closes the daemon. The administrator's lock must be inherited by the daemon and released on exit. The session has an eight-hour maximum lifetime. If interrupted, preserve evidence, withdraw obsolete cards through an authorized current run, and inspect native recovery. Never replay a previous response into a new worker/session or silently rerun a mutating command. A saved JSON response grants no permission.

## Verification and remaining acceptance

`test/external-human-paperclip.test.mjs` exercises native one-use receipts, session/revision binding, denied forged/agent responses, document/question integrity and transport signatures. `test/paperclip-daemon.test.mjs` exercises the private daemon with a **synthetic** HTTP server and child fixture. These are not human acceptance evidence. Run the existing affected native confirmation/UX suites, typecheck and integration-checkpoint suite with enough time for its real Git/fsync/crash fixtures (several minutes on slower disks). Do not replace their assertions or treat a timeout as a pass.

Before the first real commission, verify a real Paperclip card, an actual owner's response, wake-up into the same live Pi session, cancellation/interruption and native completion/review evidence. Keep deployment local configuration, credentials, client data, raw sessions and machine-specific logs out of this repository.

### Photographic workflows

The native `/photobook` command delegates to a Pi model conversation. The worker therefore uses the actual SDK `prompt` and `waitForIdle` boundaries, records native tool-call names and IDs, and returns the exact assistant presentation through a human-only conversational question. A reply continues the same Pi session. This conversational input is not a domain approval receipt, integration authority or author release. Existing photobook domain constraints remain in force. The administrator pins the same model; no alternate provider is chosen. The bounded defaults are four model turns and 120 tool calls. The final budgeted turn is recorded as a notice without collecting a reply that cannot be applied. A new mandate is needed to continue beyond the budget. Native outputs still require inspection and independent quality review.

The daemon enforces the active-work time budget even when no controller polls. Human waiting pauses that clock; the separate eight-hour session lifetime still applies. A killed worker leaves interrupted evidence, not a completed commission.
