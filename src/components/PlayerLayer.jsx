"use client";

function initials(name) {
  return String(name || "P")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export default function PlayerLayer({ players, selfId }) {
  return (
    <div className="player-layer" aria-label="Players in this stage">
      {players.map((player) => (
        <div
          key={player.id}
          className={`player-token ${player.id === selfId ? "is-self" : ""}`}
          style={{ left: `${player.x}%`, top: `${player.y}%` }}
          aria-label={`${player.name} is ${player.online ? "online" : "offline"}`}
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
      ))}
    </div>
  );
}
