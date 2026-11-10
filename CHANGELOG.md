# Changelog

`unraid-unzip` — archive extraction for the unRAID File Manager.
Newest version first. The release pipeline reads the topmost `### <version>`
entry for the GitHub Release body and for the generated `.plg` / landing page.

### 2026.11.08.04

- Fix: settings page no longer inlined on /Settings overview (Menu moved from `Settings` to `OtherSettings`).
- Shorten the about paragraph on the settings page.

### 2026.11.08.03

- Refactor exclude-pattern normalisation into a testable, unit-tested helper (same behaviour as 0.02).

### 2026.11.08.02

- Fix: excludes match at any archive depth; pre-fill target dir in extract dialog; shorten plugin description; prune empty staging dirs after extraction.

### 2026.11.08.01

- Settings restructured (descriptions, Advanced accordion); saved exclude list now always applied to extractions; saved passwords always tried; notifications on by default (suppressable); mobile-friendly dialog; plugin description for the plugin list.

### 2026.11.07.05

- Installation now replaces a single plugin slot instead of creating one per version; legacy slots are cleaned up.

### 2026.11.07.04

- Password list is now a plain editable textbox, shown and saved like the exclude list; removed the keep/clear mechanism.

### 2026.11.07.03

- Settings save rewritten: single API call, no /update.htm; password + exclude lists persisted directly.

### 2026.11.07.02

- Fixed settings save (relative API URL returned the HTML error page).

### 2026.11.07.01

- Dark-theme aware settings page and dialogs.
- Fixed settings page (eval'd plugin dir resolution).
- Removed the create-archive feature (extraction only).

### 2026.11.06.01

- Initial implementation.
