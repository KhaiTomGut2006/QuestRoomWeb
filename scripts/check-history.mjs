import pkg from "@next/env";
const { loadEnvConfig } = pkg;
import { MongoClient } from "mongodb";

loadEnvConfig(process.cwd());
const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) { console.error("MONGODB_URI not configured"); process.exit(1); }

async function main() {
  const client = new MongoClient(MONGO_URI, { directConnection: true });
  await client.connect();
  const local = client.db("local");

  const oplog = local.collection("oplog.rs");

  // Get latest oplog entries about dekhub.levels
  const entries = await oplog.find({
    $or: [
      { ns: "dekhub.levels" },
      { ns: /levels/ }
    ]
  }).sort({ $natural: -1 }).limit(5).toArray();

  console.log(`Found ${entries.length} oplog entries about levels\n`);
  for (const e of entries) {
    console.log("Op:", e.op, "| Time:", new Date(e.wall?.getTime?.() || 0).toISOString());
    if (e.op === "d") {
      console.log("Deleted:", JSON.stringify(e.o?._id || e.o));
    } else if (e.op === "i") {
      console.log("Inserted doc keys:", Object.keys(e.o || {}));
      console.log("  name:", e.o?.name);
      console.log("  stageId:", e.o?.stageId);
    }
    console.log("---");
  }

  // Also try the current ops
  console.log("\nChecking current in-progress ops...");
  const curOps = await client.db("admin").command({ currentOp: 1 });
  console.log("Current op count:", curOps?.inprog?.length || 0);

  await client.close();
}

main().catch(err => { console.error("Error:", err.message); process.exit(1); });
