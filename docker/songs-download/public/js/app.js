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
    if (!Array.isArray(data)) { status.textContent = data.error || 'Fehler'; return; }
    status.textContent = data.length + ' Ergebnisse';
    data.forEach(item => {
      const card = document.createElement('div');
      card.className = 'card';
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
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
      // technical badges (e.g. 4K) are intentionally not shown
      card.appendChild(thumb);

      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = item.displayName || item.title || '';
      card.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'meta';
      const views = abbreviateViews(item.views);
      meta.textContent = [views, item.published].filter(Boolean).join(' · ');
      const link = document.createElement('a');
      link.className = 'videoLink';
      link.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(item.id);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '↗';
      meta.appendChild(link);
      card.appendChild(meta);

      const dl = document.createElement('button');
      dl.className = 'dl';
      dl.textContent = 'Download';
      dl.addEventListener('click', (ev) => { ev.stopPropagation(); download(item.id, dl); });
      card.appendChild(dl);

      results.appendChild(card);
    });
  } catch (err) {
    status.textContent = 'Fehler: ' + err;
  }
});

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
      alert('Download fehlgeschlagen:\n' + (data.output || ''));
    } else {
      btn.textContent = '✓';
    }
  } catch (err) {
    alert('Fehler: ' + err);
  } finally {
    btn.disabled = false;
  }
}