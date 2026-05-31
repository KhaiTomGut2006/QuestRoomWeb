"use client";

import { Zap } from "lucide-react";
import { withBasePath } from "@/lib/basePath";

export default function ChallengeModal({ member, onConfirm, onCancel }) {
  const cost = member?.currentChallengeCost || 250;
  const stageName = member?.stageLabel || member?.stage || "Stage";
  const coins = member?.coins || 0;
  const canAfford = coins >= cost;

  return (
    <div className="challenge-modal-overlay" onClick={onCancel}>
      <div className="challenge-modal" onClick={(e) => e.stopPropagation()}>
        <div className="challenge-modal-glow-top" />

        <div className="challenge-modal-icon">
          <Zap size={52} fill="currentColor" />
        </div>

        <h2 className="challenge-modal-title">CHALLENGE</h2>
        <p className="challenge-modal-stage">{stageName}</p>

        <div className="challenge-modal-impact">
          <div className="challenge-modal-impact-row">
            <span className="challenge-modal-impact-label">ค่าใช้จ่าย</span>
            <span className="challenge-modal-impact-cost">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withBasePath("/assets/Coin.png")} alt="coin" />
              −{cost.toLocaleString()}
            </span>
          </div>
          <div className="challenge-modal-impact-divider" />
          <div className="challenge-modal-impact-row">
            <span className="challenge-modal-impact-label">เหรียญที่มี</span>
            <span className={`challenge-modal-impact-balance${canAfford ? "" : " deficit"}`}>
              {coins.toLocaleString()}
            </span>
          </div>
          {canAfford && (
            <div className="challenge-modal-impact-row">
              <span className="challenge-modal-impact-label">คงเหลือหลัง</span>
              <span className="challenge-modal-impact-remaining">
                {(coins - cost).toLocaleString()}
              </span>
            </div>
          )}
        </div>

        <p className="challenge-modal-desc">
          ประกาศท้าทาย เพื่อเรียกพี่ประจำห้องมาตรวจ Checkpoint ของเธอ
          <br />
          <strong>ทุกคนในห้องจะเห็นการประกาศนี้!</strong>
        </p>

        {canAfford ? (
          <button className="challenge-modal-confirm" type="button" onClick={onConfirm}>
            <Zap size={20} fill="currentColor" />
            ยืนยัน Challenge!
          </button>
        ) : (
          <div className="challenge-modal-no-coins">เหรียญไม่พอ!</div>
        )}

        <button className="challenge-modal-cancel" type="button" onClick={onCancel}>
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
