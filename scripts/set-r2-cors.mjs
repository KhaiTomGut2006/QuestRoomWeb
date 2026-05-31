/**
 * Run once to configure CORS on the Cloudflare R2 bucket.
 * Usage: node scripts/set-r2-cors.mjs
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3";

// Minimal .env.local parser (no dotenv dependency)
const __dir = path.dirname(fileURLToPath(import.meta.url));
for (const envFile of ["../.env.local", "../.env"]) {
  const envPath = path.resolve(__dir, envFile);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}

const accountId = process.env.R2_ACCOUNT_ID;
const bucket    = process.env.R2_BUCKET;

if (!accountId || !bucket || !process.env.R2_ACCESS_KEY_ID) {
  console.error("❌  R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_BUCKET not set in .env.local");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const corsRule = {
  AllowedOrigins: [
    "https://api.hamsterquest.com",
    "https://hamsterhub.co",
    "https://www.hamsterhub.co",
    "http://localhost:3000",
    "http://localhost:3001",
  ],
  AllowedMethods: ["PUT", "GET", "HEAD"],
  AllowedHeaders: ["Content-Type", "Content-Length"],
  MaxAgeSeconds: 3600,
};

console.log(`Setting CORS on bucket: ${bucket}`);
console.log("Origins:", corsRule.AllowedOrigins.join(", "));

await client.send(new PutBucketCorsCommand({
  Bucket: bucket,
  CORSConfiguration: { CORSRules: [corsRule] },
}));

const { CORSRules } = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
console.log("✅  CORS set successfully:");
console.log(JSON.stringify(CORSRules, null, 2));
