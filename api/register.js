const { v4: uuidv4 } = require("uuid");
const { loadDb, saveDb } = require("../lib/db");

module.exports = (req, res) => {
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
  res.json({ deviceId });
};
