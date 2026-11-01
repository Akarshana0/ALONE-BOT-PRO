const cfg = require('../config');
const ui = require('../core/ui');
const dl = require('../core/dl');
const { getJson } = require('../core/utils');
const { frame, line, btn, cmd } = ui;

const D = { category: 'download', need: true };
const card = (v) => frame('🎧 ' + v.title.slice(0, 40), [line('👤', 'Channel', v.author?.name || '—'), line('⏱️', 'Duration', v.timestamp || '—'), line('👁️', 'Views', (v.views || 0).toLocaleString()), line('🗓️', 'Uploaded', v.ago || '—'), line('🔗', 'Link', v.url)].join('\n'));
const tooBig = (c, e) => (e.message === 'TOO_BIG' || /maxContentLength|maxBodyLength/.test(e.message) ? c.reply(c.t('too_big', { mb: cfg.maxMediaMB })) : Promise.reject(e));

const yt = (name, aliases, desc, kind, asDoc) => ({ ...D, name, aliases, desc, usage: '<song name | YouTube link>', run: async (c) => {
  await c.react('⏳');
  const v = await dl.ytFind(c.input); if (!v) return c.reply(c.t('not_found'));
  await c.send({ image: { url: v.thumbnail || v.image }, caption: card(v) });
  try {
    const buf = await dl.ytMedia(v.url, kind);
    const safe = v.title.replace(/[\\/:*?"<>|]/g, '');
    if (asDoc) await c.send({ document: buf, mimetype: kind === 'audio' ? 'audio/mpeg' : 'video/mp4', fileName: `${safe}.${kind === 'audio' ? 'mp3' : 'mp4'}` });
    else if (kind === 'audio') await c.send({ audio: buf, mimetype: 'audio/mpeg', fileName: `${safe}.mp3` });
    else await c.send({ video: buf, caption: `🎬 ${v.title}` });
    return c.react('✅');
  } catch (e) { return tooBig(c, e); }
} });

const linkOf = (c) => dl.urlsIn(c.input)[0] || c.input.trim();     // works with "<cmd> <link>" and with a reply to a message containing a link

const soc = (name, aliases, key, desc) => ({ ...D, name, aliases, desc, usage: '<link>', run: async (c) => {
  await c.react('⏳');
  try { await dl.sendFromUrls(c, await dl.social(linkOf(c), key), `⚡ ${cfg.botName}`); return c.react('✅'); }
  catch (e) { c.react('❌'); return tooBig(c, e); }
} });

module.exports = [
  yt('play', ['song', 'ytmp3', 'audio'], 'Download a song (YouTube) as audio', 'audio'),
  yt('playdoc', ['songdoc'], 'Download a song as an MP3 document', 'audio', true),
  yt('video', ['ytmp4', 'playvid'], 'Download a YouTube video', 'video'),
  yt('videodoc', ['ytmp4doc'], 'Download a YouTube video as a document', 'video', true),
  { ...D, name: 'spotify', aliases: ['sp', 'spotifydl'], desc: 'Spotify track → audio (via YouTube match)', usage: '<song name | Spotify link>', run: async (c) => {
    let q = c.input;
    if (/open\.spotify\.com/.test(q)) { try { q = (await getJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(q)}`)).title; } catch { /* keep link */ } }
    return require('../core/commandLoader').get('play').run({ ...c, input: q, text: q });
  } },
  { ...D, name: 'ytsearch', aliases: ['yts', 'youtube'], desc: 'Search YouTube (tap a result to play)', usage: '<query>', run: async (c) => {
    const l = await dl.ytList(c.input, 8); if (!l.length) return c.reply(c.t('not_found'));
    return ui.send(c, { title: '🔎 YouTube', body: frame('🔎 YOUTUBE', l.map((v, i) => `┃ ${i + 1}. ${v.title.slice(0, 50)} • ${v.timestamp}`).join('\n')), buttons: [btn.list('🎧 Pick', [{ title: 'Audio ▶️', rows: l.map((v) => ({ title: v.title.slice(0, 60), desc: `${v.timestamp} • ${v.author?.name || ''}`.slice(0, 70), id: cmd(`play ${v.url}`) })) }, { title: 'Video 🎬', rows: l.slice(0, 5).map((v) => ({ title: v.title.slice(0, 60), desc: v.timestamp, id: cmd(`video ${v.url}`) })) }])] });
  } },
  { ...D, name: 'ytinfo', desc: 'YouTube video details', usage: '<link|query>', run: async (c) => { const v = await dl.ytFind(c.input); return v ? c.send({ image: { url: v.thumbnail || v.image }, caption: card(v) }) : c.reply(c.t('not_found')); } },
  { ...D, name: 'ytthumb', aliases: ['thumb'], desc: 'Get a YouTube thumbnail', usage: '<link>', run: async (c) => { const id = dl.ytId(c.input); if (!id) return c.reply(c.t('no_input')); return c.send({ image: { url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` } }); } },
  soc('tiktok', ['tt', 'ttdl'], 'tiktok', 'TikTok video downloader'),
  soc('instagram', ['ig', 'igdl'], 'instagram', 'Instagram reel/post downloader'),
  soc('facebook', ['fb', 'fbdl'], 'facebook', 'Facebook video downloader'),
  soc('twitter', ['x', 'twdl'], 'twitter', 'Twitter / X video downloader'),
  soc('pinterest', ['pin', 'pindl'], 'pinterest', 'Pinterest media downloader'),
  soc('mediafire', ['mf'], 'mediafire', 'MediaFire file downloader'),
  soc('soundcloud', ['scdl'], 'soundcloud', 'SoundCloud downloader'),
  soc('gdrive', ['drive'], 'gdrive', 'Google Drive file downloader'),
  soc('capcut', ['cc'], 'capcut', 'CapCut template downloader'),
  soc('threads', ['thr'], 'threads', 'Threads media downloader'),
  { ...D, name: 'download', aliases: ['dl', 'get'], desc: 'Auto-detect any supported link and download it', usage: '<link>', run: async (c) => {
    const u = linkOf(c);
    if (dl.detect(u) === 'youtube') return require('../core/commandLoader').get('video').run({ ...c, input: u, text: u });
    await c.react('⏳');
    try { await dl.sendFromUrls(c, await dl.social(u), `⚡ ${cfg.botName}`); return c.react('✅'); }
    catch (e) { c.react('❌'); return tooBig(c, e); }
  } },
  { ...D, name: 'movie', aliases: ['film-info', 'imdb'], desc: 'Movie details + trailer (OMDb key optional)', usage: '<title>', run: async (c) => {
    const trailer = (await dl.ytList(`${c.input} official trailer`, 1))[0];
    if (cfg.omdbKey) {
      const m = await getJson(`https://www.omdbapi.com/?t=${encodeURIComponent(c.input)}&apikey=${cfg.omdbKey}`);
      if (m.Response !== 'False') {
        const cap = frame(`🎬 ${m.Title}`, [line('📅', 'Year', m.Year), line('⭐', 'IMDb', m.imdbRating), line('🎭', 'Genre', m.Genre), line('⏱️', 'Runtime', m.Runtime), line('🎬', 'Director', m.Director), `┃ 📝 ${await c.tr(m.Plot)}`, trailer ? line('▶️', 'Trailer', trailer.url) : ''].filter(Boolean).join('\n'));
        return m.Poster && m.Poster !== 'N/A' ? c.send({ image: { url: m.Poster }, caption: cap }) : c.reply(cap);
      }
    }
    return trailer ? c.send({ image: { url: trailer.thumbnail }, caption: card(trailer) }) : c.reply(c.t('not_found'));
  } },
  { ...D, name: 'trailer', desc: 'Find and send a movie trailer', usage: '<title>', run: (c) => require('../core/commandLoader').get('video').run({ ...c, input: `${c.input} official trailer`, text: `${c.input} official trailer` }) },
];
