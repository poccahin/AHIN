export default function GovernanceTopBar() {
  const commitRef = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local-build";

  return (
    <header className="governance-topbar" aria-label="AHIN governance terminal status">
      <div className="topbar-identity">
        <p>AHIN Governance Terminal</p>
        <h1>LIFE++ Foundation Control Plane</h1>
        <span>Treasury Funding Readiness Evidence</span>
      </div>
      <div className="governance-topbar-status">
        <span>Solana mainnet · readonly status</span>
        <span>Case GOV-2026-0518-EVD</span>
        <span>Phase G1</span>
        <span>Audit trail · enabled</span>
        <span>Commit · {commitRef}</span>
      </div>
    </header>
  );
}
