"use client";

import type { CSSProperties } from "react";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { NODE_TYPES, NODE_TYPE_LIST } from "@/src/lib/active-hash/constants/nodeTypes";
import { useNetworkStore } from "@/src/lib/active-hash/state/networkStore";
import { enterTransition } from "./design";

const LAYER_NAMES = {
  genesis: "Cashflow",
  sentinel: "Code Logic",
  routing: "Compute",
  settlement: "Contract",
  eco: "Eco"
} as const;

export function ProtocolLayerStrip() {
  const nodes = useNetworkStore((state) => state.nodes);
  const links = useNetworkStore((state) => state.links);
  const counts = useMemo(() => {
    return NODE_TYPE_LIST.map((type) => {
      const typedNodes = nodes.filter((node) => node.type === type);
      return {
        type,
        total: typedNodes.length,
        healthy: typedNodes.filter((node) => node.health === "healthy").length
      };
    });
  }, [nodes]);

  return (
    <motion.aside className="active-hash-hud-layers active-hash-hud-panel" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ ...enterTransition, delay: 0.14 }}>
      <div className="active-hash-hud-layer-head">
        <span>Protocol layer strip</span>
        <strong>{nodes.length} nodes · {links.length} links</strong>
      </div>
      <div className="active-hash-hud-layer-rows">
        {counts.map((count) => {
          const config = NODE_TYPES[count.type];
          return (
            <article key={count.type} style={{ "--hud-node-color": config.color } as CSSProperties}>
              <span aria-hidden="true" />
              <strong>{LAYER_NAMES[count.type]}</strong>
              <em>{config.labelZh}</em>
              <code>
                {count.healthy}/{count.total}
              </code>
            </article>
          );
        })}
      </div>
    </motion.aside>
  );
}
