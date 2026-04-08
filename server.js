require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

// --- JSON File Database ---
const DB_PATH = path.join(__dirname, "data.json");

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    return { devices: {}, logs: [] };
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function saveDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// --- OpenAI Client ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Middleware ---
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Rate limit per device
const deviceRateLimit = rateLimit({
  windowMs: (parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES) || 60) * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_PER_DEVICE) || 10,
  keyGenerator: (req) => req.headers["x-device-id"] || req.ip,
  message: {
    error: "rate_limit",
    message: "Too many requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- System Prompt ---
const SYSTEM_PROMPT = `You are a personal data analyst. You will receive a JSON array of Android notification records from a user's device. Each record contains fields: appLabel, title, body, postTimeMs, category, and rawExtracted (pre-parsed structured data).

Your task is to return ONLY a valid JSON object (no markdown, no prose) with this schema:
{
  "summary": "<2-3 sentence overall summary>",
  "cards": [
    {
      "appLabel": "<app name>",
      "cardType": "<TRANSACTION|MESSAGE|ALERT|PROMO|DELIVERY|OTHER>",
      "headline": "<one-line insight>",
      "details": "<expanded detail, max 100 words>",
      "metrics": { "<key>": "<value>" },
      "timeRange": "<human-readable time range>"
    }
  ],
  "anomalies": ["<any unusual patterns noted>"],
  "totalNotifications": <int>
}`;

// --- Routes ---

// Device registration
app.post("/api/register", (req, res) => {
  const { deviceName } = req.body;
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
});

// Analyze notifications (main endpoint)
app.post("/api/analyze", deviceRateLimit, async (req, res) => {
  const deviceId = req.headers["x-device-id"];

  if (!deviceId) {
    return res.status(401).json({
      error: "missing_device_id",
      message: "X-Device-Id header is required. Register first via POST /api/register",
    });
  }

  const db = loadDb();
  const device = db.devices[deviceId];

  if (!device) {
    return res.status(401).json({
      error: "unknown_device",
      message: "Device not registered. Call POST /api/register first.",
    });
  }

  if (device.isBlocked) {
    return res.status(403).json({
      error: "device_blocked",
      message: "This device has been blocked.",
    });
  }

  const { notifications } = req.body;

  if (!notifications || !Array.isArray(notifications) || notifications.length === 0) {
    return res.status(400).json({
      error: "invalid_payload",
      message: "Request body must contain a non-empty 'notifications' array.",
    });
  }

  if (notifications.length > 500) {
    return res.status(400).json({
      error: "too_many_notifications",
      message: "Maximum 500 notifications per request.",
    });
  }

  try {
    const userPrompt = `Analyze the following ${notifications.length} notification records:\n\n${JSON.stringify(notifications)}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 4096,
    });

    const content = completion.choices[0]?.message?.content;
    const tokensUsed = completion.usage?.total_tokens || 0;

    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    const parsed = JSON.parse(content);

    // Log success
    device.lastSeenAt = Date.now();
    device.totalRequests++;
    db.logs.push({
      deviceId,
      timestamp: Date.now(),
      notificationCount: notifications.length,
      tokensUsed,
      status: "SUCCESS",
    });

    // Keep only last 1000 logs
    if (db.logs.length > 1000) {
      db.logs = db.logs.slice(-1000);
    }

    saveDb(db);

    console.log(
      `[${deviceId.substring(0, 8)}] Analyzed ${notifications.length} notifications (${tokensUsed} tokens)`
    );

    res.json(parsed);
  } catch (error) {
    const db2 = loadDb();
    db2.logs.push({
      deviceId,
      timestamp: Date.now(),
      notificationCount: notifications.length,
      status: "ERROR",
      error: error.message,
    });
    saveDb(db2);

    console.error(`[${deviceId.substring(0, 8)}] Error:`, error.message);

    if (error.status === 429) {
      return res.status(429).json({
        error: "openai_rate_limit",
        message: "AI service is temporarily overloaded. Try again in a minute.",
      });
    }

    res.status(500).json({
      error: "analysis_failed",
      message: "Failed to analyze notifications. Please try again.",
    });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  const db = loadDb();
  res.json({
    status: "ok",
    devices: Object.keys(db.devices).length,
    totalRequests: db.logs.length,
    uptime: process.uptime(),
  });
});

// Admin: list devices
app.get("/api/admin/devices", (req, res) => {
  const db = loadDb();
  const devices = Object.entries(db.devices).map(([id, d]) => ({
    deviceId: id,
    ...d,
  }));
  devices.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  res.json({ devices });
});

// Admin: view logs for a device
app.get("/api/admin/devices/:deviceId/logs", (req, res) => {
  const db = loadDb();
  const logs = db.logs
    .filter((l) => l.deviceId === req.params.deviceId)
    .reverse()
    .slice(0, 100);
  res.json({ logs });
});

// Admin: block/unblock device
app.post("/api/admin/devices/:deviceId/block", (req, res) => {
  const db = loadDb();
  if (db.devices[req.params.deviceId]) {
    db.devices[req.params.deviceId].isBlocked = !!req.body.blocked;
    saveDb(db);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Device not found" });
  }
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`NotifyLog backend running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
});
