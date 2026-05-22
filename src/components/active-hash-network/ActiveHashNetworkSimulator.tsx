"use client";

import type { CSSProperties } from "react";
import { NODE_TYPE_LIST, NODE_TYPES } from "@/src/lib/active-hash/constants/nodeTypes";
import { useNetworkStore } from "@/src/lib/active-hash/state/networkStore";
import { Scene } from "./Scene";

export default function ActiveHashNetworkSimulator() {
  const nodes = useNetworkStore((state) => state.nodes);
  const links = useNetworkStore((state) => state.links);
  const timelineT = useNetworkStore((state) => state.timelineT);

  return (
    <main className="active-hash-network" aria-label="AHIN Active Hash Interaction Network readonly simulator">
      <header className="active-hash-header">
        <div>
          <p>AHIN Gateway Phase 1</p>
          <h1>Active Hash Interaction Network</h1>
          <span>Readonly simulator · no protocol execution · no transfer · no burn · no signing</span>
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
        Readonly simulator · no protocol execution · no transfer · no burn · no signing · no wallet calls · no chain calls · no transaction submission
      </section>

      <div className="active-hash-layout">
        <Scene />

        <aside className="active-hash-side-panel" aria-label="Five cognition node type registry">
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
