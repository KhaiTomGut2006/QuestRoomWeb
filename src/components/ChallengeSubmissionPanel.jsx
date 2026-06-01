"use client";

import { useState } from "react";
import { ImageUp, MessageSquare, Zap } from "lucide-react";

const MAX_EVIDENCE_BYTES = 100 * 1024 * 1024;

export default function ChallengeSubmissionPanel({ challenge, onSubmit }) {
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [postText, setPostText] = useState(challenge?.postText || "");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const hasSubmission = Boolean(challenge?.evidence?.url && challenge?.submittedAt);

  if (!challenge) return null;

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setSubmitError("");
    setUploadProgress(0);
    if (!file) {
      setEvidenceFile(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setEvidenceFile(null);
      setSubmitError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_EVIDENCE_BYTES) {
      setEvidenceFile(null);
      setSubmitError("The image must be no larger than 100 MB.");
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
    } catch (error) {
      setSubmitError(error.message || "Unable to upload your work. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <aside className="aqp challenge-submission-panel" aria-label="Challenge submission">
      <div className="aqp-header">
        <Zap size={18} fill="currentColor" />
        <span className="aqp-header-title">Challenge Submission</span>
      </div>
      <div className="aqp-body">
        <p className="aqp-quest-title">{challenge.taskName || "Challenge"}</p>
        <p className="aqp-quest-desc">
          Upload your checkpoint image before the admin can approve your Badge.
        </p>

        {hasSubmission && (
          <a
            className="challenge-submission-preview"
            href={challenge.evidence.url}
            target="_blank"
            rel="noreferrer"
          >
            View submitted image
          </a>
        )}

        <label className="aqp-upload-label">
          <input type="file" accept="image/*" hidden onChange={handleFileChange} />
          <ImageUp size={17} />
          <span className="aqp-upload-text">
            {evidenceFile
              ? `${evidenceFile.name} (${(evidenceFile.size / 1024 / 1024).toFixed(1)} MB)`
              : hasSubmission
                ? "Choose another image to update"
                : "Choose checkpoint image"}
          </span>
        </label>

        <label className="challenge-submission-message">
          <span><MessageSquare size={14} /> Message for Social</span>
          <textarea
            className="aqp-post-text"
            value={postText}
            maxLength={500}
            rows={3}
            placeholder="Write something about your work..."
            onChange={(event) => setPostText(event.target.value.slice(0, 500))}
          />
        </label>

        {uploadProgress > 0 && uploadProgress < 100 && (
          <div className="aqp-progress">
            <div className="aqp-progress-bar" style={{ width: `${uploadProgress}%` }} />
            <span>{uploadProgress}%</span>
          </div>
        )}

        {submitError && <p className="aqp-error">{submitError}</p>}
        {hasSubmission && !evidenceFile && (
          <p className="challenge-submission-status">Submitted. Waiting for admin review.</p>
        )}

        <button
          className="aqp-submit-btn"
          type="button"
          disabled={!evidenceFile || submitting}
          onClick={handleSubmit}
        >
          {submitting ? "Uploading..." : hasSubmission ? "Update submission" : "Submit challenge"}
        </button>
      </div>
    </aside>
  );
}
