"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { Coins, Zap, Volume2, VolumeX, LogOut, Settings } from "lucide-react";
import { io } from "socket.io-client";
import { upload } from "@vercel/blob/client";
import RoomCanvas from "@/components/RoomCanvas";
import PlayerLayer from "@/components/PlayerLayer";
import ProfileModal from "@/components/ProfileModal";
import RewardModal from "@/components/RewardModal";
import NpcVisitModal from "@/components/NpcVisitModal";
import NpcDoorVisitor from "@/components/NpcDoorVisitor";
import NoCoinsModal from "@/components/NoCoinsModal";
import RankingModal from "@/components/RankingModal";
import FriendsModal from "@/components/FriendsModal";
import GlobalQuestModal from "@/components/GlobalQuestModal";
import ChallengeModal from "@/components/ChallengeModal";
import ChallengeAnnouncement from "@/components/ChallengeAnnouncement";
import ChallengeSubmissionPanel from "@/components/ChallengeSubmissionPanel";
import ChallengeInfoModal from "@/components/ChallengeInfoModal";
import RoomProgressBar from "@/components/RoomProgressBar";
import TutorialMode from "@/components/TutorialMode";
import QuestReceivedPopup from "@/components/QuestReceivedPopup";
import { withBasePath, withOptimizedAsset } from "@/lib/basePath";
import { getWalkablePoint } from "@/lib/walkableArea";

const NPC_VISIT_ACTIONS = {
  gamble: "__gamble__",
  hint: "__hint__"
};
const MEMBER_REFRESH_INTERVAL_MS = 120_000;
const CHALLENGE_REVIEW_REFRESH_DELAYS_MS = [800, 2_500, 6_000];
const CHALLENGE_PENDING_REFRESH_INTERVAL_MS = 5_000;
const ROOM_LEVEL_REFRESH_INTERVAL_MS = 300_000;
const ROOM_PEEK_INTERVAL_MS = 60_000;
const SOCIAL_STATUS_INTERVAL_MS = 300_000;
const POSITION_SAVE_INTERVAL_MS = 60_000;
const POSITION_SAVE_MIN_DELTA = 0.5;
const SOCKET_TRANSPORTS = process.env.NEXT_PUBLIC_SOCKET_ALLOW_POLLING === "true"
  ? ["websocket", "polling"]
  : ["websocket"];

function safeUploadName(filename) {
  return String(filename || "evidence")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "evidence";
}

function socialNotificationText(notification) {
  const author = notification?.author || {};
  const username = author.username ? `@${author.username}` : author.name || "Player";
  if (notification?.type === "challenge") {
    return `${username} ได้ผ่าน Challenge ${notification.title || "Challenge"} แล้ว!!`;
  }
  return `${username} เพิ่งโพสต์ผลงาน ${notification.title || "Quest"} ลงใน Social เข้าไปดูสิ`;
}

async function uploadNpcQuestEvidence(file, playerId, onProgress) {
  if (!file) throw new Error("กรุณาเลือกไฟล์หลักฐาน");
  const safePlayerId = safeUploadName(playerId || "player");
  const pathname = `npc-quests/${safePlayerId}/${Date.now()}-${safeUploadName(file.name)}`;
  const uploadUrl = withBasePath("/api/player/npc-quest/upload");
  const uploadOptions = {
    access: "public",
    handleUploadUrl: uploadUrl,
    multipart: file.size > 4 * 1024 * 1024,
    onUploadProgress: ({ percentage }) => onProgress?.(percentage)
  };

  const configUrl = `${uploadUrl}?config=1&type=${encodeURIComponent(file.type)}&name=${encodeURIComponent(file.name)}&size=${file.size}`;
  const storageResponse = await fetch(configUrl);
  const storageConfig = await storageResponse.json().catch(() => ({}));
  if (!storageResponse.ok) {
    const maximumSizeInBytes = Number(storageConfig.maximumSizeInBytes) || 0;
    if (storageConfig.error === "file_too_large" && maximumSizeInBytes) {
      const maxMb = Math.floor(maximumSizeInBytes / 1024 / 1024);
      throw new Error(`ไฟล์ใหญ่เกินไป ระบบอัปโหลดตอนนี้รองรับไม่เกิน ${maxMb} MB`);
    }
    throw new Error(storageConfig.error || "upload_config_failed");
  }
  const maximumSizeInBytes = Number(storageConfig.maximumSizeInBytes) || 0;
  if (maximumSizeInBytes && file.size > maximumSizeInBytes) {
    const maxMb = Math.floor(maximumSizeInBytes / 1024 / 1024);
    throw new Error(`ไฟล์ใหญ่เกินไป ระบบอัปโหลดตอนนี้รองรับไม่เกิน ${maxMb} MB`);
  }

  // ── Cloudflare R2: PUT directly with presigned URL ────────────────────────
  if (storageConfig.storage === "r2") {
    const { uploadUrl: presignedUrl, publicUrl, key, headers: extraHeaders } = storageConfig;
    const xhr = new XMLHttpRequest();
    await new Promise((resolve, reject) => {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`r2_upload_failed_${xhr.status}`)));
      xhr.onerror = () => reject(new Error("r2_upload_network_error"));
      xhr.open("PUT", presignedUrl);
      Object.entries(extraHeaders || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.send(file);
    });
    onProgress?.(100);
    return {
      url: publicUrl,
      pathname: `r2/${key}`,
      contentType: file.type,
      size: file.size,
      originalName: file.name,
    };
  }

  // ── GridFS: POST multipart to server ─────────────────────────────────────
  if (storageConfig.storage !== "blob") {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${uploadUrl}?storage=gridfs`, {
      method: "POST",
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "quest_evidence_upload_failed");
    onProgress?.(100);
    return data.blob;
  }

  // ── Vercel Blob ───────────────────────────────────────────────────────────
  try {
    const blob = await upload(pathname, file, uploadOptions);
    return {
      url: blob.url,
      pathname: blob.pathname,
      contentType: blob.contentType || file.type,
      size: file.size,
      originalName: file.name
    };
  } catch (error) {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${uploadUrl}?storage=gridfs`, {
      method: "POST",
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || error.message || "quest_evidence_upload_failed");
    onProgress?.(100);
    return data.blob;
  }
}

const demoMember = {
  discordId: "demo-local",
  name: "Demo Guest",
  username: "demo",
  avatar: "",
  stage: "game-demo-1",
  coins: 0,
  shopAssetTickets: 0,
  ownedAccessories: [],
  equippedAccessory: "",
  quest: {
    current: "อยากเห็นรูปเดี่ยวตัวละครเจ้า (ตอนแยกสาย) จัง",
    status: "active",
    completed: [],
    cooldownUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  },
  npcQuest: null,
  tutorial: null,
  position: { x: 56, y: 72 }
};

const demoNpcQuest = {
  difficulty: "easy",
  title: "ภาพ Lighting แสนสวย",
  description: "เพื่อนฉันกลับมามองเห็นอีกครั้ง ในรอบ 30 ปี ฉันอยากให้เธอได้เห็นภาพ ทิวทัศน์ที่เต็มไปด้วย Lighting แสนสวย",
  reward: 90,
  cancelPenalty: 23,
  source: "shop",
  npcType: "quest-easy",
  npcName: "near",
  npcCharacter: "near",
  acceptedAt: "demo-quest-preview",
};

const demoChallenge = {
  status: "pending",
  taskId: "game-demo-1",
  taskName: "Game Demo",
  stage: "game-demo-1",
  cost: 250,
  requestedAt: "demo-challenge-preview",
};

const DEFAULT_CHALLENGE_REWARDS = [
  {
    id: "chest-shadow",
    label: "Mystery Chest",
    image: "/assets/ItemShadow/chest_shadow.webp",
    quantity: 1,
    kind: "item",
  },
  {
    id: "quest-shadow",
    label: "Challenge Role",
    image: "/assets/ItemShadow/quest_shadow.webp",
    quantity: 1,
    kind: "item",
  },
  {
    id: "coins",
    label: "Coins",
    image: "/assets/Coin.png",
    quantity: 1000,
    kind: "coins",
  },
];

function normalizeChallengeReward(reward, index) {
  return {
    id: String(reward?.id || reward?.itemId || `reward-${index}`),
    label: String(reward?.label || reward?.itemName || reward?.name || "Unlock item"),
    image: String(reward?.image || reward?.icon || reward?.asset || ""),
    quantity: Math.max(0, Number(reward?.quantity ?? reward?.qty ?? reward?.amount ?? 1) || 0),
    kind: String(reward?.kind || reward?.type || "item"),
  };
}

function challengeInfoFromLevel(level, fallbackName) {
  const source = level?.challengeInfo || level?.challenge || {};
  const title = String(source.title || source.taskName || fallbackName || "Challenge").trim();
  const description = String(source.description || source.details || source.prompt || "").trim();
  const rewards = Array.isArray(source.rewards) && source.rewards.length > 0
    ? source.rewards.map(normalizeChallengeReward)
    : DEFAULT_CHALLENGE_REWARDS;

  return {
    title,
    description: description || "Capture the final result, summarize your plan, and prepare a short presentation clip for review.",
    videoUrl: String(source.videoUrl || source.video || source.mediaUrl || "").trim(),
    videoPath: String(source.videoPath || "").trim(),
    videoContentType: String(source.videoContentType || source.contentType || "").trim(),
    rewards,
  };
}

