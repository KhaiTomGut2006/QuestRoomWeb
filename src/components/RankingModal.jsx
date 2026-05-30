"use client";

import { useEffect, useState, useCallback } from "react";
import { Trophy, X, ChevronDown, Award } from "lucide-react";
import { withBasePath } from "@/lib/basePath";

export default function RankingModal({ onClose, onOpenProfile }) {
  const [levels, setLevels] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [selectedStageId, setSelectedStageId] = useState("");
  const [loading, setLoading] = useState(true);

  // Esc key closes modal
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Fetch ranking data based on selected stage
  const fetchRanking = useCallback((stageId) => {
    setLoading(true);
    const query = stageId ? `?stage=${encodeURIComponent(stageId)}` : "";
    fetch(withBasePath(`/api/player/ranking${query}`))
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(({ levels: loadedLevels, ranking: loadedRanking }) => {
        setLevels(loadedLevels);
        setRanking(loadedRanking);
        if (loadedLevels.length > 0 && !selectedStageId && !stageId) {
          setSelectedStageId(loadedLevels[0].stageId);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load rankings", err);
        setLoading(false);
      });
  }, [selectedStageId]);

  useEffect(() => {
    fetchRanking(selectedStageId);
  }, [selectedStageId, fetchRanking]);

  // Find the selected stage name
  const currentStageName = levels.find((l) => l.stageId === selectedStageId)?.name || "Game Designer";

  return (
    <div
      className="ranking-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section className="ranking-card animate-pop" role="dialog" aria-modal="true" aria-label="Leaderboard Ranking">
        <button className="ranking-close-btn" type="button" aria-label="Close ranking" onClick={onClose}>
          <X size={22} strokeWidth={3} />
        </button>

        {/* Outer header title */}
        <h1 className="ranking-outer-title">Ranking</h1>

        {/* Inner leaderboard panel */}
        <div className="ranking-inner-panel">
          
          <header className="ranking-header">
            <div className="ranking-trophy-wrapper">
              <Trophy size={48} className="ranking-trophy" />
              {/* Cute hamster/cat ears or custom indicator can be styled via CSS */}
              <div className="ranking-hamster-avatar">🐹</div>
            </div>
            <div className="ranking-header-text">
              <h2>RANKING</h2>
              <div className="ranking-select-container">
                <select
                  value={selectedStageId}
                  onChange={(e) => setSelectedStageId(e.target.value)}
                  className="ranking-stage-select"
                >
                  {levels.map((lvl) => (
                    <option key={lvl.stageId} value={lvl.stageId}>
                      {lvl.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} className="ranking-select-arrow" />
              </div>
            </div>
          </header>

          {/* Leaderboard list container */}
          <div className="ranking-list-container">
            {loading ? (
              <div className="ranking-loading">
                <div className="ranking-spinner" />
                <p>กำลังโหลดข้อมูลอันดับ...</p>
              </div>
            ) : ranking.length > 0 ? (
              <div className="ranking-list">
                {ranking.map((player) => {
                  const badgeIcon = String(player.badge?.icon || "");
                  const hasImage = /^(https?:\/\/|\/)/.test(badgeIcon);
                  const imageSource = badgeIcon.startsWith("/") ? withBasePath(badgeIcon) : badgeIcon;

                  return (
                    <div
                      key={player.id}
                      className={`ranking-item rank-${player.rank}`}
                      style={{ cursor: "pointer" }}
                      onClick={() => onOpenProfile && onOpenProfile(player.id)}
                    >
                      <div className="ranking-item-rank-num">
                        #{player.rank}
                      </div>
                      <div className="ranking-item-player-name">
                        {player.name}
                      </div>
                      <div className="ranking-item-badge-col">
                        {hasImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={imageSource}
                            alt={player.badge?.label || "Badge"}
                            className="ranking-badge-img"
                          />
                        ) : (
                          <div className={`ranking-badge-fallback is-${player.badge?.kind || "bronze"}`}>
                            <Award size={18} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="ranking-empty-state">
                <Trophy size={42} className="empty-trophy" />
                <p>ยังไม่มีผู้เล่นได้รับ Badge ในด่านนี้</p>
                <small>ท้าทายด่านนี้และรับตราเพื่อมาเป็นคนแรก!</small>
              </div>
            )}
          </div>

        </div>
      </section>
    </div>
  );
}
