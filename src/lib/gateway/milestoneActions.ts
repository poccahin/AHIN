'use client';

/**
 * Milestone action handlers.
 *
 * Each function corresponds to one of the three HUD milestone buttons. They
 * compose actions across networkStore and slashStore to produce a visible,
 * topology-level event from a single click.
 *
 * Time handling: these are called from React event handlers, which don't
 * have access to the R3F clock. We avoid the clock-origin mismatch by:
 *   - slashStore exposes `enqueueSlash(id)` which defers to the next useFrame
 *     tick (which has the canonical clock)
 *   - networkStore.pulse uses a `remaining` duration that's decremented
 *     each frame by the VoxelInstancedField, also avoiding clock-origin
 *     coupling
 */

import { useNetworkStore } from '@/src/store/networkStore';
import { useSlashStore } from '@/src/store/slashStore';

/**
 * 🔥 Genesis Ignition — reset the topology and trigger a synchronized outward
 * "breath" from the origin. Visually: everything snaps back to a fresh
 * configuration, then breathes outward dramatically for ~1.2 s before settling.
 *
 * Also clears any in-flight slash records — fresh ignition = fresh state.
 */
export function fireGenesisIgnition(): void {
  const net = useNetworkStore.getState();
  // Clear in-flight slash records first so the new topology starts pristine.
  useSlashStore.setState({ records: new Map() });
  net.reset();
  net.setActiveMilestone('genesis-ignition');
  net.setPulse({
    origin: [0, 0, 0],
    strength: 18,
    remaining: 1.2,
  });
  window.setTimeout(() => {
    if (useNetworkStore.getState().activeMilestone === 'genesis-ignition') {
      useNetworkStore.getState().setActiveMilestone(null);
    }
  }, 2000);
}

/**
 * 🌌 Causal Guard — telegraph the protocol's enforcement by slashing a
 * random rule-violator. Picks a routing or eco node (the "compute" and
 * "ecosystem" layers, which are where hallucinations typically originate).
 */
export function fireCausalGuard(): void {
  const net = useNetworkStore.getState();
  const slash = useSlashStore.getState();

  const candidates = net.nodes.filter(
    (n) =>
      n.health === 'healthy' &&
      (n.type === 'routing' || n.type === 'eco'),
  );
  const pool =
    candidates.length > 0
      ? candidates
      : net.nodes.filter((n) => n.health === 'healthy' && n.type !== 'genesis');
  if (pool.length === 0) return;

  const pick = pool[Math.floor(Math.random() * pool.length)];
  slash.enqueueSlash(pick.id);

  net.setActiveMilestone('causal-guard');
  window.setTimeout(() => {
    if (useNetworkStore.getState().activeMilestone === 'causal-guard') {
      useNetworkStore.getState().setActiveMilestone(null);
    }
  }, 2500);
}

/**
 * 🌿 Macro Evolution — represents the convergence of the ecosystem layer.
 * Spawns a small cluster of new Eco nodes at the periphery; they integrate
 * into the topology, demonstrating organic growth.
 */
export function fireMacroEvolution(): void {
  const net = useNetworkStore.getState();
  net.spawnEcoCluster(5);
  net.setActiveMilestone('macro-evolution');
  window.setTimeout(() => {
    if (useNetworkStore.getState().activeMilestone === 'macro-evolution') {
      useNetworkStore.getState().setActiveMilestone(null);
    }
  }, 2500);
}

/**
 * 🚨 Kill Switch — the presentation climax. Triggers a slash on a random
 * non-Genesis node.
 */
export function fireKillSwitch(): void {
  const net = useNetworkStore.getState();
  const slash = useSlashStore.getState();
  const candidates = net.nodes.filter(
    (n) => n.health === 'healthy' && n.type !== 'genesis',
  );
  if (candidates.length === 0) return;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  slash.enqueueSlash(pick.id);
}
