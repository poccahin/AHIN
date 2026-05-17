import { RadioTower } from "lucide-react";
import { evaluateGodsignal } from "./godsignal/engine";

export default function FireOrangeAgent() {
  const decision = evaluateGodsignal({
    operatorId: "ahin.fire-orchestrator",
    signal: "genesis-pulse",
    observedAt: new Date().toISOString()
  });

  return (
    <section className="agent-surface fire-orange">
      <div className="agent-heading">
        <RadioTower aria-hidden="true" />
        <div>
          <p>初然橙</p>
          <h2>Godsignal Engine</h2>
        </div>
      </div>
      <dl className="agent-metrics">
        <div>
          <dt>Cluster</dt>
          <dd>{decision.cluster}</dd>
        </div>
        <div>
          <dt>Signal</dt>
          <dd>{decision.reason}</dd>
        </div>
        <div>
          <dt>Trace</dt>
          <dd>{decision.traceId}</dd>
        </div>
      </dl>
    </section>
  );
}
