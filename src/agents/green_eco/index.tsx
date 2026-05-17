import { Sprout } from "lucide-react";

export default function GreenEcoAgent() {
  return (
    <section className="agent-surface green-eco">
      <div className="agent-heading">
        <Sprout aria-hidden="true" />
        <div>
          <p>灵根绿</p>
          <h2>Regenerative Coordination Layer</h2>
        </div>
      </div>
      <dl className="agent-metrics">
        <div>
          <dt>Signal</dt>
          <dd>Ecosystem health</dd>
        </div>
        <div>
          <dt>Loop</dt>
          <dd>Operator feedback</dd>
        </div>
      </dl>
    </section>
  );
}
