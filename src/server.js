// ALONE WhatsApp Bot — Web & Pairing Server
const express = require('express');
const cors = require('cors');
const path = require('path');
const cfg = require('./config');
const log = require('./logger');
const sessions = require('./session/manager');

function startServer(port = process.env.PORT || 3000) {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve static files from public/
  const publicDir = path.join(__dirname, '../public');
  app.use(express.static(publicDir));

  // Bot Info API
  app.get('/api/info', (req, res) => {
    const mainS = sessions.get(cfg.mainSession);
    res.json({
      success: true,
      botName: cfg.botName,
      ownerName: cfg.ownerName,
      prefix: cfg.prefix,
      defaultLang: cfg.defaultLang,
      mainSessionReady: !!mainS?.ready,
      mainSessionNumber: mainS?.number || null,
    });
  });

  // Pairing Code API: handles both GET and POST
  const handlePair = async (req, res) => {
    const number = req.query.number || req.body.number;
    const type = req.query.type || req.body.type || 'auto';

    if (!number) {
      return res.status(400).json({ success: false, error: 'Phone number is required.' });
    }

    try {
      log.info(`🌐 Web pairing requested for: ${number} (type: ${type})`);
      const result = await sessions.requestPairCode(number, type);
      return res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      log.error({ err: err.message }, 'web pairing error');
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to generate pairing code.',
      });
    }
  };

  app.get('/api/pair', handlePair);
  app.post('/api/pair', handlePair);

  // Status API: check if user connected on WhatsApp
  app.get('/api/status', (req, res) => {
    const sid = req.query.sid;
    if (!sid) {
      return res.status(400).json({ success: false, error: 'Session ID (sid) is required.' });
    }
    const status = sessions.getSessionStatus(sid);
    res.json({ success: true, ...status });
  });

  // Dedicated Pair route serves pair.html
  app.get('/pair', (req, res) => {
    res.sendFile(path.join(publicDir, 'pair.html'));
  });

  // Fallback for SPA/direct links (Express 5 compatible)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  const server = app.listen(port, () => {
    log.info(`🌐 ALONE Web & Pairing Server running on port ${port} -> http://localhost:${port}`);
  });

  return server;
}

module.exports = { startServer };
