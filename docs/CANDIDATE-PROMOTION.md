**English** · [Italiano](it/CANDIDATE-PROMOTION.md)

# Candidate Promotion / Git Integration

The baseline already uses detached Git worktrees outside the project. ScopeGuard compares the base commit, index, tracked files and manifest, includes new/binary/mode changes, and rejects protected paths, aliases and out-of-scope modifications. The candidate remains at the base commit across generations. Rework prepares a detached worktree from the previous result and reconstructs cumulative changes in the original candidate. Reviewer and validations bind to digest and generation; recovery reattaches only persisted bytes and evidence. The closed CompletionPackage preserves this meaning.

New tasks add a project-level binding and a stable branch in an external worktree. Developer retains read/edit/write; parent and Reviewer remain read-only. Tasks without a binding remain loadable and recoverable without implicit migration. This capability does not initialize empty repositories. New records preserve identities, refs and commits, without using absolute worktree paths as authority.

Commit identity comes from available Git configuration, without configuring it or impersonating a person. Host primitives construct validated argv and disable hooks, signing and autostash without changing permanent configuration. External filter/merge drivers are rejected. No remote commands are invoked. Branches and worktrees are retained for audit and recovery; no skill is introduced because this capability is host infrastructure.

COMPLETED means a verified candidate. The candidate commit freezes the result without updating the target. A worktree detached from current HEAD prepares an explicit two-parent merge. Conflicts or failed validations preserve evidence and leave the destination unchanged. The proposal binds HEAD, candidate, integration commit/tree, summary, validations and review; confirmation reuses the trusted boundary. Rejection and cancellation do not fail the task.

A durable intent precedes ref CAS and a verified index/worktree update under the Git index lock. Recovery checks intent, receipt, commit, ref, index and bytes before completing the same operation. Ambiguities remain blocked: no hard reset, rollback, stash or automatic resolution. The merge is not recalculated after approval.

The original folder remains the official project. Project Planning distinguishes execution from integration: new predecessors require the candidate commit in target history. No-op tasks require no artificial merge; cherry-picks or similar bytes do not prove identity. Historical tasks retain the previous baseline check.

Tests use real Git and processes; any provider/UI doubles are declared. The 11 states/43 transitions and CompletionPackage are unchanged. Integration Checkpoints, Greenfield, remotes and Systemist are outside this capability's scope.

If targetHead differs from B0, the task review does not demonstrate interaction with code added to the destination: the same controlled.reviewer receives an exact merge packet, criteria and new evidence, with fresh context, read-only access, closed output and terminal/transcript/canary proof. No IntegrationReviewer is created. If HEAD and tree match the candidate, the verified terminal review is reused.

Conservative limits: local refs within the validated ASCII profile; repositories without external drivers and with byte-exact checkouts. A dirty workspace, including ignored files, a different branch or Git operations in progress require explicit intervention. A stale intent or unprovable partial update remains blocked, without invented approval or file repair. Index reconciliation is permitted only when all bytes match the complete authorized tree. Workspace locks also serialize different targets in the same project, a stronger limit than the minimum project+targetRef. A no-op reuses B0 and needs no identity for a nonexistent commit. There is no automatic cleanup: evidence, worktrees and branches are retained locally.

The common host policy also covers the technical rework worktree: hooks and signing remain disabled, and new task branches use the configured Git identity for that temporary commit too. Only historical detached rework retains its preexisting explicit synthetic technical identity; it does not retroactively become a candidate/integration commit. An unfrozen candidate remains NOT_READY in the Git projection; the action separately verifies the COMPLETED ledger before preparing integration.
