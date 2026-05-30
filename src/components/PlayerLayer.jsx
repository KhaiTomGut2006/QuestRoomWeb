"use client";

import { useCallback, useRef } from "react";

const LONG_PRESS_MS = 600;
const MOVE_THRESHOLD = 10;

function initials(name) {
  return String(name || "P")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function PlayerToken({ player, selfId, onOpenProfile }) {
  const longPressTimerRef = useRef(null);
  const pointerStartRef = useRef(null);
  const suppressClickRef = useRef(false);

  const clearLongPress = useCallback(() => {
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    pointerStartRef.current = null;
  }, []);

  const handlePointerDown = (event) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    event.stopPropagation();
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = true;
      onOpenProfile(player);
      clearLongPress();
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (event) => {
    const start = pointerStartRef.current;
    if (!start) return;
    if (
      Math.abs(event.clientX - start.x) > MOVE_THRESHOLD ||
      Math.abs(event.clientY - start.y) > MOVE_THRESHOLD
    ) {
      clearLongPress();
    }
  };

  const handleContextMenu = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenProfile(player);
  };

  const handleClick = (event) => {
    event.stopPropagation();
    if (suppressClickRef.current) {
      event.preventDefault();
      suppressClickRef.current = false;
    }
  };

  const handleKeyDown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onOpenProfile(player);
  };

  return (
    <div
      className={`player-token ${player.id === selfId ? "is-self" : ""}`}
      style={{ left: `${player.x}%`, top: `${player.y}%` }}
      aria-label={`${player.name} is ${player.online ? "online" : "offline"}`}
      role="button"
      tabIndex={0}
      title="Right-click or press and hold to view profile"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
    >
      <div className="player-name">{player.name}</div>
      <div className="player-avatar">
        {player.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={player.avatar} alt="" />
        ) : (
          <span>{initials(player.name)}</span>
        )}
        {player.online && <span className="player-online-dot" aria-hidden="true" />}
      </div>
      <div className="player-shadow" />
    </div>
  );
}

export default function PlayerLayer({ players, selfId, onOpenProfile }) {
  return (
    <div className="player-layer" aria-label="Players in this stage">
      {players.map((player) => (
        <PlayerToken
          key={player.id}
          player={player}
          selfId={selfId}
          onOpenProfile={onOpenProfile}
        />
      ))}
    </div>
  );
}
