# Life++ Agent OS

> **A Cognitive Objectification Operating System aligned with Prof. Cai Hengjin's theoretical framework.**

This is **not** a generic AI agent platform.
This is **not** a Web3 payment app.
This is a **cognitive–economic–operational system** — a runtime for the generation, routing, verification, and settlement of Cognitive Canxian across human nodes, digital avatars, edge terminals, and machine agents.

---

## Theoretical Foundation

Every design decision in this system is grounded in Prof. Cai Hengjin's Life++ theoretical framework:

| Concept | System Implementation |
|---|---|
| **Cognitive Canxian** | `CanxianArtifact` — objectification of cognitive effort |
| **Tactile Brain Hypothesis** | Edge terminals with `grounding_context` anchoring |
| **Causation Re-engineering** | `BaseAgent.verify_causation()` + zombie detection |
| **Life+ Objectification** | Persistent `CanxianArtifactORM` + `ObjectificationReceipt` |
| **AHIN** | `AhinNode` + `AssociationGraph` + `InteractionHasher` |
| **Spontaneous Time Order** | `LocalTimeSequencer` + hash-chained `SpontaneousTimeOrder` |
| **POC** | `POCService` — validates meaningful cognitive contribution |
| **Aligned Virtue & Well-being** | `VirtueWellbeingDistributor` — POC-proportional settlement |
| **Continuous Spectrum Topology** | `TrustWeightModel` — directional, decaying trust weights |

---

## Architecture

```
+------------------------------------------------------------------+
|                     Control Plane API (FastAPI)                   |
|   /v1/agents  /v1/tasks  /v1/wallet  /v1/settlement  /v1/ahin    |
+------------------------------+-----------------------------------+
                               |
+------------------------------v-----------------------------------+
|                      Agent OS Kernel Layer                        |
|  AgentKernel  ExecutionSupervisor  PolicyEngine  Capability      |
|  Registry  TrustWeightModel  CognitiveMemoryStore                |
+------+--------------------+-------------------+------------------+
       |                    |                   |
+------v------+   +---------v-------+   +-------v------------+
| Canxian     |   | AHIN Network    |   | Value Flow         |
| Layer       |   | Layer           |   | Layer              |
|             |   |                 |   |                    |
| Canxian     |   | AhinNode        |   | WalletService      |
| Artifact    |   | AssociationGraph|   | PaymentIntent      |
| POCService  |   | InteractionHash |   | TransferEngine     |
| Validation  |   | LocalTimeSeq    |   | LedgerService      |
+------+------+   +---------+-------+   +-------+------------+
       |                    |                   |
       +--------------------v-------------------+
                            |
+------------------------------v-----------------------------------+
|                      Settlement Layer                             |
|  SettlementService  VirtueWellbeingDistributor  DayClose         |
|  ReconciliationService  VirtueWellbeingSettlementBatch            |
+------------------------------+-----------------------------------+
                               |
+------------------------------v-----------------------------------+
|                   Embodiment Layer (Edge)                         |
|  EdgeRuntime  PaymentCoordinator  LocalTransactionStore          |
|  OfflineSyncManager  ReceiptProofService                          |
+------------------------------------------------------------------+
```

---

## Monorepo Structure

```
/apps
  /control_plane_api      FastAPI control plane
  /edge_terminal          Edge terminal entry point
  /settlement_worker      Day-close cron worker

/packages
  /agent_kernel           BaseAgent, AgentKernel, ExecutionSupervisor
  /capability_registry    Capability to agent routing
  /policy_engine          Anti-spam, anti-zombie, rate limiting
  /cognitive_memory       Episodic + semantic memory for agents
  /ahin_network           AhinNode, AssociationGraph, InteractionHasher, LocalTimeSequencer, TrustWeightModel
  /value_flow             WalletService, PaymentIntentService, TransferEngine
  /ledger                 LedgerService (append-only), POCService
  /settlement             SettlementService, VirtueWellbeingDistributor, DayCloseService
  /edge_runtime           EdgeRuntime, LocalTransactionStore, OfflineSyncManager
  /event_bus              EventBus (in-process), RedisEventBus (production)
  /observability          OpenTelemetry hooks
  /shared                 Domain models, ORM, events, theory mapping
```

---

## Domain Vocabulary (MANDATORY)

| Generic Term | Life++ Term | Reason |
|---|---|---|
| Task | `CognitiveTask` | Represents subjective intentionality to be processed |
| OutputArtifact | `CanxianArtifact` | Objectification/solidification of cognitive effort |
| WorkflowEvent | `AssociationEvent` | AHIN proactive/acceptance interactions |
| PaymentEvent | `ValueFlowEvent` | Energy flow, not mere payment |
| AgentScore | `TrustWeight` | Emergent from interaction, not centrally scored |
| ContributionRecord | `POCRecord` | Proof of Cognitive Canxian |
| LocalReceipt | `ObjectificationReceipt` | Proof of Life+ externalization |
| SettlementBatch | `VirtueWellbeingSettlementBatch` | Aligned virtue and well-being |
| User/AgentNode | `DigitalAvatarNode` | Human-AI symbiotic actor |
| GlobalState | `DataOntologyState` | Human-verified ground truth |
| Timestamp | `SpontaneousTimeOrder` | Locally-emergent interaction ordering |

---

## Core Distinction: Four Levels of Output

The system distinguishes between:

1. **`RAW_OUTPUT`** — mere model output (no grounding, no causal evidence)
2. **`OPERATIONALLY_GROUNDED`** — anchored to real context (non-empty `grounding_context`)
3. **`VALIDATED_CANXIAN`** — POC-validated cognitive objectification
4. **`PAYABLE`** — eligible for VirtueWellbeing settlement

Only level 3+ artifacts contribute to `contribution_credit` and VirtueWellbeing settlement.

---

## Token Model (LIFE++)

- **Fixed supply** on Solana — no inflation
- **Admission stake**: agent must hold >= 10 USDT equivalent in LIFE++ to join AHIN
- **Collaboration cost**: `min(0.00001 USDT equivalent in LIFE++, 1 LIFE++)` per interaction
- **Settlement**: proportional to `cognitive_score` from POCRecords (not capital stake)
- **Treasury**: default 5% of settlement pool

### Account Types (MUST NOT be collapsed)

| Account | Purpose |
|---|---|
| `capital_stake` | AHIN admission stake (locked) |
| `payment_balance` | Operational spendable balance |
| `contribution_credit` | POC-earned credits |
| `trust_weight` | Emergent trust metric (not currency) |
| `settlement_claim` | Pending settlement obligation |
| `locked_participation` | Locked during active task participation |

---

## Ledger Rules (STRICT)

- **Append-only**: no UPDATE or DELETE on `journal_entry` rows
- **Derived balances**: computed by summing entries — never stored
- **Every action** maps to journal entries
- **Idempotency key**: retry-safe, prevents double-spend
- **Double-entry**: every debit has a corresponding credit

---

## Quick Start

```bash
# 1. Setup
cp .env.example .env

# 2. Start infrastructure
docker-compose up -d postgres redis

# 3. Start control plane
docker-compose up control_plane

# 4. Run sample workflow
PYTHONPATH=. python scripts/sample_workflow.py

# 5. Run tests
PYTHONPATH=. pytest tests/ -v
```

---

## Theory Reference

See `packages/shared/theory_mapping.py` for the complete Theory-to-System mapping.

---

*This is a cognitive objectification operating system for the Life++ paradigm.*
