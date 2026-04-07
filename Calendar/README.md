# FullCalendar + Obsidian Events (Demo)

This demo generates a JS file that FullCalendar can render.

## Data source logic

`build-events.mjs` first queries your Obsidian Base:

- base file: `6. Obsidian/Live/Kalender.base`
- view: `Tabelle`

If Base query is not available, it falls back to scanning markdown files for:

- event tag (`tags: [event]`, tags list, or inline `#event`)
- frontmatter dates `startDate` and optional `endDate`
- optional color from frontmatter: `event_color` (fallback also accepts `eventColor` or `color`)
- optional background rendering flag: `event_background` (`true`/`false`, fallback also accepts `eventBackground`)
- optional weekly recurrence (RRule-based):
  - `event_recurrence: weekly`
  - `event_recurrence_days: [0..6]` (0 = Sunday)
  - optional `event_recurrence_count: <number>`
  - optional `event_recurrence_until: YYYY-MM-DD` (inclusive in frontmatter)
  - optional `event_recurrence_interval` (every N weeks)
  - optional `event_recurrence_exdates: [YYYY-MM-DD, ...]` for skipped occurrences
  - optional `event_recurrence_rdates: [YYYY-MM-DD, ...]` for added/moved occurrences
- optional `event_recurrence_exrule` (JSON string, advanced)

## Base filter bookmarks

Calendar Base filters are discovered from Obsidian bookmarks:

- file: `.obsidian/bookmarks.json`
- folder/group title: `Kalendar Bases`
- supported bookmark type: `file` entries ending in `.base`

In `cal.html`, a filter dropdown appears next to the `Refresh` button.
When you change the filter, the app calls `POST /api/events/rebuild` with that base path/view,
rebuilds `events.generated.js`, and reloads the calendar.

Example frontmatter:

```yaml
---
title: "Team Meeting"
startDate: 2026-04-06
endDate: 2026-04-06
event_background: false
event_color: "#0f766e"
event_recurrence: weekly
event_recurrence_days: [1, 3]
event_recurrence_until: 2026-12-31
event_recurrence_interval: 1
event_recurrence_exdates: [2026-05-04, 2026-05-06]
tags:
  - event
---
```

Note: `#` comments are valid YAML, but Obsidian frontmatter/properties workflows can rewrite frontmatter. For stability, examples here avoid YAML comments.

RRule notes:
- `event_recurrence_exdates` is the easiest way to model irregular gaps in an otherwise regular series.
- `event_recurrence_exrule` allows advanced exclusion rules; store it as JSON text in frontmatter.

## Generate calendar events

Run from repository root:

```powershell
npm.cmd --prefix .\Tools\Calendar run build:events
```

This writes `Tools/Calendar/events.generated.js`.

Optional overrides:

```powershell
$env:OBSIDIAN_BASE_PATH='6. Obsidian/Live/Kalender.base'
$env:OBSIDIAN_BASE_VIEW='Tabelle'
npm.cmd --prefix .\Tools\Calendar run build:events
```

## View

### Browser directly

Open `Tools/Calendar/cal.html` in Chrome (works for quick checks).

### Obsidian Webviewer (recommended)

Obsidian webviewer does not reliably render local `file://` pages.
Use a local HTTP server instead:

```powershell
npm.cmd --prefix .\Tools\Calendar run preview
```

Then open in Obsidian webviewer:

```powershell
obsidian web url="http://127.0.0.1:4173/cal.html"
```

This is the same pattern as Fava (local server + webviewer).

### Stop / restart preview server

Stop server on default port (`4173`):

```powershell
npm.cmd --prefix .\Tools\Calendar run stop:preview
```

Restart (stop + start):

```powershell
npm.cmd --prefix .\Tools\Calendar run restart:preview
```

If you use a custom port, set it first:

```powershell
$env:CALENDAR_PORT=4180
npm.cmd --prefix .\Tools\Calendar run stop:preview
npm.cmd --prefix .\Tools\Calendar run preview
```

`cal.html` loads:

1. FullCalendar from CDN
2. `events.generated.js` from local folder

## UI theming (mirror Obsidian)

Calendar now mirrors the active Obsidian theme colors when running via preview server.

