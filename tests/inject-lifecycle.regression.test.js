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

  it("inlines the controller stylesheet without exposing an extension URL to the page", async () => {
    const css = readWorkspaceFile("extension/content/shadow.css");
    let resolveCss;
    const fetchSpy = vi.fn(() => new Promise((resolve) => { resolveCss = resolve; }));
    bootInject({ configureWindow(win) { win.fetch = fetchSpy; } });
    await settleLifecycle();
    const { wrapper } = createControlledVideo();
    const shadow = wrapper.shadowRoot;
    expect(shadow.querySelector("link")).toBeNull();
    expect(shadow.innerHTML).not.toMatch(/moz-extension:/);
    const style = shadow.querySelector("style");
    // Hidden, not unstyled, until the text arrives.
    expect(style.textContent).toMatch(/#controller\{visibility:hidden!important\}/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(window.chrome.runtime.getURL("content/shadow.css"));

    resolveCss({ ok: true, text: () => Promise.resolve(css) });
    await settleLifecycle();
    expect(style.textContent).toBe(css);

    const second = createControlledVideo();
    expect(second.wrapper.shadowRoot.querySelector("style").textContent).toBe(css);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const manifest = JSON.parse(readWorkspaceFile("extension/manifest.json"));
    expect(manifest.web_accessible_resources).toEqual(["content/shadow-bridge.js"]);
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

  it("measures ambient-loop player chrome once per lifecycle burst until size or source changes", async () => {
    const observers = [];
    bootInject({
      configureWindow(win) {
        win.ResizeObserver = class {
          constructor(callback) {
            this.callback = callback;
            this.targets = new Set();
            observers.push(this);
          }
          observe(target) { this.targets.add(target); }
          unobserve(target) { this.targets.delete(target); }
          disconnect() { this.targets.clear(); }
        };
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
    video.src = "https://example.org/hero-loop.mp4";
    setRect(mount, rect);
    setBoxMetrics(mount, rect.width, rect.height);
    const measure = vi.fn(() => rect);
    video.getBoundingClientRect = measure;
    mount.appendChild(video);
    document.body.appendChild(mount);
    await settleLifecycle();
    measure.mockClear();

    const burst = ["loadedmetadata", "loadeddata", "canplay", "play", "playing"];
    burst.forEach((type) => video.dispatchEvent(new Event(type)));
    await settleLifecycle();
    expect(video.vsc).toBeUndefined();
    expect(measure.mock.calls.length).toBeLessThanOrEqual(1);

    const chromeObserver = observers.find((observer) => observer.targets.has(video));
    expect(chromeObserver).toBeDefined();
    const notify = (width, height) => chromeObserver.callback([
      { target: video, contentRect: { width, height } }
    ]);
    // The initial observation only records the size.
    notify(480, 270);
    measure.mockClear();
    burst.forEach((type) => video.dispatchEvent(new Event(type)));
    expect(measure).not.toHaveBeenCalled();

    notify(960, 540);
    video.dispatchEvent(new Event("play"));
    expect(measure).toHaveBeenCalled();

    measure.mockClear();
    video.dispatchEvent(new Event("loadstart"));
    expect(measure).toHaveBeenCalled();

    measure.mockClear();
    video.src = "https://example.org/hero-loop-2.mp4";
    video.dispatchEvent(new Event("canplay"));
    expect(measure).toHaveBeenCalled();
    expect(video.vsc).toBeUndefined();
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

  it.each(["video/mp4", "video/webm", "audio/ogg", "application/ogg"])(
    "preserves native %s document layout while keeping speed controls",
    async (contentType) => {
      bootInject({
        configureWindow(win) {
          Object.defineProperty(win.document, "contentType", { value: contentType });
        }
      });
      await settleLifecycle();

      // Firefox centers an absolutely positioned video against the viewport.
      // Its empty body has no height; positioning it collapses the video.
      document.body.style.position = "static";
      const video = document.createElement("video");
      video.src = "https://example.org/native-media";
      video.controls = true;
      video.getBoundingClientRect = () =>
        document.body.style.position === "static"
          ? makeRect(80, 100, 640, 360)
          : makeRect(0, 0, 0, 0);
      setRect(document.body, makeRect(8, 8, 784, 0));
      document.body.appendChild(video);

      const controller = window.ensureController(video, document.body);
      expect(document.body.style.position).toBe("static");
      expect(document.body.style.isolation).toBe("");
      expect(controller.div.parentNode).toBe(document.body);
      expect(hostIsGeometrySuppressed(controller.div)).toBe(false);
      expect(controller.div.style.top).toBe("100px");
      expect(controller.div.style.left).toBe("80px");
      expect(controller.div.style.height).toBe("360px");
      expect(video.controls).toBe(true);
      window.setSpeed(video, 1.5, false, false);
      expect(video.playbackRate).toBe(1.5);

      controller.div.showPopover = vi.fn();
      controller.div.hidePopover = vi.fn();
      Object.defineProperty(document, "fullscreenElement", {
        configurable: true, value: video
      });
      document.dispatchEvent(new Event("fullscreenchange"));
      expect(controller.div.showPopover).toHaveBeenCalledOnce();
      Object.defineProperty(document, "fullscreenElement", {
        configurable: true, value: null
      });
      document.dispatchEvent(new Event("fullscreenchange"));
      await settleLifecycle();
      expect(hostIsGeometrySuppressed(controller.div)).toBe(false);
      expect(document.body.style.position).toBe("static");
      window.removeController(video);
      expect(document.body.style.position).toBe("static");
      expect(document.body.style.isolation).toBe("");
    }
  );

  it("keeps the YouTube host in fullscreen through subsequent media events", async () => {
    bootInject({ url: "https://www.youtube.com/watch?v=fullscreen" });
    await settleLifecycle();
    const player = document.createElement("div");
    player.className = "html5-video-player";
    const provider = document.createElement("div");
    const rect = makeRect(0, 0, 640, 360);
    setRect(player, rect);
    setRect(provider, rect);
    setBoxMetrics(player, 640, 360);
    setBoxMetrics(provider, 640, 360);
    player.appendChild(provider);
    document.body.appendChild(player);
    const { video, wrapper } = createControlledVideo({ mount: provider });
    expect(wrapper.parentNode).toBe(player);
    await settleLifecycle(8);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true, value: provider
    });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(wrapper.parentNode).toBe(provider);
    await settleLifecycle(8);
    ["play", "playing", "loadedmetadata", "canplay"].forEach((type) => {
      video.dispatchEvent(new Event(type));
    });
    await settleLifecycle(8);
    expect(wrapper.parentNode).toBe(provider);
    expect(hostIsGeometrySuppressed(wrapper)).toBe(false);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true, value: null
    });
    document.dispatchEvent(new Event("fullscreenchange"));
    await settleLifecycle();
    expect(wrapper.parentNode).toBe(player);
  });

  it("uses the current player when fullscreen follows a video move before reconciliation", async () => {
    bootInject({ url: "https://www.youtube.com/watch?v=moved-player" });
    await settleLifecycle();
    const first = document.createElement("div");
    const second = document.createElement("div");
    const rect = makeRect(0, 0, 640, 360);
    [first, second].forEach((player) => {
      player.className = "html5-video-player";
      setRect(player, rect);
      setBoxMetrics(player, 640, 360);
      document.body.appendChild(player);
    });
    const { video, wrapper } = createControlledVideo({ mount: first });
    second.appendChild(video);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true, value: document.documentElement
    });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(wrapper.parentNode).toBe(second);
    expect(video.vsc.normalControllerMount).toBe(second);
  });

  it.each([
    "https://www.reddit.com/r/videos/",
    "https://www.facebook.com/watch/",
    "https://tv.apple.com/"
  ])("mounts the initial controller with the generic resolver on %s", async (url) => {
    bootInject({ url });
    await settleLifecycle();
    const outer = document.createElement("div");
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    document.body.append(outer, scrim);
    const mount = document.createElement("div");
    outer.appendChild(mount);
    const { video, wrapper } = createControlledVideo({ mount });
    expect(wrapper.parentNode).toBe(window.getControllerMount(video));
    expect(wrapper.parentNode).not.toBe(scrim);
  });

  it("preserves a sibling overlay mount during fullscreen sync", async () => {
    bootInject();
    await settleLifecycle();
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    setRect(scrim, makeRect(0, 0, 640, 360));
    setBoxMetrics(scrim, 640, 360);
    document.body.appendChild(scrim);
    const { video, wrapper, controller } = createControlledVideo();
    // No hostname-specific mount exists any more; install the sibling mount
    // directly to cover the non-containing normal-mount branch.
    window.setNormalControllerMount(controller, scrim);
    window.remountControllerHost(controller, scrim);
    expect(controller.normalMountContainedMedia).toBe(false);
    expect(wrapper.parentNode).toBe(scrim);
    expect(scrim.contains(video)).toBe(false);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true, value: document.documentElement
    });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(wrapper.parentNode).toBe(scrim);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true, value: null
    });
    window.syncControllerFullscreenMount(controller);
    expect(wrapper.parentNode).toBe(scrim);
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

  it("ignores image src changes without checking URLs or scanning descendants", async () => {
    bootInject();
    await settleLifecycle();

    const image = document.createElement("img");
    document.body.appendChild(image);
    await settleLifecycle();

    const urlSpy = vi.spyOn(window, "isChallengeUrl");
    const querySpy = vi.spyOn(image, "querySelectorAll");
    image.src = "https://challenges.cloudflare.com/poster.jpg";
    await settleLifecycle();
    expect(urlSpy).not.toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
    expect(window.vscPageHooksSuspended).toBe(false);
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
    window.navigation = new window.EventTarget();
    evaluateScript("extension/content/shadow-bridge.js");
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
    evaluateScript("extension/content/shadow-bridge.js");

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
  it.each([
    ["script", "https://challenges.cloudflare.com/turnstile/v0/api.js"],
    ["script", "/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=x"],
    ["iframe", "https://challenges.cloudflare.com/widget"]
  ])("restores page hooks for a later %s challenge resource and retains controls", async (tag, src) => {
    vi.useFakeTimers();
    let descriptor;
    bootInject({ configureWindow(win) {
      descriptor = Object.getOwnPropertyDescriptor(win.Element.prototype, "attachShadow");
      win.navigation = new win.EventTarget();
    } });
    await settleLifecycle();
    evaluateScript("extension/content/shadow-bridge.js");
    expect(window.__speederPageShadowBridgeInstalled).toBe(true);
    expect(window.vscLocationWatchTimer).toBeNull();
    const container = document.createElement("section");
    const resource = document.createElement(tag);
    resource.src = src;
    container.appendChild(resource);
    document.body.appendChild(container);
    await Promise.resolve();
    expect(window.Element.prototype.attachShadow).toBe(descriptor.value);
    expect(Object.getOwnPropertyDescriptor(window.Element.prototype, "attachShadow")).toEqual(descriptor);
    expect(window.history.hasOwnProperty("pushState")).toBe(false);
    expect(window.history.hasOwnProperty("replaceState")).toBe(false);
    expect(Object.keys(window).filter((key) => key.startsWith("__speeder"))).toEqual([]);
    expect(window.vscPageHooksSuspended).toBe(true);
    expect(window.vscLocationWatchTimer).toBeTruthy();
    expect(window.vscBoundedShadowFallbackTimers).toHaveLength(3);
    const { video, wrapper } = createControlledVideo();
    document.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true, code: "KeyD", key: "d"
    }));
    expect(video.playbackRate).toBe(1.1);
    expect(wrapper.isConnected).toBe(true);
    const snapshot = window.eval(readWorkspaceFile("extension/content/frame-speed-snapshot.js"));
    expect(snapshot.speed).toBe(1.1);
    expect(snapshot.frameToken).toBe(window.tc.frameToken);
    expect(snapshot.diagnostics.pageHooks).toEqual({ installed: false, suspended: true, reason: "challenge" });
    resource.remove();
    window.installPageShadowBridge();
    await vi.advanceTimersByTimeAsync(1000);
    expect(window.Element.prototype.attachShadow).toBe(descriptor.value);
    expect(window.__speederPageShadowBridgeInstalled).toBeUndefined();
    window.history.pushState({}, "", "/suspended-route");
    await vi.advanceTimersByTimeAsync(1400);
    expect(window.tc.siteRuleAppliedHref).toBe(window.location.href);
  });

  it.each([
    ["early", "script", "/cdn-cgi/challenge-platform/h/b/orchestrate/x.js"],
    ["runtime", "script", "/cdn-cgi/challenge-platform/h/b/orchestrate/x.js"],
    ["early", "iframe", "https://challenges.cloudflare.com/widget"],
    ["runtime", "iframe", "https://challenges.cloudflare.com/widget"]
  ])("restores hooks for delayed %s %s src assignments", async (phase, tag, src) => {
    vi.useFakeTimers();
    let descriptor;
    bootInject({ syncGetDelayMs: phase === "early" ? 100 : 0, configureWindow(win) {
      descriptor = Object.getOwnPropertyDescriptor(win.Element.prototype, "attachShadow");
    } });
    if (phase === "runtime") await settleLifecycle();
    evaluateScript("extension/content/shadow-bridge.js");
    const resource = document.createElement(tag);
    document.body.appendChild(resource);
    await settleLifecycle();
    resource.src = src;
    await Promise.resolve();
    expect(window.vscPageHooksSuspended).toBe(true);
    expect(Object.getOwnPropertyDescriptor(window.Element.prototype, "attachShadow")).toEqual(descriptor);
    expect(window.history.hasOwnProperty("pushState")).toBe(false);
    expect(Object.getOwnPropertyNames(window).filter((key) => key.startsWith("__speeder"))).toEqual([]);
  });

  it("keeps hooks installed for a non-challenge script src change", async () => {
    bootInject();
    await settleLifecycle();
    evaluateScript("extension/content/shadow-bridge.js");
    const script = document.createElement("script");
    document.head.appendChild(script);
    await settleLifecycle();
    script.src = "/ordinary-loader.js";
    await settleLifecycle();
    expect(window.vscPageHooksSuspended).toBe(false);
    expect(window.__speederPageShadowBridgeInstalled).toBe(true);
  });

  it.each(["site", "global"])("restores hooks after %s disable hydrates and reinstalls once on storage enable", async (kind) => {
    vi.useFakeTimers();
    let descriptor;
    const chrome = bootInject({
      syncGetDelayMs: 100,
      syncData: kind === "site" ? { siteRules: [{ pattern: "example.org", enabled: false }] } : { enabled: false },
      configureWindow(win) { descriptor = Object.getOwnPropertyDescriptor(win.Element.prototype, "attachShadow"); }
    });
    evaluateScript("extension/content/shadow-bridge.js");
    expect(window.__speederPageShadowBridgeInstalled).toBe(true);
    await vi.advanceTimersByTimeAsync(110);
    await settleLifecycle();
    expect(window.vscPageHooksInactive).toBe(true);
    expect(window.vscPageHooksSuspended).toBe(false);
    expect(Object.getOwnPropertyDescriptor(window.Element.prototype, "attachShadow")).toEqual(descriptor);
    expect(window.history.hasOwnProperty("pushState")).toBe(false);
    expect(Object.getOwnPropertyNames(window).filter((key) => key.startsWith("__speeder"))).toEqual([]);
    expect(window.vscPageShadowBridgeRequested).toBe(false);

    const host = document.createElement("disabled-player");
    document.body.appendChild(host);
    await settleLifecycle();
    const root = host.attachShadow({ mode: "closed" });
    Object.defineProperty(host, "openOrClosedShadowRoot", { value: root });
    const video = document.createElement("video");
    video.src = "https://example.org/disabled.mp4";
    root.appendChild(video);
    await settleLifecycle();
    expect(video.vsc).toBeUndefined();
    expect(window.getDiagnosticsSnapshot(video).pageHooks).toEqual({ installed: false, suspended: true, reason: "inactive" });
    const append = vi.spyOn(document.documentElement, "appendChild");
    chrome.storage.sync.set(kind === "site" ? { siteRules: [] } : { enabled: true });
    await vi.advanceTimersByTimeAsync(200);
    await settleLifecycle();
    window.isSpeederActiveForCurrentPage();
    window.isSpeederActiveForCurrentPage();
    await settleLifecycle();
    expect(append.mock.calls.filter(([node]) => node.src && node.src.endsWith("content/shadow-bridge.js"))).toHaveLength(1);
    expect(window.vscPageHooksInactive).toBe(false);
    expect(video.vsc.div.getRootNode()).toBe(root);
    evaluateScript("extension/content/shadow-bridge.js");
    expect(window.__speederPageShadowBridgeInstalled).toBe(true);
    expect(window.getDiagnosticsSnapshot(video).pageHooks).toEqual({ installed: true, suspended: false, reason: null });
    // A second cycle must capture fresh descriptors and fully restore again.
    chrome.storage.sync.set({ enabled: false });
    await vi.advanceTimersByTimeAsync(200);
    await settleLifecycle();
    expect(Object.getOwnPropertyDescriptor(window.Element.prototype, "attachShadow")).toEqual(descriptor);
    expect(window.history.hasOwnProperty("pushState")).toBe(false);
    expect(Object.getOwnPropertyNames(window).filter((key) => key.startsWith("__speeder"))).toEqual([]);
  });

  it.each(["global-enable", "site-rule", "tab-unpause", "spa-route"])(
    "parks discovery while disabled and controls media inserted meanwhile after %s", async (path) => {
      vi.useFakeTimers();
      const syncData = {
        "global-enable": { enabled: false },
        "site-rule": { siteRules: [{ pattern: "example.org", enabled: false }] },
        "tab-unpause": {},
        "spa-route": { enabled: false, siteRules: [{ pattern: "example.org/enabled", enabled: true }] }
      }[path];
      const chrome = bootInject({ path: path === "spa-route" ? "/disabled" : "/", syncData });
      await settleLifecycle();
      if (path === "tab-unpause") {
        createControlledVideo();
        expect(document.vscMutationObserverAttached).toBe(true);
        chrome.runtime.onMessage.listeners[0]({ action: "set_tab_paused", paused: true }, {}, vi.fn());
        await settleLifecycle();
        expect(window.tc.mediaElements).toHaveLength(0);
      } else {
        expect(window.vscPageHooksInactive).toBe(true);
        // No bounded full-document shadow walks on a disabled page.
        expect(window.vscBoundedShadowFallbackTimers || []).toHaveLength(0);
      }
      expect(document.vscMutationObserverAttached).not.toBe(true);
      expect(window.tc.pendingMediaCandidates).toHaveLength(0);

      const scan = vi.spyOn(window, "scanNodeForMedia");
      const lightVideo = document.createElement("video");
      lightVideo.src = "https://example.org/light-while-disabled.mp4";
      const lightMount = document.createElement("div");
      lightMount.appendChild(lightVideo);
      document.body.appendChild(lightMount);
      const host = document.createElement("parked-player");
      document.body.appendChild(host);
      const root = host.attachShadow({ mode: "open" });
      const shadowVideo = document.createElement("video");
      shadowVideo.src = "https://example.org/shadow-while-disabled.mp4";
      root.appendChild(shadowVideo);
      await vi.advanceTimersByTimeAsync(5000);
      await settleLifecycle();
      expect(scan).not.toHaveBeenCalled();
      expect(lightVideo.vsc).toBeUndefined();
      expect(shadowVideo.vsc).toBeUndefined();
      scan.mockRestore();

      if (path === "global-enable") chrome.storage.sync.set({ enabled: true });
      if (path === "site-rule") chrome.storage.sync.set({ siteRules: [] });
      if (path === "tab-unpause") {
        chrome.runtime.onMessage.listeners[0]({ action: "set_tab_paused", paused: false }, {}, vi.fn());
      }
      if (path === "spa-route") window.history.pushState({}, "", "/enabled");
      await vi.advanceTimersByTimeAsync(1400);
      await settleLifecycle();

      expect(lightVideo.vsc && lightVideo.vsc.div.isConnected).toBe(true);
      expect(shadowVideo.vsc && shadowVideo.vsc.div.getRootNode()).toBe(root);
      expect(document.vscMutationObserverAttached).toBe(true);
      // Observation is live again: later insertions are discovered as usual.
      const lateVideo = document.createElement("video");
      lateVideo.src = "https://example.org/late.mp4";
      document.body.appendChild(lateVideo);
      await vi.advanceTimersByTimeAsync(1100);
      await settleLifecycle();
      expect(lateVideo.vsc).toBeDefined();
    }
  );

  it("follows whitelisted SPA routes in both directions while global settings are disabled", async () => {
    vi.useFakeTimers();
    let descriptor;
    bootInject({ path: "/disabled", syncData: { enabled: false, siteRules: [
      { pattern: "example.org/enabled", enabled: true }
    ] }, configureWindow(win) { descriptor = Object.getOwnPropertyDescriptor(win.Element.prototype, "attachShadow"); } });
    await settleLifecycle();
    expect(window.vscPageHooksInactive).toBe(true);
    window.history.pushState({}, "", "/enabled");
    await vi.advanceTimersByTimeAsync(1400);
    await settleLifecycle();
    expect(window.vscPageHooksInactive).toBe(false);
    evaluateScript("extension/content/shadow-bridge.js");
    expect(window.__speederPageShadowBridgeInstalled).toBe(true);
    window.history.pushState({}, "", "/disabled");
    await vi.advanceTimersByTimeAsync(350);
    await settleLifecycle();
    expect(window.vscPageHooksInactive).toBe(true);
    expect(Object.getOwnPropertyDescriptor(window.Element.prototype, "attachShadow")).toEqual(descriptor);
    expect(window.history.hasOwnProperty("pushState")).toBe(false);
    expect(Object.getOwnPropertyNames(window).filter((key) => key.startsWith("__speeder"))).toEqual([]);
  });

  it("follows URL hook activity while a hydrated page has no body", async () => {
    vi.useFakeTimers();
    let descriptor;
    bootInject({ path: "/enabled", syncData: { enabled: false, siteRules: [
      { pattern: "example.org/enabled", enabled: true }
    ] }, configureWindow(win) { descriptor = Object.getOwnPropertyDescriptor(win.Element.prototype, "attachShadow"); } });
    await settleLifecycle();
    evaluateScript("extension/content/shadow-bridge.js");
    const body = document.body;
    body.remove();
    try {
      window.history.pushState({}, "", "/disabled");
      await vi.advanceTimersByTimeAsync(350);
      await settleLifecycle();
      expect(window.vscPageHooksInactive).toBe(true);
      expect(window.__speederPageShadowBridgeInstalled).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(window.Element.prototype, "attachShadow")).toEqual(descriptor);
      window.history.pushState({}, "", "/enabled");
      await vi.advanceTimersByTimeAsync(1400);
      await settleLifecycle();
      expect(window.vscPageHooksInactive).toBe(false);
      expect(window.vscPageShadowBridgeRequested).toBe(true);
      evaluateScript("extension/content/shadow-bridge.js");
      expect(window.__speederPageShadowBridgeInstalled).toBe(true);
    } finally {
      document.documentElement.appendChild(body);
    }
  });

  it.each(["load", "error"])("ignores a restored bridge's stale %s callback after reactivation", async (eventName) => {
    vi.useFakeTimers();
    const chrome = bootInject({ syncData: { enabled: false } });
    const oldBridge = window.vscPageShadowBridgeScript;
    await settleLifecycle();
    expect(oldBridge.isConnected).toBe(false);
    chrome.storage.sync.set({ enabled: true });
    await vi.advanceTimersByTimeAsync(100);
    await settleLifecycle();
    const newBridge = window.vscPageShadowBridgeScript;
    expect(newBridge).not.toBe(oldBridge);
    expect(newBridge.isConnected).toBe(true);
    oldBridge.dispatchEvent(new Event(eventName));
    await vi.advanceTimersByTimeAsync(1000);
    expect(window.vscPageShadowBridgeRequested).toBe(true);
    expect(window.vscPageShadowBridgeRetries).toBe(0);
    expect(window.vscPageShadowBridgeScript).toBe(newBridge);
  });

  it("keeps hooks installed during tab pause", async () => {
    const chrome = bootInject();
    await settleLifecycle();
    evaluateScript("extension/content/shadow-bridge.js");
    const attach = window.Element.prototype.attachShadow;
    chrome.runtime.onMessage.listeners[0]({ action: "set_tab_paused", paused: true }, {}, vi.fn());
    window.isSpeederActiveForCurrentPage();
    await settleLifecycle();
    expect(window.tc.tabPaused).toBe(true);
    expect(window.vscPageHooksInactive).toBe(false);
    expect(window.Element.prototype.attachShadow).toBe(attach);
    expect(window.__speederPageShadowBridgeInstalled).toBe(true);
  });

  it("never reinstalls challenge-suspended hooks when storage enables the page", async () => {
    vi.useFakeTimers();
    const chrome = bootInject({ syncData: { enabled: false } });
    await settleLifecycle();
    const resource = document.createElement("script");
    document.head.appendChild(resource);
    await settleLifecycle();
    resource.src = "/cdn-cgi/challenge-platform/h/b/orchestrate/x.js";
    await settleLifecycle();
    resource.remove();
    chrome.storage.sync.set({ enabled: true });
    await vi.advanceTimersByTimeAsync(100);
    await settleLifecycle();
    expect(window.vscPageHooksSuspended).toBe(true);
    expect(window.__speederPageShadowBridgeInstalled).toBeUndefined();
    expect(document.querySelector('script[src$="content/shadow-bridge.js"]')).toBeNull();
  });

  it("suspends before hydration and prevents a pending bridge from installing", async () => {
    vi.useFakeTimers();
    let nativeAttach;
    bootInject({ syncGetDelayMs: 100, configureWindow(win) {
      nativeAttach = win.Element.prototype.attachShadow;
    } });
    const resource = document.createElement("script");
    resource.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    document.head.appendChild(resource);
    await Promise.resolve();
    evaluateScript("extension/content/shadow-bridge.js");
    expect(window.Element.prototype.attachShadow).toBe(nativeAttach);
    expect(window.__speederPageShadowBridgeInstalled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(120);
    await settleLifecycle();
    expect(createControlledVideo().video.vsc).toBeDefined();
  });

  it("restarts bounded shadow catch-up when a never-ready bridge is suspended late", async () => {
    vi.useFakeTimers();
    let nativeAttach;
    bootInject({ configureWindow(win) { nativeAttach = win.Element.prototype.attachShadow; } });
    await settleLifecycle();
    await vi.advanceTimersByTimeAsync(31000);
    const resource = document.createElement("script");
    resource.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    document.head.appendChild(resource);
    await Promise.resolve();
    const container = document.createElement("section");
    const host = document.createElement("fallback-player");
    const root = nativeAttach.call(host, { mode: "open" });
    const video = document.createElement("video");
    video.src = "https://example.org/fallback.mp4";
    root.appendChild(video);
    container.appendChild(host);
    document.body.appendChild(container);
    await vi.advanceTimersByTimeAsync(3100);
    await settleLifecycle();
    expect(video.vsc.div.getRootNode()).toBe(root);
  });

  it("skips hooks for resources present at content startup but keeps media discovery", async () => {
    let descriptor;
    bootInject({ configureWindow(win) {
      descriptor = Object.getOwnPropertyDescriptor(win.Element.prototype, "attachShadow");
      const resource = win.document.createElement("script");
      resource.src = "/cdn-cgi/challenge-platform/start";
      win.document.head.appendChild(resource);
    } });
    await settleLifecycle();
    expect(window.vscPageHooksSuspended).toBe(true);
    expect(Object.getOwnPropertyDescriptor(window.Element.prototype, "attachShadow")).toEqual(descriptor);
    expect(document.querySelector('script[src$="shadow-bridge.js"]')).toBeNull();
    expect(createControlledVideo().video.vsc).toBeDefined();
  });

  it.each(["open", "closed"])("discovers nested page roots behind an %s ancestor", async (outerMode) => {
    let pageAttach;
    const rootListeners = new WeakMap();
    bootInject({ configureWindow(win) {
      const nativeAttach = win.Element.prototype.attachShadow;
      pageAttach = function(options) {
        const root = nativeAttach.call(this, options);
        rootListeners.set(root, vi.spyOn(root, "addEventListener"));
        Object.defineProperty(this, "openOrClosedShadowRoot", { value: root });
        return root;
      };
      win.Element.prototype.attachShadow = pageAttach;
    } });
    await settleLifecycle();
    // Model page-world calls that bypass the content-world patch.
    window.Element.prototype.attachShadow = pageAttach;
    evaluateScript("extension/content/shadow-bridge.js");
    const outer = document.createElement("outer-player");
    document.body.appendChild(outer);
    const outerRoot = outer.attachShadow({ mode: outerMode });
    const addListener = rootListeners.get(outerRoot);
    window.observeRoot(outerRoot);
    window.observeRoot(outerRoot);
    expect(addListener.mock.calls.filter(([type]) => type === "speeder-shadow-root-attached")).toHaveLength(1);
    expect(window.vscShadowBridgeListenerRoots.has(outerRoot)).toBe(true);
    const inner = document.createElement("inner-player");
    outerRoot.appendChild(inner);
    await settleLifecycle();
    const innerRoot = inner.attachShadow({ mode: "closed" });
    const video = document.createElement("video");
    video.src = "https://example.org/nested.mp4";
    innerRoot.appendChild(video);
    await settleLifecycle();
    expect(inner.shadowRoot).toBeNull();
    expect(innerRoot.vscMutationObserverAttached).toBe(true);
    expect(video.vsc.div.getRootNode()).toBe(innerRoot);
    outer.remove();
    await settleLifecycle();
    expect(window.vscShadowBridgeListenerRoots.has(outerRoot)).toBe(false);
    document.body.appendChild(outer);
    await settleLifecycle();
    expect(window.vscShadowBridgeListenerRoots.has(outerRoot)).toBe(true);
    expect(addListener.mock.calls.filter(([type]) => type === "speeder-shadow-root-attached")).toHaveLength(2);
  });

  it("uses detached-root signals to scan only later inserted subtrees after bridge catch-up ends", async () => {
    vi.useFakeTimers();
    let pageAttach;
    bootInject({ configureWindow(win) { pageAttach = win.Element.prototype.attachShadow; } });
    await settleLifecycle();
    window.Element.prototype.attachShadow = pageAttach;
    evaluateScript("extension/content/shadow-bridge.js");
    await vi.advanceTimersByTimeAsync(31000);
    const container = document.createElement("section");
    const intermediate = document.createElement("div");
    const host = document.createElement("detached-player");
    const root = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    video.src = "https://example.org/detached.mp4";
    root.appendChild(video);
    intermediate.appendChild(host);
    container.appendChild(intermediate);
    expect(root.vscMutationObserverAttached).not.toBe(true);
    // Unrelated insertions must not close the detached-root window.
    document.body.appendChild(document.createElement("aside"));
    await settleLifecycle();
    await vi.advanceTimersByTimeAsync(1000);
    const walker = vi.spyOn(document, "createTreeWalker");
    document.body.appendChild(container);
    await settleLifecycle();
    expect(video.vsc.div.getRootNode()).toBe(root);
    expect(walker.mock.calls.some(([node]) => node === container)).toBe(true);
    expect(walker.mock.calls.some(([node]) => node === document || node === document.body)).toBe(false);
  });

  it("stops walking inserted subtrees once the detached-root window decays", async () => {
    vi.useFakeTimers();
    let pageAttach;
    bootInject({ configureWindow(win) { pageAttach = win.Element.prototype.attachShadow; } });
    await settleLifecycle();
    window.Element.prototype.attachShadow = pageAttach;
    evaluateScript("extension/content/shadow-bridge.js");
    await vi.advanceTimersByTimeAsync(31000);
    // A host that is never inserted must not keep insertion TreeWalks alive.
    document.createElement("never-inserted-player").attachShadow({ mode: "open" });
    await vi.advanceTimersByTimeAsync(31000);
    const container = document.createElement("div");
    container.appendChild(document.createElement("span"));
    const walker = vi.spyOn(document, "createTreeWalker");
    document.body.appendChild(container);
    await settleLifecycle();
    expect(walker.mock.calls.some(([node]) => node === container)).toBe(false);
  });

  it("resolves nested shadow fullscreen down to the direct video", async () => {
    bootInject();
    await settleLifecycle();
    const outer = document.createElement("outer-fullscreen");
    const outerRoot = outer.attachShadow({ mode: "open" });
    const inner = document.createElement("inner-fullscreen");
    const innerRoot = inner.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    video.src = "https://example.org/fullscreen.mp4";
    innerRoot.appendChild(video);
    outerRoot.appendChild(inner);
    document.body.appendChild(outer);
    [outer, inner, video].forEach((node) => setRect(node, makeRect(0, 0, 640, 360)));
    window.ensureController(video, innerRoot);
    video.vsc.div.showPopover = vi.fn();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: outer });
    Object.defineProperty(outerRoot, "fullscreenElement", { configurable: true, value: inner });
    Object.defineProperty(innerRoot, "fullscreenElement", { configurable: true, value: video });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(window.getFullscreenElement(document)).toBe(video);
    expect(video.vsc.div.showPopover).toHaveBeenCalled();
  });

  it("follows assigned slots and deep composed ancestors without looping", async () => {
    bootInject();
    await settleLifecycle();
    const host = document.createElement("slotted-player");
    const root = host.attachShadow({ mode: "open" });
    const boundary = document.createElement("div");
    const slot = document.createElement("slot");
    const video = document.createElement("video");
    video.src = "https://example.org/slotted.mp4";
    boundary.appendChild(slot);
    root.appendChild(boundary);
    host.appendChild(video);
    document.body.appendChild(host);
    [host, boundary, video].forEach((node) => setRect(node, makeRect(0, 0, 640, 360)));
    window.ensureController(video, host);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: host });
    Object.defineProperty(root, "fullscreenElement", { configurable: true, value: boundary });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(video.assignedSlot).toBe(slot);
    expect(window.isComposedDescendant(video, boundary)).toBe(true);
    expect(video.vsc.div.parentNode).toBe(boundary);
    let deep = video;
    for (let i = 0; i < 35; i++) {
      const child = document.createElement("div");
      deep.appendChild(child);
      deep = child;
    }
    expect(window.isComposedDescendant(deep, boundary)).toBe(true);
    const cycle = document.createElement("div");
    Object.defineProperty(cycle, "assignedSlot", { value: cycle });
    expect(window.isComposedDescendant(cycle, boundary)).toBe(false);
  });

  it("reopens externally closed popovers while direct-video fullscreen remains active", async () => {
    vi.useFakeTimers();
    bootInject();
    await settleLifecycle();
    const { video, wrapper } = createControlledVideo();
    let open = false;
    const matches = wrapper.matches.bind(wrapper);
    wrapper.matches = (selector) => selector === ":popover-open" ? open : matches(selector);
    wrapper.showPopover = vi.fn(() => { open = true; });
    wrapper.hidePopover = vi.fn(() => { open = false; });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: video });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(open).toBe(true);
    open = false;
    window.syncControllerFullscreenMount(video.vsc);
    expect(open).toBe(true);
    open = false;
    const toggle = new Event("toggle");
    Object.defineProperty(toggle, "newState", { value: "closed" });
    wrapper.dispatchEvent(toggle);
    await settleLifecycle();
    expect(open).toBe(true);
    expect(wrapper.showPopover).toHaveBeenCalledTimes(3);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    document.dispatchEvent(new Event("fullscreenchange"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(open).toBe(false);
    expect(wrapper.showPopover).toHaveBeenCalledTimes(3);
  });

  it.each(["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange", "resize"])(
    "recovers after more than two seconds of zero geometry on %s", async (type) => {
      vi.useFakeTimers();
      bootInject();
      await settleLifecycle();
      const { video, mount, wrapper } = createControlledVideo();
      setRect(video, makeRect(0, 0, 0, 0));
      setRect(mount, makeRect(0, 0, 0, 0));
      video.vsc.controllerHostSchedule();
      await vi.advanceTimersByTimeAsync(2500);
      expect(hostIsGeometrySuppressed(wrapper)).toBe(true);
      if (type !== "resize") {
        Object.defineProperty(document, "fullscreenElement", { configurable: true, value: mount });
      }
      (type === "resize" ? window : document).dispatchEvent(new Event(type));
      await vi.advanceTimersByTimeAsync(2300);
      expect(hostIsGeometrySuppressed(wrapper)).toBe(true);
      setRect(video, makeRect(0, 0, 800, 450));
      setRect(mount, makeRect(0, 0, 800, 450));
      setBoxMetrics(mount, 800, 450);
      if (type === "resize") {
        // Outside fullscreen a resize only resets the geometry retry budget;
        // the host's ResizeObserver (absent in jsdom) reports the late size.
        video.vsc.controllerHostSchedule();
      }
      await vi.advanceTimersByTimeAsync(500);
      expect(hostIsGeometrySuppressed(wrapper)).toBe(false);
      expect(wrapper.style.display).not.toBe("none");
      expect(wrapper.style.width).toBe("800px");
    }
  );

  it("debounces window resize and runs the fullscreen settle only for fullscreen controllers", async () => {
    vi.useFakeTimers();
    bootInject();
    await settleLifecycle();
    const { controller } = createControlledVideo();
    const reset = vi.spyOn(controller, "controllerHostResetGeometry");
    for (let i = 0; i < 10; i += 1) {
      window.dispatchEvent(new Event("resize"));
      await vi.advanceTimersByTimeAsync(16);
    }
    expect(reset).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(controller.fullscreenSettleTimers || []).toHaveLength(0);

    const { mount: fullscreenMount, controller: fullscreenController } = createControlledVideo();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: fullscreenMount });
    window.dispatchEvent(new Event("resize"));
    await vi.advanceTimersByTimeAsync(160);
    expect(fullscreenController.fullscreenSettleTimers).toHaveLength(4);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  });

  it("coalesces fullscreen settle work, repairs late moves, and cancels timers on removal", async () => {
    vi.useFakeTimers();
    bootInject();
    await settleLifecycle();
    const { video, wrapper, controller, mount } = createControlledVideo();
    const boundary = document.createElement("section");
    boundary.appendChild(mount);
    document.body.appendChild(boundary);
    setRect(boundary, makeRect(0, 0, 800, 450));
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: boundary });
    document.dispatchEvent(new Event("fullscreenchange"));
    const previousTimers = controller.fullscreenSettleTimers.slice();
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(controller.fullscreenSettleTimers).toHaveLength(4);
    expect(controller.fullscreenSettleTimers).not.toEqual(previousTimers);
    document.body.appendChild(wrapper);
    await vi.advanceTimersByTimeAsync(150);
    expect(window.isComposedDescendant(wrapper, boundary)).toBe(true);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(wrapper.parentNode).toBe(controller.normalControllerMount);
    window.removeController(video);
    expect(controller.fullscreenSettleTimers).toEqual([]);
    expect(controller.fullscreenSettleFrame).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(wrapper.isConnected).toBe(false);
  });

  it("clears stale YouTube visibility state at fullscreen and retargets a replaced SPA player", async () => {
    vi.useFakeTimers();
    bootInject({ url: "https://www.youtube.com/watch?v=test", syncData: { hideWithControls: true } });
    await settleLifecycle();
    const oldPlayer = document.createElement("div");
    oldPlayer.className = "html5-video-player";
    const { video, wrapper, controller } = createControlledVideo({ mount: oldPlayer });
    oldPlayer.classList.add("ytp-autohide");
    await settleLifecycle();
    expect(wrapper.classList.contains("ytp-autohide")).toBe(true);
    oldPlayer.classList.remove("ytp-autohide");
    wrapper.classList.add("vsc-idle-hidden", "vsc-hidden", "vsc-show", "vsc-forced-show");
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: oldPlayer });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(wrapper.classList.contains("ytp-autohide")).toBe(false);
    expect(wrapper.classList.contains("vsc-idle-hidden")).toBe(false);
    for (const cls of ["vsc-hidden", "vsc-show", "vsc-forced-show"]) expect(wrapper.classList.contains(cls)).toBe(true);
    const newPlayer = document.createElement("div");
    newPlayer.className = "html5-video-player";
    setRect(newPlayer, makeRect(0, 0, 640, 360));
    newPlayer.appendChild(video);
    document.body.appendChild(newPlayer);
    oldPlayer.remove();
    document.dispatchEvent(new Event("yt-navigate-finish"));
    await vi.advanceTimersByTimeAsync(350);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: newPlayer });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(video.vsc).toBe(controller);
    expect(controller.youTubeAutoHidePlayer).toBe(newPlayer);
    expect(wrapper.classList.contains("ytp-autohide")).toBe(false);
    oldPlayer.classList.add("ytp-autohide");
    await settleLifecycle();
    expect(wrapper.classList.contains("ytp-autohide")).toBe(false);
    newPlayer.classList.add("ytp-autohide");
    await settleLifecycle();
    expect(wrapper.classList.contains("ytp-autohide")).toBe(true);
  });

  it.each(["fullscreenchange", "resize"])("preserves manual placement through %s settling", async (type) => {
    vi.useFakeTimers();
    bootInject();
    await settleLifecycle();
    const { mount, controller } = createControlledVideo();
    const element = window.convertControllerToManualPosition(controller);
    element.style.left = "99px";
    element.style.top = "123px";
    if (type === "fullscreenchange") {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: mount });
    }
    (type === "resize" ? window : document).dispatchEvent(new Event(type));
    await vi.advanceTimersByTimeAsync(2000);
    expect(element.dataset.positionMode).toBe("manual");
    expect(element.style.left).toBe("99px");
    expect(element.style.top).toBe("123px");
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    document.dispatchEvent(new Event("fullscreenchange"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(element.dataset.positionMode).toBe("manual");
    expect(element.style.left).toBe("99px");
    expect(element.style.top).toBe("123px");
  });

  it("keeps P-cycled and dragged positions through navigation refreshes until the location setting changes", async () => {
    vi.useFakeTimers();
    bootInject();
    await settleLifecycle();
    const first = createControlledVideo();
    const second = createControlledVideo();
    expect(first.controller.controllerLocation).toBe("top-left");

    window.cycleControllerLocation(first.video);
    const cycledLocation = first.controller.controllerLocation;
    expect(cycledLocation).not.toBe("top-left");
    const dragged = window.convertControllerToManualPosition(second.controller);
    dragged.style.left = "77px";
    dragged.style.top = "88px";

    window.history.pushState({}, "", "/next-route");
    document.dispatchEvent(new Event("speeder-location-changed"));
    await vi.advanceTimersByTimeAsync(2000);
    window.refreshAllControllerGeometry();
    window.initializeWhenReady(document, true);
    await settleLifecycle();

    const cycled = window.getControllerElement(first.controller);
    expect(first.controller.controllerLocation).toBe(cycledLocation);
    expect(cycled.dataset.location).toBe(cycledLocation);
    expect(cycled.dataset.positionMode).toBe("anchored");
    expect(dragged.dataset.positionMode).toBe("manual");
    expect(dragged.style.left).toBe("77px");
    expect(dragged.style.top).toBe("88px");

    window.tc.settings.controllerLocation = "bottom-right";
    window.refreshAllControllerGeometry();
    expect(first.controller.controllerLocation).toBe("bottom-right");
    expect(cycled.dataset.location).toBe("bottom-right");
    expect(dragged.dataset.positionMode).toBe("anchored");
    expect(dragged.dataset.location).toBe("bottom-right");
  });

  it("preserves a drag started during the fullscreen settle sequence", async () => {
    vi.useFakeTimers();
    bootInject();
    await settleLifecycle();
    const { mount, controller } = createControlledVideo();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: mount });
    document.dispatchEvent(new Event("fullscreenchange"));
    await vi.advanceTimersByTimeAsync(200);
    const element = window.convertControllerToManualPosition(controller);
    element.style.left = "111px";
    element.style.top = "222px";
    await vi.advanceTimersByTimeAsync(1800);
    expect(element.dataset.positionMode).toBe("manual");
    expect(element.style.left).toBe("111px");
    expect(element.style.top).toBe("222px");
  });

  it("reports privacy-safe hook, fullscreen, mount and visibility diagnostics for every controller", async () => {
    bootInject();
    await settleLifecycle();
    evaluateScript("extension/content/shadow-bridge.js");
    const first = createControlledVideo({ src: "https://example.org/private-video?token=secret" });
    const second = createControlledVideo();
    first.wrapper.classList.add("vsc-hidden", "ytp-autohide", "vsc-idle-hidden");
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: first.mount });
    const report = window.getDiagnosticsSnapshot(first.video);
    expect(report.pageHooks).toEqual({ installed: true, suspended: false, reason: null });
    expect(report.controllers).toHaveLength(2);
    expect(report.controller).toMatchObject({ fullscreenActive: true, insideFullscreen: true,
      normalMount: true, popoverOpen: false, hidden: true, autohide: true, idleHidden: true });
    expect(JSON.stringify(report)).not.toMatch(/private-video|secret|https:/);
    window.suspendPageHooks();
    expect(window.getDiagnosticsSnapshot(second.video).pageHooks).toEqual({ installed: false, suspended: true, reason: "challenge" });
  });

  it("leaves isolated-world history untouched and keeps hash/popstate navigation listeners", async () => {
    vi.useFakeTimers();
    let pushState;
    let replaceState;
    bootInject({ configureWindow(win) {
      pushState = win.history.pushState;
      replaceState = win.history.replaceState;
    } });
    await settleLifecycle();
    expect(window.history.pushState).toBe(pushState);
    expect(window.history.replaceState).toBe(replaceState);
    expect(window.history.hasOwnProperty("pushState")).toBe(false);
    window.history.pushState({}, "", "/pop-route");
    window.dispatchEvent(new Event("popstate"));
    await vi.advanceTimersByTimeAsync(350);
    expect(window.tc.siteRuleAppliedHref).toBe(window.location.href);
    window.location.hash = "next";
    await vi.advanceTimersByTimeAsync(350);
    expect(window.tc.siteRuleAppliedHref).toBe(window.location.href);
  });

  it.each([
    ["suspended", "open"],
    ["suspended", "closed"],
    ["failed", "open"],
    ["failed", "closed"]
  ])("discovers late %s-hook shadow players in inserted subtrees (%s root)", async (state, mode) => {
    vi.useFakeTimers();
    let nativeAttach;
    bootInject({ configureWindow(win) { nativeAttach = win.Element.prototype.attachShadow; } });
    await settleLifecycle();
    if (state === "suspended") {
      evaluateScript("extension/content/shadow-bridge.js");
      const resource = document.createElement("script");
      resource.src = "/cdn-cgi/challenge-platform/scripts/jsd/main.js";
      document.head.appendChild(resource);
      await Promise.resolve();
      expect(window.vscPageHooksSuspended).toBe(true);
    } else {
      document.querySelector('script[src$="shadow-bridge.js"]').dispatchEvent(new Event("error"));
      expect(window.vscPageShadowBridgeRetries).toBeGreaterThan(0);
    }
    await vi.advanceTimersByTimeAsync(31000);
    const container = document.createElement("div");
    const host = document.createElement("late-component-player");
    const root = nativeAttach.call(host, { mode });
    if (mode === "closed") {
      Object.defineProperty(host, "openOrClosedShadowRoot", { value: root });
      expect(host.shadowRoot).toBeNull();
    }
    const video = document.createElement("video");
    video.src = "https://example.org/late-shadow.mp4";
    root.appendChild(video);
    container.appendChild(host);
    const scan = vi.spyOn(window, "rescanOpenShadowRoots");
    document.body.appendChild(container);
    await settleLifecycle();
    expect(video.vsc.div.getRootNode()).toBe(root);
    expect(scan.mock.calls.some(([node]) => node === container)).toBe(true);
    expect(scan.mock.calls.some(([node]) => node === document || node === document.body)).toBe(false);
  });

  it("does not walk inserted subtrees or rescan on empty shortcuts with an active bridge", async () => {
    vi.useFakeTimers();
    let nativeAttach;
    bootInject({ configureWindow(win) { nativeAttach = win.Element.prototype.attachShadow; },
      syncData: { keyBindings: [{ action: "faster", code: "KeyD", value: 0.1, force: true }] }
    });
    await settleLifecycle();
    evaluateScript("extension/content/shadow-bridge.js");
    await vi.advanceTimersByTimeAsync(31000);
    expect(window.vscPageShadowBridgeLoaded).toBe(true);
    expect(window.vscDetachedShadowRecentUntil).toBeLessThanOrEqual(Date.now());
    const container = document.createElement("div");
    const host = document.createElement("bridged-component-player");
    // Bypass both wrappers so the test isolates the insertion fallback.
    nativeAttach.call(host, { mode: "open" });
    container.appendChild(host);
    const scan = vi.spyOn(window, "rescanOpenShadowRoots");
    const walker = vi.spyOn(document, "createTreeWalker");
    document.body.appendChild(container);
    await settleLifecycle();
    const shortcut = new KeyboardEvent("keydown", {
      bubbles: true, cancelable: true, code: "KeyD", key: "d"
    });
    document.dispatchEvent(shortcut);
    expect(scan).not.toHaveBeenCalled();
    expect(walker).not.toHaveBeenCalled();
    expect(shortcut.defaultPrevented).toBe(false);
  });

  it.each(["open", "closed"])("recovers missed %s shadow media on a suspended-page shortcut", async (mode) => {
    vi.useFakeTimers();
    let nativeAttach;
    bootInject({ configureWindow(win) { nativeAttach = win.Element.prototype.attachShadow; } });
    await settleLifecycle();
    window.suspendPageHooks();
    await vi.advanceTimersByTimeAsync(31000);
    const host = document.createElement("missed-shortcut-player");
    document.body.appendChild(host);
    await settleLifecycle();
    // Attaching a root to an already-connected host causes no light-DOM mutation.
    const root = nativeAttach.call(host, { mode });
    if (mode === "closed") Object.defineProperty(host, "openOrClosedShadowRoot", { value: root });
    const video = document.createElement("video");
    video.src = "https://example.org/missed-shortcut.mp4";
    root.appendChild(video);
    await settleLifecycle();
    expect(window.tc.mediaElements).toHaveLength(0);
    const scan = vi.spyOn(window, "rescanOpenShadowRoots");
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyD", key: "d" }));
    expect(video.vsc.div.getRootNode()).toBe(root);
    expect(video.playbackRate).toBe(1.1);
    expect(scan.mock.calls.filter(([node]) => node === document)).toHaveLength(1);
  });

  it.each(["run_action", "get_speed", "set_force_last_saved_speed"])("recovers missed shadow media on %s messages", async (action) => {
    vi.useFakeTimers();
    let nativeAttach;
    const chrome = bootInject({ configureWindow(win) { nativeAttach = win.Element.prototype.attachShadow; } });
    await settleLifecycle();
    window.suspendPageHooks();
    await vi.advanceTimersByTimeAsync(31000);
    const host = document.createElement("missed-popup-player");
    document.body.appendChild(host);
    await settleLifecycle();
    const root = nativeAttach.call(host, { mode: "open" });
    const video = document.createElement("video");
    video.src = "https://example.org/missed-popup.mp4";
    root.appendChild(video);
    await settleLifecycle();
    expect(video.vsc).toBeUndefined();
    const scan = vi.spyOn(window, "rescanOpenShadowRoots");
    const targets = vi.spyOn(window, "resolveActionMediaTargets");
    const response = vi.fn();
    chrome.runtime.onMessage.listeners[0]({
      action, actionName: "faster", value: 0.1, enabled: false,
      targetFrameToken: window.tc.frameToken
    }, {}, response);
    expect(video.vsc.div.getRootNode()).toBe(root);
    expect(response).toHaveBeenCalledOnce();
    expect(response.mock.calls[0][0].speed).toBe(action === "run_action" ? 1.1 : 1);
    expect(scan.mock.calls.filter(([node]) => node === document)).toHaveLength(1);
    if (action === "run_action") {
      // The speed change also resolves its existing, video-specific blink action.
      expect(targets.mock.calls.filter(([, specificVideo]) => !specificVideo)).toHaveLength(2);
    }
  });

  it("shares the two-second empty-media rescan throttle across shortcuts and runtime messages", async () => {
    vi.useFakeTimers();
    const chrome = bootInject();
    await settleLifecycle();
    window.suspendPageHooks();
    await vi.advanceTimersByTimeAsync(31000);
    const scan = vi.spyOn(window, "rescanOpenShadowRoots");
    const response = vi.fn();
    const message = chrome.runtime.onMessage.listeners[0];
    const shortcut = () => document.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true, code: "KeyD", key: "d"
    }));
    shortcut();
    message({ action: "get_speed" }, {}, response);
    message({ action: "run_action", actionName: "faster", value: 0.1 }, {}, response);
    expect(scan.mock.calls.filter(([node]) => node === document)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1999);
    shortcut();
    expect(scan.mock.calls.filter(([node]) => node === document)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    message({ action: "get_speed" }, {}, response);
    expect(scan.mock.calls.filter(([node]) => node === document)).toHaveLength(2);
    expect(response).not.toHaveBeenCalled();
  });

  it("preserves existing-media targeting without an on-demand scan while hooks are suspended", async () => {
    vi.useFakeTimers();
    const chrome = bootInject();
    await settleLifecycle();
    window.suspendPageHooks();
    const { video } = createControlledVideo();
    await settleLifecycle();
    const scan = vi.spyOn(window, "rescanOpenShadowRoots");
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyD", key: "d" }));
    const response = vi.fn();
    chrome.runtime.onMessage.listeners[0]({ action: "get_speed" }, {}, response);
    expect(video.playbackRate).toBe(1.1);
    expect(response.mock.calls[0][0].speed).toBe(1.1);
    expect(scan).not.toHaveBeenCalled();
  });

  it("does not rescan for unrelated, disabled, modified or editable shortcuts or wrong-frame actions", async () => {
    vi.useFakeTimers();
    const chrome = bootInject({ syncData: { keyBindings: [
      { action: "faster", code: "KeyD", value: 0.1 },
      { action: "slower", code: "KeyS", value: 0.1, disabled: true }
    ] } });
    await settleLifecycle();
    window.suspendPageHooks();
    await vi.advanceTimersByTimeAsync(31000);
    const scan = vi.spyOn(window, "rescanOpenShadowRoots");
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyQ", key: "q" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyS", key: "s" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyD", key: "d", ctrlKey: true }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyD", key: "d" }));
    chrome.runtime.onMessage.listeners[0]({
      action: "run_action", actionName: "faster", targetFrameToken: "another-frame"
    }, {}, vi.fn());
    expect(scan).not.toHaveBeenCalled();
  });

  it("never reads browser-internal shadow roots on built-in controls", async () => {
    bootInject();
    await settleLifecycle();
    // Firefox 150 exposes UA widget roots through this privileged getter.
    // Even touching a retained root's host after widget teardown can crash
    // Gecko, so reject these elements before reading either shadow getter.
    const readInternalRoot = vi.fn(() => ({}));
    const elements = [
      "input", "textarea", "select", "option", "button", "video", "audio",
      "img", "iframe", "object", "embed", "progress", "meter", "details"
    ].map((tag) => document.createElement(tag));
    elements.push(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    elements.push(document.createElementNS("http://www.w3.org/2000/svg", "custom-player"));
    for (const element of elements) {
      Object.defineProperties(element, {
        openOrClosedShadowRoot: { get: readInternalRoot },
        shadowRoot: { get: readInternalRoot }
      });
      expect(window.getElementShadowRoot(element)).toBeNull();
    }
    expect(readInternalRoot).not.toHaveBeenCalled();
  });

  it.each(["active", "global-disabled", "site-disabled"])(
    "ignores internal input roots during insertion, navigation and removal (%s)", async (state) => {
      vi.useFakeTimers();
      let internalRoot;
      const readInternalRoot = vi.fn(() => internalRoot);
      const readInternalHost = vi.fn();
      bootInject({
        syncData: state === "global-disabled" ? { enabled: false } :
          state === "site-disabled" ? { siteRules: [{ pattern: "example.org", enabled: false }] } : {},
        configureWindow(win) {
          win.document.body.innerHTML = '<form><input type="text"><input type="search"></form>';
          internalRoot = win.document.createElement("div").attachShadow({ mode: "closed" });
          const input = win.document.querySelector("input");
          readInternalHost.mockImplementation(() => input);
          Object.defineProperty(internalRoot, "host", { get: readInternalHost });
          Object.defineProperty(win.HTMLInputElement.prototype, "openOrClosedShadowRoot", {
            get: readInternalRoot
          });
        }
      });
      await settleLifecycle();
      for (let i = 0; i < 3; i++) {
        document.querySelector("form").innerHTML = '<input type="url"><input type="text">';
        window.history.pushState({}, "", "/route-" + i);
        window.dispatchEvent(new Event("popstate"));
        await vi.advanceTimersByTimeAsync(1100);
      }
      document.querySelector("form").remove();
      await settleLifecycle();
      expect(readInternalRoot).not.toHaveBeenCalled();
      expect(readInternalHost).not.toHaveBeenCalled();
      expect(window.vscObservedRootList).toHaveLength(0);
    }
  );

  it.each(["div", "span", "section", "custom-player"])(
    "still discovers closed page-created shadow media on %s", async (tag) => {
      let root;
      let video;
      bootInject({ configureWindow(win) {
        const host = win.document.createElement(tag);
        root = host.attachShadow({ mode: "closed" });
        Object.defineProperty(host, "openOrClosedShadowRoot", { value: root });
        video = win.document.createElement("video");
        video.src = "https://example.org/closed.mp4";
        root.appendChild(video);
        win.document.body.appendChild(host);
      } });
      await settleLifecycle();
      expect(video.vsc.div.getRootNode()).toBe(root);
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyD", key: "d" }));
      expect(video.playbackRate).toBe(1.1);
    }
  );

  it("keeps challenge mutation checks constant-time for non-elements and childless elements", async () => {
    vi.useFakeTimers();
    bootInject();
    await settleLifecycle();
    const text = document.createTextNode("ordinary text");
    const comment = document.createComment("ordinary comment");
    const leaf = document.createElement("span");
    const query = vi.spyOn(leaf, "querySelectorAll");
    const resourceCheck = vi.spyOn(window, "hasChallengeResource");
    document.body.append(text, comment, leaf);
    // Check only the synchronous mutation callback, before idle media discovery.
    await Promise.resolve();
    expect(resourceCheck).not.toHaveBeenCalledWith(text);
    expect(resourceCheck).not.toHaveBeenCalledWith(comment);
    expect(resourceCheck).toHaveBeenCalledWith(leaf);
    expect(query).not.toHaveBeenCalled();
  });

});
