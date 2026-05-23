import { AhinGateway } from '@/components/AhinGateway';

export default function Page() {
  return <AhinGateway />;
}

// Force this route segment to be rendered dynamically — it's an interactive
// 3D app, no SSR benefit. (Next.js App Router segment config.)
export const dynamic = 'force-dynamic';
