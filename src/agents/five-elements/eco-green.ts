import type { FiveElementAgentDefinition } from "./element-types";

export const ecoGreenAgent: FiveElementAgentDefinition = {
  id: "eco_green",
  chineseName: "灵根绿",
  englishName: "Eco Green",
  role: "Ecosystem growth, reputation, and feedback",
  allowedActions: ["UPDATE_REPUTATION_DRY_RUN", "EMIT_FEEDBACK_EVENT"]
};
