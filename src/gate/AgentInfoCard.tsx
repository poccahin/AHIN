"use client";

import { motion } from "framer-motion";
import { AHIN_COLLABORATION_USAGE_RULE } from "../config/life-plus";
import type { ElementSpec } from "./element-specs";

interface AgentInfoCardProps {
  agent: ElementSpec;
  compact?: boolean;
}

export default function AgentInfoCard({ agent, compact = false }: AgentInfoCardProps) {
  return (
    <motion.aside
      className={`agent-info-card ${compact ? "is-compact" : ""}`}
      initial={{ opacity: 0, y: 10, scale: 0.96, filter: "blur(12px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: 8, scale: 0.96, filter: "blur(12px)" }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <p className="text-[12px] text-white/[0.48]">{agent.chineseName}</p>
          <h3 className="text-base font-semibold text-white">{agent.englishName}</h3>
        </div>
        <span className="status-pill">Active</span>
      </div>
      <p className="mb-4 text-sm leading-5 text-white/[0.68]">{agent.role}</p>
      <dl className="grid gap-2 text-xs">
        <div className="agent-info-row">
          <dt>Trust Route</dt>
          <dd>Readonly PoCC Canxian</dd>
        </div>
        <div className="agent-info-row">
          <dt>Admission</dt>
          <dd>≥ 10 USDT-equivalent LIFE++</dd>
        </div>
        <div className="agent-info-row">
          <dt>Usage Rule</dt>
          <dd>{AHIN_COLLABORATION_USAGE_RULE}</dd>
        </div>
        <div className="agent-info-row">
          <dt>AHIN Anchor</dt>
          <dd>{agent.anchorHash}</dd>
        </div>
      </dl>
    </motion.aside>
  );
}
