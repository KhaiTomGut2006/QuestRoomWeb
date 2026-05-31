"use client";

import { useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";

export default function ChallengeAnnouncement({ announcement, onDone }) {
  const [phase, setPhase] = useState("idle");
  const timersRef = useRef([]);

  useEffect(() => {
    if (!announcement) {
      setPhase("idle");
      return;
    }

    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setPhase("enter");

    timersRef.current.push(setTimeout(() => setPhase("hold"), 700));
    timersRef.current.push(setTimeout(() => setPhase("exit"), 4200));
    timersRef.current.push(setTimeout(() => {
      setPhase("idle");
      onDone();
    }, 5000));

    return () => timersRef.current.forEach(clearTimeout);
  }, [announcement, onDone]);

  if (!announcement || phase === "idle") return null;

  return (
    <div className={`challenge-announce challenge-announce--${phase}`} aria-live="assertive">
      <div className="challenge-announce-bg" />
      <div className="challenge-announce-card">
        <div className="challenge-announce-top-border" />

        <div className="challenge-announce-zaps">
          <Zap size={28} fill="currentColor" className="ca-zap-l" />
          <Zap size={42} fill="currentColor" className="ca-zap-c" />
          <Zap size={28} fill="currentColor" className="ca-zap-r" />
        </div>

        <p className="challenge-announce-eyebrow">⚡ CHALLENGE DECLARED ⚡</p>
        <h2 className="challenge-announce-name">{announcement.playerName}</h2>
        <p className="challenge-announce-verse">กำลังท้าทาย</p>
        <p className="challenge-announce-stage">{announcement.stageName}</p>
        <p className="challenge-announce-witness">— ทุกคนเป็นพยาน —</p>

        <div className="challenge-announce-bottom-border" />
      </div>
    </div>
  );
}
