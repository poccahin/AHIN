"use client";

import { Activity, CircleDot, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { HUD_SAFETY_COPY, enterTransition } from "./design";

export function TopBar() {
  return (
    <motion.header className="active-hash-hud-topbar active-hash-hud-panel" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={enterTransition}>
      <div className="active-hash-hud-brand">
        <span className="active-hash-hud-mark" aria-hidden="true" />
        <div>
          <strong>ahin.io</strong>
          <span>Active Hash Boardroom</span>
        </div>
      </div>
      <nav aria-label="Readonly simulator status" className="active-hash-hud-status">
        <span>
          <CircleDot size={12} aria-hidden="true" />
          Local topology
        </span>
        <span>
          <Activity size={12} aria-hidden="true" />
          Readonly simulator
        </span>
        <span>
          <ShieldCheck size={12} aria-hidden="true" />
          No wallet calls
        </span>
      </nav>
      <p>{HUD_SAFETY_COPY}</p>
    </motion.header>
  );
}
