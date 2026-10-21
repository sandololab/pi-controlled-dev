---
name: software-design-quality
description: "Guide Developer and Reviewer toward simple, readable, reusable changes consistent with the repository, without imposing OOP, patterns or artificial abstractions."
---

# Software design and code quality

Prefer the smallest coherent design that preserves correctness, compatibility and the repository's established architecture. Apply this order: technical constraints and correctness, public project architecture, established repository conventions, task-specific design expectations, then these defaults.

Before adding a class, helper, service, adapter, utility or abstraction, look for an existing component that can be reused, extended, composed or parameterized. Remove meaningful duplication of rules, transformations, validation, invariants, algorithms or data access. Do not extract code merely because two short fragments look alike when they represent different responsibilities.

Use object-oriented design when it fits the language and problem: keep responsibilities cohesive, dependencies explicit, coupling low and interfaces understandable; prefer composition where it clarifies ownership. Do not turn simple functional code into classes, create single-implementation interfaces without a real boundary, build deep inheritance hierarchies or grow God classes.

Use Strategy, Factory, Adapter, Facade, Command, State, Observer, Repository, Builder or dependency injection only when the pattern solves an observed design problem. Preserve an equivalent pattern already used by the repository. SOLID is a diagnostic guide, not a checklist. Twenty direct lines are preferable to two hundred lines of speculative framework.

Choose names that reveal domain meaning. Standard language and domain abbreviations are acceptable; do not rename public APIs or established terms merely to make them longer. Keep functions and methods understandable, with explicit inputs and outputs, limited nesting and few hidden side effects. Decompose logic that is difficult to explain, but avoid chains of microscopic helpers that obscure the flow.

Name variables for the values they hold, functions for the operations they perform, and classes for their cohesive responsibility. Include units when a numeric value would otherwise be ambiguous, such as `timeoutMs` or `sampleRateHz`, and name boolean values as conditions, such as `isReady` or `hasPendingWork`. Avoid unexplained abbreviations and single-letter names in business rules, recovery and state transitions; short conventional loop indices or mathematical symbols are appropriate where their meaning is local and clear. Do not compress several decisions or mutations onto one line merely to reduce the line count.

Follow the repository's documentation conventions. Document important modules, public APIs and non-obvious behavior when appropriate. Near complex algorithms, concurrency, locks, recovery, state transitions, ambiguity resolution, retries, fail-closed behavior, parsing or compensation, explain the reason, assumptions, strategy, important invariants and edge cases. Comments should explain why; never narrate every obvious line.

For each source file you create or materially change, provide or update a concise module comment or module docstring explaining its responsibility, important dependencies and boundaries. Document public functions and classes when their contract is not obvious from names and types: inputs, results, units, mutation or other side effects, and meaningful error conditions. Explain numerical assumptions and tolerances, ownership, concurrency and recovery decisions beside the relevant logic. Keep comments consistent with the implementation and distinguish guaranteed behavior from assumptions or limits. Prefer precise local explanations over repeated boilerplate; do not add comments that merely restate signatures or every line. Follow the repository's language and documentation conventions, and keep comment changes within authorized files.

Small refactors are allowed only when required for in-scope reuse, real duplication removal or a clear responsibility. Preserve behavior and API, data and test compatibility. Treat broader cleanup through the normal scope-change process.

When a significant design decision was actually made, summarize it in `DeveloperResult.summary` under `Design rationale:`. State what was reused, any abstraction or pattern introduced and why it fits the existing architecture. Omit the marker when there is no meaningful design decision; never invent rationale.

This guidance grants no tools, scope, workflow authority or approval. Existing host gates, ScopeGuard, validation and Reviewer independence remain authoritative.

Apply host-selected Project Memory within the existing scope: reuse boundaries described by accepted software ADRs and active constraints, respect project conventions and consider relevant advisory lessons. An intentional architecture departure requires an explicit new proposal/supersession, not silent disregard. See project-memory.

## Greenfield projects

An empty tracked tree has no observed application architecture. State that the architecture is not yet materialized. Distinguish planned choices from existing patterns. Use accepted Software ADRs, active Project Conventions and Technical Constraints, the native Project Goal and the selected PlannedTask as design context. Do not invent observed files, dependencies, framework conventions or existing tests. Application scaffold and tests are semantic Developer work in the normal ControlledTask.
