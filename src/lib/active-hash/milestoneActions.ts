"use client";

import { useNetworkStore } from "./state/networkStore";
import { useSlashStore } from "./state/slashStore";

const MILESTONE_CLEAR_MS = 2400;

function clearMilestoneLater(expected: ReturnType<typeof useNetworkStore.getState>["activeMilestone"]) {
  window.setTimeout(() => {
    const network = useNetworkStore.getState();
    if (network.activeMilestone === expected) {
      network.setActiveMilestone(null);
    }
  }, MILESTONE_CLEAR_MS);
}

function pickVisualPenaltyTarget() {
  const network = useNetworkStore.getState();
  const preferred = network.nodes.filter((node) => node.health === "healthy" && (node.type === "routing" || node.type === "eco"));
  const fallback = network.nodes.filter((node) => node.health === "healthy" && node.type !== "genesis");
  const pool = preferred.length > 0 ? preferred : fallback;
  if (pool.length === 0) return null;
  const index = Math.floor((performance.now() * 0.017) % pool.length);
  return pool[index];
}

export function fireGenesisBigBang() {
  useSlashStore.getState().resetSlashSimulation();
  const network = useNetworkStore.getState();
  network.setTimelineT(0.5);
  network.setActiveMilestone("genesis-ignition");
  network.setPulse({ origin: [0, 0, 0], strength: 18, remaining: 1.2 });
  clearMilestoneLater("genesis-ignition");
}

export function fireCausalGuard() {
  const network = useNetworkStore.getState();
  network.setTimelineT(0.42);
  network.setActiveMilestone("causal-guard");
  const target = pickVisualPenaltyTarget();
  if (target) {
    useSlashStore.getState().triggerSlash(target.id);
  }
  clearMilestoneLater("causal-guard");
}

export function fireMacroEvolution() {
  const network = useNetworkStore.getState();
  network.spawnEcoCluster(5);
  network.setTimelineT(1);
  network.setActiveMilestone("macro-evolution");
  network.setPulse({ origin: [0, 0, 0], strength: 10, remaining: 1 });
  clearMilestoneLater("macro-evolution");
}

export function firePenaltySimulation() {
  const target = pickVisualPenaltyTarget();
  if (target) {
    useSlashStore.getState().triggerSlash(target.id);
    return;
  }
  useSlashStore.getState().triggerRandomSlash();
}
