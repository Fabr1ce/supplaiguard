import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

// The Playground is served under /playground/ of the existing Pages site (https://fabr1ce.github.io/supplaiguard/).
export default defineConfig({
  base: process.env.VITE_BASE ?? "/supplaiguard/playground/",
  plugins: [react(), tailwind()],
});
