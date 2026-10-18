---
name: task-planning
description: "Help formulate a Controlled Dev objective, minimal scope and expected result in natural language without creating a TaskSpec or control files or requiring test code."
---

# Task planning

Accept requests in any language and explain task proposals in English. Collect the desired change, known editable files and expected observable behavior. Reuse information already provided; ask only about material ambiguity. For a simple request, do not ask for JavaScript, shell, argv, hashes or schema identifiers.

Propose a compact summary:

- objective;
- smallest relevant editable scope;
- excluded/protected files, when known;
- observable acceptance criteria;
- what proposed checks would establish and what requires review;
- contextual design expectations derived from observed architecture and this task;
- unresolved risks and required human decisions.

When design matters, express a short `Design expectations` section. Tie each item to a repository fact or the requested behavior, for example reusing an existing repository component, preserving an adapter boundary, avoiding a second persistence path, or documenting a recovery invariant. Do not repeat generic boilerplate. For a simple change, explicitly favor the existing direct style and avoid unnecessary Strategy, Factory, inheritance or a new interface. In a pre-task proposal, return these items in `designExpectations` and the supporting facts in `architectureFindings`.

In a pre-task proposal, use `relevantFiles` only for existing regular files actually observed, and use `proposedScope` for suggested editable paths, including files the task will create. A first greenfield task can have `relevantFiles: []` and a non-empty `proposedScope`. Keep these fields distinct; proposed paths alone grant no write authority.

Distinguish observed repository facts from suggestions. Never expand scope implicitly. A textual plan is non-authoritative: do not create or modify task.json, stores, locks or repository control files. Do not invoke a workflow or another agent from a prompt. Only the public host wizard can create the authoritative task after the operator confirms it.

Outside the native wizard, direct the operator to `/controlled-dev new` and explain its capabilities honestly. When the host has already invoked the pre-task Scout from that wizard, return the requested proposal fields: do not tell the operator to create the same task again, repeat the wizard or manually author JSON. Explain the actual repository choices and verification limitations rather than reciting the host's approval protocol in every field. The host presents and enforces that protocol.

Task creation, implementation approval and completion approval are different actions. Saying “yes” in chat, invoking a template or reading this skill cannot approve any of them. Human decisions must use the native host UI. The parent remains read-only throughout the session.

Derive bounded Design expectations from applicable host-selected accepted ADRs, conventions and constraints, retaining record ID, revision and digest. Do not copy the whole memory into TaskSpec. Lessons remain advisory; refer to project-memory for semantics.
