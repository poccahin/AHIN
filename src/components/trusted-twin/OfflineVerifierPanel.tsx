"use client";

import { useMemo, useState } from "react";
import { CANDIDATE_EVIDENCE_HASH, CAUSAL_REPLAY_FRAMES, TRUSTED_TWIN_CASE_ID } from "./trusted-twin-data";

type VerificationState = "idle" | "ready" | "incomplete";

export default function OfflineVerifierPanel() {
  const [certificateText, setCertificateText] = useState(`${TRUSTED_TWIN_CASE_ID}\n${CANDIDATE_EVIDENCE_HASH}\nreadonly evidence mode`);
  const [verificationState, setVerificationState] = useState<VerificationState>("idle");

  const checks = useMemo(
    () => [
      { label: "Case ID present", passed: certificateText.includes(TRUSTED_TWIN_CASE_ID) },
      { label: "Candidate evidence hash present", passed: certificateText.includes(CANDIDATE_EVIDENCE_HASH) },
      { label: "Readonly mode declared", passed: /readonly evidence mode/i.test(certificateText) }
    ],
    [certificateText]
  );

  function runLocalReadinessCheck() {
    setVerificationState(checks.every((check) => check.passed) ? "ready" : "incomplete");
  }

  return (
    <section className="twin-panel twin-verifier">
      <div className="twin-section-heading">
        <span>Causal Replay Terminal</span>
        <strong>Readonly replay · no ledger state modified</strong>
      </div>
      <p className="twin-muted">
        Paste a readiness certificate payload. This panel performs local structure checks only; the archived trust kernel is not wired into this browser build.
      </p>
      <div className="causal-replay-table" aria-label="Readonly causal replay frames">
        <div className="causal-replay-head">
          <span>frame</span>
          <span>authority</span>
          <span>model</span>
          <span>delta</span>
          <span>hash</span>
          <span>event</span>
        </div>
        {CAUSAL_REPLAY_FRAMES.map((frame) => (
          <div key={frame.frame} className="causal-replay-row">
            <span>{frame.frame}</span>
            <span>{frame.authority}</span>
            <span>{frame.modelVersion}</span>
            <span>{frame.creditDelta}</span>
            <span>{frame.cognitiveHash}</span>
            <span>{frame.event}</span>
          </div>
        ))}
      </div>
      <textarea
        className="twin-textarea"
        value={certificateText}
        onChange={(event) => {
          setCertificateText(event.target.value);
          setVerificationState("idle");
        }}
        aria-label="Readiness certificate draft"
      />
      <div className="twin-check-list">
        {checks.map((check) => (
          <span key={check.label} className={check.passed ? "is-pass" : "is-pending"}>
            {check.label}
          </span>
        ))}
      </div>
      <button type="button" className="twin-button" onClick={runLocalReadinessCheck}>
        Run local readiness check
      </button>
      <p className={`twin-verdict is-${verificationState}`}>
        {verificationState === "ready"
          ? "Local readiness checks passed · no network call"
          : verificationState === "incomplete"
            ? "Readiness certificate draft incomplete"
            : "Awaiting local verification readiness check"}
      </p>
    </section>
  );
}
