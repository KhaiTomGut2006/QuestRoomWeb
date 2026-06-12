import mongoose from "mongoose";

const ShopItemSchema = new mongoose.Schema({
  itemType: { type: String, required: true },
  itemName: { type: String, default: '' },
  chance:   { type: Number, default: 0 },
  price:    { type: Number, default: 0 },
  maxQty:   { type: Number, default: 1 },
}, { _id: false });

const BoxDropSchema = new mongoose.Schema({
  itemType: { type: String, required: true },
  itemName: { type: String, default: '' },
  chance:   { type: Number, default: 0 },
  coinMin:  { type: Number, default: 0 },
  coinMax:  { type: Number, default: 0 },
}, { _id: false });

const NpcSpawnSchema = new mongoose.Schema({
  npcId:  { type: String, required: true },
  chance: { type: Number, default: 0 },
}, { _id: false });

const UnlockItemSchema = new mongoose.Schema({
  itemType:    { type: String, required: true },
  itemName:    { type: String, default: '' },
  shopChance:  { type: Number, default: 0 },
  boxChance:   { type: Number, default: 0 },
  price:       { type: Number, default: 0 },
  maxQty:      { type: Number, default: 1 },
  shadowImage: { type: String, default: '' },
  image:       { type: String, default: '' },
}, { _id: false });

const UnlockNpcSchema = new mongoose.Schema({
  npcId:       { type: String, required: true },
  name:        { type: String, default: '' },
  spawnChance: { type: Number, default: 0 },
  shadowImage: { type: String, default: '' },
  image:       { type: String, default: '' },
}, { _id: false });

const LevelUnlockSchema = new mongoose.Schema({
  coinReward: { type: Number, default: 0 },
  items:      { type: [UnlockItemSchema], default: [] },
  npcs:       { type: [UnlockNpcSchema], default: [] },
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
  unlocks:  { type: LevelUnlockSchema, default: () => ({}) },
  challengeInfo: { type: ChallengeInfoSchema, default: () => ({}) },
}, { collection: "levels" });

LevelSchema.index({ order: 1, _id: 1 });

export default mongoose.models.Level || mongoose.model("Level", LevelSchema);
