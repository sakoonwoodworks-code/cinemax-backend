require('dotenv').config();
const https = require('https');
const db = require('./db');

const API_KEY = process.env.TMDB_API_KEY || '844dba0bfd8f3a4f3799f6130ef9e335';

const TMDB_GENRES = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi',
  10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
  10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
  10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics'
};

function fetchJson(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({});
        }
      });
    }).on('error', (err) => {
      console.warn('Network error fetching:', url, err.message);
      resolve({});
    });
  });
}

function resolveGenres(genreIds, defaultGenres = 'Drama') {
  if (!genreIds || !genreIds.length) return defaultGenres;
  const list = genreIds.map(id => TMDB_GENRES[id]).filter(Boolean);
  return list.length ? list.join(',') : defaultGenres;
}

function resolveCountryAndLangs(item) {
  const lang = item.original_language || 'en';
  if (lang === 'hi') {
    return { country: 'IN', audio: 'hi,en', subs: 'en,hi' };
  }
  if (['te', 'ta', 'ml', 'kn'].includes(lang)) {
    return { country: 'IN', audio: `${lang},hi,en`, subs: 'en,hi' };
  }
  if (lang === 'ko') {
    return { country: 'KR', audio: 'ko,en,hi', subs: 'en,hi,ko' };
  }
  if (lang === 'ja') {
    return { country: 'JP', audio: 'ja,en,hi', subs: 'en,hi,ja' };
  }
  if (lang === 'es') {
    return { country: 'ES', audio: 'es,en', subs: 'en,es' };
  }
  const country = (item.origin_country && item.origin_country[0]) || 'US';
  return { country, audio: 'en,hi', subs: 'en,hi,es' };
}

