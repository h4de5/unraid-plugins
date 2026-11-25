const express = require('express');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { makeName, stripNoise, sanitizeName } = require('./lib/youtube');
const { contentType, findCached, cleanupOld } = require('./lib/stream-cache');
const localIndex = require('./lib/local-index');

const PORT = parseInt(process.env.PORT || '8765', 10);
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || '/downloads';
const TMP_DIR = '/tmp';
const INDEX_FILE = path.join(TMP_DIR, 'songs-download', 'local-index.json');
const TTL = parseInt(process.env.STREAM_CACHE_TTL_MIN || '60', 10);
const JS_RUNTIME = process.env.JS_RUNTIME || 'node';
const FFMPEG_LOCATION = process.env.FFMPEG_LOCATION || '/usr/bin';
// Base URL the Chromecast (a separate LAN client, not the browser) uses to
// fetch audio. Leave empty to make the frontend fall back to the browser
// origin.
const CAST_BASE_URL = (process.env.CAST_BASE_URL || '').trim().replace(/\/+$/, '');
// Map yt-dlp failures to a short, human-readable reason so the UI does not
// just show a raw tool tail.
function downloadError(text) {
  const t = String(text || '');
  if (/sign in to confirm your age|age[- ]restrict|age[- ]gate/i.test(t)) {
    return 'Das Video ist altersbeschränkt und ohne YouTube-Login nicht verfügbar.';
  }
  if (/private video/i.test(t)) return 'Privates Video - nicht herunterladbar.';
  if (/unavailable/i.test(t)) return 'Video nicht verfügbar.';
  if (/403|forbidden|request blocked/i.test(t)) return 'YouTube hat die Anfrage blockiert (403). Versuche es später erneut.';
  return null;
}

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

try { fs.mkdirSync(DOWNLOAD_DIR, { recursive: true }); } catch (e) { console.error('mkdir DOWNLOAD_DIR failed:', e && e.code, e && e.message); }
cleanupOld(TMP_DIR, TTL);
setInterval(() => cleanupOld(TMP_DIR, TTL), 10 * 60 * 1000);

// Build/update the local index of already-downloaded files before the server
// starts listening, so the first search is already complete.

function runYtDlp(args) {
  return new Promise((resolve) => {
    const proc = spawn('/usr/local/bin/yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', (e) => resolve({ code: 1, stdout, stderr: stderr + '\n' + e.message }));
  });
}

// Search suggestions for the input box. Local (already downloaded) matches
// come first, then YouTube's own query completions. Results are cached in
// memory for 10 minutes.
const SUGGEST_TTL_MS = 10 * 60 * 1000;
const suggestCache = new Map();

app.get('/suggest.php', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) { res.json([]); return; }
  const hit = suggestCache.get(q);
  if (hit && hit.at + SUGGEST_TTL_MS > Date.now()) { res.json(hit.list); return; }
  const local = localIndex.suggest(q, 5);
  let yt = [];
  try {
    const r = await fetch(
      'https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt&q=' + encodeURIComponent(q),
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }
    );
    const text = await r.text();
    const m = text.match(/window\.google\.ac\.h\((.*)\)/);
    if (m) {
      const parsed = JSON.parse(m[1]);
      if (Array.isArray(parsed) && Array.isArray(parsed[1])) {
        yt = parsed[1].map((s) => (Array.isArray(s) ? s[0] : s)).filter((s) => typeof s === 'string');
      }
    }
  } catch (e) { /* suggestion endpoint is optional */ }
  const seen = {};
  const list = [];
  for (const s of local.concat(yt)) {
    const k = String(s).toLowerCase();
    if (!s || seen[k]) continue;
    seen[k] = true;
    list.push(s);
    if (list.length >= 8) break;
  }
  suggestCache.set(q, { at: Date.now(), list });
  res.json(list);
});

