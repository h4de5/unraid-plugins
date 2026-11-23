const fs = require('fs');
const path = require('path');

const EXT_TYPES = {
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
};

function contentType(ext) {
  return EXT_TYPES[String(ext).toLowerCase()] || 'audio/octet-stream';
}

function findCached(id, tmpDir) {
  const prefix = path.join(tmpDir, 'yt_preview_' + id + '.');
  // glob manually
  try {
    const files = fs.readdirSync(tmpDir);
    const matches = files.filter((f) => f.startsWith('yt_preview_' + id + '.'));
    if (matches.length) return path.join(tmpDir, matches[0]);
  } catch (e) {
    return '';
  }
  return '';
}

function cleanupOld(tmpDir, ttlMin) {
  const now = Date.now();
  const ttlMs = (ttlMin || 60) * 60 * 1000;
  try {
    const files = fs.readdirSync(tmpDir);
    for (const f of files) {
      if (!f.startsWith('yt_preview_')) continue;
      const full = path.join(tmpDir, f);
      try {
        const st = fs.statSync(full);
        if (now - st.mtimeMs > ttlMs) fs.unlinkSync(full);
      } catch (e) {}
    }
  } catch (e) {}
}

module.exports = { contentType, findCached, cleanupOld, EXT_TYPES };
