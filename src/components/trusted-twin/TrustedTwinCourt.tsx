import CircuitBreakerCertificate from "./CircuitBreakerCertificate";
import EndgameSealModal from "./EndgameSealModal";
import OfflineVerifierPanel from "./OfflineVerifierPanel";
import TrilingualSeal from "./TrilingualSeal";
import { CANONICAL_TREASURY_MULTISIG, TRUSTED_TWIN_FLAGS, TRUSTED_TWIN_PHASE } from "./trusted-twin-data";

export default function TrustedTwinCourt() {
  return (
    <section className="trusted-twin-court" aria-label="AHIN Trusted Twin Court readiness layer">
      <div className="trusted-twin-header">
        <div>
          <p>AHIN Trusted Twin Court v1.0</p>
          <h2>Readiness layer</h2>
          <span>Offline verifier prototype · causal replay · finality certificate draft</span>
        </div>
        <dl>
          <div>
            <dt>Phase</dt>
            <dd>{TRUSTED_TWIN_PHASE}</dd>
          </div>
          <div>
            <dt>Treasury</dt>
            <dd>{CANONICAL_TREASURY_MULTISIG}</dd>
          </div>
          <div>
            <dt>Chain submission</dt>
            <dd>{String(TRUSTED_TWIN_FLAGS.onChainSubmitted)}</dd>
          </div>
        </dl>
      </div>

      <div className="trusted-twin-grid">
        <EndgameSealModal />
        <OfflineVerifierPanel />
        <CircuitBreakerCertificate />
        <TrilingualSeal />
      </div>
    </section>
  );
}

