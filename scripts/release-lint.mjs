import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const checks = [];

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function listFiles(relativeDir) {
  const absoluteDir = join(root, relativeDir);
  if (!existsSync(absoluteDir)) {
    return [];
  }
  return readdirSync(absoluteDir).flatMap((entry) => {
    const relativePath = join(relativeDir, entry);
    const absolutePath = join(root, relativePath);
    if (statSync(absolutePath).isDirectory()) {
      return listFiles(relativePath);
    }
    return [relativePath];
  });
}

function check(name, passed, detail) {
  checks.push({ name, passed, detail });
}

const page = read("app/page.tsx");
const layout = read("app/layout.tsx");
const scene = read("src/gate/AhinGateScene.tsx");
const gateCard = read("src/gate/GateCard.tsx");
const gatekeeper = read("src/components/Gatekeeper.tsx");
const motion = read("src/gate/motion.ts");
const css = read("src/gate/ahin-gate.css");
const env = read(".env.example");
const lifePlusConfig = read("src/config/life-plus.ts");
const oracle = read("functions/api/oracle/jupiter/lifepp.ts");
const policyReport = JSON.parse(read("reports/ahin-lifeplus-admission-policy.json"));
const trustedTwinReport = JSON.parse(read("reports/ahin-r0-g2-trusted-twin-court-readiness.json"));
const terminalGovernanceReport = JSON.parse(read("reports/ahin-r0-g3-production-terminal-governance-console.json"));
const activeHashReport = JSON.parse(read("reports/ahin-r0-g4-active-hash-simulator-import.json"));
const slashingSimulationReport = JSON.parse(read("reports/ahin-r0-g4b-slashing-simulation-import.json"));
const boardroomHudReport = JSON.parse(read("reports/ahin-r0-g4c-boardroom-hud-import.json"));
const runtimeAuditSurfaceReport = JSON.parse(read("reports/ahin-r0-runtime-audit-surface-reduction.json"));
const rootProductionSmokeReport = JSON.parse(read("reports/ahin-root-production-deploy-final-smoke.json"));
const srcFiles = listFiles("src").filter((file) => /\.(css|ts|tsx)$/.test(file));
const functionFiles = listFiles("functions").filter((file) => /\.(ts|tsx|js|mjs)$/.test(file));
const srcAndFunctionSource = [...srcFiles, ...functionFiles].map((file) => read(file)).join("\n");
const srcNonTestSource = srcFiles
  .filter((file) => !file.includes("__tests__"))
  .map((file) => read(file))
  .join("\n");
const visibleGateCopy = [
  gateCard,
  gatekeeper,
  read("src/gate/AgentInfoCard.tsx"),
  read("src/gate/MatrixReveal.tsx"),
  read("src/gate/ValidationStatusBar.tsx"),
  read("src/gate/wallet/mock-fallback.ts"),
  read("src/gate/matrix/AgentMatrixScene.tsx"),
  read("src/gate/matrix/MatrixHeader.tsx"),
  read("src/gate/matrix/AgentInspector.tsx"),
  read("src/gate/matrix/AgentFlowRail.tsx"),
  read("src/gate/matrix/ProofEnvelopeModal.tsx"),
  read("src/components/governance/GovernanceConsole.tsx"),
  read("src/components/governance/GovernanceTopBar.tsx"),
  read("src/components/governance/GovernancePhaseStrip.tsx"),
  read("src/components/governance/FiveAgentTopology.tsx"),
  read("src/components/governance/ResponsibilityRail.tsx"),
  read("src/components/governance/TreasuryCustodyCard.tsx"),
  read("src/components/governance/GovernanceInspector.tsx"),
  read("src/components/governance/GovernanceFooter.tsx"),
  read("src/components/trusted-twin/TrustedTwinCourt.tsx"),
  read("src/components/trusted-twin/EndgameSealModal.tsx"),
  read("src/components/trusted-twin/OfflineVerifierPanel.tsx"),
  read("src/components/trusted-twin/CircuitBreakerCertificate.tsx"),
  read("src/components/trusted-twin/TrilingualSeal.tsx"),
  read("src/components/trusted-twin/trusted-twin-data.ts"),
  read("app/active-hash/page.tsx"),
  read("src/components/active-hash-network/ActiveHashNetworkSimulator.tsx"),
  read("src/components/active-hash-network/Scene.tsx"),
  read("src/components/active-hash-network/Links.tsx"),
  read("src/components/active-hash-network/VoxelInstancedField.tsx"),
  read("src/components/active-hash-network/ParticleField.tsx"),
  read("src/components/active-hash-network/SlashingSequence.tsx"),
  read("src/components/active-hash-network/ShatteringNode.tsx"),
  read("src/components/active-hash-network/AshBurst.tsx"),
  read("src/components/active-hash-network/hud/HudOverlay.tsx"),
  read("src/components/active-hash-network/hud/TopBar.tsx"),
  read("src/components/active-hash-network/hud/MilestoneButtons.tsx"),
  read("src/components/active-hash-network/hud/Timeline.tsx"),
  read("src/components/active-hash-network/hud/ProtocolLayerStrip.tsx"),
  read("src/components/active-hash-network/hud/KillSwitch.tsx"),
  read("src/components/active-hash-network/hud/design.ts"),
  read("src/lib/active-hash/milestoneActions.ts"),
  read("src/lib/active-hash/constants/nodeTypes.ts"),
  read("src/lib/active-hash/state/networkStore.ts"),
  read("src/lib/active-hash/state/slashStore.ts")
].join("\n");
const liveOperationCopySource = visibleGateCopy
  .replaceAll("Genesis Ignition", "")
  .replaceAll("genesis-ignition", "");

