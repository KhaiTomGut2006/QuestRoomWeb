import mongoose from "mongoose";

const LevelSchema = new mongoose.Schema({
  stageId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  order: { type: Number, required: true }
}, { collection: "levels" });

export default mongoose.models.Level || mongoose.model("Level", LevelSchema);
