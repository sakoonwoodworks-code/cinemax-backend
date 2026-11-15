// OMDb API Helper for CineMax
// Provides IMDb search, details, and metadata enrichment
const https = require('https');

const OMDB_API_KEY = process.env.OMDB_API_KEY || '6171807f';

function fetchOmdb(params = {}) {
  return new Promise((resolve) => {
    const url = new URL('https://www.omdbapi.com/');
    url.searchParams.set('apikey', OMDB_API_KEY);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }

    const req = https.get(url, { headers: { 'User-Agent': 'CineMax/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch {
          resolve({ Response: 'False', Error: 'Invalid JSON response from OMDb' });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ Response: 'False', Error: err.message });
    });

    req.setTimeout(8000, () => {
      req.destroy();
      resolve({ Response: 'False', Error: 'OMDb request timed out' });
    });
  });
}

/**
 * Search OMDb by title or keywords
 */
async function searchOmdb(query, page = 1, type = null) {
  const q = String(query || '').trim();
  if (!q) return [];

  // If query is an IMDb ID (e.g. tt3896198)
  if (/^tt\d+$/i.test(q)) {
    const item = await getOmdbById(q);
    return item ? [item] : [];
  }

  const params = { s: q, page };
  if (type) params.type = type; // 'movie' or 'series'

  const res = await fetchOmdb(params);
  if (res.Response === 'True' && Array.isArray(res.Search)) {
    return res.Search.map(r => ({
      imdbId: r.imdbID,
      title: r.Title,
      year: parseInt(String(r.Year || '').slice(0, 4), 10) || null,
      kind: r.Type === 'series' ? 'series' : 'movie',
      poster: (r.Poster && r.Poster !== 'N/A') ? r.Poster : null,
      source: 'omdb'
    }));
  }
  return [];
}

/**
 * Get detailed metadata from OMDb by IMDb ID
 */
async function getOmdbById(imdbId) {
  const id = String(imdbId || '').trim();
  if (!id) return null;

  const res = await fetchOmdb({ i: id, plot: 'full' });
  if (res.Response === 'True') {
    const year = parseInt(String(res.Year || '').slice(0, 4), 10) || null;
    const rating = parseFloat(res.imdbRating) || null;
    const runtime = parseInt(res.Runtime, 10) || (res.Type === 'series' ? 45 : 120);

    return {
      imdbId: res.imdbID,
      title: res.Title,
      year,
      rating,
      rated: res.Rated !== 'N/A' ? res.Rated : 'PG-13',
      runtime,
      genres: res.Genre !== 'N/A' ? res.Genre : 'Action, Drama',
      director: res.Director !== 'N/A' ? res.Director : '',
      actors: res.Actors !== 'N/A' ? res.Actors : '',
      plot: res.Plot !== 'N/A' ? res.Plot : '',
      poster: (res.Poster && res.Poster !== 'N/A') ? res.Poster : null,
      kind: res.Type === 'series' ? 'series' : 'movie',
      totalSeasons: parseInt(res.totalSeasons, 10) || 1,
      ratings: res.Ratings || [],
      country: res.Country !== 'N/A' ? res.Country : 'US',
      language: res.Language !== 'N/A' ? res.Language : 'English',
      source: 'omdb'
    };
  }
  return null;
}

module.exports = {
  OMDB_API_KEY,
  searchOmdb,
  getOmdbById,
  fetchOmdb
};
