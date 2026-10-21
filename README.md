# pi-controlled-dev

**0.1.0-beta.4** — guided development for Pi Coding Agent, with isolated working copies, host-run checks, independent review and explicit human confirmations.

Describe the software result you want. Review the proposed plan, choose supervised execution or approve bounded autonomy, and follow each task through implementation, verification and integration.

**Development beta:** the beta.4 portable suite passed a complete verification run on 21 October 2026. Read the [validation status](docs/VALIDATION.md) for coverage, optional checks and remaining limits. Historical successful runs do not certify every current feature or platform.

The interface and agent guidance are in English. Documentation is available in [English](docs/README.md) and [Italiano](docs/it/README.md). See the complete [user manual](USER-MANUAL.md) / [manuale italiano](docs/it/USER-MANUAL.md).

## Requirements

- Node.js **>=22.19.0**, npm, Git and Pi Coding Agent.
- A model and credentials configured in the Pi profile you use.
- **pi-subagents installed separately**, exposing the public runtime registration, asynchronous dispatch, structured result and process termination capabilities required by the operation.
- A project folder separate from the installed package and Pi profile. Execution requires a clean Git baseline with at least one commit on a local branch; the package can propose initial Git setup when it is missing.
- A filesystem supporting the required synchronization operations. Verified ownership recovery currently relies on Linux process evidence.

pi-controlled-dev does not bundle or import pi-subagents. Compatibility is determined by advertised public capabilities, not a version number alone. Missing capabilities stop dependent operations. An unproven historical agent remains `UNKNOWN` and `BLOCKED`.

## Install from GitHub

Use a dedicated Pi profile. Loading this extension restricts the parent model to read-only tools for the whole session, including after a task finishes.

```sh
export PI_CODING_AGENT_DIR="$HOME/.pi-controlled-dev"
pi install git:github.com/sandololab/pi-controlled-dev
pi install npm:pi-subagents
pi list
```

These commands follow Pi 1.3.0's [package documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md). Configure your provider and model in this dedicated profile; credentials from another profile are not copied automatically.

The Git installation follows the repository's default branch. To pin a verified revision, append `@COMMIT_SHA` to the Git source, replacing the placeholder with the desired commit. A pinned revision does not advance with later updates.

To update an existing Git installation, close Pi normally, select the same Pi
profile in your terminal, then run:

```sh
pi update git:github.com/sandololab/pi-controlled-dev
```

Restart Pi afterward. Local development edits do not update GitHub or an installed
Git copy automatically. Update to beta.4 before reopening a project containing
new asynchronous process evidence; shared saved copies require beta.3 or later.
See [smaller saved copies](docs/CANDIDATE-STORAGE.md) and the
[reliability plan](docs/RELIABILITY-PLAN.md) for the changes since beta.2.

For an offline alternative, build a tarball with `npm pack --pack-destination "$HOME/Downloads"`, then install it:

```sh
npm install --prefix "$HOME/.local/share/pi-controlled-dev" \
  --ignore-scripts --omit=dev --omit=optional \
  "$HOME/Downloads/pi-controlled-dev-0.1.0-beta.4.tgz"
pi install "$HOME/.local/share/pi-controlled-dev/node_modules/pi-controlled-dev"
```

Install pi-subagents separately in this case too. Keep the package, its installation prefix and the Pi profile outside the project being developed.

## Open a project

Start Pi in the folder you want to work on:

```sh
mkdir demo
cd demo
pi
```

Then open:

```text
/controlled-dev
```

The package recognizes the current project and reopens its saved objective, plan and status. Inside a Git subfolder, it opens the repository root. A folder containing one nested repository opens that repository; with multiple repositories, enter the intended project first.

If Git is missing, review the proposed local baseline, file exclusions and commit identity. Existing files keep their location and content. Choose **Start from existing code** only when you want a separate import into a new folder. Existing source code does not imply a refactoring objective: ask for the actual feature, fix or continuation you need.

After opening a project, natural-language requests are handled through the package's dialogs. You can also use `/controlled-dev request <description>`. The parent model does not implement changes directly.

## Plan and execute

The read-only pre-task Scout examines relevant sources and selected Project Memory. It proposes a design, verifiable tasks and justified dependencies. Missing material information is investigated first, then presented as focused questions. A suggested answer must be explicitly submitted; closing the dialog does not accept it.

Review the plan, request corrections in natural language and approve it. **Continue the work** prepares the next ready task; choose among ready tasks when several are available. **Consult the plan** reads the saved plan and linked results without launching agents. Alt+P opens plan consultation; Alt+S opens task status.

