// Noise that is marketing/technical for a music file name: "official"
// phrases, video/audio/lyric tags, resolution tags (4K/HD/HDR), restore
// tags, channel names. Version-distinguishing qualifiers (feat., remix,
// live, acoustic, instrumental) are intentionally NOT in these lists, so
// they survive in both the search result and the downloaded file name.

// A parenthesised/bracketed group containing any of these markers is
// dropped as a whole ("Official Music Video", "4K", "Lyrics", "Hi-Def").
const GROUP_NOISE = /\b(official(?:ly)?|video|audio|lyrics?|music|only|4k|8k|hd|hdr|uhd|fhd|hls|vevo|restored|restoration|film|definition|colorized|colourized|hires|hi-?res|hi-?def|remaster(?:ed|ing)?|visualizer|visualisation|visualisierung|60fps|30fps|lossless)\b/i;

// Unambiguous technical/marketing terms removed even free-standing.
// Deliberately excludes standalone "video"/"audio"/"music"/"lyrics" so real
// titles like "Video" or "Audio Adventures" are not gutted.
const WORD_NOISE = new RegExp(
  '\\b(' + [
    'official(?:ly)?(?:\\s+(?:music|video|audio|song|theme|lyrics?))?(?:\\s+(?:video|audio|song|music|lyrics?))?',
    '4k', '8k', 'uhd', 'fhd', 'hls', 'hd(?:r)?',
    '60fps', '30fps',
    'film\\s+restored',
    'restored', 'restoration',
    'hi(?:gh)?[-\\s]?def(?:inition)?',
    'hi-?res(?:olution)?',
    'high\\s+definition',
    'visualizer', 'visualisation', 'visualisierung',
    'colorized', 'colourized',
    'remaster(?:ed|ing)?',
    'lossless',
    'vevo',
  ].join('|') + ')\\b',
  'gi'
);

function stripNoise(s) {
  // Drop bracketed groups that carry a technical marker, keep the rest.
  s = s.replace(/\[([^\]]*)\]|\(([^)]*)\)/g, (m, a, b) => {
    const inner = a !== undefined ? a : b;
    return GROUP_NOISE.test(inner) ? ' ' : m;
  });
  s = s.replace(WORD_NOISE, ' ');
  s = s.replace(/\[\s*\]|\(\s*\)/g, ' ');
  s = s.replace(/\s+/g, ' ');
  s = s.trim();
  // drop separators left dangling after a removal
  s = s.replace(/\s*[-\u2013\u2014]+\s*$/, '').trim();
  s = s.replace(/^\s*[-\u2013\u2014]+\s*/, '').trim();
  return s;
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
