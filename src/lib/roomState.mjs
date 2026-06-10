const DEFAULT_STAGE = "stage-1";
const ROOM_FAILURE_COUNT_MAX = 99;

export function makeRoomKey(stage = DEFAULT_STAGE, failureCount = 0) {
  const stageKey = String(stage || DEFAULT_STAGE).trim().slice(0, 96) || DEFAULT_STAGE;
  const count = Math.min(ROOM_FAILURE_COUNT_MAX, Math.max(0, Number(failureCount) || 0));
  return count > 0 ? `${stageKey}::fail-${count}` : stageKey;
}

export function parseRoomKey(roomKey = DEFAULT_STAGE) {
  const value = String(roomKey || DEFAULT_STAGE).trim().slice(0, 128) || DEFAULT_STAGE;
  const canonical = /^(.+?)::fail-([1-9]\d{0,2})$/i.exec(value);
  if (canonical) {
    return {
      stage: canonical[1].slice(0, 96) || DEFAULT_STAGE,
      failureCount: Math.min(ROOM_FAILURE_COUNT_MAX, Number(canonical[2]) || 0)
    };
  }

  const legacy = /^(.+?):challenge-([2-9]\d{0,2})$/i.exec(value);
  if (legacy) {
    return {
      stage: legacy[1].slice(0, 96) || DEFAULT_STAGE,
      failureCount: Math.min(ROOM_FAILURE_COUNT_MAX, Math.max(0, (Number(legacy[2]) || 1) - 1))
    };
  }

  return { stage: value.slice(0, 96) || DEFAULT_STAGE, failureCount: 0 };
}

export function challengeFailureCountForMember(member, stage = member?.stage || DEFAULT_STAGE) {
  return member?.challengeFailureStage === stage
    ? Math.min(ROOM_FAILURE_COUNT_MAX, Math.max(0, Number(member?.challengeFailureCount) || 0))
    : 0;
}

export function roomStateFor(stage = DEFAULT_STAGE, failureCount = 0) {
  const count = Math.min(ROOM_FAILURE_COUNT_MAX, Math.max(0, Number(failureCount) || 0));
  return {
    stage,
    failureCount: count,
    roomKey: makeRoomKey(stage, count),
    roomLabel: null
  };
}

export function roomStateForMember(member) {
  const stage = member?.stage || DEFAULT_STAGE;
  return roomStateFor(stage, challengeFailureCountForMember(member, stage));
}
