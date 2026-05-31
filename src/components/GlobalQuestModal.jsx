"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { withBasePath } from "@/lib/basePath";

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
  if (author.avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="global-post-avatar" src={author.avatar} alt="" />;
  }
  return (
    <span className="global-post-avatar global-post-avatar--fallback">
      {String(author.name || "P").charAt(0).toUpperCase()}
    </span>
  );
}

export default function GlobalQuestModal({ onClose }) {
  const [classes, setClasses] = useState([]);
  const [posts, setPosts] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchPosts = useCallback((classId = "") => {
    setLoading(true);
    setError("");
    const query = classId ? `?class=${encodeURIComponent(classId)}` : "";
    fetch(withBasePath(`/api/player/global${query}`))
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(({ classes: loadedClasses, posts: loadedPosts, defaultClassId }) => {
        setClasses(Array.isArray(loadedClasses) ? loadedClasses : []);
        setPosts(Array.isArray(loadedPosts) ? loadedPosts : []);
        setSelectedClassId((current) => current || defaultClassId || "");
        setLoading(false);
      })
      .catch(() => {
        setError("Unable to load Global Quest posts");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchPosts(selectedClassId);
  }, [fetchPosts, selectedClassId]);

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
          <img src={withBasePath("/assets/Global.png")} alt="" />
          <div>
            <h2>Global Quest</h2>
            <div className="global-quest-select-wrap">
              <select value={selectedClassId} onChange={(event) => setSelectedClassId(event.target.value)}>
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

        <div className="global-quest-feed">
          {loading ? (
            <p className="global-quest-status">Loading posts...</p>
          ) : error ? (
            <p className="global-quest-status global-quest-status--error">{error}</p>
          ) : posts.length === 0 ? (
            <p className="global-quest-status">No quest submissions in this course yet</p>
          ) : posts.map((post) => {
            const isVideo = String(post.evidence?.contentType || "").startsWith("video/");
            return (
              <article className="global-post" key={post.id}>
                <div className="global-post-author">
                  <AuthorAvatar author={post.author || {}} />
                  <strong>{post.author?.name || "Player"}</strong>
                  <span>| {relativeTime(post.submittedAt)}</span>
                </div>
                {isVideo ? (
                  <video className="global-post-media" src={post.evidence.url} controls preload="metadata" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="global-post-media" src={post.evidence.url} alt={post.title || "Quest submission"} />
                )}
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
            );
          })}
        </div>
      </section>
    </div>
  );
}
