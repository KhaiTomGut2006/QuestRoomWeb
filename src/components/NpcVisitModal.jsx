"use client";

import { withBasePath } from "@/lib/basePath";

// npcId → image filename
const NPC_IMAGE = {
  milt:   "Milt.png",
  witch:  "Witch.png",
  smith:  "Smith.png",
  dog:    "Dog.png",
  begger: "Begger.png",
  near:   "Near.png",
  chest:  "chest_open.png",
};

// event-type → badge label + colour class
const TYPE_META = {
  chest:        { label: "Treasure",   cls: "type-chest" },
  shop:         { label: "Shop",       cls: "type-shop" },
  quest:        { label: "Quest",      cls: "type-quest" },
  hints:        { label: "Hints",      cls: "type-hints" },
  "stupid-quest":{ label: "Stupid Quest", cls: "type-stupid" },
  gambling:     { label: "Gambling",   cls: "type-gambling" },
};

// 6 smoke puff positions (top-left origin, %)
const SMOKE_PUFFS = [
  { left: "18%", top: "55%", delay: "0ms",   size: 52 },
  { left: "26%", top: "42%", delay: "120ms",  size: 38 },
  { left: "10%", top: "46%", delay: "60ms",  size: 44 },
  { left: "32%", top: "58%", delay: "200ms", size: 30 },
  { left: "22%", top: "35%", delay: "90ms",  size: 34 },
  { left: "6%",  top: "60%", delay: "170ms", size: 28 },
];

// ── Quest dialog (when npc.type === "quest" and questData is loaded) ──────────
function QuestDialog({ npc, questData, onAccept, onClose }) {
  const charKey = questData.npcCharacter || npc.npcId || npc.id;
  const imgFile = NPC_IMAGE[charKey] || "Witch.png";
  const imgSrc  = withBasePath(`/assets/NPC/${imgFile}`);
  const charName = charKey
    ? charKey.charAt(0).toUpperCase() + charKey.slice(1)
    : npc.name;

  return (
    <div className="npc-quest-layout">
      {/* Left — NPC portrait */}
      <div className="npc-quest-npc-side">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="npc-quest-npc-img" src={imgSrc} alt={charName} />
        <p className="npc-quest-npc-name">{charName}</p>
      </div>

      {/* Right — speech bubble */}
      <div className="npc-quest-dialog-side">
        <p className="npc-quest-warning">*เมื่อยอมรับเควสจะไม่ Spawn Event ใหม่</p>
        <p className="npc-quest-text">
          <strong>{charName} :</strong> {questData.description}
        </p>
        <div className="npc-quest-reward">
          <span>Reward :</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={withBasePath("/assets/Coin.png")} alt="coin" />
          <span>×{questData.reward}</span>
        </div>
        <button className="npc-quest-accept-btn" type="button" onClick={onAccept}>
          ยอมรับเควส
        </button>
        <button className="npc-quest-decline-btn" type="button" onClick={onClose}>
          ฉันยังไม่พร้อม
        </button>
      </div>
    </div>
  );
}

export default function NpcVisitModal({ npc, questData, onAccept, onClose }) {
  if (!npc) return null;

  const imgFile = NPC_IMAGE[npc.npcId] || NPC_IMAGE[npc.id] || "chest_open.png";
  const imgSrc  = withBasePath(`/assets/NPC/${imgFile}`);
  const meta    = TYPE_META[npc.type] || { label: npc.type, cls: "" };
  const isQuestDialog = npc.type === "quest" && questData;

  return (
    <div
      className="npc-visit-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${npc.name} มาเยือน`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Magic smoke puffs — positioned near the door (left side) */}
      <div className="npc-smoke-stage" aria-hidden="true">
        {SMOKE_PUFFS.map((p, i) => (
          <span
            key={i}
            className="npc-smoke-puff"
            style={{ left: p.left, top: p.top, width: p.size, height: p.size, animationDelay: p.delay }}
          />
        ))}
      </div>

      {/* NPC card — slides in from the left */}
      <div className={`npc-visit-card${isQuestDialog ? " npc-visit-card--quest" : ""}`}>
        <button className="npc-visit-close" type="button" onClick={onClose} aria-label="Close">✕</button>

        {!isQuestDialog && (
          <>
            <span className={`npc-visit-type-badge ${meta.cls}`}>{meta.label}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="npc-visit-img" src={imgSrc} alt={npc.npcId || npc.id} />
            <p className="npc-visit-name">{npc.name}</p>
            {npc.description && (
              <p className="npc-visit-desc">
                {npc.description.split("\n").map((line, i) => (
                  <span key={i}>{line}<br /></span>
                ))}
              </p>
            )}
            <button className="npc-visit-btn" type="button" onClick={onClose}>
              พูดคุย
            </button>
          </>
        )}

        {isQuestDialog && (
          <QuestDialog
            npc={npc}
            questData={questData}
            onAccept={onAccept}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

