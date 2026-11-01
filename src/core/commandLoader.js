// Auto-loads every file in /commands. Each file exports a command object or an array of them.
const fs = require('fs');
const path = require('path');
const log = require('../logger');

const map = new Map();
const list = [];
const CATS = ['main', 'download', 'ai', 'group', 'owner', 'tools', 'fun', 'image', 'info'];

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);

function loadCommands() {
  map.clear(); list.length = 0;
  for (const file of walk(path.join(__dirname, '../commands'))) {
    for (const cmd of [].concat(require(file))) {
      if (!cmd || !cmd.name || typeof cmd.run !== 'function') continue;
      cmd.aliases ||= []; cmd.category ||= 'main';
      list.push(cmd);
      for (const n of [cmd.name, ...cmd.aliases]) {
        if (map.has(n)) log.warn(`duplicate command name: ${n}`);
        map.set(n, cmd);
      }
    }
  }
  return list.length;
}
module.exports = { loadCommands, get: (n) => map.get(n), list, CATS };