A planned task uses one compact proposal covering its objective, editable files, acceptance criteria and checks. **Create the task** freezes the proposal; implementation and completion still require their applicable authorizations. `/controlled-dev new` provides the detailed five-step wizard for a separate request, and `/controlled-dev menu` opens advanced controls.

**Break down the work** or `/controlled-dev project refine` refines one unstarted task into at most three smaller increments while preserving the rest of the plan. Large remaining work stays marked for further refinement. A task already linked to execution, or with linked successors, requires an ordinary plan revision. Changing identities never resets used attempts or establishes completion.

Choose an execution mode:

- **Supervised mode:** review confirmations at individual checkpoints.
- **Controlled Autonomy:** approve the exact plan, allowed and protected paths, checks, budgets and permitted local integrations. The package proceeds sequentially within those limits and stops when another decision is needed.

Autonomy pauses on material plan or architecture changes, additional scope, conflicts, unexpected dependencies, unresolved risks, exhausted budgets or uncertain process identity. It grants no remote Git operations. You can pause or revoke it.

## Roles and authority

| Role | Responsibility |
| --- | --- |
| Scout | Read-only analysis of the assignment and relevant repository context. |
| Developer | Changes within exact authorized paths in an isolated candidate workspace. |
| Reviewer | Independent, read-only assessment of criteria, scope, tests and actual changes. |
| Oracle | Bounded advisory analysis during an authorized escalation. |

The TypeScript host owns task state, scope enforcement, command execution, evidence validation, confirmations and completion. Agents return structured data. They cannot grant themselves permissions or declare durable completion.

Developer has no shell, delegation or authority to modify the original repository. It should reuse existing components, preserve public behavior and choose a design proportionate to the task. Reviewer also assesses architectural consistency, duplication, complexity, naming and unnecessary abstractions.

The twelve packaged skills provide methodology, not authority. The `/controlled-dev-task`, `/controlled-dev-recovery` and `/controlled-dev-result` prompt templates explain or prepare requests; they neither invoke the workflow nor approve a gate. Files under `agents/` document roles and are not independently discoverable agent profiles.

## Checks, confirmations and results

The host compiles proposed checks into fixed recipes: exact file content, configured project tests, candidate Python tests and a diff formatting check. Supported project test mechanisms include npm, pytest, Cargo, Maven, Gradle and Make. Project tests execute repository code in the candidate copy. A diff formatting check alone does not prove correctness.

Candidate Python tests may be created by the current task. The proposal identifies exact test files and supported pytest configuration. The fixed runner disables cache, bytecode, automatic plugin loading and extra environment options; plugins explicitly required by tests remain possible. At least one ordinary test must pass.

Start a prepared task with `/controlled-dev run`. Read each native confirmation. The initial selection is **No, go back**. No, Esc, timeout or UI failure do not approve anything. Pending decisions can be opened through:

```text
/controlled-dev decide APPROVE
/controlled-dev decide REJECT
/controlled-dev decide ANSWER Your clarification
```

These commands still require explicit TUI confirmation. Model messages, agent outputs and edited files cannot replace it. Confirmations bind the exact subject, payload, presentation and current session and are consumed once.

```text
/controlled-dev status
/controlled-dev status --technical
```

Status provides **Summary**, **Activity**, **Checks** and **Technical details**. Use arrows or Tab to change views, 1–4 as shortcuts, up/down or page keys to scroll, and Esc to close. In text editors, Ctrl+J inserts a newline. Status is a verified snapshot when opened; reopen it to refresh.

A successful test or Reviewer PASS alone does not complete a task. **COMPLETED** requires current, attributed evidence and all applicable confirmations. Completion freezes the verified candidate; integration into the original project is a separate fact.

Failed checks retain bounded logs, attributed runtime observations and a cautious diagnosis. Corrections remain within the approved scope and retry budget, with independent review afterward. Redaction reduces common secret exposure but is not a universal secret detector.

## Integrate verified work

Choose **Integrate into project** or `/controlled-dev integrate [taskId]`. The host prepares an exact merge against the current destination in isolation, reruns the task's checks and obtains an independent review when the advanced target requires one.

In supervised mode, a trusted confirmation binds branch, commits, tree, files and evidence before the local branch and official folder are updated. Controlled Autonomy may authorize this within its approved policy. Rejection preserves the completed task and candidate.

Dirty targets, stale approvals, unexpected branches, conflicts, failed checks and ambiguous outcomes stop integration. There is no automatic hard reset, stash, rollback or conflict resolution. Historical tasks without a promotion binding are not silently migrated. Manual integration is recognized only through actual candidate commit ancestry.

