import { describe, expect, it, vi } from "vitest";
import { createChromeMock, flushAsyncWork, loadScript } from "./helpers/browser.js";

function loadBlankDocument() {
  document.open();
  document.write("<!doctype html><html><body></body></html>");
  document.close();
}

async function bootInject({ sync = {}, local = {} } = {}) {
  loadBlankDocument();
  globalThis.chrome = createChromeMock({ sync, local });
  window.chrome = globalThis.chrome;
  globalThis.chrome.runtime.onMessage = {
    addListener: vi.fn()
  };
  const originalSyncGet = globalThis.chrome.storage.sync.get;
  const originalLocalGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.sync.get = vi.fn((keys, callback) => {
    Promise.resolve().then(() => originalSyncGet(keys, callback));
  });
  globalThis.chrome.storage.local.get = vi.fn((keys, callback) => {
    Promise.resolve().then(() => originalLocalGet(keys, callback));
  });
  globalThis.requestIdleCallback = (callback, options) =>
    setTimeout(
      () =>
        callback({
          didTimeout: false,
          timeRemaining() {
            return 1;
          }
        }),
      (options && options.timeout) || 0
    );
  globalThis.cancelIdleCallback = (id) => clearTimeout(id);

  loadScript("shared/controller-utils.js");
  loadScript("shared/key-bindings.js");
  loadScript("shared/site-rules.js");
  loadScript("ui-icons.js");
  loadScript("inject.js");

  for (let i = 0; i < 3; i += 1) {
    await flushAsyncWork();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("inject runtime", () => {
  it("keeps subtitle nudge disabled when the effective setting is off", async () => {
    await bootInject({
      sync: {
        enableSubtitleNudge: false
      }
    });

    const stopSubtitleNudge = vi.fn();
    const startSubtitleNudge = vi.fn();
    const flashEl = document.createElement("span");
    const video = {
      paused: false,
      playbackRate: 1.5,
      vsc: {
        stopSubtitleNudge,
        startSubtitleNudge,
        subtitleNudgeEnabledOverride: null,
        subtitleNudgeIndicator: null,
        nudgeFlashIndicator: flashEl
      }
    };

    expect(window.tc.settings.enableSubtitleNudge).toBe(false);
    expect(window.isSubtitleNudgeEnabledForVideo(video)).toBe(false);
    expect(window.setSubtitleNudgeEnabledForVideo(video, true)).toBe(false);
    expect(video.vsc.subtitleNudgeEnabledOverride).toBeNull();
    expect(stopSubtitleNudge).toHaveBeenCalledTimes(1);
    expect(startSubtitleNudge).not.toHaveBeenCalled();
    expect(flashEl.classList.contains("visible")).toBe(false);

    window.tc.settings.enableSubtitleNudge = true;
    expect(window.setSubtitleNudgeEnabledForVideo(video, true)).toBe(true);
    expect(window.isSubtitleNudgeEnabledForVideo(video)).toBe(true);

    window.tc.settings.enableSubtitleNudge = false;
    expect(window.isSubtitleNudgeEnabledForVideo(video)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
