const mongoose = require('mongoose');
const cfg = require('../config');
const log = require('../logger');
const { Schema } = mongoose;

const AuthKey = mongoose.model('AuthKey', new Schema({ sid: String, key: String, value: String }).index({ sid: 1, key: 1 }, { unique: true }));
const Session = mongoose.model('Session', new Schema({
  sid: { type: String, unique: true }, number: String, requestedBy: String,
  status: { type: String, default: 'active' }, createdAt: { type: Date, default: Date.now },
}));
const User = mongoose.model('User', new Schema({
  number: { type: String, unique: true }, lang: String, langPromptedAt: Number,
  banned: { type: Boolean, default: false }, commands: { type: Number, default: 0 }, lastSeen: Date,
}));
const Setting = mongoose.model('Setting', new Schema({
  sid: { type: String, unique: true }, prefix: String, features: { type: Schema.Types.Mixed, default: {} },
}, { minimize: false }));
const Group = mongoose.model('Group', new Schema({
  sid: String, jid: String, features: { type: Schema.Types.Mixed, default: {} },
  welcomeMsg: String, goodbyeMsg: String, warns: { type: Schema.Types.Mixed, default: {} },
}, { minimize: false }).index({ sid: 1, jid: 1 }, { unique: true }));
// VIP vault: messages received by the owner (text + media up to ~8MB), auto-expire after 3 days
const Stored = mongoose.model('Stored', new Schema({
  sid: String, id: String, chat: String, sender: String, pushName: String, type: String,
  text: String, caption: String, mime: String, ptt: Boolean, data: Buffer, ts: Number,
  expireAt: { type: Date, index: { expires: 0 } },
}).index({ sid: 1, id: 1 }));

async function connect() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(cfg.mongoUri, { serverSelectionTimeoutMS: 20000 });
  log.info('🗄️  MongoDB connected');
}

module.exports = { connect, AuthKey, Session, User, Setting, Group, Stored };