**Integration verification** checks selected integrated results together on an isolated copy of an exact commit. Proposal approval and execution are separate actions. PASS concerns that commit and selected checks; STALE identifies a result for an earlier version. It does not certify a release, repair code or undo integrations.

## Memory, notes and portability

Project Memory stores software architecture decisions, technical lessons, conventions and constraints across tasks. Proposals require a separate human decision before becoming current. A lesson remains advice; accepted decisions and current constraints require explicit assessment of divergence. `/controlled-dev memory` opens this view.

The host supplies bounded, relevant memory and records exactly which revisions and digests each role received. Markdown and Obsidian notes explain tasks, scenarios, runs, evidence, reviews, decisions and plans. JSON records retain authority. Personal notes are preserved separately and are not overwritten by regeneration.

Use **Keep the project in its folder** to move existing project documents and state into the project through the verified host path. For transfer or a cleanly closed saved project, use **Resume transferred project** or `/controlled-dev project resume-storage`. Include `.git`, `.controlled-dev` and the existing `Documentazione` folder when transferring. The historical folder name is retained for compatibility; its generated explanations are in English. Credentials and live process permissions are not transferred. Do not rewrite absolute paths inside signed or hashed historical evidence.

## Recover after interruption

Read `/controlled-dev status` first. Recovery, reconciliation, repair and resume are distinct operations:

```text
/controlled-dev recover
/controlled-dev reconcile
/controlled-dev repair
/controlled-dev resume
```

Use only the path allowed by the saved state. Recovery requires verifiable ownership and process termination; a missing lock or reassuring agent message is insufficient. Repair verifies and synchronizes the existing journal in the new process. It does not invent missing effects, results or approvals. Resume requests any fresh local confirmations needed before further work.

An interrupted independent review can be retried only with verified prior termination and unchanged candidate evidence. Existing attempts remain counted. A cleanly closed project uses the storage resume path, even in the same folder; it does not have old locks to reclaim.

Where permitted, `/controlled-dev close-attempt` closes a blocked, reconciled attempt without claiming the objective complete. Partial work, logs and counters remain preserved and are not integrated as a successful result.

Most controlled operations have a ten-minute deadline; single-task proposal analysis has five minutes. Source inventory and request/result sizes are bounded. Oversized inputs produce an explicit error rather than silently dropping files or truncating proposed work. See the manual for the limits and supported recovery cases.

## Update or remove

Close active sessions before updating, and use the same Pi profile:

```sh
pi update git:github.com/sandololab/pi-controlled-dev
```

Restart Pi afterward. Pushing a commit to GitHub does **not** update installations on other computers. In Pi 1.3.0, `pi update` without arguments updates Pi itself; `pi update --extensions` updates all packages. For the tarball alternative, reinstall the new tarball into the same prefix.

To remove the Git installation from the current profile:

```sh
pi remove git:github.com/sandololab/pi-controlled-dev
```

For the tarball alternative:

```sh
pi remove "$HOME/.local/share/pi-controlled-dev/node_modules/pi-controlled-dev"
```

Removal does not cancel an active workflow or erase its data. Preserve profiles, candidates and evidence for as long as needed.

## Development and distribution

The public repository includes sources, tests, synthetic fixtures, reusable examples and documentation. Installed dependencies, profiles, credentials, execution logs and private historical archives are excluded. A Git install downloads the repository; `package.json`'s `files` list separately defines the smaller npm tarball.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack --dry-run
```

The installation probe is separate:

```sh
P17_PACKAGE_TARBALL="$HOME/Downloads/pi-controlled-dev-0.1.0-beta.4.tgz" \
  node --test test/product-install.test.mjs
```

Read [architecture](docs/ARCHITECTURE.md), [protocol](docs/PROTOCOL.md), [test matrix](docs/TEST-MATRIX.md), [historical evidence](docs/HISTORICAL-EVIDENCE.md) and [current validation](docs/VALIDATION.md). The [Systemist composition guide](docs/SYSTEMIST-COMPOSITION.md) describes the host API for domain packages without turning software evidence into system-level acceptance.

Tool restrictions are not an operating-system sandbox and do not protect against malicious host extensions or destructive test programs. Completion proves the specified checks, not absolute software correctness.

## License

The repository is public and currently **UNLICENSED**. No open-source license has been granted. `private: true` prevents accidental publication to the npm registry; it does not make GitHub private or prevent Git installation.
