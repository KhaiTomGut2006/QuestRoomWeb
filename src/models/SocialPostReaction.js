import mongoose from "mongoose";

const SocialPostReactionSchema = new mongoose.Schema(
  {
    postId: { type: String, required: true },
    userId: { type: String, required: true },
    reaction: { type: String, enum: ["like", "dislike"], required: true },
    reactedAt: { type: Date, default: Date.now }
  },
  { timestamps: true, collection: "social_post_reactions" }
);

SocialPostReactionSchema.index({ postId: 1, userId: 1 }, { unique: true });
SocialPostReactionSchema.index({ postId: 1, reaction: 1 });
SocialPostReactionSchema.index({ userId: 1, updatedAt: -1 });

export default mongoose.models.SocialPostReaction || mongoose.model("SocialPostReaction", SocialPostReactionSchema);
