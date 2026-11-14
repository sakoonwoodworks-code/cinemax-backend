// Generates local SVG posters & backdrops for the seeded catalog (offline-safe previews).
const fs = require('fs');
const path = require('path');
const seed = require('./seedData');

const POSTERS = path.join(__dirname, '..', 'public', 'posters');
const BACKDROPS = path.join(__dirname, '..', 'public', 'backdrops');
fs.mkdirSync(POSTERS, { recursive: true });
fs.mkdirSync(BACKDROPS, { recursive: true });

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const HUES = [ [215,280],[350,20],[10,45],[160,200],[265,320],[190,240],[0,330],[25,5],[130,170],[285,300] ];
function huePair(slug){ let h=0; for (const c of slug) h=(h*31 + c.charCodeAt(0))>>>0; return HUES[h % HUES.length]; }
function wrap(text, max){
  const words = String(text).split(' '); const lines=[]; let cur='';
  for (const w of words){ if ((cur+' '+w).trim().length <= max) cur=(cur+' '+w).trim(); else { if (cur) lines.push(cur); cur=w; } }
  if (cur) lines.push(cur); return lines.slice(0,4);
}
function ratingBadge(r){ return r ? `<tspan fill="#ffd54a" font-weight="700">★ ${Number(r).toFixed(1)}</tspan>` : ''; }

for (const t of seed){
  const [h1,h2] = huePair(t.slug);
  const genre = (t.genres||'').split(',')[0].trim().toUpperCase();
  const lines = wrap(t.title, 13);
  const bg = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${h1} 55% 16%)"/><stop offset="0.55" stop-color="hsl(${h2} 60% 8%)"/><stop offset="1" stop-color="#050505"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.75" cy="0.18" r="0.9"><stop offset="0" stop-color="hsl(${h1} 80% 45%)" stop-opacity="0.55"/><stop offset="1" stop-color="transparent"/></radialGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="transparent"/><stop offset="1" stop-color="#000" stop-opacity="0.92"/></linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#glow)"/>`;
  const poster = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" role="img" aria-label="${esc(t.title)} poster">
  ${bg}
  <text x="24" y="46" fill="#E50914" font-family="Arial Black,Arial,sans-serif" font-size="17" letter-spacing="6" font-weight="900">CINEMAX</text>
  <text x="376" y="46" fill="#ffffff" fill-opacity="0.75" font-family="Arial,sans-serif" font-size="15" text-anchor="end">${esc(String(t.year||''))}</text>
  <path d="M24 78 L120 78 L132 90 L24 90 Z" fill="#E50914"/><text x="34" y="87.5" fill="#fff" font-family="Arial,sans-serif" font-size="10.5" font-weight="700" letter-spacing="2">${esc(genre)}</text>
  ${lines.map((l,i)=>`<text x="24" y="${392 + i*44}" fill="#ffffff" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="36">${esc(l)}</text>`).join('\n  ')}
  <rect width="400" height="150" y="450" fill="url(#fade)"/>
  <text x="24" y="566" font-family="Arial,sans-serif" font-size="16">${ratingBadge(t.rating)}<tspan fill="#ccc" font-size="13">  ·  ${esc((t.genres||'').split(',').slice(0,2).join(' · '))}</tspan></text>
</svg>`;
  const bdLines = wrap(t.title, 26);
  const backdrop = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" role="img" aria-label="${esc(t.title)} backdrop">
  ${bg}
  <path d="M64 108 L236 108 L248 120 L64 120 Z" fill="#E50914"/><text x="74" y="116.5" fill="#fff" font-family="Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="2.5">${esc(genre)}${t.kind==='series'?' SERIES':''}</text>
  ${bdLines.map((l,i)=>`<text x="64" y="${440 + i*86}" fill="#ffffff" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="78">${esc(l)}</text>`).join('\n  ')}
  <text x="64" y="700" fill="#ffb3b6" font-family="Arial,sans-serif" font-size="17" letter-spacing="3">CINEMAX<tspan fill="#ffffff" fill-opacity="0.7">  ·  ${esc(String(t.year||''))}  ·  ${Number(t.rating||0).toFixed(1)} ★</tspan></text>
</svg>`;
  fs.writeFileSync(path.join(POSTERS, t.slug + '.svg'), poster);
  fs.writeFileSync(path.join(BACKDROPS, t.slug + '.svg'), backdrop);
}
console.log(`Generated ${seed.length} posters and ${seed.length} backdrops.`);
