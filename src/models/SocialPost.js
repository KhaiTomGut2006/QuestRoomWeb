import mongoose from "mongoose";

const QuestEvidenceSchema = new mongoose.Schema(
  {
    url: String,
    pathname: String,
    contentType: String,
    size: Number,
    originalName: String
  },
  { _id: false }
);

const BadgeSchema = new mongoose.Schema(
  {
    id: String,
    label: String,
    sublabel: String,
    kind: String,
    icon: String,
    awardedAt: Date
  },
  { _id: false }
);

const SocialPostAuthorSchema = new mongoose.Schema(
  {
    id: String,
    name: String,
    username: String,
    avatar: String
  },
  { _id: false }
);

const SocialPostSchema = new mongoose.Schema(
  {
    postId: { type: String, required: true, unique: true, index: true },
    authorId: { type: String, required: true, index: true },
    author: SocialPostAuthorSchema,
    title: String,
    description: String,
    difficulty: String,
    reward: Number,
    npcType: String,
    npcName: String,
    npcCharacter: String,
    source: { type: String, default: "npc-quest", index: true },
    postText: { type: String, default: "" },
    badge: BadgeSchema,
    evidence: QuestEvidenceSchema,
    likes: { type: [String], default: [] },
    dislikes: { type: [String], default: [] },
    likeCount: { type: Number, default: 0 },
    dislikeCount: { type: Number, default: 0 },
    submittedAt: Date,
    publishedAt: { type: Date, index: true },
    visible: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

SocialPostSchema.index({ visible: 1, publishedAt: -1 });
SocialPostSchema.index({ visible: 1, publishedAt: -1, postId: -1 });
SocialPostSchema.index({ authorId: 1, visible: 1, publishedAt: -1 });
SocialPostSchema.index({ authorId: 1, visible: 1, publishedAt: -1, postId: -1 });

export default mongoose.models.SocialPost || mongoose.model("SocialPost", SocialPostSchema);
