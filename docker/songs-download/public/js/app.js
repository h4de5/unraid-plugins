function abbreviateViews(v) {
  if (!v) return '';
  const m = String(v).match(/([\d.,]+)/);
  if (!m) return v;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (isNaN(n)) return v;
  let suffix = '';
  if (n >= 1e9) { n = n / 1e9; suffix = 'B'; }
  else if (n >= 1e6) { n = n / 1e6; suffix = 'M'; }
  else if (n >= 1e3) { n = n / 1e3; suffix = 'K'; }
  const num = (Math.round(n * 10) / 10).toString().replace(/\.0$/, '');
  return num + suffix + ' views';
}

const results = document.getElementById('results');
const status = document.getElementById('status');
const player = document.getElementById('player');
const playerBar = document.getElementById('playerBar');
const nowPlaying = document.getElementById('nowPlaying');
player.addEventListener('error', () => {
  const e = player.error;
  const msg = e ? ('Media-Fehler ' + e.code + (e.message ? ': ' + e.message : '')) : 'Media-Fehler';
  nowPlaying.textContent = msg;
});

const qInput = document.getElementById('q');
const sugBox = document.getElementById('suggestions');
let sugList = [];
let sugActive = -1;
let sugTimer = null;
let sugAbort = null;
let sugPickBlock = false;

function renderSuggestions() {
  sugBox.innerHTML = '';
  if (!sugList.length) { sugBox.hidden = true; return; }
  sugList.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'sug' + (i === sugActive ? ' active' : '');
    row.setAttribute('role', 'option');
    const mark = document.createElement('span');
    mark.className = 'sug-mark';
    mark.textContent = '\u266A';
    const text = document.createElement('span');
    text.textContent = s;
    row.appendChild(mark);
    row.appendChild(text);
    row.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pickSuggestion(s);
    });
    row.addEventListener('mousemove', () => { setActive(i); });
    sugBox.appendChild(row);
  });
  sugBox.hidden = false;
}

function setActive(i) {
  sugActive = i;
  sugBox.querySelectorAll('.sug').forEach((el, j) => el.classList.toggle('active', j === i));
}

function hideSuggestions() {
  sugActive = -1;
  sugBox.hidden = true;
}

function pickSuggestion(s) {
  sugPickBlock = true;
  qInput.value = s;
  hideSuggestions();
  qInput.focus();
  document.getElementById('searchForm').requestSubmit();
}

function fetchSuggestions(q) {
  if (sugAbort) sugAbort.abort();
  sugAbort = new AbortController();
  fetch('/suggest.php?q=' + encodeURIComponent(q), { signal: sugAbort.signal })
    .then((r) => r.json())
    .then((data) => {
      const seen = {};
      sugList = (Array.isArray(data) ? data : []).filter((s) => {
        if (typeof s !== 'string' || !s.trim() || seen[s.toLowerCase()]) return false;
        seen[s.toLowerCase()] = true;
        return true;
      }).slice(0, 8);
      sugActive = -1;
      renderSuggestions();
    })
    .catch(() => {});
}

qInput.addEventListener('input', () => {
  if (sugPickBlock) { sugPickBlock = false; return; }
  clearTimeout(sugTimer);
  const v = qInput.value.trim();
  if (v.length < 2) { hideSuggestions(); return; }
  sugTimer = setTimeout(() => fetchSuggestions(v), 200);
});

qInput.addEventListener('keydown', (e) => {
  if (sugBox.hidden || !sugList.length) {
    if (e.key === 'Escape') hideSuggestions();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setActive(sugActive < 0 ? 0 : (sugActive + 1) % sugList.length);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setActive(sugActive < 0 ? sugList.length - 1 : (sugActive - 1 + sugList.length) % sugList.length);
  } else if (e.key === 'Enter' && sugActive >= 0) {
    e.preventDefault();
    pickSuggestion(sugList[sugActive]);
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
});

document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#searchForm')) hideSuggestions();
});

