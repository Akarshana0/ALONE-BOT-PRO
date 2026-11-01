// Message pipeline: unwrap -> vault/anti-delete -> view-once -> automation -> language gate -> command dispatch
const { getContentType, jidNormalizedUser, downloadMediaMessage, proto } = require('@whiskeysockets/baileys');
const cfg = require('../config');
const log = require('../logger');
const S = require('./settings');
const I = require('./i18n');
const ui = require('./ui');
const store = require('./store');
const vault = require('./vault');
const mod = require('./moderation');
const users = require('./users');
const loader = require('./commandLoader');
const { num, sleep } = require('./utils');

const UNWRAP = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage'];
const unwrap = (m) => { let cur = m; for (let i = 0; i < 5 && cur; i++) { const k = UNWRAP.find((x) => cur[x]); if (!k) break; cur = cur[k].message; } return cur; };
const nativeId = (m) => { try { return JSON.parse(m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson || '{}').id || ''; } catch { return ''; } };
const textOf = (m) => m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption
  || m.buttonsResponseMessage?.selectedButtonId || m.listResponseMessage?.singleSelectReply?.selectedRowId || m.templateButtonReplyMessage?.selectedId || nativeId(m) || '';

const metaCache = new Map();
async function groupMeta(sock, jid) {
  const hit = metaCache.get(jid);
  if (hit && Date.now() - hit.at < 60000) return hit.meta;
  const meta = await sock.groupMetadata(jid).catch(() => null);
  if (meta) metaCache.set(jid, { meta, at: Date.now() });
  return meta;
}
const cooldown = new Map();

async function getMedia(c) {
  const sources = [{ key: c.raw.key, message: c.inner }];
  if (c.quoted) sources.push({ key: { remoteJid: c.chat, id: c.quoted.id, participant: c.quoted.participant }, message: c.quoted.message });
  for (const s of sources) {
    const t = getContentType(s.message || {});
    if (/^(image|video|audio|sticker|document)Message$/.test(t || '')) {
      const buffer = await downloadMediaMessage(s, 'buffer', {}, { logger: log.baileysLogger, reuploadRequest: c.sock.updateMediaMessage });
      return { buffer, type: t.replace('Message', ''), mime: s.message[t].mimetype || '', fileName: s.message[t].fileName };
    }
  }
  return null;
}

async function handleStatus(session, raw) {
  const { sid, sock } = session;
  if (raw.key.fromMe) return;
  try {
    if (S.isOn(sid, 'autostatusview')) await sock.readMessages([raw.key]);
    if (S.isOn(sid, 'autostatusreact')) await sock.sendMessage('status@broadcast', { react: { text: '💚', key: raw.key } }, { statusJidList: [raw.key.participant, vault.selfJid(sock)] });
  } catch (e) { log.debug({ err: e.message }, 'status handling'); }
}

async function onUpsert(session, upsert) {
  for (const raw of upsert.messages) {
    try { await processMessage(session, raw, upsert.type); } catch (e) { log.error({ err: e }, 'processMessage'); }
  }
}

