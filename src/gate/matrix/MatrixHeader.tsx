"use client";

import { motion } from "framer-motion";
import { CheckCircle2, CircleDashed, LockKeyhole, ShieldCheck } from "lucide-react";
import { headerVariants } from "./matrix-motion";

const STATUS = [
  { label: "Gate: Passed", tone: "green", Icon: CheckCircle2 },
  { label: "Mode: Mock / Readonly", tone: "amber", Icon: CircleDashed },
  { label: "Protocol Execution: Disabled", tone: "neutral", Icon: ShieldCheck },
  { label: "LIFE++ Transfer: Disabled", tone: "neutral", Icon: LockKeyhole }
];

export default function MatrixHeader() {
  return (
    <motion.header className="matrix4f-header" variants={headerVariants}>
      <div className="matrix4f-title-stack">
        <p>AHIN Agent Matrix</p>
        <h1>Five Elements Online</h1>
        <span>PoCC Cognitive Canxian consensus ready · AHIN semantic anchors active</span>
      </div>
      <div className="matrix4f-status-grid" aria-label="Protocol status">
        {STATUS.map(({ label, tone, Icon }) => (
          <span key={label} className={`matrix4f-status-pill is-${tone}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden={true} />
            {label}
          </span>
        ))}
      </div>
    </motion.header>
  );
}
