// Feature registry + per-session / per-group persistent toggles
const cfg = require('../config');
const { Setting, Group } = require('../database');

const FEATURES = [
  // session scope
  { key: 'buttons', scope: 'session', cat: 'ui', emoji: '🎛️', label: 'Interactive Buttons', def: true },
  { key: 'public', scope: 'session', cat: 'ui', emoji: '🌍', label: 'Public Mode', def: null },
  { key: 'antidelete', scope: 'session', cat: 'security', emoji: '🛡️', label: 'Anti-Delete (Global)', def: false },
  { key: 'vv', scope: 'session', cat: 'security', emoji: '👁️', label: 'View-Once Retriever', def: false },
  { key: 'anticall', scope: 'session', cat: 'security', emoji: '📵', label: 'Anti-Call', def: false },
  { key: 'autoread', scope: 'session', cat: 'automation', emoji: '✔️', label: 'Auto Read', def: false },
  { key: 'autotyping', scope: 'session', cat: 'automation', emoji: '⌨️', label: 'Auto Typing', def: false },
  { key: 'autorecording', scope: 'session', cat: 'automation', emoji: '🎙️', label: 'Auto Recording', def: false },
  { key: 'alwaysonline', scope: 'session', cat: 'automation', emoji: '🟢', label: 'Always Online', def: false },
  { key: 'autostatusview', scope: 'session', cat: 'automation', emoji: '📺', label: 'Auto Status View', def: false },
  { key: 'autostatusreact', scope: 'session', cat: 'automation', emoji: '💚', label: 'Auto Status React', def: false },
  { key: 'autodl', scope: 'session', cat: 'automation', emoji: '📥', label: 'Auto Link Downloader', def: true },
  { key: 'autoreact', scope: 'session', cat: 'automation', emoji: '😎', label: 'Auto React', def: false },
  { key: 'chatbot', scope: 'session', cat: 'ai', emoji: '🤖', label: 'AI Chatbot (DM auto-reply)', def: false },
  // group scope
  { key: 'welcome', scope: 'group', cat: 'group', emoji: '👋', label: 'Welcome Card', def: false },
  { key: 'goodbye', scope: 'group', cat: 'group', emoji: '🚪', label: 'Goodbye Card', def: false },
  { key: 'antilink', scope: 'group', cat: 'group', emoji: '🔗', label: 'Anti-Link', def: false },
  { key: 'antibadword', scope: 'group', cat: 'group', emoji: '🤬', label: 'Anti-BadWord', def: false },
  { key: 'antibot', scope: 'group', cat: 'group', emoji: '🦾', label: 'Anti-Bot', def: false },
  { key: 'antispam', scope: 'group', cat: 'group', emoji: '🚫', label: 'Anti-Spam', def: false },
  { key: 'adminonly', scope: 'group', cat: 'group', emoji: '🛡️', label: 'Admin-Only Commands', def: false },
];
const CAT_TITLES = { ui: '🎛️ Interface', security: '🛡️ Security', automation: '⚡ Automation', ai: '🧠 AI', group: '👥 Group' };
const feat = (k) => FEATURES.find((f) => f.key === k);

const cache = new Map();
const gcache = new Map();

async function init(sid) {
  let d = await Setting.findOne({ sid }).lean();
  if (!d) d = (await Setting.create({ sid, features: {} })).toObject();
  cache.set(sid, d);
  return d;
}
const prefix = (sid) => cache.get(sid)?.prefix || cfg.prefix;
async function setPrefix(sid, p) { const d = cache.get(sid) || (await init(sid)); d.prefix = p; await Setting.updateOne({ sid }, { $set: { prefix: p } }); }

function isOn(sid, key) {
  const v = cache.get(sid)?.features?.[key];
  if (v !== undefined) return !!v;
  if (key === 'public') return sid === cfg.mainSession;
  return !!feat(key)?.def;
}
async function setFeature(sid, key, val) {
  const d = cache.get(sid) || (await init(sid));
  d.features = { ...(d.features || {}), [key]: !!val };
  await Setting.updateOne({ sid }, { $set: { [`features.${key}`]: !!val } });
}

async function group(sid, jid) {
  const k = `${sid}:${jid}`;
  if (gcache.has(k)) return gcache.get(k);
  let d = await Group.findOne({ sid, jid }).lean();
  if (!d) d = (await Group.create({ sid, jid, features: {}, warns: {} })).toObject();
  d.features ||= {}; d.warns ||= {};
  gcache.set(k, d);
  return d;
}
const groupOn = (g, key) => !!g?.features?.[key];
async function setGroupFeature(sid, jid, key, val) {
  const g = await group(sid, jid); g.features[key] = !!val;
  await Group.updateOne({ sid, jid }, { $set: { [`features.${key}`]: !!val } });
}
async function setGroupField(sid, jid, field, val) {
  const g = await group(sid, jid); g[field] = val;
  await Group.updateOne({ sid, jid }, { $set: { [field]: val } });
}
async function setWarn(sid, jid, number, n) {
  const g = await group(sid, jid); g.warns[number] = n;
  await Group.updateOne({ sid, jid }, { $set: { [`warns.${number}`]: n } });
}

module.exports = { FEATURES, CAT_TITLES, feat, init, prefix, setPrefix, isOn, setFeature, group, groupOn, setGroupFeature, setGroupField, setWarn };
