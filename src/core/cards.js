// Cyberpunk welcome/goodbye cards rendered with sharp (SVG -> PNG)
const sharp = require('sharp');
const { esc, getBuf } = require('./utils');

async function avatar(sock, jid) {
  let buf;
  try { buf = await getBuf(await sock.profilePictureUrl(jid, 'image'), { timeout: 15000 }); } catch { /* default */ }
  if (!buf) buf = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#1b1033"/><circle cx="100" cy="78" r="38" fill="#00f0ff"/><ellipse cx="100" cy="170" rx="62" ry="46" fill="#00f0ff"/></svg>`);
  const mask = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="100"/></svg>');
  return sharp(buf).resize(200, 200, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function makeCard(sock, { jid, name, line1, line2, color = '#00f0ff', accent = '#ff2bd6' }) {
  const W = 1000, H = 420;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0220"/><stop offset="1" stop-color="#1a0b3d"/></linearGradient>
    <filter id="g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${color}" stroke-opacity="0.12"/></pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#grid)"/>
  <rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="18" fill="none" stroke="${color}" stroke-width="3" filter="url(#g)"/>
  <circle cx="190" cy="210" r="112" fill="none" stroke="${accent}" stroke-width="6" filter="url(#g)"/>
  <text x="360" y="150" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" font-weight="700" fill="${accent}" filter="url(#g)">${esc(line1)}</text>
  <text x="360" y="225" font-family="DejaVu Sans, Arial, sans-serif" font-size="${name.length > 18 ? 40 : 54}" font-weight="900" fill="#ffffff" filter="url(#g)">${esc(name.slice(0, 26))}</text>
  <text x="360" y="285" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" fill="${color}">${esc(line2.slice(0, 40))}</text>
  <text x="${W - 40}" y="${H - 34}" text-anchor="end" font-family="DejaVu Sans Mono, monospace" font-size="18" fill="${color}" fill-opacity="0.8">ALONE // AKARSHANA</text>
  </svg>`;
  const av = await avatar(sock, jid);
  return sharp(Buffer.from(svg)).composite([{ input: av, left: 90, top: 110 }]).png().toBuffer();
}
module.exports = { makeCard };
