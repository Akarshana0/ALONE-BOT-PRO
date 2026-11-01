// Offline self-test for the film engine:  npm test
// (no network, no WhatsApp, no MongoDB — uses a local HTTP server + ffmpeg test streams)
process.env.TMP_DIR = require('path').join(require('os').tmpdir(), `alone-film-test-${process.pid}`);
process.env.FILM_CONCURRENCY = '1';
process.env.FILM_QUEUE_MAX = '2';
process.env.MAX_FILM_MB = '200';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Readable } = require('stream');
const cfg = require('../src/config');
const utils = require('../src/core/utils');
const film = require('../src/core/film');
const { FilmError, _t } = film;
const ffmpeg = require('ffmpeg-static') || 'ffmpeg';

const rnd = (n) => require('crypto').randomBytes(n);
const flush = () => new Promise((r) => setTimeout(r, 50));

// ───────── pure helpers ─────────
test('parseRuntime understands archive.org runtime strings', () => {
  assert.equal(_t.parseRuntime('01:32:10'), 5530);
  assert.equal(_t.parseRuntime('92:10'), 5530);
  assert.equal(_t.parseRuntime('95 min'), 5700);
  assert.equal(_t.parseRuntime('1.5 hours'), 5400);
  assert.equal(_t.parseRuntime(''), 0);
  assert.equal(_t.parseRuntime(undefined), 0);
});

