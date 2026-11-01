const os = require('os');
const cfg = require('../config');
const S = require('../core/settings');
const I = require('../core/i18n');
const ui = require('../core/ui');
const users = require('../core/users');
const menus = require('../core/menus');
const sessions = require('../session/manager');
const { fmtUptime, bytes, num } = require('../core/utils');
const { btn, cmd, frame, line } = ui;
const loader = () => require('../core/commandLoader');

const canSet = (c) => c.isOwner || c.isSelf;

async function dashboard(c) {
  const rows = { ui: [], security: [], automation: [], ai: [], group: [] };
  const lines = [];
  for (const f of S.FEATURES) {
    if (f.scope === 'group' && !c.isGroup) continue;
    const on = f.scope === 'group' ? S.groupOn(c.group, f.key) : S.isOn(c.sid, f.key);
    rows[f.cat].push({ title: `${on ? '🟢' : '🔴'} ${f.emoji} ${f.label}`, desc: c.t(on ? 'on' : 'off'), id: cmd(`set ${f.key}`) });
    lines.push(`┃ ${on ? '🟢' : '🔴'} ${f.emoji} ${f.label} — *${c.t(on ? 'on' : 'off')}*`);
  }
  if (c.sid === cfg.mainSession) lines.push(`┃ 🔒 👑 VIP Owner Anti-Delete — *${c.t('on')}* (${c.t('locked')})`);
  const sections = Object.entries(rows).filter(([, r]) => r.length).map(([k, r]) => ({ title: S.CAT_TITLES[k], rows: r }));
  return ui.send(c, {
    title: c.t('settings_title'),
    body: `${frame(c.t('settings_title'), lines.join('\n'))}\n\n${c.t('settings_body')}${c.isGroup ? '' : `\n${c.t('group_hint')}`}`,
    buttons: [btn.list('⚙️ Features', sections), btn.reply('🟢 ALL ON', cmd('set all on')), btn.reply('🔴 ALL OFF', cmd('set all off')), btn.reply(c.t('back_menu'), cmd('menu'))],
  });
}

