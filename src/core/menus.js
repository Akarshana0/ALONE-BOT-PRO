const cfg = require('../config');
const ui = require('./ui');
const S = require('./settings');
const I = require('./i18n');
const { fmtUptime } = require('./utils');
const { btn, cmd, frame, line } = ui;

const ICON = { main: '🤖', download: '📥', ai: '🧠', group: '🛡️', owner: '👑', tools: '⚙️', fun: '🎮', image: '🎨', info: '🌐' };
const loader = () => require('./commandLoader');
const byCat = (cat) => loader().list.filter((x) => x.category === cat).sort((a, b) => a.name.localeCompare(b.name));

function header(c) {
  const L = I.LANGS[c.lang];
  return frame(`🤖 ${cfg.botName.toUpperCase()}`, [
    `┃ ✨ ${c.t('greet', { name: c.pushName })}`,
    line('👑', c.t('lbl_owner'), cfg.ownerName),
    line('⚙️', c.t('lbl_prefix'), `[ ${c.prefix} ]`),
    line('⚡', c.t('lbl_mode'), c.t(S.isOn(c.sid, 'public') ? 'mode_public' : 'mode_private')),
    line('🌐', c.t('lbl_lang'), `${L.flag} ${L.native}`),
    line('🚀', c.t('lbl_uptime'), fmtUptime(process.uptime())),
    line('📦', c.t('lbl_commands'), loader().list.length),
  ].join('\n'));
}

async function mainMenu(c) {
  const rows = loader().CATS.map((k) => ({ title: c.t(`cat_${k}`), desc: c.t('cat_footer', { n: byCat(k).length }), id: cmd(`menu ${k}`) }));
  return ui.send(c, {
    title: `⚡ ${cfg.botName}`,
    image: cfg.bannerUrl || undefined,
    body: `${header(c)}\n\n${c.t('menu_pick')}`,
    buttons: [
      btn.list(c.t('menu_btn'), [{ title: `${cfg.botName} // MENU`, rows }]),
      btn.reply(c.t('settings_btn'), cmd('settings')),
      btn.url(`👑 ${cfg.ownerName}`, `https://wa.me/${cfg.ownerNumber}`),
    ],
  });
}

async function categoryMenu(c, cat) {
  const cmds = byCat(cat).filter((x) => !x.hidden);
  const descs = await Promise.all(cmds.map((x) => I.tr(c.lang, x.desc || '')));
  const body = cmds.map((x, i) => `▫️ *${c.prefix}${x.name}*${x.usage ? ` _${x.usage}_` : ''}\n   ↳ ${descs[i]}`).join('\n');
  const rows = cmds.slice(0, 100).map((x, i) => ({ title: `${c.prefix}${x.name}`, desc: descs[i].slice(0, 70), id: cmd(x.name) }));
  const sections = [];
  for (let i = 0; i < rows.length; i += 10) sections.push({ title: `${c.t(`cat_${cat}`)} ${Math.floor(i / 10) + 1}`, rows: rows.slice(i, i + 10) });
  return ui.send(c, {
    title: c.t(`cat_${cat}`),
    body: frame(c.t(`cat_${cat}`), body) + `\n${c.t('cat_footer', { n: cmds.length })}`,
    buttons: [btn.list(c.t('menu_btn'), sections.length ? sections : [{ title: '—', rows: [{ title: c.t('back_menu'), id: cmd('menu') }] }]), btn.reply(c.t('back_menu'), cmd('menu'))],
  });
}

async function allMenu(c) {
  let out = header(c) + '\n';
  for (const k of loader().CATS) {
    const names = byCat(k).filter((x) => !x.hidden).map((x) => `${c.prefix}${x.name}`).join(' • ');
    out += `\n${c.t(`cat_${k}`)}  _(${byCat(k).length})_\n${names}\n`;
  }
  return c.reply(out);
}

module.exports = { mainMenu, categoryMenu, allMenu, byCat, ICON };
