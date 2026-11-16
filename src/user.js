const express = require('express');
const db = require('./db');
const { optionalAuth } = require('./auth');
const { mapTitle, track } = require('./util');

const router = express.Router();
router.use(optionalAuth);

function ownProfile(req, res, id) {
  if (!req.user || req.user.id === 0) {
    return { id: 0, user_id: 0, name: 'Guest', avatar_color: '#E50914', is_kids: 0, audio_language: 'en', subtitle_language: 'en', app_language: 'en', video_quality: 'auto', autoplay: 1, notifications: 1 };
  }
  const p = db.prepare('SELECT * FROM profiles WHERE id=? AND user_id=?').get(Number(id), req.user.id);
  if (!p) res.status(404).json({ error: 'PROFILE_NOT_FOUND', message: 'Profile not found.' });
  return p;
}
const dto = p => ({ id: p.id, name: p.name, avatarColor: p.avatar_color, isKids: !!p.is_kids, audioLanguage: p.audio_language, subtitleLanguage: p.subtitle_language, appLanguage: p.app_language, videoQuality: p.video_quality, autoplay: !!p.autoplay, notifications: !!p.notifications });

router.get('/profiles', (req, res) => {
  if (!req.user || req.user.id === 0) {
    return res.json({ profiles: [{ id: 0, name: 'Guest', avatarColor: '#E50914', isKids: false, audioLanguage: 'en', subtitleLanguage: 'en', appLanguage: 'en', videoQuality: 'auto', autoplay: true, notifications: true }] });
  }
  res.json({ profiles: db.prepare('SELECT * FROM profiles WHERE user_id=? ORDER BY id').all(req.user.id).map(dto) });
});

router.post('/profiles', (req, res) => {
  if (!req.user || req.user.id === 0) return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Please sign in to create profiles.' });
  const count = db.prepare('SELECT COUNT(*) c FROM profiles WHERE user_id=?').get(req.user.id).c;
  if (count >= 5) return res.status(400).json({ error: 'LIMIT', message: 'Maximum 5 profiles per account.' });
  const { name, isKids, avatarColor } = req.body || {};
  if (!name || String(name).trim().length < 1 || String(name).trim().length > 30) return res.status(400).json({ error: 'VALIDATION', message: 'Profile name must be 1–30 characters.' });
  const colors = ['#E50914','#3fa9f5','#46d369','#f5c518','#a78bfa','#ff7a1a'];
  const color = colors.includes(avatarColor) ? avatarColor : colors[count % colors.length];
  const info = db.prepare('INSERT INTO profiles (user_id,name,avatar_color,is_kids) VALUES (?,?,?,?)').run(req.user.id, String(name).trim(), color, isKids ? 1 : 0);
  res.status(201).json({ profile: dto(db.prepare('SELECT * FROM profiles WHERE id=?').get(info.lastInsertRowid)) });
});

router.put('/profiles/:id', (req, res) => {
  if (!req.user || req.user.id === 0) return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Please sign in to edit profiles.' });
  const p = ownProfile(req, res, req.params.id); if (!p) return;
  const { name, isKids, avatarColor, audioLanguage, subtitleLanguage, appLanguage, videoQuality, autoplay, notifications } = req.body || {};
  const cleanQuality = ['auto','480p','720p','1080p','4k'].includes(String(videoQuality||'')) ? String(videoQuality).toLowerCase().replace('4k','4K') : p.video_quality;
  db.prepare(`UPDATE profiles SET name=COALESCE(?,name), is_kids=COALESCE(?,is_kids), avatar_color=COALESCE(?,avatar_color),
    audio_language=COALESCE(?,audio_language), subtitle_language=COALESCE(?,subtitle_language), app_language=COALESCE(?,app_language),
    video_quality=?, autoplay=COALESCE(?,autoplay), notifications=COALESCE(?,notifications) WHERE id=?`)
    .run(name!=null?String(name).trim().slice(0,30):null, isKids==null?null:(isKids?1:0), avatarColor||null, audioLanguage||null, subtitleLanguage||null, appLanguage||null, cleanQuality, autoplay==null?null:(autoplay?1:0), notifications==null?null:(notifications?1:0), p.id);
  res.json({ profile: dto(db.prepare('SELECT * FROM profiles WHERE id=?').get(p.id)) });
});

router.delete('/profiles/:id', (req, res) => {
  if (!req.user || req.user.id === 0) return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Please sign in to delete profiles.' });
  const p = ownProfile(req, res, req.params.id); if (!p) return;
  const count = db.prepare('SELECT COUNT(*) c FROM profiles WHERE user_id=?').get(req.user.id).c;
  if (count <= 1) return res.status(400).json({ error: 'LIMIT', message: 'You must keep at least one profile.' });
  db.prepare('DELETE FROM profiles WHERE id=?').run(p.id);
  res.json({ message: 'Profile deleted.' });
});

