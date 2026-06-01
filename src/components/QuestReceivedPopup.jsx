"use client";

import { useEffect, useRef } from "react";
import { ScrollText, Sparkles } from "lucide-react";
import { withBasePath } from "@/lib/basePath";

const DISPLAY_MS = 3200;

export default function QuestReceivedPopup({ quest, onDone }) {
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; });

  useEffect(() => {
    const timeout = window.setTimeout(() => onDoneRef.current?.(), DISPLAY_MS);
    return () => window.clearTimeout(timeout);
  }, [quest?.acceptedAt]);

  if (!quest) return null;

  return (
    <div className="quest-received-backdrop" role="presentation">
      <section className="quest-received-card" role="dialog" aria-modal="true" aria-label="Quest received">
        <div className="quest-received-sparkles" aria-hidden="true">
          <Sparkles size={28} />
          <Sparkles size={18} />
          <Sparkles size={22} />
        </div>
        <div className="quest-received-icon" aria-hidden="true">
          <ScrollText size={55} strokeWidth={2.5} />
        </div>
        <p className="quest-received-kicker">New Quest Received!</p>
        <h2>{quest.title || "NPC Quest"}</h2>
        <p className="quest-received-desc">{quest.description || "เปิดเมนู Quest ทางซ้ายเพื่อดูรายละเอียด"}</p>
        <div className="quest-received-reward">
          <span>Reward</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={withBasePath("/assets/Coin.png")} alt="coin" />
          <strong>×{Number(quest.reward || 0).toLocaleString()}</strong>
        </div>
        <button type="button" onClick={onDone}>ดูเควสทางซ้าย</button>
      </section>
    </div>
  );
}
