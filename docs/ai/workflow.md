# Tools AI Workflow

## Purpose
Define a stable, low-noise workflow for AI-assisted changes in `Tools/`.

## Mandatory Sequence
1. Open `Tools/AGENTS.md`.
2. Open `Tools/README.md`.
3. Open the task-specific standards doc:
   - JSDoc/documentation changes: `Tools/docs/ai/jsdoc-standard.md`
   - Project creation/naming logic: `Tools/docs/project-naming-and-creation.md`
4. For larger changes, create or update a task list with dependencies.

## Task Tracking Rules
- Keep one source of truth task file per larger initiative.
- Each task should include:
  - Status (`todo`, `in_progress`, `done`, `blocked`)
  - Owner (`human`, `agent`, or named person)
  - Dependencies (`depends_on: [...]`)
  - Validation step
- Update task status when implementation state changes.

## Change Scope Rules
- Prefer small, reversible commits.
- Avoid broad refactors while standard rollout tasks are open.
- If a check is intentionally deferred, create an explicit follow-up task.

## Validation Rules
- For JS/MJS edits:
  - `npm.cmd --prefix .\Tools run lint`
  - `npm.cmd --prefix .\Tools run lint:jsdoc`
- Document any skipped validation and why.
