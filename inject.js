var regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;

var isUserSeek = false; // Track if seek was user-initiated
var lastToggleSpeed = {}; // Store last toggle speeds per video

var tc = {
  settings: {
    lastSpeed: 1.0,
    enabled: true,
    speeds: {},
    displayKeyCode: 86,
    rememberSpeed: false,
    forceLastSavedSpeed: false,
    audioBoolean: false,
    startHidden: false,
    hideWithYouTubeControls: false,
    hideWithControls: false,
    hideWithControlsTimer: 2.0,
    controllerLocation: "top-left",
    controllerOpacity: 0.3,
    keyBindings: [],
    siteRules: [],
    controllerButtons: ["rewind", "slower", "faster", "advance", "display"],
    defaultLogLevel: 3,
    logLevel: 3,
    enableSubtitleNudge: true, // Enabled by default, but only activates on YouTube
    subtitleNudgeInterval: 50, // Default 50ms balances subtitle tracking with CPU cost
    subtitleNudgeAmount: 0.001
  },
  mediaElements: [],
  isNudging: false,
  pendingLastSpeedSave: null,
  pendingLastSpeedValue: null,
  persistedLastSpeed: 1.0,
  activeSiteRule: null
};

var MIN_SPEED = 0.0625;
var MAX_SPEED = 16;
var YT_NATIVE_MIN = 0.25;
var YT_NATIVE_MAX = 2.0;
var YT_NATIVE_STEP = 0.05;
var vscObservedRoots = new WeakSet();
var requestIdle =
  typeof window.requestIdleCallback === "function"
    ? window.requestIdleCallback.bind(window)
    : function (callback, options) {
      return setTimeout(callback, (options && options.timeout) || 1);
    };
var controllerLocations = [
  "top-left",
  "top-center",
  "top-right",
  "middle-right",
  "bottom-right",
  "bottom-center",
  "bottom-left",
  "middle-left"
];
var defaultControllerLocation = controllerLocations[0];
var controllerLocationStyles = {
  "top-left": {
    top: "10px",
    left: "15px",
    transform: "translate(0, 0)"
  },
  "top-center": {
    top: "10px",
    left: "50%",
    transform: "translate(-50%, 0)"
  },
  "top-right": {
    top: "10px",
    left: "calc(100% - 10px)",
    transform: "translate(-100%, 0)"
  },
  "middle-right": {
    top: "50%",
    left: "calc(100% - 10px)",
    transform: "translate(-100%, -50%)"
  },
  "bottom-right": {
    top: "calc(100% - 65px)",
    left: "calc(100% - 10px)",
    transform: "translate(-100%, -100%)"
  },
  "bottom-center": {
    top: "calc(100% - 65px)",
    left: "50%",
    transform: "translate(-50%, -100%)"
  },
  "bottom-left": {
    top: "calc(100% - 65px)",
    left: "15px",
    transform: "translate(0, -100%)"
  },
  "middle-left": {
    top: "50%",
    left: "15px",
    transform: "translate(0, -50%)"
  }
};

var controllerButtonDefs = {
  rewind:   { label: "\u00AB", className: "rw" },
  slower:   { label: "\u2212", className: "" },
  faster:   { label: "+",      className: "" },
  advance:  { label: "\u00BB", className: "rw" },
  display:  { label: "\u00D7", className: "hideButton" },
  reset:    { label: "\u21BA", className: "" },
  fast:     { label: "\u2605", className: "" },
  settings: { label: "\u2699", className: "" },
  pause:    { label: "\u23EF", className: "" },
  muted:    { label: "M",      className: "" },
  mark:     { label: "\u2691", className: "" },
  jump:     { label: "\u21E5", className: "" }
};

var keyCodeToEventKey = {
  32: " ",
  37: "ArrowLeft",
  38: "ArrowUp",
  39: "ArrowRight",
  40: "ArrowDown",
  96: "0",
  97: "1",
  98: "2",
  99: "3",
  100: "4",
  101: "5",
  102: "6",
  103: "7",
  104: "8",
  105: "9",
  106: "*",
  107: "+",
  109: "-",
  110: ".",
  111: "/",
  112: "F1",
  113: "F2",
  114: "F3",
  115: "F4",
  116: "F5",
  117: "F6",
  118: "F7",
  119: "F8",
  120: "F9",
  121: "F10",
  122: "F11",
  123: "F12",
  186: ";",
  188: "<",
  189: "-",
  187: "+",
  190: ">",
  191: "/",
  192: "~",
  219: "[",
  220: "\\",
  221: "]",
  222: "'",
  59: ";",
  61: "+",
  173: "-"
};

function createDefaultBinding(action, key, keyCode, value) {
  return {
    action: action,
    key: key,
    keyCode: keyCode,
    value: value,
    force: false,
    predefined: true
  };
}

function defaultKeyBindings(storage) {
  return [
    createDefaultBinding(
      "slower",
      "S",
      Number(storage.slowerKeyCode) || 83,
      Number(storage.speedStep) || 0.1
    ),
    createDefaultBinding(
      "faster",
      "D",
      Number(storage.fasterKeyCode) || 68,
      Number(storage.speedStep) || 0.1
    ),
    createDefaultBinding(
      "rewind",
      "Z",
      Number(storage.rewindKeyCode) || 90,
      Number(storage.rewindTime) || 10
    ),
    createDefaultBinding(
      "advance",
      "X",
      Number(storage.advanceKeyCode) || 88,
      Number(storage.advanceTime) || 10
    ),
    createDefaultBinding(
      "reset",
      "R",
      Number(storage.resetKeyCode) || 82,
      1.0
    ),
    createDefaultBinding(
      "fast",
      "G",
      Number(storage.fastKeyCode) || 71,
      Number(storage.fastSpeed) || 1.8
    ),
    createDefaultBinding(
      "move",
      "P",
      80,
      0
    ),
    createDefaultBinding(
      "toggleSubtitleNudge",
      "N",
      78,
      0
    )
  ];
}

function ensureDefaultKeyBinding(action, key, keyCode, value) {
  if (tc.settings.keyBindings.some((binding) => binding.action === action)) {
    return false;
  }

  tc.settings.keyBindings.push(
    createDefaultBinding(action, key, keyCode, value)
  );
  return true;
}

function getLegacyKeyCode(binding) {
  if (!binding) return null;
  if (Number.isInteger(binding.keyCode)) return binding.keyCode;
  if (typeof binding.key === "number" && Number.isInteger(binding.key)) {
    return binding.key;
  }
  return null;
}

function normalizeControllerLocation(location) {
  if (controllerLocations.includes(location)) return location;
  return defaultControllerLocation;
}

function getNextControllerLocation(location) {
  var normalizedLocation = normalizeControllerLocation(location);
  var currentIndex = controllerLocations.indexOf(normalizedLocation);
  return controllerLocations[(currentIndex + 1) % controllerLocations.length];
}

function getControllerElement(videoOrController) {
  if (!videoOrController) return null;

  if (
    videoOrController.shadowRoot &&
    typeof videoOrController.shadowRoot.querySelector === "function"
  ) {
    return videoOrController.shadowRoot.querySelector("#controller");
  }

  if (
    videoOrController.div &&
    videoOrController.div.shadowRoot &&
    typeof videoOrController.div.shadowRoot.querySelector === "function"
  ) {
    return videoOrController.div.shadowRoot.querySelector("#controller");
  }

  return null;
}

function applyControllerLocationToElement(controller, location) {
  if (!controller) return defaultControllerLocation;
  var normalizedLocation = normalizeControllerLocation(location);
  var styles = controllerLocationStyles[normalizedLocation];

  controller.dataset.location = normalizedLocation;
  controller.dataset.positionMode = "anchored";

  var top = styles.top;
  // If in fullscreen, move the controller down to avoid overlapping video titles
  if (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  ) {
    if (normalizedLocation.startsWith("top-")) {
      top = "63px";
    }
  }

  controller.style.top = top;
  controller.style.left = styles.left;
  controller.style.transform = styles.transform;

  return normalizedLocation;
}

function applyControllerLocation(videoController, location) {
  if (!videoController) return;

  var controller = getControllerElement(videoController);
  if (!controller) return;

  videoController.controllerLocation = applyControllerLocationToElement(
    controller,
    location
  );
}

function clearManualControllerPosition(videoController) {
  if (!videoController) return;
  applyControllerLocation(
    videoController,
    videoController.controllerLocation || tc.settings.controllerLocation
  );
}

function convertControllerToManualPosition(videoController) {
  if (!videoController) return null;

  var controller = getControllerElement(videoController);
  if (!controller) return null;

  controller.dataset.positionMode = "manual";

  var offsetParent = controller.offsetParent;
  if (offsetParent) {
    var controllerRect = controller.getBoundingClientRect();
    var offsetParentRect = offsetParent.getBoundingClientRect();

    controller.style.setProperty(
      "left",
      controllerRect.left - offsetParentRect.left + "px",
      "important"
    );
    controller.style.setProperty(
      "top",
      controllerRect.top - offsetParentRect.top + "px",
      "important"
    );
  } else {
    controller.style.setProperty(
      "left",
      controller.offsetLeft + "px",
      "important"
    );
    controller.style.setProperty(
      "top",
      controller.offsetTop + "px",
      "important"
    );
  }
  controller.style.setProperty("transform", "none", "important");

  return controller;
}

function cycleControllerLocation(video) {
  if (!video || !video.vsc) return;

  video.vsc.controllerLocation = getNextControllerLocation(
    video.vsc.controllerLocation || tc.settings.controllerLocation
  );
  clearManualControllerPosition(video.vsc);
}

function normalizeBindingKey(key) {
  if (typeof key !== "string" || key.length === 0) return null;
  if (key === "Spacebar") return " ";
  if (key === "Esc") return "Escape";
  if (key.length === 1 && /[a-z]/i.test(key)) return key.toUpperCase();
  return key;
}

