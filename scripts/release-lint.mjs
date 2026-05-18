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
const scene = read("src/gate/AhinGateScene.tsx");
const gateCard = read("src/gate/GateCard.tsx");
const gatekeeper = read("src/components/Gatekeeper.tsx");
const motion = read("src/gate/motion.ts");
const css = read("src/gate/ahin-gate.css");
const env = read(".env.example");
const lifePlusConfig = read("src/config/life-plus.ts");
const oracle = read("functions/api/oracle/jupiter/lifepp.ts");
const policyReport = JSON.parse(read("reports/ahin-lifeplus-admission-policy.json"));
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
  read("src/components/governance/GovernanceFooter.tsx")
].join("\n");

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
  "No Solana transfer instruction path exists in src",
  !/(transferLifePlusToFoundation|createTransferCheckedInstruction|createAssociatedTokenAccountIdempotentInstruction|sendRawTransaction|TransactionInstruction|SystemProgram|SYSVAR_RENT_PUBKEY)/.test(
    srcAndFunctionSource
  ),
  "src/functions must not include Solana transfer instruction helpers or submission paths."
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
    "Readonly evidence mode"
  ].every((copy) => visibleGateCopy.includes(copy)),
  "Root governance console must expose production readonly/dry-run safety boundaries."
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
    "ISO 27001 certified"
  ].every((copy) => !visibleGateCopy.toLowerCase().includes(copy.toLowerCase())),
  "Visible production UI must not claim live operation, fake certification, transfer, burn, signing, or transaction submission."
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
