import mongoose from "mongoose";

const QuestTemplateSchema = new mongoose.Schema({
  difficulty: { type: String, enum: ["easy", "medium", "hard"], required: true },
  title:       { type: String, required: true },
  description: { type: String, required: true },
  rewardMin:   { type: Number, default: 50 },
  rewardMax:   { type: Number, default: 100 },
  npcCharacter: { type: String, default: null }, // optional: overrides visiting NPC image
}, { timestamps: true, collection: "quest_templates" });

export default mongoose.models.QuestTemplate ||
  mongoose.model("QuestTemplate", QuestTemplateSchema);
