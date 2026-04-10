# Homepage Tool (Modular)

Lokaler Preview-Server fuer eine modulare Obsidian-Homepage.

## Ziele

- Homepage in Obsidian Webviewer ueber lokalen Server.
- Module koennen per Settings ein/ausgeschaltet werden.
- Lokale, einfache Konfiguration in `Tools/config/`.
- Klick auf Bookmark-Karten nutzt native Obsidian-Bookmark-Logik (`openBookmark`).

## Ordnerstruktur

- `Tools/home.html`: Hauptseite (Layout + CSS + Script-Einbindung).
- `Tools/app/homepage.css`: Styles fuer die Homepage.
- `Tools/app/homepage.js`: Bootstrap + Modul-Registry.
- `Tools/modules/bookmarks.js`: Bookmarks-Modul.
- `Tools/modules/clock.js`: Uhrzeit-Modul.
- `Tools/settings.html`: Settings-Seite (UI fuer Konfiguration).
- `Tools/serve.mjs`: HTTP-Server + API.
- `Tools/stop-preview.mjs`: stoppt den Preview-Server auf Port `4174`.
- `Tools/config/settings.default.json`: versionierte Default-Konfiguration.
- `Tools/config/settings.local.json`: lokale Ueberschreibungen fuer diesen Arbeitsplatz.

## Start / Stop

Von Repository-Root:

```powershell
npm.cmd --prefix .\Tools run preview
```

Stoppen:

```powershell
npm.cmd --prefix .\Tools run stop:preview
```

Direkt im Obsidian Webviewer oeffnen:

```powershell
obsidian web url="http://127.0.0.1:4174/home.html"
```

Settings-Seite:

```powershell
obsidian web url="http://127.0.0.1:4174/settings.html"
```

## API

- `GET /api/ping`: Health-Check.
- `GET /api/settings`: Effektive Settings (Default + Local Merge).
- `POST /api/settings`: Speichert Settings nach `Tools/config/settings.local.json`.
- `GET /api/bookmarks`: Liest `.obsidian/bookmarks.json` fuer Bookmark-Modul.
- `POST /api/bookmarks/open`: Oeffnet Bookmark in Obsidian ueber Bookmark-Plugin-API.
- `GET /api/obsidian/theme`: Liefert einen Theme-Snapshot aus Obsidian (fuer `mirror-obsidian`).
- `POST /api/search/open`: Oeffnet konfigurierte Header-Suche in Obsidian.
- `GET /api/projects/meta`: Liefert Vorschlagswerte fuer neue Projekte (Year/Society/Type/Foerderkuerzel).
- `POST /api/projects/create`: Erstellt neuen Projektordner + MOC-Datei per Projekt-Template und oeffnet die Datei.
- `GET /api/updo/snapshot`: Liefert Monitoring-Snapshot fuer das `updo`-Modul.
  - Enthält bei TLS-Fehlern ein `sslIssue`-Objekt (z. B. `ERR_TLS_CERT_ALTNAME_INVALID`).
- `POST /api/updo/restart`: Startet den `updo`-Monitorprozess neu.

## Konfigurationsprinzip

1. Defaults aus `settings.default.json`.
2. Lokale Ueberschreibung aus `settings.local.json`.
3. Server liefert die gemergten, validierten Settings aus.

Damit sind spaetere Features stabil erweiterbar (neue Module, neue Optionen).

## Aktuelle Module

- `bookmarks`: Visuelle Bookmark-Navigation.
  - Optional: Pfadanzeige (`showPath`) an/aus.
  - Optional: Typ-Badge (`showType`) an/aus.
  - Optional: Oeffnen in neuem Tab (`openInNewTab`) an/aus.
  - Optional: Kartenbreite (`cardMaxWidth`, 205-420 px).
