const sharp = require('sharp');
const { esc, getBuf, rnd } = require('../core/utils');
const { frame, btn, cmd } = require('../core/ui');
const ui = require('../core/ui');

const I = [];
const base = { category: 'image' };

// ───────── AI image generation (Pollinations — free, no key) ─────────
const gen = (name, aliases, desc, model, suffix = '') => I.push({ ...base, name, aliases, desc, usage: '<prompt>', need: true, run: async (c) => {
  await c.react('🎨');
  const seed = rnd(1, 999999);
  const buf = await getBuf(`https://image.pollinations.ai/prompt/${encodeURIComponent(c.input + suffix)}?width=1024&height=1024&nologo=true&seed=${seed}${model ? `&model=${model}` : ''}`, { timeout: 120000 });
  return c.send({ image: buf, caption: `🎨 ${c.input.slice(0, 120)}` });
} });
gen('imagine', ['img', 'aiimg', 'gen'], 'AI image generator', 'flux');
gen('imagine2', ['img2'], 'AI image generator (fast model)', 'turbo');
gen('wallpaper', ['wall'], 'Cyberpunk-style AI wallpaper', 'flux', ', ultra detailed wallpaper, 4k, cinematic');
gen('anime', ['animeart'], 'AI anime-style art', 'flux', ', anime style, detailed illustration');
gen('avatar', ['pfp'], 'AI profile avatar', 'flux', ', profile avatar, centered, high quality');

// ───────── Logo maker (rendered locally with SVG → PNG, no external API) ─────────
const STYLES = {
  neon:       { bg: ['#05010f', '#120236'], fill: ['#00f0ff', '#00b3ff'], stroke: '#ffffff', glow: 10, fx: 'grid' },
  neonpink:   { bg: ['#12000f', '#2b0030'], fill: ['#ff4fd8', '#ff1f9c'], stroke: '#ffd6f5', glow: 10, fx: 'grid' },
  neongreen:  { bg: ['#00100a', '#002a17'], fill: ['#39ff14', '#00e676'], stroke: '#eaffea', glow: 10, fx: 'grid' },
  neonpurple: { bg: ['#0a0020', '#1d0050'], fill: ['#b388ff', '#7c4dff'], stroke: '#efe7ff', glow: 10, fx: 'grid' },
  glitch:     { bg: ['#000000', '#0d0d1a'], fill: ['#ffffff', '#ffffff'], stroke: null, glow: 0, fx: 'glitch' },
  cyberpunk:  { bg: ['#0a0014', '#240046'], fill: ['#fcee0a', '#ff9e00'], stroke: '#ff00a0', glow: 7, fx: 'grid' },
  matrix:     { bg: ['#000000', '#001a00'], fill: ['#00ff41', '#00c030'], stroke: null, glow: 6, fx: 'matrix' },
  hacker:     { bg: ['#000000', '#050505'], fill: ['#00ff66', '#00ff66'], stroke: null, glow: 4, fx: 'scan', mono: true },
  fire:       { bg: ['#140000', '#3a0800'], fill: ['#fff176', '#ff9100', '#ff1744'], stroke: '#ff3d00', glow: 8, fx: null },
  ice:        { bg: ['#001428', '#003a66'], fill: ['#ffffff', '#a5e8ff', '#3aa8ff'], stroke: '#cdf3ff', glow: 7, fx: 'stars' },
  gold:       { bg: ['#0e0a00', '#2b1d00'], fill: ['#fff3b0', '#ffc107', '#b8860b'], stroke: '#6b4e00', glow: 3, fx: null },
  chrome:     { bg: ['#101418', '#2a3038'], fill: ['#ffffff', '#9aa5b1', '#e8edf2', '#6b7683'], stroke: '#1b1f24', glow: 2, fx: null },
  retro:      { bg: ['#2b0a4d', '#ff4f9a'], fill: ['#fff176', '#ff9ec7'], stroke: '#3b0a6e', glow: 3, fx: 'sun' },
  galaxy:     { bg: ['#02010a', '#1a0b3d'], fill: ['#ffffff', '#c3a6ff', '#6fa8ff'], stroke: '#ffffff', glow: 8, fx: 'stars' },
  sunset:     { bg: ['#1a0a2e', '#ff6b35'], fill: ['#ffffff', '#ffe0b3'], stroke: '#5b1a00', glow: 4, fx: 'sun' },
  blood:      { bg: ['#0a0000', '#220000'], fill: ['#ff1a1a', '#8b0000'], stroke: '#000000', glow: 6, fx: null },
  shadow3d:   { bg: ['#101020', '#1f1f3d'], fill: ['#ffffff', '#cfd8ff'], stroke: null, glow: 0, fx: 'shadow' },
  rainbow:    { bg: ['#0a0a14', '#14142a'], fill: ['#ff0055', '#ff9100', '#ffee00', '#00e676', '#00b0ff', '#b388ff'], stroke: null, glow: 3, fx: null },
};

