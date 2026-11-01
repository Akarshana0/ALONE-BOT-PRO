// Download providers: yt-search + ytdl-core (primary) with btch-downloader fallback, generic social downloader
const cfg = require('../config');
const { safeRequire, getFile, sleep } = require('./utils');
const { toMp3 } = require('./media');

const yts = safeRequire('yt-search');
const ytdl = safeRequire('@distube/ytdl-core');
const btch = safeRequire('btch-downloader');
const MAX = () => cfg.maxMediaMB * 1048576;

// Optional YouTube agent (cookies / proxy) — datacenter IPs (Heroku) are often challenged with "confirm you're not a bot"
let _agent;
function ytAgent() {
  if (_agent !== undefined) return _agent;
  _agent = null;
  try {
    if (ytdl && cfg.ytProxy) _agent = ytdl.createProxyAgent({ uri: cfg.ytProxy }, cfg.ytCookies ? JSON.parse(cfg.ytCookies) : []);
    else if (ytdl && cfg.ytCookies) _agent = ytdl.createAgent(JSON.parse(cfg.ytCookies));
  } catch (e) { require('../logger').warn({ err: e.message }, 'YT_COOKIES / YT_PROXY invalid — continuing without'); }
  return _agent;
}
const ytOpts = (o = {}) => (ytAgent() ? { agent: ytAgent(), ...o } : o);

const ytId = (u) => (String(u).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/) || [])[1];
async function ytFind(q) {
  if (!yts) throw new Error('yt-search not installed');
  const id = ytId(q);
  if (id) return yts({ videoId: id });
  return (await yts(q)).videos[0];
}
async function ytList(q, n = 8) { return (await yts(q)).videos.slice(0, n); }

function streamToBuf(stream, max) {
  return new Promise((res, rej) => {
    const chunks = []; let size = 0;
    stream.on('data', (d) => { size += d.length; if (size > max) { stream.destroy(); rej(new Error('TOO_BIG')); } else chunks.push(d); });
    stream.on('end', () => res(Buffer.concat(chunks)));
    stream.on('error', rej);
  });
}

// Keys that hold previews / avatars / page links — never the media itself
const SKIP_KEY = /thumb|cover|avatar|profile|icon|poster|preview|artwork|caption|logo|banner|^link$/i;
const isHttp = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);
// Collect http(s) URLs from an arbitrary JSON structure (provider shapes vary), skipping thumbnails/avatars
function mediaUrls(o, out = []) {
  if (!o) return out;
  if (isHttp(o)) out.push(o);
  else if (Array.isArray(o)) o.forEach((x) => mediaUrls(x, out));
  else if (typeof o === 'object') for (const [k, v] of Object.entries(o)) if (!SKIP_KEY.test(k)) mediaUrls(v, out);
  return [...new Set(out)];
}
const rank = (u) => (/\.(mp4|webm|mov)(\?|$)/i.test(u) ? 0 : /\.(mp3|m4a)(\?|$)/i.test(u) ? 1 : /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u) ? 2 : /googlevideo|fbcdn|cdninstagram|tiktok|twimg|pinimg|mediafire|video/i.test(u) ? 3 : 4);
const bestUrls = (o) => mediaUrls(o).sort((a, b) => rank(a) - rank(b));

async function ytMedia(url, kind) {
  try {
    if (!ytdl) throw new Error('no ytdl');
    const info = await ytdl.getInfo(url, ytOpts());
    if (kind === 'audio') {
      const f = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
      return await toMp3(await streamToBuf(ytdl.downloadFromInfo(info, ytOpts({ format: f })), MAX()));
    }
    let f;
    try { f = ytdl.chooseFormat(info.formats, { quality: '18' }); } catch { f = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'audioandvideo' }); }
    return await streamToBuf(ytdl.downloadFromInfo(info, ytOpts({ format: f })), MAX());
  } catch (e) {
    if (e.message === 'TOO_BIG') throw e;
    if (!btch?.youtube) throw e;
    const r = await btch.youtube(url);
    const direct = kind === 'audio' ? r.mp3 || r.audio : r.mp4 || r.video;
    const u = typeof direct === 'string' ? direct : bestUrls(r).find((x) => (kind === 'audio' ? /mp3|audio/i.test(x) : /mp4|video/i.test(x))) || bestUrls(r)[0];
    if (!u) throw e;
    const { buffer } = await getFile(u);
    return kind === 'audio' && !/mp3/.test(u) ? toMp3(buffer) : buffer;
  }
}

