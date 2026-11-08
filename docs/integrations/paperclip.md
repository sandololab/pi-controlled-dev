# Paperclip integration and agent setup

This guide covers **pi-controlled-dev 0.1.0**, with the same runtime as 0.1.0-beta.5. It describes configuration and existing interfaces, not a Paperclip plugin, a new bridge or a replacement session manager.

## Choose the right tool

Use Pi without this package for small, direct tasks that do not need controlled candidates, structured review or durable development checkpoints. Use Controlled Dev when the assignment benefits from a proposed plan, bounded implementation in a separate working copy, host-run checks and internal review. Use an editorial package in a separate project/session for document production. Loading Controlled Dev restricts the parent model to read-only tools for the entire session; it is unsuitable as a global extension for an unrestricted editorial or general-purpose Pi session.

Paperclip owns the company assignment, assignee, dependencies, external approvals and final independent acceptance. Controlled Dev owns its internal Scout, Developer, Reviewer, candidate, checks and saved development state. Do not mirror its internal states in a second workflow service or create a Paperclip task for every internal callback.

## Supported execution paths and limits

| Path | What to configure | Confirmation boundary |
| --- | --- | --- |
| Paperclip agent operating Pi in a persistent terminal | An installed Paperclip adapter for the operator agent, plus an already authorized terminal tool capable of opening, reading and interacting with the same Pi TUI | The operator submits the actual native dialog under its mandate; decisions reserved to a person are shown to that person |
| Paperclip running Pi directly | The installed Paperclip Pi adapter/runner, project directory, explicit model and instructions | Verify extension discovery and each required interactive operation; session resume alone does not prove dialog support |
| Programmatic host composition | The package's existing host API and a verified confirmation channel | Implement against the documented host contract; this is integration development, not an installation prerequisite or a ready-made Paperclip connector |

The terminal path has completed a real task through orderly same-session recovery, Developer, checks and internal Reviewer. It requires an actual terminal tool in the agent's environment. Neither this package nor Paperclip's ordinary shell configuration automatically supplies an interactive terminal MCP service.

Paperclip's [Pi adapter](https://docs.paperclip.ing/reference/adapters/pi/) documents instructions, model selection and native session resume. Runner behavior varies by installed Paperclip version; inspect the agent's actual runner rather than copying configuration from another release. A print/headless run that cannot present the required native dialog is a **specific integration limit**. Report it instead of fabricating approval, replaying a stale decision, editing saved state or adding another session manager. The [host composition guide](../SYSTEMIST-COMPOSITION.md) is for deliberate host integrations.

## Install into the work project

Prerequisites: Node.js >=22.19.0, Git, Pi, an authorized configured model and pi-subagents exposing the required public capabilities. One Pi executable can serve multiple projects. Separate project-local packages and, when necessary, separate Pi profiles keep role-specific settings apart.

Run these in the **shell**, inside the project being developed, not inside the package source checkout:

```sh
export PI_CODING_AGENT_DIR="$HOME/.pi-controlled-dev"
cd /path/to/project
pi install git:github.com/sandololab/pi-controlled-dev@v0.1.0 -l
pi install npm:pi-subagents -l
pi list
pi --list-models
```

Use the same profile, OS identity and model configuration when the Paperclip operator opens Pi. A new profile does not inherit authentication automatically. Configure access through the runtime's supported authentication mechanism; never put tokens in Git URLs, instructions, issue comments or `.pi/settings.json`.

The local install records package sources in `.pi/settings.json`. Include that **non-secret** configuration and any intended project instructions in a clean Git baseline before creating work. Keep the Pi profile, credentials, workflow evidence and candidate stores private and outside committed source files as appropriate to their documented storage layout. Let the package propose exclusions when preparing a new repository; review them before approval. Do not alter the baseline or package generation under an active task.

## Configure the Paperclip operator agent

1. Select a supported installed adapter for the agent. For a Codex operator, consult Paperclip's [Codex adapter](https://docs.paperclip.ing/reference/adapters/codex/). Keep the existing permission model; this package requires no agent-creation authority or instance administrator role.
2. Set the agent's working directory (`cwd`) to the work project. Set `instructionsFilePath` to a readable, persistent Markdown file with the operating instructions below. For a direct classic Pi adapter, set `model` to an installed `provider/model` value. Check the installed runner documentation for translated settings.
3. Give the operator the terminal capability needed for the selected path. Confirm that its sandbox can access the project, installed package, intended Pi profile/store, candidate locations and required temporary directories. Keep OS sandboxing enabled. Configure only the network access and external tools the assignment actually needs.
4. Run Paperclip's environment test, then verify `pi list` from the agent's actual execution environment. A successful shell test under your personal account does not prove the service account sees the packages or model.
5. Save the Pi session ID, project root and package/profile identity in the assignment's technical report. Keep credentials, full transcripts and private runtime files out of ordinary comments and public repositories.

For direct Pi execution, Paperclip already manages its agent-scoped session resume. Do not also launch another Pi process on that saved session. For the terminal path, keep one session owner and use the explicit native reopen procedure below when needed.

## Skills and reusable instructions

Pi discovers the package's 12 skills through the package's `pi.skills` registration. They guide repository analysis, planning, evidence, validation, review, recovery, runtime observation, scenarios, design quality, project memory and initial setup. They **do not grant permissions**. The package supplies bounded guidance to its internal roles; do not inject the entire Paperclip company context, all installed skills or another workflow extension into every child.

