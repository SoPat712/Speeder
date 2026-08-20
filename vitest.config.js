const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    environment: "jsdom",
    clearMocks: true,
    fileParallelism: false,
    globals: true,
    restoreMocks: true,
    testTimeout: 15000,
    include: ["tests/**/*.test.js", "tests/**/*.spec.js"],
    setupFiles: ["./tests/setup.js"]
  }
});
