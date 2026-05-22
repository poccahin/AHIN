"use client";

import type { CSSProperties } from "react";
import { Flame, ShieldAlert, Sprout } from "lucide-react";
import { motion } from "framer-motion";
import { fireCausalGuard, fireGenesisBigBang, fireMacroEvolution } from "@/src/lib/active-hash/milestoneActions";
import { useNetworkStore } from "@/src/lib/active-hash/state/networkStore";
import type { MilestoneId } from "@/src/lib/active-hash/types/network";
import { enterTransition, milestoneTransition } from "./design";

interface MilestoneDef {
  id: MilestoneId;
  label: string;
  sublabel: string;
  color: string;
  icon: typeof Flame;
  fire: () => void;
}

const MILESTONES: MilestoneDef[] = [
  {
    id: "genesis-ignition",
    label: "Genesis Big Bang",
    sublabel: "Genesis Ignition",
    color: "#FF5722",
    icon: Flame,
    fire: fireGenesisBigBang
  },
  {
    id: "causal-guard",
    label: "Causal Guard",
    sublabel: "PoCC violation simulation",
    color: "#9C27B0",
    icon: ShieldAlert,
    fire: fireCausalGuard
  },
  {
    id: "macro-evolution",
    label: "Macro Evolution",
    sublabel: "Local eco cluster",
    color: "#8BC34A",
    icon: Sprout,
    fire: fireMacroEvolution
  }
];

export function MilestoneButtons() {
  const activeMilestone = useNetworkStore((state) => state.activeMilestone);

  return (
    <motion.section className="active-hash-hud-milestones active-hash-hud-panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...enterTransition, delay: 0.08 }}>
      <span className="active-hash-hud-overline">Milestone controls · local state only</span>
      <div className="active-hash-hud-milestone-grid">
        {MILESTONES.map((milestone) => {
          const Icon = milestone.icon;
          const isActive = activeMilestone === milestone.id;
          return (
            <motion.button
              key={milestone.id}
              type="button"
              onClick={milestone.fire}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              transition={milestoneTransition}
              className={isActive ? "is-active" : undefined}
              style={{ "--hud-node-color": milestone.color } as CSSProperties}
            >
              <Icon size={15} aria-hidden="true" />
              <span>
                <strong>{milestone.label}</strong>
                <em>{milestone.sublabel}</em>
              </span>
            </motion.button>
          );
        })}
      </div>
    </motion.section>
  );
}
