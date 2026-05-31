"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
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

const SHOP_ITEMS = {
  "quest-scroll": {
    name: "Quest (Normal)",
    description: "เก็บตั๋วเควสปกติไว้ใช้ภายหลัง",
    cost: 50,
    image: "quest.png",
  },
  "asset-ticket": {
    name: "Asset Ticket",
    description: "ตั๋วไอเทมสำหรับกิจกรรมพิเศษ",
    cost: 120,
    image: "AssetTicket.png",
  },
  "cooldown-minute": {
    name: "Cooldown -1 min",
    description: "ลดเวลารอ NPC รอบถัดไป 1 นาที",
    cost: 200,
    image: "Cooldown.png",
  },
  "limit-break": {
    name: "Limit Break",
    description: "ไอเทมหายากสำหรับปลดขีดจำกัด",
    cost: 500,
    image: "limitbreak.png",
  },
};

const DEFAULT_SHOP_OFFERS = ["quest-scroll", "asset-ticket", "cooldown-minute"];
const MAX_QUEST_EVIDENCE_BYTES = 100 * 1024 * 1024;

// 6 smoke puff positions (top-left origin, %)
const SMOKE_PUFFS = [
  { left: "18%", top: "55%", delay: "0ms",   size: 52 },
  { left: "26%", top: "42%", delay: "120ms",  size: 38 },
  { left: "10%", top: "46%", delay: "60ms",  size: 44 },
  { left: "32%", top: "58%", delay: "200ms", size: 30 },
  { left: "22%", top: "35%", delay: "90ms",  size: 34 },
  { left: "6%",  top: "60%", delay: "170ms", size: 28 },
];

// ── Shared NPC dialog layout (portrait left, speech bubble right) ────────────
function InteractDialog({ npcId, npcName, intro, children }) {
  const imgFile = NPC_IMAGE[npcId] || "Witch.png";
  const imgSrc  = withBasePath(`/assets/NPC/${imgFile}`);
  return (
    <div className="npc-quest-layout">
      <div className="npc-quest-npc-side">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="npc-quest-npc-img" src={imgSrc} alt={npcName} />
        <p className="npc-quest-npc-name">{npcName}</p>
      </div>
      <div className="npc-quest-dialog-side">
        <p className="npc-quest-text"><strong>{npcName} :</strong> {intro}</p>
        {children}
      </div>
    </div>
  );
}

// ── Gambling dialog (Begger) ─────────────────────────────────────────────────
function GamblingDialog({ npc, result, onGamble, onClose }) {
  const betAmount = Number(npc.betAmount) || 0;
  const canGamble = betAmount > 0;
  return (
    <InteractDialog npcId="begger" npcName="Begger" intro="ขอเสนอวิธีการเงินง่ายๆ กับผม">
      {result ? (
        <>
          <div className={`npc-interact-result${result.won ? " npc-interact-result--win" : " npc-interact-result--lose"}`}>
            {result.won
              ? `🎉 ยินดีด้วย! คุณได้รับ +${betAmount.toLocaleString()} Coins!`
              : `💸 เสียใจด้วย... คุณเสีย -${betAmount.toLocaleString()} Coins`}
          </div>
          <button className="npc-quest-decline-btn" type="button" onClick={onClose}>ตกลง</button>
        </>
      ) : (
        <>
          <div className="npc-interact-betamount">
            เดิมพัน{" "}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={withBasePath("/assets/Coin.png")} alt="coin" />
            <span>×{betAmount.toLocaleString()}</span>
          </div>
          <button
            className="npc-interact-choice-btn"
            type="button"
            onClick={() => onGamble(betAmount)}
            disabled={!canGamble}
          >
            {canGamble ? `ร่วมลงทุน ${betAmount.toLocaleString()} Coins` : "Coins ไม่พอสำหรับลงทุน"}
          </button>
          <button className="npc-quest-decline-btn" type="button" onClick={onClose}>อย่ามาแตะตัวกู!</button>
        </>
      )}
    </InteractDialog>
  );
}

