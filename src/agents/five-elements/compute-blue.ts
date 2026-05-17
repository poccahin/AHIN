import type { FiveElementAgentDefinition } from "./element-types";

export const computeBlueAgent: FiveElementAgentDefinition = {
  id: "compute_blue",
  chineseName: "算流蓝",
  englishName: "Compute Blue",
  role: "Routing, pricing, and computation",
  allowedActions: ["SIMULATE_ROUTE", "READ_ORACLE_QUOTE", "COMPUTE_SCORE"]
};
