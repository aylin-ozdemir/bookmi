import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    globalSetup: ["tests/global-setup.ts"],
    exclude: [...configDefaults.exclude, "e2e/**"],
    env: {
      // API tests run against a throwaway db; see tests/api.test.ts
      DATABASE_URL: "file:./prisma/test.db",
    },
  },
});