// ───────── social downloaders (btch-downloader) ─────────
// matched against the URL's hostname only (so "netflix.com" never counts as "x.com")
const HOST = (names) => new RegExp(`^(?:[a-z0-9-]+\\.)*(?:${names})$`, 'i');
const SOCIAL = {
  tiktok: [HOST('tiktok\\.com'), ['ttdl']],
  instagram: [HOST('instagram\\.com|instagr\\.am'), ['igdl']],
  facebook: [HOST('facebook\\.com|fb\\.watch|fb\\.com|fb\\.me'), ['fbdown']],
  twitter: [HOST('twitter\\.com|x\\.com'), ['twitter']],
  pinterest: [HOST('pinterest\\.[a-z.]+|pin\\.it'), ['pinterest']],
  mediafire: [HOST('mediafire\\.com'), ['mediafire']],
  soundcloud: [HOST('soundcloud\\.com|on\\.soundcloud\\.com'), ['soundcloud']],
  gdrive: [HOST('drive\\.google\\.com'), ['gdrive']],
  capcut: [HOST('capcut\\.com'), ['capcut']],
  threads: [HOST('threads\\.net|threads\\.com'), ['threads']],
};
const YT_RE = HOST('youtube\\.com|youtu\\.be|music\\.youtube\\.com');

