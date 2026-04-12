# CLI Time Tracking Research (Open Source + Plaintext)

Date: 2026-04-12
Goal: Identify CLI-first time tracking tools that use plaintext (or plaintext-adjacent) storage and can be extended/integrated in our tooling.

## Shortlist

| Tool | Open Source | Storage / Format | Why it is interesting for integration | Notes / Risks | Links |
|---|---|---|---|---|---|
| Bartib | Yes (Rust) | Plaintext activity log | Very close to our requirement: simple CLI, file-based log, reporting built in | Smaller ecosystem than older tools | https://github.com/nikolassv/bartib |
| klog | Yes (Go) | Human-readable plain-text format (`.klg`) | Explicit file format focus, good if we want deterministic parsing + versioning in git | Needs adoption of klog syntax conventions | https://github.com/jotaen/klog |
| tock | Yes (Go) | Human-readable plaintext log (also Timewarrior backend support) | Can interoperate with Bartib/Timewarrior-style workflows, modern CLI UX | Newer/smaller project compared to Timewarrior | https://github.com/mcannoo/tock |
| Watson | Yes (Python, MIT) | Local data files in user config dir (`~/.config/watson`); supports JSON export/import | Mature CLI with reporting and ecosystem familiarity | Storage is less "document-like" than klog/Bartib plain logs | https://github.com/jazzband/Watson / https://jazzband.github.io/Watson/faq/ |
| Timewarrior | Yes (C++) | Local data files under `~/.timewarrior/data`; JSON import/export + extension API | Very extensible, strong CLI ergonomics, broad ecosystem (plugins/extensions) | Format is optimized for tool use, less friendly for direct manual editing | https://timewarrior.net/docs/ / https://github.com/GothenburgBitFactory/timewarrior |
| Time-Track-CLI | Yes (Python) | Plain text files in TODO.txt-like style | Very plaintext-native and scriptable, simple model | Older/less active project; may require maintenance by us | https://github.com/dongola7/Time-Track-CLI |

## Most Promising for Our Next Module

1. **klog**
- Best if we want a **stable, human-readable file format** we can parse and extend ourselves.
- Good fit for "build on top" scenarios (custom reports, sync, migration tooling).

2. **Bartib**
- Best if we want to start quickly with minimal complexity.
- Pragmatic baseline for a first integrated CLI workflow.

3. **Timewarrior**
- Best if we expect more advanced workflows and integrations later.
- Strong extension model, but storage is less directly user-editable than plain log-first tools.

## Suggested Next Step

Run a short proof-of-concept with **klog** and **Bartib**:
- Define one canonical activity schema for our repo (project, tags, billable flag, notes).
- Map that schema to each tool's native format.
- Check round-trip ability: `track -> report -> parse -> aggregate`.

If you want, I can do this next and create a compatibility matrix + import/export adapter outline in `Tools/timetracking/`.
