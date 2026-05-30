"use client";

import { useEffect } from "react";
import { Coins, X } from "lucide-react";

export default function NoCoinsModal({ cost, coins, onClose }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="no-coins-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section className="no-coins-card" role="dialog" aria-modal="true" aria-label="Coins insufficient">
        <button className="no-coins-close" type="button" aria-label="Close modal" onClick={onClose}>
          <X size={22} strokeWidth={3} />
        </button>

        <div className="no-coins-icon-container">
          <Coins size={44} className="no-coins-icon-symbol" />
          <div className="no-coins-icon-glowing" />
        </div>

        <p className="no-coins-title-kicker">INSUFFICIENT COINS</p>
        <h2>เหรียญไม่เพียงพอ!</h2>
        
        <div className="no-coins-info-box">
          <div className="no-coins-info-row">
            <span>ค่าท้าทายด่านนี้:</span>
            <strong className="cost-value">{cost?.toLocaleString() || "250"} 🪙</strong>
          </div>
          <div className="no-coins-info-row">
            <span>เหรียญของคุณตอนนี้:</span>
            <strong className="coins-value">{coins?.toLocaleString() || "0"} 🪙</strong>
          </div>
        </div>

        <p className="no-coins-desc-note">
          กรุณาทำภารกิจหรือขอเหรียญจากพี่ประจำห้องเพื่อท้าทายด่านนี้ต่อไป
        </p>

        <button className="no-coins-btn" type="button" onClick={onClose}>
          ตกลง
        </button>
      </section>
    </div>
  );
}
