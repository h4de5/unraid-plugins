#!/usr/bin/env bash
# Generate the published artifacts from CHANGELOG.md + a finished build:
#
#   <out>/unraid-unzip.plg   the unRAID install manifest (pluginURL points at the
#                            place this file will be served from)
#   <out>/index.html         a small landing page with the changelog
#
# The .plg is a pure build artifact: it is generated AFTER the .txz is built and
# (for GitHub) after the Release exists, and then published to a static URL.
# This script does NOT touch git — the CI deploy action pushes the output dir to
# the pages branch.
#
# Usage:
#   bin/generate-pages.sh \
#     --version 2026.11.08.03 \
#     --sha256 <sha of the built .txz> \
#     --plugin-url https://h4de5.github.io/unraid-unzip/unraid-unzip.plg \
#     [--pkg-url   https://github.com/h4de5/unraid-unzip/releases/download/<v>/<pkg>] \
#     [--changelog CHANGELOG.md] \
#     [--out pages]
#
#   --pkg-url defaults to the GitHub Release asset for --version.
#   --plugin-url defaults to the GitHub Pages URL.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 7-Zip runtime dependency (installed + verified by the .plg, pinned here).
# Single source of truth for the pin — do not duplicate elsewhere.
SEVENZIP_VERSION="26.05"
SEVENZIP_FILE="7z2605-linux-x64.tar.xz"
SEVENZIP_SHA256="22cf82fcc6eb7474f1d5bb4f02c0f8ebd573a718089d6833dc30f8350a3b232e"
SEVENZIP_URL="https://github.com/ip7z/7zip/releases/download/26.05/7z2605-linux-x64.tar.xz"
readonly SEVENZIP_VERSION SEVENZIP_FILE SEVENZIP_SHA256 SEVENZIP_URL

OWNER="h4de5"
REPO_NAME="unraid-unzip"
PAGES_URL="https://${OWNER}.github.io/${REPO_NAME}"

VERSION="" SHA256="" PLUGIN_URL="" PKG_URL="" CHANGELOG="" OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)    VERSION="$2"; shift 2 ;;
    --sha256)     SHA256="$2"; shift 2 ;;
    --plugin-url) PLUGIN_URL="$2"; shift 2 ;;
    --pkg-url)    PKG_URL="$2"; shift 2 ;;
    --changelog)  CHANGELOG="$2"; shift 2 ;;
    --out)        OUT="$2"; shift 2 ;;
    -h|--help)    grep '^# ' "$0" | sed 's/^# //'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$VERSION" ]] || { echo "--version is required" >&2; exit 2; }
[[ -n "$SHA256" ]]  || { echo "--sha256 is required" >&2; exit 2; }

PKG_NAME="${REPO_NAME}-${VERSION}-noarch-1.txz"
PLUGIN_URL="${PLUGIN_URL:-${PAGES_URL}/unraid-unzip.plg}"
PKG_URL="${PKG_URL:-https://github.com/${OWNER}/${REPO_NAME}/releases/download/${VERSION}/${PKG_NAME}}"
CHANGELOG="${CHANGELOG:-$REPO/CHANGELOG.md}"
OUT="${OUT:-$REPO/pages}"
[[ -f "$CHANGELOG" ]] || { echo "changelog not found: $CHANGELOG" >&2; exit 2; }

mkdir -p "$OUT"
PLG="$OUT/${REPO_NAME}.plg"
HTML="$OUT/index.html"

echo "==> Generate $PLG for $VERSION (pkg: $PKG_NAME)"
python3 - "$PLG" "$VERSION" "$PKG_NAME" "$PKG_URL" "$SHA256" "$CHANGELOG" \
  "$PLUGIN_URL" "$OWNER" "$REPO_NAME" \
  "$SEVENZIP_FILE" "$SEVENZIP_SHA256" "$SEVENZIP_URL" <<'PYEOF'
import re, sys

