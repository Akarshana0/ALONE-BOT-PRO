const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const cfg = require('../config');
const S = require('../core/settings');
const store = require('../core/store');
const ui = require('../core/ui');
const sessions = require('../session/manager');
const { User, Session, Stored } = require('../database');
const { fmtUptime, sleep, num, bytes } = require('../core/utils');
const { frame, line } = ui;

const O = { category: 'owner', owner: true };
const jidOf = (c) => (c.mentionedJids()[0] || c.quoted?.participant || (c.args[0] ? `${c.args[0].replace(/\D/g, '')}@s.whatsapp.net` : null));

module.exports = [
  // ───── VIP: remote disconnect ─────
  { ...O, name: 'disconnect', aliases: ['revoke', 'dc', 'kickdevice'], desc: '👑 VIP: revoke a linked session and unlink that WhatsApp instantly', usage: '<sessionId | number | all>', need: true, run: async (c) => {
    const sids = sessions.resolve(c.args[0] === 'main' ? 'main' : c.args[0]);
    const list = c.args[0] === 'main' ? ['main'] : sids;
    if (!list.length) return c.reply(c.t('disc_none'));
    const done = [];
    for (const sid of list) { const s = sessions.get(sid); done.push(`${sid}${s?.number ? ` (+${s.number})` : ''}`); await sessions.revoke(sid, c.t('revoked_notice')); }
    return c.reply(frame('🔌 DISCONNECT', c.t('disc_ok', { list: done.join(', ') })));
  } },
  { ...O, name: 'sessions', aliases: ['linked', 'devices'], desc: 'List all connected sessions', run: async (c) => {
    const rows = [...sessions.registry.values()].map((s) => `┃ ${s.ready ? '🟢' : '🟡'} *${s.sid}* — +${s.number || '?'} — ${fmtUptime((Date.now() - s.startedAt) / 1000)}${s.requestedBy ? ` — by ${s.requestedBy}` : ''}`);
    return c.reply(frame('🔌 SESSIONS', rows.join('\n') || '┃ —'));
  } },
  // ───── VIP: delete-for-everyone override ─────
  { name: 'del', aliases: ['delete', 'unsend', 'rm'], category: 'owner', desc: '👑 VIP: delete a replied message for everyone (forced)', anySession: true, run: async (c) => {
    if (!(c.isOwner || c.isSelf || (c.isGroup && c.isAdmin && c.isBotAdmin))) return c.reply(c.t('owner_only'));
    if (!c.quoted) return c.reply(c.t('reply_media'));
    const q = c.quoted;
    await c.sock.sendMessage(c.chat, { delete: { remoteJid: c.chat, fromMe: q.fromMe, id: q.id, participant: c.isGroup ? q.participant : undefined } });
    return c.sock.sendMessage(c.chat, { delete: c.raw.key }).catch(() => {});
  } },
  { ...O, name: 'purge', aliases: ['wipe'], desc: '👑 VIP: delete my last N sent messages in this chat for everyone', usage: '[1-50]', run: async (c) => {
    const n = Math.min(50, Math.max(1, parseInt(c.args[0] || '5', 10)));
    for (const k of store.lastSent(c.sid, c.chat, n)) { await c.sock.sendMessage(c.chat, { delete: k }).catch(() => {}); await sleep(450); }
  } },
  // ───── messaging ─────
  { ...O, name: 'broadcast', aliases: ['bc'], desc: 'Message every known user (DM)', usage: '<text>', need: true, run: async (c) => {
    const us = await User.find({}).select('number').lean(); let ok = 0;
    for (const u of us) { if (u.number === c.senderNumber) continue; try { await c.sock.sendMessage(`${u.number}@s.whatsapp.net`, { text: frame('📢 BROADCAST', c.input) }); ok++; } catch { /* skip */ } await sleep(1500); }
    return c.reply(`✅ ${ok}/${us.length}`);
  } },
  { ...O, name: 'bcgroups', aliases: ['bcgc'], desc: 'Message every group', usage: '<text>', need: true, run: async (c) => {
    const gs = Object.keys(await c.sock.groupFetchAllParticipating()); let ok = 0;
    for (const g of gs) { try { await c.sock.sendMessage(g, { text: frame('📢 BROADCAST', c.input) }); ok++; } catch { /* skip */ } await sleep(2000); }
    return c.reply(`✅ ${ok}/${gs.length}`);
  } },
  // ───── users ─────
  { ...O, name: 'block', desc: 'Block a user', usage: '<@user|reply|number>', run: async (c) => { const j = jidOf(c) || (!c.isGroup && c.chat); if (!j) return c.reply(c.t('no_input')); await c.sock.updateBlockStatus(j, 'block'); return c.reply(c.t('done')); } },
  { ...O, name: 'unblock', desc: 'Unblock a user', usage: '<@user|reply|number>', run: async (c) => { const j = jidOf(c) || (!c.isGroup && c.chat); if (!j) return c.reply(c.t('no_input')); await c.sock.updateBlockStatus(j, 'unblock'); return c.reply(c.t('done')); } },
  { ...O, name: 'blocklist', desc: 'Show blocked contacts', run: async (c) => { const l = await c.sock.fetchBlocklist(); return c.reply(l.length ? l.map((j) => `• +${num(j)}`).join('\n') : c.t('not_found')); } },
  { ...O, name: 'banuser', aliases: ['ban'], desc: 'Ban a user from using the bot', usage: '<@user|reply|number>', run: async (c) => { const j = jidOf(c); if (!j) return c.reply(c.t('no_input')); await require('../core/users').update(num(j), { banned: true }); return c.reply(c.t('done')); } },
  { ...O, name: 'unbanuser', aliases: ['unban'], desc: 'Unban a user', usage: '<@user|reply|number>', run: async (c) => { const j = jidOf(c); if (!j) return c.reply(c.t('no_input')); await require('../core/users').update(num(j), { banned: false }); return c.reply(c.t('done')); } },
  { ...O, name: 'banlist', desc: 'List banned users', run: async (c) => { const l = await User.find({ banned: true }).lean(); return c.reply(l.length ? l.map((u) => `• +${u.number}`).join('\n') : c.t('not_found')); } },
  // ───── bot control ─────
  { ...O, name: 'mode', desc: 'Switch Public/Private mode', usage: '<public|private>', need: true, run: async (c) => { await S.setFeature(c.sid, 'public', /^pub/i.test(c.args[0])); return c.reply(c.t('done')); } },
  { ...O, name: 'setprefix', desc: 'Change the command prefix', usage: '<symbol>', need: true, run: async (c) => { await S.setPrefix(c.sid, c.args[0].slice(0, 2)); return c.reply(`${c.t('done')} ➜ ${c.args[0].slice(0, 2)}`); } },
  { ...O, name: 'restart', aliases: ['reboot'], desc: 'Restart the bot (Heroku restarts the dyno)', run: async (c) => { await c.reply('♻️ …'); setTimeout(() => process.exit(0), 800); } },
  { ...O, name: 'clearcache', desc: 'Clear the in-memory message cache', run: (c) => { store.clear(); return c.reply(c.t('done')); } },
  { ...O, name: 'dbstats', desc: 'Database & vault statistics', run: async (c) => c.reply(frame('🗄️ DB', [line('👥', 'Users', await User.countDocuments()), line('🔌', 'Sessions', await Session.countDocuments()), line('🛡️', 'Vault (3d)', await Stored.countDocuments()), line('🧠', 'LRU', `${store.stats().entries} / ${bytes(store.stats().bytes)}`)].join('\n'))) },
  { ...O, name: 'vip', desc: 'Show VIP protection status', run: async (c) => {
    const me = num(jidNormalizedUser(c.sock.user.id));
    const ownerPaired = c.sid === cfg.mainSession && me === cfg.ownerNumber;
    return c.reply(frame('👑 VIP STATUS', [line('🛡️', 'Owner Anti-Delete', ownerPaired ? '🟢 ACTIVE (always on)' : '🟡 inactive — pair the owner number as MAIN session'), line('🗑️', 'Delete override', '🟢 .del / .purge'), line('🔌', 'Remote disconnect', '🟢 .disconnect'), line('📱', 'Main account', `+${me}`)].join('\n')));
  } },
  // ───── groups & profile ─────
  { ...O, name: 'join', desc: 'Join a group by invite link', usage: '<chat.whatsapp.com link>', need: true, run: async (c) => { const m = c.input.match(/chat\.whatsapp\.com\/([\w-]+)/); if (!m) return c.reply(c.t('no_input')); await c.sock.groupAcceptInvite(m[1]); return c.reply(c.t('done')); } },
  { ...O, name: 'leave', aliases: ['leavegc'], desc: 'Make the bot leave this group', group: true, run: async (c) => { await c.reply('👋'); return c.sock.groupLeave(c.chat); } },
  { ...O, name: 'groups', aliases: ['gclist'], desc: 'List all groups the bot is in', run: async (c) => { const g = Object.values(await c.sock.groupFetchAllParticipating()); return c.reply(frame(`👥 GROUPS (${g.length})`, g.map((x, i) => `┃ ${i + 1}. ${x.subject} (${x.participants.length})`).join('\n') || '┃ —')); } },
  { ...O, name: 'setbio', aliases: ['setstatus'], desc: 'Change the bot account bio', usage: '<text>', need: true, run: async (c) => { await c.sock.updateProfileStatus(c.input); return c.reply(c.t('done')); } },
  { ...O, name: 'setname', aliases: ['setbotname'], desc: 'Change the bot account name', usage: '<text>', need: true, run: async (c) => { await c.sock.updateProfileName(c.input); return c.reply(c.t('done')); } },
  { ...O, name: 'setpp', aliases: ['setbotpp'], desc: 'Change the bot profile picture (reply to an image)', run: async (c) => { const m = await c.getMedia(); if (!m || m.type !== 'image') return c.reply(c.t('reply_media')); await c.sock.updateProfilePicture(c.sock.user.id, m.buffer); return c.reply(c.t('done')); } },
  { ...O, name: 'getpp', aliases: ['pp'], desc: 'Get a profile picture', usage: '<@user|reply>', anySession: true, run: async (c) => { const j = jidOf(c) || c.sender; try { return c.send({ image: { url: await c.sock.profilePictureUrl(j, 'image') }, caption: `+${num(j)}` }); } catch { return c.reply(c.t('not_found')); } } },
];
