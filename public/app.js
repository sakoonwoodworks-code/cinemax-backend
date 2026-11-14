'use strict';
/* CineMax web preview — talks to the same REST API the Android app uses. */

// Ad & Popup Blocker: Intercept malicious popup attempts & external redirect hijacking
const _origOpen = window.open;
window.open = function(url, target, features) {
  if (url && typeof url === 'string') {
    if (!url.startsWith('/') && !url.startsWith(window.location.origin)) {
      console.warn('[AdBlock] Blocked third-party ad popup:', url);
      return null;
    }
  }
  return _origOpen ? _origOpen.call(window, url, target, features) : null;
};

// Prevent external ad redirects from hijacking the CineMax tab while watching
window.addEventListener('beforeunload', (e) => {
  const p = document.getElementById('playerModal');
  if (p && p.classList.contains('open')) {
    e.preventDefault();
    return (e.returnValue = '');
  }
});

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = {
  get token() { return localStorage.getItem('cmx_token'); },
  set token(v) { v == null ? localStorage.removeItem('cmx_token') : localStorage.setItem('cmx_token', v); },
  get profileId() { return localStorage.getItem('cmx_profile'); },
  set profileId(v) { v == null ? localStorage.removeItem('cmx_profile') : localStorage.setItem('cmx_profile', v); },
  get user() { try { return JSON.parse(localStorage.getItem('cmx_user') || 'null'); } catch { return null; } },
  set user(v) { v == null ? localStorage.removeItem('cmx_user') : localStorage.setItem('cmx_user', JSON.stringify(v)); },
};
const state = { home: null, homeKind: '', myList: new Set(), heroIdx: 0, heroTimer: null, searchSort: 'popularity', playingEpisode: null, playingTitle: null, progressTimer: null };

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (store.token) { headers.Authorization = 'Bearer ' + store.token; headers['X-CineMax-Token'] = store.token; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Request timed out. Please check your connection.');
    throw err;
  }
  clearTimeout(timer);
  let data = null; try { data = await res.json(); } catch {}
  if (res.status === 401) { signOut(true); throw new Error((data && data.message) || 'Please sign in.'); }
  if (!res.ok) { const e = new Error((data && data.message) || 'Request failed (' + res.status + ')'); e.code = data && data.error; e.status = res.status; throw e; }
  return data;
}
const fmt = {
  year: t => t.year || '—',
  rating: t => t.rating ? '★ ' + Number(t.rating).toFixed(1) : 'NR',
  runtime: t => t.runtime ? (t.runtime >= 60 ? Math.floor(t.runtime / 60) + 'h ' + (t.runtime % 60) + 'm' : t.runtime + 'm') : '',
  time: s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(sec).padStart(2, '0'); },
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3600); }
function posterUrl(u) {
  if (!u) return '';
  if (u.startsWith('https://image.tmdb.org/') || u.startsWith('http://image.tmdb.org/')) {
    return '/api/proxy/image?url=' + encodeURIComponent(u);
  }
  return u;
}

/* ---------------- auth ---------------- */
function signOut(silent) { store.token = null; store.user = null; store.profileId = null; if (!silent) toast('Signed out.'); openAuth(false); }
function openAuth(isRegister) {
  $('#authModal').classList.add('open');
  setAuthMode(!!isRegister);
}
function closeAuth() { $('#authModal').classList.remove('open'); $('#authError').textContent = ''; }
function setAuthMode(reg) {
  $('#authName').style.display = reg ? 'block' : 'none';
  $('#authTitle').textContent = reg ? 'Create your account' : 'Welcome back';
  $('#authSub').textContent = reg ? 'Join CineMax in seconds.' : 'Sign in to continue watching';
  $('#authSubmit').textContent = reg ? 'Sign Up' : 'Sign In';
  $('#authToggle').innerHTML = reg ? 'Already a member? <b>Sign in</b>' : 'New to CineMax? <b>Sign up</b>';
  $('#authToggle').dataset.mode = reg ? 'login' : 'register';
}
$('#authToggle').addEventListener('click', () => setAuthMode($('#authToggle').dataset.mode === 'register'));
$('#forgotLink').addEventListener('click', async () => {
  const email = $('#authForm input[name=email]').value.trim();
  if (!email) { $('#authError').textContent = 'Enter your email above first, then tap "Forgot password?"'; return; }
  try { const d = await api('/auth/forgot', { method: 'POST', body: { email } }); $('#authError').textContent = d.devToken ? 'Reset token (dev mode): ' + d.devToken : d.message; }
  catch (e) { $('#authError').textContent = e.message; }
});
$('#authForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = ev.target;
  const reg = $('#authSubmit').textContent === 'Sign Up';
  const body = { email: f.email.value.trim(), password: f.password.value };
  if (reg) body.name = f.name.value.trim();
  $('#authError').textContent = '';
  try {
    const d = await api(reg ? '/auth/register' : '/auth/login', { method: 'POST', body });
    store.token = d.token;
    const me = await api('/auth/me');
    store.user = me.user;
    store.profileId = me.profiles[0] && me.profiles[0].id;
    closeAuth(); renderAccount(me); await bootData();
    toast(reg ? 'Welcome to CineMax, ' + me.user.name.split(' ')[0] + '!' : 'Welcome back, ' + me.user.name.split(' ')[0] + '!');
  } catch (e) { $('#authError').textContent = e.message; }
});

