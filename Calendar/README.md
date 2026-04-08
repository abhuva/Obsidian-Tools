# Calendar (Agent Guide)

Updated: 2026-04-08
Scope: `Tools/Calendar`

## What This Tool Does

Builds and serves a local FullCalendar view backed by Obsidian notes.

- Source of truth: Obsidian Base (`.base` view) and markdown event notes.
- Build output: `events.generated.js`
- Runtime UI: `cal.html` + `cal.app.js` + `cal.css`
- Local API server: `serve.mjs`

## Entry Points (Read These First)

1. `package.json` scripts (how to run/validate)
2. `build-events.mjs` (data extraction + event generation)
3. `serve.mjs` (preview server + write APIs)
4. `cal.app.js` (frontend behavior)
5. `task.md` (change history + pending manual actions)

## Quick Commands

From repository root:

```powershell
# Build local event bundle
npm.cmd --prefix .\Tools\Calendar run build:events

# Start preview (auto-stops prior preview process first)
npm.cmd --prefix .\Tools\Calendar run preview

# Stop preview
npm.cmd --prefix .\Tools\Calendar run stop:preview

# Smoke validation (syntax + build + generated-event checks)
npm.cmd --prefix .\Tools\Calendar run check:smoke
```

Open in browser/webviewer:

- `http://127.0.0.1:4173/cal.html`

## Configuration

Use `.env.local` for machine-specific secrets/settings.

Template: `.env.example`

Important vars:

- `CALENDAR_HOST` (default `127.0.0.1`)
- `CALENDAR_PORT` (default `4173`)
- `OBSIDIAN_VAULT_NAME`
- `OBSIDIAN_BASE_PATH` (default `6. Obsidian/Live/Kalender.base`)
- `OBSIDIAN_BASE_VIEW` (default `Tabelle`)
- `CALENDAR_INBOX_PATH` (default `6. Obsidian/Inbox`)
- `ALLOW_MARKDOWN_FALLBACK` (`true` to allow full vault markdown scan fallback)
- `GOOGLE_CALENDAR_API_KEY` / `GOOGLE_CALENDAR_IDS` (optional read-only Google events)

## Data Contract (Event Notes)

An event note must be tagged as event (`tags: [event]`, tags list, or inline `#event`).

Supported frontmatter keys:

- All-day: `startDate`, optional `endDate`
- Timed: `event_start`, optional `event_end`
- Display: `event_background` (`true`/`false`), `event_color`
- Location: `coordinates` (`lat, lng`)
- Recurrence:
  - `event_recurrence: weekly`
  - `event_recurrence_days`
  - `event_recurrence_interval`
  - `event_recurrence_count`
  - `event_recurrence_until`
  - `event_recurrence_exdates`
  - `event_recurrence_rdates`
  - `event_recurrence_exrule` (JSON text)

Recurrence exception note:

- For timed recurring events, `event_recurrence_exdates` are applied as datetime exclusions using the event's start time.
- For all-day recurring events, `event_recurrence_exdates` remain date-only exclusions.

## Runtime API (serve.mjs)

Read:

- `GET /api/ping`
- `GET /api/session`
- `GET /api/obsidian/theme`
- `GET /api/calendar/filters`
- `GET /api/google-calendar/config`
- `GET /api/google-calendar/events`
- `GET /api/events/preview` (`sourcePath` query param)

Write:

- `POST /api/events/update-dates`
- `POST /api/events/open-note`
- `POST /api/events/open-map`
- `POST /api/events/create`
- `POST /api/events/rebuild`

Write-route protections:

- JSON content-type required
- host/origin checks
- `X-Calendar-Token` required (from `GET /api/session`)

## Architecture Notes

- `cal.html` is now a shell file only (bootstrap cache + markup).
- `cal.app.js` contains frontend logic.
- `cal.css` contains styling.
- Event click behavior is configurable in Calendar settings:
  - enabled: show a compact cursor-near preview popover (title, date/time, first note block)
  - disabled: open note directly (legacy behavior)
- In preview popover, events with `coordinates` show a `map` button:
  - opens `6. Obsidian/Live/Kalender.base` in a new `bases` tab
  - switches to `Map` view
  - applies center/zoom to the event coordinates (best effort after map load)
- `lib/env.mjs` is shared by `build-events.mjs` and `serve.mjs`.
- Preview process PID is tracked in `calendar.preview.pid`.

## Runtime/Generated Files

- `events.generated.js` (generated)
- `calendar.filter-state.json` (local persisted filter)
- `calendar.preview.pid` (runtime)
- `preview.log` (optional runtime log)

## Troubleshooting

Port in use:

```powershell
npm.cmd --prefix .\Tools\Calendar run stop:preview
npm.cmd --prefix .\Tools\Calendar run preview
```

Base query failure:

- Default behavior: build fails.
- To permit fallback scan: set `ALLOW_MARKDOWN_FALLBACK=true`.

No Google events:

- verify `.env.local` keys
- verify calendar IDs are readable by API key

## Current Manual Follow-up

Rotate/revoke previously exposed Google API key and replace with a new key in local `.env.local` only.
