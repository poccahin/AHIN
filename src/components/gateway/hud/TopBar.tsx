'use client';

import { motion } from 'framer-motion';
import { LayoutGrid, ShieldCheck, Coins, Bot } from 'lucide-react';
import { enter, glassSurfaceTight, secondaryLabel } from './design';
import { clsx } from 'clsx';

const NAV_ITEMS = [
  { label: 'Gate', icon: LayoutGrid, active: true },
  { label: 'Governance', icon: ShieldCheck, active: false },
  { label: 'Treasury', icon: Coins, active: false },
  { label: 'Agents', icon: Bot, active: false },
] as const;

export function TopBar() {
  return (
    <motion.header
      variants={enter}
      initial="hidden"
      animate="visible"
      className="absolute top-0 inset-x-0 z-30 pointer-events-none"
    >
      <div className="flex items-center justify-between px-8 py-6">
        {/* Left: logo. */}
        <div className="flex items-center gap-3 pointer-events-auto">
          {/* Tri-color gem mark — the visual handle for the gateway. */}
          <div className="relative w-8 h-8">
            <div className="absolute inset-0 rounded-md bg-gradient-to-br from-[#FF5722] via-[#9C27B0] to-[#03A9F4] opacity-90" />
            <div className="absolute inset-[3px] rounded-[3px] bg-black/60 backdrop-blur-sm" />
            <div className="absolute inset-[3px] rounded-[3px] bg-gradient-to-tr from-transparent via-white/10 to-white/30" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-white text-[18px] font-light tracking-[0.04em]">
              ahin
            </span>
            <span className="text-white/40 text-[18px] font-light">.</span>
            <span className="text-white/55 text-[18px] font-light tracking-tight">
              io
            </span>
          </div>
        </div>

        {/* Right: nav rail. */}
        <nav
          className={clsx(
            glassSurfaceTight,
            'pointer-events-auto px-2 py-1.5 flex items-center gap-1',
          )}
          aria-label="Primary"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                className={clsx(
                  'group relative flex items-center gap-2 px-3.5 py-1.5 rounded-full',
                  'transition-colors duration-200',
                  item.active
                    ? 'bg-white/[0.07] text-white/95'
                    : 'text-white/55 hover:text-white/85 hover:bg-white/[0.04]',
                )}
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={1.6} />
                <span className={clsx(secondaryLabel, 'text-current')}>
                  {item.label}
                </span>
                {item.active && (
                  <span
                    aria-hidden
                    className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 h-px w-6 bg-white/40 rounded-full"
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </motion.header>
  );
}
