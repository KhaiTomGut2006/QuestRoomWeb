import mongoose from "mongoose";

const JourneyStageSchema = new mongoose.Schema(
  {
    id: String,
    type: String,
    courseId: String,
    eventName: String,
    projectId: String,
    projectDbId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    projectTitle: String,
    teamName: String,
    label: String,
    sublabel: String,
    tone: String,
    source: String,
    refId: String,
    createdAt: Date,
    updatedAt: Date
  },
  { _id: false }
);

const QuestSchema = new mongoose.Schema(
  {
    current: { type: String, default: "Find the quiet corner" },
    status: { type: String, default: "active" },
    completed: { type: [String], default: [] },
    cooldownUntil: Date,
    costMultiplier: { type: Number, default: 1 }
  },
  { _id: false }
);

const PositionSchema = new mongoose.Schema(
  {
    x: { type: Number, default: 50 },
    y: { type: Number, default: 70 },
    updatedAt: Date
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

const ChallengeSchema = new mongoose.Schema(
  {
    status: String,
    taskId: String,
    taskName: String,
    stage: String,
    cost: Number,
    requestedAt: Date,
    approvedAt: Date,
    badge: BadgeSchema
  },
  { _id: false }
);

const RewardSchema = new mongoose.Schema(
  {
    id: String,
    taskId: String,
    taskName: String,
    badge: BadgeSchema,
    awardedAt: Date,
    seenAt: Date
  },
  { _id: false }
);

const NpcQuestSchema = new mongoose.Schema(
  {
    difficulty:   String,
    title:        String,
    description:  String,
    reward:       Number,
    cancelPenalty:Number,
    npcType:      String,
    npcName:      String,
    npcCharacter: String,
    acceptedAt:   Date,
  },
  { _id: false }
);

const NpcQuestEvidenceSchema = new mongoose.Schema(
  {
    url:          String,
    pathname:     String,
    contentType:  String,
    size:         Number,
    originalName: String
  },
  { _id: false }
);

const NpcQuestSubmissionSchema = new mongoose.Schema(
  {
    id:           String,
    title:        String,
    description:  String,
    difficulty:   String,
    reward:       Number,
    npcType:      String,
    npcName:      String,
    npcCharacter: String,
    evidence:     NpcQuestEvidenceSchema,
    submittedAt:  Date
  },
  { _id: false }
);

const MemberSchema = new mongoose.Schema(
  {
    id: String,
    fullname: String,
    nick: String,
    age: String,
    school: String,
    birthDate: Date,
    mobile: String,
    line: String,
    lineId: String,
    lineName: String,
    lineUserId: String,
    lineVerifiedAt: Date,
    lineVerifiedVia: String,
    lastAuthentication: Date,
    email: String,
    coin: { type: String, default: "1080" },
    code: String,
    member_id: String,
    username: {
      type: String,
      index: { unique: true, sparse: true },
      lowercase: true,
      trim: true,
      match: /^[a-z0-9_.-]{1,64}$/
    },
    usernameUpdatedAt: Date,
    discord_id: { type: String, index: true, sparse: true },
    profileIdentityKey: { type: String, index: true, sparse: true },
    rank: String,
    interest: String,
    experience: String,
    ticket: [String],
    checked_events: { type: [String], default: [] },
    courses: { type: [String], default: [] },
    realName: String,
    nickname: String,
    about: String,
    skills: [
      {
        name: String,
        level: Number
      }
    ],
    profileAchievements: [BadgeSchema],
    journey: { type: [JourneyStageSchema], default: [] },
    profileUrl: String,
    webProfileUrl: String,
    profileProvisioned: { type: Boolean, default: false, index: true },
    profileCreatedAt: Date,
    featuredProjectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    featuredProjectFileId: String,
    evaluations: [mongoose.Schema.Types.Mixed],
    certificates: [mongoose.Schema.Types.Mixed],
    driveFolderId: String,
    courseFolders: [mongoose.Schema.Types.Mixed],
    projects: [mongoose.Schema.Types.Mixed],
    reports: [{ type: mongoose.Schema.Types.ObjectId, ref: "Report" }],
    ball: String,
    discordData: Object,
    questChallengeRequestedAt: Date,
    questChallenge: ChallengeSchema,
    questReward: RewardSchema,
    stage: { type: String, default: "game-demo-1", index: true },
    quest: { type: QuestSchema, default: () => ({}) },
    npcQuest: { type: NpcQuestSchema, default: null },
    npcQuestSubmissions: { type: [NpcQuestSubmissionSchema], default: [] },
    roomPosition: { type: PositionSchema, default: () => ({}) },
    shopCooldownT1: { type: Number, default: 0 },
    shopCooldownT2: { type: Number, default: 0 },
    shopLimitBreak: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

MemberSchema.pre("save", function syncMemberAliases(next) {
  if (!this.realName && this.fullname) this.realName = this.fullname;
  if (!this.fullname && this.realName) this.fullname = this.realName;
  if (!this.nickname && this.nick) this.nickname = this.nick;
  if (!this.nick && this.nickname) this.nick = this.nickname;
  next();
});

export default mongoose.models.Member || mongoose.model("Member", MemberSchema);