- frontend fetches `GET /api/obsidian/theme`
- server reads Obsidian CSS vars via `obsidian eval`
- `cal.html` maps those values to Calendar and FullCalendar CSS tokens
- if mirroring fails, built-in calendar defaults remain active

For first paint, the last successful theme mapping is cached in `localStorage`:

- key: `calendar-theme-bootstrap-v1`

Important:

- mirror theming requires HTTP preview (`npm.cmd --prefix .\Tools\Calendar run preview`)
- `file://` mode cannot call the API endpoint

Planned later (Option 3):

- we want to extract/shared theme utilities between Homepage and Calendar, so theme snapshot/mapping logic is not duplicated across both tools.

## Render/Class hooks (current behavior)

`cal.html` currently uses FullCalendar hooks for semantic styling:

- `eventClassNames`: adds classes based on event semantics
  - recurring events -> `ev-recurring`
  - recurring override instances -> `ev-recurring-override`
  - background events -> `ev-background`
  - society classes -> `ev-society-nica` / `ev-society-tohu`
- `eventContent`: renders compact badges before title text
  - `NICA` or `TOHU`
  - `REC` for recurring events
- `dayCellClassNames`: adds day-level classes
  - weekends -> `day-weekend`
  - days covered by background events -> `day-vacation`

### User controls (settings popover)

Calendar toolbar now includes a compact settings icon button (gear).
It opens a popover with:

- `Show NICA/TOHU badges`
- `Show REC badge`
- `Year view month width` (slider, maps to FullCalendar `multiMonthMinWidth`)

Behavior:

- changes apply immediately (events rerender in place)
- settings are stored in `localStorage` under key `calendar-ui-settings-v1`
- defaults:
  - both label toggles enabled
  - year-view month width: `300`

### Society label inference (important)

Society labels are not read from frontmatter metadata right now.
They are inferred from `extendedProps.sourcePath` with string matching:

- if path contains ` TOHU ` or `/TOHU ` (case-insensitive via uppercase conversion), label is `TOHU`
- if path contains ` NICA ` or `/NICA `, label is `NICA`
- otherwise no society label is shown

This is a heuristic. It works well for project folders following naming convention (`[Year] [Society] ...`) but can miss files in generic paths (for example Inbox/Meetings/custom folders).

### Vacation day inference

`day-vacation` is derived from events with `display: "background"`.
For each background event, all covered dates are added to an in-memory day set and then marked on day cells.
Date matching uses local calendar dates (not UTC conversion) to avoid timezone off-by-one mismatches in textured day rendering.

### Recurring event colors

Recurring events now respect `event_color` metadata as well.
The builder applies event color before recurrence expansion so recurring instances/overrides inherit the same color.

### Next technical improvement (recommended)

To remove heuristic path matching, enrich generated events in `build-events.mjs` with explicit metadata:

- `extendedProps.society` (`nica` / `tohu`)
- optional future keys like `extendedProps.projectKey`, `extendedProps.eventType`

Then UI hooks in `cal.html` should consume those explicit fields first and only fallback to path matching for legacy events.

## Drag and drop persistence

Drag and resize are enabled in the calendar.

When a date changes, `cal.html` calls:

- `POST /api/events/update-dates`

The local preview server updates the source markdown frontmatter:

- `startDate: YYYY-MM-DD`
- `endDate: YYYY-MM-DD`

Important:

- This works only through `npm.cmd --prefix .\Tools\Calendar run preview` (not `file://` mode).
- Events are mapped to files by `extendedProps.sourcePath` from `events.generated.js`.

## Open note on event click

When you click an event in `cal.html`, the preview server calls:

- `POST /api/events/open-note`

The server then runs Obsidian CLI:

- `obsidian open path="<sourcePath>" newtab`

Result: the mapped markdown note opens in a new Obsidian tab.

## Create event on date click

When you click an empty date cell in `cal.html`, the app prompts for an event title and then calls:

- `POST /api/events/create`

The server creates a markdown file in:

- `6. Obsidian/Inbox` (override with `CALENDAR_INBOX_PATH`)

Created file details:

- filename is derived from the entered title (with automatic ` (2)`, ` (3)`... on duplicates)
- frontmatter includes `title`, `startDate`, `endDate`, `event_background: false`, and `tags: [event]`
- the new event is added directly to the calendar view

