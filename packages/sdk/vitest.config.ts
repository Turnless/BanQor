import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // integration tests fork Mezo testnet over the network
    testTimeout: 180_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
