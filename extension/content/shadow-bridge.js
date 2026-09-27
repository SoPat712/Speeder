(function() {
  "use strict";

  function isChallengeUrl(value) {
    try {
      var url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return false;
      var hostname = url.hostname.toLowerCase().replace(/\.$/, "");
      return (
        hostname === "challenges.cloudflare.com" ||
        hostname.endsWith(".challenges.cloudflare.com") ||
        url.pathname === "/cdn-cgi/challenge-platform" ||
        url.pathname.indexOf("/cdn-cgi/challenge-platform/") === 0
      );
    } catch (_error) {
      return false;
    }
  }

  function isChallengeDocument(win) {
    try {
      if (isChallengeUrl(win.location.href)) return true;
      if (!/^about:(blank|srcdoc)(?:[?#]|$)/i.test(win.location.href)) {
        return false;
      }
      // match_about_blank can inherit a challenge document's eligibility.
      if (
        isChallengeUrl(win.document.baseURI) ||
        isChallengeUrl(win.document.referrer)
      ) {
        return true;
      }
      return win.parent !== win && isChallengeDocument(win.parent);
    } catch (_error) {
      // A cross-origin ancestor is inaccessible; use only the URLs we can read.
      return false;
    }
  }

  // Challenge pages inspect native APIs. Leave the page untouched, including
  // bridge flags and readiness events, even if the manifest was bypassed.
  if (isChallengeDocument(window)) return;

  function dispatchBridgeEvent(eventName) {
    try {
      document.dispatchEvent(
        new Event(eventName, {
          bubbles: true,
          composed: true
        })
      );
    } catch (_error) {}
  }

  function notifyBridgeReady() {
    if (window.__speederPageNavigationApiBridgeInstalled) {
      dispatchBridgeEvent("speeder-page-navigation-api-ready");
    }
    dispatchBridgeEvent("speeder-page-bridge-ready");
  }

  if (window.__speederPageShadowBridgeInstalled) {
    notifyBridgeReady();
    return;
  }

  window.__speederPageShadowBridgeInstalled = true;

  function notifyLocationChanged() {
    try {
      document.dispatchEvent(
        new Event("speeder-location-changed", {
          bubbles: true,
          composed: true
        })
      );
    } catch (_error) {}
  }

  if (
    typeof Element !== "undefined" &&
    typeof Element.prototype.attachShadow === "function"
  ) {
    var originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function() {
      var shadowRoot = originalAttachShadow.apply(this, arguments);
      try {
        this.dispatchEvent(
          new Event("speeder-shadow-root-attached", {
            bubbles: true,
            composed: true
          })
        );
      } catch (_error) {}
      return shadowRoot;
    };
  }

  ["pushState", "replaceState"].forEach(function(method) {
    if (typeof history === "undefined" || typeof history[method] !== "function") {
      return;
    }
    var original = history[method];
    history[method] = function() {
      var result = original.apply(this, arguments);
      notifyLocationChanged();
      return result;
    };
  });

  // Modern Navigation API entries cover same-document navigations that do not
  // pass through the History wrappers above. The legacy content-side fallback
  // remains active when this API is unavailable or cannot be registered.
  if (
    window.navigation &&
    typeof window.navigation.addEventListener === "function"
  ) {
    try {
      window.navigation.addEventListener(
        "currententrychange",
        notifyLocationChanged
      );
      window.__speederPageNavigationApiBridgeInstalled = true;
    } catch (_error) {}
  }

  notifyBridgeReady();
})();