qInput.addEventListener('blur', () => {
  setTimeout(hideSuggestions, 150);
});

document.getElementById('searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (sugAbort) sugAbort.abort();
  hideSuggestions();
  const q = document.getElementById('q').value.trim();
  if (!q) return;
  status.textContent = 'Suche...';
  results.innerHTML = '';
  try {
    const res = await fetch('/search.php?q=' + encodeURIComponent(q));
    const data = await res.json();
    if (!res.ok) { status.textContent = (data && data.error) || 'Fehler'; return; }
    const local = (data.local || []);
    const youtube = (data.youtube || []);
    status.textContent = (local.length + ' lokal · ' + youtube.length + ' auf YouTube');

    if (local.length) {
      const h = document.createElement('div');
      h.className = 'section';
      h.textContent = 'Lokal (' + local.length + ')';
      results.appendChild(h);
      local.forEach(item => results.appendChild(makeCard(item, true)));
    }
    if (youtube.length) {
      const h = document.createElement('div');
      h.className = 'section';
      h.textContent = 'YouTube (' + youtube.length + ')';
      results.appendChild(h);
      youtube.forEach(item => results.appendChild(makeCard(item, false)));
    }
    if (!local.length && !youtube.length) status.textContent = 'Keine Treffer.';
  } catch (err) {
    status.textContent = 'Fehler: ' + err;
  }
});

function makeCard(item, isLocal) {
  const card = document.createElement('div');
  card.className = 'card';

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  if (isLocal) {
    const img = document.createElement('img');
    img.src = 'cover.php?id=' + encodeURIComponent(item.id);
    img.alt = '';
    img.addEventListener('error', function handler() {
      img.removeEventListener('error', handler);
      thumb.classList.add('local');
      img.remove();
      thumb.textContent = '\u266A';
    });
    img.addEventListener('click', () => playLocal(item.id, item.name, item.contentType));
    thumb.appendChild(img);
  } else {
    const img = document.createElement('img');
    img.src = item.thumb;
    img.alt = '';
    img.addEventListener('click', () => play(item.id));
    thumb.appendChild(img);

    const timeBadge = document.createElement('span');
    timeBadge.className = 'badge time';
    timeBadge.textContent = item.length || '';
    thumb.appendChild(timeBadge);

    if (item.isOfficial) {
      const b = document.createElement('span');
      b.className = 'badge official';
      b.textContent = 'Official';
      thumb.appendChild(b);
    }
    if (item.isShort) {
      const b = document.createElement('span');
      b.className = 'badge short';
      b.textContent = 'Short';
      thumb.appendChild(b);
    }
    if (item.isCover) {
      const b = document.createElement('span');
      b.className = 'badge cover';
      b.textContent = 'Cover';
      thumb.appendChild(b);
    }
    if (item.already) {
      const b = document.createElement('span');
      b.className = 'badge already';
      b.textContent = 'Lokal vorhanden';
      thumb.appendChild(b);
    }
  }
  card.appendChild(thumb);

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = item.name || item.displayName || item.title || '';
  card.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'meta';
  if (isLocal) {
    meta.textContent = item.artist || 'Lokale Datei';
  } else {
    const views = abbreviateViews(item.views);
    meta.textContent = [views, item.published].filter(Boolean).join(' · ');
    const link = document.createElement('a');
    link.className = 'videoLink';
    link.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(item.id);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '\u2197';
    meta.appendChild(link);
  }
  card.appendChild(meta);

  const dl = document.createElement('button');
  dl.className = 'dl';
  if (isLocal || item.already) {
    dl.className = 'dl disabled';
    dl.textContent = 'Geladen';
    dl.disabled = true;
  } else {
    dl.textContent = 'Download';
    dl.addEventListener('click', (ev) => { ev.stopPropagation(); download(item.id, dl); });
  }
  card.appendChild(dl);

  return card;
}

