// 🎞️ FILM ENGINE — full-length films, delivered as ONE WhatsApp document.
//
//  • Everything is streamed to DISK (never buffered in RAM) → a 1.5 GB film uses a few MB of memory.
//  • Auto quality ladder: highest quality ≤ FILM_QUALITY whose size fits MAX_FILM_MB (WhatsApp hard limit is 2 GB) and the free disk.
//  • HD = separate video + audio streams merged with ffmpeg (stream copy, no re-encode, takes seconds). Fallback = muxed 360p.
//  • Network hiccups never restart the download: it RESUMES from the last byte (HTTP Range), with a stall watchdog.
//  • Job queue (FILM_CONCURRENCY), per-user limit, cancel, live progress events, temp files always cleaned.
//  • Sources: YouTube (full movies / long videos) and the Internet Archive (free & public-domain feature films).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const cfg = require('../config');
const log = require('../logger');
const { safeRequire, sleep, http } = require('./utils');
const dl = require('./dl');

const ffmpegPath = safeRequire('ffmpeg-static') || 'ffmpeg';
const btch = safeRequire('btch-downloader');
const sharp = safeRequire('sharp');
const MB = 1048576;
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

class FilmError extends Error {
  constructor(code, message, extra) { super(message || code); this.code = code; Object.assign(this, extra); }
}
const isAbort = (e) => e?.name === 'AbortError' || e?.code === 'ABORT_ERR';
const num = (v) => Number(v) || 0;
const cap = () => cfg.maxFilmMB * MB;

// ───────────────────────── disk helpers ─────────────────────────
async function ensureTmp() { await fsp.mkdir(cfg.tmpDir, { recursive: true }); }
async function freeBytes() {
  try { await ensureTmp(); const s = await fsp.statfs(cfg.tmpDir); return Number(s.bavail) * Number(s.bsize); } catch { return Infinity; }
}
const sizeOf = async (f) => { try { return (await fsp.stat(f)).size; } catch { return 0; } };

// ───────────────────────── resumable stream → file ─────────────────────────
async function pipeOnce(src, file, flags, { signal, stallMs, base, onBytes, limit }) {
  let got = 0, last = Date.now();
  const watch = new Transform({
    transform(chunk, _enc, cb) {
      got += chunk.length; last = Date.now();
      if (limit && base + got > limit) return cb(new FilmError('TOO_BIG'));
      onBytes(base + got);
      cb(null, chunk);
    },
  });
  const out = fs.createWriteStream(file, { flags });
  const timer = setInterval(() => { if (Date.now() - last > stallMs) src.destroy(new Error('download stalled')); }, 5000);
  try { await pipeline(src, watch, out, signal ? { signal } : {}); }
  finally {
    clearInterval(timer);
    if (!out.closed) await new Promise((r) => out.once('close', r));
  }
}

// open(startByte) -> Readable (or Promise<Readable>); may set readable.totalBytes (size of the WHOLE file).
// Throws FilmError (fatal) / {code:'RESTART'} (server can't resume) / anything else (retried, resuming from the last byte).
async function streamToFile(open, file, { total = 0, onBytes = () => {}, signal, stallMs = 60000, retries = 6, limit = cap() } = {}) {
  await fsp.rm(file, { force: true });
  let written = 0;
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new FilmError('CANCELLED');
    let src;
    try {
      src = await open(written);
      if (src.totalBytes) total = src.totalBytes;
      if (total && total > limit) { src.destroy(); throw new FilmError('TOO_BIG'); }
      await pipeOnce(src, file, written ? 'a' : 'w', { signal, stallMs, base: written, onBytes, limit });
      const size = await sizeOf(file);
      if (total && size < total * 0.999) throw new Error(`truncated stream (${size}/${total})`);
      if (!size) throw new Error('empty download');
      return size;
    } catch (e) {
      src?.destroy?.();
      if (e instanceof FilmError) throw e;
      if (signal?.aborted || isAbort(e)) throw new FilmError('CANCELLED');
      if (e.code === 'RESTART') { await fsp.rm(file, { force: true }); written = 0; }
      else written = await sizeOf(file);
      if (attempt >= retries) throw e;
      log.warn({ err: e.message, resumeAt: written, attempt: attempt + 1 }, 'film download interrupted — resuming');
      await sleep(Math.min(10000, 1200 * (attempt + 1)));
    }
  }
}

