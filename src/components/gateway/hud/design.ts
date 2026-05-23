'use client';

/**
 * HUD design tokens — the single source of truth for surface styling,
 * typography, and motion in the Boardroom Premium HUD.
 *
 * Centralizing here so every panel feels like part of one design system,
 * not a collection of one-off Tailwind strings. Edit here, propagate
 * everywhere.
 */

import { clsx } from 'clsx';
import type { Variants } from 'framer-motion';

/**
 * The base glass surface. Use on every HUD panel.
 * - `bg-black/40`            warm dark backdrop tint
 * - `backdrop-blur-md`       8px gaussian blur over the canvas below
 * - `border border-white/10` 1px ghost border
 * - `rounded-2xl`            soft pill-shaped corners
 * - `shadow-[...]`           subtle inner-glow keeps panels readable on bright pixels
 */
export const glassSurface = clsx(
  'bg-black/40 backdrop-blur-md',
  'border border-white/[0.08]',
  'rounded-2xl',
  'shadow-[0_8px_32px_-8px_rgba(0,0,0,0.6),inset_0_1px_0_0_rgba(255,255,255,0.04)]',
);

/** A slightly tighter variant for compact controls (buttons inside a pill rail). */
export const glassSurfaceTight = clsx(
  'bg-black/45 backdrop-blur-md',
  'border border-white/[0.08]',
  'rounded-full',
  'shadow-[0_4px_16px_-4px_rgba(0,0,0,0.5)]',
);

/** Section overline — small ALL-CAPS label, used for panel headers. */
export const overline = clsx(
  'text-[10px] tracking-[0.22em] uppercase font-medium',
  'text-white/40',
);

/** Primary label — readable body copy on glass. */
export const primaryLabel = 'text-sm text-white/85';
export const secondaryLabel = 'text-xs text-white/55';
export const tertiaryLabel = 'text-[11px] text-white/30';

/** Mono-feeling text for stats/numerics — tabular-nums keeps them aligned. */
export const numericLabel = 'tabular-nums tracking-tight text-white/80';

// --------- Framer Motion presets ---------

/**
 * The "ahin entrance" — soft fade-up with a subtle scale-in. Used for
 * top-level HUD panels on first mount.
 */
export const enter: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.985 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
  },
};

/**
 * Stagger container — apply to a parent so its <motion.> children reveal
 * in sequence with a small delay between each.
 */
export const stagger: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.15,
    },
  },
};

/** Subtle entrance for individual items inside a staggered container. */
export const item: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
};

/** Hover/tap micro-feedback for buttons. */
export const buttonHover = {
  whileHover: { scale: 1.03, y: -1 },
  whileTap: { scale: 0.97, y: 0 },
  transition: { type: 'spring' as const, stiffness: 380, damping: 25 },
};