// ── Hints dialog (Smith) ─────────────────────────────────────────────────────
function HintsDialog({ hintsData, hintResult, onHintBuy, onClose }) {
  return (
    <InteractDialog npcId="smith" npcName="Smith" intro="มีปัญหาอะไรให้ฉันช่วยมัย คุณผู้ชาย">
      {hintResult ? (
        <>
          <p className="npc-quest-text" style={{ marginTop: 8 }}>{hintResult.content}</p>
          <button className="npc-quest-decline-btn" type="button" onClick={onClose}>ขอบคุณ Smith!</button>
        </>
      ) : (
        <>
          {(hintsData || []).map((hint, i) => (
            <button key={hint._id} className="npc-interact-choice-btn" type="button"
              onClick={() => onHintBuy(hint._id)}>
              {i + 1} : {hint.title} ({(hint.cost || 500).toLocaleString()} coins)
            </button>
          ))}
          {(!hintsData || hintsData.length === 0) && (
            <p className="npc-quest-text" style={{ opacity: 0.6, marginTop: 8 }}>
              ตอนนี้ฉันยังไม่มีคำแนะนำพิเศษ
            </p>
          )}
          <button className="npc-quest-decline-btn" type="button" onClick={onClose}>ฉันไม่ต้องการ!</button>
        </>
      )}
    </InteractDialog>
  );
}

function ChestDialog({ result, loading, onClaim, onClose }) {
  return (
    <InteractDialog npcId="chest" npcName="Treasure Chest" intro="หีบสมบัติลึกลับมาหยุดอยู่หน้าประตู">
      {result ? (
        <>
          <div className="npc-interact-result npc-interact-result--win">
            คุณได้รับ +{result.coins.toLocaleString()} Coins
          </div>
          <button className="npc-quest-decline-btn" type="button" onClick={onClose}>เก็บสมบัติ</button>
        </>
      ) : (
        <>
          <p className="npc-quest-text">เปิดหีบเพื่อลุ้นรับ 20-200 Coins</p>
          <button className="npc-quest-accept-btn" type="button" onClick={onClaim} disabled={loading}>
            {loading ? "กำลังเปิดหีบ..." : "เปิดหีบสมบัติ"}
          </button>
          <button className="npc-quest-decline-btn" type="button" onClick={onClose}>ไว้คราวหน้า</button>
        </>
      )}
    </InteractDialog>
  );
}

function ShopDialog({ npc, purchases, loadingItem, onBuy, onClose }) {
  const offers = Array.isArray(npc.offers) && npc.offers.length > 0
    ? npc.offers
    : DEFAULT_SHOP_OFFERS;

  return (
    <InteractDialog npcId="milt" npcName="Milt" intro="มีของน่าสนใจมาให้เลือก 3 ชิ้น">
      <div className="npc-shop-list">
        {offers.map((itemId) => {
          const item = SHOP_ITEMS[itemId];
          if (!item) return null;
          return (
            <button
              key={itemId}
              className="npc-shop-item"
              type="button"
              onClick={() => onBuy(itemId)}
              disabled={Boolean(loadingItem)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withBasePath(`/assets/Item/${item.image}`)} alt="" />
              <span className="npc-shop-item-copy">
                <strong>{item.name}</strong>
                <small>{purchases[itemId] || item.description}</small>
              </span>
              <span className="npc-shop-price">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={withBasePath("/assets/Coin.png")} alt="coin" />
                {loadingItem === itemId ? "..." : item.cost}
              </span>
            </button>
          );
        })}
      </div>
      <button className="npc-quest-decline-btn" type="button" onClick={onClose}>เรียบร้อยแล้ว</button>
    </InteractDialog>
  );
}