app.get('/search.php', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) { res.json([]); return; }
  try {
    const local = localIndex.searchLocal(q);
    const payload = JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00' } }, query: q });
    const r = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: payload,
    });
    const data = await r.json();
    const results = [];
    function collect(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(collect); return; }
      if (node.videoRenderer && node.videoRenderer.videoId) {
        const vr = node.videoRenderer;
        const thumbs = vr.thumbnail && vr.thumbnail.thumbnails;
        let thumb = '';
        if (Array.isArray(thumbs) && thumbs.length) thumb = (thumbs[thumbs.length - 1].url || '');
        let title = '';
        if (vr.title && vr.title.runs && vr.title.runs[0]) title = vr.title.runs[0].text || '';
        else if (vr.title && vr.title.simpleText) title = vr.title.simpleText;
        const published = (vr.publishedTimeText && vr.publishedTimeText.simpleText) || '';
        const views = (vr.viewCountText && vr.viewCountText.simpleText) || '';
        const length = (vr.lengthText && vr.lengthText.simpleText) || '';
        const badges = [];
        for (const b of (vr.badges || [])) if (b.metadataBadgeRenderer && b.metadataBadgeRenderer.label) badges.push(b.metadataBadgeRenderer.label);
        const ownerBadges = [];
        for (const b of (vr.ownerBadges || [])) {
          if (b.metadataBadgeRenderer && b.metadataBadgeRenderer.label) ownerBadges.push(b.metadataBadgeRenderer.label);
          else if (b.metadataBadgeRenderer && b.metadataBadgeRenderer.tooltip) ownerBadges.push(b.metadataBadgeRenderer.tooltip);
        }
        let isShort = false;
        if (length) {
          const parts = length.split(':');
          let secs = 0, ok = true;
          for (const p of parts) { if (!/^\d+$/.test(p)) { ok = false; break; } secs = secs * 60 + parseInt(p, 10); }
          if (ok && secs > 0 && secs <= 60) isShort = true;
        }
        const isCover = /cover/i.test(title);
        const isOfficial = ownerBadges.indexOf('Official Artist Channel') !== -1 || /official/i.test(title);
        results.push({ id: vr.videoId, thumb, title, displayName: sanitizeName(stripNoise(title)) || title, published, views, length, badges, ownerBadges, isShort, isCover, isOfficial });
      } else {
        for (const k of Object.keys(node)) collect(node[k]);
      }
    }
    collect(data);
    function durationSeconds(l) {
      const parts = String(l || '').split(':');
      let secs = 0;
      for (const p of parts) { if (!/^\d+$/.test(p)) return 0; secs = secs * 60 + parseInt(p, 10); }
      return secs;
    }
    const seen = {};
    const unique = [];
    for (const r of results) {
      if (seen[r.id]) continue;
      const secs = durationSeconds(r.length);
      if (secs > 0 && (secs <= 60 || secs > 900)) continue;
      seen[r.id] = true;
      r.already = localIndex.hasVideoId(r.id);
      unique.push(r);
      if (unique.length >= 24) break;
    }
    res.json({ local: local.map((x) => Object.assign({}, x, { contentType: contentType(x.ext) })), youtube: unique });
  } catch (e) {
    res.status(502).json({ error: String(e && e.message || e) });
  }
});

app.get('/preview.php', async (req, res) => {
  const id = String(req.query.id || '');
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) { res.status(400).json({ error: 'invalid id' }); return; }
  const url = 'https://www.youtube.com/watch?v=' + id;
  const { code, stdout } = await runYtDlp([
    '--js-runtimes', JS_RUNTIME, '--no-download', '--no-playlist', '-f', 'bestaudio',
    '--print', '%(title)s', '--print', '%(artist,uploader)s', '--print', '%(duration)s', '--print', '%(thumbnail)s',
    url,
  ]);
  const lines = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (code !== 0 || lines.length < 4) { res.status(502).json({ error: 'yt-dlp failed', rc: code }); return; }
  const cached = findCached(id, TMP_DIR);
  const ct = (cached && path.extname(cached)) ? contentType(path.extname(cached).slice(1)) : 'audio/mp4';
  res.json({
    id, title: lines[0], artist: lines[1], duration: lines[2], thumbnail: lines[3],
    contentType: ct,
    stream_url: 'stream.php?id=' + encodeURIComponent(id),
  });
});

