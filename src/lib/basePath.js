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
