# Calendar Agent Rules

Scope: `Tools/Calendar`
Updated: 2026-04-08

## Start Checklist

1. Read `README.md`.
2. Run `npm.cmd --prefix .\Tools\Calendar run check:smoke`.
3. If smoke fails, fix that first.

## Source of Truth

- Runtime behavior: `serve.mjs` + `cal.app.js`
- Event generation: `build-events.mjs`
- Docs/handoff state: `README.md` + `task.md`

## Operational Rules

- Start preview with `npm.cmd --prefix .\Tools\Calendar run preview`.
- Stop preview with `npm.cmd --prefix .\Tools\Calendar run stop:preview`.
- Do not kill processes by port manually unless stop script fails.
- Treat `events.generated.js` as generated output; rebuild instead of manual edits.

## Security Rules

- Keep secrets in `.env.local` only.
- Never commit real API keys to `.env` or docs.
- Write API routes require `X-Calendar-Token` from `GET /api/session`; keep this behavior.
- Do not loosen host/origin checks unless explicitly requested.

## Data/Build Rules

- Default behavior: fail build on Base query errors.
- Only enable markdown fallback with `ALLOW_MARKDOWN_FALLBACK=true`.
- Preserve recurrence semantics (including background recurrence behavior).
- Preserve date handling that avoids timezone day-shift regressions.

## Change Discipline

When behavior changes:

1. Update `README.md` (commands, config, behavior).
2. Update `task.md` (status + open items only).
3. Re-run `check:smoke`.
