# VaultGraph Agent Rules

Scope: `Tools/VaultGraph`

## Start Checklist

1. Read `README.md`.
2. Run `npm.cmd --prefix .\Tools\VaultGraph run check:smoke`.
3. If smoke fails, fix that first before changing behavior.

## Source of Truth

- Folder scan: `build-graph.mjs`
- Runtime server: `serve.mjs`
- Frontend: `vault-graph.html`, `vault-graph.css`, `vault-graph.app.js`
- Generated data: `graph.generated.json`, `graph.generated.js`
- Handoff state: `README.md`, `task.md`

## Operational Rules

- Start preview with `npm.cmd --prefix .\Tools\VaultGraph run preview`.
- Stop preview with `npm.cmd --prefix .\Tools\VaultGraph run stop:preview`.
- Do not kill processes by port manually unless the stop script fails.
- Treat `graph.generated.json` and `graph.generated.js` as generated output; rebuild instead of manual edits.

## Data Rules

- V1 is read-only with respect to vault content.
- Scanning must avoid symlink traversal to prevent loops.
- Keep ignore rules conservative and documented in `README.md`.

## Change Discipline

When behavior changes:

1. Update `README.md` for commands, config, or behavior changes.
2. Update `task.md` with current status and open items.
3. Re-run `check:smoke` and the root `Tools` lint commands.
