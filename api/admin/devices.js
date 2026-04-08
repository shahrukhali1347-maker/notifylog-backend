const { loadDb, saveDb } = require("../../lib/db");
const { cors } = require("../../lib/cors");

module.exports = (req, res) => {
  if (cors(req, res)) return;

  // Handle block/unblock via POST with deviceId in query
  if (req.method === "POST" && req.query.action === "block") {
    const db = loadDb();
    const deviceId = req.query.deviceId;
    if (db.devices[deviceId]) {
      db.devices[deviceId].isBlocked = !!req.body.blocked;
      saveDb(db);
      return res.json({ success: true });
    }
    return res.status(404).json({ error: "Device not found" });
  }

  const db = loadDb();
  const devices = Object.entries(db.devices).map(([id, d]) => ({
    deviceId: id,
    ...d,
  }));
  devices.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  res.json({ devices });
};
