"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, LoaderCircle, ShieldCheck, Users } from "lucide-react";
import { withBasePath } from "@/lib/basePath";
import GameShell from "@/components/GameShell";

const CLIENT_ID_KEY = "questroom:entry-client-id";
const RELEASE_AFTER_MS = 24_000;

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

export default function EntryQueueGate() {
  const [clientId, setClientId] = useState("");
  const [queueState, setQueueState] = useState({ status: "loading", retryMs: 2000 });
  const [admission, setAdmission] = useState(null);
  const [gameMounted, setGameMounted] = useState(false);
  const releasedRef = useRef(false);

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

    const pollQueue = () => {
      fetch(withBasePath(`/api/entry-queue?clientId=${encodeURIComponent(clientId)}`), { cache: "no-store" })
        .then((response) => response.json())
        .then((data) => {
          if (cancelled) return;
          setQueueState(data);
          if (data.status === "admitted" && data.token) {
            setAdmission({ token: data.token, expiresAt: data.expiresAt || "" });
            window.setTimeout(() => setGameMounted(true), 450 + Math.floor(Math.random() * 850));
            return;
          }
          const retryMs = Math.max(1000, Number(data.retryMs) || 2000);
          timerId = window.setTimeout(pollQueue, retryMs + Math.floor(Math.random() * 900));
        })
        .catch(() => {
          if (cancelled) return;
          setQueueState({ status: "error", retryMs: 3000 });
          timerId = window.setTimeout(pollQueue, 3000);
        });
    };

    pollQueue();
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [admission?.token, clientId, shouldBypass]);

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
      <GameShell
        entryAdmissionToken={admission?.token || ""}
        entryQueueClientId={clientId}
      />
    );
  }

  const status = queueState.status || "waiting";
  const waiting = Number(queueState.waiting) || 0;
  const active = Number(queueState.active) || 0;
  const position = Number(queueState.position) || 0;
  const paused = status === "paused";

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
          {paused
            ? "มีผู้เล่นเข้าเยอะ ระบบกำลังพักเพื่อให้ server ไม่หนักเกินไป"
            : "กำลังทยอยเตรียมข้อมูลผู้เล่นก่อนเข้าเกม เพื่อลดโหลด server ตอนเข้าเกมพร้อมกัน"}
        </p>
        <div className="entry-queue-progress" aria-hidden="true">
          <span style={{ width: `${status === "admitted" ? 100 : Math.max(8, Math.min(92, 100 - position * 8))}%` }} />
        </div>
      </section>
    </main>
  );
}
