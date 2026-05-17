import type { ComponentType, PropsWithChildren } from "react";
import { Link, Navigate, Outlet, createBrowserRouter } from "react-router-dom";
import { Cpu, FileCheck2, RadioTower, Scale, Sprout } from "lucide-react";
import Gatekeeper from "../components/Gatekeeper";
import BlueWaterAgent from "../agents/blue_water";
import FireOrangeAgent from "../agents/fire_orange";
import GoldContractAgent from "../agents/gold_contract";
import GreenEcoAgent from "../agents/green_eco";
import PurpleRuleAgent from "../agents/purple_rule";
import { useAuthStore } from "../store/authStore";

interface ClusterLink {
  label: string;
  title: string;
  path: string;
  className: string;
  icon: ComponentType<{ "aria-hidden"?: boolean }>;
}

const clusterLinks: ClusterLink[] = [
  {
    label: "初然橙",
    title: "Godsignal",
    path: "/agents/fire-orange/godsignal",
    className: "fire-orange",
    icon: RadioTower
  },
  {
    label: "天则紫",
    title: "Rule",
    path: "/agents/purple-rule",
    className: "purple-rule",
    icon: Scale
  },
  {
    label: "算流蓝",
    title: "Chippmf",
    path: "/agents/blue-water/chippmf",
    className: "blue-water",
    icon: Cpu
  },
  {
    label: "定约金",
    title: "Contract",
    path: "/agents/gold-contract",
    className: "gold-contract",
    icon: FileCheck2
  },
  {
    label: "灵根绿",
    title: "Eco",
    path: "/agents/green-eco",
    className: "green-eco",
    icon: Sprout
  }
];

function GlobalAuthBoundary() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated ? (
    <AuthenticatedFrame>
      <Outlet />
    </AuthenticatedFrame>
  ) : (
    <Gatekeeper />
  );
}

function AuthenticatedFrame({ children }: PropsWithChildren) {
  const session = useAuthStore((state) => state.session);
  const clearSession = useAuthStore((state) => state.clearSession);

  return (
    <main className="agent-shell">
      <header className="agent-topbar">
        <Link to="/" className="brand-lockup">
          <span>AHIN</span>
          <small>global session</small>
        </Link>
        <nav aria-label="Agent clusters">
          {clusterLinks.map((cluster) => {
            const Icon = cluster.icon;
            return (
              <Link key={cluster.path} to={cluster.path} className={`cluster-logo ${cluster.className}`}>
                <Icon aria-hidden />
                <span>{cluster.label}</span>
              </Link>
            );
          })}
        </nav>
        <button type="button" className="text-button" onClick={clearSession}>
          End session
        </button>
      </header>
      <section className="session-strip">
        <span>{session?.wallet.label}</span>
        <strong>{session?.wallet.address}</strong>
      </section>
      {children}
    </main>
  );
}

function AgentLobby() {
  return (
    <section className="agent-lobby">
      {clusterLinks.map((cluster) => {
        const Icon = cluster.icon;
        return (
          <Link key={cluster.path} to={cluster.path} className={`cluster-card ${cluster.className}`}>
            <Icon aria-hidden />
            <span>{cluster.label}</span>
            <strong>{cluster.title}</strong>
          </Link>
        );
      })}
    </section>
  );
}

export const agentRouter = createBrowserRouter([
  {
    path: "/",
    element: <GlobalAuthBoundary />,
    children: [
      {
        index: true,
        element: <AgentLobby />
      },
      {
        path: "agents/fire-orange",
        element: <FireOrangeAgent />
      },
      {
        path: "agents/fire-orange/godsignal",
        element: <FireOrangeAgent />
      },
      {
        path: "agents/purple-rule",
        element: <PurpleRuleAgent />
      },
      {
        path: "agents/blue-water",
        element: <BlueWaterAgent />
      },
      {
        path: "agents/blue-water/chippmf",
        element: <BlueWaterAgent />
      },
      {
        path: "agents/gold-contract",
        element: <GoldContractAgent />
      },
      {
        path: "agents/green-eco",
        element: <GreenEcoAgent />
      }
    ]
  },
  {
    path: "/godsignal/*",
    element: <Navigate to="/agents/fire-orange/godsignal" replace />
  },
  {
    path: "/chippmf/*",
    element: <Navigate to="/agents/blue-water/chippmf" replace />
  },
  {
    path: "*",
    element: <Navigate to="/" replace />
  }
]);
