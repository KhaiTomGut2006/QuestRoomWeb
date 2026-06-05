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

const ChallengeRewardSchema = new mongoose.Schema({
  id:       { type: String, default: '' },
  label:    { type: String, default: '' },
  image:    { type: String, default: '' },
  quantity: { type: Number, default: 1 },
  kind:     { type: String, default: 'item' },
}, { _id: false });

const ChallengeInfoSchema = new mongoose.Schema({
  title:       { type: String, default: '' },
  description: { type: String, default: '' },
  videoUrl:    { type: String, default: '' },
  videoPath:   { type: String, default: '' },
  videoContentType: { type: String, default: '' },
  rewards:     { type: [ChallengeRewardSchema], default: [] },
}, { _id: false });

const LevelSchema = new mongoose.Schema({
  stageId:  { type: String, required: true, unique: true },
  name:     { type: String, required: true },
  order:    { type: Number, required: true },
  npcShop:  { type: [ShopItemSchema], default: [] },
  boxDrops: { type: [BoxDropSchema],  default: [] },
  npcSpawns:{ type: [NpcSpawnSchema], default: [] },
  challengeInfo: { type: ChallengeInfoSchema, default: () => ({}) },
}, { collection: "levels" });

export default mongoose.models.Level || mongoose.model("Level", LevelSchema);
