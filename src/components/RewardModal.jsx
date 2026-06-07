"use client";

import { Award, Sparkles } from "lucide-react";
import { withOptimizedAsset } from "@/lib/basePath";

function Badge({ badge }) {
  const icon = String(badge?.icon || "");
  const hasImage = /^(https?:\/\/|\/)/.test(icon);
  const imageSource = icon.startsWith("/") ? withOptimizedAsset(icon) : icon;

  return (
    <div className={`reward-badge is-${badge?.kind || "gold"}`}>
      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageSource} alt="" />
      ) : (
        <span>{icon || <Award size={56} />}</span>
      )}
    </div>
  );
}

export default function RewardModal({ reward, onClose }) {
  if (!reward) return null;
  const rewards = Array.isArray(reward.rewards) ? reward.rewards : [];
  const isBadgeOnly = String(reward.id || "").startsWith("badge-award:");

  return (
    <div className="reward-modal-backdrop">
      <section className="reward-modal" role="dialog" aria-modal="true" aria-label={isBadgeOnly ? "Badge earned" : "Quest completed"}>
        <Sparkles className="reward-sparkle reward-sparkle-left" size={38} />
        <Sparkles className="reward-sparkle reward-sparkle-right" size={30} />
        <p className="reward-kicker">{isBadgeOnly ? "BADGE EARNED!" : "QUEST COMPLETE!"}</p>
        <h2>{isBadgeOnly ? `ได้รับ Badge จาก ${reward.taskName}` : `ผ่าน ${reward.taskName} แล้ว!`}</h2>
        <Badge badge={reward.badge} />
        <p className="reward-earned">ได้รับ Badge</p>
        <h3>{reward.badge?.label || "Badge"}</h3>
        {reward.badge?.sublabel && <p className="reward-tier">{reward.badge.sublabel}</p>}
        {rewards.length > 0 && (
          <ul className="reward-unlock-list">
            {rewards.map((item, index) => (
              <li key={item.id || `${item.label}-${index}`} className="reward-unlock-item">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image.startsWith("/") ? withOptimizedAsset(item.image) : item.image} alt="" loading="lazy" />
                ) : (
                  <Award size={42} />
                )}
                <span>{item.label || "Unlock"}</span>
                {Number(item.quantity) > 1 && <strong>x{Number(item.quantity).toLocaleString()}</strong>}
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={onClose}>รับรางวัล</button>
      </section>
    </div>
  );
}
