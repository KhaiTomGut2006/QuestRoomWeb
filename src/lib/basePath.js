const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const basePath = rawBasePath
  ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

export function withBasePath(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${basePath}${normalizedPath}`;
}

export function withOptimizedAsset(path) {
  const [assetPath, query = ""] = String(path || "").split("?");
  const optimizedPath = assetPath.startsWith("/assets/") && assetPath.toLowerCase().endsWith(".png")
    ? assetPath.replace(/\.png$/i, ".webp")
    : assetPath;
  return withBasePath(query ? `${optimizedPath}?${query}` : optimizedPath);
}

export function normalizeEvidenceUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const fileId = parsed.searchParams.get("file") || "";
    if (fileId && parsed.pathname.endsWith("/api/player/npc-quest/upload")) {
      const normalizedPath = withBasePath(`/api/player/npc-quest/upload?file=${encodeURIComponent(fileId)}`);
      return typeof window !== "undefined" ? `${window.location.origin}${normalizedPath}` : normalizedPath;
    }
  } catch {
    return value;
  }
  return value;
}
