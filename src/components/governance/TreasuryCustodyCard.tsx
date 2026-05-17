import { CANONICAL_TREASURY_MULTISIG, TREASURY_MULTISIG_SHORT } from "./governance-data";

export default function TreasuryCustodyCard() {
  return (
    <aside className="governance-panel treasury-custody-card" aria-label="AHIN Foundation Treasury custody">
      <div className="governance-section-heading">
        <span>AHIN Foundation Treasury</span>
        <strong>Governance custody</strong>
      </div>

      <dl className="treasury-custody-list">
        <div>
          <dt>Multisig</dt>
          <dd>{TREASURY_MULTISIG_SHORT}</dd>
        </div>
        <div className="is-address">
          <dt>Canonical address</dt>
          <dd>{CANONICAL_TREASURY_MULTISIG}</dd>
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
          <dd>Blocked pending approval evidence</dd>
        </div>
        <div>
          <dt>Treasury funding enabled</dt>
          <dd>false</dd>
        </div>
      </dl>

      <div className="readiness-meter" aria-label="G1 evidence readiness">
        <div>
          <span>Treasury funding readiness</span>
          <strong>Funding blocked pending approval evidence</strong>
        </div>
        <div className="readiness-bars" aria-hidden="true">
          <span />
          <span />
          <span />
          <span className="is-muted" />
          <span className="is-muted" />
        </div>
        <p>G1 evidence readiness · No live funding actions</p>
      </div>
    </aside>
  );
}
