"use client";

import { AnimatePresence, motion } from "framer-motion";
import { type CSSProperties, useMemo, useState } from "react";
import AgentInfoCard from "./AgentInfoCard";
import type { AgentElementId, ElementSpec } from "./element-specs";
import {
  agentEntityVariants,
  agentHoverAnimation,
  agentIdleAnimation,
  agentIdleTransition,
  agentTapAnimation
} from "./motion";

interface AgentVoxelEntityProps {
  agent: ElementSpec;
  selected: boolean;
  onSelect: (id: AgentElementId) => void;
  className?: string;
}

interface AgentParticleStyle extends CSSProperties {
  "--particle-x": string;
  "--particle-y": string;
  "--particle-delay": string;
  "--particle-duration": string;
  "--particle-size": string;
}

function makeParticles(agentId: AgentElementId): AgentParticleStyle[] {
  const seedMap: Record<AgentElementId, number> = {
    "genesis-orange": 7,
    "rule-purple": 17,
    "compute-blue": 29,
    "contract-gold": 41,
    "eco-green": 53
  };
  const seed = seedMap[agentId];
  return Array.from({ length: 13 }, (_, index) => {
    const x = 14 + ((seed + index * 19) % 72);
    const y = 12 + ((seed * 3 + index * 23) % 74);
    return {
      "--particle-x": `${x}%`,
      "--particle-y": `${y}%`,
      "--particle-delay": `${((seed + index * 5) % 20) / 10}s`,
      "--particle-duration": `${3.8 + ((seed + index * 7) % 28) / 10}s`,
      "--particle-size": `${2 + ((seed + index) % 4)}px`
    };
  });
}

function VoxelSkullFallback({ agent }: { agent: ElementSpec }) {
  return (
    <div className="voxel-skull-fallback" style={{ color: agent.color }} aria-hidden="true">
      {Array.from({ length: 64 }, (_, index) => {
        const row = Math.floor(index / 8);
        const col = index % 8;
        const active =
          (row === 0 && col >= 2 && col <= 5) ||
          (row === 1 && col >= 1 && col <= 6) ||
          (row === 2 && col >= 0 && col <= 7) ||
          (row === 3 && (col <= 2 || col >= 5)) ||
          (row === 4 && col >= 1 && col <= 6) ||
          (row === 5 && (col === 2 || col === 3 || col === 4 || col === 5)) ||
          (row === 6 && (col === 1 || col === 3 || col === 4 || col === 6)) ||
          (row === 7 && col >= 2 && col <= 5);
        return <span key={index} className={active ? "is-lit" : ""} />;
      })}
    </div>
  );
}

export default function AgentVoxelEntity({ agent, selected, onSelect, className = "" }: AgentVoxelEntityProps) {
  const [imageIndex, setImageIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const showImage = !imageFailed && agent.imageCandidates[imageIndex];
  const Icon = agent.Icon;
  const showInfo = hovered;
  const particles = useMemo(() => makeParticles(agent.id), [agent.id]);

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
      className={`agent-entity ${agent.glowClass} ${selected ? "is-selected" : ""} ${className}`}
      variants={agentEntityVariants}
      onClick={() => onSelect(agent.id)}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileHover={agentHoverAnimation}
      whileTap={agentTapAnimation}
      aria-label={`${agent.chineseName} ${agent.englishName}`}
    >
      <span className="agent-volume-halo" aria-hidden="true" />
      <motion.span className="agent-entity-motion" animate={agentIdleAnimation} transition={agentIdleTransition}>
        <span className="agent-aura" aria-hidden="true" />
        <span className="agent-color-fog" aria-hidden="true" />
        <span className="agent-particle-field" aria-hidden="true">
          {particles.map((style, index) => (
            <span key={index} className="agent-element-particle" style={style} />
          ))}
        </span>
        <span className="agent-icon-plate">
          <span className="agent-inner-glass" aria-hidden="true" />
          {showImage ? (
            <img
              src={agent.imageCandidates[imageIndex]}
              alt=""
              className="agent-pixel-image"
              draggable={false}
              onError={handleImageError}
            />
          ) : (
            <VoxelSkullFallback agent={agent} />
          )}
          <span className="agent-front-highlight" aria-hidden="true" />
        </span>
        <span className="agent-mini-label">
          <Icon aria-hidden={true} className="h-3.5 w-3.5" />
          {agent.chineseName}
        </span>
      </motion.span>
      <AnimatePresence>{showInfo ? <AgentInfoCard agent={agent} compact /> : null}</AnimatePresence>
    </motion.button>
  );
}
