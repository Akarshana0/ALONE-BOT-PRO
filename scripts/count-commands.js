const loader = require('../src/core/commandLoader');
const n = loader.loadCommands();
const by = {};
for (const c of loader.list) by[c.category] = (by[c.category] || 0) + 1;
console.log(`Total commands: ${n}`);
console.table(by);
