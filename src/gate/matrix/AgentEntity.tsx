"use client";

import { motion } from "framer-motion";
import { type CSSProperties, useMemo, useState } from "react";
import type { MatrixAgent, MatrixAgentId } from "./matrix-elements";
import { agentHoverAnimation, agentIdleAnimation, agentIdleTransition, agentVariants } from "./matrix-motion";

interface AgentEntityProps {
  agent: MatrixAgent;
  selected: boolean;
  onSelect: (id: MatrixAgentId) => void;
}

interface ParticleStyle extends CSSProperties {
  "--particle-x": string;
  "--particle-y": string;
  "--particle-delay": string;
  "--particle-duration": string;
  "--particle-size": string;
}

const SEEDS: Record<MatrixAgentId, number> = {
  "genesis-orange": 7,
  "rule-purple": 17,
  "compute-blue": 29,
  "contract-gold": 41,
  "eco-green": 53
};

function makeParticles(agentId: MatrixAgentId): ParticleStyle[] {
  const seed = SEEDS[agentId];
  return Array.from({ length: 16 }, (_, index) => ({
    "--particle-x": `${12 + ((seed + index * 19) % 76)}%`,
    "--particle-y": `${10 + ((seed * 3 + index * 23) % 78)}%`,
    "--particle-delay": `${((seed + index * 5) % 20) / 10}s`,
    "--particle-duration": `${3.8 + ((seed + index * 7) % 28) / 10}s`,
    "--particle-size": `${2 + ((seed + index) % 4)}px`
  }));
}

function VoxelSkullFallback({ agent }: { agent: MatrixAgent }) {
  return (
    <div className="matrix4f-voxel-fallback" style={{ color: agent.color }} aria-hidden="true">
      {Array.from({ length: 64 }, (_, index) => {
        const row = Math.floor(index / 8);
        const col = index % 8;
        const active =
          (row === 0 && col >= 2 && col <= 5) ||
          (row === 1 && col >= 1 && col <= 6) ||
          (row === 2 && col >= 0 && col <= 7) ||
          (row === 3 && (col <= 2 || col >= 5)) ||
          (row === 4 && col >= 1 && col <= 6) ||
          (row === 5 && col >= 2 && col <= 5) ||
          (row === 6 && (col === 1 || col === 3 || col === 4 || col === 6)) ||
          (row === 7 && col >= 2 && col <= 5);
        return <span key={index} className={active ? "is-lit" : ""} />;
      })}
    </div>
  );
}

export default function AgentEntity({ agent, selected, onSelect }: AgentEntityProps) {
  const [imageIndex, setImageIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const particles = useMemo(() => makeParticles(agent.id), [agent.id]);
  const showImage = !imageFailed && agent.imageCandidates[imageIndex];
  const Icon = agent.Icon;

  function handleImageError() {
    const nextIndex = imageIndex + 1;
    if (nextIndex < agent.imageCandidates.length) {
      setImageIndex(nextIndex);
    } else {
      setImageFailed(true);
    }
  }

  return (
    <motion.button
      type="button"
      className={`matrix4f-agent ${agent.glowClass} ${agent.slotClass} ${selected ? "is-selected" : ""}`}
      style={{ "--agent-color": agent.color } as CSSProperties}
      variants={agentVariants}
      onClick={() => onSelect(agent.id)}
      onFocus={() => onSelect(agent.id)}
      onHoverStart={() => onSelect(agent.id)}
      whileHover={agentHoverAnimation}
      aria-label={`${agent.cnName} ${agent.enName} ${agent.lastAction}`}
    >
      <span className="matrix4f-agent-halo" aria-hidden="true" />
      <motion.span className="matrix4f-agent-body" animate={agentIdleAnimation} transition={agentIdleTransition}>
        <span className="matrix4f-agent-aura" aria-hidden="true" />
        <span className="matrix4f-particles" aria-hidden="true">
          {particles.map((style, index) => (
            <span key={index} className="matrix4f-particle" style={style} />
          ))}
        </span>
        <span className="matrix4f-capsule">
          <span className="matrix4f-capsule-glass" aria-hidden="true" />
          {showImage ? (
            <img src={agent.imageCandidates[imageIndex]} alt="" draggable={false} onError={handleImageError} />
          ) : (
            <VoxelSkullFallback agent={agent} />
          )}
          <span className="matrix4f-capsule-highlight" aria-hidden="true" />
        </span>
        <span className="matrix4f-agent-label">
          <Icon className="h-3.5 w-3.5" aria-hidden={true} />
          <span>{agent.cnName}</span>
        </span>
        <span className="matrix4f-agent-action">{agent.lastAction}</span>
      </motion.span>
    </motion.button>
  );
}
