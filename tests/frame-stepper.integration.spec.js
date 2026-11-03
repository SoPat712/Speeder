import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function source(relativePath) {
  return readFileSync(relativePath, "utf8");
}

function between(text, begin, end) {
  const start = text.indexOf(begin);
  const finish = text.indexOf(end, start + begin.length);
  if (start < 0 || finish < 0) {
    throw new Error(`Missing Speeder function boundary: ${begin} / ${end}`);
  }
  return text.slice(start, finish);
}

describe("frame stepping integration", () => {
  it("loads the engine before inject.js and registers optional buttons", () => {
    const manifest = JSON.parse(source("extension/manifest.json"));
    const scripts = manifest.content_scripts.flatMap((entry) => entry.js || []);
    expect(scripts.indexOf("shared/frame-stepper.js")).toBeGreaterThan(-1);
    expect(scripts.indexOf("shared/frame-stepper.js")).toBeLessThan(
      scripts.indexOf("content/inject.js")
    );

    const context = {};
    runInNewContext(source("extension/shared/settings-core.js"), context);
    expect(Array.from(context.vscGetButtonIds())).toEqual(
      expect.arrayContaining(["previousFrame", "nextFrame"])
    );
    expect(Array.from(context.vscGetDefaultButtonIds())).not.toContain("nextFrame");
    expect(Array.from(context.vscGetDefaultButtonIds())).not.toContain("previousFrame");
  });

  it("enables estimation only for configured shortcuts or controller buttons", () => {
    const code = source("extension/content/inject.js");
    const calls = [];
    let active = true;
    const settings = {
      keyBindings: [],
      controllerButtons: [],
      popupControllerButtons: [],
      popupMatchHoverControls: true,
      showPopupControlBar: true
    };
    const context = {
      tc: { settings },
      frameStepper: {
        start: (video, identity) => calls.push(["start", video, identity(video)]),
        dispose: (video) => calls.push(["dispose", video])
      },
      isSpeederActiveForCurrentPage: () => active,
      isOnYouTube: () => false,
      getVideoSourceKey: (video) => video.currentSrc
    };
    runInNewContext(between(code, "function getFrameStepperIdentity(",
      "function getVideoSourceKey("), context);
    const video = { nodeName: "VIDEO", currentSrc: "example.mp4" };

    context.syncFrameSteppingOnVideo(video);
    expect(calls.pop()[0]).toBe("dispose");
    settings.keyBindings = [{ action: "nextFrame", code: "Period", disabled: false }];
    context.syncFrameSteppingOnVideo(video);
    expect(calls.pop()).toEqual(["start", video, "example.mp4"]);
    settings.keyBindings[0].disabled = true;
    context.syncFrameSteppingOnVideo(video);
    expect(calls.pop()[0]).toBe("dispose");

    settings.popupMatchHoverControls = false;
    settings.popupControllerButtons = ["previousFrame"];
    context.syncFrameSteppingOnVideo(video);
    expect(calls.pop()[0]).toBe("start");
    settings.showPopupControlBar = false;
    context.syncFrameSteppingOnVideo(video);
    expect(calls.pop()[0]).toBe("dispose");
    active = false;
    settings.controllerButtons = ["nextFrame"];
    context.syncFrameSteppingOnVideo(video);
    expect(calls.pop()[0]).toBe("dispose");
  });

  it("routes actions through the existing closest/all targeting behavior", () => {
    const code = source("extension/content/inject.js");
    const calls = [];
    const document = {};
    const makeVideo = (src) => ({
      nodeName: "VIDEO",
      currentSrc: src,
      ownerDocument: document,
      isConnected: true,
      vsc: { div: { classList: { contains: () => false } } },
      classList: { contains: () => false }
    });
    const first = makeVideo("one.mp4");
    const second = makeVideo("two.mp4");
    const context = {
      document,
      tc: {
        mediaElements: [first, second],
        settings: { shortcutTargetMode: "all" },
        lastPointerPosition: null,
        lastInteractedMedia: second
      },
      frameStepper: {
        step: (video, direction, identity) => {
          calls.push([video.currentSrc, direction, identity(video)]);
        }
      },
      getFrameStepperIdentity: (video) => video.currentSrc,
      log: () => {},
      getMediaFromControllerEvent: () => null,
      isOnYouTube: () => false,
      getClosestMediaToPointer: () => null,
      getPrimaryVideoElement: () => first,
      rescanShadowRootsForAction: () => false,
      showController: () => {},
      getKeyBindings: () => 0,
      keyBindingUtils: { sanitizeActionValue: () => 0 }
    };
    runInNewContext(
      between(code, "function resolveActionMediaTargets(", "function pause(v)"),
      context
    );
    const event = { target: { ownerDocument: document } };

    context.runAction("nextFrame", 0, event);
    expect(calls).toEqual([
      ["one.mp4", 1, "one.mp4"],
      ["two.mp4", 1, "two.mp4"]
    ]);
    calls.length = 0;
    context.tc.settings.shortcutTargetMode = "closest";
    context.runAction("previousFrame", 0, event);
    expect(calls).toEqual([["two.mp4", -1, "two.mp4"]]);
    calls.length = 0;
    context.runAction("nextFrame", 0, event, first);
    expect(calls).toEqual([["one.mp4", 1, "one.mp4"]]);
  });
});
