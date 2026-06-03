"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { ChevronLeft, ChevronRight, Coins, Trophy, Zap, Volume2, VolumeX, LogOut, Settings } from "lucide-react";
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
import TutorialMode from "@/components/TutorialMode";
import QuestReceivedPopup from "@/components/QuestReceivedPopup";
import { withBasePath } from "@/lib/basePath";
import { getWalkablePoint } from "@/lib/walkableArea";

const NPC_VISIT_ACTIONS = {
  gamble: "__gamble__",
  hint: "__hint__"
};

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

  const configUrl = `${uploadUrl}?config=1&type=${encodeURIComponent(file.type)}&name=${encodeURIComponent(file.name)}`;
  const storageResponse = await fetch(configUrl);
  const storageConfig = storageResponse.ok ? await storageResponse.json() : { storage: "gridfs" };

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

function getChestRewardIcon(reward) {
  if (!reward || reward.kind === "coins") return "/assets/Coin.png";
  if (reward.itemId === "asset-ticket") return "/assets/Item/AssetTicket.png";
  if (String(reward.itemId || "").startsWith("quest-scroll-")) return "/assets/Item/quest.png";
  if (String(reward.itemId || "").startsWith("cooldown-minute")) return "/assets/Item/Cooldown.png";
  return "/assets/Coin.png";
}

