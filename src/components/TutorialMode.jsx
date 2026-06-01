"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Clock3, Coins, ShieldCheck, Sparkles, X } from "lucide-react";
import { withBasePath } from "@/lib/basePath";

const TUTORIAL_STEPS = {
  "quest-intro": {
    index: 1,
    title: "Quest ระดับง่ายมาก",
    npcName: "Near",
    npcImage: "Near.png",
    description: "เริ่มจาก Quest แรกที่ออกแบบให้ผ่านได้แน่นอน เพื่อรู้จักการรับภารกิจและรางวัล",
    reward: "+50 Coins และ First Quest Badge",
    action: "complete-quest",
    actionLabel: "รับ Quest และผ่านด่าน"
  },
  "chest-intro": {
    index: 2,
    title: "ทดลองเปิด Chest",
    npcName: "Treasure Chest",
    npcImage: "chest_close.png",
    description: "Chest ให้รางวัลแบบสุ่ม ครั้งนี้ลองเปิดหนึ่งครั้งเพื่อรู้จักระบบสมบัติ",
    reward: "+20-100 Coins",
    action: "open-chest",
    actionLabel: "เปิด Chest"
  },
  "shop-intro": {
    index: 3,
    title: "ทดลองใช้ Shop",
    npcName: "Milt",
    npcImage: "Milt.png",
    description: "ใช้ Coins ซื้อ Quest พิเศษหนึ่งชิ้น จากนั้น NPC ผู้ให้บททดสอบ Role จะมาหาเธอ",
    reward: "Quest : Challenge Role ราคา 50 Coins",
    action: "buy-role-quest",
    actionLabel: "ซื้อ Quest : Challenge Role"
  },
  "role-quest-offer": {
    index: 4,
    title: "Challenge Role",
    npcName: "Fact",
    npcImage: "Fact.png",
    description: "ฉันคือผู้ให้บททดสอบ Role พร้อมเมื่อไรก็เริ่มได้เลย หากยังไม่พร้อม ฉันจะกลับมาใหม่ในอีก 2 นาที",
    reward: "+100 Coins, Challenge Role และ Badge",
    action: "accept-role-test",
    actionLabel: "เริ่มบททดสอบ Role"
  },
  "role-quest-active": {
    index: 4,
    title: "บททดสอบ Role",
    npcName: "Fact",
    npcImage: "Fact.png",
    description: "บททดสอบแรกตั้งใจให้ผ่านได้แน่นอน ขอเพียงยืนยันว่าเข้าใจการรับ Quest, เปิด Chest และซื้อของจาก Shop แล้ว",
    reward: "+100 Coins, Challenge Role และ Badge",
    action: "complete-role-test",
    actionLabel: "ฉันเข้าใจแล้ว จบบททดสอบ"
  }
};

function formatCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function TutorialMode({ tutorial, busy, error, onAction }) {
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const waitingUntil = tutorial?.step === "role-quest-waiting"
    ? new Date(tutorial.roleNpcAvailableAt || 0).getTime()
    : 0;
  const waitingMs = Math.max(0, waitingUntil - now);
  const roleNpcReady = tutorial?.step === "role-quest-waiting" && waitingMs <= 0;
  const effectiveStep = roleNpcReady ? "role-quest-offer" : tutorial?.step;
  const step = TUTORIAL_STEPS[effectiveStep];

  useEffect(() => {
    setOpen(tutorial?.step !== "role-quest-waiting");
  }, [tutorial?.step]);

  useEffect(() => {
    if (tutorial?.step !== "role-quest-waiting" || roleNpcReady) return;
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [roleNpcReady, tutorial?.step]);

  useEffect(() => {
    if (roleNpcReady) setOpen(true);
  }, [roleNpcReady]);

  const progress = useMemo(() => Math.min(4, step?.index || 4), [step?.index]);

  if (!tutorial || tutorial.status !== "active") return null;

  return (
    <>
      <aside className="tutorial-hud" aria-label="Tutorial Mode progress">
        <p className="tutorial-hud-eyebrow"><Sparkles size={15} /> Tutorial Mode</p>
        <strong>{roleNpcReady ? "NPC ผู้ให้บททดสอบ Role กลับมาแล้ว" : step?.title || "รอ NPC ผู้ให้บททดสอบ Role"}</strong>
        <div className="tutorial-progress" aria-label={`Tutorial step ${progress} of 4`}>
          {[1, 2, 3, 4].map((number) => (
            <span className={number <= progress ? "is-active" : ""} key={number} />
          ))}
        </div>
        {tutorial.step === "role-quest-waiting" && !roleNpcReady ? (
          <p className="tutorial-wait"><Clock3 size={15} /> NPC จะกลับมาใน {formatCountdown(waitingMs)}</p>
        ) : (
          <button type="button" onClick={() => setOpen(true)}>
            เปิดคำแนะนำ <ChevronRight size={17} />
          </button>
        )}
      </aside>

      {open && step && (
        <div className="tutorial-backdrop" role="presentation">
          <section className="tutorial-card" role="dialog" aria-modal="true" aria-label="Tutorial Mode">
            <button className="tutorial-close" type="button" aria-label="Close tutorial guide" onClick={() => setOpen(false)}>
              <X size={23} strokeWidth={3} />
            </button>
            <div className="tutorial-npc">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withBasePath(`/assets/NPC/${step.npcImage}`)} alt={step.npcName} />
              <strong>{step.npcName}</strong>
            </div>
            <div className="tutorial-copy">
              <p className="tutorial-kicker">Tutorial Mode · Step {step.index}/4</p>
              <h2>{step.title}</h2>
              <p>{step.description}</p>
              {step.index === 1 && (
                <p className="tutorial-note">
                  ระหว่างเล่นสามารถคลิกพื้นเพื่อเดิน, คลิกผู้เล่นเพื่อดู Profile และใช้ Social เพื่อดูผลงานที่เผยแพร่แล้วได้
                </p>
              )}
              <div className="tutorial-reward">
                {step.index === 4 ? <ShieldCheck size={19} /> : <Coins size={19} />}
                <span>{step.reward}</span>
              </div>
              {error && <p className="tutorial-error">{error}</p>}
              <div className="tutorial-actions">
                <button className="tutorial-primary" type="button" disabled={busy} onClick={() => onAction(step.action)}>
                  {busy ? "กำลังดำเนินการ..." : step.actionLabel}
                </button>
                {effectiveStep === "role-quest-offer" && (
                  <button className="tutorial-secondary" type="button" disabled={busy} onClick={() => onAction("defer-role-test")}>
                    ยังไม่พร้อม รอ 2 นาที
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