Paperclip's own agent skill describes **when to select and how to operate** the tool. It is separate from the Pi package skills. Register a short skill using the installed Paperclip version's normal skill workflow, and reference this guide. Do not copy package source or credentials into that skill. Suggested content:

```markdown
---
name: controlled-development-operation
description: Select and operate Pi Controlled Dev for bounded software changes requiring isolated implementation, checks and review.
---
Read the installed package documentation before use. Choose plain Pi when a controlled development workflow adds no value. For Controlled Dev, use the authorized project-local installation and preserve its native task and session. Submit only decisions within the assignment's explicit mandate; ask the person for decisions reserved to them. Report missing capabilities precisely. Never edit workflow evidence or create substitute completion/approval receipts.
```

Keep reusable agent instructions generic, without company task IDs or project-specific paths. Supply actual paths and acceptance criteria in each assignment. Example `AGENTS.md` or Paperclip instructions file:

```markdown
You are a software engineer responsible for delivering and explaining verified software changes.

Read the assignment and the installed tool documentation. Choose plain Pi or Controlled Dev according to the task; do not use a package merely because it is installed. For Controlled Dev, open the native interface in the authorized work project. The package's parent is read-only; implementation belongs to its Developer in the candidate workspace.

Preserve the existing Pi session and package state. Operate native dialogs only within explicit delegated authority. A terminal response proves an authorized operator action, not the presence or identity of a named human. Escalate reserved decisions with the exact question and scope. Never answer in another person's name or infer approval from a notification.

Use package status and verified artifacts to report progress. Do not call a task complete just because a process ended. Keep local completion, integration into the target repository, GitHub publication and independent Paperclip acceptance separate.

Write short, clear updates: result so far, remaining problem, next action, and whether the owner must decide anything. Put hashes, session IDs, raw tool errors and detailed test evidence in the technical report.
```

Do not repeat the same long text in description, capabilities, skill and instructions. Use a short role description, one authoritative operating file and a focused skill.

## Native commands and confirmations

Enter slash commands **inside Pi**, not in the OS shell:

| Command | Purpose |
| --- | --- |
| `/controlled-dev` | Open the guided project interface |
| `/controlled-dev request <description>` | Submit the software objective |
| `/controlled-dev status` | Read progress and the current decision |
| `/controlled-dev status --technical` | Read technical state |
| `/controlled-dev run` | Continue through the package's own admission rules |
| `/controlled-dev recover [taskId]` | Acquire interrupted ownership only when proven safe |
| `/controlled-dev reconcile [taskId]` | Check existing asynchronous results without launching replacements |
| `/controlled-dev repair [taskId]` | Check/reconstruct an interrupted save when supported by evidence |
| `/controlled-dev resume [taskId]` | Resume from the verified point, with applicable confirmations |
| `/controlled-dev decide APPROVE` | Request approval of the current gate through the native confirmation path |
| `/controlled-dev decide REJECT` | Reject the current gate through that path |
| `/controlled-dev decide ANSWER <text>` | Supply an answer through that path |
| `/controlled-dev integrate [taskId]` | Request separate integration of the completed candidate |

Read current status first. These commands do not bypass dialogs, capability checks or authority boundaries. Do not run recovery commands as a blind sequence. Creation, implementation, retries, completion and integration may be distinct decisions. An approved bounded-autonomy plan covers only its explicit limits; it grants no remote Git authority. GitHub push/release permissions and Paperclip external acceptance remain separate.

## Save and resume without another session manager

For a terminal-operated Pi 1.5 session, first make an ordinary harmless user/assistant exchange so Pi persists its native JSONL session; slash-command-only activity may not create it. Use `/session` to record the real session ID. At a supported quiescent checkpoint, finish the package's durable release and close normally with `/quit`.

Reopen the same project, profile and store with `pi --session SESSION_ID`; verify the same ID before using the package's native recover/resume actions. Do not substitute a new session, `--continue`, a hand-written JSONL file or a fabricated release receipt. A crash, uncertain child process, missing original session or PID-namespace mismatch is not an orderly handoff and may remain blocked. Preserve evidence and report the limit.

## Small acceptance test

Use a synthetic, committed repository. Ask for one harmless text-file change with exact expected contents and one host check. Verify: the correct package is loaded; actual dialogs appear; only authorized decisions are submitted; Developer creates the candidate; the host check and internal Reviewer pass; the package reaches `COMPLETED`; and the target repository changes only after separate authorized integration. Have a different Paperclip reviewer inspect the actual delivered file and test result.

Test orderly session reopen separately at a supported checkpoint, using the same persisted ID. Stop at the first unsupported boundary and state which component failed: environment/model, terminal/runner, pi-subagents capability, package behavior or independent acceptance. Do not turn this smoke test into an infrastructure redesign.

## Updates and evidence

Close active work before changing packages. `pi update` updates Pi itself in Pi 1.5; `pi update --extensions` updates installed packages, and `pi update git:github.com/sandololab/pi-controlled-dev` targets this source. Pinned revisions remain pinned; install a new selected tag explicitly to advance them. A local path installation follows that directory, not an automatic GitHub update. See the upstream [Pi package documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md).

The package enforces tool and workflow boundaries, not an OS sandbox. Its internal Reviewer is separate from the independent Paperclip reviewer. Earlier broad-suite failures and conservative recovery limits remain in [validation status](../VALIDATION.md). Release 0.1.0 removes the prerelease suffix; it does not provide a new claim of full production qualification.