function legacyKeyCodeToBinding(keyCode) {
  if (!Number.isInteger(keyCode)) return null;
  var key = keyCodeToEventKey[keyCode];
  if (!key && keyCode >= 48 && keyCode <= 57) {
    key = String.fromCharCode(keyCode);
  }
  if (!key && keyCode >= 65 && keyCode <= 90) {
    key = String.fromCharCode(keyCode);
  }
  return {
    key: normalizeBindingKey(key),
    keyCode: keyCode,
    code: null,
    disabled: false
  };
}

function normalizeStoredBinding(binding, fallbackKeyCode) {
  var fallbackBinding = legacyKeyCodeToBinding(fallbackKeyCode);
  if (!binding) return fallbackBinding;

  if (
    binding.disabled === true ||
    (binding.key === null &&
      binding.keyCode === null &&
      binding.code === null)
  ) {
    return {
      action: binding.action,
      key: null,
      keyCode: null,
      code: null,
      disabled: true,
      value: Number(binding.value),
      force: String(binding.force) === "true" ? "true" : "false",
      predefined: Boolean(binding.predefined)
    };
  }

  var normalized = {
    action: binding.action,
    key: null,
    keyCode: null,
    code:
      typeof binding.code === "string" && binding.code.length > 0
        ? binding.code
        : null,
    disabled: false,
    value: Number(binding.value),
    force: String(binding.force) === "true" ? "true" : "false",
    predefined: Boolean(binding.predefined)
  };

  if (typeof binding.key === "string") {
    normalized.key = normalizeBindingKey(binding.key);
  }

  var legacyKeyCode = getLegacyKeyCode(binding);
  if (Number.isInteger(legacyKeyCode)) {
    var legacyBinding = legacyKeyCodeToBinding(legacyKeyCode);
    if (legacyBinding) {
      normalized.key = normalized.key || legacyBinding.key;
      normalized.keyCode = legacyKeyCode;
    }
  }

  if (Number.isInteger(binding.keyCode)) {
    normalized.keyCode = binding.keyCode;
  }

  if (!normalized.key && fallbackBinding) {
    normalized.key = fallbackBinding.key;
    if (normalized.keyCode === null) normalized.keyCode = fallbackBinding.keyCode;
  }

  if (!normalized.key && !normalized.code && normalized.keyCode === null) {
    return null;
  }

  return normalized;
}

function isValidSpeed(speed) {
  return !isNaN(speed) && speed >= MIN_SPEED && speed <= MAX_SPEED;
}

function sanitizeSpeed(speed, fallback) {
  var numericSpeed = Number(speed);
  return isValidSpeed(numericSpeed) ? numericSpeed : fallback;
}

function getVideoSourceKey(video) {
  return (video && (video.currentSrc || video.src)) || "unknown_src";
}

function getControllerTargetSpeed(video) {
  if (!video || !video.vsc) return null;
  return isValidSpeed(video.vsc.targetSpeed) ? video.vsc.targetSpeed : null;
}

function getRememberedSpeed(video) {
  var sourceKey = getVideoSourceKey(video);
  if (sourceKey !== "unknown_src") {
    var videoSpeed = tc.settings.speeds[sourceKey];
    if (isValidSpeed(videoSpeed)) return videoSpeed;
  }
  if (tc.settings.forceLastSavedSpeed && isValidSpeed(tc.settings.lastSpeed)) {
    return tc.settings.lastSpeed;
  }
  if (tc.settings.rememberSpeed && isValidSpeed(tc.settings.lastSpeed)) {
    return tc.settings.lastSpeed;
  }
  return null;
}

function getDesiredSpeed(video) {
  return getControllerTargetSpeed(video) || getRememberedSpeed(video) || 1.0;
}

function isOnYouTube() {
  return (
    location.hostname.includes("youtube.com") ||
    location.hostname.includes("youtube-nocookie.com")
  );
}

function isYouTubeNativeSpeedRange(speed) {
  if (speed < YT_NATIVE_MIN || speed > YT_NATIVE_MAX) return false;
  // Check if speed is a multiple of 0.05 (with floating point tolerance)
  var remainder = Math.abs((speed * 100) % (YT_NATIVE_STEP * 100));
  return remainder < 0.01 || remainder > (YT_NATIVE_STEP * 100 - 0.01);
}

function tryYouTubeNativeSpeed(video, speed) {
  if (!isOnYouTube() || !isYouTubeNativeSpeedRange(speed)) return false;

  try {
    // YouTube's movie_player element exposes setPlaybackRate() but it's a
    // page-level JS method, not a native DOM method. Content scripts can't
    // see it directly. In Firefox, wrappedJSObject gives access to the
    // page's JS context.
    var playerEl =
      video.closest(".html5-video-player") ||
      document.getElementById("movie_player");
    if (!playerEl) return false;

    // Try wrappedJSObject first (Firefox content script → page context)
    var player = playerEl.wrappedJSObject || playerEl;
    if (typeof player.setPlaybackRate === "function") {
      player.setPlaybackRate(speed);
      // Verify YouTube actually accepted the speed (it may silently clamp)
      var actualSpeed = video.playbackRate;
      if (Math.abs(actualSpeed - speed) > 0.01) {
        log("YouTube clamped speed to " + actualSpeed + ", falling back", 4);
        return false;
      }
      log("Used YouTube native setPlaybackRate: " + speed, 4);
      return true;
    }
  } catch (e) {
    log("YouTube native speed failed: " + e.message, 3);
  }
  return false;
}

function isSubtitleNudgeSupported(video) {
  return Boolean(video);
}

function isSubtitleNudgeEnabledForVideo(video) {
  if (!video || !video.vsc) return tc.settings.enableSubtitleNudge;

  if (typeof video.vsc.subtitleNudgeEnabledOverride === "boolean") {
    return video.vsc.subtitleNudgeEnabledOverride;
  }

  return tc.settings.enableSubtitleNudge;
}

function setSubtitleNudgeEnabledForVideo(video, enabled) {
  if (!video || !video.vsc) return false;

  var normalizedEnabled = Boolean(enabled);
  video.vsc.subtitleNudgeEnabledOverride = normalizedEnabled;

  if (!normalizedEnabled) {
    video.vsc.stopSubtitleNudge();
  } else if (!video.paused && video.playbackRate !== 1.0) {
    video.vsc.startSubtitleNudge();
  }

  updateSubtitleNudgeIndicator(video);

  // Briefly flash the standalone indicator next to the speed text
  var flashEl = video.vsc.nudgeFlashIndicator;
  if (flashEl) {
    flashEl.classList.add("visible");
    clearTimeout(flashEl._flashTimer);
    flashEl._flashTimer = setTimeout(function () {
      flashEl.classList.remove("visible");
    }, 1500);
  }

  return normalizedEnabled;
}

function updateSubtitleNudgeIndicator(video) {
  if (!video || !video.vsc) return;

  var isEnabled = isSubtitleNudgeEnabledForVideo(video);
  var label = isEnabled ? "✓" : "×";
  var title = isEnabled ? "Subtitle nudge enabled" : "Subtitle nudge disabled";

  var indicator = video.vsc.subtitleNudgeIndicator;
  if (indicator) {
    indicator.textContent = label;
    indicator.dataset.enabled = isEnabled ? "true" : "false";
    indicator.dataset.supported = "true";
    indicator.title = title;
    indicator.setAttribute("aria-label", title);
  }

  var flashEl = video.vsc.nudgeFlashIndicator;
  if (flashEl) {
    flashEl.textContent = label;
    flashEl.dataset.enabled = isEnabled ? "true" : "false";
    flashEl.dataset.supported = "true";
  }
}

function schedulePersistLastSpeed(speed) {
  if (!isValidSpeed(speed)) return;

  tc.pendingLastSpeedValue = speed;
  if (tc.pendingLastSpeedSave !== null) return;

  tc.pendingLastSpeedSave = setTimeout(function () {
    var speedToPersist = tc.pendingLastSpeedValue;
    tc.pendingLastSpeedSave = null;

    if (!isValidSpeed(speedToPersist) || tc.persistedLastSpeed === speedToPersist) {
      return;
    }

    chrome.storage.sync.set({ lastSpeed: speedToPersist }, function () { });
    tc.persistedLastSpeed = speedToPersist;
  }, 250);
}

function suppressNextNudgeRateChanges(controller, count) {
  if (!controller) return;

  controller.suppressedRateChangeCount =
    (controller.suppressedRateChangeCount || 0) + (count || 2);
  controller.suppressedRateChangeUntil =
    Date.now() + Math.max(250, tc.settings.subtitleNudgeInterval * 4);
}

function shouldIgnoreSuppressedRateChange(video) {
  if (!video || !video.vsc) return false;

  var controller = video.vsc;
  if (
    controller.suppressedRateChangeCount > 0 &&
    controller.suppressedRateChangeUntil >= Date.now()
  ) {
    controller.suppressedRateChangeCount -= 1;
    return true;
  }

  if (controller.suppressedRateChangeUntil < Date.now()) {
    controller.suppressedRateChangeCount = 0;
  }

  return false;
}

function resolveTargetSpeed(video) {
  return getDesiredSpeed(video);
}

function extendSpeedRestoreWindow(video, duration) {
  if (!video || !video.vsc) return;

  var restoreDuration = Number(duration) || 1500;
  var restoreUntil = Date.now() + restoreDuration;
  var currentUntil = Number(video.vsc.speedRestoreUntil) || 0;

  video.vsc.speedRestoreUntil = Math.max(currentUntil, restoreUntil);
}

function scheduleSpeedRestore(video, desiredSpeed, reason) {
  if (!video || !video.vsc || !isValidSpeed(desiredSpeed)) return;

  if (video.vsc.restoreSpeedTimer) {
    clearTimeout(video.vsc.restoreSpeedTimer);
  }

  video.vsc.restoreSpeedTimer = setTimeout(function () {
    if (!video.vsc) return;

    if (Math.abs(video.playbackRate - desiredSpeed) > 0.01) {
      log(
        `Restoring playbackRate to ${desiredSpeed.toFixed(2)} after ${reason}`,
        4
      );
      setSpeed(video, desiredSpeed, false, false);
    }

    if (video.vsc) {
      video.vsc.restoreSpeedTimer = null;
    }
  }, 0);
}

