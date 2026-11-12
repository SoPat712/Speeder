import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import testUtils from "./helpers/extension-test-utils.js";

const {
  createChromeMock,
  evaluateScript,
  loadHtmlString,
  readWorkspaceFile
} = testUtils;

let stepper;

function createVideo(source) {
  const video = document.createElement("video");
  document.body.appendChild(video);
  Object.defineProperty(video, "currentSrc", {
    configurable: true,
    value: source
  });
  // Speeder targets videos that have a controller attached.
  video.vsc = { div: document.createElement("div") };
  return video;
}

beforeEach(() => {
  loadHtmlString("<!doctype html><html><head></head><body></body></html>");

  window.chrome = createChromeMock();
  // Keep startup hydration pending: the tests explicitly configure the
  // controller and settings, without starting discovery or page-wide timers.
  window.chrome.storage.sync.get = vi.fn();

  evaluateScript("extension/shared/settings-core.js");

  window.SpeederShared = {
    siteRules: { isSpeederActiveForSite: vi.fn(() => true) },
    keyBindings: {
      sanitizeActionValue: vi.fn((_action, value) => value)
    }
  };
  evaluateScript("extension/shared/frame-stepper.js");
  stepper = window.SpeederShared.frameStepper;
  vi.spyOn(stepper, "start").mockReturnValue(true);
  vi.spyOn(stepper, "dispose").mockImplementation(() => {});
  vi.spyOn(stepper, "step").mockReturnValue(true);

  // Execute the whole content script, rather than copying function bodies or
  // relying on their order in inject.js.
  evaluateScript("extension/content/inject.js");
});

afterEach(() => {
  // The real content script installs a bounded shadow-root fallback. Cancel
  // its scheduled work before closing the jsdom document.
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

describe("frame stepping integration", () => {
  it("loads the frame stepper before inject.js and registers optional actions and buttons", () => {
    const manifest = JSON.parse(readWorkspaceFile("extension/manifest.json"));
    const scripts = manifest.content_scripts.flatMap((entry) => entry.js || []);

    expect(scripts).toContain("shared/frame-stepper.js");
    expect(scripts.indexOf("shared/frame-stepper.js")).toBeLessThan(
      scripts.indexOf("content/inject.js")
    );

    for (const action of ["previousFrame", "nextFrame"]) {
      expect(window.vscGetButtonIds()).toContain(action);
      expect(window.vscGetDefaultButtonIds()).not.toContain(action);
      expect(window.vscGetActionDefs()[action]).toMatchObject({ hasValue: false });
    }
  });

  it("starts measurement only when a shortcut or controller button enables frame stepping", () => {
    const video = createVideo("https://example.org/clip.mp4");
    const settings = window.tc.settings;
    settings.keyBindings = [];
    settings.controllerButtons = [];
    settings.popupControllerButtons = [];
    settings.popupMatchHoverControls = true;
    settings.showPopupControlBar = true;

    window.syncFrameSteppingOnVideo(video);
    expect(stepper.dispose).toHaveBeenCalledWith(video);
    expect(stepper.start).not.toHaveBeenCalled();

    settings.keyBindings = [{ action: "nextFrame", code: "Period", disabled: false }];
    window.syncFrameSteppingOnVideo(video);
    expect(stepper.start).toHaveBeenCalledOnce();
    expect(stepper.start).toHaveBeenCalledWith(video, expect.any(Function));
    const identity = stepper.start.mock.calls[0][1];
    expect(identity(video)).toBe("https://example.org/clip.mp4");

    settings.keyBindings[0].disabled = true;
    window.syncFrameSteppingOnVideo(video);
    expect(stepper.dispose).toHaveBeenCalledTimes(2);

    settings.popupMatchHoverControls = false;
    settings.popupControllerButtons = ["previousFrame"];
    window.syncFrameSteppingOnVideo(video);
    expect(stepper.start).toHaveBeenCalledTimes(2);

    settings.showPopupControlBar = false;
    window.syncFrameSteppingOnVideo(video);
    expect(stepper.dispose).toHaveBeenCalledTimes(3);

    settings.controllerButtons = ["nextFrame"];
    window.tc.tabPaused = true;
    window.syncFrameSteppingOnVideo(video);
    expect(stepper.dispose).toHaveBeenCalledTimes(4);
  });

  it("uses Speeder's all, closest, and explicit-video targeting for frame actions", () => {
    const first = createVideo("https://example.org/one.mp4");
    const second = createVideo("https://example.org/two.mp4");
    window.tc.mediaElements = [first, second];
    window.tc.lastPointerPosition = null;
    window.tc.lastInteractedMedia = second;
    window.tc.settings.shortcutTargetMode = "all";

    const event = { target: document.body };
    window.runAction("nextFrame", 0, event);
    expect(stepper.step).toHaveBeenCalledTimes(2);
    expect(stepper.step).toHaveBeenNthCalledWith(
      1, first, 1, expect.any(Function)
    );
    expect(stepper.step).toHaveBeenNthCalledWith(
      2, second, 1, expect.any(Function)
    );

    stepper.step.mockClear();
    window.tc.settings.shortcutTargetMode = "closest";
    window.runAction("previousFrame", 0, event);
    expect(stepper.step).toHaveBeenCalledTimes(1);
    expect(stepper.step).toHaveBeenCalledWith(
      second, -1, expect.any(Function)
    );

    stepper.step.mockClear();
    window.runAction("nextFrame", 0, event, first);
    expect(stepper.step).toHaveBeenCalledTimes(1);
    expect(stepper.step).toHaveBeenCalledWith(
      first, 1, expect.any(Function)
    );
  });
});
