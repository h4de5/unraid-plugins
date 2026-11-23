const express = require('express');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { makeName, stripNoise, sanitizeName } = require('./lib/youtube');
const { contentType, findCached, cleanupOld } = require('./lib/stream-cache');

const PORT = parseInt(process.env.PORT || '8765', 10);
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || '/downloads';
const TMP_DIR = '/tmp';
const TTL = parseInt(process.env.STREAM_CACHE_TTL_MIN || '60', 10);
const JS_RUNTIME = process.env.JS_RUNTIME || 'node';
const FFMPEG_LOCATION = process.env.FFMPEG_LOCATION || '/usr/bin';

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

try { fs.mkdirSync(DOWNLOAD_DIR, { recursive: true }); } catch (e) { console.error('mkdir DOWNLOAD_DIR failed:', e && e.code, e && e.message); }
cleanupOld(TMP_DIR, TTL);
setInterval(() => cleanupOld(TMP_DIR, TTL), 10 * 60 * 1000);

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

app.get('/search.php', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) { res.json([]); return; }
  try {
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
      unique.push(r);
      if (unique.length >= 24) break;
    }
    res.json(unique);
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
  res.json({
    id, title: lines[0], artist: lines[1], duration: lines[2], thumbnail: lines[3],
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
  res.json({ success: code === 0, rc: code, name: baseName, output: tail.join('\n') });
});

app.get('/version', (req, res) => {
  execFile('/usr/local/bin/yt-dlp', ['--version'], (e, out) => {
    res.json({ yt_dlp: (out || '').trim(), node: process.version, uid: process.getuid(), gid: process.getgid() });
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('songs-download listening on ' + PORT);
});
