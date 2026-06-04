"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight, Gamepad2, MessageSquare, Shirt, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { withOptimizedAsset } from "@/lib/basePath";
import { ACCESSORY_LIST, getAccessoryImagePath } from "@/lib/accessories";
import AvatarWithFallback from "./AvatarWithFallback";

function initials(name) {
  return String(name || "P")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function Badge({ achievement }) {
  const icon = String(achievement.icon || "");
  const hasImage = /^(https?:\/\/|\/)/.test(icon);
  const imageSource = icon.startsWith("/") ? withOptimizedAsset(icon) : icon;

  return (
    <div className="profile-badge">
      <div className={`profile-badge-medal ${achievement.kind ? `is-${achievement.kind}` : ""}`}>
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageSource} alt="" loading="lazy" />
        ) : (
          <span>{icon || initials(achievement.label)}</span>
        )}
      </div>
      <strong>{achievement.label || "Badge"}</strong>
      {achievement.sublabel && <small>{achievement.sublabel}</small>}
    </div>
  );
}

function AccessoryDoll({ accessoryId, className = "" }) {
  const imagePath = getAccessoryImagePath(accessoryId);
  if (!imagePath) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={withOptimizedAsset(imagePath)} alt="" loading="lazy" />
  );
}

function isVideoEvidence(evidence) {
  const contentType = String(evidence?.contentType || "").toLowerCase();
  const url = String(evidence?.url || "").toLowerCase().split(/[?#]/)[0];
  return contentType.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/.test(url);
}

function QuestPost({ post }) {
  const [failed, setFailed] = useState(false);
  const evidenceUrl = String(post.evidence?.url || "");
  const isVideo = isVideoEvidence(post.evidence);

  return (
    <article className="profile-quest-post">
      {!evidenceUrl || failed ? (
        <a className="profile-quest-media profile-quest-media-fallback" href={evidenceUrl || undefined} target="_blank" rel="noreferrer">
          Media unavailable
        </a>
      ) : isVideo ? (
        <video className="profile-quest-media" src={evidenceUrl} controls preload="metadata" onError={() => setFailed(true)} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="profile-quest-media" src={evidenceUrl} alt={post.title || "Quest submission"} loading="lazy" onError={() => setFailed(true)} />
      )}
      <div className="profile-quest-reactions" aria-label="Quest reactions">
        <span><ThumbsUp size={20} /> {post.likeCount || 0}</span>
        <span><ThumbsDown size={20} /> {post.dislikeCount || 0}</span>
      </div>
      <strong>{post.title || "NPC Quest"}</strong>
      {post.postText && <p>{post.postText}</p>}
    </article>
  );
}

export default function ProfileModal({ player, selfId, onClose, onTrade, onEquipAccessory }) {
  const [showTrade, setShowTrade] = useState(false);
  const [tradeAmount, setTradeAmount] = useState("");
  const [tradeError, setTradeError] = useState("");
  const [tradeSuccess, setTradeSuccess] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [equippingAccessory, setEquippingAccessory] = useState("");
  const [accessoryError, setAccessoryError] = useState("");

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (showTrade) {
        setShowTrade(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, showTrade]);

  if (!player) return null;

  const achievements = Array.isArray(player.achievements) ? player.achievements : [];
  const questPosts = Array.isArray(player.questPosts) ? player.questPosts : [];
  const isSelf = player.id === selfId;
  const ownedAccessories = new Set(Array.isArray(player.ownedAccessories) ? player.ownedAccessories : []);

  const handleEquipAccessory = async (accessoryId) => {
    if (!onEquipAccessory || equippingAccessory) return;
    setEquippingAccessory(accessoryId || "none");
    setAccessoryError("");
    try {
      await onEquipAccessory(accessoryId);
    } catch (error) {
      setAccessoryError(error.message || "เปลี่ยน Accessory ไม่สำเร็จ");
    } finally {
      setEquippingAccessory("");
    }
  };

  const handleTradeSubmit = async (event) => {
    event.preventDefault();
    if (!onTrade || transferring) return;
    setTransferring(true);
    setTradeError("");
    setTradeSuccess("");
    try {
      const result = await onTrade(player.id, Number(tradeAmount));
      setTradeSuccess(`ส่ง ${Number(result.amount).toLocaleString()} Coins ให้ ${player.name} แล้ว`);
      setTradeAmount("");
    } catch (error) {
      setTradeError(error.message || "ส่ง Coin ไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setTransferring(false);
    }
  };

  const handleOpenDiscord = () => {
    if (!player.id) return;
    window.open(`https://discord.com/users/${encodeURIComponent(player.id)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className="profile-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section className="profile-modal" role="dialog" aria-modal="true" aria-label={`${player.name} profile`}>
        <button className="profile-close-button" type="button" aria-label="Close profile" onClick={onClose}>
          <X size={23} strokeWidth={3} />
        </button>

        <div className="profile-modal-header">
          <div className="profile-modal-avatar">
            <AccessoryDoll accessoryId={player.equippedAccessory} className="profile-equipped-accessory" />
            <AvatarWithFallback
              src={player.avatar}
              fallbackText={initials(player.name)}
              loading="lazy"
            />
            {player.online && <i className="profile-modal-online" aria-label="Online" />}
          </div>
          <div>
            <h2>{player.name}</h2>
            {player.username && <p className="profile-username">@{player.username}</p>}
            <p className="profile-rank">
              <Gamepad2 size={19} />
              <span>{player.rank || "Game Tester"}</span>
            </p>
          </div>
        </div>

        {isSelf && (
          <div className="profile-accessory-section">
            <div className="profile-accessory-heading">
              <h3>Accessories</h3>
              <span><Shirt size={16} /> เลือกตุ๊กตาบนหัว</span>
            </div>
            <div className="profile-accessory-list">
              <button
                className={`profile-accessory-item${!player.equippedAccessory ? " is-equipped" : ""}`}
                type="button"
                onClick={() => handleEquipAccessory("")}
                disabled={Boolean(equippingAccessory)}
              >
                <span className="profile-accessory-none">None</span>
                <small>{!player.equippedAccessory ? "Equipped" : "ถอดหมวก"}</small>
              </button>
              {ACCESSORY_LIST.filter((accessory) => ownedAccessories.has(accessory.id)).map((accessory) => {
                const isEquipped = player.equippedAccessory === accessory.id;
                return (
                  <button
                    key={accessory.id}
                    className={`profile-accessory-item${isEquipped ? " is-equipped" : ""}`}
                    type="button"
                    onClick={() => handleEquipAccessory(accessory.id)}
                    disabled={Boolean(equippingAccessory)}
                  >
                    <AccessoryDoll accessoryId={accessory.id} className="profile-accessory-preview" />
                    <strong>{accessory.name}</strong>
                    <small>{isEquipped ? "Equipped" : "สวมใส่"}</small>
                  </button>
                );
              })}
            </div>
            {ownedAccessories.size === 0 && (
              <p className="profile-accessory-empty">ยังไม่มี Accessory สามารถซื้อได้จาก Shop</p>
            )}
            {accessoryError && <p className="profile-trade-error">{accessoryError}</p>}
          </div>
        )}

        <div className="profile-badge-section">
          <h3>Badge</h3>
          {achievements.length > 0 ? (
            <div className="profile-badge-list">
              {achievements.map((achievement, index) => (
                <Badge key={achievement.id || `${achievement.label}-${index}`} achievement={achievement} />
              ))}
            </div>
          ) : (
            <p className="profile-empty-badges">No badges yet</p>
          )}
        </div>

        {!isSelf && (
          <div className="profile-modal-actions">
            <button type="button" title="ส่ง Coin ให้เพื่อน" onClick={() => setShowTrade(true)}>
              <ArrowLeftRight size={24} strokeWidth={3} />
              <span>Trade</span>
            </button>
            <button type="button" title="เปิด Discord DM" onClick={handleOpenDiscord}>
              <MessageSquare size={24} strokeWidth={3} />
              <span>Chat</span>
            </button>
          </div>
        )}

        <div className="profile-quest-section">
          <h3>Quest Lists</h3>
          {questPosts.length > 0 ? (
            <div className="profile-quest-list">
              {questPosts.map((post) => <QuestPost key={post.id} post={post} />)}
            </div>
          ) : (
            <p className="profile-empty-quests">No quest submissions yet</p>
          )}
        </div>

        {showTrade && (
          <div className="profile-trade-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowTrade(false)}>
            <form className="profile-trade-card" onSubmit={handleTradeSubmit}>
              <h3>ส่ง Coin ให้ {player.name}</h3>
              <p>ระบุจำนวน Coin ที่ต้องการแจกให้เพื่อน</p>
              <input
                type="number"
                min="1"
                max="1000000"
                step="1"
                inputMode="numeric"
                value={tradeAmount}
                onChange={(event) => setTradeAmount(event.target.value)}
                placeholder="จำนวน Coin"
                autoFocus
              />
              {tradeError && <p className="profile-trade-error">{tradeError}</p>}
              {tradeSuccess && <p className="profile-trade-success">{tradeSuccess}</p>}
              <div className="profile-trade-actions">
                <button type="button" onClick={() => setShowTrade(false)}>ยกเลิก</button>
                <button type="submit" disabled={transferring || !tradeAmount}>
                  {transferring ? "กำลังส่ง..." : "ส่ง Coin"}
                </button>
              </div>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
