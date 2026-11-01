const { User } = require('../database');
const cache = new Map();
async function get(number) {
  if (cache.has(number)) return cache.get(number);
  let u = await User.findOne({ number }).lean();
  if (!u) u = (await User.create({ number })).toObject();
  cache.set(number, u);
  return u;
}
async function update(number, patch) {
  const u = await get(number);
  Object.assign(u, patch);
  await User.updateOne({ number }, { $set: patch });
}
module.exports = { get, update };
