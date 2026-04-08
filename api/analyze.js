const OpenAI = require("openai");
const { loadDb, saveDb } = require("../lib/db");
const { SYSTEM_PROMPT } = require("../lib/prompt");
const { cors } = require("../lib/cors");

module.exports = async (req, res) => {
  try {
    if (cors(req, res)) return;

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const deviceId = req.headers["x-device-id"];

    if (!deviceId) {
      return res.status(401).json({
        error: "missing_device_id",
        message: "X-Device-Id header is required.",
      });
    }

    const db = loadDb();
    let device = db.devices[deviceId];

    // Auto-register if device not found (handles /tmp resets on Vercel)
    if (!device) {
      db.devices[deviceId] = {
        deviceName: "Auto-registered",
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        totalRequests: 0,
        isBlocked: false,
      };
      saveDb(db);
      device = db.devices[deviceId];
    }

    if (device.isBlocked) {
      return res.status(403).json({
        error: "device_blocked",
        message: "This device has been blocked.",
      });
    }

    const { notifications } = req.body || {};

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

    // Sanitize notification fields - only allow expected string/number fields
    const sanitized = notifications.map((n) => ({
      appLabel: String(n.appLabel || "").slice(0, 200),
      title: String(n.title || "").slice(0, 500),
      body: String(n.body || "").slice(0, 2000),
      postTimeMs: Number(n.postTimeMs) || 0,
      category: String(n.category || "unknown").slice(0, 50),
      rawExtracted: String(n.rawExtracted || "{}").slice(0, 1000),
    }));

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const userPrompt = `Analyze the following ${sanitized.length} notification records:\n\n${JSON.stringify(sanitized)}`;

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
      return res.status(500).json({
        error: "empty_response",
        message: "AI returned an empty response. Try again.",
      });
    }

    const parsed = JSON.parse(content);

    // Log success
    try {
      const db2 = loadDb();
      if (db2.devices[deviceId]) {
        db2.devices[deviceId].lastSeenAt = Date.now();
        db2.devices[deviceId].totalRequests++;
      }
      db2.logs.push({
        deviceId,
        timestamp: Date.now(),
        notificationCount: notifications.length,
        tokensUsed,
        status: "SUCCESS",
      });
      if (db2.logs.length > 1000) db2.logs = db2.logs.slice(-1000);
      saveDb(db2);
    } catch (logErr) {
      console.error("Failed to write log:", logErr.message);
    }

    console.log(`[${deviceId.substring(0, 8)}] Analyzed ${notifications.length} notifications (${tokensUsed} tokens)`);

    return res.json(parsed);
  } catch (error) {
    console.error("Analyze error:", error.message || error);

    // Log failure
    try {
      const db = loadDb();
      db.logs.push({
        deviceId: req.headers?.["x-device-id"] || "unknown",
        timestamp: Date.now(),
        notificationCount: req.body?.notifications?.length || 0,
        status: "ERROR",
        error: error.message,
      });
      saveDb(db);
    } catch (logErr) {
      console.error("Failed to write log:", logErr.message);
    }

    if (error.status === 429) {
      return res.status(429).json({
        error: "openai_rate_limit",
        message: "AI service is temporarily overloaded. Try again in a minute.",
      });
    }

    return res.status(500).json({
      error: "analysis_failed",
      message: error.message || "Failed to analyze notifications.",
    });
  }
};
