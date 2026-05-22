"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { NODE_TYPE_LIST, NODE_TYPES } from "@/src/lib/active-hash/constants/nodeTypes";
import { useNetworkStore } from "@/src/lib/active-hash/state/networkStore";
import { useSlashStore } from "@/src/lib/active-hash/state/slashStore";
import { Scene } from "./Scene";

export default function ActiveHashNetworkSimulator() {
  const nodes = useNetworkStore((state) => state.nodes);
  const links = useNetworkStore((state) => state.links);
  const timelineT = useNetworkStore((state) => state.timelineT);
  const triggerSlash = useSlashStore((state) => state.triggerSlash);
  const triggerRandomSlash = useSlashStore((state) => state.triggerRandomSlash);
  const resetSlashSimulation = useSlashStore((state) => state.resetSlashSimulation);
  const slashEvents = useSlashStore((state) => state.events);
  const [targetNodeId, setTargetNodeId] = useState("");
  const healthyNodes = useMemo(() => nodes.filter((node) => node.health === "healthy"), [nodes]);
  const selectedTarget = healthyNodes.some((node) => node.id === targetNodeId) ? targetNodeId : healthyNodes[0]?.id || "";

  return (
    <main className="active-hash-network" aria-label="AHIN Active Hash Interaction Network readonly simulator">
      <header className="active-hash-header">
        <div>
          <p>AHIN Gateway Phase 1</p>
          <h1>Active Hash Interaction Network</h1>
          <span>Simulation only · no real slashing · no transfer · no burn · no signing · no treasury mutation</span>
        </div>
        <dl>
          <div>
            <dt>route</dt>
            <dd>/active-hash</dd>
          </div>
          <div>
            <dt>state</dt>
            <dd>client-local</dd>
          </div>
          <div>
            <dt>nodes</dt>
            <dd>{nodes.length}</dd>
          </div>
          <div>
            <dt>links</dt>
            <dd>{links.length}</dd>
          </div>
        </dl>
      </header>

      <section className="active-hash-safety-banner" aria-label="Simulator safety boundary">
        Simulation only · no real slashing · no transfer · no burn · no signing · no treasury mutation · no wallet calls · no chain calls · no transaction submission
      </section>

      <div className="active-hash-layout">
        <Scene />

        <aside className="active-hash-side-panel" aria-label="Five cognition node type registry">
          <section className="active-hash-slash-controls" aria-label="Visual-only slashing simulation controls">
            <div className="active-hash-panel-heading">
              <span>Visual slashing sequence</span>
              <strong>Simulation only</strong>
            </div>
            <div className="active-hash-control-grid">
              <label>
                target node
                <select value={selectedTarget} onChange={(event) => setTargetNodeId(event.target.value)} disabled={healthyNodes.length === 0}>
                  {healthyNodes.map((node) => {
                    const config = NODE_TYPES[node.type];
                    return (
                      <option key={node.id} value={node.id}>
                        {node.id} · {config.label}
                      </option>
                    );
                  })}
                </select>
              </label>
              <button type="button" onClick={() => selectedTarget && triggerSlash(selectedTarget)} disabled={!selectedTarget}>
                Trigger Slashing Simulation
              </button>
              <button type="button" onClick={() => triggerRandomSlash()} disabled={healthyNodes.length === 0}>
                Slash Random Node
              </button>
              <button type="button" onClick={resetSlashSimulation}>
                Reset Simulation
              </button>
            </div>
            <div className="active-hash-event-stream" aria-label="Readonly slashing event stream">
              {slashEvents.map((event) => (
                <article key={event.id}>
                  <span>{event.timestamp}</span>
                  <strong>{event.label}</strong>
                  <p>{event.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <div className="active-hash-panel-heading">
            <span>Five cognition node types</span>
            <strong>Local simulator registry</strong>
          </div>
          <div className="active-hash-node-registry">
            {NODE_TYPE_LIST.map((type) => {
              const config = NODE_TYPES[type];
              const count = nodes.filter((node) => node.type === type).length;
              return (
                <article key={type} style={{ "--node-color": config.color } as CSSProperties}>
                  <span>{config.labelZh}</span>
                  <h2>{config.label}</h2>
                  <p>{config.role}</p>
                  <dl>
                    <div>
                      <dt>count</dt>
                      <dd>{count}</dd>
                    </div>
                    <div>
                      <dt>mass</dt>
                      <dd>{config.mass}</dd>
                    </div>
                    <div>
                      <dt>mode</dt>
                      <dd>{type === "routing" ? "readonly" : "dry-run"}</dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
          <div className="active-hash-raw-state">
            <span>Simulator raw state</span>
            <pre>
              {JSON.stringify(
                {
                  simulatorRoute: "/active-hash",
                  timelineT: Number(timelineT.toFixed(2)),
                  protocolExecutionEnabled: false,
                  slashingSimulationEnabled: true,
                  realSlashingEnabled: false,
                  realWalletTransfer: false,
                  realBurnTransaction: false,
                  signingEnabled: false,
                  transactionSubmissionEnabled: false,
                  treasuryMutationEnabled: false,
                  backendMutation: false,
                  chainCalls: false,
                  walletCalls: false
                },
                null,
                2
              )}
            </pre>
          </div>
        </aside>
      </div>
    </main>
  );
}
