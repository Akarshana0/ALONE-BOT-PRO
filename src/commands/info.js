const { getJson, http } = require('../core/utils');
const { frame, line } = require('../core/ui');
const cfg = require('../config');

const N = [];
const base = { category: 'info', need: true };
const add = (name, aliases, desc, usage, run) => N.push({ ...base, name, aliases, desc, usage, run });

add('weather', ['wttr', 'forecast'], 'Weather for a city', '<city>', async (c) => {
  const d = await getJson(`https://wttr.in/${encodeURIComponent(c.input)}?format=j1`);
  const n = d.current_condition[0]; const a = d.nearest_area?.[0];
  return c.reply(frame(`🌦️ ${a?.areaName?.[0]?.value || c.input}`, [line('🌡️', 'Temp', `${n.temp_C}°C (feels ${n.FeelsLikeC}°C)`), line('☁️', 'Sky', n.weatherDesc[0].value), line('💧', 'Humidity', `${n.humidity}%`), line('💨', 'Wind', `${n.windspeedKmph} km/h`), line('🌅', 'UV', n.uvIndex)].join('\n')));
});
add('time', ['clock'], 'Current time in a time zone', '<Region/City>  e.g. Asia/Colombo', (c) => {
  try { return c.reply(`🕒 ${new Date().toLocaleString('en-GB', { timeZone: c.input, dateStyle: 'full', timeStyle: 'medium' })}\n📍 ${c.input}`); } catch { return c.reply('⚠️ e.g. Asia/Colombo, Asia/Dubai, Europe/London'); }
});
add('crypto', ['price'], 'Crypto price (CoinGecko id, e.g. bitcoin)', '<coin>', async (c) => {
  const id = c.input.toLowerCase(); const d = (await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd,lkr,aed&include_24hr_change=true`))[id];
  return d ? c.reply(frame(`🪙 ${id.toUpperCase()}`, [line('💵', 'USD', d.usd.toLocaleString()), line('🇱🇰', 'LKR', d.lkr?.toLocaleString()), line('🇦🇪', 'AED', d.aed?.toLocaleString()), line('📈', '24h', `${d.usd_24h_change?.toFixed(2)}%`)].join('\n'))) : c.reply(c.t('not_found'));
});
add('currency', ['convert', 'fx'], 'Convert currency', '<amount> <FROM> <TO>', async (c) => {
  const [amt, from, to] = c.args; if (!to) return c.reply(c.t('usage', { usage: `${c.prefix}currency 100 USD LKR` }));
  const d = await getJson(`https://api.frankfurter.app/latest?amount=${amt}&from=${from.toUpperCase()}&to=${to.toUpperCase()}`);
  return c.reply(`💱 ${amt} ${from.toUpperCase()} = *${d.rates[to.toUpperCase()]} ${to.toUpperCase()}*`);
});
add('wiki', ['wikipedia'], 'Wikipedia summary', '<topic>', async (c) => {
  const lang = ['si', 'ar', 'hi'].includes(c.lang) ? c.lang : 'en';
  let d; try { d = await getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(c.input)}`); } catch { d = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(c.input)}`); }
  const cap = frame(`📚 ${d.title}`, `┃ ${d.extract?.slice(0, 900)}\n┃ 🔗 ${d.content_urls?.desktop?.page}`);
  return d.thumbnail?.source ? c.send({ image: { url: d.thumbnail.source }, caption: cap }) : c.reply(cap);
});
add('define', ['dictionary', 'dict'], 'English dictionary', '<word>', async (c) => {
  const d = (await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(c.input)}`))[0];
  return c.say(frame(`📖 ${d.word}`, d.meanings.slice(0, 3).map((m) => `┃ *${m.partOfSpeech}*: ${m.definitions[0].definition}`).join('\n')));
});
add('github', ['gh', 'ghuser'], 'GitHub user profile', '<username>', async (c) => {
  const d = await getJson(`https://api.github.com/users/${encodeURIComponent(c.input)}`);
  return c.send({ image: { url: d.avatar_url }, caption: frame(`🐙 ${d.login}`, [line('📛', 'Name', d.name || '—'), line('📦', 'Repos', d.public_repos), line('👥', 'Followers', d.followers), line('🏢', 'Company', d.company || '—'), `┃ 🔗 ${d.html_url}`].join('\n')) });
});
add('npm', ['npmjs'], 'npm package info', '<package>', async (c) => {
  const d = await getJson(`https://registry.npmjs.org/${encodeURIComponent(c.input)}`); const v = d['dist-tags'].latest;
  return c.reply(frame(`📦 ${d.name}`, [line('🏷️', 'Latest', v), line('📝', 'About', (d.description || '—').slice(0, 120)), line('📜', 'License', d.license || '—'), `┃ 🔗 https://npmjs.com/package/${d.name}`].join('\n')));
});
add('ip', ['iplookup'], 'IP / domain lookup', '<ip|domain>', async (c) => {
  const d = await getJson(`http://ip-api.com/json/${encodeURIComponent(c.input)}`);
  return d.status === 'success' ? c.reply(frame('🌐 IP', [line('📍', 'Location', `${d.city}, ${d.regionName}, ${d.country}`), line('🏢', 'ISP', d.isp), line('🕒', 'TZ', d.timezone), line('🧭', 'Coords', `${d.lat}, ${d.lon}`)].join('\n'))) : c.reply(c.t('not_found'));
});
add('country', ['nation'], 'Country information', '<name>', async (c) => {
  const d = (await getJson(`https://restcountries.com/v3.1/name/${encodeURIComponent(c.input)}`))[0];
  return c.send({ image: { url: d.flags.png }, caption: frame(`${d.flag} ${d.name.common}`, [line('🏛️', 'Capital', d.capital?.[0] || '—'), line('🌏', 'Region', d.region), line('👥', 'Population', d.population.toLocaleString()), line('🗣️', 'Languages', Object.values(d.languages || {}).join(', ')), line('💰', 'Currency', Object.keys(d.currencies || {}).join(', '))].join('\n')) });
});
add('prayer', ['salah', 'prayertimes'], 'Prayer times for a city', '<city> <country>', async (c) => {
  const [city, ...rest] = c.args; const d = (await getJson(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(rest.join(' ') || city)}`)).data.timings;
  return c.reply(frame(`🕌 ${city}`, ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map((k) => line('🕋', k, d[k])).join('\n')));
});
add('animeinfo', ['animesearch'], 'Anime details (MyAnimeList)', '<title>', async (c) => {
  const d = (await getJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(c.input)}&limit=1`)).data[0]; if (!d) return c.reply(c.t('not_found'));
  return c.send({ image: { url: d.images.jpg.image_url }, caption: frame(`🎌 ${d.title}`, [line('⭐', 'Score', d.score), line('📺', 'Episodes', d.episodes || '?'), line('📅', 'Year', d.year || '?'), `┃ 📝 ${await c.tr((d.synopsis || '').slice(0, 350))}`].join('\n')) });
});
N.push({ category: 'info', name: 'iss', desc: 'International Space Station position', run: async (c) => { const d = await getJson('http://api.open-notify.org/iss-now.json'); return c.reply(frame('🛰️ ISS', `┃ 🧭 ${d.iss_position.latitude}, ${d.iss_position.longitude}`)); } });
N.push({ category: 'info', name: 'apod', aliases: ['nasa'], desc: 'NASA astronomy picture of the day', run: async (c) => { const d = await getJson('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY'); return c.send({ image: { url: d.url }, caption: frame(`🌌 ${d.title}`, `┃ ${await c.tr((d.explanation || '').slice(0, 600))}`) }); } });
N.push({ category: 'info', name: 'date', aliases: ['today'], desc: 'Today’s date and time', run: (c) => c.reply(`📅 ${new Date().toLocaleString('en-GB', { timeZone: cfg.tz, dateStyle: 'full', timeStyle: 'short' })} (${cfg.tz})`) });
N.push({ category: 'info', name: 'covid', desc: 'Global COVID-19 statistics', run: async (c) => { const d = await getJson('https://disease.sh/v3/covid-19/all'); return c.reply(frame('🦠 COVID-19', [line('🌍', 'Cases', d.cases.toLocaleString()), line('💀', 'Deaths', d.deaths.toLocaleString()), line('💚', 'Recovered', d.recovered.toLocaleString())].join('\n'))); } });

module.exports = N;
