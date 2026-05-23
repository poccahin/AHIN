'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { useNetworkStore } from '@/src/store/networkStore';
import {
  enter,
  glassSurface,
  overline,
  numericLabel,
  tertiaryLabel,
} from './design';
import { clsx } from 'clsx';

const TRACK_WIDTH = 320; // px

/** Anchor labels along the timeline track. */
const ANCHORS = [
  { t: 0, label: 'Past', sublabel: '过去' },
  { t: 0.5, label: 'Present', sublabel: '现在' },
  { t: 1, label: 'Future', sublabel: '未来' },
] as const;

export function Timeline() {
  // Read the canonical timelineT. We're fine to subscribe — the user only
  // updates this with drag events, not 60 times/sec.
  const timelineT = useNetworkStore((s) => s.timelineT);
  const setTimelineT = useNetworkStore((s) => s.setTimelineT);

  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // Convert client X within the track to a [0..1] timeline value.
  const xToT = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return timelineT;
    const rect = track.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => setTimelineT(xToT(e.clientX));
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // xToT is stable across renders since it only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, setTimelineT]);

  // Derive the readable phase from timelineT.
  const phase =
    timelineT < 0.35 ? 'Pre-genesis Entropy'
    : timelineT < 0.65 ? 'Self-organising Network'
    : timelineT < 0.95 ? 'Stable Causal Field'
    : 'Convergence';

  return (
    <motion.div
      variants={enter}
      initial="hidden"
      animate="visible"
      transition={{ delay: 0.2 }}
      className={clsx(
        'absolute bottom-8 left-1/2 -translate-x-1/2 z-20',
        'pointer-events-auto',
      )}
    >
      <div className={clsx(glassSurface, 'px-6 py-5 flex flex-col items-center')}>
        {/* Header. */}
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-3 h-3 text-white/35" strokeWidth={1.7} />
          <span className={clsx(overline, 'tracking-[0.28em]')}>
            Temporal Evolution · 时间线
          </span>
        </div>

        {/* Track. */}
        <div
          ref={trackRef}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            setTimelineT(xToT(e.clientX));
            setDragging(true);
          }}
          className="relative cursor-pointer"
          style={{ width: TRACK_WIDTH, height: 28 }}
          role="slider"
          aria-label="Temporal evolution"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={timelineT}
        >
          {/* Track base. */}
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-white/15" />

          {/* Filled portion — past → handle. */}
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-px bg-gradient-to-r from-white/15 via-white/50 to-white/70"
            style={{ width: `${timelineT * 100}%` }}
          />

          {/* Anchor ticks. */}
          {ANCHORS.map((a) => (
            <div
              key={a.t}
              className="absolute top-1/2 -translate-y-1/2"
              style={{ left: `${a.t * 100}%`, transform: 'translate(-50%, -50%)' }}
            >
              <div className="w-px h-2 bg-white/30" />
            </div>
          ))}

          {/* Handle. */}
          <motion.div
            className="absolute top-1/2 -translate-y-1/2"
            style={{
              left: `calc(${timelineT * 100}% - 8px)`,
              width: 16,
              height: 16,
            }}
            animate={{ scale: dragging ? 1.15 : 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
          >
            <div className="relative w-full h-full">
              <div className="absolute inset-0 rounded-full bg-white/90 shadow-[0_0_12px_2px_rgba(255,255,255,0.25)]" />
              <div className="absolute inset-[3px] rounded-full bg-black/85" />
              <div className="absolute inset-[5px] rounded-full bg-white/70" />
            </div>
          </motion.div>
        </div>

        {/* Anchor labels under track. */}
        <div className="relative mt-2" style={{ width: TRACK_WIDTH }}>
          {ANCHORS.map((a) => (
            <div
              key={a.t}
              className="absolute flex flex-col items-center"
              style={{ left: `${a.t * 100}%`, transform: 'translateX(-50%)' }}
            >
              <span className={clsx(tertiaryLabel, 'tracking-[0.18em] uppercase')}>
                {a.label}
              </span>
              <span className={clsx(tertiaryLabel, 'mt-0.5 opacity-60')}>
                {a.sublabel}
              </span>
            </div>
          ))}
        </div>

        {/* Live phase + numeric readout. */}
        <div className="mt-9 flex items-center gap-4">
          <span className={clsx(overline, 'tracking-[0.22em]')}>{phase}</span>
          <span className="w-px h-3 bg-white/15" />
          <span className={clsx(numericLabel, 'text-[11px] text-white/55')}>
            T = {timelineT.toFixed(2)}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