/* ---------------- account / profiles ---------------- */
function renderAccount(me) {
  const u = me.user; $('#menuName').textContent = u.name; $('#menuEmail').textContent = u.email;
  $('#avatarBtn').textContent = (u.name || 'D')[0].toUpperCase();
  $('#adminBtn').style.display = u.role === 'admin' ? 'grid' : 'none';
  const list = $('#profileList'); list.innerHTML = '';
  for (const p of me.profiles) {
    const b = document.createElement('button');
    b.className = 'profile-row';
    b.innerHTML = `<span class="avatar" style="background:${esc(p.avatarColor)};width:30px;height:30px;border-radius:7px;font-size:.8rem">${esc(p.name[0].toUpperCase())}</span><span>${esc(p.name)}</span>${String(store.profileId) === String(p.id) ? '<span class="ptag">ACTIVE</span>' : (p.isKids ? '<span class="ptag" style="background:#12303f;color:#7bd4ff">KIDS</span>' : '')}`;
    b.addEventListener('click', async () => { store.profileId = String(p.id); $('#menu').classList.remove('show'); await bootData(); toast('Switched to profile: ' + p.name); });
    list.appendChild(b);
  }
}
$('#avatarBtn').addEventListener('click', () => $('#menu').classList.toggle('show'));
$('#adminBtn').addEventListener('click', () => { $('#menu').classList.remove('show'); go('admin'); });
$('#menuSignout').addEventListener('click', () => signOut(false));
document.addEventListener('click', e => { if (!e.target.closest('.account')) $('#menu').classList.remove('show'); });

/* ---------------- navigation ---------------- */
const VIEWS = ['home', 'grid', 'mylist', 'downloads', 'search', 'admin'];
function go(view) {
  for (const v of VIEWS) $('#view-' + v).classList.toggle('active', v === view);
  $$('.topnav button').forEach(b => b.classList.toggle('active', b.dataset.nav === view || (view === 'grid' && (b.dataset.nav === 'movies' || b.dataset.nav === 'series')) ));
  window.scrollTo({ top: 0 });
  if (view === 'mylist') loadMyList();
  if (view === 'downloads') loadDownloads();
  if (view === 'admin') loadAdmin();
}
$$('.topnav button').forEach(b => b.addEventListener('click', () => {
  const nav = b.dataset.nav;
  if (nav === 'movies') return openGrid('movie', 'Movies');
  if (nav === 'series') return openGrid('series', 'Web Series & OTT Originals');
  go(nav);
}));

