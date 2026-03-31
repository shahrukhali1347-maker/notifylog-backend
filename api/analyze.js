const OpenAI = require("openai");
const { loadDb, saveDb } = require("../lib/db");
const { SYSTEM_PROMPT } = require("../lib/prompt");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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

  // Simple rate limit: max 10 requests per hour per device
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const recentRequests = db.logs.filter(
    (l) => l.deviceId === deviceId && l.timestamp > oneHourAgo && l.status === "SUCCESS"
  ).length;

  if (recentRequests >= 10) {
    return res.status(429).json({
      error: "rate_limit",
      message: "Too many requests. Please try again later.",
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
};
