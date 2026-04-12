# Architecture Notes

## Current Direction

Das Tool ist als modulares UI + Settings-Seite aufgebaut:

- zentrale Seiten: `home.html` und `settings.html`
- Bootstrap/Registry in `app/homepage.js`
- einzelne Module in `modules/*.js`
- Feature-Toggles ueber Settings
- gemeinsames Theme-Modell (`ui.theme`) fuer beide Seiten

## Why This Fits Long-Term Collaboration

- **Per-user Anpassbarkeit**: Optionen in `Tools/config/settings.local.json`.
- **Stabile Defaults**: Teamweite Basis in `Tools/config/settings.default.json`.
- **Niedrige Kopplung**: Module sind getrennte Render-Funktionen.
- **Backend klar getrennt**: `serve.mjs` stellt nur APIs + statische Dateien bereit.
- **Theme-Unabhaengigkeit**: Eigene Presets funktionieren auch ausserhalb von Obsidian.
- **Obsidian-Integration ohne Hard-Coupling**: Mirror bezieht nur Theme-Snapshot ueber API.

## Tradeoffs

- Frontend ist modularisiert; CSS liegt zentral in `app/homepage.css`.
- Settings-Schema ist bewusst klein gehalten; bei Wachstum kann es in mehrere Dateien geteilt werden.
- Theme-Logik ist aktuell in `app/homepage.js` und inline in `settings.html` dupliziert.
- Mirror ist "best effort": Mapping von Obsidian-Variablen auf lokale Tokens ist nicht 1:1.
- Kein Flash beim Laden wird ueber lokalen Theme-Bootstrap-Cache erreicht (`homepage-theme-bootstrap-v1`).

## Time Tracking Modes (Aktuell)

- `timetracking`-Modul (klog): CLI-orientierte Aktivitaetszeiterfassung mit Tagesansicht.
- `beantime`-Modul (Beancount): Start/Stop mit temporaerer State-Datei; beim Stop wird eine fertige Beancount-Transaktion mit Zeit-Metadaten geschrieben.
- Beide Module nutzen einstellbare Dateipfade in `settings.html`, damit projekt- oder nutzerspezifische Speicherorte moeglich bleiben.

## Theme Pipeline (Aktuell)

1. Defaults + lokale Settings werden in `serve.mjs` gemerged und normalisiert (`ui.theme` eingeschlossen).
2. Seiten setzen frueh gecachte Theme-Werte vor dem ersten Paint (localStorage Bootstrap).
3. Danach werden Settings geladen und Theme final angewendet.
4. Bei `mirror-obsidian` holt das Frontend Theme-Daten von `GET /api/obsidian/theme`.
5. Wenn Mirror fehlschlaegt, bleibt Preset-Theme aktiv (Fallback).

## Next Good Refactor (wenn mehr Features kommen)

1. Gemeinsame Theme-Utilities in eigene Datei auslagern (aktuell doppelte Logik in Home + Settings).
2. Optional modul-spezifische CSS-Dateien pro Modul (`Tools/modules/*.css`).
3. Settings-Schema versionieren inkl. Migration (`schemaVersion` nutzen).
4. Optional rollenbasierte Modul-Sets (z.B. Buchhaltung, Projektarbeit, Meetings).
