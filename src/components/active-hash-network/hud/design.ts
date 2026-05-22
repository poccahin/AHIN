import type { CSSProperties } from "react";

export const HUD_SAFETY_COPY = "Simulation only · no real slashing · no transfer · no burn · no signing · no treasury mutation";

export const milestoneTransition = {
  type: "spring" as const,
  stiffness: 320,
  damping: 26,
  mass: 0.72
};

export const enterTransition = {
  duration: 0.45,
  ease: [0.16, 1, 0.3, 1] as const
};

export function nodeColorStyle(color: string) {
  return {
    "--hud-node-color": color
  } as CSSProperties;
}
