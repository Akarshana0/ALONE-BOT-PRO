// ALONE — futuristic WhatsApp bot  ·  Owner: AKARSHANA
require('dotenv').config();
const http = require('http');
const cfg = require('./src/config');
const log = require('./src/logger');

(async () => {
  if (!cfg.mongoUri) { log.fatal('❌ MONGODB_URI is required (sessions, settings and languages are stored there).'); process.exit(1); }
  const db = require('./src/database');
  await db.connect();
  const film = require('./src/core/film');
  await film.sweep();                                   // remove temp files left over from a previous run
  const { loadCommands } = require('./src/core/commandLoader');
  log.info(`🤖 ${cfg.botName} — ${loadCommands()} commands loaded`);
  const sessions = require('./src/session/manager');
  await sessions.startMain();
  sessions.restoreAll().catch((e) => log.error({ err: e.message }, 'restoreAll'));

  // Start web & pairing server (works locally & on cloud platforms)
  const { startServer } = require('./src/server');
  startServer(process.env.PORT || 3000);

  process.on('unhandledRejection', (e) => log.error({ err: e }, 'unhandledRejection'));
  process.on('uncaughtException', (e) => log.error({ err: e }, 'uncaughtException'));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await sessions.closeAll(); await film.shutdown().catch(() => {}); process.exit(0); });
})();
