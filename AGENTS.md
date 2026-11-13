# unraid-plugins

Repository for unRAID plugins (one repo, several plugins, one release pipeline).
The first plugin is **unraid-unzip**: an archive-extraction plugin that integrates
with the built-in File Manager (`/Shares/Browse?dir=...`), adds Extract actions to
the file/folder context menus, and provides a settings page for passwords, exclude
patterns, overwrite behaviour and notifications.

**Naming:** the unRAID plugin / package name is `unraid-unzip`; the GitHub repo
and GitHub Pages base are `unraid-plugins` (renamed from `unraid-unzip`). The
plugin name is what appears in the package slot, the `.plg` file, and the emhttp
dir; the repo name is what appears in the release-asset and Pages URLs.

**Status:** implemented and published (current `2026.11.08.05`). Source lives in
`src/`; the changelog in `CHANGELOG.md`; CI/Release workflows in
`.github/workflows/`. Build and release tooling in `bin/`. Community
Applications files: `ca_profile.xml` + `plugins/unraid-unzip.xml`.

## Workspace rules

This project is part of `/workspace/development`. The central workspace rules in
`/workspace/development/AGENTS.md` and the `AGENTS_*.md` files next to it apply
here as well. In particular:

- Do not write to `/unraid/appdata`, `/unraid/dockerMan` or running containers
  without an explicit task.
- Test against copies in `/tmp`, never against production data.
- Never manipulate the git working tree unless the user explicitly asks for it.
- All project documentation is written in English.
- No em dashes (`—`) or en dashes (`–`) anywhere in the repo. Use a plain
  hyphen-minus `-` only. This applies to prose, code, comments, and changelog.

## Absolute rules - unRAID host (SSH root)

The agent has SSH **root** access to the unRAID host (`192.168.0.6`). That access
is **only ever used to install/upgrade/verify this plugin** and nothing else.

1. **Only touch this plugin.** On the host, the only permitted writes are those
   performed by `bin/deploy.sh`'s standard plugin install path: the `unraid-unzip`
   package/slot under `/boot/config/plugins/unraid-unzip*`, the plugin files under
   `/usr/local/emhttp/plugins/unraid-unzip`, and the 7-Zip binary the plugin
   installs. No other file, directory, service, container, share, config, or
   system setting on the host may be read-for-write, created, modified, removed,
   or restarted.
2. **The plugin install routine must behave like a well-behaved unRAID plugin.**
   Its install/upgrade/remove scripts may only: install the package files, bundle
   `7zzs` under `/usr/bin`, manage their own `/tmp/unraid-unzip/` state, and
   register/remove their own menu/Buttons/OtherSettings pages and notification
   hooks. They must **not** modify system packages, unRAID settings, docker or
   other plugins, user data/shares, network, DNS, cron, autostart, or any host
   state outside the plugin's own namespace.
3. **No host experimentation.** Do not run ad-hoc host commands to "test", "check
   state", or "fix" anything that is not part of the documented plugin
   install/verify steps. Diagnostics on the host are read-only and limited to
   confirming this plugin's installation (version, slot count, page present,
   config dir intact).
4. **If a task requires touching anything else on the host, stop and ask.**
   The plugin boundary is the hard limit of what may be written on the box.

## Documentation

Internal design and investigation notes live in `docs-internal/` (gitignored;
not part of the public repo). `README.md` at the repo root is the public
documentation.

| File | Content |
|---|---|
| `docs-internal/requirements.md` | Scope, supported formats, UX flows, settings schema, acceptance criteria, open decisions |
| `docs-internal/research-findings.md` | Verified File Manager internals, 7-Zip behaviour, security tests, old-plugin audit, packaging facts |
| `docs-internal/implementation-plan.md` | Architecture, file layout, API, job runner, extraction algorithm, UI injection, packaging, milestones and test plan |
| `docs-internal/issues-2026-11-08.md` | The 2026-11-08 bug report, each item's root cause, fix and verification |

## Key design decisions

- Backend is 7-Zip (`7zzs`), pinned to 26.05. RAR extraction is supported through
  7-Zip; RAR creation is out of scope for licensing reasons.
- `.tar.gz` / `.tgz` and the other compressed tarballs require a two-stage
  pipeline (`7zz x outer -so | 7zz x -si -ttar`), not a single `x` call.
- Passwords are passed as a single `-p<password>` argument. Bare `-p` does **not**
  read a password from stdin on Linux 26.05. The `ps` exposure of the argument is
  a known, documented risk.
- The File Manager has no plugin hook. The UI is injected by a `Menu="Buttons"`
  page that is included in the `<head>` of every page; the script wraps
  `context.attach` and only acts on `/Browse` file rows.
- Extraction goes to a staging directory on the target filesystem, then merges
  into the target using the selected overwrite policy. This makes root-folder
  stripping and path/symlink safety controllable.
- Never write job logs to the USB flash drive. Active job state and logs live in
  `/tmp/unraid-unzip/`; only a bounded history summary is persisted.

## Build and release

```
bin/build.sh         Lint + build a deterministic .txz from src/ (does NOT touch plugin/ or pages/)
bin/generate-pages.sh Generate unraid-unzip.plg (install manifest) + index.html (landing)
                     from CHANGELOG.md + version + SHA (pure artifact; never committed)
bin/deploy.sh        Local host deploy (gitignored; builds + installs on the box, fileshare URLs)
```

The install manifest `unraid-unzip.plg` is a **tracked source file at the repo
root**. Its `pluginURL` is the stable raw URL
(`https://raw.githubusercontent.com/h4de5/unraid-plugins/main/unraid-unzip.plg`)
- that is the canonical install source and what the Community Applications
wrapper points at. `CHANGELOG.md` is the single source for the changelog
(topmost `### <version>` entry = current release). The release pipeline
regenerates the root manifest from each build's SHA and commits it to `main`,
so the raw URL always resolves to the latest release.

Release flow (tags are the unRAID version verbatim, e.g. `2026.11.08.03`):

1. Make the change in `src/` and add a `### <version>` entry to `CHANGELOG.md`.
2. `bin/build.sh --version 2026.11.08.03 --out-dir packages` to sanity-build.
3. Commit `src/` + `CHANGELOG.md` to `main`.
4. `git tag v2026.11.08.03 && git push origin v2026.11.08.03`.

The `release` workflow then: builds the `.txz`, **generates the `.plg` from that
build's SHA**, publishes the `.txz` as a GitHub Release, and deploys the `.plg`
+ landing page to GitHub Pages. It never commits to `main`. The `ci` workflow
runs lint + tests + build/determinism + a `generate-pages.sh` check on every PR
and main push.