"""
PriceOracle — LIFE++ / USDT price feed for cognitive value calculations.

The PriceOracle is NOT a decentralised oracle network in the DeFi sense.
It is the system's reference for converting between LIFE++ and USDT
equivalents for:
  - AHIN admission threshold (≥10 USDT equivalent)
  - Collaboration cost computation (min{0.00001 USDT equiv, 1 LIFE++})
  - Settlement calculations
  - Merchant payment quoting

MVP: configurable fixed price.
Later: Solana on-chain oracle, TWAP feed, multi-source aggregation.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Optional

logger = logging.getLogger(__name__)

_DEFAULT_LIFEPP_USDT_PRICE = float(
    os.getenv("LIFEPP_USDT_PRICE", "0.01")
)
# Stale threshold in seconds (price older than this triggers a warning)
_STALE_THRESHOLD_SECONDS = int(os.getenv("PRICE_STALE_THRESHOLD", "3600"))


class PriceOracle:
    """
    Provides LIFE++ / USDT price for system calculations.

    Thread-safe, single-writer.  In production the price is updated
    by an external feed; in MVP it is a configurable constant.
    """

    def __init__(
        self,
        initial_price: float = _DEFAULT_LIFEPP_USDT_PRICE,
        stale_threshold_seconds: int = _STALE_THRESHOLD_SECONDS,
    ) -> None:
        if initial_price <= 0:
            raise ValueError(
                f"LIFE++ price must be positive, got {initial_price}"
            )
        self._price = initial_price
        self._updated_at = time.monotonic()
        self._stale_threshold = stale_threshold_seconds

    @property
    def lifepp_usdt_price(self) -> float:
        """Current LIFE++ price in USDT."""
        age = time.monotonic() - self._updated_at
        if age > self._stale_threshold:
            logger.warning(
                "Price oracle stale",
                extra={"age_seconds": age, "threshold": self._stale_threshold},
            )
        return self._price

    def update_price(self, new_price: float) -> None:
        """Update the LIFE++ / USDT price (external feed callback)."""
        if new_price <= 0:
            raise ValueError(
                f"LIFE++ price must be positive, got {new_price}"
            )
        old_price = self._price
        self._price = new_price
        self._updated_at = time.monotonic()
        logger.info(
            "Price oracle updated",
            extra={"old_price": old_price, "new_price": new_price},
        )

    def lifepp_to_usdt(self, amount_lifepp: float) -> float:
        """Convert LIFE++ amount to USDT equivalent."""
        return amount_lifepp * self._price

    def usdt_to_lifepp(self, amount_usdt: float) -> float:
        """Convert USDT amount to LIFE++ equivalent."""
        return amount_usdt / self._price

    @property
    def is_stale(self) -> bool:
        """Whether the current price is considered stale."""
        return (time.monotonic() - self._updated_at) > self._stale_threshold