function rememberPendingRateChange(video, speed) {
  if (!video || !video.vsc || !isValidSpeed(speed)) return;

  video.vsc.pendingRateChange = {
    speed: Number(speed),
    expiresAt: Date.now() + 1000
  };
}

function takePendingRateChange(video, currentSpeed) {
  if (!video || !video.vsc || !video.vsc.pendingRateChange) return null;

  var pendingRateChange = video.vsc.pendingRateChange;
  if (
    !isValidSpeed(pendingRateChange.speed) ||
    pendingRateChange.expiresAt <= Date.now()
  ) {
    video.vsc.pendingRateChange = null;
    return null;
  }

  if (Math.abs(Number(pendingRateChange.speed) - currentSpeed) > 0.01) {
    return null;
  }

  video.vsc.pendingRateChange = null;
  return pendingRateChange;
}

function matchesKeyBinding(binding, event) {
  if (!binding || binding.disabled) return false;

  var normalizedEventKey = normalizeBindingKey(event.key);
  if (binding.key && normalizedEventKey) {
    return binding.key === normalizedEventKey;
  }

  if (binding.code && event.code) {
    return binding.code === event.code;
  }

  var legacyKeyCode = getLegacyKeyCode(binding);
  return Number.isInteger(legacyKeyCode) && legacyKeyCode === event.keyCode;
}

function mediaSelector() {
  return tc.settings.audioBoolean ? "video,audio" : "video";
}

function isMediaElement(node) {
  return (
    node &&
    node.nodeType === Node.ELEMENT_NODE &&
    (node.nodeName === "VIDEO" ||
      (node.nodeName === "AUDIO" && tc.settings.audioBoolean))
  );
}

function hasUsableMediaSource(node) {
  if (!isMediaElement(node) || !node.isConnected) return false;
  if (node.currentSrc || node.src || node.srcObject) return true;
  if (typeof node.readyState === "number" && node.readyState > 0) return true;
  if (
    typeof node.networkState === "number" &&
    typeof HTMLMediaElement !== "undefined" &&
    (node.networkState === HTMLMediaElement.NETWORK_IDLE ||
      node.networkState === HTMLMediaElement.NETWORK_LOADING)
  ) {
    return true;
  }

  if (node.querySelectorAll) {
    return Array.from(node.querySelectorAll("source[src]")).some(function (
      source
    ) {
      var src = source.getAttribute("src");
      return typeof src === "string" && src.trim().length > 0;
    });
  }

  return false;
}

function ensureController(node, parent) {
  if (!isMediaElement(node) || node.vsc) return node && node.vsc;
  if (!hasUsableMediaSource(node)) {
    log(
      `Deferring controller creation for ${node.tagName}: no usable source yet`,
      5
    );
    return null;
  }
  log(
    `Creating controller for ${node.tagName}: ${node.src || node.currentSrc || "no src"}`,
    4
  );
  node.vsc = new tc.videoController(
    node,
    parent || node.parentElement || node.parentNode
  );
  return node.vsc;
}

function removeController(node) {
  if (node && node.vsc) node.vsc.remove();
}

function scanNodeForMedia(node, parent, added) {
  if (!node || typeof node === "function") return;

  if (node.nodeType === Node.DOCUMENT_NODE) {
    scanNodeForMedia(node.body || node.documentElement, node.body, added);
    return;
  }

  if (
    node.nodeType !== Node.ELEMENT_NODE &&
    node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
  ) {
    return;
  }

  var ownerDocument = node.ownerDocument || document;
  if (!added && ownerDocument.body && ownerDocument.body.contains(node)) return;

  // Check if the node itself is a media element
  if (isMediaElement(node)) {
    if (added) ensureController(node, parent);
    else removeController(node);
  }

  // Use querySelectorAll instead of recursive child walking — the browser's
  // native selector engine is orders of magnitude faster than JS recursion.
  if (typeof node.querySelectorAll === "function") {
    var selector = mediaSelector();
    try {
      var mediaElements = node.querySelectorAll(selector);
      for (var i = 0; i < mediaElements.length; i++) {
        var el = mediaElements[i];
        if (added) ensureController(el, el.parentNode || parent);
        else removeController(el);
      }
    } catch (e) {
      // querySelectorAll may throw on detached or unusual nodes
    }
  }

  // Still need to observe shadow roots for media inside web components
  if (node.shadowRoot) {
    observeRoot(node.shadowRoot);
  }
}

function getScanNodeForRoot(root) {
  if (!root) return null;
  if (root.nodeType === Node.DOCUMENT_NODE) {
    return root.body || root.documentElement;
  }
  return root;
}

function rootMayContainMedia(root) {
  if (!root) return false;
  if (root.nodeType === Node.DOCUMENT_NODE) return true;
  if (typeof root.querySelector !== "function") return true;

  try {
    return Boolean(root.querySelector(mediaSelector()));
  } catch (error) {
    return true;
  }
}

function scanRootForMedia(root) {
  var scanRoot = getScanNodeForRoot(root);
  if (!scanRoot) return;
  scanNodeForMedia(scanRoot, root.host || scanRoot.parentNode || scanRoot, true);
  if (root.nodeType === Node.DOCUMENT_NODE) {
    attachIframeListeners(root);
  }
}

function observeRoot(root) {
  if (!root || vscObservedRoots.has(root)) return;
  vscObservedRoots.add(root);
  setupListener(root);
  attachMutationObserver(root);
  attachMediaDetectionListeners(root);
  if (rootMayContainMedia(root)) {
    scanRootForMedia(root);
  }
}

function patchAttachShadow() {
  if (
    window.vscAttachShadowPatched ||
    typeof Element === "undefined" ||
    typeof Element.prototype.attachShadow !== "function"
  ) {
    return;
  }

  var originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function () {
    var shadowRoot = originalAttachShadow.apply(this, arguments);
    try {
      if (shadowRoot) {
        observeRoot(shadowRoot);
      }
    } catch (error) {
      log(`Unable to observe shadow root: ${error.message}`, 3);
    }
    return shadowRoot;
  };
  window.vscAttachShadowPatched = true;
}

/* Log levels */
function log(message, level) {
  verbosity = tc.settings.logLevel;
  if (typeof level === "undefined") level = tc.settings.defaultLogLevel;
  if (verbosity >= level) {
    let prefix = "[VSC] ";
    if (level === 2) console.log(prefix + "ERROR: " + message);
    else if (level === 3) console.log(prefix + "WARNING: " + message);
    else if (level === 4) console.log(prefix + "INFO: " + message);
    else if (level === 5) console.log(prefix + "DEBUG: " + message);
    else if (level === 6) {
      console.log(prefix + "DEBUG (VERBOSE): " + message);
      console.trace();
    }
  }
}

chrome.storage.sync.get(tc.settings, function (storage) {
  var storedBindings = Array.isArray(storage.keyBindings)
    ? storage.keyBindings
    : [];

  tc.settings.keyBindings = storedBindings
    .map((binding) => normalizeStoredBinding(binding))
    .filter(Boolean);

  if (tc.settings.keyBindings.length === 0) {
    tc.settings.keyBindings = defaultKeyBindings(storage);
    tc.settings.version = "0.5.3";
    chrome.storage.sync.set({
      keyBindings: tc.settings.keyBindings,
      version: tc.settings.version,
      displayKeyCode: tc.settings.displayKeyCode,
      rememberSpeed: tc.settings.rememberSpeed,
      forceLastSavedSpeed: tc.settings.forceLastSavedSpeed,
      audioBoolean: tc.settings.audioBoolean,
      startHidden: tc.settings.startHidden,
      enabled: tc.settings.enabled,
      controllerLocation: tc.settings.controllerLocation,
      controllerOpacity: tc.settings.controllerOpacity
    });
  }
  tc.settings.lastSpeed = Number(storage.lastSpeed);
  if (!isValidSpeed(tc.settings.lastSpeed) && tc.settings.lastSpeed !== 1.0) {
    log(`Invalid lastSpeed detected: ${storage.lastSpeed}, resetting to 1.0`, 3);
    tc.settings.lastSpeed = 1.0;
    tc.persistedLastSpeed = 1.0;
    chrome.storage.sync.set({ lastSpeed: 1.0 });
  } else if (!isValidSpeed(tc.settings.lastSpeed)) {
    tc.settings.lastSpeed = 1.0;
  }
  tc.persistedLastSpeed = tc.settings.lastSpeed;
  tc.settings.displayKeyCode = Number(storage.displayKeyCode);
  tc.settings.rememberSpeed = Boolean(storage.rememberSpeed);
  tc.settings.forceLastSavedSpeed = Boolean(storage.forceLastSavedSpeed);
  tc.settings.audioBoolean = Boolean(storage.audioBoolean);
  tc.settings.enabled = Boolean(storage.enabled);
  tc.settings.startHidden = Boolean(storage.startHidden);
  tc.settings.hideWithControls =
    typeof storage.hideWithControls !== "undefined"
      ? Boolean(storage.hideWithControls)
      : Boolean(storage.hideWithYouTubeControls);
  tc.settings.hideWithControlsTimer =
    Math.min(15, Math.max(0.1, Number(storage.hideWithControlsTimer) || 2.0));
  tc.settings.hideWithYouTubeControls = tc.settings.hideWithControls;
  tc.settings.controllerLocation = normalizeControllerLocation(
    storage.controllerLocation
  );
  tc.settings.controllerOpacity = Number(storage.controllerOpacity);
  tc.settings.siteRules = Array.isArray(storage.siteRules)
    ? storage.siteRules
    : [];

  tc.settings.controllerButtons = Array.isArray(storage.controllerButtons)
    ? storage.controllerButtons
    : tc.settings.controllerButtons;

  // Migrate legacy blacklist if present
  if (storage.blacklist && typeof storage.blacklist === "string" && tc.settings.siteRules.length === 0) {
    var lines = storage.blacklist.split("\n");
    lines.forEach((line) => {
      var pattern = line.replace(regStrip, "");
      if (pattern.length > 0) {
        tc.settings.siteRules.push({
          pattern: pattern,
          disableExtension: true
        });
      }
    });
    if (tc.settings.siteRules.length > 0) {
      chrome.storage.sync.set({ siteRules: tc.settings.siteRules });
      chrome.storage.sync.remove(["blacklist"]);
      log("Migrated legacy blacklist to site rules", 4);
    }
  }

  tc.settings.enableSubtitleNudge =
    typeof storage.enableSubtitleNudge !== "undefined"
      ? Boolean(storage.enableSubtitleNudge)
      : tc.settings.enableSubtitleNudge;
  tc.settings.subtitleNudgeInterval = Math.min(
    1000,
    Math.max(10, Number(storage.subtitleNudgeInterval) || 50)
  );
  tc.settings.subtitleNudgeAmount =
    Number(storage.subtitleNudgeAmount) || tc.settings.subtitleNudgeAmount;
  var addedDefaultBinding = false;
  addedDefaultBinding =
    ensureDefaultKeyBinding(
      "display",
      "V",
      Number(storage.displayKeyCode) || 86,
      0
    ) || addedDefaultBinding;
  addedDefaultBinding =
    ensureDefaultKeyBinding("move", "P", 80, 0) || addedDefaultBinding;
  addedDefaultBinding =
    ensureDefaultKeyBinding("toggleSubtitleNudge", "N", 78, 0) ||
    addedDefaultBinding;

  if (addedDefaultBinding) {
    chrome.storage.sync.set({ keyBindings: tc.settings.keyBindings });
  }
  patchAttachShadow();
  // Add a listener for messages from the popup.
  // We use a global flag to ensure the listener is only attached once.
  if (!window.vscMessageListener) {
    chrome.runtime.onMessage.addListener(
      function (request, sender, sendResponse) {
        if (request.action === "rescan_page") {
          log("Re-scan command received from popup.", 4);
          initializeWhenReady(document, true);
          sendResponse({ status: "complete" });
        } else if (request.action === "get_speed") {
          var speed = 1.0;
          if (tc.mediaElements && tc.mediaElements.length > 0) {
            for (var i = 0; i < tc.mediaElements.length; i++) {
              if (tc.mediaElements[i] && !tc.mediaElements[i].paused) {
                speed = tc.mediaElements[i].playbackRate;
                break;
              }
            }
            if (speed === 1.0 && tc.mediaElements[0]) {
              speed = tc.mediaElements[0].playbackRate;
            }
          }
          sendResponse({ speed: speed });
        } else if (request.action === "get_page_context") {
          sendResponse({ url: location.href });
        } else if (request.action === "run_action") {
          var value = request.value;
          if (value === undefined || value === null) {
            value = getKeyBindings(request.actionName, "value");
          }
          runAction(request.actionName, value);
          var newSpeed = 1.0;
          if (tc.mediaElements && tc.mediaElements.length > 0) {
            newSpeed = tc.mediaElements[0].playbackRate;
          }
          sendResponse({ speed: newSpeed });
        }

        return true;
      }
    );

    // Set the flag to prevent adding the listener again.
    window.vscMessageListener = true;
  }
  initializeWhenReady(document);
});

