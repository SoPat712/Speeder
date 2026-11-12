const {
  createChromeMock,
  evaluateScript,
  flushAsyncWork,
  loadHtmlString
} = require("./helpers/extension-test-utils");

function bootInject(options) {
  const config = options || {};

  loadHtmlString("<!doctype html><html><body></body></html>");

  const chrome = createChromeMock({
    syncData: config.syncData,
    localData: config.localData
  });

  global.chrome = chrome;
  window.chrome = chrome;
  window.requestIdleCallback = (callback, opts) =>
    setTimeout(
      () =>
        callback({
          didTimeout: false,
          timeRemaining() {
            return 1;
          }
        }),
      (opts && opts.timeout) || 0
    );
  window.cancelIdleCallback = (id) => clearTimeout(id);

  evaluateScript("extension/shared/controller-utils.js");
  evaluateScript("extension/shared/key-bindings.js");
  evaluateScript("extension/shared/settings-core.js");
  evaluateScript("extension/shared/site-rules.js");
  evaluateScript("extension/shared/ui-icons.js");
  evaluateScript("extension/content/inject.js");

  return chrome;
}

describe("inject.js helper logic", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete global.chrome;
  });

  it("normalizes bindings from legacy formats", async () => {
    bootInject();
    await flushAsyncWork(3);

    expect(
      window.normalizeStoredBinding({
        action: "faster",
        key: "g",
        value: 1.8,
        force: false
      }).code
    ).toBe("KeyG");

    expect(
      window.normalizeStoredBinding({
        action: "pause",
        code: null,
        key: null,
        keyCode: null,
        value: 0
      })
    ).toEqual({
      action: "pause",
      code: null,
      disabled: true,
      value: 0,
      force: "false",
      predefined: false
    });

    expect(window.defaultKeyBindings({ speedStep: 0.25, rewindTime: 5 })[0]).toEqual(
      {
        action: "slower",
        code: "KeyS",
        value: 0.25,
        force: false,
        predefined: true
      }
    );
  });

  it("clamps controller margins and ignores stale source-specific target speeds", async () => {
    bootInject();
    await flushAsyncWork(3);

    expect(window.normalizeControllerMarginPx(250, 0)).toBe(200);
    expect(window.normalizeControllerMarginPx(-5, 65)).toBe(0);
    expect(window.normalizeControllerMarginPx("bad", 65)).toBe(65);

    const staleVideo = {
      currentSrc: "fresh.mp4",
      vsc: {
        targetSpeed: 1.75,
        targetSpeedSourceKey: "old.mp4"
      }
    };

    expect(window.getControllerTargetSpeed(staleVideo)).toBeNull();

    window.tc.settings.rememberSpeed = true;
    window.tc.settings.forceLastSavedSpeed = false;
    window.tc.settings.lastSpeed = 1.3;
    window.tc.settings.speeds = { "fresh.mp4": 1.6 };

    expect(window.getRememberedSpeed({ currentSrc: "fresh.mp4" })).toBe(1.6);
    expect(window.getDesiredSpeed(staleVideo)).toBe(1.6);
  });

  it("applies site rule overrides and detects disabled sites", async () => {
    bootInject();
    await flushAsyncWork(3);

    window.tc.settings.siteRules = [{ pattern: "example.org", enabled: false }];
    window.captureSiteRuleBase();
    expect(window.applySiteRuleOverrides()).toBe(true);

    window.resetSettingsFromSiteRuleBase();
    window.tc.settings.siteRules = [
      {
        pattern: "example.org",
        controllerLocation: "bottom-left",
        controllerMarginTop: 300,
        controllerMarginBottom: -10,
        rememberSpeed: true
      }
    ];
    window.captureSiteRuleBase();

    expect(window.applySiteRuleOverrides()).toBe(false);
    expect(window.tc.settings.controllerLocation).toBe("bottom-left");
    expect(window.tc.settings.controllerMarginTop).toBe(200);
    expect(window.tc.settings.controllerMarginBottom).toBe(0);
    expect(window.tc.settings.rememberSpeed).toBe(true);

    window.resetSettingsFromSiteRuleBase();
    window.tc.settings.shortcutTargetMode = "closest";
    window.tc.settings.siteRules = [
      { pattern: "example.org", shortcutTargetMode: "all" }
    ];
    window.captureSiteRuleBase();
    window.applySiteRuleOverrides();
    expect(window.tc.settings.shortcutTargetMode).toBe("all");
  });

  it("sizes and positions the controller host to the video bounds", async () => {
    bootInject();
    await flushAsyncWork(3);

    const mount = document.createElement("div");
    const video = document.createElement("video");
    const wrapper = document.createElement("div");
    wrapper.className = "vsc-controller";
    mount.append(video, wrapper);
    document.body.appendChild(mount);

    Object.defineProperties(mount, {
      offsetWidth: { value: 400 },
      offsetHeight: { value: 240 },
      clientLeft: { value: 2 },
      clientTop: { value: 2 }
    });
    mount.getBoundingClientRect = () => ({
      left: 100,
      top: 50,
      right: 500,
      bottom: 290,
      width: 400,
      height: 240
    });
    video.getBoundingClientRect = () => ({
      left: 140,
      top: 70,
      right: 460,
      bottom: 250,
      width: 320,
      height: 180
    });

    window.positionControllerHost(wrapper, video, mount);

    expect(wrapper.style.getPropertyValue("left")).toBe("38px");
    expect(wrapper.style.getPropertyValue("top")).toBe("18px");
    expect(wrapper.style.getPropertyValue("width")).toBe("320px");
    expect(wrapper.style.getPropertyValue("height")).toBe("180px");
    expect(wrapper.style.getPropertyPriority("width")).toBe("important");
  });

  it("does not mount the controller outside a player stacking boundary", async () => {
    bootInject();
    await flushAsyncWork(3);

    const page = document.createElement("main");
    const outsidePlayer = document.createElement("section");
    const isolatedPlayer = document.createElement("div");
    const videoParent = document.createElement("div");
    const video = document.createElement("video");
    isolatedPlayer.style.isolation = "isolate";
    videoParent.appendChild(video);
    isolatedPlayer.appendChild(videoParent);
    outsidePlayer.appendChild(isolatedPlayer);
    page.appendChild(outsidePlayer);
    document.body.appendChild(page);

    const rect = {
      left: 10,
      top: 100,
      right: 650,
      bottom: 460,
      width: 640,
      height: 360
    };
    [video, videoParent, isolatedPlayer, outsidePlayer].forEach((element) => {
      element.getBoundingClientRect = () => rect;
    });

    expect(window.getControllerMount(video)).toBe(isolatedPlayer);
  });

  it("keeps the controller inside a nested fullscreen player subtree", async () => {
    bootInject();
    await flushAsyncWork(3);

    const isolatedPlayer = document.createElement("div");
    isolatedPlayer.style.isolation = "isolate";
    const fullscreenPlayer = document.createElement("media-player");
    const provider = document.createElement("media-provider");
    const video = document.createElement("video");
    provider.appendChild(video);
    fullscreenPlayer.appendChild(provider);
    isolatedPlayer.appendChild(fullscreenPlayer);
    document.body.appendChild(isolatedPlayer);

    const rect = {
      left: 0,
      top: 0,
      right: 640,
      bottom: 360,
      width: 640,
      height: 360
    };
    [video, provider, fullscreenPlayer, isolatedPlayer].forEach((element) => {
      element.getBoundingClientRect = () => rect;
    });

    expect(window.getControllerMount(video)).toBe(isolatedPlayer);
    expect(window.getControllerMount(video, fullscreenPlayer)).toBe(
      fullscreenPlayer
    );
  });

  it("remounts the controller on fullscreen entry and restores it on exit", async () => {
    bootInject();
    await flushAsyncWork(3);

    const isolatedPlayer = document.createElement("div");
    isolatedPlayer.style.isolation = "isolate";
    const fullscreenPlayer = document.createElement("media-player");
    const provider = document.createElement("media-provider");
    const video = document.createElement("video");
    const wrapper = document.createElement("div");
    wrapper.className = "vsc-controller";
    provider.appendChild(video);
    fullscreenPlayer.appendChild(provider);
    isolatedPlayer.append(fullscreenPlayer, wrapper);
    document.body.appendChild(isolatedPlayer);

    const rect = {
      left: 0,
      top: 0,
      right: 640,
      bottom: 360,
      width: 640,
      height: 360
    };
    [video, provider, fullscreenPlayer, isolatedPlayer].forEach((element) => {
      element.getBoundingClientRect = () => rect;
    });

    const controller = {
      video,
      div: wrapper,
      normalControllerMount: isolatedPlayer
    };
    window.setupControllerHostTracking(controller, wrapper, isolatedPlayer);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: fullscreenPlayer
    });

    expect(window.syncControllerFullscreenMount(controller)).toBe(true);
    expect(wrapper.parentElement).toBe(fullscreenPlayer);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null
    });
    expect(window.syncControllerFullscreenMount(controller)).toBe(true);
    expect(wrapper.parentElement).toBe(isolatedPlayer);

    wrapper.remove();
    controller.controllerHostCleanup();
  });

  it("force-rescans media missed during initial hydration", async () => {
    bootInject();
    await flushAsyncWork(3);

    const video = document.createElement("video");
    const source = document.createElement("source");
    source.src = "https://example.org/late-source.mp4";
    video.appendChild(source);
    document.body.appendChild(video);

    expect(video.vsc).toBeUndefined();
    window.initializeWhenReady(document, true);

    expect(video.vsc).toBeDefined();
    expect(video.vsc.div).toBeDefined();
  });

  it("lets a site rule shortcut win over a global binding on the same key", async () => {
    bootInject({
      syncData: {
        keyBindings: [
          { action: "faster", code: "KeyD", value: 0.1 },
          { action: "slower", code: "KeyS", value: 0.1 }
        ]
      }
    });
    await flushAsyncWork(3);

    window.tc.settings.siteRules = [
      {
        pattern: "example.org",
        shortcuts: [{ action: "rewind", code: "KeyD", value: 5 }]
      }
    ];
    window.captureSiteRuleBase();
    window.applySiteRuleOverrides();

    const event = new KeyboardEvent("keydown", { key: "d", code: "KeyD" });
    const match = window.tc.settings.keyBindings.find((binding) =>
      window.matchesKeyBinding(binding, event)
    );
    expect(match).toMatchObject({ action: "rewind", value: 5 });
    expect(
      window.tc.settings.keyBindings.map((binding) => binding.action)
    ).toEqual(expect.arrayContaining(["faster", "slower"]));
  });

  it("only blocks page key handlers when the shortcut force option is enabled", async () => {
    bootInject({
      syncData: {
        keyBindings: [
          {
            action: "faster",
            code: "KeyD",
            value: 0.1,
            force: false
          }
        ]
      }
    });
    await flushAsyncWork(3);

    const video = document.createElement("video");
    video.src = "https://example.org/shortcut.mp4";
    document.body.appendChild(video);
    window.ensureController(video, document.body);
    let pageKeydowns = 0;
    let pageCaptureKeydowns = 0;
    document.addEventListener(
      "keydown",
      function() {
        pageCaptureKeydowns += 1;
      },
      true
    );
    document.body.addEventListener("keydown", function() {
      pageKeydowns += 1;
    });

    const unblocked = new KeyboardEvent("keydown", {
      key: "d",
      code: "KeyD",
      bubbles: true,
      cancelable: true
    });
    video.dispatchEvent(unblocked);

    expect(video.playbackRate).toBeCloseTo(1.1, 5);
    expect(pageKeydowns).toBe(1);
    expect(pageCaptureKeydowns).toBe(1);
    expect(unblocked.defaultPrevented).toBe(false);

    window.tc.settings.keyBindings[0].force = "true";
    const blocked = new KeyboardEvent("keydown", {
      key: "d",
      code: "KeyD",
      bubbles: true,
      cancelable: true
    });
    video.dispatchEvent(blocked);

    expect(video.playbackRate).toBeCloseTo(1.2, 5);
    expect(pageKeydowns).toBe(1);
    expect(pageCaptureKeydowns).toBe(1);
    expect(blocked.defaultPrevented).toBe(true);
  });
});
