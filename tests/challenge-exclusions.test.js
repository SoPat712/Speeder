import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
const { readWorkspaceFile } = require("./helpers/extension-test-utils");

const manifest = JSON.parse(
  readWorkspaceFile("extension/manifest.json")
);
const bridgeSource = readWorkspaceFile(
  "extension/content/shadow-bridge.js"
);
const injectSource = readWorkspaceFile(
  "extension/content/inject.js"
);
const challengeUrls = [
  "https://challenges.cloudflare.com/turnstile/v0/api.js",
  "http://challenges.cloudflare.com/",
  "https://nested.challenges.cloudflare.com/turnstile/",
  "https://example.org/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/",
  "http://example.org/cdn-cgi/challenge-platform/",
  "https://example.org/cdn-cgi/challenge-platform",
  "https://example.org/cdn-cgi/challenge-platform?token=example#challenge"
];
const ordinaryUrls = [
  "https://cloudflare.com/",
  "https://www.cloudflare.com/products/stream/",
  "https://watch.cloudflarestream.com/video",
  "https://example.org/watch?v=123",
  "https://example.org/cdn-cgi/image/width=320/video-poster.jpg",
  "https://example.org/cdn-cgi/challenge-platform-guide",
  "https://challenges.cloudflare.com.example.org/video",
  "https://otherchallenges.cloudflare.com/video",
  "https://example.org/watch?next=/cdn-cgi/challenge-platform/"
];

// Firefox match-pattern paths include the query string, but exclude fragments.
function matchesPattern(pattern, href) {
  const [, scheme, host, path] = pattern.match(/^(\*|https?):\/\/([^/]+)(\/.*)$/);
  const url = new URL(href);
  const hostname = host.startsWith("*.") ? host.slice(2) : host;
  const hostMatches =
    host === "*" ||
    url.hostname === hostname ||
    (host.startsWith("*.") && url.hostname.endsWith("." + hostname));
  const pathExpression = path
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return (
    (scheme === "*" || url.protocol === scheme + ":") &&
    hostMatches &&
    new RegExp("^" + pathExpression + "$").test(url.pathname + url.search)
  );
}

let activeDom;

function createWindow(url, options = {}) {
  activeDom = new JSDOM("<!doctype html><html><body></body></html>", {
    url,
    runScripts: "dangerously",
    ...options
  });
  return activeDom.window;
}

function observeBridge(win) {
  const ready = vi.fn();
  const navigationReady = vi.fn();
  const navigationListener = vi.fn();
  win.document.addEventListener("speeder-page-bridge-ready", ready);
  win.document.addEventListener(
    "speeder-page-navigation-api-ready",
    navigationReady
  );
  win.navigation = { addEventListener: navigationListener };
  return {
    attachShadow: win.Element.prototype.attachShadow,
    pushState: win.history.pushState,
    replaceState: win.history.replaceState,
    ready,
    navigationReady,
    navigationListener
  };
}

function expectInertBridge(win) {
  const original = observeBridge(win);
  win.eval(bridgeSource);
  expect(win.Element.prototype.attachShadow).toBe(original.attachShadow);
  expect(win.history.pushState).toBe(original.pushState);
  expect(win.history.replaceState).toBe(original.replaceState);
  expect(win.__speederPageShadowBridgeInstalled).toBeUndefined();
  expect(win.__speederPageNavigationApiBridgeInstalled).toBeUndefined();
  expect(original.ready).not.toHaveBeenCalled();
  expect(original.navigationReady).not.toHaveBeenCalled();
  expect(original.navigationListener).not.toHaveBeenCalled();

  // The content runtime must be inert too, including when it is injected into
  // an inherited blank frame outside the manifest's ordinary URL matching.
  const addListener = vi.fn();
  const getSettings = vi.fn();
  win.chrome = {
    runtime: { getURL: vi.fn(), onMessage: { addListener } },
    storage: {
      sync: { get: getSettings },
      local: { get: getSettings },
      onChanged: { addListener }
    }
  };
  win.eval(injectSource);
  expect(win.Element.prototype.attachShadow).toBe(original.attachShadow);
  expect(win.history.pushState).toBe(original.pushState);
  expect(win.history.replaceState).toBe(original.replaceState);
  expect(win.document.querySelector("script")).toBeNull();
  expect(win.vscKeydownListenerAttached).toBeUndefined();
  expect(win.vscAttachShadowPatched).toBeUndefined();
  expect(win.vscPageBridgeListenersAttached).toBeUndefined();
  expect(getSettings).not.toHaveBeenCalled();
  expect(addListener).not.toHaveBeenCalled();
  expect(win.chrome.runtime.getURL).not.toHaveBeenCalled();
}

afterEach(() => {
  if (activeDom) activeDom.window.close();
  activeDom = null;
});