function logoSvg(key, text) {
  const s = STYLES[key], W = 1024, H = 512;
  const fs = Math.max(54, Math.min(170, Math.floor(900 / (Math.max(text.length, 1) * 0.66))));
  const t = esc(text);
  const font = s.mono ? "DejaVu Sans Mono, monospace" : "DejaVu Sans, Arial, sans-serif";
  const stops = s.fill.map((c, i) => `<stop offset="${(i / Math.max(1, s.fill.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('');
  const txt = (extra = '', x = 512, y = 300) => `<text x="${x}" y="${y}" text-anchor="middle" font-family="${font}" font-size="${fs}" font-weight="900" ${extra}>${t}</text>`;
  let layers = '';
  if (s.fx === 'grid') layers += `<rect width="${W}" height="${H}" fill="url(#grid)"/>`;
  if (s.fx === 'scan') for (let y = 0; y < H; y += 6) layers += `<rect y="${y}" width="${W}" height="2" fill="#00ff66" fill-opacity="0.05"/>`;
  if (s.fx === 'matrix') for (let i = 0; i < 46; i++) layers += `<text x="${i * 23 + 6}" y="${rnd(20, 500)}" font-family="DejaVu Sans Mono, monospace" font-size="20" fill="#00ff41" fill-opacity="${(Math.random() * 0.35 + 0.08).toFixed(2)}">${'01'[rnd(0, 1)]}${'10'[rnd(0, 1)]}${'01'[rnd(0, 1)]}</text>`;
  if (s.fx === 'stars') for (let i = 0; i < 90; i++) layers += `<circle cx="${rnd(0, W)}" cy="${rnd(0, H)}" r="${(Math.random() * 2 + 0.5).toFixed(1)}" fill="#fff" fill-opacity="${(Math.random() * 0.8 + 0.2).toFixed(2)}"/>`;
  if (s.fx === 'sun') layers += `<circle cx="512" cy="330" r="190" fill="#ffd166" fill-opacity="0.35"/>` + Array.from({ length: 9 }, (_, i) => `<rect x="300" y="${330 + i * 22}" width="424" height="${2 + i}" fill="#2b0a4d" fill-opacity="0.55"/>`).join('');
  let main;
  if (s.fx === 'glitch') main = txt('fill="#ff003c" fill-opacity="0.85"', 502, 296) + txt('fill="#00f0ff" fill-opacity="0.85"', 522, 304) + txt('fill="#ffffff"');
  else if (s.fx === 'shadow') main = Array.from({ length: 14 }, (_, i) => txt('fill="#4a3fd0"', 512 + 14 - i, 300 + 14 - i)).join('') + txt('fill="url(#fg)"');
  else main = txt(`fill="url(#fg)" ${s.stroke ? `stroke="${s.stroke}" stroke-width="${s.glow > 5 ? 2 : 4}" paint-order="stroke"` : ''} ${s.glow ? 'filter="url(#glow)"' : ''}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${s.bg[0]}"/><stop offset="1" stop-color="${s.bg[1]}"/></linearGradient>
    <linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${s.glow}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#ffffff" stroke-opacity="0.07"/></pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>${layers}${main}
  <text x="${W - 28}" y="${H - 24}" text-anchor="end" font-family="DejaVu Sans Mono, monospace" font-size="18" fill="#ffffff" fill-opacity="0.45">ALONE // AKARSHANA</text>
</svg>`;
}
const render = (key, text) => sharp(Buffer.from(logoSvg(key, text.slice(0, 24)))).png().toBuffer();

for (const k of Object.keys(STYLES)) I.push({ ...base, name: k, aliases: [], desc: `${k} style logo`, usage: '<text>', need: true, run: async (c) => c.send({ image: await render(k, c.input), caption: `✨ ${k} • ALONE` }) });
I.push({ ...base, name: 'logo', aliases: ['logomaker', 'textlogo'], desc: 'Logo maker — pick a style', usage: '[style] <text>', run: async (c) => {
  const st = (c.args[0] || '').toLowerCase();
  if (STYLES[st] && c.args.length > 1) return c.send({ image: await render(st, c.args.slice(1).join(' ')), caption: `✨ ${st} • ALONE` });
  const text = c.input && !STYLES[st] ? c.input : 'ALONE';
  const rows = Object.keys(STYLES).map((k) => ({ title: `🎨 ${k}`, desc: `${c.prefix}${k} <text>`, id: cmd(`${k} ${text}`) }));
  const sections = []; for (let i = 0; i < rows.length; i += 10) sections.push({ title: `Styles ${i / 10 + 1}`, rows: rows.slice(i, i + 10) });
  return ui.send(c, { title: '🎨 LOGO MAKER', body: frame('🎨 LOGO MAKER', `┃ ✍️ Text: *${text}*\n┃ Pick a style below 👇\n┃ ${c.prefix}logo <style> <text>`), buttons: [btn.list('🎨 Styles', sections)] });
} });
I.push({ ...base, name: 'logos', aliases: ['logostyles'], desc: 'List all logo styles', run: (c) => c.reply(frame('🎨 STYLES', Object.keys(STYLES).map((k) => `┃ ▫️ ${c.prefix}${k} <text>`).join('\n'))) });

// ───────── Image effects (reply to an image) ─────────
const fx = (name, aliases, desc, fn) => I.push({ ...base, name, aliases, desc, run: async (c) => {
  const m = await c.getMedia(); if (!m || m.type !== 'image') return c.reply(c.t('reply_media'));
  return c.send({ image: await fn(sharp(m.buffer), c, m.buffer).toBuffer(), caption: `⚡ ${name}` });
} });
fx('blur', [], 'Blur an image', (s) => s.blur(12).jpeg());
fx('gray', ['grayscale', 'bw'], 'Black & white', (s) => s.grayscale().jpeg());
fx('invert', ['negative'], 'Invert colours', (s) => s.negate().jpeg());
fx('sepia', ['vintage'], 'Sepia filter', (s) => s.recomb([[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]]).jpeg());
fx('rotate', ['rot'], 'Rotate 90°', (s, c) => s.rotate(parseInt(c.args[0] || '90', 10)).jpeg());
fx('mirror', ['flipimg'], 'Mirror horizontally', (s) => s.flop().jpeg());
fx('pixel', ['pixelate'], 'Pixelate', (s) => s.resize(48, null, { kernel: 'nearest' }).resize(768, null, { kernel: 'nearest' }).jpeg());
fx('circle', ['roundpic'], 'Circle crop (PNG)', (s) => s.resize(600, 600, { fit: 'cover' }).composite([{ input: Buffer.from('<svg width="600" height="600"><circle cx="300" cy="300" r="300"/></svg>'), blend: 'dest-in' }]).png());

module.exports = I;
