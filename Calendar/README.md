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

## Session Restart Checklist

Use this at the beginning of a new session:

1. Stop old preview process:
   - `npm.cmd --prefix .\Tools\Calendar run stop:preview`
2. Start fresh preview:
   - `npm.cmd --prefix .\Tools\Calendar run preview`
3. Verify API health:
   - open `http://127.0.0.1:4173/api/ping` and expect `{"ok":true}`
4. Open calendar:
   - `http://127.0.0.1:4173/cal.html`
5. Quick sanity checks in UI:
   - base filter dropdown is visible
   - Google status in settings is not error
   - Nextcloud status in settings is not error

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
- `GOOGLE_CALENDAR_API_KEY` / `GOOGLE_CALENDAR_IDS` (optional Google read via API key)
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` (optional Google OAuth, required for write)
- `GOOGLE_OAUTH_REDIRECT_URI` (default `http://127.0.0.1:4173/api/google-oauth/callback`)
- `GOOGLE_OAUTH_SCOPES` (default includes `calendar.readonly` + `calendar.events`)
- `GOOGLE_OAUTH_TOKEN_FILE` (default `Tools/Calendar/google-oauth-token.json`)
- `GOOGLE_CREATE_CALENDAR_ID` (optional default target calendar for new Google events)
- `NEXTCLOUD_CALDAV_BASE_URL` (example `https://cloud.example.org`)
- `NEXTCLOUD_CALDAV_USERNAME` (Nextcloud user)
- `NEXTCLOUD_CALDAV_APP_PASSWORD` (Nextcloud app password)
- `NEXTCLOUD_CALDAV_CALENDARS` (comma list of calendar slugs or full CalDAV calendar URLs)
- `NEXTCLOUD_CREATE_CALENDAR_ID` (optional default target calendar for new Nextcloud events)

Important Nextcloud note:

- `NEXTCLOUD_CALDAV_BASE_URL` must include scheme (`https://...`), not bare host.

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
- `GET /api/google-oauth/status`
- `GET /api/google-oauth/start`
- `GET /api/google-oauth/callback`
- `GET /api/nextcloud-calendar/config`
- `GET /api/nextcloud-calendar/events`
- `GET /api/events/preview` (`sourcePath` query param)

Write:

- `POST /api/events/update-dates`
- `POST /api/google-oauth/disconnect`
- `POST /api/google-calendar/events/create`
- `POST /api/google-calendar/events/update`
- `POST /api/google-calendar/events/delete`
- `POST /api/nextcloud-calendar/events/create`
- `POST /api/nextcloud-calendar/events/update`
- `POST /api/nextcloud-calendar/events/delete`
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
- Calendar settings include:
  - global roundness slider
  - year-view month width slider
  - day/week row-height slider (timeGrid density)
  - per-Nextcloud-calendar visibility checkboxes
- Header toolbar includes source toggles:
  - `G` button toggles Google event visibility
  - `N` button toggles Nextcloud event visibility
  - buttons show clear on/off visual state and mirror settings values
- Source visibility toggles were moved out of settings popover; visibility is controlled from toolbar buttons only.
- Create-event modal uses per-target tabs:
  - `md`: create markdown event note
  - `google`: choose color from currently loaded Google event colors, then create
  - `nextcloud`: choose configured Nextcloud calendar slug, then create
- Nextcloud recurring events:
  - CalDAV `RRULE` events are mapped to FullCalendar recurrence (`rrule`) with duration
  - `EXDATE` and `RECURRENCE-ID` overrides are applied as exclusions to avoid duplicate occurrences
  - recurring Nextcloud events are rendered read-only in calendar UI
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

Google edit mode does not work:

- connect OAuth in Calendar settings (`Connect Google OAuth`)
- ensure OAuth scopes include `https://www.googleapis.com/auth/calendar.events`
- if needed, disconnect and reconnect OAuth to refresh scopes/token

No Nextcloud events:

- verify `.env.local` has `NEXTCLOUD_CALDAV_BASE_URL`, `NEXTCLOUD_CALDAV_USERNAME`, `NEXTCLOUD_CALDAV_APP_PASSWORD`, `NEXTCLOUD_CALDAV_CALENDARS`
- use an app password (recommended), not your login password
- ensure the configured calendars exist and are accessible for that user
- ensure `NEXTCLOUD_CALDAV_BASE_URL` includes `https://`

Nextcloud calendar too noisy:

- use Calendar settings -> `Nextcloud calendars` to enable/disable individual calendars without changing `.env.local`

## Current Manual Follow-up

Rotate/revoke previously exposed Google API key and replace with a new key in local `.env.local` only.
