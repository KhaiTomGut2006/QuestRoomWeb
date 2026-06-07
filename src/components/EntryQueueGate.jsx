"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Clock3, LoaderCircle, ShieldCheck, Users } from "lucide-react";
import { withBasePath } from "@/lib/basePath";
import Providers from "@/components/Providers";

const GameShell = dynamic(() => import("@/components/GameShell"), {
  ssr: false,
  loading: () => (
    <main className="entry-queue-page">
      <section className="entry-queue-panel" aria-live="polite">
        <div className="entry-queue-brand">
          <span>Quest Room</span>
          <strong>กำลังเข้าเกม</strong>
        </div>
        <div className="entry-queue-orb">
          <LoaderCircle size={56} />
        </div>
        <p>กำลังเปิดห้องเกม</p>
        <div className="entry-queue-progress" aria-hidden="true">
          <span style={{ width: "100%" }} />
        </div>
      </section>
    </main>
  )
});

const CLIENT_ID_KEY = "questroom:entry-client-id";
const RELEASE_AFTER_MS = 24_000;
const QUEUE_RETRY_MIN_MS = 10_000;
const QUEUE_RETRY_MAX_MS = 90_000;
const ENTRY_QUEUE_SSE_ENABLED = process.env.NEXT_PUBLIC_ENTRY_QUEUE_SSE_ENABLED === "true";

function createClientId() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  return `qr-${String(id).replace(/[^a-zA-Z0-9._-]+/g, "")}`;
}

function getClientId() {
  try {
    const stored = window.localStorage.getItem(CLIENT_ID_KEY);
    if (stored) return stored;
    const next = createClientId();
    window.localStorage.setItem(CLIENT_ID_KEY, next);
    return next;
  } catch {
    return createClientId();
  }
}

function statusText(status) {
  if (status === "admitted") return "กำลังเตรียมข้อมูลก่อนเข้าเกม";
  if (status === "paused") return "พักคิวชั่วคราว";
  if (status === "full") return "คิวเต็มชั่วคราว";
  if (status === "error") return "ระบบคิวเชื่อมต่อไม่ได้";
  return "กำลังรอคิวเข้าเกม";
}

function boundedQueueRetryMs(value, status = "waiting", failureCount = 0) {
  const base = Math.max(QUEUE_RETRY_MIN_MS, Number(value) || 30_000);
  const statusMultiplier = status === "paused" || status === "full" ? 2 : 1;
  const failureMultiplier = Math.min(4, 1 + Math.max(0, failureCount));
  return Math.min(QUEUE_RETRY_MAX_MS, base * statusMultiplier * failureMultiplier);
}

