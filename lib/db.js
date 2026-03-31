const fs = require("fs");
const path = require("path");

// Vercel serverless has /tmp for writable storage
const DB_PATH = process.env.VERCEL
  ? path.join("/tmp", "data.json")
  : path.join(__dirname, "..", "data.json");

function loadDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return { devices: {}, logs: [] };
    }
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    return { devices: {}, logs: [] };
  }
}

function saveDb(data) {
  // Keep only last 1000 logs
  if (data.logs && data.logs.length > 1000) {
    data.logs = data.logs.slice(-1000);
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = { loadDb, saveDb };
