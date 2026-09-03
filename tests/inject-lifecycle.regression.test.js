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
  if (typeof config.configureWindow === "function") {
    config.configureWindow(window);
  }

  const chrome = createChromeMock({
    syncData: config.syncData,
    localData: config.localData
  });
  if (typeof config.configureChrome === "function") {
    config.configureChrome(chrome);
  }

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
    let readyEvents = 0;
    document.addEventListener("speeder-location-changed", () => {
      locationEvents += 1;
    });
    document.addEventListener("speeder-shadow-root-attached", () => {
      shadowEvents += 1;
    });
    document.addEventListener("speeder-page-bridge-ready", () => {
      readyEvents += 1;
    });
    evaluateScript("extension/content/shadow-bridge.js");
    evaluateScript("extension/content/shadow-bridge.js");

    window.history.pushState({}, "", "/new-route");
    window.history.replaceState({}, "", window.location.href);
    const bridgePlayer = document.createElement("bridge-player");
    document.body.appendChild(bridgePlayer);
    bridgePlayer.attachShadow({ mode: "open" });

    expect(locationEvents).toBe(2);
    expect(shadowEvents).toBe(1);
    expect(readyEvents).toBe(2);
  });

  it("bridges Navigation API entry changes that bypass History wrappers", () => {
    loadHtmlString("<!doctype html><html><body></body></html>");
    const nativePushState = window.history.pushState.bind(window.history);
    let entryChangeListener = null;
    Object.defineProperty(window, "navigation", {
      configurable: true,
      value: {
        addEventListener(type, listener) {
          if (type === "currententrychange") entryChangeListener = listener;
        }
      }
    });
    let locationEvents = 0;
    let navigationReadyEvents = 0;
    document.addEventListener("speeder-location-changed", () => {
      locationEvents += 1;
    });
    document.addEventListener("speeder-page-navigation-api-ready", () => {
      navigationReadyEvents += 1;
    });
    evaluateScript("extension/content/shadow-bridge.js");

    nativePushState({}, "", "/navigation-api-route");
    entryChangeListener(new Event("currententrychange"));

    expect(locationEvents).toBe(1);
    expect(navigationReadyEvents).toBe(1);
  });

  it("keeps the bridge ready when Navigation API registration fails", () => {
    loadHtmlString("<!doctype html><html><body></body></html>");
    Object.defineProperty(window, "navigation", {
      configurable: true,
      value: {
        addEventListener() {
          throw new Error("partial Navigation API");
        }
      }
    });
    let readyEvents = 0;
    let navigationReadyEvents = 0;
    document.addEventListener("speeder-page-bridge-ready", () => {
      readyEvents += 1;
    });
    document.addEventListener("speeder-page-navigation-api-ready", () => {
      navigationReadyEvents += 1;
    });

    expect(() => evaluateScript("extension/content/shadow-bridge.js")).not.toThrow();
    expect(readyEvents).toBe(1);
    expect(navigationReadyEvents).toBe(0);
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

  it("keeps measured geometry out of controller stylesheet defaults", () => {
    [
      {
        css: readWorkspaceFile("extension/content/inject.css"),
        host: /\.vsc-controller\s*\{([^}]*)\}/,
        fullscreen:
          /\.vsc-controller\.vsc-fullscreen-popover\s*\{([^}]*)\}/
      },
      {
        css: readWorkspaceFile("extension/content/shadow.css"),
        host: /:host\s*\{([^}]*)\}/,
        fullscreen: /:host\(\.vsc-fullscreen-popover\)\s*\{([^}]*)\}/
      }
    ].forEach(({ css, host, fullscreen }) => {
      expect(css.match(host)[1]).not.toMatch(
        /\b(?:top|left|width|height)\s*:/
      );
      expect(css.match(fullscreen)[1]).not.toMatch(/\binset\s*:/);
    });
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

  it("reconciles controller geometry after text-only player layout updates", async () => {
    vi.useFakeTimers();
    bootInject();
    await settleLifecycle();

    let playerRect = makeRect(0, 0, 640, 360);
    const { mount, video, wrapper } = createControlledVideo({
      mountRect: playerRect,
      videoRect: playerRect
    });
    mount.getBoundingClientRect = () => playerRect;
    video.getBoundingClientRect = () => playerRect;
    await settleLifecycle();
    expect(video.vsc.controllerHostMount).toBe(mount);
    const scheduleSpy = vi.spyOn(video.vsc, "controllerHostSchedule");

    playerRect = makeRect(0, 0, 800, 450);
    setBoxMetrics(mount, 800, 450);
    mount.appendChild(document.createTextNode("updated player layout"));
    await settleLifecycle();
    await vi.advanceTimersByTimeAsync(1);

    expect(scheduleSpy).toHaveBeenCalled();
    expect(wrapper.style.getPropertyValue("width")).toBe("800px");
    expect(wrapper.style.getPropertyValue("height")).toBe("450px");
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
    const firstLayoutRead = vi.fn(() => first.mount.getBoundingClientRect());
    const secondLayoutRead = vi.fn(() => second.mount.getBoundingClientRect());
    first.video.getBoundingClientRect = firstLayoutRead;
    second.video.getBoundingClientRect = secondLayoutRead;

    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 600, clientY: 20 })
    );
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "KeyD",
        key: "d"
      })
    );

    expect(first.video.playbackRate).toBe(1);
    expect(second.video.playbackRate).toBe(1.1);
    expect(firstLayoutRead).not.toHaveBeenCalled();
    expect(secondLayoutRead).not.toHaveBeenCalled();

    window.tc.settings.shortcutTargetMode = "all";
    window.runAction("faster", 0.1);
    expect(first.video.playbackRate).toBe(1.1);
    expect(second.video.playbackRate).toBe(1.2);
  });

  it("targets the player under a stationary cursor after scrolling down the page", async () => {
    bootInject();
    await settleLifecycle();

    let scrollOffset = 0;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => scrollOffset
    });
    const top = createControlledVideo({
      src: "https://example.org/top.mp4",
      mountRect: makeRect(0, 0, 320, 180)
    });
    const lower = createControlledVideo({
      src: "https://example.org/lower.mp4",
      mountRect: makeRect(0, 1000, 320, 180)
    });
    const topLayoutRead = vi.fn(() =>
      makeRect(0, 0 - scrollOffset, 320, 180)
    );
    const lowerLayoutRead = vi.fn(() =>
      makeRect(0, 1000 - scrollOffset, 320, 180)
    );
    top.video.getBoundingClientRect = topLayoutRead;
    lower.video.getBoundingClientRect = lowerLayoutRead;

    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 90 })
    );
    scrollOffset = 1000;
    window.dispatchEvent(new Event("scroll"));

    expect(topLayoutRead).not.toHaveBeenCalled();
    expect(lowerLayoutRead).not.toHaveBeenCalled();

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "KeyD",
        key: "d"
      })
    );

    expect(top.video.playbackRate).toBe(1);
    expect(lower.video.playbackRate).toBe(1.1);
    expect(topLayoutRead).toHaveBeenCalledTimes(1);
    expect(lowerLayoutRead).toHaveBeenCalledTimes(1);

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "KeyD",
        key: "d"
      })
    );
    expect(lower.video.playbackRate).toBe(1.2);
    expect(
      window.getPrimaryVideoElement([top.video, lower.video])
    ).toBe(lower.video);
    expect(topLayoutRead).toHaveBeenCalledTimes(1);
    expect(lowerLayoutRead).toHaveBeenCalledTimes(1);
  });

  it("uses cursor position recorded before multiple controllers are created", async () => {
    bootInject();
    await settleLifecycle();

    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 20 })
    );
    const first = createControlledVideo({
      src: "https://example.org/first.mp4",
      mountRect: makeRect(0, 0, 320, 180)
    });
    const second = createControlledVideo({
      src: "https://example.org/second.mp4",
      mountRect: makeRect(500, 0, 320, 180)
    });

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "KeyD",
        key: "d"
      })
    );

    expect(first.video.playbackRate).toBe(1.1);
    expect(second.video.playbackRate).toBe(1);
  });

  it("keeps nearest-controller targeting when the cursor stays still across SPA navigation", async () => {
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

    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 20 })
    );
    window.history.pushState({}, "", "/next-route");

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "KeyD",
        key: "d"
      })
    );

    expect(window.tc.lastPointerPosition).toEqual(
      expect.objectContaining({ document, x: 100, y: 20 })
    );
    expect(first.video.playbackRate).toBe(1.1);
    expect(second.video.playbackRate).toBe(1);
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

  it("does not remount a controller after fallback cleanup", async () => {
    bootInject();
    await settleLifecycle();

    const { mount, video, wrapper, controller } = createControlledVideo();
    await settleLifecycle();
    controller.remove = vi.fn(() => {
      throw new Error("cleanup failed");
    });

    window.removeController(video);
    mount.appendChild(document.createElement("span"));
    await settleLifecycle();

    expect(video.vsc).toBeUndefined();
    expect(window.tc.mediaElements).not.toContain(video);
    expect(wrapper.isConnected).toBe(false);
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

  it("retries controller creation when a source changes after a transient failure", async () => {
    bootInject();
    await settleLifecycle();

    const OriginalVideoController = window.tc.videoController;
    let shouldFail = true;
    window.tc.videoController = function(target, parent) {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("player mount not ready");
      }
      return new OriginalVideoController(target, parent);
    };

    const video = document.createElement("video");
    video.src = "https://example.org/transient-first.mp4";
    document.body.appendChild(video);
    await settleLifecycle();

    expect(video.vsc).toBeUndefined();
    expect(video.vscBootstrapSourceObserver).toBeDefined();

    video.src = "https://example.org/transient-second.mp4";
    await settleLifecycle();

    expect(video.vsc).toBeDefined();
    expect(video.vsc.div.isConnected).toBe(true);
    expect(video.vscBootstrapSourceObserver).toBeUndefined();
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

  it("compacts overlapping mutation scan roots without losing coverage", async () => {
    bootInject();
    await settleLifecycle();

    const outer = document.createElement("section");
    const inner = document.createElement("div");
    const sibling = document.createElement("aside");
    const shadowHost = document.createElement("nested-player");
    const firstVideo = document.createElement("video");
    const secondVideo = document.createElement("video");
    firstVideo.src = "https://example.org/first-nested.mp4";
    secondVideo.src = "https://example.org/second-nested.mp4";
    inner.appendChild(firstVideo);
    sibling.appendChild(secondVideo);
    shadowHost.attachShadow({ mode: "open" });
    outer.append(inner, sibling, shadowHost);

    const compacted = window.compactMutationScanCandidates([
      { node: inner, parent: outer },
      { node: firstVideo, parent: inner },
      { node: outer, parent: document.body },
      { node: sibling, parent: outer },
      { node: shadowHost, parent: outer },
      { node: inner, parent: outer }
    ]);

    expect(compacted.map((candidate) => candidate.node)).toEqual([
      outer,
      shadowHost
    ]);

    document.body.appendChild(outer);
    await settleLifecycle(8);
    expect(firstVideo.vsc).toBeDefined();
    expect(secondVideo.vsc).toBeDefined();
  });

  it("does not refresh existing controllers for every new video on one URL", async () => {
    bootInject();
    await settleLifecycle();

    createControlledVideo({ src: "https://example.org/existing.mp4" });
    const originalRefresh = window.refreshAllControllerGeometry;
    const refreshSpy = vi.fn(function() {
      return originalRefresh();
    });
    window.refreshAllControllerGeometry = refreshSpy;

    for (let index = 0; index < 20; index += 1) {
      createControlledVideo({
        src: `https://example.org/batch-${index}.mp4`
      });
    }

    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it("coalesces repeated lifecycle geometry work into one animation frame", async () => {
    vi.useFakeTimers();
    bootInject();
    await settleLifecycle();

    const rect = makeRect(0, 0, 640, 360);
    const { mount, video } = createControlledVideo({
      mountRect: rect,
      videoRect: rect
    });
    await vi.advanceTimersByTimeAsync(0);
    await settleLifecycle();

    const videoRectSpy = vi.fn(() => rect);
    const mountRectSpy = vi.fn(() => rect);
    video.getBoundingClientRect = videoRectSpy;
    mount.getBoundingClientRect = mountRectSpy;

    [
      "loadstart",
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "playing",
      "play"
    ].forEach((eventName) => video.dispatchEvent(new Event(eventName)));

    expect(videoRectSpy).not.toHaveBeenCalled();
    expect(mountRectSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);
    expect(videoRectSpy.mock.calls.length).toBeLessThanOrEqual(1);
    expect(mountRectSpy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("recomputes a changed controller mount asynchronously after media lifecycle events", async () => {
    vi.useFakeTimers();
    bootInject();
    await settleLifecycle();

    const firstMount = document.createElement("div");
    const nextMount = document.createElement("div");
    const rect = makeRect(0, 0, 640, 360);
    [firstMount, nextMount].forEach((mount) => {
      setRect(mount, rect);
      setBoxMetrics(mount, rect.width, rect.height);
      document.body.appendChild(mount);
    });
    const { video, wrapper } = createControlledVideo({
      mount: firstMount,
      mountRect: rect,
      videoRect: rect
    });
    await settleLifecycle();

    const getMountSpy = vi
      .spyOn(window, "getControllerMount")
      .mockReturnValue(nextMount);
    video.dispatchEvent(new Event("loadeddata"));

    expect(wrapper.parentElement).toBe(firstMount);
    await vi.advanceTimersByTimeAsync(0);
    await settleLifecycle();

    expect(getMountSpy).toHaveBeenCalled();
    expect(wrapper.parentElement).toBe(nextMount);
    expect(video.vsc.controllerHostMount).toBe(nextMount);
  });

  it("does not reorder multiple controller hosts past each other forever", async () => {
    bootInject();
    await settleLifecycle();

    const mount = document.createElement("div");
    const rect = makeRect(0, 0, 640, 360);
    setRect(mount, rect);
    setBoxMetrics(mount, rect.width, rect.height);
    document.body.appendChild(mount);

    const first = createControlledVideo({
      mount,
      src: "https://example.org/shared-first.mp4",
      mountRect: rect,
      videoRect: rect
    });
    const second = createControlledVideo({
      mount,
      src: "https://example.org/shared-second.mp4",
      mountRect: rect,
      videoRect: rect
    });
    await settleLifecycle();

    const appendSpy = vi.spyOn(mount, "appendChild");
    for (let index = 0; index < 20; index += 1) {
      window.remountControllerHost(first.video.vsc, mount);
      window.remountControllerHost(second.video.vsc, mount);
    }

    expect(appendSpy).not.toHaveBeenCalled();
    expect(first.wrapper.parentNode).toBe(mount);
    expect(second.wrapper.parentNode).toBe(mount);
  });

  it("reconciles existing siblings when another Speeder host is inserted", async () => {
    bootInject();
    await settleLifecycle();

    const { mount, wrapper } = createControlledVideo();
    const pageOverlay = document.createElement("div");
    pageOverlay.className = "page-owned-overlay";
    mount.appendChild(pageOverlay);
    document.vscMutationObserver.takeRecords();

    const addedControllerHost = document.createElement("div");
    addedControllerHost.className = "vsc-controller";
    addedControllerHost.vscControllerHost = true;
    mount.appendChild(addedControllerHost);
    await settleLifecycle(8);

    expect(pageOverlay.compareDocumentPosition(wrapper)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("keeps Speeder controller shadows out of the page observer network", async () => {
    bootInject();
    await settleLifecycle();

    const { wrapper } = createControlledVideo();
    await settleLifecycle();

    expect(wrapper.shadowRoot.vscMutationObserverAttached).not.toBe(true);
    expect(wrapper.shadowRoot.vscMediaEventListenersAttached).not.toBe(true);
    expect(wrapper.shadowRoot.vscRateListenerAttached).not.toBe(true);
  });

  it("does not observe unrelated src attributes across the document", async () => {
    bootInject();
    await settleLifecycle();

    const image = document.createElement("img");
    document.body.appendChild(image);
    await settleLifecycle();

    image.src = "https://example.org/poster.jpg";
    expect(document.vscMutationObserver.takeRecords()).toHaveLength(0);
  });

  it("still detects a source that receives its src after insertion", async () => {
    bootInject();
    await settleLifecycle();

    const video = document.createElement("video");
    const source = document.createElement("source");
    video.appendChild(source);
    document.body.appendChild(video);
    await settleLifecycle();
    expect(video.vsc).toBeUndefined();
    expect(video.vscBootstrapSourceObserver).toBeDefined();
    expect(window.vscMediaSourceObserver).toBeUndefined();

    source.src = "https://example.org/deferred-source.mp4";
    await settleLifecycle();

    expect(video.vsc).toBeDefined();
    expect(video.vscBootstrapSourceObserver).toBeUndefined();
    expect(video.vsc.div.isConnected).toBe(true);

    const sourcePolicySpy = vi.spyOn(window, "applySourceTransitionPolicy");
    source.src = "https://example.org/next-deferred-source.mp4";
    await settleLifecycle();
    expect(sourcePolicySpy).toHaveBeenCalledWith(video, false);
  });

  it("ignores caption src changes when tracking media source transitions", async () => {
    bootInject();
    await settleLifecycle();

    const { video } = createControlledVideo();
    const track = document.createElement("track");
    video.appendChild(track);
    await settleLifecycle();
    video.playbackRate = 1.5;
    const sourcePolicySpy = vi.spyOn(window, "applySourceTransitionPolicy");

    track.src = "https://example.org/captions.vtt";
    await settleLifecycle();

    expect(sourcePolicySpy).not.toHaveBeenCalled();
    expect(video.playbackRate).toBe(1.5);
  });

  it("retains in-session speed histories while bounding persisted data", async () => {
    vi.useFakeTimers();
    bootInject({ syncData: { rememberSpeed: true } });
    await settleLifecycle();

    for (let index = 0; index < 260; index += 1) {
      const source = `https://example.org/history-${index}.mp4`;
      window.rememberSourceSpeed({ src: source }, 1.5);
      window.rememberToggleSpeed(source, 1.25);
    }

    expect(Object.keys(window.tc.settings.speeds)).toHaveLength(260);
    expect(Object.keys(window.lastToggleSpeed)).toHaveLength(260);
    expect(Object.keys(window.buildRememberedSpeedsPayload())).toHaveLength(200);
    expect(window.tc.settings.speeds).toHaveProperty(
      "https://example.org/history-0.mp4"
    );
    expect(window.lastToggleSpeed).toHaveProperty(
      "https://example.org/history-0.mp4"
    );
    expect(window.tc.settings.speeds).toHaveProperty(
      "https://example.org/history-259.mp4"
    );
    expect(window.lastToggleSpeed).toHaveProperty(
      "https://example.org/history-259.mp4"
    );
  });

  it("avoids redundant startup reads and forced initialization", async () => {
    vi.useFakeTimers();
    const chrome = bootInject({ syncData: { controllerOpacity: 0.6 } });
    await settleLifecycle();

    const scanSpy = vi.spyOn(window, "scanRootForMedia");
    const refreshSpy = vi.spyOn(window, "refreshAllControllerGeometry");
    await vi.advanceTimersByTimeAsync(100);
    await settleLifecycle();

    expect(scanSpy).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(chrome.storage.sync.get).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
  });

  it("does not lose a settings change during delayed startup hydration", async () => {
    vi.useFakeTimers();
    const chrome = bootInject({
      syncData: { controllerOpacity: 0.3 },
      configureChrome(chromeMock) {
        chromeMock.storage.sync.get.mockImplementation((_keys, callback) => {
          const snapshot = chromeMock.storage.sync._dump();
          setTimeout(() => callback(snapshot), 25);
        });
      }
    });

    chrome.storage.sync.set({ controllerOpacity: 0.8 });
    await vi.advanceTimersByTimeAsync(200);
    await settleLifecycle();

    expect(chrome.storage.sync.get.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(window.tc.settings.controllerOpacity).toBe(0.8);
  });

  it("performs a recovery read when all initial storage attempts fail", async () => {
    vi.useFakeTimers();
    const source = "https://example.org/recovered-speed.mp4";
    let syncAttempts = 0;
    let localAttempts = 0;
    const chrome = bootInject({
      syncData: { controllerOpacity: 0.45 },
      localData: {
        rememberedSpeeds: {
          [source]: { speed: 1.7, updatedAt: 100 }
        }
      },
      configureChrome(chromeMock) {
        const syncSnapshot = chromeMock.storage.sync._dump();
        const localSnapshot = chromeMock.storage.local._dump();
        chromeMock.storage.sync.get.mockImplementation((_keys, callback) => {
          syncAttempts += 1;
          if (syncAttempts <= 4) {
            chromeMock.runtime.lastError = { message: "sync unavailable" };
            callback({});
            chromeMock.runtime.lastError = null;
            return;
          }
          callback(syncSnapshot);
        });
        chromeMock.storage.local.get.mockImplementation((_keys, callback) => {
          localAttempts += 1;
          if (localAttempts <= 4) {
            chromeMock.runtime.lastError = { message: "local unavailable" };
            callback({});
            chromeMock.runtime.lastError = null;
            return;
          }
          callback(localSnapshot);
        });
      }
    });

    await vi.advanceTimersByTimeAsync(2000);
    await settleLifecycle();

    expect(chrome.storage.sync.get).toHaveBeenCalledTimes(5);
    expect(chrome.storage.local.get.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(window.tc.settings.controllerOpacity).toBe(0.45);
    expect(window.tc.settings.speeds[source]).toBe(1.7);
  });

  it("stops URL polling after the page-world bridge loads", async () => {
    vi.useFakeTimers();
    bootInject();
    await settleLifecycle();

    const bridge = document.querySelector(
      'script[src$="content/shadow-bridge.js"]'
    );
    expect(window.vscLocationWatchTimer).not.toBeNull();

    const shadowCatchupSpy = vi.spyOn(window, "rescanOpenShadowRoots");
    document.dispatchEvent(new Event("speeder-page-navigation-api-ready"));
    document.dispatchEvent(new Event("speeder-page-bridge-ready"));
    bridge.dispatchEvent(new Event("load"));

    expect(shadowCatchupSpy).toHaveBeenCalledTimes(1);
    expect(window.vscLocationWatchTimer).toBeNull();
    expect(window.vscBoundedShadowFallbackTimers).toHaveLength(0);

    const documentScanSpy = vi.spyOn(window, "scanRootForMedia");
    const shadowScanSpy = vi.spyOn(window, "rescanObservedMediaRoots");
    window.history.replaceState({}, "", window.location.href);
    expect(window.vscNavigationRescanTimer).not.toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    expect(documentScanSpy).not.toHaveBeenCalled();
    expect(shadowScanSpy).not.toHaveBeenCalled();

    window.history.pushState({}, "", "/event-driven-route");
    expect(window.vscNavigationRescanTimer).not.toBeNull();
    await vi.advanceTimersByTimeAsync(300);

    expect(documentScanSpy).not.toHaveBeenCalled();
    expect(shadowScanSpy).not.toHaveBeenCalled();
  });

  it("retains URL polling when Navigation API route events are unavailable", async () => {
    vi.useFakeTimers();
    let nativePushState;
    bootInject({
      configureWindow(win) {
        nativePushState = win.history.pushState.bind(win.history);
      }
    });
    await settleLifecycle();

    const bridge = document.querySelector(
      'script[src$="content/shadow-bridge.js"]'
    );
    document.dispatchEvent(new Event("speeder-page-bridge-ready"));
    bridge.dispatchEvent(new Event("load"));
    expect(window.vscLocationWatchTimer).not.toBeNull();

    nativePushState({}, "", "/unwrapped-route");
    expect(window.vscNavigationRescanTimer).toBeFalsy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(window.vscNavigationRescanTimer).not.toBeNull();
  });

  it("rechecks deferred media on same-URL state navigation without a full scan", async () => {
    vi.useFakeTimers();
    bootInject();
    await settleLifecycle();
    document.dispatchEvent(new Event("speeder-page-bridge-ready"));

    const mount = document.createElement("div");
    const video = document.createElement("video");
    video.src = "https://example.org/ambient-to-player.mp4";
    video.autoplay = true;
    video.defaultMuted = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    mount.appendChild(video);
    document.body.appendChild(mount);
    await settleLifecycle();
    expect(video.vsc).toBeUndefined();

    video.loop = false;
    const documentScanSpy = vi.spyOn(window, "scanRootForMedia");
    window.history.replaceState({}, "", window.location.href);
    await vi.advanceTimersByTimeAsync(300);
    await settleLifecycle();

    expect(documentScanSpy).not.toHaveBeenCalled();
    expect(video.vsc).toBeDefined();
    expect(video.vsc.div.isConnected).toBe(true);
  });

  it("reuses one pointer record instead of allocating on every mouse move", async () => {
    bootInject();
    await settleLifecycle();
    createControlledVideo();

    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 10, clientY: 20, bubbles: true })
    );
    const pointerRecord = window.tc.lastPointerPosition;
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 30, clientY: 40, bubbles: true })
    );

    expect(window.tc.lastPointerPosition).toBe(pointerRecord);
    expect(pointerRecord).toEqual(
      expect.objectContaining({ x: 30, y: 40, document })
    );
  });

  it("matches site rules once per URL instead of once per media event", async () => {
    bootInject({
      syncData: {
        siteRules: [
          { pattern: "example.org", controllerLocation: "bottom-left" }
        ]
      }
    });
    await settleLifecycle();

    const matchSpy = vi.spyOn(
      window.SpeederShared.siteRules,
      "matchSiteRule"
    );
    const { mount, video } = createControlledVideo();
    [
      "loadstart",
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "playing",
      "play"
    ].forEach((eventName) => video.dispatchEvent(new Event(eventName)));

    expect(matchSpy).not.toHaveBeenCalled();

    window.history.pushState({}, "", "/next-player");
    window.ensureController(video, mount);
    expect(matchSpy).toHaveBeenCalledTimes(1);
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
    const offscreenLayoutRead = vi.spyOn(offscreen, "getBoundingClientRect");
    const visibleLayoutRead = vi.spyOn(visible, "getBoundingClientRect");

    expect(window.getPrimaryVideoElement()).toBe(visible);
    expect(window.getPrimaryVideoElement()).not.toBe(offscreen);
    expect(offscreenLayoutRead).not.toHaveBeenCalled();
    expect(visibleLayoutRead).not.toHaveBeenCalled();
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
    expect(shadow.vscMutationObserverAttached).toBe(false);

    document.body.appendChild(host);
    await settleLifecycle(6);

    expect(shadow.vscMutationObserverAttached).toBe(true);
    expect(video.vsc).toBeDefined();
    expect(video.vsc.div.getRootNode()).toBe(shadow);
  });

  it("releases detached shadow roots without WeakRef and rediscovers them on insertion", async () => {
    bootInject({
      configureWindow(targetWindow) {
        Object.defineProperty(targetWindow, "WeakRef", {
          configurable: true,
          value: undefined
        });
      }
    });
    await settleLifecycle();

    const host = document.createElement("legacy-shadow-player");
    const shadow = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    video.src = "https://example.org/legacy-shadow.mp4";
    shadow.appendChild(video);
    document.body.appendChild(host);
    await settleLifecycle(6);

    expect(window.vscSupportsWeakRootReferences).toBe(false);
    expect(video.vsc).toBeDefined();

    host.remove();
    await settleLifecycle(6);

    expect(shadow.vscMutationObserverAttached).toBe(false);
    expect(shadow.vscObservedRootTracked).toBe(false);
    expect(window.vscSuspendedObservedRootList).not.toContain(shadow);
    expect(video.vsc).toBeUndefined();

    document.body.appendChild(host);
    await settleLifecycle(8);

    expect(shadow.vscMutationObserverAttached).toBe(true);
    expect(shadow.vscObservedRootTracked).toBe(true);
    expect(video.vsc).toBeDefined();
  });

  it("keeps controls when a video moves within an open ShadowRoot", async () => {
    bootInject();
    await settleLifecycle();

    const host = document.createElement("moving-shadow-player");
    const shadow = host.attachShadow({ mode: "open" });
    const firstMount = document.createElement("div");
    const secondMount = document.createElement("div");
    const video = document.createElement("video");
    video.src = "https://example.org/moving-shadow.mp4";
    firstMount.appendChild(video);
    shadow.append(firstMount, secondMount);
    document.body.appendChild(host);
    window.observeRoot(shadow);
    window.scanRootForMedia(shadow);
    const wrapper = video.vsc.div;

    secondMount.appendChild(video);
    await settleLifecycle(8);

    expect(video.vsc).toBeDefined();
    expect(video.vsc.div).toBe(wrapper);
    expect(wrapper.isConnected).toBe(true);
    expect(wrapper.parentNode).toBe(secondMount);
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

  it("keeps one set-backed queue entry per media element before hydration", async () => {
    vi.useFakeTimers();
    bootInject({ syncGetDelayMs: 100 });

    const videos = Array.from({ length: 24 }, (_, index) => {
      const video = document.createElement("video");
      video.src = `https://example.org/early-${index}.mp4`;
      document.body.appendChild(video);
      for (let repeat = 0; repeat < 6; repeat += 1) {
        window.ensureController(video, document.body);
      }
      return video;
    });

    expect(window.tc.pendingMediaCandidates).toHaveLength(videos.length);
    expect(
      videos.every((video) => window.tc.pendingMediaCandidateNodes.has(video))
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(120);
    await settleLifecycle();

    expect(window.tc.pendingMediaCandidates).toHaveLength(0);
    expect(videos.every((video) => video.vsc && video.vsc.div)).toBe(true);
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
