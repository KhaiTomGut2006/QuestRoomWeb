"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { ChevronLeft, ChevronRight, Coins, Trophy, Zap } from "lucide-react";
import { io } from "socket.io-client";
import RoomCanvas from "@/components/RoomCanvas";
import PlayerLayer from "@/components/PlayerLayer";
import ProfileModal from "@/components/ProfileModal";
import RewardModal from "@/components/RewardModal";
import NpcVisitModal from "@/components/NpcVisitModal";
import { withBasePath } from "@/lib/basePath";
import { getWalkablePoint } from "@/lib/walkableArea";

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
    cooldownUntil: new Date(Date.now() + 40 * 60 * 1000).toISOString()
  },
  position: { x: 56, y: 72 }
};

// ─── Room Clock (synchronized 40-min countdown) ─────────────────
function RoomClock({ cycleInfo }) {
  const [timeLeft, setTimeLeft] = useState(null);

  useEffect(() => {
    if (!cycleInfo) return;
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
    <div className={`room-clock${urgent ? " room-clock--urgent" : ""}`} aria-label="Event countdown">
      <span className="room-clock-time">{mins}:{secs}</span>
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
    online: true
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

export default function GameShell() {
  const { data: session, status } = useSession();
  const [config, setConfig] = useState(null);
  const [member, setMember] = useState(null);
  const [players, setPlayers] = useState([]);
  const [previewMode, setPreviewMode] = useState(false);
  const [demoRequested, setDemoRequested] = useState(false);
  const [authError, setAuthError] = useState("");
  const [target, setTarget] = useState(null);
  const [profilePlayerId, setProfilePlayerId] = useState(null);
  const [reward, setReward] = useState(null);
  const [message, setMessage] = useState("Pedding...");
  const [cycleInfo, setCycleInfo] = useState(null);
  const [npcVisit, setNpcVisit] = useState(null);
  const socketRef = useRef(null);
  const emitTimerRef = useRef(null);
  const autoLoginStartedRef = useRef(false);
  const shownRewardIdsRef = useRef(new Set());

  const isAuthed = status === "authenticated";
  const activeMember = member || (previewMode ? demoMember : null);
  const selfPlayer = useMemo(() => (activeMember ? playerFromMember(activeMember) : null), [activeMember]);
  const profilePlayer = useMemo(
    () => players.find((player) => player.id === profilePlayerId) || null,
    [players, profilePlayerId]
  );
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
    const params = new URLSearchParams(window.location.search);
    setDemoRequested(params.get("demo") === "1");
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
    socket.on("npc:visit", (npc) => setNpcVisit(npc));
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
  }, [selfPlayer?.id, selfPlayer?.stage, previewMode]);

  useEffect(() => {
    if (!selfPlayer) return;
    setPlayers((prev) => {
      const map = new Map(prev.map((item) => [item.id, item]));
      map.set(selfPlayer.id, selfPlayer);
      return Array.from(map.values());
    });
  }, [selfPlayer]);

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

  const handleChallenge = async () => {
    if (!isAuthed) {
      setMessage("Preview mode");
      return;
    }

    if (isChallengePending) return;
    setMessage("Pedding...");
    const response = await fetch(withBasePath("/api/player/challenge"), { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.reason === "not_enough_coins" ? "Need more coins" : "Try again");
      return;
    }
    applyMember(data.member);
    setMessage("ให้น้องไปเรียกพี่ประจำห้องได้เลย");
  };

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
          <button className="ranking-button" type="button" aria-label="Ranking">
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
          </div>
          {isChallengePending && (
            <p className="challenge-pending-note">ให้น้องไปเรียกพี่ประจำห้องได้เลย</p>
          )}
        </div>
      </section>

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
              aria-label={activeMember ? "Sign out" : "Login with Discord"}
              onClick={() => (activeMember && isAuthed ? signOut() : signIn("discord"))}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withBasePath("/assets/Friends.png")} alt="" />
            </button>
            <span>Friends</span>
          </div>
        </div>
      </section>



      <section className="game-stage" onClick={handleStageClick}>
        <RoomCanvas target={target} onTargetHandled={() => setTarget(null)} />
        <PlayerLayer
          players={visiblePlayers}
          selfId={selfPlayer?.id}
          onOpenProfile={(player) => setProfilePlayerId(player.id)}
        />
        <RoomClock cycleInfo={cycleInfo} />
      </section>
      {profilePlayer && <ProfileModal player={profilePlayer} onClose={() => setProfilePlayerId(null)} />}
      {reward && <RewardModal reward={reward} onClose={handleRewardClose} />}
      {npcVisit && <NpcVisitModal npc={npcVisit} onClose={() => setNpcVisit(null)} />}
    </main>
  );
}
