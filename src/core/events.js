const cfg = require('../config');
const log = require('../logger');
const S = require('./settings');
const I = require('./i18n');
const cards = require('./cards');
const { num } = require('./utils');
const { groupMeta } = require('./handler');

async function onGroupParticipants(session, ev) {
  const { sid, sock } = session;
  const { id: gid, action } = ev;
  const g = await S.group(sid, gid);
  const key = action === 'add' ? 'welcome' : action === 'remove' ? 'goodbye' : null;
  if (!key || !S.groupOn(g, key)) return;
  const meta = await groupMeta(sock, gid);
  const gname = meta?.subject || 'Group';
  for (const p of ev.participants) {
    const jid = typeof p === 'string' ? p : p.phoneNumber || p.id;
    const n = num(jid);
    const tpl = (key === 'welcome' ? g.welcomeMsg : g.goodbyeMsg) || I.t(cfg.defaultLang, `${key === 'welcome' ? 'welcome' : 'goodbye'}_default`);
    const text = tpl.replace(/\{user\}/g, `@${n}`).replace(/\{group\}/g, gname);
    try {
      const img = await cards.makeCard(sock, { jid, name: `+${n}`, line1: key === 'welcome' ? '⚡ WELCOME' : '👋 GOODBYE', line2: gname, ...(key === 'goodbye' ? { color: '#ff5c5c', accent: '#ffb300' } : {}) });
      await sock.sendMessage(gid, { image: img, caption: text, mentions: [jid] });
    } catch (e) { log.debug({ err: e.message }, 'card failed'); await sock.sendMessage(gid, { text, mentions: [jid] }).catch(() => {}); }
  }
}

async function onCall(session, calls) {
  if (!S.isOn(session.sid, 'anticall')) return;
  for (const call of calls) {
    if (call.status !== 'offer') continue;
    try { await session.sock.rejectCall(call.id, call.from); await session.sock.sendMessage(call.from, { text: '📵 Calls are disabled. Please send a message instead. ⚡' }); } catch (e) { log.debug({ err: e.message }, 'rejectCall'); }
  }
}

module.exports = { onGroupParticipants, onCall };