check(
  "App Router page renders mock Gatekeeper and Matrix",
  page.includes("Gatekeeper") && page.includes("MatrixReveal"),
  "app/page.tsx should render Gatekeeper with MatrixReveal as authenticated child content."
);
check(
  "Production default starts at Gatekeeper",
  scene.includes('debugMatrix ? "matrix_active" : "idle"'),
  "AhinGateScene should use idle unless NEXT_PUBLIC_AHIN_DEBUG_MATRIX=true."
);
check(
  "Gate state machine includes production states",
  [
    '"idle"',
    '"wallet_selecting"',
    '"wallet_connected"',
    '"asset_checking"',
    '"asset_verified"',
    '"signature_pending"',
    '"signature_verified"',
    '"matrix_revealing"',
    '"matrix_active"'
  ].every((state) => scene.includes(state)),
  "GateState is missing one or more required states."
);
check(
  "Readonly evidence disclosure is present",
  gatekeeper.includes("Readonly evidence mode. On-chain wallet adapters are not enabled in this build.") || gateCard.includes("Readonly evidence mode"),
  "Gatekeeper must disclose readonly evidence mode."
);
check(
  "Debug Matrix env is documented as false",
  env.includes("NEXT_PUBLIC_AHIN_DEBUG_MATRIX=false"),
  ".env.example must document the production-safe debug value."
);
check(
  "Wallet mode is documented as mock",
  env.includes("NEXT_PUBLIC_AHIN_WALLET_MODE=mock"),
  ".env.example must document mock wallet mode for this release."
);
check(
  "Gate and Matrix motion contract is present",
  motion.includes("duration: 0.82") &&
    motion.includes('filter: "blur(22px)"') &&
    motion.includes("duration: 1.05") &&
    motion.includes("staggerChildren: 0.12"),
  "motion.ts must keep the production transition timings."
);
check(
  "Per-element logo glow filters are present",
  [
    ".agent-genesis-orange img",
    ".agent-rule-purple img",
    ".agent-compute-blue img",
    ".agent-contract-gold img",
    ".agent-eco-green img"
  ].every((selector) => css.includes(selector)),
  "ahin-gate.css must include per-element logo image filters."
);
check(
  "Reduced motion is supported",
  css.includes("@media (prefers-reduced-motion: reduce)"),
  "Reduced motion media query is required."
);
check(
  "Cleaned production logo assets exist",
  [
    "lifepp-genesis-orange.png",
    "lifepp-rule-purple.png",
    "lifepp-compute-blue.png",
    "lifepp-contract-gold.png",
    "lifepp-eco-green.png"
  ].every((file) => existsSync(join(root, "public/agents", file))),
  "All five production logo assets must be present."
);