let currentTrack = null;
let castBase = window.location.origin;

function showPlayerBar() {
  playerBar.hidden = false;
}

function trackLabel(t) {
  return (t.artist ? t.artist + ' - ' : '') + (t.title || '');
}

// Local (phone) playback only. Hidden/ignored while a Cast session is active.
function playLocalOnly(track, startSec) {
  player.hidden = false;
  player.src = track.path;
  if (startSec > 0) { try { player.currentTime = startSec; } catch (e) {} }
  const p = player.play();
  if (p && typeof p.catch === 'function') p.catch(() => {});
}

function pauseLocal() {
  player.pause();
}

// Play a track in whichever mode is active: on the phone by default, or on the
// Chromecast while a session is connected. The phone only ever plays in local
// mode, so it never competes with the receiver.
function startPlay(track, startSec) {
  currentTrack = track;
  showPlayerBar();
  if (castConnected()) {
    pauseLocal();
    loadOnCast(track, startSec);
  } else {
    nowPlaying.textContent = trackLabel(track);
    playLocalOnly(track, startSec);
  }
}

// Resume playback on the phone (e.g. after the Cast session ends).
function resumeLocalAt(pos) {
  if (!currentTrack) return;
  nowPlaying.textContent = trackLabel(currentTrack);
  playLocalOnly(currentTrack, pos || 0);
}

function trackKey(t) { return t ? (t.localId ? 'L:' + t.localId : (t.path || '')) : ''; }
function sameTrack(a, b) { return !!a && !!b && trackKey(a) === trackKey(b); }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function playAt(i) {
  if (i < 0 || i >= queue.length) return;
  currentIdx = i;
  currentTrack = queue[i];
  startPlay(queue[i], 0);
  renderQueue();
}

function enqueue(track) {
  if (queue.length === 0) {
    queue.push(track);
    playAt(0);
  } else {
    queue.push(track);
    renderQueue();
  }
}

function bringToFrontAndPlay(track) {
  const idx = queue.findIndex((t) => sameTrack(t, track));
  if (idx !== -1) queue.splice(idx, 1);
  queue.unshift(track);
  playAt(0);
}

function onTrackClick(track) {
  const idx = queue.findIndex((t) => sameTrack(t, track));
  if (idx !== -1) {
    bringToFrontAndPlay(track);
  } else {
    enqueue(track);
  }
}

function stopPlayback() {
  player.pause();
  try { player.src = ''; } catch (e) {}
  if (castConnected()) { mediaCmd('STOP'); }
  currentTrack = null;
  currentIdx = -1;
  queue = [];
  nowPlaying.textContent = '';
  playerBar.hidden = true;
  renderQueue();
}

function advance() {
  if (advancing) return;
  if (queue.length === 0) { stopPlayback(); return; }
  advancing = true;
  try {
    if (repeat) {
      currentIdx = (currentIdx + 1) % queue.length;
      playAt(currentIdx);
    } else {
      queue.splice(currentIdx, 1);
      if (queue.length === 0) { stopPlayback(); currentIdx = -1; currentTrack = null; return; }
      if (currentIdx >= queue.length) currentIdx = queue.length - 1;
      playAt(currentIdx);
    }
  } finally {
    advancing = false;
  }
  renderQueue();
}

function clearQueue() {
  queue = [];
  currentIdx = -1;
  currentTrack = null;
  player.pause();
  try { player.src = ''; } catch (e) {}
  if (castConnected()) { mediaCmd('STOP'); }
  nowPlaying.textContent = '';
  playerBar.hidden = true;
  renderQueue();
}

function toggleRepeat() {
  repeat = !repeat;
  const btn = document.getElementById('repeatBtn');
  if (btn) btn.classList.toggle('active', repeat);
  renderQueue();
}

