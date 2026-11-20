import type { ReactNode } from "react";
import Header from "./Header";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-violet focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Header />
      <main id="main" className="mx-auto max-w-6xl px-4 pb-20 pt-6">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 text-sm text-mute">
        SupplAIGuard is a hackathon project. Demo repositories are intentionally vulnerable and must not be deployed.
      </footer>
    </div>
  );
}
