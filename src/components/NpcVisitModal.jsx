"use client";

import { withBasePath } from "@/lib/basePath";

const NPC_IMAGE = {
  near:   "Near.png",
  smith:  "Smith.png",
  witch:  "Witch.png",
  dog:    "Dog.png",
  milt:   "Milt.png",
  begger: "Begger.png",
};

export default function NpcVisitModal({ npc, onClose }) {
  if (!npc) return null;

  const imgFile = NPC_IMAGE[npc.id] || `${npc.id}.png`;
  const imgSrc  = withBasePath(`/assets/NPC/${imgFile}`);

  return (
    <div className="npc-visit-overlay" role="dialog" aria-modal="true" aria-label={`${npc.name} visits`}>
      <div className="npc-visit-card">
        <button className="npc-visit-close" type="button" onClick={onClose} aria-label="Close">✕</button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="npc-visit-img" src={imgSrc} alt={npc.name} />
        <p className="npc-visit-name">{npc.name}</p>
        <p className="npc-visit-sub">มาเยือนคุณ!</p>
        <button className="npc-visit-btn" type="button" onClick={onClose}>
          พูดคุย
        </button>
      </div>
    </div>
  );
}
