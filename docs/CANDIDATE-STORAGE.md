**English** · [Italiano](it/CANDIDATE-STORAGE.md)

# Smaller saved copies

A candidate snapshot still describes its complete file tree. New snapshots share
payload files by SHA-256 under `.controlled-dev/candidates/.objects`. Each
candidate keeps its original canonical manifest and a small `storage.json`
marker. A restore needs that manifest and its referenced shared payloads; it does
not need an earlier candidate or a chain of changes. File contents, modes and
manifest digests retain their original meaning.

This is the same storage principle used for repeated history in
pi-editorial-factory, applied here to source trees and assets. It does not copy
that package's checkpoint rotation: candidate evidence and task history have
different retention obligations. There is no automatic deletion of old
candidate manifests, journal records, unknown files or unreferenced objects.

## Convert existing copies

Close Pi normally at a safe point, then reopen the project with this package.
Before resuming its task, choose **Reduce duplicate saved copies** in
`/controlled-dev menu`, or use `/controlled-dev project reduce-storage`.
The package requires a released project and a real workspace lease. It checks
existing copies, presents counts and estimated savings, and asks for native
confirmation of that exact inventory. Cancelling leaves the project namespace
and its transfer checkpoint unchanged. No model is called.

The status distinguishes verification, shared-content writes, duplicate cleanup
and final transfer verification. Alt+I requests a pause after the current file;
a file already being written finishes first. A large initial namespace check
and final transfer seal remain synchronous and may take time. During conversion,
source data is removed only after its shared copy is durable and its hash is
verified. A paused conversion remains readable, is sealed for transfer, and
requires a fresh inventory and confirmation to continue. Lease loss, unexpected
files or corruption stop cleanup and preserve the remaining originals; preserve
all files and inspect the reported error before retrying.

The diagnostic report is saved in the existing planning artifact archive. It
records actual removed files and bytes, elapsed conversion time, native receipt
and zero provider calls. Removed old bytes differ from net savings when new
shared content had to be written. This does not alter task state, accepted
results, checks, history or consumed attempts.

## Compatibility and transfer

The reader accepts both legacy independent copies and shared snapshots. Shared
snapshots require **0.1.0-beta.3 or later**; earlier package versions cannot read
them. Install the compatible package before resuming on another machine.
Transfer the entire project, including `.git`, `.controlled-dev` (especially
`candidates/.objects`) and `Documentazione`. An individual manifest folder is
not a portable archive by itself. Credentials and running processes remain
machine-local. Imported tasks still need the normal local checks and native
resume confirmation.

Restore verifies every referenced payload. After Git checks out the baseline,
byte-identical files are kept instead of rewritten; the final complete manifest
is still verified. Sharing reduces retained disk copies, while verification of
large trees can remain costly. It does not imply faster model responses or
certify the unfinished refactor.

A normal close reuses an already released checkpoint only after the exact current namespace, source commit and task heads have been verified. Merely viewing a project or finishing storage maintenance does not require recreating every saved candidate. Changes to personal notes still require a new checkpoint.

## A saved candidate after Pi terminates unexpectedly

**Resume transferred project** also checks an imported task interrupted during
verification when its complete candidate and current state were already sealed.
It verifies the ended Pi process, the exact old permission pair, the original
import journal and accepted binding, every saved model result, and the complete
saved checkpoint. Missing, changed or incomplete evidence stops this path.

The first native proposal closes only the dead local permissions and preserves
the exact saved data for transfer. It does not resume the old working folder or
claim that an old host command has terminated. The old folder may be unavailable:
recovery reads the saved snapshot. A second confirmation restores a separate
copy, preserves all consumed attempts and invalidates old checks before new
verification and review. No model starts from the data-release decision alone.

Recovery in the same working folder remains conservative when host-process
termination is unproven. An ambiguous execution is not a suggestion to guess a
repair outcome. Use the project resume path to review a concrete verified
proposal; preserve all evidence if that proposal cannot be prepared.
