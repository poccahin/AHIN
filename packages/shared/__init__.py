"""
packages/shared — Domain vocabulary, base schemas, and primitives.

This package is the philosophical bedrock of Life++.
Every model, schema, and event in the system derives from here.
The naming conventions MUST follow Prof. Cai Hengjin's theoretical framework:
  - Agent  → cognitive-economic actor
  - Task   → CognitiveTask (subjective intentionality to be processed)
  - Output → CanxianArtifact (objectification/solidification of cognitive effort)
  - Workflow Event → AssociationEvent (proactive / acceptance)
  - Payment → ValueFlowEvent
  - Ledger → Cognitive Value Ledger
  - Receipt → ObjectificationReceipt
  - Settlement → VirtueWellbeingSettlement
"""
from packages.shared.domain import *  # noqa: F401,F403
