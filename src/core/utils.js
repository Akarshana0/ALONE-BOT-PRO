const crypto = require('crypto');
const axios = require('axios');
const cfg = require('../config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (j) => String(j || '').split('@')[0].split(':')[0];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[m]));
const fmtUptime = (sec) => {
  sec = Math.floor(sec);
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(' ');
};
const bytes = (n) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; const i = Math.min(3, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(1)} ${u[i]}`;
};
const http = axios.create({ timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0 (ALONE-Bot)' } });
const getJson = async (url, opt) => (await http.get(url, opt)).data;
const getFile = async (url, opt = {}) => {
  const max = cfg.maxMediaMB * 1048576;
  const r = await http.get(url, { responseType: 'arraybuffer', maxContentLength: max, maxBodyLength: max, timeout: 120000, ...opt });
  return { buffer: Buffer.from(r.data), mime: String(r.headers['content-type'] || '').split(';')[0] };
};
const getBuf = async (url, opt) => (await getFile(url, opt)).buffer;
const hashNum = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
// message ids for everything the bot itself sends (handler ignores these so the bot never reacts to its own replies)
const botId = () => 'BAE5' + crypto.randomBytes(9).toString('hex').toUpperCase();
const safeRequire = (m) => { try { return require(m); } catch { return null; } };

module.exports = { sleep, num, pick, rnd, esc, fmtUptime, bytes, http, getJson, getFile, getBuf, hashNum, safeRequire, botId };
