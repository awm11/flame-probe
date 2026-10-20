import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://awm11.github.io/flame-probe/
export default defineConfig({
  plugins: [react()],
  base: "/flame-probe/",
});
