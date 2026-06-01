import { createHmac } from "node:crypto";

const DEV_SOCKET_TOKEN_TTL_MS = 10 * 60 * 1000;

function tokenSecret() {
  return String(process.env.NEXTAUTH_SECRET || "local-dev-secret");
}

export function createDevSocketToken(discordId) {
  const payload = Buffer.from(JSON.stringify({
    discordId: String(discordId || ""),
    expiresAt: Date.now() + DEV_SOCKET_TOKEN_TTL_MS
  })).toString("base64url");
  const signature = createHmac("sha256", tokenSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
