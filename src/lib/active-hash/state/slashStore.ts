"use client";

import { create } from "zustand";
import { NODE_TYPE_LIST } from "../constants/nodeTypes";
import { useNetworkStore } from "./networkStore";
import type { NodeType, SlashPhase, Vector3Tuple } from "../types/network";

export const SLASH_TIMING = {
  collapseStart: 0.8,
  banishedStart: 2.8
} as const;

export interface SlashRecord {
  id: string;
  phase: SlashPhase;
  startTime: number;
  position: Vector3Tuple;
  type: NodeType;
  scale: number;
  seed: number;
  erroredLinkIds: string[];
}

export interface SlashEvent {
  id: string;
  label: string;
  detail: string;
  phase: SlashPhase | "RESET";
  timestamp: string;
}

interface SlashState {
  records: Map<string, SlashRecord>;
  events: SlashEvent[];
  triggerSlash: (nodeId: string, clockSeconds?: number) => void;
  triggerRandomSlash: (clockSeconds?: number) => void;
  tick: (clockSeconds: number) => void;
  resetSlashSimulation: () => void;
}

const DEFAULT_EVENTS: SlashEvent[] = [
  {
    id: "baseline-economic-model",
    label: "Economic responsibility model only",
    detail: "All penalties are local visual simulation state.",
    phase: "RESET",
    timestamp: "T+0.00"
  },
  {
    id: "baseline-no-chain",
    label: "No on-chain transaction",
    detail: "No protocol execution, transfer, burn, signing, or treasury mutation is available.",
    phase: "RESET",
    timestamp: "T+0.00"
  }
];

function eventId(label: string, clockSeconds: number) {
  return `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${clockSeconds.toFixed(3)}`;
}

function clockLabel(clockSeconds: number) {
  return `T+${clockSeconds.toFixed(2)}`;
}

function pushEvent(events: SlashEvent[], label: string, detail: string, phase: SlashEvent["phase"], clockSeconds: number) {
  return [
    {
      id: eventId(label, clockSeconds),
      label,
      detail,
      phase,
      timestamp: clockLabel(clockSeconds)
    },
    ...events
  ].slice(0, 12);
}

export const useSlashStore = create<SlashState>((set, get) => ({
  records: new Map(),
  events: DEFAULT_EVENTS,
  triggerSlash: (nodeId, clockSeconds = performance.now() / 1000) => {
    const network = useNetworkStore.getState();
    const node = network.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.health !== "healthy" || get().records.has(nodeId)) return;

    const record: SlashRecord = {
      id: nodeId,
      phase: "DETECTION",
      startTime: clockSeconds,
      position: [node.position[0], node.position[1], node.position[2]],
      type: node.type,
      scale: node.scale,
      seed: node.seed,
      erroredLinkIds: []
    };

    network.setNodeHealth(nodeId, "detection");
    for (const link of network.links) {
      if (link.sourceId === nodeId || link.targetId === nodeId) {
        network.setLinkErrored(link.id, true);
        record.erroredLinkIds.push(link.id);
      }
    }

    set((state) => {
      const records = new Map(state.records);
      records.set(nodeId, record);
      let events = pushEvent(
        state.events,
        "PoCC violation simulated",
        "PoCC violation detected · simulation only",
        "DETECTION",
        clockSeconds
      );
      events = pushEvent(events, "Touching links marked red", "Errored links vibrate in the local simulator only.", "DETECTION", clockSeconds + 0.01);
      return { records, events };
    });
  },
  triggerRandomSlash: (clockSeconds = performance.now() / 1000) => {
    const healthyNodes = useNetworkStore
      .getState()
      .nodes.filter((node) => node.health === "healthy")
      .sort((a, b) => NODE_TYPE_LIST.indexOf(a.type) - NODE_TYPE_LIST.indexOf(b.type) || a.seed - b.seed);
    if (healthyNodes.length === 0) return;
    const index = Math.floor((clockSeconds * 997) % healthyNodes.length);
    get().triggerSlash(healthyNodes[index].id, clockSeconds);
  },
  tick: (clockSeconds) => {
    const records = get().records;
    if (records.size === 0) return;

    const network = useNetworkStore.getState();
    let recordsMutated = false;
    let events = get().events;
    const nextRecords = new Map(records);

    for (const record of records.values()) {
      const elapsed = clockSeconds - record.startTime;
      if (record.phase === "DETECTION" && elapsed >= SLASH_TIMING.collapseStart) {
        const updated = { ...record, phase: "COLLAPSE" as const };
        network.setNodeHealth(record.id, "collapsing");
        nextRecords.set(record.id, updated);
        recordsMutated = true;
        events = pushEvent(
          events,
          "ChainRank decrease simulated",
          "ChainRank impact simulated · no asset movement",
          "COLLAPSE",
          clockSeconds
        );
        events = pushEvent(events, "Economic responsibility model only", "Visual penalty state is not a token or treasury action.", "COLLAPSE", clockSeconds + 0.01);
      } else if (record.phase === "COLLAPSE" && elapsed >= SLASH_TIMING.banishedStart) {
        network.setNodeHealth(record.id, "banished");
        network.removeNode(record.id);
        nextRecords.delete(record.id);
        recordsMutated = true;
        events = pushEvent(
          events,
          "Node banished from local topology simulation",
          "Node and incident links were removed from local client state only.",
          "BANISHED",
          clockSeconds
        );
        events = pushEvent(events, "No on-chain transaction", "No chain call, signature request, or transaction submission was generated.", "BANISHED", clockSeconds + 0.01);
      }
    }

    if (recordsMutated) {
      set({ records: nextRecords, events });
    }
  },
  resetSlashSimulation: () => {
    useNetworkStore.getState().reset();
    set({ records: new Map(), events: DEFAULT_EVENTS });
  }
}));
