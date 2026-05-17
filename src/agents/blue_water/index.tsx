import { Cpu } from "lucide-react";

export default function BlueWaterAgent() {
  return (
    <section className="agent-surface blue-water">
      <div className="agent-heading">
        <Cpu aria-hidden="true" />
        <div>
          <p>算流蓝</p>
          <h2>Chippmf Precision Market</h2>
        </div>
      </div>
      <dl className="agent-metrics">
        <div>
          <dt>Mode</dt>
          <dd>RFQ to inventory match</dd>
        </div>
        <div>
          <dt>Legacy Slot</dt>
          <dd>src/agents/blue_water/legacy</dd>
        </div>
        <div>
          <dt>Flow</dt>
          <dd>Broker quote parsing, allocation, settlement trace</dd>
        </div>
      </dl>
    </section>
  );
}