function getKeyBindings(action, what = "value") {
  try {
    return tc.settings.keyBindings.find((item) => item.action === action)[what];
  } catch (e) {
    return false;
  }
}
function setKeyBindings(action, value) {
  tc.settings.keyBindings.find((item) => item.action === action)["value"] =
    value;
}

function createControllerButton(doc, action, label, className) {
  var button = doc.createElement("button");
  button.dataset.action = action;
  button.textContent = label;
  if (className) {
    button.className = className;
  }
  return button;
}

function defineVideoController() {
  tc.videoController = function (target, parent) {
    if (target.vsc) return target.vsc;
    tc.mediaElements.push(target);
    target.vsc = this;
    this.video = target;
    this.parent = target.parentElement || parent;
    this.nudgeAnimationId = null;
    this.restoreSpeedTimer = null;
    this.pendingRateChange = null;
    this.speedRestoreUntil = 0;
    this.subtitleNudgeEnabledOverride = null;
    this.suppressedRateChangeCount = 0;
    this.suppressedRateChangeUntil = 0;
    this.visibilityResumeHandler = null;
    this.controllerLocation = normalizeControllerLocation(
      tc.settings.controllerLocation
    );

    log(`Creating video controller for ${target.tagName} with src: ${target.src || target.currentSrc || 'none'}`, 4);

    let storedSpeed = sanitizeSpeed(resolveTargetSpeed(target), 1.0);
    this.targetSpeed = storedSpeed;
    if (!tc.settings.rememberSpeed && !tc.settings.forceLastSavedSpeed) {
      setKeyBindings("reset", getKeyBindings("fast"));
    }

    log("Explicitly setting playbackRate to: " + storedSpeed, 5);
    target.playbackRate = storedSpeed;

    this.div = this.initializeControls();

    if (!this.div) {
      log("ERROR: Failed to create controller div!", 2);
      return;
    }

    log(`Controller created and attached to DOM. Hidden: ${this.div.classList.contains('vsc-hidden')}`, 4);

    var mediaEventAction = function (event) {
      if (event.type === "play") {
        extendSpeedRestoreWindow(event.target);

        if (!tc.settings.rememberSpeed && !tc.settings.forceLastSavedSpeed) {
          setKeyBindings("reset", getKeyBindings("fast"));
        }

        var playSpeed = sanitizeSpeed(resolveTargetSpeed(event.target), 1.0);
        if (Math.abs(event.target.playbackRate - playSpeed) > 0.01) {
          log("Play event: setting playbackRate to: " + playSpeed, 4);
          setSpeed(event.target, playSpeed, false, false);
        } else if (playSpeed === 1.0 || event.target.paused) {
          this.stopSubtitleNudge();
        } else {
          this.startSubtitleNudge();
        }
      } else if (event.type === "pause") {
        extendSpeedRestoreWindow(event.target);
        this.stopSubtitleNudge();
        tc.isNudging = false;
      } else if (event.type === "seeking") {
        extendSpeedRestoreWindow(event.target);
      } else if (event.type === "ended") {
        this.speedRestoreUntil = 0;
        this.stopSubtitleNudge();
        tc.isNudging = false;
      } else if (event.type === "seeked") {
        extendSpeedRestoreWindow(event.target);
        var expectedSpeed = sanitizeSpeed(resolveTargetSpeed(event.target), 1.0);
        var currentSpeed = event.target.playbackRate;

        if (
          Math.abs(currentSpeed - expectedSpeed) > 0.01
        ) {
          log(
            `Seeked: speed changed from ${expectedSpeed} to ${currentSpeed}, restoring`,
            4
          );
          setSpeed(event.target, expectedSpeed, false, false);
        }

        if (isUserSeek) {
          isUserSeek = false;
        }
      }
    };

    target.addEventListener(
      "play",
      (this.handlePlay = mediaEventAction.bind(this))
    );
    target.addEventListener(
      "pause",
      (this.handlePause = mediaEventAction.bind(this))
    );
    target.addEventListener(
      "seeking",
      (this.handleSeeking = mediaEventAction.bind(this))
    );
    target.addEventListener(
      "ended",
      (this.handleEnded = mediaEventAction.bind(this))
    );
    target.addEventListener(
      "seeked",
      (this.handleSeek = mediaEventAction.bind(this))
    );

    var srcObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "attributes" &&
          (mutation.attributeName === "src" ||
            mutation.attributeName === "currentSrc")
        ) {
          log("mutation of A/V element", 5);
          if (this.div) {
            this.stopSubtitleNudge();
            if (!mutation.target.src && !mutation.target.currentSrc) {
              this.div.classList.add("vsc-nosource");
            } else {
              this.div.classList.remove("vsc-nosource");
              if (!mutation.target.paused) this.startSubtitleNudge();
            }
            updateSubtitleNudgeIndicator(this.video);
          }
        }
      });
    });
    this.srcObserver = srcObserver;
    srcObserver.observe(target, { attributeFilter: ["src", "currentSrc"] });
    if (!target.paused && target.playbackRate !== 1.0)
      this.startSubtitleNudge();
  };

  tc.videoController.prototype.remove = function () {
    this.stopSubtitleNudge();
    if (this.youTubeAutoHideObserver) {
      this.youTubeAutoHideObserver.disconnect();
      this.youTubeAutoHideObserver = null;
    }
    if (this.youTubeAutoHideCleanup) {
      this.youTubeAutoHideCleanup();
      this.youTubeAutoHideCleanup = null;
    }
    if (this.genericAutoHideCleanup) {
      this.genericAutoHideCleanup();
      this.genericAutoHideCleanup = null;
    }
    if (this.div) this.div.remove();
    if (this.restoreSpeedTimer) clearTimeout(this.restoreSpeedTimer);
    if (this.video) {
      this.video.removeEventListener("play", this.handlePlay);
      this.video.removeEventListener("pause", this.handlePause);
      this.video.removeEventListener("seeking", this.handleSeeking);
      this.video.removeEventListener("ended", this.handleEnded);
      this.video.removeEventListener("seeked", this.handleSeek);
      delete this.video.vsc;
    }
    if (this.srcObserver) this.srcObserver.disconnect();
    let idx = tc.mediaElements.indexOf(this.video);
    if (idx != -1) tc.mediaElements.splice(idx, 1);
  };

  tc.videoController.prototype.startSubtitleNudge = function () {
    if (
      !isSubtitleNudgeSupported(this.video) ||
      !isSubtitleNudgeEnabledForVideo(this.video) ||
      this.nudgeAnimationId !== null ||
      !this.video ||
      this.video.paused ||
      this.video.playbackRate === 1.0
    ) {
      return;
    }

    // Store the target speed so we can always revert to it
    this.targetSpeed = this.video.playbackRate;

    const performNudge = () => {
      // Check if we should stop
      if (!this.video || this.video.paused || this.video.playbackRate === 1.0) {
        this.stopSubtitleNudge();
        return;
      }

      // CRITICAL: Don't nudge if tab is hidden - prevents speed drift
      if (document.hidden) {
        if (!this.visibilityResumeHandler && this.video && this.video.ownerDocument) {
          this.visibilityResumeHandler = () => {
            if (this.video.ownerDocument.hidden) return;
            this.video.ownerDocument.removeEventListener(
              "visibilitychange",
              this.visibilityResumeHandler,
              true
            );
            this.visibilityResumeHandler = null;
            this.startSubtitleNudge();
          };
          this.video.ownerDocument.addEventListener(
            "visibilitychange",
            this.visibilityResumeHandler,
            true
          );
        }
        this.nudgeAnimationId = null;
        return;
      }

      // Set flag to prevent ratechange listener from interfering
      tc.isNudging = true;
      suppressNextNudgeRateChanges(this, 2);

      // Cache values to avoid repeated property access
      const targetSpeed = this.targetSpeed;
      const nudgeAmount = tc.settings.subtitleNudgeAmount;

      // Apply nudge from the stored target speed (not current rate)
      this.video.playbackRate = targetSpeed + nudgeAmount;

      // Revert synchronously after a microtask to ensure it happens immediately
      Promise.resolve().then(() => {
        if (this.video && targetSpeed) {
          this.video.playbackRate = targetSpeed;
        }
        tc.isNudging = false;
      });

      // Schedule next nudge
      this.nudgeAnimationId = setTimeout(performNudge, tc.settings.subtitleNudgeInterval);
    };

    // Start the first nudge
    this.nudgeAnimationId = setTimeout(performNudge, tc.settings.subtitleNudgeInterval);
    log(`Nudge: Starting with interval ${tc.settings.subtitleNudgeInterval}ms.`, 5);
  };

  tc.videoController.prototype.stopSubtitleNudge = function () {
    if (this.nudgeAnimationId !== null) {
      clearTimeout(this.nudgeAnimationId);
      this.nudgeAnimationId = null;
      log(`Nudge: Stopping.`, 5);
    }
    if (this.visibilityResumeHandler && this.video && this.video.ownerDocument) {
      this.video.ownerDocument.removeEventListener(
        "visibilitychange",
        this.visibilityResumeHandler,
        true
      );
      this.visibilityResumeHandler = null;
    }
    // Clear the animation state, but PRESERVE targetSpeed so getDesiredSpeed
    // doesn't lose the user's intended speed if the site hijacks it.
  };

  tc.videoController.prototype.performImmediateNudge = function () {
    if (
      !isSubtitleNudgeSupported(this.video) ||
      !isSubtitleNudgeEnabledForVideo(this.video) ||
      !this.video ||
      this.video.paused ||
      this.video.playbackRate === 1.0 ||
      document.hidden
    ) {
      return;
    }

    const targetRate = this.targetSpeed || this.video.playbackRate;
    const nudgeAmount = tc.settings.subtitleNudgeAmount;

    tc.isNudging = true;
    suppressNextNudgeRateChanges(this, 2);
    this.video.playbackRate = targetRate + nudgeAmount;

    // Revert synchronously via microtask
    Promise.resolve().then(() => {
      if (this.video) {
        this.video.playbackRate = targetRate;
      }
      tc.isNudging = false;
    });

    log(`Immediate nudge performed at rate ${targetRate.toFixed(2)}`, 5);
  };

  tc.videoController.prototype.setupYouTubeAutoHide = function (wrapper) {
    if (!wrapper || !isOnYouTube()) return;

    const video = this.video;
    const ytPlayer = video.closest(".html5-video-player");
    if (!ytPlayer) {
      log("YouTube player not found for auto-hide setup", 4);
      return;
    }

    const syncControllerVisibility = () => {
      // YouTube adds ytp-autohide class to the player when controls should be hidden
      // We mirror this class state to enable CSS-based hiding
      // The vsc-hidden class (from V key) takes precedence via CSS specificity
      if (ytPlayer.classList.contains("ytp-autohide")) {
        wrapper.classList.add("ytp-autohide");
        
        // Immediately end any temporary "vsc-show" state to hide with YouTube
        // UNLESS it was forced by a shortcut (vsc-forced-show)
        if (!wrapper.classList.contains("vsc-forced-show")) {
          wrapper.classList.remove("vsc-show");
          if (wrapper.showTimeOut) {
            clearTimeout(wrapper.showTimeOut);
            wrapper.showTimeOut = undefined;
          }
        }
        
        log("YouTube controls hidden, hiding controller", 5);
      } else {
        wrapper.classList.remove("ytp-autohide");
        log("YouTube controls visible, showing controller", 5);
      }
    };

    // Initial sync
    syncControllerVisibility();

    // Observe YouTube player class changes
    this.youTubeAutoHideObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes" && mutation.attributeName === "class") {
          syncControllerVisibility();
        }
      });
    });

    this.youTubeAutoHideObserver.observe(ytPlayer, {
      attributes: true,
      attributeFilter: ["class"]
    });

    log("YouTube auto-hide observer setup complete", 4);

    // Also reveal on hover/activity independently of YouTube's own controls
    // for immediate responsiveness, UNLESS Speeder is actually toggled hidden (vsc-hidden)
    const resetTimer = () => {
      showController(wrapper, tc.settings.hideWithControlsTimer * 1000);
    };

    const activityEvents = ["mousemove", "mousedown", "touchstart"];
    activityEvents.forEach((type) => {
      video.addEventListener(type, resetTimer, { passive: true });
      wrapper.addEventListener(type, resetTimer, { passive: true });
      ytPlayer.addEventListener(type, resetTimer, { passive: true });
    });

    // Store a cleanup function
    this.youTubeAutoHideCleanup = () => {
      activityEvents.forEach((type) => {
        video.removeEventListener(type, resetTimer);
        wrapper.removeEventListener(type, resetTimer);
        ytPlayer.removeEventListener(type, resetTimer);
      });
    };
  };

  tc.videoController.prototype.setupGenericAutoHide = function (wrapper) {
    if (!wrapper) return;

    const video = this.video;
    let timer = null;

    const resetTimer = () => {
      wrapper.classList.remove("vsc-idle-hidden");
      showController(wrapper, tc.settings.hideWithControlsTimer * 1000);
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        // Only hide if the video is not paused
        // (Many players keep controls visible while paused)
        // However, the user said "Reveal on every mouse and keyboard input"
        // and "auto-hidden after timespan". 
        // We'll follow the timer strictly.
        wrapper.classList.add("vsc-idle-hidden");
        log("Generic hide: controller hidden due to inactivity", 5);
      }, tc.settings.hideWithControlsTimer * 1000);
    };

    // Initial show/timer
    resetTimer();

    // The wrapper covers the player area on most sites due to inject.css styles,
    // but we listen on both the video and the wrapper for maximum coverage.
    const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart"];
    const parentEl = video.parentElement;
    activityEvents.forEach((type) => {
      video.addEventListener(type, resetTimer, { passive: true });
      wrapper.addEventListener(type, resetTimer, { passive: true });
      if (parentEl) {
        parentEl.addEventListener(type, resetTimer, { passive: true });
      }
    });

    // Also reset timer on play/pause events to ensure sync when player state changes
    video.addEventListener("play", resetTimer, { passive: true });
    video.addEventListener("pause", resetTimer, { passive: true });

    // Store a cleanup function
    this.genericAutoHideCleanup = () => {
      if (timer) clearTimeout(timer);
      activityEvents.forEach((type) => {
        video.removeEventListener(type, resetTimer);
        wrapper.removeEventListener(type, resetTimer);
        if (parentEl) {
          parentEl.removeEventListener(type, resetTimer);
        }
      });
      video.removeEventListener("play", resetTimer);
      video.removeEventListener("pause", resetTimer);
    };

    log(`Generic auto-hide setup complete with ${tc.settings.hideWithControlsTimer}s timer`, 4);
  };

  tc.videoController.prototype.initializeControls = function () {
    const doc = this.video.ownerDocument;
    const speed = this.video.playbackRate.toFixed(2);
    var wrapper = doc.createElement("div");
    wrapper.classList.add("vsc-controller");
    if (!this.video.src && !this.video.currentSrc)
      wrapper.classList.add("vsc-nosource");
    if (tc.settings.startHidden) wrapper.classList.add("vsc-hidden");
    // Use lower z-index for non-YouTube sites to avoid overlapping modals
    if (!isOnYouTube()) wrapper.classList.add("vsc-non-youtube");
    var shadow = wrapper.attachShadow({ mode: "open" });
    var shadowStylesheet = doc.createElement("link");
    shadowStylesheet.rel = "stylesheet";
    shadowStylesheet.href = chrome.runtime.getURL("shadow.css");
    shadow.appendChild(shadowStylesheet);

    var controller = doc.createElement("div");
    controller.id = "controller";
    controller.style.opacity = String(tc.settings.controllerOpacity);
    this.controllerLocation = applyControllerLocationToElement(
      controller,
      this.controllerLocation
    );

    var dragHandle = doc.createElement("span");
    dragHandle.dataset.action = "drag";
    dragHandle.className = "draggable";
    dragHandle.textContent = speed;

    var controls = doc.createElement("span");
    controls.id = "controls";

    var buttonConfig = Array.isArray(tc.settings.controllerButtons)
      ? tc.settings.controllerButtons
      : ["rewind", "slower", "faster", "advance", "display"];

    var subtitleNudgeIndicator = null;

    buttonConfig.forEach(function (btnId) {
      if (btnId === "nudge") {
        subtitleNudgeIndicator = doc.createElement("span");
        subtitleNudgeIndicator.id = "nudge-indicator";
        subtitleNudgeIndicator.setAttribute("role", "button");
        subtitleNudgeIndicator.setAttribute("aria-live", "polite");
        subtitleNudgeIndicator.setAttribute("tabindex", "0");
        controls.appendChild(subtitleNudgeIndicator);
      } else {
        var def = controllerButtonDefs[btnId];
        if (def) {
          controls.appendChild(
            createControllerButton(doc, btnId, def.label, def.className)
          );
        }
      }
    });

    var nudgeFlashIndicator = doc.createElement("span");
    nudgeFlashIndicator.id = "nudge-flash-indicator";
    nudgeFlashIndicator.setAttribute("aria-hidden", "true");

    controller.appendChild(dragHandle);
    controller.appendChild(nudgeFlashIndicator);
    controller.appendChild(controls);
    shadow.appendChild(controller);

    this.speedIndicator = dragHandle;
    this.subtitleNudgeIndicator = subtitleNudgeIndicator;
    this.nudgeFlashIndicator = nudgeFlashIndicator;
    if (subtitleNudgeIndicator) {
      updateSubtitleNudgeIndicator(this.video);
    }
    dragHandle.addEventListener(
      "mousedown",
      (e) => {
        runAction(
          e.target.dataset["action"],
          getKeyBindings(e.target.dataset["action"], "value"),
          e
        );
        e.stopPropagation();
      },
      true
    );
    shadow.querySelectorAll("button").forEach((button) => {
      button.addEventListener(
        "click",
        (e) => {
          runAction(
            e.target.dataset["action"],
            getKeyBindings(e.target.dataset["action"]),
            e
          );
          e.stopPropagation();
        },
        true
      );
    });
    if (subtitleNudgeIndicator) {
      subtitleNudgeIndicator.addEventListener(
        "click",
        (e) => {
          var video = this.video;
          if (video) {
            var newState = !isSubtitleNudgeEnabledForVideo(video);
            setSubtitleNudgeEnabledForVideo(video, newState);
          }
          e.stopPropagation();
        },
        true
      );
    }
    controller.addEventListener("click", (e) => e.stopPropagation(), false);
    controller.addEventListener("mousedown", (e) => e.stopPropagation(), false);

    // Setup auto-hide observers if enabled
    if (tc.settings.hideWithControls) {
      if (isOnYouTube()) {
        this.setupYouTubeAutoHide(wrapper);
      } else {
        this.setupGenericAutoHide(wrapper);
      }
    }
    
    var fragment = doc.createDocumentFragment();
    fragment.appendChild(wrapper);
    const parentEl = this.parent || this.video.parentElement;

    log(`Inserting controller: parentEl=${!!parentEl}, parentNode=${!!parentEl?.parentNode}, hostname=${location.hostname}`, 4);

    if (!parentEl || !parentEl.parentNode) {
      log("No suitable parent found, appending to body", 4);
      doc.body.appendChild(fragment);
      return wrapper;
    }

    try {
      switch (true) {
        case location.hostname == "www.amazon.com":
        case location.hostname == "www.reddit.com":
        case /hbogo\./.test(location.hostname):
          log("Using parentElement.parentElement insertion", 5);
          parentEl.parentElement.insertBefore(fragment, parentEl);
          break;
        case location.hostname == "www.facebook.com":
          log("Using Facebook-specific insertion", 5);
          let p =
            parentEl.parentElement.parentElement.parentElement.parentElement
              .parentElement.parentElement.parentElement;
          if (p && p.firstChild) p.insertBefore(fragment, p.firstChild);
          else parentEl.insertBefore(fragment, parentEl.firstChild);
          break;
        case location.hostname == "tv.apple.com":
          log("Using Apple TV-specific insertion", 5);
          const r = parentEl.getRootNode();
          const s = r && r.querySelector ? r.querySelector(".scrim") : null;
          if (s) s.prepend(fragment);
          else parentEl.insertBefore(fragment, parentEl.firstChild);
          break;
        case location.hostname == "www.youtube.com":
        case location.hostname == "m.youtube.com":
        case location.hostname == "music.youtube.com":
          // YouTube's player DOM has .html5-video-container (video's parent) as a
          // low layer with overlay siblings (.ytp-player-content, etc.) on top that
          // intercept mouse events. Insert into .html5-video-player (the player
          // root) so the controller sits above all overlay layers.
          log("Using YouTube-specific insertion", 5);
          var ytPlayer = parentEl.closest(".html5-video-player");
          if (ytPlayer) {
            ytPlayer.insertBefore(fragment, ytPlayer.firstChild);
          } else {
            parentEl.insertBefore(fragment, parentEl.firstChild);
          }
          break;
        default:
          log("Using default insertion method", 5);
          parentEl.insertBefore(fragment, parentEl.firstChild);
      }
      log("Controller successfully inserted into DOM", 4);
    } catch (error) {
      log(`Error inserting controller: ${error.message}`, 2);
      // Fallback to body insertion
      doc.body.appendChild(fragment);
    }

    return wrapper;
  };
}

