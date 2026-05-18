import { TREASURY_RAW_STATE, TREASURY_MULTISIG_SHORT } from "./governance-data";

export default function TreasuryCustodyCard() {
  return (
    <aside className="governance-panel treasury-custody-card" aria-label="Treasury raw state">
      <div className="governance-section-heading">
        <span>Treasury Raw State</span>
        <strong>Machine-readable custody disclosure</strong>
      </div>

      <dl className="treasury-custody-list">
        <div>
          <dt>Multisig</dt>
          <dd>{TREASURY_MULTISIG_SHORT}</dd>
        </div>
        <div className="is-address">
          <dt>Canonical address</dt>
          <dd>{TREASURY_RAW_STATE.treasuryMultisigAddress}</dd>
        </div>
        <div>
          <dt>Threshold</dt>
          <dd>2 of 3</dd>
        </div>
        <div>
          <dt>Signers</dt>
          <dd>3 active</dd>
        </div>
        <div>
          <dt>Phase</dt>
          <dd>G1 evidence</dd>
        </div>
        <div>
          <dt>Funding</dt>
          <dd>Treasury funding blocked pending approval evidence</dd>
        </div>
        <div>
          <dt>Treasury funding enabled</dt>
          <dd>false</dd>
        </div>
      </dl>

      <pre className="treasury-raw-json" aria-label="Treasury funding readiness raw JSON">
        {JSON.stringify(TREASURY_RAW_STATE, null, 2)}
      </pre>
    </aside>
  );
}
