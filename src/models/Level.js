import mongoose from "mongoose";

const ShopItemSchema = new mongoose.Schema({
  itemType: { type: String, required: true },
  itemName: { type: String, default: '' },
  price:    { type: Number, default: 0 },
  maxQty:   { type: Number, default: 1 },
}, { _id: false });

const BoxDropSchema = new mongoose.Schema({
  itemType: { type: String, required: true },
  itemName: { type: String, default: '' },
  chance:   { type: Number, default: 0 },
}, { _id: false });

const NpcSpawnSchema = new mongoose.Schema({
  npcId:  { type: String, required: true },
  chance: { type: Number, default: 0 },
}, { _id: false });

const LevelSchema = new mongoose.Schema({
  stageId:  { type: String, required: true, unique: true },
  name:     { type: String, required: true },
  order:    { type: Number, required: true },
  npcShop:  { type: [ShopItemSchema], default: [] },
  boxDrops: { type: [BoxDropSchema],  default: [] },
  npcSpawns:{ type: [NpcSpawnSchema], default: [] },
}, { collection: "levels" });

LevelSchema.index({ order: 1 });

export default mongoose.models.Level || mongoose.model("Level", LevelSchema);
