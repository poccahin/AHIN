"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
  opacity: number;
}

function seededParticle(index: number): Particle {
  const x = (index * 47 + 13) % 100;
  const y = (index * 71 + 19) % 100;
  return {
    id: index,
    x,
    y,
    size: 1 + ((index * 11) % 4),
    delay: ((index * 17) % 30) / 10,
    duration: 7 + ((index * 13) % 70) / 10,
    opacity: 0.18 + (((index * 7) % 28) / 100)
  };
}

export default function AmbientParticles() {
  const particles = useMemo(() => Array.from({ length: 54 }, (_, index) => seededParticle(index)), []);

  return (
    <div className="ambient-particles" aria-hidden="true">
      {particles.map((particle) => (
        <motion.span
          key={particle.id}
          className="ambient-particle"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            width: particle.size,
            height: particle.size
          }}
          animate={{
            y: [0, -18, 0],
            x: [0, particle.id % 2 === 0 ? 8 : -8, 0],
            opacity: [particle.opacity * 0.35, particle.opacity, particle.opacity * 0.35]
          }}
          transition={{
            duration: particle.duration,
            delay: particle.delay,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
      ))}
    </div>
  );
}
