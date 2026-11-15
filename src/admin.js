const express = require('express');
const https = require('https');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { adminRequired } = require('./auth');
const { csv, mapTitle, EMAIL_RE } = require('./util');
const { searchOmdb } = require('./omdb');
const { autoIndexTitle } = require('./universalCatalog');

const API_KEY = process.env.TMDB_API_KEY || '844dba0bfd8f3a4f3799f6130ef9e335';

function fetchTmdb(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve({}); }
      });
    }).on('error', () => resolve({}));
  });
}

const router = express.Router();
router.use(adminRequired);

router.get('/stats', (req, res) => {
  const one = sql => db.prepare(sql).get().c;
  const totalMovies = one("SELECT COUNT(*) c FROM titles WHERE kind='movie'");
  const totalSeries = one("SELECT COUNT(*) c FROM titles WHERE kind='series'");
  const totalUsers = one('SELECT COUNT(*) c FROM users');
  const activeUsers = one('SELECT COUNT(*) c FROM users WHERE is_active=1');
  const admins = one("SELECT COUNT(*) c FROM users WHERE role='admin'");
  const streamCount = one('SELECT COUNT(*) c FROM streams');
  const eventCount = ev => db.prepare("SELECT COUNT(*) c FROM analytics_events WHERE event=?").get(ev).c;
  const totalViews = eventCount('play');
  const totalSearches = eventCount('search');
  const mostWatched = db.prepare(`SELECT t.id, t.title, t.slug, COUNT(*) views FROM analytics_events e JOIN titles t ON t.id = CAST(json_extract(e.meta,'$.titleId') AS INTEGER)
    WHERE e.event='play' GROUP BY t.id ORDER BY views DESC LIMIT 10`).all();
  // popularity by genre across history
  const genreCount = new Map();
  for (const r of db.prepare('SELECT t.genres FROM watch_history h JOIN titles t ON t.id=h.title_id').all())
    for (const g of csv(r.genres)) genreCount.set(g, (genreCount.get(g) || 0) + 1);
  const popularGenres = [...genreCount.entries()].sort((a,b) => b[1]-a[1]).slice(0, 8).map(([genre, count]) => ({ genre, count }));
  const langCount = new Map();
  for (const r of db.prepare("SELECT meta FROM analytics_events WHERE event='play'").all()) { try { const m=JSON.parse(r.meta||'{}'); if (m.titleId) { const t=db.prepare('SELECT audio_languages FROM titles WHERE id=?').get(m.titleId); for (const l of csv(t?.audio_languages)) langCount.set(l,(langCount.get(l)||0)+1);} } catch {} }
  const popularLanguages = [...langCount.entries()].sort((a,b) => b[1]-a[1]).slice(0, 8).map(([language, count]) => ({ language, count }));
  const dau = db.prepare("SELECT COUNT(DISTINCT date(created_at)) c FROM analytics_events").get().c;
  res.json({ totals: { users: totalUsers, activeUsers, admins, movies: totalMovies, series: totalSeries, playableStreams: streamCount, views: totalViews, searches: totalSearches, daysTracked: dau }, mostWatched, popularGenres, popularLanguages });
});

router.get('/users', (req, res) => {
  const users = db.prepare(`SELECT u.id,u.name,u.email,u.role,u.is_active,u.created_at,(SELECT COUNT(*) FROM profiles p WHERE p.user_id=u.id) profiles FROM users u ORDER BY u.created_at DESC`).all()
    .map(u => ({ ...u, isActive: !!u.is_active }));
  res.json({ users });
});

router.post('/users', (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || String(name).trim().length < 2) return res.status(400).json({ error: 'VALIDATION', message: 'Name must be at least 2 characters.' });
  if (!email || !EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'VALIDATION', message: 'A valid email is required.' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'VALIDATION', message: 'Password must be at least 8 characters.' });
  const cleanEmail = String(email).trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(cleanEmail);
  if (existing) return res.status(409).json({ error: 'EMAIL_TAKEN', message: 'An account with this email already exists.' });
  
  const userRole = role === 'admin' ? 'admin' : 'user';
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)').run(String(name).trim(), cleanEmail, hash, userRole);
  db.prepare('INSERT INTO profiles (user_id,name,avatar_color) VALUES (?,?,?)').run(info.lastInsertRowid, String(name).trim().split(' ')[0], '#E50914');
  
  const newUser = db.prepare('SELECT id,name,email,role,is_active,created_at FROM users WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json({
    message: `User "${newUser.name}" created successfully as ${newUser.role}.`,
    user: { ...newUser, isActive: !!newUser.is_active, profiles: 1 }
  });
});

router.put('/users/:id/status', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!target) return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
  if (target.role === 'admin' && id === req.user.id) return res.status(400).json({ error: 'VALIDATION', message: 'You cannot disable your own admin account.' });
  db.prepare('UPDATE users SET is_active=? WHERE id=?').run(req.body?.isActive === false ? 0 : 1, id);
  res.json({ message: 'User status updated.' });
});

