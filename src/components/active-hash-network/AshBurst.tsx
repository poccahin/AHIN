"use client";

import type { CSSProperties } from "react";
import type { SlashRecord } from "@/src/lib/active-hash/state/slashStore";

interface AshBurstProps {
  record: SlashRecord;
}

function projectedPosition(record: SlashRecord) {
  return {
    x: record.position[0] * 24,
    y: record.position[1] * -18 + record.position[2] * 1.8
  };
}

export function AshBurst({ record }: AshBurstProps) {
  const projected = projectedPosition(record);
  return (
    <div
      className="active-hash-ash-burst"
      style={
        {
          "--ash-x": `${projected.x}px`,
          "--ash-y": `${projected.y}px`
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {Array.from({ length: 44 }, (_, index) => {
        const angle = record.seed * 360 + index * 31;
        const radians = (angle * Math.PI) / 180;
        const distance = 38 + (index % 9) * 9;
        const lift = 12 + (index % 6) * 11;
        return (
          <span
            key={`${record.id}-ash-${index}`}
            className="active-hash-ash-chip"
            style={
              {
                "--ash-tx": `${Math.cos(radians) * distance}px`,
                "--ash-ty": `${Math.sin(radians) * distance * 0.62 - lift}px`,
                "--ash-delay": `${(index % 13) * 18}ms`,
                "--ash-rot": `${angle.toFixed(1)}deg`
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
