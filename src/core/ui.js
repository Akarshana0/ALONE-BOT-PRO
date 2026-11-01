// Futuristic UI layer: WhatsApp interactive buttons/lists with automatic plain-text fallback
const { generateWAMessageFromContent, prepareWAMessageMedia, proto } = require('@whiskeysockets/baileys');
const cfg = require('../config');
const log = require('../logger');
const S = require('./settings');
const { botId } = require('./utils');

const cmd = (s) => `cmd:${s}`; // button ids that run a command (prefix is added by the handler)
const frame = (title, body, foot) => `╭━━━━『 ${title} 』━━━━╮\n${body}\n╰━━━━『 ${foot || `${cfg.botName} ⚡ ${cfg.ownerName}`} 』━━━━╯`;
const line = (emoji, label, value) => `┃ ${emoji} *${label}:* ${value}`;

const btn = {
  reply: (text, id) => ({ t: 'reply', text, id }),
  list: (text, sections) => ({ t: 'list', text, sections }),
  url: (text, url) => ({ t: 'url', text, url }),
  copy: (text, code) => ({ t: 'copy', text, code }),
};

const toNative = (b) => {
  if (b.t === 'reply') return { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: b.text, id: b.id }) };
  if (b.t === 'url') return { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: b.text, url: b.url, merchant_url: b.url }) };
  if (b.t === 'copy') return { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: b.text, copy_code: b.code }) };
  return {
    name: 'single_select',
    buttonParamsJson: JSON.stringify({
      title: b.text,
      sections: b.sections.map((s) => ({ title: s.title, rows: s.rows.map((r) => ({ header: '', title: r.title, description: r.desc || '', id: r.id })) })),
    }),
  };
};

async function sendInteractive(sock, jid, spec, quoted) {
  const I = proto.Message.InteractiveMessage;
  let header = I.Header.create({ title: spec.title || '', subtitle: '', hasMediaAttachment: false });
  if (spec.image) {
    const media = await prepareWAMessageMedia({ image: { url: spec.image } }, { upload: sock.waUploadToServer });
    header = I.Header.create({ title: spec.title || '', subtitle: '', hasMediaAttachment: true, ...media });
  }
  const content = {
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: I.create({
          header,
          body: I.Body.create({ text: spec.body }),
          footer: I.Footer.create({ text: spec.footer || `${cfg.botName} ⚡` }),
          nativeFlowMessage: I.NativeFlowMessage.create({ buttons: spec.buttons.map(toNative) }),
        }),
      },
    },
  };
  const msg = generateWAMessageFromContent(jid, content, { quoted, userJid: sock.user.id, messageId: botId() });
  await sock.relayMessage(jid, msg.message, {
    messageId: msg.key.id,
    additionalNodes: [{ tag: 'biz', attrs: {}, content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }] }],
  });
  return msg;
}

const show = (id, p) => (id.startsWith('cmd:') ? p + id.slice(4) : id);
function toText(spec, p) {
  const out = [spec.body];
  for (const b of spec.buttons) {
    if (b.t === 'reply') out.push(`▫️ ${b.text} ➜ *${show(b.id, p)}*`);
    else if (b.t === 'url') out.push(`🔗 ${b.text}: ${b.url}`);
    else if (b.t === 'copy') out.push(`📋 ${b.text}: ${b.code}`);
    else for (const s of b.sections) { out.push(`\n*${s.title}*`); for (const r of s.rows) out.push(`▫️ *${show(r.id, p)}* — ${r.title}${r.desc ? ` _(${r.desc})_` : ''}`); }
  }
  if (spec.footer) out.push(`\n_${spec.footer}_`);
  return out.join('\n');
}

// c = command context. Falls back to text if buttons are disabled or the relay fails.
async function send(c, spec) {
  if (S.isOn(c.sid, 'buttons')) {
    try { return await sendInteractive(c.sock, c.chat, spec, c.raw); }
    catch (e) { log.warn({ err: e.message }, 'interactive send failed, using text fallback'); }
  }
  if (spec.image) { try { return await c.sock.sendMessage(c.chat, { image: { url: spec.image }, caption: toText(spec, c.prefix) }, { quoted: c.raw }); } catch { /* fall through */ } }
  return c.sock.sendMessage(c.chat, { text: toText(spec, c.prefix) }, { quoted: c.raw });
}

module.exports = { cmd, frame, line, btn, send, sendInteractive, toText };
