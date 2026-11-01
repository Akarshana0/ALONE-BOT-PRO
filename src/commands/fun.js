const { getJson, pick, rnd, sleep, hashNum, num } = require('../core/utils');
const { frame, line } = require('../core/ui');

const F = [];
const base = { category: 'fun' };
const list = (name, aliases, desc, arr, emoji) => F.push({ ...base, name, aliases, desc, run: (c) => c.say(`${emoji} ${pick(arr)}`) });
const target = (c) => c.mentionedJids()[0] || c.quoted?.participant || null;
const who = (c) => { const t = target(c); return t ? { jid: t, tag: `@${num(t)}` } : { jid: c.sender, tag: `@${c.senderNumber}` }; };

// ── static content ──
list('8ball', ['eightball'], 'Ask the magic 8-ball', ['It is certain.', 'Without a doubt.', 'Yes — definitely.', 'Most likely.', 'Signs point to yes.', 'Reply hazy, try again.', 'Ask again later.', 'Cannot predict now.', "Don't count on it.", 'My sources say no.', 'Very doubtful.'], '🎱');
list('truth', [], 'Truth question', ['What is your biggest fear?', 'What is the last lie you told?', 'Who was your first crush?', 'What is your most embarrassing moment?', 'What habit do you wish you could quit?', 'What is a secret talent you have?', 'What is the worst gift you ever received?', 'Which app do you waste the most time on?'], '🫣');
list('dare', [], 'Dare challenge', ['Send a voice note singing a song.', 'Change your profile photo to a meme for an hour.', 'Text your best friend "I miss you" with no context.', 'Do 15 push-ups and send proof.', 'Speak only in emojis for 10 minutes.', 'Post a funny selfie in the group.', 'Write a 2-line poem about the person above you.'], '😈');
list('wyr', ['wouldyourather'], 'Would you rather…', ['Be able to fly OR be invisible?', 'Always be 10 min late OR 20 min early?', 'Lose your phone OR lose your wallet?', 'Live without music OR without movies?', 'Know how you die OR when you die?', 'Be rich and lonely OR poor and loved?'], '🤔');
list('pickup', ['pickupline'], 'Pickup line', ['Are you a keyboard? Because you are just my type.', 'Do you have Wi-Fi? Because I feel a strong connection.', 'Are you Ctrl+C? Because I want to copy your number.', 'Is your name Google? Because you have everything I am searching for.', 'Are you a bug? Because you are stuck in my head.'], '💘');
list('compliment', ['praise'], 'Get a compliment', ['You make hard things look easy. ⚡', 'Your energy lights up every room.', 'You are the kind of person who makes others better.', 'Your creativity is next level.', 'You are the main character today.'], '🌟');
list('roast', [], 'Friendly roast', ['You are the reason the "skip ad" button exists.', 'Your Wi-Fi password is probably "password123".', 'You type "brb" and disappear for 3 days.', 'Your battery dies faster than your motivation.', 'You have the confidence of a 100% charge at 1%.'], '🔥');
list('shayari', [], 'Short poetic line', ['Stars shine brightest when the night is darkest. ✨', 'Every ending is a quiet beginning.', 'In the neon rain, hope still glows.', 'Be the signal in the noise. 📡', 'Dreams compile when courage runs.'], '📜');
list('motto', ['cyberquote'], 'Cyberpunk quote', ['The future is already here — it is just not evenly distributed.', 'Hack the planet. 🌍', 'In a world of noise, be the signal.', 'Code is poetry written for machines.', 'Stay human in a digital world.'], '🤖');

// ── APIs ──
const fetcher = (name, aliases, desc, url, fmt, img) => F.push({ ...base, name, aliases, desc, run: async (c) => { const d = await getJson(url); const t = fmt(d); return img ? c.send({ image: { url: img(d) }, caption: t || '' }) : c.say(t); } });
fetcher('joke', ['jokes'], 'Random joke', 'https://official-joke-api.appspot.com/random_joke', (d) => `😂 ${d.setup}\n\n👉 ${d.punchline}`);
fetcher('fact', ['funfact'], 'Random fact', 'https://uselessfacts.jsph.pl/api/v2/facts/random?language=en', (d) => `🧠 ${d.text}`);
fetcher('quote', ['quotes'], 'Inspirational quote', 'https://zenquotes.io/api/random', (d) => `💬 “${d[0].q}”\n— ${d[0].a}`);
fetcher('advice', [], 'Random advice', 'https://api.adviceslip.com/advice', (d) => `💡 ${JSON.parse(typeof d === 'string' ? d : JSON.stringify(d)).slip.advice}`);
fetcher('catfact', [], 'Cat fact', 'https://catfact.ninja/fact', (d) => `🐱 ${d.fact}`);
fetcher('cat', ['kitty'], 'Random cat picture', 'https://api.thecatapi.com/v1/images/search', () => '🐱', (d) => d[0].url);
fetcher('dog', ['doggo'], 'Random dog picture', 'https://dog.ceo/api/breeds/image/random', () => '🐶', (d) => d.message);
fetcher('fox', [], 'Random fox picture', 'https://randomfox.ca/floof/', () => '🦊', (d) => d.image);
fetcher('meme', ['memes'], 'Random meme', 'https://meme-api.com/gimme', (d) => `😆 ${d.title}`, (d) => d.url);
F.push({ ...base, name: 'trivia', aliases: ['quiz'], desc: 'Trivia question (answer revealed after 20s)', run: async (c) => {
  const d = (await getJson('https://opentdb.com/api.php?amount=1&type=multiple')).results[0];
  const dec = (s) => s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&[a-z]+;/g, '');
  const opts = [...d.incorrect_answers, d.correct_answer].sort(() => Math.random() - 0.5).map(dec);
  await c.reply(frame('🧩 TRIVIA', `┃ ${dec(d.question)}\n${opts.map((o, i) => `┃ ${'ABCD'[i]}) ${o}`).join('\n')}\n┃ ⏳ 20s…`));
  await sleep(20000);
  return c.reply(`✅ ${dec(d.correct_answer)}`);
} });

