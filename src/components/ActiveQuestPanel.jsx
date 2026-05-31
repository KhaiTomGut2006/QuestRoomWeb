"use client";

import { useState, useRef } from "react";
import { withBasePath } from "@/lib/basePath";

const MAX_EVIDENCE_BYTES = 100 * 1024 * 1024;

export default function ActiveQuestPanel({ quest, onSubmit, onCancel }) {
  const [collapsed, setCollapsed] = useState(false);
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [confirmAction, setConfirmAction] = useState(""); // "submit" | "cancel"
  const fileInputRef = useRef(null);

  if (!quest) return null;

  const reward = Number(quest.reward) || 0;
  const cancelPenalty = Number(quest.cancelPenalty) || Math.max(1, Math.round(reward * 0.25));

  const handleFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    setSubmitError("");
    setUploadProgress(0);
    if (!file) { setEvidenceFile(null); return; }
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setSubmitError("รองรับเฉพาะไฟล์รูปภาพหรือวิดีโอ");
      setEvidenceFile(null);
      return;
    }
    if (file.size > MAX_EVIDENCE_BYTES) {
      setSubmitError("ไฟล์ต้องมีขนาดไม่เกิน 100 MB");
      setEvidenceFile(null);
      return;
    }
    setEvidenceFile(file);
  };

  const handleConfirm = async () => {
    if (submitting) return;
    if (confirmAction === "submit" && !evidenceFile) {
      setSubmitError("กรุณาเลือกไฟล์หลักฐานก่อนส่งเควส");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      if (confirmAction === "cancel") {
        await onCancel?.();
      } else if (confirmAction === "submit") {
        await onSubmit?.(evidenceFile, setUploadProgress);
      }
    } catch (err) {
      setSubmitError(err.message || "เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
      setConfirmAction("");
    }
  };

  return (
    <aside className={`aqp${collapsed ? " aqp--collapsed" : ""}`} aria-label="Active Quest">
      {/* Header bar */}
      <div className="aqp-header" onClick={() => setCollapsed((v) => !v)} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setCollapsed((v) => !v)}>
        <span className="aqp-header-icon">⚔️</span>
        <span className="aqp-header-title">Quest ที่รับอยู่</span>
        <span className="aqp-header-chevron">{collapsed ? "▶" : "◀"}</span>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="aqp-body">
          <p className="aqp-quest-title">{quest.title}</p>
          <p className="aqp-quest-desc">{quest.description}</p>

          <div className="aqp-reward-row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={withBasePath("/assets/Coin.png")} alt="coin" />
            <span>×{reward.toLocaleString()}</span>
          </div>

          {/* File upload */}
          <label className="aqp-upload-label" onClick={() => fileInputRef.current?.click()}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            <span className="aqp-upload-icon">📎</span>
            <span className="aqp-upload-text">
              {evidenceFile
                ? `${evidenceFile.name} (${(evidenceFile.size / 1024 / 1024).toFixed(1)} MB)`
                : "แนบหลักฐาน (รูป / วิดีโอ)"}
            </span>
          </label>

          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="aqp-progress">
              <div className="aqp-progress-bar" style={{ width: `${uploadProgress}%` }} />
              <span>{uploadProgress}%</span>
            </div>
          )}

          {submitError && <p className="aqp-error">{submitError}</p>}

          <button
            className="aqp-submit-btn"
            type="button"
            disabled={!evidenceFile || submitting}
            onClick={() => setConfirmAction("submit")}
          >
            {submitting && confirmAction === "submit" ? "กำลังส่ง..." : "ส่งเควส"}
          </button>

          <button
            className="aqp-cancel-btn"
            type="button"
            disabled={submitting}
            onClick={() => setConfirmAction("cancel")}
          >
            ยกเลิกเควส
          </button>
        </div>
      )}

      {/* Confirm overlay */}
      {confirmAction && !submitting && (
        <div className="aqp-confirm-overlay" role="dialog" aria-modal="true">
          <div className="aqp-confirm-card">
            <p className="aqp-confirm-title">
              {confirmAction === "cancel"
                ? `ยกเลิก "${quest.title}"?`
                : `ส่งเควส "${quest.title}"?`}
            </p>
            {confirmAction === "cancel" && (
              <p className="aqp-confirm-penalty">
                จะถูกหัก {cancelPenalty.toLocaleString()} Coins
              </p>
            )}
            <div className="aqp-confirm-row">
              <button
                className="aqp-confirm-yes"
                type="button"
                onClick={handleConfirm}
              >
                {confirmAction === "cancel" ? "ยืนยันยกเลิก" : "ยืนยันส่ง"}
              </button>
              <button
                className="aqp-confirm-no"
                type="button"
                onClick={() => setConfirmAction("")}
              >
                กลับ
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
