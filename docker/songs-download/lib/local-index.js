// Local index of already-downloaded audio files. Built incrementally: on load
// the saved index (in the container, wiped on rebuild) is read, and only files
// not yet indexed are ffprobed. Indexed files never change, so this is cheap
// after the first build. The index is stored in the container (not the
// downloads folder), keyed by an absolute-path-derived token so the downloads
// directory is never exposed via HTTP.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUDIO_EXT = new Set(['.opus', '.m4a', '.mp3', '.flac', '.ogg', '.oga', '.wav', '.m4b', '.aac']);
const ID_RE = /youtu\.?be(?:\.com)?\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})|youtu\.be\/([A-Za-z0-9_-]{11})/i;

let files = {};    // absPath -> entry
let byId = {};     // token -> absPath
let videoIds = new Set();
let downloadDir = '';
let indexFile = '';
let ffmpegBin = 'ffprobe';
let ffmpegCoverBin = 'ffmpeg';
let coverDir = '';
const coverInflight = new Map(); // token -> Promise<null|string>

function tokenFor(p) { return crypto.createHash('sha1').update(p).digest('hex').slice(0, 16); }

// Word tokenizer: keep letters and digits (incl. Umlauts), split on everything
// else. Used for both the query and the indexed haystack so a token only
// matches a whole word ("dai" does not match "daily"/"daisy").
function tokenize(s) {
  return String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// Lazy per-entry word set, derived from the persisted haystack. Kept out of
// JSON (a Set would serialize to {}); rebuilt on first use after a reload.
function wordsOf(e) {
  if (!(e.words instanceof Set)) e.words = new Set(tokenize(e.haystack));
  return e.words;
}

function extractId(v) {
  if (!v) return '';
  const m = String(v).match(ID_RE);
  if (!m) return '';
  return (m[1] || m[2] || '').toLowerCase();
}

function runFfprobe(file) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    const finish = (o) => { if (!done) { done = true; clearTimeout(timer); resolve(o); } };
    const proc = spawn(ffmpegBin, ['-v', 'quiet', '-show_streams', '-show_format', '-of', 'json', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (x) {} }, 15000);
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('close', () => finish({ out, err }));
    proc.on('error', (e) => finish({ out, err: err + ' ' + e.message }));
  });
}

function tagsFrom(j) {
  const tags = {};
  const pick = (t) => { if (t && typeof t === 'object') { for (const k of Object.keys(t)) tags[k.toLowerCase()] = t[k]; } };
  if (j.format && j.format.tags) pick(j.format.tags);
  if (Array.isArray(j.streams)) { for (const s of j.streams) { if (s && s.tags) pick(s.tags); } }
  return tags;
}

function makeEntry(absPath, tags) {
  const ext = path.extname(absPath).slice(1).toLowerCase();
  const baseName = path.basename(absPath, path.extname(absPath));
  const title = (tags.title || '').trim();
  const artist = (tags.artist || '').trim();
  // Avoid "Shakira - Shakira, Burna Boy - Dai Dai" when the artist is already
  // part of the title.
  const artistInTitle = artist && title.toLowerCase().indexOf(artist.toLowerCase()) !== -1;
  const name = (artist && title && !artistInTitle) ? (artist + ' - ' + title) : (title || baseName);
  const videoId = extractId(tags.purl) || extractId(tags.comment) || '';
  return {
    id: tokenFor(absPath),
    path: absPath,
    ext,
    name,
    artist,
    title,
    videoId,
    haystack: (baseName + ' ' + title + ' ' + artist).toLowerCase(),
  };
}

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && AUDIO_EXT.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
}

async function indexNew(downloadDirPath) {
  const all = [];
  walk(downloadDirPath, all);
  const newFiles = all.filter((p) => !files[p]);
  if (!newFiles.length) return 0;
  const CONC = 24;
  for (let i = 0; i < newFiles.length; i += CONC) {
    const batch = newFiles.slice(i, i + CONC);
    const res = await Promise.all(batch.map(async (p) => {
      const { out } = await runFfprobe(p);
      let tags = {};
      try { tags = tagsFrom(JSON.parse(out)); } catch (e) { tags = {}; }
      return { p, tags };
    }));
    for (const { p, tags } of res) {
      const entry = makeEntry(p, tags);
      files[p] = entry;
      byId[entry.id] = p;
      if (entry.videoId) videoIds.add(entry.videoId);
    }
  }
  save();
  return newFiles.length;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(indexFile), { recursive: true });
    const slim = {};
    for (const p of Object.keys(files)) {
      const e = files[p];
      const { words, ...rest } = e;
      slim[p] = rest;
    }
    const tmp = indexFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ files: slim }, null, 0));
    fs.renameSync(tmp, indexFile);
  } catch (e) { console.error('save index failed:', e && e.message); }
}

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    files = (j && j.files) || {};
    byId = {};
    videoIds = new Set();
    for (const p of Object.keys(files)) {
      const e = files[p];
      byId[e.id] = p;
      if (e.videoId) videoIds.add(e.videoId);
    }
  } catch (e) { files = {}; byId = {}; videoIds = new Set(); }
}

