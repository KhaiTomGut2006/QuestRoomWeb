import DiscordProvider from "next-auth/providers/discord";
import { upsertMemberFromDiscord } from "@/lib/player";

export const authConfigured = Boolean(
  process.env.DISCORD_CLIENT_ID &&
    process.env.DISCORD_CLIENT_SECRET &&
    process.env.NEXTAUTH_SECRET
);

export const authOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID || "missing-client-id",
      clientSecret: process.env.DISCORD_CLIENT_SECRET || "missing-client-secret",
      authorization: {
        params: { scope: "identify email" }
      }
    })
  ],
  callbacks: {
    async signIn({ profile }) {
      await upsertMemberFromDiscord(profile);
      return true;
    },
    async jwt({ token, account, profile }) {
      if (profile?.id) {
        token.discordId = profile.id;
        token.discordProfile = {
          id: profile.id,
          username: profile.username,
          globalName: profile.global_name || profile.globalName || "",
          avatarUrl: profile.image_url || ""
        };
      }
      if (account?.provider === "discord") token.provider = "discord";
      return token;
    },
    async session({ session, token }) {
      session.user.discordId = token.discordId || "";
      session.user.discordProfile = token.discordProfile || null;
      return session;
    }
  },
  pages: {
    signIn: "/"
  }
};
