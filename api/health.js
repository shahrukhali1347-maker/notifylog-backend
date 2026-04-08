const { loadDb } = require("../lib/db");
const { cors } = require("../lib/cors");

module.exports = (req, res) => {
  if (cors(req, res)) return;

  const db = loadDb();
  res.json({
    status: "ok",
    devices: Object.keys(db.devices).length,
    totalRequests: db.logs.length,
  });
};
