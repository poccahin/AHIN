import ActiveHashNetworkSimulator from "@/src/components/active-hash-network/ActiveHashNetworkSimulator";

export const metadata = {
  title: "AHIN Active Hash Interaction Network",
  description: "Readonly AHIN force-graph simulator for active hash interaction evidence."
};

export default function ActiveHashPage() {
  return <ActiveHashNetworkSimulator />;
}