// ── games / random ──
F.push({ ...base, name: 'dice', aliases: ['roll'], desc: 'Roll a dice', run: (c) => c.reply(`🎲 ${rnd(1, 6)}`) });
F.push({ ...base, name: 'coin', aliases: ['flip', 'coinflip'], desc: 'Flip a coin', run: (c) => c.reply(pick(['🪙 Heads', '🪙 Tails'])) });
F.push({ ...base, name: 'rps', desc: 'Rock paper scissors', usage: '<rock|paper|scissors>', need: true, run: (c) => {
  const m = ['rock', 'paper', 'scissors']; const u = m.find((x) => x.startsWith(c.args[0].toLowerCase())); if (!u) return c.reply(c.t('usage', { usage: `${c.prefix}rps rock` }));
  const b = pick(m); const win = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  return c.reply(`🤖 ${b}\n${u === b ? '🤝 Draw' : win[u] === b ? '🏆 You win!' : '💀 I win!'}`);
} });
F.push({ ...base, name: 'slot', aliases: ['slots'], desc: 'Slot machine', run: (c) => { const e = ['🍒', '🍋', '💎', '7️⃣', '⚡']; const r = [pick(e), pick(e), pick(e)]; return c.reply(`🎰 ${r.join(' | ')}\n${r[0] === r[1] && r[1] === r[2] ? '🏆 JACKPOT!' : r[0] === r[1] || r[1] === r[2] ? '✨ Nice pair!' : '❌ Try again'}`); } });
F.push({ ...base, name: 'choose', aliases: ['pickone'], desc: 'Choose between options', usage: 'a | b | c', need: true, run: (c) => c.reply(`🎯 ${pick(c.input.split('|').map((s) => s.trim()).filter(Boolean))}`) });
F.push({ ...base, name: 'ship', aliases: ['love'], desc: 'Compatibility of two people', usage: '<@a> <@b>', run: (c) => {
  const m = c.mentionedJids(); const a = m[0] || c.sender; const b = m[1] || m[0] ? m[1] || c.sender : null; if (!b) return c.reply(c.t('usage', { usage: `${c.prefix}ship @a @b` }));
  const p = hashNum([num(a), num(b)].sort().join('')) % 101;
  return c.send({ text: frame('💞 SHIP', `┃ @${num(a)} ❤️ @${num(b)}\n┃ ${'█'.repeat(Math.round(p / 10))}${'░'.repeat(10 - Math.round(p / 10))} *${p}%*`), mentions: [a, b] });
} });
const meter = (name, aliases, desc, emoji, label) => F.push({ ...base, name, aliases, desc, run: (c) => { const w = who(c); const p = hashNum(w.jid + name + new Date().toDateString()) % 101; return c.send({ text: `${emoji} ${w.tag} — ${label}: *${p}%*`, mentions: [w.jid] }); } });
meter('iq', [], 'IQ meter (just for fun)', '🧠', 'IQ'); meter('luck', [], "Today's luck meter", '🍀', 'Luck'); meter('vibe', [], 'Vibe check', '🌈', 'Vibe'); meter('cool', ['coolness'], 'Coolness meter', '😎', 'Cool'); meter('smart', [], 'Smartness meter', '🎓', 'Smart');
const act = (name, emoji, verb) => F.push({ ...base, name, desc: `${verb} someone`, usage: '<@user|reply>', run: (c) => { const t = target(c); return c.send({ text: `${emoji} @${c.senderNumber} ${verb} ${t ? '@' + num(t) : 'everyone'}!`, mentions: [c.sender, ...(t ? [t] : [])] }); } });
act('hug', '🤗', 'hugs'); act('slap', '👋', 'slaps'); act('pat', '🫳', 'pats'); act('poke', '👉', 'pokes'); act('highfive', '🙌', 'high-fives'); act('wave', '👋', 'waves at');
F.push({ ...base, name: 'hack', aliases: [], desc: 'Fake "hacking" animation (just for fun!)', usage: '<@user|name>', run: async (c) => {
  const nm = c.input || 'target'; const m = await c.reply(`💻 Initializing on *${nm}*…`);
  const steps = ['🔍 Scanning ports… [22, 80, 443]', '🔓 Bypassing firewall… ██░░░░░░ 25%', '📡 Injecting payload… ████░░░░ 50%', '🧬 Decrypting hashes… ██████░░ 75%', '✅ Access granted… ████████ 100%', '😄 Just kidding — this is a prank. Nothing was touched! ⚡'];
  for (const s of steps) { await sleep(1100); await c.sock.sendMessage(c.chat, { text: `💻 ${s}`, edit: m.key }); }
} });
F.push({ ...base, name: 'matrixrain', aliases: ['rain'], desc: 'Matrix rain text', run: (c) => c.reply(Array.from({ length: 8 }, () => Array.from({ length: 18 }, () => pick('01アイウエオカキクケコ'.split(''))).join('')).join('\n').replace(/^/, '```\n') + '\n```') });
F.push({ ...base, name: 'fakeip', desc: 'Random fake IP (prank)', run: (c) => c.reply(`🌐 ${rnd(11, 223)}.${rnd(0, 255)}.${rnd(0, 255)}.${rnd(1, 254)}`) });

module.exports = F;
