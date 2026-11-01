// AI layer: OpenAI / Gemini when keys exist, otherwise a free public endpoint (Pollinations)
const cfg = require('../config');
const I = require('./i18n');
const { http } = require('./utils');

const mem = new Map();
const SYS = (lang) => `You are ${cfg.botName}, a futuristic, concise, helpful WhatsApp assistant created by ${cfg.ownerName}. Reply in ${I.LANGS[lang]?.ai || 'English'}. Use short paragraphs and WhatsApp formatting (*bold*) sparingly.`;

async function openai(messages) {
  const r = await http.post('https://api.openai.com/v1/chat/completions', { model: cfg.openaiModel, messages }, { headers: { Authorization: `Bearer ${cfg.openaiKey}` }, timeout: 60000 });
  return r.data.choices[0].message.content;
}
async function gemini(messages) {
  const sys = messages.find((m) => m.role === 'system')?.content || '';
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const r = await http.post(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.geminiModel}:generateContent?key=${cfg.geminiKey}`, { systemInstruction: { parts: [{ text: sys }] }, contents }, { timeout: 60000 });
  return r.data.candidates[0].content.parts.map((p) => p.text).join('');
}
async function free(messages) {
  try {
    const r = await http.post('https://text.pollinations.ai/openai', { model: 'openai', messages }, { timeout: 60000 });
    return r.data.choices[0].message.content;
  } catch {
    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n').slice(-1800);
    return String((await http.get(`https://text.pollinations.ai/${encodeURIComponent(prompt)}`, { timeout: 60000 })).data);
  }
}

// provider: 'auto' | 'openai' | 'gemini'
async function ask(memKey, prompt, { lang = 'en', provider = 'auto', system, remember = true } = {}) {
  const hist = remember ? mem.get(memKey) || [] : [];
  const messages = [{ role: 'system', content: system || SYS(lang) }, ...hist, { role: 'user', content: prompt }];
  let out;
  if (provider === 'openai' && cfg.openaiKey) out = await openai(messages);
  else if (provider === 'gemini' && cfg.geminiKey) out = await gemini(messages);
  else if (provider === 'auto' && cfg.geminiKey) out = await gemini(messages);
  else if (provider === 'auto' && cfg.openaiKey) out = await openai(messages);
  else out = await free(messages);
  if (remember) { hist.push({ role: 'user', content: prompt }, { role: 'assistant', content: out }); mem.set(memKey, hist.slice(-12)); }
  return out.trim();
}
const reset = (k) => mem.delete(k);
const hasProvider = (p) => (p === 'openai' ? !!cfg.openaiKey : p === 'gemini' ? !!cfg.geminiKey : true);

module.exports = { ask, reset, hasProvider };