app.get('/stream.php', async (req, res) => {
  const id = String(req.query.id || '');
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) { res.status(400).end(); return; }
  let audioFile = findCached(id, TMP_DIR);
  if (!audioFile || !fs.existsSync(audioFile)) {
    const outtmpl = path.join(TMP_DIR, 'yt_preview_' + id + '.%(ext)s');
    const url = 'https://www.youtube.com/watch?v=' + id;
    const r = await runYtDlp([
      '--js-runtimes', JS_RUNTIME, '--no-playlist', '-f', 'bestaudio',
      '-o', outtmpl, url,
    ]);
    if (r.code !== 0) { console.error('stream yt-dlp failed (rc=' + r.code + '):', (r.stderr || '').slice(-500)); res.status(502).end(); return; }
    audioFile = findCached(id, TMP_DIR);
    if (!audioFile || !fs.existsSync(audioFile)) { res.status(502).end(); return; }
  }
  const ext = path.extname(audioFile).slice(1).toLowerCase();
  const ct = contentType(ext);
  const stat = fs.statSync(audioFile);
  const total = stat.size;
  const range = req.headers.range;
  res.setHeader('Content-Type', ct);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Accept-Ranges', 'bytes');
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start, end;
    if (m && m[1] === '' && m[2] !== '') {
      // suffix range: last N bytes
      const suffix = parseInt(m[2], 10);
      start = Math.max(0, total - suffix);
      end = total - 1;
    } else {
      start = (m && m[1] !== '') ? parseInt(m[1], 10) : 0;
      end = (m && m[2] !== '') ? parseInt(m[2], 10) : total - 1;
    }
    if (isNaN(start) || isNaN(end) || start >= total || end >= total || start > end || start < 0) {
      res.status(416).setHeader('Content-Range', 'bytes */' + total).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + total);
    res.setHeader('Content-Length', chunkSize);
    fs.createReadStream(audioFile, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', total);
    fs.createReadStream(audioFile).pipe(res);
  }
});

// Stream a local (already downloaded) file by index token. The downloads dir
// is never served statically; this is the only HTTP path into it.
app.get('/localstream.php', (req, res) => {
  const id = String(req.query.id || '');
  if (!/^[0-9a-f]{16}$/.test(id)) { res.status(400).end(); return; }
  const entry = localIndex.resolveLocal(id);
  if (!entry || !fs.existsSync(entry.path)) { res.status(404).end(); return; }
  const ct = contentType(entry.ext) || 'application/octet-stream';
  const total = fs.statSync(entry.path).size;
  const range = req.headers.range;
  res.setHeader('Content-Type', ct);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Disposition', 'inline; filename="' + entry.path.split('/').pop().replace(/"/g, '') + '"');
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start, end;
    if (m && m[1] === '' && m[2] !== '') {
      const suffix = parseInt(m[2], 10);
      start = Math.max(0, total - suffix);
      end = total - 1;
    } else {
      start = (m && m[1] !== '') ? parseInt(m[1], 10) : 0;
      end = (m && m[2] !== '') ? parseInt(m[2], 10) : total - 1;
    }
    if (isNaN(start) || isNaN(end) || start >= total || end >= total || start > end || start < 0) {
      res.status(416).setHeader('Content-Range', 'bytes */' + total).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + total);
    res.setHeader('Content-Length', chunkSize);
    fs.createReadStream(entry.path, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', total);
    fs.createReadStream(entry.path).pipe(res);
  }
});

// ---- Chromecast local streaming -----------------------------------------
// The Stock Receiver on the target box does not reliably decode Opus-in-OGG
// (the bulk of the local library). MP3 and AAC-in-MP4/M4A decode everywhere,
// so those are served as-is and everything else is transcoded to MP3 192k
// once and cached under /tmp/songs-download/cast/<token>.mp3.
const CAST_DIR = path.join(TMP_DIR, 'songs-download', 'cast');
const CAST_SAFE_EXT = new Set(['mp3', 'm4a', 'm4b']);
const castInFlight = new Map(); // token -> Promise<string>

