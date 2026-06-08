import pkg from "@next/env";
const { loadEnvConfig } = pkg;
import mongoose from "mongoose";

loadEnvConfig(process.cwd());

const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) { console.error("MONGODB_URI not configured"); process.exit(1); }

function eq(count, index) {
  const base = Math.floor((100 / count) * 10) / 10;
  return index === count - 1 ? Math.round((100 - base * (count - 1)) * 10) / 10 : base;
}

function buildLevels() {
  const itemDefs = {
    "quest-scroll-normal": { name: "Quest Roll Normal" },
    "quest-scroll-rare": { name: "Quest Roll Rare" },
    "quest-scroll-epic": { name: "Quest Roll Epic" },
    "chest-small": { name: "Chest Small" },
    "chest-medium": { name: "Chest Medium" },
    "chest-large": { name: "Chest Large" },
    "cooldown-minute": { name: "Cooldown -1 min Lv1" },
    "cooldown-minute-lv2": { name: "Cooldown -1 min Lv2" },
    "limit-break": { name: "Limit Break" },
    "asset-ticket": { name: "Asset Ticket", price: 550 },
    "accessory-mrx": { name: "Accessory: Mr. X" },
    "accessory-mrx-red-eye": { name: "Accessory: Mr. X Red Eye" },
    "accessory-mrx-glasses": { name: "Accessory: Mr. X with Glasses" },
    "accessory-ppuk": { name: "Accessory: P'Puk" },
  };

  const stageDefs = [
    { name: "Game Demo - I", coin: 1000, npcs: ["chest","quest-easy","stupid-quest"], items: ["quest-scroll-normal","chest-small","cooldown-minute"], boxCoinPct: 20, coinMin: 50, coinMax: 150 },
    { name: "Game Demo - II", coin: 1500, npcs: ["shop","quest-medium"], items: ["quest-scroll-rare","chest-medium","accessory-ppuk","asset-ticket"], boxCoinPct: 15, coinMin: 100, coinMax: 300 },
    { name: "Game Demo - III", coin: 2000, npcs: ["hints","gambling"], items: ["quest-scroll-epic","chest-large","cooldown-minute-lv2"], boxCoinPct: 15, coinMin: 150, coinMax: 400 },
    { name: "Game Demo - IV", coin: 2500, npcs: ["quest-hard"], items: ["limit-break","accessory-mrx"], boxCoinPct: 12, coinMin: 200, coinMax: 500 },
    { name: "Game Demo - V", coin: 3000, npcs: [], items: ["accessory-mrx-red-eye","accessory-mrx-glasses"], boxCoinPct: 12, coinMin: 300, coinMax: 600 },
    { name: "Hamstore To Make Money", coin: 5000, npcs: [], items: [], boxCoinPct: 10, coinMin: 400, coinMax: 1000 },
  ];

  const allNpcs = [];
  const allItems = [];
  const levels = [];

  for (const def of stageDefs) {
    const newNpcs = def.npcs.map(id => ({ npcId: id, name: id }));
    const newItems = def.items.map(id => {
      const meta = itemDefs[id] || {};
      return { itemType: id, itemName: meta.name || id, price: meta.price || 0, maxQty: 1 };
    });
    allNpcs.push(...newNpcs);
    allItems.push(...newItems);

    const npcSpawns = allNpcs.map((npc, i) => ({ npcId: npc.npcId, chance: eq(allNpcs.length, i) }));
    const npcShop = allItems.map((item, i) => ({ itemType: item.itemType, itemName: item.itemName, chance: eq(allItems.length, i), price: item.price, maxQty: item.maxQty }));

    const coinPct = def.boxCoinPct;
    const itemPctTotal = 100 - coinPct;
    const itemBoxDrops = allItems.map((item, i) => ({ itemType: item.itemType, itemName: item.itemName, chance: eq(allItems.length, i) }));
    const itemRawSum = itemBoxDrops.reduce((s, d) => s + d.chance, 0) || 1;
    const scale = itemPctTotal / itemRawSum;
    let sum = 0;
    for (let i = 0; i < itemBoxDrops.length; i++) {
      const raw = i === itemBoxDrops.length - 1 ? itemPctTotal - sum : Math.round(itemBoxDrops[i].chance * scale * 10) / 10;
      itemBoxDrops[i].chance = +raw.toFixed(1);
      sum += itemBoxDrops[i].chance;
    }

    const boxDrops = [
      ...itemBoxDrops,
      { itemType: "coins", itemName: "Coins", chance: coinPct, coinMin: def.coinMin, coinMax: def.coinMax },
    ];

    levels.push({
      stageId: `game-demo-${levels.length + 1}`,
      name: def.name,
      order: levels.length,
      unlocks: { coinReward: def.coin, items: newItems, npcs: newNpcs },
      npcSpawns,
      npcShop,
      boxDrops,
      challengeInfo: { title: def.name, description: "", videoUrl: "", videoPath: "", videoContentType: "" },
    });
  }
  return levels;
}

async function main() {
  const levels = buildLevels();
  console.log(`\n📦 Writing ${levels.length} levels to MongoDB...\n`);
  for (const lv of levels) {
    console.log(`  ${lv.name} — ${lv.unlocks.npcs.length} NPCs, ${lv.unlocks.items.length} items, ${lv.unlocks.coinReward} coins`);
  }
  await mongoose.connect(MONGO_URI, { bufferCommands: false, serverSelectionTimeoutMS: 5000 });
  const collection = mongoose.connection.collection("levels");
  await collection.deleteMany({});
  if (levels.length > 0) await collection.insertMany(levels);
  console.log(`\n✅ Saved ${levels.length} levels!\n`);
  await mongoose.disconnect();
}

main().catch(err => { console.error("Error:", err.message); process.exit(1); });
