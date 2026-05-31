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
import ChallengeModal from "@/components/ChallengeModal";
import ChallengeAnnouncement from "@/components/ChallengeAnnouncement";
import { withBasePath } from "@/lib/basePath";
import { getWalkablePoint } from "@/lib/walkableArea";

function safeUploadName(filename) {
  return String(filename || "evidence")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "evidence";
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
  coins: 1080,
  quest: {
    current: "Find the quiet corner",
    status: "active",
    completed: [],
    cooldownUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  },
  npcQuest: null,
  position: { x: 56, y: 72 }
};

const demoNpcQuest = {
  difficulty: "easy",
  title: "ภาพ Lighting แสนสวย",
  description: "เพื่อนฉันกลับมามองเห็นอีกครั้ง ในรอบ 30 ปี ฉันอยากให้เธอได้เห็นภาพ ทิวทัศน์ที่เต็มไปด้วย Lighting แสนสวย",
  reward: 90,
  cancelPenalty: 23,
  npcType: "quest-easy",
  npcName: "near",
  npcCharacter: "near",
  acceptedAt: "demo-quest-preview",
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

function playerFromMember(member) {
  return {
    id: member.discordId || "demo-local",
    name: member.name || member.username || "Player",
    username: member.username || "",
    avatar: member.avatar || "",
    rank: member.rank || "Game Tester",
    achievements: member.achievements || [],
    stage: member.stage || "game-demo-1",
    x: Number(member.position?.x || 56),
    y: Number(member.position?.y || 72),
    action: "idle",
    online: true,
    hasNpcQuest: Boolean(member.npcQuest),
    coins: Number(member.coins) || 0,
  };
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

function DevPanel({ socketRef, cycleInfo }) {
  const [open, setOpen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [npcId, setNpcId] = useState("");

  const emit = (ev, data) => socketRef.current?.emit(ev, data);

  const handleSpeed = (val) => {
    setSpeed(val);
    emit("dev:set-speed", val);
  };

  return (
    <div className={`dev-panel${open ? " dev-panel--open" : ""}`}>
      <button className="dev-panel-toggle" type="button" onClick={() => setOpen((o) => !o)}>
        🛠️ Dev
      </button>
      {open && (
        <div className="dev-panel-body">
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
  const [previewMode, setPreviewMode] = useState(false);
  const [demoRequested, setDemoRequested] = useState(false);
  const [authError, setAuthError] = useState("");
  const [devMode, setDevMode] = useState(false);
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
  const [hintsData, setHintsData] = useState(null);
  const [hintResult, setHintResult] = useState(null);
  const [hintBought, setHintBought] = useState(false);
  const [showNoCoins, setShowNoCoins] = useState(false);
  const [noCoinsCost, setNoCoinsCost] = useState(250);
  const [questSuccess, setQuestSuccess] = useState(null); // { title, reward }
  const [showRanking, setShowRanking] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [showChallengeModal, setShowChallengeModal] = useState(false);
  const [challengeAnnouncement, setChallengeAnnouncement] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const audioRef = useRef(null);
  const settingsPanelRef = useRef(null);

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
  const npcSwapTimerRef = useRef(null);

  const isAuthed = status === "authenticated";
  const activeMember = member || (previewMode ? demoMember : null);
  const selfPlayer = useMemo(() => (activeMember ? playerFromMember(activeMember) : null), [activeMember]);
  const isChallengePending = activeMember?.challenge?.status === "pending";

  const applyMember = useCallback((nextMember) => {
    setMember(nextMember);
    const nextReward = nextMember?.reward;
    if (nextReward?.id && !nextReward.seenAt && !shownRewardIdsRef.current.has(nextReward.id)) {
      shownRewardIdsRef.current.add(nextReward.id);
      setReward(nextReward);
    }
  }, []);

  useEffect(() => {
    doorNpcRef.current = doorNpc;
  }, [doorNpc]);

  useEffect(() => {
    const activeQuest = activeMember?.npcQuest || null;
    activeNpcQuestRef.current = activeQuest;
    if (!activeQuest) return;

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
    setDoorNpcPhase("exiting");
    npcSwapTimerRef.current = window.setTimeout(() => {
      doorNpcRef.current = null;
      setDoorNpc(null);
      setDoorNpcPhase("idle");
    }, NPC_EXIT_MS);
  }, []);

  const handleOpenProfile = useCallback((playerId, preloadedPlayer = null) => {
    if (!playerId) return;

    // 1. Try to find in the current room players
    const roomPlayer = players.find((p) => p.id === playerId);
    if (roomPlayer) {
      setProfilePlayer(roomPlayer);
      return;
    }

    // 2. If preloadedPlayer has achievements and rank, we can use it directly
    if (preloadedPlayer?.achievements && preloadedPlayer?.rank) {
      setProfilePlayer(preloadedPlayer);
      return;
    }

    // 3. Otherwise, fetch from the database
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
  }, [players]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantsDemo = params.get("demo") === "1";
    const wantsDev = params.get("dev") === "1";
    demoMember.npcQuest = wantsDemo && wantsDev && params.get("questPreview") === "1"
      ? demoNpcQuest
      : null;
    setDemoRequested(wantsDemo);
    setDevMode(wantsDev);
    setAuthError(params.get("error") || "");
    fetch(withBasePath("/api/config"))
      .then((res) => res.json())
      .then(setConfig)
      .catch(() => setConfig({ authConfigured: false, demoGuestsEnabled: true }));
  }, []);

  useEffect(() => {
    if (!config) return;

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
  }, [authError, config, demoRequested, status]);

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
      fetch(withBasePath("/api/player/me"))
        .then((res) => (res.ok ? res.json() : Promise.reject(res)))
        .then((data) => applyMember(data.member))
        .catch(() => {});
    }, 3000);
    return () => window.clearInterval(interval);
  }, [applyMember, isAuthed]);

  useEffect(() => {
    if (!isAuthed || !activeMember?.stage) return;
    const controller = new AbortController();
    const stage = activeMember.stage;

    fetch(withBasePath(`/api/player/room?stage=${encodeURIComponent(stage)}`), {
      signal: controller.signal
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(({ players: roomPlayers }) => {
        setPlayers((prev) => {
          const merged = new Map(prev.map((player) => [player.id, player]));
          for (const player of roomPlayers) {
            const current = merged.get(player.id);
            merged.set(player.id, {
              ...player,
              online: Boolean(current?.online || player.online)
            });
          }
          return Array.from(merged.values());
        });
      })
      .catch(() => {});

    return () => controller.abort();
  }, [activeMember?.stage, isAuthed]);

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
      setPlayers((prev) => {
        const merged = new Map([...prev, ...roomPlayers].map((p) => [p.id, p]));
        return Array.from(merged.values());
      });
    });
    socket.on("player:upsert", (player) => {
      setPlayers((prev) => {
        const map = new Map(prev.map((item) => [item.id, item]));
        map.set(player.id, player);
        return Array.from(map.values());
      });
    });
    socket.on("player:leave", (id) => {
      setPlayers((prev) => prev.filter((player) => player.id !== id));
    });
    socket.on("timer:sync", (data) => setCycleInfo(data));
    socket.on("npc:visit", (npc) => {
      queueDoorNpc(npc);
      setNpcVisit(null);
    });
    socket.on("challenge:announce", (data) => {
      setChallengeAnnouncement(data);
    });
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
  }, [previewMode, queueDoorNpc, selfPlayer?.id, selfPlayer?.stage]);

  useEffect(() => {
    if (!selfPlayer) return;
    setPlayers((prev) => {
      const map = new Map(prev.map((item) => [item.id, item]));
      map.set(selfPlayer.id, selfPlayer);
      return Array.from(map.values());
    });
  }, [selfPlayer]);

  useEffect(() => {
    if (!activeMember) return;
    socketRef.current?.emit("player:balance", { coins: Number(activeMember.coins) || 0 });
  }, [activeMember?.coins]);

  const moveSelf = useCallback(
    (x, y) => {
      if (!activeMember || !selfPlayer) return;
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
    [activeMember, isAuthed, previewMode, selfPlayer]
  );

  const handleStageClick = useCallback(
    (event) => {
      if (!activeMember) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      moveSelf(x, y);
    },
    [activeMember, moveSelf]
  );

  const handleChallenge = () => {
    if (!isAuthed) {
      setMessage("Preview mode");
      return;
    }
    if (isChallengePending) return;
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
  // Fetch quest template when a quest-type NPC visits
  useEffect(() => {
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
      setNpcQuestData(null);
    } else {
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
    }

    // Fetch hints when Smith appears (only if not yet loaded for this visit)
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

    // Reset gambling state when a new NPC arrives
    if (npcVisit?.type !== "gambling") {
      setGamblingResult(null);
    }
  }, [activeMember?.npcQuest, hintsData, npcVisit]);

  // Reset hint state when a new NPC spawns (npcKey increments on each new arrival)
  useEffect(() => {
    setHintBought(false);
    setHintResult(null);
    setHintsData(null);
  }, [npcKey]);

  const handleNpcQuestAccept = useCallback(async () => {
    if (!isAuthed || !npcQuestData || !npcVisit) return;
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
        socketRef.current?.emit("quest:active", true);
      }
    } catch {}
    setNpcVisit(null);
    setNpcQuestData(null);
  }, [applyMember, isAuthed, npcQuestData, npcVisit]);

  const handleQuestScrollBought = useCallback((assignedQuest, updatedMember) => {
    // Quest is assigned directly to the player — no quest NPC spawned at the door.
    // The shop NPC (Milt) stays until the quest is completed or cancelled.
    applyMember(updatedMember);
    activeNpcQuestRef.current = assignedQuest;
    socketRef.current?.emit("quest:active", true);
    // Close the modal but keep the door NPC visible
    setNpcVisit(null);
    setNpcQuestData(null);
  }, [applyMember]);

  const handleNpcQuestCancel = useCallback(async () => {
    if (!isAuthed) return;
    try {
      const res = await fetch(withBasePath("/api/player/npc-quest"), { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        applyMember(data.member);
        activeNpcQuestRef.current = null;
        socketRef.current?.emit("quest:active", false);
        setNpcVisit(null);
        setNpcQuestData(null);
        dismissDoorNpc();
      }
    } catch {}
  }, [applyMember, dismissDoorNpc, isAuthed]);

  const handleNpcQuestSubmit = useCallback(async (file, onUploadProgress) => {
    if (!isAuthed) throw new Error("กรุณาเข้าสู่ระบบก่อนส่งเควส");
    const evidence = await uploadNpcQuestEvidence(file, activeMember?.discordId || activeMember?.id, onUploadProgress);
    const res = await fetch(withBasePath("/api/player/npc-quest"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evidence })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "quest_submit_failed");

    applyMember(data.member);
    activeNpcQuestRef.current = null;
    socketRef.current?.emit("quest:active", false);
    setNpcVisit(null);
    setNpcQuestData(null);
    dismissDoorNpc();
    setQuestSuccess({ title: data.submission?.title || "NPC Quest", reward: data.reward ?? 0 });
  }, [activeMember?.discordId, activeMember?.id, applyMember, dismissDoorNpc, isAuthed]);

  const handleChestClaim = useCallback((coins, { dismissNpc = true } = {}) => {
    if (dismissNpc) dismissDoorNpc();
    setQuestSuccess({ title: "หีบสมบัติ", reward: coins, isChest: true });
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
        body: JSON.stringify({ betAmount }),
      });
      const data = await res.json();
      if (res.ok) {
        applyMember(data.member);
        setGamblingResult({ won: data.won, delta: data.delta });
      } else if (data.error === "not_enough_coins") {
        handleNpcCoinsNeeded(betAmount);
      }
    } catch {}
  }, [applyMember, handleNpcCoinsNeeded, isAuthed]);

  const handleHintBuy = useCallback(async (hintId) => {
    if (!isAuthed) return;
    try {
      const res = await fetch(withBasePath("/api/player/hint"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hintId }),
      });
      const data = await res.json();
      if (res.ok) {
        applyMember(data.member);
        setHintResult({ title: data.hintTitle, content: data.hintContent });
        setHintBought(true);
      } else if (data.error === "not_enough_coins") {
        handleNpcCoinsNeeded(data.cost);
      }
    } catch {}
  }, [applyMember, handleNpcCoinsNeeded, isAuthed]);

  const handleNpcQuestClose = useCallback(() => {
    setNpcVisit(null);
    setNpcQuestData(null);
    setGamblingResult(null);
    setHintResult(null); // clear hint content on close; hintBought stays for the visit
  }, []);

  const handleNpcInteract = useCallback(() => {
    if (!doorNpc || doorNpcPhase === "exiting") return;
    setNpcVisit(doorNpc);
  }, [doorNpc, doorNpcPhase]);

  const handleCooldownReduction = useCallback((milliseconds) => {
    if (!milliseconds) return;
    socketRef.current?.emit("shop:reduce-cooldown", { milliseconds });
  }, []);

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
    if (!activeMember) return [];
    return players.filter((player) => player.stage === activeMember.stage || !player.stage);
  }, [activeMember, players]);

  if (!activeMember) {
    return <LoginScreen authConfigured={Boolean(config?.authConfigured)} authError={authError} />;
  }

  return (
    <main className="game-shell">
      <section className="top-left hud-cluster">
        <h1>{activeMember?.stageLabel || stageLabel(activeMember?.stage)}</h1>
        <div className="action-row">
          <button className="ranking-button" type="button" aria-label="Ranking" onClick={() => setShowRanking(true)}>
            <Trophy size={38} fill="currentColor" />
          </button>
          <button
            className={`challenge-button ${isChallengePending ? "is-pending" : ""}`}
            type="button"
            onClick={handleChallenge}
            disabled={isChallengePending}
          >
            <Zap size={23} fill="currentColor" />
            <span>{isChallengePending ? "Pending..." : "Challenge"}</span>
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

      {activeMember?.npcQuest && (
        <div className="npc-quest-sidebar">
          <span className="npc-active-quest-label">📜 เควสที่รับไว้</span>
          <span className="npc-active-quest-title">{activeMember.npcQuest.title}</span>
          <span className="npc-active-quest-reward">🪙 ×{activeMember.npcQuest.reward}</span>
          <button
            className="npc-active-quest-done"
            type="button"
            onClick={handleNpcInteract}
          >
            คุยกับ NPC
          </button>
        </div>
      )}

      <section className="top-right hud-cluster">
        <p className="version">Ver.Demo</p>
        <div className="profile-row">
          <div className="coin-pill">
            <span>{activeMember?.coins?.toLocaleString?.() || "1,080"}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={withBasePath("/assets/Coin.png")} alt="coin" />
          </div>
          <div className="profile-action">
            <button className="circle-button global" type="button" aria-label="Social">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withBasePath("/assets/Global.png")} alt="" />
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



      <section className="game-stage" onClick={handleStageClick}>
        <RoomCanvas target={target} onTargetHandled={() => setTarget(null)} />
        <PlayerLayer
          players={visiblePlayers}
          selfId={selfPlayer?.id}
          onOpenProfile={(player) => handleOpenProfile(player.id, player)}
        />
        <NpcDoorVisitor key={npcKey} npc={doorNpc} phase={doorNpcPhase} onInteract={handleNpcInteract} />
        <RoomClock cycleInfo={cycleInfo} />
      </section>
      {profilePlayer && <ProfileModal player={profilePlayer} onClose={() => setProfilePlayer(null)} />}
      {reward && <RewardModal reward={reward} onClose={handleRewardClose} />}
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
          onGamble={handleGamble}
          memberShop={activeMember ? {
            cooldownT1: activeMember.shopCooldownT1 || 0,
            cooldownT2: activeMember.shopCooldownT2 || 0,
            limitBreak: activeMember.shopLimitBreak || false,
            hasActiveQuest: Boolean(activeMember.npcQuest),
          } : null}
          onMemberUpdate={applyMember}
          onCooldownReduction={handleCooldownReduction}
          onNeedCoins={handleNpcCoinsNeeded}
          onChestClaim={handleChestClaim}
          onQuestScrollBought={handleQuestScrollBought}
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
      {devMode && <DevPanel socketRef={socketRef} cycleInfo={cycleInfo} />}
      {questSuccess && (
        <div className="quest-success-backdrop" onClick={() => setQuestSuccess(null)}>
          <section className="quest-success-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="quest-success-icon">{questSuccess.isChest ? "🎁" : "⚔️"}</div>
            <p className="quest-success-kicker">{questSuccess.isChest ? "TREASURE FOUND!" : "QUEST COMPLETE!"}</p>
            <h2 className="quest-success-title">{questSuccess.isChest ? "ได้สมบัติ!!" : "เควสสำเร็จ!!"}</h2>
            <p className="quest-success-subtitle">{questSuccess.title}</p>
            <div className="quest-success-reward">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withBasePath("/assets/Coin.png")} alt="coin" />
              <span>+{Number(questSuccess.reward).toLocaleString()}</span>
              <span className="quest-success-reward-label">Coins</span>
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
    </main>
  );
}