function escapeStringRegExp(str) {
  const m = /[|\\{}()[\]^$+*?.]/g;
  return str.replace(m, "\\$&");
}
function applySiteRuleOverrides() {
  if (!Array.isArray(tc.settings.siteRules) || tc.settings.siteRules.length === 0) {
    return false;
  }

  var currentUrl = location.href;
  var matchedRule = null;

  for (var i = 0; i < tc.settings.siteRules.length; i++) {
    var rule = tc.settings.siteRules[i];
    var pattern = rule.pattern;
    if (!pattern || pattern.length === 0) continue;

    var regex;
    if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
      try {
        var lastSlash = pattern.lastIndexOf("/");
        regex = new RegExp(
          pattern.substring(1, lastSlash),
          pattern.substring(lastSlash + 1)
        );
      } catch (e) {
        log(`Invalid site rule regex: ${pattern}. ${e.message}`, 2);
        continue;
      }
    } else {
      regex = new RegExp(escapeStringRegExp(pattern));
    }

    if (regex && regex.test(currentUrl)) {
      matchedRule = rule;
      break;
    }
  }

  if (!matchedRule) return false;

  tc.activeSiteRule = matchedRule;
  log(`Matched site rule: ${matchedRule.pattern}`, 4);

  // Check if extension should be enabled/disabled on this site
  if (matchedRule.enabled === false) {
    log(`Extension disabled for site: ${currentUrl}`, 4);
    return true;
  } else if (matchedRule.disableExtension === true) {
    // Handle old format
    log(`Extension disabled (legacy) for site: ${currentUrl}`, 4);
    return true;
  }

  // Override general settings with site-specific overrides
  const siteSettings = [
    "startHidden",
    "hideWithControls",
    "hideWithControlsTimer",
    "controllerLocation",
    "rememberSpeed",
    "forceLastSavedSpeed",
    "audioBoolean",
    "controllerOpacity",
    "enableSubtitleNudge",
    "subtitleNudgeInterval"
  ];

  siteSettings.forEach((key) => {
    if (matchedRule[key] !== undefined) {
      log(`Overriding ${key} for site: ${matchedRule[key]}`, 4);
      tc.settings[key] = matchedRule[key];
    }
  });

  if (Array.isArray(matchedRule.controllerButtons)) {
    log(`Overriding controllerButtons for site`, 4);
    tc.settings.controllerButtons = matchedRule.controllerButtons;
  }

  // Override key bindings with site-specific shortcuts
  if (Array.isArray(matchedRule.shortcuts) && matchedRule.shortcuts.length > 0) {
    var overriddenActions = new Set();
    matchedRule.shortcuts.forEach((shortcut) => {
      overriddenActions.add(shortcut.action);
    });

    // Keep global bindings that aren't overridden, add site-specific ones
    tc.settings.keyBindings = tc.settings.keyBindings
      .filter((binding) => !overriddenActions.has(binding.action))
      .concat(
        matchedRule.shortcuts.map((shortcut) =>
          normalizeStoredBinding(shortcut)
        ).filter(Boolean)
      );
  }

  return false;
}

