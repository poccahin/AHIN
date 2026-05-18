"use client";

import { useState } from "react";
import { CANDIDATE_EVIDENCE_HASH, CANONICAL_TREASURY_MULTISIG, G1_PHASE, READINESS_EVENTS, TRUSTED_TWIN_CASE_ID, TRUSTED_TWIN_FLAGS } from "./trusted-twin-data";

export default function EndgameSealModal() {
  const [open, setOpen] = useState(false);

  return (
    <section className="twin-panel twin-endgame">
      <div className="twin-section-heading">
        <span>Trusted Twin Court</span>
        <strong>Finality readiness seal</strong>
      </div>
      <div className="twin-seal-summary">
        <div className="twin-seal-mark" aria-hidden="true">
          seal
        </div>
        <div>
          <p>本体终局意向已确认</p>
          <h3>Readiness Certificate</h3>
          <span>Candidate evidence hash · not submitted to chain execution</span>
        </div>
      </div>
      <dl className="twin-fact-list">
        <div>
          <dt>Case</dt>
          <dd>{TRUSTED_TWIN_CASE_ID}</dd>
        </div>
        <div>
          <dt>Phase</dt>
          <dd>{G1_PHASE}</dd>
        </div>
        <div>
          <dt>Approvals</dt>
          <dd>Required approvals: 2-of-3 · collected approvals pending evidence</dd>
        </div>
        <div>
          <dt>Effect</dt>
          <dd>待外部签名与链上提交后生效</dd>
        </div>
      </dl>
      <button type="button" className="twin-button" onClick={() => setOpen(true)}>
        View readiness seal
      </button>

      {open ? (
        <div className="twin-modal" role="dialog" aria-modal="true" aria-label="Trusted Twin Court readiness seal">
          <button type="button" className="twin-modal-scrim" aria-label="Close readiness seal" onClick={() => setOpen(false)} />
          <div className="twin-modal-card">
            <div className="twin-certificate-head">
              <div>
                <span>AHIN Governance Court · Final Seal Draft</span>
                <h2>Readiness Certificate</h2>
                <p>Human finality intent confirmed · execution authority disabled</p>
              </div>
              <div className="twin-stamp" aria-hidden="true">
                ready
              </div>
            </div>

            <dl className="twin-certificate-grid">
              <div>
                <dt>Case ID</dt>
                <dd>{TRUSTED_TWIN_CASE_ID}</dd>
              </div>
              <div>
                <dt>Treasury multisig</dt>
                <dd>{CANONICAL_TREASURY_MULTISIG}</dd>
              </div>
              <div>
                <dt>Candidate evidence hash</dt>
                <dd>{CANDIDATE_EVIDENCE_HASH}</dd>
              </div>
              <div>
                <dt>On-chain submitted</dt>
                <dd>{String(TRUSTED_TWIN_FLAGS.onChainSubmitted)}</dd>
              </div>
              <div>
                <dt>Signing enabled</dt>
                <dd>{String(TRUSTED_TWIN_FLAGS.signingEnabled)}</dd>
              </div>
              <div>
                <dt>Protocol execution</dt>
                <dd>{String(TRUSTED_TWIN_FLAGS.protocolExecutionEnabled)}</dd>
              </div>
            </dl>

            <div className="twin-event-stack">
              {READINESS_EVENTS.map((event) => (
                <div key={event.label}>
                  <span>{event.label}</span>
                  <strong>{event.hash}</strong>
                  <small>{event.status}</small>
                </div>
              ))}
            </div>

            <p className="twin-judgment">
              "This readiness certificate records candidate evidence only. It becomes operationally meaningful only after external signature evidence and verified chain submission are separately archived."
            </p>

            <button type="button" className="twin-button is-dark" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