async function fetchJson(path, options = {}) {
  const response = await fetch(withBasePath(path), { cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export default function EntryQueueGate() {
  const [clientId, setClientId] = useState("");
  const [queueState, setQueueState] = useState({ status: "loading", retryMs: 2000 });
  const [admission, setAdmission] = useState(null);
  const [initialData, setInitialData] = useState(null);
  const [preloadState, setPreloadState] = useState({ status: "idle", progress: 0, label: "" });
  const [gameMounted, setGameMounted] = useState(false);
  const releasedRef = useRef(false);
  const preloadStartedRef = useRef(false);

  const shouldBypass = useMemo(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("demo") === "1" || params.get("queue") === "0";
  }, []);

  const releaseAdmission = useCallback((reason = "loaded") => {
    if (releasedRef.current || !clientId || !admission?.token || shouldBypass) return;
    releasedRef.current = true;
    fetch(withBasePath("/api/entry-queue"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, token: admission.token, reason })
    }).catch(() => {});
  }, [admission?.token, clientId, shouldBypass]);

  useEffect(() => {
    if (shouldBypass) {
      setGameMounted(true);
      return;
    }
    setClientId(getClientId());
  }, [shouldBypass]);

  useEffect(() => {
    if (!clientId || shouldBypass || admission?.token) return undefined;
    let cancelled = false;
    let timerId = 0;
    let controller = null;
    let eventSource = null;
    let failureCount = 0;
    let usingSse = false;

    const pollQueue = () => {
      if (usingSse) return;
      controller?.abort();
      controller = new AbortController();
      fetch(withBasePath(`/api/entry-queue?clientId=${encodeURIComponent(clientId)}`), {
        cache: "no-store",
        signal: controller.signal
      })
        .then((response) => response.json())
        .then((data) => {
          if (cancelled) return;
          failureCount = 0;
          setQueueState(data);
          if (data.status === "admitted" && data.token) {
            setAdmission({ token: data.token, expiresAt: data.expiresAt || "" });
            return;
          }
          const retryMs = boundedQueueRetryMs(data.retryMs, data.status, failureCount);
          timerId = window.setTimeout(pollQueue, retryMs + Math.floor(Math.random() * 5000));
        })
        .catch((error) => {
          if (cancelled) return;
          if (error?.name === "AbortError") return;
          failureCount += 1;
          setQueueState({ status: "error", retryMs: 3000 });
          const retryMs = boundedQueueRetryMs(30_000, "error", failureCount);
          timerId = window.setTimeout(pollQueue, retryMs + Math.floor(Math.random() * 5000));
        });
    };

    const handleQueueData = (data) => {
      if (cancelled) return;
      failureCount = 0;
      setQueueState(data);
      if (data.status === "admitted" && data.token) {
        setAdmission({ token: data.token, expiresAt: data.expiresAt || "" });
      }
    };

    if (ENTRY_QUEUE_SSE_ENABLED && typeof window !== "undefined" && "EventSource" in window) {
      usingSse = true;
      eventSource = new EventSource(withBasePath(`/api/entry-queue?stream=1&clientId=${encodeURIComponent(clientId)}`));
      eventSource.addEventListener("queue", (event) => {
        try {
          handleQueueData(JSON.parse(event.data));
        } catch {
          // Ignore malformed SSE payloads and let reconnect/fallback handle it.
        }
      });
      eventSource.onerror = () => {
        if (cancelled) return;
        usingSse = false;
        eventSource?.close();
        eventSource = null;
        failureCount += 1;
        const retryMs = boundedQueueRetryMs(30_000, "error", failureCount);
        timerId = window.setTimeout(pollQueue, retryMs + Math.floor(Math.random() * 5000));
      };
    } else {
      pollQueue();
    }

    return () => {
      cancelled = true;
      eventSource?.close();
      controller?.abort();
      window.clearTimeout(timerId);
    };
  }, [admission?.token, clientId, shouldBypass]);

  useEffect(() => {
    if (!admission?.token || shouldBypass || gameMounted || preloadStartedRef.current) return undefined;
    let cancelled = false;
    let retryTimerId = 0;
    const controller = new AbortController();

    const runPreload = async () => {
      preloadStartedRef.current = true;
      try {
        setPreloadState({ status: "loading", progress: 12, label: "กำลังตรวจสอบระบบ" });
        const config = await fetchJson("/api/config", { signal: controller.signal });
        if (cancelled) return;

        setPreloadState({ status: "loading", progress: 34, label: "กำลังโหลดข้อมูลผู้เล่น" });
        let memberPayload = null;
        try {
          memberPayload = await fetchJson("/api/player/me", { signal: controller.signal });
        } catch (error) {
          if (error.status === 401) {
            setInitialData({ config });
            setGameMounted(true);
            return;
          }
          throw error;
        }
        if (cancelled) return;

        setPreloadState({ status: "loading", progress: 58, label: "กำลังโหลดรายชื่อห้อง" });
        const roomsPayload = await fetchJson("/api/player/rooms", { signal: controller.signal });
        if (cancelled) return;

        const member = memberPayload?.member || null;
        const roomKey = member?.roomKey || member?.stage || "";
        let roomPlayers = [];
        if (roomKey) {
          setPreloadState({ status: "loading", progress: 78, label: "กำลังโหลดผู้เล่นในห้อง" });
          const roomPayload = await fetchJson(`/api/player/room?roomKey=${encodeURIComponent(roomKey)}`, { signal: controller.signal });
          roomPlayers = Array.isArray(roomPayload?.players) ? roomPayload.players : [];
        }
        if (cancelled) return;

        setPreloadState({ status: "ready", progress: 100, label: "โหลดข้อมูลเสร็จแล้ว" });
        setInitialData({
          config,
          member,
          levels: Array.isArray(roomsPayload?.levels) ? roomsPayload.levels : [],
          players: roomPlayers
        });
        window.setTimeout(() => {
          if (!cancelled) setGameMounted(true);
        }, 250);
      } catch {
        if (cancelled) return;
        preloadStartedRef.current = false;
        setPreloadState({ status: "error", progress: 22, label: "โหลดข้อมูลไม่สำเร็จ กำลังลองใหม่" });
        retryTimerId = window.setTimeout(runPreload, 3000);
      }
    };

    runPreload();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(retryTimerId);
    };
  }, [admission?.token, gameMounted, shouldBypass]);

  useEffect(() => {
    if (!gameMounted || !admission?.token || shouldBypass) return undefined;
    const timeoutId = window.setTimeout(() => releaseAdmission("startup-window-complete"), RELEASE_AFTER_MS);
    const handlePageHide = () => releaseAdmission("pagehide");
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [admission?.token, gameMounted, releaseAdmission, shouldBypass]);

  if (gameMounted) {
    return (
      <Providers>
        <GameShell
          entryAdmissionToken={admission?.token || ""}
          entryQueueClientId={clientId}
          initialData={initialData}
        />
      </Providers>
    );
  }

  const status = queueState.status || "waiting";
  const waiting = Number(queueState.waiting) || 0;
  const active = Number(queueState.active) || 0;
  const position = Number(queueState.position) || 0;
  const paused = status === "paused";
  const progressWidth = preloadState.status !== "idle"
    ? preloadState.progress
    : status === "admitted"
      ? 100
      : Math.max(8, Math.min(92, 100 - position * 8));

  return (
    <main className="entry-queue-page">
      <section className="entry-queue-panel" aria-live="polite">
        <div className="entry-queue-brand">
          <span>Quest Room</span>
          <strong>{statusText(status)}</strong>
        </div>
        <div className={`entry-queue-orb${paused ? " is-paused" : ""}`}>
          {status === "admitted" ? <ShieldCheck size={56} /> : <LoaderCircle size={56} />}
        </div>
        <div className="entry-queue-stats">
          <div>
            <Clock3 size={22} />
            <span>ลำดับคิว</span>
            <strong>{position || "-"}</strong>
          </div>
          <div>
            <Users size={22} />
            <span>กำลังรอ</span>
            <strong>{waiting}</strong>
          </div>
          <div>
            <ShieldCheck size={22} />
            <span>กำลังโหลด</span>
            <strong>{active}</strong>
          </div>
        </div>
        <p>
          {preloadState.label
            || (paused
            ? "มีผู้เล่นเข้าเยอะ ระบบกำลังพักเพื่อให้ server ไม่หนักเกินไป"
            : "กำลังทยอยเตรียมข้อมูลผู้เล่นก่อนเข้าเกม เพื่อลดโหลด server ตอนเข้าเกมพร้อมกัน")}
        </p>
        <div className="entry-queue-progress" aria-hidden="true">
          <span style={{ width: `${progressWidth}%` }} />
        </div>
      </section>
    </main>
  );
}
