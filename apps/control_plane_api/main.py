"""
Control Plane API — Life++ Agent OS FastAPI application.

This is the administrative and operational interface for:
  - Agent registration and AHIN admission
  - CognitiveTask submission and status
  - Wallet and ledger queries
  - Settlement triggers
  - Edge terminal sync
"""
from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.control_plane_api.routers import (
    agents_router,
    tasks_router,
    wallet_router,
    settlement_router,
    edge_router,
    ahin_router,
)

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Life++ Agent OS — Control Plane",
    description=(
        "Cognitive objectification, trust coordination, and value-settlement OS. "
        "Aligned with Prof. Cai Hengjin's theoretical framework."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agents_router.router, prefix="/v1/agents", tags=["Agents"])
app.include_router(tasks_router.router, prefix="/v1/tasks", tags=["CognitiveTasks"])
app.include_router(wallet_router.router, prefix="/v1/wallet", tags=["Wallet"])
app.include_router(settlement_router.router, prefix="/v1/settlement", tags=["Settlement"])
app.include_router(edge_router.router, prefix="/v1/edge", tags=["Edge"])
app.include_router(ahin_router.router, prefix="/v1/ahin", tags=["AHIN"])


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "system": "Life++ Agent OS"}
