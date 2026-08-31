import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      // Deliberately fixed so date math never silently depends on the host zone.
      TZ: "UTC",
      // Each test file gets its own in-memory database.
      TURSO_DATABASE_URL: ":memory:",
      ENCRYPTION_KEY: "test-encryption-key",
      EMAIL_FROM: "get2gethr <test@get2gethr.test>",
      NEXT_PUBLIC_BASE_URL: "https://get2gethr.test",
      CALENDAR_BROKER: "fake",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
