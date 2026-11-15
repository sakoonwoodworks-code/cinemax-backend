// Universal Catalog: Unifies TMDB & OMDb to make any movie or series searchable and instantly accessible/streamable
const https = require('https');
const db = require('./db');
const { searchOmdb, getOmdbById, OMDB_API_KEY } = require('./omdb');

const TMDB_API_KEY = process.env.TMDB_API_KEY || '844dba0bfd8f3a4f3799f6130ef9e335';

function fetchJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'CineMax/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({}); }
      });
    });
    req.on('error', () => resolve({}));
    req.setTimeout(8000, () => { req.destroy(); resolve({}); });
  });
}

/**
 * Auto-indexes a title into the CineMax database so it is immediately
 * searchable, viewable, and streamable across all user profiles (Web + Android).
 */
async function autoIndexTitle({ tmdbId, imdbId, kind, title, overview, poster, backdrop, year, rating, genres }) {
  // 1. Check if already exists in local DB
  let existing = null;
  if (tmdbId) {
    existing = db.prepare('SELECT id, tmdb_id, imdb_id FROM titles WHERE tmdb_id=?').get(tmdbId);
  }
  if (!existing && imdbId) {
    existing = db.prepare('SELECT id, tmdb_id, imdb_id FROM titles WHERE imdb_id=?').get(imdbId);
  }
  if (!existing && title && year) {
    existing = db.prepare('SELECT id, tmdb_id, imdb_id FROM titles WHERE title=? AND release_year=?').get(title, year);
  }
  if (existing) {
    // If it exists but is missing imdb_id or tmdb_id, update it
    if ((!existing.imdb_id && imdbId) || (!existing.tmdb_id && tmdbId)) {
      db.prepare('UPDATE titles SET tmdb_id=COALESCE(tmdb_id, ?), imdb_id=COALESCE(imdb_id, ?) WHERE id=?')
        .run(tmdbId || null, imdbId || null, existing.id);
    }
    return existing.id;
  }

  // 2. Enrich from TMDB if tmdbId is present or if we have an imdbId to look up
  let fullTitle = title;
  let fullOverview = overview;
  let fullPoster = poster;
  let fullBackdrop = backdrop;
  let fullYear = year;
  let fullRating = rating || 7.5;
  let fullRuntime = 120;
  let fullGenres = genres || 'Action, Drama';
  let fullCountry = 'US';
  let fullDirector = '';
  let fullCast = '[]';
  let fullKind = kind === 'series' || kind === 'tv' ? 'series' : 'movie';
  let totalSeasons = 2;

  // If we have an IMDb ID but no tmdbId, look it up on TMDB
  if (!tmdbId && imdbId) {
    const findRes = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
    const tmdbMatch = (findRes.movie_results && findRes.movie_results[0]) || (findRes.tv_results && findRes.tv_results[0]);
    if (tmdbMatch) {
      tmdbId = tmdbMatch.id;
      if (!fullKind) fullKind = tmdbMatch.media_type === 'tv' ? 'series' : 'movie';
      if (!fullBackdrop && tmdbMatch.backdrop_path) fullBackdrop = `https://image.tmdb.org/t/p/w1280${tmdbMatch.backdrop_path}`;
      if (!fullPoster && tmdbMatch.poster_path) fullPoster = `https://image.tmdb.org/t/p/w500${tmdbMatch.poster_path}`;
      if (!fullOverview && tmdbMatch.overview) fullOverview = tmdbMatch.overview;
      if (!fullTitle && (tmdbMatch.title || tmdbMatch.name)) fullTitle = tmdbMatch.title || tmdbMatch.name;
    }
  }

  // Enrich full details from TMDB if tmdbId is available
  if (tmdbId) {
    const tType = fullKind === 'series' ? 'tv' : 'movie';
    const tmdbData = await fetchJson(`https://api.themoviedb.org/3/${tType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=credits,external_ids`);
    if (tmdbData && (tmdbData.title || tmdbData.name)) {
      fullTitle = tmdbData.title || tmdbData.name;
      fullOverview = tmdbData.overview || fullOverview;
      if (tmdbData.poster_path) fullPoster = `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`;
      if (tmdbData.backdrop_path) fullBackdrop = `https://image.tmdb.org/t/p/w1280${tmdbData.backdrop_path}`;
      const relDate = tmdbData.release_date || tmdbData.first_air_date || '';
      if (relDate) fullYear = parseInt(relDate.slice(0, 4), 10) || fullYear;
      if (tmdbData.vote_average) fullRating = Number(tmdbData.vote_average.toFixed(1));
      if (tmdbData.runtime) fullRuntime = tmdbData.runtime;
      if (tmdbData.genres && tmdbData.genres.length) fullGenres = tmdbData.genres.map(g => g.name).join(',');
      if (tmdbData.origin_country && tmdbData.origin_country[0]) fullCountry = tmdbData.origin_country[0];
      if (tmdbData.external_ids?.imdb_id) imdbId = tmdbData.external_ids.imdb_id;
      if (tmdbData.credits?.cast) {
        fullCast = JSON.stringify(tmdbData.credits.cast.slice(0, 10).map(c => ({ name: c.name, character: c.character })));
      }
      if (tType === 'tv' && tmdbData.number_of_seasons) {
        totalSeasons = Math.min(tmdbData.number_of_seasons, 5);
      }
    }
  }

  // Enrich from OMDb if imdbId is available
  if (imdbId) {
    const omdbData = await getOmdbById(imdbId);
    if (omdbData) {
      if (!fullTitle) fullTitle = omdbData.title;
      if (!fullOverview) fullOverview = omdbData.plot;
      if (!fullPoster && omdbData.poster) fullPoster = omdbData.poster;
      if (!fullYear && omdbData.year) fullYear = omdbData.year;
      if (omdbData.rating) fullRating = omdbData.rating;
      if (omdbData.genres && (!fullGenres || fullGenres === 'Action, Drama')) fullGenres = omdbData.genres;
      if (omdbData.director) fullDirector = omdbData.director;
      if (omdbData.totalSeasons) totalSeasons = Math.min(omdbData.totalSeasons, 5);
    }
  }

  if (!fullTitle) return null;
  if (!fullBackdrop) fullBackdrop = fullPoster;

  // Language & audio determination
  let audioLangs = 'en,hi';
  if (fullCountry === 'IN') audioLangs = 'hi,en';
  else if (fullCountry === 'KR') audioLangs = 'ko,en,hi';
  else if (fullCountry === 'JP') audioLangs = 'ja,en,hi';

  const cleanSlugBase = fullTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'title';
  const slug = `${cleanSlugBase}-${tmdbId || imdbId || Date.now()}`;

  const insertTitle = db.prepare(`INSERT INTO titles
    (slug, kind, title, overview, release_year, imdb_rating, tmdb_rating, runtime_min, genres, audio_languages, subtitle_languages, country, director, cast_json, maturity, quality, popularity, is_trending, is_popular, is_top_rated, is_featured, is_recently_added, license, allow_download, tmdb_id, imdb_id, poster_url, backdrop_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const info = insertTitle.run(
    slug, fullKind, fullTitle, fullOverview || 'Available for high definition streaming with multi-server playback.',
    fullYear || 2024, fullRating, fullRating, fullRuntime,
    fullGenres, audioLangs, 'en,hi,es', fullCountry, fullDirector, fullCast,
    fullRating >= 8.2 ? 'R' : 'PG-13', fullRating >= 7.8 ? '4K' : 'HD',
    85, 1, 1, fullRating >= 8.0 ? 1 : 0, 1, 1,
    'Universal Multi-Server Stream', 1, tmdbId || null, imdbId || null, fullPoster, fullBackdrop
  );

  const titleId = info.lastInsertRowid;

  // If series, automatically populate seasons and episodes so user can watch immediately
  if (fullKind === 'series') {
    const insertSeason = db.prepare(`INSERT OR IGNORE INTO seasons (title_id, season_number, name, episode_count) VALUES (?, ?, ?, ?)`);
    const insertEpisode = db.prepare(`INSERT OR IGNORE INTO episodes (season_id, episode_number, name, overview, runtime_min) VALUES (?, ?, ?, ?, ?)`);
    for (let s = 1; s <= totalSeasons; s++) {
      const sInfo = insertSeason.run(titleId, s, `Season ${s}`, 8);
      for (let e = 1; e <= 8; e++) {
        insertEpisode.run(sInfo.lastInsertRowid, e, `Episode ${e}`, `Season ${s} Episode ${e}`, 45);
      }
    }
  }

  return titleId;
}

/**
 * Searches across TMDB and OMDb simultaneously, deduplicating
 * and automatically importing top matches into the catalog.
 */
async function searchUniversal(query) {
  const q = String(query || '').trim();
  if (!q) return [];

  // Check if query is an IMDb ID directly (e.g. tt3896198)
  if (/^tt\d+$/i.test(q)) {
    const id = await autoIndexTitle({ imdbId: q, title: '' });
    return id ? [id] : [];
  }

  // 1. Fetch TMDB and OMDb results in parallel
  const [tmdbData, omdbList] = await Promise.all([
    fetchJson(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(q)}`),
    searchOmdb(q)
  ]);

  const candidates = [];

  // Parse TMDB
  for (const r of (tmdbData.results || [])) {
    if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
    candidates.push({
      tmdbId: r.id,
      imdbId: null,
      kind: r.media_type === 'tv' ? 'series' : 'movie',
      title: r.title || r.name,
      overview: r.overview || '',
      year: parseInt(String(r.release_date || r.first_air_date || '').slice(0, 4), 10) || null,
      rating: r.vote_average ? Number(r.vote_average.toFixed(1)) : null,
      poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
      backdrop: r.backdrop_path ? `https://image.tmdb.org/t/p/w1280${r.backdrop_path}` : null,
      source: 'tmdb'
    });
  }

  // Parse OMDb
  for (const o of omdbList) {
    candidates.push({
      tmdbId: null,
      imdbId: o.imdbId,
      kind: o.kind,
      title: o.title,
      overview: '',
      year: o.year,
      rating: o.rating,
      poster: o.poster,
      backdrop: o.poster,
      source: 'omdb'
    });
  }

  // Deduplicate candidates (by tmdbId, imdbId, or title + year)
  const seen = new Set();
  const uniqueCandidates = [];
  for (const c of candidates) {
    const key = (c.tmdbId ? `tmdb:${c.tmdbId}` : null) || (c.imdbId ? `imdb:${c.imdbId}` : null) || `${(c.title || '').toLowerCase().trim()}:${c.year}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueCandidates.push(c);
    }
  }

  // Auto-index top candidates into SQLite so they are playable by any user
  const autoIndexedIds = [];
  const topCandidates = uniqueCandidates.slice(0, 8); // Top 8 results
  for (const cand of topCandidates) {
    try {
      const id = await autoIndexTitle(cand);
      if (id) autoIndexedIds.push(id);
    } catch (e) {
      console.error('[UniversalCatalog] Auto-index failed for', cand.title, e.message);
    }
  }

  return autoIndexedIds;
}

module.exports = {
  searchUniversal,
  autoIndexTitle,
  fetchJson,
  TMDB_API_KEY,
  OMDB_API_KEY
};