check(
  "Phase 4E unsafe transfer entry copy is absent",
  !visibleGateCopy.includes("Transfer 1 $LIFE++") && !visibleGateCopy.includes("Burn 1 $LIFE++"),
  "Visible Gate or Matrix copy must not ask users to transfer or burn LIFE++."
);
check(
  "Phase 4E readonly admission copy is present",
  visibleGateCopy.includes("Verify 10 USDT-equivalent LIFE++ Holding") &&
    visibleGateCopy.includes("Enter Governance Console") &&
    visibleGateCopy.includes("Enter with Dry-Run Proof"),
  "Gate copy must describe readonly holding verification and dry-run proof entry."
);
check(
  "Phase 4E permanent disclosure is present",
  visibleGateCopy.includes("Readonly evidence mode · No real wallet balance checked unless explicitly connected · No LIFE++ transferred or burned"),
  "Gate proof/action area must disclose readonly evidence mode and no transfer or burn."
);
check(
  "Phase 4E Proof of Assets policy is visible",
  visibleGateCopy.includes("Admission threshold: ≥ 10 USDT-equivalent LIFE++") &&
    visibleGateCopy.includes("LIFE++ mint:") &&
    visibleGateCopy.includes("Quote source: Jupiter readonly") &&
    visibleGateCopy.includes("No transfer or burn will be executed"),
  "Proof of Assets panel must show threshold, mint, quote source, and no-transfer/no-burn policy."
);
check(
  "No wallet signing API exists in src",
  !srcAndFunctionSource.includes("signAndSendTransaction"),
  "src/functions must not expose signAndSendTransaction."
);
check(
  "Runtime Web3 dependency imports are absent",
  !/@solana\/wallet-adapter-react|@solana\/web3\.js|from\s+["']wagmi|from\s+["']wagmi\/|from\s+["']viem/.test(srcAndFunctionSource),
  "src/functions must not import Solana wallet adapters, @solana/web3.js, wagmi, or viem in readonly evidence mode."
);
check(
  "No Solana transfer instruction path exists in src",
  !/(transferLifePlusToFoundation|createTransferCheckedInstruction|createAssociatedTokenAccountIdempotentInstruction|sendRawTransaction|sendTransaction|signAndSendTransaction|TransactionInstruction|SystemProgram|SYSVAR_RENT_PUBKEY|createBurnInstruction|burnChecked)/.test(
    srcAndFunctionSource
  ),
  "src/functions must not include Solana transfer, burn, signing, or submission helpers."
);
check(
  "Protocol execution remains disabled",
  lifePlusConfig.includes("TRANSFER_ENABLED = false") &&
    lifePlusConfig.includes("BURN_ENABLED = false") &&
    lifePlusConfig.includes("PROTOCOL_EXECUTION_ENABLED = false") &&
    policyReport.transferEnabled === false &&
    policyReport.burnEnabled === false &&
    policyReport.protocolExecutionEnabled === false &&
    !srcNonTestSource.includes("protocolExecutionEnabled: true"),
  "Phase 4E must remain readonly/mock with protocol execution disabled."
);
check(
  "Readonly Jupiter oracle policy metadata is present",
  oracle.includes('mode: "readonly"') &&
    oracle.includes("admissionThresholdUsd") &&
    oracle.includes("collaborationUsageRule") &&
    oracle.includes("lifePlusMint") &&
    oracle.includes("inputMint") &&
    oracle.includes("outputMint") &&
    oracle.includes("quoteHash") &&
    oracle.includes("realWalletTransfer: false") &&
    oracle.includes("realBurnTransaction: false"),
  "Oracle response must include readonly policy metadata."
);
check(
  "Oracle API key remains server-side only",
  oracle.includes("JUPITER_API_KEY") &&
    oracle.includes('headers["x-api-key"]') &&
    !oracle.slice(oracle.indexOf("const body")).includes("JUPITER_API_KEY") &&
    !oracle.includes("NEXT_PUBLIC_JUPITER"),
  "Oracle may use JUPITER_API_KEY only as a request header and must never expose it in response bodies or NEXT_PUBLIC variables."
);
check(
  "Phase 4E-2 Gate errors fail soft",
  !gatekeeper.includes("setWalletError(error instanceof Error ? error.message") &&
    gatekeeper.includes("formatWalletConnectionError(walletLabel, error)") &&
    gatekeeper.includes("Readonly quote unavailable. You can continue in readonly evidence mode."),
  "Gate must not render raw wallet/RPC/Jupiter errors directly."
);
check(
  "Phase 4E-2 Oracle parse errors fail soft",
  oracle.includes("createUnavailableBody") &&
    oracle.includes('status: "quote_unavailable"') &&
    oracle.includes("Readonly quote unavailable. You can continue in readonly evidence mode.") &&
    !oracle.includes("return json({ error: error instanceof Error ? error.message") &&
    !oracle.slice(oracle.indexOf("createBaseMetadata")).includes("payload.error"),
  "Oracle must not echo raw Jupiter payload errors or API failure details."
);
check(
  "Phase 4C oracle defaults omitted outputMint to LIFE++",
  oracle.includes('const inputMint = validateSolanaMint(requestUrl.searchParams.get("inputMint"), "inputMint")') &&
    oracle.includes('const outputMint = validateSolanaMint(requestUrl.searchParams.get("outputMint") ?? lifeMint, "outputMint")') &&
    oracle.includes("lifepp:readonly:v2") &&
    oracle.includes("status: \"quote_unavailable\"") &&
    !oracle.includes("validateLifeMint"),
  "Oracle must require inputMint, default omitted outputMint to LIFE++, and avoid rejecting SOL->LIFE++ as an invalid LIFE++ route."
);
check(
  "Phase 4C oracle mutation and invalid params guards remain",
  oracle.includes('context.request.method !== "GET"') &&
    oracle.includes("status: 405") &&
    oracle.includes("validateAmount") &&
    oracle.includes("status: 400"),
  "Oracle must keep GET-only behavior, 405 mutation rejection, and 400 invalid-param rejection."
);
check(
  "Phase 4F command deck safety copy is visible",
  visibleGateCopy.includes("Five Elements Online") &&
    visibleGateCopy.includes("Protocol Execution: Disabled") &&
    visibleGateCopy.includes("LIFE++ Transfer: Disabled") &&
    visibleGateCopy.includes("Readonly evidence mode · No LIFE++ transferred or burned · Protocol execution disabled") &&
    visibleGateCopy.includes("No LIFE++ transferred or burned"),
  "Post-gate Matrix must expose readonly protocol boundaries."
);
check(
  "Phase 4F proof envelope remains dry-run only",
  visibleGateCopy.includes("protocolExecutionEnabled: false") &&
    visibleGateCopy.includes("realWalletTransfer: false") &&
    visibleGateCopy.includes("realBurnTransaction: false"),
  "Proof modal must include dry-run safety flags."
);
check(
  "Production governance safety language is visible",
  [
    "Protocol execution disabled",
    "LIFE++ transfer disabled",
    "Burn disabled",
    "Signing disabled",
    "Treasury funding blocked",
    "Oracle readonly",
    "No transaction submission",
    "Readonly evidence mode",
    "AHIN Governance Terminal",
    "LIFE++ Foundation Control Plane",
    "Treasury Funding Readiness Evidence",
    "onChainSubmitted=false"
  ].every((copy) => visibleGateCopy.includes(copy)),
  "Root governance console must expose production readonly/dry-run safety boundaries."
);
check(
  "Post-deploy root copy is production-current",
  layout.includes('title: "AHIN Governance Terminal"') &&
    visibleGateCopy.includes("Root domain status") &&
    visibleGateCopy.includes("Active on ahin.io via Cloudflare Pages") &&
    !visibleGateCopy.includes("Approved by operator, but not yet deployed in this patch") &&
    !visibleGateCopy.includes("Root domain takeover"),
  "Root production UI must not retain pre-deploy takeover copy and must expose the Governance Terminal title."
);
check(
  "Production UI forbidden live-operation copy is absent",
  [
    "Transfer 1 $LIFE++",
    "Burn 1 $LIFE++",
    "sign transaction",
    "submit transaction",
    "mainnet transfer",
    "protocol live",
    "ignition",
    "real burn",
    "unlock breaker",
    "SOC 2 Type II certified",
    "ISO 27001 certified",
    "本体已亲签",
    "已写入链",
    "FIDO2 · 指纹 · 私钥",
    "链上凭证",
    "2 / 3 已签",
    "不可撤销之意志"
  ].every((copy) => !liveOperationCopySource.toLowerCase().includes(copy.toLowerCase())),
  "Visible production UI must not claim live operation, fake certification, transfer, burn, signing, or transaction submission."
);
check(
  "Trusted Twin Court readiness layer is visible and safe",
  [
    "AHIN Trusted Twin Court v1.0",
    "Human Finality Evidence Layer",
    "Readiness Certificate",
    "Causal Replay Terminal",
    "Readonly replay · no ledger state modified",
    "Circuit breaker draft",
    "Trilingual certificate draft",
    "onChainSubmitted",
    "signatureRequestGenerated",
    "false"
  ].every((copy) => visibleGateCopy.includes(copy)) &&
    !visibleGateCopy.includes("<script") &&
    visibleGateCopy.includes("5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo"),
  "Trusted Twin Court UI must be a React readiness layer with safe certificate/verifier/circuit-breaker/trilingual copy."
);
check(
  "Phase R0-G3 terminal governance console is recorded",
  terminalGovernanceReport.phase === "Phase R0-G3 Production Terminal Governance Console" &&
    terminalGovernanceReport.deploymentExecuted === false &&
    terminalGovernanceReport.workflowDispatched === false &&
    terminalGovernanceReport.rootDomainTouched === false &&
    terminalGovernanceReport.mockFacingLanguageRemoved === true &&
    terminalGovernanceReport.terminalGovernanceConsoleImplemented === true &&
    terminalGovernanceReport.canonicalTreasuryMultisigAddress === "5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo" &&
    terminalGovernanceReport.treasuryFundingEnabled === false &&
    terminalGovernanceReport.protocolExecutionEnabled === false &&
    terminalGovernanceReport.realWalletTransfer === false &&
    terminalGovernanceReport.realBurnTransaction === false &&
    terminalGovernanceReport.signingEnabled === false &&
    terminalGovernanceReport.transactionSubmissionEnabled === false &&
    terminalGovernanceReport.onChainSubmitted === false &&
    terminalGovernanceReport.biometricVerificationClaimed === false &&
    terminalGovernanceReport.webauthnImplemented === false &&
    terminalGovernanceReport.certificationClaimed === false,
  "R0-G3 report must record the production terminal UI and all disabled execution boundaries."
);
check(
  "Trusted Twin Court readiness report is recorded",
  trustedTwinReport.phase === "Phase R0-G2 Trusted Twin Court Readiness" &&
    trustedTwinReport.deploymentExecuted === false &&
    trustedTwinReport.workflowDispatched === false &&
    trustedTwinReport.rootDomainTouched === false &&
    trustedTwinReport.webauthnImplemented === false &&
    trustedTwinReport.biometricVerificationClaimed === false &&
    trustedTwinReport.onChainSubmitted === false &&
    trustedTwinReport.multisigStateMutated === false &&
    trustedTwinReport.protocolExecutionEnabled === false &&
    trustedTwinReport.realWalletTransfer === false &&
    trustedTwinReport.realBurnTransaction === false &&
    trustedTwinReport.signingEnabled === false &&
    trustedTwinReport.trustKernelArchived === true &&
    trustedTwinReport.offlineVerifierArchived === true &&
    trustedTwinReport.finalSealReadinessImplemented === true &&
    trustedTwinReport.circuitBreakerReadinessImplemented === true &&
    trustedTwinReport.trilingualCertificateArchived === true &&
    trustedTwinReport.inlineScriptUsed === false &&
    trustedTwinReport.canonicalTreasuryMultisigAddress === "5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo",
  "Trusted Twin Court report must record readiness-only boundaries and canonical treasury multisig."
);
check(
  "Phase 4E admission policy report is recorded",
  policyReport.phase === "Phase 4E" &&
    policyReport.lifePlusMint === "7YdwpERJjzw7UVojxLpvu5ycKBRdYaxaKn4HvoHLpump" &&
    policyReport.fixedSupply === true &&
    policyReport.currentSupply === "993953256.43115" &&
    policyReport.admissionThresholdUsdEquivalent === 10 &&
    policyReport.collaborationUsageRule === "min(1 USDT, 1 LIFE++)" &&
    policyReport.jupiterReadonly === true &&
    policyReport.secretExposure === false,
  "reports/ahin-lifeplus-admission-policy.json must record Phase 4E LIFE++ policy facts."
);
check(
  "Phase R0-G4 active hash simulator is isolated and readonly",
  read("app/active-hash/page.tsx").includes("ActiveHashNetworkSimulator") &&
    visibleGateCopy.includes("Simulation only · no real slashing · no transfer · no burn · no signing · no treasury mutation") &&
    visibleGateCopy.includes("Genesis Orange") &&
    visibleGateCopy.includes("Rule Purple / Sentinel") &&
    visibleGateCopy.includes("Compute Blue / Routing") &&
    visibleGateCopy.includes("Contract Gold / Settlement") &&
    visibleGateCopy.includes("Eco Green") &&
    visibleGateCopy.includes("backendMutation: false") &&
    visibleGateCopy.includes("walletCalls: false") &&
    visibleGateCopy.includes("chainCalls: false") &&
    visibleGateCopy.includes("transactionSubmissionEnabled: false"),
  "Active Hash simulator must live at /active-hash with visible readonly/no-execution/no-wallet/no-chain boundaries."
);
check(
  "Phase R0-G4 active hash simulator report is recorded",
  activeHashReport.phase === "Phase R0-G4 Active Hash Interaction Simulator Import" &&
    activeHashReport.deploymentExecuted === false &&
    activeHashReport.workflowDispatched === false &&
    activeHashReport.rootDomainTouched === false &&
    activeHashReport.simulatorRoute === "/active-hash" &&
    activeHashReport.protocolExecutionEnabled === false &&
    activeHashReport.realWalletTransfer === false &&
    activeHashReport.realBurnTransaction === false &&
    activeHashReport.signingEnabled === false &&
    activeHashReport.transactionSubmissionEnabled === false &&
    activeHashReport.treasuryMutationEnabled === false &&
    activeHashReport.sourceArchive === "ahin-gateway-phase1.tar.gz",
  "R0-G4 report must record the isolated active-hash simulator route and all disabled execution boundaries."
);
check(
  "Phase R0-G4B slashing simulation is visual-only",
  visibleGateCopy.includes("Trigger Slashing Simulation") &&
    visibleGateCopy.includes("Reset Simulation") &&
    visibleGateCopy.includes("Slash Random Node") &&
    visibleGateCopy.includes("PoCC violation detected · simulation only") &&
    visibleGateCopy.includes("ChainRank impact simulated · no asset movement") &&
    visibleGateCopy.includes("Node banished from local topology simulation") &&
    visibleGateCopy.includes("No on-chain transaction") &&
    visibleGateCopy.includes("realSlashingEnabled: false") &&
    visibleGateCopy.includes("treasuryMutationEnabled: false"),
  "Active Hash slashing controls must be local visual simulation with no on-chain, transfer, burn, signing, or treasury mutation path."
);
check(
  "Phase R0-G4B slashing simulation report is recorded",
  slashingSimulationReport.phase === "Phase R0-G4B Slashing Visual Simulation Import" &&
    slashingSimulationReport.deploymentExecuted === false &&
    slashingSimulationReport.workflowDispatched === false &&
    slashingSimulationReport.rootDomainTouched === false &&
    slashingSimulationReport.route === "/active-hash" &&
    slashingSimulationReport.slashingSimulationEnabled === true &&
    slashingSimulationReport.realSlashingEnabled === false &&
    slashingSimulationReport.protocolExecutionEnabled === false &&
    slashingSimulationReport.realWalletTransfer === false &&
    slashingSimulationReport.realBurnTransaction === false &&
    slashingSimulationReport.signingEnabled === false &&
    slashingSimulationReport.transactionSubmissionEnabled === false &&
    slashingSimulationReport.treasuryMutationEnabled === false &&
    slashingSimulationReport.sourceArchive === "ahin-gateway-phase2.tar.gz",
  "R0-G4B report must record the isolated visual slashing simulation and all disabled execution boundaries."
);
check(
  "Phase R0-G4C boardroom HUD is visual-only and route-isolated",
  visibleGateCopy.includes("Genesis Big Bang") &&
    visibleGateCopy.includes("Genesis Ignition") &&
    visibleGateCopy.includes("Causal Guard") &&
    visibleGateCopy.includes("Macro Evolution") &&
    visibleGateCopy.includes("Past") &&
    visibleGateCopy.includes("Entropy") &&
    visibleGateCopy.includes("Present") &&
    visibleGateCopy.includes("Balanced Graph") &&
    visibleGateCopy.includes("Future") &&
    visibleGateCopy.includes("PoCC Penalty Simulation") &&
    visibleGateCopy.includes("Trigger Slashing Simulation") &&
    visibleGateCopy.includes("Simulation only · no real slashing · no transfer · no burn · no signing · no treasury mutation") &&
    read("src/components/active-hash-network/active-hash-network.css").includes("pointer-events: none") &&
    read("src/components/active-hash-network/active-hash-network.css").includes("pointer-events: auto"),
  "Active Hash boardroom HUD must expose local milestone controls, timeline, visual penalty simulation, and pointer-event pass-through behavior."
);
check(
  "Phase R0-G4C boardroom HUD report is recorded",
  boardroomHudReport.phase === "Phase R0-G4C Boardroom HUD Overlay Import" &&
    boardroomHudReport.deploymentExecuted === false &&
    boardroomHudReport.workflowDispatched === false &&
    boardroomHudReport.rootDomainTouched === false &&
    boardroomHudReport.route === "/active-hash" &&
    boardroomHudReport.boardroomHudEnabled === true &&
    boardroomHudReport.milestoneButtonsEnabled === true &&
    boardroomHudReport.timelineScrubberEnabled === true &&
    boardroomHudReport.slashingSimulationTriggerEnabled === true &&
    boardroomHudReport.realSlashingEnabled === false &&
    boardroomHudReport.protocolExecutionEnabled === false &&
    boardroomHudReport.realWalletTransfer === false &&
    boardroomHudReport.realBurnTransaction === false &&
    boardroomHudReport.signingEnabled === false &&
    boardroomHudReport.transactionSubmissionEnabled === false &&
    boardroomHudReport.treasuryMutationEnabled === false &&
    boardroomHudReport.sourceArchive === "ahin-gateway-phase3.tar(1).gz",
  "R0-G4C report must record the boardroom HUD overlay and all disabled execution boundaries."
);
check(
  "Phase R0 runtime audit surface reduction is recorded",
  runtimeAuditSurfaceReport.phase === "Phase R0 Runtime Audit Surface Reduction" &&
    runtimeAuditSurfaceReport.deploymentExecuted === false &&
    runtimeAuditSurfaceReport.workflowDispatched === false &&
    runtimeAuditSurfaceReport.rootDomainTouched === false &&
    runtimeAuditSurfaceReport.removedRuntimeDependencies.includes("@solana/wallet-adapter-react") &&
    runtimeAuditSurfaceReport.removedRuntimeDependencies.includes("@solana/web3.js") &&
    runtimeAuditSurfaceReport.removedRuntimeDependencies.includes("wagmi") &&
    runtimeAuditSurfaceReport.removedRuntimeDependencies.includes("viem") &&
    runtimeAuditSurfaceReport.protocolExecutionEnabled === false &&
    runtimeAuditSurfaceReport.realWalletTransfer === false &&
    runtimeAuditSurfaceReport.realBurnTransaction === false &&
    runtimeAuditSurfaceReport.signingEnabled === false &&
    runtimeAuditSurfaceReport.transactionSubmissionEnabled === false,
  "R0 runtime audit report must record removed Web3 runtime dependencies and disabled execution boundaries."
);
check(
  "Phase R0 root production final smoke report is recorded",
  rootProductionSmokeReport.phase === "Phase R0 — ahin.io Root Gate Production Deploy" &&
    rootProductionSmokeReport.targetDomain === "https://ahin.io" &&
    rootProductionSmokeReport.rootDomainServingGateUi === true &&
    rootProductionSmokeReport.oracleMode === "readonly" &&
    rootProductionSmokeReport.postOracleStatus === 405 &&
    rootProductionSmokeReport.invalidParamsStatus === 400 &&
    rootProductionSmokeReport.protocolExecutionEnabled === false &&
    rootProductionSmokeReport.realWalletTransfer === false &&
    rootProductionSmokeReport.realBurnTransaction === false &&
    rootProductionSmokeReport.signingEnabled === false &&
    rootProductionSmokeReport.staleCopyDetected === true &&
    rootProductionSmokeReport.staleCopyFixedInLocalPatch === true &&
    rootProductionSmokeReport.deploymentExecuted === false,
  "Root production smoke report must record readonly root smoke, stale copy detection, and local copy-fix readiness without claiming deployment."
);

