// i18n: static UI strings come from /locales/*.json, dynamic text (API results, descriptions) is machine-translated + cached
const fs = require('fs');
const path = require('path');
const { safeRequire } = require('./utils');

const LANGS = {
  en: { name: 'English', native: 'English', flag: '🇬🇧', ai: 'English' },
  si: { name: 'Sinhala', native: 'සිංහල', flag: '🇱🇰', ai: 'Sinhala (සිංහල)' },
  ar: { name: 'Arabic', native: 'العربية', flag: '🇸🇦', ai: 'Arabic (العربية)' },
  hi: { name: 'Hindi', native: 'हिन्दी', flag: '🇮🇳', ai: 'Hindi (हिन्दी)' },
};
const packs = {};
for (const l of Object.keys(LANGS)) packs[l] = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales', `${l}.json`), 'utf8'));

const t = (lang, key, vars = {}) => {
  const s = packs[lang]?.[key] ?? packs.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
};

const translator = safeRequire('google-translate-api-x');
const cache = new Map();
const tr = async (lang, text) => {
  if (!text || lang === 'en' || !translator || !LANGS[lang]) return text;
  const k = `${lang}|${text}`;
  if (cache.has(k)) return cache.get(k);
  try {
    const r = await translator(text, { to: lang });
    cache.set(k, r.text);
    if (cache.size > 5000) cache.delete(cache.keys().next().value);
    return r.text;
  } catch { return text; }
};

module.exports = { LANGS, t, tr };
