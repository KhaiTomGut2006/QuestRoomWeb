"use client";

import { Gift, Play, X } from "lucide-react";
import { withOptimizedAsset } from "@/lib/basePath";

function normalizedMediaUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  return value.startsWith("/") ? withOptimizedAsset(value) : value;
}

function isVideoUrl(url) {
  return /\.(mp4|webm|ogg)(\?.*)?$/i.test(String(url || ""));
}

function RewardItem({ reward }) {
  const image = String(reward?.image || "");
  const hasImage = Boolean(image);
  const quantity = Math.max(0, Number(reward?.quantity) || 0);

  return (
    <li className="challenge-reward-item">
      <div className="challenge-reward-art">
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.startsWith("/") ? withOptimizedAsset(image) : image} alt="" loading="lazy" />
        ) : (
          <Gift size={68} strokeWidth={2.6} />
        )}
      </div>
      <span className="challenge-reward-name">{reward?.label || "Unlock item"}</span>
      {quantity > 1 && <strong className="challenge-reward-qty">x{quantity.toLocaleString()}</strong>}
    </li>
  );
}

export default function ChallengeInfoModal({ info, view = "details", onClose, onShowRewards }) {
  if (!info) return null;
  const mediaUrl = normalizedMediaUrl(info.videoUrl);
  const rewards = Array.isArray(info.rewards) ? info.rewards : [];

  return (
    <div className="challenge-info-backdrop" onClick={onClose}>
      <section
        className={`challenge-info-modal challenge-info-modal--${view}`}
        role="dialog"
        aria-modal="true"
        aria-label={view === "rewards" ? "Challenge rewards" : "Challenge details"}
        onClick={(event) => event.stopPropagation()}
      >
        <button className="challenge-info-close" type="button" aria-label="Close" onClick={onClose}>
          <X size={46} strokeWidth={3.2} />
        </button>

        {view === "rewards" ? (
          <>
            <h2 className="challenge-info-title">Reward Unlock</h2>
            <p className="challenge-info-subtitle">when Complete &quot;{info.title}&quot;</p>
            <ul className="challenge-reward-list">
              {rewards.map((reward, index) => (
                <RewardItem key={reward.id || `${reward.label}-${index}`} reward={reward} />
              ))}
            </ul>
          </>
        ) : (
          <>
            <h2 className="challenge-info-title">{info.title}</h2>
            <p className="challenge-info-description">{info.description}</p>
            <div className="challenge-info-media">
              {mediaUrl && isVideoUrl(mediaUrl) ? (
                <video src={mediaUrl} controls preload="metadata" />
              ) : mediaUrl ? (
                <a className="challenge-info-media-link" href={mediaUrl} target="_blank" rel="noreferrer">
                  <Play size={42} fill="currentColor" />
                </a>
              ) : (
                <div className="challenge-info-media-empty">
                  <Play size={48} fill="currentColor" />
                </div>
              )}
            </div>
            <button className="challenge-info-rewards-button" type="button" onClick={onShowRewards}>
              <Gift size={68} fill="currentColor" strokeWidth={2.4} />
              <span>Rewards</span>
            </button>
          </>
        )}
      </section>
    </div>
  );
}
