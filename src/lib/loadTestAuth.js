import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

function loadTestAuthEnabled() {
  return process.env.LOAD_TEST_AUTH_ENABLED === "true"
    && Boolean(process.env.LOAD_TEST_AUTH_TOKEN);
}

function loadTestSession(request) {
  if (!loadTestAuthEnabled()) return null;
  const token = request?.headers?.get("x-load-test-token") || "";
  if (token !== process.env.LOAD_TEST_AUTH_TOKEN) return null;
  const discordId = String(request?.headers?.get("x-load-test-user-id") || "").trim().slice(0, 120);
  if (!discordId || !discordId.startsWith("loadtest-")) return null;
  return {
    user: {
      discordId,
      discordProfile: {
        id: discordId,
        username: discordId,
        globalName: `Load Test ${discordId.replace(/^loadtest-/, "")}`,
        avatarUrl: ""
      }
    },
    loadTest: true
  };
}

export async function getPlayerSession(request) {
  const session = await getServerSession(authOptions);
  if (session?.user?.discordId) return session;
  return loadTestSession(request);
}

export function getPlayerDiscordId(session) {
  return session?.user?.discordId ? String(session.user.discordId) : "";
}
