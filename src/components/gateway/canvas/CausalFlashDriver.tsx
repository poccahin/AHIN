'use client';

/**
 * CausalFlashDriver — emits CausalFlash flares at a steady rate on random
 * healthy links, simulating a stream of successful PoCC consensus events.
 *
 * Tuning:
 *   - FLASH_RATE_HZ: target flashes per second (across all links).
 *   - We pick a random healthy non-errored link each tick; if there are
 *     no eligible links, the tick is skipped.
 *
 * The flash spawns at the link's MIDPOINT, tinted in a soft amber/gold
 * for the "consensus confirmed" feel.
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useNetworkStore } from '@/src/store/networkStore';
import { triggerCausalFlash } from './CausalFlash';

/** Target rate (flashes/second) of successful consensus events. */
const FLASH_RATE_HZ = 2.2;

export function CausalFlashDriver() {
  const debt = useRef(0);

  useFrame((_, dt) => {
    debt.current += dt * FLASH_RATE_HZ;
    if (debt.current < 1) return;

    const store = useNetworkStore.getState();
    const { nodes, links } = store;
    if (links.length === 0) return;

    // Eligible: not errored, both endpoints healthy.
    const nodeMap = new Map<string, (typeof nodes)[number]>();
    for (const n of nodes) nodeMap.set(n.id, n);

    const eligible: Array<{ src: typeof nodes[number]; tgt: typeof nodes[number] }> = [];
    for (const link of links) {
      if (link.errored) continue;
      const a = nodeMap.get(link.sourceId);
      const b = nodeMap.get(link.targetId);
      if (!a || !b) continue;
      if (a.health !== 'healthy' || b.health !== 'healthy') continue;
      eligible.push({ src: a, tgt: b });
    }

    // Fire up to floor(debt) flashes this frame.
    const toFire = Math.floor(debt.current);
    debt.current -= toFire;
    for (let i = 0; i < toFire; i++) {
      if (eligible.length === 0) break;
      const pair = eligible[Math.floor(Math.random() * eligible.length)];
      // Midpoint with tiny jitter.
      const mx = (pair.src.position[0] + pair.tgt.position[0]) * 0.5;
      const my = (pair.src.position[1] + pair.tgt.position[1]) * 0.5;
      const mz = (pair.src.position[2] + pair.tgt.position[2]) * 0.5;
      triggerCausalFlash(
        [mx, my, mz],
        // Warm amber/gold core — reads as "consensus confirmed."
        [1.0, 0.78, 0.42],
      );
    }
  });

  return null;
}
