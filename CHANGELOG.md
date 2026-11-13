# Changelog

`unraid-unzip` - archive extraction for the unRAID File Manager.
Newest version first. The release pipeline reads the topmost `### <version>`
entry for the GitHub Release body and for the generated `.plg` / landing page.

### 2026.11.10.02

- Community Applications compliance: `plugins/unraid-unzip.xml` rewritten to the approved schema (single `<Plugin>` root, `<Project>`, `<Support>` -> issue tracker, `<Icon>` -> raw image URL, `<MinVer>`/`<MaxVer>`, `Tools:Utilities`); the legacy `<IconFA>` and out-of-spec `<PluginAuthor>` fields are removed.
- The install manifest `unraid-unzip.plg` is now a **tracked source file at the repo root**; its `pluginURL` is the stable raw URL (`raw.githubusercontent.com/h4de5/unraid-plugins/main/unraid-unzip.plg`), which is what the CA wrapper points at.
- `bin/generate-pages.sh`: the default `pluginURL` is the stable raw URL.
- Release pipeline: after publishing a Release it regenerates the root manifest from that build's SHA and commits it to `main`, so the raw URL always resolves to the latest release. CI asserts the committed manifest uses the raw URL.
- README / RELEASE.md / AGENTS.md updated to describe the raw-URL manifest as the canonical install source.

### 2026.11.10.01

- Repo renamed `unraid-unzip` to `unraid-plugins`; the unRAID plugin / package name is unchanged (`unraid-unzip`).
- Fix: the published `pluginURL` (and the Pages base) now point at the live `h4de5.github.io/unraid-plugins` base; the old `h4de5.github.io/unraid-unzip` base returned 404, which broke the on-box update check.
- `generate-pages.sh`: split the unRAID plugin name from the GitHub repo name so the package slot, `.plg` file and emhttp dir stay `unraid-unzip` while release assets and Pages use the new repo name.
- CA files (`ca_profile.xml`, `plugins/unraid-unzip.xml`), README, RELEASE.md, AGENTS.md and the CI/release URL checks now reference the canonical `unraid-plugins` repo.

### 2026.11.08.05

- Add Community Applications submission files: `ca_profile.xml` (repo profile) and `plugins/unraid-unzip.xml` (plugin wrapper, category Tools:Utilities).
- `.plg` support link now points to the GitHub issue tracker instead of the repo root.
- Repo-wide style: em/en dashes replaced with plain hyphens; rule added to `AGENTS.md`.

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