// Home Category Filter Bar (All / Movies / Web Series)
$$('#homeFilterBar button[data-home-kind]').forEach(b => b.addEventListener('click', async () => {
  $$('#homeFilterBar button[data-home-kind]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  state.homeKind = b.dataset.homeKind || '';
  await bootData();
}));

/* ---------------- home ---------------- */
const GENRES = ['All', 'Action', 'Comedy', 'Drama', 'Crime', 'Thriller', 'Sci-Fi', 'Animation', 'Romance', 'Horror', 'Adventure', 'Mystery', 'Family', 'Fantasy'];
async function bootData() {
  let pid = store.profileId;
  if (!pid) {
    try {
      const me = await api('/auth/me');
      if (me.profiles && me.profiles.length > 0) {
        pid = String(me.profiles[0].id);
        store.profileId = pid;
        renderAccount(me);
      }
    } catch {}
    if (!pid) pid = '1';
  }
  try {
    const kindQuery = state.homeKind ? '&kind=' + encodeURIComponent(state.homeKind) : '';
    state.home = await api('/catalog/home?profileId=' + pid + kindQuery);
    renderHero();
    renderRails();
    refreshMyListIds();
  } catch (e) {
    console.error('Failed to load catalog:', e);
    const wrap = $('#heroContent');
    if (wrap) {
      wrap.innerHTML = `
        <div class="hero-kicker">CINEMAX</div>
        <h1 class="hero-title" style="font-size:2rem">Could not load catalog</h1>
        <p class="hero-overview" style="color:#ff6b6b">${esc(e.message || 'Connection failed')}</p>
        <div class="hero-actions" style="margin-top:16px">
          <button class="btn btn-primary" onclick="bootData()">↻ Retry</button>
        </div>
      `;
    }
    toast('Error loading catalog: ' + e.message);
  }
}
async function refreshMyListIds() { try { const d = await api('/user/mylist?profileId=' + store.profileId); state.myList = new Set(d.items.map(i => i.id)); } catch {} }
function renderHero() {
  const f = (state.home && state.home.featured) || [];
  const wrap = $('#heroContent');
  if (!f.length) { wrap.innerHTML = '<div class="hero-kicker">CINEMAX</div><h1 class="hero-title">Your cinema is loading…</h1>'; return; }
  const t = f[state.heroIdx % f.length];
  $('#heroBackdrop').style.backgroundImage = `url('${esc(t.backdrop)}')`;
  wrap.innerHTML = `
    <div class="hero-kicker">${t.kind === 'series' ? 'CINEMAX SERIES' : 'CINEMAX FEATURE'} · #${state.heroIdx % f.length + 1} POPULAR</div>
    <h1 class="hero-title">${esc(t.title)}</h1>
    <div class="hero-meta">
      <span class="badge-rating">★ ${t.rating ? Number(t.rating).toFixed(1) : 'NR'}</span>
      <span>${esc(t.year || '')}</span>
      <span>${esc((t.genres || []).slice(0, 3).join(' · '))}</span>
      <span class="badge-chip">${esc(t.maturity)}</span>
      <span class="badge-chip">${esc(t.quality)}</span>
      ${t.playable ? '<span class="badge-chip" style="border-color:#2fdc7a;color:#7dffb0">▶ PLAYABLE</span>' : ''}
    </div>
    <p class="hero-overview">${esc(t.overview)}</p>
    <div class="hero-actions">
      <button class="btn btn-primary" id="heroPlay">▶&nbsp; Watch Now</button>
      <button class="btn btn-ghost" id="heroInfo">ⓘ&nbsp; More Info</button>
      <button class="icon-circle ${state.myList.has(t.id) ? 'in-list' : ''}" id="heroList" title="Toggle My List">${state.myList.has(t.id) ? '✓' : '+'}</button>
    </div>`;
  $('#heroPlay').addEventListener('click', () => tryPlay(t));
  $('#heroInfo').addEventListener('click', () => openDetails(t.id));
  $('#heroList').addEventListener('click', async () => { await toggleMyList(t); renderHero(); });
  clearInterval(state.heroTimer);
  state.heroTimer = setInterval(() => { state.heroIdx = (state.heroIdx + 1) % f.length; renderHero(); }, 8000);
}
function cardHtml(t) {
  const progress = t.progress && t.progress.fraction ? Math.min(100, Math.round(t.progress.fraction * 100)) : 0;
  return `<div class="card" role="button" tabindex="0" data-id="${t.id}" aria-label="${esc(t.title)}">
    <div class="card-poster">
      <img loading="lazy" referrerpolicy="no-referrer" src="${esc(posterUrl(t.poster))}" alt="${esc(t.title)} poster" onerror="this.onerror=null;this.src='/posters/${esc(t.slug)}.svg'" />
      ${t.playable ? '<span class="card-playable">▶ PLAYABLE</span>' : ''}
      <span class="card-quality">${esc(t.quality || 'HD')}</span>
      ${progress ? `<div class="card-progress"><i style="width:${progress}%"></i></div>` : ''}
    </div>
    <div class="card-meta">
      <div class="card-title">${esc(t.title)}</div>
      <div class="card-sub"><span>${esc(t.year || '')}</span><span>★ ${t.rating ? Number(t.rating).toFixed(1) : 'NR'}</span><span>${esc((t.genres || [])[0] || '')}</span></div>
    </div>
  </div>`;
}
function bindCards(root) {
  $$('.card[data-id]', root).forEach(c => {
    const open = () => openDetails(+c.dataset.id);
    c.addEventListener('click', open);
    c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}
function renderRails() {
  const box = $('#rails'); box.innerHTML = '';
  for (const rail of (state.home && state.home.rails) || []) {
    if (!rail.items.length) continue;
    const sec = document.createElement('section');
    sec.className = 'rail';
    sec.innerHTML = `<div class="rail-head"><h2 class="rail-title">${esc(rail.label)}</h2><span class="rail-count">${rail.items.length} titles</span></div><div class="rail-track">${rail.items.map(cardHtml).join('')}</div>`;
    bindCards(sec);
    box.appendChild(sec);
  }
}

/* ---------------- grid (movies / series) ---------------- */
async function openGrid(kind, title) {
  go('grid');
  $('#gridTitle').textContent = title;
  const chips = $('#genreChips'); chips.innerHTML = '';
  let active = 'All';
  const load = async genre => {
    $$('.chip', chips).forEach(c => c.classList.toggle('active', c.dataset.genre === genre));
    const pid = store.profileId;
    const d = await api(`/titles?kind=${kind}${genre !== 'All' ? '&genre=' + encodeURIComponent(genre) : ''}&sort=popularity&limit=300${pid ? '&kids=0' : ''}`);
    const grid = $('#cardGrid'); grid.innerHTML = d.results.map(cardHtml).join(''); bindCards(grid);
  };
  for (const g of GENRES) { const b = document.createElement('button'); b.className = 'chip' + (g === 'All' ? ' active' : ''); b.textContent = g; b.dataset.genre = g; b.addEventListener('click', () => load(g)); chips.appendChild(b); }
  await load('All');
}

/* ---------------- details modal ---------------- */
function openDetails(id) { loadDetails(id).catch(e => toast(e.message)); }
async function loadDetails(id, pushState = true) {
  const d = await api(`/titles/${id}?profileId=${store.profileId}`);
  const m = $('#detailsModal'); const card = $('#detailsCard');
  const cast = (d.cast || []).slice(0, 8);
  const similar = d.similar || [];
  const seasons = d.seasons || [];
  const progress = d.progress ? Math.round((d.progress.position / Math.max(1, d.progress.duration)) * 100) : 0;
  card.innerHTML = `
    <div class="details-hero" style="background-image:url('${esc(d.backdrop)}')"></div>
    <div class="details-body">
      <h1 class="details-title">${esc(d.title)}</h1>
      <div class="details-meta">
        <span class="badge-rating">★ ${d.rating ? Number(d.rating).toFixed(1) : 'NR'}</span>
        <span>${esc(d.year || '')}</span>
        <span>${esc(fmt.runtime(d.runtime))}</span>
        <span class="badge-chip">${esc(d.maturity)}</span>
        <span class="badge-chip">${esc(d.quality)}</span>
        <span>${esc((d.audioLanguages || []).map(l => String(l).toUpperCase()).join(' / '))}</span>
        ${d.playable ? '<span class="badge-chip" style="border-color:#2fdc7a;color:#7dffb0">LICENSED STREAM</span>' : ''}
      </div>
      <p class="details-overview">${esc(d.overview)}</p>
      <div class="details-actions">
        <button class="btn btn-primary" id="dPlay">${progress ? '▶&nbsp; Resume (' + progress + '%)' : '▶&nbsp; Play'}</button>
        <button class="btn btn-ghost" id="dList">${d.inMyList ? '✓ In My List' : '+ My List'}</button>
        <button class="btn btn-ghost" id="dShare">↗&nbsp; Share</button>
        <button class="btn btn-ghost" id="dDownload">⬇&nbsp; Download</button>
      </div>
      ${!d.playable ? `<div class="unavailable"><b>Streaming currently unavailable.</b><br/>This title’s metadata is shown, but no licensed playback source is configured. The CineMax catalog admin can add an authorized stream from the Admin Dashboard, or configure a licensed provider. External catalogs supply metadata only — never video.</div>` : ''}
      <div class="details-cols">
        <div>
          <div class="menu-label" style="color:var(--muted-2)">TOP CAST</div>
          <div class="cast-row">${cast.map(c => `<div class="cast-chip"><div class="avatar-circle">${esc((c.name || '?').split(' ').map(w => w[0]).slice(0, 2).join(''))}</div><div>${esc(c.name)}</div><div style="color:var(--muted-2)">${esc(c.character || '')}</div></div>`).join('')}</div>
          ${seasons.length ? `<div class="menu-label" style="color:var(--muted-2);margin-top:18px">EPISODES</div>
          <div class="ep-list">${seasons.map(s => s.episodes.map(e => `<div class="ep"><div class="ep-num">${e.episodeNumber}</div><div class="ep-name"><b>${esc(e.name)}</b><br/><span class="muted">${esc(String(e.overview || '').slice(0, 110))}${String(e.overview || '').length > 110 ? '…' : ''}</span></div><span class="ep-rt">${e.runtime}m</span><button class="ep-play" data-ep="${e.id}" data-name="${esc(e.name)}" ${e.playable ? '' : 'disabled title="No licensed source" style="opacity:.35;cursor:not-allowed"'}>▶</button></div>`).join('')).join('')}</div>` : ''}
          ${similar.length ? `<div class="menu-label" style="color:var(--muted-2);margin-top:18px">MORE LIKE THIS</div><div class="similar-row">${similar.map(s => `<div class="mini-card" data-id="${s.id}"><img loading="lazy" referrerpolicy="no-referrer" src="${esc(posterUrl(s.poster))}" alt="${esc(s.title)}"/><div>${esc(s.title)}</div></div>`).join('')}</div>` : ''}
        </div>
        <aside class="details-side">
          <div><b>Director:</b> ${esc(d.director || '—')}</div>
          <div><b>Genres:</b> ${esc((d.genres || []).join(', '))}</div>
          <div><b>Audio:</b> ${esc((d.audioLanguages || []).map(l => String(l).toUpperCase()).join(', '))}</div>
          <div><b>Subtitles:</b> ${esc((d.subtitleLanguages || []).map(l => String(l).toUpperCase()).join(', '))}</div>
          <div><b>Country:</b> ${esc((d.country || []).join(', '))}</div>
          <div><b>Maturity:</b> ${esc(d.maturity)}</div>
          <div><b>License:</b> ${esc(d.license || '—')}</div>
        </aside>
      </div>
    </div>`;
  $('#dPlay').addEventListener('click', () => tryPlay(d, progress));
  $('#dList').addEventListener('click', async () => { await toggleMyList(d); $('#dList').textContent = state.myList.has(d.id) ? '✓ In My List' : '+ My List'; });
  $('#dShare').addEventListener('click', async () => { const url = location.origin + '/#title-' + d.id; try { await navigator.clipboard.writeText(url); toast('Link copied to clipboard.'); } catch { toast(url); } });
  $('#dDownload').addEventListener('click', async () => { try { await api('/user/downloads', { method: 'POST', body: { profileId: +store.profileId, titleId: d.id, quality: '720p' } }); toast('Download queued — see Downloads tab.'); } catch (e) { toast(e.message); } });
  $$('.mini-card', card).forEach(el => el.addEventListener('click', () => loadDetails(+el.dataset.id)));
  $$('.ep-play[data-ep]', card).forEach(btn => btn.addEventListener('click', () => { if (btn.disabled) return; playStream(d, +btn.dataset.ep, btn.dataset.name); }));
  m.classList.add('open');
  document.body.style.overflow = 'hidden';
}
async function toggleMyList(t) {
  const has = state.myList.has(t.id);
  try {
    if (has) { await api(`/user/mylist/${t.id}?profileId=${store.profileId}`, { method: 'DELETE' }); state.myList.delete(t.id); toast('Removed from My List.'); }
    else { await api('/user/mylist', { method: 'POST', body: { profileId: +store.profileId, titleId: t.id } }); state.myList.add(t.id); toast('Added to My List.'); }
  } catch (e) { toast(e.message); }
}

/* ---------------- player ---------------- */
async function tryPlay(t, resumePct) {
  const d = t.streams ? t : await api(`/titles/${t.id}?profileId=${store.profileId}`);
  let episodeId = null, episodeName = null;
  if (d.kind === 'series') {
    const first = (d.seasons || []).flatMap(s => s.episodes).find(e => e.playable);
    if (first) { episodeId = first.id; episodeName = first.name; }
  }
  playStream(d, episodeId, episodeName, resumePct);
}
async function playStream(t, episodeId, episodeName, resumePct) {
  let manifest;
  try { manifest = await api(`/titles/${t.id}/stream${episodeId ? '?episodeId=' + episodeId : ''}`); }
  catch (e) { toast(e.status === 404 ? e.message : 'Could not load stream: ' + e.message); return; }
  $('#detailsModal').classList.remove('open');
  const video = $('#video');
  const iframe = $('#playerIframe');
  const serverPicker = $('#serverPicker');
  const serverSelect = $('#serverSelect');
  
  $('#playerTitle').textContent = t.title + (episodeName ? ' — ' + episodeName : '');
  $('#playerSub').textContent = `${manifest.label || ''} · ${manifest.provider || ''} · ${manifest.license || 'Multi-Source'}`;
  
  const nextBtn = $('#nextEpisodeBtn');
  nextBtn.style.display = 'none';
  if (t.kind === 'series' && episodeId) {
    const eps = (t.seasons || []).flatMap(s => s.episodes);
    const idx = eps.findIndex(e => e.id === episodeId);
    const next = eps.slice(idx + 1).find(e => e.playable);
    if (next) { nextBtn.style.display = 'inline-flex'; nextBtn.onclick = () => playStream(t, next.id, next.name); }
  }

  // Multi-server selector setup
  const servers = manifest.servers || [];
  if (servers.length > 0) {
    serverPicker.style.display = 'flex';
    serverSelect.innerHTML = servers.map((s, idx) => `<option value="${esc(s.url)}">${esc(s.name)}</option>`).join('');
    serverSelect.onchange = () => {
      const selectedUrl = serverSelect.value;
      if (manifest.type === 'embed' || selectedUrl.includes('http')) {
        video.pause();
        video.style.display = 'none';
        iframe.src = selectedUrl;
        iframe.style.display = 'block';
        toast('Switched server: ' + serverSelect.options[serverSelect.selectedIndex].text);
      }
    };
  } else {
    serverPicker.style.display = 'none';
  }

  if (manifest.type === 'embed') {
    // Embed iframe player (VidFast, VidSrc, VsEmbed, Embed.su, etc.)
    video.pause();
    video.style.display = 'none';
    iframe.src = manifest.url;
    iframe.style.display = 'block';
  } else {
    // Standard direct HTML5 video stream (MP4 / HLS / DASH)
    iframe.src = '';
    iframe.style.display = 'none';
    video.style.display = 'block';
    video.src = manifest.url;
    video.load();
    // resume
    try {
      const pr = await api(`/user/progress?profileId=${store.profileId}&titleId=${t.id}&episodeId=${episodeId || 0}`);
      if (pr && pr.progress && pr.progress.position > 15 && pr.progress.position < (pr.progress.duration || Infinity) - 30) video.currentTime = pr.progress.position;
      else if (resumePct) video.currentTime = (video.duration || 0) * (resumePct / 100);
    } catch {}
    video.play().catch(() => {});
    state.playingTitle = { ...t, episodeId, episodeName };
    clearInterval(state.progressTimer);
    state.progressTimer = setInterval(saveProgress, 5000);
    video.onpause = () => saveProgress();
    video.onended = () => { saveProgress(); clearInterval(state.progressTimer); if (nextBtn.style.display !== 'none') toast('Episode finished — next episode ready.'); };
  }

  $('#playerModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}
async function saveProgress() {
  const t = state.playingTitle; const video = $('#video');
  if (!t || !video.duration || !isFinite(video.duration)) return;
  try { await api('/user/progress', { method: 'PUT', body: { profileId: +store.profileId, titleId: t.id, episodeId: t.episodeId || 0, positionSec: video.currentTime, durationSec: video.duration } }); } catch {}
}
function closeModal(id) {
  $('#' + id).classList.remove('open');
  if (!$('.modal.open')) document.body.style.overflow = '';
  if (id === 'playerModal') {
    const v = $('#video'); v.pause(); v.removeAttribute('src'); v.load();
    const ifr = $('#playerIframe'); if (ifr) { ifr.src = 'about:blank'; ifr.style.display = 'none'; }
    clearInterval(state.progressTimer); saveProgress();
  }
}
$$('[data-close]').forEach(el => el.addEventListener('click', () => closeModal(el.dataset.close)));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { $$('.modal.open').forEach(m => closeModal(m.id)); $('#menu').classList.remove('show'); $('#suggest').classList.remove('show'); }
  if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); $('#searchInput').focus(); }
});

/* ---------------- my list / downloads ---------------- */
async function loadMyList() {
  const grid = $('#myListGrid'); grid.innerHTML = '<p class="muted">Loading…</p>';
  try { const d = await api('/user/mylist?profileId=' + store.profileId); grid.innerHTML = d.items.length ? d.items.map(cardHtml).join('') : '<p class="muted">Your list is empty. Tap + My List on any title.</p>'; bindCards(grid); }
  catch (e) { grid.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; }
}
async function loadDownloads() {
  const box = $('#downloadsList'); box.innerHTML = '<p class="muted">Loading…</p>';
  try { const d = await api('/user/downloads?profileId=' + store.profileId);
    box.innerHTML = d.items.length ? d.items.map(i => `<div class="dl-item"><img src="${esc(i.poster)}" alt="${esc(i.title)}"/><div style="flex:1"><b>${esc(i.title)}</b><div class="muted">${esc(i.quality)} · ${esc(i.status)} · ${esc(i.license || '')}</div><div class="dl-bar"><i style="width:${i.status === 'completed' ? 100 : i.progress || 5}%"></i></div></div></div>`).join('') : '<p class="muted">No downloads yet. Open a downloadable title (marked PLAYABLE with CC license) and tap Download.</p>';
    // simulate progress for queued/active downloads (visual; persisted via API)
    d.items.filter(i => i.status !== 'completed').forEach(i => simulateDownload(i));
  } catch (e) { box.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; }
}
function simulateDownload(item) {
  let p = item.progress || 5; item.status = 'downloading';
  const tick = async () => {
    p = Math.min(100, p + 12 + Math.random() * 18);
    const status = p >= 100 ? 'completed' : 'downloading';
    try { await api('/user/downloads/' + item.id, { method: 'PUT', body: { profileId: +store.profileId, status, progress: p } }); } catch {}
    if (status !== 'completed') setTimeout(tick, 650); else if ($('#view-downloads').classList.contains('active')) loadDownloads();
  };
  setTimeout(tick, 500);
}

/* ---------------- search ---------------- */
let suggestTimer = null;
$('#searchInput').addEventListener('input', e => {
  const q = e.target.value.trim();
  const box = $('#suggest');
  clearTimeout(suggestTimer);
  if (q.length < 2) { box.classList.remove('show'); return; }
  suggestTimer = setTimeout(async () => {
    try { const d = await api('/search/suggest?q=' + encodeURIComponent(q));
      box.innerHTML = d.suggestions.map(s => `<button>${esc(s)}</button>`).join('');
      $$('button', box).forEach(b => b.addEventListener('click', () => { $('#searchInput').value = b.textContent; box.classList.remove('show'); runSearch(b.textContent); }));
      box.classList.toggle('show', d.suggestions.length > 0);
    } catch {}
  }, 180);
});
$('#searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') { $('#suggest').classList.remove('show'); runSearch(e.target.value.trim()); } });
$('#sortSelect').addEventListener('change', e => { state.searchSort = e.target.value; const q = $('#searchInput').value.trim(); if (q) runSearch(q); });
async function runSearch(q) {
  if (!q) return;
  go('search');
  $('#searchHeading').textContent = `Results for “${q}”`;
  const grid = $('#searchGrid'); grid.innerHTML = '<p class="muted">Searching…</p>';
  try {
    const d = await api(`/search?q=${encodeURIComponent(q)}&sort=${state.searchSort}&profileId=${store.profileId}&limit=48`);
    $('#searchHeading').textContent = `Results for “${q}” (${d.total})`;
    grid.innerHTML = d.results.length ? d.results.map(cardHtml).join('') : '<p class="muted">No matches. Try a different title, actor, genre or year.</p>';
    bindCards(grid);
  } catch (e) { grid.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; }
}

