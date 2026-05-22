"use client";

import { Zap } from "lucide-react";
import { motion } from "framer-motion";
import { firePenaltySimulation } from "@/src/lib/active-hash/milestoneActions";
import { useSlashStore } from "@/src/lib/active-hash/state/slashStore";
import { enterTransition, milestoneTransition } from "./design";

export function KillSwitch() {
  const activeCount = useSlashStore((state) => state.records.size);

  return (
    <motion.aside className="active-hash-hud-penalty active-hash-hud-panel" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ ...enterTransition, delay: 0.2 }}>
      <span className="active-hash-hud-overline">Penalty simulation</span>
      <motion.button type="button" onClick={firePenaltySimulation} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }} transition={milestoneTransition}>
        <Zap size={15} aria-hidden="true" />
        <span>
          <strong>PoCC Penalty Simulation</strong>
          <em>{activeCount > 0 ? `${activeCount} local sequence active` : "Trigger Slashing Simulation"}</em>
        </span>
      </motion.button>
      <p>Visual-only ChainRank responsibility model · no on-chain transaction</p>
    </motion.aside>
  );
}
