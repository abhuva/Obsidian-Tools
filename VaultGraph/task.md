# VaultGraph Task Tracker

## v1 Folder Hierarchy Graph

- status: done
- owner: agent
- dependencies: []
- validation: `npm.cmd --prefix .\Tools\VaultGraph run check:smoke`

Implemented:

- Recursive folder hierarchy scanner.
- Generated graph JSON and browser JS payload.
- Local preview server on `127.0.0.1:4175`.
- Apache ECharts force graph UI.
- Depth, top-level folder, system-folder, and search filters.
- Render controls for labels, node scale, graph physics, line width, and color mode.
- View switcher for force graph and folder tree views.
- Treemap disk-usage view based on recursive folder file sizes.
- Node action panel for set-as-root, hide-subtree, and reset node filters.
- Relative-depth filtering based on the active root/focus.
- Rebuild endpoint and UI button.

Open items:

- status: todo
- owner: human/agent
- dependencies: [v1 folder hierarchy graph]
- validation: evaluate graph usability in Obsidian Webviewer

Potential next steps:

- Add note/file count metrics per folder.
- Add project MOC detection.
- Add Obsidian open-folder/open-note actions.
- Add persisted UI preferences.
