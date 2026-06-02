import nextEnv from "@next/env";
import mongoose from "mongoose";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI is not configured");
}

await mongoose.connect(uri, {
  bufferCommands: false,
  dbName: process.env.MONGODB_DB || undefined
});

const db = mongoose.connection.db;
const members = db.collection("members");
const levels = db.collection("levels");
const questTemplates = db.collection("quest_templates");
const hintTemplates = db.collection("hint_templates");
const courseConfigs = db.collection("discordcourseconfigs");

await Promise.all([
  members.createIndex({ "npcQuestSubmissions.id": 1 }, { name: "npcQuestSubmissions.id_1" }),
  members.createIndex({ "profileAchievements.label": 1 }, { name: "profileAchievements.label_1" }),
  members.createIndex({ courses: 1 }, { name: "courses_1" }),
  members.createIndex({ stage: 1, "roomPosition.updatedAt": -1 }, { name: "stage_1_roomPosition.updatedAt_-1" }),
  levels.createIndex({ order: 1 }, { name: "order_1" }),
  questTemplates.createIndex({ difficulty: 1, createdAt: 1 }, { name: "difficulty_1_createdAt_1" }),
  hintTemplates.createIndex({ order: 1, createdAt: 1 }, { name: "order_1_createdAt_1" }),
  courseConfigs.createIndex({ isActive: 1, courseName: 1 }, { name: "isActive_1_courseName_1" })
]);

console.log("Performance indexes are ready.");
await mongoose.disconnect();
