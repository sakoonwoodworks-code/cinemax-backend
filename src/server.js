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

// Catalog Integrity & Image Accuracy Repair:
// Automatically repairs mismatched TMDB IDs, restores correct official posters/backdrops,
// and boosts the latest 2024–2026 megahits on the Hero banner.
function repairCatalogMetadata() {
  try {
    const fixes = [
      { slug: 'rrr', tmdb: 579974, poster: 'https://image.tmdb.org/t/p/w500/wE0I6efAW4cDDmZQWtwZMOW44EJ.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/i0Y0wP8H6SRgjr6QmuwbtQbS24D.jpg' },
      { slug: '3-idiots', tmdb: 20453, poster: 'https://image.tmdb.org/t/p/w500/66A9MqXOyVFCssoloscw79z8Tew.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/u7kuUaySqXBVAtqEl9vkTkAzHV9.jpg' },
      { slug: 'pk', tmdb: 297222, poster: 'https://image.tmdb.org/t/p/w500/z2x2Y4tncefsIU7h82gmUM5vnBJ.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/gxfvtq5eYiClS2X7hxAAPBNrbWA.jpg' },
      { slug: 'gully-boy', tmdb: 491625, poster: 'https://image.tmdb.org/t/p/w500/4RE7TD5TqEXbPKyUHcn7CSeMlrJ.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/gcZbciueHH7WmD03GcVZX7LYqmR.jpg' },
      { slug: 'kgf-chapter-2', tmdb: 587412, poster: 'https://image.tmdb.org/t/p/w500/khNVygolU0TxLIDWff5tQlAhZ23.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/nsV5Mfi9FAV4w8eDsdr7uqVswOk.jpg' },
      { slug: 'vikram', tmdb: 743563, poster: 'https://image.tmdb.org/t/p/w500/774UV1aCURb4s4JfEFg3IEMu5Zj.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/dkIX4dSMuVqjfrPGunBJUR7K3LQ.jpg' },
      { slug: 'drishyam-2013', tmdb: 341012, poster: 'https://image.tmdb.org/t/p/w500/1X6k036T90u8vXf60N87fHq876G.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/vI0FpC599j2H3gJ5fMmsG0tM4a9.jpg' },
      { slug: 'nosferatu-1922', tmdb: 653, poster: 'https://image.tmdb.org/t/p/w500/520fA3tGvT3Jt7o3T0pG5c0Y3.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/z0gV3fI3WbZ3V0o8YgAWg0tM5c1.jpg' },
      { slug: 'sacred-games', tmdb: 79352, poster: 'https://image.tmdb.org/t/p/w500/uEbNtFbK4At9WBDGap23lt1qO9n.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/qtac9X9lSLqZFbxS71347N8MiID.jpg' },
      { slug: 'mirzapur', tmdb: 84105, poster: 'https://image.tmdb.org/t/p/w500/p0qM8hhlMF5DuxHBzl2EZR6TehX.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/3dV7pWAdwIPKR2lMIACMfObXdgK.jpg' },
      { slug: 'paatal-lok', tmdb: 103051, poster: 'https://image.tmdb.org/t/p/w500/8Hcq3HoJE4shH7BWkp9UNSFCE3O.jpg', backdrop: 'https://image.tmdb.org/t/p/w1280/bVKoX1AiN1jjUcvC7BkXypJPF2X.jpg' }
    ];
    for (const f of fixes) {
      db.prepare("UPDATE titles SET tmdb_id=?, poster_url=?, backdrop_url=? WHERE slug=? OR (title=? AND tmdb_id!=?)")
        .run(f.tmdb, f.poster, f.backdrop, f.slug, f.slug, f.tmdb);
    }
    // Remove old pre-2024 movies from Hero banner is_featured
    db.prepare("UPDATE titles SET is_featured=0 WHERE release_year < 2024").run();

    // Feature top 2024 mega blockbusters for the hero banner
    const topHits = [
      { title: 'Deadpool & Wolverine', pop: 650 },
      { title: 'Stree 2', pop: 640 },
      { title: 'Dune: Part Two', pop: 630 },
      { title: 'Pushpa 2 - The Rule', pop: 620 },
      { title: 'Kalki 2898-AD', pop: 610 },
      { title: 'Panchayat', pop: 600 }
    ];
    for (const h of topHits) {
      db.prepare("UPDATE titles SET is_featured=1, popularity=? WHERE title LIKE ?")
        .run(h.pop, '%' + h.title + '%');
    }

    // Direct HD profile photos for top seed titles
    db.prepare("UPDATE titles SET cast_json=? WHERE slug='rrr' OR (title='RRR' AND tmdb_id=579974)").run(JSON.stringify([
      { name: 'N.T. Rama Rao Jr.', character: 'Komaram Bheem', profile: 'https://image.tmdb.org/t/p/w185/5ycQgZ3SPUa12bq0yn1jpToBq9X.jpg' },
      { name: 'Ram Charan', character: 'Alluri Sitarama Raju', profile: 'https://image.tmdb.org/t/p/w185/twGqYUCR0Yh33j3TcgRTZRBRhTd.jpg' },
      { name: 'Alia Bhatt', character: 'Sita', profile: 'https://image.tmdb.org/t/p/w185/865tF9TqPz1Gj3aWkP0Kj9H4e7Y.jpg' },
      { name: 'Ajay Devgn', character: 'Venkata Rama Raju', profile: 'https://image.tmdb.org/t/p/w185/vnW0iV0c8M7V0Z8R1b7eR9y9Z8r.jpg' },
      { name: 'Olivia Morris', character: 'Jennifer', profile: 'https://image.tmdb.org/t/p/w185/iAzUTXzFWwEkRx6Ygudqnx4DmtW.jpg' }
    ]));
    db.prepare("UPDATE titles SET cast_json=? WHERE title LIKE '%Baahubali 2%' OR tmdb_id=350312").run(JSON.stringify([
      { name: 'Prabhas', character: 'Amarendra / Mahendra', profile: 'https://image.tmdb.org/t/p/w185/u6RVP8ukgLaymeoi5VmX0JRAcCn.jpg' },
      { name: 'Rana Daggubati', character: 'Bhallaladeva', profile: 'https://image.tmdb.org/t/p/w185/q0Rw0e9RogMD0zJ0Heq0GotDYoy.jpg' },
      { name: 'Anushka Shetty', character: 'Devasena', profile: 'https://image.tmdb.org/t/p/w185/zpe6Es8kdNOXuPdXiJvqxzsmN6z.jpg' },
      { name: 'Tamannaah Bhatia', character: 'Avantika', profile: 'https://image.tmdb.org/t/p/w185/s7vN1N0c1fH4a4vB8y8n7f4K8j.jpg' },
      { name: 'Ramya Krishnan', character: 'Sivagami', profile: 'https://image.tmdb.org/t/p/w185/7C1bj7z3XhqxjDIGoCs6MFJdSVa.jpg' }
    ]));
  } catch (err) {
    console.warn('[CineMax] Catalog repair check warning:', err.message);
  }
}
repairCatalogMetadata();

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

// Direct Android APK download endpoints
app.get(['/download', '/download/android', '/cinemax.apk', '/download/apk', '/api/download/android'], (req, res) => {
  const apkPath = path.join(__dirname, '..', 'public', 'CineMax.apk');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.download(apkPath, 'CineMax.apk', (err) => {
    if (err && !res.headersSent) {
      res.redirect('/CineMax.apk');
    }
  });
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
