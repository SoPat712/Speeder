const {
  createChromeMock,
  evaluateScript,
  flushAsyncWork,
  loadHtmlString,
  readWorkspaceFile
} = require("./helpers/extension-test-utils");

function bootInject(options) {
  const config = options || {};

  loadHtmlString("<!doctype html><html><body></body></html>", {
    url: config.url || "https://example.org/"
  });
  window.history.replaceState({}, "", config.path || "/");

  const chrome = createChromeMock({
    syncData: config.syncData,
    localData: config.localData
  });

  if (config.syncGetDelayMs) {
    chrome.storage.sync.get.mockImplementation((keys, callback) => {
      setTimeout(() => {
        callback(chrome.storage.sync._dump());
      }, config.syncGetDelayMs);
    });
  }

  global.chrome = chrome;
  window.chrome = chrome;

  // Keep extension timers under Vitest's clock when a test uses fake timers.
  window.setTimeout = global.setTimeout.bind(global);
  window.clearTimeout = global.clearTimeout.bind(global);
  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.requestIdleCallback = (callback) =>
    setTimeout(
      () =>
        callback({
          didTimeout: false,
          timeRemaining() {
            return 1;
          }
        }),
      0
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

async function settleLifecycle(turns = 4) {
  await flushAsyncWork(turns);
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(0);
    await flushAsyncWork(2);
  }
}

function makeRect(left, top, width, height) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON() {
      return this;
    }
  };
}

function setRect(element, rect) {
  element.getBoundingClientRect = () => rect;
}

function setBoxMetrics(element, width, height) {
  Object.defineProperties(element, {
    offsetWidth: { configurable: true, value: width },
    offsetHeight: { configurable: true, value: height },
    clientLeft: { configurable: true, value: 0 },
    clientTop: { configurable: true, value: 0 }
  });
}

function createControlledVideo(options) {
  const config = options || {};
  const mount = config.mount || document.createElement("div");
  const video = document.createElement("video");
  const mountRect = config.mountRect || makeRect(0, 0, 640, 360);
  const videoRect = config.videoRect || mountRect;

  setRect(mount, mountRect);
  setBoxMetrics(mount, mountRect.width, mountRect.height);
  setRect(video, videoRect);
  video.src = config.src || "https://example.org/video.mp4";
  mount.appendChild(video);
  if (!mount.isConnected) document.body.appendChild(mount);

  window.ensureController(video, mount);
  return { mount, video, controller: video.vsc, wrapper: video.vsc.div };
}

function hostIsGeometrySuppressed(host) {
  const width = host.style.getPropertyValue("width");
  const height = host.style.getPropertyValue("height");
  return Boolean(
    host.hidden ||
      host.getAttribute("aria-hidden") === "true" ||
      host.classList.contains("vsc-geometry-hidden") ||
      host.style.display === "none" ||
      host.style.visibility === "hidden" ||
      ((width === "0" || width === "0px") &&
        (height === "0" || height === "0px"))
  );
}

