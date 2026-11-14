// Idempotent seeder: rebuilds catalog from seedData.js, ensures admin/demo users exist.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const seed = require('./seedData');
require('./genAssets');

function csv(a){ return Array.isArray(a) ? a.join(',') : (a||''); }

const insertTitle = db.prepare(`INSERT INTO titles
  (slug,kind,title,overview,release_year,imdb_rating,tmdb_rating,runtime_min,genres,audio_languages,subtitle_languages,country,director,cast_json,maturity,quality,popularity,is_trending,is_popular,is_top_rated,is_featured,is_recently_added,license,allow_download,tmdb_id,imdb_id)
  VALUES (@slug,@kind,@title,@overview,@year,@rating,@rating,@runtime,@genres,@langs,@subs,@country,@director,@cast,@maturity,@quality,@pop,@trending,@popular,@toprated,@featured,@recentlyAdded,@license,@allowDownload,@tmdb,@imdb)`);
const insertStream = db.prepare(`INSERT INTO streams (title_id,url,type,label,audio_language,subtitle_tracks,qualities,provider,license) VALUES (?,?,?,?,?,?,?,?,?)`);
const insertSeason = db.prepare(`INSERT INTO seasons (title_id,season_number,name,episode_count) VALUES (?,?,?,?)`);
const insertEpisode = db.prepare(`INSERT INTO episodes (season_id,episode_number,name,overview,runtime_min,air_date,stream_url,stream_type) VALUES (?,?,?,?,?,?,?,?)`);

const wipe = db.transaction(() => {
  db.exec('DELETE FROM episodes; DELETE FROM seasons; DELETE FROM streams; DELETE FROM my_list; DELETE FROM watch_progress; DELETE FROM watch_history; DELETE FROM downloads; DELETE FROM titles;');
});
wipe();

const insertMany = db.transaction(() => {
  for (const t of seed) {
    const info = insertTitle.run({
      slug:t.slug, kind:t.kind, title:t.title, overview:t.overview, year:t.year||null, rating:t.rating||null,
      runtime:t.runtime||null, genres:csv(t.genres), langs:csv(t.langs), subs:csv(t.subs), country:t.country||'',
      director:t.director||'', cast:JSON.stringify((t.cast||[]).map(([name,character])=>({name,character}))),
      maturity:t.maturity||'PG-13', quality:t.quality||'HD', pop:t.pop||0,
      trending:t.trending?1:0, popular:t.popular?1:0, toprated:t.toprated?1:0, featured:t.featured?1:0, recentlyAdded:t.recentlyAdded?1:0,
      license:t.license||'Metadata: TMDB/CC — Video: see streams', allowDownload:t.allowDownload?1:0, tmdb:t.tmdb||null, imdb:t.imdb||null
    });
    const titleId = info.lastInsertRowid;
    for (const s of (t.seasons||[])) {
      const count = s.eps||8;
      const sInfo = insertSeason.run(titleId, s.n, `Season ${s.n}`, count);
      for (let e=1;e<=count;e++) {
        const name = s.names ? s.names[e-1] : `Episode ${e}`;
        const overview = s.overviews ? s.overviews[e-1] : 'Catalog entry. Configure a TMDB API key to load official episode titles and synopses, or add licensed streams from the admin dashboard.';
        const url = s.urls ? s.urls[e-1] : null;
        const rt = s.runtimes ? s.runtimes[e-1] : 45;
        insertEpisode.run(sInfo.lastInsertRowid, e, name, overview, rt, null, url, url ? 'mp4' : null);
      }
    }
  }
  for (const s of (seed.streams||[])) {
    if (s.note) continue;
    const t = db.prepare('SELECT id FROM titles WHERE slug=?').get(s.slug);
    if (t) insertStream.run(t.id, s.url, s.type, s.label, s.audio, s.subs, s.qualities, s.provider, s.license);
  }
});
insertMany();

// --- users ---
const adminEmail = process.env.ADMIN_EMAIL || 'admin@cinemax.app';
const adminPass = process.env.ADMIN_PASSWORD || 'Admin@123';
const demoPass = process.env.DEMO_PASSWORD || 'Demo@123';
const upsertUser = (name,email,pass,role) => {
  const hash = bcrypt.hashSync(pass, 10);
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  let userId;
  if (existing) { userId = existing.id; db.prepare('UPDATE users SET password_hash=?, role=?, is_active=1 WHERE id=?').run(hash, role, userId); }
  else { userId = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)').run(name,email,hash,role).lastInsertRowid; }
  const prof = db.prepare('SELECT id FROM profiles WHERE user_id=? ORDER BY id LIMIT 1').get(userId);
  if (!prof) db.prepare('INSERT INTO profiles (user_id,name,avatar_color,is_kids) VALUES (?,?,?,?)').run(userId, name.split(' ')[0], role==='admin'?'#E50914':'#E50914', 0);
  return userId;
};
upsertUser('CineMax Admin', adminEmail, adminPass, 'admin');
const demoId = upsertUser('Demo User', 'demo@cinemax.app', demoPass, 'user');
const kids = db.prepare("SELECT id FROM profiles WHERE user_id=? AND is_kids=1").get(demoId);
if (!kids) db.prepare("INSERT INTO profiles (user_id,name,avatar_color,is_kids,audio_language,subtitle_language) VALUES (?,?,?,1,'en','en')").run(demoId, 'Kids', '#3fa9f5');
// demo profile also gets the catalog playable favorite? keep clean.
console.log(`Seeded ${seed.length} titles. Admin: ${adminEmail} / ${adminPass}   Demo: demo@cinemax.app / ${demoPass}`);
