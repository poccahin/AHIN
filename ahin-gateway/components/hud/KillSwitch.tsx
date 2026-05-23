'use client';

import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { fireKillSwitch } from '@/lib/milestoneActions';
import { useSlashStore } from '@/lib/state/slashStore';
import { enter, glassSurface, overline, primaryLabel } from './design';
import { clsx } from 'clsx';

export function KillSwitch() {
  // Show a live count of active slash records, gives the button context.
  const activeCount = useSlashStore((s) => s.records.size);

  return (
    <motion.div
      variants={enter}
      initial="hidden"
      animate="visible"
      transition={{ delay: 0.25 }}
      className="absolute bottom-8 right-8 z-20 pointer-events-auto"
    >
      <motion.button
        type="button"
        onClick={fireKillSwitch}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 350, damping: 22 }}
        className={clsx(
          glassSurface,
          'group relative overflow-hidden',
          'pl-4 pr-5 py-3.5 flex items-center gap-3',
          'border-red-900/50 hover:border-red-700/70',
          'transition-colors duration-300',
        )}
        style={{
          boxShadow:
            '0 0 0 1px rgba(190, 30, 50, 0.18), 0 0 32px -8px rgba(255, 30, 50, 0.32)',
        }}
      >
        {/* Pulsing red dot — the "armed" indicator. */}
        <span className="relative flex items-center justify-center w-9 h-9">
          <span className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />
          <span className="relative w-3 h-3 rounded-full bg-red-500 shadow-[0_0_12px_2px_rgba(255,40,60,0.6)]" />
        </span>

        {/* Label block. */}
        <span className="flex flex-col items-start leading-tight">
          <span
            className={clsx(
              primaryLabel,
              'font-medium text-white/85 group-hover:text-red-300 transition-colors duration-300',
            )}
          >
            <Zap
              className="inline-block w-3.5 h-3.5 mr-1 -mt-0.5"
              strokeWidth={2}
            />
            PoCC Slashing
          </span>
          <span className={clsx(overline, 'mt-1 text-red-400/60')}>
            罚没干预 · {activeCount > 0 ? `${activeCount} ACTIVE` : 'ARMED'}
          </span>
        </span>

        {/* Hover-only sweep highlight. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
          style={{
            background:
              'linear-gradient(110deg, transparent 30%, rgba(255,60,80,0.08) 50%, transparent 70%)',
          }}
        />
      </motion.button>
    </motion.div>
  );
}
