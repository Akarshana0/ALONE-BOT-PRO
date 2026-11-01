// ALONE bot — central configuration (AKARSHANA)
require('dotenv').config();
const os = require('os');
const path = require('path');
const digits = (n) => String(n || '').replace(/\D/g, '');
const int = (v, d, min = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= min ? n : d; };
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));

module.exports = {
  botName: process.env.BOT_NAME || 'ALONE',
  ownerName: process.env.OWNER_NAME || 'AKARSHANA',
  ownerNumber: digits(process.env.OWNER_NUMBER || '94714768679'),
  prefix: process.env.PREFIX || '.',
  mongoUri: process.env.MONGODB_URI || '',
  pairNumber: digits(process.env.PAIR_NUMBER || ''),
  mainSession: 'main',
  maxSessions: parseInt(process.env.MAX_SESSIONS || '10', 10),
  allowPublicLink: bool(process.env.ALLOW_PUBLIC_LINK, true),
  defaultLang: process.env.DEFAULT_LANG || 'en',
  maxMediaMB: parseInt(process.env.MAX_MEDIA_MB || '60', 10),
  // 🎞️ full-film downloader (streams to disk, sent as ONE document)
  maxFilmMB: int(process.env.MAX_FILM_MB, 1800, 50),               // WhatsApp's hard limit is 2 GB — keep a safety margin
  filmQuality: int(process.env.FILM_QUALITY, 720, 144),            // preferred max height; auto steps down until the file fits
  filmMaxMinutes: int(process.env.FILM_MAX_MINUTES, 300, 10),
  filmConcurrency: int(process.env.FILM_CONCURRENCY, 1, 1),        // simultaneous film jobs (RAM/disk friendly default)
  filmQueueMax: int(process.env.FILM_QUEUE_MAX, 10, 1),
  tmpDir: process.env.TMP_DIR || path.join(os.tmpdir(), 'alone-film'),
  ytCookies: process.env.YT_COOKIES || '',                         // optional: JSON cookie array exported from a logged-in browser (fixes "confirm you're not a bot")
  ytProxy: process.env.YT_PROXY || '',                             // optional: http(s)://user:pass@host:port
  tz: process.env.TZ || 'Asia/Colombo',
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  geminiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  omdbKey: process.env.OMDB_API_KEY || '',
  bannerUrl: process.env.BANNER_URL || '',
  maxWarns: 3,
};
