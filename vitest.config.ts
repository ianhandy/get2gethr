import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Deliberately fixed so date math never silently depends on the host zone.
    env: { TZ: "UTC" },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