// ── Quest dialog (when npc.type === "quest" and questData is loaded) ──────────
function QuestDialog({ npc, questData, activeQuest, onAccept, onCancel, onSubmit, onClose }) {
  const [confirmAction, setConfirmAction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitError, setSubmitError] = useState("");
  const charKey = questData.npcCharacter || npc.npcId || npc.id;
  const imgFile = NPC_IMAGE[charKey] || "Witch.png";
  const imgSrc  = withBasePath(`/assets/NPC/${imgFile}`);
  const charName = charKey
    ? charKey.charAt(0).toUpperCase() + charKey.slice(1)
    : npc.name;
  const cancelPenalty = Number(questData.cancelPenalty)
    || Math.max(1, Math.round((Number(questData.reward) || 0) * 0.25));

  const handleConfirm = async () => {
    if (!confirmAction || submitting) return;
    if (confirmAction === "submit" && !evidenceFile) {
      setSubmitError("กรุณาเลือกรูปภาพหรือวิดีโอก่อนส่งเควส");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      if (confirmAction === "cancel") await onCancel?.();
      if (confirmAction === "submit") await onSubmit?.(evidenceFile, setUploadProgress);
    } catch (error) {
      setSubmitError(error.message || "อัปโหลดหลักฐานไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEvidenceChange = (event) => {
    const file = event.target.files?.[0] || null;
    setSubmitError("");
    setUploadProgress(0);
    if (!file) {
      setEvidenceFile(null);
      return;
    }
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setEvidenceFile(null);
      setSubmitError("รองรับเฉพาะไฟล์รูปภาพหรือวิดีโอ");
      return;
    }
    if (file.size > MAX_QUEST_EVIDENCE_BYTES) {
      setEvidenceFile(null);
      setSubmitError("ไฟล์ต้องมีขนาดไม่เกิน 100 MB");
      return;
    }
    setEvidenceFile(file);
  };

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
        {!activeQuest && <p className="npc-quest-warning">*เมื่อยอมรับเควสจะไม่ Spawn Event ใหม่</p>}
        <p className="npc-quest-text">
          <strong>{charName} :</strong> {questData.description}
        </p>
        <div className="npc-quest-reward">
          <span>Reward :</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={withBasePath("/assets/Coin.png")} alt="coin" />
          <span>×{questData.reward}</span>
        </div>
        {activeQuest ? (
          <div className="npc-active-quest-actions">
            <label className="npc-quest-upload">
              <input type="file" accept="image/*,video/*" onChange={handleEvidenceChange} />
              <strong>{evidenceFile ? "เปลี่ยนไฟล์หลักฐาน" : "อัปโหลดรูปภาพหรือวิดีโอ"}</strong>
              <small>{evidenceFile ? `${evidenceFile.name} (${(evidenceFile.size / 1024 / 1024).toFixed(1)} MB)` : "ไฟล์ภาพหรือวิดีโอ ขนาดไม่เกิน 100 MB"}</small>
            </label>
            {submitError && <p className="npc-quest-upload-error">{submitError}</p>}
            <div className="npc-active-quest-submit-row">
              <button className="npc-quest-submit-btn" type="button" onClick={() => setConfirmAction("submit")} disabled={!evidenceFile}>
                ส่งเควส
              </button>
              <button className="npc-quest-message-btn" type="button" aria-label="ข้อความ เร็ว ๆ นี้" disabled>
                <MessageSquare size={28} strokeWidth={2.2} />
              </button>
            </div>
            <div className="npc-active-quest-footer">
              <button className="npc-quest-decline-btn" type="button" onClick={onClose}>
                ปิดบทสนทนา
              </button>
              <button className="npc-quest-cancel-btn" type="button" onClick={() => setConfirmAction("cancel")}>
                ยกเลิกเควส
              </button>
            </div>
          </div>
        ) : (
          <>
            <button className="npc-quest-accept-btn" type="button" onClick={onAccept}>
              ยอมรับเควส
            </button>
            <button className="npc-quest-decline-btn" type="button" onClick={onClose}>
              ฉันยังไม่พร้อม
            </button>
          </>
        )}
      </div>
      {confirmAction && (
        <div className="npc-quest-confirm-overlay" role="dialog" aria-modal="true">
          <section className="npc-quest-confirm-card">
            <h3>
              {confirmAction === "cancel"
                ? `ยกเลิก "${questData.title}"?`
                : `ส่งมอบ "${questData.title}"?`}
            </h3>
            <p>
              {confirmAction === "cancel"
                ? `หากยกเลิกเควสจะเสีย ${cancelPenalty.toLocaleString()} Coins`
                : `อัปโหลด "${evidenceFile?.name || ""}" และยืนยันเพื่อรับ ${(Number(questData.reward) || 0).toLocaleString()} Coins`}
            </p>
            {confirmAction === "submit" && submitting && (
              <p className="npc-quest-upload-progress">กำลังอัปโหลด... {Math.round(uploadProgress)}%</p>
            )}
            {submitError && <p className="npc-quest-upload-error">{submitError}</p>}
            <div className="npc-quest-confirm-actions">
              <button className="npc-quest-confirm-back" type="button" onClick={() => setConfirmAction("")}>
                Cancel
              </button>
              <button
                className={`npc-quest-confirm-primary npc-quest-confirm-primary--${confirmAction}`}
                type="button"
                onClick={handleConfirm}
                disabled={submitting}
              >
                {submitting
                  ? "กำลังดำเนินการ..."
                  : confirmAction === "cancel" ? "ยกเลิกเควส" : "ยืนยันรางวัล"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default function NpcVisitModal({
  npc, questData, activeQuest, onAccept, onQuestCancel, onQuestSubmit,
  hintsData, hintResult, onHintBuy,
  gamblingResult, onGamble,
  onMemberUpdate, onCooldownReduction, onNeedCoins,
  onClose,
}) {
  const [chestResult, setChestResult] = useState(null);
  const [claimingChest, setClaimingChest] = useState(false);
  const [shopPurchases, setShopPurchases] = useState({});
  const [loadingShopItem, setLoadingShopItem] = useState("");

  if (!npc) return null;

  const imgFile = NPC_IMAGE[npc.npcId] || NPC_IMAGE[npc.id] || "chest_open.png";
  const imgSrc  = withBasePath(`/assets/NPC/${imgFile}`);
  const meta    = TYPE_META[npc.type] || { label: npc.type, cls: "" };
  const isQuestDialog    = (npc.type === "quest" || npc.type === "stupid-quest") && questData;
  const isGamblingDialog = npc.type === "gambling";
  const isHintsDialog    = npc.type === "hints";
  const isShopDialog     = npc.type === "shop";
  const isChestDialog    = npc.type === "chest";
  const isWideDialog     = isQuestDialog || isGamblingDialog || isHintsDialog || isShopDialog || isChestDialog;

  const handleChestClaim = async () => {
    setClaimingChest(true);
    try {
      const response = await fetch(withBasePath("/api/player/npc-reward"), { method: "POST" });
      const data = await response.json();
      if (!response.ok) return;
      onMemberUpdate?.(data.member);
      setChestResult({ coins: data.coins });
    } finally {
      setClaimingChest(false);
    }
  };

  const handleShopBuy = async (itemId) => {
    setLoadingShopItem(itemId);
    try {
      const response = await fetch(withBasePath("/api/player/npc-shop"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.error === "not_enough_coins") onNeedCoins?.(data.cost);
        return;
      }
      onMemberUpdate?.(data.member);
      onCooldownReduction?.(data.cooldownReductionMs);
      setShopPurchases((current) => ({ ...current, [itemId]: "ซื้อสำเร็จ" }));
    } finally {
      setLoadingShopItem("");
    }
  };

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
      <div className={`npc-visit-card${isWideDialog ? " npc-visit-card--quest" : ""}`}>
        <button className="npc-visit-close" type="button" onClick={onClose} aria-label="Close">✕</button>

        {!isQuestDialog && !isGamblingDialog && !isHintsDialog && !isShopDialog && !isChestDialog && (
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
            activeQuest={activeQuest}
            onAccept={onAccept}
            onCancel={onQuestCancel}
            onSubmit={onQuestSubmit}
            onClose={onClose}
          />
        )}

        {isGamblingDialog && (
          <GamblingDialog
            npc={npc}
            result={gamblingResult}
            onGamble={onGamble}
            onClose={onClose}
          />
        )}

        {isHintsDialog && (
          <HintsDialog
            hintsData={hintsData}
            hintResult={hintResult}
            onHintBuy={onHintBuy}
            onClose={onClose}
          />
        )}

        {isShopDialog && (
          <ShopDialog
            npc={npc}
            purchases={shopPurchases}
            loadingItem={loadingShopItem}
            onBuy={handleShopBuy}
            onClose={onClose}
          />
        )}

        {isChestDialog && (
          <ChestDialog
            result={chestResult}
            loading={claimingChest}
            onClaim={handleChestClaim}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
