const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    environment: "jsdom",
    clearMocks: true,
    globals: true,
    restoreMocks: true,
    include: ["tests/**/*.test.js"],
    setupFiles: ["./tests/setup.js"]
  }
});
