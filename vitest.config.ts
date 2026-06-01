import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    coverage: { include: ["src/lib/**", "src/app/api/**"], reporter: ["text", "html"] },
  },
});
