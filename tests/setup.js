import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  if (typeof window !== "undefined") {
    window.open = vi.fn();
    window.close = vi.fn();
  }

  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.SpeederShared;
  delete globalThis.restore_options;
  if (typeof document !== "undefined") {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  }
  delete globalThis.chrome;
});
