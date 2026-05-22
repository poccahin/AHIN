export type Vector3Tuple = [number, number, number];

export type NodeType = "genesis" | "sentinel" | "routing" | "settlement" | "eco";

export type NodeHealth = "healthy" | "slashing" | "banished";

export interface AhinNode {
  id: string;
  type: NodeType;
  health: NodeHealth;
  position: Vector3Tuple;
  velocity: Vector3Tuple;
  mass: number;
  scale: number;
  seed: number;
}

export interface AhinLink {
  id: string;
  sourceId: string;
  targetId: string;
  intensity: number;
  pulsePhase: number;
  errored: boolean;
}

export type SlashPhase = "detection" | "collapse" | "banishment" | "done";

export type MilestoneId = "genesis-ignition" | "causal-guard" | "macro-evolution";

export interface NodeTypeConfig {
  type: NodeType;
  label: string;
  labelZh: string;
  role: string;
  color: string;
  rgb: [number, number, number];
  defaultCount: number;
  mass: number;
  forces: {
    charge: number;
    linkDistanceMul: number;
    selfCoefficient?: number;
  };
}
