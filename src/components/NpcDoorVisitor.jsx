"use client";

import { withBasePath } from "@/lib/basePath";

const NPC_IMAGE = {
  milt: "Milt.png",
  witch: "Witch.png",
  smith: "Smith.png",
  dog: "Dog.png",
  begger: "Begger.png",
  near: "Near.png",
  chest: "chest_close.png",
};

export default function NpcDoorVisitor({ npc, phase = "idle", onInteract }) {
  if (!npc) return null;

  const character = npc.npcId || npc.id;
  const imgFile = NPC_IMAGE[character] || "Witch.png";

  return (
    <button
      className={`npc-door-visitor npc-door-visitor--${npc.type} npc-door-visitor--${phase}`}
      type="button"
      disabled={phase === "exiting" || phase === "swapping"}
      onClick={(event) => {
        event.stopPropagation();
        onInteract?.();
      }}
      aria-label={`คุยกับ ${npc.name}`}
    >
      <span className="npc-door-visitor-prompt">คลิกเพื่อพูดคุย</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={withBasePath(`/assets/NPC/${imgFile}`)} alt="" />
      <span className="npc-door-visitor-shadow" aria-hidden="true" />
    </button>
  );
}
