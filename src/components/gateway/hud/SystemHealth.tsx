'use client';

/**
 * SystemHealth — middle-right telemetry panel showing live infrastructure
 * state.
 *
 * Two sections:
 *   1. Active Agent Core Subsystems — per-type uptime indicators (a small
 *      animated bar chart) for the 5 node families.
 *   2. Infrastructure — compute uptime, memory overhead, $LIFE++ treasury
 *      live allocation. Values drift smoothly to feel live.
 *
 * Slides in from x:50 → 0 with a slight delay after ProtocolEvidencePanel
 * so the right column reveals top-to-bottom.
 */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, Database, Wallet } from 'lucide-react';
import { useNetworkStore } from '@/src/store/networkStore';
import { NODE_TYPES, NODE_TYPE_LIST } from '@/src/lib/gateway/constants/nodeTypes';
import type { NodeType } from '@/src/types/gateway';
import {
  glassSurface,
  overline,
  primaryLabel,
  secondaryLabel,
  tertiaryLabel,
  numericLabel,
} from './design';
import { clsx } from 'clsx';

/** Bilingual labels for the agent subsystems. */
const AGENT_LABELS: Record<NodeType, { name: string; zh: string }> = {
  genesis:    { name: 'Catalyst',   zh: '催化' },
  sentinel:   { name: 'Sentinel',   zh: '哨兵' },
  routing:    { name: 'Routing',    zh: '路由' },
  settlement: { name: 'Settlement', zh: '结算' },
  eco:        { name: 'Eco',        zh: '生态' },
};

export function SystemHealth() {
  const nodes = useNetworkStore((s) => s.nodes);
  const [tick, setTick] = useState(0);

  // Soft drift driver — tick at 4 Hz to animate numerics smoothly without
  // burning a useFrame.
  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => {
      setTick((performance.now() - start) / 1000);
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  // Aggregate per-type counts.
  const counts = useMemo(() => {
    const c: Record<NodeType, { healthy: number; total: number }> = {} as Record<
      NodeType,
      { healthy: number; total: number }
    >;
    for (const t of NODE_TYPE_LIST) c[t] = { healthy: 0, total: 0 };
    for (const n of nodes) {
      c[n.type].total++;
      if (n.health === 'healthy') c[n.type].healthy++;
    }
    return c;
  }, [nodes]);

  // Drifting infrastructure numerics — anchored to defaults, oscillating gently.
  const uptime = 99.94 + Math.sin(tick * 0.21) * 0.04 + Math.sin(tick * 0.61) * 0.02;
  const memoryMB = 482 + Math.sin(tick * 0.4) * 24 + Math.sin(tick * 1.3) * 9;
  const treasuryAlloc = 1280453 + Math.floor(tick * 17.3);

  return (
    <motion.aside
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.42, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-auto w-[300px]"
    >
      <div className={clsx(glassSurface, 'px-5 py-4')}>
        {/* Header. */}
        <div className="flex items-baseline justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-3 h-3 text-white/45" strokeWidth={1.7} />
            <span className={clsx(overline, 'tracking-[0.28em]')}>
              System Health
            </span>
          </div>
          <span className={clsx(tertiaryLabel, 'tracking-[0.18em] uppercase')}>
            状态
          </span>
        </div>

        {/* Section 1: Agent Core Subsystems. */}
        <section className="mb-4">
          <p className={clsx(secondaryLabel, 'mb-2.5')}>
            Active Agent Core Subsystems
          </p>
          <div className="flex flex-col gap-2">
            {NODE_TYPE_LIST.map((type) => {
              const cfg = NODE_TYPES[type];
              const ct = counts[type];
              const label = AGENT_LABELS[type];
              const hex = `#${cfg.color.toString(16).padStart(6, '0')}`;
              // Pseudo-load: jittery 0..1 driven by tick + node count.
              const load = Math.min(
                1,
                0.32 +
                  ct.healthy * 0.05 +
                  Math.sin(tick * 1.7 + type.length) * 0.12,
              );
              return (
                <div key={type} className="flex items-center gap-2.5">
                  {/* Color dot. */}
                  <span
                    aria-hidden
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{
                      background: hex,
                      boxShadow: `0 0 6px 0 ${hex}99`,
                    }}
                  />
                  {/* Label */}
                  <span
                    className={clsx(tertiaryLabel, 'w-[68px] flex-shrink-0 text-white/55')}
                  >
                    {label.name}
                  </span>
                  {/* Bar */}
                  <div className="flex-1 h-1 bg-white/[0.05] rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{
                        background: hex,
                        boxShadow: `0 0 6px 0 ${hex}88`,
                      }}
                      animate={{ width: `${load * 100}%` }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                    />
                  </div>
                  {/* Live count */}
                  <span
                    className={clsx(numericLabel, 'text-[10.5px] w-9 text-right')}
                  >
                    {ct.healthy}
                    <span className="text-white/30">/{ct.total}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Divider. */}
        <div className="h-px bg-white/[0.06] my-3" />

        {/* Section 2: Infrastructure. */}
        <section>
          <p className={clsx(secondaryLabel, 'mb-2')}>Infrastructure</p>
          <ul className="flex flex-col gap-2">
            <Row
              icon={<Activity className="w-3 h-3" strokeWidth={1.6} />}
              label="Compute Uptime"
              labelZh="算力可用率"
              value={`${uptime.toFixed(2)}%`}
              tone="positive"
            />
            <Row
              icon={<Database className="w-3 h-3" strokeWidth={1.6} />}
              label="Memory Overhead"
              labelZh="内存开销"
              value={`${memoryMB.toFixed(0)} MB`}
              tone="neutral"
            />
            <Row
              icon={<Wallet className="w-3 h-3" strokeWidth={1.6} />}
              label="Treasury Allocation"
              labelZh="国库分配"
              value={`$LIFE++ ${treasuryAlloc.toLocaleString()}`}
              tone="accent"
            />
          </ul>
        </section>
      </div>
    </motion.aside>
  );
}

interface RowProps {
  icon: React.ReactNode;
  label: string;
  labelZh: string;
  value: string;
  tone: 'positive' | 'neutral' | 'accent';
}

function Row({ icon, label, labelZh, value, tone }: RowProps) {
  const valueColor =
    tone === 'positive'
      ? 'text-emerald-300/85'
      : tone === 'accent'
      ? 'text-amber-200/85'
      : 'text-white/85';
  return (
    <li className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-white/40">{icon}</span>
        <div className="flex flex-col leading-tight min-w-0">
          <span className={clsx(primaryLabel, 'text-[11.5px] truncate')}>
            {label}
          </span>
          <span className={clsx(tertiaryLabel, 'truncate')}>{labelZh}</span>
        </div>
      </div>
      <span
        className={clsx(
          'font-mono text-[11px] tabular-nums tracking-tight whitespace-nowrap',
          valueColor,
        )}
      >
        {value}
      </span>
    </li>
  );
}
