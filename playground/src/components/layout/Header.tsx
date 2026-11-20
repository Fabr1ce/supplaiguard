import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Github, ShieldCheck } from "lucide-react";
import Navigation from "./Navigation";
import { apiConfigured, getHealth } from "../../services/api";

type Health = "checking" | "up" | "paused" | "down";

export default function Header() {
  const [health, setHealth] = useState<Health>("checking");
  useEffect(() => {
    if (!apiConfigured) return setHealth("down");
    getHealth().then((h) => setHealth(h.launchEnabled ? "up" : "paused")).catch(() => setHealth("down"));
  }, []);
  const label = { checking: "Checking service", up: "Service available", paused: "Launching paused", down: "Service unavailable" }[health];
  const dot = { checking: "bg-mute", up: "bg-ok", paused: "bg-warn", down: "bg-bad" }[health];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-midnight/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-6 w-6 text-violet" aria-hidden />
          <span>SupplAIGuard <span className="text-mute font-normal">Playground</span></span>
        </Link>
        <div className="flex items-center gap-3">
          <Navigation />
          <span className="hidden items-center gap-2 text-xs text-mute sm:flex" role="status">
            <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />{label}
          </span>
          <a href="https://github.com/Fabr1ce/supplaiguard" className="text-mute hover:text-ink" aria-label="SupplAIGuard on GitHub" target="_blank" rel="noreferrer">
            <Github className="h-5 w-5" />
          </a>
        </div>
      </div>
    </header>
  );
}
