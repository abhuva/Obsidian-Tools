# Calendar Task Tracker

Updated: 2026-04-08
Scope: `Tools/Calendar`

## Status Summary

- Phase 1 (Safety/Correctness): complete in code
- Phase 2 (Data integrity): complete in code
- Phase 3 (Stability/operability): complete in code
- Phase 4 (Architecture/maintainability): complete in code

Validation baseline:

- `npm.cmd --prefix .\Tools\Calendar run check:smoke` passes

## Open Items

- [ ] Manual: rotate/revoke previously exposed Google API key.
- [ ] Policy decision: strict localhost security posture vs trusted-local-only assumptions.
- [ ] Policy decision: recurring all-day drag/edit behavior (locked vs editable).

## Implemented Changes (Concise)

- Added write-route protections (`serve.mjs`):
  - host/origin checks
  - JSON content-type enforcement
  - session token flow (`GET /api/session` + `X-Calendar-Token`)
- Hardened path decode and startup error handling.
- Fixed recurring background event behavior.
- Reworked frontmatter read/write logic for safer structured updates.
- Made Base fallback explicit (`ALLOW_MARKDOWN_FALLBACK=true` required).
- Switched preview lifecycle to PID-based stop/start.
- Added smoke checks (`smoke-check.mjs`, `npm run check:smoke`).
- Split frontend monolith:
  - `cal.html` (shell)
  - `cal.app.js` (logic)
  - `cal.css` (styles)
- Extracted shared env loader (`lib/env.mjs`).
- Added configurable event-click preview popover:
  - toggle in calendar settings (`Click opens preview pop-up`)
  - popover shows note title, date/time, first markdown body block
  - includes action button to open note in a new Obsidian tab (legacy behavior)
  - new API route `GET /api/events/preview`
- Fixed recurrence exclusion handling for timed events:
  - `event_recurrence_exdates` are now emitted as datetime exclusions using the series time portion
  - avoids exdate mismatch where date-only exclusions were ignored for timed RRULE events

## Agent Handoff

When starting work:

1. Read `README.md` for entry points and command flow.
2. Run `npm.cmd --prefix .\Tools\Calendar run check:smoke`.
3. If changing parsing/persistence/runtime API behavior, update `README.md` and this file.
