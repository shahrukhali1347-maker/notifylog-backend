const { loadDb, saveDb } = require("../../lib/db");
const { cors } = require("../../lib/cors");

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "notifylog-admin-2026";

module.exports = (req, res) => {
  if (cors(req, res)) return;

  // Simple admin auth via header
  const authToken = req.headers["x-admin-token"];
  if (authToken !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized", message: "Invalid admin token" });
  }

  // Handle block/unblock via POST
  if (req.method === "POST" && req.query.action === "block") {
    const deviceId = req.query.deviceId;

    // Prototype pollution guard
    if (!deviceId || deviceId === "__proto__" || deviceId === "constructor" || deviceId === "prototype") {
      return res.status(400).json({ error: "invalid_device_id" });
    }

    const db = loadDb();
    if (db.devices.hasOwnProperty(deviceId)) {
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
