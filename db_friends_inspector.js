const mongoose = require("mongoose");

async function main() {
  const uri = "mongodb+srv://xynox:yzoQ4mRCaXcGRMMR@dekhub.7xfopzc.mongodb.net/dekhub";
  
  try {
    await mongoose.connect(uri);
    console.log("Connected to MongoDB successfully via Mongoose!");

    const memberSchema = new mongoose.Schema({}, { strict: false, collection: "members" });
    const Member = mongoose.models.Member || mongoose.model("Member", memberSchema);

    const courseSchema = new mongoose.Schema({}, { strict: false, collection: "discordcourseconfigs" });
    const CourseConfig = mongoose.models.DiscordCourseConfig || mongoose.model("DiscordCourseConfig", courseSchema);

    // 1. Inspect active courses in DB
    const activeClasses = await CourseConfig.find({}).lean();
    console.log("\n--- Course Configurations in DB ---");
    console.log(`Total course configs found: ${activeClasses.length}`);
    activeClasses.forEach(c => {
      console.log(`ID: ${c._id}, sheetTitle: ${c.sheetTitle}, courseName: ${c.courseName}, isActive: ${c.isActive}`);
    });

    // 2. Check what courses are present on members
    const allCourses = await Member.distinct("courses");
    console.log("\n--- Unique course codes on members ---");
    console.log(allCourses);

    // 3. Check some sample members with non-empty courses
    const sampleMembers = await Member.find({ courses: { $exists: true, $not: { $size: 0 } } }).limit(5).lean();
    console.log("\n--- Sample members with courses ---");
    sampleMembers.forEach(m => {
      console.log(`Name: ${m.fullname || m.nick || m.realName}, Courses:`, m.courses);
    });

  } catch (error) {
    console.error("Error connecting or querying:", error);
  } finally {
    await mongoose.connection.close();
  }
}

main();
