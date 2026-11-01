// Baileys auth state stored in MongoDB (Heroku's filesystem is ephemeral)
const { proto, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const { AuthKey } = require('../database');

async function useMongoAuthState(sid) {
  const read = async (key) => {
    const d = await AuthKey.findOne({ sid, key }).lean();
    return d ? JSON.parse(d.value, BufferJSON.reviver) : null;
  };
  const write = (key, data) =>
    AuthKey.updateOne({ sid, key }, { $set: { value: JSON.stringify(data, BufferJSON.replacer) } }, { upsert: true });
  const remove = (key) => AuthKey.deleteOne({ sid, key });

  const creds = (await read('creds')) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {};
          await Promise.all(ids.map(async (id) => {
            let v = await read(`${type}-${id}`);
            if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
            out[id] = v;
          }));
          return out;
        },
        set: async (data) => {
          const jobs = [];
          for (const cat of Object.keys(data))
            for (const id of Object.keys(data[cat])) {
              const v = data[cat][id];
              jobs.push(v ? write(`${cat}-${id}`, v) : remove(`${cat}-${id}`));
            }
          await Promise.all(jobs);
        },
      },
    },
    saveCreds: () => write('creds', creds),
    clear: () => AuthKey.deleteMany({ sid }),
  };
}
module.exports = { useMongoAuthState };
