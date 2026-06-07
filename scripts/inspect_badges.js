const mongoose = require("mongoose");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd());

const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB || undefined;

function requiredEnv(name) {
  if (!process.env[name]) throw new Error(`${name} is not configured.`);
}

function isTutorialBadge(badge) {
  if (!badge) return false;
  const id = String(badge.id || "");
  const label = String(badge.label || "");
  const sublabel = String(badge.sublabel || "");

  return id.startsWith("tutorial-")
    || sublabel === "Tutorial Mode"
    || label === "Time To Begin"
    || label === "Challenge Role";
}

function badgeKey(badge) {
  if (!badge) return "";
  return String(badge.id || badge.label || "").trim().toLowerCase();
}

async function main() {
  requiredEnv("MONGODB_URI");

  console.log("Connecting to MongoDB...");
  await mongoose.connect(mongoUri, mongoDbName ? { dbName: mongoDbName } : undefined);
  console.log("Connected.\n");

  const membersCollection = mongoose.connection.collection("members");

  // 1) หาผู้เล่นที่มี tutorial badge
  console.log("=== 1) ผู้เล่นที่มี Badge จาก Tutorial Mode ===\n");

  const cursor = membersCollection.find(
    {},
    {
      projection: {
        discordId: 1,
        name: 1,
        username: 1,
        "discordData.username": 1,
        profileAchievements: 1,
      },
    }
  );

  const tutorialPlayers = [];
  const duplicatePlayers = [];

  for await (const member of cursor) {
    const achievements = member.profileAchievements || [];

    // Check tutorial badges
    const tutorialBadges = achievements.filter(isTutorialBadge);
    if (tutorialBadges.length > 0) {
      tutorialPlayers.push({
        discordId: member.discordId || "(no discordId)",
        name: member.name || member.username || member.discordData?.username || "(unknown)",
        badgeCount: tutorialBadges.length,
        badges: tutorialBadges.map((b) => ({
          id: b.id || "(no id)",
          label: b.label || "(no label)",
          sublabel: b.sublabel || "(no sublabel)",
          kind: b.kind || "(no kind)",
          awardedAt: b.awardedAt || null,
        })),
      });
    }

    // Check duplicate badges
    const seen = new Map(); // key -> count
    for (const badge of achievements) {
      const key = badgeKey(badge);
      if (!key) continue;
      seen.set(key, (seen.get(key) || 0) + 1);
    }

    const duplicates = [];
    for (const [key, count] of seen.entries()) {
      if (count > 1) {
        const matching = achievements.filter((b) => badgeKey(b) === key);
        duplicates.push({
          key,
          count,
          badges: matching.map((b) => ({
            id: b.id || "(no id)",
            label: b.label || "(no label)",
            sublabel: b.sublabel || "(no sublabel)",
            kind: b.kind || "(no kind)",
            awardedAt: b.awardedAt || null,
          })),
        });
      }
    }

    if (duplicates.length > 0) {
      duplicatePlayers.push({
        discordId: member.discordId || "(no discordId)",
        name: member.name || member.username || member.discordData?.username || "(unknown)",
        totalAchievements: achievements.length,
        duplicateGroups: duplicates,
      });
    }
  }

  // Report 1: Tutorial badges
  if (tutorialPlayers.length === 0) {
    console.log("ไม่พบผู้เล่นที่มี Tutorial Badge\n");
  } else {
    console.log(`พบ ${tutorialPlayers.length} คน ที่มี Tutorial Badge:\n`);
    for (const p of tutorialPlayers) {
      console.log(`- ${p.name} (discordId: ${p.discordId}) — ${p.badgeCount} badge(s)`);
      for (const b of p.badges) {
        console.log(`    • [${b.id}] "${b.label}" (${b.sublabel}) | kind=${b.kind} | awardedAt=${b.awardedAt}`);
      }
      console.log();
    }
  }

  // Report 2: Duplicate badges
  console.log("\n=== 2) ผู้เล่นที่มี Badge ซ้ำกันใน profileAchievements ===\n");

  if (duplicatePlayers.length === 0) {
    console.log("ไม่พบผู้เล่นที่มี Badge ซ้ำกัน\n");
  } else {
    console.log(`พบ ${duplicatePlayers.length} คน ที่มี Badge ซ้ำกัน:\n`);
    for (const p of duplicatePlayers) {
      console.log(`- ${p.name} (discordId: ${p.discordId}) — ${p.totalAchievements} badges total`);
      for (const group of p.duplicateGroups) {
        console.log(`    • ซ้ำ "${group.key}" ${group.count} อัน:`);
        for (const b of group.badges) {
          console.log(`        - [${b.id}] "${b.label}" (${b.sublabel}) | kind=${b.kind} | awardedAt=${b.awardedAt}`);
        }
      }
      console.log();
    }
  }

  // Summary
  console.log("=== สรุป ===");
  console.log(`Tutorial Badge holders: ${tutorialPlayers.length} คน`);
  console.log(`Duplicate Badge holders: ${duplicatePlayers.length} คน`);

  await mongoose.connection.close();
  console.log("\nDisconnected.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
