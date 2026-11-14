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
        try { resolve(JSON.parse(data)); } catch { resolve({}); }
      });
    }).on('error', () => resolve({}));
  });
}

const SPECIFIC_TITLES = [
  // ── Pirates of the Caribbean Complete Franchise ─────────────────────────
  { id: 22, kind: 'movie', tag: 'pirates' },      // The Curse of the Black Pearl (2003)
  { id: 58, kind: 'movie', tag: 'pirates' },      // Dead Man's Chest (2006)
  { id: 285, kind: 'movie', tag: 'pirates' },     // At World's End (2007)
  { id: 1865, kind: 'movie', tag: 'pirates' },    // On Stranger Tides (2011)
  { id: 166426, kind: 'movie', tag: 'pirates' },  // Dead Men Tell No Tales (2017)

  // ── Epic Swashbuckling & High-Seas Adventure (Like Pirates of the Caribbean) ──
  { id: 46648, kind: 'series', tag: 'pirates' },  // Black Sails (Pirate TV Series)
  { id: 436969, kind: 'movie', tag: 'pirates' },  // Jungle Cruise (2021)
  { id: 8688, kind: 'movie', tag: 'pirates' },    // Master and Commander: The Far Side of the World
  { id: 205587, kind: 'movie', tag: 'pirates' },  // In the Heart of the Sea
  { id: 1408, kind: 'movie', tag: 'pirates' },    // Cutthroat Island
  { id: 9016, kind: 'movie', tag: 'pirates' },    // Treasure Planet
  { id: 10555, kind: 'movie', tag: 'pirates' },   // Sinbad: Legend of the Seven Seas
  { id: 560057, kind: 'movie', tag: 'pirates' },  // The Sea Beast
  { id: 335787, kind: 'movie', tag: 'pirates' },  // Uncharted
  { id: 564, kind: 'movie', tag: 'pirates' },     // The Mummy (1999)
  { id: 1734, kind: 'movie', tag: 'pirates' },    // The Mummy Returns (2001)
  { id: 2059, kind: 'movie', tag: 'pirates' },    // National Treasure
  { id: 6964, kind: 'movie', tag: 'pirates' },    // National Treasure: Book of Secrets
  { id: 9543, kind: 'movie', tag: 'pirates' },    // Prince of Persia: The Sands of Time
  { id: 85, kind: 'movie', tag: 'pirates' },      // Raiders of the Lost Ark
  { id: 89, kind: 'movie', tag: 'pirates' },      // Indiana Jones and the Last Crusade
  { id: 335977, kind: 'movie', tag: 'pirates' },  // Indiana Jones and the Dial of Destiny
  { id: 9804, kind: 'movie', tag: 'pirates' },    // Waterworld
  { id: 293167, kind: 'movie', tag: 'pirates' },  // Kong: Skull Island
  { id: 111110, kind: 'series', tag: 'pirates' }, // One Piece (Live Action)

  // ── Top Indian Web Series & OTT Originals ────────────────────────────────
  { id: 101352, kind: 'series', tag: 'indian_series' }, // Panchayat
  { id: 93352, kind: 'series', tag: 'indian_series' },  // The Family Man
  { id: 111188, kind: 'series', tag: 'indian_series' }, // Scam 1992
  { id: 132117, kind: 'series', tag: 'indian_series' }, // Farzi
  { id: 100911, kind: 'series', tag: 'indian_series' }, // Asur
  { id: 89113, kind: 'series', tag: 'indian_series' },  // Kota Factory
  { id: 99966, kind: 'series', tag: 'indian_series' },  // Special OPS
  { id: 87508, kind: 'series', tag: 'indian_series' },  // Delhi Crime
  { id: 124411, kind: 'series', tag: 'indian_series' }, // Aspirants
  { id: 156714, kind: 'series', tag: 'indian_series' }, // Guns & Gulaabs
  { id: 203832, kind: 'series', tag: 'indian_series' }, // Taaza Khabar
  { id: 138211, kind: 'series', tag: 'indian_series' }, // Rocket Boys
  { id: 88177, kind: 'series', tag: 'indian_series' },  // Criminal Justice
  { id: 249543, kind: 'series', tag: 'indian_series' }, // Inspector Rishi
  { id: 230034, kind: 'series', tag: 'indian_series' }, // Kohrra
  { id: 195729, kind: 'series', tag: 'indian_series' }, // Jubilee
  { id: 137437, kind: 'series', tag: 'indian_series' }, // Rana Naidu
  { id: 104758, kind: 'series', tag: 'indian_series' }, // Aarya
  { id: 126280, kind: 'series', tag: 'indian_series' }, // Maharani
  { id: 105596, kind: 'series', tag: 'indian_series' }, // Breathe: Into the Shadows
  { id: 97546, kind: 'series', tag: 'indian_series' },  // Jamtara
  { id: 139164, kind: 'series', tag: 'indian_series' }, // Yeh Kaali Kaali Ankhein
  { id: 114695, kind: 'series', tag: 'indian_series' }, // Tandav
  { id: 200508, kind: 'series', tag: 'indian_series' }, // Indian Police Force
  { id: 131977, kind: 'series', tag: 'indian_series' }, // Heeramandi: The Diamond Bazaar

  // ── Top Indian Blockbusters (Bollywood & South Indian Mass Cinema) ──────
  { id: 1091299, kind: 'movie', tag: 'indian_movie' }, // Stree 2
  { id: 508763, kind: 'movie', tag: 'indian_movie' },  // Stree
  { id: 872906, kind: 'movie', tag: 'indian_movie' },  // Jawan
  { id: 864692, kind: 'movie', tag: 'indian_movie' },  // Pathaan
  { id: 781732, kind: 'movie', tag: 'indian_movie' },  // Animal
  { id: 801688, kind: 'movie', tag: 'indian_movie' },  // Kalki 2898 AD
  { id: 939243, kind: 'movie', tag: 'indian_movie' },  // Pushpa 2: The Rule
  { id: 690942, kind: 'movie', tag: 'indian_movie' },  // Pushpa: The Rise
  { id: 897087, kind: 'movie', tag: 'indian_movie' },  // Salaar: Part 1 - Ceasefire
  { id: 1072790, kind: 'movie', tag: 'indian_movie' }, // Leo
  { id: 998846, kind: 'movie', tag: 'indian_movie' },  // Jailer
  { id: 1024535, kind: 'movie', tag: 'indian_movie' }, // Kantara
  { id: 1100782, kind: 'movie', tag: 'indian_movie' }, // Devara: Part 1
  { id: 1134418, kind: 'movie', tag: 'indian_movie' }, // GOAT (The Greatest of All Time)
  { id: 1242405, kind: 'movie', tag: 'indian_movie' }, // Amaran
  { id: 1186947, kind: 'movie', tag: 'indian_movie' }, // Vettaiyan
  { id: 1114738, kind: 'movie', tag: 'indian_movie' }, // Maharaja
  { id: 1249289, kind: 'movie', tag: 'indian_movie' }, // Manjummel Boys
  { id: 1238497, kind: 'movie', tag: 'indian_movie' }, // Premalu
  { id: 987483, kind: 'movie', tag: 'indian_movie' },  // Hanu-Man
  { id: 1181548, kind: 'movie', tag: 'indian_movie' }, // 12th Fail
  { id: 850165, kind: 'movie', tag: 'indian_movie' },  // Fighter
  { id: 969492, kind: 'movie', tag: 'indian_movie' },  // Dunki
  { id: 1241982, kind: 'movie', tag: 'indian_movie' }, // Bhool Bhulaiyaa 3
  { id: 635876, kind: 'movie', tag: 'indian_movie' },  // Bhool Bhulaiyaa 2
  { id: 1059128, kind: 'movie', tag: 'indian_movie' }, // Singham Again
  { id: 1239251, kind: 'movie', tag: 'indian_movie' }, // Article 370
  { id: 1289500, kind: 'movie', tag: 'indian_movie' }, // Munjya
  { id: 637920, kind: 'movie', tag: 'indian_movie' },  // Shershaah
  { id: 609242, kind: 'movie', tag: 'indian_movie' },  // Chhichhore
  { id: 554600, kind: 'movie', tag: 'indian_movie' },  // Uri: The Surgical Strike
  { id: 346648, kind: 'movie', tag: 'indian_movie' },  // Bajrangi Bhaijaan
  { id: 534780, kind: 'movie', tag: 'indian_movie' },  // Andhadhun
  { id: 538858, kind: 'movie', tag: 'indian_movie' },  // Tumbbad
  { id: 119803, kind: 'movie', tag: 'indian_movie' },  // Gangs of Wasseypur
  { id: 12244, kind: 'movie', tag: 'indian_movie' },   // Sholay
  { id: 19404, kind: 'movie', tag: 'indian_movie' },   // Dilwale Dulhania Le Jayenge
  { id: 2069, kind: 'movie', tag: 'indian_movie' },    // Swades
  { id: 7578, kind: 'movie', tag: 'indian_movie' },    // Chak De! India
  { id: 7508, kind: 'movie', tag: 'indian_movie' },    // Taare Zameen Par
  { id: 1966, kind: 'movie', tag: 'indian_movie' }     // Lagaan
];