function shouldPreserveDesiredSpeed(video, speed) {
  if (!video || !video.vsc) return false;
  var desiredSpeed = getDesiredSpeed(video);
  if (!isValidSpeed(desiredSpeed) || Math.abs(speed - desiredSpeed) <= 0.01) {
    return false;
  }

  return (
    video.paused === true ||
    (typeof video.vsc.speedRestoreUntil === "number" &&
      video.vsc.speedRestoreUntil > Date.now())
  );
}

function setupListener(root) {
  root = root || document;
  if (root.vscRateListenerAttached) return;
  function updateSpeedFromEvent(video) {
    if (!video.vsc || !video.vsc.speedIndicator) return;
    var speed = video.playbackRate; // Preserve full precision (e.g. 0.0625)
    video.vsc.speedIndicator.textContent = speed.toFixed(2);
    video.vsc.targetSpeed = speed;
    var sourceKey = getVideoSourceKey(video);
    if (sourceKey !== "unknown_src") {
      tc.settings.speeds[sourceKey] = speed;
    }
    tc.settings.lastSpeed = speed;
    schedulePersistLastSpeed(speed);
    if (video.vsc) {
      if (speed === 1.0 || video.paused) video.vsc.stopSubtitleNudge();
      else video.vsc.startSubtitleNudge();
    }
  }
  root.addEventListener(
    "ratechange",
    function (event) {
      if (tc.isNudging) return;
      var video = event.target;
      if (!video || typeof video.playbackRate === "undefined" || !video.vsc)
        return;
      if (shouldIgnoreSuppressedRateChange(video)) return;
      if (tc.settings.forceLastSavedSpeed) {
        if (event.detail && event.detail.origin === "videoSpeed") {
          video.playbackRate = event.detail.speed;
          updateSpeedFromEvent(video);
        } else {
          video.playbackRate = sanitizeSpeed(tc.settings.lastSpeed, 1.0);
        }
        event.stopImmediatePropagation();
      } else {
        var currentSpeed = video.playbackRate; // Preserve full precision (e.g. 0.0625)
        var desiredSpeed = getDesiredSpeed(video);
        var pendingRateChange = takePendingRateChange(video, currentSpeed);

        if (pendingRateChange) {
          updateSpeedFromEvent(video);
          return;
        }

        if (shouldPreserveDesiredSpeed(video, currentSpeed)) {
          log(
            `Ignoring external rate change to ${currentSpeed.toFixed(4)} while preserving ${desiredSpeed.toFixed(4)}`,
            4
          );
          video.vsc.speedIndicator.textContent = desiredSpeed.toFixed(2);
          scheduleSpeedRestore(video, desiredSpeed, "pause/play or seek");
          return;
        }

        updateSpeedFromEvent(video);
      }
    },
    true
  );
  root.vscRateListenerAttached = true;
}

