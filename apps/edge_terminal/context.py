"""
DeviceContext — captures the operational grounding context of the edge terminal.

Per Tactile Brain Hypothesis:
  Cognition must be grounded in resistance, context, and operational interaction.
  The DeviceContext is the structured representation of the terminal's physical
  and operational environment at the moment of each interaction.

This grounding context is attached to every CanxianArtifact and
ObjectificationReceipt produced at this terminal, ensuring that
cognitive objectification is not merely virtual but operationally anchored.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from packages.shared.domain import LifePPBaseModel, new_id, now_utc

logger = logging.getLogger(__name__)


class DeviceContext(LifePPBaseModel):
    """
    Snapshot of the terminal's operational environment at interaction time.

    This is the Tactile Brain grounding record:
      - Where is the terminal? (location)
      - Who is operating it? (operator)
      - What is the physical context? (device_metadata)
      - When, in local experience? (captured_at)

    An empty DeviceContext means no grounding — artifacts produced
    without grounding remain RAW_OUTPUT per Tactile Brain Hypothesis.
    """
    terminal_id: str
    location_label: Optional[str] = None
    geo_lat: Optional[float] = None
    geo_lon: Optional[float] = None
    operator_node_id: Optional[str] = None
    device_metadata: Dict[str, Any] = {}
    captured_at: str = ""


class DeviceContextManager:
    """
    Manages the current operational context for an edge terminal.

    The context can be updated as the terminal moves or is reconfigured.
    Each interaction snapshot captures the context at that moment.
    """

    def __init__(
        self,
        terminal_id: str,
        location_label: Optional[str] = None,
        geo_lat: Optional[float] = None,
        geo_lon: Optional[float] = None,
        operator_node_id: Optional[str] = None,
        device_metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        self._terminal_id = terminal_id
        self._location_label = location_label or os.getenv(
            "EDGE_TERMINAL_LOCATION", "unknown"
        )
        self._geo_lat = geo_lat
        self._geo_lon = geo_lon
        self._operator_node_id = operator_node_id
        self._device_metadata = device_metadata or {}
        logger.info(
            "DeviceContextManager initialised",
            extra={
                "terminal_id": terminal_id,
                "location": self._location_label,
            },
        )

    def capture(self) -> DeviceContext:
        """
        Capture a snapshot of the current device context.

        This snapshot is attached to every interaction as grounding evidence.
        """
        return DeviceContext(
            terminal_id=self._terminal_id,
            location_label=self._location_label,
            geo_lat=self._geo_lat,
            geo_lon=self._geo_lon,
            operator_node_id=self._operator_node_id,
            device_metadata=self._device_metadata,
            captured_at=now_utc().isoformat(),
        )

    def to_grounding_dict(self) -> Dict[str, Any]:
        """
        Return the current context as a grounding_context dict.

        This dict is stored in CanxianArtifactORM.grounding_context and
        ObjectificationReceiptORM.payload to satisfy Tactile Brain Hypothesis.
        """
        ctx = self.capture()
        return {k: v for k, v in ctx.model_dump().items() if v is not None and v != {}}

    @property
    def has_grounding(self) -> bool:
        """Return True if the context provides meaningful operational grounding."""
        return bool(self._location_label and self._location_label != "unknown")

    def update_location(
        self,
        location_label: str,
        geo_lat: Optional[float] = None,
        geo_lon: Optional[float] = None,
    ) -> None:
        """Update the terminal's location context."""
        self._location_label = location_label
        self._geo_lat = geo_lat
        self._geo_lon = geo_lon
        logger.info(
            "Device context location updated",
            extra={"terminal_id": self._terminal_id, "location": location_label},
        )

    def update_operator(self, operator_node_id: str) -> None:
        """Update the current operator of this terminal."""
        self._operator_node_id = operator_node_id

    def update_device_metadata(self, metadata: Dict[str, Any]) -> None:
        """Update device-level metadata (firmware, peripherals, etc.)."""
        self._device_metadata.update(metadata)
