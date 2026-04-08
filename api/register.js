const { v4: uuidv4 } = require("uuid");
const { loadDb, saveDb } = require("../lib/db");
const { cors } = require("../lib/cors");

module.exports = (req, res) => {
  try {
    if (cors(req, res)) return;

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { deviceName } = req.body || {};
    const deviceId = uuidv4();
    const db = loadDb();

    db.devices[deviceId] = {
      deviceName: deviceName || "Unknown Device",
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      totalRequests: 0,
      isBlocked: false,
    };

    saveDb(db);
    console.log(`Device registered: ${deviceId} (${deviceName})`);
    return res.json({ deviceId });
  } catch (error) {
    console.error("Register error:", error.message || error);
    return res.status(500).json({ error: "registration_failed", message: error.message });
  }
};
