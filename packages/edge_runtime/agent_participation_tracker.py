"""
AgentParticipationTracker — auditability of collaborative agent participation.

Per POC (Proof of Cognitive Canxian):
  Meaningful local execution at the edge terminal can become evidence
  of cognitive contribution.  POC must be treated as proof of meaningful
  cognitive work and meaningful output, not brute-force computation
  or pure capital stake.

Per Causation Re-engineering:
  The system must include mechanisms to distinguish philosophical-zombie-like
  output from grounded, policy-relevant, or value-relevant contribution.

This tracker records which agents contributed to each edge interaction,
what role they played, and provides evidence for POC validation.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Dict, List, Optional

from packages.shared.domain import new_id, now_utc

logger = logging.getLogger(__name__)


class AgentParticipationRecord:
    """A single record of an agent's participation at the edge terminal."""

    def __init__(
        self,
        agent_node_id: str,
        interaction_id: str,
        role: str,
        contribution_summary: str,
        grounding_evidence: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.record_id: str = new_id()
        self.agent_node_id = agent_node_id
        self.interaction_id = interaction_id
        self.role = role
        self.contribution_summary = contribution_summary
        self.grounding_evidence = grounding_evidence or {}
        self.created_at = now_utc()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "record_id": self.record_id,
            "agent_node_id": self.agent_node_id,
            "interaction_id": self.interaction_id,
            "role": self.role,
            "contribution_summary": self.contribution_summary,
            "grounding_evidence": self.grounding_evidence,
            "created_at": self.created_at.isoformat(),
        }


class AgentParticipationTracker:
    """
    Tracks and audits agent participation at the Life++ Lite Edge Terminal.

    Provides:
      1. Participation recording per interaction
      2. Audit trail generation for POC evidence
      3. Anti-zombie participation checks
      4. Contribution summary per agent per session
      5. Tamper-evident audit hash of participation records
    """

    def __init__(self, terminal_node_id: str) -> None:
        self._terminal_id = terminal_node_id
        self._records: List[AgentParticipationRecord] = []

    def record_participation(
        self,
        agent_node_id: str,
        interaction_id: str,
        role: str,
        contribution_summary: str,
        grounding_evidence: Optional[Dict[str, Any]] = None,
    ) -> AgentParticipationRecord:
        """
        Record an agent's participation in an edge terminal interaction.

        Args:
            agent_node_id: The participating agent's AHIN node ID.
            interaction_id: The interaction this agent contributed to.
            role: The agent's role (e.g. 'executor', 'validator',
                'advisor', 'translator').
            contribution_summary: Human-readable description of what
                the agent contributed.
            grounding_evidence: Evidence linking this participation
                to operational grounding (for POC).

        Returns:
            The participation record.
        """
        record = AgentParticipationRecord(
            agent_node_id=agent_node_id,
            interaction_id=interaction_id,
            role=role,
            contribution_summary=contribution_summary,
            grounding_evidence=grounding_evidence,
        )
        self._records.append(record)

        logger.info(
            "Agent participation recorded",
            extra={
                "record_id": record.record_id,
                "agent": agent_node_id,
                "interaction": interaction_id,
                "role": role,
                "terminal": self._terminal_id,
            },
        )
        return record

    def get_participation_for_interaction(
        self, interaction_id: str
    ) -> List[AgentParticipationRecord]:
        """Return all agent participation records for a given interaction."""
        return [r for r in self._records if r.interaction_id == interaction_id]

    def get_participation_for_agent(
        self, agent_node_id: str
    ) -> List[AgentParticipationRecord]:
        """Return all participation records for a given agent."""
        return [r for r in self._records if r.agent_node_id == agent_node_id]

    def get_contribution_summary(self) -> Dict[str, Dict[str, Any]]:
        """
        Return a per-agent contribution summary for this terminal session.

        This is suitable for inclusion in POC evidence or settlement records.
        """
        summary: Dict[str, Dict[str, Any]] = {}
        for record in self._records:
            agent = record.agent_node_id
            if agent not in summary:
                summary[agent] = {
                    "participation_count": 0,
                    "roles": [],
                    "has_grounding_evidence": False,
                }
            summary[agent]["participation_count"] += 1
            if record.role not in summary[agent]["roles"]:
                summary[agent]["roles"].append(record.role)
            if record.grounding_evidence:
                summary[agent]["has_grounding_evidence"] = True
        return summary

    def generate_audit_hash(self) -> str:
        """
        Generate a tamper-evident hash of all participation records.

        This hash can be included in day-close reconciliation batches
        for auditability.
        """
        audit_data = json.dumps(
            [r.to_dict() for r in self._records],
            sort_keys=True,
            default=str,
        )
        return hashlib.sha256(audit_data.encode()).hexdigest()

    def detect_zombie_participation(
        self, agent_node_id: str, min_evidence_count: int = 1
    ) -> bool:
        """
        Check if an agent's participation exhibits zombie-like patterns.

        A zombie participant:
          - Has participation records but NO grounding evidence
          - Contributes to many interactions but with trivial summaries

        This is a heuristic flag; actual zombie determination is done by POCService.

        Returns True if participation appears zombie-like (suspicious).
        """
        agent_records = self.get_participation_for_agent(agent_node_id)
        if not agent_records:
            return False

        records_with_evidence = sum(
            1 for r in agent_records if r.grounding_evidence
        )
        return records_with_evidence < min_evidence_count

    @property
    def total_records(self) -> int:
        return len(self._records)

    def get_all_records(self) -> List[Dict[str, Any]]:
        """Return all records as dicts for serialization."""
        return [r.to_dict() for r in self._records]