/* ---------------- admin ---------------- */
async function loadAdmin() {
  try {
    const [stats, users, titles] = await Promise.all([api('/admin/stats'), api('/admin/users'), api('/admin/titles')]);
    $('#adminStats').innerHTML = [
      ['Users', stats.totals.users], ['Active', stats.totals.activeUsers], ['Movies', stats.totals.movies], ['Series', stats.totals.series],
      ['Playable streams', stats.totals.playableStreams], ['Total views', stats.totals.views], ['Searches', stats.totals.searches],
    ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    $('#adminUsers').innerHTML = users.users.map(u => `<div class="trow"><div><b>${esc(u.name)}</b><br/><small>${esc(u.email)} · ${u.profiles} profile(s)</small></div><span class="pill ${u.isActive ? '' : 'off'}">${u.isActive ? 'ACTIVE' : 'DISABLED'}</span><button class="toggle" data-id="${u.id}" data-active="${u.isActive ? 1 : 0}">${u.isActive ? 'Disable' : 'Enable'}</button></div>`).join('');
    $$('#adminUsers .toggle').forEach(b => b.addEventListener('click', async () => { try { await api('/admin/users/' + b.dataset.id + '/status', { method: 'PUT', body: { isActive: b.dataset.active !== '1' } }); toast('User updated.'); loadAdmin(); } catch (e) { toast(e.message); } }));
    $('#adminTop').innerHTML = (stats.mostWatched.length ? stats.mostWatched : []).map(t => `<div class="trow"><div><b>${esc(t.title)}</b><br/><small>${t.views} play(s)</small></div><span class="pill">RANKED</span></div>`).join('') || '<p class="muted">No plays tracked yet — press Play on any title.</p>';
  } catch (e) { $('#adminStats').innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; }
}

// Add User Box Setup
const showAddUserBtn = $('#showAddUserBtn');
const cancelAddUserBtn = $('#cancelAddUserBtn');
const addUserBox = $('#addUserBox');
const addUserForm = $('#addUserForm');

if (showAddUserBtn && addUserBox) {
  showAddUserBtn.addEventListener('click', () => {
    addUserBox.style.display = addUserBox.style.display === 'none' ? 'block' : 'none';
  });
}
if (cancelAddUserBtn && addUserBox) {
  cancelAddUserBtn.addEventListener('click', () => {
    addUserBox.style.display = 'none';
    if (addUserForm) addUserForm.reset();
  });
}
if (addUserForm) {
  addUserForm.addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    const body = {
      name: f.name.value.trim(),
      email: f.email.value.trim(),
      password: f.password.value,
      role: f.role.value
    };
    try {
      const res = await api('/admin/users', { method: 'POST', body });
      f.reset();
      if (addUserBox) addUserBox.style.display = 'none';
      toast(res.message || 'User created successfully!');
      loadAdmin();
    } catch (e) {
      toast('Failed to create user: ' + e.message);
    }
  });
}

