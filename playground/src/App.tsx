import { Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import Playground from "./pages/Playground";
import Execution from "./pages/Execution";
import Results from "./pages/Results";
import History from "./pages/History";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Playground />} />
        <Route path="/run/:id" element={<Execution />} />
        <Route path="/run/:id/results" element={<Results />} />
        <Route path="/history" element={<History />} />
        <Route path="*" element={<Playground />} />
      </Routes>
    </AppShell>
  );
}
