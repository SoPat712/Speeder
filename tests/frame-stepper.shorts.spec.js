import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import testUtils from "./helpers/extension-test-utils.js";

const { createChromeMock, evaluateScript, loadHtmlString } = testUtils;

function addShortVideo(source, width) {
  const renderer = document.createElement("ytd-reel-video-renderer");
  const video = document.createElement("video");
  renderer.appendChild(video);
  document.body.appendChild(renderer);
  Object.defineProperty(video, "currentSrc", {
    configurable: true,
    value: source
  });
  video.vsc = { div: document.createElement("div") };
  const rect = vi.spyOn(video, "getBoundingClientRect").mockImplementation(() => ({
    left: 0,
    top: 0,
    right: width.value,
    bottom: 200,
    width: width.value,
    height: 200
  }));
  return { video, rect };
}

beforeEach(() => {
  loadHtmlString("<!doctype html><html><head></head><body></body></html>", {
    url: "https://www.youtube.com/shorts/first"
  });
  window.chrome = createChromeMock();
  window.chrome.storage.sync.get = vi.fn();
  evaluateScript("extension/shared/settings-core.js");
  window.SpeederShared = {
    siteRules: { isSpeederActiveForSite: vi.fn(() => true) },
    keyBindings: { sanitizeActionValue: vi.fn((_action, value) => value) }
  };
  evaluateScript("extension/shared/frame-stepper.js");
  evaluateScript("extension/content/inject.js");
});

afterEach(() => {
  for (const timer of window.vscBoundedShadowFallbackTimers || []) {
    window.clearTimeout(timer);
  }
  if (window.vscPageShadowBridgeRetryTimer) {
    window.clearTimeout(window.vscPageShadowBridgeRetryTimer);
  }
  if (window.vscLocationWatchTimer) {
    window.clearInterval(window.vscLocationWatchTimer);
  }
  window.close();
  vi.restoreAllMocks();
});

describe("YouTube Shorts frame-stepper identity", () => {
  it("does not measure video geometry when there is only one video", () => {
    const first = addShortVideo("blob:https://www.youtube.com/shared", { value: 200 });
    window.tc.mediaElements = [first.video];

    expect(window.getFrameStepperIdentity(first.video)).toContain("|short:first");
    expect(first.rect).not.toHaveBeenCalled();
  });

  it("caches the fallback primary video until navigation changes", () => {
    const firstWidth = { value: 300 };
    const secondWidth = { value: 100 };
    const first = addShortVideo("blob:https://www.youtube.com/shared", firstWidth);
    const second = addShortVideo("blob:https://www.youtube.com/shared", secondWidth);
    window.tc.mediaElements = [first.video, second.video];

    for (let i = 0; i < 10; i += 1) {
      expect(window.getFrameStepperIdentity(first.video)).toContain("|short:first");
      expect(window.getFrameStepperIdentity(second.video)).not.toContain("|short:");
    }
    expect(first.rect).toHaveBeenCalledTimes(1);
    expect(second.rect).toHaveBeenCalledTimes(1);

    firstWidth.value = 100;
    secondWidth.value = 300;
    window.history.replaceState(null, "", "/shorts/second");

    expect(window.getFrameStepperIdentity(second.video)).toContain("|short:second");
    expect(window.getFrameStepperIdentity(first.video)).not.toContain("|short:");
    expect(first.rect).toHaveBeenCalledTimes(2);
    expect(second.rect).toHaveBeenCalledTimes(2);
  });

  it("refreshes cached selection when Speeder's interacted video changes", () => {
    const first = addShortVideo("blob:https://www.youtube.com/shared", { value: 200 });
    const second = addShortVideo("blob:https://www.youtube.com/shared", { value: 100 });
    window.tc.mediaElements = [first.video, second.video];

    window.getFrameStepperIdentity(first.video);
    window.tc.lastInteractedMedia = second.video;
    window.getFrameStepperIdentity(second.video);

    expect(first.rect).toHaveBeenCalledTimes(2);
    expect(second.rect).toHaveBeenCalledTimes(2);
  });
});