// 1-Click TMDB Importer
const tmdbBtn = $('#tmdbSearchBtn');
const tmdbInput = $('#tmdbSearchInput');
const tmdbBox = $('#tmdbResults');

async function searchTmdb() {
  const q = tmdbInput?.value.trim();
  if (!q) return;
  tmdbBox.innerHTML = '<p class="muted">Searching database…</p>';
  try {
    const data = await api('/admin/tmdb/search?q=' + encodeURIComponent(q));
    if (!data.results || !data.results.length) {
      tmdbBox.innerHTML = '<p class="muted">No matching titles found for “' + esc(q) + '”.</p>';
      return;
    }
    tmdbBox.innerHTML = data.results.map(r => `
      <div style="background:#18181c; border-radius:10px; overflow:hidden; border:1px solid #333; display:flex; flex-direction:column;">
        <div style="position:relative; width:100%; aspect-ratio:2/3; background:#000;">
          ${r.poster ? `<img src="${esc(posterUrl(r.poster))}" style="width:100%; height:100%; object-fit:cover;" alt="${esc(r.title)}" />` : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#666;">No Poster</div>'}
          <span style="position:absolute; top:6px; right:6px; background:rgba(0,0,0,0.8); color:#fff; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; text-transform:uppercase;">${esc(r.kind)}</span>
        </div>
        <div style="padding:10px; display:flex; flex-direction:column; flex:1;">
          <b style="font-size:13px; line-height:1.2; margin-bottom:4px; color:#fff;">${esc(r.title)}</b>
          <small style="color:#aaa; margin-bottom:8px;">${r.year || '—'} · ★ ${r.rating ? r.rating.toFixed(1) : 'NR'}</small>
          <div style="margin-top:auto;">
            ${r.alreadyImported
              ? '<button class="btn btn-block" disabled style="opacity:0.85; font-size:11px; padding:6px 8px; background:#122018; color:#00E676; border:1px solid #00E676;">✓ In CineMax</button>'
              : `<button class="btn btn-primary btn-block tmdb-import-btn" data-tmdb="${r.id}" data-kind="${r.kind}" style="font-size:11px; padding:6px 8px;">+ Add to CineMax</button>`}
          </div>
        </div>
      </div>
    `).join('');

    $$('.tmdb-import-btn', tmdbBox).forEach(btn => {
      btn.addEventListener('click', async () => {
        const tmdbId = +btn.dataset.tmdb;
        const kind = btn.dataset.kind;
        btn.disabled = true;
        btn.textContent = 'Importing…';
        try {
          const res = await api('/admin/tmdb/import', { method: 'POST', body: { tmdbId, kind } });
          toast(res.message);
          btn.style.background = '#122018';
          btn.style.color = '#00E676';
          btn.style.border = '1px solid #00E676';
          btn.textContent = '✓ Imported';
          loadAdmin();
        } catch (err) {
          toast(err.message);
          btn.disabled = false;
          btn.textContent = '+ Import to CineMax';
        }
      });
    });
  } catch (err) {
    tmdbBox.innerHTML = '<p class="muted">' + esc(err.message) + '</p>';
  }
}

