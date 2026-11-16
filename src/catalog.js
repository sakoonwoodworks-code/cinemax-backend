const express = require('express');
const db = require('./db');
const { authRequired, publicUser } = require('./auth');
const { csv, mapTitle, kidsFilter, pageParams, track } = require('./util');
const { getPlayerSources, PLAYER_SOURCES } = require('./playerSources');
const { searchUniversal, autoIndexTitle } = require('./universalCatalog');
const { searchOmdb, getOmdbById } = require('./omdb');

const router = express.Router();

function streamCounts() {
  const rows = db.prepare('SELECT title_id, COUNT(*) c FROM streams GROUP BY title_id').all();
  const m = new Map(); for (const r of rows) m.set(r.title_id, r.c); return m;
}
function mapRows(rows) {
  const counts = streamCounts();
  return rows.map(r => mapTitle(r, { streamCount: counts.get(r.id) || 0 }));
}
function profileById(req, res, profileId) {
  const p = db.prepare('SELECT * FROM profiles WHERE id=? AND user_id=?').get(Number(profileId), req.user.id);
  if (!p) res.status(404).json({ error: 'PROFILE_NOT_FOUND', message: 'Profile not found.' });
  return p;
}
function getProfile(req, res) {
  const pid = req.query.profileId || req.body?.profileId;
  if (!pid) { res.status(400).json({ error: 'VALIDATION', message: 'profileId is required.' }); return null; }
  return profileById(req, res, pid);
}

// Query builder shared by /titles and rails
const SORTS = { popularity: 'popularity DESC', rating: 'imdb_rating DESC', newest: 'release_year DESC', title: 'title ASC' };

function filteredQuery(q, isKids) {
  let where = `WHERE 1=1 ${kidsFilter(isKids)}`;
  const args = {};
  if (q.kind === 'movie' || q.kind === 'series') { where += ' AND kind=@kind'; args.kind = q.kind; }
  if (q.genre) { where += " AND ','||genres||',' LIKE '%,'||@genre||',%'"; args.genre = String(q.genre); }
  if (q.language) { where += " AND ','||audio_languages||',' LIKE '%,'||@language||',%'"; args.language = String(q.language); }
  if (q.country) { where += " AND country LIKE '%'||@country||'%'"; args.country = String(q.country); }
  if (q.year) { where += ' AND release_year=@year'; args.year = parseInt(q.year, 10); }
  if (q.minRating) { where += ' AND imdb_rating >= @minRating'; args.minRating = parseFloat(q.minRating); }
  const sort = SORTS[q.sort] || 'popularity DESC';
  return { where, args, sort };
}

router.get('/titles', authRequired, (req, res) => {
  const { page, limit, offset } = pageParams(req.query, 20);
  const isKids = req.query.kids === '1';
  const { where, args, sort } = filteredQuery(req.query, isKids);
  const total = db.prepare(`SELECT COUNT(*) c FROM titles ${where}`).get(args).c;
  const rows = db.prepare(`SELECT * FROM titles ${where} ORDER BY ${sort} LIMIT @limit OFFSET @offset`).all({ ...args, limit, offset });
  res.json({ page, limit, total, totalPages: Math.ceil(total / limit), results: mapRows(rows) });
});

router.get('/titles/:id', authRequired, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM titles WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND', message: 'Title not found.' });
  const streamRows = db.prepare('SELECT * FROM streams WHERE title_id=? ORDER BY id').all(id);
  const epPlayable = row.kind === 'series' ? db.prepare("SELECT COUNT(*) c FROM episodes e JOIN seasons s ON s.id=e.season_id WHERE s.title_id=? AND e.stream_url IS NOT NULL").get(id).c : 0;
  const title = mapTitle(row, { withStreams: true, streamCount: streamRows.length + epPlayable, streams: streamRows });
  // similar: shared genre overlap + same kind, exclude self
  const gs = csv(row.genres);
  const candidates = db.prepare('SELECT * FROM titles WHERE id<>? AND kind=?').all(id, row.kind);
  const scored = candidates.map(c => { const cs = csv(c.genres); const overlap = cs.filter(g => gs.includes(g)).length; return { c, overlap }; })
    .filter(x => x.overlap > 0).sort((a, b) => b.overlap - a.overlap || b.c.popularity - a.c.popularity).slice(0, 12)
    .map(x => x.c);
  title.similar = mapRows(scored);
  if (row.kind === 'series') {
    title.seasons = db.prepare('SELECT * FROM seasons WHERE title_id=? ORDER BY season_number').all(id).map(s => ({
      id: s.id, seasonNumber: s.season_number, name: s.name, episodeCount: s.episode_count,
      episodes: db.prepare('SELECT * FROM episodes WHERE season_id=? ORDER BY episode_number').all(s.id).map(e => ({
        id: e.id, episodeNumber: e.episode_number, name: e.name, overview: e.overview,
        runtime: e.runtime_min, airDate: e.air_date, playable: !!e.stream_url || !!row.tmdb_id, streamType: e.stream_type
      }))
    }));
  }
  // per-profile extras
  const pid = req.query.profileId ? Number(req.query.profileId) : null;
  if (pid) {
    title.inMyList = !!db.prepare('SELECT 1 FROM my_list WHERE profile_id=? AND title_id=?').get(pid, id);
    const pr = db.prepare('SELECT * FROM watch_progress WHERE profile_id=? AND title_id=? AND episode_id=0').get(pid, id);
    title.progress = pr ? { position: pr.position_sec, duration: pr.duration_sec, updatedAt: pr.updated_at } : null;
  }
  track(db, 'view_title', { titleId: id });
  res.json(title);
});