var vscInitializedDocuments = new Set();
function clearPendingInitialization(doc) {
  if (!doc || !doc.vscPendingInitializeHandler) return;

  var handler = doc.vscPendingInitializeHandler;
  doc.removeEventListener("DOMContentLoaded", handler);
  doc.removeEventListener("readystatechange", handler);

  if (doc.defaultView) {
    doc.defaultView.removeEventListener("load", handler);
  }

  delete doc.vscPendingInitializeHandler;
  doc.vscPendingForceReinit = false;
}

function tryInitializeDocument(doc, forceReinit) {
  if (!doc) return false;
  if ((!forceReinit && vscInitializedDocuments.has(doc)) || !doc.body) {
    return false;
  }

  initializeNow(doc, forceReinit);
  clearPendingInitialization(doc);
  return true;
}

function initializeWhenReady(doc, forceReinit = false) {
  if (!doc) return;
  doc.vscPendingForceReinit = doc.vscPendingForceReinit === true || forceReinit;

  if (tryInitializeDocument(doc, doc.vscPendingForceReinit)) {
    return;
  }

  if (doc.vscPendingInitializeHandler) return;

  var pendingInitializeHandler = function () {
    tryInitializeDocument(doc, doc.vscPendingForceReinit === true);
  };

  doc.vscPendingInitializeHandler = pendingInitializeHandler;
  doc.addEventListener("DOMContentLoaded", pendingInitializeHandler);
  doc.addEventListener("readystatechange", pendingInitializeHandler);

  if (doc.defaultView) {
    doc.defaultView.addEventListener("load", pendingInitializeHandler);
    doc.defaultView.setTimeout(pendingInitializeHandler, 0);
  } else {
    setTimeout(pendingInitializeHandler, 0);
  }
}
function inIframe() {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
}

