import test from "node:test";
import assert from "node:assert/strict";

import {
  CHALLENGE_BASE_COST,
  CHALLENGE_COST_MULTIPLIER_MAX,
  challengeFailureAppliesToCurrentStage,
  challengeBaseCostForStageNumber,
  challengeCostForStage,
  normalizeChallengeCostMultiplier,
  nextChallengeFailureCostMultiplier,
  resetChallengeCostMultiplier
} from "../src/lib/challengeCost.mjs";
import { roomProgressStepLabel } from "../src/lib/roomProgress.mjs";

test("normalizes missing or invalid multipliers to 1", () => {
  assert.equal(normalizeChallengeCostMultiplier(undefined), 1);
  assert.equal(normalizeChallengeCostMultiplier(null), 1);
  assert.equal(normalizeChallengeCostMultiplier("not-a-number"), 1);
  assert.equal(normalizeChallengeCostMultiplier(Number.NaN), 1);
});

test("normalizes low multipliers to 1", () => {
  assert.equal(normalizeChallengeCostMultiplier(0), 1);
  assert.equal(normalizeChallengeCostMultiplier(-5), 1);
});

test("normalizes string and decimal multipliers to safe integers", () => {
  assert.equal(normalizeChallengeCostMultiplier("3"), 3);
  assert.equal(normalizeChallengeCostMultiplier(2.9), 2);
});

test("caps very high multipliers", () => {
  assert.equal(normalizeChallengeCostMultiplier(10_000), CHALLENGE_COST_MULTIPLIER_MAX);
});

test("increments from clean state on first challenge failure", () => {
  assert.equal(nextChallengeFailureCostMultiplier(undefined), 2);
  assert.equal(nextChallengeFailureCostMultiplier(1), 2);
});

test("increments by one for repeated challenge failures", () => {
  let multiplier = 1;
  multiplier = nextChallengeFailureCostMultiplier(multiplier);
  assert.equal(multiplier, 2);
  multiplier = nextChallengeFailureCostMultiplier(multiplier);
  assert.equal(multiplier, 3);
  multiplier = nextChallengeFailureCostMultiplier(multiplier);
  assert.equal(multiplier, 4);
});

test("does not exceed max multiplier after many failures", () => {
  let multiplier = CHALLENGE_COST_MULTIPLIER_MAX - 1;
  multiplier = nextChallengeFailureCostMultiplier(multiplier);
  assert.equal(multiplier, CHALLENGE_COST_MULTIPLIER_MAX);
  multiplier = nextChallengeFailureCostMultiplier(multiplier);
  assert.equal(multiplier, CHALLENGE_COST_MULTIPLIER_MAX);
});

test("resets multiplier to base value", () => {
  assert.equal(resetChallengeCostMultiplier(), 1);
});

test("applies challenge failure only to the current stage", () => {
  assert.equal(challengeFailureAppliesToCurrentStage("game-demo-1", "game-demo-1"), true);
  assert.equal(challengeFailureAppliesToCurrentStage("game-demo-1", "game-demo-2"), false);
});

test("does not apply challenge failure when stage data is missing", () => {
  assert.equal(challengeFailureAppliesToCurrentStage("game-demo-1", ""), false);
  assert.equal(challengeFailureAppliesToCurrentStage("", "game-demo-1"), false);
  assert.equal(challengeFailureAppliesToCurrentStage(undefined, "game-demo-1"), false);
});

test("calculates base challenge cost by stage number", () => {
  assert.equal(challengeBaseCostForStageNumber(1), CHALLENGE_BASE_COST);
  assert.equal(challengeBaseCostForStageNumber(2), 338);
  assert.equal(challengeBaseCostForStageNumber(3), 456);
  assert.equal(challengeBaseCostForStageNumber(4), 615);
});

test("normalizes invalid stage numbers to first stage base cost", () => {
  assert.equal(challengeBaseCostForStageNumber(undefined), CHALLENGE_BASE_COST);
  assert.equal(challengeBaseCostForStageNumber(0), CHALLENGE_BASE_COST);
  assert.equal(challengeBaseCostForStageNumber(-10), CHALLENGE_BASE_COST);
});

test("calculates final challenge cost from stage base cost and multiplier", () => {
  assert.equal(challengeCostForStage(1, 1), 250);
  assert.equal(challengeCostForStage(1, 3), 750);
  assert.equal(challengeCostForStage(3, 2), 912);
});

test("sublevels keep parent level base cost and only increase multiplier", () => {
  const levelOneBase = challengeBaseCostForStageNumber(1);
  const levelTwoBase = challengeBaseCostForStageNumber(2);

  assert.equal(levelOneBase, 250);
  assert.equal(challengeCostForStage(1, 1), levelOneBase); // Level 1
  assert.equal(challengeCostForStage(1, 2), levelOneBase * 2); // Level 1-I
  assert.equal(challengeCostForStage(1, 3), levelOneBase * 3); // Level 1-II

  assert.equal(levelTwoBase, 338);
  assert.equal(challengeCostForStage(2, 1), levelTwoBase); // Level 2
  assert.equal(challengeCostForStage(2, 2), levelTwoBase * 2); // Level 2-I
  assert.equal(challengeCostForStage(2, 3), levelTwoBase * 3); // Level 2-II
});

test("final challenge cost normalizes invalid multiplier", () => {
  assert.equal(challengeCostForStage(2, undefined), 338);
  assert.equal(challengeCostForStage(2, "bad"), 338);
  assert.equal(challengeCostForStage(2, 0), 338);
});

test("room progress numbers main rooms without counting subrooms", () => {
  const levels = [
    { roomKey: "level-1", stageId: "level-1", kind: "main", failureCount: 0 },
    { roomKey: "level-1::fail-1", stageId: "level-1", kind: "challenge-subroom", failureCount: 1, isSubroom: true },
    { roomKey: "level-1::fail-2", stageId: "level-1", kind: "challenge-subroom", failureCount: 2, isSubroom: true },
    { roomKey: "level-2", stageId: "level-2", kind: "main", failureCount: 0 },
    { roomKey: "level-2::fail-1", stageId: "level-2", kind: "challenge-subroom", failureCount: 1, isSubroom: true },
    { roomKey: "level-3", stageId: "level-3", kind: "main", failureCount: 0 }
  ];

  assert.equal(roomProgressStepLabel(levels, 0), "1");
  assert.equal(roomProgressStepLabel(levels, 1), "I");
  assert.equal(roomProgressStepLabel(levels, 2), "II");
  assert.equal(roomProgressStepLabel(levels, 3), "2");
  assert.equal(roomProgressStepLabel(levels, 4), "I");
  assert.equal(roomProgressStepLabel(levels, 5), "3");
});
