# Validation status

**English** · [Italiano](it/VALIDATION.md)

This is a development beta. The failures recorded during the initial publication have been investigated and corrected. Historical campaign reports and current automated checks describe different revisions.

## Current verification — 18 October 2026

Final verification covers **1,305 distinct portable cases: 1,303 passed, 0 remaining failures, 2 default skips**, across a complete run and a final affected-suite rerun. The complete run itself recorded **1,302 passed, 1 failed, 2 skipped**. Its only failure came from a directory-substitution fixture that deleted and recreated a folder: the filesystem could reuse the same inode. The fixture now retains the original directory outside the worktree and asserts a distinct replacement; the complete Scope Guard suite then passed **13/13**. No runtime code changed after the complete run. This is combined coverage, not a claim of a single clean full run. TypeScript checking, package inventory, English-language checks and an isolated native Pi install/reinstall probe also passed. The probe verifies one extension, 12 skills and 3 prompts, and confirms that headless use cannot bypass the native confirmation.

Verified on Linux with Node.js 22.22.1, npm 9.2.0, TypeScript 5.9.3 and native Pi 1.3.0.

The higher total reflects suites that previously stopped during import and now execute their individual cases. The full run uses every portable test file listed in `npm test`, with eight isolated file workers. Each check uses synthetic fixtures, unique temporary folders and a separate Pi profile. The default `npm test` command runs the same files serially.

The two tests skipped by default require `CONTROLLED_DEV_TEST_SSD`. They were also run separately against the actual SSD test area: **2/2 passed**. This checks file bytes, destination mode policy and rollback while preserving personal Notes. It does not certify another operating system or a real-model workflow on a second computer.

## Corrections

- Contract validation now depends on the pure `runtime-root-mapping` module. The operational root-binding verifier still checks retained artifacts, transcripts and terminal proofs before recording a process-local mapping. Contract tests keep their bounded import list and prohibit filesystem, RPC and timer dependencies.
- Orderly project shutdown now preserves the verified baseline of a Developer stopped without effects. Repeated transfers retain the original evidence bytes and counter history. Recovery evidence is bound to the current runtime import; a retired READY authorization requires a new native confirmation before one new attempt can start.
- Missing task-local autonomy artifacts produce the existing typed integrity error. A historical artifact identity remains readable without migration or replacement.
- Canceling before analysis avoids creating an investigation store. Session replacement cannot publish an executable task. Already recorded read-only investigation evidence remains available, and synthetic sensitive input is checked for absence from persisted files.
- Integration fixtures now start from a valid module and passing adopted checks. The checkpoint's exact-content criteria still require the implemented components. The RPC double reads the canonical packet independently of appended role guidance.
- Tests now exercise the current English labels and consumed gate references. Scout cancellation waits for actual dispatch before canceling; viewport checks account for native Pi controls; independent failure cases use separate investigation budgets. Tests await asynchronous session shutdown before removing their fixtures. Real blockers are checked before READY admission.

These changes preserve scope enforcement, mandatory validation, independent review, human confirmation and retry limits. No real-model acceptance campaign is claimed for this revision. Installation/loader checks use an isolated native Pi profile and deterministic test responses.

## Preserved history

The earlier complete baseline before localization recorded **1,055 tests: 1,015 passed, 38 failed, 2 skipped**. Later diagnostic attempts and targeted reruns are retained together with the final verification logs, source hashes and publication commit in the author's external evidence archive. Those originals have not been rewritten to show a later success. Raw sessions, credentials and machine-specific logs are excluded from the public package.

The P15 and P16C reports remain historical reports. Their earlier PASS results do not replace the current checks above.

## Reproduce

Use Linux, Node.js >=22.19.0, npm and Git:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack --dry-run --ignore-scripts
```

`test/product-install.test.mjs`, `test/recovery-historical.test.mjs` and `npm run test:pi-integration` need explicit external inputs/installations. They are outside the portable suite; see the README and the corresponding test files. The repository remains `UNLICENSED` and npm publication remains disabled.
