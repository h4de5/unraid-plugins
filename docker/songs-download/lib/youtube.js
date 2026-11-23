const NOISE_SUBS = [
  'remix', 'live', 'official', 'video', 'audio', 'lyrics', 'karaoke',
  'instrumental', 'version', 'edit', 'extended', 'radio', 'club', 'mix',
  '4k', '8k', 'hdr', 'vevo',
];

const NOISE_WORDS = [
  'remix', 'cover', 'official', 'audio', 'video', 'lyrics', 'karaoke',
  'instrumental', 'live', 'version', 'edit', 'extended', 'radio', 'club', 'mix',
  '4k', '8k', 'hdr', 'vevo',
];

function stripNoise(s) {
  // Remove parenthesised/bracketed groups whose inner text contains a noise sub
  s = s.replace(/\[([^\]]*)\]|\(([^)]*)\)/g, (m, a, b) => {
    const inner = (a !== undefined ? a : b).toLowerCase();
    for (const n of NOISE_SUBS) {
      if (inner.indexOf(n) !== -1) return ' ';
    }
    return m;
  });
  const words = NOISE_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  s = s.replace(new RegExp('(?<![A-Za-z])(' + words + ')(?![A-Za-z])', 'giu'), ' ');
  s = s.replace(/\[\s*\]|\(\s*\)/g, ' ');
  s = s.replace(/\s+/g, ' ');
  return s.trim();
}

function sanitizeName(s) {
  s = s.replace(/[\/\\:*?"<>|]/g, ' ');
  s = s.replace(/\s+/g, ' ');
  s = s.trim().replace(/^[ \t\n\r\0\x0b\-_]+|[ \t\n\r\0\x0b\-_]+$/g, '');
  if (s === '') s = 'track';
  if (s.length > 150) s = s.slice(0, 150);
  return s;
}

function makeName(uploader, title) {
  let artist, song;
  const m = title.match(/^\s*(.+?)\s*[-\u2013\u2014]\s+(.+)$/u);
  if (m) {
    artist = m[1].trim();
    song = m[2].trim();
  } else {
    artist = uploader;
    song = title;
  }
  return sanitizeName(artist) + ' - ' + sanitizeName(stripNoise(song));
}

module.exports = { stripNoise, sanitizeName, makeName };
