import { defineConfig } from "vitest/config";
import path from "node:path";

// Contract tests need Docker (testcontainers) and run in their own CI job.
// Excluded from the default `npm test` so a developer without Docker still
// gets a clean unit-test pass. RUN_CONTRACT=1 npm test re-enables them.
const INCLUDE_CONTRACT = process.env.RUN_CONTRACT === "1";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      ...(INCLUDE_CONTRACT ? [] : ["**/contract.test.{ts,tsx}"]),
    ],
    coverage: { include: ["src/lib/**", "src/app/api/**"], reporter: ["text", "html"] },
  },
});
