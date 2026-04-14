"""
Theory-to-System Mapping for Life++.

This module documents the mapping from Prof. Cai Hengjin's theoretical
concepts to concrete engineering implementations.

Each concept maps to:
  - System abstraction
  - Runtime behavior
  - Data structure
  - Event type
  - Incentive logic
  - Governance rule
  - Audit/replay mechanism

Use this as the canonical reference for all architectural decisions.
"""
from __future__ import annotations

from typing import Dict, Any

THEORY_TO_SYSTEM_MAP: Dict[str, Dict[str, Any]] = {
    "CognitiveCanxian": {
        "theoretical_meaning": (
            "The objectification and solidification of subjective intentionality "
            "through physical or operational interaction."
        ),
        "system_abstraction": "CanxianArtifact + CanxianValidationPipeline",
        "runtime_behavior": (
            "An agent executes a CognitiveTask and produces a CanxianArtifact. "
            "The artifact passes through the CanxianValidationPipeline — "
            "a 4-stage promotion pipeline: "
            "RAW_OUTPUT → GROUNDED (GroundingAssessor) "
            "→ VALIDATED_CANXIAN (POC-lite / zombie detection) "
            "→ PAYABLE (PayabilityGate)."
        ),
        "data_structure": (
            "CanxianArtifactORM (packages/shared/models.py), "
            "CanxianValidationPipeline (packages/canxian_pipeline/)"
        ),
        "event_type": "ArtifactValidationEvent (one per stage transition)",
        "incentive_logic": (
            "Only PAYABLE artifacts earn contribution_credit in the ledger. "
            "RAW_OUTPUT and GROUNDED artifacts are not eligible for "
            "VirtueWellbeing settlement."
        ),
        "governance_rule": (
            "POC validation required before settlement. "
            "Zombie-flagged artifacts are blocked from settlement. "
            "PayabilityGate enforces AHIN admission, policy compliance, "
            "and minimum cognitive score."
        ),
        "audit_replay": (
            "ArtifactValidationEvent emitted at each pipeline stage. "
            "PipelineResult.events provides the full audit trail. "
            "POCRecordORM persisted with evidence dict. "
            "Replayable via EventBus.replay('artifact_validation_event')."
        ),
        "must_not_implement_as": (
            "Generic LLM output. A CanxianArtifact MUST be operationally grounded "
            "with non-empty grounding_context. Do NOT treat all model outputs as Canxian."
        ),
    },

    "TactileBrainHypothesis": {
        "theoretical_meaning": (
            "Cognition must be grounded in real interaction and resistance — "
            "embodied execution anchors intelligence."
        ),
        "system_abstraction": (
            "GroundingAssessor (packages/canxian_pipeline/) + "
            "EdgeRuntime + DeviceContext (grounding_context field)"
        ),
        "runtime_behavior": (
            "GroundingAssessor evaluates every artifact at pipeline Stage 1. "
            "It checks for non-empty grounding_context, context references, "
            "and causal chain entries. Artifacts without grounding remain "
            "RAW_OUTPUT and are excluded from POC validation."
        ),
        "data_structure": (
            "CanxianArtifactORM.grounding_context (JSONB), "
            "GroundingResult (packages/canxian_pipeline/grounding_assessor.py)"
        ),
        "event_type": "ArtifactValidationEvent (from_status=RAW_OUTPUT → to_status=GROUNDED)",
        "incentive_logic": (
            "Grounded artifacts score higher in cognitive_score computation. "
            "Ungrounded artifacts cannot pass POC validation."
        ),
        "governance_rule": "grounding_context must be non-empty for VALIDATED_CANXIAN.",
        "audit_replay": (
            "GroundingResult recorded in ArtifactValidationEvent.validation_evidence. "
            "EdgeRuntime stores ObjectificationReceiptORM with grounding evidence."
        ),
        "must_not_implement_as": (
            "Do NOT classify cloud-only LLM responses as grounded. "
            "Grounding requires real operational context from the device or user interaction."
        ),
    },

    "CausationReengineeringOfIntelligence": {
        "theoretical_meaning": (
            "Intelligence = active reconstruction of causal chains, "
            "not statistical inference."
        ),
        "system_abstraction": (
            "BaseAgent.verify_causation() + CanxianValidationPipeline "
            "zombie detection (Stage 2) + POCService"
        ),
        "runtime_behavior": (
            "After every task execution, AgentKernel calls verify_causation(). "
            "If False → artifact classified as RAW_OUTPUT + zombie flag. "
            "CanxianValidationPipeline._detect_zombie_output() flags "
            "high-confidence/no-evidence outputs at Stage 2. "
            "POCService._detect_zombie_output() provides the DB-backed variant."
        ),
        "data_structure": "POCRecordORM.is_zombie_output + evidence.causal_chain",
        "event_type": "ArtifactValidationEvent(is_zombie_flagged=True)",
        "incentive_logic": (
            "Zombie outputs earn zero contribution_credit. "
            "Repeated zombie outputs trigger PolicyEngine.record_zombie_strike()."
        ),
        "governance_rule": (
            "After 3 zombie strikes, node is blocked by PolicyEngine. "
            "Admin can unblock via policy_engine.unblock_node()."
        ),
        "audit_replay": "POCRecordORM.evidence.causal_chain logged for all artifacts.",
        "must_not_implement_as": (
            "Do NOT model this as a confidence threshold or F1-score. "
            "Causation evidence requires explicit causal_chain entries, "
            "not just a high probability score."
        ),
    },

    "LifePlusObjectification": {
        "theoretical_meaning": (
            "Intelligence must externalize into tools, records, workflows, "
            "and systems — durable structures."
        ),
        "system_abstraction": "CanxianArtifact + ObjectificationReceipt",
        "runtime_behavior": (
            "Every CognitiveTask produces a CanxianArtifact stored in the DB. "
            "Edge interactions produce ObjectificationReceipts. "
            "CognitiveMemoryStore records episodic memories."
        ),
        "data_structure": "CanxianArtifactORM, ObjectificationReceiptORM",
        "event_type": "CognitiveEvent(status=OBJECTIFIED)",
        "incentive_logic": "Objectified artifacts are prerequisites for settlement.",
        "governance_rule": "artifact.content_hash must be non-empty for storage.",
        "audit_replay": "content_ref (IPFS/S3) enables external audit of artifact content.",
        "must_not_implement_as": (
            "Do NOT treat ephemeral in-memory computations as objectification. "
            "Objectification requires PERSISTENCE to a durable medium."
        ),
    },

    "AHIN": {
        "theoretical_meaning": (
            "Active Hashed Interaction Network — decentralized interaction substrate. "
            "No global consensus. Trust emerges from directional interaction."
        ),
        "system_abstraction": "AhinNode + AssociationGraph + InteractionHasher",
        "runtime_behavior": (
            "Nodes exchange AssociationEvents (Proactive/Acceptance). "
            "Each event is hashed and chained to its predecessor. "
            "Trust weights are updated after each interaction."
        ),
        "data_structure": "AssociationEventORM, AssociationGraph (in-memory)",
        "event_type": "AssociationEvent(PROACTIVE / ACCEPTANCE)",
        "incentive_logic": (
            "Admission requires ≥ 10 USDT equivalent stake. "
            "Each collaboration interaction costs min(0.00001 USDT equiv, 1 LIFEPP)."
        ),
        "governance_rule": (
            "No global consensus required. "
            "Trust is directional and locally computed."
        ),
        "audit_replay": (
            "AssociationEventORM chains via interaction_hash. "
            "InteractionHasher.verify_chain() validates audit trail."
        ),
        "must_not_implement_as": (
            "Do NOT model AHIN as a blockchain requiring global consensus. "
            "Do NOT use centralized trust scores. "
            "Trust MUST be directional and interaction-derived."
        ),
    },

    "SpontaneousTimeOrder": {
        "theoretical_meaning": (
            "Time is the emergent ordering of interactions among nodes, "
            "not a centralized timestamp authority."
        ),
        "system_abstraction": "SpontaneousTimeOrder + LocalTimeSequencer",
        "runtime_behavior": (
            "Each node maintains a local sequence counter. "
            "Every event carries a SpontaneousTimeOrder with "
            "wall_clock_utc, local_sequence, node_id, and interaction_hash."
        ),
        "data_structure": "SpontaneousTimeOrder (Pydantic), spontaneous_time_order (JSONB column)",
        "event_type": "All events carry time_order field",
        "incentive_logic": "N/A — temporal infrastructure",
        "governance_rule": (
            "Conflict resolution uses local_sequence + interaction_hash, "
            "not only wall clock. "
            "Offline edge transactions preserve their local sequence."
        ),
        "audit_replay": (
            "InteractionHasher.verify_chain() reconstructs temporal ordering "
            "from hash chain without central authority."
        ),
        "must_not_implement_as": (
            "Do NOT use only wall-clock timestamps for ordering. "
            "Do NOT assume all nodes share a synchronized clock."
        ),
    },

    "ProofOfCognitiveCanxian": {
        "theoretical_meaning": (
            "Proof that a CanxianArtifact was produced through meaningful cognitive work, "
            "not brute-force compute or capital stake."
        ),
        "system_abstraction": "POCService + POCRecordORM",
        "runtime_behavior": (
            "POCService.validate() checks grounding, causal evidence, zombie detection. "
            "Valid POC → artifact status = VALIDATED_CANXIAN. "
            "POCRecord stored with cognitive_score and evidence."
        ),
        "data_structure": "POCRecordORM",
        "event_type": "ArtifactValidationEvent(to_status=VALIDATED_CANXIAN)",
        "incentive_logic": (
            "cognitive_score determines share of VirtueWellbeing settlement. "
            "Zero-score or zombie artifacts earn nothing."
        ),
        "governance_rule": (
            "POC is required before any settlement payout. "
            "is_zombie_output=True blocks settlement permanently for that artifact."
        ),
        "audit_replay": "POCRecordORM.evidence is the audit record for all validations.",
        "must_not_implement_as": (
            "Do NOT model POC as PoW (hash computation) or PoS (stake size). "
            "POC MUST be about cognitive contribution quality and operational grounding."
        ),
    },

    "AlignedVirtueAndWellbeing": {
        "theoretical_meaning": (
            "Incentives must structurally align contribution with well-being "
            "(德福一致 — virtue and well-being in correspondence)."
        ),
        "system_abstraction": "VirtueWellbeingDistributor + VirtueWellbeingSettlementBatch",
        "runtime_behavior": (
            "Settlement distributes LIFE++ proportional to contribution_credit. "
            "Treasury fraction (default 5%) allocated to public goods. "
            "Settlement is NOT a fee payment — it is a welfare distribution."
        ),
        "data_structure": "VirtueWellbeingSettlementBatchORM",
        "event_type": "SettlementEvent",
        "incentive_logic": (
            "Contribution credit is the sole basis for distribution. "
            "Capital size does NOT determine payout."
        ),
        "governance_rule": (
            "Treasury fraction is governed by protocol parameters. "
            "Distribution formula is transparent and auditable."
        ),
        "audit_replay": (
            "VirtueWellbeingSettlementBatchORM.audit_hash covers all distributions. "
            "SettlementEvents are replayable from event bus."
        ),
        "must_not_implement_as": (
            "Do NOT model settlement as a generic fee distribution. "
            "Do NOT allow capital stake to determine settlement share. "
            "Settlement MUST be based on cognitive contribution."
        ),
    },

    "ContinuousSpectrumTopology": {
        "theoretical_meaning": (
            "Nodes are connected across a spectrum of trust intensities, "
            "not binary on/off membership."
        ),
        "system_abstraction": "TrustWeightModel + AssociationGraph.get_trusted_neighbours()",
        "runtime_behavior": (
            "Every directed edge carries a trust weight in [0, 1]. "
            "Weights decay over time without reinforcing interactions. "
            "Negative interactions (zombie, policy violation) reduce weights."
        ),
        "data_structure": "TrustWeightModel._interaction_log (in-memory; TODO: persist)",
        "event_type": "TrustEvent",
        "incentive_logic": (
            "Higher trust weight → preferred routing for CognitiveTasks. "
            "Low trust → excluded from high-sensitivity tasks."
        ),
        "governance_rule": (
            "min_trust threshold for collaboration is configurable. "
            "Trust revocation is available for policy violations."
        ),
        "audit_replay": "TrustEvents logged to event bus. TrustWeightModel reconstructible from log.",
        "must_not_implement_as": (
            "Do NOT use binary trusted/untrusted membership. "
            "Do NOT use a centralized trust authority. "
            "Trust MUST be directional and interaction-derived."
        ),
    },

    "CanxianLayer": {
        "theoretical_meaning": (
            "The Canxian Layer is the structural embodiment of the core "
            "epistemic question: how does the system distinguish mere model output "
            "from validated, payable cognitive contribution? It implements the "
            "4-stage objectification pipeline that is the defining property of "
            "the Life++ Agent OS."
        ),
        "system_abstraction": (
            "CanxianValidationPipeline (packages/canxian_pipeline/) orchestrating "
            "GroundingAssessor (Stage 1), POC-lite / zombie detection (Stage 2), "
            "and PayabilityGate (Stage 3)"
        ),
        "runtime_behavior": (
            "Every CanxianArtifact enters the pipeline at RAW_OUTPUT. "
            "Stage 1 (GroundingAssessor) checks Tactile Brain Hypothesis grounding. "
            "Stage 2 computes cognitive_score and runs zombie detection. "
            "Stage 3 (PayabilityGate) verifies AHIN admission, policy compliance, "
            "and minimum score. Only artifacts reaching PAYABLE participate in "
            "VirtueWellbeing settlement."
        ),
        "data_structure": (
            "CanxianValidationPipeline, GroundingAssessor, PayabilityGate, "
            "PipelineResult, GroundingResult, PayabilityResult"
        ),
        "event_type": "ArtifactValidationEvent (one per stage transition)",
        "incentive_logic": (
            "Only PAYABLE artifacts enter settlement. "
            "Cognitive score determines contribution_credit share. "
            "Zombie-flagged outputs earn zero."
        ),
        "governance_rule": (
            "No pipeline stage can be skipped. "
            "PayabilityGate enforces AHIN admission and policy blocklist. "
            "Zombie strikes accumulate in PolicyEngine."
        ),
        "audit_replay": (
            "PipelineResult.events contains the full audit trail of stage transitions. "
            "Each ArtifactValidationEvent includes validation_evidence for replay."
        ),
        "must_not_implement_as": (
            "Do NOT bypass the pipeline by writing PAYABLE directly. "
            "Do NOT skip grounding assessment. "
            "Do NOT treat all validated artifacts as payable without PayabilityGate."
        ),
    },
}


def get_mapping(concept: str) -> Dict[str, Any]:
    """Return the theory-to-system mapping for a given concept."""
    return THEORY_TO_SYSTEM_MAP.get(concept, {})


def list_concepts() -> list:
    """Return all mapped theoretical concepts."""
    return list(THEORY_TO_SYSTEM_MAP.keys())
