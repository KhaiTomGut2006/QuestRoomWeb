import mongoose from "mongoose";

const CourseConfigSchema = new mongoose.Schema({
  sheetTitle: { type: String, required: true, unique: true },
  courseName: { type: String, required: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true, collection: "discordcourseconfigs" });

CourseConfigSchema.index({ isActive: 1, courseName: 1, _id: 1 });

export default mongoose.models.DiscordCourseConfig || mongoose.model("DiscordCourseConfig", CourseConfigSchema);
