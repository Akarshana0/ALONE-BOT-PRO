// Multi-session manager: one MAIN session + any number of linked user sessions, all persisted in MongoDB
const baileys = require('@whiskeysockets/baileys');
const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser } = baileys;
const cfg = require('../config');
const log = require('../logger');
const S = require('../core/settings');
const store = require('../core/store');
const handler = require('../core/handler');
const events = require('../core/events');
const users = require('../core/users');
const I = require('../core/i18n');
const { useMongoAuthState } = require('./authState');
const { Session, AuthKey } = require('../database');
const { num, sleep, botId } = require('../core/utils');

const registry = new Map(); // sid -> session

async function start(sid, opts = {}) {
  const old = registry.get(sid);
  if (old?.sock && !opts.force) return old;
  const { state, saveCreds, clear } = await useMongoAuthState(sid);
  await S.init(sid);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({}));
  const sock = makeWASocket({
    ...(version ? { version } : {}),
    logger: log.baileysLogger,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, log.baileysLogger) },
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    getMessage: async (key) => store.getRaw(sid, key),
  });
  // Baileys 6.7 ids start with 3EB0, so the handler's `BAE5` self-filter never matched: tag our own sends explicitly
  const rawSend = sock.sendMessage.bind(sock);
  sock.sendMessage = (jid, content, options = {}) => rawSend(jid, content, { messageId: botId(), ...options });
  const session = old || { sid, startedAt: Date.now(), kind: sid === cfg.mainSession ? 'main' : 'user', requestedBy: opts.requestedBy, retries: 0 };
  Object.assign(session, { sock, ready: false, stopped: false, clear, registered: !!state.creds.registered });
  registry.set(sid, session);

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.upsert', (u) => handler.onUpsert(session, u));
  sock.ev.on('group-participants.update', (ev) => events.onGroupParticipants(session, ev).catch((e) => log.debug({ err: e.message }, 'group event')));
  sock.ev.on('call', (calls) => events.onCall(session, calls));

  if (!state.creds.registered && opts.pairNumber) {
    setTimeout(async () => {
      try {
        const raw = await sock.requestPairingCode(opts.pairNumber);
        const code = raw.match(/.{1,4}/g).join('-');
        log.info(`🔐 [${sid}] PAIRING CODE for +${opts.pairNumber}: ${code}`);
        opts.onPairCode?.(code);
      } catch (e) { log.error({ err: e.message }, 'pairing failed'); opts.onPairError?.(e); }
    }, 3000);
  }

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      session.ready = true; session.retries = 0;
      session.number = num(jidNormalizedUser(sock.user.id));
      await Session.updateOne({ sid }, { $set: { sid, number: session.number, status: 'active', requestedBy: session.requestedBy } }, { upsert: true });
      log.info(`⚡ [${sid}] connected as +${session.number}`);
      if (sid === cfg.mainSession) {
        const owner = await users.get(cfg.ownerNumber);
        const text = `🤖 *${cfg.botName}* ${I.t(owner.lang || cfg.defaultLang, 'alive', { bot: cfg.botName })}`;
        sock.sendMessage(`${cfg.ownerNumber}@s.whatsapp.net`, { text }).catch(() => {});
      }
    }
    if (connection === 'close') {
      session.ready = false;
      if (session.stopped) return;
      const code = lastDisconnect?.error?.output?.statusCode;
      log.warn(`[${sid}] closed (code ${code})`);
      if (code === DisconnectReason.loggedOut) return purge(sid, 'logged out from phone');
      if (code === DisconnectReason.connectionReplaced) return log.warn(`[${sid}] replaced by another instance — not reconnecting`);
      if (!session.registered && !sock.authState.creds.registered && sid !== cfg.mainSession && code !== DisconnectReason.restartRequired) return purge(sid, 'pairing never completed');
      session.retries++;
      const wait = Math.min(30000, 1500 * session.retries);
      setTimeout(() => start(sid, { force: true }).catch((e) => log.error({ err: e.message }, 'restart failed')), wait);
    }
  });
  return session;
}

async function purge(sid, why) {
  const s = registry.get(sid);
  if (s) { s.stopped = true; try { s.sock.end(undefined); } catch { /* ignore */ } }
  await AuthKey.deleteMany({ sid });
  await Session.deleteOne({ sid });
  registry.delete(sid);
  log.info(`🧹 [${sid}] purged (${why})`);
}

// Owner remote-disconnect: unlink the device (logout) + wipe credentials
async function revoke(sid, notice) {
  const s = registry.get(sid);
  if (s) {
    s.stopped = true;
    try {
      if (notice && s.ready) await s.sock.sendMessage(jidNormalizedUser(s.sock.user.id), { text: notice });
      await s.sock.logout();
    } catch { try { s.sock.end(undefined); } catch { /* ignore */ } }
  }
  await purge(sid, 'revoked');
}

function resolve(target) {
  const t = String(target || '').trim().toLowerCase();
  if (t === 'all') return [...registry.values()].filter((s) => s.sid !== cfg.mainSession).map((s) => s.sid);
  const d = t.replace(/\D/g, '');
  return [...registry.values()].filter((s) => s.sid.toLowerCase() === t || (d && (s.number === d || s.sid === `u_${d}`))).map((s) => s.sid);
}

async function connectUser(number, requestedBy) {
  const sid = `u_${number}`;
  const ex = registry.get(sid);
  if (ex?.ready) return { exists: true };
  if (ex) await purge(sid, 're-link');
  if ([...registry.values()].filter((s) => s.kind === 'user').length >= cfg.maxSessions) return { full: true };
  const code = await new Promise((resolveP, reject) => {
    const to = setTimeout(() => reject(new Error('pairing timeout')), 30000);
    start(sid, { pairNumber: number, requestedBy, onPairCode: (c) => { clearTimeout(to); resolveP(c); }, onPairError: (e) => { clearTimeout(to); reject(e); } }).catch(reject);
  });
  return { code, sid };
}

async function startMain() { return start(cfg.mainSession, { pairNumber: cfg.pairNumber || undefined }); }
async function restoreAll() {
  const rows = await Session.find({ status: 'active', sid: { $ne: cfg.mainSession } }).lean();
  for (const r of rows) { await start(r.sid, { requestedBy: r.requestedBy }).catch((e) => log.error({ err: e.message }, `restore ${r.sid}`)); await sleep(2500); }
}
async function closeAll() { for (const s of registry.values()) { s.stopped = true; try { s.sock.end(undefined); } catch { /* ignore */ } } }

// presence tick for "always online"
setInterval(() => { for (const s of registry.values()) if (s.ready && S.isOn(s.sid, 'alwaysonline')) s.sock.sendPresenceUpdate('available').catch(() => {}); }, 60000).unref();

module.exports = { registry, start, startMain, restoreAll, closeAll, revoke, purge, resolve, connectUser, get: (sid) => registry.get(sid) };
