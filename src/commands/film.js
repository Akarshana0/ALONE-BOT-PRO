// 🎞️ Full-film commands:  .film <title>  ·  .filmdl <link|ia:id> [quality]  ·  .filmstatus  ·  .filmcancel
// Heavy lifting lives in core/film.js (disk streaming, resume, ffmpeg merge, queue). This file is only UI + messages.
const cfg = require('../config');
const ui = require('../core/ui');
const film = require('../core/film');
const log = require('../logger');
const { bytes, sleep } = require('../core/utils');
const { frame, line, btn, cmd } = ui;

const D = { category: 'download' };
const hm = (s) => (s ? `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m` : '—');
const eta = (s) => (s > 3600 ? hm(s) : s > 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${Math.max(0, s)}s`);
const bar = (p) => '▰'.repeat(Math.round(p / 10)) + '▱'.repeat(10 - Math.round(p / 10));
const safeName = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 110) || 'film';
const clean = (t) => String(t).replace(/\b(full\s+(movie|film)|hd|4k|1080p|720p|english|subtitles?)\b/gi, '').replace(/[|•\-–—]+\s*$/g, '').replace(/\s{2,}/g, ' ').trim();

// the Baileys socket can be replaced while a long job runs (reconnect) → always use the live one
async function liveSock(c, wait = 60) {
  const mgr = require('../session/manager');
  for (let i = 0; i < wait; i++) {
    const s = mgr.get(c.sid);
    if (s?.ready && s.sock) return s.sock;
    await sleep(1000);
  }
  return mgr.get(c.sid)?.sock || c.sock;
}

const ERR = { BUSY: 'film_busy', DUPLICATE: 'film_dup', QUEUE_FULL: 'film_q_full', TOO_LONG: 'film_too_long', TOO_BIG: 'film_too_big', NO_SPACE: 'film_no_space',
  NO_FORMAT: 'film_no_format', NOT_FOUND: 'not_found', BLOCKED: 'film_blocked', UNAVAILABLE: 'film_unavailable', UPLOAD: 'film_upload_failed', CANCELLED: 'film_cancelled', UPLOADING: 'film_uploading' };
const errText = (c, e) => {
  const fe = film._t.toFilmError(e);
  return c.t(ERR[fe.code] || 'film_failed', { mins: fe.mins, max: fe.max ?? cfg.filmMaxMinutes, mb: cfg.maxFilmMB, n: fe.n, err: String(fe.message).slice(0, 160), p: c.prefix });
};

// ───────── .film <title> ─────────
const search = { ...D, name: 'film', aliases: ['movies', 'fullmovie', 'filmsearch'], desc: 'Search full-length films and download them as ONE file', usage: '<title>', need: true, run: async (c) => {
  await c.react('🔎');
  const { yt, ia } = await film.search(c.input);
  if (!yt.length && !ia.length) { c.react('❌'); return c.reply(c.t('film_none')); }
  const lines = [];
  yt.forEach((v, i) => lines.push(`┃ ${i + 1}. ${clean(v.title).slice(0, 48)} • ${hm(v.seconds)}`));
  ia.forEach((v, i) => lines.push(`┃ ${yt.length + i + 1}. 🏛️ ${v.title.slice(0, 44)}${v.seconds ? ` • ${hm(v.seconds)}` : ''}`));
  const sections = [];
  if (yt.length) sections.push({ title: c.t('film_sec_yt'), rows: yt.map((v) => ({ title: clean(v.title).slice(0, 60), desc: `${hm(v.seconds)} • ${v.author?.name || ''}`.slice(0, 70), id: cmd(`filmdl ${v.url}`) })) });
  if (yt.length) sections.push({ title: c.t('film_sec_lite'), rows: yt.slice(0, 5).map((v) => ({ title: clean(v.title).slice(0, 60), desc: `480p • ${hm(v.seconds)}`, id: cmd(`filmdl ${v.url} 480`) })) });
  if (ia.length) sections.push({ title: c.t('film_sec_ia'), rows: ia.map((v) => ({ title: v.title.slice(0, 60), desc: `${hm(v.seconds)}${v.year ? ` • ${v.year}` : ''}`, id: cmd(`filmdl ia:${v.id}`) })) });
  c.react('✅');
  return ui.send(c, { title: c.t('film_title'), body: `${frame(c.t('film_title'), lines.join('\n'))}\n\n${c.t('film_hint')}`, buttons: [btn.list(c.t('film_pick'), sections)] });
} };

// ───────── .filmdl <link|ia:id> [240|360|480|720|1080] ─────────
const download = { ...D, name: 'filmdl', aliases: ['getfilm', 'fdl', 'longvideo'], desc: 'Download a full film / long video (YouTube link or ia:id) as ONE file', usage: '<YouTube link | ia:id> [480|720|1080]', need: true, run: async (c) => {
  const src = film.parseSource(c.input);
  if (!src) return c.reply(c.t('film_bad_link', { p: c.prefix }));
  const height = Number((c.input.match(/(?:^|\s)(240|360|480|720|1080)p?(?=\s|$)/) || [])[1]) || undefined;

  await c.react('⏳');
  let meta;
  try { meta = await film.inspect(src); }
  catch (e) { c.react('❌'); log.warn({ err: e.message }, 'film inspect'); return c.reply(errText(c, e)); }

  // — info card —
  const want = Math.min(height || cfg.filmQuality, 1080);
  const card = frame(c.t('film_card_title'), [
    line('🎬', c.t('lbl_title'), clean(meta.title).slice(0, 70)),
    line('📺', c.t('lbl_channel'), meta.author || '—'),
    line('⏱️', c.t('lbl_duration'), hm(meta.seconds)),
    src.type === 'yt' ? line('🎚️', c.t('lbl_quality'), `≤ ${want}p (auto)`) : line('💾', c.t('lbl_size'), meta.size ? bytes(meta.size) : '—'),
    line('🌐', c.t('lbl_source'), src.type === 'ia' ? 'Internet Archive' : 'YouTube'),
  ].join('\n'));
  const thumbP = film.thumbBuffer(meta.thumb);
  try { await (meta.thumb ? c.send({ image: { url: meta.thumb }, caption: card }) : c.reply(card)); } catch { await c.reply(card).catch(() => {}); }

  // — live status message (edited in place; every edit is serialized and throttled) —
  let key, lastEdit = 0, lastText = '', chain = Promise.resolve();
  const put = (text, force) => { chain = chain.then(async () => {
    if (text === lastText || (!force && Date.now() - lastEdit < 7000)) return;
    lastEdit = Date.now(); lastText = text;
    const sock = await liveSock(c, 1);
    if (!key) key = (await sock.sendMessage(c.chat, { text }, { quoted: c.raw })).key;
    else await sock.sendMessage(c.chat, { text, edit: key });
  }).catch((e) => log.debug({ err: e.message }, 'film status edit')); };
  put(c.t('film_st_info'), true);

  const onEvent = (e) => {
    switch (e.phase) {
      case 'queued': return put(c.t('film_q_pos', { n: e.pos }), true);
      case 'info': return put(c.t('film_st_info'), true);
      case 'download': return put(e.total
        ? c.t('film_st_download', { bar: bar(e.job.pct), pct: e.job.pct, done: bytes(e.done), total: bytes(e.total), speed: bytes(e.speed), eta: eta(e.eta) })
        : c.t('film_st_download_nt', { done: bytes(e.done), speed: bytes(e.speed) }));
      case 'merge': return put(c.t('film_st_merge'), true);
      case 'upload': return put(c.t('film_st_upload', { size: bytes(e.size) }), true);
      case 'done': c.react('✅'); return put(c.t('film_st_done'), true);
      case 'error': c.react(e.error.code === 'CANCELLED' ? '🛑' : '❌'); return put(errText(c, e.error), true);
      default: return undefined;
    }
  };

  const deliver = async (r) => {
    const sock = await liveSock(c);
    const thumb = await thumbP;
    const fileName = `${safeName(clean(meta.title))}${r.height ? ` [${r.height}p]` : ''}.${r.ext}`;
    const caption = [`🎞️ *${clean(meta.title).slice(0, 90)}*`, `📦 ${bytes(r.size)}${r.height ? ` • 🎚️ ${r.height}p` : ''}${meta.seconds ? ` • ⏱️ ${hm(meta.seconds)}` : ''}`, `⚡ ${cfg.botName}`].join('\n');
    await sock.sendMessage(c.chat, { document: { url: r.file }, mimetype: r.mime, fileName, caption, ...(thumb ? { jpegThumbnail: thumb } : {}) }, { quoted: c.raw, mediaUploadTimeoutMs: 60 * 60 * 1000 });
  };

  try {
    film.enqueue({ src: { ...src, meta: meta.meta }, title: meta.title, user: c.senderNumber, owner: c.isOwner, height, notify: onEvent, deliver });
  } catch (e) { c.react('❌'); put(errText(c, e), true); }
} };

// ───────── .filmstatus / .filmcancel ─────────
const status = { ...D, name: 'filmstatus', aliases: ['filmqueue', 'fstatus'], desc: 'Show the film download queue', run: async (c) => {
  const l = film.list();
  if (!l.length) return c.reply(c.t('film_status_empty'));
  return c.reply(frame(c.t('film_status_title'), l.map((j) => `┃ ${j.running ? '⚙️' : `🕒 #${j.pos}`} *${j.id}* • ${clean(j.title).slice(0, 36)}${j.running ? ` • ${j.state}${j.pct ? ` ${j.pct}%` : ''}` : ''}`).join('\n')));
} };

const cancel = { ...D, name: 'filmcancel', aliases: ['cancelfilm', 'fcancel'], desc: 'Cancel your film download (optionally by job id)', usage: '[job id]', run: async (c) => {
  try {
    const j = film.cancel(c.args[0], { user: c.senderNumber, owner: c.isOwner });
    return c.reply(j ? c.t('film_cancel_ok', { title: clean(j.title).slice(0, 60) }) : c.t('film_cancel_none'));
  } catch (e) { return c.reply(errText(c, e)); }
} };

module.exports = [search, download, status, cancel];
