// In-memory LRU used by Anti-Delete / VIP vault + raw message cache for Baileys' getMessage()
const MAX_ENTRIES = 400;
const MAX_BYTES = 96 * 1048576;
const lru = new Map();
let total = 0;
const raws = new Map();
const sent = new Map();

const key = (sid, chat, id) => `${sid}:${chat}:${id}`;
function put(e) {
  lru.set(key(e.sid, e.chat, e.id), e);
  total += e.size || 0;
  while (lru.size > MAX_ENTRIES || total > MAX_BYTES) {
    const [k, v] = lru.entries().next().value;
    lru.delete(k); total -= v.size || 0;
  }
}
const find = (sid, chat, id) => lru.get(key(sid, chat, id));
function remember(sid, id, message) {
  raws.set(`${sid}:${id}`, message);
  if (raws.size > 1000) raws.delete(raws.keys().next().value);
}
const getRaw = (sid, k) => raws.get(`${sid}:${k.id}`);
function logSent(sid, chat, k) {
  const kk = `${sid}:${chat}`;
  const arr = sent.get(kk) || [];
  arr.push({ remoteJid: k.remoteJid, id: k.id, fromMe: true, participant: k.participant });
  if (arr.length > 60) arr.shift();
  sent.set(kk, arr);
}
const lastSent = (sid, chat, n) => (sent.get(`${sid}:${chat}`) || []).slice(-n).reverse();
function clear() { lru.clear(); raws.clear(); total = 0; }
const stats = () => ({ entries: lru.size, bytes: total, raws: raws.size });

module.exports = { put, find, remember, getRaw, logSent, lastSent, clear, stats };
