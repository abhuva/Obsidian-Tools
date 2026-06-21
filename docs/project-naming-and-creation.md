# Neues Projekt Erstellen: Naming-Schema

Dieses Dokument definiert das verbindliche Naming fuer neue Projektordner und die zugehoerige MOC-Datei in `2. Projektverwaltung/`.

## Schema

- Gefoerdertes Projekt (`type: funding`):
  - `[YEAR] [SOCIETY] [FUNDING] - [PROJECT TITLE]`
  - Beispiel: `2026 NICA BKJ - Verborgene Staerken`
- Nicht gefoerdertes Projekt (`type: hired` oder `type: self financed`):
  - `[YEAR] [SOCIETY] - [PROJECT TITLE]`
  - Beispiel: `2026 NICA - Tanzgruppe Leipzig`

## Regeln

- `SOCIETY` ist strikt `NICA` oder `TOHU`.
- Bei `funding` ist ein Foerderkuerzel Pflicht (z. B. `BKJ`, `VHS`, `ZMS`).
- Bei `hired` und `self financed` wird kein Funding-Token im Ordnernamen verwendet.
- Frontmatter `förderer` wird bei `hired` und `self financed` immer auf `"-"` gesetzt.
- Die Projektdatei hat exakt denselben Namen wie der Ordner, plus `.md`.
- Ungueltige Windows-Dateizeichen sind nicht erlaubt: `< > : " / \\ | ? *`.

## Templates

- Projekt-Templates liegen in `6. Obsidian/_template/project/`.
- Die Projekterstellung bietet alle `.md` Dateien aus diesem Ordner als Auswahl an.
- Die Anzeige nutzt den Dateinamen ohne `.md`, z. B. `Projekt Peter`.
- `Projekt.md` ist das Standard-Template, falls vorhanden.
- Nach dem Rendern des Templates werden die kanonischen Frontmatter-Felder automatisch gesetzt oder ueberschrieben.

## Frontmatter-Felder (mindestens)

- `year`
- `antragsteller`
- `förderer`
- `title`
- `type`
- `category: project-moc`
