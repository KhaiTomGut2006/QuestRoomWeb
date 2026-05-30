"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { X, Search, ChevronDown, Award } from "lucide-react";
import { withBasePath } from "@/lib/basePath";

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

  // Esc key closes modal
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Fetch classes and friends list
  const fetchFriends = useCallback((classId) => {
    setLoading(true);
    const query = classId ? `?class=${encodeURIComponent(classId)}` : "";
    fetch(withBasePath(`/api/player/friends${query}`))
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(({ classes: loadedClasses, friends: loadedFriends, defaultClassId }) => {
        setClasses(loadedClasses);
        setFriends(loadedFriends);
        if (loadedClasses.length > 0 && !selectedClassId && !classId) {
          setSelectedClassId(defaultClassId || loadedClasses[0].sheetTitle);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load friends", err);
        setLoading(false);
      });
  }, [selectedClassId]);

  useEffect(() => {
    fetchFriends(selectedClassId);
  }, [selectedClassId, fetchFriends]);

  // Filter friends list based on search query
  const filteredFriends = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return friends;
    return friends.filter(
      (f) =>
        String(f.name || "").toLowerCase().includes(query) ||
        String(f.username || "").toLowerCase().includes(query)
    );
  }, [friends, searchQuery]);

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
              src={withBasePath("/assets/Friends.png")}
              alt="Friends Group"
              className="friends-header-avatar"
            />
            <div className="friends-header-text">
              <h2>Friends</h2>
              <div className="friends-select-container">
                <select
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
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
            ) : filteredFriends.length > 0 ? (
              <div className="friends-list">
                {filteredFriends.map((friend) => {
                  const badgeIcon = String(friend.bestBadge?.icon || "");
                  const hasImage = /^(https?:\/\/|\/)/.test(badgeIcon);
                  const imageSource = badgeIcon.startsWith("/") ? withBasePath(badgeIcon) : badgeIcon;

                  // Check if currently online in sockets (or active in room)
                  const isOnline = roomPlayers.some((p) => p.id === friend.id && p.online);
                  const statusText = isOnline ? "Online now" : getRelativeTimeString(friend.lastAuthentication);

                  return (
                    <div
                      key={friend.id}
                      className="friends-item"
                      onClick={() => onOpenProfile && onOpenProfile(friend.id)}
                    >
                      <div className="friends-item-avatar-col">
                        {friend.avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={friend.avatar}
                            alt=""
                            className="friends-avatar-img"
                          />
                        ) : (
                          <div className="friends-avatar-fallback">
                            {String(friend.name || "P").charAt(0).toUpperCase()}
                          </div>
                        )}
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
