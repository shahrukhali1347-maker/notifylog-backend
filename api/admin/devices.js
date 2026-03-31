const { loadDb } = require("../../lib/db");

module.exports = (req, res) => {
  const db = loadDb();
  const devices = Object.entries(db.devices).map(([id, d]) => ({
    deviceId: id,
    ...d,
  }));
  devices.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  res.json({ devices });
};