router.get('/titles', (req, res) => {
  const rows = db.prepare('SELECT * FROM titles ORDER BY kind, title').all();
  const counts = new Map(db.prepare('SELECT title_id, COUNT(*) c FROM streams GROUP BY title_id').all().map(r => [r.title_id, r.c]));
  res.json({ titles: rows.map(r => mapTitle(r, { streamCount: counts.get(r.id) || 0 })) });
});

const TITLE_FIELDS = new Set(['title','overview','release_year','imdb_rating','runtime_min','genres','audio_languages','subtitle_languages','country','director','maturity','quality','popularity','license']);
const SLUG_RE = /^[a-z0-9-]+$/;
function validateTitlePayload(body, { partial = false } = {}) {
  const errors = [];
  if (!partial || body.title !== undefined) {
    if (!body.title || String(body.title).trim().length < 1) errors.push('title is required');
  }
  if (body.kind !== undefined && !['movie','series'].includes(body.kind)) errors.push('kind must be movie or series');
  if (!partial && body.kind === undefined) errors.push('kind is required (movie|series)');
  if (body.slug !== undefined && !SLUG_RE.test(String(body.slug))) errors.push('slug must be lowercase letters, numbers and dashes');
  return errors;
}

router.post('/titles', (req, res) => {
  const b = req.body || {};
  const errors = validateTitlePayload(b);
  if (errors.length) return res.status(400).json({ error: 'VALIDATION', message: errors.join('; ') });
  const slug = b.slug ? String(b.slug) : String(b.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);
  if (db.prepare('SELECT id FROM titles WHERE slug=?').get(slug)) return res.status(409).json({ error: 'SLUG_TAKEN', message: 'A title with this slug already exists.' });
  const info = db.prepare(`INSERT INTO titles (slug,kind,title,overview,release_year,imdb_rating,tmdb_rating,runtime_min,genres,audio_languages,subtitle_languages,country,director,cast_json,maturity,quality,popularity,is_trending,is_popular,is_top_rated,is_featured,is_recently_added,license,allow_download)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(slug, b.kind, String(b.title).trim(), String(b.overview||''), b.releaseYear?Number(b.releaseYear):null, b.rating?Number(b.rating):null, b.rating?Number(b.rating):null, b.runtime?Number(b.runtime):null,
      Array.isArray(b.genres)?b.genres.join(','):(b.genres||''), Array.isArray(b.audioLanguages)?b.audioLanguages.join(','):(b.audioLanguages||''), Array.isArray(b.subtitleLanguages)?b.subtitleLanguages.join(','):(b.subtitleLanguages||''),
      Array.isArray(b.country)?b.country.join(','):(b.country||''), b.director||'', JSON.stringify(Array.isArray(b.cast)?b.cast:(b.cast?String(b.cast).split(',').map(n=>({name:n.trim(),character:''})):[])),
      b.maturity||'PG-13', b.quality||'HD', b.popularity?Number(b.popularity):50, b.trending?1:0, b.popular?1:0, b.topRated?1:0, b.featured?1:0, b.recentlyAdded===false?0:1, b.license||'Admin-added', b.allowDownload?1:0);
  res.status(201).json({ id: info.lastInsertRowid, slug, message: 'Title created.' });
});

router.put('/titles/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM titles WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND', message: 'Title not found.' });
  const b = req.body || {};
  const errors = validateTitlePayload(b, { partial: true });
  if (errors.length) return res.status(400).json({ error: 'VALIDATION', message: errors.join('; ') });
  const map = { title:'title', overview:'overview', releaseYear:'release_year', rating:'imdb_rating', runtime:'runtime_min', director:'director', maturity:'maturity', quality:'quality', popularity:'popularity', license:'license' };
  const sets = [], vals = [];
  for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { sets.push(`${col}=?`); vals.push(b[k]); }
  if (b.genres !== undefined) { sets.push('genres=?'); vals.push(Array.isArray(b.genres)?b.genres.join(','):String(b.genres)); }
  if (b.audioLanguages !== undefined) { sets.push('audio_languages=?'); vals.push(Array.isArray(b.audioLanguages)?b.audioLanguages.join(','):String(b.audioLanguages)); }
  if (b.subtitleLanguages !== undefined) { sets.push('subtitle_languages=?'); vals.push(Array.isArray(b.subtitleLanguages)?b.subtitleLanguages.join(','):String(b.subtitleLanguages)); }
  if (b.cast !== undefined) { sets.push('cast_json=?'); vals.push(JSON.stringify(b.cast)); }
  for (const [k, col] of Object.entries({ trending:'is_trending', popular:'is_popular', topRated:'is_top_rated', featured:'is_featured', recentlyAdded:'is_recently_added', allowDownload:'allow_download' })) if (b[k] !== undefined) { sets.push(`${col}=?`); vals.push(b[k]?1:0); }
  if (!sets.length) return res.status(400).json({ error: 'VALIDATION', message: 'No updatable fields provided.' });
  vals.push(id);
  db.prepare(`UPDATE titles SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  res.json({ message: 'Title updated.' });
});

router.delete('/titles/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM titles WHERE id=?').run(id);
  res.json({ message: 'Title deleted.' });
});

