import type { FiveElementAgentDefinition } from "./element-types";

export const rulePurpleAgent: FiveElementAgentDefinition = {
  id: "rule_purple",
  chineseName: "天则紫",
  englishName: "Rule Purple",
  role: "Law, policy, and risk control",
  allowedActions: ["EVALUATE_POLICY", "APPLY_RISK_RULE", "REJECT_UNSAFE_FLOW"]
};
