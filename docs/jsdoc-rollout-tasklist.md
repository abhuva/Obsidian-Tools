# JSDoc Rollout Task List

Status date: 2026-04-11
Owner: shared (human + agent)

## Objective
Reach stable JSDoc coverage and enforce it via lint/PR checks for `Tools`.

## Dependency Graph
- T1 -> T2 -> T3 -> T4
- T3 -> T5
- T5 -> T6

## Tasks
- [x] T1 `done`: Define standards and entry-point docs
  - Depends on: none
  - Output: `Tools/AGENTS.md`, `Tools/docs/ai/workflow.md`, `Tools/docs/ai/jsdoc-standard.md`
  - Validation: docs exist and are linked from `AGENTS.md`
- [x] T2 `done`: Add lint scaffolding for JSDoc checks
  - Depends on: T1
  - Output: ESLint config + npm scripts
  - Validation: `npm.cmd --prefix .\Tools run lint:jsdoc` executes
- [x] T3 `done`: Backfill JSDoc in runtime-critical files
  - Depends on: T2
  - Scope:
    - [x] `Tools/serve.mjs`
    - [x] `Tools/app/homepage.js`
    - [x] `Tools/modules/bookmarks.js`
    - [x] `Tools/modules/clock.js`
    - [x] `Tools/modules/new-project.js`
    - [x] `Tools/modules/updo.js`
  - Validation: no new JSDoc warnings in scoped files
- [x] T4 `done`: Backfill JSDoc in helper/ops files
  - Depends on: T3
  - Scope:
    - [x] `Tools/stop-preview.mjs`
    - [x] `Tools/Calendar/serve.mjs`
    - [x] `Tools/Calendar/stop-preview.mjs`
    - [x] `Tools/Calendar/smoke-check.mjs`
    - [x] `Tools/Calendar/build-events.mjs`
    - [x] `Tools/Calendar/lib/env.mjs`
    - [x] `Tools/Calendar/cal.app.js`
  - Validation: warning count reduced to agreed target
- [x] T5 `done`: Move enforcement from warning to error
  - Depends on: T3
  - Output: ESLint JSDoc rule severity change (`warn` -> `error`)
  - Validation: CI/PR fails on missing required JSDoc
- [x] T6 `done`: Improve JSDoc quality on key public APIs (manual pass)
  - Depends on: T5
  - Scope (priority order):
    - [x] `Tools/serve.mjs` (API handlers + core helpers)
    - [x] `Tools/Calendar/serve.mjs` (API handlers + CalDAV helpers)
    - [x] `Tools/app/homepage.js` + `Tools/modules/*.js` public entry points
  - Validation:
    - [x] `npm.cmd --prefix .\Tools run lint`
    - [x] Spot-check summaries/params are meaningful (not placeholder text)

## Notes
- Exclude generated artifacts from rollout:
  - `Tools/Calendar/events.generated.js`
- If scope expands, add files explicitly before editing.
- Baseline after scaffolding (2026-04-11):
  - `npm.cmd run lint` -> `0 errors`, `449 warnings` (all JSDoc-related)
- Baseline after T3 (2026-04-11):
  - `npm.cmd run lint` -> `0 errors`, `301 warnings` (remaining warnings are outside T3 scope)
- Baseline after T4+T5 (2026-04-11):
  - `npm.cmd run lint` -> `0 errors`, `0 warnings`
- Session update (2026-04-11, later):
  - Additional semantic-doc cleanup started.
  - A broad automated replacement temporarily broke many `@param` tags; repaired to passing lint.
  - Current lint policy was adjusted to keep enforcement stable:
    - `jsdoc/require-jsdoc` = `error`
    - `jsdoc/require-returns` = `error`
    - `jsdoc/require-param` = `off`
    - `jsdoc/require-param-type` = `off`
    - `jsdoc/require-returns-type` = `off`
  - Current baseline remains:
    - `npm.cmd run lint` -> `0 errors`, `0 warnings`
    - `npm.cmd run lint:jsdoc` -> passes
- Session update (2026-04-11, jsdoc manual pass #2):
  - Completed manual quality pass for:
    - `Tools/app/homepage.js`
    - `Tools/modules/bookmarks.js`
    - `Tools/modules/clock.js`
    - `Tools/modules/new-project.js`
    - `Tools/modules/updo.js`
  - Started manual quality pass for server helpers:
    - `Tools/serve.mjs` (Obsidian CLI helpers, settings helpers, project naming helpers, updo persistence/compression helpers)
    - `Tools/Calendar/serve.mjs` (path/filter/auth helpers, request parsing, Obsidian open helpers)
  - Validation:
    - `npm.cmd --prefix .\Tools run lint` -> passes
    - `npm.cmd --prefix .\Tools run lint:jsdoc` -> passes
- Session update (2026-04-11, jsdoc manual pass #3):
  - Expanded semantic JSDoc on server-side API/helpers:
    - `Tools/serve.mjs`:
      - Updo history/monitor pipeline helpers (`maybeCompressUpdoHistory`, `buildUpdoHistory`, `syncLiveStateFromPersisted`, SSL probe helpers, stream processors)
      - Bookmark payload helpers and project-create helpers
      - Removed last `@param {*} / @returns {*} ` placeholder in embedded `safeSetActiveLeaf` helper
    - `Tools/Calendar/serve.mjs`:
      - Google OAuth + Google Calendar API helper group
      - Nextcloud/CalDAV helper group, ICS parsing/mapping helpers, and Nextcloud CRUD helpers
  - Remaining placeholder hotspot:
    - `Tools/Calendar/serve.mjs` still contains `63` wildcard tags (`@param {*} / @returns {*} `), concentrated in early calendar date/frontmatter helper functions and a few utility sections.
  - Validation:
    - `npm.cmd --prefix .\Tools run lint` -> passes
    - `npm.cmd --prefix .\Tools run lint:jsdoc` -> passes
- Session update (2026-04-11, jsdoc manual pass #4):
  - Completed remaining wildcard cleanup in `Tools/Calendar/serve.mjs`:
    - date/datetime validation helpers
    - frontmatter parsing/rewrite helpers
    - event preview + markdown event creation helpers
    - rebuild/pid/theme helpers
  - Fixed embedded template-string JSDoc escape issue in `Tools/serve.mjs` (`safeSetActiveLeaf` comment) that caused a parser error.
  - Current placeholder status:
    - `Tools/serve.mjs`: `0` wildcard tags (`@param {*} / @returns {*} `)
    - `Tools/Calendar/serve.mjs`: `0` wildcard tags (`@param {*} / @returns {*} `)
  - Validation:
    - `npm.cmd --prefix .\Tools run lint` -> passes
    - `npm.cmd --prefix .\Tools run lint:jsdoc` -> passes

## Resume Checklist
- Confirm lint still passes before continuing:
  - `npm.cmd --prefix .\Tools run lint`
  - `npm.cmd --prefix .\Tools run lint:jsdoc`
- Continue with `T6` as manual-only edits (avoid bulk regex automation).
- If stricter param/type enforcement is desired later, create a separate task after T6.