- `clock` (Uhrzeit): Live-Digitaluhr im Header/Banner.
- `newProject` (Neues Projekt erstellen): Dialog fuer neue Projekte in `2. Projektverwaltung` inkl. Naming-Validierung.
- `updo` (Website Monitoring): Statuskarten + Latenz/Verfuegbarkeits-Charts fuer konfigurierten URL-Satz.
  - Kennzeichnet Zertifikatsprobleme explizit (z. B. `SSL MISMATCH`) statt nur generisch `DOWN`.

## Projektnaming-Doku

- Regeln fuer Projektnamen und Frontmatter: `Tools/docs/project-naming-and-creation.md`

## UI-Theming (Homepage + Settings)

- Theme-Modus:
  - `preset`: Nutzt lokale Theme-Presets.
  - `mirror-obsidian`: Liest Obsidian-Theme-Werte ueber Server-Endpoint und mapped sie auf Tool-Tokens.
- Presets: `soft`, `flat`, `high-contrast`.
- Shape-Profile: `rounded`, `comfortable`, `sharp`.
- Gilt fuer beide Seiten: `home.html` und `settings.html`.

### Theme-Settings (Schema)

UI-Optionen liegen unter `ui` in den Settings:

```json
{
  "ui": {
    "title": "Workspace Homepage",
    "titleSize": 38,
    "search": {
      "provider": "omnisearch",
      "openInNewTab": false
    },
    "theme": {
      "mode": "preset",
      "preset": "soft",
      "shape": "rounded"
    }
  }
}
```

### Mirror-Mechanik

1. Frontend fragt `GET /api/obsidian/theme`.
2. Server liest Theme-Werte via `obsidian eval` aus Obsidian (`document.body` CSS-Variablen).
3. Frontend mapped Werte auf lokale CSS-Tokens.
4. Falls Theme-Daten fehlen/fehlschlagen: automatischer Fallback auf `preset`.

### First-Paint Verhalten (kein Theme-Flash)

- Beide Seiten nutzen einen lokalen Bootstrap-Cache in `localStorage`:
  - Key: `homepage-theme-bootstrap-v1`
- Ziel: Theme-Daten vor dem ersten Paint anwenden, bevor async API-Requests zurueck sind.
- Ergebnis: Kein sichtbarer Wechsel von Default-Theme auf Ziel-Theme beim Reload/Seitenwechsel (nach erstem erfolgreichen Load).

### Troubleshooting

- Mirror ohne Effekt:
  - `http://127.0.0.1:4174/api/obsidian/theme` pruefen (es muessen `vars` mit Werten kommen).
  - Preview-Server neu starten (`stop:preview` + `preview`), falls neue API-Routen noch nicht aktiv sind.
- Unerwartete Restfarben nach Refactor:
  - `localStorage`-Eintrag `homepage-theme-bootstrap-v1` loeschen und Seite neu laden.

## Recent Changes

- Modulares Theme-System eingefuehrt (`ui.theme.mode/preset/shape`).
- Presets hinzugefuegt: `soft`, `flat`, `high-contrast`.
- Shape-Profile hinzugefuegt: `rounded`, `comfortable`, `sharp`.
- Obsidian-Mirror-Modus hinzugefuegt (via `GET /api/obsidian/theme`).
- Theme gilt jetzt fuer `home.html` und `settings.html`.
- First-paint Theme-Bootstrap via `localStorage` hinzugefuegt (`homepage-theme-bootstrap-v1`) zur Vermeidung von Theme-Flash.
- Header angepasst: kein Untertitel mehr, Titelgroesse konfigurierbar (`ui.titleSize`), neue Such-Icon-Aktion fuer Omnisearch.

## Neue Module ergaenzen

1. Neue Moduldatei in `Tools/modules/` anlegen und `render...Module` exportieren.
2. In `Tools/app/homepage.js` neues Modul in `moduleRegistry` registrieren.
3. In `Tools/config/settings.default.json` Modul-Konfiguration aufnehmen.
4. Optional in `Tools/settings.html` UI-Toggles/Felder ergaenzen.
5. Falls Backend noetig: Endpoint in `Tools/serve.mjs` ergaenzen.
