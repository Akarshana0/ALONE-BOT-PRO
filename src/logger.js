const pino = require('pino');
const log = pino({ level: process.env.LOG_LEVEL || 'info' });
log.baileysLogger = pino({ level: 'silent' });
module.exports = log;
