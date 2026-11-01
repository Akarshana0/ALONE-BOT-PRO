const S = require('./settings');
const I = require('./i18n');
const cfg = require('../config');
const { num } = require('./utils');

const LINK = /(https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/)\S+/i;
const BAD = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'slut', 'dick', 'pussy'];
const spam = new Map();

async function warnUser(c, jid, reason) {
  const n = num(jid);
  const g = await S.group(c.sid, c.chat);
  const cnt = (g.warns[n] || 0) + 1;
  await S.setWarn(c.sid, c.chat, n, cnt);
  const user = `@${n}`;
  await c.sock.sendMessage(c.chat, { text: c.t('warn_msg', { user, n: cnt, max: cfg.maxWarns, reason }), mentions: [jid] });
  if (cnt >= cfg.maxWarns && c.isBotAdmin) {
    await c.sock.groupParticipantsUpdate(c.chat, [jid], 'remove').catch(() => {});
    await S.setWarn(c.sid, c.chat, n, 0);
    await c.sock.sendMessage(c.chat, { text: c.t('warn_kick', { user }), mentions: [jid] });
  }
}

// returns true when the message was handled/removed
async function check(c, g) {
  if (!c.isGroup || c.isAdmin || c.isOwner || c.isSelf || !c.isBotAdmin) return false;
  const del = () => c.sock.sendMessage(c.chat, { delete: c.raw.key }).catch(() => {});
  const f = (k) => S.groupOn(g, k);
  if (f('antilink') && LINK.test(c.body)) { await del(); await c.sock.sendMessage(c.chat, { text: c.t('link_removed', { user: `@${c.senderNumber}` }), mentions: [c.sender] }); await warnUser(c, c.sender, 'link'); return true; }
  if (f('antibadword') && BAD.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(c.body))) { await del(); await warnUser(c, c.sender, 'bad word'); return true; }
  if (f('antibot') && (c.raw.key.id || '').startsWith('BAE5')) { await del(); await c.sock.groupParticipantsUpdate(c.chat, [c.sender], 'remove').catch(() => {}); return true; }
  if (f('antispam')) {
    const k = `${c.sid}:${c.chat}:${c.sender}`;
    const now = Date.now(); const arr = (spam.get(k) || []).filter((t) => now - t < 8000); arr.push(now); spam.set(k, arr);
    if (arr.length > 7) { spam.set(k, []); await del(); await warnUser(c, c.sender, 'spam'); return true; }
  }
  return false;
}
module.exports = { check, warnUser };
