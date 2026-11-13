# Releasing

There is one canonical install manifest, `unraid-unzip.plg`, tracked **at the
repo root**. Its `pluginURL` is the stable raw URL, and it is what Community
Applications points at. The release pipeline regenerates it *after* the package
is built and the Release exists, and commits it back to `main` - so the raw URL
always resolves to the latest release. You only add a changelog entry and tag;
the pipeline keeps the manifest current.

The stable URL (unRAID and CA fetch this to detect a newer `version=`):

```
https://raw.githubusercontent.com/h4de5/unraid-plugins/main/unraid-unzip.plg
```

The manifest carries the versioned package path + SHA256; the install script
downloads the pinned 7-Zip runtime (SHA256-verified) then `upgradepkg`.

The package binary itself is a GitHub Release asset (versioned, immutable):

```
https://github.com/h4de5/unraid-plugins/releases/download/v<version>/<pkg>
```

A landing page is also generated (via `bin/generate-pages.sh`) and published to
GitHub Pages for humans; it is not the install source.

## Release flow

Bump the change in `src/`, add a `### <version>` entry to `CHANGELOG.md`, and
tag. That's it - the pipeline does the rest.

1. Make the change in `src/`.
2. Add a `### <version>` entry to `CHANGELOG.md` (topmost entry = current release).
3. Optional local sanity build:
   ```
   bin/build.sh --version 2026.11.08.03 --out-dir packages
   ```
4. Commit `src/` + `CHANGELOG.md` to `main`, push.
5. Tag and push - this triggers the release:
   ```
   git tag v2026.11.08.03 && git push origin v2026.11.08.03
   ```

The `release` workflow (on the `v*` tag) then, in order:

1. lint + tests,
2. build the deterministic `.txz` (→ its SHA256),
3. generate the `.plg` from `CHANGELOG.md` + that SHA,
4. **publish the GitHub Release** (`.txz` now downloadable),
5. **deploy the `.plg` + landing `index.html` to GitHub Pages**,
6. **regenerate the root `unraid-unzip.plg` from this build's SHA and commit it
   to `main`** (only if it changed).

Because the Release is published *before* the root manifest is bumped, there is
no window where unRAID sees a new version but the package 404s. The commit to
`main` is the pipeline keeping its own manifest current - it is not a hand edit
and does not re-trigger the release job (that fires on `v*` tags only).

## Local build / deploy (no GitHub)

For the home server, skip GitHub entirely:

```
# add the "### <version>" entry to CHANGELOG.md first
bin/deploy.sh --version 2026.11.08.03
```

`deploy.sh` is local-only (gitignored). It builds the `.txz`, generates the
`.plg` with **fileshare** URLs (so the box fetches locally), and installs on the
host. It does not publish a Release or touch GitHub Pages.

## Notes

- Builds are deterministic (GNU tar, fixed owner/mtime/sort). Two builds of the
  same tree hash identically - that is what makes the SHA in the manifest
  reliable.
- `CHANGELOG.md` is the single source for the changelog; the topmost
  `### <version>` entry is used for both the Release body and the generated
  `.plg` / landing page.
- The 7-Zip runtime pin (version/file/SHA256/URL) lives in `bin/generate-pages.sh`.
  `tests/verify-7z-checksum.sh` independently re-checks that pin in CI.
- The `7z2605-linux-x64.tar.xz` tarball kept in `packages/` is for
  offline/reproducible installs and is not part of any published package.