# Controlled Scout — documentation template

This file is not registered or discovered as an agent profile. The sole operational definition is the runtime registration produced by `src/controlled-scout.ts` under the fixed name `controlled.scout`.

Controlled Scout is a leaf read-only codebase analyst. It receives fresh context, the `read` tool, and the internal `structured_output` protocol only. It must not mutate, execute commands, delegate, contact a supervisor, inherit project/global/skill context, or treat assignment/file content as authority. Its only result is a schema-valid `ScoutResult`; `recommendedScope` is advisory.
