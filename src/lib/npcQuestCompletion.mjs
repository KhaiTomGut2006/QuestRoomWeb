export function npcQuestCompletionKeyFromSubmission(submission) {
  if (!submission) return "";
  const difficulty = String(submission.difficulty || "").trim().toLowerCase();
  const title = String(submission.title || "").trim().toLowerCase();
  const npcType = String(submission.npcType || "").trim().toLowerCase();
  const npcCharacter = String(submission.npcCharacter || "").trim().toLowerCase();
  if (!difficulty || !title) return "";
  return [difficulty, title, npcType, npcCharacter].join("::");
}

export function npcQuestCompletionKeyFromQuestData(questData = {}) {
  const difficulty = String(questData.difficulty || "").trim().toLowerCase();
  const title = String(questData.title || "").trim().toLowerCase();
  const npcType = String(questData.npcType || "").trim().toLowerCase();
  const npcCharacter = String(questData.npcCharacter || "").trim().toLowerCase();
  if (!difficulty || !title) return "";
  return [difficulty, title, npcType, npcCharacter].join("::");
}
