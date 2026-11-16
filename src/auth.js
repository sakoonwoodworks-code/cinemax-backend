const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');
const { EMAIL_RE, track } = require('./util');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'cinemax-dev-secret-change-me';
if (!process.env.JWT_SECRET) console.warn('[CineMax] WARNING: JWT_SECRET not set — using development secret. Set it in .env for production.');

// lightweight in-memory rate limiter for auth endpoints
const hits = new Map();
setInterval(() => hits.clear(), 60_000).unref();
function rateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  if (n > 30) return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many attempts. Try again in a minute.' });
  next();
}

function sign(user) { return jwt.sign({ sub: user.id, role: user.role, email: user.email }, SECRET, { expiresIn: '30d' }); }
function publicUser(u) { return { id: u.id, name: u.name, email: u.email, role: u.role }; }

function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  // Fallback for preview proxies / WebViews that strip the Authorization header:
  // clients may also send the raw JWT in X-CineMax-Token.
  const rawAlt = req.headers['x-cinemax-token'];
  const token = m ? m[1] : (typeof rawAlt === 'string' && rawAlt.trim() ? rawAlt.trim() : null);
  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or malformed token.' });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(payload.sub);
    if (!user) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Account no longer exists.' });
    if (!user.is_active) return res.status(403).json({ error: 'ACCOUNT_DISABLED', message: 'This account has been disabled. Contact support.' });
    req.user = user;
    next();
  } catch { res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired token.' }); }
}

// Optional Auth: Guest access by default. If valid token is present, populates req.user.
// If token is missing, expired or invalid, sets a safe Guest user object and continues without 401.
function optionalAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  const rawAlt = req.headers['x-cinemax-token'];
  const token = m ? m[1] : (typeof rawAlt === 'string' && rawAlt.trim() ? rawAlt.trim() : null);
  if (!token) {
    req.user = { id: 0, name: 'Guest', email: 'guest@cinemax.app', role: 'guest', is_active: 1 };
    return next();
  }
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(payload.sub);
    if (user && user.is_active) {
      req.user = user;
    } else {
      req.user = { id: 0, name: 'Guest', email: 'guest@cinemax.app', role: 'guest', is_active: 1 };
    }
    next();
  } catch {
    req.user = { id: 0, name: 'Guest', email: 'guest@cinemax.app', role: 'guest', is_active: 1 };
    next();
  }
}

function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required.' });
    next();
  });
}

router.post('/register', rateLimit, (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || String(name).trim().length < 2 || String(name).trim().length > 60) return res.status(400).json({ error: 'VALIDATION', message: 'Name must be 2–60 characters.' });
  if (!email || !EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'VALIDATION', message: 'A valid email is required.' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'VALIDATION', message: 'Password must be at least 8 characters.' });
  const cleanEmail = String(email).trim().toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE email=?').get(cleanEmail)) return res.status(409).json({ error: 'EMAIL_TAKEN', message: 'An account with this email already exists.' });
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)').run(String(name).trim(), cleanEmail, hash, 'user');
  const profile = db.prepare('INSERT INTO profiles (user_id,name,avatar_color) VALUES (?,?,?)').run(info.lastInsertRowid, String(name).trim().split(' ')[0], '#E50914');
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  track(db, 'register', { userId: user.id });
  res.status(201).json({ token: sign(user), user: publicUser(user), profileId: profile.lastInsertRowid });
});

router.post('/login', rateLimit, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'VALIDATION', message: 'Email and password are required.' });
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(String(email).trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) return res.status(401).json({ error: 'BAD_CREDENTIALS', message: 'Invalid email or password.' });
  if (!user.is_active) return res.status(403).json({ error: 'ACCOUNT_DISABLED', message: 'This account has been disabled. Contact support.' });
  track(db, 'login', { userId: user.id });
  res.json({ token: sign(user), user: publicUser(user) });
});

router.post('/forgot', rateLimit, (req, res) => {
  const { email } = req.body || {};
  if (!email || !EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'VALIDATION', message: 'A valid email is required.' });
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(String(email).trim().toLowerCase());
  // Always answer generically to avoid account enumeration.
  const response = { message: 'If an account exists for this email, a reset link has been created.' };
  if (user) {
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('UPDATE users SET reset_token=?, reset_token_expires=? WHERE id=?').run(token, Date.now() + 30 * 60 * 1000, user.id);
    // In production this token would be emailed. In this self-hosted build we surface it for setup/testing:
    response.devToken = token;
    response.note = 'Email delivery is not configured in this self-hosted build, so the reset token is returned here. Configure SMTP to email it instead.';
  }
  res.json(response);
});

router.post('/reset', rateLimit, (req, res) => {
  const { token, password } = req.body || {};
  if (!token) return res.status(400).json({ error: 'VALIDATION', message: 'Reset token is required.' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'VALIDATION', message: 'Password must be at least 8 characters.' });
  const user = db.prepare('SELECT * FROM users WHERE reset_token=? AND reset_token_expires > ?').get(String(token), Date.now());
  if (!user) return res.status(400).json({ error: 'INVALID_TOKEN', message: 'Reset token is invalid or expired.' });
  db.prepare('UPDATE users SET password_hash=?, reset_token=NULL, reset_token_expires=NULL WHERE id=?').run(bcrypt.hashSync(String(password), 10), user.id);
  res.json({ message: 'Password updated. You can now sign in.' });
});

router.get('/me', authRequired, (req, res) => {
  const profiles = db.prepare('SELECT * FROM profiles WHERE user_id=? ORDER BY id').all(req.user.id)
    .map(p => ({ id: p.id, name: p.name, avatarColor: p.avatar_color, isKids: !!p.is_kids, audioLanguage: p.audio_language, subtitleLanguage: p.subtitle_language, appLanguage: p.app_language, videoQuality: p.video_quality, autoplay: !!p.autoplay, notifications: !!p.notifications }));
  res.json({ user: publicUser(req.user), profiles });
});

module.exports = { router, authRequired, optionalAuth, adminRequired, publicUser, sign };
