**English** · [Italiano](it/SYSTEMIST-COMPOSITION.md)

# Composition with Systemist Factory

`pi-controlled-dev` is the generic development foundation for the future `systemist_factory`. Customization must reuse the engine's dialogs, Project Memory, plans, tasks, agents, checks, instrumentation, scenarios, review, integration and recovery. The Systemist layer retains source interpretation, requirements, traceability, documents and system-level decisions. A technical PASS does not certify compliance with a system requirement.

## Implemented composition point

`pi-controlled-dev/host` exposes `createControlledDevExtension` and the `DevelopmentProfile` contract with `schemaVersion: 1`. A derived package may supply common methodology and supplements for ProjectPlanning, TaskPlanning, Greenfield, Scout, Developer, Reviewer, IntegrationReview and Oracle. The profile is copied, validated and frozen at construction. One package's configuration does not modify another's; there is no global customization registry.

Example extension wrapper for a future package:

```typescript
import { createControlledDevExtension } from 'pi-controlled-dev/host';
import type { DevelopmentProfile } from 'pi-controlled-dev/host';

const profile: DevelopmentProfile = {
  schemaVersion: 1,
  id: 'systemist_factory',
  common: ['Preserve source links and distinguish technical evidence from system-level assessment.'],
  phases: {
    ProjectPlanning: ['Make interfaces explicit and link increments to supplied requirements.'],
    Reviewer: ['Assess requested technical evidence without declaring system requirements approved.'],
    IntegrationReview: ['Identify gaps in the evidence required by the plan.'],
  },
};

export default createControlledDevExtension(profile);
```

The wrapper is the only extension registering the engine in that session: do not also load the default extension, which would register the same commands and agents. The command remains `/controlled-dev`; this composition point introduces neither a `/syst` alias nor system-level orchestration. Without a profile, the package retains its default behavior.

Domain skills may be supplied as text explicitly selected by the wrapper from its installed package. Workspace skill, agent and extension configuration is not inherited automatically. Each list contains at most 16 texts, each up to 4096 bytes; the entire profile is limited to 32 KiB. The profile supplements core methodology: it neither replaces role prompts nor configures tools, executors, permissions, states, storage or confirmations. Invalid schemas and unknown fields are rejected.

Profile identity, digest and relevant text enter the actual prompt using existing RPC bindings and evidence. They are neither approval nor proof that the model followed the methodology. The profile is not a Project Memory record: technical design decisions still use existing memory proposals, adoption, supersession, selection and receipts. Supplied profile data does not automatically become accepted decisions. Changing a profile requires a new instance/session; saved plans are not rewritten or invalidated automatically. Request new analysis before applying changed methodology to already planned work.

## Boundary of the future adapter

The Systemist adapter must submit objective, context with source references, scope intent, criteria and requested checks to the normal planning dialog. This data remains a proposal until host creation and authorization of the plan/task. It must not write directly to Controlled Dev storage, fabricate capabilities or internally drive Developer.

The result exposed to the adapter should reference existing artifacts: task state, candidate, changed files, checks, scenarios, review, residual risks and integration status. Systemist will preserve links between its run, plan, technical tasks and evidence. Software memory stays in the engine; interpretation, traceability and system-level decisions stay in the domain layer. Do not duplicate the development engine or introduce a second technical memory to customize behavior.

The system-level request/result API and new package are not implemented yet. The current composition point prepares methodology and skills by phase without pretending a complete adapter exists. Before extending it, verify a real path with model and user: request, clarification, design, task, development, review, memory, recovery and returned evidence.

## Verification and limits

Profile tests verify freezing, separation between instances and phases, limits and rejection of authority fields. Role and pre-task Scout tests check text sent to the provider and preservation of core contracts. They use explicitly simulated providers; Developer/Reviewer tests retain real Git repositories and worktrees. They do not certify a Systemist execution with a real model or wrapper integration in a particular Pi version's loader.