router.post('/titles/:id/streams', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!db.prepare('SELECT id FROM titles WHERE id=?').get(id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'Title not found.' });
  const { url, type, label, audioLanguage, subtitleTracks, qualities, provider, license } = req.body || {};
  if (!url || !/^https:\/\//i.test(String(url))) return res.status(400).json({ error: 'VALIDATION', message: 'A valid https:// stream URL is required. Only HTTPS sources are accepted.' });
  const t = ['mp4','hls','dash'].includes(type) ? type : (String(url).includes('.m3u8') ? 'hls' : String(url).includes('.mpd') ? 'dash' : 'mp4');
  const info = db.prepare('INSERT INTO streams (title_id,url,type,label,audio_language,subtitle_tracks,qualities,provider,license) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, String(url), t, label || 'Full stream', audioLanguage || 'en', Array.isArray(subtitleTracks)?subtitleTracks.join(','):(subtitleTracks||'en'), Array.isArray(qualities)?qualities.join(','):(qualities||'Auto,1080p,720p,480p'), provider || 'Admin-added licensed source', license || 'Provider-licensed');
  res.status(201).json({ id: info.lastInsertRowid, message: 'Stream added.' });
});

router.delete('/streams/:id', (req, res) => {
  db.prepare('DELETE FROM streams WHERE id=?').run(parseInt(req.params.id, 10));
  res.json({ message: 'Stream removed.' });
});

// Multi-API Instant Search for 1-Click Import (TMDB + OMDb)
router.get('/tmdb/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ results: [] });

  const [tmdbData, omdbResults] = await Promise.all([
    fetchTmdb(`https://api.themoviedb.org/3/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(q)}`),
    searchOmdb(q)
  ]);

  const candidates = [];
  for (const r of (tmdbData.results || [])) {
    if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
    const exists = db.prepare('SELECT id FROM titles WHERE tmdb_id=?').get(r.id);
    candidates.push({
      id: r.id,
      tmdbId: r.id,
      imdbId: null,
      title: r.title || r.name,
      kind: r.media_type === 'tv' ? 'series' : 'movie',
      year: parseInt(String(r.release_date || r.first_air_date || '').slice(0, 4), 10) || null,
      rating: r.vote_average ? Number(r.vote_average.toFixed(1)) : null,
      overview: r.overview || '',
      poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
      backdrop: r.backdrop_path ? `https://image.tmdb.org/t/p/w1280${r.backdrop_path}` : null,
      alreadyImported: !!exists,
      localId: exists ? exists.id : null,
      source: 'TMDB'
    });
  }

  for (const o of omdbResults) {
    const exists = db.prepare('SELECT id FROM titles WHERE imdb_id=?').get(o.imdbId);
    candidates.push({
      id: o.imdbId,
      tmdbId: null,
      imdbId: o.imdbId,
      title: o.title,
      kind: o.kind,
      year: o.year,
      rating: o.rating,
      overview: '',
      poster: o.poster,
      backdrop: o.poster,
      alreadyImported: !!exists,
      localId: exists ? exists.id : null,
      source: 'OMDb'
    });
  }

  // Deduplicate
  const seen = new Set();
  const results = [];
  for (const c of candidates) {
    const key = (c.tmdbId ? `tmdb:${c.tmdbId}` : null) || (c.imdbId ? `imdb:${c.imdbId}` : null) || `${(c.title || '').toLowerCase().trim()}:${c.year}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(c);
    }
  }

  res.json({ results });
});

// 1-Click Multi-API Importer (TMDB + OMDb)
router.post('/tmdb/import', async (req, res) => {
  const { tmdbId, imdbId, kind, title } = req.body || {};
  if (!tmdbId && !imdbId) return res.status(400).json({ error: 'VALIDATION', message: 'tmdbId or imdbId is required.' });

  try {
    const titleId = await autoIndexTitle({ tmdbId, imdbId, kind, title });
    if (!titleId) return res.status(404).json({ error: 'NOT_FOUND', message: 'Could not fetch or import title.' });
    const row = db.prepare('SELECT * FROM titles WHERE id=?').get(titleId);
    res.status(201).json({ message: `Successfully imported "${row.title}"!`, id: titleId, title: row.title });
  } catch (err) {
    res.status(500).json({ error: 'IMPORT_ERROR', message: err.message });
  }
});

module.exports = router;