path, version, pkg, pkg_url, sha = sys.argv[1:6]
changelog_path, plugin_url, owner, repo = sys.argv[6:10]
sevenzip_file, sevenzip_sha, sevenzip_url = sys.argv[10:13]

raw = open(changelog_path).read()
# Keep everything from the first "### " entry onward (drop a leading H1 / intro).
m = re.search(r'(?m)^### ', raw)
changelog = (raw[m.start():] if m else raw).strip()

template = """<?xml version='1.0' standalone='yes'?>
<!DOCTYPE PLUGIN>

<PLUGIN
  name="{repo}"
  author="{owner}"
  version="{version}"
  launch="Settings/UnraidUnzip"
  pluginURL="{plugin_url}"
  support="https://github.com/{owner}/{repo}"
  min="7.0.0"
  icon="file-archive-o"
>

<CHANGES>
<![CDATA[
{changelog}
]]>
</CHANGES>

<FILE Name="/boot/config/plugins/{repo}/{pkg}">
<URL>{pkg_url}</URL>
<SHA256>{sha}</SHA256>
</FILE>

<FILE Run="/bin/bash">
<INLINE>
<![CDATA[
set -e
install_dir="/boot/config/plugins/{repo}"
mkdir -p "$install_dir"
chmod 755 "$install_dir"

# --- 7-Zip runtime dependency (verified, single-use) -------------------------
sevenzip_file="{sevenzip_file}"
sevenzip_sha="{sevenzip_sha}"
sevenzip_url="{sevenzip_url}"
if [[ ! -x /usr/bin/7zzs || "$(sha256sum /usr/bin/7zzs 2>/dev/null | awk '{{print $1}}')" != "$sevenzip_sha" ]]; then
  killall 7zzs >/dev/null 2>&1 || true
  tmp="$(mktemp -d /tmp/{repo}-7z.XXXXXX)"
  curl -fsSL "$sevenzip_url" -o "$tmp/$sevenzip_file"
  actual="$(sha256sum "$tmp/$sevenzip_file" | awk '{{print $1}}')"
  if [[ "$actual" != "$sevenzip_sha" ]]; then
    echo "{repo}: 7-Zip checksum mismatch" >&2
    rm -rf "$tmp"
    exit 1
  fi
  tar -xOf "$tmp/$sevenzip_file" 7zzs > /usr/bin/7zzs
  chmod 755 /usr/bin/7zzs
  rm -rf "$tmp"
fi
# --- end 7-Zip dependency -----------------------------------------------------

upgradepkg --install-new "$install_dir/{pkg}"

# cleanup old package versions
rm -f $(ls "$install_dir"/{repo}-*.txz 2>/dev/null | grep -v "{version}")

echo ""
echo "----------------------------------------------------"
echo " {repo} has been installed."
echo " Version: {version}"
echo "----------------------------------------------------"
echo ""
]]>
</INLINE>
</FILE>

<FILE Run="/bin/bash" Method="remove">
<INLINE>
<![CDATA[
removepkg {repo}

killall 7zzs >/dev/null 2>&1 || true
rm -f /usr/bin/7zzs
rm -rf /usr/local/emhttp/plugins/{repo}

# Keep user configuration and history on remove.
echo "{repo} removed; configuration kept in /boot/config/plugins/{repo}"
]]>
</INLINE>
</FILE>

</PLUGIN>
"""

out = template.format(
    repo=repo, owner=owner, version=version, plugin_url=plugin_url,
    pkg=pkg, pkg_url=pkg_url, sha=sha, changelog=changelog,
    sevenzip_file=sevenzip_file, sevenzip_sha=sevenzip_sha,
    sevenzip_url=sevenzip_url)
open(path, "w").write(out)
print("wrote:", path)
PYEOF

echo "==> Generate $HTML (landing page)"
python3 - "$HTML" "$VERSION" "$PKG_URL" "$CHANGELOG" \
  "$OWNER" "$REPO_NAME" "$PAGES_URL" <<'PYEOF'
import html, re, sys

