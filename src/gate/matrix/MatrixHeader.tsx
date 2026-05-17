"use client";

import { motion } from "framer-motion";
import { CheckCircle2, CircleDashed, DatabaseZap, LockKeyhole, ShieldCheck } from "lucide-react";
import { headerVariants } from "./matrix-motion";

const STATUS = [
  { label: "Gate: Passed", tone: "green", Icon: CheckCircle2 },
  { label: "Mode: Mock / Readonly", tone: "amber", Icon: CircleDashed },
  { label: "Oracle: Readonly", tone: "neutral", Icon: DatabaseZap },
  { label: "Protocol Execution: Disabled", tone: "neutral", Icon: ShieldCheck },
  { label: "LIFE++ Transfer: Disabled", tone: "neutral", Icon: LockKeyhole }
];

const TRUST_ITEMS = [
  { label: "Squads Multisig", value: "2-of-3", tone: "green" },
  { label: "Treasury", value: "5Coh...CzRo", tone: "neutral" },
  { label: "G1 Status", value: "Evidence Collection", tone: "amber" },
  { label: "Oracle", value: "Readonly", tone: "green" },
  { label: "Protocol Execution", value: "Disabled", tone: "neutral" },
  { label: "LIFE++ Transfer", value: "Disabled", tone: "neutral" }
];

export default function MatrixHeader() {
  return (
    <motion.header className="matrix4f-header" variants={headerVariants}>
      <div className="matrix4f-header-main">
        <div className="matrix4f-title-stack">
          <p>AHIN Governance Matrix</p>
          <h1>Five Elements Online</h1>
          <span>LIFE++ / AHIN Foundation governance gate · G1 treasury readiness · Readonly protocol state</span>
        </div>
        <div className="matrix4f-status-grid" aria-label="Protocol status">
          {STATUS.map(({ label, tone, Icon }) => (
            <span key={label} className={`matrix4f-status-pill is-${tone}`}>
              <Icon className="h-3.5 w-3.5" aria-hidden={true} />
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="matrix4f-trust-bar" aria-label="Governance trust status">
        {TRUST_ITEMS.map((item) => (
          <span key={`${item.label}-${item.value}`} className={`matrix4f-trust-pill is-${item.tone}`}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </span>
        ))}
      </div>
    </motion.header>
  );
}