router.get('/settings', (req, res) => {
  const p = ownProfile(req, res, req.query.profileId); if (!p) return;
  res.json({ settings: dto(p) });
});

router.put('/settings', (req, res) => {
  if (!req.user || req.user.id === 0) return res.json({ settings: { id: 0, name: 'Guest', videoQuality: 'auto' } });
  const p = ownProfile(req, res, req.body?.profileId); if (!p) return;
  req.params = { ...req.params, id: String(p.id) };
  const { audioLanguage, subtitleLanguage, appLanguage, videoQuality, autoplay, notifications } = req.body || {};
  const cleanQuality = ['auto','480p','720p','1080p','4k'].includes(String(videoQuality||'')) ? String(videoQuality).toLowerCase().replace('4k','4K') : p.video_quality;
  db.prepare(`UPDATE profiles SET audio_language=COALESCE(?,audio_language), subtitle_language=COALESCE(?,subtitle_language), app_language=COALESCE(?,app_language), video_quality=?, autoplay=COALESCE(?,autoplay), notifications=COALESCE(?,notifications) WHERE id=?`)
    .run(audioLanguage||null, subtitleLanguage||null, appLanguage||null, cleanQuality, autoplay==null?null:(autoplay?1:0), notifications==null?null:(notifications?1:0), p.id);
  res.json({ settings: dto(db.prepare('SELECT * FROM profiles WHERE id=?').get(p.id)) });
});

// ---------- My List ----------
router.get('/mylist', (req, res) => {
  if (!req.user || req.user.id === 0) return res.json({ items: [] });
  const p = ownProfile(req, res, req.query.profileId); if (!p) return;
  const rows = db.prepare('SELECT t.* FROM my_list m JOIN titles t ON t.id=m.title_id WHERE m.profile_id=? ORDER BY m.added_at DESC').all(p.id);
  const counts = new Map(db.prepare('SELECT title_id, COUNT(*) c FROM streams GROUP BY title_id').all().map(r => [r.title_id, r.c]));
  res.json({ items: rows.map(r => mapTitle(r, { streamCount: counts.get(r.id) || 0 })) });
});
router.post('/mylist', (req, res) => {
  if (!req.user || req.user.id === 0) return res.json({ message: 'Saved to local list.', titleId: req.body?.titleId });
  const p = ownProfile(req, res, req.body?.profileId); if (!p) return;
  const tid = parseInt(req.body?.titleId, 10);
  if (!db.prepare('SELECT id FROM titles WHERE id=?').get(tid)) return res.status(404).json({ error: 'NOT_FOUND', message: 'Title not found.' });
  db.prepare('INSERT OR IGNORE INTO my_list (profile_id,title_id) VALUES (?,?)').run(p.id, tid);
  res.status(201).json({ message: 'Added to My List.', titleId: tid });
});
router.delete('/mylist/:titleId', (req, res) => {
  if (!req.user || req.user.id === 0) return res.json({ message: 'Removed from local list.' });
  const p = ownProfile(req, res, req.query.profileId); if (!p) return;
  db.prepare('DELETE FROM my_list WHERE profile_id=? AND title_id=?').run(p.id, parseInt(req.params.titleId, 10));
  res.json({ message: 'Removed from My List.' });
});

// ---------- Progress / continue watching ----------
router.get('/progress', (req, res) => {
  if (!req.user || req.user.id === 0) return res.json({ progress: null });
  const p = ownProfile(req, res, req.query.profileId); if (!p) return;
  const pr = db.prepare('SELECT * FROM watch_progress WHERE profile_id=? AND title_id=? AND episode_id=?').get(p.id, parseInt(req.query.titleId, 10), parseInt(req.query.episodeId || '0', 10));
  res.json({ progress: pr ? { position: pr.position_sec, duration: pr.duration_sec, updatedAt: pr.updated_at } : null });
});
router.put('/progress', (req, res) => {
  if (!req.user || req.user.id === 0) return res.json({ message: 'Guest progress acknowledged.' });
  const p = ownProfile(req, res, req.body?.profileId); if (!p) return;
  const { titleId, episodeId, positionSec, durationSec } = req.body || {};
  const tid = parseInt(titleId, 10), eid = parseInt(episodeId || 0, 10);
  const pos = Math.max(0, Number(positionSec) || 0), dur = Math.max(0, Number(durationSec) || 0);
  if (!tid) return res.status(400).json({ error: 'VALIDATION', message: 'titleId is required.' });
  db.prepare(`INSERT INTO watch_progress (profile_id,title_id,episode_id,position_sec,duration_sec,updated_at)
    VALUES (?,?,?,?,?,datetime('now')) ON CONFLICT(profile_id,title_id,episode_id) DO UPDATE SET position_sec=excluded.position_sec, duration_sec=excluded.duration_sec, updated_at=datetime('now')`)
    .run(p.id, tid, eid, pos, dur);
  if (pos > 30 || dur > 0) db.prepare('INSERT INTO watch_history (profile_id,title_id,episode_id) VALUES (?,?,?)').run(p.id, tid, eid);
  res.json({ message: 'Progress saved.' });
});
router.delete('/progress', (req, res) => {
  if (!req.user || req.user.id === 0) return res.json({ message: 'Progress cleared.' });
  const p = ownProfile(req, res, req.query.profileId); if (!p) return;
  if (req.query.titleId) db.prepare('DELETE FROM watch_progress WHERE profile_id=? AND title_id=?').run(p.id, parseInt(req.query.titleId, 10));
  else db.prepare('DELETE FROM watch_progress WHERE profile_id=?').run(p.id);
  res.json({ message: 'Progress cleared.' });
});

