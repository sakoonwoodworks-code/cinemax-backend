const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let DB_PATH = process.env.CINEMAX_DB;
if (!DB_PATH) {
  if (process.env.VERCEL) {
    const tmpDb = '/tmp/cinemax.db';
    const bundledDb = path.join(__dirname, '..', 'data', 'cinemax.db');
    if (!fs.existsSync(tmpDb) && fs.existsSync(bundledDb)) {
      try { fs.copyFileSync(bundledDb, tmpDb); } catch (e) { console.warn('[CineMax] Could not copy DB to /tmp:', e.message); }
    }
    DB_PATH = fs.existsSync(tmpDb) ? tmpDb : bundledDb;
  } else {
    DB_PATH = path.join(__dirname, '..', 'data', 'cinemax.db');
  }
}
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
if (!process.env.VERCEL) {
  db.pragma('journal_mode = WAL');
} else {
  try { db.pragma('journal_mode = DELETE'); } catch (_) {}
}
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
  is_active INTEGER NOT NULL DEFAULT 1,
  reset_token TEXT,
  reset_token_expires INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#E50914',
  is_kids INTEGER NOT NULL DEFAULT 0,
  audio_language TEXT NOT NULL DEFAULT 'en',
  subtitle_language TEXT NOT NULL DEFAULT 'en',
  app_language TEXT NOT NULL DEFAULT 'en',
  video_quality TEXT NOT NULL DEFAULT 'auto',
  autoplay INTEGER NOT NULL DEFAULT 1,
  notifications INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('movie','series')),
  title TEXT NOT NULL,
  overview TEXT NOT NULL DEFAULT '',
  release_year INTEGER,
  imdb_rating REAL,
  tmdb_rating REAL,
  runtime_min INTEGER,
  genres TEXT NOT NULL DEFAULT '',       -- csv
  audio_languages TEXT NOT NULL DEFAULT '', -- csv iso codes
  subtitle_languages TEXT NOT NULL DEFAULT '', -- csv
  country TEXT NOT NULL DEFAULT '',      -- csv iso
  director TEXT NOT NULL DEFAULT '',
  cast_json TEXT NOT NULL DEFAULT '[]',  -- json [{name, character}]
  maturity TEXT NOT NULL DEFAULT 'PG-13',
  quality TEXT NOT NULL DEFAULT 'HD',
  popularity REAL NOT NULL DEFAULT 0,
  is_trending INTEGER NOT NULL DEFAULT 0,
  is_popular INTEGER NOT NULL DEFAULT 0,
  is_top_rated INTEGER NOT NULL DEFAULT 0,
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_recently_added INTEGER NOT NULL DEFAULT 0,
  license TEXT,
  allow_download INTEGER NOT NULL DEFAULT 0,
  tmdb_id INTEGER,
  imdb_id TEXT,
  poster_url TEXT,
  backdrop_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS streams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'mp4',
  label TEXT NOT NULL DEFAULT 'Full',
  audio_language TEXT NOT NULL DEFAULT 'en',
  subtitle_tracks TEXT NOT NULL DEFAULT 'en', -- csv
  qualities TEXT NOT NULL DEFAULT 'Auto,1080p,720p,480p', -- csv
  provider TEXT NOT NULL DEFAULT 'CineMax licensed catalog',
  license TEXT NOT NULL DEFAULT 'Creative Commons / Public Domain',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  episode_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  overview TEXT NOT NULL DEFAULT '',
  runtime_min INTEGER NOT NULL DEFAULT 45,
  air_date TEXT,
  stream_url TEXT,
  stream_type TEXT DEFAULT 'mp4'
);

CREATE TABLE IF NOT EXISTS my_list (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (profile_id, title_id)
);

CREATE TABLE IF NOT EXISTS watch_progress (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  episode_id INTEGER NOT NULL DEFAULT 0,
  position_sec REAL NOT NULL DEFAULT 0,
  duration_sec REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (profile_id, title_id, episode_id)
);

CREATE TABLE IF NOT EXISTS watch_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  episode_id INTEGER NOT NULL DEFAULT 0,
  watched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  searched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  episode_id INTEGER NOT NULL DEFAULT 0,
  quality TEXT NOT NULL DEFAULT '720p',
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','downloading','paused','completed','failed')),
  progress REAL NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_titles_kind ON titles(kind);
CREATE INDEX IF NOT EXISTS idx_titles_year ON titles(release_year);
CREATE INDEX IF NOT EXISTS idx_titles_rating ON titles(imdb_rating);
CREATE INDEX IF NOT EXISTS idx_streams_title ON streams(title_id);
CREATE INDEX IF NOT EXISTS idx_progress_profile ON watch_progress(profile_id);
CREATE INDEX IF NOT EXISTS idx_history_profile ON watch_history(profile_id);
CREATE INDEX IF NOT EXISTS idx_mylist_profile ON my_list(profile_id);
`);

module.exports = db;