// --- Phase P2P: dev routes must be gated so they cannot serve in production ---
const devRouteGateModule = read("src/lib/devRouteGate.ts");
const devBalanceRoute = read("app/api/dev/lifepp-balance/route.ts");
const devBuildtxRoute = read("app/api/dev/lifepp-buildtx/route.ts");

check(
  "Dev route gate helper defines the production check",
  devRouteGateModule.includes("NEXT_PUBLIC_AHIN_ENV") &&
    devRouteGateModule.includes("AHIN_ENABLE_DEV_ROUTES") &&
    devRouteGateModule.includes("devRouteNotFoundResponse"),
  "src/lib/devRouteGate.ts must verify NEXT_PUBLIC_AHIN_ENV !== production AND AHIN_ENABLE_DEV_ROUTES === true."
);
check(
  "Dev route /api/dev/lifepp-balance is gated by devRoutesEnabled()",
  devBalanceRoute.includes("devRoutesEnabled") &&
    devBalanceRoute.includes("devRouteNotFoundResponse"),
  "app/api/dev/lifepp-balance/route.ts must import and invoke devRoutesEnabled() before any RPC work."
);
check(
  "Dev route /api/dev/lifepp-buildtx is gated by devRoutesEnabled()",
  devBuildtxRoute.includes("devRoutesEnabled") &&
    devBuildtxRoute.includes("devRouteNotFoundResponse"),
  "app/api/dev/lifepp-buildtx/route.ts must import and invoke devRoutesEnabled() before any RPC work."
);