async function processMessage(session, raw, upType) {
  const { sid, sock } = session;
  if (!raw.message || !raw.key?.remoteJid) return;
  const chat = raw.key.remoteJid;
  if (chat === 'status@broadcast') return handleStatus(session, raw);
  if (chat.endsWith('@newsletter') || chat.endsWith('@broadcast')) return;
  if (raw.message.editedMessage || raw.message.protocolMessage?.type === 14) return;
  const inner = unwrap(raw.message);
  if (!inner) return;
  const isGroup = chat.endsWith('@g.us');
  const fromMe = !!raw.key.fromMe;
  const me = vault.selfJid(sock);
  const sender = jidNormalizedUser(fromMe ? me : (raw.key.participantPn || raw.key.senderPn || raw.key.participant || chat));
  const senderNumber = num(sender);

  // remember own/outgoing messages (retry support + `.purge`)
  if (fromMe) { store.remember(sid, raw.key.id, raw.message); store.logSent(sid, chat, raw.key); }
  if (fromMe && String(raw.key.id).startsWith('BAE5')) return; // our own bot replies

  // revoke (delete for everyone)
  if (inner.protocolMessage) {
    if (inner.protocolMessage.type === proto.Message.ProtocolMessage.Type.REVOKE) await vault.onRevoke(session, raw, inner, isGroup, sender);
    return;
  }

  if (!fromMe) {
    await vault.record(session, raw, inner, isGroup, sender).catch((e) => log.debug({ err: e.message }, 'vault.record'));
    // view-once retriever
    const vo = raw.message.viewOnceMessage?.message || raw.message.viewOnceMessageV2?.message || raw.message.viewOnceMessageV2Extension?.message;
    const t0 = getContentType(inner);
    if ((vo || inner[t0]?.viewOnce) && S.isOn(sid, 'vv')) await vault.viewOnce(session, raw, vo || inner, sender).catch((e) => log.warn({ err: e.message }, 'viewOnce'));
  }

  // old backlog messages never trigger commands
  const ts = Number(raw.messageTimestamp?.low ?? raw.messageTimestamp ?? 0);
  if (ts && Date.now() / 1000 - ts > 120) return;

  let body = textOf(inner).trim();
  const prefix = S.prefix(sid);
  if (body.startsWith('cmd:')) body = prefix + body.slice(4); // interactive button/list ids

  // permissions
  const isSelf = fromMe;
  const isOwner = senderNumber === cfg.ownerNumber || (fromMe && sid === cfg.mainSession);
  const isPublic = S.isOn(sid, 'public');
  if (!isPublic && !isOwner && !isSelf) return;

  const user = await users.get(senderNumber);
  if (user.banned && !isOwner) return;

  // automation
  if (!fromMe) {
    if (S.isOn(sid, 'autoread')) sock.readMessages([raw.key]).catch(() => {});
    if (S.isOn(sid, 'autotyping')) sock.sendPresenceUpdate('composing', chat).catch(() => {});
    else if (S.isOn(sid, 'autorecording')) sock.sendPresenceUpdate('recording', chat).catch(() => {});
    if (S.isOn(sid, 'autoreact') && body) sock.sendMessage(chat, { react: { text: ['⚡', '🤖', '🚀', '💎', '🔥'][Math.floor(Math.random() * 5)], key: raw.key } }).catch(() => {});
  }

  // group info
  let meta = null, isAdmin = false, isBotAdmin = false, g = null;
  if (isGroup) {
    meta = await groupMeta(sock, chat);
    if (meta) {
      const admins = meta.participants.filter((p) => p.admin).flatMap((p) => [p.id, p.phoneNumber, p.jid]).filter(Boolean).map(num);
      isAdmin = admins.includes(senderNumber); isBotAdmin = admins.includes(num(me));
    }
    g = await S.group(sid, chat);
  }

  // quoted
  const type = getContentType(inner);
  const ci = inner[type]?.contextInfo;
  const quotedMsg = ci?.quotedMessage ? unwrap(ci.quotedMessage) : null;
  const quoted = quotedMsg ? { id: ci.stanzaId, participant: ci.participant ? jidNormalizedUser(ci.participant) : null, message: quotedMsg, text: textOf(quotedMsg), fromMe: ci.participant ? num(ci.participant) === num(me) : false } : null;

  const isCmd = body.startsWith(prefix) && body.length > prefix.length;
  const [name, ...args] = isCmd ? body.slice(prefix.length).trim().split(/\s+/) : [''];
  const command = (name || '').toLowerCase();
  const lang = user.lang || cfg.defaultLang;

  const c = {
    session, sid, sock, raw, inner, chat, isGroup, sender, senderNumber, pushName: raw.pushName || 'User',
    body, prefix, command, args, text: args.join(' '), quoted, lang, isOwner, isSelf, isAdmin, isBotAdmin, groupMeta: meta, group: g,
    t: (k, v) => I.t(lang, k, { p: prefix, bot: cfg.botName, ...v }),
    tr: (txt) => I.tr(lang, txt),
  };
  c.input = c.text || quoted?.text || '';
  c.reply = (text, o = {}) => sock.sendMessage(chat, { text, ...o }, { quoted: raw });
  c.say = async (text, o) => c.reply(await I.tr(lang, text), o);
  c.send = (content, o = {}) => sock.sendMessage(chat, content, { quoted: raw, ...o });
  c.react = (e) => sock.sendMessage(chat, { react: { text: e, key: raw.key } }).catch(() => {});
  c.ui = (spec) => ui.send(c, spec);
  c.getMedia = () => getMedia(c);
  c.mentionedJids = () => ci?.mentionedJid || [];

  if (isGroup && !fromMe && (await mod.check(c, g))) return;

  // auto link downloader: a plain message containing a social-media link -> send the photo / video
  if (!isCmd && body && S.isOn(sid, 'autodl') && (await require('./autodl').run(c).catch((e) => { log.error({ err: e }, 'autodl'); return false; }))) return;

  // language gate (DM only): first interaction -> language picker
  if (!isGroup && !fromMe && !user.lang && !/^(setlang|language|lang)$/.test(command)) {
    if (!user.langPromptedAt || Date.now() - user.langPromptedAt > 3600000) {
      await users.update(senderNumber, { langPromptedAt: Date.now() });
      c.lang = cfg.defaultLang;
      return loader.get('language').run({ ...c, args: [], text: '', command: 'language' });
    }
  }

  if (!isCmd) {
    if (!isGroup && !fromMe && body && S.isOn(sid, 'chatbot') && isPublic) {
      const ai = require('./ai');
      try { const out = await ai.ask(`${sid}:${senderNumber}`, body, { lang }); await c.reply(out); } catch { /* ignore */ }
    }
    return;
  }

  const cmd = loader.get(command);
  if (!cmd) return;

  // checks
  const last = cooldown.get(`${sid}:${senderNumber}`) || 0;
  if (Date.now() - last < 1200 && !isOwner) return;
  cooldown.set(`${sid}:${senderNumber}`, Date.now());

  if (cmd.owner && !isOwner) return c.reply(c.t('owner_only'));
  if (cmd.owner && sid !== cfg.mainSession && !cmd.anySession) return;
  if (cmd.self && !isOwner && !isSelf) return c.reply(c.t('owner_only'));
  if (cmd.group && !isGroup) return c.reply(c.t('group_only'));
  if (cmd.admin && !(isAdmin || isOwner || isSelf)) return c.reply(c.t('admin_only'));
  if (cmd.botAdmin && !isBotAdmin) return c.reply(c.t('bot_admin'));
  if (isGroup && S.groupOn(g, 'adminonly') && !(isAdmin || isOwner || isSelf)) return;
  if (cmd.need && !c.input) return c.reply(c.t('usage', { usage: `${prefix}${cmd.name} ${cmd.usage || ''}`.trim() }));

  users.update(senderNumber, { commands: (user.commands || 0) + 1, lastSeen: new Date() }).catch(() => {});
  try { await cmd.run(c); }
  catch (e) {
    log.error({ err: e, cmd: cmd.name }, 'command failed');
    c.reply(c.t('error', { err: String(e.message || e).slice(0, 180) })).catch(() => {});
  }
}

module.exports = { onUpsert, groupMeta, textOf, unwrap };
