// Anti-Delete (global + VIP owner protection) and View-Once retriever
const { getContentType, downloadMediaMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const cfg = require('../config');
const log = require('../logger');
const S = require('./settings');
const I = require('./i18n');
const store = require('./store');
const users = require('./users');
const ui = require('./ui');
const { Stored } = require('../database');
const { num } = require('./utils');

const MEDIA = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio', stickerMessage: 'sticker', documentMessage: 'document' };
const selfJid = (sock) => jidNormalizedUser(sock.user.id);
const selfNum = (sock) => num(selfJid(sock));
const textOf = (m) => m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || '';

// VIP rule: the main session is paired with the OWNER's number -> every DM that arrives is "sent TO the owner"
const isVipChat = (session, isGroup) => session.sid === cfg.mainSession && !isGroup && selfNum(session.sock) === cfg.ownerNumber;
const dl = (session, raw, inner) => downloadMediaMessage({ key: raw.key, message: inner }, 'buffer', {}, { logger: log.baileysLogger, reuploadRequest: session.sock.updateMediaMessage });

async function record(session, raw, inner, isGroup, sender) {
  const { sid, sock } = session;
  const chat = raw.key.remoteJid;
  const vip = isVipChat(session, isGroup);
  if (!vip && !S.isOn(sid, 'antidelete')) return;
  const type = getContentType(inner);
  const e = { sid, chat, id: raw.key.id, sender, pushName: raw.pushName, ts: Date.now(), type, vip, isGroup, size: 0 };
  if (MEDIA[type]) {
    const c = inner[type];
    const len = Number(c.fileLength?.low ?? c.fileLength ?? 0);
    e.caption = c.caption || ''; e.mime = c.mimetype; e.ptt = !!c.ptt; e.fileName = c.fileName;
    if (len <= 12 * 1048576) { try { e.buffer = await dl(session, raw, inner); e.size = e.buffer.length; } catch (err) { log.debug({ err: err.message }, 'vault download failed'); } }
  } else e.text = textOf(inner);
  store.put(e);
  if (vip) {
    Stored.updateOne({ sid, id: e.id }, { $set: { chat, sender, pushName: e.pushName, type, text: e.text, caption: e.caption, mime: e.mime, ptt: e.ptt, ts: e.ts, data: e.buffer && e.buffer.length <= 8 * 1048576 ? e.buffer : undefined, expireAt: new Date(Date.now() + 3 * 86400000) } }, { upsert: true }).catch(() => {});
  }
}

async function deliver(sock, target, e, header) {
  const k = e.buffer ? MEDIA[e.type] : null;
  if (!k) return sock.sendMessage(target, { text: `${header}\n\n${e.text || `[${e.type}]`}`, mentions: [e.sender] });
  if (k === 'image' || k === 'video') return sock.sendMessage(target, { [k]: e.buffer, caption: `${header}${e.caption ? `\n\n${e.caption}` : ''}`, mentions: [e.sender] });
  await sock.sendMessage(target, { text: header, mentions: [e.sender] });
  if (k === 'audio') return sock.sendMessage(target, { audio: e.buffer, mimetype: e.mime || 'audio/ogg; codecs=opus', ptt: !!e.ptt });
  if (k === 'sticker') return sock.sendMessage(target, { sticker: e.buffer });
  return sock.sendMessage(target, { document: e.buffer, mimetype: e.mime || 'application/octet-stream', fileName: e.fileName || 'file' });
}

async function onRevoke(session, raw, inner, isGroup, deleter) {
  const { sid, sock } = session;
  const id = inner.protocolMessage?.key?.id;
  const chat = raw.key.remoteJid;
  if (!id) return;
  let e = store.find(sid, chat, id);
  if (!e) {
    const d = await Stored.findOne({ sid, id }).lean();
    if (d) e = { ...d, sid, buffer: d.data ? Buffer.from(d.data.buffer || d.data) : undefined, vip: true, isGroup };
  }
  if (!e || e.fromMe) return;
  const owner = await users.get(cfg.ownerNumber);
  const lang = owner.lang || cfg.defaultLang;
  const t = (k) => I.t(lang, k);
  const head = ui.frame(`🛡️ ${t('ad_title')}`, [
    `┃ 👤 ${t('vv_from')}: @${num(e.sender)}${e.pushName ? ` (${e.pushName})` : ''}`,
    `┃ 🗑️ ${t('ad_from')}: @${num(deleter)}`,
    `┃ 💬 ${t('ad_chat')}: ${isGroup ? chat : 'DM'}`,
    `┃ 🕒 ${new Date(e.ts).toLocaleString('en-GB', { timeZone: cfg.tz })}`,
  ].join('\n'));
  // VIP -> resend to the owner. Otherwise -> to this session's own chat.
  const target = selfJid(sock); // VIP: main session = owner's own account, so this lands in the owner's chat
  await deliver(sock, target, e, head);
}

async function viewOnce(session, raw, vo, sender) {
  const { sid, sock } = session;
  const type = getContentType(vo);
  const buf = await dl(session, raw, vo);
  const c = vo[type];
  const head = `👁️ *VIEW-ONCE RETRIEVER*\n👤 @${num(sender)}${raw.pushName ? ` (${raw.pushName})` : ''}\n💬 ${raw.key.remoteJid.endsWith('@g.us') ? raw.key.remoteJid : 'DM'}`;
  const k = MEDIA[type];
  const to = selfJid(sock);
  if (k === 'image' || k === 'video') await sock.sendMessage(to, { [k]: buf, caption: `${head}${c.caption ? `\n\n${c.caption}` : ''}`, mentions: [sender] });
  else if (k === 'audio') { await sock.sendMessage(to, { text: head, mentions: [sender] }); await sock.sendMessage(to, { audio: buf, mimetype: c.mimetype || 'audio/ogg; codecs=opus', ptt: !!c.ptt }); }
}

module.exports = { record, onRevoke, viewOnce, isVipChat, selfJid, selfNum, textOf };
