# unraid-unzip

unRAID archive-extraction plugin. Integrates with the built-in File Manager
(`/Shares/Browse?dir=...`), adds Extract actions to the file/folder context menus,
and provides a settings page for passwords, exclude patterns, overwrite behaviour
and notifications.

**Status:** implemented and published (current `2026.11.08.03`). Source lives in
`src/`; the changelog in `CHANGELOG.md`; CI/Release workflows in
`.github/workflows/`. Build and release tooling in `bin/`.

## Workspace rules

This project is part of `/workspace/development`. The central workspace rules in
`/workspace/development/AGENTS.md` and the `AGENTS_*.md` files next to it apply
here as well. In particular:

- Do not write to `/unraid/appdata`, `/unraid/dockerMan` or running containers
  without an explicit task.
- Test against copies in `/tmp`, never against production data.
- Never manipulate the git working tree unless the user explicitly asks for it.
- All project documentation is written in English.

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

The `.plg` is a **build artifact**, not a tracked source file. `CHANGELOG.md` is
the single source for the changelog (topmost `### <version>` entry = current
release). The stable plugin URL is served from GitHub Pages:
`https://h4de5.github.io/unraid-unzip/unraid-unzip.plg`.

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
