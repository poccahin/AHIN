import type { ComponentType } from "react";
import { Flame, Landmark, Leaf, Network, Scale } from "lucide-react";

export type AgentElementId = "genesis-orange" | "rule-purple" | "compute-blue" | "contract-gold" | "eco-green";

export interface ElementSpec {
  id: AgentElementId;
  chineseName: string;
  englishName: string;
  color: string;
  role: string;
  material: string;
  effect: string;
  glowClass: string;
  anchorHash: string;
  imageCandidates: string[];
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

export const ELEMENT_SPECS: ElementSpec[] = [
  {
    id: "genesis-orange",
    chineseName: "初然橙",
    englishName: "Genesis Orange",
    color: "#FF5722",
    role: "Godsignal Creation Engine",
    material: "molten glass",
    effect: "ember sparks",
    glowClass: "agent-genesis-orange",
    anchorHash: "0xA11F...57C9",
    imageCandidates: [
      "/agents/lifepp-genesis-orange.png",
      "/genesis-orange-skull.png",
      "/agent-genesis-orange.png",
      "/skull-orange.png"
    ],
    Icon: Flame
  },
  {
    id: "rule-purple",
    chineseName: "天则紫",
    englishName: "Rule Purple",
    color: "#9C27B0",
    role: "Law & Risk Control",
    material: "amethyst crystal",
    effect: "plasma aura",
    glowClass: "agent-rule-purple",
    anchorHash: "0xD0C4...92B1",
    imageCandidates: ["/agents/lifepp-rule-purple.png", "/rule-purple-skull.png", "/agent-rule-purple.png", "/skull-purple.png"],
    Icon: Scale
  },
  {
    id: "compute-blue",
    chineseName: "算流蓝",
    englishName: "Compute Blue",
    color: "#03A9F4",
    role: "Chippmf Calculation & Routing Engine",
    material: "liquid fiber optics",
    effect: "cascading data light",
    glowClass: "agent-compute-blue",
    anchorHash: "0x0CF1...38EA",
    imageCandidates: ["/agents/lifepp-compute-blue.png", "/compute-blue-skull.png", "/agent-compute-blue.png", "/skull-blue.png"],
    Icon: Network
  },
  {
    id: "contract-gold",
    chineseName: "定约金",
    englishName: "Contract Gold",
    color: "#FFC107",
    role: "Dry-Run Settlement Attestation",
    material: "luminescent aurum",
    effect: "stable radiant rays",
    glowClass: "agent-contract-gold",
    anchorHash: "0xC01D...70AF",
    imageCandidates: ["/agents/lifepp-contract-gold.png", "/contract-gold-skull.png", "/agent-contract-gold.png", "/skull-gold.png"],
    Icon: Landmark
  },
  {
    id: "eco-green",
    chineseName: "灵根绿",
    englishName: "Eco Green",
    color: "#8BC34A",
    role: "Ecosystem Growth & Evolution",
    material: "bioluminescent organic glass",
    effect: "forest breathing ripples",
    glowClass: "agent-eco-green",
    anchorHash: "0xECO5...41DA",
    imageCandidates: ["/agents/lifepp-eco-green.png", "/eco-green-skull.png", "/agent-eco-green.png", "/skull-green.png"],
    Icon: Leaf
  }
];

export const CENTER_AGENT_ID: AgentElementId = "compute-blue";
