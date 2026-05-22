"use client";

import { Clock3 } from "lucide-react";
import { motion } from "framer-motion";
import { useNetworkStore } from "@/src/lib/active-hash/state/networkStore";
import { enterTransition } from "./design";

const ANCHORS = [
  { value: 0, label: "Past", sublabel: "Entropy" },
  { value: 0.5, label: "Present", sublabel: "Balanced Graph" },
  { value: 1, label: "Future", sublabel: "Macro Evolution" }
] as const;

function phaseLabel(timelineT: number) {
  if (timelineT < 0.34) return "Past / Entropy";
  if (timelineT < 0.67) return "Present / Balanced Graph";
  return "Future / Macro Evolution";
}

export function Timeline() {
  const timelineT = useNetworkStore((state) => state.timelineT);
  const setTimelineT = useNetworkStore((state) => state.setTimelineT);

  return (
    <motion.section className="active-hash-hud-timeline active-hash-hud-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...enterTransition, delay: 0.16 }}>
      <div className="active-hash-hud-timeline-head">
        <Clock3 size={13} aria-hidden="true" />
        <span>Timeline scrubber</span>
        <strong>{phaseLabel(timelineT)}</strong>
      </div>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={timelineT}
        aria-label="Active Hash timeline"
        onChange={(event) => setTimelineT(Number(event.target.value))}
      />
      <div className="active-hash-hud-timeline-anchors">
        {ANCHORS.map((anchor) => (
          <span key={anchor.value}>
            <strong>{anchor.label}</strong>
            <em>{anchor.sublabel}</em>
          </span>
        ))}
      </div>
    </motion.section>
  );
}
