# unraid-unzip

Archive extraction for the unRAID File Manager. It adds **Extract** actions to
the file/folder context menus and extracts archives to a chosen destination.

Built on [7-Zip](https://www.7-zip.org/) (`7zzs`) — the binary is downloaded and
SHA256-verified at install time; it is **not** bundled in the package.

Project page: [https://h4de5.github.io/unraid-unzip/](https://h4de5.github.io/unraid-unzip/)
(changelog + install URL).

## Disclaimer

This repository was **vibe-coded**: I have not looked at the source code, and you
probably should not either. I cannot evaluate the code either, because I have no
experience writing unRAID plugins. **Use it at your own risk.**

This plugin was built to cover my own use-case. No further use-cases are
currently planned.

The architecture, plugin manifest format, File Manager injection technique, and
7-Zip integration in this project are based on work and documentation by
contributors to the unRAID community — in particular the
[zip_manager](https://github.com/jcofer555/zip_manager) plugin, the
[unRAID webgui](https://github.com/unraid/webgui) source,
[plugin-docs](https://github.com/mstrhakr/plugin-docs), and
[folder.view3](https://github.com/chodeus/folder.view3).
Those projects solved the same problems years before this repo existed; the
credit for the underlying patterns is entirely theirs.

## Supported input formats

Extract (read) support:

- 7z, zip
- RAR / RAR5 (extraction only — RAR creation is out of scope for licensing)
- tar, tar.gz / tgz, tar.bz2 / tbz, tar.xz / txz, tar.zst (compressed tarballs
  are handled with a two-stage 7-Zip pipeline)

Encrypted archives: saved passwords are tried automatically, and a prompt is
shown if none match.

## Features

- **Context-menu actions** on archive files in the File Manager (`/Browse`).
- **Destination + overwrite policy** per extraction (overwrite / skip / rename).
- **Exclude patterns** (e.g. `node_modules`, `*.log`) — matched at any archive
  depth.
- **Job model**: extractions run in the background; active state and logs live in
  `/tmp/unraid-unzip/` so the USB flash drive is never written during jobs.
- **Settings page**: password list, exclude list, default overwrite policy,
  notifications.
- **Dark-theme aware** UI, mobile-friendly dialog.

## Requirements

- unRAID 7.0 or newer (the plugin ships as a standard unRAID plugin package).
- Internet access at **install time** to fetch the pinned 7-Zip runtime
  (verified by SHA256). No network is needed at runtime.

## Installation

1. Add the plugin URL in **Settings → Plugins → Add/Remove**:
   `https://h4de5.github.io/unraid-unzip/unraid-unzip.plg`
   (a stable URL — always the latest released version, with a verified
   checksum). Or download the `.txz` from the
   [Releases](https://github.com/h4de5/unraid-unzip/releases) page.
2. Install (the `.plg` auto-downloads the package + the pinned 7-Zip runtime,
   both verified by SHA256).
3. Open **Settings → unraid-unzip** to configure passwords, exclude patterns and
   the default overwrite policy.
4. Right-click an archive in the File Manager → **Extract…**.

## How it works

- The File Manager has no plugin hook; the UI is injected by a
  `Menu="Buttons"` page included in the page head, which wraps `context.attach`
  and only acts on `/Browse` file rows.
- Extraction runs in a staging directory on the target filesystem, then merges
  into the destination using the selected overwrite policy. This keeps
  root-folder stripping and path/symlink safety under control.
- Passwords are passed to 7-Zip as a single `-p<password>` argument. This is
  visible in `ps`; it is a known, documented trade-off (7-Zip's bare `-p` does
  not read a password from stdin on Linux 26.05).

## Development

```
bin/     build.sh (public, CI build)   generate-pages.sh (manifest + landing)
         deploy.sh (local host deploy, not shipped)
src/     plugin sources (emhttp pages, api, js, css, scripts)
CHANGELOG.md  changelog (single source; topmost "### <version>" = current release)
tests/   bash unit tests (merge-tree, exclude normalisation) + 7-Zip checksum
packages/ local build output (gitignored)
```

Build a package locally (deterministic — local and CI builds hash identically):

```sh
bin/build.sh --version 2026.11.08.03 --out-dir packages
```

Generate the install manifest + landing page from `CHANGELOG.md` + a SHA:

```sh
bin/generate-pages.sh --version 2026.11.08.03 --sha256 <sha> --out pages
```

Run the tests:

```sh
bash tests/run-tests.sh
bash tests/test-exclude-normalization.sh
bash tests/verify-7z-checksum.sh
```

## Releases

Tags are the unRAID version verbatim (e.g. `2026.11.08.03`). Add the release
note as a `### <version>` entry in `CHANGELOG.md`, push, then tag — pushing the
tag builds the `.txz`, publishes it as a GitHub Release asset, generates the
install manifest from that build's checksum, and deploys the manifest + landing
page to the stable URL. Nothing about the manifest is committed by hand.

The stable plugin URL (always the latest release) is
`https://h4de5.github.io/unraid-unzip/unraid-unzip.plg`.

## License

MIT — see [LICENSE](LICENSE).
