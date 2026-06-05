const path = require("node:path");
const mongoose = require("mongoose");
const { loadEnvConfig } = require("@next/env");
const { HeadObjectCommand, ListObjectsV2Command, S3Client } = require("@aws-sdk/client-s3");

loadEnvConfig(process.cwd());

const args = new Set(process.argv.slice(2));
const getArg = (name, fallback = "") => {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
};

const DRY_RUN = !args.has("--confirm");
const LIMIT = Math.max(1, Number(getArg("--limit", "100")) || 100);
const MAX_KEYS_PER_PREFIX = Math.max(10, Number(getArg("--max-prefix-keys", "200")) || 200);
const MIN_SCORE = Math.min(1, Math.max(0.5, Number(getArg("--min-score", "0.82")) || 0.82));
const ONLY_PREFIX = getArg("--prefix", "");

const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB || undefined;
const publicBase = String(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");

function requiredEnv(name) {
  if (!process.env[name]) throw new Error(`${name} is not configured.`);
}

function encodeKey(key) {
  return encodeURI(key).replace(/%2F/g, "/");
}

function publicUrlForKey(key) {
  return `${publicBase}/${encodeKey(key)}`;
}

function evidenceKeyCandidates(evidence = {}) {
  const candidates = [];
  const pathname = String(evidence.pathname || "").trim();
  if (pathname.startsWith("r2/npc-quests/")) {
    candidates.push(pathname.slice(3));
  }

  const url = String(evidence.url || "").trim();
  try {
    const parsed = new URL(url);
    const decodedPath = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    if (decodedPath.startsWith("npc-quests/")) {
      candidates.push(decodedPath);
    }
  } catch {
    // Some legacy rows contain partial or malformed URLs. Pathname is enough when present.
  }

  return [...new Set(candidates)]
    .filter((key) => key.startsWith("npc-quests/") && !key.includes(".."))
    .filter((key) => !ONLY_PREFIX || key.startsWith(ONLY_PREFIX));
}

function evidencePatch(key) {
  return {
    "evidence.url": publicUrlForKey(key),
    "evidence.pathname": `r2/${key}`
  };
}

function nestedEvidencePatch(basePath, key) {
  return {
    [`${basePath}.url`]: publicUrlForKey(key),
    [`${basePath}.pathname`]: `r2/${key}`
  };
}

function dirnamePrefix(key) {
  const index = key.lastIndexOf("/");
  return index >= 0 ? key.slice(0, index + 1) : "";
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function similarity(a, b) {
  const maxLength = Math.max(a.length, b.length, 1);
  return 1 - (levenshtein(a, b) / maxLength);
}

function chooseClosestKey(candidate, keys) {
  const wantedName = path.basename(candidate);
  const wantedExt = path.extname(candidate).toLowerCase();
  const ranked = keys
    .filter((key) => key.startsWith("npc-quests/"))
    .filter((key) => !wantedExt || path.extname(key).toLowerCase() === wantedExt)
    .map((key) => {
      const score = similarity(wantedName, path.basename(key));
      return { key, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;
  if (best.score >= MIN_SCORE) return best.key;
  if (ranked.length === 1 && best.score >= 0.7) return best.key;
  return null;
}

function getR2Client() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  });
}

const existingKeyCache = new Map();
const prefixListCache = new Map();

async function objectExists(client, key) {
  if (existingKeyCache.has(key)) return existingKeyCache.get(key);
  try {
    await client.send(new HeadObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key
    }));
    existingKeyCache.set(key, true);
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey") {
      existingKeyCache.set(key, false);
      return false;
    }
    throw error;
  }
}

async function listPrefix(client, prefix) {
  if (prefixListCache.has(prefix)) return prefixListCache.get(prefix);
  const result = await client.send(new ListObjectsV2Command({
    Bucket: process.env.R2_BUCKET,
    Prefix: prefix,
    MaxKeys: MAX_KEYS_PER_PREFIX
  }));
  const keys = (result.Contents || []).map((item) => item.Key).filter(Boolean);
  prefixListCache.set(prefix, keys);
  return keys;
}

async function resolveEvidenceKey(client, evidence) {
  const candidates = evidenceKeyCandidates(evidence);
  for (const candidate of candidates) {
    if (await objectExists(client, candidate)) return { key: candidate, reason: "exact" };
  }

  for (const candidate of candidates) {
    const prefix = dirnamePrefix(candidate);
    if (!prefix) continue;
    const keys = await listPrefix(client, prefix);
    const repairedKey = chooseClosestKey(candidate, keys);
    if (repairedKey) return { key: repairedKey, reason: "closest" };
  }

  return null;
}

function needsEvidencePatch(evidence, key) {
  return String(evidence?.url || "") !== publicUrlForKey(key)
    || String(evidence?.pathname || "") !== `r2/${key}`;
}

