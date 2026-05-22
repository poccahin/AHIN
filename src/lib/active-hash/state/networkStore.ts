"use client";

import { create } from "zustand";
import { NODE_TYPES, NODE_TYPE_LIST, WORLD_RADIUS } from "../constants/nodeTypes";
import type { AhinLink, AhinNode, MilestoneId, NodeHealth, NodeType } from "../types/network";

interface NetworkState {
  nodes: AhinNode[];
  links: AhinLink[];
  timelineT: number;
  activeMilestone: MilestoneId | null;
  setTimelineT: (timelineT: number) => void;
  setActiveMilestone: (milestone: MilestoneId | null) => void;
  initializeNodes: () => void;
  addLink: (link: AhinLink) => void;
  removeLink: (id: string) => void;
  setNodeHealth: (id: string, health: NodeHealth) => void;
  setLinkErrored: (id: string, errored: boolean) => void;
  removeNode: (id: string) => void;
  reset: () => void;
}

let nodeIdCounter = 0;
let linkIdCounter = 0;

function nextNodeId(type: NodeType) {
  nodeIdCounter += 1;
  return `${type}-${nodeIdCounter}`;
}

export function nextLinkId() {
  linkIdCounter += 1;
  return `link-${linkIdCounter}`;
}

function seededPoint(index: number, typeIndex: number): [number, number, number] {
  const angle = index * 2.399963 + typeIndex * 0.71;
  const radius = WORLD_RADIUS * (0.24 + ((index * 17 + typeIndex * 11) % 9) / 22);
  const y = Math.sin(index * 0.73 + typeIndex) * WORLD_RADIUS * 0.22;
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
}

function createInitialNodes(): AhinNode[] {
  nodeIdCounter = 0;
  const nodes: AhinNode[] = [];
  NODE_TYPE_LIST.forEach((type, typeIndex) => {
    const config = NODE_TYPES[type];
    for (let index = 0; index < config.defaultCount; index++) {
      const position: [number, number, number] = type === "genesis" ? [0, 0, 0] : seededPoint(index + 1, typeIndex);
      nodes.push({
        id: nextNodeId(type),
        type,
        health: "healthy",
        position,
        velocity: [0, 0, 0],
        mass: config.mass,
        scale: type === "genesis" ? 1.35 : type === "routing" ? 0.82 : 0.98,
        seed: (typeIndex + 1) * 0.137 + index * 0.071
      });
    }
  });
  return nodes;
}

function createInitialLinks(nodes: AhinNode[]): AhinLink[] {
  linkIdCounter = 0;
  const genesis = nodes.find((node) => node.type === "genesis");
  if (!genesis) return [];
  const links: AhinLink[] = [];
  for (const node of nodes) {
    if (node.id === genesis.id) continue;
    if (links.length >= 42) break;
    links.push({
      id: nextLinkId(),
      sourceId: genesis.id,
      targetId: node.id,
      intensity: node.type === "routing" ? 0.92 : 0.58,
      pulsePhase: node.seed % 1,
      errored: false
    });
  }
  const routing = nodes.filter((node) => node.type === "routing");
  const settlement = nodes.filter((node) => node.type === "settlement");
  routing.forEach((node, index) => {
    const target = settlement[index % settlement.length];
    if (!target) return;
    links.push({ id: nextLinkId(), sourceId: node.id, targetId: target.id, intensity: 0.72, pulsePhase: node.seed % 1, errored: false });
  });
  return links;
}

function createInitialState() {
  const nodes = createInitialNodes();
  return { nodes, links: createInitialLinks(nodes) };
}

const initial = createInitialState();

export const useNetworkStore = create<NetworkState>((set) => ({
  nodes: initial.nodes,
  links: initial.links,
  timelineT: 1,
  activeMilestone: null,
  setTimelineT: (timelineT) => set({ timelineT: Math.max(0, Math.min(1, timelineT)) }),
  setActiveMilestone: (activeMilestone) => set({ activeMilestone }),
  initializeNodes: () => {
    const next = createInitialState();
    set(next);
  },
  addLink: (link) =>
    set((state) => {
      const key = [link.sourceId, link.targetId].sort().join("|");
      const exists = state.links.some((candidate) => [candidate.sourceId, candidate.targetId].sort().join("|") === key);
      return exists ? state : { links: [...state.links, link] };
    }),
  removeLink: (id) => set((state) => ({ links: state.links.filter((link) => link.id !== id) })),
  setNodeHealth: (id, health) => set((state) => ({ nodes: state.nodes.map((node) => (node.id === id ? { ...node, health } : node)) })),
  setLinkErrored: (id, errored) => set((state) => ({ links: state.links.map((link) => (link.id === id ? { ...link, errored } : link)) })),
  removeNode: (id) =>
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== id),
      links: state.links.filter((link) => link.sourceId !== id && link.targetId !== id)
    })),
  reset: () => {
    const next = createInitialState();
    set({ ...next, timelineT: 1, activeMilestone: null });
  }
}));