function attachKeydownListeners(doc) {
  var docs = [doc];
  try {
    if (inIframe() && window.top.document !== doc) docs.push(window.top.document);
  } catch (e) { }

  docs.forEach(function (keyDoc) {
    if (keyDoc.vscKeydownListenerAttached) return;
    keyDoc.addEventListener(
      "keydown",
      function (event) {
        if (
          !event.getModifierState ||
          event.getModifierState("Alt") ||
          event.getModifierState("Control") ||
          event.getModifierState("Fn") ||
          event.getModifierState("Meta") ||
          event.getModifierState("Hyper") ||
          event.getModifierState("OS")
        ) {
          return;
        }

        if (
          event.target.nodeName === "INPUT" ||
          event.target.nodeName === "TEXTAREA" ||
          event.target.isContentEditable
        ) {
          return;
        }

        if (!tc.mediaElements.length) return;

        var item = tc.settings.keyBindings.find(function (binding) {
          return matchesKeyBinding(binding, event);
        });

        if (item) {
          runAction(item.action, item.value, event);

          // Always prevent default and stop propagation for Speeder shortcuts
          // to prevent the website (e.g. YouTube) from reacting to these keys.
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true
    );
    keyDoc.vscKeydownListenerAttached = true;
  });
}

function attachMutationObserver(root) {
  if (root.vscMutationObserverAttached) return;

  var pendingMutations = [];
  var mutationProcessingScheduled = false;
  var observer = new MutationObserver(function (mutations) {
    pendingMutations.push(...mutations);
    if (mutationProcessingScheduled) return;

    mutationProcessingScheduled = true;
    requestIdle(
      function () {
        var mutationsToProcess = pendingMutations.splice(0);
        mutationProcessingScheduled = false;

        mutationsToProcess.forEach(function (mutation) {
          if (mutation.type === "childList") {
            mutation.addedNodes.forEach(function (node) {
              // Skip text nodes, comments, etc. — only elements can contain media
              if (node.nodeType !== Node.ELEMENT_NODE) return;
              scanNodeForMedia(node, node.parentNode || mutation.target, true);
            });
            mutation.removedNodes.forEach(function (node) {
              if (node.nodeType !== Node.ELEMENT_NODE) return;
              scanNodeForMedia(node, node.parentNode || mutation.target, false);
            });
            return;
          }

          if (mutation.type !== "attributes") return;

          var target = mutation.target;
          if (
            isMediaElement(target) &&
            (mutation.attributeName === "src" ||
              mutation.attributeName === "currentSrc")
          ) {
            ensureController(target, target.parentElement || target.parentNode);
            return;
          }

          if (
            mutation.attributeName === "aria-hidden" &&
            target.attributes["aria-hidden"] &&
            target.attributes["aria-hidden"].value === "false"
          ) {
            scanNodeForMedia(
              target,
              target.parentNode || root.host || mutation.target,
              true
            );
          }
        });
      },
      { timeout: 1000 }
    );
  });

  observer.observe(root, {
    attributeFilter: ["aria-hidden", "src", "currentSrc"],
    childList: true,
    subtree: true,
    attributes: true
  });

  root.vscMutationObserverAttached = true;
}

function attachMediaDetectionListeners(root) {
  if (root.vscMediaEventListenersAttached) return;

  var handleDetectedMedia = function (event) {
    var target = event.target;
    if (!isMediaElement(target)) return;
    ensureController(target, target.parentElement || target.parentNode);
  };

  [
    "loadstart",
    "loadeddata",
    "loadedmetadata",
    "canplay",
    "playing",
    "play"
  ].forEach(function (eventName) {
    root.addEventListener(eventName, handleDetectedMedia, true);
  });
  root.vscMediaEventListenersAttached = true;
}

function attachIframeListeners(doc) {
  Array.from(doc.getElementsByTagName("iframe")).forEach(function (frame) {
    if (!frame.vscLoadListenerAttached) {
      frame.addEventListener("load", function () {
        try {
          if (frame.contentDocument) {
            initializeWhenReady(frame.contentDocument, true);
          }
        } catch (e) { }
      });
      frame.vscLoadListenerAttached = true;
    }

    try {
      if (frame.contentDocument) {
        initializeWhenReady(frame.contentDocument);
      }
    } catch (e) { }
  });
}

function attachNavigationListeners() {
  if (window.vscNavigationListenersAttached) return;

  var scheduleRescan = function () {
    clearTimeout(window.vscNavigationRescanTimer);
    window.vscNavigationRescanTimer = setTimeout(function () {
      initializeWhenReady(document, true);
    }, 300);
  };

  ["pushState", "replaceState"].forEach(function (method) {
    if (typeof history[method] !== "function") return;
    var original = history[method];
    history[method] = function () {
      var result = original.apply(this, arguments);
      scheduleRescan();
      return result;
    };
  });

  window.addEventListener("popstate", scheduleRescan);
  window.addEventListener("hashchange", scheduleRescan);
  window.vscNavigationListenersAttached = true;
}

function initializeNow(doc, forceReinit = false) {
  if ((!forceReinit && vscInitializedDocuments.has(doc)) || !doc.body) return;

  var siteDisabled = applySiteRuleOverrides();
  if (!tc.settings.enabled || siteDisabled) return;

  if (!doc.body.classList.contains("vsc-initialized")) {
    doc.body.classList.add("vsc-initialized");
  }
  if (typeof tc.videoController === "undefined") defineVideoController();
  attachKeydownListeners(doc);
  attachNavigationListeners();
  observeRoot(doc);

  if (forceReinit) {
    log("Force re-initialization requested", 4);
  }

  vscInitializedDocuments.add(doc);
}

function setSpeed(video, speed, isInitialCall = false, isUserKeyPress = false) {
  const numericSpeed = Number(speed);

  if (!isValidSpeed(numericSpeed)) {
    log(
      `Invalid speed rejected: ${speed}, must be between ${MIN_SPEED} and ${MAX_SPEED}`,
      2
    );
    return;
  }

  if (!video || !video.vsc || !video.vsc.speedIndicator) return;

  log(
    `setSpeed: Target ${numericSpeed.toFixed(2)}. Initial: ${isInitialCall}. UserKeyPress: ${isUserKeyPress}`,
    4
  );
  tc.settings.lastSpeed = numericSpeed;
  video.vsc.speedIndicator.textContent = numericSpeed.toFixed(2);

  // Update the target speed for nudge so it knows what to revert to
  video.vsc.targetSpeed = numericSpeed;

  if (isUserKeyPress && !isInitialCall && video.vsc && video.vsc.div) {
    runAction("blink", 1000, null, video); // Pass video to blink
    extendSpeedRestoreWindow(video); // Protect against immediate site-driven resets
  }

  // Try YouTube's native speed API first — keeps subtitles in sync without nudge
  var usedNativeSpeed = false;
  if (tc.settings.forceLastSavedSpeed) {
    video.dispatchEvent(
      new CustomEvent("ratechange", {
        detail: {
          origin: "videoSpeed",
          speed: numericSpeed.toFixed(2),
          fromUserInput: isUserKeyPress
        }
      })
    );
  } else {
    if (Math.abs(video.playbackRate - numericSpeed) > 0.001) {
      rememberPendingRateChange(video, numericSpeed);
      usedNativeSpeed = tryYouTubeNativeSpeed(video, numericSpeed);
      if (!usedNativeSpeed) {
        video.playbackRate = numericSpeed;
      }
    }
  }
  if (video.vsc) {
    if (numericSpeed === 1.0 || video.paused) {
      video.vsc.stopSubtitleNudge();
    } else if (usedNativeSpeed) {
      // YouTube's native API handles subtitle sync — no nudge needed
      video.vsc.stopSubtitleNudge();
    } else {
      video.vsc.startSubtitleNudge();
    }
  }
}

function runAction(action, value, e) {
  log("runAction Begin", 5);
  var mediaTagsToProcess;
  const specificVideo = arguments[3] || null;
  var subtitleNudgeToggleValue = null;

  if (specificVideo) {
    mediaTagsToProcess = [specificVideo];
  } else if (e && e.target && e.target.getRootNode) {
    // Event-driven action
    const docContext = e.target.ownerDocument || document;
    mediaTagsToProcess = tc.mediaElements.filter(
      (v) => v.ownerDocument === docContext
    );
    const targetController = e.target.getRootNode().host;
    if (targetController) {
      // If it's a click on a controller, only use that one video
      const videoFromController = tc.mediaElements.find(
        (v) => v.vsc && v.vsc.div === targetController
      );
      if (videoFromController) mediaTagsToProcess = [videoFromController];
    }
  } else {
    mediaTagsToProcess = tc.mediaElements;
  }
  if (action === "settings") {
    chrome.runtime.sendMessage({ action: "openOptions" });
    return;
  }
  if (mediaTagsToProcess.length === 0 && action !== "display") return;

  if (action === "toggleSubtitleNudge" && mediaTagsToProcess.length > 0) {
    subtitleNudgeToggleValue = !isSubtitleNudgeEnabledForVideo(
      mediaTagsToProcess[0]
    );
  }

  mediaTagsToProcess.forEach(function (v) {
    if (!v.vsc) return; // Don't process videos without a controller
    var controller = v.vsc.div;
    const userDrivenActionsThatShowController = [
      "rewind",
      "advance",
      "faster",
      "slower",
      "reset",
      "fast",
      "move",
      "pause",
      "muted",
      "mark",
      "jump",
      "drag",
      "toggleSubtitleNudge",
      "display"
    ];
    if (userDrivenActionsThatShowController.includes(action) && action !== "display") {
      showController(controller, 2000, true);
    }
    if (v.classList.contains("vsc-cancelled")) return;
    const numValue = parseFloat(value);
    switch (action) {
      case "rewind":
        isUserSeek = true;
        extendSpeedRestoreWindow(v);
        v.currentTime -= numValue;
        break;
      case "advance":
        isUserSeek = true;
        extendSpeedRestoreWindow(v);
        v.currentTime += numValue;
        break;
      case "faster":
        var fasterStep = numValue;
        // Use grid-snapping: always move to the next multiple of fasterStep
        // Add a tiny epsilon (1% of step) to jump clear of the current point
        var newFasterSpeed = Math.ceil((v.playbackRate + (fasterStep * 0.01)) / fasterStep) * fasterStep;
        // Clean up JS floating point math (e.g. 0.30000000000000004 -> 0.30)
        newFasterSpeed = Math.round(newFasterSpeed * 1000) / 1000;
        setSpeed(v, Math.min(newFasterSpeed, MAX_SPEED), false, true);
        break;
      case "slower":
        var slowerStep = numValue;
        // Use grid-snapping: always move to the previous multiple of slowerStep
        // Subtract a tiny epsilon (1% of step) to jump clear of the current point
        var newSlowerSpeed = Math.floor((v.playbackRate - (slowerStep * 0.01)) / slowerStep) * slowerStep;
        // Clean up JS floating point math
        newSlowerSpeed = Math.round(newSlowerSpeed * 1000) / 1000;
        setSpeed(v, Math.max(newSlowerSpeed, MIN_SPEED), false, true);
        break;
      case "reset":
        resetSpeed(v, 1.0, false); // Use enhanced resetSpeed
        break;
      case "fast":
        var preferredSpeed = numValue;
        // Apply site-specific preferred speed override if available
        if (tc.activeSiteRule && typeof tc.activeSiteRule.preferredSpeed === "number") {
          preferredSpeed = tc.activeSiteRule.preferredSpeed;
        }
        resetSpeed(v, preferredSpeed, true);
        break;
      case "display":
        if (controller.classList.contains("vsc-hidden")) {
          controller.classList.remove("vsc-hidden");
          showController(controller, 2000, true);
        } else {
          controller.classList.add("vsc-hidden");
          // Clear any show state when explicitly hiding
          controller.classList.remove("vsc-show");
          controller.classList.remove("vsc-forced-show");
          if (controller.showTimeOut) {
            clearTimeout(controller.showTimeOut);
            controller.showTimeOut = undefined;
          }
        }
        break;
      case "blink":
        log(`Blink action: controller hidden=${controller.classList.contains("vsc-hidden")}, timeout=${controller.blinkTimeOut !== undefined}, duration=${numValue}`, 5);

        if (
          controller.classList.contains("vsc-hidden") ||
          controller.blinkTimeOut !== undefined
        ) {
          var restoreHidden =
            controller.restoreHiddenAfterBlink === true ||
            controller.classList.contains("vsc-hidden");

          if (controller.blinkTimeOut !== undefined) {
            clearTimeout(controller.blinkTimeOut);
          }

          controller.restoreHiddenAfterBlink = restoreHidden;
          controller.classList.remove("vsc-hidden");
          log(`Controller shown, setting timeout for ${numValue || 1000}ms`, 5);

          controller.blinkTimeOut = setTimeout(() => {
            if (controller.restoreHiddenAfterBlink === true) {
              controller.classList.add("vsc-hidden");
              log("Controller auto-hidden after blink timeout", 5);
            } else {
              log("Controller kept visible", 5);
            }
            controller.restoreHiddenAfterBlink = false;
            controller.blinkTimeOut = undefined;
          }, numValue || 1000);
        }
        break;
      case "drag":
        if (e) handleDrag(v, e);
        break;
      case "move":
        cycleControllerLocation(v);
        break;
      case "pause":
        pause(v);
        break;
      case "muted":
        muted(v);
        break;
      case "mark":
        setMark(v);
        break;
      case "jump":
        jumpToMark(v);
        break;
      case "toggleSubtitleNudge":
        setSubtitleNudgeEnabledForVideo(v, subtitleNudgeToggleValue);
        break;
    }
  });
  log("runAction End", 5);
}

function pause(v) {
  if (v.paused) v.play().catch((e) => log(`Play err:${e.message}`, 2));
  else v.pause();
}

function resetSpeed(v, target, isFastKey = false) {
  const videoId = getVideoSourceKey(v);
  const currentSpeed = v.playbackRate;

  if (isFastKey) {
    // G key: Toggle between current speed and preferred speed (e.g., 1.8)
    const preferredSpeed = target;
    const lastToggle = lastToggleSpeed[videoId] || currentSpeed;

    if (Math.abs(currentSpeed - preferredSpeed) < 0.01) {
      // Currently at preferred speed, toggle to the last speed
      setSpeed(v, lastToggle, false, true);
    } else {
      // Not at preferred speed, save current as toggle speed and go to preferred
      lastToggleSpeed[videoId] = currentSpeed;
      setSpeed(v, preferredSpeed, false, true);
    }
  } else {
    // R key: Toggle between current speed and 1.0
    const resetSpeedValue = 1.0;
    const lastToggle = lastToggleSpeed[videoId] || currentSpeed;

    if (Math.abs(currentSpeed - resetSpeedValue) < 0.01) {
      // Currently at 1.0, toggle to the last speed (or 1.8 if no history)
      const speedToRestore =
        Math.abs(lastToggle - 1.0) < 0.01
          ? getKeyBindings("fast") || 1.8
          : lastToggle;
      setSpeed(v, speedToRestore, false, true);
    } else {
      // Not at 1.0, save current as toggle speed and go to 1.0
      lastToggleSpeed[videoId] = currentSpeed;
      setSpeed(v, resetSpeedValue, false, true);
    }
  }
}

function muted(v) {
  v.muted = !v.muted;
}
function setMark(v) {
  v.vsc.mark = v.currentTime;
}
function jumpToMark(v) {
  if (v.vsc && typeof v.vsc.mark === "number") {
    extendSpeedRestoreWindow(v);
    v.currentTime = v.vsc.mark;
  }
}
function handleDrag(video, e) {
  const c = video.vsc.div;
  const sC = convertControllerToManualPosition(video.vsc);
  if (!sC) return;
  var pE = c.parentElement;
  while (
    pE.parentNode &&
    pE.parentNode.offsetHeight === pE.offsetHeight &&
    pE.parentNode.offsetWidth === pE.offsetWidth
  )
    pE = pE.parentNode;
  video.classList.add("vcs-dragging");
  sC.classList.add("dragging");
  const iXY = [e.clientX, e.clientY],
    iCXY = [parseInt(sC.style.left), parseInt(sC.style.top)];
  const sD = (e) => {
    sC.style.setProperty(
      "left",
      iCXY[0] + e.clientX - iXY[0] + "px",
      "important"
    );
    sC.style.setProperty(
      "top",
      iCXY[1] + e.clientY - iXY[1] + "px",
      "important"
    );
  };
  const eD = () => {
    pE.removeEventListener("mousemove", sD);
    pE.removeEventListener("mouseup", eD);
    pE.removeEventListener("mouseleave", eD);
    sC.classList.remove("dragging");
    video.classList.remove("vcs-dragging");
  };
  pE.addEventListener("mouseup", eD);
  pE.addEventListener("mouseleave", eD);
  pE.addEventListener("mousemove", sD);
}
function showController(controller, duration = 2000, forced = false) {
  if (!controller || typeof controller.classList === "undefined") return;
  var restoreHidden =
    controller.restoreHiddenAfterShow === true ||
    controller.classList.contains("vsc-hidden");

  controller.restoreHiddenAfterShow = restoreHidden;
  controller.classList.remove("vsc-hidden");
  controller.classList.add("vsc-show");
  if (forced) {
    controller.classList.add("vsc-forced-show");
  }

  if (controller.showTimeOut !== undefined) {
    clearTimeout(controller.showTimeOut);
  }

  controller.showTimeOut = setTimeout(function () {
    controller.classList.remove("vsc-show");
    controller.classList.remove("vsc-forced-show");
    if (controller.restoreHiddenAfterShow === true) {
      controller.classList.add("vsc-hidden");
    }
    controller.restoreHiddenAfterShow = false;
    controller.showTimeOut = undefined;
  }, duration);
}

// Add global listener to handle fullscreen transitions and adjust controller positions
document.addEventListener("fullscreenchange", () => {
  tc.mediaElements.forEach((video) => {
    if (video.vsc) {
      applyControllerLocation(video.vsc, video.vsc.controllerLocation);
    }
  });
});