// ─── Room Clock (personal 30-min countdown, freezes during active quest) ────
function RoomClock({ cycleInfo }) {
  const [timeLeft, setTimeLeft] = useState(null);

  useEffect(() => {
    if (!cycleInfo) return;
    // Frozen: show static remaining time
    if (cycleInfo.frozen) {
      setTimeLeft(cycleInfo.frozenRemainingMs ?? 0);
      return;
    }
    const tick = () => {
      const elapsed = Date.now() - cycleInfo.cycleStartedAt;
      const remaining = Math.max(0, cycleInfo.cycleDurationMs - elapsed);
      setTimeLeft(remaining);
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [cycleInfo]);

  if (timeLeft === null) return null;
  const mins = String(Math.floor(timeLeft / 60000)).padStart(2, "0");
  const secs = String(Math.floor((timeLeft % 60000) / 1000)).padStart(2, "0");
  const urgent = timeLeft < 60000;

  return (
    <div className={`room-clock${urgent ? " room-clock--urgent" : ""}${cycleInfo?.frozen ? " room-clock--frozen" : ""}`} aria-label="Event countdown">
      <span className="room-clock-time">{mins}:{secs}</span>
      {cycleInfo?.frozen && <span className="room-clock-frozen-label">❄</span>}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────

function stageLabel(stage) {
  const stageNumber = Number.parseInt(String(stage || "game-demo-1").split("-").pop(), 10) || 1;
  const numerals = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return `Game Demo - ${numerals[stageNumber - 1] || stageNumber}`;
}

function roomKeyFor(stage, challengeFailureCount = 0) {
  const stageKey = String(stage || "game-demo-1").trim().slice(0, 96) || "game-demo-1";
  const count = Math.min(99, Math.max(0, Number(challengeFailureCount) || 0));
  return count > 0 ? `${stageKey}::fail-${count}` : stageKey;
}

function getChestRewardIcon(reward) {
  if (!reward || reward.kind === "coins") return "/assets/Coin.png";
  if (reward.itemId === "asset-ticket") return "/assets/Item/AssetTicket.png";
  if (String(reward.itemId || "").startsWith("quest-scroll-")) return "/assets/Item/quest.png";
  if (String(reward.itemId || "").startsWith("cooldown-minute")) return "/assets/Item/Cooldown.png";
  return "/assets/Coin.png";
}

function displayAvatarUrl(url, size = 64) {
  const value = String(url || "");
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const isDiscordAvatar =
      (parsed.hostname === "cdn.discordapp.com" || parsed.hostname === "media.discordapp.net")
      && parsed.pathname.startsWith("/avatars/");
    if (!isDiscordAvatar) return value;
    parsed.searchParams.set("size", String(size));
    return parsed.toString();
  } catch {
    return value;
  }
}

function playerFromMember(member, stageOverride = "") {
  return {
    id: member.discordId || "demo-local",
    name: member.name || member.username || "Player",
    username: member.username || "",
    avatar: displayAvatarUrl(member.avatar),
    rank: member.rank || "Game Tester",
    achievements: member.achievements || [],
    equippedAccessory: member.equippedAccessory || "",
    stage: stageOverride || member.stage || "game-demo-1",
    challengeFailureCount: Math.max(0, Number(member.challengeFailureCount) || 0),
    roomKey: stageOverride
      ? stageOverride
      : member.roomKey || roomKeyFor(member.stage, member.challengeFailureCount),
    x: Number(member.position?.x || 56),
    y: Number(member.position?.y || 72),
    action: "idle",
    online: true,
    hasNpcQuest: Boolean(member.npcQuest && member.npcQuest.source !== "shop"),
    coins: Number(member.coins) || 0,
    // Permanent cooldown reduction: 60s per Lv1 purchase + 60s per Lv2 purchase
    permanentReductionMs: ((member.shopCooldownT1 || 0) + (member.shopCooldownT2 || 0)) * 60_000,
  };
}

function playerPresencePayload(player, admission = {}) {
  if (!player) return null;
  return {
    id: player.id,
    name: player.name,
    username: player.username,
    avatar: player.avatar,
    equippedAccessory: player.equippedAccessory,
    stage: player.stage,
    roomKey: player.roomKey || roomKeyFor(player.stage, player.challengeFailureCount),
    challengeFailureCount: player.challengeFailureCount,
    x: player.x,
    y: player.y,
    action: player.action,
    coins: player.coins,
    hasNpcQuest: player.hasNpcQuest,
    permanentReductionMs: player.permanentReductionMs,
    entryQueueClientId: admission.clientId || "",
    entryAdmissionToken: admission.token || ""
  };
}

function positionChangedEnough(a, b) {
  if (!a || !b) return Boolean(a);
  const ax = Number(a.x);
  const ay = Number(a.y);
  const bx = Number(b.x);
  const by = Number(b.y);
  if (![ax, ay, bx, by].every(Number.isFinite)) return true;
  return Math.hypot(ax - bx, ay - by) >= POSITION_SAVE_MIN_DELTA;
}

function sameRoomPlayer(a, b) {
  if (!a || !b || a.id !== b.id) return false;
  const comparableKeys = [
    "name",
    "username",
    "avatar",
    "equippedAccessory",
    "stage",
    "roomKey",
    "challengeFailureCount",
    "x",
    "y",
    "action",
    "online"
  ];
  return comparableKeys.every((key) => !(key in b) || a[key] === b[key]);
}

function selectRoomPlayers(players, { selfId = "", excludeSelf = false } = {}) {
  const incoming = Array.isArray(players) ? players.filter((player) => player?.id) : [];
  return excludeSelf ? incoming.filter((player) => player.id !== selfId) : incoming;
}

function mergeRoomPlayers(currentPlayers, nextPlayers) {
  const incoming = Array.isArray(nextPlayers) ? nextPlayers : [];
  if (!incoming.length) return currentPlayers;

  let changed = false;
  const playersById = new Map(currentPlayers.map((player) => [player.id, player]));
  for (const player of incoming) {
    if (!player?.id) continue;
    const current = playersById.get(player.id);
    if (!sameRoomPlayer(current, player)) {
      changed = true;
      playersById.set(player.id, current ? { ...current, ...player } : player);
    }
  }

  return changed ? Array.from(playersById.values()) : currentPlayers;
}

function LoginScreen({ authConfigured, authError }) {
  const hasError = Boolean(authError);
  return (
    <main className="login-screen">
      <section className="login-card" aria-label="Login with Discord">
        <p className="login-room">Bed Room</p>
        <h1>Quest Room</h1>
        <p className="login-copy">
          {hasError
            ? "Discord login could not finish. Check the redirect URL and try again."
            : authConfigured
              ? "Opening Discord login..."
              : "Set Discord OAuth credentials before players can enter."}
        </p>
        <button className="discord-button" type="button" onClick={() => signIn("discord")}>
          Login with Discord
        </button>
        {hasError && <p className="login-note">Auth error: {authError}</p>}
        {!authConfigured && <p className="login-note">Missing Discord Client ID / Secret</p>}
      </section>
    </main>
  );
}

// ─── Dev Panel ────────────────────────────────────────────────────────────
const NPC_IDS = [
  { id: "chest",        label: "Chest (20%)" },
  { id: "shop",         label: "Shop/Milt (20%)" },
  { id: "quest-easy",   label: "Quest Easy/Near (20%)" },
  { id: "quest-medium", label: "Quest Medium/Fact (15%)" },
  { id: "hints",        label: "Hints/Smith (10%)" },
  { id: "quest-hard",   label: "Quest Hard/Nite (5%)" },
  { id: "stupid-quest", label: "Stupid Quest/Dog (5%)" },
  { id: "gambling",     label: "Gambling/Begger (5%)" },
];
const NPC_EXIT_MS = 720;

function npcFromActiveQuest(quest) {
  if (!quest) return null;
  return {
    id: quest.npcType || "quest-active",
    type: quest.npcType === "stupid-quest" ? "stupid-quest" : "quest",
    name: quest.title || "Quest",
    npcId: quest.npcCharacter || quest.npcName || "witch",
    description: quest.description || "",
    activeQuest: true,
  };
}

const TUTORIAL_FIRST_QUEST = {
  difficulty: "easy",
  title: "อยากเห็นรูปเดี่ยวตัวละครเจ้า (ตอนแยกสาย) จัง",
  description: "ส่งรูปเดี่ยวตัวละครของเจ้าในตอนแยกสาย แล้วอัปโหลดมาให้ฉันดู",
  reward: 50,
  cancelPenalty: 0,
  source: "tutorial-first-quest",
  npcCharacter: "near"
};

function npcFromTutorialStep(step) {
  if (step === "quest-arrival") {
    return {
      id: "quest-easy",
      type: "quest",
      name: "Quest (Tutorial)",
      npcId: "near",
      tutorialAction: "accept-first-quest"
    };
  }
  if (step === "chest-arrival") {
    return {
      id: "chest",
      type: "chest",
      name: "Treasure Chest",
      npcId: "chest",
      tutorialAction: "open-chest"
    };
  }
  if (step === "quest-active") {
    return {
      id: "quest-easy",
      type: "quest",
      name: "Quest (Tutorial)",
      npcId: "near",
      activeQuest: true
    };
  }
  if (step === "shop-arrival") {
    return {
      id: "shop",
      type: "shop",
      name: "Shop",
      npcId: "milt",
      offers: ["tutorial-role-quest"],
      tutorialAction: "buy-role-quest"
    };
  }
  return null;
}

function DevPanel({ socketRef, cycleInfo, cycleToolsEnabled, devToken, selfDiscordId, onMemberUpdate }) {
  const [open, setOpen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [npcId, setNpcId] = useState("");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [grantAmount, setGrantAmount] = useState("1000");
  const [userToolStatus, setUserToolStatus] = useState("");
  const [userToolBusy, setUserToolBusy] = useState(false);

  const emit = (ev, data = {}) => socketRef.current?.emit(ev, { ...data, devToken });

  const handleSpeed = (val) => {
    setSpeed(val);
    emit("dev:set-speed", { multiplier: val });
  };

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!open || !trimmedQuery) {
      setUsers([]);
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      fetch(`${withBasePath("/api/dev/users")}?q=${encodeURIComponent(trimmedQuery)}`, {
        signal: controller.signal
      })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Search failed.");
          return data;
        })
        .then((data) => {
          setUsers(data.users || []);
          setUserToolStatus((data.users || []).length ? "" : "No users found.");
        })
        .catch((error) => {
          if (error.name !== "AbortError") setUserToolStatus(error.message);
        });
    }, 240);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [open, query]);

  const runUserAction = async (action) => {
    if (!selectedUser) return;
    if (action === "reset-user" && !window.confirm(`Reset game data for ${selectedUser.name || selectedUser.discordId}?`)) return;

    setUserToolBusy(true);
    setUserToolStatus("");
    try {
      const response = await fetch(withBasePath("/api/dev/users"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          discordId: selectedUser.discordId,
          ...(action === "grant-coins" ? { amount: Number(grantAmount) } : {})
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Dev action failed.");
      setSelectedUser(data.user);
      setUsers((current) => current.map((user) => user.discordId === data.user.discordId ? data.user : user));
      setUserToolStatus(action === "grant-coins" ? "Coins granted." : "Game data reset.");
      if (data.user.discordId === selfDiscordId) onMemberUpdate?.(data.user);
    } catch (error) {
      setUserToolStatus(error.message);
    } finally {
      setUserToolBusy(false);
    }
  };

  return (
    <div className={`dev-panel${open ? " dev-panel--open" : ""}`}>
      <button className="dev-panel-toggle" type="button" onClick={() => setOpen((o) => !o)}>
        🛠️ Dev
      </button>
      {open && (
        <div className="dev-panel-body">
          {cycleToolsEnabled && (
            <>
              <p className="dev-panel-title">NPC Cycle Controls</p>

              <div className="dev-panel-row">
                <label>Speed</label>
                <div className="dev-speed-btns">
                  {[1, 5, 10, 60, 100].map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`dev-speed-btn${speed === v ? " active" : ""}`}
                      onClick={() => handleSpeed(v)}
                    >
                      {v === 1 ? "1×" : `${v}×`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="dev-panel-row">
                <label>Force NPC</label>
                <select value={npcId} onChange={(e) => setNpcId(e.target.value)} className="dev-select">
                  <option value="">Random</option>
                  {NPC_IDS.map((n) => (
                    <option key={n.id} value={n.id}>{n.label}</option>
                  ))}
                </select>
              </div>

              <div className="dev-panel-row">
                <button className="dev-action-btn" type="button"
                  onClick={() => emit("dev:trigger", { npcId: npcId || undefined })}>
                  ▶️ Trigger NPC
                </button>
                <button className="dev-action-btn" type="button"
                  onClick={() => emit("dev:skip", {})}>
                  ⏩ Skip Cycle
                </button>
                <button className="dev-action-btn" type="button"
                  onClick={() => emit("dev:reset", {})}>
                  🔄 Reset Timer
                </button>
              </div>

              {cycleInfo && (() => {
                const remaining = Math.max(0, cycleInfo.cycleDurationMs - (Date.now() - cycleInfo.cycleStartedAt));
                const mins = String(Math.floor(remaining / 60000)).padStart(2, "0");
                const secs = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");
                return <p className="dev-panel-note">Cycle: {mins}:{secs} | {speed}× speed</p>;
              })()}

              <div className="dev-panel-divider" />
            </>
          )}

          <p className="dev-panel-title">User Tools</p>
          <div className="dev-panel-row">
            <label htmlFor="dev-user-search">Search user</label>
            <input
              id="dev-user-search"
              className="dev-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Discord ID or name"
            />
          </div>

          {users.length > 0 && (
            <div className="dev-user-results">
              {users.map((user) => (
                <button
                  key={user.discordId}
                  type="button"
                  className={`dev-user-result${selectedUser?.discordId === user.discordId ? " active" : ""}`}
                  onClick={() => {
                    setSelectedUser(user);
                    setUserToolStatus("");
                  }}
                >
                  <strong>{user.name || user.username || "Unnamed user"}</strong>
                  <span>{user.discordId} · {Number(user.coins || 0).toLocaleString()} coins</span>
                </button>
              ))}
            </div>
          )}

          {selectedUser && (
            <div className="dev-selected-user">
              <strong>{selectedUser.name || selectedUser.username || "Unnamed user"}</strong>
              <span>{selectedUser.discordId}</span>
              <span>{Number(selectedUser.coins || 0).toLocaleString()} coins</span>
            </div>
          )}

          <div className="dev-panel-row">
            <label htmlFor="dev-coin-amount">Grant coins</label>
            <div className="dev-inline-actions">
              <input
                id="dev-coin-amount"
                className="dev-input"
                type="number"
                min="1"
                max="1000000000"
                step="1"
                value={grantAmount}
                onChange={(event) => setGrantAmount(event.target.value)}
              />
              <button
                className="dev-action-btn"
                type="button"
                disabled={!selectedUser || userToolBusy}
                onClick={() => runUserAction("grant-coins")}
              >
                Grant
              </button>
            </div>
          </div>
          <button
            className="dev-action-btn dev-action-btn--danger"
            type="button"
            disabled={!selectedUser || userToolBusy}
            onClick={() => runUserAction("reset-user")}
          >
            Reset selected user game data
          </button>
          {userToolStatus && <p className="dev-panel-note">{userToolStatus}</p>}
        </div>
      )}
    </div>
  );
}
// ───────────────────────────────────────────────────────────────────

export default function GameShell({ entryAdmissionToken = "", entryQueueClientId = "", initialData = null } = {}) {
  const { data: session, status } = useSession();
  const [config, setConfig] = useState(() => initialData?.config || null);
  const [member, setMember] = useState(() => initialData?.member || null);
  const [players, setPlayers] = useState(() => (
    Array.isArray(initialData?.players) ? initialData.players : []
  ));
  const [roomLevels, setRoomLevels] = useState(() => (
    Array.isArray(initialData?.levels) ? initialData.levels : []
  ));
  const [viewedRoomKey, setViewedRoomKey] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [demoRequested, setDemoRequested] = useState(false);
  const [authError, setAuthError] = useState("");
  const [devRequested, setDevRequested] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [devToken, setDevToken] = useState("");
  const [target, setTarget] = useState(null);
  const [profilePlayer, setProfilePlayer] = useState(null);
  const [reward, setReward] = useState(null);
  const [message, setMessage] = useState("Pedding...");
  const [cycleInfo, setCycleInfo] = useState(null);
  const [doorNpc, setDoorNpc] = useState(null);
  const [doorNpcPhase, setDoorNpcPhase] = useState("idle");
  const [npcKey, setNpcKey] = useState(0);
  const [npcVisit, setNpcVisit] = useState(null);
  const [npcQuestData, setNpcQuestData] = useState(null);
  const [gamblingResult, setGamblingResult] = useState(null);
  const [hasGambledThisVisit, setHasGambledThisVisit] = useState(false);
  const [gamblingReplayBet, setGamblingReplayBet] = useState(0);
  const [hintsData, setHintsData] = useState(null);
  const [hintResult, setHintResult] = useState(null);
  const [hintBought, setHintBought] = useState(false);
  const [shopPurchases, setShopPurchases] = useState({});
  const [showNoCoins, setShowNoCoins] = useState(false);
  const [noCoinsCost, setNoCoinsCost] = useState(250);
  const [questSuccess, setQuestSuccess] = useState(null); // { title, reward }
  const [questReceived, setQuestReceived] = useState(null);
  const [showRanking, setShowRanking] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [showGlobalQuest, setShowGlobalQuest] = useState(false);
  const [showChallengeModal, setShowChallengeModal] = useState(false);
  const [challengeInfoView, setChallengeInfoView] = useState(null);
  const [challengeInfoOverrides, setChallengeInfoOverrides] = useState({});
  const [showChallengeSubmission, setShowChallengeSubmission] = useState(false);
  const [challengeAnnouncement, setChallengeAnnouncement] = useState(null);
  const [socialUnreadCount, setSocialUnreadCount] = useState(0);
  const [socialNotifications, setSocialNotifications] = useState([]);
  const [playerReactions, setPlayerReactions] = useState([]);
  const [finishedNpcVisitIds, setFinishedNpcVisitIds] = useState(() => new Set());
  const [tutorialBusy, setTutorialBusy] = useState(false);
  const [tutorialError, setTutorialError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [seenRewardStages, setSeenRewardStages] = useState(() => new Set());
  const audioRef = useRef(null);
  const btnSfxRef = useRef(null);
  const settingsPanelRef = useRef(null);
  const reactionSequenceRef = useRef(0);
  const lastReactionAtRef = useRef(0);
  const socialCheckedAtRef = useRef("");
  const shownSocialNotificationIdsRef = useRef(new Set());
  const showGlobalQuestRef = useRef(false);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "none";
    audio.src = withBasePath("/assets/bgmusic-loop.m4a");
    audio.loop = true;
    audio.volume = 0.25; // 0.5 (default volume state) * 0.5 scale
    audioRef.current = audio;

    const startPlay = () => {
      audio.play().catch((err) => {
        console.log("Audio playback waiting for interaction", err);
      });
      document.removeEventListener("click", startPlay);
      document.removeEventListener("keydown", startPlay);
      document.removeEventListener("touchstart", startPlay);
    };

    document.addEventListener("click", startPlay);
    document.addEventListener("keydown", startPlay);
    document.addEventListener("touchstart", startPlay);

    return () => {
      audio.pause();
      document.removeEventListener("click", startPlay);
      document.removeEventListener("keydown", startPlay);
      document.removeEventListener("touchstart", startPlay);
    };
  }, []);

  // ── Global button-click SFX ─────────────────────────────────────────
  useEffect(() => {
    const sfx = new Audio(withBasePath("/assets/Sound/button-click.mp3"));
    sfx.volume = 0.6;
    btnSfxRef.current = sfx;

    function handleClick(e) {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.classList.contains("npc-door-visitor")) return;
      const audio = btnSfxRef.current;
      if (!audio) return;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  // Close settings panel on outside click
  useEffect(() => {
    if (!showSettings) return;
    function handleOutside(e) {
      if (settingsPanelRef.current && !settingsPanelRef.current.contains(e.target)) {
        setShowSettings(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showSettings]);

  const toggleMute = useCallback(() => {
    if (!audioRef.current) return;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    audioRef.current.muted = nextMuted;
  }, [isMuted]);

  const handleVolumeChange = useCallback((e) => {
    if (!audioRef.current) return;
    const nextVol = parseFloat(e.target.value);
    setVolume(nextVol);
    audioRef.current.volume = nextVol * 0.5; // Scale actual played volume by 50%
    if (nextVol > 0) {
      setIsMuted(false);
      audioRef.current.muted = false;
    } else {
      setIsMuted(true);
      audioRef.current.muted = true;
    }
  }, []);
  const socketRef = useRef(null);
  const autoLoginStartedRef = useRef(false);
  const shownRewardIdsRef = useRef(new Set());
  const doorNpcRef = useRef(null);
  const activeNpcQuestRef = useRef(null);
  const tutorialActiveRef = useRef(false);
  const questDataKeyRef = useRef(-1); // npcKey for which quest data was last fetched
  const npcSwapTimerRef = useRef(null);
  const memberRefreshInFlightRef = useRef(false);
  const challengeReviewRefreshTimersRef = useRef([]);
  const socialStatusInFlightRef = useRef(false);
  const initialRoomSnapshotStageRef = useRef(initialData?.member?.stage && Array.isArray(initialData?.players)
    ? initialData.member.stage
    : "");
  const latestPositionRef = useRef(null);
  const lastPersistedPositionRef = useRef(null);
  const persistedPositionOwnerRef = useRef("");
  const positionSaveInFlightRef = useRef(false);
  const questTemplatesCacheRef = useRef(new Map());
  const hintTemplatesCacheRef = useRef(null);

  const markNpcVisitFinished = useCallback((visitId) => {
    const normalizedVisitId = String(visitId || "");
    if (!normalizedVisitId) return;
    setFinishedNpcVisitIds((current) => {
      if (current.has(normalizedVisitId)) return current;
      const next = new Set([...current].slice(-49));
      next.add(normalizedVisitId);
      return next;
    });
  }, []);

  const isAuthed = status === "authenticated";
  const activeMember = member || (previewMode ? demoMember : null);
  const isTutorialActive = activeMember?.tutorial?.status === "active";
  const tutorialRoomStage = isTutorialActive && activeMember
    ? `tutorial-room-${activeMember.discordId || activeMember.id || "player"}`
    : "";
  const selfPlayer = useMemo(
    () => (activeMember ? playerFromMember(activeMember, tutorialRoomStage) : null),
    [activeMember, tutorialRoomStage]
  );
  const mergePlayers = useCallback((currentPlayers, nextPlayers) => (
    mergeRoomPlayers(currentPlayers, nextPlayers)
  ), []);
  const tutorialVisitor = useMemo(
    () => npcFromTutorialStep(activeMember?.tutorial?.step),
    [activeMember?.tutorial?.step]
  );
  const isChallengePending = activeMember?.challenge?.status === "pending";
  const hasChallengeSubmission = Boolean(
    isChallengePending
    && activeMember?.challenge?.evidence?.url
    && activeMember?.challenge?.submittedAt
  );
  const actualStage = tutorialRoomStage || activeMember?.stage || "";
  const actualRoomKey = tutorialRoomStage
    || activeMember?.roomKey
    || roomKeyFor(activeMember?.stage, activeMember?.challengeFailureCount);
  const activeViewedRoomKey = viewedRoomKey || actualRoomKey;
  const effectiveRoomLevels = useMemo(() => {
    if (tutorialRoomStage) {
      return [{ roomKey: tutorialRoomStage, stageId: tutorialRoomStage, name: "Tutorial Room", order: 0 }];
    }
    const levels = Array.isArray(roomLevels)
      ? roomLevels.map((level) => ({
          ...level,
          roomKey: level.roomKey || roomKeyFor(level.stageId, level.failureCount)
        }))
      : [];
    if (actualRoomKey && !levels.some((level) => level.roomKey === actualRoomKey)) {
      levels.push({
        roomKey: actualRoomKey,
        stageId: actualStage,
        failureCount: Math.max(0, Number(activeMember?.challengeFailureCount) || 0),
        name: activeMember?.roomLabel || activeMember?.stageLabel || stageLabel(actualStage),
        order: Number.MAX_SAFE_INTEGER
      });
    }
    return levels.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }, [activeMember?.challengeFailureCount, activeMember?.roomLabel, activeMember?.stageLabel, actualRoomKey, actualStage, roomLevels, tutorialRoomStage]);
  const viewedRoomLevel = effectiveRoomLevels.find((level) => level.roomKey === activeViewedRoomKey) || null;
  const activeViewedStage = viewedRoomLevel?.stageId || actualStage;
  const isViewingOtherRoom = Boolean(actualRoomKey && activeViewedRoomKey && activeViewedRoomKey !== actualRoomKey);
  const viewedRoomLabel = viewedRoomLevel?.name
    || stageLabel(viewedRoomLevel?.stageId || actualStage);
  const ownRoomLabel = tutorialRoomStage
    ? "Tutorial Room"
    : effectiveRoomLevels.find((level) => level.roomKey === actualRoomKey)?.name
    || activeMember?.roomLabel
    || activeMember?.stageLabel
    || stageLabel(actualStage);
  const currentRoomLabel = isViewingOtherRoom ? viewedRoomLabel : ownRoomLabel;
  const currentRoomLevel = useMemo(() => (
    effectiveRoomLevels.find((level) => level.roomKey === actualRoomKey) || null
  ), [actualRoomKey, effectiveRoomLevels]);
  const latestChallengeInfo = actualStage ? challengeInfoOverrides[actualStage] : null;
  const currentChallengeInfo = useMemo(() => (
    latestChallengeInfo
      ? challengeInfoFromLevel({ challengeInfo: latestChallengeInfo }, currentRoomLabel)
      : challengeInfoFromLevel(currentRoomLevel, currentRoomLabel)
  ), [currentRoomLabel, currentRoomLevel, latestChallengeInfo]);
  const rewardStageKey = useMemo(() => {
    if (!activeMember || !actualStage || isViewingOtherRoom || isTutorialActive) return "";
    const playerId = activeMember.discordId || activeMember.id || "guest";
    return `${playerId}:${actualStage}`;
  }, [activeMember, actualStage, isTutorialActive, isViewingOtherRoom]);
  const shouldShakeRewardButton = Boolean(rewardStageKey && !seenRewardStages.has(rewardStageKey));
  const activeNpcVisitPurchases = useMemo(() => (
    doorNpc?.visitId && activeMember?.npcVisitId === doorNpc.visitId
      ? activeMember.npcVisitPurchases || []
      : []
  ), [activeMember?.npcVisitId, activeMember?.npcVisitPurchases, doorNpc?.visitId]);
  const isDoorNpcFinished = useMemo(() => {
    const visitId = String(doorNpc?.visitId || "");
    if (!visitId) return false;
    if (finishedNpcVisitIds.has(visitId)) return true;
    const completedActions = new Set([
      NPC_VISIT_ACTIONS.chest,
      NPC_VISIT_ACTIONS.gamble,
      NPC_VISIT_ACTIONS.hint,
      NPC_VISIT_ACTIONS.quest
    ]);
    return activeNpcVisitPurchases.some((itemId) => completedActions.has(String(itemId || "")));
  }, [activeNpcVisitPurchases, doorNpc?.visitId, finishedNpcVisitIds]);

  const applyMember = useCallback((nextMember) => {
    setMember((current) => ({
      ...current,
      ...(nextMember || {}),
      npcQuestSubmissions: nextMember?.npcQuestSubmissions?.length
        ? nextMember.npcQuestSubmissions
        : current?.npcQuestSubmissions || nextMember?.npcQuestSubmissions || [],
      socialQuestSubmissions: nextMember?.socialQuestSubmissions?.length
        ? nextMember.socialQuestSubmissions
        : current?.socialQuestSubmissions || nextMember?.socialQuestSubmissions || [],
    }));
    const nextReward = nextMember?.reward;
    if (nextReward?.id && !nextReward.seenAt && !shownRewardIdsRef.current.has(nextReward.id)) {
      shownRewardIdsRef.current.add(nextReward.id);
      setReward(nextReward);
    }
  }, []);

  const syncSocketPresenceFromMember = useCallback((nextMember) => {
    if (!nextMember || !socketRef.current) return;
    socketRef.current.emit("player:join", playerPresencePayload(playerFromMember(nextMember), {
      clientId: entryQueueClientId,
      token: entryAdmissionToken
    }));
  }, [entryAdmissionToken, entryQueueClientId]);

  const reloadMemberNow = useCallback(({ force = false } = {}) => {
    if (!isAuthed || (!force && memberRefreshInFlightRef.current)) return;
    memberRefreshInFlightRef.current = true;
    fetch(withBasePath("/api/player/me"))
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => {
        applyMember(data.member);
        syncSocketPresenceFromMember(data.member);
      })
      .catch(() => {})
      .finally(() => {
        memberRefreshInFlightRef.current = false;
      });
  }, [applyMember, isAuthed, syncSocketPresenceFromMember]);

  const scheduleChallengeReviewRefresh = useCallback(() => {
    for (const timerId of challengeReviewRefreshTimersRef.current) {
      window.clearTimeout(timerId);
    }
    challengeReviewRefreshTimersRef.current = CHALLENGE_REVIEW_REFRESH_DELAYS_MS.map((delayMs) => (
      window.setTimeout(() => reloadMemberNow({ force: true }), delayMs)
    ));
  }, [reloadMemberNow]);

  useEffect(() => () => {
    for (const timerId of challengeReviewRefreshTimersRef.current) {
      window.clearTimeout(timerId);
    }
    challengeReviewRefreshTimersRef.current = [];
  }, []);

  useEffect(() => {
    const ownerId = activeMember?.discordId || activeMember?.id || "";
    const position = activeMember?.position
      ? {
          x: Number(activeMember.position.x),
          y: Number(activeMember.position.y)
        }
      : null;
    if (!ownerId || !position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;

    latestPositionRef.current = position;
    if (persistedPositionOwnerRef.current !== ownerId) {
      persistedPositionOwnerRef.current = ownerId;
      lastPersistedPositionRef.current = position;
    }
  }, [activeMember?.discordId, activeMember?.id, activeMember?.position?.x, activeMember?.position?.y]);

  const persistLatestPosition = useCallback((force = false) => {
    if (!isAuthed || previewMode || positionSaveInFlightRef.current) return;
    const position = latestPositionRef.current;
    if (!position || !positionChangedEnough(position, lastPersistedPositionRef.current)) return;
    if (!force && document.visibilityState === "hidden") return;

    positionSaveInFlightRef.current = true;
    fetch(withBasePath("/api/player/position"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position })
    })
      .then((response) => {
        if (response.ok) lastPersistedPositionRef.current = position;
      })
      .catch(() => {})
      .finally(() => {
        positionSaveInFlightRef.current = false;
      });
  }, [isAuthed, previewMode]);

  useEffect(() => {
    if (!isAuthed || previewMode) return;
    const interval = window.setInterval(() => persistLatestPosition(false), POSITION_SAVE_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") persistLatestPosition(true);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      positionSaveInFlightRef.current = false;
    };
  }, [isAuthed, persistLatestPosition, previewMode]);

  const showPlayerReaction = useCallback(({ playerId, emoji }) => {
    if (!playerId || !emoji) return;
    reactionSequenceRef.current += 1;
    setPlayerReactions((current) => [
      ...current.slice(-19),
      {
        id: `${Date.now()}-${reactionSequenceRef.current}`,
        playerId,
        emoji
      }
    ]);
  }, []);

  const showSocialNotification = useCallback((notification, { incrementUnread = false } = {}) => {
    if (!notification?.id || shownSocialNotificationIdsRef.current.has(notification.id)) return;
    shownSocialNotificationIdsRef.current.add(notification.id);
    setSocialNotifications((current) => [...current.slice(-3), notification]);
    if (incrementUnread && !showGlobalQuestRef.current) {
      setSocialUnreadCount((current) => current + 1);
    }
    window.setTimeout(() => {
      setSocialNotifications((current) => current.filter((item) => item.id !== notification.id));
    }, 8000);
  }, []);

  const handlePlayerReaction = useCallback((emoji) => {
    if (!selfPlayer?.id || isViewingOtherRoom) return;
    const now = Date.now();
    if (now - lastReactionAtRef.current < 300) return;
    lastReactionAtRef.current = now;
    showPlayerReaction({ playerId: selfPlayer.id, emoji });
    socketRef.current?.emit("player:reaction", { emoji });
  }, [isViewingOtherRoom, selfPlayer?.id, showPlayerReaction]);

  const handlePlayerReactionEnd = useCallback((reactionId) => {
    setPlayerReactions((current) => current.filter((reaction) => reaction.id !== reactionId));
  }, []);

  const handleTutorialAction = useCallback(async (action) => {
    if (!isAuthed || tutorialBusy) {
      if (!isAuthed) setTutorialError("กรุณาเข้าสู่ระบบเพื่อดำเนิน Tutorial");
      return;
    }
    setTutorialBusy(true);
    setTutorialError("");
    try {
      const response = await fetch(withBasePath("/api/player/tutorial"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "tutorial_action_failed");
      applyMember(data.member);
      if (action === "buy-role-quest" && data.member?.npcQuest) {
        setQuestReceived(data.member.npcQuest);
      }
      if (data.reward?.coins) {
        if (action === "open-chest") {
          setQuestSuccess({ title: data.reward.title, chestReward: data.reward, isChest: true });
        } else {
          setQuestSuccess({ title: data.reward.title, reward: data.reward.coins });
        }
      }
      if (action === "finish-tutorial") setMessage("Tutorial Mode สำเร็จแล้ว");
      return data;
    } catch (error) {
      const messages = {
        not_enough_coins: "Coins ไม่เพียงพอสำหรับซื้อ Quest นี้",
        tutorial_role_npc_not_ready: "NPC ผู้ให้บททดสอบ Role ยังไม่กลับมา"
      };
      setTutorialError(messages[error.message] || "ดำเนิน Tutorial ไม่สำเร็จ กรุณาลองใหม่");
      return null;
    } finally {
      setTutorialBusy(false);
    }
  }, [applyMember, isAuthed, tutorialBusy]);

  useEffect(() => {
    tutorialActiveRef.current = isTutorialActive;
  }, [isTutorialActive]);

  useEffect(() => {
    showGlobalQuestRef.current = showGlobalQuest;
  }, [showGlobalQuest]);

  useEffect(() => {
    if (!isAuthed || !activeMember?.discordId) return;
    socialCheckedAtRef.current = new Date().toISOString();

    const fetchSocialStatus = () => {
      if (document.visibilityState === "hidden" || socialStatusInFlightRef.current) return;
      const since = socialCheckedAtRef.current;
      socialStatusInFlightRef.current = true;
      fetch(withBasePath(`/api/player/social-status?since=${encodeURIComponent(since)}`))
        .then((response) => (response.ok ? response.json() : Promise.reject(response)))
        .then((data) => {
          setSocialUnreadCount(Number(data.unreadCount) || 0);
          for (const notification of data.notifications || []) {
            showSocialNotification(notification);
          }
          socialCheckedAtRef.current = data.checkedAt || new Date().toISOString();
        })
        .catch(() => {})
        .finally(() => {
          socialStatusInFlightRef.current = false;
        });
    };

    const initialDelay = window.setTimeout(
      fetchSocialStatus,
      5_000 + Math.floor(Math.random() * 25_000)
    );
    const interval = window.setInterval(fetchSocialStatus, SOCIAL_STATUS_INTERVAL_MS);
    document.addEventListener("visibilitychange", fetchSocialStatus);
    return () => {
      window.clearTimeout(initialDelay);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", fetchSocialStatus);
      socialStatusInFlightRef.current = false;
    };
  }, [activeMember?.discordId, isAuthed, showSocialNotification]);

  useEffect(() => {
    doorNpcRef.current = doorNpc;
  }, [doorNpc]);

  useEffect(() => {
    const activeQuest = activeMember?.npcQuest || null;
    const locksDoorNpc = activeQuest && activeQuest.source !== "shop";
    activeNpcQuestRef.current = locksDoorNpc ? activeQuest : null;
    if (!locksDoorNpc) return;

    const questNpc = npcFromActiveQuest(activeQuest);
    window.clearTimeout(npcSwapTimerRef.current);
    setDoorNpc((current) => {
      const nextNpc = current ? { ...current, ...questNpc } : questNpc;
      doorNpcRef.current = nextNpc;
      return nextNpc;
    });
    setDoorNpcPhase(doorNpcRef.current ? "idle" : "entering");
  }, [activeMember?.npcQuest?.acceptedAt]);

  useEffect(() => () => {
    window.clearTimeout(npcSwapTimerRef.current);
  }, []);

  const queueDoorNpc = useCallback((npc) => {
    const visitor = activeNpcQuestRef.current && (npc?.type === "quest" || npc?.type === "stupid-quest")
      ? {
          ...npc,
          ...npcFromActiveQuest(activeNpcQuestRef.current),
          visitId: npc.visitId || ""
        }
      : npc;
    window.clearTimeout(npcSwapTimerRef.current);
    if (!doorNpcRef.current) {
      doorNpcRef.current = visitor;
      setDoorNpc(visitor);
      setDoorNpcPhase("entering");
      setNpcKey((k) => k + 1);
      return;
    }

    setDoorNpcPhase("exiting");
    npcSwapTimerRef.current = window.setTimeout(() => {
      doorNpcRef.current = visitor;
      setDoorNpc(visitor);
      setDoorNpcPhase("entering");
      setNpcKey((k) => k + 1);
    }, NPC_EXIT_MS);
  }, []);

  const handleOpenProfile = useCallback((playerId, preloadedPlayer = null) => {
    if (!playerId) return;

    if (playerId === selfPlayer?.id && activeMember) {
      setProfilePlayer({
        ...selfPlayer,
        ...activeMember,
        id: selfPlayer.id,
        questPosts: activeMember.socialQuestSubmissions,
        online: true
      });
    } else {
      // Show any available room data immediately while the full profile loads.
      const roomPlayer = players.find((p) => p.id === playerId);
      if (roomPlayer || preloadedPlayer) {
        setProfilePlayer({ ...preloadedPlayer, ...roomPlayer });
      }
    }

    fetch(withBasePath(`/api/player/profile?id=${encodeURIComponent(playerId)}`))
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(({ player }) => {
        // Merge online status if they happen to be online
        const isOnline = players.some((p) => p.id === playerId && p.online);
        setProfilePlayer({ ...player, online: isOnline });
      })
      .catch((err) => {
        console.error("Failed to load player profile", err);
      });
  }, [activeMember, players, selfPlayer]);

  const handleEquipAccessory = useCallback(async (accessoryId) => {
    const response = await fetch(withBasePath("/api/player/accessory"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessoryId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "accessory_equip_failed");

    applyMember(data.member);
    setProfilePlayer((current) => current ? { ...current, ...data.member, id: data.member.discordId } : current);
    socketRef.current?.emit("player:accessory", { accessoryId: data.member.equippedAccessory || "" });
    return data.member;
  }, [applyMember]);

  const handleTradeCoins = useCallback(async (recipientId, amount) => {
    const response = await fetch(withBasePath("/api/player/trade"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientId, amount })
    });
    const data = await response.json();
    if (!response.ok) {
      const message = {
        invalid_trade_amount: "กรุณาระบุจำนวน Coin ตั้งแต่ 1 ถึง 1,000,000",
        cannot_trade_self: "ไม่สามารถส่ง Coin ให้ตัวเองได้",
        recipient_not_found: "ไม่พบเพื่อนคนนี้ในระบบ",
        player_not_found: "ไม่พบข้อมูลผู้เล่น",
        not_enough_coins: "Coin ของคุณไม่เพียงพอ"
      }[data.error] || "ส่ง Coin ไม่สำเร็จ กรุณาลองใหม่";
      throw new Error(message);
    }
    applyMember(data.member);
    return data;
  }, [applyMember]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantsDemo = params.get("demo") === "1";
    const wantsDev = params.get("dev") === "1";
    const challengePreview = params.get("challengePreview");
    const tutorialPreview = params.get("tutorialPreview");
    const questReceivedPreview = params.get("questReceivedPreview") === "1";
    demoMember.npcQuest = wantsDemo && wantsDev && params.get("questPreview") === "1"
      ? demoNpcQuest
      : null;
    demoMember.tutorial = wantsDemo && wantsDev && tutorialPreview
      ? {
          status: "active",
          step: tutorialPreview,
          startedAt: "demo-tutorial-preview",
          updatedAt: "demo-tutorial-preview",
        }
      : null;
    demoMember.challenge = wantsDemo && wantsDev && challengePreview
      ? {
          ...demoChallenge,
          ...(challengePreview === "submitted"
            ? {
                evidence: {
                  url: withOptimizedAsset("/assets/room1.png"),
                  pathname: "demo/challenge-preview.png",
                  contentType: "image/png",
                  size: 0,
                  originalName: "challenge-preview.png",
                },
                submittedAt: "demo-challenge-preview",
              }
            : {}),
        }
      : null;
    setQuestReceived(wantsDemo && wantsDev && questReceivedPreview ? demoNpcQuest : null);
    setDemoRequested(wantsDemo);
    setDevRequested(wantsDev);
    setAuthError(params.get("error") || "");
    if (initialData?.config) {
      setConfig(initialData.config);
      return;
    }
    fetch(withBasePath("/api/config"))
      .then((res) => res.json())
      .then(setConfig)
      .catch(() => setConfig({ authConfigured: false, demoGuestsEnabled: true, devToolsEnabled: false }));
  }, [initialData?.config]);

  useEffect(() => {
    if (!config) return;
    if (!devRequested || !config.devToolsEnabled) {
      setDevMode(false);
      setDevToken("");
    } else if (!config.devToolsRequireAuth) {
      setDevMode(true);
    } else {
      fetch(withBasePath("/api/dev/token"))
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Dev tools unavailable.");
          setDevToken(data.token || "");
          setDevMode(true);
        })
        .catch(() => {
          setDevToken("");
          setDevMode(false);
        });
    }

    if (demoRequested && config.demoGuestsEnabled) {
      setPreviewMode(true);
      setMember(demoMember);
      setMessage("Preview mode");
      return;
    }

    if (
      status === "unauthenticated" &&
      config.authConfigured &&
      !authError &&
      !autoLoginStartedRef.current
    ) {
      autoLoginStartedRef.current = true;
      signIn("discord", { callbackUrl: withBasePath("/") });
    }
  }, [authError, config, demoRequested, devRequested, status]);

  useEffect(() => {
    if (!isAuthed || member) return;
    fetch(withBasePath("/api/player/me"))
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => applyMember(data.member))
      .catch(() => setMessage("DB setup needed"));
  }, [applyMember, isAuthed, member]);

  useEffect(() => {
    if (!isAuthed) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden" || memberRefreshInFlightRef.current) return;
      memberRefreshInFlightRef.current = true;
      fetch(withBasePath("/api/player/me"))
        .then((res) => (res.ok ? res.json() : Promise.reject(res)))
        .then((data) => {
          // Preserve local position to avoid snap-back caused by stale DB data
          setMember((current) => ({ ...data.member, position: current?.position ?? data.member.position }));
          const nextReward = data.member?.reward;
          if (nextReward?.id && !nextReward.seenAt && !shownRewardIdsRef.current.has(nextReward.id)) {
            shownRewardIdsRef.current.add(nextReward.id);
            setReward(nextReward);
          }
        })
        .catch(() => {})
        .finally(() => {
          memberRefreshInFlightRef.current = false;
        });
    }, MEMBER_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      memberRefreshInFlightRef.current = false;
    };
  }, [isAuthed]);

  useEffect(() => {
    const challenge = activeMember?.challenge;
    const challengeStatus = String(challenge?.status || "").toLowerCase();
    if (!isAuthed || previewMode || challengeStatus !== "pending") return undefined;

    const refreshPendingChallenge = () => {
      if (document.visibilityState === "hidden") return;
      reloadMemberNow();
    };
    const timeoutId = window.setTimeout(refreshPendingChallenge, 2_000);
    const intervalId = window.setInterval(refreshPendingChallenge, CHALLENGE_PENDING_REFRESH_INTERVAL_MS);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [
    activeMember?.challenge?.requestedAt,
    activeMember?.challenge?.status,
    activeMember?.challenge?.submissionId,
    activeMember?.discordId,
    isAuthed,
    previewMode,
    reloadMemberNow
  ]);

  useEffect(() => {
    if (!actualRoomKey) return;
    setViewedRoomKey(actualRoomKey);
  }, [actualRoomKey]);

  useEffect(() => {
    if (!activeMember) return;
    const playerId = activeMember.discordId || activeMember.id || "guest";
    try {
      const raw = window.localStorage.getItem(`questroom:stage-rewards-seen:${playerId}`);
      const stages = raw ? JSON.parse(raw) : [];
      setSeenRewardStages(new Set(Array.isArray(stages) ? stages.map((stage) => `${playerId}:${stage}`) : []));
    } catch {
      setSeenRewardStages(new Set());
    }
  }, [activeMember]);

  useEffect(() => {
    if (!isAuthed) return;
    const loadRoomLevels = () => {
      if (document.visibilityState === "hidden") return;
      fetch(withBasePath("/api/player/rooms"))
        .then((res) => (res.ok ? res.json() : Promise.reject(res)))
        .then(({ levels }) => setRoomLevels(Array.isArray(levels) ? levels : []))
        .catch(() => {});
    };
    if (!roomLevels.length) loadRoomLevels();
    const interval = window.setInterval(loadRoomLevels, ROOM_LEVEL_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isAuthed, roomLevels.length]);

  useEffect(() => {
    if (!isAuthed || !activeViewedRoomKey) return;
    const controller = new AbortController();
    const roomKey = activeViewedRoomKey;
    if (!isViewingOtherRoom && initialRoomSnapshotStageRef.current === roomKey) {
      initialRoomSnapshotStageRef.current = "";
      return undefined;
    }

    const loadRoomSnapshot = () => {
      fetch(withBasePath(`/api/player/room?roomKey=${encodeURIComponent(roomKey)}`), {
        signal: controller.signal
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(res)))
        .then(({ players: roomPlayers }) => {
          setPlayers((prev) => {
            const currentPlayersById = new Map(prev.map((player) => [player.id, player]));
            return mergePlayers(
              prev,
              (roomPlayers || []).map((player) => ({
                ...player,
                online: Boolean(currentPlayersById.get(player.id)?.online || player.online)
              }))
            );
          });
        })
        .catch(() => {});
    };
    const delayMs = isViewingOtherRoom ? 0 : 1_000 + Math.floor(Math.random() * 7_000);
    const timeoutId = window.setTimeout(loadRoomSnapshot, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [activeViewedRoomKey, isAuthed, isViewingOtherRoom, mergePlayers]);

  useEffect(() => {
    if (!selfPlayer) return;
    const socket = io({
      path: withBasePath("/socket.io"),
      addTrailingSlash: false,
      transports: SOCKET_TRANSPORTS,
      reconnectionAttempts: 6,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      randomizationFactor: 0.75,
      timeout: 20_000
    });
    socketRef.current = socket;

    socket.on("room:state", (roomPlayers) => {
      setPlayers((prev) => mergePlayers(prev, roomPlayers));
    });
    socket.on("player:upsert", (player) => {
      setPlayers((prev) => mergePlayers(prev, [player]));
    });
    socket.on("players:patch", (roomPlayers) => {
      setPlayers((prev) => mergePlayers(prev, roomPlayers));
    });
    socket.on("player:leave", (id) => {
      setPlayers((prev) => prev.filter((player) => player.id !== id));
    });
    socket.on("room:peek-state", ({ players: roomPlayers = [] } = {}) => {
      setPlayers((prev) => mergePlayers(prev, roomPlayers));
    });
    socket.on("timer:sync", (data) => setCycleInfo(data));
    socket.on("npc:visit", (npc) => {
      if (tutorialActiveRef.current) return;
      queueDoorNpc(npc);
      setNpcVisit(null);
    });
    socket.on("challenge:announce", (data) => {
      setChallengeAnnouncement(data);
    });
    socket.on("member:update", ({ member: nextMember, reason } = {}) => {
      const reviewReason = ["approve", "approved", "award", "awarded", "badge", "badge_awarded", "challenge_sync"].includes(String(reason || "").toLowerCase());
      if (nextMember) {
        applyMember(nextMember);
        syncSocketPresenceFromMember(nextMember);
        if (reviewReason) scheduleChallengeReviewRefresh();
        return;
      }
      if (reviewReason) {
        reloadMemberNow({ force: true });
        scheduleChallengeReviewRefresh();
      }
    });
    socket.on("questroom:reload", () => {
      reloadMemberNow({ force: true });
      scheduleChallengeReviewRefresh();
    });
    socket.on("social:notification", (data) => {
      if (data?.author?.id && data.author.id === activeMember?.discordId) return;
      showSocialNotification(data, { incrementUnread: true });
    });
    socket.on("player:reaction", showPlayerReaction);
    socket.on("connect", () => {
      socket.emit("player:join", playerPresencePayload(selfPlayer, {
        clientId: entryQueueClientId,
        token: entryAdmissionToken
      }));
    });

    if (socket.connected) {
      socket.emit("player:join", playerPresencePayload(selfPlayer, {
        clientId: entryQueueClientId,
        token: entryAdmissionToken
      }));
    }

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [activeMember?.discordId, applyMember, entryAdmissionToken, entryQueueClientId, mergePlayers, previewMode, queueDoorNpc, reloadMemberNow, scheduleChallengeReviewRefresh, selfPlayer?.id, selfPlayer?.roomKey, selfPlayer?.stage, showPlayerReaction, showSocialNotification, syncSocketPresenceFromMember]);

  useEffect(() => {
    if (!selfPlayer?.id) return;
    socketRef.current?.emit("player:sync", {
      roomKey: selfPlayer.roomKey,
      challengeFailureCount: selfPlayer.challengeFailureCount
    });
  }, [selfPlayer?.challengeFailureCount, selfPlayer?.id, selfPlayer?.roomKey]);

  useEffect(() => {
    if (!isViewingOtherRoom || !activeViewedRoomKey) return;
    const requestRoomSnapshot = () => {
      if (document.visibilityState === "hidden") return;
      socketRef.current?.emit("room:peek", { roomKey: activeViewedRoomKey });
    };
    requestRoomSnapshot();
    const interval = window.setInterval(requestRoomSnapshot, ROOM_PEEK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [activeViewedRoomKey, isViewingOtherRoom]);

  useEffect(() => {
    if (!selfPlayer) return;
    setPlayers((prev) => mergePlayers(prev, [selfPlayer]));
  }, [mergePlayers, selfPlayer]);

  useEffect(() => {
    if (!activeMember) return;
    socketRef.current?.emit("player:balance", { coins: Number(activeMember.coins) || 0 });
  }, [activeMember?.coins]);

  const emitQuestActive = useCallback((quest) => {
    socketRef.current?.emit("quest:active", {
      active: Boolean(quest),
      source: quest?.source || ""
    });
  }, []);

  useEffect(() => {
    if (!activeMember || isViewingOtherRoom) return;
    emitQuestActive(activeMember.npcQuest);
  }, [activeMember?.npcQuest, activeMember?.discordId, activeMember?.id, emitQuestActive, isViewingOtherRoom]);

  const moveSelf = useCallback(
    (x, y) => {
      if (!activeMember || !selfPlayer || isViewingOtherRoom) return;
      const nextPosition = getWalkablePoint({ x, y });
      if (!nextPosition) return;
      setTarget(nextPosition);
      setMember((current) =>
        current
          ? { ...current, position: nextPosition }
          : current
      );
      if (previewMode) {
        demoMember.position = nextPosition;
      }

      const payload = { x, y, action: "move" };
      latestPositionRef.current = nextPosition;
      socketRef.current?.emit("player:move", payload);
    },
    [activeMember, isViewingOtherRoom, previewMode, selfPlayer]
  );

  const handleStageClick = useCallback(
    (event) => {
      if (!activeMember || isViewingOtherRoom) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      moveSelf(x, y);
    },
    [activeMember, isViewingOtherRoom, moveSelf]
  );

  const handleChallenge = () => {
    if (isViewingOtherRoom) return;
    if (isTutorialActive) {
      setMessage("ทำ Tutorial Mode ให้เสร็จก่อนเริ่ม Challenge");
      return;
    }
    if (isChallengePending) {
      setShowChallengeSubmission(true);
      return;
    }
    if (!isAuthed) {
      setMessage("Preview mode");
      return;
    }
    setShowChallengeModal(true);
  };

  const handleChallengeConfirm = async () => {
    setShowChallengeModal(false);
    setMessage("Pedding...");
    const response = await fetch(withBasePath("/api/player/challenge"), { method: "POST" });
    const data = await response.json();
    if (!response.ok || (data && data.ok === false)) {
      setMessage(data?.reason === "not_enough_coins" ? "Need more coins" : "Try again");
      if (data?.reason === "not_enough_coins") {
        setNoCoinsCost(data.cost || activeMember?.currentChallengeCost || 250);
        setShowNoCoins(true);
      }
      return;
    }
    applyMember(data.member);
    setMessage("ให้น้องไปเรียกพี่ประจำห้องได้เลย");
    socketRef.current?.emit("challenge:announce", {
      stageName: activeMember?.stageLabel || activeMember?.stage || "",
    });
  };

  const handleChallengeSubmit = useCallback(async (file, onUploadProgress, postText = "") => {
    if (!isAuthed) throw new Error("Please log in before submitting your challenge.");
    const evidence = await uploadNpcQuestEvidence(
      file,
      activeMember?.discordId || activeMember?.id,
      onUploadProgress
    );
    const response = await fetch(withBasePath("/api/player/challenge"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evidence, postText })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "challenge_submit_failed");
    applyMember(data.member);
    setMessage("Challenge submitted. Waiting for admin review.");
  }, [activeMember?.discordId, activeMember?.id, applyMember, isAuthed]);

  // Fetch quest template when a quest-type NPC visits
  useEffect(() => {
    if (npcVisit?.tutorialAction === "accept-first-quest") {
      setNpcQuestData(TUTORIAL_FIRST_QUEST);
      return;
    }

    if (npcVisit?.activeQuest && activeMember?.npcQuest) {
      setNpcQuestData(activeMember.npcQuest);
      return;
    }

    const QUEST_DIFFICULTY_MAP = {
      "quest-easy":   "easy",
      "quest-medium": "medium",
      "quest-hard":   "hard",
      "stupid-quest": "stupid",
    };
    const difficulty = QUEST_DIFFICULTY_MAP[npcVisit?.id];
    if (!npcVisit || !difficulty) {
      // Dialog closed or non-quest NPC — npcKey effect handles clearing npcQuestData
      return;
    }

    // Already fetched quest data for this NPC visit — keep the same reward
    if (questDataKeyRef.current === npcKey) return;
    questDataKeyRef.current = npcKey;

    // Server already picked the quest — use it directly (stable across refreshes)
    if (npcVisit.questData) {
      setNpcQuestData(npcVisit.questData);
      return;
    }

    const applyQuestPool = (pool) => {
      if (pool.length === 0) { setNpcQuestData(null); return; }
      const picked = pool[Math.floor(Math.random() * pool.length)];
      const reward = Math.round(
        picked.rewardMin + Math.random() * (picked.rewardMax - picked.rewardMin)
      );
      setNpcQuestData({ ...picked, reward });
    };
    const cachedPool = questTemplatesCacheRef.current.get(difficulty);
    if (cachedPool) {
      applyQuestPool(cachedPool);
      return;
    }

    fetch(withBasePath(`/api/quest-templates?difficulty=${difficulty}`))
      .then((r) => r.json())
      .then((data) => {
        const pool = Array.isArray(data.quests) ? data.quests : [];
        questTemplatesCacheRef.current.set(difficulty, pool);
        applyQuestPool(pool);
      })
      .catch(() => setNpcQuestData(null));

  }, [activeMember?.npcQuest, npcKey, npcVisit]);

  useEffect(() => {
    if (npcVisit?.type === "hints") {
      if (!hintsData) {
        if (hintTemplatesCacheRef.current) {
          setHintsData(hintTemplatesCacheRef.current);
        } else {
          fetch(withBasePath("/api/hint-templates"))
            .then((r) => r.json())
            .then((data) => {
              const hints = Array.isArray(data.hints) ? data.hints : [];
              hintTemplatesCacheRef.current = hints;
              setHintsData(hints);
            })
            .catch(() => setHintsData([]));
        }
      }
    } else {
      setHintsData(null);
      setHintResult(null);
    }

    if (npcVisit?.type !== "gambling") {
      setGamblingResult(null);
    }
  }, [hintsData, npcVisit?.type]);

  // Reset hint + shop state when a new NPC spawns (npcKey increments on each new arrival)
  useEffect(() => {
    setNpcQuestData(null);         // clear so next visit fetches fresh
    questDataKeyRef.current = -1;  // allow fetch for the new NPC
    setHintBought(false);
    setHintResult(null);
    setHintsData(null);
    setShopPurchases({});
    setHasGambledThisVisit(false);
    setGamblingReplayBet(0);
  }, [npcKey]);

  useEffect(() => {
    const purchases = new Set(activeNpcVisitPurchases);
    setHintBought(purchases.has(NPC_VISIT_ACTIONS.hint));
    setHasGambledThisVisit(purchases.has(NPC_VISIT_ACTIONS.gamble));
    setShopPurchases(activeNpcVisitPurchases
      .filter((itemId) => !itemId.startsWith("__"))
      .reduce((purchases, itemId) => ({
        ...purchases,
        [itemId]: {
          message: "ซื้อแล้ว",
          count: (purchases[itemId]?.count || 0) + 1,
        }
      }), {}));
  }, [activeNpcVisitPurchases]);

  const handleNpcQuestAccept = useCallback(async () => {
    if (!isAuthed || !npcQuestData || !npcVisit) return;
    if (npcVisit.tutorialAction === "accept-first-quest") {
      const data = await handleTutorialAction("accept-first-quest");
      if (data?.member) {
        activeNpcQuestRef.current = data.member.npcQuest;
        setQuestReceived(data.member.npcQuest);
        emitQuestActive(data.member.npcQuest);
      }
      setNpcVisit(null);
      setNpcQuestData(null);
      return;
    }
    try {
      const res = await fetch(withBasePath("/api/player/npc-quest"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          difficulty:   npcQuestData.difficulty,
          title:        npcQuestData.title,
          description:  npcQuestData.description,
          reward:       npcQuestData.reward,
          npcType:      npcVisit.id,
          npcName:      npcVisit.npcId || "",
          npcCharacter: npcQuestData.npcCharacter || null,
        }),
      });
	    if (res.ok) {
	        const data = await res.json();
	        applyMember(data.member);
	        activeNpcQuestRef.current = data.member.npcQuest;
	        const questNpc = npcFromActiveQuest(data.member.npcQuest);
	        setDoorNpc((current) => {
	          const nextNpc = current ? { ...current, ...questNpc } : questNpc;
	          doorNpcRef.current = nextNpc;
	          return nextNpc;
	        });
	        setDoorNpcPhase("idle");
	        setQuestReceived(data.member.npcQuest);
	        emitQuestActive(data.member.npcQuest);
      }
    } catch {}
    setNpcVisit(null);
    setNpcQuestData(null);
  }, [applyMember, emitQuestActive, handleTutorialAction, isAuthed, npcQuestData, npcVisit]);

  const handleQuestScrollBought = useCallback((assignedQuest, updatedMember, options = {}) => {
    // Quest is assigned directly to the player — no quest NPC spawned at the door.
    // The shop NPC (Milt) stays until its current cooldown expires.
    applyMember(updatedMember);
    setQuestReceived(assignedQuest);
    activeNpcQuestRef.current = null;
    // Notify server so timer freezes at 1 sec when it expires
    emitQuestActive(assignedQuest || updatedMember?.npcQuest);
    if (!options.keepShopOpen) {
      setNpcVisit(null);
      setNpcQuestData(null);
    }
  }, [applyMember, emitQuestActive]);

  const handleNpcQuestCancel = useCallback(async () => {
    if (!isAuthed) return;
	    try {
	      const res = await fetch(withBasePath("/api/player/npc-quest"), { method: "DELETE" });
	      if (res.ok) {
	        const data = await res.json();
	        applyMember(data.member);
	        activeNpcQuestRef.current = null;
	        emitQuestActive(null);
	        setNpcVisit(null);
	        setNpcQuestData(null);
	        markNpcVisitFinished(doorNpcRef.current?.visitId);
	      }
	    } catch {}
	  }, [applyMember, emitQuestActive, isAuthed, markNpcVisitFinished]);

  const handleNpcQuestSubmit = useCallback(async (file, onUploadProgress, postText = "") => {
    if (!isAuthed) throw new Error("กรุณาเข้าสู่ระบบก่อนส่งเควส");
	    const activeVisitId = doorNpcRef.current?.visitId || npcVisit?.visitId || "";
	    const evidence = await uploadNpcQuestEvidence(file, activeMember?.discordId || activeMember?.id, onUploadProgress);
    const res = await fetch(withBasePath("/api/player/npc-quest"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evidence, postText, visitId: activeVisitId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "quest_submit_failed");

    applyMember(data.member);
    activeNpcQuestRef.current = null;
	    emitQuestActive(null);
	    setNpcVisit(null);
	    setNpcQuestData(null);
	    markNpcVisitFinished(activeVisitId);
	    setQuestSuccess({ title: data.submission?.title || "NPC Quest", reward: data.reward ?? 0 });
    socketRef.current?.emit("social:publish", {
      id: data.submission?.id,
      title: data.submission?.title,
      type: "npc-quest",
      authorName: activeMember?.name,
      username: activeMember?.username
    });
	  }, [activeMember?.discordId, activeMember?.id, activeMember?.name, activeMember?.username, applyMember, emitQuestActive, isAuthed, markNpcVisitFinished, npcVisit?.visitId]);

  const handleChestClaim = useCallback((chestReward) => {
    markNpcVisitFinished(doorNpcRef.current?.visitId);
    setQuestSuccess({ title: "หีบสมบัติ", chestReward, isChest: true });
  }, [markNpcVisitFinished]);

  const handleNpcCoinsNeeded = useCallback((cost) => {
    setNoCoinsCost(Number(cost) || 0);
    setShowNoCoins(true);
  }, []);

  const handleGamble = useCallback(async (betAmount) => {
    if (!isAuthed) return;
    try {
      const res = await fetch(withBasePath("/api/player/gamble"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ betAmount, visitId: npcVisit?.visitId }),
      });
      const data = await res.json();
      if (res.ok) {
        applyMember(data.member);
        setGamblingResult({ won: data.won, delta: data.delta });
        setHasGambledThisVisit(true);
        const updatedCoins = data.member?.coins || 0;
        const maxBet = Math.min(10000, Math.max(0, Math.floor(updatedCoins)));
        setGamblingReplayBet(maxBet > 0 ? Math.floor(Math.random() * maxBet) + 1 : 0);
      } else if (data.error === "not_enough_coins") {
        handleNpcCoinsNeeded(betAmount);
      }
    } catch {}
  }, [applyMember, handleNpcCoinsNeeded, isAuthed, npcVisit?.visitId]);

  const handleHintBuy = useCallback(async (hintId) => {
    if (!isAuthed) return;
    try {
      const res = await fetch(withBasePath("/api/player/hint"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hintId, visitId: npcVisit?.visitId }),
      });
      const data = await res.json();
      if (res.ok) {
        applyMember(data.member);
        setHintResult({ title: data.hintTitle, content: data.hintContent });
        setHintBought(true);
        try { new Audio(withBasePath("/assets/Sound/usemoney.mp3")).play().catch(() => {}); } catch {}
      } else if (data.error === "not_enough_coins") {
        handleNpcCoinsNeeded(data.cost);
      }
    } catch {}
  }, [applyMember, handleNpcCoinsNeeded, isAuthed, npcVisit?.visitId]);

  const handleNpcQuestClose = useCallback(() => {
    setNpcVisit(null);
    // npcQuestData intentionally kept — same reward shown if dialog reopened for same NPC
    setGamblingResult(null);
    setHintResult(null); // clear hint content on close; hintBought stays for the visit
  }, []);

	  const handleGamblingKickOut = useCallback(() => {
	    markNpcVisitFinished(npcVisit?.visitId || doorNpcRef.current?.visitId);
	    setNpcVisit(null);
	    setNpcQuestData(null);
	    setGamblingResult(null);
	    setHintResult(null);
	  }, [markNpcVisitFinished, npcVisit?.visitId]);

	  const handleNpcInteract = useCallback(() => {
	    if (isTutorialActive) return;
	    if (!doorNpc || doorNpcPhase === "exiting") return;
	    try { new Audio(withBasePath("/assets/Sound/openmenu.mp3")).play().catch(() => {}); } catch {}
	    setNpcVisit(isDoorNpcFinished ? { ...doorNpc, noBusiness: true } : doorNpc);
	  }, [doorNpc, doorNpcPhase, isDoorNpcFinished, isTutorialActive]);

  const handleTutorialNpcInteract = useCallback(() => {
    if (!tutorialVisitor) return;
    try { new Audio(withBasePath("/assets/Sound/openmenu.mp3")).play().catch(() => {}); } catch {}
    if (tutorialVisitor.tutorialAction === "accept-first-quest") {
      setNpcQuestData(TUTORIAL_FIRST_QUEST);
    } else if (tutorialVisitor.activeQuest && activeMember?.npcQuest) {
      setNpcQuestData(activeMember.npcQuest);
    }
    setNpcVisit(tutorialVisitor);
  }, [activeMember?.npcQuest, tutorialVisitor]);

  const handleQuestSidebarOpen = useCallback(() => {
    if (!activeMember?.npcQuest) return;
    setNpcQuestData(activeMember.npcQuest);
    if (activeMember.npcQuest.source === "tutorial-first-quest") {
      setNpcVisit({ id: "quest-easy", type: "quest", name: "Quest (Tutorial)", npcId: "near", activeQuest: true });
      return;
    }
    const isShopQuest = activeMember.npcQuest.source === "shop";
    setNpcVisit(
      isShopQuest
        ? { id: "shop", type: "quest", name: "Shop", npcId: "milt", activeQuest: true }
        : { id: "quest-sidebar", type: "quest", name: "Quest details", activeQuest: true, standaloneQuest: true }
    );
  }, [activeMember?.npcQuest]);

  const handleCooldownReduction = useCallback((milliseconds) => {
    if (!milliseconds) return;
    socketRef.current?.emit("shop:reduce-cooldown", { milliseconds });
  }, []);

  const handleGlobalQuestOpen = useCallback(() => {
    if (!activeMember || (!isAuthed && !previewMode)) {
      signIn("discord");
      return;
    }
    setShowGlobalQuest(true);
    setSocialUnreadCount(0);
    if (isAuthed) {
      fetch(withBasePath("/api/player/social-status"), { method: "POST" }).catch(() => {});
    }
    if (isAuthed && activeMember.tutorial?.step === "social-intro") {
      void handleTutorialAction("open-social");
    }
  }, [activeMember, handleTutorialAction, isAuthed, previewMode]);

  const handleGlobalQuestClose = useCallback(() => {
    setShowGlobalQuest(false);
    if (isAuthed && ["social-intro", "social-opened"].includes(activeMember?.tutorial?.step)) {
      void handleTutorialAction("finish-social");
    }
  }, [activeMember?.tutorial?.step, handleTutorialAction, isAuthed]);

  const handleRewardClose = useCallback(() => {
    const rewardId = reward?.id;
    setReward(null);
    if (!rewardId || !isAuthed) return;
    fetch(withBasePath("/api/player/reward"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rewardId })
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => applyMember(data.member))
      .catch(() => {});
  }, [applyMember, isAuthed, reward?.id]);

  const handleStageRewardOpen = useCallback(() => {
    if (rewardStageKey) {
      const separatorIndex = rewardStageKey.indexOf(":");
      const playerId = separatorIndex >= 0 ? rewardStageKey.slice(0, separatorIndex) : "guest";
      setSeenRewardStages((current) => {
        if (current.has(rewardStageKey)) return current;
        const next = new Set(current);
        next.add(rewardStageKey);
        try {
          const stages = [...next]
            .filter((key) => key.startsWith(`${playerId}:`))
            .map((key) => key.slice(playerId.length + 1));
          window.localStorage.setItem(`questroom:stage-rewards-seen:${playerId}`, JSON.stringify(stages));
        } catch {}
        return next;
      });
    }
    setChallengeInfoView("details");
    if (!actualStage) return;

    fetch(withBasePath(`/api/player/challenge-info?stage=${encodeURIComponent(actualStage)}`), {
      cache: "no-store"
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => {
        if (!data?.challengeInfo) return;
        setChallengeInfoOverrides((current) => ({
          ...current,
          [actualStage]: data.challengeInfo
        }));
      })
      .catch(() => {});
  }, [actualStage, rewardStageKey]);

  const visiblePlayers = useMemo(() => {
    if (!activeViewedRoomKey) return [];
    const roomPlayers = players.filter((player) => {
      const playerRoomKey = player.roomKey || roomKeyFor(player.stage, player.challengeFailureCount);
      const isInViewedRoom = playerRoomKey === activeViewedRoomKey || (!player.stage && !player.roomKey);
      const isBrowsingSelf = isViewingOtherRoom && player.id === selfPlayer?.id;
      return isInViewedRoom && !isBrowsingSelf;
    });
    return selectRoomPlayers(roomPlayers, {
      selfId: selfPlayer?.id,
      excludeSelf: isViewingOtherRoom
    });
  }, [activeViewedRoomKey, isViewingOtherRoom, players, selfPlayer?.id]);

  if (!activeMember) {
    return <LoginScreen authConfigured={Boolean(config?.authConfigured)} authError={authError} />;
  }

  return (
    <main className="game-shell">
      <section className="top-left hud-cluster">
        <div className="stage-title-row">
          <div className="stage-title-text">
            <h1>{currentRoomLabel}</h1>
            {isViewingOtherRoom && <p>(Spectator)</p>}
          </div>
          {!isViewingOtherRoom && (
            <button
              className={`stage-reward-button${shouldShakeRewardButton ? " is-shaking" : ""}`}
              type="button"
              aria-label="Open challenge details"
              disabled={isTutorialActive}
              onClick={handleStageRewardOpen}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withOptimizedAsset("/assets/Card.webp")} alt="" className="gift-line-icon" />
            </button>
          )}
        </div>
        {!isViewingOtherRoom && (
          <div className="action-row">
            <button
              className={`challenge-button${isChallengePending ? " is-pending" : ""}${hasChallengeSubmission ? " is-submitted" : ""}`}
              type="button"
              onClick={handleChallenge}
              disabled={isTutorialActive}
            >
              <Zap size={23} fill="currentColor" />
              <span>
                {hasChallengeSubmission
                  ? "แก้ไข"
                  : isChallengePending
                    ? "อัปโหลดไฟล์งาน"
                    : "Challenge"}
              </span>
            </button>
            <div className="cost-chip">
              <span>-{activeMember?.currentChallengeCost || 250}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withOptimizedAsset("/assets/Coin.png")} alt="coin" />
              {activeMember?.costMultiplier > 1 && (
                <span className="multiplier-tag">x{activeMember.costMultiplier}</span>
              )}
            </div>
            {isChallengePending && (
              <p className="challenge-pending-note">ให้น้องไปเรียกพี่ประจำห้องได้เลย</p>
            )}
          </div>
        )}
      </section>

      {activeMember?.npcQuest && !questReceived && !isViewingOtherRoom && (
        <div className="npc-quest-sidebar npc-quest-sidebar--arriving">
          <span className="npc-active-quest-label">📜 เควสที่รับไว้</span>
          <span className="npc-active-quest-title">{activeMember.npcQuest.title}</span>
          <span className="npc-active-quest-reward">🪙 ×{activeMember.npcQuest.reward}</span>
          <button
            className="npc-active-quest-done"
            type="button"
            onClick={handleQuestSidebarOpen}
          >
            ดูรายละเอียด / ส่งเควส
          </button>
        </div>
      )}

      {!isViewingOtherRoom && (
        <section className="top-right hud-cluster">
          <p className="version">Ver.Demo</p>
          <div className="profile-row">
            <div className="coin-pill">
              <span>{activeMember?.coins?.toLocaleString?.() || "0"}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withOptimizedAsset("/assets/Coin.png")} alt="coin" />
            </div>
            <div className="ticket-pill" title="Select 1 Asset on HamStore tickets">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withOptimizedAsset("/assets/Item/AssetTicket.png")} alt="asset ticket" />
              <span>x{Number(activeMember?.shopAssetTickets || 0).toLocaleString()}</span>
            </div>
            <div className="profile-action">
              <button className="circle-button ranking" type="button" aria-label="Ranking" onClick={() => setShowRanking(true)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={withOptimizedAsset("/assets/Rank.webp")} alt="Rank" />
              </button>
              <span>Rank</span>
            </div>
            <div className="profile-action">
              <button
                className={`circle-button global${activeMember?.tutorial?.step === "social-intro" ? " tutorial-social-target" : ""}`}
                type="button"
                aria-label={activeMember && isAuthed ? "Global Quest" : "Login with Discord"}
                onClick={handleGlobalQuestOpen}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={withOptimizedAsset("/assets/Global.png")} alt="" />
                {socialUnreadCount > 0 && (
                  <b className="social-unread-badge">{socialUnreadCount > 99 ? "99+" : socialUnreadCount}</b>
                )}
              </button>
              <span>Social</span>
            </div>
            <div className="profile-action">
              <button
                className="circle-button friends"
                type="button"
                aria-label={activeMember && isAuthed ? "Friends list" : "Login with Discord"}
                onClick={() => (activeMember && isAuthed ? setShowFriends(true) : signIn("discord"))}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={withOptimizedAsset("/assets/Friends.png")} alt="" />
              </button>
              <span>Friends</span>
            </div>
          </div>
        </section>
      )}

      {!isViewingOtherRoom && (
        <section className="bottom-right hud-cluster">
          <div className="profile-action settings-wrapper" ref={settingsPanelRef}>
            <span>ตั้งค่า</span>
            <button
              className={`circle-button settings-btn${showSettings ? " active" : ""}`}
              type="button"
              aria-label="Settings"
              onClick={() => setShowSettings((s) => !s)}
            >
              <Settings size={30} strokeWidth={2.5} />
            </button>
            {showSettings && (
              <div className="settings-panel">
                <p className="settings-panel-title">⚙️ ตั้งค่า</p>
                <div className="settings-row">
                  <button
                    className="settings-mute-btn"
                    type="button"
                    aria-label={isMuted ? "Unmute" : "Mute"}
                    onClick={toggleMute}
                  >
                    {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <input
                    type="range"
                    min="0" max="1" step="0.05"
                    value={volume}
                    onChange={handleVolumeChange}
                    className="settings-volume-slider"
                    aria-label="Volume"
                  />
                  <span className="settings-vol-pct">
                    {isMuted ? "Muted" : `${Math.round(volume * 100)}%`}
                  </span>
                </div>
                {isAuthed && (
                  <button
                    className="settings-logout-btn"
                    type="button"
                    onClick={() => signOut()}
                  >
                    <LogOut size={16} />
                    ออกจากระบบ
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      )}



      {socialNotifications.length > 0 && (
        <aside className="social-notification-list" aria-live="polite">
          {socialNotifications.map((notification) => (
            <p className="social-notification" key={notification.id}>
              {socialNotificationText(notification)}
            </p>
          ))}
        </aside>
      )}

      <section className="game-stage" onClick={handleStageClick}>
        <RoomCanvas target={isViewingOtherRoom ? null : target} onTargetHandled={() => setTarget(null)} />
        <PlayerLayer
          players={visiblePlayers}
          selfId={isViewingOtherRoom ? undefined : selfPlayer?.id}
          reactions={playerReactions}
          onOpenProfile={(player) => handleOpenProfile(player.id, player)}
          onSelectReaction={handlePlayerReaction}
          onReactionEnd={handlePlayerReactionEnd}
        />
        {!isViewingOtherRoom && isTutorialActive && tutorialVisitor && (
          <NpcDoorVisitor
            key={`tutorial-${activeMember?.tutorial?.step}`}
            npc={tutorialVisitor}
            phase="entering"
            onInteract={handleTutorialNpcInteract}
          />
        )}
        {!isViewingOtherRoom && !isTutorialActive && (
          <>
            <NpcDoorVisitor key={npcKey} npc={doorNpc} phase={doorNpcPhase} onInteract={handleNpcInteract} />
            <RoomClock cycleInfo={cycleInfo} />
          </>
        )}
      </section>
      <TutorialMode
        tutorial={activeMember?.tutorial}
        activeQuest={activeMember?.npcQuest}
        busy={tutorialBusy}
        error={tutorialError}
        onAction={handleTutorialAction}
        socialOpen={showGlobalQuest}
      />
      {profilePlayer && (
        <ProfileModal
          player={profilePlayer}
          selfId={selfPlayer?.id}
          onClose={() => setProfilePlayer(null)}
          onTrade={handleTradeCoins}
          onEquipAccessory={handleEquipAccessory}
        />
      )}
      {reward && <RewardModal reward={reward} onClose={handleRewardClose} />}
      {questReceived && (
        <QuestReceivedPopup quest={questReceived} onDone={() => setQuestReceived(null)} />
      )}
      {npcVisit && (
        <NpcVisitModal
          npc={npcVisit}
          questData={npcQuestData}
          onAccept={handleNpcQuestAccept}
          activeQuest={Boolean(npcVisit.activeQuest && activeMember?.npcQuest)}
          onQuestCancel={handleNpcQuestCancel}
          onQuestSubmit={handleNpcQuestSubmit}
          hintsData={hintsData}
          hintResult={hintResult}
          hintBought={hintBought}
          onHintBuy={handleHintBuy}
          gamblingResult={gamblingResult}
          hasGambledThisVisit={hasGambledThisVisit}
          gamblingReplayBet={gamblingReplayBet}
          onGamble={handleGamble}
          onGamblingKickOut={handleGamblingKickOut}
          memberShop={activeMember ? {
            cooldownT1: activeMember.shopCooldownT1 || 0,
            cooldownT2: activeMember.shopCooldownT2 || 0,
            limitBreak: activeMember.shopLimitBreak || false,
            assetTickets: activeMember.shopAssetTickets || 0,
            ownedAccessories: activeMember.ownedAccessories || [],
            hasActiveQuest: Boolean(activeMember.npcQuest),
          } : null}
          visitPurchases={activeNpcVisitPurchases}
          shopPurchases={shopPurchases}
          onShopPurchase={(itemId, msg, stock) => setShopPurchases((prev) => ({
            ...prev,
            [itemId]: { message: msg, ...stock }
          }))}
          onMemberUpdate={applyMember}
          onCooldownReduction={handleCooldownReduction}
          onNeedCoins={handleNpcCoinsNeeded}
          onChestClaim={handleChestClaim}
          onQuestScrollBought={handleQuestScrollBought}
          onTutorialAction={handleTutorialAction}
          onClose={handleNpcQuestClose}
        />
      )}
      {showChallengeModal && (
        <ChallengeModal
          member={activeMember}
          onConfirm={handleChallengeConfirm}
          onCancel={() => setShowChallengeModal(false)}
        />
      )}
      {challengeInfoView && (
        <ChallengeInfoModal
          info={currentChallengeInfo}
          view={challengeInfoView}
          onClose={() => setChallengeInfoView(null)}
          onShowRewards={() => setChallengeInfoView("rewards")}
        />
      )}
      <ChallengeAnnouncement
        announcement={challengeAnnouncement}
        onDone={() => setChallengeAnnouncement(null)}
      />
      {showChallengeSubmission && isChallengePending && !isViewingOtherRoom && (
        <ChallengeSubmissionPanel
          challenge={activeMember.challenge}
          onSubmit={handleChallengeSubmit}
          onClose={() => setShowChallengeSubmission(false)}
        />
      )}
      {devMode && (
        <DevPanel
          socketRef={socketRef}
          cycleInfo={cycleInfo}
          cycleToolsEnabled={config?.devCycleToolsEnabled}
          devToken={devToken}
          selfDiscordId={activeMember?.discordId}
          onMemberUpdate={applyMember}
        />
      )}
      {questSuccess && (
        <div className="quest-success-backdrop" onClick={() => setQuestSuccess(null)}>
          <section className="quest-success-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="quest-success-icon">{questSuccess.isChest ? "🎁" : "⚔️"}</div>
            <p className="quest-success-kicker">{questSuccess.isChest ? "TREASURE FOUND!" : "QUEST COMPLETE!"}</p>
            <h2 className="quest-success-title">{questSuccess.isChest ? "ได้สมบัติ!!" : "เควสสำเร็จ!!"}</h2>
            <p className="quest-success-subtitle">{questSuccess.title}</p>
            <div className="quest-success-reward">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={withOptimizedAsset(questSuccess.isChest ? getChestRewardIcon(questSuccess.chestReward) : "/assets/Coin.png")}
                alt={questSuccess.isChest && questSuccess.chestReward?.kind === "item" ? "item" : "coin"}
              />
              <span>
                {questSuccess.isChest
                  ? questSuccess.chestReward?.kind === "coins"
                    ? `+${Number(questSuccess.chestReward.coins || 0).toLocaleString()}`
                    : questSuccess.chestReward?.itemName || "Shop item"
                  : `+${Number(questSuccess.reward).toLocaleString()}`}
              </span>
              <span className="quest-success-reward-label">
                {questSuccess.isChest && questSuccess.chestReward?.kind === "item"
                  ? questSuccess.chestReward.itemId === "asset-ticket" ? "Ticket x1" : "Shop item"
                  : "Coins"}
              </span>
            </div>
            <button type="button" className="quest-success-btn" onClick={() => setQuestSuccess(null)}>
              {questSuccess.isChest ? "เก็บสมบัติ!" : "รับรางวัล!"}
            </button>
          </section>
        </div>
      )}
      {showNoCoins && (
        <NoCoinsModal
          cost={noCoinsCost}
          coins={activeMember?.coins || 0}
          onClose={() => setShowNoCoins(false)}
        />
      )}
      {showRanking && (
        <RankingModal
          onClose={() => setShowRanking(false)}
          onOpenProfile={(playerId) => handleOpenProfile(playerId)}
        />
      )}
      {showFriends && (
        <FriendsModal
          onClose={() => setShowFriends(false)}
          onOpenProfile={(playerId) => handleOpenProfile(playerId)}
          roomPlayers={players}
        />
      )}
      {showGlobalQuest && (
        <GlobalQuestModal
          tutorialMode={["social-intro", "social-opened"].includes(activeMember?.tutorial?.step)}
          onClose={handleGlobalQuestClose}
        />
      )}
      {!isTutorialActive && effectiveRoomLevels.length > 1 && (
        <RoomProgressBar
          levels={effectiveRoomLevels}
          activeRoomKey={actualRoomKey}
          viewedRoomKey={activeViewedRoomKey}
          onSelectRoom={(roomKey) => {
            setTarget(null);
            setViewedRoomKey(roomKey);
          }}
          disabled={false}
        />
      )}
    </main>
  );
}
