// Auto link downloader: any supported social-media link sent in a chat -> the photo / video / audio is downloaded and sent back.
const cfg = require('../config');
const log = require('../logger');
const dl = require('./dl');

const seen = new Map();                                    // message-id -> timestamp (WhatsApp can deliver the same message twice)
const claim = (id) => {
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 120000) seen.delete(k);
  if (seen.has(id)) return false;
  seen.set(id, now);
  return true;
};
const isTooBig = (e) => e.message === 'TOO_BIG' || /maxContentLength|maxBodyLength/.test(e.message || '');

// returns true when the message contained at least one downloadable link (so the caller stops further handling)
async function run(c) {
  const links = dl.urlsIn(c.body).filter((u) => dl.detect(u)).slice(0, 3);
  if (!links.length) return false;
  if (!claim(`${c.sid}|${c.raw.key.id}`)) return true;
  for (const url of links) {
    await c.react('⏳');
    try {
      await dl.downloadLink(c, url, `⚡ ${cfg.botName}`);
      await c.react('✅');
    } catch (e) {
      log.warn({ err: e.message, url }, 'autodl failed');
      await c.react('❌');
      if (isTooBig(e)) await c.reply(c.t('too_big', { mb: cfg.maxMediaMB })).catch(() => {});
      else if (e.message === 'TOO_LONG') await c.say(`⏱️ This video is too long for auto-download. For full films / long videos use ${c.prefix}filmdl <link>.`).catch(() => {});
    }
  }
  return true;
}

module.exports = { run };
