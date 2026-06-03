"use client";

import { memo, useCallback, useMemo, useRef } from "react";
import { withBasePath } from "@/lib/basePath";
import { getAccessoryImagePath } from "@/lib/accessories";

const LONG_PRESS_MS = 600;
const MOVE_THRESHOLD = 10;
const PLAYER_REACTIONS = ["🥰", "😂", "😭", "🤓", "🖕🏿"];

function initials(name) {
  return String(name || "P")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

const PlayerToken = memo(function PlayerToken({ player, selfId, reactions, onOpenProfile, onSelectReaction, onReactionEnd }) {
  const longPressTimerRef = useRef(null);
  const pointerStartRef = useRef(null);
  const suppressClickRef = useRef(false);
  const lastPointerTypeRef = useRef("");
  const accessoryImagePath = getAccessoryImagePath(player.equippedAccessory);
  const isSelf = player.id === selfId;

  const clearLongPress = useCallback(() => {
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    pointerStartRef.current = null;
  }, []);

  const handlePointerDown = (event) => {
    lastPointerTypeRef.current = event.pointerType;
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

  const handleClick = (event) => {
    event.stopPropagation();
    if (suppressClickRef.current) {
      event.preventDefault();
      suppressClickRef.current = false;
      return;
    }
    if (lastPointerTypeRef.current === "touch" || lastPointerTypeRef.current === "pen") return;
    onOpenProfile(player);
  };

  const handleKeyDown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onOpenProfile(player);
  };

  return (
    <div
      className={`player-token ${isSelf ? "is-self" : ""}`}
      style={{ left: `${player.x}%`, top: `${player.y}%` }}
    >
      {isSelf && (
        <div className="player-reaction-picker" aria-label="Choose a reaction">
          {PLAYER_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React with ${emoji}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelectReaction?.(emoji);
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      <div
        className="player-profile-trigger"
        aria-label={`${player.name} is ${player.online ? "online" : "offline"}`}
        role="button"
        tabIndex={0}
        title="Click or press and hold to view profile"
        onClick={handleClick}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
      >
        {player.challengeFailureCount > 0 && (
          <span className="player-challenge-failures" aria-label={`${player.challengeFailureCount} failed challenges`}>
            💀{player.challengeFailureCount}
          </span>
        )}
        <div className="player-avatar">
          {accessoryImagePath && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="player-accessory"
              src={withBasePath(accessoryImagePath)}
              alt=""
              loading="lazy"
              decoding="async"
            />
          )}
          {player.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={player.avatar} alt="" loading="lazy" decoding="async" />
          ) : (
            <span>{initials(player.name)}</span>
          )}
          {player.online && <span className="player-online-dot" aria-hidden="true" />}
        </div>
        <div className="player-name">{player.name}</div>
        <div className="player-shadow" />
      </div>
      {reactions.map((reaction, index) => (
        <span
          className="player-reaction-bubble"
          key={reaction.id}
          style={{ "--reaction-offset-x": `${(index % 3 - 1) * 16}px` }}
          aria-hidden="true"
          onAnimationEnd={() => onReactionEnd?.(reaction.id)}
        >
          {reaction.emoji}
        </span>
      ))}
    </div>
  );
}, (prev, next) => {
  const prevPlayer = prev.player;
  const nextPlayer = next.player;
  if (
    prev.selfId !== next.selfId ||
    prevPlayer.id !== nextPlayer.id ||
    prevPlayer.name !== nextPlayer.name ||
    prevPlayer.avatar !== nextPlayer.avatar ||
    prevPlayer.equippedAccessory !== nextPlayer.equippedAccessory ||
    prevPlayer.challengeFailureCount !== nextPlayer.challengeFailureCount ||
    prevPlayer.online !== nextPlayer.online ||
    prevPlayer.x !== nextPlayer.x ||
    prevPlayer.y !== nextPlayer.y ||
    prev.reactions.length !== next.reactions.length
  ) {
    return false;
  }

  for (let i = 0; i < prev.reactions.length; i += 1) {
    if (prev.reactions[i].id !== next.reactions[i].id) return false;
  }

  return true;
});

export default function PlayerLayer({
  players,
  selfId,
  reactions = [],
  onOpenProfile,
  onSelectReaction,
  onReactionEnd
}) {
  const reactionsByPlayer = useMemo(() => {
    const map = new Map();
    for (const reaction of reactions) {
      const list = map.get(reaction.playerId);
      if (list) list.push(reaction);
      else map.set(reaction.playerId, [reaction]);
    }
    return map;
  }, [reactions]);

  return (
    <div className="player-layer" aria-label="Players in this stage">
      {players.map((player) => (
        <PlayerToken
          key={player.id}
          player={player}
          selfId={selfId}
          reactions={reactionsByPlayer.get(player.id) || []}
          onOpenProfile={onOpenProfile}
          onSelectReaction={onSelectReaction}
          onReactionEnd={onReactionEnd}
        />
      ))}
    </div>
  );
}
