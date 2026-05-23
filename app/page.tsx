import Gatekeeper from "@/src/components/Gatekeeper";
import MatrixReveal from "@/src/gate/MatrixReveal";

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <Gatekeeper>
      <main className="ahin-gate-scene fixed inset-0 overflow-auto bg-[#050505] text-white">
        <div className="living-light-field" aria-hidden="true" />
        <div className="gate-depth-grid" aria-hidden="true" />
        <MatrixReveal />
      </main>
    </Gatekeeper>
  );
}
