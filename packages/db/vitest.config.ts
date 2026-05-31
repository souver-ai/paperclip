import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 120_000,
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 1,
        minForks: 1,
      },
    },
    sequence: {
      concurrent: false,
    },
  },
});
