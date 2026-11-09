import { describe, expect, it, vi } from "vitest";
import {
  createChromeMock,
  flushAsyncWork,
  loadHtmlString,
  loadScript
} from "./helpers/browser.js";

function loadBlankDocument() {
  loadHtmlString("<!doctype html><html><body></body></html>");
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

  loadScript("extension/shared/controller-utils.js");
  loadScript("extension/shared/key-bindings.js");
  loadScript("extension/shared/settings-core.js");
  loadScript("extension/shared/site-rules.js");
  loadScript("extension/shared/ui-icons.js");
  loadScript("extension/content/inject.js");

  for (let i = 0; i < 3; i += 1) {
    await flushAsyncWork();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("inject runtime", () => {
  it("treats a matching site rule with site enabled as active when global enable is off", async () => {
    await bootInject({
      sync: {
        enabled: false,
        siteRules: [{ pattern: "example.org", enabled: true }]
      }
    });

    expect(window.tc.settings.enabled).toBe(false);
    window.captureSiteRuleBase();
    window.applySiteRuleOverrides();
    expect(window.tc.activeSiteRule).toEqual(
      expect.objectContaining({ pattern: "example.org", enabled: true })
    );
    expect(
      window.SpeederShared.siteRules.isSpeederActiveForSite(
        window.tc.settings.enabled,
        window.tc.activeSiteRule
      )
    ).toBe(true);
  });

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

  it("uses the configured subtitle nudge default until a video is toggled", async () => {
    await bootInject({
      sync: {
        enableSubtitleNudge: true,
        subtitleNudgeEnabledByDefault: false
      }
    });

    const startSubtitleNudge = vi.fn();
    const video = {
      paused: false,
      playbackRate: 1.5,
      vsc: {
        startSubtitleNudge,
        stopSubtitleNudge: vi.fn(),
        subtitleNudgeEnabledOverride: null,
        subtitleNudgeIndicator: null,
        nudgeFlashIndicator: document.createElement("span")
      }
    };

    expect(window.isSubtitleNudgeEnabledForVideo(video)).toBe(false);
    expect(window.setSubtitleNudgeEnabledForVideo(video, true)).toBe(true);
    expect(video.vsc.subtitleNudgeEnabledOverride).toBe(true);
    expect(window.isSubtitleNudgeEnabledForVideo(video)).toBe(true);
    expect(startSubtitleNudge).toHaveBeenCalledTimes(1);
  });

  it("applies subtitle nudge default state from matching site rules", async () => {
    await bootInject();

    window.tc.settings.enableSubtitleNudge = true;
    window.tc.settings.subtitleNudgeEnabledByDefault = true;
    window.tc.settings.siteRules = [
      {
        pattern: "example.org",
        subtitleNudgeEnabledByDefault: false
      }
    ];
    window.captureSiteRuleBase();

    expect(window.applySiteRuleOverrides()).toBe(false);
    expect(window.tc.settings.subtitleNudgeEnabledByDefault).toBe(false);

    window.resetSettingsFromSiteRuleBase();
    expect(window.tc.settings.subtitleNudgeEnabledByDefault).toBe(true);
  });

  it("detects media inside dynamically added shadow DOMs", async () => {
    await bootInject();

    vi.useFakeTimers();

    // Page shadow-root discovery is owned by the page-world bridge; the
    // content script only listens for its events.
    loadScript("extension/content/shadow-bridge.js");
    expect(window.vscPageShadowBridgeLoaded).toBe(true);

    // Attach the root to an already-connected host and add media afterwards,
    // so only the bridge's speeder-shadow-root-attached event can find it.
    const host = document.createElement("custom-player");
    document.body.appendChild(host);
    await flushAsyncWork();
    vi.runAllTimers();
    await flushAsyncWork();
    const shadow = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    video.src = "https://example.org/dynamic.mp4";
    shadow.appendChild(video);

    // Flush MutationObserver microtasks so that the observer callback runs
    // and schedules requestIdleCallback's setTimeout.
    await flushAsyncWork();
    // Run the scheduled timers (requestIdleCallback)
    vi.runAllTimers();
    // Flush any remaining microtasks/promises
    await flushAsyncWork();

    expect(video.vsc).toBeDefined();
    expect(video.vsc.div).toBeDefined();
    expect(video.vsc.div.classList.contains("vsc-non-youtube")).toBe(false);

    vi.useRealTimers();
  });

  it("attaches a controller when Vidstack appends a source after the video", async () => {
    await bootInject();
    vi.useFakeTimers();

    const provider = document.createElement("media-provider");
    const video = document.createElement("video");
    provider.appendChild(video);
    document.body.appendChild(provider);

    await flushAsyncWork();
    vi.runAllTimers();
    await flushAsyncWork();
    expect(video.vsc).toBeUndefined();

    const source = document.createElement("source");
    source.src = "https://example.org/vidstack.mp4";
    video.appendChild(source);

    await flushAsyncWork();
    vi.runAllTimers();
    await flushAsyncWork();

    expect(video.vsc).toBeDefined();
    expect(video.vsc.div).toBeDefined();
    expect(video.vsc.div.classList.contains("vsc-nosource")).toBe(false);
    vi.useRealTimers();
  });

  it("detects media in pre-existing shadow DOMs via delayed rescan", async () => {
    vi.useFakeTimers();
    loadHtmlString("<!doctype html><html><body></body></html>");

    const host = document.createElement("custom-player");
    const shadow = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    video.src = "https://example.org/pre-existing.mp4";
    shadow.appendChild(video);
    document.body.appendChild(host);

    globalThis.chrome = createChromeMock({ sync: {}, local: {} });
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

    loadScript("extension/shared/controller-utils.js");
    loadScript("extension/shared/key-bindings.js");
    loadScript("extension/shared/settings-core.js");
    loadScript("extension/shared/site-rules.js");
    loadScript("extension/shared/ui-icons.js");
    loadScript("extension/content/inject.js");

    // Fast-forward 3000ms for delayed rescan to trigger
    await vi.advanceTimersByTimeAsync(3000);
    // The bounded discovery pass yields to an idle callback before traversing.
    await vi.advanceTimersByTimeAsync(2000);

    for (let i = 0; i < 5; i += 1) {
      await flushAsyncWork();
    }

    expect(video.vsc).toBeDefined();
    expect(video.vsc.div).toBeDefined();
    expect(video.vsc.div.classList.contains("vsc-non-youtube")).toBe(false);

    vi.useRealTimers();
  });
});
