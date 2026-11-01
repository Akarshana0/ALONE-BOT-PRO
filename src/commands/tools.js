const crypto = require('crypto');
const QR = require('qrcode');
const sharp = require('sharp');
const I = require('../core/i18n');
const media = require('../core/media');
const { getJson, getBuf, pick, rnd, safeRequire, http } = require('../core/utils');
const { frame, line } = require('../core/ui');
const translator = safeRequire('google-translate-api-x');

const T = [];
const txt = (name, aliases, desc, fn, usage = '<text>') => T.push({ name, aliases, category: 'tools', desc, usage, need: true, run: async (c) => c.reply(String(await fn(c.input, c))) });

// ─── text utilities ───
txt('upper', ['uppercase'], 'UPPERCASE text', (s) => s.toUpperCase());
txt('lower', ['lowercase'], 'lowercase text', (s) => s.toLowerCase());
txt('title', ['titlecase'], 'Title Case Text', (s) => s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()));
txt('reverse', ['rev'], 'Reverse text', (s) => [...s].reverse().join(''));
txt('count', ['wc', 'charcount'], 'Count characters / words / lines', (s) => `🔢 chars: ${s.length}\n📝 words: ${s.trim().split(/\s+/).length}\n📄 lines: ${s.split('\n').length}`);
txt('slug', [], 'Make a URL slug', (s) => s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-'));
txt('b64', ['base64', 'b64enc'], 'Base64 encode', (s) => Buffer.from(s).toString('base64'));
txt('unb64', ['b64dec', 'base64d'], 'Base64 decode', (s) => Buffer.from(s, 'base64').toString('utf8'));
txt('hex', [], 'Text → hex', (s) => Buffer.from(s).toString('hex'));
txt('unhex', [], 'Hex → text', (s) => Buffer.from(s.replace(/\s/g, ''), 'hex').toString('utf8'));
txt('bin', ['binary'], 'Text → binary', (s) => [...Buffer.from(s)].map((b) => b.toString(2).padStart(8, '0')).join(' '));
txt('unbin', ['unbinary'], 'Binary → text', (s) => Buffer.from(s.split(/\s+/).map((b) => parseInt(b, 2))).toString('utf8'));
txt('urlenc', ['urlencode'], 'URL encode', (s) => encodeURIComponent(s));
txt('urldec', ['urldecode'], 'URL decode', (s) => decodeURIComponent(s));
for (const h of ['md5', 'sha1', 'sha256']) txt(h, [], `${h.toUpperCase()} hash`, (s) => crypto.createHash(h).update(s).digest('hex'));
txt('rot13', [], 'ROT13 cipher', (s) => s.replace(/[a-z]/gi, (ch) => String.fromCharCode((ch <= 'Z' ? 90 : 122) >= (ch = ch.charCodeAt(0) + 13) ? ch : ch - 26)));
const MORSE = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.' };
const UNMORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
txt('morse', [], 'Text → Morse code', (s) => [...s.toLowerCase()].map((ch) => (ch === ' ' ? '/' : MORSE[ch] || '')).join(' '));
txt('unmorse', [], 'Morse code → text', (s) => s.split(' / ').map((w) => w.split(' ').map((x) => UNMORSE[x] || '').join('')).join(' '));
txt('leet', ['1337'], 'Convert to l33t', (s) => s.replace(/[aeiost]/gi, (m) => ({ a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' }[m.toLowerCase()])));
txt('palindrome', ['ispal'], 'Palindrome check', (s) => { const n = s.toLowerCase().replace(/[^a-z0-9]/g, ''); return n === [...n].reverse().join('') ? '✅ Palindrome' : '❌ Not a palindrome'; });
txt('roman', [], 'Number → Roman numeral', (s) => { let n = parseInt(s, 10); if (!(n > 0 && n < 4000)) return '1–3999 only'; const m = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let r = ''; for (const [v, sym] of m) while (n >= v) { r += sym; n -= v; } return r; }, '<number>');
txt('calc', ['calculate', 'math2'], 'Safe calculator', (s) => { const e = s.replace(/\^/g, '**').replace(/×/g, '*').replace(/÷/g, '/'); if (!/^[\d\s+\-*/().%*]+$/.test(e)) return '⚠️ numbers and + - * / ( ) % ^ only'; const r = Function(`"use strict";return (${e})`)(); return `🧮 ${s} = *${r}*`; }, '<expression>');
txt('percent', ['pct'], 'X percent of Y', (s) => { const [p, v] = s.split(/\s+/).map(Number); return `📊 ${p}% of ${v} = *${(p * v) / 100}*`; }, '<percent> <value>');
txt('bmi', [], 'Body-mass index', (s) => { const [kg, cm] = s.split(/\s+/).map(Number); const b = kg / (cm / 100) ** 2; return `⚖️ BMI: *${b.toFixed(1)}* — ${b < 18.5 ? 'Underweight' : b < 25 ? 'Normal' : b < 30 ? 'Overweight' : 'Obese'}`; }, '<kg> <cm>');
txt('age', [], 'Age from birth date', (s) => { const d = new Date(s); if (isNaN(d)) return '⚠️ use YYYY-MM-DD'; const ms = Date.now() - d; const y = Math.floor(ms / 31557600000); return `🎂 ${y} years • ${Math.floor(ms / 86400000)} days`; }, '<YYYY-MM-DD>');
txt('timestamp', ['unixtime'], 'Unix timestamp ↔ date', (s) => (/^\d{9,13}$/.test(s) ? new Date(s.length > 10 ? +s : s * 1000).toUTCString() : String(Math.floor(new Date(s) / 1000))), '<unix|date>');
txt('shorten', ['short', 'tinyurl'], 'Shorten a URL', async (s) => (await http.get(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(s)}`)).data, '<url>');

// ─── no-input generators ───
const gen = (name, aliases, desc, fn, usage = '') => T.push({ name, aliases, category: 'tools', desc, usage, run: async (c) => c.reply(String(await fn(c))) });
gen('uuid', ['guid'], 'Random UUID v4', () => crypto.randomUUID());
gen('genpass', ['password', 'pass'], 'Strong random password', (c) => { const n = Math.min(64, Math.max(8, parseInt(c.args[0] || '16', 10))); const set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?'; return `🔑 ${Array.from({ length: n }, () => set[crypto.randomInt(set.length)]).join('')}`; }, '[length]');
gen('rand', ['random', 'rng'], 'Random number', (c) => { const [a, b] = [parseInt(c.args[0] || '1', 10), parseInt(c.args[1] || '100', 10)]; return `🎲 ${rnd(Math.min(a, b), Math.max(a, b))}`; }, '[min] [max]');
gen('lorem', ['ipsum'], 'Lorem ipsum text', () => 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.');

// ─── fancy fonts ───
const mapFont = (s, up, low, digit) => [...s].map((ch) => { const c = ch.codePointAt(0); if (c >= 65 && c <= 90) return String.fromCodePoint(up + c - 65); if (c >= 97 && c <= 122) return String.fromCodePoint(low + c - 97); if (digit && c >= 48 && c <= 57) return String.fromCodePoint(digit + c - 48); return ch; }).join('');
const SMALL = { a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ' };
const FONTS = {
  sbold: (s) => mapFont(s, 0x1d5d4, 0x1d5ee, 0x1d7ec),
  mono: (s) => mapFont(s, 0x1d670, 0x1d68a, 0x1d7f6),
  bubble: (s) => mapFont(s, 0x24b6, 0x24d0, 0),
  vapor: (s) => [...s].map((ch) => (ch === ' ' ? '　' : ch.charCodeAt(0) > 32 && ch.charCodeAt(0) < 127 ? String.fromCharCode(ch.charCodeAt(0) + 0xfee0) : ch)).join(''),
  smallcaps: (s) => [...s.toLowerCase()].map((ch) => SMALL[ch] || ch).join(''),
};
for (const [k, fn] of Object.entries(FONTS)) txt(k, k === 'sbold' ? ['bold'] : [], `${k} font style`, fn);
txt('mock', ['spongebob'], 'mOcKiNg tExT', (s) => [...s].map((ch, i) => (i % 2 ? ch.toUpperCase() : ch.toLowerCase())).join(''));
txt('fancy', ['fonts'], 'Show text in every font style', (s) => Object.values(FONTS).map((f) => f(s)).join('\n'));

// ─── network tools ───
T.push({ name: 'translate', aliases: ['tr', 'trt'], category: 'tools', desc: 'Translate text (en, si, ar, hi, ta, fr …)', usage: '<lang code> <text | reply>', need: true, run: async (c) => {
  if (!translator) return c.reply('translator module missing');
  const lang = c.args[0].toLowerCase(); const text = c.args.slice(1).join(' ') || c.quoted?.text;
  if (!text) return c.reply(c.t('usage', { usage: `${c.prefix}translate si Hello` }));
  const r = await translator(text, { to: lang });
  return c.reply(frame(`🌐 ${r.from?.language?.iso || '?'} ➜ ${lang}`, r.text));
} });
T.push({ name: 'tts', aliases: ['say', 'speak'], category: 'tools', desc: 'Text to speech', usage: '[lang] <text>', need: true, run: async (c) => {
  let lang = c.lang, text = c.input;
  if (/^[a-z]{2}(-[A-Z]{2})?$/.test(c.args[0]) && c.args.length > 1) { lang = c.args[0]; text = c.args.slice(1).join(' '); }
  const buf = await getBuf(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text.slice(0, 200))}`);
  return c.send({ audio: buf, mimetype: 'audio/mpeg', ptt: true });
} });
T.push({ name: 'qr', aliases: ['qrcode'], category: 'tools', desc: 'Generate a QR code', usage: '<text|link>', need: true, run: async (c) => c.send({ image: await QR.toBuffer(c.input, { width: 600, margin: 2, color: { dark: '#00c8ff', light: '#0b0220' } }), caption: '⚡ QR' }) });
T.push({ name: 'ssweb', aliases: ['screenshot', 'ss'], category: 'tools', desc: 'Screenshot of a website', usage: '<url>', need: true, run: async (c) => { const u = /^https?:/.test(c.input) ? c.input : `https://${c.input}`; return c.send({ image: await getBuf(`https://image.thum.io/get/width/1280/crop/720/${u}`, { timeout: 60000 }), caption: `🖥️ ${u}` }); } });
T.push({ name: 'tourl', aliases: ['upload', 'catbox'], category: 'tools', desc: 'Upload media and get a link', run: async (c) => {
  const m = await c.getMedia(); if (!m) return c.reply(c.t('reply_media'));
  const f = new FormData(); f.append('reqtype', 'fileupload'); f.append('fileToUpload', new Blob([m.buffer]), `file.${(m.mime.split('/')[1] || 'bin').split(';')[0]}`);
  const r = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: f });
  return c.reply(`🔗 ${await r.text()}`);
} });
T.push({ name: 'color', aliases: ['colour', 'hexcolor'], category: 'tools', desc: 'Preview a colour (hex)', usage: '<#hex>', need: true, run: async (c) => {
  const h = c.input.replace('#', '').trim(); if (!/^[0-9a-f]{6}$/i.test(h)) return c.reply('⚠️ e.g. #00f0ff');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return c.send({ image: await sharp({ create: { width: 400, height: 240, channels: 3, background: { r, g, b } } }).png().toBuffer(), caption: `🎨 #${h.toUpperCase()}\nrgb(${r}, ${g}, ${b})` });
} });

// ─── media tools ───
T.push({ name: 'sticker', aliases: ['s', 'stiker'], category: 'tools', desc: 'Image/video/GIF → sticker', run: async (c) => {
  const m = await c.getMedia(); if (!m || !['image', 'video'].includes(m.type)) return c.reply(c.t('reply_media'));
  await c.react('⏳');
  return c.send({ sticker: m.type === 'image' ? await media.imgToSticker(m.buffer) : await media.videoToWebp(m.buffer) });
} });
T.push({ name: 'toimg', aliases: ['stickertoimg'], category: 'tools', desc: 'Sticker → image', run: async (c) => { const m = await c.getMedia(); if (!m || m.type !== 'sticker') return c.reply(c.t('reply_media')); return c.send({ image: await media.stickerToPng(m.buffer) }); } });
T.push({ name: 'tomp3', aliases: ['toaudio'], category: 'tools', desc: 'Video/voice → MP3', run: async (c) => { const m = await c.getMedia(); if (!m || !['video', 'audio'].includes(m.type)) return c.reply(c.t('reply_media')); return c.send({ audio: await media.toMp3(m.buffer), mimetype: 'audio/mpeg' }); } });
T.push({ name: 'tovoice', aliases: ['toptt'], category: 'tools', desc: 'Audio → voice note', run: async (c) => { const m = await c.getMedia(); if (!m || !['video', 'audio'].includes(m.type)) return c.reply(c.t('reply_media')); return c.send({ audio: await media.ff(m.buffer, ['-vn', '-c:a', 'libopus', '-b:a', '48k'], 'ogg'), mimetype: 'audio/ogg; codecs=opus', ptt: true }); } });

module.exports = T;
