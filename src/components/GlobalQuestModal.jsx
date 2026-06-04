"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { withBasePath, withOptimizedAsset } from "@/lib/basePath";
import AvatarWithFallback from "./AvatarWithFallback";

const PAGE_SIZE = 10;

function relativeTime(value) {
  const timestamp = new Date(value || 0).getTime();
  if (!timestamp) return "";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (elapsedMinutes < 1) return "now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  return `${Math.floor(elapsedHours / 24)}d`;
}

function AuthorAvatar({ author }) {
  return (
    <AvatarWithFallback
      src={author.avatar}
      className="global-post-avatar"
      fallbackClassName="global-post-avatar global-post-avatar--fallback"
      fallbackText={String(author.name || "P").charAt(0).toUpperCase()}
      loading="lazy"
    />
  );
}

function PostBadge({ badge }) {
  if (!badge) return null;
  const icon = String(badge.icon || "");
  const hasImage = /^(https?:\/\/|\/)/.test(icon);
  const imageSource = icon.startsWith("/") ? withOptimizedAsset(icon) : icon;

  return (
    <div className={`global-post-badge is-${badge.kind || "gold"}`} title={badge.sublabel || badge.label || "Badge"}>
      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageSource} alt={badge.sublabel || badge.label || "Badge"} loading="lazy" />
      ) : (
        <span>{icon || "Badge"}</span>
      )}
    </div>
  );
}

