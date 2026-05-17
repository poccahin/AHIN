export default function GovernanceFooter() {
  const commitRef = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local-build";

  return (
    <footer className="governance-footer" aria-label="Governance compliance status">
      <span>Readonly · mock verification</span>
      <span>No LIFE++ transferred or burned</span>
      <span>Protocol execution disabled</span>
      <span>Security controls documented</span>
      <span>Certification evidence pending</span>
      <span>Hash · {commitRef}</span>
    </footer>
  );
}