module.exports = [
  { name: 'menu', aliases: ['start', 'commands'], category: 'main', desc: 'Open the main menu', usage: '[category]', run: async (c) => {
    const k = (c.args[0] || '').toLowerCase();
    return loader().CATS.includes(k) ? menus.categoryMenu(c, k) : menus.mainMenu(c);
  } },
  { name: 'allmenu', aliases: ['listcmd', 'cmds'], category: 'main', desc: 'Show every command in one list', run: (c) => menus.allMenu(c) },
  { name: 'help', aliases: ['h'], category: 'main', desc: 'Help for a specific command', usage: '<command>', run: async (c) => {
    const x = loader().get((c.args[0] || '').toLowerCase());
    if (!x) return menus.mainMenu(c);
    return c.reply(frame(`❓ ${c.prefix}${x.name}`, [`┃ 📝 ${await c.tr(x.desc)}`, `┃ 🧩 ${c.prefix}${x.name} ${x.usage || ''}`, x.aliases.length ? `┃ 🔁 ${x.aliases.map((a) => c.prefix + a).join(', ')}` : ''].filter(Boolean).join('\n')));
  } },
  { name: 'ping', aliases: ['speed', 'latency'], category: 'main', desc: 'Check bot latency', run: async (c) => {
    const t = Date.now(); const m = await c.reply('🏓 …');
    return c.sock.sendMessage(c.chat, { text: frame('⚡ PING', `┃ 🚀 ${Date.now() - t} ms`), edit: m.key });
  } },
  { name: 'alive', aliases: ['bot', 'online'], category: 'main', desc: 'Check that the bot is online', run: (c) => c.reply(frame(`🤖 ${cfg.botName}`, `┃ ${c.t('alive')}\n${line('🚀', c.t('lbl_uptime'), fmtUptime(process.uptime()))}`)) },
  { name: 'uptime', aliases: ['runtime'], category: 'main', desc: 'How long the bot has been running', run: (c) => c.reply(`🚀 ${fmtUptime(process.uptime())}`) },
  { name: 'owner', aliases: ['creator', 'dev'], category: 'main', desc: 'Send the owner contact card', run: (c) => c.send({ contacts: { displayName: cfg.ownerName, contacts: [{ vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${cfg.ownerName}\nORG:${cfg.botName};\nTEL;type=CELL;type=VOICE;waid=${cfg.ownerNumber}:+${cfg.ownerNumber}\nEND:VCARD` }] } }) },
  { name: 'about', aliases: ['botinfo', 'info'], category: 'main', desc: 'About this bot', run: (c) => c.reply(frame(`🤖 ${cfg.botName}`, [line('👑', c.t('lbl_owner'), cfg.ownerName), line('📦', c.t('lbl_commands'), loader().list.length), line('🧠', 'Engine', 'Baileys / Node ' + process.version), line('🌐', 'Languages', 'EN • සිං • عربي • हिन्दी'), line('🛡️', 'VIP', 'Owner Anti-Delete • Remote Disconnect')].join('\n'))) },
  { name: 'stats', aliases: ['status'], category: 'main', desc: 'System and session statistics', run: (c) => {
    const m = process.memoryUsage();
    return c.reply(frame('📊 STATS', [line('🧠', 'RAM', bytes(m.rss)), line('💻', 'Host', `${os.platform()} ${os.cpus().length} cpu`), line('🔌', 'Sessions', sessions.registry.size), line('📦', c.t('lbl_commands'), loader().list.length), line('🚀', c.t('lbl_uptime'), fmtUptime(process.uptime()))].join('\n')));
  } },
  { name: 'language', aliases: ['lang', 'setlang'], category: 'main', desc: 'Choose your reply language (EN / SI / AR / HI)', usage: '[en|si|ar|hi]', run: async (c) => {
    const code = (c.args[0] || '').toLowerCase();
    if (I.LANGS[code]) {
      await users.update(c.senderNumber, { lang: code });
      c.lang = code;
      await c.reply(I.t(code, 'lang_saved', { lang: I.LANGS[code].native }));
      return menus.mainMenu(c);
    }
    const rows = Object.entries(I.LANGS).map(([k, v]) => ({ title: `${v.flag} ${v.native}`, desc: v.name, id: cmd(`setlang ${k}`) }));
    return ui.send(c, { title: I.t('en', 'lang_title'), body: `${frame(I.t('en', 'lang_title'), I.t('en', 'lang_body', { bot: cfg.botName, p: c.prefix }))}\n\n${I.t('si', 'lang_title')} • ${I.t('ar', 'lang_title')} • ${I.t('hi', 'lang_title')}`, buttons: [btn.list(I.t('en', 'lang_btn'), [{ title: '🌐 Languages', rows }])] });
  } },
  { name: 'settings', aliases: ['setting', 'dashboard', 'config'], category: 'main', desc: 'Settings dashboard — toggle every feature ON/OFF', run: async (c) => (canSet(c) ? dashboard(c) : c.reply(c.t('owner_only'))) },
  { name: 'set', aliases: ['toggle'], category: 'main', desc: 'Turn a feature ON/OFF', usage: '<feature|all> [on|off]', need: true, run: async (c) => {
    if (!canSet(c)) return c.reply(c.t('owner_only'));
    const [key, val] = [c.args[0].toLowerCase(), (c.args[1] || '').toLowerCase()];
    if (key === 'all') {
      if (!/^(on|off)$/.test(val)) return c.reply(c.t('usage', { usage: `${c.prefix}set all on|off` }));
      for (const f of S.FEATURES) {
        if (f.scope === 'group') { if (c.isGroup) await S.setGroupFeature(c.sid, c.chat, f.key, val === 'on'); }
        else if (f.key !== 'public' || c.sid === cfg.mainSession) await S.setFeature(c.sid, f.key, val === 'on');
      }
      return dashboard(c);
    }
    const f = S.feat(key);
    if (!f) return dashboard(c);
    if (f.scope === 'group' && !c.isGroup) return c.reply(c.t('group_hint'));
    if (!/^(on|off)$/.test(val)) {
      const now = f.scope === 'group' ? S.groupOn(c.group, key) : S.isOn(c.sid, key);
      return ui.send(c, { title: `${f.emoji} ${f.label}`, body: frame(`${f.emoji} ${f.label}`, `┃ ${now ? '🟢' : '🔴'} *${c.t(now ? 'on' : 'off')}*`), buttons: [btn.reply(`✅ ${c.t('on')}`, cmd(`set ${key} on`)), btn.reply(`⛔ ${c.t('off')}`, cmd(`set ${key} off`)), btn.reply(c.t('settings_btn'), cmd('settings'))] });
    }
    if (f.scope === 'group') await S.setGroupFeature(c.sid, c.chat, key, val === 'on'); else await S.setFeature(c.sid, key, val === 'on');
    await c.reply(c.t('toggled', { emoji: f.emoji, label: f.label, state: c.t(val === 'on' ? 'on' : 'off') }));
    return dashboard(c);
  } },
  { name: 'connect', aliases: ['pair'], category: 'main', desc: 'Link your own WhatsApp account to this bot (pairing code)', usage: '<number with country code>', run: async (c) => {
    if (c.sid !== cfg.mainSession) return;
    if (!cfg.allowPublicLink && !c.isOwner) return c.reply(c.t('owner_only'));
    const n = (c.args[0] || '').replace(/\D/g, '');
    if (n.length < 8 || n.length > 15) return c.reply(c.t('connect_bad'));
    await c.reply(c.t('connect_notice'));
    const r = await sessions.connectUser(n, c.senderNumber);
    if (r.exists) return c.reply(c.t('connect_exists'));
    if (r.full) return c.reply(c.t('connect_limit'));
    return ui.send(c, { title: '🔐 PAIRING', body: frame('🔐 PAIRING', c.t('connect_code', { code: r.code })), buttons: [btn.copy('📋 Copy code', r.code.replace(/-/g, ''))] });
  } },
  { name: 'logout', aliases: ['unlink'], category: 'main', desc: 'Unlink your linked WhatsApp session', usage: '', anySession: true, run: async (c) => {
    if (c.sid === cfg.mainSession) { if (!c.isOwner) return c.reply(c.t('owner_only')); if (c.args[0] !== 'confirm') return c.reply(c.t('usage', { usage: `${c.prefix}logout confirm` })); }
    else if (!c.isSelf && !c.isOwner) return;
    await c.reply(c.t('logout_ok'));
    return sessions.revoke(c.sid);
  } },
  { name: 'mysession', aliases: ['session'], category: 'main', desc: 'Show this session', run: (c) => { const s = c.session; return c.reply(frame('🔌 SESSION', [line('🆔', 'ID', s.sid), line('📱', 'Number', `+${s.number || '?'}`), line('🚀', c.t('lbl_uptime'), fmtUptime((Date.now() - s.startedAt) / 1000))].join('\n'))); } },
  { name: 'id', aliases: ['jid'], category: 'main', desc: 'Show chat and sender JIDs', run: (c) => c.reply(`💬 ${c.chat}\n👤 ${c.sender}`) },
  { name: 'whoami', aliases: ['me'], category: 'main', desc: 'Your profile with the bot', run: async (c) => { const u = await users.get(c.senderNumber); return c.reply(frame('👤 ME', [line('📱', 'Number', `+${c.senderNumber}`), line('🌐', c.t('lbl_lang'), I.LANGS[u.lang || cfg.defaultLang].native), line('📦', c.t('lbl_commands'), u.commands || 0), line('👑', 'Owner', c.isOwner ? '✅' : '❌')].join('\n'))); } },
  { name: 'prefix', category: 'main', desc: 'Show the current prefix', run: (c) => c.reply(`⚙️ ${c.t('lbl_prefix')}: *${c.prefix}*`) },
  { name: 'report', aliases: ['bug', 'feedback'], category: 'main', desc: 'Send a report to the owner', usage: '<message>', need: true, run: async (c) => { await c.sock.sendMessage(`${cfg.ownerNumber}@s.whatsapp.net`, { text: `📨 *REPORT* from @${c.senderNumber}\n\n${c.input}`, mentions: [c.sender] }); return c.reply(c.t('done')); } },
  { name: 'support', aliases: ['contact'], category: 'main', desc: 'Contact the owner', run: (c) => ui.send(c, { title: '💬 SUPPORT', body: frame('💬 SUPPORT', `┃ 👑 ${cfg.ownerName}`), buttons: [btn.url(`👑 ${cfg.ownerName}`, `https://wa.me/${cfg.ownerNumber}`)] }) },
];
