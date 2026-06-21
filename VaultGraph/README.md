# VaultGraph

Local Obsidian/Webviewer tool for visualizing the vault folder hierarchy with Apache ECharts.

## Purpose

VaultGraph scans the folder hierarchy of the vault at full depth and renders it as an interactive graph. V1 is intentionally read-only: it does not move, rename, edit, or delete vault files.

## Files

- `build-graph.mjs`: scans the vault folder hierarchy and writes generated graph files.
- `graph.generated.json`: generated graph payload for the server/API.
- `graph.generated.js`: generated graph payload for direct browser loading.
- `serve.mjs`: local HTTP server and rebuild API.
- `stop-preview.mjs`: stops the preview server via PID file or legacy port detection.
- `vault-graph.html`: browser/Webviewer entry point.
- `vault-graph.css`: UI styling.
- `vault-graph.app.js`: ECharts rendering and filters.
- `smoke-check.mjs`: generated-data validation.

## Commands

From the vault root:

```powershell
npm.cmd --prefix .\Tools\VaultGraph run build:graph
npm.cmd --prefix .\Tools\VaultGraph run preview
npm.cmd --prefix .\Tools\VaultGraph run stop:preview
npm.cmd --prefix .\Tools\VaultGraph run check:smoke
```

Open in Obsidian Webviewer:

```powershell
obsidian web url="http://127.0.0.1:4175/vault-graph.html"
```

Open in a browser:

```text
http://127.0.0.1:4175/vault-graph.html
```

## API

- `GET /api/ping`: health check.
- `GET /api/graph`: returns the current generated graph payload.
- `POST /api/graph/rebuild`: rescans the vault and rewrites generated graph files.

## Ignore Rules

The scanner excludes noisy or unsafe runtime folders:

- `.git`
- any `node_modules`
- `.obsidian/cache`
- `.obsidian/workspace*`
- generated preview PID/log files
- `.env` and `.env.*`

Symlinks are skipped to avoid recursive loops.

## UI

- Force-directed folder graph with pan/zoom.
- Tree view with polyline edges, based on the same filtered folder data.
- Treemap view for disk usage by folder, sized by recursive file bytes.
- Node size indicates descendant folder count.
- Node color indicates depth.
- Optional group color mode assigns colors to direct children of the current local root and shades descendants.
- Search filters paths by substring.
- Max-depth filter is relative to the current active root/focus.
- Top-level folder filter focuses one vault area.
- System-folder toggle hides or shows `.obsidian`, `Tools`, and hidden folders.
- Render controls include labels, node scale, force repulsion, edge length, gravity, friction, line width, tree spacing, and tree animation duration.
- Clicking a node opens side-panel actions to set it as root, hide its subtree, or reset node filters.

## Validation

For local changes:

```powershell
npm.cmd --prefix .\Tools\VaultGraph run check:smoke
npm.cmd --prefix .\Tools run lint
npm.cmd --prefix .\Tools run lint:jsdoc
```