function isVideoEvidence(evidence) {
  const contentType = String(evidence?.contentType || "").toLowerCase();
  const url = String(evidence?.url || "").toLowerCase().split(/[?#]/)[0];
  return contentType.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/.test(url);
}

function PostMedia({ post }) {
  const [failed, setFailed] = useState(false);
  const evidence = post.evidence || {};
  const url = String(evidence.url || "");

  if (!url || failed) {
    return (
      <a className="global-post-media global-post-media-fallback" href={url || undefined} target="_blank" rel="noreferrer">
        Media unavailable
      </a>
    );
  }

  if (isVideoEvidence(evidence)) {
    return (
      <video
        className="global-post-media"
        src={url}
        controls
        preload="metadata"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="global-post-media"
      src={url}
      alt={post.title || "Quest submission"}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default function GlobalQuestModal({ onClose, tutorialMode = false }) {
  const [classes, setClasses] = useState([]);
  const [posts, setPosts] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const lastLoadedClassRef = useRef("");
  const loadMoreRef = useRef(null);

  const fetchPosts = useCallback((classId = "", options = {}) => {
    const cursor = options.cursor || "";
    const append = Boolean(cursor);
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setNextCursor("");
      setHasMore(false);
    }
    setError("");
    const params = new URLSearchParams();
    if (classId) params.set("class", classId);
    params.set("limit", String(PAGE_SIZE));
    if (cursor) params.set("cursor", cursor);
    const query = `?${params.toString()}`;
    fetch(withBasePath(`/api/player/global${query}`))
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(({ classes: loadedClasses, posts: loadedPosts, defaultClassId, nextCursor: loadedNextCursor, hasMore: loadedHasMore }) => {
        setClasses(Array.isArray(loadedClasses) ? loadedClasses : []);
        setPosts((current) => (
          append
            ? [...current, ...(Array.isArray(loadedPosts) ? loadedPosts : [])]
            : (Array.isArray(loadedPosts) ? loadedPosts : [])
        ));
        setNextCursor(loadedNextCursor || "");
        setHasMore(Boolean(loadedHasMore));
        const loadedClassId = defaultClassId || classId || "";
        lastLoadedClassRef.current = loadedClassId;
        setSelectedClassId((current) => current || loadedClassId);
        setLoading(false);
        setLoadingMore(false);
      })
      .catch(() => {
        setError("Unable to load Global Quest posts");
        setLoading(false);
        setLoadingMore(false);
      });
  }, []);

  useEffect(() => {
    if (selectedClassId && lastLoadedClassRef.current === selectedClassId) return;
    fetchPosts(selectedClassId);
  }, [fetchPosts, selectedClassId]);

  const handleClassChange = (event) => {
    const nextClassId = event.target.value;
    lastLoadedClassRef.current = "";
    setPosts([]);
    setNextCursor("");
    setHasMore(false);
    setSelectedClassId(nextClassId);
  };

  const handleLoadMore = useCallback(() => {
    if (!hasMore || !nextCursor || loading || loadingMore) return;
    fetchPosts(selectedClassId, { cursor: nextCursor });
  }, [fetchPosts, hasMore, loading, loadingMore, nextCursor, selectedClassId]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasMore) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) handleLoadMore();
      },
      { root: null, rootMargin: "180px 0px", threshold: 0.01 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [handleLoadMore, hasMore]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleReaction = async (post, reaction) => {
    const nextReaction = post.viewerReaction === reaction ? "" : reaction;
    const response = await fetch(withBasePath("/api/player/global"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: post.id, reaction: nextReaction })
    });
    if (!response.ok) return;
    const update = await response.json();
    setPosts((current) => current.map((item) => (
      item.id === update.postId
        ? {
            ...item,
            viewerReaction: update.viewerReaction,
            likeCount: update.likeCount,
            dislikeCount: update.dislikeCount
          }
        : item
    )));
  };

  return (
    <div
      className="global-quest-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="global-quest-card" role="dialog" aria-modal="true" aria-label="Global Quest">
        <button className="global-quest-close" type="button" aria-label="Close Global Quest" onClick={onClose}>
          <X size={22} strokeWidth={3} />
        </button>

        <header className="global-quest-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={withOptimizedAsset("/assets/Global.png")} alt="" loading="lazy" />
          <div>
            <h2>Global Quest</h2>
            <div className="global-quest-select-wrap">
              <select value={selectedClassId} onChange={handleClassChange}>
                {classes.map((course) => (
                  <option key={course.sheetTitle} value={course.sheetTitle}>
                    {course.courseName || course.sheetTitle}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </div>
          </div>
        </header>
        {tutorialMode && (
          <div className="global-quest-tutorial-note">
            <strong>Social</strong>
            <span>ที่นี่รวมผลงาน Quest ของผู้เล่น สามารถดูผลงานและกด Like หรือ Dislike ให้กันได้</span>
          </div>
        )}

        <div className="global-quest-feed">
          {loading ? (
            <p className="global-quest-status">Loading posts...</p>
          ) : error ? (
            <p className="global-quest-status global-quest-status--error">{error}</p>
          ) : posts.length === 0 ? (
            <p className="global-quest-status">No quest submissions in this course yet</p>
          ) : (
            <>
              {posts.map((post) => (
              <article className="global-post" key={post.id}>
                <div className="global-post-author">
                  <AuthorAvatar author={post.author || {}} />
                  <strong>{post.author?.name || "Player"}</strong>
                  <span>| {relativeTime(post.submittedAt)}</span>
                </div>
                <div className="global-post-media-wrap">
                  <PostMedia post={post} />
                  <PostBadge badge={post.badge} />
                </div>
                <div className="global-post-actions">
                  <button
                    className={post.viewerReaction === "like" ? "is-active" : ""}
                    type="button"
                    aria-label={`Like ${post.title || "quest"}`}
                    onClick={() => handleReaction(post, "like")}
                  >
                    <ThumbsUp size={23} />
                    <span>{post.likeCount || 0}</span>
                  </button>
                  <button
                    className={post.viewerReaction === "dislike" ? "is-active" : ""}
                    type="button"
                    aria-label={`Dislike ${post.title || "quest"}`}
                    onClick={() => handleReaction(post, "dislike")}
                  >
                    <ThumbsDown size={22} />
                    <span>{post.dislikeCount || 0}</span>
                  </button>
                </div>
                <strong className="global-post-title">{post.title || "NPC Quest"}</strong>
                {post.postText && <p className="global-post-text">{post.postText}</p>}
              </article>
              ))}
              {hasMore && (
                <button
                  ref={loadMoreRef}
                  className="global-quest-load-more"
                  type="button"
                  disabled={loadingMore}
                  onClick={handleLoadMore}
                >
                  {loadingMore ? "Loading..." : "Load more"}
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