describe("challenge content-script exclusions", () => {
  it("uses Firefox host and path match patterns for every content-script entry", () => {
    for (const script of manifest.content_scripts) {
      expect(script.exclude_matches).toEqual(
        expect.arrayContaining([
          "*://*.challenges.cloudflare.com/*",
          "*://*/cdn-cgi/challenge-platform",
          "*://*/cdn-cgi/challenge-platform?*",
          "*://*/cdn-cgi/challenge-platform/*"
        ])
      );
    }
  });

  it.each(challengeUrls)("excludes challenge document %s", (url) => {
    for (const script of manifest.content_scripts) {
      expect(script.exclude_matches.some((pattern) => matchesPattern(pattern, url)))
        .toBe(true);
    }
  });

  it.each(ordinaryUrls)("preserves ordinary document %s", (url) => {
    for (const script of manifest.content_scripts) {
      expect(script.exclude_matches.some((pattern) => matchesPattern(pattern, url)))
        .toBe(false);
    }
  });
});

describe("challenge page bridge guard", () => {
  it.each(challengeUrls)("leaves native APIs untouched at %s", (url) => {
    expectInertBridge(createWindow(url));
  });

  it.each(["about:blank", "about:srcdoc", "about:blank#frame"])(
    "leaves inherited challenge document %s untouched",
    (url) => {
      expectInertBridge(
        createWindow(url, { referrer: "https://challenges.cloudflare.com/" })
      );
    }
  );

  it("recognizes the inherited base URL when a challenge hides its referrer", () => {
    const parent = createWindow(
      "https://example.org/cdn-cgi/challenge-platform/frame"
    );
    const iframe = parent.document.createElement("iframe");
    parent.document.body.appendChild(iframe);
    const child = iframe.contentWindow;
    Object.defineProperty(child.document, "referrer", { value: "" });
    expect(child.location.href).toBe("about:blank");
    expectInertBridge(child);
  });

  it("recognizes challenge ancestors through nested inherited documents", () => {
    const parent = createWindow("https://challenges.cloudflare.com/");
    const iframe = parent.document.createElement("iframe");
    parent.document.body.appendChild(iframe);
    const child = iframe.contentWindow;
    Object.defineProperty(child.document, "referrer", { value: "" });
    Object.defineProperty(child.document, "baseURI", { value: "about:blank" });
    const nestedFrame = child.document.createElement("iframe");
    child.document.body.appendChild(nestedFrame);
    const nested = nestedFrame.contentWindow;
    Object.defineProperty(nested.document, "referrer", { value: "" });
    Object.defineProperty(nested.document, "baseURI", { value: "about:blank" });
    expectInertBridge(nested);
  });

  it.each(ordinaryUrls)("keeps the normal bridge available at %s", (url) => {
    const win = createWindow(url, {
      referrer: "https://challenges.cloudflare.com/"
    });
    const original = observeBridge(win);
    win.eval(bridgeSource);
    expect(win.Element.prototype.attachShadow).not.toBe(original.attachShadow);
    expect(win.history.pushState).not.toBe(original.pushState);
    expect(win.history.replaceState).not.toBe(original.replaceState);
    expect(win.__speederPageShadowBridgeInstalled).toBe(true);
    expect(original.ready).toHaveBeenCalledTimes(1);
    expect(original.navigationReady).toHaveBeenCalledTimes(1);
    expect(original.navigationListener).toHaveBeenCalledTimes(1);
  });

  it("preserves native return values and bridge events on an ordinary page", () => {
    const win = createWindow("https://example.org/video");
    const shadowAttached = vi.fn();
    const locationChanged = vi.fn();
    win.document.addEventListener("speeder-shadow-root-attached", shadowAttached);
    win.document.addEventListener("speeder-location-changed", locationChanged);
    const original = observeBridge(win);
    win.eval(bridgeSource);
    const host = win.document.createElement("div");
    win.document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    expect(shadow).toBe(host.shadowRoot);
    expect(shadowAttached).toHaveBeenCalledTimes(1);
    expect(win.history.pushState({ position: 1 }, "", "/next-video")).toBeUndefined();
    expect(win.history.replaceState({ position: 2 }, "", "/final-video"))
      .toBeUndefined();
    expect(locationChanged).toHaveBeenCalledTimes(2);
    expect(win.history.state).toEqual({ position: 2 });
    expect(win.location.pathname).toBe("/final-video");
    const wrappedAttachShadow = win.Element.prototype.attachShadow;
    win.eval(bridgeSource);
    expect(win.Element.prototype.attachShadow).toBe(wrappedAttachShadow);
    expect(original.ready).toHaveBeenCalledTimes(2);
    expect(original.navigationListener).toHaveBeenCalledTimes(1);
  });
});
