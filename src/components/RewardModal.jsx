"use client";

import { Award, Sparkles } from "lucide-react";
import { withBasePath } from "@/lib/basePath";

function Badge({ badge }) {
  const icon = String(badge?.icon || "");
  const hasImage = /^(https?:\/\/|\/)/.test(icon);
  const imageSource = icon.startsWith("/") ? withBasePath(icon) : icon;

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

  return (
    <div className="reward-modal-backdrop">
      <section className="reward-modal" role="dialog" aria-modal="true" aria-label="Quest completed">
        <Sparkles className="reward-sparkle reward-sparkle-left" size={38} />
        <Sparkles className="reward-sparkle reward-sparkle-right" size={30} />
        <p className="reward-kicker">QUEST COMPLETE!</p>
        <h2>ผ่าน {reward.taskName} แล้ว!</h2>
        <Badge badge={reward.badge} />
        <p className="reward-earned">ได้รับ Badge</p>
        <h3>{reward.badge?.label || "Badge"}</h3>
        {reward.badge?.sublabel && <p className="reward-tier">{reward.badge.sublabel}</p>}
        <button type="button" onClick={onClose}>รับรางวัล</button>
      </section>
    </div>
  );
}
