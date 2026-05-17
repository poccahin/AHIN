import { RouterProvider } from "react-router-dom";
import { agentRouter } from "./routes/agentRoutes";

export default function App() {
  return <RouterProvider router={agentRouter} />;
}
