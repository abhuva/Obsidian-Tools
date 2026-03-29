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

## Frontmatter-Felder (mindestens)

- `year`
- `antragsteller`
- `förderer`
- `title`
- `type`
- `category: project-moc`