function runFfmpeg(args) {
  return new Promise((resolve) => {
    let err = '';
    const proc = spawn(path.join(FFMPEG_LOCATION, 'ffmpeg'), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('close', (code) => resolve({ code, err }));
    proc.on('error', (e) => resolve({ code: 1, err: err + ' ' + e.message }));
  });
}

function castFingerprint(p) {
  const st = fs.statSync(p);
  return p + '|' + st.size + '|' + Math.round(st.mtimeMs);
}

// Resolve the file to stream for Cast: the original if already a safe format,
// otherwise a cached MP3 (transcoding on first use).
async function ensureCastMp3(entry) {
  if (CAST_SAFE_EXT.has(entry.ext)) return entry.path;
  const token = entry.id;
  const target = path.join(CAST_DIR, token + '.mp3');
  const metaFile = path.join(CAST_DIR, token + '.meta');
  try {
    if (fs.existsSync(target) && fs.existsSync(metaFile) && fs.readFileSync(metaFile, 'utf8') === castFingerprint(entry.path)) {
      return target;
    }
  } catch (e) {}
  if (castInFlight.has(token)) return castInFlight.get(token);
  const job = (async () => {
    try { fs.mkdirSync(CAST_DIR, { recursive: true }); } catch (e) {}
    const tmp = target + '.tmp.' + process.pid + '.' + Date.now();
    const r = await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', entry.path,
      '-vn', '-map', '0:a:0', '-f', 'mp3', '-acodec', 'libmp3lame', '-b:a', '192k',
      tmp,
    ]);
    if (r.code !== 0 || !fs.existsSync(tmp)) {
      console.error('cast transcode failed (rc=' + r.code + '):', (r.err || '').slice(-500));
      try { fs.unlinkSync(tmp); } catch (e) {}
      throw new Error('transcode failed');
    }
    fs.renameSync(tmp, target);
    try { fs.writeFileSync(metaFile, castFingerprint(entry.path)); } catch (e) {}
    return target;
  })();
  castInFlight.set(token, job);
  try { return await job; } finally { castInFlight.delete(token); }
}

// Serve an audio file with full HTTP Range/206 support (same behaviour as the
// stream.php / localstream.php endpoints).
function serveAudio(res, req, file, ct) {
  const total = fs.statSync(file).size;
  const range = req.headers.range;
  res.setHeader('Content-Type', ct);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Accept-Ranges', 'bytes');
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start, end;
    if (m && m[1] === '' && m[2] !== '') {
      const suffix = parseInt(m[2], 10);
      start = Math.max(0, total - suffix);
      end = total - 1;
    } else {
      start = (m && m[1] !== '') ? parseInt(m[1], 10) : 0;
      end = (m && m[2] !== '') ? parseInt(m[2], 10) : total - 1;
    }
    if (isNaN(start) || isNaN(end) || start >= total || end >= total || start > end || start < 0) {
      res.status(416).setHeader('Content-Range', 'bytes */' + total).end();
      return;
    }
    res.status(206);
    res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + total);
    res.setHeader('Content-Length', end - start + 1);
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', total);
    fs.createReadStream(file).pipe(res);
  }
}

app.get('/caststream.php', async (req, res) => {
  const id = String(req.query.id || '');
  if (!/^[0-9a-f]{16}$/.test(id)) { res.status(400).end(); return; }
  const entry = localIndex.resolveLocal(id);
  if (!entry || !fs.existsSync(entry.path)) { res.status(404).end(); return; }
  let file;
  try {
    file = await ensureCastMp3(entry);
  } catch (e) {
    console.error('caststream failed:', e && e.message);
    res.status(500).end();
    return;
  }
  const ct = CAST_SAFE_EXT.has(entry.ext) ? (contentType(entry.ext) || 'audio/mpeg') : 'audio/mpeg';
  serveAudio(res, req, file, ct);
});

// Serve the extracted JPEG cover for a local file by index token. Extracted
// once per file (ffmpeg first frame) and then served from the container-local
// cover dir. Files without an embedded cover stream return 404.
app.get('/cover.php', async (req, res) => {
  const id = String(req.query.id || '');
  if (!/^[0-9a-f]{16}$/.test(id)) { res.status(400).end(); return; }
  if (!localIndex.resolveLocal(id)) { res.status(404).end(); return; }
  let file = null;
  try { file = await localIndex.extractCover(id); } catch (e) { file = null; }
  if (!file || !fs.existsSync(file)) { res.status(404).end(); return; }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  res.setHeader('Content-Length', fs.statSync(file).size);
  fs.createReadStream(file).pipe(res);
});

