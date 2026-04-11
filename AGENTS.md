# Agent Entry Point (Tools)

This file is the mandatory starting point for any work in `Tools/`.
Use it as a compact index. Keep details in specialized docs.

## Startup Protocol (Mandatory)
1. Read this file first.
2. Read `Tools/README.md` for runtime architecture and commands.
3. Read task-specific docs from the index below before editing.
4. For larger changes, track work in `Tools/docs/jsdoc-rollout-tasklist.md` (or an equivalent scoped task list).

## Documentation Index
- Architecture and runtime:
  - `Tools/README.md`
  - `Tools/ARCHITECTURE.md`
- Standards for AI/code changes:
  - `Tools/docs/ai/workflow.md`
  - `Tools/docs/ai/jsdoc-standard.md`
- Existing domain docs:
  - `Tools/docs/project-naming-and-creation.md`
- Current rollout tracker:
  - `Tools/docs/jsdoc-rollout-tasklist.md`

## Branching and PR Workflow (Mandatory)
- Never make direct code changes on `master` (or `main`).
- Always create a feature branch for every change.
- Do not open a pull request after every commit automatically.
- Open a pull request only when a larger task is complete, or when the user explicitly requests it.
- Always ask the user for confirmation before creating a pull request.
- Keep this workflow so CodeRabbit (and other PR checks) can run.

## Quality Gates (Mandatory for JS/MJS changes)
- Run `npm.cmd --prefix .\Tools run lint` for baseline lint checks.
- Run `npm.cmd --prefix .\Tools run lint:jsdoc` for doc coverage checks.
- If JSDoc warnings are introduced, either fix them in the same change or update the rollout tasklist with explicit follow-up tasks.
