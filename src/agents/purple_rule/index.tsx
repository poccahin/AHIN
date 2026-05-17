import { Scale } from "lucide-react";

export default function PurpleRuleAgent() {
  return (
    <section className="agent-surface purple-rule">
      <div className="agent-heading">
        <Scale aria-hidden="true" />
        <div>
          <p>天则紫</p>
          <h2>Rule Arbitration Layer</h2>
        </div>
      </div>
      <dl className="agent-metrics">
        <div>
          <dt>Policy</dt>
          <dd>Invariant review</dd>
        </div>
        <div>
          <dt>Ledger</dt>
          <dd>Decision provenance</dd>
        </div>
      </dl>
    </section>
  );
}
