"""Edge terminal routers package."""
from apps.edge_terminal.routers import (
    audit_router,
    interaction_router,
    payment_router,
    sync_router,
)

__all__ = ["payment_router", "interaction_router", "sync_router", "audit_router"]