function playerFromMember(member, stageOverride = "") {
  return {
    id: member.discordId || "demo-local",
    name: member.name || member.username || "Player",
    username: member.username || "",
    avatar: member.avatar || "",
    rank: member.rank || "Game Tester",
    achievements: member.achievements || [],
    equippedAccessory: member.equippedAccessory || "",
    stage: stageOverride || member.stage || "game-demo-1",
    challengeFailureCount: Math.max(0, Number(member.challengeFailureCount) || 0),
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

function sameRoomPlayer(a, b) {
  if (!a || !b || a.id !== b.id) return false;
  const comparableKeys = [
    "name",
    "username",
    "avatar",
    "equippedAccessory",
    "stage",
    "challengeFailureCount",
    "x",
    "y",
    "action",
    "online"
  ];
  return comparableKeys.every((key) => !(key in b) || a[key] === b[key]);
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

export default function GameShell() {
  const { data: session, status } = useSession();
  const [config, setConfig] = useState(null);
  const [member, setMember] = useState(null);
  const [players, setPlayers] = useState([]);
  const [roomLevels, setRoomLevels] = useState([]);
  const [viewedStage, setViewedStage] = useState("");
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
  const [showChallengeSubmission, setShowChallengeSubmission] = useState(false);
  const [challengeAnnouncement, setChallengeAnnouncement] = useState(null);
  const [socialUnreadCount, setSocialUnreadCount] = useState(0);
  const [socialNotifications, setSocialNotifications] = useState([]);
  const [playerReactions, setPlayerReactions] = useState([]);
  const [tutorialBusy, setTutorialBusy] = useState(false);
  const [tutorialError, setTutorialError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const audioRef = useRef(null);
  const btnSfxRef = useRef(null);
  const settingsPanelRef = useRef(null);
  const reactionSequenceRef = useRef(0);
  const lastReactionAtRef = useRef(0);
  const socialCheckedAtRef = useRef("");
  const shownSocialNotificationIdsRef = useRef(new Set());
  const showGlobalQuestRef = useRef(false);

  useEffect(() => {
    const audio = new Audio(withBasePath("/assets/bgmusic.mp3"));
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
  const emitTimerRef = useRef(null);
  const autoLoginStartedRef = useRef(false);
  const shownRewardIdsRef = useRef(new Set());
  const doorNpcRef = useRef(null);
  const activeNpcQuestRef = useRef(null);
  const tutorialActiveRef = useRef(false);
  const questDataKeyRef = useRef(-1); // npcKey for which quest data was last fetched
  const npcSwapTimerRef = useRef(null);
  const memberRefreshInFlightRef = useRef(false);
  const socialStatusInFlightRef = useRef(false);

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
  const activeViewedStage = viewedStage || actualStage;
  const effectiveRoomLevels = useMemo(() => {
    if (tutorialRoomStage) {
      return [{ stageId: tutorialRoomStage, name: "Tutorial Room", order: 0 }];
    }
    const levels = Array.isArray(roomLevels) ? [...roomLevels] : [];
    if (actualStage && !levels.some((level) => level.stageId === actualStage)) {
      levels.push({
        stageId: actualStage,
        name: activeMember?.stageLabel || stageLabel(actualStage),
        order: Number.MAX_SAFE_INTEGER
      });
    }
    return levels.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }, [activeMember?.stageLabel, actualStage, roomLevels, tutorialRoomStage]);
  const viewedRoomIndex = effectiveRoomLevels.findIndex((level) => level.stageId === activeViewedStage);
  const isViewingOtherRoom = Boolean(actualStage && activeViewedStage && activeViewedStage !== actualStage);
  const canViewPreviousRoom = viewedRoomIndex > 0;
  const canViewNextRoom = viewedRoomIndex >= 0 && viewedRoomIndex < effectiveRoomLevels.length - 1;
  const viewedRoomLabel = effectiveRoomLevels.find((level) => level.stageId === activeViewedStage)?.name
    || stageLabel(activeViewedStage);
  const currentRoomLabel = tutorialRoomStage
    ? "Tutorial Room"
    : activeMember?.stageLabel
    || effectiveRoomLevels.find((level) => level.stageId === actualStage)?.name
    || stageLabel(actualStage);
  const activeNpcVisitPurchases = useMemo(() => (
    doorNpc?.visitId && activeMember?.npcVisitId === doorNpc.visitId
      ? activeMember.npcVisitPurchases || []
      : []
  ), [activeMember?.npcVisitId, activeMember?.npcVisitPurchases, doorNpc?.visitId]);

  const applyMember = useCallback((nextMember) => {
    setMember(nextMember);
    const nextReward = nextMember?.reward;
    if (nextReward?.id && !nextReward.seenAt && !shownRewardIdsRef.current.has(nextReward.id)) {
      shownRewardIdsRef.current.add(nextReward.id);
      setReward(nextReward);
    }
  }, []);

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

    fetchSocialStatus();
    const interval = window.setInterval(fetchSocialStatus, 60_000);
    document.addEventListener("visibilitychange", fetchSocialStatus);
    return () => {
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
    if (activeNpcQuestRef.current) return;
    window.clearTimeout(npcSwapTimerRef.current);
    if (!doorNpcRef.current) {
      doorNpcRef.current = npc;
      setDoorNpc(npc);
      setDoorNpcPhase("entering");
      setNpcKey((k) => k + 1);
      return;
    }

    setDoorNpcPhase("exiting");
    npcSwapTimerRef.current = window.setTimeout(() => {
      doorNpcRef.current = npc;
      setDoorNpc(npc);
      setDoorNpcPhase("entering");
      setNpcKey((k) => k + 1);
    }, NPC_EXIT_MS);
  }, []);

  const dismissDoorNpc = useCallback(() => {
    window.clearTimeout(npcSwapTimerRef.current);
    if (!doorNpcRef.current) return;
    socketRef.current?.emit("npc:dismiss");
    setDoorNpcPhase("exiting");
    npcSwapTimerRef.current = window.setTimeout(() => {
      doorNpcRef.current = null;
      setDoorNpc(null);
      setDoorNpcPhase("idle");
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
                  url: withBasePath("/assets/room1.png"),
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
    fetch(withBasePath("/api/config"))
      .then((res) => res.json())
      .then(setConfig)
      .catch(() => setConfig({ authConfigured: false, demoGuestsEnabled: true, devToolsEnabled: false }));
  }, []);

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
    if (!isAuthed) return;
    fetch(withBasePath("/api/player/me"))
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => applyMember(data.member))
      .catch(() => setMessage("DB setup needed"));
  }, [applyMember, isAuthed]);

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
    }, 15_000);
    return () => {
      window.clearInterval(interval);
      memberRefreshInFlightRef.current = false;
    };
  }, [isAuthed]);

  useEffect(() => {
    if (!actualStage) return;
    setViewedStage(actualStage);
  }, [actualStage]);

  useEffect(() => {
    if (!isAuthed) return;
    const loadRoomLevels = () => {
      if (document.visibilityState === "hidden") return;
      fetch(withBasePath("/api/player/rooms"))
        .then((res) => (res.ok ? res.json() : Promise.reject(res)))
        .then(({ levels }) => setRoomLevels(Array.isArray(levels) ? levels : []))
        .catch(() => {});
    };
    loadRoomLevels();
    const interval = window.setInterval(loadRoomLevels, 60_000);
    return () => window.clearInterval(interval);
  }, [isAuthed]);

  useEffect(() => {
    if (!isAuthed || !activeViewedStage) return;
    const controller = new AbortController();
    const stage = activeViewedStage;

    fetch(withBasePath(`/api/player/room?stage=${encodeURIComponent(stage)}`), {
      signal: controller.signal
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(({ players: roomPlayers }) => {
        setPlayers((prev) => {
          const currentPlayersById = new Map(prev.map((player) => [player.id, player]));
          return mergeRoomPlayers(
            prev,
            (roomPlayers || []).map((player) => ({
              ...player,
              online: Boolean(currentPlayersById.get(player.id)?.online || player.online)
            }))
          );
        });
      })
      .catch(() => {});

    return () => controller.abort();
  }, [activeViewedStage, isAuthed]);

  useEffect(() => {
    if (!selfPlayer) return;
    const socket = io({
      path: withBasePath("/socket.io"),
      addTrailingSlash: false,
      transports: ["websocket", "polling"],
      reconnectionAttempts: 6
    });
    socketRef.current = socket;

    socket.on("room:state", (roomPlayers) => {
      setPlayers((prev) => mergeRoomPlayers(prev, roomPlayers));
    });
    socket.on("player:upsert", (player) => {
      setPlayers((prev) => mergeRoomPlayers(prev, [player]));
    });
    socket.on("players:patch", (roomPlayers) => {
      setPlayers((prev) => mergeRoomPlayers(prev, roomPlayers));
    });
    socket.on("player:leave", (id) => {
      setPlayers((prev) => prev.filter((player) => player.id !== id));
    });
    socket.on("room:peek-state", ({ players: roomPlayers = [] } = {}) => {
      setPlayers((prev) => mergeRoomPlayers(prev, roomPlayers));
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
    socket.on("social:notification", (data) => {
      showSocialNotification(data, { incrementUnread: true });
    });
    socket.on("player:reaction", showPlayerReaction);
    socket.on("connect", () => {
      socket.emit("player:join", selfPlayer);
    });

    if (socket.connected) {
      socket.emit("player:join", selfPlayer);
    }

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [previewMode, queueDoorNpc, selfPlayer?.id, selfPlayer?.stage, showPlayerReaction, showSocialNotification]);

  useEffect(() => {
    if (!selfPlayer?.id) return;
    socketRef.current?.emit("player:sync", {
      challengeFailureCount: selfPlayer.challengeFailureCount
    });
  }, [selfPlayer?.challengeFailureCount, selfPlayer?.id]);

  useEffect(() => {
    if (!isViewingOtherRoom || !activeViewedStage) return;
    const requestRoomSnapshot = () => {
      if (document.visibilityState === "hidden") return;
      socketRef.current?.emit("room:peek", { stage: activeViewedStage });
    };
    requestRoomSnapshot();
    const interval = window.setInterval(requestRoomSnapshot, 10_000);
    return () => window.clearInterval(interval);
  }, [activeViewedStage, isViewingOtherRoom]);

  useEffect(() => {
    if (!selfPlayer) return;
    setPlayers((prev) => mergeRoomPlayers(prev, [selfPlayer]));
  }, [selfPlayer]);

  useEffect(() => {
    if (!activeMember) return;
    socketRef.current?.emit("player:balance", { coins: Number(activeMember.coins) || 0 });
  }, [activeMember?.coins]);

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
      socketRef.current?.emit("player:move", payload);

      window.clearTimeout(emitTimerRef.current);
      emitTimerRef.current = window.setTimeout(() => {
        if (!isAuthed) return;
        fetch(withBasePath("/api/player/me"), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: nextPosition })
        }).catch(() => {});
      }, 240);
    },
    [activeMember, isAuthed, isViewingOtherRoom, previewMode, selfPlayer]
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

    fetch(withBasePath(`/api/quest-templates?difficulty=${difficulty}`))
      .then((r) => r.json())
      .then((data) => {
        const pool = Array.isArray(data.quests) ? data.quests : [];
        if (pool.length === 0) { setNpcQuestData(null); return; }
        const picked = pool[Math.floor(Math.random() * pool.length)];
        const reward = Math.round(
          picked.rewardMin + Math.random() * (picked.rewardMax - picked.rewardMin)
        );
        setNpcQuestData({ ...picked, reward });
      })
      .catch(() => setNpcQuestData(null));

  }, [activeMember?.npcQuest, npcKey, npcVisit]);

  useEffect(() => {
    if (npcVisit?.type === "hints") {
      if (!hintsData) {
        fetch(withBasePath("/api/hint-templates"))
          .then((r) => r.json())
          .then((data) => setHintsData(Array.isArray(data.hints) ? data.hints : []))
          .catch(() => setHintsData([]));
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
        socketRef.current?.emit("quest:active", true);
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
        doorNpcRef.current = questNpc;
        setDoorNpc(questNpc);
        setDoorNpcPhase("idle");
        setQuestReceived(data.member.npcQuest);
        socketRef.current?.emit("quest:active", true);
      }
    } catch {}
    setNpcVisit(null);
    setNpcQuestData(null);
  }, [applyMember, handleTutorialAction, isAuthed, npcQuestData, npcVisit]);

  const handleQuestScrollBought = useCallback((assignedQuest, updatedMember) => {
    // Quest is assigned directly to the player — no quest NPC spawned at the door.
    // The shop NPC (Milt) stays until its current cooldown expires.
    applyMember(updatedMember);
    setQuestReceived(assignedQuest);
    activeNpcQuestRef.current = null;
    // Notify server so timer freezes at 1 sec when it expires
    socketRef.current?.emit("quest:active", true);
    // Close the modal but keep the door NPC visible
    setNpcVisit(null);
    setNpcQuestData(null);
  }, [applyMember]);

  const handleNpcQuestCancel = useCallback(async () => {
    if (!isAuthed) return;
    const visitorQuest = activeMember?.npcQuest?.source !== "shop";
    try {
      const res = await fetch(withBasePath("/api/player/npc-quest"), { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        applyMember(data.member);
        activeNpcQuestRef.current = null;
        socketRef.current?.emit("quest:active", false);
        setNpcVisit(null);
        setNpcQuestData(null);
        if (visitorQuest) dismissDoorNpc();
      }
    } catch {}
  }, [activeMember?.npcQuest?.source, applyMember, dismissDoorNpc, isAuthed]);

  const handleNpcQuestSubmit = useCallback(async (file, onUploadProgress, postText = "") => {
    if (!isAuthed) throw new Error("กรุณาเข้าสู่ระบบก่อนส่งเควส");
    const visitorQuest = activeMember?.npcQuest?.source !== "shop";
    const evidence = await uploadNpcQuestEvidence(file, activeMember?.discordId || activeMember?.id, onUploadProgress);
    const res = await fetch(withBasePath("/api/player/npc-quest"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evidence, postText })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "quest_submit_failed");

    applyMember(data.member);
    activeNpcQuestRef.current = null;
    socketRef.current?.emit("quest:active", false);
    setNpcVisit(null);
    setNpcQuestData(null);
    if (visitorQuest) dismissDoorNpc();
    setQuestSuccess({ title: data.submission?.title || "NPC Quest", reward: data.reward ?? 0 });
    socketRef.current?.emit("social:publish", {
      id: data.submission?.id,
      title: data.submission?.title,
      type: "npc-quest",
      authorName: activeMember?.name,
      username: activeMember?.username
    });
  }, [activeMember?.discordId, activeMember?.id, activeMember?.name, activeMember?.npcQuest?.source, activeMember?.username, applyMember, dismissDoorNpc, isAuthed]);

  const handleChestClaim = useCallback((chestReward, { dismissNpc = true } = {}) => {
    if (dismissNpc) dismissDoorNpc();
    setQuestSuccess({ title: "หีบสมบัติ", chestReward, isChest: true });
  }, [dismissDoorNpc]);

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
    setNpcVisit(null);
    setNpcQuestData(null);
    setGamblingResult(null);
    setHintResult(null);
    dismissDoorNpc();
  }, [dismissDoorNpc]);

  const handleNpcInteract = useCallback(() => {
    if (isTutorialActive) return;
    if (!doorNpc || doorNpcPhase === "exiting") return;
    try { new Audio(withBasePath("/assets/Sound/openmenu.mp3")).play().catch(() => {}); } catch {}
    setNpcVisit(doorNpc);
  }, [doorNpc, doorNpcPhase, isTutorialActive]);

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

  const visiblePlayers = useMemo(() => {
    if (!activeViewedStage) return [];
    return players.filter((player) => {
      const isInViewedRoom = player.stage === activeViewedStage || !player.stage;
      const isBrowsingSelf = isViewingOtherRoom && player.id === selfPlayer?.id;
      return isInViewedRoom && !isBrowsingSelf;
    });
  }, [activeViewedStage, isViewingOtherRoom, players, selfPlayer?.id]);

  const navigateViewedRoom = useCallback((direction) => {
    const nextRoom = effectiveRoomLevels[viewedRoomIndex + direction];
    if (!nextRoom) return;
    setTarget(null);
    setViewedStage(nextRoom.stageId);
  }, [effectiveRoomLevels, viewedRoomIndex]);

  if (!activeMember) {
    return <LoginScreen authConfigured={Boolean(config?.authConfigured)} authError={authError} />;
  }

  return (
    <main className="game-shell">
      <section className="top-left hud-cluster">
        <h1>{currentRoomLabel}</h1>
        <div className="action-row">
          <button className="ranking-button" type="button" aria-label="Ranking" onClick={() => setShowRanking(true)}>
            <Trophy size={38} fill="currentColor" />
          </button>
          <button
            className={`challenge-button${isChallengePending ? " is-pending" : ""}${hasChallengeSubmission ? " is-submitted" : ""}`}
            type="button"
            onClick={handleChallenge}
            disabled={isViewingOtherRoom || isTutorialActive}
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
            <img src={withBasePath("/assets/Coin.png")} alt="coin" />
            {activeMember?.costMultiplier > 1 && (
              <span className="multiplier-tag">x{activeMember.costMultiplier}</span>
            )}
          </div>
          {isChallengePending && (
            <p className="challenge-pending-note">ให้น้องไปเรียกพี่ประจำห้องได้เลย</p>
          )}
        </div>
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

      <section className="top-right hud-cluster">
        <p className="version">Ver.Demo</p>
        <div className="profile-row">
          <div className="coin-pill">
            <span>{activeMember?.coins?.toLocaleString?.() || "0"}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={withBasePath("/assets/Coin.png")} alt="coin" />
          </div>
          <div className="ticket-pill" title="Select 1 Asset on HamStore tickets">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={withBasePath("/assets/Item/AssetTicket.png")} alt="asset ticket" />
            <span>x{Number(activeMember?.shopAssetTickets || 0).toLocaleString()}</span>
          </div>
          <div className="profile-action">
            <button
              className={`circle-button global${activeMember?.tutorial?.step === "social-intro" ? " tutorial-social-target" : ""}`}
              type="button"
              aria-label={activeMember && isAuthed ? "Global Quest" : "Login with Discord"}
              onClick={handleGlobalQuestOpen}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withBasePath("/assets/Global.png")} alt="" />
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
              <img src={withBasePath("/assets/Friends.png")} alt="" />
            </button>
            <span>Friends</span>
          </div>
          <div className="profile-action settings-wrapper" ref={settingsPanelRef}>
            <button
              className={`circle-button settings-btn${showSettings ? " active" : ""}`}
              type="button"
              aria-label="Settings"
              onClick={() => setShowSettings((s) => !s)}
            >
              <Settings size={30} strokeWidth={2.5} />
            </button>
            <span>ตั้งค่า</span>
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
        </div>
      </section>



      {socialNotifications.length > 0 && (
        <aside className="social-notification-list" aria-live="polite">
          {socialNotifications.map((notification) => (
            <p className="social-notification" key={notification.id}>
              {socialNotificationText(notification)}
            </p>
          ))}
        </aside>
      )}

      <button
        className="nav-arrow nav-left"
        type="button"
        aria-label="View previous room"
        disabled={isTutorialActive || !canViewPreviousRoom}
        onClick={() => navigateViewedRoom(-1)}
      >
        <ChevronLeft size={96} strokeWidth={3} />
      </button>
      <button
        className="nav-arrow nav-right"
        type="button"
        aria-label="View next room"
        disabled={isTutorialActive || !canViewNextRoom}
        onClick={() => navigateViewedRoom(1)}
      >
        <ChevronRight size={96} strokeWidth={3} />
      </button>
      <section className="game-stage" onClick={handleStageClick}>
        <RoomCanvas target={isViewingOtherRoom ? null : target} onTargetHandled={() => setTarget(null)} />
        {isViewingOtherRoom && (
          <div className="room-view-indicator">
            <span>Viewing room: {viewedRoomLabel}</span>
            <button type="button" onClick={() => setViewedStage(actualStage)}>
              Back to my room
            </button>
          </div>
        )}
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
                src={withBasePath(questSuccess.isChest ? getChestRewardIcon(questSuccess.chestReward) : "/assets/Coin.png")}
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
    </main>
  );
}
