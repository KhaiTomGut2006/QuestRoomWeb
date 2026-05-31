"use client";

import { useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";

export default function ChallengeAnnouncement({ announcement, onDone }) {
  const [phase, setPhase] = useState("idle");
  const timersRef = useRef([]);
  // Store onDone in a ref so it is never an effect dependency
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; });

  useEffect(() => {
    if (!announcement) {
      setPhase("idle");
      return;
    }

    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setPhase("enter");

    timersRef.current.push(setTimeout(() => setPhase("hold"), 600));
    timersRef.current.push(setTimeout(() => setPhase("exit"), 4000));
    timersRef.current.push(setTimeout(() => {
      setPhase("idle");
      onDoneRef.current?.();
    }, 4800));

    return () => timersRef.current.forEach(clearTimeout);
  }, [announcement]); // ← only announcement, never onDone

  if (!announcement || phase === "idle") return null;

  return (
    <div className={`challenge-announce challenge-announce--${phase}`} aria-live="assertive">
      <div className="challenge-announce-card">
        <div className="challenge-announce-zaps">
          <Zap size={22} fill="currentColor" className="ca-zap-l" />
          <Zap size={32} fill="currentColor" className="ca-zap-c" />
          <Zap size={22} fill="currentColor" className="ca-zap-r" />
        </div>
        <p className="challenge-announce-eyebrow">⚡ CHALLENGE DECLARED ⚡</p>
        <h2 className="challenge-announce-name">{announcement.playerName}</h2>
        <p className="challenge-announce-stage">กำลังท้าทาย {announcement.stageName}</p>
        <p className="challenge-announce-witness">— ทุกคนเป็นพยาน —</p>
      </div>
    </div>
  );
}
