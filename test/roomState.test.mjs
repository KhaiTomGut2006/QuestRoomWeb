import test from "node:test";
import assert from "node:assert/strict";

import { challengeFailureCountForMember, makeRoomKey, parseRoomKey, roomStateForMember } from "../src/lib/roomState.mjs";
import { roomProgressStepLabel } from "../src/lib/roomProgress.mjs";

test("normalizes room key and failure count for current stage", () => {
  const member = {
    stage: "stage-1",
    challengeFailureStage: "stage-1",
    challengeFailureCount: 2
  };

  assert.equal(challengeFailureCountForMember(member), 2);
  assert.equal(makeRoomKey(member.stage, member.challengeFailureCount), "stage-1::fail-2");
  assert.deepEqual(parseRoomKey("stage-1::fail-2"), { stage: "stage-1", failureCount: 2 });

  const roomState = roomStateForMember(member);
  assert.equal(roomState.roomKey, "stage-1::fail-2");
  assert.equal(roomState.failureCount, 2);
});

test("room progress labels the second failure subroom as II", () => {
  const levels = [
    { roomKey: "stage-1", stageId: "stage-1", kind: "main", failureCount: 0, name: "Summarize & Planning Idea" },
    { roomKey: "stage-1::fail-1", stageId: "stage-1", kind: "challenge-subroom", failureCount: 1, isSubroom: true, name: "Summarize & Planning Idea-I" },
    { roomKey: "stage-1::fail-2", stageId: "stage-1", kind: "challenge-subroom", failureCount: 2, isSubroom: true, name: "Summarize & Planning Idea-II" }
  ];

  assert.equal(roomProgressStepLabel(levels, 0), "1");
  assert.equal(roomProgressStepLabel(levels, 1), "I");
  assert.equal(roomProgressStepLabel(levels, 2), "II");
});