// plain HTTP source with Range-resume support
const httpOpen = (url, headers = {}) => async (start) => {
  const r = await http.get(url, {
    responseType: 'stream', timeout: 30000, maxRedirects: 8,
    headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Encoding': 'identity', ...headers, ...(start ? { Range: `bytes=${start}-` } : {}) },
    validateStatus: (s) => s === 200 || s === 206,
  });
  if (start && r.status !== 206) { r.data.destroy(); throw Object.assign(new Error('server cannot resume'), { code: 'RESTART' }); }
  const len = num(r.headers['content-length']);
  const range = String(r.headers['content-range'] || '').match(/\/(\d+)$/);
  r.data.totalBytes = r.status === 206 ? num(range?.[1]) || start + len : len;
  return r.data;
};

// ───────────────────────── ffmpeg ─────────────────────────
function mux(video, audio, out, signal) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-y', '-v', 'error', '-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', out], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-600); });
    const kill = () => p.kill('SIGKILL');
    signal?.addEventListener('abort', kill, { once: true });
    p.on('error', reject);
    p.on('close', (code) => {
      signal?.removeEventListener('abort', kill);
      if (signal?.aborted) return reject(new FilmError('CANCELLED'));
      return code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.trim() || `exit ${code}`}`));
    });
  });
}

// real container check (providers sometimes return an HTML error page with a 200)
async function looksLikeVideo(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const b = Buffer.alloc(12); await fh.read(b, 0, 12, 0);
    const a = b.toString('latin1');
    return a.slice(4, 8) === 'ftyp' || (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) || a.startsWith('RIFF') || a.startsWith('OggS') || a.startsWith('\0\0\x01\xba');
  } finally { await fh.close(); }
}

// ───────────────────────── quality planning (YouTube) ─────────────────────────
const fSize = (f, secs) => num(f.contentLength) || Math.round((num(f.bitrate || f.averageBitrate) * secs) / 8);
const isMp4 = (f) => /mp4/.test(`${f.container || ''} ${f.mimeType || ''}`);

// Picks the best plan that fits: height ≤ maxHeight, size ≤ cap, disk ≥ size × factor.
function planYouTube(info, { maxHeight, cap: limit = cap(), free = Infinity }) {
  const secs = num(info.videoDetails?.lengthSeconds);
  const fm = info.formats || [];
  const plans = [];

  const audios = fm.filter((f) => f.hasAudio && !f.hasVideo && isMp4(f) && /mp4a/.test(`${f.audioCodec || ''} ${f.codecs || ''} ${f.mimeType || ''}`));
  const audio = audios.filter((a) => num(a.audioBitrate) <= 192).sort((a, b) => num(b.audioBitrate) - num(a.audioBitrate))[0]
    || audios.sort((a, b) => num(a.audioBitrate) - num(b.audioBitrate))[0];
  if (audio) {
    const vids = fm.filter((f) => f.hasVideo && !f.hasAudio && isMp4(f) && /avc1/.test(`${f.videoCodec || ''} ${f.codecs || ''} ${f.mimeType || ''}`) && num(f.height));
    const byH = new Map();
    for (const v of vids) {
      const cur = byH.get(v.height);
      const better = !cur || (num(v.fps) <= 30 && num(cur.fps) > 30) || (num(v.fps) <= 30 === num(cur.fps) <= 30 && num(v.bitrate) > num(cur.bitrate));
      if (better) byH.set(v.height, v);
    }
    for (const [height, video] of byH) plans.push({ mode: 'adaptive', height, video, audio, size: fSize(video, secs) + fSize(audio, secs), disk: 2.2 });
  }
  for (const f of fm.filter((x) => x.hasVideo && x.hasAudio && isMp4(x) && num(x.height))) plans.push({ mode: 'muxed', height: f.height, format: f, size: fSize(f, secs), disk: 1.15 });

  if (!plans.length) throw new FilmError('NO_FORMAT');
  plans.sort((a, b) => b.height - a.height || (a.mode === 'muxed' ? -1 : 1));
  const within = plans.filter((p) => p.height <= maxHeight);
  const pool = within.length ? within : [...plans].reverse();              // nothing under the wanted height → start from the smallest
  const fitsCap = (p) => !p.size || p.size <= limit;
  const pick = pool.find((p) => fitsCap(p) && (!p.size || p.size * p.disk <= free));
  if (pick) return pick;
  throw new FilmError(plans.some(fitsCap) ? 'NO_SPACE' : 'TOO_BIG');
}

// ───────────────────────── Internet Archive ─────────────────────────
function parseRuntime(r) {
  const s = String(r ?? '').trim();
  if (!s) return 0;
  const clock = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (clock) return clock[3] !== undefined ? +clock[1] * 3600 + +clock[2] * 60 + +clock[3] : +clock[1] * 60 + +clock[2];
  const min = s.match(/(\d+(?:\.\d+)?)\s*(?:min|m\b)/i);
  if (min) return Math.round(parseFloat(min[1]) * 60);
  const hr = s.match(/(\d+(?:\.\d+)?)\s*h/i);
  return hr ? Math.round(parseFloat(hr[1]) * 3600) : 0;
}

async function archiveSearch(q, n = 6) {
  const clean = String(q).replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const { data } = await http.get('https://archive.org/advancedsearch.php', {
    params: { q: `title:(${clean}) AND mediatype:(movies)`, 'fl[]': ['identifier', 'title', 'runtime', 'downloads', 'year', 'item_size'], 'sort[]': 'downloads desc', rows: 30, output: 'json' },
  });
  return (data?.response?.docs || []).map((d) => ({
    id: d.identifier, title: String(Array.isArray(d.title) ? d.title[0] : d.title || d.identifier), seconds: parseRuntime(Array.isArray(d.runtime) ? d.runtime[0] : d.runtime),
    year: d.year, size: num(d.item_size),
  })).filter((d) => (d.seconds ? d.seconds >= 2400 : d.size >= 150 * MB)).slice(0, n);
}

function pickArchiveFile(files, limit = cap()) {
  const vids = (files || []).filter((f) => /\.(mp4|m4v|mkv|avi|ogv|webm|mov)$/i.test(f.name) && !/_thumb|sample|trailer|\.gif$/i.test(f.name));
  if (!vids.length) throw new FilmError('NO_FORMAT');
  const ranked = vids.sort((a, b) => Number(/\.(mp4|m4v)$/i.test(b.name)) - Number(/\.(mp4|m4v)$/i.test(a.name)) || num(b.size) - num(a.size));
  const fit = ranked.find((f) => !num(f.size) || num(f.size) <= limit);
  if (!fit) throw new FilmError('TOO_BIG');
  return fit;
}
const archiveUrl = (id, name) => `https://archive.org/download/${encodeURIComponent(id)}/${String(name).split('/').map(encodeURIComponent).join('/')}`;

async function archiveMeta(id) {
  const { data } = await http.get(`https://archive.org/metadata/${encodeURIComponent(id)}`);
  if (!data?.metadata) throw new FilmError('NOT_FOUND');
  const file = pickArchiveFile(data.files);
  const m = data.metadata;
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  return { id, title: String(first(m.title) || id), author: String(first(m.creator) || 'Internet Archive'), seconds: parseRuntime(first(m.runtime)), file, thumb: `https://archive.org/services/img/${encodeURIComponent(id)}` };
}

// ───────────────────────── source parsing / inspection ─────────────────────────
function parseSource(text) {
  const t = String(text || '').trim();
  const ia = t.match(/\bia:([\w.\-]+)/i) || t.match(/archive\.org\/(?:details|download)\/([\w.\-]+)/i);
  if (ia) return { type: 'ia', id: ia[1] };
  const url = dl.urlsIn(t)[0] || t.split(/\s+/)[0];
  const id = dl.ytId(url);
  return id ? { type: 'yt', id, url: `https://www.youtube.com/watch?v=${id}` } : null;
}

// Light-weight metadata for the confirmation card (+ early validation before queueing)
async function inspect(src) {
  if (src.type === 'ia') {
    const m = await archiveMeta(src.id);
    return { ...src, title: m.title, author: m.author, seconds: m.seconds, thumb: m.thumb, size: num(m.file.size), meta: m };
  }
  const v = await dl.ytFind(src.url);
  if (!v) throw new FilmError('NOT_FOUND');
  if (v.seconds && v.seconds > cfg.filmMaxMinutes * 60) throw new FilmError('TOO_LONG', null, { mins: Math.round(v.seconds / 60), max: cfg.filmMaxMinutes });
  return { ...src, title: v.title, author: v.author?.name || '—', seconds: v.seconds || 0, thumb: v.thumbnail || v.image, views: v.views, ago: v.ago };
}

// Search: YouTube full-length results + Internet Archive feature films (both optional / failure-tolerant)
async function search(q, { ytMax = 8, iaMax = 4 } = {}) {
  const limit = cfg.filmMaxMinutes * 60;
  const [a, b, ia] = await Promise.allSettled([dl.ytList(`${q} full movie`, 25), dl.ytList(`${q} full film`, 25), archiveSearch(q, iaMax)]);
  const seen = new Set();
  const all = [a, b].flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).filter((v) => v?.videoId && !seen.has(v.videoId) && seen.add(v.videoId));
  let yt = all.filter((v) => v.seconds >= 2400 && v.seconds <= limit);
  if (!yt.length) yt = all.filter((v) => v.seconds >= 1500 && v.seconds <= limit);
  return { yt: yt.slice(0, ytMax), ia: ia.status === 'fulfilled' ? ia.value : [] };
}

