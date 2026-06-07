export const CHALLENGE_COST_MULTIPLIER_MIN = 1;
export const CHALLENGE_COST_MULTIPLIER_MAX = 100;
export const CHALLENGE_BASE_COST = 250;
export const CHALLENGE_STAGE_COST_GROWTH = 1.35;

export function normalizeChallengeCostMultiplier(value) {
  const multiplier = Math.floor(Number(value));
  if (!Number.isFinite(multiplier)) return CHALLENGE_COST_MULTIPLIER_MIN;
  return Math.min(
    CHALLENGE_COST_MULTIPLIER_MAX,
    Math.max(CHALLENGE_COST_MULTIPLIER_MIN, multiplier)
  );
}

export function nextChallengeFailureCostMultiplier(value) {
  return Math.min(
    CHALLENGE_COST_MULTIPLIER_MAX,
    normalizeChallengeCostMultiplier(value) + 1
  );
}

export function resetChallengeCostMultiplier() {
  return CHALLENGE_COST_MULTIPLIER_MIN;
}

export function challengeFailureAppliesToCurrentStage(challengeStage, currentStage) {
  return Boolean(challengeStage && currentStage && challengeStage === currentStage);
}

export function challengeBaseCostForStageNumber(stageNumber) {
  const safeStageNumber = Math.max(1, Math.floor(Number(stageNumber)) || 1);
  return Math.round(
    CHALLENGE_BASE_COST * Math.pow(CHALLENGE_STAGE_COST_GROWTH, safeStageNumber - 1)
  );
}

export function challengeCostForStage(stageNumber, multiplier = CHALLENGE_COST_MULTIPLIER_MIN) {
  return challengeBaseCostForStageNumber(stageNumber) * normalizeChallengeCostMultiplier(multiplier);
}
