// Optional TMDB / OMDb metadata proxy. Keys live ONLY on this server.
// TMDB provides metadata (posters, trailers, cast). It never provides video streams.
const express = require('express');
const router = express.Router();

const TMDB = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

function keyOr503(res) {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    res.status(503).json({
      error: 'TMDB_NOT_CONFIGURED',
      message: 'TMDB integration is not configured. Set TMDB_API_KEY in backend/.env (free key: https://www.themoviedb.org/settings/api) and restart. The built-in licensed catalog remains fully functional without it.',
      docs: 'https://developers.themoviedb.org/3'
    });
    return null;
  }
  return key;
}
async function tmFetch(path, params = {}) {
  const key = process.env.TMDB_API_KEY;
  const url = new URL(TMDB + path);
  url.searchParams.set('api_key', key);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`TMDB responded ${r.status}`);
  return r.json();
}
const img = (p, size = 'w500') => (p ? `${IMG}/${size}${p}` : null);
function mapMovie(m) {
  return { id: m.id, kind: m.media_type || (m.title ? 'movie' : 'series'), title: m.title || m.name, originalTitle: m.original_title || m.original_name,
    overview: m.overview, year: String(m.release_date || m.first_air_date || '').slice(0, 4) || null, rating: m.vote_average ? Number(m.vote_average.toFixed(1)) : null,
    popularity: m.popularity, poster: img(m.poster_path), backdrop: img(m.backdrop_path, 'w1280'), genreIds: m.genre_ids || [], originalLanguage: m.original_language, mediaType: m.media_type || 'movie' };
}

router.get('/trending', async (req, res) => {
  if (!keyOr503(res)) return;
  try { const d = await tmFetch('/trending/all/week', { page: req.query.page || 1 }); res.json({ page: d.page, totalPages: d.total_pages, results: (d.results||[]).map(mapMovie) }); }
  catch (e) { res.status(502).json({ error: 'TMDB_ERROR', message: String(e.message) }); }
});
router.get('/popular', async (req, res) => {
  if (!keyOr503(res)) return;
  try { const d = await tmFetch(req.query.kind === 'tv' ? '/tv/popular' : '/movie/popular', { page: req.query.page || 1 }); res.json({ page: d.page, totalPages: d.total_pages, results: (d.results||[]).map(mapMovie) }); }
  catch (e) { res.status(502).json({ error: 'TMDB_ERROR', message: String(e.message) }); }
});
router.get('/search', async (req, res) => {
  if (!keyOr503(res)) return;
  const q = String(req.query.query || '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'VALIDATION', message: 'query must be at least 2 characters.' });
  try { const d = await tmFetch('/search/multi', { query: q, page: req.query.page || 1, include_adult: 'false' }); res.json({ page: d.page, totalPages: d.total_pages, results: (d.results||[]).filter(r => r.media_type !== 'person').map(mapMovie) }); }
  catch (e) { res.status(502).json({ error: 'TMDB_ERROR', message: String(e.message) }); }
});
router.get('/details/:type/:id', async (req, res) => {
  if (!keyOr503(res)) return;
  const type = req.params.type === 'tv' ? 'tv' : 'movie';
  try {
    const d = await tmFetch(`/${type}/${encodeURIComponent(req.params.id)}`, { append_to_response: 'videos,credits,similar,watch/providers,images', include_image_language: 'en,null' });
    res.json({
      id: d.id, kind: type, title: d.title || d.name, overview: d.overview, year: String(d.release_date || d.first_air_date || '').slice(0, 4) || null,
      rating: d.vote_average ? Number(d.vote_average.toFixed(1)) : null, runtime: d.runtime || (Array.isArray(d.episode_run_time) ? d.episode_run_time[0] : null),
      genres: (d.genres || []).map(g => g.name), originalLanguage: d.original_language,
      poster: img(d.poster_path), backdrop: img(d.backdrop_path, 'w1280'),
      trailers: (d.videos?.results || []).filter(v => v.site === 'YouTube' && ['Trailer','Teaser'].includes(v.type)).map(v => ({ key: v.key, name: v.name, official: v.official })),
      cast: (d.credits?.cast || []).slice(0, 12).map(c => ({ name: c.name, character: c.character, profile: img(c.profile_path, 'w185') })),
      director: type === 'movie' ? ((d.credits?.crew || []).find(c => c.job === 'Director')?.name || null) : (d.created_by || []).map(c => c.name).join(', '),
      similar: (d.similar?.results || []).slice(0, 12).map(mapMovie),
      seasons: type === 'tv' ? (d.seasons || []).map(s => ({ seasonNumber: s.season_number, name: s.name, episodeCount: s.episode_count, airDate: s.air_date, poster: img(s.poster_path) })) : undefined,
      watchProviders: d['watch/providers']?.results || {},
      numberOfSeasons: d.number_of_seasons, status: d.status
    });
  } catch (e) { res.status(502).json({ error: 'TMDB_ERROR', message: String(e.message) }); }
});
router.get('/genres', async (req, res) => {
  if (!keyOr503(res)) return;
  try {
    const [m, t] = await Promise.all([tmFetch('/genre/movie/list'), tmFetch('/genre/tv/list')]);
    res.json({ movie: m.genres || [], tv: t.genres || [] });
  } catch (e) { res.status(502).json({ error: 'TMDB_ERROR', message: String(e.message) }); }
});
// OMDb proxy for IMDb-rated details (https://www.omdbapi.com/)
router.get('/omdb/:imdbId', async (req, res) => {
  const key = process.env.OMDB_API_KEY;
  if (!key) return res.status(503).json({ error: 'OMDB_NOT_CONFIGURED', message: 'Set OMDB_API_KEY in backend/.env (free key: https://www.omdbapi.com/apikey.aspx).' });
  try {
    const r = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(req.params.imdbId)}&plot=short`);
    const d = await r.json();
    if (d.Response === 'False') return res.status(404).json({ error: 'OMDB_ERROR', message: d.Error || 'Not found.' });
    res.json({ title: d.Title, year: d.Year, rated: d.Rated, released: d.Released, runtime: d.Runtime, genre: d.Genre, director: d.Director, actors: d.Actors, plot: d.Plot, imdbRating: d.imdbRating, imdbVotes: d.imdbVotes, metascore: d.Metascore, awards: d.Awards, language: d.Language, country: d.Country, poster: d.Poster });
  } catch (e) { res.status(502).json({ error: 'OMDB_ERROR', message: String(e.message) }); }
});
module.exports = router;
