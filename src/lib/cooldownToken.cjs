const { createHmac, randomBytes, timingSafeEqual } = require("node:crypto");

const MAX_REDUCTION_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 30 * 1000;

function getSecret() {
  return String(process.env.NEXTAUTH_SECRET || "").trim();
}

function sign(encodedPayload, secret) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function issueCooldownToken({ discordId, milliseconds }) {
  const secret = getSecret();
  const normalizedDiscordId = String(discordId || "").trim();
  const normalizedMs = Math.min(MAX_REDUCTION_MS, Math.max(0, Number(milliseconds) || 0));
  if (!secret || !normalizedDiscordId || !normalizedMs) return "";

  const encodedPayload = Buffer.from(JSON.stringify({
    discordId: normalizedDiscordId,
    milliseconds: normalizedMs,
    expiresAt: Date.now() + TOKEN_TTL_MS,
    nonce: randomBytes(16).toString("base64url")
  })).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

function verifyCooldownToken(token, expectedDiscordId) {
  const secret = getSecret();
  const [encodedPayload, signature] = String(token || "").split(".");
  if (!secret || !encodedPayload || !signature || !safeEqual(signature, sign(encodedPayload, secret))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    const milliseconds = Math.min(MAX_REDUCTION_MS, Math.max(0, Number(payload.milliseconds) || 0));
    if (
      String(payload.discordId || "") !== String(expectedDiscordId || "")
      || !milliseconds
      || Number(payload.expiresAt) <= Date.now()
      || !payload.nonce
    ) {
      return null;
    }
    return { ...payload, milliseconds };
  } catch {
    return null;
  }
}

module.exports = { issueCooldownToken, verifyCooldownToken };