// 'youtube' | <SOCIAL key> | null
function detect(url) {
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  if (YT_RE.test(host)) return 'youtube';
  return Object.keys(SOCIAL).find((k) => SOCIAL[k][0].test(host)) || null;
}
// every http(s) link inside a chat message
const urlsIn = (text) => [...new Set((String(text || '').match(/https?:\/\/[^\s<>"'`]+/gi) || []).map((u) => u.replace(/[)\].,!?;:*~]+$/, '')))];

const asUrls = (v) => [].concat(v || []).map((x) => (typeof x === 'string' ? x : x?.url)).filter(isHttp);
const bySize = (o) => Object.values(o || {}).sort((a, b) => (b.width || 0) - (a.width || 0)).map((x) => x.url);

// Each extractor returns GROUPS of candidate URLs: one group = one deliverable (alternatives inside, best first).
const EXTRACT = {
  tiktok: (r) => { const v = asUrls(r.video); return v.length ? [v] : [asUrls(r.audio)]; },
  instagram: (r) => asUrls((r.result || []).map((i) => i.url)).map((u) => [u]),   // carousel -> several items
  facebook: (r) => [asUrls([r.HD, r.hd, r.Normal_video, r.sd])],                  // HD first
  twitter: (r) => [asUrls(r.url)],
  pinterest: (r) => {
    const p = Array.isArray(r.result) ? r.result[0] || {} : r.result || r;
    const vids = asUrls([p.video_url, ...bySize(p.videos)]);
    if (vids.length) return [vids];
    return [asUrls([...bySize(p.images), p.image])];
  },
  threads: (r) => { const p = r.result || r; return [asUrls(p.video || p.image)]; },
  mediafire: (r) => [asUrls([r.result?.url, r.data?.url, r.url])],
  soundcloud: (r) => { const p = r.result || r; return [asUrls([p.downloadMp3, p.audio])]; },
  gdrive: (r) => [asUrls([r.result?.downloadUrl, r.downloadUrl])],
  capcut: (r) => [asUrls([r.originalVideoUrl, r.result?.originalVideoUrl])],
};

async function callProvider(fns, url) {
  let last;
  for (const n of fns) {
    if (typeof btch[n] !== 'function') continue;
    for (let i = 0; i < 2; i++) {            // one retry — these free APIs are flaky
      try { return await btch[n](url); } catch (e) { last = e; await sleep(800); }
    }
  }
  throw last || new Error('Provider unavailable');
}

// -> array of groups of candidate URLs (see EXTRACT)
async function social(url, forced) {
  if (!btch) throw new Error('Downloader module (btch-downloader) is not installed');
  const key = forced || detect(url);
  if (!key || key === 'youtube' || !SOCIAL[key]) throw new Error('Unsupported link');
  let groups = [], err;
  try {
    const r = await callProvider(SOCIAL[key][1], url);
    groups = (EXTRACT[key]?.(r) || []).filter((g) => g.length);
    if (!groups.length) { const g = bestUrls(r).filter((u) => u !== url); if (g.length) groups = [g]; }   // provider changed its shape
  } catch (e) { err = e; }
  if (!groups.length && typeof btch.aio === 'function') {                                              // last resort: all-in-one API
    try { const g = bestUrls(await btch.aio(url)).filter((u) => u !== url); if (g.length) groups = [g]; } catch (e) { err ||= e; }
  }
  if (!groups.length) throw err || new Error('No media found');
  return groups.slice(0, 10);
}

// identify the real file type (providers often send wrong / missing content-types)
function sniff(buf, mime) {
  const h = buf.subarray(0, 16);
  const ascii = h.toString('latin1');
  if (h[0] === 0xff && h[1] === 0xd8) return 'image';
  if (ascii.startsWith('\x89PNG') || ascii.startsWith('GIF8') || (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP')) return 'image';
  if (ascii.slice(4, 8) === 'ftyp' || (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3)) return /^audio/.test(mime) ? 'audio' : 'video';
  if (ascii.startsWith('ID3') || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) || ascii.startsWith('OggS') || ascii.startsWith('fLaC')) return 'audio';
  if (/^text\/html|^application\/json|^text\/plain/.test(mime) || /^\s*(<|\{)/.test(buf.subarray(0, 40).toString('utf8'))) return 'bad';
  if (/^video/.test(mime)) return 'video';
  if (/^image/.test(mime)) return 'image';
  if (/^audio/.test(mime)) return 'audio';
  return 'file';
}

const DL_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36', Accept: '*/*' };

// Download one group (try alternatives in order) and send it with the right WhatsApp message type
async function sendOne(c, urls, caption) {
  let last;
  for (const u of urls.slice(0, 4)) {
    try {
      const { buffer, mime } = await getFile(u, { headers: DL_HEADERS });
      if (!buffer.length) throw new Error('empty file');
      const kind = sniff(buffer, mime || '');
      if (kind === 'bad') throw new Error('provider returned a web page, not media');
      if (kind === 'video') return await c.send({ video: buffer, caption, mimetype: 'video/mp4' });
      if (kind === 'image') return await c.send({ image: buffer, caption });
      if (kind === 'audio') return await c.send({ audio: buffer, mimetype: 'audio/mpeg' });
      return await c.send({ document: buffer, mimetype: mime || 'application/octet-stream', fileName: decodeURIComponent(u.split('?')[0].split('/').pop() || 'file'), caption });
    } catch (e) { last = e; }
  }
  throw last || new Error('download failed');
}

// groups: result of social() (also accepts a flat array of URLs = one group of alternatives)
async function sendFromUrls(c, groups, caption = '') {
  if (groups.length && typeof groups[0] === 'string') groups = [groups];
  let sent = 0, last;
  for (const g of groups) {
    try { await sendOne(c, g, sent ? '' : caption); sent++; } catch (e) { last = e; }
  }
  if (!sent) throw last || new Error('download failed');
  return sent;
}

// Everything the auto-downloader needs in one call: YouTube -> video, any other supported link -> photo/video/audio
async function downloadLink(c, url, caption = `⚡ ${cfg.botName}`) {
  const kind = detect(url);
  if (kind === 'youtube') {
    if (!ytId(url)) throw new Error('Unsupported link');   // playlist / channel links are not single videos
    const v = await ytFind(url);
    if (v?.seconds && v.seconds > 1500) throw new Error('TOO_LONG');   // long videos / films -> .filmdl (streams to disk)
    const buf = await ytMedia(v?.url || url, 'video');
    return c.send({ video: buf, caption: v?.title ? `🎬 ${v.title}` : caption, mimetype: 'video/mp4' });
  }
  return sendFromUrls(c, await social(url, kind), caption);
}

module.exports = { ytFind, ytList, ytMedia, ytId, ytAgent, ytOpts, ytdl, social, sendFromUrls, downloadLink, detect, urlsIn, bestUrls, SOCIAL };
