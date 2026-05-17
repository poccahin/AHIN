import type { FiveElementAgentDefinition } from "./element-types";

export const contractGoldAgent: FiveElementAgentDefinition = {
  id: "contract_gold",
  chineseName: "定约金",
  englishName: "Contract Gold",
  role: "Agreement, settlement intent, and contract finality",
  allowedActions: ["CREATE_SETTLEMENT_INTENT", "ISSUE_DRY_RUN_CERTIFICATE"]
};
