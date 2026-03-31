const { loadDb } = require("../lib/db");

module.exports = (req, res) => {
  const db = loadDb();
  res.json({
    status: "ok",
    devices: Object.keys(db.devices).length,
    totalRequests: db.logs.length,
  });
};
