import type { ComponentType } from "react";
import { Flame, Landmark, Leaf, Network, Scale } from "lucide-react";

export type MatrixAgentId = "genesis-orange" | "rule-purple" | "compute-blue" | "contract-gold" | "eco-green";

export interface MatrixAgent {
  id: MatrixAgentId;
  cnName: string;
  enName: string;
  role: string;
  color: string;
  material: string;
  status: "Active";
  consensusRoute: "PoCC Verified";
  ahinAnchor: string;
  mode: "Dry-run / Readonly";
  lastAction: string;
  proofStatus: "Passed / Dry-run Evidence";
  description: string;
  glowClass: string;
  slotClass: string;
  imageCandidates: string[];
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

export const MATRIX_AGENTS: MatrixAgent[] = [
  {
    id: "genesis-orange",
    cnName: "初然橙",
    enName: "Genesis Orange",
    role: "Godsignal Creation Engine",
    color: "#FF5722",
    material: "molten glass",
    status: "Active",
    consensusRoute: "PoCC Verified",
    ahinAnchor: "0xA11F...57C9",
    mode: "Dry-run / Readonly",
    lastAction: "ASSERT_INTENT",
    proofStatus: "Passed / Dry-run Evidence",
    description: "Asserts user intent into the AHIN semantic field before any downstream policy or route simulation.",
    glowClass: "agent-genesis-orange",
    slotClass: "matrix4f-slot-northwest",
    imageCandidates: ["/agents/lifepp-genesis-orange.png", "/genesis-orange-skull.png", "/agent-genesis-orange.png", "/skull-orange.png"],
    Icon: Flame
  },
  {
    id: "rule-purple",
    cnName: "天则紫",
    enName: "Rule Purple",
    role: "Law & Risk Control",
    color: "#9C27B0",
    material: "amethyst crystal",
    status: "Active",
    consensusRoute: "PoCC Verified",
    ahinAnchor: "0xD0C4...92B1",
    mode: "Dry-run / Readonly",
    lastAction: "EVALUATE_POLICY",
    proofStatus: "Passed / Dry-run Evidence",
    description: "Evaluates policy constraints and keeps admission evidence inside the readonly safety boundary.",
    glowClass: "agent-rule-purple",
    slotClass: "matrix4f-slot-northeast",
    imageCandidates: ["/agents/lifepp-rule-purple.png", "/rule-purple-skull.png", "/agent-rule-purple.png", "/skull-purple.png"],
    Icon: Scale
  },
  {
    id: "compute-blue",
    cnName: "算流蓝",
    enName: "Compute Blue",
    role: "Routing / Compute / Oracle Coordination",
    color: "#03A9F4",
    material: "liquid fiber optics",
    status: "Active",
    consensusRoute: "PoCC Verified",
    ahinAnchor: "0x0CF1...38EA",
    mode: "Dry-run / Readonly",
    lastAction: "SIMULATE_ROUTE",
    proofStatus: "Passed / Dry-run Evidence",
    description: "Coordinates readonly quote context, route simulation, and proof-envelope continuity.",
    glowClass: "agent-compute-blue",
    slotClass: "matrix4f-slot-center",
    imageCandidates: ["/agents/lifepp-compute-blue.png", "/compute-blue-skull.png", "/agent-compute-blue.png", "/skull-blue.png"],
    Icon: Network
  },
  {
    id: "contract-gold",
    cnName: "定约金",
    enName: "Contract Gold",
    role: "Dry-Run Settlement Attestation",
    color: "#FFC107",
    material: "luminescent aurum",
    status: "Active",
    consensusRoute: "PoCC Verified",
    ahinAnchor: "0xC01D...70AF",
    mode: "Dry-run / Readonly",
    lastAction: "ISSUE_DRY_RUN_CERTIFICATE",
    proofStatus: "Passed / Dry-run Evidence",
    description: "Issues the dry-run evidence certificate that proves no transfer, burn, or protocol execution occurred.",
    glowClass: "agent-contract-gold",
    slotClass: "matrix4f-slot-southwest",
    imageCandidates: ["/agents/lifepp-contract-gold.png", "/contract-gold-skull.png", "/agent-contract-gold.png", "/skull-gold.png"],
    Icon: Landmark
  },
  {
    id: "eco-green",
    cnName: "灵根绿",
    enName: "Eco Green",
    role: "Ecosystem Feedback & Evolution",
    color: "#8BC34A",
    material: "bioluminescent organic glass",
    status: "Active",
    consensusRoute: "PoCC Verified",
    ahinAnchor: "0xECO5...41DA",
    mode: "Dry-run / Readonly",
    lastAction: "EMIT_FEEDBACK_EVENT",
    proofStatus: "Passed / Dry-run Evidence",
    description: "Emits the final feedback event for the living collaboration field without executing a real protocol action.",
    glowClass: "agent-eco-green",
    slotClass: "matrix4f-slot-southeast",
    imageCandidates: ["/agents/lifepp-eco-green.png", "/eco-green-skull.png", "/agent-eco-green.png", "/skull-green.png"],
    Icon: Leaf
  }
];

export const CENTER_AGENT_ID: MatrixAgentId = "compute-blue";

export const FLOW_STEPS = [
  { action: "ASSERT_INTENT", agentId: "genesis-orange" },
  { action: "EVALUATE_POLICY", agentId: "rule-purple" },
  { action: "SIMULATE_ROUTE", agentId: "compute-blue" },
  { action: "CREATE_SETTLEMENT_INTENT", agentId: "contract-gold" },
  { action: "ISSUE_DRY_RUN_CERTIFICATE", agentId: "contract-gold" },
  { action: "EMIT_FEEDBACK_EVENT", agentId: "eco-green" }
] as const;

export function getMatrixAgent(id: MatrixAgentId) {
  return MATRIX_AGENTS.find((agent) => agent.id === id) ?? MATRIX_AGENTS[2];
}