async function run() {
  console.log('Ensuring poster_url and backdrop_url columns exist...');
  try { db.exec('ALTER TABLE titles ADD COLUMN poster_url TEXT;'); } catch (_) {}
  try { db.exec('ALTER TABLE titles ADD COLUMN backdrop_url TEXT;'); } catch (_) {}

  // 1. Update any existing titles with posters if missing
  const existing = db.prepare("SELECT id, title, tmdb_id, kind, poster_url FROM titles WHERE tmdb_id IS NOT NULL AND (poster_url IS NULL OR poster_url NOT LIKE 'http%')").all();
  if (existing.length > 0) {
    console.log(`Updating ${existing.length} existing titles missing official posters...`);
    for (const t of existing) {
      try {
        const type = t.kind === 'series' ? 'tv' : 'movie';
        const data = await fetchJson(`https://api.themoviedb.org/3/${type}/${t.tmdb_id}?api_key=${API_KEY}`);
        if (data && (data.poster_path || data.backdrop_path)) {
          db.prepare('UPDATE titles SET poster_url=?, backdrop_url=?, tmdb_rating=? WHERE id=?')
            .run(
              data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
              data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null,
              data.vote_average ? Number(data.vote_average.toFixed(1)) : null,
              t.id
            );
        }
      } catch (_) {}
    }
  }

  // 2. Multi-category TMDB discovery
  console.log('\nFetching comprehensive catalog across all movie & TV categories...');
  const endpoints = [
    // Trending & Top Rated
    { url: `https://api.themoviedb.org/3/trending/movie/day?api_key=${API_KEY}`, kind: 'movie', trending: 1 },
    { url: `https://api.themoviedb.org/3/trending/movie/week?api_key=${API_KEY}&page=1`, kind: 'movie', trending: 1 },
    { url: `https://api.themoviedb.org/3/trending/movie/week?api_key=${API_KEY}&page=2`, kind: 'movie', trending: 1 },
    { url: `https://api.themoviedb.org/3/movie/now_playing?api_key=${API_KEY}&page=1`, kind: 'movie', trending: 1 },
    { url: `https://api.themoviedb.org/3/movie/now_playing?api_key=${API_KEY}&page=2`, kind: 'movie', trending: 1 },
    { url: `https://api.themoviedb.org/3/trending/tv/day?api_key=${API_KEY}`, kind: 'series', trending: 1 },
    { url: `https://api.themoviedb.org/3/trending/tv/week?api_key=${API_KEY}&page=1`, kind: 'series', trending: 1 },
    { url: `https://api.themoviedb.org/3/trending/tv/week?api_key=${API_KEY}&page=2`, kind: 'series', trending: 1 },
    { url: `https://api.themoviedb.org/3/tv/on_the_air?api_key=${API_KEY}&page=1`, kind: 'series', trending: 1 },
    { url: `https://api.themoviedb.org/3/tv/on_the_air?api_key=${API_KEY}&page=2`, kind: 'series', trending: 1 },
    { url: `https://api.themoviedb.org/3/movie/top_rated?api_key=${API_KEY}&page=1`, kind: 'movie', topRated: 1 },
    { url: `https://api.themoviedb.org/3/movie/top_rated?api_key=${API_KEY}&page=2`, kind: 'movie', topRated: 1 },
    { url: `https://api.themoviedb.org/3/movie/top_rated?api_key=${API_KEY}&page=3`, kind: 'movie', topRated: 1 },
    { url: `https://api.themoviedb.org/3/movie/popular?api_key=${API_KEY}&page=1`, kind: 'movie', popular: 1 },
    { url: `https://api.themoviedb.org/3/movie/popular?api_key=${API_KEY}&page=2`, kind: 'movie', popular: 1 },
    { url: `https://api.themoviedb.org/3/movie/popular?api_key=${API_KEY}&page=3`, kind: 'movie', popular: 1 },
    { url: `https://api.themoviedb.org/3/movie/popular?api_key=${API_KEY}&page=4`, kind: 'movie', popular: 1 },

    // TV Series & Web Series
    { url: `https://api.themoviedb.org/3/tv/popular?api_key=${API_KEY}&page=1`, kind: 'series', popular: 1 },
    { url: `https://api.themoviedb.org/3/tv/popular?api_key=${API_KEY}&page=2`, kind: 'series', popular: 1 },
    { url: `https://api.themoviedb.org/3/tv/popular?api_key=${API_KEY}&page=3`, kind: 'series', popular: 1 },
    { url: `https://api.themoviedb.org/3/tv/top_rated?api_key=${API_KEY}&page=1`, kind: 'series', topRated: 1 },
    { url: `https://api.themoviedb.org/3/tv/top_rated?api_key=${API_KEY}&page=2`, kind: 'series', topRated: 1 },

    // Indian Web Series & OTT Originals
    { url: `https://api.themoviedb.org/3/discover/tv?api_key=${API_KEY}&with_original_language=hi&sort_by=popularity.desc&page=1`, kind: 'series', tag: 'indian_webseries' },
    { url: `https://api.themoviedb.org/3/discover/tv?api_key=${API_KEY}&with_original_language=hi&sort_by=popularity.desc&page=2`, kind: 'series', tag: 'indian_webseries' },
    { url: `https://api.themoviedb.org/3/discover/tv?api_key=${API_KEY}&with_original_language=hi&sort_by=first_air_date.desc&page=1`, kind: 'series', tag: 'indian_webseries' },

    // Bollywood Movies
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_original_language=hi&sort_by=popularity.desc&page=1`, kind: 'movie', tag: 'bollywood' },
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_original_language=hi&sort_by=popularity.desc&page=2`, kind: 'movie', tag: 'bollywood' },
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_original_language=hi&sort_by=popularity.desc&page=3`, kind: 'movie', tag: 'bollywood' },
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_original_language=hi&sort_by=vote_count.desc&page=1`, kind: 'movie', tag: 'bollywood' },

    // South Indian (Telugu, Tamil, Malayalam, Kannada)
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_original_language=te|ta|ml|kn&sort_by=popularity.desc&page=1`, kind: 'movie', tag: 'south' },
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_original_language=te|ta|ml|kn&sort_by=popularity.desc&page=2`, kind: 'movie', tag: 'south' },
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_original_language=te|ta|ml|kn&sort_by=popularity.desc&page=3`, kind: 'movie', tag: 'south' },

    // Anime & Animation
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_genres=16&with_original_language=ja&sort_by=popularity.desc&page=1`, kind: 'movie', tag: 'anime' },
    { url: `https://api.themoviedb.org/3/discover/tv?api_key=${API_KEY}&with_genres=16&with_original_language=ja&sort_by=popularity.desc&page=1`, kind: 'series', tag: 'anime' },
    { url: `https://api.themoviedb.org/3/discover/tv?api_key=${API_KEY}&with_genres=16&with_original_language=ja&sort_by=popularity.desc&page=2`, kind: 'series', tag: 'anime' },
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_genres=16&sort_by=popularity.desc&page=1`, kind: 'movie', tag: 'animation' },
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_genres=16&sort_by=popularity.desc&page=2`, kind: 'movie', tag: 'animation' },

    // K-Drama
    { url: `https://api.themoviedb.org/3/discover/tv?api_key=${API_KEY}&with_original_language=ko&sort_by=popularity.desc&page=1`, kind: 'series', tag: 'kdrama' },
    { url: `https://api.themoviedb.org/3/discover/tv?api_key=${API_KEY}&with_original_language=ko&sort_by=popularity.desc&page=2`, kind: 'series', tag: 'kdrama' },

    // Action & Sci-Fi
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_genres=28&sort_by=popularity.desc&page=1`, kind: 'movie' },
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_genres=28&sort_by=popularity.desc&page=2`, kind: 'movie' },
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_genres=878&sort_by=popularity.desc&page=1`, kind: 'movie' },
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_genres=878&sort_by=popularity.desc&page=2`, kind: 'movie' },

    // Comedy & Romance
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_genres=35&sort_by=popularity.desc&page=1`, kind: 'movie' },
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_genres=10749&sort_by=popularity.desc&page=1`, kind: 'movie' },

    // Horror & Thriller
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_genres=27,53&sort_by=popularity.desc&page=1`, kind: 'movie' },
    { url: `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}&with_genres=27,53&sort_by=popularity.desc&page=2`, kind: 'movie' },

    // Crime & Mystery
    { url: `https://api.themoviedb.org/3/discover/tv?api_key=${API_KEY}&with_genres=80,9648&sort_by=popularity.desc&page=1`, kind: 'series' }
  ];

  const insertTitle = db.prepare(`INSERT OR IGNORE INTO titles
    (slug, kind, title, overview, release_year, imdb_rating, tmdb_rating, runtime_min, genres, audio_languages, subtitle_languages, country, director, cast_json, maturity, quality, popularity, is_trending, is_popular, is_top_rated, is_featured, is_recently_added, license, allow_download, tmdb_id, poster_url, backdrop_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const insertSeason = db.prepare(`INSERT OR IGNORE INTO seasons (title_id, season_number, name, episode_count) VALUES (?, ?, ?, ?)`);
  const insertEpisode = db.prepare(`INSERT OR IGNORE INTO episodes (season_id, episode_number, name, overview, runtime_min) VALUES (?, ?, ?, ?, ?)`);

  let addedCount = 0;
  const seenIds = new Set();

  for (const ep of endpoints) {
    const data = await fetchJson(ep.url);
    const results = data.results || [];
    for (const item of results) {
      const tmdbId = item.id;
      if (!tmdbId || seenIds.has(tmdbId)) continue;
      seenIds.add(tmdbId);

      const title = item.title || item.name;
      if (!title || (!item.poster_path && !item.backdrop_path)) continue;

      const exists = db.prepare('SELECT id, poster_url, genres FROM titles WHERE tmdb_id=?').get(tmdbId);
      if (exists) {
        if (!exists.poster_url && item.poster_path) {
          db.prepare('UPDATE titles SET poster_url=?, backdrop_url=? WHERE id=?')
            .run(
              `https://image.tmdb.org/t/p/w500${item.poster_path}`,
              item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
              exists.id
            );
        }
        continue;
      }

      const slug = (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'title') + '-' + tmdbId;
      const year = parseInt(String(item.release_date || item.first_air_date || '').slice(0, 4), 10) || null;
      const rating = item.vote_average ? Number(item.vote_average.toFixed(1)) : 8.0;
      const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null;
      const backdropUrl = item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : posterUrl;
      const genres = resolveGenres(item.genre_ids, ep.kind === 'series' ? 'Drama,Mystery' : 'Action,Drama');
      const { country, audio, subs } = resolveCountryAndLangs(item);

      const isKids = (item.genre_ids || []).includes(10751) || (item.genre_ids || []).includes(10762) || (item.genre_ids || []).includes(16);
      const maturity = isKids ? 'PG' : (rating >= 8.2 ? 'R' : 'PG-13');
      const quality = rating >= 7.8 ? '4K' : 'HD';

      const res = insertTitle.run(
        slug,
        ep.kind,
        title,
        item.overview || 'Available for streaming with multi-audio and high definition playback.',
        year,
        rating,
        rating,
        ep.kind === 'movie' ? 120 : 45,
        genres,
        audio,
        subs,
        country,
        '',
        '[]',
        maturity,
        quality,
        item.popularity || 85,
        ep.trending || 0,
        ep.popular || (rating >= 7.5 ? 1 : 0),
        ep.topRated || (rating >= 8.2 ? 1 : 0),
        rating >= 8.4 ? 1 : 0,
        1,
        'Multi-Server Stream',
        1,
        tmdbId,
        posterUrl,
        backdropUrl
      );

      const titleId = res.lastInsertRowid;
      if (titleId && ep.kind === 'series') {
        // Create 2 seasons with 8 episodes each so every episode is playable
        for (let s = 1; s <= 2; s++) {
          const sInfo = insertSeason.run(titleId, s, `Season ${s}`, 8);
          for (let e = 1; e <= 8; e++) {
            insertEpisode.run(sInfo.lastInsertRowid, e, `Episode ${e}`, `Season ${s} Episode ${e}`, 45);
          }
        }
      }

      addedCount++;
    }
  }

  const totalNow = db.prepare('SELECT COUNT(*) c FROM titles').get().c;
  console.log(`\nDONE! Added ${addedCount} new titles. Total titles in CineMax database: ${totalNow}!`);
}

module.exports = { run };
if (require.main === module) {
  run().catch(console.error);
}
