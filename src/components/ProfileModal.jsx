"use client";

import { useEffect } from "react";
import { ArrowLeftRight, Gamepad2, MessageSquare, X } from "lucide-react";

function initials(name) {
  return String(name || "P")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function Badge({ achievement }) {
  const icon = String(achievement.icon || "");
  const hasImage = /^(https?:\/\/|\/)/.test(icon);

  return (
    <div className="profile-badge">
      <div className={`profile-badge-medal ${achievement.kind ? `is-${achievement.kind}` : ""}`}>
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt="" />
        ) : (
          <span>{icon || initials(achievement.label)}</span>
        )}
      </div>
      <strong>{achievement.label || "Badge"}</strong>
      {achievement.sublabel && <small>{achievement.sublabel}</small>}
    </div>
  );
}

export default function ProfileModal({ player, onClose }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!player) return null;

  const achievements = Array.isArray(player.achievements) ? player.achievements : [];

  return (
    <div
      className="profile-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section className="profile-modal" role="dialog" aria-modal="true" aria-label={`${player.name} profile`}>
        <button className="profile-close-button" type="button" aria-label="Close profile" onClick={onClose}>
          <X size={23} strokeWidth={3} />
        </button>

        <div className="profile-modal-header">
          <div className="profile-modal-avatar">
            {player.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={player.avatar} alt="" />
            ) : (
              <span>{initials(player.name)}</span>
            )}
            {player.online && <i className="profile-modal-online" aria-label="Online" />}
          </div>
          <div>
            <h2>{player.name}</h2>
            {player.username && <p className="profile-username">@{player.username}</p>}
            <p className="profile-rank">
              <Gamepad2 size={19} />
              <span>{player.rank || "Game Tester"}</span>
            </p>
          </div>
        </div>

        <div className="profile-badge-section">
          <h3>Badge</h3>
          {achievements.length > 0 ? (
            <div className="profile-badge-list">
              {achievements.map((achievement, index) => (
                <Badge key={achievement.id || `${achievement.label}-${index}`} achievement={achievement} />
              ))}
            </div>
          ) : (
            <p className="profile-empty-badges">No badges yet</p>
          )}
        </div>

        <div className="profile-modal-actions">
          <button type="button" disabled title="Coming soon">
            <ArrowLeftRight size={24} strokeWidth={3} />
            <span>Trade</span>
          </button>
          <button type="button" disabled title="Coming soon">
            <MessageSquare size={24} strokeWidth={3} />
            <span>Chat</span>
          </button>
        </div>
      </section>
    </div>
  );
}
