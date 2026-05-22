import type { NodeType, NodeTypeConfig } from "../types/network";

export const NODE_TYPES: Record<NodeType, NodeTypeConfig> = {
  genesis: {
    type: "genesis",
    label: "Genesis Orange",
    labelZh: "初燃橙",
    role: "ASSERT_INTENT",
    color: "#FF5722",
    rgb: [255, 87, 34],
    defaultCount: 1,
    mass: 4,
    forces: {
      charge: 80,
      linkDistanceMul: 1.4
    }
  },
  sentinel: {
    type: "sentinel",
    label: "Rule Purple / Sentinel",
    labelZh: "天则紫",
    role: "EVALUATE_POLICY",
    color: "#9C27B0",
    rgb: [156, 39, 176],
    defaultCount: 4,
    mass: 6,
    forces: {
      charge: -10,
      linkDistanceMul: 1
    }
  },
  routing: {
    type: "routing",
    label: "Compute Blue / Routing",
    labelZh: "算流蓝",
    role: "SIMULATE_ROUTE",
    color: "#03A9F4",
    rgb: [3, 169, 244],
    defaultCount: 8,
    mass: 0.8,
    forces: {
      charge: -3,
      linkDistanceMul: 0.7
    }
  },
  settlement: {
    type: "settlement",
    label: "Contract Gold / Settlement",
    labelZh: "定约金",
    role: "ISSUE_DRY_RUN_CERTIFICATE",
    color: "#FFC107",
    rgb: [255, 193, 7],
    defaultCount: 5,
    mass: 2.5,
    forces: {
      charge: -2,
      linkDistanceMul: 0.5
    }
  },
  eco: {
    type: "eco",
    label: "Eco Green",
    labelZh: "灵根绿",
    role: "EMIT_FEEDBACK_EVENT",
    color: "#8BC34A",
    rgb: [139, 195, 74],
    defaultCount: 10,
    mass: 1.2,
    forces: {
      charge: -4,
      linkDistanceMul: 1,
      selfCoefficient: 1.2
    }
  }
};

export const NODE_TYPE_LIST: NodeType[] = ["genesis", "sentinel", "routing", "settlement", "eco"];

export const DEFAULT_TOTAL_NODES = NODE_TYPE_LIST.reduce((sum, type) => sum + NODE_TYPES[type].defaultCount, 0);

export const WORLD_RADIUS = 18;

export const MAX_LINKS = 64;

export const BACKGROUND_COLOR = "#05060a";