app.post('/download.php', async (req, res) => {
  const id = String((req.body && req.body.id) || req.query.id || '');
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) { res.status(400).json({ error: 'invalid id' }); return; }
  const url = 'https://www.youtube.com/watch?v=' + id;
  const meta = await runYtDlp([
    '--js-runtimes', JS_RUNTIME, '--no-download',
    '--ffmpeg-location', FFMPEG_LOCATION,
    '--print', '%(uploader)s', '--print', '%(title)s',
    url,
  ]);
  const metaLines = meta.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let baseName = null;
  if (meta.code === 0 && metaLines.length >= 2) {
    baseName = makeName(metaLines[0], metaLines[1]);
  } else {
    // The video is not downloadable (age-gated, private, unavailable). Return
    // a clear reason now instead of re-running the full (slow) extract step.
    const reason = downloadError(meta.stdout + '\n' + meta.stderr);
    if (reason) {
      res.json({ success: false, rc: meta.code, reason, output: meta.stderr.split(/\r?\n/).filter(Boolean).slice(-5).join('\n') });
      return;
    }
  }
  const year = new Date().getFullYear();
  const outDir = path.join(DOWNLOAD_DIR, String(year));
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) { console.error('mkdirSync failed:', e && e.code, e && e.message); }
  if (!fs.existsSync(outDir)) { res.status(500).json({ error: 'cannot create ' + outDir }); return; }
  const outtmpl = path.join(outDir, (baseName !== null ? baseName : '%(uploader)s - %(title)s') + '.%(ext)s');
  const { code, stdout, stderr } = await runYtDlp([
    '--js-runtimes', JS_RUNTIME, '--no-mtime',
    '--extract-audio', '--audio-format', 'best', '--audio-quality', '0',
    '--embed-metadata', '--embed-thumbnail', '--convert-thumbnails', 'jpg',
    '--parse-metadata', 'id:album',
    '--ffmpeg-location', FFMPEG_LOCATION,
    '--output', outtmpl,
    url,
  ]);
  const output = (stdout + '\n' + stderr).split(/\r?\n/).filter(Boolean);
  const tail = output.slice(-15);
  const reason = code === 0 ? null : downloadError(stdout + '\n' + stderr);
  if (code === 0) {
    // Register the freshly written file in the local index so it shows up in
    // future searches and the matching YouTube result is marked "already".
    try {
      const prefix = (baseName !== null ? baseName : '') + '.';
      const cands = fs.readdirSync(outDir).filter((f) => f.toLowerCase().startsWith(prefix.toLowerCase()));
      if (cands.length) {
        localIndex.addFile(path.join(outDir, cands[0]));
      }
    } catch (e) { console.error('index addFile failed:', e && e.message); }
  }
  res.json({ success: code === 0, rc: code, name: baseName, reason, output: tail.join('\n') });
});

app.get('/version', (req, res) => {
  execFile('/usr/local/bin/yt-dlp', ['--version'], (e, out) => {
    res.json({ yt_dlp: (out || '').trim(), node: process.version, uid: process.getuid(), gid: process.getgid() });
  });
});

// Base URL for the Chromecast receiver to stream from. Empty means the
// frontend falls back to the browser origin (same-origin audio URL).
app.get('/castconfig', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ base: CAST_BASE_URL });
});

localIndex.init(DOWNLOAD_DIR, INDEX_FILE,
  path.join(FFMPEG_LOCATION, 'ffprobe'),
  path.join(FFMPEG_LOCATION, 'ffmpeg'),
  path.join(TMP_DIR, 'songs-download', 'covers'))
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log('songs-download listening on ' + PORT)))
  .catch((e) => {
    console.error('local-index init failed:', e && e.message);
    app.listen(PORT, '0.0.0.0', () => console.log('songs-download listening on ' + PORT));
  });
