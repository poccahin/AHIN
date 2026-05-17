export default function GovernanceFooter() {
  const commitRef = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local-build";

  return (
    <footer className="governance-footer" aria-label="Governance compliance status">
      <span>Readonly · mock verification</span>
      <span>No LIFE++ transferred or burned</span>
      <span>Protocol execution disabled</span>
      <span>Security controls documented</span>
      <span>SOC 2 / ISO 27001 mapping: evidence pending</span>
      <span>Certification status: not claimed</span>
      <span>Hash · {commitRef}</span>
    </footer>
  );
}
