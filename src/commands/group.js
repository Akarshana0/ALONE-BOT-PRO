const S = require('../core/settings');
const ui = require('../core/ui');
const mod = require('../core/moderation');
const cfg = require('../core/../config');
const { num } = require('../core/utils');
const { frame, line } = ui;

const G = { category: 'group', group: true };
const A = { ...G, admin: true, botAdmin: true };
const targets = (c) => {
  const m = c.mentionedJids();
  if (m.length) return m;
  if (c.quoted?.participant) return [c.quoted.participant];
  return c.args.map((a) => a.replace(/\D/g, '')).filter((a) => a.length >= 7).map((a) => `${a}@s.whatsapp.net`);
};
const members = (c) => (c.groupMeta?.participants || []).map((p) => p.phoneNumber || p.id);
const act = (name, aliases, desc, action) => ({ ...A, name, aliases, desc, usage: '<@user|reply|number>', run: async (c) => {
  const t = targets(c); if (!t.length) return c.reply(c.t('no_input'));
  await c.sock.groupParticipantsUpdate(c.chat, t, action);
  return c.reply(c.t('done'));
} });
const toggle = (key, desc) => ({ ...G, admin: true, name: key, desc, usage: '<on|off>', run: async (c) => {
  const v = (c.args[0] || '').toLowerCase();
  if (!/^(on|off)$/.test(v)) return require('../core/commandLoader').get('set').run({ ...c, args: [key] });
  await S.setGroupFeature(c.sid, c.chat, key, v === 'on');
  const f = S.feat(key);
  return c.reply(c.t('toggled', { emoji: f.emoji, label: f.label, state: c.t(v) }));
} });

