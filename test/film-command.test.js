// End-to-end check of the .filmdl / .film / .filmstatus / .filmcancel commands with a fake WhatsApp socket (offline).
process.env.TMP_DIR = require('path').join(require('os').tmpdir(), `alone-film-cmd-${process.pid}`);
process.env.MAX_FILM_MB = '200';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const utils = require('../src/core/utils');
const I = require('../src/core/i18n');
const loader = require('../src/core/commandLoader');
const manager = require('../src/session/manager');
const film = require('../src/core/film');
loader.loadCommands();

const data = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), crypto.randomBytes(3_000_000)]);
const sent = [];
const sock = { sendMessage: async (jid, content, opts = {}) => { sent.push({ jid, content, opts }); return { key: { id: `K${sent.length}`, remoteJid: jid } }; } };
manager.registry.set('main', { sid: 'main', ready: true, sock });

const ctx = (input, extra = {}) => {
  const lang = extra.lang || 'en', reacts = [], replies = [];
  return {
    sid: 'main', sock, chat: '9477@s.whatsapp.net', raw: { key: { id: 'RAW' } }, prefix: '.', lang, senderNumber: '9477', isOwner: false, args: input.split(/\s+/).filter(Boolean), input,
    t: (k, v) => I.t(lang, k, { p: '.', bot: 'ALONE', ...v }),
    react: async (e) => reacts.push(e), reply: async (t) => { replies.push(t); return { key: { id: 'R' } }; },
    send: async (content, o) => sock.sendMessage('9477@s.whatsapp.net', content, o), reacts, replies, ...extra,
  };
};
const waitFor = async (fn, ms = 15000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 50)); } };

test('commands are registered without name clashes', () => {
  for (const n of ['film', 'movies', 'filmdl', 'getfilm', 'filmstatus', 'filmcancel']) assert.ok(loader.get(n), n);
  assert.equal(loader.get('film').name, 'film'); assert.equal(loader.get('filmdl').name, 'filmdl');
  const names = loader.list.flatMap((c) => [c.name, ...c.aliases]);
  assert.equal(names.length, new Set(names).size, 'no duplicate command names/aliases');
});

test('.filmdl ia:<id> → info card, live status, ONE document with thumbnail-less fallback, success reaction', async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': data.length }); res.end(data); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const realGet = utils.http.get;
  utils.http.get = (u, o) => (String(u).includes('archive.org/metadata')
    ? Promise.resolve({ data: { metadata: { title: 'Night of the Living Dead (1968) Full Movie', creator: 'George Romero', runtime: '01:36:00' }, files: [{ name: 'night.mp4', size: String(data.length) }, { name: 'night.ogv', size: '1' }] } })
    : String(u).includes('archive.org/download') ? realGet(`http://127.0.0.1:${srv.address().port}/`, o)
    : Promise.reject(new Error('offline')));          // thumbnails etc. → engine must cope
  try {
    const c = ctx('ia:night_of_the_living_dead 480');
    await loader.get('filmdl').run(c);
    await waitFor(() => c.reacts.includes('✅')).catch((e) => { console.log('DEBUG', JSON.stringify({ reacts: c.reacts, replies: c.replies, sent: sent.map((s) => s.content.text || s.content.caption || Object.keys(s.content)), jobs: film.list() })); throw e; });
    const docs = sent.filter((s) => s.content.document);
    assert.equal(docs.length, 1, 'exactly ONE document is delivered');
    const d = docs[0];
    assert.match(d.content.fileName, /^Night of the Living Dead \(1968\)\.mp4$/);
    assert.equal(d.content.mimetype, 'video/mp4');
    assert.ok(fs.existsSync(d.content.document.url) === false, 'temp file removed after delivery');
    assert.equal(d.opts.mediaUploadTimeoutMs, 3600000);
    assert.match(d.content.caption, /Night of the Living Dead/);
    const texts = sent.filter((s) => s.content.text).map((s) => s.content.text);
    assert.ok(texts[0].includes('Preparing'), 'status message created first');
    assert.ok(sent.some((s) => s.content.edit && /Uploading to WhatsApp/.test(s.content.text)), 'status edited in place (upload phase)');
    assert.ok(sent.some((s) => s.content.edit && /Delivered/.test(s.content.text)), 'final status says delivered');
    assert.match(sent[0].content.caption || c.replies[0] || '', /FILM/);
    assert.deepEqual(film.list(), []);
  } finally { utils.http.get = realGet; srv.close(); }
});

test('.filmdl rejects bad input, shows friendly errors, supports cancel/status', async () => {
  let c = ctx('hello there');
  await loader.get('filmdl').run(c);
  assert.match(c.replies[0], /YouTube link/);
  c = ctx('', { lang: 'si' });
  await loader.get('filmstatus').run(c);
  assert.match(c.replies[0], /චිත්‍රපට/);
  c = ctx('');
  await loader.get('filmcancel').run(c);
  assert.match(c.replies[0], /no active film/);
});

test('.film <title> merges YouTube + Archive results, filters short clips, renders the list (text fallback)', async () => {
  const dl = require('../src/core/dl');
  const realList = dl.ytList, realGet = utils.http.get;
  const v = (id, title, seconds) => ({ videoId: id, url: `https://www.youtube.com/watch?v=${id}`, title, seconds, timestamp: '', author: { name: 'Chan' } });
  dl.ytList = async (q) => [v('aaaaaaaaaaa', 'Nosferatu (1922) FULL MOVIE HD', 5400), v('bbbbbbbbbbb', 'Nosferatu clip', 120), v('ccccccccccc', 'Nosferatu 4K | Full Film', 5600)];
  utils.http.get = async () => ({ data: { response: { docs: [{ identifier: 'Nosferatu1922', title: 'Nosferatu', runtime: '01:34:00', year: 1922, item_size: 900e6 }, { identifier: 'tiny', title: 'Nosferatu trailer', runtime: '0:02:00' }] } } });
  try {
    const c = ctx('nosferatu'); sent.length = 0;
    await loader.get('film').run(c);
    const out = sent.map((s) => s.content.text || '').join('\n');
    assert.match(out, /FULL FILMS/); assert.match(out, /Nosferatu \(1922\)/);
    assert.doesNotMatch(out, /clip/); assert.doesNotMatch(out, /trailer/);
    assert.match(out, /\.filmdl https:\/\/www\.youtube\.com\/watch\?v=aaaaaaaaaaa/);
    assert.match(out, /\.filmdl https:\/\/www\.youtube\.com\/watch\?v=aaaaaaaaaaa 480/);
    assert.match(out, /\.filmdl ia:Nosferatu1922/);
    assert.equal((out.match(/ccccccccccc/g) || []).length >= 1, true);
  } finally { dl.ytList = realList; utils.http.get = realGet; }
});

test.after(async () => { await film.shutdown(); process.exit(0); });
