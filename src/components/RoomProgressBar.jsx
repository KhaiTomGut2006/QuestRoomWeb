"use client";

export default function RoomProgressBar({ levels, activeStage, viewedStage, onSelectRoom, disabled }) {
  if (!levels || levels.length === 0) return null;

  const activeIndex  = levels.findIndex((l) => l.stageId === activeStage);
  const viewedIndex  = levels.findIndex((l) => l.stageId === viewedStage);

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
        const isActive    = level.stageId === activeStage;
        const isViewed    = level.stageId === viewedStage;

        let cls = "room-step";
        if (isCompleted) cls += " is-completed";
        if (isActive)    cls += " is-active";
        if (isViewed && !isActive) cls += " is-viewed";

        return (
          <button
            key={level.stageId}
            className={cls}
            type="button"
            disabled={disabled}
            onClick={() => onSelectRoom?.(level.stageId)}
            aria-label={`ห้อง ${level.name}${isActive ? " (ห้องของคุณ)" : ""}${isViewed && !isActive ? " (กำลังดู)" : ""}`}
            aria-current={isViewed ? "step" : undefined}
          >
            <span className="room-step-dot">
              {isCompleted ? (
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <polyline points="4,10 8,14 16,6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span className="room-step-number">{index + 1}</span>
              )}
            </span>
            <span className="room-step-label">{level.name}</span>
          </button>
        );
      })}
    </nav>
  );
}