module.exports = [
  act('kick', ['remove'], 'Remove a member', 'remove'),
  act('add', [], 'Add a member by number', 'add'),
  act('promote', ['makeadmin'], 'Promote to admin', 'promote'),
  act('demote', ['removeadmin'], 'Demote an admin', 'demote'),
  { ...A, name: 'mute', aliases: ['close'], desc: 'Only admins can send messages', run: async (c) => { await c.sock.groupSettingUpdate(c.chat, 'announcement'); return c.reply('🔇'); } },
  { ...A, name: 'unmute', aliases: ['open'], desc: 'Everyone can send messages', run: async (c) => { await c.sock.groupSettingUpdate(c.chat, 'not_announcement'); return c.reply('🔊'); } },
  { ...A, name: 'lock', desc: 'Only admins can edit group info', run: async (c) => { await c.sock.groupSettingUpdate(c.chat, 'locked'); return c.reply('🔒'); } },
  { ...A, name: 'unlock', desc: 'Everyone can edit group info', run: async (c) => { await c.sock.groupSettingUpdate(c.chat, 'unlocked'); return c.reply('🔓'); } },
  { ...G, admin: true, name: 'tagall', aliases: ['everyone', 'mentionall'], desc: 'Mention every member', usage: '[message]', run: async (c) => {
    const m = members(c);
    return c.send({ text: frame('📣 TAG ALL', `┃ ${c.input || '⚡'}\n${m.map((j) => `┃ @${num(j)}`).join('\n')}`), mentions: m });
  } },
  { ...G, admin: true, name: 'hidetag', aliases: ['tag', 'announce'], desc: 'Mention everyone silently', usage: '<message>', need: true, run: (c) => c.send({ text: c.input, mentions: members(c) }) },
  { ...G, admin: true, name: 'tagadmins', aliases: ['admins'], desc: 'List / mention group admins', run: (c) => {
    const a = (c.groupMeta?.participants || []).filter((p) => p.admin).map((p) => p.phoneNumber || p.id);
    return c.send({ text: frame('🛡️ ADMINS', a.map((j) => `┃ @${num(j)}`).join('\n')), mentions: a });
  } },
  { ...A, name: 'link', aliases: ['grouplink', 'invite'], desc: 'Get the group invite link', run: async (c) => c.reply(`🔗 https://chat.whatsapp.com/${await c.sock.groupInviteCode(c.chat)}`) },
  { ...A, name: 'revokelink', aliases: ['resetlink'], desc: 'Reset the group invite link', run: async (c) => { await c.sock.groupRevokeInvite(c.chat); return c.reply(c.t('done')); } },
  { ...A, name: 'gname', aliases: ['setgname'], desc: 'Change the group name', usage: '<name>', need: true, run: async (c) => { await c.sock.groupUpdateSubject(c.chat, c.input.slice(0, 90)); return c.reply(c.t('done')); } },
  { ...A, name: 'gdesc', aliases: ['setdesc'], desc: 'Change the group description', usage: '<text>', need: true, run: async (c) => { await c.sock.groupUpdateDescription(c.chat, c.input); return c.reply(c.t('done')); } },
  { ...A, name: 'gpp', aliases: ['setgpp'], desc: 'Change the group picture (reply to an image)', run: async (c) => { const m = await c.getMedia(); if (!m || m.type !== 'image') return c.reply(c.t('reply_media')); await c.sock.updateProfilePicture(c.chat, m.buffer); return c.reply(c.t('done')); } },
  { ...G, name: 'ginfo', aliases: ['groupinfo'], desc: 'Show group information', run: (c) => {
    const m = c.groupMeta; if (!m) return c.reply(c.t('not_found'));
    return c.reply(frame('👥 GROUP', [line('📛', 'Name', m.subject), line('👤', 'Members', m.participants.length), line('🛡️', 'Admins', m.participants.filter((p) => p.admin).length), line('📅', 'Created', new Date(m.creation * 1000).toLocaleDateString('en-GB')), m.desc ? `┃ 📝 ${m.desc.slice(0, 200)}` : ''].filter(Boolean).join('\n')));
  } },
  toggle('welcome', 'Welcome card for new members'),
  toggle('goodbye', 'Goodbye card for leavers'),
  toggle('antilink', 'Delete links + warn'),
  toggle('antibadword', 'Delete bad words + warn'),
  toggle('antibot', 'Remove other bots'),
  toggle('antispam', 'Flood protection'),
  toggle('adminonly', 'Only admins can use commands'),
  { ...G, admin: true, name: 'setwelcome', desc: 'Custom welcome text ({user} {group})', usage: '<text>', need: true, run: async (c) => { await S.setGroupField(c.sid, c.chat, 'welcomeMsg', c.input); return c.reply(c.t('done')); } },
  { ...G, admin: true, name: 'setgoodbye', desc: 'Custom goodbye text ({user} {group})', usage: '<text>', need: true, run: async (c) => { await S.setGroupField(c.sid, c.chat, 'goodbyeMsg', c.input); return c.reply(c.t('done')); } },
  { ...A, name: 'warn', desc: 'Warn a member (3 warns = removed)', usage: '<@user|reply> [reason]', run: async (c) => { const t = targets(c)[0]; if (!t) return c.reply(c.t('no_input')); return mod.warnUser(c, t, c.args.slice(1).join(' ') || '—'); } },
  { ...G, admin: true, name: 'resetwarn', aliases: ['unwarn'], desc: 'Reset warnings of a member', usage: '<@user|reply>', run: async (c) => { const t = targets(c)[0]; if (!t) return c.reply(c.t('no_input')); await S.setWarn(c.sid, c.chat, num(t), 0); return c.reply(c.t('done')); } },
  { ...G, name: 'warnings', aliases: ['warns'], desc: 'Show warnings in this group', run: async (c) => {
    const w = Object.entries((await S.group(c.sid, c.chat)).warns).filter(([, v]) => v > 0);
    return c.reply(frame('⚠️ WARNINGS', w.map(([k, v]) => `┃ +${k}: ${v}/${cfg.maxWarns}`).join('\n') || '┃ ✅'));
  } },
  { ...A, name: 'ephemeral', aliases: ['disappear'], desc: 'Disappearing messages', usage: '<off|24h|7d|90d>', need: true, run: async (c) => {
    const m = { off: 0, '24h': 86400, '7d': 604800, '90d': 7776000 }[c.args[0].toLowerCase()];
    if (m === undefined) return c.reply(c.t('usage', { usage: `${c.prefix}ephemeral off|24h|7d|90d` }));
    await c.sock.groupToggleEphemeral(c.chat, m); return c.reply(c.t('done'));
  } },
  { ...G, name: 'poll', desc: 'Create a poll', usage: 'question | option1 | option2 …', need: true, run: async (c) => {
    const [q, ...o] = c.input.split('|').map((s) => s.trim()).filter(Boolean);
    if (o.length < 2) return c.reply(c.t('usage', { usage: `${c.prefix}poll Question | A | B` }));
    return c.send({ poll: { name: q, values: o.slice(0, 12), selectableCount: 1 } });
  } },
];
