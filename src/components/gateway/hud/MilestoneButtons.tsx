'use client';

import { motion } from 'framer-motion';
import { Flame, ShieldAlert, Sprout } from 'lucide-react';
import { useNetworkStore } from '@/src/store/networkStore';
import {
  fireGenesisIgnition,
  fireCausalGuard,
  fireMacroEvolution,
} from '@/src/lib/gateway/milestoneActions';
import type { MilestoneId } from '@/src/types/gateway';
import {
  enter,
  glassSurface,
  overline,
  primaryLabel,
  buttonHover,
} from './design';
import { clsx } from 'clsx';

interface MilestoneDef {
  id: MilestoneId;
  label: string;
  labelZh: string;
  icon: typeof Flame;
  /** Hex color used for the soft halo and active-state ring. */
  accent: string;
  fire: () => void;
}

const MILESTONES: MilestoneDef[] = [
  {
    id: 'genesis-ignition',
    label: 'Genesis Ignition',
    labelZh: '创世点火',
    icon: Flame,
    accent: '#FF5722',
    fire: fireGenesisIgnition,
  },
  {
    id: 'causal-guard',
    label: 'Causal Guard',
    labelZh: '因果规制',
    icon: ShieldAlert,
    accent: '#9C27B0',
    fire: fireCausalGuard,
  },
  {
    id: 'macro-evolution',
    label: 'Macro Evolution',
    labelZh: '生态收敛',
    icon: Sprout,
    accent: '#8BC34A',
    fire: fireMacroEvolution,
  },
];

export function MilestoneButtons() {
  // Subscribe only to activeMilestone; ignore everything else for performance.
  const active = useNetworkStore((s) => s.activeMilestone);

  return (
    <motion.div
      variants={enter}
      initial="hidden"
      animate="visible"
      transition={{ delay: 0.1 }}
      className={clsx(
        'absolute top-24 left-1/2 -translate-x-1/2 z-20',
        'pointer-events-auto',
      )}
    >
      <div
        className={clsx(
          glassSurface,
          'flex items-stretch gap-0 p-1.5 rounded-2xl',
        )}
      >
        {MILESTONES.map((m, idx) => {
          const Icon = m.icon;
          const isActive = active === m.id;
          return (
            <motion.button
              key={m.id}
              type="button"
              onClick={m.fire}
              {...buttonHover}
              className={clsx(
                'group relative flex items-center gap-3 px-4 py-2.5 rounded-xl',
                'transition-colors duration-200',
                isActive
                  ? 'bg-white/[0.08]'
                  : 'hover:bg-white/[0.05]',
                idx > 0 && 'ml-0.5',
              )}
              style={{
                // Soft per-button accent halo on hover (and full when active).
                boxShadow: isActive
                  ? `inset 0 0 0 1px ${m.accent}55, 0 0 24px -4px ${m.accent}66`
                  : undefined,
              }}
            >
              {/* Color dot. */}
              <span
                aria-hidden
                className="relative flex items-center justify-center w-7 h-7 rounded-lg"
                style={{
                  background: `radial-gradient(circle at 30% 30%, ${m.accent}33, ${m.accent}0a 70%)`,
                  border: `1px solid ${m.accent}55`,
                }}
              >
                <Icon
                  className="w-3.5 h-3.5"
                  strokeWidth={1.8}
                  style={{ color: m.accent }}
                />
              </span>

              {/* Bilingual label stack. */}
              <span className="flex flex-col items-start leading-tight">
                <span className={clsx(primaryLabel, 'font-medium')}>
                  {m.label}
                </span>
                <span className={clsx(overline, 'mt-0.5')}>
                  {m.labelZh}
                </span>
              </span>
            </motion.button>
          );
        })}
      </div>

      {/* Section overline below the pill. */}
      <p
        className={clsx(
          overline,
          'mt-3 text-center tracking-[0.32em]',
        )}
      >
        Milestone Presets · 里程碑
      </p>
    </motion.div>
  );
}