describe("inject.js media/controller lifecycle regressions", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete global.chrome;
  });

  it("bridges page-world history and shadow creation events", () => {
    loadHtmlString("<!doctype html><html><body></body></html>");
    let locationEvents = 0;
    let shadowEvents = 0;
    document.addEventListener("speeder-location-changed", () => {
      locationEvents += 1;
    });
    document.addEventListener("speeder-shadow-root-attached", () => {
      shadowEvents += 1;
    });
    evaluateScript("extension/content/shadow-bridge.js");

    window.history.pushState({}, "", "/new-route");
    const bridgePlayer = document.createElement("bridge-player");
    document.body.appendChild(bridgePlayer);
    bridgePlayer.attachShadow({ mode: "open" });

    expect(locationEvents).toBe(1);
    expect(shadowEvents).toBe(1);
  });

  it("retries a blocked page bridge with bounded shadow fallback scans", async () => {
    vi.useFakeTimers();
    bootInject();
    const firstBridge = document.querySelector(
      'script[src$="content/shadow-bridge.js"]'
    );
    expect(firstBridge).not.toBeNull();

    firstBridge.dispatchEvent(new Event("error"));

    expect(window.vscPageShadowBridgeRequested).toBe(false);
    expect(window.vscBoundedShadowFallbackStarted).toBe(true);
    expect(window.vscBoundedShadowFallbackTimers).toHaveLength(3);
    expect(window.vscPersistentShadowFallbackTimer).toBeUndefined();
    await vi.advanceTimersByTimeAsync(250);
    expect(
      document.querySelector('script[src$="content/shadow-bridge.js"]')
    ).not.toBeNull();
  });

  it("stops at an immediate player stacking boundary", async () => {
    bootInject();
    await settleLifecycle();

    const outside = document.createElement("section");
    const isolatedPlayer = document.createElement("div");
    const video = document.createElement("video");
    const rect = makeRect(10, 70, 640, 360);

    isolatedPlayer.style.isolation = "isolate";
    isolatedPlayer.appendChild(video);
    outside.appendChild(isolatedPlayer);
    document.body.appendChild(outside);
    [outside, isolatedPlayer, video].forEach((element) => setRect(element, rect));

    expect(window.getControllerMount(video)).toBe(isolatedPlayer);
  });

  it("escapes a video wrapper when a sibling gesture pane covers the player", async () => {
    bootInject();
    await settleLifecycle();

    const player = document.createElement("div");
    const videoLayer = document.createElement("div");
    const gesturePane = document.createElement("div");
    const video = document.createElement("video");
    const rect = makeRect(20, 70, 640, 360);

    videoLayer.style.transform = "translateZ(0)";
    video.src = "https://example.org/sibling-pane.mp4";
    videoLayer.appendChild(video);
    player.append(videoLayer, gesturePane);
    document.body.appendChild(player);
    [player, videoLayer, gesturePane, video].forEach((element) => {
      setRect(element, rect);
    });
    setBoxMetrics(player, rect.width, rect.height);

    expect(window.getControllerMount(video)).toBe(player);
    window.ensureController(video, videoLayer);
    expect(video.vsc.controllerHostMount).toBe(player);
    expect(player.lastElementChild).toBe(video.vsc.div);
  });

  it("recovers a controller measured before the player receives layout", async () => {
    vi.useFakeTimers();
    bootInject();
    await settleLifecycle();

    const mount = document.createElement("div");
    const video = document.createElement("video");
    let mountRect = makeRect(0, 0, 0, 0);
    let videoRect = makeRect(0, 0, 0, 0);

    setBoxMetrics(mount, 640, 360);
    mount.getBoundingClientRect = () => mountRect;
    video.getBoundingClientRect = () => videoRect;
    video.src = "https://example.org/late-layout.mp4";
    mount.appendChild(video);
    document.body.appendChild(mount);

    window.ensureController(video, mount);
    expect(video.vsc.div.classList.contains("vsc-geometry-hidden")).toBe(true);

    mountRect = makeRect(20, 80, 640, 360);
    videoRect = makeRect(20, 80, 640, 360);
    await vi.advanceTimersByTimeAsync(100);

    expect(video.vsc.div.classList.contains("vsc-geometry-hidden")).toBe(false);
    expect(video.vsc.div.style.display).not.toBe("none");
    expect(video.vsc.div.style.getPropertyValue("width")).toBe("640px");
    expect(video.vsc.div.style.getPropertyValue("height")).toBe("360px");
  });

  it("keeps YouTube watch, Shorts, and hover controls on the real player boundary", async () => {
    bootInject({ url: "https://www.youtube.com/" });
    await settleLifecycle();

    const player = document.createElement("div");
    player.id = "inline-preview-player";
    player.className = "html5-video-player";
    const zeroHeightVideoContainer = document.createElement("div");
    zeroHeightVideoContainer.className = "html5-video-container";
    const video = document.createElement("video");
    const playerRect = makeRect(40, 120, 402, 226);

    setRect(player, playerRect);
    setBoxMetrics(player, playerRect.width, playerRect.height);
    setRect(zeroHeightVideoContainer, makeRect(40, 120, 402, 0));
    setBoxMetrics(zeroHeightVideoContainer, 402, 0);
    setRect(video, playerRect);
    video.src = "blob:https://www.youtube.com/hover-preview";
    zeroHeightVideoContainer.appendChild(video);
    player.appendChild(zeroHeightVideoContainer);
    document.body.appendChild(player);

    window.ensureController(video, zeroHeightVideoContainer);
    window.ensureController(video, zeroHeightVideoContainer);

    expect(video.vsc.div.parentElement).toBe(player);
    expect(video.vsc.controllerHostMount).toBe(player);
    expect(video.vsc.div.classList.contains("vsc-geometry-hidden")).toBe(false);
    expect(video.vsc.div.style.getPropertyValue("width")).toBe("402px");
    expect(video.vsc.div.style.getPropertyValue("height")).toBe("226px");
  });

  it("does not let shadow host defaults override measured geometry", () => {
    const shadowCss = readWorkspaceFile("extension/content/shadow.css");
    const hostRule = shadowCss.match(/:host\s*\{([^}]*)\}/)[1];
    const fullscreenRule = shadowCss.match(
      /:host\(\.vsc-fullscreen-popover\)\s*\{([^}]*)\}/
    )[1];

    expect(hostRule).not.toMatch(/\b(?:top|left|width|height)\s*:/);
    expect(fullscreenRule).not.toMatch(/\binset\s*:/);
  });

  it("repositions a Shorts controller when playback moves the video on-screen", async () => {
    vi.useFakeTimers();
    bootInject({ url: "https://www.youtube.com/shorts/example" });
    await settleLifecycle();

    const player = document.createElement("div");
    player.className = "html5-video-player";
    const video = document.createElement("video");
    const playerRect = makeRect(40, 64, 351, 624);
    let videoRect = makeRect(40, -560, 351, 624);

    setRect(player, playerRect);
    setBoxMetrics(player, playerRect.width, playerRect.height);
    video.getBoundingClientRect = () => videoRect;
    video.src = "blob:https://www.youtube.com/shorts";
    player.appendChild(video);
    document.body.appendChild(player);

    window.ensureController(video, player);
    expect(video.vsc.div.style.getPropertyValue("top")).toBe("-624px");

    videoRect = playerRect;
    video.dispatchEvent(new Event("playing"));
    await vi.advanceTimersByTimeAsync(0);

    expect(video.vsc.div.style.getPropertyValue("top")).toBe("0px");
  });

  it("targets the controller nearest the pointer unless change-all is selected", async () => {
    bootInject();
    await settleLifecycle();

    const first = createControlledVideo({
      src: "https://example.org/first.mp4",
      mountRect: makeRect(0, 0, 320, 180)
    });
    const second = createControlledVideo({
      src: "https://example.org/second.mp4",
      mountRect: makeRect(500, 0, 320, 180)
    });
    setRect(window.getControllerElement(first.controller), makeRect(10, 10, 120, 30));
    setRect(window.getControllerElement(second.controller), makeRect(510, 10, 120, 30));

    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 600, clientY: 20 })
    );
    window.runAction("faster", 0.1);

    expect(first.video.playbackRate).toBe(1);
    expect(second.video.playbackRate).toBe(1.1);

    window.tc.settings.shortcutTargetMode = "all";
    window.runAction("faster", 0.1);
    expect(first.video.playbackRate).toBe(1.1);
    expect(second.video.playbackRate).toBe(1.2);
  });

  it("ignores popup actions addressed to another frame", async () => {
    const chrome = bootInject();
    await settleLifecycle();
    const { video } = createControlledVideo();
    const listener = chrome.runtime.onMessage.listeners[0];
    const initialSpeed = video.playbackRate;

    listener(
      {
        action: "run_action",
        actionName: "faster",
        targetFrameToken: "another-frame"
      },
      {},
      vi.fn()
    );

    expect(video.playbackRate).toBe(initialSpeed);
  });

  it("removes and restores controls when this tab is paused", async () => {
    const chrome = bootInject();
    await settleLifecycle();
    const { video } = createControlledVideo();
    const listener = chrome.runtime.onMessage.listeners[0];
    const playbackRate = video.playbackRate;

    listener(
      { action: "set_tab_paused", paused: true },
      {},
      vi.fn()
    );
    expect(window.tc.tabPaused).toBe(true);
    expect(video.vsc).toBeUndefined();
    expect(video.playbackRate).toBe(playbackRate);

    listener(
      { action: "set_tab_paused", paused: false },
      {},
      vi.fn()
    );
    expect(window.tc.tabPaused).toBe(false);
    expect(video.vsc).toBeTruthy();
  });

  it("drops a stale hover-preview shortcut target after SPA navigation", async () => {
    bootInject({
      url: "https://www.youtube.com/",
      path: "/"
    });
    await settleLifecycle();

    const preview = createControlledVideo({
      src: "blob:https://www.youtube.com/hover-preview",
      mountRect: makeRect(0, 0, 320, 180)
    });
    preview.mount.id = "inline-preview-player";
    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 90 })
    );
    expect(window.tc.lastPointerPosition).toEqual(
      expect.objectContaining({ document, x: 100, y: 90 })
    );

    window.history.pushState({}, "", "/watch?v=next-video");

    const main = createControlledVideo({
      src: "blob:https://www.youtube.com/main-player",
      mountRect: makeRect(0, 0, 1280, 720)
    });
    main.mount.id = "movie_player";
    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 90 })
    );
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "KeyD",
        key: "d"
      })
    );

    expect(window.tc.lastPointerPosition).not.toBeNull();
    expect(preview.video.playbackRate).toBe(1);
    expect(main.video.playbackRate).toBe(1.1);
  });

  it("captures SPA shortcuts before later page handlers and distinguishes Shift", async () => {
    vi.useFakeTimers();
    bootInject({
      syncGetDelayMs: 25,
      syncData: {
        keyBindings: [
          { action: "advance", code: "KeyX", value: 10 },
          { action: "advance", code: "KeyX", shiftKey: true, value: 3 }
        ]
      }
    });
    expect(window.vscKeydownListenerAttached).toBe(true);

    window.addEventListener(
      "keydown",
      (event) => event.stopImmediatePropagation(),
      true
    );
    await vi.advanceTimersByTimeAsync(25);
    await settleLifecycle();

    const { video } = createControlledVideo();
    video.currentTime = 50;
    video.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        code: "KeyX",
        key: "x"
      })
    );
    video.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        code: "KeyX",
        key: "X",
        shiftKey: true
      })
    );

    expect(video.currentTime).toBe(63);
  });

  it("ignores shortcuts from selects and shadow-DOM edit fields", async () => {
    bootInject();
    await settleLifecycle();
    const { video } = createControlledVideo();
    const select = document.createElement("select");
    const host = document.createElement("site-editor");
    const input = document.createElement("input");
    host.attachShadow({ mode: "open" }).appendChild(input);
    document.body.append(select, host);

    [select, input].forEach((target) => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          composed: true,
          code: "KeyD",
          key: "d"
        })
      );
    });

    expect(video.playbackRate).toBe(1);
  });

  it("finishes a forced SPA initialization after settings hydration", async () => {
    vi.useFakeTimers();
    bootInject({
      url: "https://www.youtube.com/",
      syncGetDelayMs: 1000
    });

    const mount = document.createElement("div");
    const video = document.createElement("video");
    const rect = makeRect(0, 0, 1280, 720);
    mount.id = "movie_player";
    video.src = "blob:https://www.youtube.com/main-player";
    setRect(mount, rect);
    setBoxMetrics(mount, rect.width, rect.height);
    setRect(video, rect);
    mount.appendChild(video);
    document.body.appendChild(mount);

    document.dispatchEvent(new Event("speeder-location-changed"));
    await vi.advanceTimersByTimeAsync(300);
    expect(window.tc.runtimeSettingsHydrated).toBe(false);
    expect(video.vsc).toBeUndefined();

    await vi.advanceTimersByTimeAsync(700);
    await settleLifecycle();

    expect(window.tc.runtimeSettingsHydrated).toBe(true);
    expect(video.vsc).toBeTruthy();
    video.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        code: "KeyD",
        key: "d"
      })
    );
    expect(video.playbackRate).toBe(1.1);
  });

  it("skips ambient loops by default and includes them when explicitly enabled", async () => {
    bootInject();
    await settleLifecycle();

    const mount = document.createElement("div");
    const video = document.createElement("video");
    const rect = makeRect(0, 0, 480, 270);
    video.autoplay = true;
    video.defaultMuted = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.controls = false;
    video.src = "https://example.org/card-loop.mp4";
    setRect(mount, rect);
    setBoxMetrics(mount, rect.width, rect.height);
    setRect(video, rect);
    mount.appendChild(video);
    document.body.appendChild(mount);

    expect(window.ensureController(video, mount)).toBeNull();
    expect(video.vsc).toBeUndefined();

    window.tc.settings.showAmbientLoopControls = true;
    window.tc.siteRuleBase.showAmbientLoopControls = true;
    expect(window.ensureController(video, mount)).toBeTruthy();
    expect(video.vsc.div.isConnected).toBe(true);
  });

  it("always includes a genuine player even when its video has an ambient-loop signature", async () => {
    bootInject();
    await settleLifecycle();

    const player = document.createElement("media-player");
    const video = document.createElement("video");
    const playButton = document.createElement("button");
    const rect = makeRect(0, 0, 640, 360);
    playButton.setAttribute("aria-label", "Play");
    video.autoplay = true;
    video.defaultMuted = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.src = "https://example.org/interactive-loop.mp4";
    player.append(video, playButton);
    document.body.appendChild(player);
    [player, video].forEach((element) => setRect(element, rect));
    setBoxMetrics(player, rect.width, rect.height);

    expect(window.tc.settings.showAmbientLoopControls).toBe(false);
    expect(window.ensureController(video, player)).toBeTruthy();
    expect(video.vsc.div.isConnected).toBe(true);
  });

  it("applies the ambient-loop setting from a matching site rule", async () => {
    bootInject({
      url: "https://news.example.org/story",
      syncData: {
        showAmbientLoopControls: false,
        siteRules: [
          {
            pattern: "news.example.org",
            enabled: true,
            showAmbientLoopControls: true
          }
        ]
      }
    });
    await settleLifecycle();

    const mount = document.createElement("div");
    const video = document.createElement("video");
    const rect = makeRect(0, 0, 480, 270);
    video.autoplay = true;
    video.defaultMuted = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.src = "https://news.example.org/card.mp4";
    mount.appendChild(video);
    document.body.appendChild(mount);
    [mount, video].forEach((element) => setRect(element, rect));
    setBoxMetrics(mount, rect.width, rect.height);

    expect(window.ensureController(video, mount)).toBeTruthy();
    expect(window.tc.settings.showAmbientLoopControls).toBe(true);
  });

  it("moves the host into an ancestor fullscreen subtree and restores it", async () => {
    bootInject();
    await settleLifecycle();

    const normalMount = document.createElement("div");
    const fullscreenPlayer = document.createElement("media-player");
    const provider = document.createElement("media-provider");
    const video = document.createElement("video");
    const wrapper = document.createElement("div");
    const rect = makeRect(0, 0, 640, 360);

    normalMount.style.isolation = "isolate";
    provider.appendChild(video);
    fullscreenPlayer.appendChild(provider);
    normalMount.append(fullscreenPlayer, wrapper);
    document.body.appendChild(normalMount);
    [normalMount, fullscreenPlayer, provider, video].forEach((element) => {
      setRect(element, rect);
      setBoxMetrics(element, rect.width, rect.height);
    });

    const controller = {
      video,
      div: wrapper,
      normalControllerMount: normalMount
    };
    wrapper.showPopover = vi.fn();
    window.setupControllerHostTracking(controller, wrapper, normalMount);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: fullscreenPlayer
    });

    window.syncControllerFullscreenMount(controller);
    expect(fullscreenPlayer.contains(wrapper)).toBe(true);
    expect(wrapper.showPopover).not.toHaveBeenCalled();
    expect(wrapper.hasAttribute("popover")).toBe(false);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null
    });
    window.syncControllerFullscreenMount(controller);
    expect(wrapper.parentElement).toBe(normalMount);

    wrapper.remove();
    controller.controllerHostCleanup();
  });

  it("keeps a visible player-local host when Firefox fullscreens the page root", async () => {
    bootInject();
    await settleLifecycle();

    const { mount, controller, wrapper } = createControlledVideo();
    setRect(document.documentElement, makeRect(0, 0, 0, 0));
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.documentElement
    });

    window.syncControllerFullscreenMount(controller);

    expect(wrapper.parentElement).toBe(mount);
    expect(wrapper.classList.contains("vsc-geometry-hidden")).toBe(false);
    expect(document.documentElement.style.position).toBe("");
    expect(document.documentElement.style.isolation).toBe("");
  });

  it("only promotes the directly-fullscreen video's controller", async () => {
    bootInject();
    await settleLifecycle();

    const fullscreenPlayer = document.createElement("div");
    const fullscreenVideo = document.createElement("video");
    const otherVideo = document.createElement("video");
    const rect = makeRect(0, 0, 640, 360);

    fullscreenVideo.src = "https://example.org/fullscreen.mp4";
    otherVideo.src = "https://example.org/other.mp4";
    fullscreenPlayer.appendChild(fullscreenVideo);
    document.body.append(fullscreenPlayer, otherVideo);
    [fullscreenPlayer, fullscreenVideo, otherVideo].forEach((element) => {
      setRect(element, rect);
      setBoxMetrics(element, rect.width, rect.height);
    });
    window.ensureController(fullscreenVideo, fullscreenPlayer);
    window.ensureController(otherVideo, document.body);
    fullscreenVideo.vsc.div.showPopover = vi.fn();
    otherVideo.vsc.div.showPopover = vi.fn();

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: fullscreenVideo
    });
    window.syncControllerFullscreenMount(fullscreenVideo.vsc);
    window.syncControllerFullscreenMount(otherVideo.vsc);

    expect(fullscreenVideo.vsc.div.showPopover).toHaveBeenCalledOnce();
    expect(otherVideo.vsc.div.showPopover).not.toHaveBeenCalled();
    expect(
      otherVideo.vsc.div.classList.contains("vsc-fullscreen-popover")
    ).toBe(false);
  });

  it("preserves direct-video requestFullscreen semantics and overlays with a popover", async () => {
    bootInject();
    await settleLifecycle();

    const fullscreenRequests = [];
    Object.defineProperty(window.Element.prototype, "requestFullscreen", {
      configurable: true,
      value: function(options) {
        fullscreenRequests.push({ target: this, options });
        Object.defineProperty(document, "fullscreenElement", {
          configurable: true,
          value: this
        });
        return Promise.resolve();
      }
    });
    evaluateScript("extension/content/shadow-bridge.js");

    const { mount, video, controller, wrapper } = createControlledVideo();
    wrapper.showPopover = vi.fn();
    wrapper.hidePopover = vi.fn();
    await video.requestFullscreen({ navigationUI: "hide" });
    document.dispatchEvent(new Event("fullscreenchange"));

    window.syncControllerFullscreenMount(controller);

    expect(fullscreenRequests).toEqual([
      {
        target: video,
        options: { navigationUI: "hide" }
      }
    ]);
    expect(document.fullscreenElement).toBe(video);
    expect(wrapper.showPopover).toHaveBeenCalledOnce();
    expect(wrapper.parentNode).toBe(mount);
    expect(video.contains(wrapper)).toBe(false);
    expect(wrapper.isConnected).toBe(true);
  });

  it("uses a top-layer popover when native controls fullscreen the video element", async () => {
    bootInject();
    await settleLifecycle();

    const { mount, video, controller, wrapper } = createControlledVideo();
    wrapper.showPopover = vi.fn();
    wrapper.hidePopover = vi.fn();
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: video
    });

    expect(window.getControllerMount(video, video)).toBe(mount);
    expect(window.syncControllerFullscreenMount(controller)).toBe(true);
    expect(wrapper.showPopover).toHaveBeenCalledOnce();
    expect(wrapper.parentNode).toBe(mount);
    expect(video.contains(wrapper)).toBe(false);
    expect(wrapper.getAttribute("popover")).toBe("manual");
    expect(wrapper.classList.contains("vsc-fullscreen-popover")).toBe(true);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null
    });
    window.syncControllerFullscreenMount(controller);

    expect(wrapper.hidePopover).toHaveBeenCalledOnce();
    expect(wrapper.hasAttribute("popover")).toBe(false);
    expect(wrapper.classList.contains("vsc-fullscreen-popover")).toBe(false);
  });

  it("uses the fullscreen boundary for a portrait video beneath a gesture pane", async () => {
    bootInject();
    await settleLifecycle();

    const fullscreenPlayer = document.createElement("media-player");
    const provider = document.createElement("media-provider");
    const video = document.createElement("video");
    const gesturePane = document.createElement("div");
    const playerRect = makeRect(0, 0, 1280, 720);
    const portraitRect = makeRect(440, 10, 400, 700);

    gesturePane.className = "gesture-pane";
    provider.appendChild(video);
    fullscreenPlayer.append(provider, gesturePane);
    document.body.appendChild(fullscreenPlayer);
    setRect(fullscreenPlayer, playerRect);
    setRect(gesturePane, playerRect);
    setRect(provider, portraitRect);
    setRect(video, portraitRect);

    expect(window.getControllerMount(video, fullscreenPlayer)).toBe(
      fullscreenPlayer
    );
  });

  it("repairs a controller host removed independently of its video", async () => {
    bootInject();
    await settleLifecycle();

    const { mount, video, wrapper } = createControlledVideo();
    wrapper.remove();
    expect(video.isConnected).toBe(true);

    window.ensureController(video, mount);

    expect(video.vsc).toBeDefined();
    expect(video.vsc.div.isConnected).toBe(true);
    expect(video.vsc.div.parentElement).toBe(mount);
  });

  it("still creates controls when a custom player throws from playbackRate", async () => {
    bootInject();
    await settleLifecycle();
    const mount = document.createElement("div");
    const video = document.createElement("video");
    video.src = "https://example.org/rejecting-player.mp4";
    Object.defineProperty(video, "playbackRate", {
      configurable: true,
      get() {
        return 1;
      },
      set() {
        throw new Error("rate rejected");
      }
    });
    mount.appendChild(video);
    document.body.appendChild(mount);

    expect(() => window.ensureController(video, mount)).not.toThrow();
    expect(video.vsc).toBeDefined();
    expect(video.vsc.div.isConnected).toBe(true);
  });

  it("remounts an existing controller when its video moves between players", async () => {
    bootInject();
    await settleLifecycle();

    const mountA = document.createElement("div");
    const mountB = document.createElement("div");
    const rect = makeRect(0, 0, 640, 360);
    [mountA, mountB].forEach((mount) => {
      setRect(mount, rect);
      setBoxMetrics(mount, rect.width, rect.height);
      document.body.appendChild(mount);
    });

    const { video, wrapper } = createControlledVideo({ mount: mountA });
    mountB.appendChild(video);

    window.ensureController(video, mountB);

    expect(video.vsc.div).toBe(wrapper);
    expect(wrapper.parentElement).toBe(mountB);
    expect(video.vsc.controllerHostMount).toBe(mountB);
    expect(mountA.querySelector(".vsc-controller")).toBeNull();
  });

  it("reconciles a burst of player mutations only once per idle batch", async () => {
    bootInject();
    await settleLifecycle();

    const { mount, wrapper } = createControlledVideo();
    const originalAppendChild = mount.appendChild.bind(mount);
    let controllerReorders = 0;
    mount.appendChild = function(node) {
      if (node === wrapper) controllerReorders += 1;
      return originalAppendChild(node);
    };

    for (let index = 0; index < 25; index += 1) {
      mount.appendChild(document.createElement("span"));
    }
    await settleLifecycle(8);

    expect(controllerReorders).toBe(1);
    expect(mount.lastElementChild).toBe(wrapper);
  });

  it("keeps expanded controls visible and disables auto-hide while hovered", async () => {
    vi.useFakeTimers();
    bootInject({
      syncData: {
        hideWithControls: true,
        hideWithControlsTimer: 1
      }
    });
    await settleLifecycle();

    const { controller, wrapper } = createControlledVideo();
    const controllerElement = window.getControllerElement(controller);
    controllerElement.dispatchEvent(new Event("pointerenter"));

    expect(controller.controllerInteractionActive).toBe(true);
    expect(controllerElement.classList.contains("vsc-controls-hovered")).toBe(true);
    expect(wrapper.classList.contains("vsc-controls-hovered")).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(wrapper.classList.contains("vsc-idle-hidden")).toBe(false);

    controllerElement.dispatchEvent(new Event("pointerleave"));
    expect(controller.controllerInteractionActive).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.classList.contains("vsc-idle-hidden")).toBe(true);
  });

  it("creates named native buttons for in-player controls", async () => {
    bootInject({
      syncData: { controllerButtons: ["rewind", "nudge"] }
    });
    await settleLifecycle();
    const { wrapper } = createControlledVideo();
    const rewind = wrapper.shadowRoot.querySelector('[data-action="rewind"]');
    const nudge = wrapper.shadowRoot.querySelector("#nudge-indicator");

    expect(rewind.tagName).toBe("BUTTON");
    expect(rewind.getAttribute("aria-label")).toBe("Rewind");
    expect(nudge.tagName).toBe("BUTTON");
    expect(nudge.getAttribute("aria-label")).toContain("Subtitle nudge");
  });

  it("does not let YouTube auto-hide collapse controls under the pointer", async () => {
    vi.useFakeTimers();
    bootInject({
      url: "https://www.youtube.com/watch?v=hover-lock",
      syncData: {
        hideWithControls: true,
        hideWithControlsTimer: 1
      }
    });
    await settleLifecycle();

    const player = document.createElement("div");
    player.className = "html5-video-player ytp-autohide";
    const { controller, wrapper } = createControlledVideo({ mount: player });
    const controllerElement = window.getControllerElement(controller);

    expect(wrapper.classList.contains("ytp-autohide")).toBe(true);
    controllerElement.dispatchEvent(new Event("pointerenter"));
    expect(wrapper.classList.contains("ytp-autohide")).toBe(false);

    controllerElement.dispatchEvent(new Event("pointerleave"));
    expect(wrapper.classList.contains("ytp-autohide")).toBe(true);

    player.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(wrapper.classList.contains("vsc-show")).toBe(true);
    player.classList.remove("ytp-autohide");
    player.classList.add("ytp-autohide");
    await settleLifecycle();
    expect(wrapper.classList.contains("ytp-autohide")).toBe(true);
    expect(wrapper.classList.contains("vsc-show")).toBe(true);
  });

  it("suppresses a zero-size host and reveals it when the video becomes visible", async () => {
    bootInject();
    await settleLifecycle();

    const mount = document.createElement("div");
    const mountRect = makeRect(100, 50, 640, 360);
    let videoRect = makeRect(100, 50, 0, 0);
    setRect(mount, mountRect);
    setBoxMetrics(mount, mountRect.width, mountRect.height);

    const video = document.createElement("video");
    video.src = "https://example.org/preload.mp4";
    video.getBoundingClientRect = () => videoRect;
    mount.appendChild(video);
    document.body.appendChild(mount);
    window.ensureController(video, mount);

    const wrapper = video.vsc.div;
    expect(hostIsGeometrySuppressed(wrapper)).toBe(true);

    videoRect = makeRect(140, 80, 320, 180);
    window.positionControllerHost(wrapper, video, mount);

    expect(hostIsGeometrySuppressed(wrapper)).toBe(false);
    expect(wrapper.style.getPropertyValue("width")).toBe("320px");
    expect(wrapper.style.getPropertyValue("height")).toBe("180px");
  });

  it("chooses visible media over an offscreen player for popup actions", async () => {
    bootInject();
    await settleLifecycle();

    const offscreen = createControlledVideo({
      mountRect: makeRect(0, 2000, 1280, 720),
      videoRect: makeRect(0, 2000, 1280, 720),
      src: "https://example.org/offscreen.mp4"
    }).video;
    const visible = createControlledVideo({
      mountRect: makeRect(40, 40, 640, 360),
      videoRect: makeRect(40, 40, 640, 360),
      src: "https://example.org/visible.mp4"
    }).video;

    expect(window.getPrimaryVideoElement()).toBe(visible);
    expect(window.getPrimaryVideoElement()).not.toBe(offscreen);
  });

  it("mounts a controller locally for video directly under an open ShadowRoot", async () => {
    bootInject();
    await settleLifecycle();

    const host = document.createElement("custom-player");
    const shadow = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    const rect = makeRect(20, 30, 640, 360);
    video.src = "https://example.org/shadow.mp4";
    setRect(host, rect);
    setBoxMetrics(host, rect.width, rect.height);
    setRect(video, rect);
    shadow.appendChild(video);
    document.body.appendChild(host);

    window.observeRoot(shadow);
    window.scanRootForMedia(shadow);

    expect(video.vsc).toBeDefined();
    expect(video.vsc.div.getRootNode()).toBe(shadow);
    expect(shadow.contains(video.vsc.div)).toBe(true);
  });

  it("keeps a shadow player controller in its visible root during host fullscreen", async () => {
    bootInject();
    await settleLifecycle();

    const host = document.createElement("fullscreen-shadow-player");
    const shadow = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    const rect = makeRect(0, 0, 640, 360);
    video.src = "https://example.org/shadow-fullscreen.mp4";
    setRect(host, rect);
    setBoxMetrics(host, rect.width, rect.height);
    setRect(video, rect);
    shadow.appendChild(video);
    document.body.appendChild(host);
    window.observeRoot(shadow);
    window.scanRootForMedia(shadow);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: host
    });
    window.syncControllerFullscreenMount(video.vsc);

    expect(window.getControllerMount(video, host)).toBe(shadow);
    expect(video.vsc.div.parentNode).toBe(shadow);
    expect(host.contains(video.vsc.div)).toBe(false);
  });

  it("removes controllers when their open-shadow host is detached", async () => {
    bootInject();
    await settleLifecycle();

    const host = document.createElement("detached-shadow-player");
    const shadow = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    video.src = "https://example.org/detached-shadow.mp4";
    shadow.appendChild(video);
    document.body.appendChild(host);
    window.observeRoot(shadow);
    window.scanRootForMedia(shadow);
    const wrapper = video.vsc.div;

    host.remove();
    await settleLifecycle(6);

    expect(video.vsc).toBeUndefined();
    expect(window.tc.mediaElements).not.toContain(video);
    expect(wrapper.isConnected).toBe(false);
  });

  it("starts and ends a controller drag mounted directly in an open ShadowRoot", async () => {
    bootInject();
    await settleLifecycle();

    const host = document.createElement("drag-shadow-player");
    const shadow = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    const rect = makeRect(20, 30, 640, 360);
    video.src = "https://example.org/drag-shadow.mp4";
    setRect(host, rect);
    setBoxMetrics(host, rect.width, rect.height);
    setRect(video, rect);
    shadow.appendChild(video);
    document.body.appendChild(host);
    window.observeRoot(shadow);
    window.scanRootForMedia(shadow);

    expect(() =>
      window.handleDrag(video, { clientX: 30, clientY: 40 })
    ).not.toThrow();
    expect(video.classList.contains("vcs-dragging")).toBe(true);

    host.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(video.classList.contains("vcs-dragging")).toBe(false);
  });

  it("queues early shadow media until async settings hydration completes", async () => {
    vi.useFakeTimers();
    bootInject({ syncGetDelayMs: 100 });

    const host = document.createElement("early-player");
    const shadow = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    video.src = "https://example.org/early.mp4";
    shadow.appendChild(video);
    document.body.appendChild(host);
    await settleLifecycle();

    expect(video.vsc).toBeUndefined();
    await vi.advanceTimersByTimeAsync(120);
    await settleLifecycle();

    expect(video.vsc).toBeDefined();
    expect(video.vsc.div.isConnected).toBe(true);
    expect(video.vsc.div.getRootNode()).toBe(shadow);
  });

  it("reconciles source children and the emptied lifecycle on an existing controller", async () => {
    bootInject();
    await settleLifecycle();

    const { video, wrapper } = createControlledVideo();
    video.preload = "none";
    video.removeAttribute("src");
    video.dispatchEvent(new Event("emptied"));
    await settleLifecycle();
    expect(wrapper.classList.contains("vsc-nosource")).toBe(true);

    const source = document.createElement("source");
    source.src = "https://example.org/later.mp4";
    video.appendChild(source);
    await settleLifecycle();
    expect(wrapper.classList.contains("vsc-nosource")).toBe(false);

    source.remove();
    video.dispatchEvent(new Event("emptied"));
    await settleLifecycle();
    expect(wrapper.classList.contains("vsc-nosource")).toBe(true);
  });

  it("applies the newly matched SPA rule before choosing source-transition speed", async () => {
    bootInject({
      path: "/watch/one",
      syncData: {
        lastSpeed: 1.8,
        rememberSpeed: false,
        siteRules: [
          {
            pattern: "example.org/watch/",
            enabled: true,
            rememberSpeed: false
          },
          {
            pattern: "example.org/shorts/",
            enabled: true,
            rememberSpeed: true
          }
        ]
      },
      localData: {
        rememberedSpeeds: {
          "https://example.org/short-two.mp4": {
            speed: 1.8,
            updatedAt: 100
          }
        }
      }
    });
    await settleLifecycle();

    const { video } = createControlledVideo({
      src: "https://example.org/watch-one.mp4"
    });
    expect(video.playbackRate).toBe(1);

    window.history.replaceState({}, "", "/shorts/two");
    video.src = "https://example.org/short-two.mp4";
    window.applySourceTransitionPolicy(video, true);

    expect(window.tc.activeSiteRule.pattern).toBe("example.org/shorts/");
    expect(window.tc.settings.rememberSpeed).toBe(true);
    expect(video.vsc.targetSpeed).toBe(1.8);
    expect(video.playbackRate).toBe(1.8);
  });

  it("activates after an initially disabled SPA route becomes enabled", async () => {
    vi.useFakeTimers();
    bootInject({
      path: "/disabled",
      syncData: {
        siteRules: [
          { pattern: "example.org/disabled", enabled: false },
          { pattern: "example.org/enabled", enabled: true }
        ]
      }
    });

    const video = document.createElement("video");
    video.src = "https://example.org/enabled.mp4";
    document.body.appendChild(video);
    expect(video.vsc).toBeUndefined();

    window.history.pushState({}, "", "/enabled");
    window.dispatchEvent(new window.PopStateEvent("popstate"));
    await vi.advanceTimersByTimeAsync(350);
    await settleLifecycle();

    expect(video.vsc).toBeDefined();
    expect(video.vsc.div.isConnected).toBe(true);
  });

  it("rescans an existing open-shadow player when an SPA route becomes enabled", async () => {
    vi.useFakeTimers();
    bootInject({
      path: "/disabled",
      syncData: {
        siteRules: [
          { pattern: "example.org/disabled", enabled: false },
          { pattern: "example.org/enabled", enabled: true }
        ]
      }
    });

    const host = document.createElement("route-shadow-player");
    const shadow = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    video.src = "https://example.org/route-shadow.mp4";
    shadow.appendChild(video);
    document.body.appendChild(host);
    window.observeRoot(shadow);
    expect(video.vsc).toBeUndefined();

    window.history.pushState({}, "", "/enabled");
    window.dispatchEvent(new window.PopStateEvent("popstate"));
    await vi.advanceTimersByTimeAsync(350);
    await settleLifecycle();

    expect(video.vsc).toBeDefined();
    expect(video.vsc.div.getRootNode()).toBe(shadow);
    expect(video.vsc.div.isConnected).toBe(true);
  });

  it("tears controllers down when an enabled SPA route becomes disabled", async () => {
    vi.useFakeTimers();
    bootInject({
      path: "/enabled",
      syncData: {
        siteRules: [
          { pattern: "example.org/enabled", enabled: true },
          { pattern: "example.org/disabled", enabled: false }
        ]
      }
    });

    const { video } = createControlledVideo();
    expect(video.vsc).toBeDefined();

    window.history.pushState({}, "", "/disabled");
    window.dispatchEvent(new window.PopStateEvent("popstate"));
    await vi.advanceTimersByTimeAsync(350);
    await settleLifecycle();

    expect(video.vsc).toBeUndefined();
    expect(document.querySelector(".vsc-controller")).toBeNull();
  });

  it("removes existing audio controllers when live settings disable audio", async () => {
    vi.useFakeTimers();
    const chrome = bootInject({ syncData: { audioBoolean: true } });
    await settleLifecycle();

    const mount = document.createElement("div");
    const audio = document.createElement("audio");
    audio.src = "https://example.org/podcast.mp3";
    mount.appendChild(audio);
    document.body.appendChild(mount);
    window.ensureController(audio, mount);
    expect(audio.vsc).toBeDefined();

    chrome.storage.sync.set({ audioBoolean: false });
    await vi.advanceTimersByTimeAsync(100);
    await settleLifecycle();

    expect(audio.vsc).toBeUndefined();
  });
});
