"use client";

import { useState } from "react";
import { CERTIFICATE_PAYLOAD, G1_PHASE, TRUSTED_TWIN_CASE_ID } from "./trusted-twin-data";

type FinalityState = "idle" | "scanning" | "verified";

export default function EndgameSealModal() {
  const [open, setOpen] = useState(false);
  const [finalityState, setFinalityState] = useState<FinalityState>("idle");
  const [copied, setCopied] = useState(false);
  const certificateJson = JSON.stringify(CERTIFICATE_PAYLOAD, null, 2);

  function advanceFinalitySlot() {
    if (finalityState === "idle") {
      setFinalityState("scanning");
      return;
    }
    setFinalityState("verified");
    setOpen(true);
  }

  async function copyCertificateJson() {
    try {
      await navigator.clipboard?.writeText(certificateJson);
    } catch {
      // Clipboard availability depends on browser security context; the terminal payload remains visible.
    }
    setCopied(true);
  }

  return (
    <section className="twin-panel twin-endgame">
      <div className="twin-section-heading">
        <span>Human Finality Slot</span>
        <strong>Readiness certificate gate</strong>
      </div>
      <div className={`human-finality-slot is-${finalityState}`}>
        <div className="slot-track" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p>
            {finalityState === "idle"
              ? "置入本体授权意向"
              : finalityState === "scanning"
                ? "终局意向校验中"
                : "本体终局意向已确认"}
          </p>
          <h3>
            {finalityState === "idle"
              ? "Readonly evidence mode · no signature request generated"
              : finalityState === "scanning"
                ? "Local readiness reconstruction · no chain execution"
                : "Readiness certificate generated · onChainSubmitted=false"}
          </h3>
          <span>case {TRUSTED_TWIN_CASE_ID}</span>
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
          <dt>Signature request generated</dt>
          <dd>{String(CERTIFICATE_PAYLOAD.signatureRequestGenerated)}</dd>
        </div>
        <div>
          <dt>On-chain submitted</dt>
          <dd>{String(CERTIFICATE_PAYLOAD.onChainSubmitted)}</dd>
        </div>
      </dl>
      <button type="button" className="twin-button" onClick={advanceFinalitySlot}>
        {finalityState === "idle" ? "Insert finality intent" : finalityState === "scanning" ? "Generate readiness certificate" : "Open certificate terminal"}
      </button>

      {open ? (
        <div className="twin-modal" role="dialog" aria-modal="true" aria-label="Certificate payload terminal">
          <button type="button" className="twin-modal-scrim" aria-label="Close certificate terminal" onClick={() => setOpen(false)} />
          <div className="twin-modal-card certificate-terminal">
            <div className="twin-certificate-head">
              <div>
                <span>Certificate Payload Terminal</span>
                <h2>Readiness Certificate</h2>
                <p>Readonly evidence mode · no transaction submitted · execution authority disabled</p>
              </div>
              <strong className="terminal-led">onChainSubmitted=false</strong>
            </div>

            <pre className="certificate-json">{certificateJson}</pre>

            <div className="terminal-actions">
              <button type="button" className="twin-button" onClick={copyCertificateJson}>
                {copied ? "Certificate JSON copied" : "Copy certificate JSON"}
              </button>
              <button type="button" className="twin-button is-dark" onClick={() => setOpen(false)}>
                Close terminal
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
