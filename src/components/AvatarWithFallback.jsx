"use client";

import { useEffect, useState } from "react";

const failedAvatarUrls = new Set();

export default function AvatarWithFallback({
  src,
  alt = "",
  className = "",
  fallbackClassName = "",
  fallbackText = "P",
  fallbackAs: FallbackTag = "span",
  ...imgProps
}) {
  const [failed, setFailed] = useState(() => Boolean(src && failedAvatarUrls.has(src)));

  useEffect(() => {
    setFailed(Boolean(src && failedAvatarUrls.has(src)));
  }, [src]);

  if (src && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        {...imgProps}
        className={className || undefined}
        src={src}
        alt={alt}
        onError={() => {
          failedAvatarUrls.add(src);
          setFailed(true);
        }}
      />
    );
  }

  return (
    <FallbackTag className={fallbackClassName || undefined}>
      {fallbackText}
    </FallbackTag>
  );
}
