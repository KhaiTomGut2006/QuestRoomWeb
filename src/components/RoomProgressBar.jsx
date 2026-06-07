"use client";

import { roomProgressStepLabel } from "@/lib/roomProgress.mjs";

export default function RoomProgressBar({
  levels,
  activeRoomKey,
  viewedRoomKey,
  activeStage = "",
  viewedStage = "",
  onSelectRoom,
  disabled
}) {
  if (!levels || levels.length === 0) return null;

  const activeKey = activeRoomKey || activeStage;
  const viewedKey = viewedRoomKey || viewedStage || activeKey;
  const activeIndex  = levels.findIndex((l) => (l.roomKey || l.stageId) === activeKey);

  return (
    <nav className="room-progress-bar" aria-label="Room progress">
      {/* Connecting track behind dots */}
      <div className="room-progress-track" aria-hidden="true">
        <div
          className="room-progress-fill"
          style={{ width: activeIndex >= 0 ? `${(activeIndex / Math.max(levels.length - 1, 1)) * 100}%` : "0%" }}
        />
      </div>

      {levels.map((level, index) => {
        const isCompleted = index < activeIndex;
        const key = level.roomKey || level.stageId;
        const isActive    = key === activeKey;
        const isViewed    = key === viewedKey;

        let cls = "room-step";
        if (isCompleted) cls += " is-completed";
        if (isActive)    cls += " is-active";
        if (isViewed && !isActive) cls += " is-viewed";
        if (level.isSubroom || level.kind === "challenge-subroom") cls += " is-subroom";

        return (
          <button
            key={key}
            className={cls}
            type="button"
            disabled={disabled}
            onClick={() => onSelectRoom?.(key)}
            aria-label={`ห้อง ${level.name}${isActive ? " (ห้องของคุณ)" : ""}${isViewed && !isActive ? " (กำลังดู)" : ""}`}
            aria-current={isViewed ? "step" : undefined}
          >
            <span className="room-step-dot">
              {isCompleted ? (
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <polyline points="4,10 8,14 16,6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span className="room-step-number">
                  {roomProgressStepLabel(levels, index)}
                </span>
              )}
            </span>
            <span className="room-step-label">{level.name}</span>
          </button>
        );
      })}
    </nav>
  );
}
