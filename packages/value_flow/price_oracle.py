"""
PriceOracle — LIFE++/USDT price feed for the Cognitive Value Flow System.

The PriceOracle provides the LIFE++/USDT exchange rate used by:
  - AdmissionGate (stake threshold check)
  - CollaborationCostEngine (micro-usage pricing)
  - MerchantSettlementService (fiat-equivalent settlement)
  - TreasuryService (public-good allocation valuation)

In production this would pull from an on-chain oracle (e.g. Pyth, Switchboard)
or a weighted average across Solana DEX pools.

The oracle MUST be treated as a *reference feed*, not an absolute truth.
LIFE++ is a scarce coordination asset — the price is emergent.
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timezone
from typing import Optional

from packages.shared.domain import LifePPBaseModel, now_utc

logger = logging.getLogger(__name__)

# Default price set via environment; production overrides via set_price()
_DEFAULT_LIFEPP_USDT_PRICE = float(
    os.getenv("LIFEPP_USDT_PRICE", "0.10")
)

# Staleness threshold — if the price has not been refreshed within this
# many seconds, queries will log a warning.
_STALE_THRESHOLD_SECONDS = int(
    os.getenv("LIFEPP_PRICE_STALE_SECONDS", "3600")
)


class PriceSnapshot(LifePPBaseModel):
    """Immutable point-in-time price record."""

    lifepp_usdt: float
    source: str = "default"
    observed_at: datetime


class PriceOracle:
    """
    Thread-safe LIFE++/USDT price oracle.

    Provides a single canonical price used by all value-flow computations.
    The price is set externally (by an oracle adapter or admin) and read
    concurrently by multiple services.
    """

    def __init__(
        self,
        initial_price: Optional[float] = None,
        stale_threshold_seconds: int = _STALE_THRESHOLD_SECONDS,
    ) -> None:
        self._lock = threading.Lock()
        self._stale_threshold = stale_threshold_seconds
        price = initial_price if initial_price is not None else _DEFAULT_LIFEPP_USDT_PRICE
        if price <= 0:
            raise ValueError(
                f"LIFE++/USDT price must be positive, got {price}"
            )
        self._snapshot = PriceSnapshot(
            lifepp_usdt=price,
            source="initial",
            observed_at=now_utc(),
        )
        logger.info(
            "PriceOracle initialised",
            extra={"lifepp_usdt": price},
        )

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    @property
    def lifepp_usdt(self) -> float:
        """Current LIFE++/USDT price."""
        with self._lock:
            self._warn_if_stale()
            return self._snapshot.lifepp_usdt

    @property
    def snapshot(self) -> PriceSnapshot:
        """Return the full price snapshot (immutable copy)."""
        with self._lock:
            self._warn_if_stale()
            return self._snapshot.model_copy()

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def set_price(
        self, lifepp_usdt: float, source: str = "external"
    ) -> PriceSnapshot:
        """
        Update the canonical LIFE++/USDT price.

        Called by oracle adapters (Pyth, Switchboard, admin override).
        """
        if lifepp_usdt <= 0:
            raise ValueError(
                f"LIFE++/USDT price must be positive, got {lifepp_usdt}"
            )
        with self._lock:
            self._snapshot = PriceSnapshot(
                lifepp_usdt=lifepp_usdt,
                source=source,
                observed_at=now_utc(),
            )
        logger.info(
            "PriceOracle updated",
            extra={"lifepp_usdt": lifepp_usdt, "source": source},
        )
        return self._snapshot.model_copy()

    # ------------------------------------------------------------------
    # Conversion helpers
    # ------------------------------------------------------------------

    def usdt_to_lifepp(self, usdt_amount: float) -> float:
        """Convert USDT amount to LIFE++ at the current price."""
        return usdt_amount / self.lifepp_usdt

    def lifepp_to_usdt(self, lifepp_amount: float) -> float:
        """Convert LIFE++ amount to USDT equivalent."""
        return lifepp_amount * self.lifepp_usdt

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _warn_if_stale(self) -> None:
        """Log a warning if the price has not been refreshed recently."""
        age = (
            datetime.now(tz=timezone.utc) - self._snapshot.observed_at
        ).total_seconds()
        if age > self._stale_threshold:
            logger.warning(
                "PriceOracle data is stale",
                extra={
                    "age_seconds": int(age),
                    "threshold": self._stale_threshold,
                },
            )