async function run() {
  console.log(`Starting dedicated Pirates & Indian Cinema ingestion (${SPECIFIC_TITLES.length} titles)...`);

  const insertTitle = db.prepare(`INSERT OR IGNORE INTO titles
    (slug, kind, title, overview, release_year, imdb_rating, tmdb_rating, runtime_min, genres, audio_languages, subtitle_languages, country, director, cast_json, maturity, quality, popularity, is_trending, is_popular, is_top_rated, is_featured, is_recently_added, license, allow_download, tmdb_id, poster_url, backdrop_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const insertSeason = db.prepare(`INSERT OR IGNORE INTO seasons (title_id, season_number, name, episode_count) VALUES (?, ?, ?, ?)`);
  const insertEpisode = db.prepare(`INSERT OR IGNORE INTO episodes (season_id, episode_number, name, overview, runtime_min) VALUES (?, ?, ?, ?, ?)`);

  let added = 0;
  let updated = 0;

  for (const item of SPECIFIC_TITLES) {
    const tmdbId = item.id;
    const type = item.kind === 'series' ? 'tv' : 'movie';

    try {
      const data = await fetchJson(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${API_KEY}`);
      const title = data.title || data.name;
      if (!title) continue;

      const posterUrl = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null;
      const backdropUrl = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : posterUrl;
      const rating = data.vote_average ? Number(data.vote_average.toFixed(1)) : 8.0;
      const year = parseInt(String(data.release_date || data.first_air_date || '').slice(0, 4), 10) || null;
      const genresList = (data.genres || []).map(g => g.name).filter(Boolean);
      let genres = genresList.length ? genresList.join(',') : (item.kind === 'series' ? 'Drama,Crime' : 'Action,Adventure');
      if (item.tag === 'pirates' && !genres.includes('Adventure')) genres = 'Action,Adventure,' + genres;

      const lang = data.original_language || 'en';
      let country = 'US';
      let audio = 'en,hi';
      let subs = 'en,hi';

      if (lang === 'hi' || item.tag?.startsWith('indian')) {
        country = 'IN';
        audio = lang === 'hi' ? 'hi,en' : `${lang},hi,en`;
        subs = 'en,hi';
      } else if (['te', 'ta', 'ml', 'kn'].includes(lang)) {
        country = 'IN';
        audio = `${lang},hi,en`;
        subs = 'en,hi';
      }

      const existing = db.prepare('SELECT id, poster_url FROM titles WHERE tmdb_id=?').get(tmdbId);
      if (existing) {
        db.prepare('UPDATE titles SET poster_url=?, backdrop_url=?, tmdb_rating=?, genres=?, audio_languages=?, country=? WHERE id=?')
          .run(posterUrl, backdropUrl, rating, genres, audio, country, existing.id);
        updated++;
        continue;
      }

      const slug = (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'title') + '-' + tmdbId;
      const maturity = rating >= 8.2 ? 'R' : 'PG-13';

      const res = insertTitle.run(
        slug,
        item.kind,
        title,
        data.overview || 'Available for streaming with multi-audio and high definition playback.',
        year,
        rating,
        rating,
        item.kind === 'movie' ? (data.runtime || 120) : (data.episode_run_time?.[0] || 45),
        genres,
        audio,
        subs,
        country,
        '',
        '[]',
        maturity,
        rating >= 7.8 ? '4K' : 'HD',
        data.popularity || 90,
        1, // is_trending
        1, // is_popular
        rating >= 8.0 ? 1 : 0, // is_top_rated
        item.tag === 'pirates' || item.tag === 'indian_series' ? 1 : 0,
        1,
        'Multi-Server Stream',
        1,
        tmdbId,
        posterUrl,
        backdropUrl
      );

      const titleId = res.lastInsertRowid;
      if (titleId && item.kind === 'series') {
        const numSeasons = Math.min(5, Math.max(1, data.number_of_seasons || 2));
        for (let s = 1; s <= numSeasons; s++) {
          const sInfo = insertSeason.run(titleId, s, `Season ${s}`, 8);
          for (let ep = 1; ep <= 8; ep++) {
            insertEpisode.run(sInfo.lastInsertRowid, ep, `Episode ${ep}`, `Season ${s} Episode ${ep}`, 45);
          }
        }
      }

      added++;
      console.log(`+ Added [${item.kind}] "${title}" (TMDB: ${tmdbId})`);
    } catch (e) {
      console.warn(`Failed to import ${item.id}:`, e.message);
    }
  }

  const total = db.prepare('SELECT COUNT(*) c FROM titles').get().c;
  const pirates = db.prepare("SELECT COUNT(*) c FROM titles WHERE title LIKE '%Pirates%' OR title LIKE '%Jungle Cruise%' OR title LIKE '%Black Sails%' OR title LIKE '%Mummy%'").get().c;
  const indian = db.prepare("SELECT COUNT(*) c FROM titles WHERE country LIKE '%IN%'").get().c;
  const indianSeries = db.prepare("SELECT COUNT(*) c FROM titles WHERE country LIKE '%IN%' AND kind='series'").get().c;

  console.log(`\nDONE! Added ${added} new titles, updated ${updated} titles.`);
  console.log(`Stats:`);
  console.log(`- Total Titles in DB: ${total}`);
  console.log(`- Pirates & High-Seas Adventure Titles: ${pirates}`);
  console.log(`- Total Indian Titles: ${indian}`);
  console.log(`- Indian Web Series: ${indianSeries}`);
}

module.exports = { run };
if (require.main === module) {
  run().catch(console.error);
}