function renderQueue() {
  const count = document.getElementById('queueCount');
  if (count) count.textContent = queue.length ? (queue.length + ' in Queue') : '';
  const list = document.getElementById('queueList');
  if (!list) return;
  if (queue.length <= 1) { list.hidden = true; list.innerHTML = ''; return; }
  list.innerHTML = queue.map((t, i) => {
    const isCur = (i === currentIdx);
    return '<div class="qitem' + (isCur ? ' cur' : '') + '" data-idx="' + i + '">' + (isCur ? '\u25B6 ' : '') + escapeHtml(trackLabel(t)) + '</div>';
  }).join('');
  list.hidden = false;
  list.querySelectorAll('.qitem').forEach((el) => {
    el.addEventListener('click', () => {
      const i = parseInt(el.getAttribute('data-idx'), 10);
      if (!isNaN(i) && queue[i]) bringToFrontAndPlay(queue[i]);
    });
  });
}

async function play(id) {
  nowPlaying.textContent = 'Lade Vorschau...';
  showPlayerBar();
  try {
    const res = await fetch('/preview.php?id=' + encodeURIComponent(id));
    const data = await res.json();
    if (data.error) { nowPlaying.textContent = data.error; return; }
    onTrackClick({
      path: 'stream.php?id=' + encodeURIComponent(id),
      contentType: data.contentType || 'audio/mp4',
      title: data.title,
      artist: data.artist || '',
      album: 'Songs Download',
    });
  } catch (err) {
    nowPlaying.textContent = 'Fehler: ' + err;
  }
}

function playLocal(id, name, contentType) {
  const parts = (name || '').split(' - ');
  const artist = parts.length > 1 ? parts[0].trim() : '';
  const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : (name || 'Lokale Datei');
  showPlayerBar();
  onTrackClick({
    path: 'localstream.php?id=' + encodeURIComponent(id),
    contentType: contentType || 'audio/mp4',
    localId: id,
    title,
    artist,
    album: 'Lokale Musik',
  });
}

async function download(id, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  try {
    const res = await fetch('/download.php', {
      method: 'POST',
      headers: {'Content-Type':'application/x-www-form-urlencoded'},
      body: 'id=' + encodeURIComponent(id)
    });
    const data = await res.json();
    if (!data.success) {
      alert('Download fehlgeschlagen\n\n' + (data.reason || data.output || 'Unbekannter Fehler'));
    } else {
      btn.textContent = '✓';
      btn.className = 'dl disabled';
      btn.disabled = true;
    }
  } catch (err) {
    alert('Fehler: ' + err);
  } finally {
    btn.disabled = false;
  }
}

// Google Cast: only available in a secure context (https); the sender SDK is
// loaded from gstatic after that check. The Cast button is hidden otherwise.
const castBtn = document.getElementById('castBtn');
const castControls = document.getElementById('castControls');
const castPlayPause = document.getElementById('castPlayPause');
const castStop = document.getElementById('castStop');
const castSeek = document.getElementById('castSeek');
const castTimeNow = document.getElementById('castTimeNow');
const castTimeDur = document.getElementById('castTimeDur');
const castVolume = document.getElementById('castVolume');
const MEDIA_NS = 'urn:x-cast:com.google.cast.media';
let castCtx = null;
let castMedia = null;   // current Media object on the receiver (for play/pause/seek/volume)
let queue = [];         // ordered list of tracks (current + upcoming)
let currentIdx = -1;    // index of the currently playing track in `queue` (-1 = none)
let repeat = false;     // repeat playlist instead of removing played tracks
let advancing = false;   // guard against re-entrant advance()
let userRequestedCast = false;
let castStatus = null;    // last media status message from the receiver
let castSeeking = false;  // user is dragging the seek bar

function castConnected() {
  return !!castCtx && castCtx.getCastState() === 'CONNECTED';
}

