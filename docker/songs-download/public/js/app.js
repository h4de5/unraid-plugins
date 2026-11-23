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
const nowPlaying = document.getElementById('nowPlaying');
player.addEventListener('error', () => {
  const e = player.error;
  const msg = e ? ('Media-Fehler ' + e.code + (e.message ? ': ' + e.message : '')) : 'Media-Fehler';
  nowPlaying.textContent = msg;
});

document.getElementById('searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
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
    img.addEventListener('click', () => playLocal(item.id, item.name));
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

async function play(id) {
  nowPlaying.textContent = 'Lade Vorschau...';
  player.hidden = false;
  const streamUrl = 'stream.php?id=' + encodeURIComponent(id);
  if (player.src !== new URL(streamUrl, window.location.href).href) {
    player.src = streamUrl;
  }
  const playPromise = player.play();
  if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
  try {
    const res = await fetch('/preview.php?id=' + encodeURIComponent(id));
    const data = await res.json();
    if (data.error) { nowPlaying.textContent = data.error; player.pause(); return; }
    nowPlaying.textContent = (data.artist ? data.artist + ' - ' : '') + data.title;
  } catch (err) {
    nowPlaying.textContent = 'Fehler: ' + err;
  }
}

function playLocal(id, name) {
  nowPlaying.textContent = 'Lade lokale Datei...';
  player.hidden = false;
  const streamUrl = 'localstream.php?id=' + encodeURIComponent(id);
  player.src = streamUrl;
  const p = player.play();
  if (p && typeof p.catch === 'function') p.catch(() => {});
  nowPlaying.textContent = name || 'Lokale Datei';
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