test('parseSource detects YouTube links/ids and Internet Archive ids', () => {
  assert.deepEqual(film.parseSource('https://youtu.be/dQw4w9WgXcQ?t=5'), { type: 'yt', id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  assert.equal(film.parseSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x').id, 'dQw4w9WgXcQ');
  assert.deepEqual(film.parseSource('ia:Nosferatu_1922'), { type: 'ia', id: 'Nosferatu_1922' });
  assert.equal(film.parseSource('https://archive.org/details/night_of_the_living_dead').id, 'night_of_the_living_dead');
  assert.equal(film.parseSource('hello world'), null);
});

test('pickArchiveFile prefers mp4, skips trailers/thumbs, respects the size cap', () => {
  const files = [
    { name: 'movie.ogv', size: '900000000' }, { name: 'movie_thumb.gif', size: '10' }, { name: 'trailer.mp4', size: '5000000' },
    { name: 'movie.mp4', size: '700000000' }, { name: 'movie_hd.mp4', size: '3000000000' },
  ];
  assert.equal(_t.pickArchiveFile(files, 2e9).name, 'movie.mp4');
  assert.throws(() => _t.pickArchiveFile(files, 1000), (e) => e.code === 'TOO_BIG');
  assert.throws(() => _t.pickArchiveFile([{ name: 'a.txt' }]), (e) => e.code === 'NO_FORMAT');
  assert.equal(_t.archiveUrl('id x', 'dir/a b.mp4'), 'https://archive.org/download/id%20x/dir/a%20b.mp4');
});

const F = (o) => ({ container: 'mp4', fps: 24, ...o });
const info = (secs, formats) => ({ videoDetails: { lengthSeconds: String(secs) }, formats });
const hour2 = 7200;
const FORMATS = [
  F({ itag: 18, hasVideo: true, hasAudio: true, height: 360, codecs: 'avc1.42001E, mp4a.40.2', contentLength: '400000000' }),
  F({ itag: 134, hasVideo: true, hasAudio: false, height: 360, videoCodec: 'avc1.4d401e', contentLength: '250000000', bitrate: 300000 }),
  F({ itag: 135, hasVideo: true, hasAudio: false, height: 480, videoCodec: 'avc1.4d401f', contentLength: '420000000', bitrate: 500000 }),
  F({ itag: 136, hasVideo: true, hasAudio: false, height: 720, videoCodec: 'avc1.4d401f', contentLength: '900000000', bitrate: 1000000 }),
  F({ itag: 137, hasVideo: true, hasAudio: false, height: 1080, videoCodec: 'avc1.640028', contentLength: '1700000000', bitrate: 2000000 }),
  F({ itag: 247, hasVideo: true, hasAudio: false, height: 720, container: 'webm', videoCodec: 'vp9', contentLength: '100' }),
  F({ itag: 140, hasVideo: false, hasAudio: true, audioCodec: 'mp4a.40.2', audioBitrate: 128, contentLength: '115000000' }),
  F({ itag: 251, hasVideo: false, hasAudio: true, container: 'webm', audioCodec: 'opus', audioBitrate: 160, contentLength: '99' }),
];

test('planYouTube: picks the highest quality that fits height, size cap and disk', () => {
  const big = 4e9;
  const p1080 = _t.planYouTube(info(hour2, FORMATS), { maxHeight: 1080, cap: big, free: Infinity });
  assert.equal(p1080.height, 1080); assert.equal(p1080.mode, 'adaptive');
  const p720 = _t.planYouTube(info(hour2, FORMATS), { maxHeight: 720, cap: big, free: Infinity });
  assert.equal(p720.height, 720); assert.equal(p720.video.itag, 136); assert.equal(p720.audio.itag, 140);   // webm/opus ignored
  const capped = _t.planYouTube(info(hour2, FORMATS), { maxHeight: 1080, cap: 1.2e9, free: Infinity });      // 720p = 1.015 GB fits, 1080p does not
  assert.equal(capped.height, 720);
  const lowDisk = _t.planYouTube(info(hour2, FORMATS), { maxHeight: 720, cap: big, free: 1.6e9 });           // 480p adaptive needs 535MB*2.2
  assert.equal(lowDisk.height, 480);
  const tiny = _t.planYouTube(info(hour2, FORMATS), { maxHeight: 720, cap: big, free: 600e6 });              // only muxed 360p fits (400MB*1.15)
  assert.equal(tiny.mode, 'muxed'); assert.equal(tiny.height, 360);
  assert.throws(() => _t.planYouTube(info(hour2, FORMATS), { maxHeight: 720, cap: 100e6, free: Infinity }), (e) => e.code === 'TOO_BIG');
  assert.throws(() => _t.planYouTube(info(hour2, FORMATS), { maxHeight: 720, cap: big, free: 1e6 }), (e) => e.code === 'NO_SPACE');
  assert.throws(() => _t.planYouTube(info(hour2, []), { maxHeight: 720 }), (e) => e.code === 'NO_FORMAT');
  assert.equal(_t.planYouTube(info(hour2, FORMATS), { maxHeight: 240, cap: big }).height, 360);               // nothing that low → smallest available
});

test('toFilmError maps provider failures to friendly codes', () => {
  assert.equal(_t.toFilmError(new Error('Sign in to confirm you’re not a bot')).code, 'BLOCKED');
  assert.equal(_t.toFilmError(new Error('Video unavailable')).code, 'UNAVAILABLE');
  assert.equal(_t.toFilmError(Object.assign(new Error('x'), { code: 'ENOSPC' })).code, 'NO_SPACE');
  assert.equal(_t.toFilmError(new Error('boom')).code, 'FAILED');
});

// ───────── streaming / resume ─────────
const tmp = (n) => { fs.mkdirSync(cfg.tmpDir, { recursive: true }); return path.join(cfg.tmpDir, n); };

test('streamToFile resumes from the last byte after a mid-stream failure', async () => {
  const data = rnd(3_000_000);
  const opens = [];
  const open = (start) => {
    opens.push(start);
    const slice = data.subarray(start);
    let sent = 0;
    return new Readable({
      read() {
        if (opens.length < 3 && sent >= 800_000) return this.destroy(new Error('ECONNRESET'));       // first two attempts die after ~800 KB
        if (sent >= slice.length) return this.push(null);
        const n = Math.min(64_000, slice.length - sent); this.push(slice.subarray(sent, sent + n)); sent += n;
      },
    });
  };
  const f = tmp('resume.bin'); let last = 0;
  const size = await _t.streamToFile(open, f, { total: data.length, onBytes: (b) => { last = b; }, retries: 4 });
  assert.equal(size, data.length);
  assert.ok(fs.readFileSync(f).equals(data), 'file is byte-identical');
  assert.equal(last, data.length);
  assert.equal(opens.length, 3); assert.equal(opens[0], 0); assert.ok(opens[1] > 0 && opens[2] > opens[1]);
});

test('streamToFile: stall watchdog, size cap and cancellation', async () => {
  const stalled = () => new Readable({ read() {} });
  await assert.rejects(_t.streamToFile(stalled, tmp('stall.bin'), { stallMs: 200, retries: 0 }), /stalled/);
  const endless = () => new Readable({ read() { this.push(Buffer.alloc(65536)); } });
  await assert.rejects(_t.streamToFile(endless, tmp('big.bin'), { limit: 1_000_000 }), (e) => e.code === 'TOO_BIG');
  const ac = new AbortController();
  const p = _t.streamToFile(() => new Readable({ read() { setTimeout(() => this.push(Buffer.alloc(1000)), 10); } }), tmp('cancel.bin'), { signal: ac.signal });
  setTimeout(() => ac.abort(), 100);
  await assert.rejects(p, (e) => e.code === 'CANCELLED');
});

function server(data, { range = true, dropAt = 0, html = false } = {}) {
  let dropped = false;
  const s = http.createServer((req, res) => {
    if (html) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>blocked</html>'); }
    const m = /bytes=(\d+)-/.exec(req.headers.range || '');
    const start = range && m ? +m[1] : 0;
    const body = data.subarray(start);
    const h = { 'content-type': 'video/mp4', 'content-length': body.length };
    if (range && m) { res.writeHead(206, { ...h, 'content-range': `bytes ${start}-${data.length - 1}/${data.length}` }); } else res.writeHead(200, h);
    if (dropAt && !dropped) { dropped = true; res.write(body.subarray(0, dropAt)); return setTimeout(() => req.socket.destroy(), 30); }
    res.end(body);
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ s, url: `http://127.0.0.1:${s.address().port}/film.mp4` })));
}

test('httpOpen: resumes with Range after a dropped connection', async () => {
  const data = rnd(2_500_000);
  const { s, url } = await server(data, { dropAt: 700_000 });
  try {
    const f = tmp('http-resume.bin');
    await _t.streamToFile(_t.httpOpen(url), f, { retries: 3 });
    assert.ok(fs.readFileSync(f).equals(data));
  } finally { s.close(); }
});

test('httpOpen: restarts cleanly when the server has no Range support', async () => {
  const data = rnd(1_500_000);
  const { s, url } = await server(data, { range: false, dropAt: 400_000 });
  try {
    const f = tmp('http-norange.bin');
    await _t.streamToFile(_t.httpOpen(url), f, { retries: 3 });
    assert.ok(fs.readFileSync(f).equals(data));
  } finally { s.close(); }
});

// ───────── ffmpeg merge + container check ─────────
test('mux merges separate video + audio (stream copy) into one playable mp4', async () => {
  const dir = path.join(cfg.tmpDir, 'mux'); fs.mkdirSync(dir, { recursive: true });
  const [v, a, out] = ['v.mp4', 'a.m4a', 'out.mp4'].map((n) => path.join(dir, n));
  let r = spawnSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', v]);
  if (r.status !== 0) return;                                   // ffmpeg build without libx264 → skip
  r = spawnSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:a', 'aac', a]);
  assert.equal(r.status, 0);
  await _t.mux(v, a, out);
  assert.ok(await _t.looksLikeVideo(out));
  const probe = spawnSync(ffmpeg, ['-i', out], { encoding: 'utf8' }).stderr;
  assert.match(probe, /Video: h264/); assert.match(probe, /Audio: aac/);
  fs.writeFileSync(path.join(dir, 'page.html'), '<html></html>');
  assert.equal(await _t.looksLikeVideo(path.join(dir, 'page.html')), false);
});

// ───────── whole job pipeline (Internet Archive path, stubbed metadata) ─────────
test('job pipeline: queue, progress, delivery, cleanup, limits, cancel', async () => {
  const data = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), rnd(2_000_000)]);
  const { s, url } = await server(data);
  const realGet = utils.http.get;
  utils.http.get = (u, o) => (String(u).includes('archive.org/metadata')
    ? Promise.resolve({ data: { metadata: { title: 'Test Film', creator: 'Nobody', runtime: '01:30:00' }, files: [{ name: 'test.mp4', size: String(data.length) }] } })
    : realGet(String(u).includes('archive.org/download') ? url : u, o));
  try {
    const events = [], delivered = [];
    const mk = (id, user, extra = {}) => film.enqueue({
      src: { type: 'ia', id }, title: id, user, notify: (e) => { events.push(`${id}:${e.phase}`); },
      deliver: async ({ file, size }) => { assert.ok(fs.existsSync(file)); delivered.push({ id, size, same: fs.readFileSync(file).equals(data) }); }, ...extra,
    });
    const j1 = mk('one', 'u1');
    const j2 = mk('two', 'u2');
    assert.equal(j1.pos, 0); assert.equal(j2.pos, 1);                           // second film waits (concurrency 1)
    assert.throws(() => mk('dup', 'u1'), (e) => e.code === 'BUSY');             // one film per user at a time
    const j3 = mk('three', 'u3');
    assert.throws(() => mk('four', 'u4'), (e) => e.code === 'QUEUE_FULL');      // FILM_QUEUE_MAX = 2
    assert.equal(film.cancel(j3.id, { user: 'someone-else' }), null);           // not your job
    assert.ok(film.cancel(j3.id, { user: 'u3' }));                              // cancel while queued
    for (let i = 0; i < 100 && film.list().length; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(film.list().length, 0);
    assert.deepEqual(delivered.map((d) => d.id), ['one', 'two']);
    assert.ok(delivered.every((d) => d.same && d.size === data.length));
    assert.ok(events.includes('one:done') && events.includes('two:queued') && events.includes('two:done') && events.includes('three:error'));
    await flush();
    assert.deepEqual(fs.readdirSync(cfg.tmpDir).filter((n) => /^[0-9a-f]{6}$/.test(n)), [], 'job temp dirs are removed');

    // delivery that always fails → UPLOAD error, temp cleaned
    const errs = [];
    const bad = film.enqueue({ src: { type: 'ia', id: 'bad' }, title: 'bad', user: 'u9', notify: (e) => e.phase === 'error' && errs.push(e.error.code), deliver: async () => { throw new Error('socket closed'); } });
    for (let i = 0; i < 400 && film.list().length; i++) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(errs, ['UPLOAD']); assert.ok(bad);
  } finally { utils.http.get = realGet; s.close(); }
});

test('job pipeline: an HTML error page is rejected, not delivered', async () => {
  const { s, url } = await server(Buffer.alloc(10), { html: true });
  const realGet = utils.http.get;
  utils.http.get = (u, o) => (String(u).includes('archive.org/metadata')
    ? Promise.resolve({ data: { metadata: { title: 'x' }, files: [{ name: 'x.mp4' }] } })
    : realGet(url, o));
  try {
    const errs = []; let delivered = false;
    film.enqueue({ src: { type: 'ia', id: 'html' }, title: 'html', user: 'u7', notify: (e) => e.phase === 'error' && errs.push(e.error.code), deliver: async () => { delivered = true; } });
    for (let i = 0; i < 100 && film.list().length; i++) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(errs, ['FAILED']); assert.equal(delivered, false);
  } finally { utils.http.get = realGet; s.close(); }
});

test.after(async () => { await film.shutdown(); });