function castFmt(sec) {
  sec = (isFinite(sec) && sec >= 0) ? Math.floor(sec) : 0;
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
function setPlayPauseIcon(playing) {
  if (castPlayPause) castPlayPause.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
}

function loadOnCast(track, startSec) {
  const session = castCtx.getCurrentSession();
  if (!session) return;
  // The receiver is a separate device, so it must reach the stream over the
  // network. Build the absolute URL from castBase (LAN address), not the
  // browser origin (which may be the NPM-Plus https domain).
  let contentId, ct;
  if (track.localId) {
    // Local file: go through the Cast-safe endpoint, which transcodes anything
    // the Stock Receiver cannot decode (e.g. Opus-in-OGG) to MP3.
    contentId = castBase + '/caststream.php?id=' + encodeURIComponent(track.localId);
    ct = 'audio/mpeg';
  } else {
    contentId = castBase + '/' + track.path;
    ct = track.contentType || 'audio/mp4';
  }
  const media = new chrome.cast.media.MediaInfo(contentId, ct);
  media.streamType = chrome.cast.media.StreamType.BUFFERED;
  const meta = new chrome.cast.media.GenericMediaMetadata();
  meta.title = track.title || '';
  meta.artist = track.artist || '';
  meta.albumName = track.album || '';
  media.metadata = meta;
  const req = new chrome.cast.media.LoadRequest(media);
  if (startSec > 0) { req.currentTime = startSec; }
  req.autoplay = true;
  player.hidden = true;
  nowPlaying.textContent = 'Cast: ' + trackLabel(track);
  castStatus = null;
  setPlayPauseIcon(true);
  const p = session.loadMedia(req);
  if (p && typeof p.then === 'function') {
    p.then((m) => { castMedia = m || null; }).catch((err) => {
      nowPlaying.textContent = 'Cast-Fehler: ' + (err && (err.description || err.code) || err);
    });
  } else if (p && typeof p.catch === 'function') {
    p.catch((err) => {
      nowPlaying.textContent = 'Cast-Fehler: ' + (err && (err.description || err.code) || err);
    });
  }
}

// Send a media command to the receiver. Prefer the high-level Media object
// methods (they build the correctly-typed protocol messages internally);
// fall back to a raw MEDIA_NS message only if no Media object is available.
function mediaCmd(command, extra) {
  if (!castCtx) return;
  const session = castCtx.getCurrentSession();
  if (!session) return;
  const media = (session.getMediaSession && session.getMediaSession()) || castMedia;
  const ok = () => {};
  const fail = (e) => { console.warn('cast ' + command + ' failed:', e && (e.code || e)); };
  try {
    if (command === 'PLAY') {
      if (media && typeof media.play === 'function') media.play(null, ok, fail);
      else session.sendMessage(MEDIA_NS, { type: 'PLAY', mediaSessionId: (castStatus && castStatus.mediaSessionId) || 0, requestId: Date.now() }).catch(fail);
    } else if (command === 'PAUSE') {
      if (media && typeof media.pause === 'function') media.pause(null, ok, fail);
      else session.sendMessage(MEDIA_NS, { type: 'PAUSE', mediaSessionId: (castStatus && castStatus.mediaSessionId) || 0, requestId: Date.now() }).catch(fail);
    } else if (command === 'STOP') {
      if (media && typeof media.stop === 'function') media.stop(null, ok, fail);
      else session.sendMessage(MEDIA_NS, { type: 'STOP', mediaSessionId: (castStatus && castStatus.mediaSessionId) || 0, requestId: Date.now() }).catch(fail);
    } else if (command === 'SEEK') {
      const ct = (extra && typeof extra.currentTime === 'number') ? extra.currentTime : 0;
      if (media && typeof media.seek === 'function') {
        const sr = new chrome.cast.media.SeekRequest();
        sr.currentTime = ct;
        media.seek(sr, ok, fail);
      } else {
        session.sendMessage(MEDIA_NS, { type: 'SEEK', mediaSessionId: (castStatus && castStatus.mediaSessionId) || 0, currentTime: ct, requestId: Date.now() }).catch(fail);
      }
    } else if (command === 'VOLUME') {
      const level = (extra && extra.volume && typeof extra.volume.level === 'number') ? extra.volume.level : ((extra && typeof extra.level === 'number') ? extra.level : 0);
      const muted = (extra && extra.volume && typeof extra.volume.muted === 'boolean') ? extra.volume.muted : (level === 0);
      if (media && typeof media.setVolume === 'function') {
        const vol = new chrome.cast.Volume(level, muted);
        if (typeof chrome.cast.media.VolumeRequest === 'function') {
          media.setVolume(new chrome.cast.media.VolumeRequest(vol), ok, fail);
        } else {
          media.setVolume(vol, ok, fail);
        }
      } else if (session && typeof session.setVolume === 'function') {
        Promise.resolve(session.setVolume(level)).catch(fail);
      } else {
        session.sendMessage(MEDIA_NS, { type: 'SET_VOLUME', mediaSessionId: (castStatus && castStatus.mediaSessionId) || 0, volume: { level: level, muted: muted }, requestId: Date.now() }).catch(fail);
      }
    }
  } catch (e) { console.warn('mediaCmd ' + command + ' failed:', e); }
}

// Drive the control bar from a receiver status message.
function applyCastStatus(status) {
  if (!status || !status.playerState) return;
  castStatus = status;
  if (status.playerState === 'PLAYING' || status.playerState === 'PAUSED') {
    setPlayPauseIcon(status.playerState === 'PLAYING');
    const dur = status.duration || 0;
    if (!castSeeking && dur) castSeek.value = Math.round((status.currentTime / dur) * 1000);
    castTimeNow.textContent = castFmt(status.currentTime || 0);
    castTimeDur.textContent = castFmt(dur);
    if (status.volume && typeof status.volume.level === 'number') {
      castVolume.value = Math.round(status.volume.level * 100);
    }
  } else if (status.playerState === 'IDLE') {
    setPlayPauseIcon(false);
    // IDLE is normal after a stop or when the track ends; only real failures
    // (e.g. PLAYBACK_ERROR) are worth surfacing.
    const idle = status.idleReason;
    if (idle && idle !== 'FINISHED' && idle !== 'CANCELED') {
      nowPlaying.textContent = 'Cast-Fehler: ' + idle;
    }
    if (idle === 'FINISHED' && castConnected() && currentIdx !== -1) {
      // track ended on the receiver -> advance the queue
      advance();
    }
  }
}

if (window.isSecureContext && castBtn) {
  // Control-bar wiring. Attached once; the buttons no-op while no session is
  // active (mediaCmd guards on castConnected).
  if (castPlayPause) castPlayPause.addEventListener('click', () => {
    if (!castConnected() || !castStatus) return;
    if (castStatus.playerState === 'PLAYING') mediaCmd('PAUSE'); else mediaCmd('PLAY');
  });
  if (castStop) castStop.addEventListener('click', () => { if (castConnected()) mediaCmd('STOP'); });
  if (castSeek) {
    castSeek.addEventListener('input', () => { castSeeking = true; });
    castSeek.addEventListener('change', () => {
      castSeeking = false;
      if (!castStatus || !castStatus.duration) return;
      mediaCmd('SEEK', { currentTime: (castSeek.value / 1000) * castStatus.duration });
    });
  }
  let castVolTimer = null;
  if (castVolume) castVolume.addEventListener('input', () => {
    clearTimeout(castVolTimer);
    castVolTimer = setTimeout(() => {
      const level = castVolume.value / 100;
      mediaCmd('VOLUME', { volume: { level: level, muted: level === 0 } });
    }, 150);
  });

  (async () => {
    try {
      const res = await fetch('/castconfig');
      const cfg = await res.json();
      if (cfg && cfg.base) castBase = String(cfg.base).replace(/\/+$/, '');
    } catch (e) { /* fall back to the browser origin */ }

    window['__onGCastApiAvailable'] = function(isAvailable) {
      if (!isAvailable) return;
      const ctx = cast.framework.CastContext.getInstance();
      ctx.setOptions({ receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID });
      castCtx = ctx;
      let lastCastPos = 0;
      ctx.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, (event) => {
        const connected = event.castState === 'CONNECTED';
        castBtn.classList.toggle('active', connected);
        castBtn.title = connected ? 'Cast trennen (lokal weiter)' : 'An Chromecast senden';
        if (castControls) castControls.hidden = !connected;
        if (connected) {
          // Follow the receiver's media status for the control bar and to
          // surface real playback errors. Status arrives as a media-namespace
          // message; addMessageListener is the reliable channel for it.
          const session = ctx.getCurrentSession();
          if (session) {
            try { session.addMessageListener(MEDIA_NS, (ns, msg) => applyCastStatus(msg)); } catch (e) {}
          }
          // Ignore the auto-restored session from a previous page load.
          if (!userRequestedCast) return;
          // Entering cast mode: stop the phone and hand the current track to
          // the receiver at the phone's position.
          if (currentTrack) {
            const pos = player.currentTime || 0;
            pauseLocal();
            loadOnCast(currentTrack, pos);
          }
        } else {
          // Leaving cast mode (button tap or receiver drop): back to the phone,
          // resuming where the receiver left off.
          castMedia = null;
          if (currentTrack) {
            let pos = lastCastPos;
            if (!pos && castStatus) { try { pos = castStatus.currentTime || 0; } catch (e) {} }
            resumeLocalAt(pos);
            lastCastPos = 0;
            castStatus = null;
          }
        }
      });
      // The Cast Framework auto-restores the last session on page load. End it
      // again unless the user just asked for a new session, so the receiver
      // does not silently replay and the button reflects reality.
      if (['CONNECTED', 'CONNECTING'].indexOf(ctx.getCastState()) !== -1 && !userRequestedCast) {
        const session = ctx.getCurrentSession();
        if (session) {
          Promise.resolve(session.endSession(true)).catch((err) => {
            nowPlaying.textContent = 'Cast trennen fehlgeschlagen: ' + (err && (err.description || err.code) || err);
          });
        }
      }
      castBtn.hidden = false;
      castBtn.addEventListener('click', () => {
        if (castConnected()) {
          // Remember where the receiver was so the phone can resume there.
          if (castStatus) { try { lastCastPos = castStatus.currentTime || 0; } catch (e) {} }
          userRequestedCast = false;
          const session = ctx.getCurrentSession();
          if (session) {
            Promise.resolve(session.endSession(true)).catch((err) => {
              nowPlaying.textContent = 'Cast trennen fehlgeschlagen: ' + (err && (err.description || err.code) || err);
            });
          }
        } else {
          userRequestedCast = true;
          ctx.requestSession();
        }
      });
    };

    const s = document.createElement('script');
    s.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    s.async = true;
    document.head.appendChild(s);
  })();
}

// ---- Queue controls (always available) -----------------------------
const nextBtn = document.getElementById('nextBtn');
const repeatBtn = document.getElementById('repeatBtn');
const clearQueueBtn = document.getElementById('clearQueueBtn');
if (nextBtn) nextBtn.addEventListener('click', () => { if (queue.length) advance(); });
if (repeatBtn) repeatBtn.addEventListener('click', toggleRepeat);
if (clearQueueBtn) clearQueueBtn.addEventListener('click', clearQueue);

// Auto-advance when local playback ends.
player.addEventListener('ended', () => {
  if (castConnected()) return;
  if (currentIdx !== -1) advance();
});

// Reflect initial repeat state on the button.
if (repeatBtn) repeatBtn.classList.toggle('active', repeat);
