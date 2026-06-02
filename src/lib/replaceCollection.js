import mongoose from "mongoose";

function transactionIsUnsupported(error) {
  return /Transaction numbers are only allowed|replica set member|mongos/i.test(String(error?.message || ""));
}

async function replaceDocuments(Model, documents, session) {
  const options = session ? { session } : undefined;
  await Model.deleteMany({}, options);
  if (documents.length > 0) await Model.insertMany(documents, options);
}

export async function replaceCollectionDocuments(Model, documents) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(() => replaceDocuments(Model, documents, session));
  } catch (error) {
    if (!transactionIsUnsupported(error)) throw error;
    await replaceDocuments(Model, documents);
  } finally {
    await session.endSession();
  }
}
