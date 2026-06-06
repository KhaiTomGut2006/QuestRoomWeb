"use client";

import { useEffect, useState } from "react";
import { ImageUp, MessageSquare, X, Zap } from "lucide-react";
import { normalizeEvidenceUrl } from "@/lib/basePath";

const MAX_EVIDENCE_BYTES = 100 * 1024 * 1024;

export default function ChallengeSubmissionPanel({ challenge, onSubmit, onClose }) {
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [postText, setPostText] = useState(challenge?.postText || "");
  const [showPostText, setShowPostText] = useState(Boolean(challenge?.postText));
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const hasSubmission = Boolean(challenge?.evidence?.url && challenge?.submittedAt);
  const previewUrl = normalizeEvidenceUrl(challenge?.evidence?.url);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !submitting) onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, submitting]);

  if (!challenge) return null;

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setSubmitError("");
    setUploadProgress(0);
    if (!file) {
      setEvidenceFile(null);
      return;
    }
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setEvidenceFile(null);
      setSubmitError("Please choose an image or video file.");
      return;
    }
    if (file.size > MAX_EVIDENCE_BYTES) {
      setEvidenceFile(null);
      setSubmitError("The file must be no larger than 100 MB.");
      return;
    }
    setEvidenceFile(file);
  };

  const handleSubmit = async () => {
    if (!evidenceFile || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await onSubmit?.(evidenceFile, setUploadProgress, postText);
      setEvidenceFile(null);
      onClose?.();
    } catch (error) {
      setSubmitError(error.message || "Unable to upload your work. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="challenge-submission-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !submitting && onClose?.()}
    >
      <section className="challenge-submission-modal" role="dialog" aria-modal="true" aria-label="Challenge submission">
        <button
          className="challenge-submission-close"
          type="button"
          aria-label="Close challenge upload"
          disabled={submitting}
          onClick={onClose}
        >
          <X size={24} strokeWidth={3} />
        </button>

        <header className="challenge-submission-header">
          <span className="challenge-submission-icon">
            <Zap size={28} fill="currentColor" />
          </span>
          <div>
            <p>Challenge Submission</p>
            <h2>{challenge.taskName || "Challenge"}</h2>
          </div>
        </header>

        <p className="challenge-submission-desc">
          อัปโหลดไฟล์งานของน้องเพื่อให้พี่ประจำห้องตรวจ Checkpoint และอนุมัติ Badge
        </p>

        <label className="npc-quest-upload challenge-submission-upload">
          <input type="file" accept="image/*,video/*" onChange={handleFileChange} />
          <strong>{evidenceFile ? "เปลี่ยนไฟล์งาน" : hasSubmission ? "อัปโหลดไฟล์งานใหม่" : "อัปโหลดไฟล์งาน"}</strong>
          <small>
            {evidenceFile
              ? `${evidenceFile.name} (${(evidenceFile.size / 1024 / 1024).toFixed(1)} MB)`
              : "รองรับไฟล์ภาพ ขนาดไม่เกิน 100 MB"}
          </small>
        </label>

        {hasSubmission && (
          <a className="challenge-submission-preview" href={previewUrl} target="_blank" rel="noreferrer">
            ดูไฟล์งานที่ส่งล่าสุด
          </a>
        )}

        {showPostText && (
          <textarea
            className="npc-quest-post-text"
            value={postText}
            maxLength={500}
            rows={3}
            placeholder="Write something about your work..."
            onChange={(event) => setPostText(event.target.value.slice(0, 500))}
          />
        )}

        {uploadProgress > 0 && uploadProgress < 100 && (
          <p className="npc-quest-upload-progress">กำลังอัปโหลด... {Math.round(uploadProgress)}%</p>
        )}

        {submitError && <p className="npc-quest-upload-error">{submitError}</p>}
        {hasSubmission && !evidenceFile && (
          <p className="challenge-submission-status">ส่งไฟล์งานแล้ว สามารถอัปโหลดใหม่เพื่อแก้ไขได้</p>
        )}

        <div className="npc-active-quest-submit-row">
          <button
            className="npc-quest-submit-btn"
            type="button"
            disabled={!evidenceFile || submitting}
            onClick={handleSubmit}
          >
            <ImageUp size={22} />
            {submitting ? "กำลังอัปโหลด..." : hasSubmission ? "บันทึกการแก้ไข" : "ส่งไฟล์งาน"}
          </button>
          <button
            className={`npc-quest-message-btn${showPostText ? " is-active" : ""}`}
            type="button"
            aria-label="Add post message"
            aria-pressed={showPostText}
            onClick={() => setShowPostText((current) => !current)}
          >
            <MessageSquare size={26} strokeWidth={2.2} />
          </button>
        </div>

        <button className="challenge-submission-cancel" type="button" disabled={submitting} onClick={onClose}>
          ปิด
        </button>
      </section>
    </div>
  );
}
