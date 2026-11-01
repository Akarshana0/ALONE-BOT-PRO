const ai = require('../core/ai');
const ui = require('../core/ui');
const { frame } = ui;

const key = (c) => `${c.sid}:${c.senderNumber}`;
const chat = (name, aliases, desc, provider) => ({ name, aliases, category: 'ai', desc, usage: '<question>', need: true, run: async (c) => {
  if (!ai.hasProvider(provider)) await c.reply(`ℹ️ ${provider.toUpperCase()} key not set — using the free engine.`);
  await c.sock.sendPresenceUpdate('composing', c.chat).catch(() => {});
  const out = await ai.ask(key(c), c.input, { lang: c.lang, provider: ai.hasProvider(provider) ? provider : 'auto' });
  return c.reply(frame(`🧠 ${name.toUpperCase()}`, out));
} });
const task = (name, aliases, desc, instruction) => ({ name, aliases, category: 'ai', desc, usage: '<text>', need: true, run: async (c) => {
  const out = await ai.ask(key(c), c.input, { lang: c.lang, remember: false, system: `${instruction} Reply in ${require('../core/i18n').LANGS[c.lang].ai}. Keep it WhatsApp-friendly.` });
  return c.reply(frame(`🧠 ${name.toUpperCase()}`, out));
} });

module.exports = [
  chat('ai', ['ask', 'chat', 'bot-ai'], 'Chat with the AI (remembers context)', 'auto'),
  chat('gpt', ['chatgpt', 'openai'], 'ChatGPT (needs OPENAI_API_KEY, else free engine)', 'openai'),
  chat('gemini', ['bard', 'google-ai'], 'Google Gemini (needs GEMINI_API_KEY, else free engine)', 'gemini'),
  { name: 'resetai', aliases: ['clearai'], category: 'ai', desc: 'Forget your AI conversation', run: (c) => { ai.reset(key(c)); return c.reply(c.t('done')); } },
  task('explain', ['whatis'], 'Explain a topic clearly', 'Explain the topic clearly with a short example.'),
  task('eli5', ['simple'], 'Explain like I am 5', 'Explain like the reader is five years old.'),
  task('summarize', ['tldr', 'summary'], 'Summarize text', 'Summarize the text in a few bullet points.'),
  task('rewrite', ['paraphrase'], 'Rewrite text better', 'Rewrite the text to be clearer and more natural, keeping the meaning.'),
  task('grammar', ['fixgrammar'], 'Fix grammar and spelling', 'Correct grammar and spelling. Return only the corrected text, then a one-line note of changes.'),
  task('code', ['codegen'], 'Generate code', 'You are a senior engineer. Write clean, working code in a fenced block with a 2-line explanation.'),
  task('debug', ['fixcode'], 'Find the bug in code', 'Find the bug(s) in the code, explain briefly and give corrected code.'),
  task('sql', [], 'Write an SQL query', 'Write a correct SQL query for the request and explain it in one line.'),
  task('regex', ['regexp'], 'Build a regex', 'Provide a regular expression for the request with 3 test examples.'),
  task('shell', ['bash'], 'Write a shell command', 'Provide the shell command(s) and a one-line explanation of each.'),
  task('math', ['solve'], 'Solve a math problem step by step', 'Solve step by step and give the final answer clearly.'),
  task('poem', [], 'Write a short poem', 'Write an original short poem on the topic.'),
  task('story', ['shortstory'], 'Write a short story', 'Write an original, engaging short story (under 250 words).'),
  task('recipe', [], 'Create a recipe', 'Create a simple recipe with ingredients and steps.'),
  task('caption', ['igcaption'], 'Social media captions', 'Write 5 catchy social media captions with emojis.'),
  task('hashtags', ['tags'], 'Generate hashtags', 'Generate 15 relevant hashtags.'),
  task('idea', ['brainstorm'], 'Brainstorm ideas', 'Give 8 creative ideas, one line each.'),
  task('email', ['mail'], 'Draft an email', 'Draft a professional email with subject line.'),
  task('essay', [], 'Write a short essay', 'Write a well-structured short essay (intro, body, conclusion).'),
  task('proscons', ['pc'], 'Pros and cons', 'List pros and cons as two concise lists, then a one-line verdict.'),
  task('motivate', ['motivation'], 'Motivational boost', 'Give a short, powerful motivational message.'),
  task('slogan', [], 'Brand slogans', 'Create 6 catchy slogans.'),
  task('socialbio', ['biogen'], 'Write a profile bio', 'Write 4 short, stylish profile bios with emojis.'),
  task('tweet', ['xpost'], 'Write a tweet/X post', 'Write 3 engaging posts under 280 characters.'),
  task('studyplan', ['plan'], 'Make a study plan', 'Create a practical day-by-day study plan.'),
];