// stream manifest for the player — returns authorized source or TMDB embed servers
router.get('/titles/:id/stream', authRequired, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM titles WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND', message: 'Title not found.' });
  const episodeId = req.query.episodeId ? Number(req.query.episodeId) : 0;
  
  // 1. Direct stream configured in DB
  if (episodeId) {
    const ep = db.prepare('SELECT e.*, s.season_number FROM episodes e JOIN seasons s ON s.id=e.season_id WHERE e.id=?').get(episodeId);
    if (ep && ep.stream_url) {
      track(db, 'play', { titleId: id, episodeId, kind: 'episode' });
      return res.json({ titleId: id, episodeId, url: ep.stream_url, type: ep.stream_type || 'mp4', label: ep.name, qualities: ['1080p', '720p', '480p'], subtitleTracks: ['en', 'hi'], provider: 'CineMax Stream', license: 'Licensed' });
    }
    // Check if TMDB multi-server embed is available for this episode
    if (row.tmdb_id) {
      const sources = getPlayerSources(row, ep);
      if (sources.length > 0) {
        track(db, 'play', { titleId: id, episodeId, kind: 'episode_embed' });
        return res.json({
          titleId: id,
          episodeId,
          url: sources[0].url,
          type: 'embed',
          label: ep ? ep.name : 'Full Episode',
          qualities: ['Auto', '1080p', '720p', '480p'],
          subtitleTracks: ['hi', 'en'],
          provider: sources[0].name,
          license: 'Multi-Source Hindi/Dual-Audio',
          servers: sources
        });
      }
    }
    return res.status(404).json({ error: 'STREAM_UNAVAILABLE', message: 'Streaming currently unavailable for this episode.' });
  }

  const s = db.prepare('SELECT * FROM streams WHERE title_id=? ORDER BY id LIMIT 1').get(id);
  if (s) {
    track(db, 'play', { titleId: id, kind: row.kind });
    const tmdbSources = row.tmdb_id ? getPlayerSources(row) : [];
    return res.json({
      titleId: id,
      episodeId: 0,
      url: s.url,
      type: s.type,
      label: s.label,
      qualities: csv(s.qualities),
      subtitleTracks: csv(s.subtitle_tracks),
      provider: s.provider,
      license: s.license,
      servers: tmdbSources
    });
  }

  // Fallback to TMDB embed sources (VidFast, VidSrc, VsEmbed, Embed.su, etc.)
  if (row.tmdb_id) {
    const sources = getPlayerSources(row);
    if (sources.length > 0) {
      track(db, 'play', { titleId: id, kind: row.kind });
      return res.json({
        titleId: id,
        episodeId: 0,
        url: sources[0].url,
        type: 'embed',
        label: row.title,
        qualities: ['Auto', '1080p', '720p', '480p'],
        subtitleTracks: ['hi', 'en', 'es'],
        provider: sources[0].name,
        license: 'Multi-Source Hindi/Dual-Audio',
        servers: sources
      });
    }
  }

  return res.status(404).json({ error: 'STREAM_UNAVAILABLE', message: 'Streaming currently unavailable for this title.' });
});