if (tmdbBtn && tmdbInput) {
  tmdbBtn.addEventListener('click', searchTmdb);
  tmdbInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchTmdb(); });
}
$('#addTitleForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = ev.target; const body = {
    kind: f.kind.value, title: f.title.value.trim(), releaseYear: f.year.value ? +f.year.value : undefined, rating: f.rating.value ? +f.rating.value : undefined,
    genres: f.genres.value.split(',').map(s => s.trim()).filter(Boolean), audioLanguages: f.audioLanguages.value.split(',').map(s => s.trim()).filter(Boolean),
    director: f.director.value.trim() || undefined, license: f.license.value.trim() || undefined,
  };
  try {
    const created = await api('/admin/titles', { method: 'POST', body });
    if (f.streamUrl.value.trim()) await api(`/admin/titles/${created.id}/streams`, { method: 'POST', body: { url: f.streamUrl.value.trim() } });
    f.reset(); toast('Title added to catalog.'); loadAdmin();
  } catch (e) { toast(e.message); }
});

/* ---------------- boot ---------------- */
(async function init() {
  if (!store.token) {
    openAuth(false);
    return;
  }
  try {
    const me = await api('/auth/me');
    store.user = me.user;
    if (!store.profileId || !me.profiles.some(p => String(p.id) === String(store.profileId))) store.profileId = String(me.profiles[0].id);
    renderAccount(me);
    await bootData();
  } catch (e) {
    signOut(true);
  }
})();
