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
- Added day/week density controls:
  - settings slider for `Day/week row height`
  - compact mode styling for low row heights
  - `scrollTime` default changed to `08:00:00` for timeGrid views
- Added Nextcloud CalDAV source (3rd source next to md + Google):
  - read + create/update/delete endpoints in `serve.mjs`
  - source toggles in Calendar settings
  - event creation target option in create modal
  - per-Nextcloud-calendar visibility toggles in settings (persisted)
  - env keys in `.env.example` and `.env.local` support multiple calendars via `NEXTCLOUD_CALDAV_CALENDARS`
- Hardened Nextcloud config parsing:
  - invalid calendar/base URLs no longer crash preview server
- Reworked create-event modal UI:
  - switched from 3 create buttons to 3 tabs (`md`, `google`, `nextcloud`)
  - Google tab now includes color chooser derived from loaded Google event colors
  - Nextcloud tab now includes radio selection for available configured calendars
- Fixed Nextcloud recurring event rendering:
  - parser now reads `RRULE`, `EXDATE`, and `RECURRENCE-ID` from ICS
  - recurring events are emitted as FullCalendar recurrence events (instead of single-instance only)
  - override recurrence IDs are merged into exclusions to avoid duplicates
  - recurring Nextcloud events are marked read-only in UI
- Toolbar UX polish:
  - reduced base filter dropdown width in header toolbar
  - added dedicated `G` and `N` toolbar toggle buttons for Google/Nextcloud visibility
  - toolbar toggle state stays in sync with settings toggles
- Settings cleanup:
  - removed "Show Google events" and "Show Nextcloud events" toggles from settings popover
  - source visibility is now controlled from toolbar toggle buttons

## Agent Handoff

When starting work:

1. Read `README.md` for entry points and command flow.
2. Run `npm.cmd --prefix .\Tools\Calendar run check:smoke`.
3. If changing parsing/persistence/runtime API behavior, update `README.md` and this file.
