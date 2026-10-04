import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      // API tests run against a throwaway db; see tests/api.test.ts
      DATABASE_URL: "file:./prisma/test.db",
    },
  },
});
