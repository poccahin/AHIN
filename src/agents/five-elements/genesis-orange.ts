import type { FiveElementAgentDefinition } from "./element-types";

export const genesisOrangeAgent: FiveElementAgentDefinition = {
  id: "genesis_orange",
  chineseName: "初然橙",
  englishName: "Genesis Orange",
  role: "Godsignal creation engine",
  allowedActions: ["ASSERT_INTENT", "CREATE_SIGNAL", "OPEN_PROOF_ENVELOPE"]
};
