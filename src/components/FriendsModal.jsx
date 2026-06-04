"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { X, Search, ChevronDown, Award } from "lucide-react";
import { withBasePath, withOptimizedAsset } from "@/lib/basePath";
import AvatarWithFallback from "./AvatarWithFallback";

const PAGE_SIZE = 10;

// Format relative time elapsed since lastAuthentication
function getRelativeTimeString(lastAuthStr) {
  if (!lastAuthStr) return "Offline";
  const lastAuth = new Date(lastAuthStr);
  const elapsedMs = Date.now() - lastAuth.getTime();
  if (elapsedMs < 0) return "Online now"; // Safety catch
  
  const minutes = Math.floor(elapsedMs / 60000);
  if (minutes < 5) return "Online now";
  if (minutes < 60) return `Online ${minutes}m ago`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Online ${hours}h ago`;
  
  const days = Math.floor(hours / 24);
  return `Online ${days}d ago`;
}

export default function FriendsModal({ onClose, onOpenProfile, roomPlayers = [] }) {
  const [classes, setClasses] = useState([]);
  const [friends, setFriends] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const lastLoadedClassRef = useRef("");
  const loadMoreRef = useRef(null);

  // Esc key closes modal
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const search = searchQuery.trim();
    const loadKey = `${selectedClassId}:${search}`;
    if (selectedClassId && lastLoadedClassRef.current === loadKey) return;
    const controller = new AbortController();
    const classId = selectedClassId;
    setLoading(true);
    setNextCursor("");
    setHasMore(false);
    const timeoutId = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (classId) params.set("class", classId);
      params.set("limit", String(PAGE_SIZE));
      if (search) params.set("q", search);
      const query = `?${params.toString()}`;
      fetch(withBasePath(`/api/player/friends${query}`), { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(res)))
        .then(({ classes: loadedClasses, friends: loadedFriends, defaultClassId, nextCursor: loadedNextCursor, hasMore: loadedHasMore }) => {
          setClasses(Array.isArray(loadedClasses) ? loadedClasses : []);
          setFriends(Array.isArray(loadedFriends) ? loadedFriends : []);
          setNextCursor(loadedNextCursor || "");
          setHasMore(Boolean(loadedHasMore));
          const loadedClassId = defaultClassId || classId || loadedClasses?.[0]?.sheetTitle || "";
          lastLoadedClassRef.current = `${loadedClassId}:${search}`;
          if (Array.isArray(loadedClasses) && loadedClasses.length > 0 && !classId) {
            setSelectedClassId(loadedClassId || loadedClasses[0].sheetTitle);
          }
          setLoading(false);
        })
        .catch((err) => {
          if (err?.name === "AbortError") return;
          console.error("Failed to load friends", err);
          setLoading(false);
        });
    }, search ? 250 : 0);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [searchQuery, selectedClassId]);

  const handleClassChange = (event) => {
    lastLoadedClassRef.current = "";
    setFriends([]);
    setNextCursor("");
    setHasMore(false);
    setSearchQuery("");
    setSelectedClassId(event.target.value);
  };

  const handleLoadMore = useCallback(() => {
    if (!selectedClassId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    const params = new URLSearchParams({
      class: selectedClassId,
      limit: String(PAGE_SIZE),
      cursor: nextCursor
    });
    const search = searchQuery.trim();
    if (search) params.set("q", search);
    fetch(withBasePath(`/api/player/friends?${params.toString()}`))
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(({ friends: loadedFriends, nextCursor: loadedNextCursor, hasMore: loadedHasMore }) => {
        setFriends((current) => [...current, ...(Array.isArray(loadedFriends) ? loadedFriends : [])]);
        setNextCursor(loadedNextCursor || "");
        setHasMore(Boolean(loadedHasMore));
      })
      .catch((err) => {
        console.error("Failed to load more friends", err);
      })
      .finally(() => {
        setLoadingMore(false);
      });
  }, [loadingMore, nextCursor, searchQuery, selectedClassId]);

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

  return (
    <div
      className="friends-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section className="friends-card animate-pop" role="dialog" aria-modal="true" aria-label="Friends List">
        <button className="friends-close-btn" type="button" aria-label="Close friends" onClick={onClose}>
          <X size={22} strokeWidth={3} />
        </button>

        {/* Inner leaderboard panel */}
        <div className="friends-inner-panel">
          
          <header className="friends-header">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={withOptimizedAsset("/assets/Friends.png")}
              alt="Friends Group"
                            className="friends-header-avatar"
                            loading="lazy"
                            decoding="async"
            />
            <div className="friends-header-text">
              <h2>Friends</h2>
              <div className="friends-select-container">
                <select
                  value={selectedClassId}
                  onChange={handleClassChange}
                  className="friends-class-select"
                >
                  {classes.map((cls) => (
                    <option key={cls.sheetTitle} value={cls.sheetTitle}>
                      {cls.courseName || cls.sheetTitle}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} className="friends-select-arrow" />
              </div>
            </div>
          </header>

          {/* Search box */}
          <div className="friends-search-box">
            <Search size={18} className="friends-search-icon" />
            <input
              type="text"
              placeholder="ค้นหาเพื่อนในคลาส..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="friends-search-input"
            />
          </div>

          {/* Leaderboard list container */}
          <div className="friends-list-container">
            {loading ? (
              <div className="friends-loading">
                <div className="friends-spinner" />
                <p>กำลังโหลดรายชื่อเพื่อน...</p>
              </div>
            ) : friends.length > 0 ? (
              <div className="friends-list">
                {friends.map((friend) => {
                  const badgeIcon = String(friend.bestBadge?.icon || "");
                  const hasImage = /^(https?:\/\/|\/)/.test(badgeIcon);
                  const imageSource = badgeIcon.startsWith("/") ? withOptimizedAsset(badgeIcon) : badgeIcon;

                  // Check if currently online in sockets (or active in room)
                  const isOnline = roomPlayers.some((p) => p.id === friend.id && p.online) || friend.isOnline;
                  const statusText = isOnline ? "Online now" : getRelativeTimeString(friend.lastAuthentication);

                  return (
                    <div
                      key={friend.id}
                      className="friends-item"
                      onClick={() => onOpenProfile && onOpenProfile(friend.id)}
                    >
                      <div className="friends-item-avatar-col">
                        <AvatarWithFallback
                          src={friend.avatar}
                          className="friends-avatar-img"
                          fallbackAs="div"
                          fallbackClassName="friends-avatar-fallback"
                          fallbackText={String(friend.name || "P").charAt(0).toUpperCase()}
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                      
                      <div className="friends-item-info-col">
                        <div className="friends-item-name-row">
                          <span className="friends-item-name">{friend.name}</span>
                          {friend.bestBadge && (
                            <div className="friends-item-badge-wrapper">
                              {hasImage ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={imageSource}
                                  alt={friend.bestBadge.label || "Badge"}
                                  className="friends-badge-icon"
                                  loading="lazy"
                                  decoding="async"
                                />
                              ) : (
                                <div className={`friends-badge-fallback is-${friend.bestBadge.kind || "bronze"}`}>
                                  <Award size={12} />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="friends-item-status-col">
                        <span className={`status-dot ${isOnline ? "is-online" : "is-offline"}`} />
                        <span className={`status-label ${isOnline ? "is-online" : "is-offline"}`}>
                          {statusText}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {hasMore && (
                  <button
                    ref={loadMoreRef}
                    className="friends-load-more"
                    type="button"
                    disabled={loadingMore}
                    onClick={handleLoadMore}
                  >
                    {loadingMore ? "Loading..." : "Load more"}
                  </button>
                )}
              </div>
            ) : (
              <div className="friends-empty-state">
                <p>{searchQuery ? "ไม่พบเพื่อนที่ตรงกับการค้นหา" : "ไม่มีสมาชิกคนอื่นในคลาสนี้"}</p>
                <small>เพื่อนๆ ในคลาสของคุณจะแสดงที่นี่เมื่อพวกเขาลงทะเบียนเรียน</small>
              </div>
            )}
          </div>

        </div>
      </section>
    </div>
  );
}