// --- Phase P2P: payment canary safeguards must remain enforced ---
const lifePlusPaymentConfig = read("src/config/life-plus-payment.ts");
const lifePaymentModule = read("src/components/LifePaymentModule.tsx");

check(
  "Canary config exports isCanaryPaymentAuthorized + PUBLIC_PAYMENT_ENABLED=false",
  lifePlusPaymentConfig.includes("isCanaryPaymentAuthorized") &&
    lifePlusPaymentConfig.includes("PUBLIC_PAYMENT_ENABLED = false") &&
    lifePlusPaymentConfig.includes("AHIN_PAYMENT_CANARY_ENABLED"),
  "src/config/life-plus-payment.ts must keep PUBLIC_PAYMENT_ENABLED=false and expose isCanaryPaymentAuthorized()."
);
check(
  "LifePaymentModule consults isCanaryPaymentAuthorized before broadcast",
  lifePaymentModule.includes("isCanaryPaymentAuthorized") &&
    lifePaymentModule.includes("INFRASTRUCTURE_TRANSFER_ARMED") &&
    lifePaymentModule.includes("confirmSolanaTransaction"),
  "LifePaymentModule must gate broadcasts on isCanaryPaymentAuthorized and confirm via confirmSolanaTransaction."
);
check(
  "LifePaymentModule only fires onSuccess after a confirmation outcome",
  // successCalledRef is checked-and-set at exactly three sites:
  //   1. dry-run confirmed branch
  //   2. canary confirmed branch (after confirmSolanaTransaction === confirmed)
  //   3. resume-in-flight confirmed branch (after checkSignatureStatus === confirmed/finalized)
  // All three happen AFTER a confirmation outcome — never on a bare signature return.
  (lifePaymentModule.match(/successCalledRef\.current = true/g) || []).length === 3 &&
    lifePaymentModule.includes('if (confirmation.result === "confirmed")') &&
    lifePaymentModule.includes("checkSignatureStatus"),
  "LifePaymentModule onSuccess must only fire after a confirmation outcome (dry-run, confirmation poll, or resume-status check)."
);

const failures = checks.filter((item) => !item.passed);

for (const item of checks) {
  const symbol = item.passed ? "PASS" : "FAIL";
  console.log(`${symbol} ${item.name}`);
  if (!item.passed) {
    console.log(`  ${item.detail}`);
  }
}

if (failures.length > 0) {
  process.exitCode = 1;
}
