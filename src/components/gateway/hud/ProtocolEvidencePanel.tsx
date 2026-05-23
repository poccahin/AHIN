'use client';

/**
 * ProtocolEvidencePanel — top-right telemetry showing the cryptographic
 * heartbeat of the PoCC consensus layer.
 *
 * Three sections:
 *   1. PoCC Validation Anchor — a 64-char hex string that mutates with
 *      character-level animation (some chars cycle fast, most slow).
 *      Conveys "live rolling cryptographic root."
 *   2. Consensus Metrics — small grid of numerics (validation loops,
 *      verification latency, proof depth) that drift over time.
 *   3. Recent Evidence Stream — last few slash records with their pseudo-
 *      hashes and timestamps. Most-recent-first.
 *
 * Animation: panel slides in from x:50 → 0 on mount with framer-motion.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollText, Cpu, GitMerge } from 'lucide-react';
import { useSlashStore } from '@/src/store/slashStore';
import { rollingHexHash, makeProofHash, shortenHash } from '@/src/lib/gateway/hexHash';
import {
  glassSurface,
  overline,
  primaryLabel,
  secondaryLabel,
  tertiaryLabel,
  numericLabel,
} from './design';
import { clsx } from 'clsx';

/** Frame interval for the rolling-hash update (ms). 8 Hz feels live without burning CPU. */
const HASH_TICK_MS = 125;

interface EvidenceEntry {
  id: string;
  nodeId: string;
  hash: string;
  timestamp: Date;
}

/** Maximum evidence rows displayed. */
const MAX_EVIDENCE_ROWS = 5;

export function ProtocolEvidencePanel() {
  const [time, setTime] = useState(0);
  const [evidence, setEvidence] = useState<EvidenceEntry[]>([]);

  // Drive the rolling hash. We use a setInterval (not useFrame) because
  // this panel lives outside the Canvas and 60 Hz is overkill for text.
  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => {
      setTime((performance.now() - start) / 1000);
    }, HASH_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Track slash records: when a new one appears (records keyed by id), emit
  // an evidence entry. We diff the previous Set against the new one.
  const prevIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const unsubscribe = useSlashStore.subscribe((s) => {
      const ids = new Set(s.records.keys());
      const additions: string[] = [];
      for (const id of ids) {
        if (!prevIds.current.has(id)) additions.push(id);
      }
      prevIds.current = ids;

      if (additions.length > 0) {
        setEvidence((prev) => {
          const entries: EvidenceEntry[] = additions.map((nodeId) => ({
            id: `${nodeId}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
            nodeId,
            hash: makeProofHash(),
            timestamp: new Date(),
          }));
          // Newest first, capped to MAX_EVIDENCE_ROWS.
          return [...entries, ...prev].slice(0, MAX_EVIDENCE_ROWS);
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // Derive the displayed hash and metrics.
  const liveHash = rollingHexHash(time);
  const verificationLatency = 18 + Math.sin(time * 0.7) * 3.2 + Math.sin(time * 1.9) * 1.4;
  const validationLoops = 1142 + Math.floor(time * 11.3);
  const proofDepth = 7 + Math.floor((Math.sin(time * 0.3) + 1) * 1.2);

  return (
    <motion.aside
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.3, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-auto w-[300px]"
    >
      <div className={clsx(glassSurface, 'px-5 py-4')}>
        {/* Header. */}
        <div className="flex items-baseline justify-between mb-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-3 h-3 text-white/45" strokeWidth={1.7} />
            <span className={clsx(overline, 'tracking-[0.28em]')}>
              Protocol Evidence
            </span>
          </div>
          <span className={clsx(tertiaryLabel, 'tracking-[0.18em] uppercase')}>
            实证
          </span>
        </div>

        {/* Section 1: PoCC Validation Anchor. */}
        <section className="mb-4">
          <p className={clsx(secondaryLabel, 'mb-1.5')}>PoCC Validation Anchor</p>
          <div
            className={clsx(
              'font-mono text-[10.5px] leading-[1.55] break-all p-2.5 rounded-md',
              'bg-black/40 border border-white/[0.06]',
              'text-emerald-300/75',
            )}
            style={{
              wordBreak: 'break-all',
              letterSpacing: '0.05em',
            }}
          >
            {liveHash}
          </div>
        </section>

        {/* Section 2: Consensus Metrics. */}
        <section className="mb-4">
          <p className={clsx(secondaryLabel, 'mb-2')}>Consensus Metrics</p>
          <div className="grid grid-cols-3 gap-2">
            <Metric
              icon={<GitMerge className="w-3 h-3" strokeWidth={1.6} />}
              label="Loops"
              value={validationLoops.toLocaleString()}
            />
            <Metric
              icon={<span className="text-[10px] font-mono">τ</span>}
              label="Latency"
              value={`${verificationLatency.toFixed(1)}ms`}
            />
            <Metric
              icon={<span className="text-[10px] font-mono">d</span>}
              label="Depth"
              value={`${proofDepth}`}
            />
          </div>
        </section>

        {/* Section 3: Evidence Stream. */}
        <section>
          <div className="flex items-center gap-1.5 mb-2">
            <ScrollText className="w-3 h-3 text-white/45" strokeWidth={1.7} />
            <p className={clsx(secondaryLabel)}>Evidence Stream</p>
          </div>

          {evidence.length === 0 ? (
            <p className={clsx(tertiaryLabel, 'italic')}>
              Awaiting slash records…
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              <AnimatePresence initial={false}>
                {evidence.map((e) => (
                  <motion.li
                    key={e.id}
                    initial={{ opacity: 0, x: 10, height: 0 }}
                    animate={{ opacity: 1, x: 0, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className={clsx(
                      'flex items-baseline justify-between gap-2 px-2 py-1.5',
                      'rounded-md bg-red-950/20 border border-red-900/30',
                      'overflow-hidden',
                    )}
                  >
                    <div className="flex items-baseline gap-2 min-w-0 flex-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0 mt-0.5" />
                      <span className={clsx(tertiaryLabel, 'truncate tracking-tight text-white/60')}>
                        {e.nodeId}
                      </span>
                      <span
                        className={clsx(
                          'font-mono text-[9.5px] text-red-300/70 tracking-[0.04em] truncate',
                        )}
                      >
                        {shortenHash(e.hash, 5)}
                      </span>
                    </div>
                    <span className={clsx(tertiaryLabel, 'flex-shrink-0 tabular-nums')}>
                      {e.timestamp.toLocaleTimeString('en-US', {
                        hour12: false,
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>
      </div>
    </motion.aside>
  );
}

interface MetricProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function Metric({ icon, label, value }: MetricProps) {
  return (
    <div className="flex flex-col gap-1 p-2 rounded-md bg-white/[0.025] border border-white/[0.05]">
      <div className="flex items-center gap-1 text-white/40">
        {icon}
        <span className={clsx(tertiaryLabel, 'tracking-[0.12em] uppercase')}>
          {label}
        </span>
      </div>
      <span className={clsx(numericLabel, primaryLabel, 'text-[11.5px] font-medium')}>
        {value}
      </span>
    </div>
  );
}