path, version, pkg_url, changelog_path, owner, repo, pages = sys.argv[1:8]

raw = open(changelog_path).read()
m = re.search(r'(?m)^### ', raw)
body = raw[m.start():] if m else raw.strip()

def esc(s):
    return html.escape(s, quote=True)

# Render the "### version" blocks as an <h2> + <ul>.
parts = []
for block in re.split(r'(?m)^### ', body):
    block = block.strip()
    if not block:
        continue
    lines = block.splitlines()
    header = lines[0].strip()
    items = [l.strip() for l in lines[1:] if l.strip().startswith('-')]
    li = "\n".join(f"      <li>{esc(i[2:].strip())}</li>" for i in items)
    ul = f"\n    <ul>\n{li}\n    </ul>" if items else ""
    parts.append(f"  <section>\n    <h2>{esc(header)}</h2>{ul}\n  </section>")
changelog_html = "\n".join(parts)

page = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{esc(repo)} &mdash; archive extraction for unRAID</title>
  <style>
    :root {{
      color-scheme: light dark;
      --bg: #ffffff; --fg: #1f2328; --muted: #656d76;
      --link: #0969da; --btn-bg: #0969da; --btn-fg: #fff;
      --code-bg: #f6f8fa; --code-border: #d0d7de;
    }}
    @media (prefers-color-scheme: dark) {{
      :root {{
        --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e;
        --link: #4493f8; --btn-bg: #1f6feb; --btn-fg: #fff;
        --code-bg: #161b22; --code-border: #30363d;
      }}
    }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
           line-height: 1.55; max-width: 42rem; margin: 2.5rem auto; padding: 0 1.25rem;
           background: var(--bg); color: var(--fg); }}
    h1 {{ font-size: 1.6rem; margin-bottom: .25rem; }}
    h2 {{ font-size: 1.05rem; margin: 1.5rem 0 .35rem; font-variant-numeric: tabular-nums; }}
    .sub {{ color: var(--muted); margin-top: 0; }}
    a {{ color: var(--link); text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
    code {{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; }}
    ul {{ margin: .35rem 0 0; padding-left: 1.25rem; }}
    .btn {{ display: inline-block; padding: .5rem .9rem; border-radius: 6px;
           background: var(--btn-bg); color: var(--btn-fg); font-weight: 600; }}
    .install {{ background: var(--code-bg); border: 1px solid var(--code-border); border-radius: 8px;
               padding: .75rem 1rem; overflow-x: auto; }}
    footer {{ margin-top: 2rem; color: var(--muted); font-size: .9rem; }}
  </style>
</head>
<body>
  <h1>{esc(repo)}</h1>
  <p class="sub">Archive extraction for the unRAID File Manager.
     <a href="https://github.com/{esc(owner)}/{esc(repo)}">GitHub</a> &middot;
     <a href="https://github.com/{esc(owner)}/{esc(repo)}/blob/main/README.md">README</a></p>
  <p>Current version: <strong>{esc(version)}</strong></p>

  <h2>Install</h2>
  <p>Add this plugin URL in <strong>Settings &rarr; Plugins &rarr; Add/Remove</strong>:</p>
  <div class="install"><code>{esc(pages)}/unraid-unzip.plg</code></div>
  <p>Or download the package directly:
     <a class="btn" href="{esc(pkg_url)}">{esc(repo)}-{esc(version)}.txz</a></p>

  <h2>Changelog</h2>
{changelog_html}

  <footer>
    <p><em>Built for a single use-case. Use at your own risk. See the
       <a href="https://github.com/{esc(owner)}/{esc(repo)}/blob/main/README.md#disclaimer">disclaimer</a>.</em></p>
  </footer>
</body>
</html>
"""
open(path, "w").write(page)
print("wrote:", path)
PYEOF

echo "==> Done"
echo "plg   : $PLG"
echo "html  : $HTML"
echo "sha   : $SHA256"
echo "pkg   : $PKG_NAME"
echo "url   : $PLUGIN_URL"
