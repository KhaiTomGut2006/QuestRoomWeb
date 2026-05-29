"use client";

import { useEffect, useRef, useState } from "react";

export default function RoomCanvas({ target, onTargetHandled }) {
  const hostRef = useRef(null);
  const appRef = useRef(null);
  const markerRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let destroyed = false;
    let resizeObserver;

    async function boot() {
      const PIXI = await import("pixi.js");
      const host = hostRef.current;
      if (!host || destroyed) return;

      const canvas = document.createElement("canvas");
      canvas.className = "room-canvas";
      host.appendChild(canvas);

      const app = new PIXI.Application();
      await app.init({
        canvas,
        resizeTo: host,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        powerPreference: "low-power"
      });

      app.ticker.maxFPS = window.matchMedia("(pointer: coarse)").matches ? 30 : 60;

      const texture = await PIXI.Assets.load("/assets/room1.png");
      const room = new PIXI.Sprite(texture);
      room.anchor.set(0.5);
      app.stage.addChild(room);

      const marker = new PIXI.Graphics();
      app.stage.addChild(marker);
      markerRef.current = marker;

      const fitRoom = () => {
        const width = app.renderer.width;
        const height = app.renderer.height;
        const scale = Math.min(width / texture.width, height / texture.height);
        room.scale.set(scale);
        room.position.set(width / 2, height / 2);
      };

      fitRoom();
      resizeObserver = new ResizeObserver(fitRoom);
      resizeObserver.observe(host);

      appRef.current = app;
      setReady(true);
    }

    boot();

    return () => {
      destroyed = true;
      resizeObserver?.disconnect();
      appRef.current?.destroy(true, { children: true, texture: false });
      appRef.current = null;
      hostRef.current?.replaceChildren();
    };
  }, []);

  useEffect(() => {
    if (!ready || !target || !markerRef.current || !appRef.current) return;
    const app = appRef.current;
    const marker = markerRef.current;
    const x = (target.x / 100) * app.renderer.width;
    const y = (target.y / 100) * app.renderer.height;
    marker.clear();
    marker.circle(x, y, 18);
    marker.stroke({ color: 0xff5c66, width: 4, alpha: 0.75 });
    marker.circle(x, y, 5);
    marker.fill({ color: 0xffd94d, alpha: 0.85 });
    const timeout = setTimeout(() => {
      marker.clear();
      onTargetHandled?.();
    }, 650);

    return () => clearTimeout(timeout);
  }, [ready, target, onTargetHandled]);

  return <div ref={hostRef} className="room-canvas-host" aria-hidden="true" />;
}
