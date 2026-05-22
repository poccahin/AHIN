"use client";

import type { CSSProperties } from "react";
import { useSlashStore } from "@/src/lib/active-hash/state/slashStore";
import { AshBurst } from "./AshBurst";
import { ShatteringNode } from "./ShatteringNode";

interface SlashingSequenceProps {
  frame: number;
}

function projectedPosition(position: [number, number, number]) {
  return {
    x: position[0] * 24,
    y: position[1] * -18 + position[2] * 1.8
  };
}

export function SlashingSequence({ frame }: SlashingSequenceProps) {
  const records = useSlashStore((state) => state.records);

  return (
    <div className="active-hash-slashing-layer" aria-live="polite">
      {[...records.values()].map((record) => {
        const projected = projectedPosition(record.position);
        if (record.phase === "DETECTION") {
          return (
            <div
              key={`${record.id}-detection`}
              className="active-hash-slash-marker is-detection"
              style={
                {
                  "--slash-x": `${projected.x}px`,
                  "--slash-y": `${projected.y}px`
                } as CSSProperties
              }
            >
              PoCC violation detected · simulation only
            </div>
          );
        }
        if (record.phase === "COLLAPSE") {
          return (
            <div key={`${record.id}-collapse`}>
              <ShatteringNode record={record} frame={frame} />
              <AshBurst record={record} />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