router.get('/history', (req, res) => {
  if (!req.user || req.user.id === 0) return res.json({ items: [] });
  const p = ownProfile(req, res, req.query.profileId); if (!p) return;
  const rows = db.prepare(`SELECT t.*, MAX(h.watched_at) last FROM watch_history h JOIN titles t ON t.id=h.title_id WHERE h.profile_id=? GROUP BY t.id ORDER BY last DESC LIMIT 50`).all(p.id);
  const counts = new Map(db.prepare('SELECT title_id, COUNT(*) c FROM streams GROUP BY title_id').all().map(r => [r.title_id, r.c]));
  res.json({ items: rows.map(r => mapTitle(r, { streamCount: counts.get(r.id) || 0 })) });
});
router.delete('/history', (req, res) => {
  if (!req.user || req.user.id === 0) return res.json({ message: 'Watch history cleared.' });
  const p = ownProfile(req, res, req.query.profileId); if (!p) return;
  db.prepare('DELETE FROM watch_history WHERE profile_id=?').run(p.id);
  db.prepare('DELETE FROM watch_progress WHERE profile_id=?').run(p.id);
  res.json({ message: 'Watch history cleared.' });
});

// ---------- Downloads ----------
router.get('/downloads', (req, res) => {
  if (!req.user || req.user.id === 0) return res.json({ items: [] });
  const p = ownProfile(req, res, req.query.profileId); if (!p) return;
  const rows = db.prepare('SELECT d.*, t.title, t.slug, t.poster_url, t.kind, t.license FROM downloads d JOIN titles t ON t.id=d.title_id WHERE d.profile_id=? ORDER BY d.added_at DESC').all(p.id);
  res.json({ items: rows.map(r => ({ id: r.id, titleId: r.title_id, episodeId: r.episode_id || null, quality: r.quality, status: r.status, progress: r.progress, title: r.title, slug: r.slug, poster: r.poster_url || `/posters/${r.slug}.svg`, kind: r.kind, license: r.license })) });
});
router.post('/downloads', (req, res) => {
  const p = ownProfile(req, res, req.body?.profileId); if (!p) return;
  const { titleId, quality, episodeId } = req.body || {};
  const t = db.prepare('SELECT * FROM titles WHERE id=?').get(parseInt(titleId, 10));
  if (!t) return res.status(404).json({ error: 'NOT_FOUND', message: 'Title not found.' });
  if (!t.allow_download) return res.status(403).json({ error: 'DOWNLOAD_NOT_PERMITTED', message: 'The licensed provider of this title does not permit offline downloads. Contact your catalog administrator or check provider terms.' });
  const q = ['480p','720p','1080p'].includes(quality) ? quality : '720p';
  const info = db.prepare('INSERT INTO downloads (profile_id,title_id,episode_id,quality,status,progress) VALUES (?,?,?,?,?,0)').run(p.id, t.id, parseInt(episodeId || 0, 10), q, 'queued');
  res.status(201).json({ download: { id: info.lastInsertRowid, titleId: t.id, quality: q, status: 'queued', progress: 0 } });
});
router.put('/downloads/:id', (req, res) => {
  const p = ownProfile(req, res, req.body?.profileId); if (!p) return;
  const d = db.prepare('SELECT * FROM downloads WHERE id=? AND profile_id=?').get(parseInt(req.params.id, 10), p.id);
  if (!d) return res.status(404).json({ error: 'NOT_FOUND', message: 'Download not found.' });
  const status = ['queued','downloading','paused','completed','failed'].includes(req.body?.status) ? req.body.status : d.status;
  const progress = Math.min(100, Math.max(0, Number(req.body?.progress ?? d.progress)));
  db.prepare('UPDATE downloads SET status=?, progress=? WHERE id=?').run(status, progress, d.id);
  res.json({ message: 'Download updated.' });
});
router.delete('/downloads/:id', (req, res) => {
  const p = ownProfile(req, res, req.query.profileId); if (!p) return;
  db.prepare('DELETE FROM downloads WHERE id=? AND profile_id=?').run(parseInt(req.params.id, 10), p.id);
  res.json({ message: 'Download deleted.' });
});

module.exports = router;
