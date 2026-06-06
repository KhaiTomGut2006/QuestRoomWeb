import mongoose from "mongoose";

const HintTemplateSchema = new mongoose.Schema({
  title:   { type: String, required: true },   // problem title shown in choice list
  content: { type: String, required: true },   // what Smith says / the actual hint
  cost:    { type: Number, default: 500 },
  order:   { type: Number, default: 0 },
}, { timestamps: true, collection: "hint_templates" });

HintTemplateSchema.index({ order: 1, createdAt: 1, _id: 1 });

export default mongoose.models.HintTemplate ||
  mongoose.model("HintTemplate", HintTemplateSchema);
