import { FileCheck2 } from "lucide-react";

export default function GoldContractAgent() {
  return (
    <section className="agent-surface gold-contract">
      <div className="agent-heading">
        <FileCheck2 aria-hidden="true" />
        <div>
          <p>定约金</p>
          <h2>Contract Commitment Layer</h2>
        </div>
      </div>
      <dl className="agent-metrics">
        <div>
          <dt>Execution</dt>
          <dd>Intent to settlement</dd>
        </div>
        <div>
          <dt>Audit</dt>
          <dd>Append-only commitment trace</dd>
        </div>
      </dl>
    </section>
  );
}