async function thumbBuffer(url) {
  if (!url || !sharp) return undefined;
  try {
    const r = await http.get(url, { responseType: 'arraybuffer', timeout: 15000, maxContentLength: 5 * MB });
    return await sharp(Buffer.from(r.data)).resize(320, 320, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
  } catch { return undefined; }
}

// ───────────────────────── jobs ─────────────────────────
const jobs = new Map();       // id -> job
const waiting = [];           // queued jobs (FIFO)
let active = 0;

function emit(job, phase, data = {}) {
  job.state = phase;
  try { Promise.resolve(job.notify?.({ phase, job, ...data })).catch(() => {}); } catch { /* notify must never break the pipeline */ }
}
// download progress (throttled to one event / 2 s, smoothed speed + ETA)
function progressor(job, total) {
  job._t = Date.now(); job._b = 0; job.speed = 0;
  return (base) => (bytes) => {
    const done = base + bytes, now = Date.now();
    if (now - job._t < 2000 && done < total) return;
    const inst = (done - job._b) / Math.max(0.001, (now - job._t) / 1000);
    job.speed = job.speed ? job.speed * 0.6 + inst * 0.4 : inst;
    job._t = now; job._b = done;
    job.pct = total ? Math.min(99, Math.floor((done / total) * 100)) : 0;
    emit(job, 'download', { done, total, speed: job.speed, eta: job.speed > 0 && total ? Math.round((total - done) / job.speed) : 0 });
  };
}

async function fetchYouTube(job, dir) {
  if (!dl.ytdl) throw new Error('@distube/ytdl-core is not installed');
  emit(job, 'info');
  const info = await dl.ytdl.getInfo(job.src.url, dl.ytOpts());
  const vd = info.videoDetails || {};
  const secs = num(vd.lengthSeconds);
  if (vd.isLive || (vd.isLiveContent && !secs)) throw new FilmError('NO_FORMAT');
  if (secs > cfg.filmMaxMinutes * 60) throw new FilmError('TOO_LONG', null, { mins: Math.round(secs / 60), max: cfg.filmMaxMinutes });
  const plan = planYouTube(info, { maxHeight: job.height, free: await freeBytes() });
  job.plan = { mode: plan.mode, height: plan.height, size: plan.size };
  const open = (f) => (start) => dl.ytdl.downloadFromInfo(info, dl.ytOpts({ format: f, highWaterMark: 1 << 25, ...(start ? { range: { start } } : {}) }));

  if (plan.mode === 'muxed') {
    const file = path.join(dir, 'film.mp4');
    const tick = progressor(job, plan.size)(0);
    await streamToFile(open(plan.format), file, { total: num(plan.format.contentLength), onBytes: tick, signal: job.controller.signal });
    return { file, ext: 'mp4', mime: 'video/mp4', height: plan.height };
  }
  const vf = path.join(dir, 'video.mp4'), af = path.join(dir, 'audio.m4a'), out = path.join(dir, 'film.mp4');
  const vSize = fSize(plan.video, secs), aSize = fSize(plan.audio, secs);
  const mk = progressor(job, vSize + aSize);
  await streamToFile(open(plan.video), vf, { total: num(plan.video.contentLength), onBytes: mk(0), signal: job.controller.signal });
  await streamToFile(open(plan.audio), af, { total: num(plan.audio.contentLength), onBytes: mk(await sizeOf(vf)), signal: job.controller.signal });
  emit(job, 'merge');
  await mux(vf, af, out, job.controller.signal);
  await Promise.all([fsp.rm(vf, { force: true }), fsp.rm(af, { force: true })]);
  return { file: out, ext: 'mp4', mime: 'video/mp4', height: plan.height };
}

// last resort for YouTube when ytdl is blocked: third-party provider → direct file URL (still streamed + resumable)
async function fetchViaProvider(job, dir) {
  emit(job, 'info');
  const r = await btch.youtube(job.src.url);
  const direct = r.mp4 || r.video;
  const u = (typeof direct === 'string' && direct) || dl.bestUrls(r).find((x) => /mp4|video/i.test(x)) || dl.bestUrls(r)[0];
  if (!u) throw new Error('provider returned no download link');
  const file = path.join(dir, 'film.mp4');
  const tick = progressor(job, 0)(0);
  await streamToFile(httpOpen(u), file, { onBytes: tick, signal: job.controller.signal });
  return { file, ext: 'mp4', mime: 'video/mp4', height: 0 };
}

async function fetchArchive(job, dir) {
  emit(job, 'info');
  const m = job.src.meta || (await archiveMeta(job.src.id));
  const f = m.file;
  const ext = (f.name.match(/\.(\w+)$/) || [, 'mp4'])[1].toLowerCase();
  const free = await freeBytes();
  if (num(f.size) && num(f.size) * 1.1 > free) throw new FilmError('NO_SPACE');
  const file = path.join(dir, `film.${ext}`);
  const tick = progressor(job, num(f.size))(0);
  await streamToFile(httpOpen(archiveUrl(job.src.id, f.name)), file, { total: num(f.size), onBytes: tick, signal: job.controller.signal });
  const mimes = { mp4: 'video/mp4', m4v: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo', ogv: 'video/ogg', webm: 'video/webm', mov: 'video/quicktime' };
  return { file, ext, mime: mimes[ext] || 'application/octet-stream', height: 0 };
}

function toFilmError(e) {
  if (e instanceof FilmError) return e;
  const msg = String(e?.message || e);
  if (e?.code === 'ENOSPC') return new FilmError('NO_SPACE', msg);
  if (/sign in to confirm|not a bot|\b429\b|status code: 403|login required|cookies/i.test(msg)) return new FilmError('BLOCKED', msg);
  if (/unavailable|private video|removed|not available|copyright|members-only|age/i.test(msg)) return new FilmError('UNAVAILABLE', msg);
  return new FilmError('FAILED', msg);
}

async function runJob(job) {
  const dir = path.join(cfg.tmpDir, job.id);
  try {
    await fsp.mkdir(dir, { recursive: true });
    let res;
    try { res = job.src.type === 'ia' ? await fetchArchive(job, dir) : await fetchYouTube(job, dir); }
    catch (e) {
      if (job.src.type !== 'yt' || e instanceof FilmError || isAbort(e) || job.controller.signal.aborted || !btch?.youtube) throw e;
      if (toFilmError(e).code === 'FAILED' || toFilmError(e).code === 'BLOCKED') {
        log.warn({ err: e.message }, 'ytdl failed — trying provider fallback');
        await fsp.rm(dir, { recursive: true, force: true }); await fsp.mkdir(dir, { recursive: true });
        try { res = await fetchViaProvider(job, dir); } catch { throw e; }
      } else throw e;
    }
    if (!(await looksLikeVideo(res.file))) throw new FilmError('FAILED', 'the source returned a web page instead of a video');
    const size = await sizeOf(res.file);
    job.pct = 100;
    emit(job, 'upload', { size });
    let lastErr;
    for (let i = 0; i < 3; i++) {                 // the WhatsApp socket may be reconnecting — retry the delivery
      if (job.controller.signal.aborted) throw new FilmError('CANCELLED');
      try { await job.deliver({ ...res, size }); lastErr = null; break; } catch (e) { lastErr = e; log.warn({ err: e.message, try: i + 1 }, 'film upload failed'); await sleep(6000 * (i + 1)); }
    }
    if (lastErr) throw new FilmError('UPLOAD', lastErr.message);
    emit(job, 'done', { size });
  } catch (e) {
    const fe = toFilmError(e);
    if (fe.code !== 'CANCELLED') log.error({ err: fe.message, code: fe.code, title: job.title }, 'film job failed');
    emit(job, 'error', { error: fe });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function pump() {
  while (active < cfg.filmConcurrency && waiting.length) {
    const job = waiting.shift();
    active++;
    runJob(job).finally(() => { active--; jobs.delete(job.id); pump(); });
  }
  waiting.forEach((j, i) => { if (j.pos !== i + 1) { j.pos = i + 1; emit(j, 'queued', { pos: j.pos }); } });
}

// opts: { src, title, user, owner, height, notify(evt), deliver({file,size,ext,mime,height}) } → job
function enqueue(opts) {
  if (!opts.owner && [...jobs.values()].some((j) => j.user === opts.user)) throw new FilmError('BUSY');
  if ([...jobs.values()].some((j) => j.user === opts.user && j.src.type === opts.src.type && j.src.id === opts.src.id)) throw new FilmError('DUPLICATE');
  if (waiting.length >= cfg.filmQueueMax) throw new FilmError('QUEUE_FULL', null, { n: cfg.filmQueueMax });
  const height = Math.min(1080, Math.max(144, opts.height || cfg.filmQuality));
  const job = { id: crypto.randomBytes(3).toString('hex'), controller: new AbortController(), state: 'queued', pct: 0, pos: 0, createdAt: Date.now(), ...opts, height };
  jobs.set(job.id, job);
  waiting.push(job);
  pump();
  job.pos = waiting.indexOf(job) + 1;           // 0 = started immediately
  return job;
}

function cancel(id, { user, owner } = {}) {
  const job = id ? jobs.get(id) : [...jobs.values()].find((j) => j.user === user);
  if (!job || (!owner && job.user !== user)) return null;
  if (job.state === 'upload') throw new FilmError('UPLOADING');       // WhatsApp upload cannot be interrupted
  job.controller.abort();
  const i = waiting.indexOf(job);
  if (i >= 0) { waiting.splice(i, 1); jobs.delete(job.id); emit(job, 'error', { error: new FilmError('CANCELLED') }); pump(); }
  return job;
}

const list = () => [...jobs.values()].map((j) => ({ id: j.id, title: j.title, user: j.user, state: j.state, pct: j.pct, pos: waiting.indexOf(j) + 1, running: !waiting.includes(j) }));

// startup: wipe orphaned temp files from a previous (crashed / restarted) dyno
async function sweep() { await fsp.rm(cfg.tmpDir, { recursive: true, force: true }).catch(() => {}); await ensureTmp(); }
async function shutdown() { for (const j of jobs.values()) j.controller.abort(); await sleep(400); await fsp.rm(cfg.tmpDir, { recursive: true, force: true }).catch(() => {}); }

module.exports = {
  FilmError, parseSource, inspect, search, thumbBuffer, enqueue, cancel, list, sweep, shutdown,
  _t: { streamToFile, httpOpen, planYouTube, pickArchiveFile, parseRuntime, mux, looksLikeVideo, archiveUrl, toFilmError, freeBytes },
};
