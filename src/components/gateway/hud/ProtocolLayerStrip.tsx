'use client';

import { motion } from 'framer-motion';
import { useMemo } from 'react';
import { useNetworkStore } from '@/src/store/networkStore';
import { NODE_TYPES, NODE_TYPE_LIST } from '@/src/lib/gateway/constants/nodeTypes';
import {
  enter,
  glassSurface,
  overline,
  numericLabel,
  primaryLabel,
  tertiaryLabel,
  stagger,
  item,
} from './design';
import { clsx } from 'clsx';

/** Map NodeType → its layer-name in the Life++ protocol vocabulary. */
const LAYER_NAMES: Record<string, { en: string; zh: string }> = {
  genesis:    { en: 'Cashflow',    zh: '现金流' },
  sentinel:   { en: 'Code Logic',  zh: '代码逻辑' },
  routing:    { en: 'Compute',     zh: '算力' },
  settlement: { en: 'Contract',    zh: '合约' },
  eco:        { en: 'Eco',         zh: '生态' },
};

export function ProtocolLayerStrip() {
  // Aggregate live counts per type. We DO subscribe to nodes here, but
  // structural changes (slash, evolution) are rare enough that this is fine.
  const nodes = useNetworkStore((s) => s.nodes);

  const counts = useMemo(() => {
    const c: Record<string, { total: number; healthy: number }> = {};
    for (const t of NODE_TYPE_LIST) c[t] = { total: 0, healthy: 0 };
    for (const n of nodes) {
      c[n.type].total++;
      if (n.health === 'healthy') c[n.type].healthy++;
    }
    return c;
  }, [nodes]);

  return (
    <motion.aside
      variants={enter}
      initial="hidden"
      animate="visible"
      transition={{ delay: 0.18 }}
      className="absolute bottom-8 left-8 z-20 pointer-events-auto"
    >
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="visible"
        className={clsx(glassSurface, 'px-5 py-4 min-w-[240px]')}
      >
        {/* Header. */}
        <div className="flex items-baseline justify-between mb-3">
          <span className={clsx(overline, 'tracking-[0.28em]')}>
            Protocol Layers
          </span>
          <span className={clsx(tertiaryLabel, 'tracking-[0.18em] uppercase')}>
            五层架构
          </span>
        </div>

        {/* One row per node type. */}
        <div className="flex flex-col gap-2.5">
          {NODE_TYPE_LIST.map((type) => {
            const cfg = NODE_TYPES[type];
            const layer = LAYER_NAMES[type];
            const hex = `#${cfg.color.toString(16).padStart(6, '0')}`;
            const ct = counts[type];
            return (
              <motion.div
                key={type}
                variants={item}
                className="flex items-center gap-3"
              >
                {/* Color dot with subtle halo. */}
                <span
                  aria-hidden
                  className="relative flex items-center justify-center w-2.5 h-2.5"
                >
                  <span
                    className="absolute inset-[-4px] rounded-full opacity-40 blur-[3px]"
                    style={{ background: hex }}
                  />
                  <span
                    className="relative w-2.5 h-2.5 rounded-full"
                    style={{
                      background: hex,
                      boxShadow: `0 0 8px 0 ${hex}99`,
                    }}
                  />
                </span>

                {/* Layer name. */}
                <div className="flex-1 flex items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-2">
                    <span className={clsx(primaryLabel, 'text-[12.5px]')}>
                      {layer.en}
                    </span>
                    <span className={clsx(tertiaryLabel)}>
                      {layer.zh}
                    </span>
                  </div>
                  <span className={clsx(numericLabel, 'text-[11px]')}>
                    {ct.healthy}
                    <span className="text-white/30">/{ct.total}</span>
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </motion.aside>
  );
}
