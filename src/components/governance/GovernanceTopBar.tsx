export default function GovernanceTopBar() {
  const commitRef = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local-build";

  return (
    <header className="governance-topbar" aria-label="AHIN governance console status">
      <div>
        <p>AHIN Foundation</p>
        <h1>Governance console</h1>
      </div>
      <div className="governance-topbar-status">
        <span>Solana mainnet · readonly status</span>
        <span>Audit trail · enabled</span>
        <span>Version · {commitRef}</span>
      </div>
    </header>
  );
}
