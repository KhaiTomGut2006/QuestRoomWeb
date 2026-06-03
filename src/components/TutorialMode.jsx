"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Clock3, Sparkles } from "lucide-react";
import { withOptimizedAsset } from "@/lib/basePath";

const CHAT_STEPS = {
  "welcome-1": {
    text: "สวัสดี นายพึ่งเข้ามาใหม่งั้นหรอ?",
    action: "continue-welcome",
    actionLabel: "ต่อไป"
  },
  "welcome-2": {
    text: "งั้นเดี๋ยวเรามาสอนนายให้เข้าใจโลกนี้ก็ซักหน่อยดีกว่า",
    action: "start-first-quest",
    actionLabel: "เริ่มฝึกรับเควส"
  },
  "after-first-quest": {
    text: "ดีมาก! งั้นต่อไปเรามาพานายรู้จักไอเท็มอื่นๆกันดีกว่า",
    action: "spawn-chest",
    actionLabel: "ทดลองเปิดกล่อง"
  },
  "after-chest": {
    text: "ดูเหมือนจะเริ่มมีเงินแล้วนี้!! งั้นลองซื้อของหน่อยไหม",
    action: "spawn-shop",
    actionLabel: "เรียกร้านค้า"
  },
  "social-intro": {
    text: "ก่อนออกไป ลองกดปุ่ม Social ด้านขวาบนดูหน่อย ที่นั่นนายจะเห็นผลงาน Quest ของคนอื่น และส่งกำลังใจให้กันได้",
    action: "",
    actionLabel: ""
  },
  "finish-chat": {
    text: "ยินดีด้วย! ตอนนี้นายเข้าใจพื้นฐานของโลกนี้แล้ว ต่อไปลองออกไปผจญภัยในด่านแรกได้เลย",
    action: "finish-tutorial",
    actionLabel: "เข้าสู่เกมจริง"
  }
};

const STEP_META = {
  "welcome-1": { progress: 1, title: "ทำความรู้จัก Tutorial Room" },
  "welcome-2": { progress: 1, title: "ทำความรู้จัก Tutorial Room" },
  "quest-arrival": { progress: 1, title: "กดคุยกับ Near แล้วรับเควสแรก" },
  "quest-active": { progress: 1, title: "ทำผลงานง่าย ๆ แล้วส่งเควสแรก" },
  "after-first-quest": { progress: 2, title: "เตรียมทดลองเปิด Chest" },
  "chest-arrival": { progress: 2, title: "กดเปิด Chest ที่หน้าประตู" },
  "after-chest": { progress: 3, title: "เตรียมทดลองซื้อ Quest จาก Shop" },
  "shop-arrival": { progress: 3, title: "กดคุยกับ Milt แล้วซื้อ Quest : Challenge Role" },
  "role-quest-active": { progress: 4, title: "ส่ง Role Quest หรือรอเพื่อยกเลิก" },
  "social-intro": { progress: 5, title: "กดปุ่ม Social ด้านขวาบนเพื่อดูผลงาน" },
  "social-opened": { progress: 5, title: "ลองดูผลงานใน Social แล้วปิดหน้าต่างเมื่อพร้อม" },
  "finish-chat": { progress: 5, title: "Tutorial สำเร็จแล้ว" }
};

function formatCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function TutorialMode({ tutorial, activeQuest, busy, error, onAction, socialOpen = false }) {
  const [now, setNow] = useState(() => Date.now());
  const chat = CHAT_STEPS[tutorial?.step];
  const meta = STEP_META[tutorial?.step] || STEP_META["welcome-1"];
  const cancelAvailableAt = tutorial?.step === "role-quest-active"
    ? new Date(activeQuest?.cancelAvailableAt || 0).getTime()
    : 0;
  const cancelWaitMs = Math.max(0, cancelAvailableAt - now);

  useEffect(() => {
    if (!cancelWaitMs) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [cancelWaitMs]);

  const progress = useMemo(() => Math.min(5, meta.progress || 1), [meta.progress]);

  if (!tutorial || tutorial.status !== "active") return null;

  return (
    <>
      <aside className="tutorial-hud" aria-label="Tutorial Mode progress">
        <p className="tutorial-hud-eyebrow"><Sparkles size={15} /> Tutorial Room</p>
        <strong>{meta.title}</strong>
        <div className="tutorial-progress" aria-label={`Tutorial step ${progress} of 5`}>
          {[1, 2, 3, 4, 5].map((number) => (
            <span className={number <= progress ? "is-active" : ""} key={number} />
          ))}
        </div>
        {cancelWaitMs > 0 && (
          <p className="tutorial-wait"><Clock3 size={15} /> ยกเลิก Role Quest ได้ใน {formatCountdown(cancelWaitMs)}</p>
        )}
        {error && <p className="tutorial-error">{error}</p>}
      </aside>

      {chat && !socialOpen && (
        <div className="tutorial-chat-wrap" role="presentation">
          <section className="tutorial-chat-box" role="dialog" aria-modal="true" aria-label="Tutorial NPC chat">
            <div className="tutorial-chat-npc">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withOptimizedAsset("/assets/NPC/Witch.png")} alt="Tutorial Guide" />
            </div>
            <div className="tutorial-chat-copy">
              <p className="tutorial-chat-name">Tutorial Guide</p>
              <p>{chat.text}</p>
              {chat.action && (
                <button type="button" disabled={busy} onClick={() => onAction(chat.action)}>
                  {busy ? "กำลังดำเนินการ..." : chat.actionLabel}
                  <ChevronRight size={19} />
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