async function init(downloadDirPath, indexFilePath, ffmpegBinPath, ffmpegCoverBinPath, coverDirPath) {
  downloadDir = downloadDirPath;
  indexFile = indexFilePath;
  if (ffmpegBinPath) ffmpegBin = ffmpegBinPath;
  if (ffmpegCoverBinPath) ffmpegCoverBin = ffmpegCoverBinPath;
  if (coverDirPath) {
    coverDir = coverDirPath;
    try { fs.mkdirSync(coverDir, { recursive: true }); } catch (e) { console.error('cover dir failed:', e && e.message); }
  }
  load();
  const known = Object.keys(files).length;
  try {
    const added = await indexNew(downloadDir);
    console.log('local-index: ' + (known + added) + ' files (' + added + ' new)');
  } catch (e) { console.error('local-index build failed:', e && e.message); }
}

function searchLocal(query) {
  const tokens = tokenize(query).filter((t) => t.length > 1);
  if (!tokens.length) return [];
  const out = [];
  for (const p of Object.keys(files)) {
    const e = files[p];
    const words = wordsOf(e);
    if (tokens.every((t) => words.has(t))) {
      out.push({ id: e.id, name: e.name, artist: e.artist, title: e.title, ext: e.ext, local: true, already: true });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function hasVideoId(id) {
  return videoIds.has(String(id || '').toLowerCase());
}

// Input-box suggestions: local entries whose haystack words start with the
// query (prefix match is enough here, unlike the strict word-boundary search).
function suggest(query, limit) {
  const q = String(query || '').toLowerCase().trim();
  if (q.length < 2) return [];
  const out = [];
  for (const p of Object.keys(files)) {
    const e = files[p];
    const words = wordsOf(e);
    for (const w of words) {
      if (w.startsWith(q)) {
        out.push(e.name);
        break;
      }
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out.slice(0, limit || 5);
}

function resolveLocal(id) {
  const p = byId[id];
  return p && files[p] ? files[p] : null;
}

async function addFile(absPath) {
  if (files[absPath]) return files[absPath];
  const { out } = await runFfprobe(absPath);
  let tags = {};
  try { tags = tagsFrom(JSON.parse(out)); } catch (e) { tags = {}; }
  const entry = makeEntry(absPath, tags);
  files[absPath] = entry;
  byId[entry.id] = absPath;
  if (entry.videoId) videoIds.add(entry.videoId);
  save();
  return entry;
}

function count() { return Object.keys(files).length; }

// Extract the first video frame of a local file as a JPEG cover and cache it
// in the container-local cover dir. Files without a video stream (no embedded
// cover) resolve to null. Concurrent calls for the same token share one
// extraction.
function extractCover(token) {
  const finalPath = path.join(coverDir, token + '.jpg');
  if (fs.existsSync(finalPath)) return Promise.resolve(finalPath);
  const existing = coverInflight.get(token);
  if (existing) return existing;
  const job = new Promise((resolve) => {
    // The .jpg extension must survive in the tmp name: ffmpeg infers the
    // output format from the extension.
    const tmpPath = path.join(coverDir, token + '.tmp-' + process.pid + '-' + Date.now() + '.jpg');
    const args = ['-hide_banner', '-loglevel', 'error', '-i', byId[token],
      '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '6',
      '-y', tmpPath];
    const proc = spawn(ffmpegCoverBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (x) {} }, 20000);
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (ok) {
        try { fs.renameSync(tmpPath, finalPath); resolve(finalPath); }
        catch (e) { resolve(null); }
      } else {
        try { fs.unlinkSync(tmpPath); } catch (x) {}
        resolve(null);
      }
    };
    proc.on('close', (code) => finish(code === 0));
    proc.on('error', () => finish(false));
  });
  coverInflight.set(token, job);
  job.finally(() => coverInflight.delete(token));
  return job;
}

module.exports = { init, searchLocal, suggest, hasVideoId, resolveLocal, addFile, count, extractCover };
