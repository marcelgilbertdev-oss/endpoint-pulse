import { defineConfig } from "vitest/config";

// Unit tests only. The Playwright suite (tests/e2e/*.spec.ts) has its own
// runner — vitest's default glob would swallow it and die on test.beforeAll,
// which is exactly what happened in CI run #1.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
