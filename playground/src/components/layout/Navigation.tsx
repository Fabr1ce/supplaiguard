import { NavLink } from "react-router-dom";

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? "bg-purple/20 text-ink" : "text-mute hover:text-ink"}`;

export default function Navigation() {
  return (
    <nav aria-label="Main" className="flex items-center gap-1">
      <NavLink to="/" end className={link}>Playground</NavLink>
      <a href="#how" className="rounded-lg px-3 py-2 text-sm text-mute transition-colors hover:text-ink" onClick={(e) => { e.preventDefault(); document.getElementById("how")?.scrollIntoView({ behavior: "smooth" }); }}>How it works</a>
      <NavLink to="/history" className={link}>History</NavLink>
    </nav>
  );
}
