require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { router: authRoutes } = require('./auth');
const catalogRoutes = require('./catalog');
const userRoutes = require('./user');
const adminRoutes = require('./admin');
const tmdbRoutes = require('./tmdb');

// auto-seed on first boot if catalog empty
try {
  const c = db.prepare('SELECT COUNT(*) c FROM titles').get().c;
  if (c === 0) { console.log('[CineMax] Empty catalog — running seeder…'); require('./seed'); }
} catch (e) { console.error('[CineMax] Seed check failed:', e.message); }

// Auto-sync TMDB real posters and latest trending titles
let isSyncing = false;
async function triggerAutoSync() {
  if (isSyncing) return { status: 'already_running' };
  isSyncing = true;
  try {
    const { run: syncTmdb } = require('./sync_tmdb');
    console.log('[CineMax] Running catalog auto-sync (fetching latest releases & web series)...');
    await syncTmdb();
    console.log('[CineMax] Catalog auto-sync completed successfully.');
    return { status: 'ok' };
  } catch (e) {
    console.warn('[CineMax] TMDB auto-sync warning:', e.message);
    return { status: 'error', message: e.message };
  } finally {
    isSyncing = false;
  }
}

// Initial sync on boot (non-blocking)
setTimeout(() => { triggerAutoSync().catch(() => {}); }, 3000);

// Hourly periodic sync
setInterval(() => { triggerAutoSync().catch(() => {}); }, 60 * 60 * 1000);

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => { // security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  next();
});
app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

// request log (concise)
app.use((req, res, next) => { const t = Date.now(); res.on('finish', () => { if (req.path.startsWith('/api')) console.log(`${req.method} ${req.path} → ${res.statusCode} (${Date.now() - t}ms)`); }); next(); });

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'cinemax-backend', version: '1.0.0', time: new Date().toISOString() }));
app.post('/api/catalog/sync', async (req, res) => {
  const result = await triggerAutoSync();
  res.json(result);
});

app.use('/api/auth', authRoutes);
app.use('/api', catalogRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tmdb', tmdbRoutes);

// High-reliability Image Proxy for TMDB posters and backdrops (bypasses ISP/DNS blocks)
app.get('/api/proxy/image', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).send('Missing url parameter');
  }
  if (!targetUrl.startsWith('https://image.tmdb.org/') && !targetUrl.startsWith('http://image.tmdb.org/')) {
    return res.status(403).send('Forbidden target domain');
  }
  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!upstream.ok) {
      return res.status(upstream.status).send('Upstream image error');
    }
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    const arrayBuffer = await upstream.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    return res.status(502).send('Error proxying image: ' + err.message);
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Unknown endpoint.' }));
app.use('/api', (err, req, res, next) => { console.error('[CineMax] API error:', err); res.status(500).json({ error: 'SERVER_ERROR', message: 'Unexpected server error.' }); });

// static web preview (Netflix-style demo UI) — poster/backdrop assets + SPA
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0, index: 'index.html', setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

const PORT = Number(process.env.PORT || 8080);
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  🍿 CineMax backend listening on http://0.0.0.0:${PORT}`);
    console.log(`  Web preview:  http://localhost:${PORT}/`);
    console.log(`  API health:   http://localhost:${PORT}/api/health`);
    console.log(`  Admin login:  ${process.env.ADMIN_EMAIL || 'admin@cinemax.app'} (see .env)\n`);
  });
}

module.exports = app;
