# Historical package evidence

**English** · [Italiano](it/HISTORICAL-EVIDENCE.md)

The public repository starts from a selected source snapshot prepared on 18 October 2026. Earlier development history and evidence from real executions remain intact in the author's local archives and are not distributed.

The archives include reviewer/recovery and runtime/observability checks, the former PDF manual, the retired wizard and earlier tests. Originals retain their bytes, dates, results and hashes. Public documentation omits personal paths and local identifiers; translating the documentation does not change the protocol contracts or rewrite historical evidence.

These archives are neither package dependencies nor prerequisites for portable tests. Historical results do not certify the current revision: see [VALIDATION.md](VALIDATION.md).

Proposal, correction, clarification and refusal cases from the retired wizard are covered through the current entry point in `test/current-project.test.mjs`. Bootstrap, promotion and checkpoint coverage remains in `test/greenfield-bootstrap.test.mjs` and `test/greenfield-e2e.test.mjs`.

The optional `test/recovery-historical.test.mjs` probe requires an external archive explicitly supplied through `P16A_HISTORICAL_DATA_ROOT`. It is outside `npm test` and does not require public disclosure of real project data.
