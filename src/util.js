// Shared helpers
const csv = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);

function mapTitle(row, { withStreams = false, streamCount = 0, streams = [] } = {}) {
  let cast = [];
  try { cast = JSON.parse(row.cast_json || '[]'); } catch { cast = []; }
  const t = {
    id: row.id, slug: row.slug, kind: row.kind, title: row.title, overview: row.overview,
    year: row.release_year, rating: row.imdb_rating, tmdbRating: row.tmdb_rating,
    runtime: row.runtime_min, genres: csv(row.genres), audioLanguages: csv(row.audio_languages),
    subtitleLanguages: csv(row.subtitle_languages), country: csv(row.country),
    director: row.director, cast, maturity: row.maturity, quality: row.quality,
    popularity: row.popularity,
    trending: !!row.is_trending, popular: !!row.is_popular, topRated: !!row.is_top_rated,
    featured: !!row.is_featured, recentlyAdded: !!row.is_recently_added,
    poster: row.poster_url || `/posters/${row.slug}.svg`,
    backdrop: row.backdrop_url || `/backdrops/${row.slug}.svg`,
    allowDownload: !!row.allow_download, license: row.license,
    tmdbId: row.tmdb_id, imdbId: row.imdb_id,
    playable: streamCount > 0 || !!row.tmdb_id, streamCount: streamCount > 0 ? streamCount : (row.tmdb_id ? 1 : 0)
  };
  if (withStreams) t.streams = streams.map(s => ({ id: s.id, url: s.url, type: s.type, label: s.label, audioLanguage: s.audio_language, subtitleTracks: csv(s.subtitle_tracks), qualities: csv(s.qualities), provider: s.provider, license: s.license }));
  return t;
}

function kidsFilter(isKids) { return isKids ? " AND maturity IN ('G','U','PG') " : ''; }

function pageParams(q, defLimit = 20) {
  const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(q.limit || String(defLimit), 10) || defLimit));
  return { page, limit, offset: (page - 1) * limit };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function track(db, event, meta) {
  try { db.prepare('INSERT INTO analytics_events (event, meta) VALUES (?,?)').run(event, meta ? JSON.stringify(meta) : null); } catch {}
}

module.exports = { csv, mapTitle, kidsFilter, pageParams, EMAIL_RE, track };