router.get('/catalog/home', authRequired, (req, res) => {
  const pid = req.query.profileId ? Number(req.query.profileId) : null;
  let isKids = req.query.kids === '1';
  let profile = null;
  if (pid) { profile = db.prepare('SELECT * FROM profiles WHERE id=? AND user_id=?').get(pid, req.user.id); if (profile) isKids = !!profile.is_kids; }
  const k = kidsFilter(isKids);
  const fallbackWhere = k.trim() ? `WHERE ${k.replace(/^\s*AND\s*/, '')}` : '';
  const rail = (label, sql) => ({ label, items: mapRows(db.prepare(sql).all()) });

  const kind = req.query.kind; // 'movie' | 'series' | undefined

  let featured = [];
  let rails = [];

  if (kind === 'bollywood') {
    // ---------------- DEDICATED BOLLYWOOD SECTION (PURE INDIAN CINEMA ONLY) ----------------
    featured = mapRows(db.prepare(`SELECT * FROM titles WHERE country LIKE '%IN%' AND (country NOT LIKE '%US%' AND country NOT LIKE '%GB%') AND backdrop_url IS NOT NULL AND release_year BETWEEN 2023 AND 2026 ${k} ORDER BY popularity DESC, release_year DESC LIMIT 6`).all());
    if (featured.length === 0) {
      featured = mapRows(db.prepare(`SELECT * FROM titles WHERE country LIKE '%IN%' AND (country NOT LIKE '%US%' AND country NOT LIKE '%GB%') AND backdrop_url IS NOT NULL ${k} ORDER BY popularity DESC, release_year DESC LIMIT 6`).all());
    }
    rails = [
      rail('⚡ Latest 2024–2026 Bollywood Releases', `SELECT * FROM titles WHERE country LIKE '%IN%' AND (country NOT LIKE '%US%' AND country NOT LIKE '%GB%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('🔥 Bollywood Blockbusters & Hits', `SELECT * FROM titles WHERE country LIKE '%IN%' AND (country NOT LIKE '%US%' AND country NOT LIKE '%GB%') AND is_popular=1 ${k} ORDER BY popularity DESC, release_year DESC LIMIT 30`),
      rail('🎬 Hindi Action & High-Octane Thrillers', `SELECT * FROM titles WHERE country LIKE '%IN%' AND (country NOT LIKE '%US%' AND country NOT LIKE '%GB%') AND ','||genres||',' LIKE '%,Action,%' ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('❤️ Bollywood Romance & Drama', `SELECT * FROM titles WHERE country LIKE '%IN%' AND (country NOT LIKE '%US%' AND country NOT LIKE '%GB%') AND (','||genres||',' LIKE '%,Drama,%' OR ','||genres||',' LIKE '%,Romance,%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('😂 Bollywood Comedy Entertainers', `SELECT * FROM titles WHERE country LIKE '%IN%' AND (country NOT LIKE '%US%' AND country NOT LIKE '%GB%') AND ','||genres||',' LIKE '%,Comedy,%' ${k} ORDER BY popularity DESC LIMIT 30`),
      rail('📺 Indian Web Series & OTT Originals', `SELECT * FROM titles WHERE kind='series' AND country LIKE '%IN%' AND (country NOT LIKE '%US%' AND country NOT LIKE '%GB%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('⭐ Top Rated Bollywood (IMDb 7.5+)', `SELECT * FROM titles WHERE country LIKE '%IN%' AND (country NOT LIKE '%US%' AND country NOT LIKE '%GB%') AND imdb_rating >= 7.5 ${k} ORDER BY imdb_rating DESC, popularity DESC LIMIT 30`),
      rail('All Bollywood & Hindi Titles', `SELECT * FROM titles WHERE country LIKE '%IN%' AND (country NOT LIKE '%US%' AND country NOT LIKE '%GB%') ${k} ORDER BY release_year DESC, id DESC LIMIT 60`),
    ];
  } else if (kind === 'hollywood') {
    // ---------------- DEDICATED HOLLYWOOD SECTION (PURE US/UK/WESTERN ONLY) ----------------
    featured = mapRows(db.prepare(`SELECT * FROM titles WHERE (country LIKE '%US%' OR country LIKE '%GB%' OR country LIKE '%CA%' OR country LIKE '%AU%') AND country NOT LIKE '%IN%' AND kind='movie' AND backdrop_url IS NOT NULL AND release_year BETWEEN 2024 AND 2026 ${k} ORDER BY popularity DESC, release_year DESC LIMIT 6`).all());
    if (featured.length === 0) {
      featured = mapRows(db.prepare(`SELECT * FROM titles WHERE (country LIKE '%US%' OR country LIKE '%GB%' OR country LIKE '%CA%' OR country LIKE '%AU%') AND country NOT LIKE '%IN%' AND backdrop_url IS NOT NULL ${k} ORDER BY popularity DESC, release_year DESC LIMIT 6`).all());
    }
    rails = [
      rail('⚡ Latest 2024–2026 Hollywood Releases', `SELECT * FROM titles WHERE (country LIKE '%US%' OR country LIKE '%GB%' OR country LIKE '%CA%' OR country LIKE '%AU%') AND country NOT LIKE '%IN%' ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('🎬 Hollywood Blockbusters', `SELECT * FROM titles WHERE (country LIKE '%US%' OR country LIKE '%GB%' OR country LIKE '%CA%' OR country LIKE '%AU%') AND country NOT LIKE '%IN%' AND is_popular=1 ${k} ORDER BY popularity DESC, release_year DESC LIMIT 30`),
      rail('🚀 Marvel, DC & Superheroes', `SELECT * FROM titles WHERE (country LIKE '%US%' OR country LIKE '%GB%') AND country NOT LIKE '%IN%' AND (title LIKE '%Spider-Man%' OR title LIKE '%Avengers%' OR title LIKE '%Batman%' OR title LIKE '%Deadpool%' OR title LIKE '%Venom%' OR title LIKE '%Wolverine%' OR title LIKE '%Superman%' OR title LIKE '%Thor%' OR title LIKE '%Iron Man%' OR ','||genres||',' LIKE '%,Fantasy,%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('💥 Action, Thriller & Sci-Fi', `SELECT * FROM titles WHERE (country LIKE '%US%' OR country LIKE '%GB%' OR country LIKE '%CA%' OR country LIKE '%AU%') AND country NOT LIKE '%IN%' AND (','||genres||',' LIKE '%,Action,%' OR ','||genres||',' LIKE '%,Sci-Fi,%' OR ','||genres||',' LIKE '%,Science Fiction,%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('⭐ Top Rated Hollywood (IMDb 8+)', `SELECT * FROM titles WHERE (country LIKE '%US%' OR country LIKE '%GB%' OR country LIKE '%CA%' OR country LIKE '%AU%') AND country NOT LIKE '%IN%' AND imdb_rating >= 8.0 ${k} ORDER BY imdb_rating DESC, popularity DESC LIMIT 30`),
      rail('😱 Horror, Mystery & Suspense', `SELECT * FROM titles WHERE (country LIKE '%US%' OR country LIKE '%GB%' OR country LIKE '%CA%' OR country LIKE '%AU%') AND country NOT LIKE '%IN%' AND (','||genres||',' LIKE '%,Horror,%' OR ','||genres||',' LIKE '%,Mystery,%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('All Hollywood Titles', `SELECT * FROM titles WHERE (country LIKE '%US%' OR country LIKE '%GB%' OR country LIKE '%CA%' OR country LIKE '%AU%') AND country NOT LIKE '%IN%' ${k} ORDER BY release_year DESC, id DESC LIMIT 60`),
    ];
  } else if (kind === 'dubbed' || kind === 'south') {
    // ---------------- DEDICATED SOUTH INDIAN & DUBBED SECTION ----------------
    featured = mapRows(db.prepare(`SELECT * FROM titles WHERE country LIKE '%IN%' AND (','||audio_languages||',' LIKE '%,te,%' OR ','||audio_languages||',' LIKE '%,ta,%' OR ','||audio_languages||',' LIKE '%,ml,%' OR ','||audio_languages||',' LIKE '%,kn,%' OR title LIKE '%Pushpa%' OR title LIKE '%Kalki%' OR title LIKE '%K.G.F%' OR title LIKE '%Salaar%' OR title LIKE '%RRR%' OR title LIKE '%Baahubali%' OR title LIKE '%Kantara%' OR title LIKE '%Vikram%' OR title LIKE '%Devara%') AND backdrop_url IS NOT NULL AND release_year >= 2022 ${k} ORDER BY release_year DESC, popularity DESC LIMIT 6`).all());
    rails = [
      rail('⚡ Latest South Indian Hindi Dubbed Hits', `SELECT * FROM titles WHERE country LIKE '%IN%' AND (','||audio_languages||',' LIKE '%,te,%' OR ','||audio_languages||',' LIKE '%,ta,%' OR ','||audio_languages||',' LIKE '%,ml,%' OR ','||audio_languages||',' LIKE '%,kn,%' OR title LIKE '%Pushpa%' OR title LIKE '%Kalki%' OR title LIKE '%K.G.F%' OR title LIKE '%Salaar%' OR title LIKE '%RRR%' OR title LIKE '%Baahubali%' OR title LIKE '%Kantara%' OR title LIKE '%Vikram%' OR title LIKE '%Devara%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('🔥 Pan-India Action Blockbusters', `SELECT * FROM titles WHERE country LIKE '%IN%' AND (','||audio_languages||',' LIKE '%,te,%' OR ','||audio_languages||',' LIKE '%,ta,%' OR ','||audio_languages||',' LIKE '%,ml,%' OR ','||audio_languages||',' LIKE '%,kn,%' OR title LIKE '%Pushpa%' OR title LIKE '%Kalki%' OR title LIKE '%K.G.F%' OR title LIKE '%Salaar%' OR title LIKE '%RRR%' OR title LIKE '%Baahubali%') ${k} ORDER BY popularity DESC, release_year DESC LIMIT 30`),
      rail('💥 South Indian Mass Action', `SELECT * FROM titles WHERE country LIKE '%IN%' AND (','||audio_languages||',' LIKE '%,te,%' OR ','||audio_languages||',' LIKE '%,ta,%') AND ','||genres||',' LIKE '%,Action,%' ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('⭐ Top Rated South Indian (IMDb 8+)', `SELECT * FROM titles WHERE country LIKE '%IN%' AND (','||audio_languages||',' LIKE '%,te,%' OR ','||audio_languages||',' LIKE '%,ta,%' OR ','||audio_languages||',' LIKE '%,ml,%') AND imdb_rating >= 8.0 ${k} ORDER BY imdb_rating DESC, popularity DESC LIMIT 30`),
      rail('All South & Dubbed Titles', `SELECT * FROM titles WHERE country LIKE '%IN%' AND (','||audio_languages||',' LIKE '%,te,%' OR ','||audio_languages||',' LIKE '%,ta,%' OR ','||audio_languages||',' LIKE '%,ml,%' OR ','||audio_languages||',' LIKE '%,kn,%') ${k} ORDER BY release_year DESC, id DESC LIMIT 60`),
    ];
  } else if (kind === 'series') {
    // ---------------- DEDICATED WEB SERIES SECTION ----------------
    featured = mapRows(db.prepare(`SELECT * FROM titles WHERE kind='series' AND backdrop_url IS NOT NULL AND release_year >= 2023 ${k} ORDER BY release_year DESC, popularity DESC LIMIT 6`).all());
    if (featured.length === 0) {
      featured = mapRows(db.prepare(`SELECT * FROM titles WHERE kind='series' AND backdrop_url IS NOT NULL ${k} ORDER BY release_year DESC, popularity DESC LIMIT 6`).all());
    }
    rails = [
      rail('⚡ Latest 2024–2026 Web Series & TV', `SELECT * FROM titles WHERE kind='series' ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('🇮🇳 Indian Web Series & OTT Originals', `SELECT * FROM titles WHERE kind='series' AND country LIKE '%IN%' ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('🔥 Popular Web Series & TV', `SELECT * FROM titles WHERE kind='series' ${k} ORDER BY popularity DESC, release_year DESC LIMIT 30`),
      rail('🇰🇷 Korean Dramas & Series', `SELECT * FROM titles WHERE kind='series' AND (country LIKE '%KR%' OR ','||audio_languages||',' LIKE '%,ko,%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('🇯🇵 Anime & Japanese Animation', `SELECT * FROM titles WHERE kind='series' AND (','||genres||',' LIKE '%,Animation,%' OR country LIKE '%JP%' OR ','||audio_languages||',' LIKE '%,ja,%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('🕵️ Crime, Mafia & Mystery Series', `SELECT * FROM titles WHERE kind='series' AND (','||genres||',' LIKE '%,Crime,%' OR ','||genres||',' LIKE '%,Mystery,%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('🚀 Sci-Fi & Mind-Bending Series', `SELECT * FROM titles WHERE kind='series' AND (','||genres||',' LIKE '%,Sci-Fi,%' OR ','||genres||',' LIKE '%,Science Fiction,%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('⭐ Top Rated Web Series (IMDb 8+)', `SELECT * FROM titles WHERE kind='series' AND imdb_rating >= 8.0 ${k} ORDER BY imdb_rating DESC, popularity DESC LIMIT 30`),
      rail('All Web Series on Server', `SELECT * FROM titles WHERE kind='series' ${k} ORDER BY release_year DESC, id DESC LIMIT 60`),
    ];
  } else if (kind === 'movie') {
    // ---------------- DEDICATED MOVIES SECTION ----------------
    featured = mapRows(db.prepare(`SELECT * FROM titles WHERE kind='movie' AND backdrop_url IS NOT NULL AND release_year >= 2024 ${k} ORDER BY release_year DESC, popularity DESC LIMIT 6`).all());
    if (featured.length === 0) {
      featured = mapRows(db.prepare(`SELECT * FROM titles WHERE kind='movie' AND backdrop_url IS NOT NULL ${k} ORDER BY release_year DESC, popularity DESC LIMIT 6`).all());
    }
    rails = [
      rail('⚡ Latest 2024–2026 Movie Releases', `SELECT * FROM titles WHERE kind='movie' ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('🔥 Trending Movies Now', `SELECT * FROM titles WHERE kind='movie' AND is_trending=1 ${k} ORDER BY popularity DESC, release_year DESC LIMIT 30`),
      rail('🇮🇳 Bollywood Blockbusters', `SELECT * FROM titles WHERE kind='movie' AND country LIKE '%IN%' AND (country NOT LIKE '%US%' AND country NOT LIKE '%GB%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('⚡ South Indian Action Hits', `SELECT * FROM titles WHERE kind='movie' AND country LIKE '%IN%' AND (','||audio_languages||',' LIKE '%,te,%' OR ','||audio_languages||',' LIKE '%,ta,%' OR ','||audio_languages||',' LIKE '%,ml,%' OR ','||audio_languages||',' LIKE '%,kn,%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('🎬 Hollywood Cinema', `SELECT * FROM titles WHERE kind='movie' AND (country LIKE '%US%' OR country LIKE '%GB%') AND country NOT LIKE '%IN%' ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('🚀 Marvel & Superhero Universe', `SELECT * FROM titles WHERE kind='movie' AND (title LIKE '%Spider-Man%' OR title LIKE '%Avengers%' OR title LIKE '%Batman%' OR title LIKE '%Deadpool%' OR title LIKE '%Venom%' OR title LIKE '%Wolverine%' OR title LIKE '%Superman%' OR title LIKE '%Thor%' OR title LIKE '%Iron Man%' OR ','||genres||',' LIKE '%,Fantasy,%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('⭐ Top Rated Masterpieces (IMDb 8+)', `SELECT * FROM titles WHERE kind='movie' AND imdb_rating >= 8.0 ${k} ORDER BY imdb_rating DESC, popularity DESC LIMIT 30`),
      rail('💥 Action & High-Octane Thrillers', `SELECT * FROM titles WHERE kind='movie' AND ','||genres||',' LIKE '%,Action,%' ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('All Available Movies', `SELECT * FROM titles WHERE kind='movie' ${k} ORDER BY release_year DESC, id DESC LIMIT 60`),
    ];
  } else {
    // ---------------- ALL RELEASES (HOME FEED - LATEST BLOCKBUSTERS ON BANNER & TOP) ----------------
    featured = mapRows(db.prepare(`SELECT * FROM titles WHERE backdrop_url IS NOT NULL AND backdrop_url NOT LIKE '%svg%' AND release_year >= 2024 ${k} ORDER BY popularity DESC, release_year DESC LIMIT 6`).all());
    if (featured.length === 0) {
      featured = mapRows(db.prepare(`SELECT * FROM titles WHERE backdrop_url IS NOT NULL AND backdrop_url NOT LIKE '%svg%' AND release_year >= 2023 ${k} ORDER BY popularity DESC, release_year DESC LIMIT 6`).all());
    }
    rails = [
      rail('🔥 Latest 2024–2026 Mega Blockbusters', `SELECT * FROM titles WHERE backdrop_url IS NOT NULL AND release_year >= 2024 ${k} ORDER BY release_year DESC, popularity DESC LIMIT 30`),
      rail('🇮🇳 Bollywood Hits & Blockbusters', `SELECT * FROM titles WHERE country LIKE '%IN%' AND (country NOT LIKE '%US%' AND country NOT LIKE '%GB%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 24`),
      rail('🎬 Hollywood Blockbusters', `SELECT * FROM titles WHERE (country LIKE '%US%' OR country LIKE '%GB%') AND country NOT LIKE '%IN%' ${k} ORDER BY release_year DESC, popularity DESC LIMIT 24`),
      rail('⚡ South Indian (Hindi Dubbed)', `SELECT * FROM titles WHERE country LIKE '%IN%' AND (','||audio_languages||',' LIKE '%,te,%' OR ','||audio_languages||',' LIKE '%,ta,%' OR ','||audio_languages||',' LIKE '%,ml,%' OR ','||audio_languages||',' LIKE '%,kn,%' OR title LIKE '%Pushpa%' OR title LIKE '%Kalki%' OR title LIKE '%K.G.F%' OR title LIKE '%Salaar%' OR title LIKE '%RRR%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 24`),
      rail('📺 Latest Web Series & OTT Releases', `SELECT * FROM titles WHERE kind='series' ${k} ORDER BY release_year DESC, popularity DESC LIMIT 24`),
      rail('🔥 Trending Now', `SELECT * FROM titles WHERE is_trending=1 ${k} ORDER BY popularity DESC, release_year DESC LIMIT 24`),
      rail('Indian Web Series & OTT Originals', `SELECT * FROM titles WHERE kind='series' AND country LIKE '%IN%' ${k} ORDER BY release_year DESC, popularity DESC LIMIT 24`),
      rail('Marvel & Superhero Universe', `SELECT * FROM titles WHERE (title LIKE '%Spider-Man%' OR title LIKE '%Avengers%' OR title LIKE '%Batman%' OR title LIKE '%Deadpool%' OR title LIKE '%Venom%' OR title LIKE '%Wolverine%' OR title LIKE '%Superman%' OR title LIKE '%Thor%' OR title LIKE '%Iron Man%' OR ','||genres||',' LIKE '%,Fantasy,%') ${k} ORDER BY release_year DESC, popularity DESC LIMIT 24`),
      rail('Top Rated Masterpieces (IMDb 8+)', `SELECT * FROM titles WHERE imdb_rating >= 8.0 ${k} ORDER BY imdb_rating DESC, popularity DESC LIMIT 24`),
      rail('Action & High-Octane Thrillers', `SELECT * FROM titles WHERE ','||genres||',' LIKE '%,Action,%' ${k} ORDER BY release_year DESC, popularity DESC LIMIT 24`),
      rail('All Available Server Titles', `SELECT * FROM titles WHERE 1=1 ${k} ORDER BY release_year DESC, id DESC LIMIT 50`),
    ];
  }
  // continue watching + recommended for this profile
  let continueWatching = [];
  let recommended = [];
  if (profile) {
    const prog = db.prepare(`SELECT wp.*, t.* FROM watch_progress wp JOIN titles t ON t.id=wp.title_id
      WHERE wp.profile_id=? AND wp.position_sec>30 AND (wp.duration_sec IS NULL OR wp.position_sec < wp.duration_sec - 20)
      ORDER BY wp.updated_at DESC LIMIT 12`).all(profile.id);
    const counts = streamCounts();
    continueWatching = prog.map(r => ({ ...mapTitle(r, { streamCount: counts.get(r.id) || 0 }), kind: r.kind,
      progress: { position: r.position_sec, duration: r.duration_sec, fraction: r.duration_sec ? Math.min(1, r.position_sec / r.duration_sec) : 0 },
      episodeId: r.episode_id || null }));
    recommended = ruleBasedRecommendations(profile, 12);
  }
  if (continueWatching.length) rails.push({ label: 'Continue Watching', items: continueWatching });
  rails.push({ label: 'Recommended For You', items: recommended.length ? recommended : mapRows(db.prepare(`SELECT * FROM titles ${fallbackWhere} ORDER BY popularity DESC LIMIT 12`).all()) });
  res.json({ featured, rails, kids: isKids });
});

function ruleBasedRecommendations(profile, limit = 12) {
  const historyIds = db.prepare('SELECT DISTINCT title_id FROM watch_history WHERE profile_id=?').all(profile.id).map(r => r.title_id);
  const myListIds = db.prepare('SELECT title_id FROM my_list WHERE profile_id=?').all(profile.id).map(r => r.title_id);
  const liked = new Set([...historyIds, ...myListIds]);
  const likedTitles = liked.size ? db.prepare(`SELECT * FROM titles WHERE id IN (${[...liked].map(() => '?').join(',')})`).all(...liked) : [];
  const genreScore = new Map(), langScore = new Map();
  for (const t of likedTitles) {
    for (const g of csv(t.genres)) genreScore.set(g, (genreScore.get(g) || 0) + 2);
    for (const l of csv(t.audio_languages)) langScore.set(l, (langScore.get(l) || 0) + 1);
  }
  langScore.set(profile.audio_language, (langScore.get(profile.audio_language) || 0) + 2);
  const all = db.prepare('SELECT * FROM titles').all();
  const scored = all.filter(t => !liked.has(t.id)).map(t => {
    let s = t.popularity * 0.02;
    for (const g of csv(t.genres)) s += genreScore.get(g) || 0;
    for (const l of csv(t.audio_languages)) s += langScore.get(l) || 0;
    if (profile.is_kids && !['G','U','PG'].includes(t.maturity)) s = -1;
    return { t, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.t);
  return mapRows(scored);
}

router.get('/recommendations', authRequired, (req, res) => {
  const profile = getProfile(req, res); if (!profile) return;
  const history = db.prepare('SELECT title_id FROM watch_history WHERE profile_id=? ORDER BY watched_at DESC LIMIT 1').get(profile.id);
  let becauseYouWatched = { becauseOf: null, items: [] };
  if (history) {
    const base = db.prepare('SELECT * FROM titles WHERE id=?').get(history.title_id);
    if (base) {
      const gs = csv(base.genres);
      const items = db.prepare('SELECT * FROM titles WHERE id<>?').all(base.id)
        .map(t => ({ t, o: csv(t.genres).filter(g => gs.includes(g)).length }))
        .filter(x => x.o > 0).sort((a, b) => b.o - a.o).slice(0, 12).map(x => x.t);
      becauseYouWatched = { becauseOf: mapTitle(base), items: mapRows(items) };
    }
  }
  const counts = streamCounts();
  const trendingInLanguage = mapRows(db.prepare(`SELECT * FROM titles WHERE is_trending=1 AND ','||audio_languages||',' LIKE '%,'||?||',%' ORDER BY popularity DESC LIMIT 12`).all(profile.audio_language));
  res.json({
    recommendedForYou: ruleBasedRecommendations(profile, 12),
    becauseYouWatched,
    trendingInYourLanguage: trendingInLanguage,
    personalizedFor: { audioLanguage: profile.audio_language, isKids: !!profile.is_kids }
  });
});

router.get('/search', authRequired, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const { page, limit, offset } = pageParams(req.query, 20);
  const isKids = req.query.kids === '1';

  // Real-time Universal Discovery (TMDB + OMDb):
  // When a user searches any title or IMDb ID, automatically find & index it
  if (q.length >= 2) {
    try {
      await searchUniversal(q);
    } catch (err) {
      console.warn('[Search] Universal auto-index error:', err.message);
    }
  }

  let where = 'WHERE 1=1 ' + kidsFilter(isKids);
  const args = {};
  if (q) {
    where += ` AND (title LIKE @q OR director LIKE @q OR cast_json LIKE @q OR genres LIKE @q OR overview LIKE @q OR slug LIKE @q OR imdb_id LIKE @q)`;
    args.q = `%${q}%`;
  }
  if (req.query.genre) { where += " AND ','||genres||',' LIKE '%,'||@genre||',%'"; args.genre = String(req.query.genre); }
  if (req.query.language) { where += " AND ','||audio_languages||',' LIKE '%,'||@language||',%'"; args.language = String(req.query.language); }
  if (req.query.year) { where += ' AND release_year=@year'; args.year = parseInt(req.query.year, 10); }
  if (req.query.country) { where += " AND country LIKE '%'||@country||'%'"; args.country = String(req.query.country); }
  if (req.query.kind === 'movie' || req.query.kind === 'series') { where += ' AND kind=@kind'; args.kind = req.query.kind; }
  const sort = SORTS[req.query.sort] || 'popularity DESC';
  const total = db.prepare(`SELECT COUNT(*) c FROM titles ${where}`).get(args).c;
  const rows = db.prepare(`SELECT * FROM titles ${where} ORDER BY ${sort} LIMIT @limit OFFSET @offset`).all({ ...args, limit, offset });
  const pid = req.query.profileId ? Number(req.query.profileId) : null;
  if (q && pid) db.prepare('INSERT INTO search_history (profile_id, query) VALUES (?,?)').run(pid, q.slice(0, 120));
  track(db, 'search', { q: q.slice(0, 120) });
  res.json({ query: q, page, limit, total, totalPages: Math.ceil(total / limit), results: mapRows(rows) });
});

router.get('/search/suggest', authRequired, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ suggestions: [] });
  const like = `%${q}%`;
  const titles = db.prepare("SELECT title FROM titles WHERE title LIKE ? OR director LIKE ? ORDER BY popularity DESC LIMIT 8").all(like, like).map(r => r.title);
  const actors = [];
  for (const r of db.prepare('SELECT cast_json FROM titles WHERE cast_json LIKE ? LIMIT 25').all(like)) {
    try { for (const c of JSON.parse(r.cast_json)) if (c.name.toLowerCase().includes(q.toLowerCase()) && !actors.includes(c.name)) actors.push(c.name); } catch {}
    if (actors.length >= 6) break;
  }
  res.json({ suggestions: [...new Set([...titles, ...actors])].slice(0, 10) });
});

router.get('/search/history', authRequired, (req, res) => {
  const profile = getProfile(req, res); if (!profile) return;
  const rows = db.prepare('SELECT query, MAX(searched_at) AS last FROM search_history WHERE profile_id=? GROUP BY query ORDER BY last DESC LIMIT 20').all(profile.id);
  res.json({ history: rows.map(r => r.query) });
});

router.delete('/search/history', authRequired, (req, res) => {
  const profile = getProfile(req, res); if (!profile) return;
  db.prepare('DELETE FROM search_history WHERE profile_id=?').run(profile.id);
  res.json({ message: 'Search history cleared.' });
});

router.get('/trending-searches', authRequired, (req, res) => {
  res.json({ searches: ['RRR', 'Interstellar', 'Sacred Games', 'K.G.F', 'Stranger Things', 'Mirzapur', 'Inception', 'Baahubali', 'Dark', 'The Godfather'] });
});

const https = require('https');
const API_KEY = process.env.TMDB_API_KEY || '844dba0bfd8f3a4f3799f6130ef9e335';

function fetchTmdbJson(url) {
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

// 1-Click Multi-API Importer search (TMDB + OMDb) (available to both APK and Web)
router.get('/catalog/tmdb/search', authRequired, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ results: [] });

  const [tmdbData, omdbResults] = await Promise.all([
    fetchTmdbJson(`https://api.themoviedb.org/3/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(q)}`),
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

// 1-Click Multi-API Import action (available to both APK and Web)
router.post('/catalog/tmdb/import', authRequired, async (req, res) => {
  const { tmdbId, imdbId, kind, title } = req.body || {};
  if (!tmdbId && !imdbId) return res.status(400).json({ error: 'VALIDATION', message: 'tmdbId or imdbId is required.' });

  try {
    const titleId = await autoIndexTitle({ tmdbId, imdbId, kind, title });
    if (!titleId) return res.status(404).json({ error: 'NOT_FOUND', message: 'Could not fetch or import title.' });
    const row = db.prepare('SELECT * FROM titles WHERE id=?').get(titleId);
    res.json({ message: `Successfully added "${row.title}" into CineMax!`, id: titleId, title: row.title, kind: row.kind, alreadyExisted: false });
  } catch (e) {
    res.status(500).json({ error: 'IMPORT_ERROR', message: e.message });
  }
});

module.exports = router;
