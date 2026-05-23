import Gatekeeper from "@/src/components/Gatekeeper";
import { AhinGateway } from "@/src/components/gateway/AhinGateway";

export default function Page() {
  return (
    <Gatekeeper>
      <div className="ahin-bloom-enter">
        <AhinGateway />
      </div>
    </Gatekeeper>
  );
}