async function repairSocialPosts(client, SocialPost) {
  const posts = await SocialPost.find({
    $or: [
      { "evidence.pathname": /^r2\/npc-quests\// },
      { "evidence.url": /\/npc-quests\// }
    ]
  })
    .select("_id postId evidence")
    .limit(LIMIT)
    .lean();

  let checked = 0;
  let repaired = 0;
  let unresolved = 0;

  for (const post of posts) {
    checked += 1;
    const resolved = await resolveEvidenceKey(client, post.evidence);
    if (!resolved) {
      unresolved += 1;
      console.log(`[SocialPost] unresolved ${post.postId || post._id}`);
      continue;
    }
    if (!needsEvidencePatch(post.evidence, resolved.key)) continue;

    repaired += 1;
    console.log(`[SocialPost] ${DRY_RUN ? "would repair" : "repair"} ${post.postId || post._id} -> ${resolved.key} (${resolved.reason})`);
    if (!DRY_RUN) {
      await SocialPost.updateOne({ _id: post._id }, { $set: evidencePatch(resolved.key) });
    }
  }

  return { checked, repaired, unresolved };
}

async function repairMembers(client, Member) {
  const members = await Member.find({
    $or: [
      { "questChallenge.evidence.pathname": /^r2\/npc-quests\// },
      { "questChallenge.evidence.url": /\/npc-quests\// },
      { "npcQuestSubmissions.evidence.pathname": /^r2\/npc-quests\// },
      { "npcQuestSubmissions.evidence.url": /\/npc-quests\// }
    ]
  })
    .select("_id discord_id questChallenge.evidence npcQuestSubmissions.id npcQuestSubmissions.evidence")
    .limit(LIMIT)
    .lean();

  let checked = 0;
  let repaired = 0;
  let unresolved = 0;

  for (const member of members) {
    const set = {};

    if (member.questChallenge?.evidence) {
      checked += 1;
      const resolved = await resolveEvidenceKey(client, member.questChallenge.evidence);
      if (resolved && needsEvidencePatch(member.questChallenge.evidence, resolved.key)) {
        Object.assign(set, nestedEvidencePatch("questChallenge.evidence", resolved.key));
        repaired += 1;
        console.log(`[Member] ${DRY_RUN ? "would repair" : "repair"} ${member.discord_id || member._id} questChallenge -> ${resolved.key} (${resolved.reason})`);
      } else if (!resolved) {
        unresolved += 1;
      }
    }

    const submissions = Array.isArray(member.npcQuestSubmissions) ? member.npcQuestSubmissions : [];
    for (let index = 0; index < submissions.length; index += 1) {
      const evidence = submissions[index]?.evidence;
      if (!evidence) continue;
      checked += 1;
      const resolved = await resolveEvidenceKey(client, evidence);
      if (resolved && needsEvidencePatch(evidence, resolved.key)) {
        Object.assign(set, nestedEvidencePatch(`npcQuestSubmissions.${index}.evidence`, resolved.key));
        repaired += 1;
        console.log(`[Member] ${DRY_RUN ? "would repair" : "repair"} ${member.discord_id || member._id} submission ${submissions[index].id || index} -> ${resolved.key} (${resolved.reason})`);
      } else if (!resolved) {
        unresolved += 1;
      }
    }

    if (!DRY_RUN && Object.keys(set).length > 0) {
      await Member.updateOne({ _id: member._id }, { $set: set });
    }
  }

  return { checked, repaired, unresolved };
}

async function main() {
  requiredEnv("MONGODB_URI");
  requiredEnv("R2_ACCOUNT_ID");
  requiredEnv("R2_ACCESS_KEY_ID");
  requiredEnv("R2_SECRET_ACCESS_KEY");
  requiredEnv("R2_BUCKET");
  requiredEnv("R2_PUBLIC_BASE_URL");

  await mongoose.connect(mongoUri, mongoDbName ? { dbName: mongoDbName } : undefined);
  const client = getR2Client();

  const SocialPost = mongoose.models.SocialPost || mongoose.model(
    "SocialPost",
    new mongoose.Schema({}, { strict: false, collection: "socialposts" })
  );
  const Member = mongoose.models.Member || mongoose.model(
    "Member",
    new mongoose.Schema({}, { strict: false, collection: "members" })
  );

  console.log(`${DRY_RUN ? "[DRY RUN]" : "[CONFIRM]"} Repairing R2 evidence paths`);
  console.log(`Limit per collection: ${LIMIT}`);
  if (ONLY_PREFIX) console.log(`Only prefix: ${ONLY_PREFIX}`);

  const socialPosts = await repairSocialPosts(client, SocialPost);
  const members = await repairMembers(client, Member);

  console.log("\nSummary");
  console.log({ socialPosts, members });
  if (DRY_RUN) {
    console.log("\nNo changes were made. Run with --confirm to apply.");
    console.log("Example: node scripts/repair_r2_evidence_paths.js --limit=100 --confirm");
  }

  await mongoose.connection.close();
}

main().catch(async (error) => {
  console.error("Fatal repair error:", error);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
