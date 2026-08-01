var isUserSeek = false; // Track if seek was user-initiated
var lastToggleSpeed = {}; // Store last toggle speeds per video
var speederShared =
  typeof SpeederShared === "object" && SpeederShared ? SpeederShared : {};
var controllerUtils = speederShared.controllerUtils || {};
var keyBindingUtils = speederShared.keyBindings || {};
var siteRuleUtils = speederShared.siteRules || {};
var sharedSettingsDefaults =
  typeof vscGetSettingsDefaults === "function"
    ? vscGetSettingsDefaults()
    : null;

function getSharedDefault(key, fallback) {
  if (
    sharedSettingsDefaults &&
    Object.prototype.hasOwnProperty.call(sharedSettingsDefaults, key)
  ) {
    var value = sharedSettingsDefaults[key];
    if (Array.isArray(value)) {
      return value.map(function(item) {
        return item && typeof item === "object"
          ? Object.assign({}, item)
          : item;
      });
    }
    return value;
  }
  return fallback;
}

function getPrimaryVideoElement(mediaElements) {
  var candidates = Array.isArray(mediaElements)
    ? mediaElements
    : tc.mediaElements;
  if (!candidates || candidates.length === 0) return null;

  var best = null;
  var bestScore = -Infinity;
  candidates.forEach(function(el, index) {
    if (!el || !el.vsc || !el.isConnected) return;

    var rect = null;
    try {
      rect = el.getBoundingClientRect();
    } catch (_error) {}

    var width = rect && Number(rect.width) > 0 ? Number(rect.width) : 0;
    var height = rect && Number(rect.height) > 0 ? Number(rect.height) : 0;
    var win = el.ownerDocument && el.ownerDocument.defaultView;
    var viewportWidth = (win && win.innerWidth) || width;
    var viewportHeight = (win && win.innerHeight) || height;
    var visibleWidth = rect
      ? Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0))
      : 0;
    var visibleHeight = rect
      ? Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0))
      : 0;
    var visibleArea = visibleWidth * visibleHeight;
    var visuallyAvailable = visibleArea > 0;
    try {
      var computed = win && win.getComputedStyle(el);
      if (
        computed &&
        (computed.display === "none" ||
          computed.visibility === "hidden" ||
          Number(computed.opacity) === 0)
      ) {
        visuallyAvailable = false;
      }
    } catch (_error) {}

    var score = visibleArea;
    if (visuallyAvailable) score += 1e12;
    if (!el.paused && !el.ended) {
      score += visuallyAvailable ? 1e11 : 1e6;
    }
    if (el.vsc.lastActivityAt) {
      score += Math.max(0, 1e9 - (Date.now() - el.vsc.lastActivityAt));
    }
    if (el.ended) score -= 1e11;
    // Stable tie-break: prefer the most recently registered media element.
    score += index / 1000;

    if (score > bestScore) {
      best = el;
      bestScore = score;
    }
  });

  return best;
}

var tc = {
  settings: {
    lastSpeed: getSharedDefault("lastSpeed", 1.0),
    enabled: getSharedDefault("enabled", true),
    speeds: {},
    rememberSpeed: getSharedDefault("rememberSpeed", false),
    forceLastSavedSpeed: getSharedDefault("forceLastSavedSpeed", false),
    audioBoolean: getSharedDefault("audioBoolean", false),
    showAmbientLoopControls: getSharedDefault(
      "showAmbientLoopControls",
      false
    ),
    startHidden: getSharedDefault("startHidden", false),
    hideWithYouTubeControls: getSharedDefault(
      "hideWithYouTubeControls",
      false
    ),
    hideWithControls: getSharedDefault("hideWithControls", false),
    hideWithControlsTimer: getSharedDefault("hideWithControlsTimer", 2.0),
    controllerLocation: getSharedDefault("controllerLocation", "top-left"),
    controllerOpacity: getSharedDefault("controllerOpacity", 0.3),
    controllerMarginTop: getSharedDefault("controllerMarginTop", 0),
    controllerMarginRight: getSharedDefault("controllerMarginRight", 0),
    controllerMarginBottom: getSharedDefault("controllerMarginBottom", 65),
    controllerMarginLeft: getSharedDefault("controllerMarginLeft", 0),
    shortcutTargetMode: getSharedDefault("shortcutTargetMode", "closest"),
    keyBindings: getSharedDefault("keyBindings", []),
    siteRules: getSharedDefault("siteRules", []),
    controllerButtons: getSharedDefault("controllerButtons", [
      "rewind",
      "slower",
      "faster",
      "advance",
      "display"
    ]),
    defaultLogLevel: 3,
    logLevel: 3,
    enableSubtitleNudge: getSharedDefault("enableSubtitleNudge", false),
    subtitleNudgeEnabledByDefault: getSharedDefault(
      "subtitleNudgeEnabledByDefault",
      true
    ),
    subtitleNudgeInterval: getSharedDefault("subtitleNudgeInterval", 250),
    subtitleNudgeAmount: getSharedDefault("subtitleNudgeAmount", 0.001),
    customButtonIcons: {}
  },
  mediaElements: [],
  isNudging: false,
  pendingLastSpeedSave: null,
  pendingLastSpeedValue: null,
  lastSpeedSaveRetries: 0,
  lastSpeedWriteInFlight: false,
  lastSpeedWriteValue: null,
  pendingRememberedSpeedsSave: null,
  rememberedSpeedsSaveRetries: 0,
  rememberedSpeedsWriteEpoch: 0,
  rememberedSpeedsWriteInFlight: null,
  rememberedSpeedsResetAt: 0,
  speedAccessTimes: {},
  persistedLastSpeed: 1.0,
  activeSiteRule: null,
  siteRuleBase: null,
  runtimeSettingsHydrated: false,
  pendingMediaCandidates: [],
  settingsReloadRetries: 0,
  lastPointerPosition: null,
  lastInteractedMedia: null,
  frameToken:
    window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : String(Date.now()) + "-" + Math.random().toString(36).slice(2)
};

var MIN_SPEED = Number(keyBindingUtils.MIN_SPEED) || 0.1;
var MAX_SPEED = Number(keyBindingUtils.MAX_SPEED) || 16;
var YT_NATIVE_MIN = 0.25;
var YT_NATIVE_MAX = 2.0;
var YT_NATIVE_STEP = 0.05;
var vscObservedRoots = new WeakSet();
var vscObservedRootList = [];
var vscConnectedScannedRoots = new WeakSet();
var vscInitializedDocuments = new WeakSet();
var vscSourceObjectIds = new WeakMap();
var vscNextSourceObjectId = 1;
var requestIdle =
  typeof window.requestIdleCallback === "function"
    ? window.requestIdleCallback.bind(window)
    : function(callback, options) {
      return setTimeout(callback, (options && options.timeout) || 1);
    };
var controllerLocations = Array.isArray(controllerUtils.controllerLocations)
  ? controllerUtils.controllerLocations.slice()
  : [
    "top-left",
    "top-center",
    "top-right",
    "middle-right",
    "bottom-right",
    "bottom-center",
    "bottom-left",
    "middle-left"
  ];
var defaultControllerLocation =
  controllerUtils.defaultControllerLocation || controllerLocations[0];
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
    top: "calc(100% - 0px)",
    left: "calc(100% - 10px)",
    transform: "translate(-100%, -100%)"
  },
  "bottom-center": {
    top: "calc(100% - 0px)",
    left: "50%",
    transform: "translate(-50%, -100%)"
  },
  "bottom-left": {
    top: "calc(100% - 0px)",
    left: "15px",
    transform: "translate(0, -100%)"
  },
  "middle-left": {
    top: "50%",
    left: "15px",
    transform: "translate(0, -50%)"
  }
};

/* `label` fallback only when ui-icons has no path for the action. */
var controllerButtonDefs = {
  rewind: { label: "", className: "rw" },
  slower: { label: "", className: "" },
  faster: { label: "", className: "" },
  advance: { label: "", className: "rw" },
  display: { label: "", className: "hideButton" },
  reset: { label: "\u21BB", className: "" },
  fast: { label: "", className: "" },
  nudge: { label: "", className: "" },
  pause: { label: "", className: "" },
  muted: { label: "", className: "" },
  louder: { label: "", className: "" },
  softer: { label: "", className: "" },
  mark: { label: "", className: "" },
  jump: { label: "", className: "" },
  settings: { label: "", className: "" }
};

function createDefaultBinding(action, code, value) {
  return {
    action: action,
    code: code,
    value: value,
    force: false,
    predefined: true
  };
}

function defaultKeyBindings(storage) {
  return [
    createDefaultBinding(
      "slower",
      "KeyS",
      Number(storage.speedStep) || 0.1
    ),
    createDefaultBinding(
      "faster",
      "KeyD",
      Number(storage.speedStep) || 0.1
    ),
    createDefaultBinding(
      "rewind",
      "KeyZ",
      Number(storage.rewindTime) || 10
    ),
    createDefaultBinding(
      "advance",
      "KeyX",
      Number(storage.advanceTime) || 10
    ),
    createDefaultBinding(
      "reset",
      "KeyR",
      1.0
    ),
    createDefaultBinding(
      "fast",
      "KeyG",
      Number(storage.fastSpeed) || 1.8
    ),
    createDefaultBinding(
      "move",
      "KeyP",
      0
    ),
    createDefaultBinding(
      "toggleSubtitleNudge",
      "KeyN",
      0
    )
  ];
}

function ensureDefaultKeyBinding(action, code, value) {
  if (tc.settings.keyBindings.some((binding) => binding.action === action)) {
    return false;
  }

  tc.settings.keyBindings.push(
    createDefaultBinding(action, code, value)
  );
  return true;
}

function getLegacyKeyCode(binding) {
  return keyBindingUtils.getLegacyKeyCode(binding);
}

function normalizeControllerLocation(location) {
  return controllerUtils.normalizeControllerLocation(
    location,
    defaultControllerLocation
  );
}

var CONTROLLER_MARGIN_MAX_PX = 200;

function normalizeControllerMarginPx(value, fallback) {
  return controllerUtils.clampControllerMarginPx(value, fallback);
}

function applyControllerMargins(controller) {
  if (!controller) return;
  var d = tc.settings;
  var loc = controller.dataset.location;
  var manual = controller.dataset.positionMode === "manual";
  var isTopAnchored =
    !manual &&
    (loc === "top-left" ||
      loc === "top-center" ||
      loc === "top-right");
  var isBottomAnchored =
    !manual &&
    (loc === "bottom-right" ||
      loc === "bottom-center" ||
      loc === "bottom-left");
  var isMiddleRow =
    !manual && (loc === "middle-left" || loc === "middle-right");
  var mt = normalizeControllerMarginPx(d.controllerMarginTop, 0);
  var mb = normalizeControllerMarginPx(d.controllerMarginBottom, 65);
  if (isTopAnchored || isBottomAnchored || isMiddleRow) {
    mt = 0;
    mb = 0;
  }
  controller.style.marginTop = mt + "px";
  var ml = normalizeControllerMarginPx(d.controllerMarginLeft, 0);
  var mr = normalizeControllerMarginPx(d.controllerMarginRight, 0);
  if (!manual) {
    ml = 0;
    mr = 0;
  }
  controller.style.marginRight = mr + "px";
  controller.style.marginBottom = mb + "px";
  controller.style.marginLeft = ml + "px";
}

function getNextControllerLocation(location) {
  return controllerUtils.getNextControllerLocation(location);
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
  if (
    normalizedLocation === "top-left" ||
    normalizedLocation === "top-center" ||
    normalizedLocation === "top-right"
  ) {
    var insetTop = normalizeControllerMarginPx(
      tc.settings.controllerMarginTop,
      0
    );
    top = "calc(10px + " + insetTop + "px)";
  }
  if (
    normalizedLocation === "bottom-right" ||
    normalizedLocation === "bottom-center" ||
    normalizedLocation === "bottom-left"
  ) {
    var lift = normalizeControllerMarginPx(
      tc.settings.controllerMarginBottom,
      65
    );
    top = "calc(100% - " + lift + "px)";
  }
  // If in fullscreen, move the controller down to avoid overlapping video titles
  if (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  ) {
    if (normalizedLocation.startsWith("top-")) {
      var insetTopFs = normalizeControllerMarginPx(
        tc.settings.controllerMarginTop,
        0
      );
      top = "calc(63px + " + insetTopFs + "px)";
    }
  }

  controller.style.top = top;

  var left = styles.left;
  switch (normalizedLocation) {
    case "top-left":
    case "middle-left":
    case "bottom-left":
      left = "15px";
      break;
    case "top-right":
    case "middle-right":
    case "bottom-right":
      left = "calc(100% - 10px)";
      break;
    case "top-center":
    case "bottom-center":
      left = "50%";
      break;
    default:
      break;
  }
  controller.style.left = left;
  controller.style.transform = styles.transform;

  applyControllerMargins(controller);

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

function captureSiteRuleBase() {
  tc.siteRuleBase = {
    startHidden: tc.settings.startHidden,
    hideWithControls: tc.settings.hideWithControls,
    hideWithControlsTimer: tc.settings.hideWithControlsTimer,
    controllerLocation: tc.settings.controllerLocation,
    rememberSpeed: tc.settings.rememberSpeed,
    forceLastSavedSpeed: tc.settings.forceLastSavedSpeed,
    audioBoolean: tc.settings.audioBoolean,
    showAmbientLoopControls: tc.settings.showAmbientLoopControls,
    controllerOpacity: tc.settings.controllerOpacity,
    controllerMarginTop: tc.settings.controllerMarginTop,
    controllerMarginBottom: tc.settings.controllerMarginBottom,
    shortcutTargetMode: tc.settings.shortcutTargetMode,
    enableSubtitleNudge: tc.settings.enableSubtitleNudge,
    subtitleNudgeEnabledByDefault: tc.settings.subtitleNudgeEnabledByDefault,
    subtitleNudgeInterval: tc.settings.subtitleNudgeInterval,
    controllerButtons: Array.isArray(tc.settings.controllerButtons)
      ? tc.settings.controllerButtons.slice()
      : tc.settings.controllerButtons,
    keyBindings: Array.isArray(tc.settings.keyBindings)
      ? tc.settings.keyBindings.map(function(binding) {
        return Object.assign({}, binding);
      })
      : tc.settings.keyBindings
  };
}

function resetSettingsFromSiteRuleBase() {
  if (!tc.siteRuleBase) return;
  var base = tc.siteRuleBase;
  tc.settings.startHidden = base.startHidden;
  tc.settings.hideWithControls = base.hideWithControls;
  tc.settings.hideWithControlsTimer = base.hideWithControlsTimer;
  tc.settings.controllerLocation = base.controllerLocation;
  tc.settings.rememberSpeed = base.rememberSpeed;
  tc.settings.forceLastSavedSpeed = base.forceLastSavedSpeed;
  tc.settings.audioBoolean = base.audioBoolean;
  tc.settings.showAmbientLoopControls = base.showAmbientLoopControls;
  tc.settings.controllerOpacity = base.controllerOpacity;
  tc.settings.controllerMarginTop = base.controllerMarginTop;
  tc.settings.controllerMarginBottom = base.controllerMarginBottom;
  tc.settings.shortcutTargetMode = base.shortcutTargetMode;
  tc.settings.enableSubtitleNudge = base.enableSubtitleNudge;
  tc.settings.subtitleNudgeEnabledByDefault = base.subtitleNudgeEnabledByDefault;
  tc.settings.subtitleNudgeInterval = base.subtitleNudgeInterval;
  tc.settings.controllerButtons = Array.isArray(base.controllerButtons)
    ? base.controllerButtons.slice()
    : base.controllerButtons;
  tc.settings.keyBindings = Array.isArray(base.keyBindings)
    ? base.keyBindings.map(function(binding) {
      return Object.assign({}, binding);
    })
    : base.keyBindings;
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
  return keyBindingUtils.normalizeBindingKey(key);
}

function legacyBindingKeyToCode(key) {
  return keyBindingUtils.legacyBindingKeyToCode(key);
}

function legacyKeyCodeToCode(keyCode) {
  return keyBindingUtils.legacyKeyCodeToCode(keyCode);
}

function inferBindingCode(binding, fallbackCode) {
  return keyBindingUtils.inferBindingCode(binding, fallbackCode);
}

function normalizeStoredBinding(binding, fallbackCode) {
  if (!binding) {
    if (!fallbackCode) return null;
    return {
      code: fallbackCode,
      disabled: false,
      value: 0,
      force: "false",
      predefined: false
    };
  }

  if (
    binding.disabled === true ||
    (binding.code === null &&
      binding.key === null &&
      binding.keyCode === null)
  ) {
    return {
      action: binding.action,
      code: null,
      disabled: true,
      value: keyBindingUtils.sanitizeActionValue(
        binding.action,
        binding.value,
        0
      ),
      force: String(binding.force) === "true" ? "true" : "false",
      predefined: Boolean(binding.predefined)
    };
  }

  var normalizedCode = inferBindingCode(binding, fallbackCode);
  if (!normalizedCode) {
    return null;
  }

  var normalized = {
    action: binding.action,
    code: normalizedCode,
    shiftKey: binding.shiftKey === true,
    disabled: false,
    value: keyBindingUtils.sanitizeActionValue(
      binding.action,
      binding.value,
      0
    ),
    force: String(binding.force) === "true" ? "true" : "false",
    predefined: Boolean(binding.predefined)
  };

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
  if (!video) return "unknown_src";

  var sourceObject = video.srcObject;
  if (
    sourceObject &&
    (typeof sourceObject === "object" || typeof sourceObject === "function")
  ) {
    if (!vscSourceObjectIds.has(sourceObject)) {
      vscSourceObjectIds.set(sourceObject, vscNextSourceObjectId++);
    }
    return "src_object:" + vscSourceObjectIds.get(sourceObject);
  }

  return video.currentSrc || video.src || "unknown_src";
}

function getControllerTargetSpeed(video) {
  if (!video || !video.vsc) return null;
  if (!isValidSpeed(video.vsc.targetSpeed)) return null;

  var currentSourceKey = getVideoSourceKey(video);
  var targetSourceKey = video.vsc.targetSpeedSourceKey;

  // SPA sites (e.g. YouTube) can reuse the same <video> element.
  // Don't carry controller target speed across a source swap.
  if (
    targetSourceKey &&
    currentSourceKey === "unknown_src" &&
    targetSourceKey !== "unknown_src"
  ) {
    return null;
  }
  if (
    targetSourceKey &&
    currentSourceKey !== "unknown_src" &&
    targetSourceKey !== currentSourceKey
  ) {
    return null;
  }

  return video.vsc.targetSpeed;
}

function getRememberedSpeed(video) {
  if (!tc.settings.rememberSpeed && !tc.settings.forceLastSavedSpeed) {
    return null;
  }

  // Force is deliberately global and must outrank stale per-source memory.
  if (tc.settings.forceLastSavedSpeed && isValidSpeed(tc.settings.lastSpeed)) {
    return tc.settings.lastSpeed;
  }

  var sourceKey = getVideoSourceKey(video);
  if (sourceKey !== "unknown_src") {
    var videoSpeed = tc.settings.speeds[sourceKey];
    if (isValidSpeed(videoSpeed)) return videoSpeed;
  }

  // No per-source entry yet — fall back to the most recently used speed.
  // This ensures e.g. YouTube Shorts carry the user's chosen speed to the
  // next Short even when that exact source URL hasn't been visited before.
  if (isValidSpeed(tc.settings.lastSpeed)) {
    return tc.settings.lastSpeed;
  }
  return null;
}

function getDesiredSpeed(video) {
  if (tc.settings.forceLastSavedSpeed && isValidSpeed(tc.settings.lastSpeed)) {
    return tc.settings.lastSpeed;
  }
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

function isSubtitleNudgeAvailableForVideo(video) {
  return isSubtitleNudgeSupported(video) && Boolean(tc.settings.enableSubtitleNudge);
}

function isSubtitleNudgeEnabledForVideo(video) {
  if (!isSubtitleNudgeAvailableForVideo(video)) return false;

  if (!video || !video.vsc) {
    return Boolean(tc.settings.subtitleNudgeEnabledByDefault);
  }

  if (typeof video.vsc.subtitleNudgeEnabledOverride === "boolean") {
    return video.vsc.subtitleNudgeEnabledOverride;
  }

  return Boolean(tc.settings.subtitleNudgeEnabledByDefault);
}

function setSubtitleNudgeEnabledForVideo(video, enabled) {
  if (!video || !video.vsc) return false;

  if (!isSubtitleNudgeAvailableForVideo(video)) {
    video.vsc.subtitleNudgeEnabledOverride = null;
    video.vsc.stopSubtitleNudge();
    updateSubtitleNudgeIndicator(video);
    return false;
  }

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
    flashEl._flashTimer = setTimeout(function() {
      flashEl.classList.remove("visible");
    }, 1500);
  }

  return normalizedEnabled;
}

function renderSubtitleNudgeIndicatorContent(target, isEnabled) {
  if (!target) return;
  var action = isEnabled ? "subtitleNudgeOn" : "subtitleNudgeOff";
  var custom =
    tc.settings.customButtonIcons &&
    tc.settings.customButtonIcons[action] &&
    tc.settings.customButtonIcons[action].svg;
  vscClearElement(target);
  if (custom) {
    var customWrap = vscCreateSvgWrap(
      target.ownerDocument || document,
      custom,
      "vsc-btn-icon"
    );
    if (customWrap) {
      target.appendChild(customWrap);
      return;
    }
  }
  if (typeof vscIconSvgString !== "function") {
    target.textContent = isEnabled ? "✓" : "×";
    return;
  }
  var svg = vscIconSvgString(action, 14);
  if (!svg) {
    target.textContent = isEnabled ? "✓" : "×";
    return;
  }
  var wrap = vscCreateSvgWrap(target.ownerDocument || document, svg, "vsc-btn-icon");
  if (wrap) {
    target.appendChild(wrap);
    return;
  }
  target.textContent = isEnabled ? "✓" : "×";
}

function updateSubtitleNudgeIndicator(video) {
  if (!video || !video.vsc) return;

  var isAvailable = isSubtitleNudgeAvailableForVideo(video);
  var isEnabled = isSubtitleNudgeEnabledForVideo(video);
  var title = !isAvailable
    ? "Subtitle nudge unavailable on this site"
    : isEnabled
      ? "Subtitle nudge enabled"
      : "Subtitle nudge disabled";

  var indicator = video.vsc.subtitleNudgeIndicator;
  if (indicator) {
    renderSubtitleNudgeIndicatorContent(indicator, isEnabled);
    indicator.dataset.enabled = isEnabled ? "true" : "false";
    indicator.dataset.supported = isAvailable ? "true" : "false";
    indicator.title = title;
    indicator.setAttribute("aria-label", title);
  }

  var flashEl = video.vsc.nudgeFlashIndicator;
  if (flashEl) {
    renderSubtitleNudgeIndicatorContent(flashEl, isEnabled);
    flashEl.dataset.enabled = isEnabled ? "true" : "false";
    flashEl.dataset.supported = isAvailable ? "true" : "false";
    flashEl.setAttribute("aria-label", title);
  }
}

function flushPendingLastSpeed() {
  tc.pendingLastSpeedSave = null;
  if (tc.lastSpeedWriteInFlight) return;

  var speedToPersist = tc.pendingLastSpeedValue;
  tc.pendingLastSpeedValue = null;

  if (!isValidSpeed(speedToPersist) || tc.persistedLastSpeed === speedToPersist) {
    return;
  }

  tc.lastSpeedWriteInFlight = true;
  tc.lastSpeedWriteValue = speedToPersist;
  chrome.storage.sync.set({ lastSpeed: speedToPersist }, function() {
    tc.lastSpeedWriteInFlight = false;
    tc.lastSpeedWriteValue = null;
    var retryDelay = 250;
    if (chrome.runtime.lastError) {
      if (tc.lastSpeedSaveRetries < 3) {
        tc.lastSpeedSaveRetries += 1;
        if (!isValidSpeed(tc.pendingLastSpeedValue)) {
          tc.pendingLastSpeedValue = speedToPersist;
        }
        retryDelay = 500 * tc.lastSpeedSaveRetries;
      }
    } else {
      tc.lastSpeedSaveRetries = 0;
      tc.persistedLastSpeed = speedToPersist;
    }

    if (
      isValidSpeed(tc.pendingLastSpeedValue) &&
      tc.pendingLastSpeedValue !== tc.persistedLastSpeed &&
      tc.pendingLastSpeedSave === null
    ) {
      tc.pendingLastSpeedSave = setTimeout(
        flushPendingLastSpeed,
        retryDelay
      );
    } else if (tc.pendingLastSpeedValue === tc.persistedLastSpeed) {
      tc.pendingLastSpeedValue = null;
    }
  });
}

function schedulePersistLastSpeed(speed) {
  if (!isValidSpeed(speed)) return;

  tc.pendingLastSpeedValue = speed;
  if (tc.pendingLastSpeedSave !== null || tc.lastSpeedWriteInFlight) return;
  tc.pendingLastSpeedSave = setTimeout(flushPendingLastSpeed, 250);
}

var MAX_PERSISTED_SOURCE_SPEEDS = 200;

function isPersistableSourceKey(sourceKey) {
  return Boolean(
    sourceKey &&
      sourceKey !== "unknown_src" &&
      sourceKey.indexOf("src_object:") !== 0 &&
      sourceKey.indexOf("blob:") !== 0 &&
      sourceKey.length <= 2048
  );
}

function buildRememberedSpeedsPayload() {
  var entries = Object.keys(tc.settings.speeds)
    .filter(function(sourceKey) {
      return (
        isPersistableSourceKey(sourceKey) &&
        isValidSpeed(Number(tc.settings.speeds[sourceKey]))
      );
    })
    .map(function(sourceKey) {
      return {
        sourceKey: sourceKey,
        speed: Number(tc.settings.speeds[sourceKey]),
        updatedAt: Number(tc.speedAccessTimes[sourceKey]) || 0
      };
    })
    .sort(function(a, b) {
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, MAX_PERSISTED_SOURCE_SPEEDS);

  var payload = {};
  entries.forEach(function(entry) {
    payload[entry.sourceKey] = {
      speed: entry.speed,
      updatedAt: entry.updatedAt
    };
  });
  return payload;
}

function reconcileRememberedSpeedsAfterStaleWrite() {
  var repairEpoch = tc.rememberedSpeedsWriteEpoch;
  chrome.storage.local.get({ rememberedSpeeds: {} }, function(localStorage) {
    if (
      chrome.runtime.lastError ||
      repairEpoch !== tc.rememberedSpeedsWriteEpoch
    ) {
      return;
    }
    mergeRememberedSpeeds(localStorage && localStorage.rememberedSpeeds);
    var repairedPayload = buildRememberedSpeedsPayload();
    chrome.storage.local.set({ rememberedSpeeds: repairedPayload });
  });
}

function schedulePersistRememberedSpeeds(forceSave) {
  if (!tc.settings.rememberSpeed && forceSave !== true) return;
  if (tc.pendingRememberedSpeedsSave !== null) return;
  if (tc.rememberedSpeedsWriteInFlight) {
    tc.pendingRememberedSpeedsSave = setTimeout(function() {
      tc.pendingRememberedSpeedsSave = null;
      schedulePersistRememberedSpeeds(true);
    }, 100);
    return;
  }

  tc.pendingRememberedSpeedsSave = setTimeout(function() {
    tc.pendingRememberedSpeedsSave = null;
    var currentPayload = buildRememberedSpeedsPayload();
    var writeEpoch = tc.rememberedSpeedsWriteEpoch;
    tc.rememberedSpeedsWriteInFlight = {
      epoch: writeEpoch,
      payload: null
    };

    // Merge at write time so independent frame content scripts do not erase
    // each other's more recent source entries.
    chrome.storage.local.get({ rememberedSpeeds: {} }, function(localStorage) {
      if (writeEpoch !== tc.rememberedSpeedsWriteEpoch) {
        tc.rememberedSpeedsWriteInFlight = null;
        return;
      }
      if (chrome.runtime.lastError) {
        tc.rememberedSpeedsWriteInFlight = null;
        if (tc.rememberedSpeedsSaveRetries < 3) {
          tc.rememberedSpeedsSaveRetries += 1;
          schedulePersistRememberedSpeeds(true);
        }
        return;
      }
      var merged = {};
      var existing =
        localStorage &&
        localStorage.rememberedSpeeds &&
        typeof localStorage.rememberedSpeeds === "object"
          ? localStorage.rememberedSpeeds
          : {};

      [existing, currentPayload].forEach(function(sourceMap) {
        Object.keys(sourceMap).forEach(function(sourceKey) {
          var entry = sourceMap[sourceKey];
          if (
            !isPersistableSourceKey(sourceKey) ||
            !entry ||
            !isValidSpeed(Number(entry.speed)) ||
            (tc.rememberedSpeedsResetAt > 0 &&
              (Number(entry.updatedAt) || 0) <= tc.rememberedSpeedsResetAt)
          ) {
            return;
          }
          var previous = merged[sourceKey];
          if (
            !previous ||
            Number(entry.updatedAt) >= Number(previous.updatedAt)
          ) {
            merged[sourceKey] = {
              speed: Number(entry.speed),
              updatedAt: Number(entry.updatedAt) || 0
            };
          }
        });
      });

      var pruned = {};
      Object.keys(merged)
        .sort(function(a, b) {
          return merged[b].updatedAt - merged[a].updatedAt;
        })
        .slice(0, MAX_PERSISTED_SOURCE_SPEEDS)
        .forEach(function(sourceKey) {
          pruned[sourceKey] = merged[sourceKey];
        });
      tc.rememberedSpeedsWriteInFlight.payload = pruned;
      chrome.storage.local.set({ rememberedSpeeds: pruned }, function() {
        var writeBecameStale =
          writeEpoch !== tc.rememberedSpeedsWriteEpoch;
        tc.rememberedSpeedsWriteInFlight = null;
        if (writeBecameStale) {
          reconcileRememberedSpeedsAfterStaleWrite();
          return;
        }
        if (chrome.runtime.lastError) {
          if (tc.rememberedSpeedsSaveRetries < 3) {
            tc.rememberedSpeedsSaveRetries += 1;
            schedulePersistRememberedSpeeds(true);
          }
          return;
        }
        tc.rememberedSpeedsSaveRetries = 0;
      });
    });
  }, 500);
}

function rememberSourceSpeed(video, speed) {
  if (!tc.settings.rememberSpeed || !isValidSpeed(speed)) return;
  var sourceKey = getVideoSourceKey(video);
  if (sourceKey === "unknown_src") return;
  tc.settings.speeds[sourceKey] = Number(speed);
  tc.speedAccessTimes[sourceKey] = Math.max(
    Date.now(),
    tc.rememberedSpeedsResetAt + 1
  );
  if (isPersistableSourceKey(sourceKey)) {
    schedulePersistRememberedSpeeds();
  }
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

function applySourceTransitionPolicy(video, forceUpdate) {
  if (!video || !video.vsc) return;

  // A same-document navigation can change the applicable playback rule before
  // or after the player swaps its source. Always resolve the URL first.
  if (!reapplySiteRulesAndControllerGeometry()) return;
  if (!video.vsc) return;

  var sourceKey = getVideoSourceKey(video);
  if (!forceUpdate && video.vsc.mediaSourceKey === sourceKey) return;

  video.vsc.mediaSourceKey = sourceKey;

  var rememberedSpeed = getRememberedSpeed(video);
  var desiredSpeed = isValidSpeed(rememberedSpeed) ? rememberedSpeed : 1.0;

  video.vsc.targetSpeed = desiredSpeed;
  video.vsc.targetSpeedSourceKey = sourceKey;
  video.vsc.targetSpeedOrigin = isValidSpeed(rememberedSpeed)
    ? "policy"
    : "source-reset";
  if (video.vsc.speedIndicator) {
    video.vsc.speedIndicator.textContent = desiredSpeed.toFixed(2);
  }

  if (isValidSpeed(rememberedSpeed)) {
    extendSpeedRestoreWindow(video);
  }
  if (Math.abs(video.playbackRate - desiredSpeed) > 0.01) {
    setSpeed(video, desiredSpeed, false, false);
  }
}

function extendSpeedRestoreWindow(video, duration) {
  if (!video || !video.vsc) return;

  var restoreDuration = Number(duration) || 1500;
  var restoreUntil = Date.now() + restoreDuration;
  var currentUntil = Number(video.vsc.speedRestoreUntil) || 0;

  video.vsc.speedRestoreUntil = Math.max(currentUntil, restoreUntil);
}

function clearAllSpeedRestoreEnforcement() {
  tc.mediaElements.slice().forEach(function(video) {
    if (!video || !video.vsc) return;
    video.vsc.speedRestoreUntil = 0;
    if (video.vsc.restoreSpeedTimer) {
      clearTimeout(video.vsc.restoreSpeedTimer);
      video.vsc.restoreSpeedTimer = null;
    }
    clearSpeedVerification(video.vsc);
    if (video.vsc.targetSpeedOrigin === "policy") {
      video.vsc.targetSpeed = null;
      video.vsc.targetSpeedSourceKey = null;
      video.vsc.targetSpeedOrigin = null;
      video.vsc.stopSubtitleNudge();
    }
  });
}

function clearSpeedVerification(controller) {
  if (!controller) return;
  if (controller.speedVerificationTimer) {
    clearTimeout(controller.speedVerificationTimer);
  }
  controller.speedVerificationTimer = null;
  controller.speedVerificationTarget = null;
  controller.speedVerificationAttempts = 0;
}

function scheduleSpeedVerification(video, desiredSpeed, resetAttempts) {
  if (!video || !video.vsc || !isValidSpeed(desiredSpeed)) return;
  var controller = video.vsc;
  if (
    resetAttempts === true ||
    controller.speedVerificationTarget !== desiredSpeed
  ) {
    controller.speedVerificationAttempts = 0;
  }
  controller.speedVerificationTarget = desiredSpeed;
  if (controller.speedVerificationTimer) {
    clearTimeout(controller.speedVerificationTimer);
  }

  controller.speedVerificationTimer = setTimeout(function verifySpeed() {
    if (!video.vsc || video.vsc !== controller) return;
    controller.speedVerificationTimer = null;
    var actualSpeed;
    try {
      actualSpeed = Number(video.playbackRate);
    } catch (error) {
      actualSpeed = NaN;
    }
    if (isValidSpeed(actualSpeed) && Math.abs(actualSpeed - desiredSpeed) <= 0.01) {
      clearSpeedVerification(controller);
      return;
    }

    var restoreIsActive =
      Number(controller.speedRestoreUntil) > Date.now();
    var policyIsActive =
      tc.settings.forceLastSavedSpeed ||
      (tc.settings.rememberSpeed && controller.targetSpeedOrigin === "policy");
    if (
      (!restoreIsActive && !policyIsActive) ||
      controller.speedVerificationAttempts >= 3
    ) {
      clearSpeedVerification(controller);
      log(
        `Player rejected playbackRate ${desiredSpeed.toFixed(2)} after verification`,
        3
      );
      return;
    }

    controller.speedVerificationAttempts += 1;
    rememberPendingRateChange(video, desiredSpeed, false);
    try {
      video.playbackRate = desiredSpeed;
    } catch (error) {
      controller.pendingRateChange = null;
      log(`Playback speed verification failed: ${error.message}`, 3);
    }
    scheduleSpeedVerification(video, desiredSpeed, false);
  }, 125 * (Number(controller.speedVerificationAttempts) + 1));
}

function scheduleSpeedRestore(video, desiredSpeed, reason) {
  if (!video || !video.vsc || !isValidSpeed(desiredSpeed)) return;

  if (video.vsc.restoreSpeedTimer) {
    clearTimeout(video.vsc.restoreSpeedTimer);
  }

  video.vsc.restoreSpeedTimer = setTimeout(function() {
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

function rememberPendingRateChange(video, speed, shouldPersist) {
  if (!video || !video.vsc || !isValidSpeed(speed)) return;

  video.vsc.pendingRateChange = {
    speed: Number(speed),
    shouldPersist: shouldPersist === true,
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
  return Boolean(
    binding &&
    binding.disabled !== true &&
    typeof binding.code === "string" &&
    binding.code.length > 0 &&
    binding.code === event.code &&
    (binding.shiftKey === true) === event.shiftKey
  );
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

function hasInteractivePlayerChrome(node) {
  if (!node || node.nodeName !== "VIDEO") return false;
  if (node.controls === true) return true;

  if (typeof node.closest === "function") {
    var knownPlayer = node.closest(
      ".html5-video-player, .video-js, .jwplayer, .plyr, " +
        "[class~='video-player'], [data-testid*='video-player'], " +
        "media-player, amp-video"
    );
    if (knownPlayer) return true;
  }

  var ancestor = node.parentElement;
  var videoRect = node.getBoundingClientRect();
  var depth = 0;
  while (ancestor && depth < 4) {
    var ancestorRect = ancestor.getBoundingClientRect();
    if (
      videoRect.width > 0 &&
      videoRect.height > 0 &&
      (ancestorRect.width > Math.max(videoRect.width * 1.75, videoRect.width + 160) ||
        ancestorRect.height > Math.max(videoRect.height * 1.75, videoRect.height + 160))
    ) {
      break;
    }
    if (
      (videoRect.width <= 0 || videoRect.height <= 0) &&
      depth > 1
    ) {
      break;
    }
    try {
      var controls = ancestor.querySelectorAll(
        "button, [role='button'], input[type='range'], [role='slider']"
      );
      for (var i = 0; i < Math.min(controls.length, 40); i += 1) {
        var control = controls[i];
        var description = [
          control.getAttribute("aria-label"),
          control.getAttribute("title"),
          control.getAttribute("data-title-no-tooltip"),
          control.className
        ]
          .filter(Boolean)
          .join(" ");
        if (
          /(^|\b)(play|pause|mute|volume|seek|captions?|subtitles?|fullscreen|full screen)(\b|$)/i.test(
            description
          )
        ) {
          return true;
        }
      }
    } catch (_error) {}
    ancestor = ancestor.parentElement;
    depth += 1;
  }

  return false;
}

function isAmbientLoopMedia(node) {
  var hasAmbientSignature = Boolean(
    node &&
      node.nodeName === "VIDEO" &&
      node.autoplay === true &&
      (node.muted === true || node.defaultMuted === true) &&
      node.loop === true &&
      node.playsInline === true &&
      node.controls !== true
  );
  if (!hasAmbientSignature || tc.settings.showAmbientLoopControls) return false;
  return !hasInteractivePlayerChrome(node);
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
    return Array.from(node.querySelectorAll("source[src]")).some(function(
      source
    ) {
      var src = source.getAttribute("src");
      return typeof src === "string" && src.trim().length > 0;
    });
  }

  return false;
}

function getControllerStructureSignature() {
  return JSON.stringify({
    buttons: Array.isArray(tc.settings.controllerButtons)
      ? tc.settings.controllerButtons
      : [],
    startHidden: tc.settings.startHidden === true
  });
}

function ensureController(node, parent) {
  if (!tc.runtimeSettingsHydrated) {
    if (
      node &&
      (node.nodeName === "VIDEO" || node.nodeName === "AUDIO") &&
      !tc.pendingMediaCandidates.some(function(candidate) {
        return candidate.node === node;
      })
    ) {
      tc.pendingMediaCandidates.push({ node: node, parent: parent });
    }
    return null;
  }
  if (!isMediaElement(node)) return null;
  if (typeof tc.videoController === "undefined") defineVideoController();

  // href selects site rules; re-run on every new/usable media so all runtime
  // paths agree on activation and effective settings.
  applySiteRuleOverrides();
  if (!siteRuleUtils.isSpeederActiveForSite(tc.settings.enabled, tc.activeSiteRule)) {
    if (node.vsc) removeController(node);
    return null;
  }
  if (isAmbientLoopMedia(node)) {
    if (node.vsc) removeController(node);
    return null;
  }

  if (
    node.vsc &&
    (
      !node.vsc.div ||
      typeof node.vsc.remove !== "function" ||
      node.vsc.structureSignature !== getControllerStructureSignature()
    )
  ) {
    removeController(node);
  }

  if (node.vsc) {
    var existingController = node.vsc;
    var hasSource = hasUsableMediaSource(node);
    if (existingController.div) {
      existingController.div.classList.toggle("vsc-nosource", !hasSource);
    }

    var fullscreenElement = getFullscreenElement(node.ownerDocument);
    var normalMount = getControllerMount(node) || parent || node.parentNode;
    if (normalMount) existingController.normalControllerMount = normalMount;
    if (
      fullscreenElement &&
      (fullscreenElement === node ||
        isComposedDescendant(node, fullscreenElement))
    ) {
      syncControllerFullscreenMount(existingController);
    } else if (normalMount) {
      remountControllerHost(existingController, normalMount);
    }

    if (hasSource) {
      applySourceTransitionPolicy(node, false);
    }
    return existingController;
  }

  if (!hasUsableMediaSource(node)) {
    log(
      `Deferring controller creation for ${node.tagName}: no usable source yet`,
      5
    );
    return null;
  }

  refreshAllControllerGeometry();

  log(
    `Creating controller for ${node.tagName}: ${node.src || node.currentSrc || "no src"}`,
    4
  );
  try {
    node.vsc = new tc.videoController(
      node,
      parent || node.parentElement || node.parentNode
    );
  } catch (error) {
    log(`Unable to create media controller: ${error.message}`, 2);
    removeController(node);
    return null;
  }
  if (!node.vsc || !node.vsc.div) {
    log("Controller initialization returned without a control host", 3);
    removeController(node);
    return null;
  }
  if (
    node.vsc &&
    (tc.settings.rememberSpeed || tc.settings.forceLastSavedSpeed)
  ) {
    scheduleSpeedVerification(node, node.vsc.targetSpeed, true);
  }
  if (node.vsc) syncControllerFullscreenMount(node.vsc);
  return node.vsc;
}

function flushPendingMediaCandidates() {
  var pending = tc.pendingMediaCandidates.splice(0);
  pending.forEach(function(candidate) {
    if (!candidate.node || !candidate.node.isConnected) return;
    ensureController(
      candidate.node,
      candidate.node.parentElement || candidate.parent || candidate.node.parentNode
    );
  });
}

function ensureControllerForMediaChild(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
  if (node.nodeName !== "SOURCE") return null;

  var media = node.parentElement;
  if (!isMediaElement(media)) return null;
  return ensureController(media, media.parentElement || media.parentNode);
}

function removeController(node) {
  if (!node || !node.vsc) return;
  var controller = node.vsc;
  if (typeof controller.remove === "function") {
    try {
      controller.remove();
      return;
    } catch (error) {
      log(`Partial controller cleanup failed: ${error.message}`, 3);
    }
  }
  if (controller.div && typeof controller.div.remove === "function") {
    controller.div.remove();
  }
  var index = tc.mediaElements.indexOf(node);
  if (index !== -1) tc.mediaElements.splice(index, 1);
  delete node.vsc;
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
  } else if (node.nodeName === "SOURCE") {
    // Players such as Vidstack often connect an empty <video> and append its
    // <source> later. Retry the owning video when that source becomes usable.
    var owningMedia = isMediaElement(parent)
      ? parent
      : node.parentElement;
    if (owningMedia) {
      ensureController(owningMedia, owningMedia.parentNode);
    } else if (added) {
      ensureControllerForMediaChild(node);
    }
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
  // Always scan shadow roots so we can find nested shadow roots or media.
  if (root.host || (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot)) return true;
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
}

function rescanOpenShadowRoots(root, visited, rescanObserved) {
  var scanRoot = getScanNodeForRoot(root);
  if (!scanRoot || typeof scanRoot.querySelectorAll !== "function") return;
  var seen = visited || new WeakSet();
  var hosts = [];

  if (scanRoot.nodeType === Node.ELEMENT_NODE && scanRoot.shadowRoot) {
    hosts.push(scanRoot);
  }
  try {
    var elements = scanRoot.querySelectorAll("*");
    for (var i = 0; i < elements.length; i++) {
      if (elements[i].shadowRoot) hosts.push(elements[i]);
    }
  } catch (_error) {
    return;
  }

  hosts.forEach(function(host) {
    var shadowRoot = host.shadowRoot;
    if (!shadowRoot || seen.has(shadowRoot)) return;
    seen.add(shadowRoot);
    if (rescanObserved !== false || !vscObservedRoots.has(shadowRoot)) {
      observeRoot(shadowRoot);
    }
    rescanOpenShadowRoots(shadowRoot, seen, rescanObserved);
  });
}

function rescanObservedMediaRoots(doc) {
  var retainedRoots = [];
  vscObservedRootList.forEach(function(root) {
    if (!root || root.nodeType === Node.DOCUMENT_NODE) return;
    var connected = Boolean(root.host ? root.host.isConnected : root.isConnected);
    if (!connected) return;
    retainedRoots.push(root);
    if (
      !doc ||
      root.ownerDocument === doc ||
      (root.host && root.host.ownerDocument === doc)
    ) {
      scanRootForMedia(root);
    }
  });
  vscObservedRootList = retainedRoots;
}

function observeRoot(root) {
  if (!root) return;

  var isConnected = false;
  try {
    isConnected = root.nodeType === Node.DOCUMENT_NODE ||
                  root.isConnected ||
                  (root.host && (root.host.isConnected || (root.host.ownerDocument && root.host.ownerDocument.contains(root.host)))) ||
                  (root.ownerDocument && root.ownerDocument.contains(root));
  } catch (e) {
    isConnected = true;
  }

  if (!vscObservedRoots.has(root)) {
    vscObservedRoots.add(root);
    vscObservedRootList.push(root);
    setupListener(root);
    attachMutationObserver(root);
    attachMediaDetectionListeners(root);
  }

  if (
    isConnected &&
    (!vscConnectedScannedRoots.has(root) || isShadowRootNode(root))
  ) {
    vscConnectedScannedRoots.add(root);
    if (rootMayContainMedia(root)) {
      scanRootForMedia(root);
    }
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
  Element.prototype.attachShadow = function() {
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

function installPageShadowBridge() {
  if (window.vscPageShadowBridgeRequested) return;

  if (!window.vscPageBridgeListenersAttached) {
    window.vscPageBridgeListenersAttached = true;
    document.addEventListener(
      "speeder-shadow-root-attached",
      function(event) {
        var host = event.target;
        if (!host || !host.shadowRoot) return;
        try {
          observeRoot(host.shadowRoot);
        } catch (error) {
          log(`Unable to observe page-created shadow root: ${error.message}`, 3);
        }
      },
      true
    );
    document.addEventListener(
      "speeder-location-changed",
      function() {
        scheduleNavigationRescan();
      },
      true
    );
  }

  function startBoundedShadowFallback() {
    if (window.vscBoundedShadowFallbackStarted) return;
    window.vscBoundedShadowFallbackStarted = true;
    window.vscBoundedShadowFallbackTimers = [3000, 10000, 30000].map(
      function(delay) {
        return setTimeout(function() {
          requestIdle(
            function() {
              if (
                !document.body ||
                (delay !== 3000 && window.vscPageShadowBridgeLoaded)
              ) {
                return;
              }
              rescanOpenShadowRoots(document, undefined, false);
            },
            { timeout: 2000 }
          );
        }, delay);
      }
    );
  }

  function handleBridgeFailure() {
    window.vscPageShadowBridgeRequested = false;
    window.vscPageShadowBridgeRetries =
      (Number(window.vscPageShadowBridgeRetries) || 0) + 1;
    startBoundedShadowFallback();
    if (window.vscPageShadowBridgeRetries > 3) return;
    clearTimeout(window.vscPageShadowBridgeRetryTimer);
    window.vscPageShadowBridgeRetryTimer = setTimeout(function() {
      installPageShadowBridge();
    }, 250 * window.vscPageShadowBridgeRetries);
  }

  var parent = document.documentElement || document.head;
  if (!parent) {
    if (!window.vscPageShadowBridgeRetryAttached) {
      window.vscPageShadowBridgeRetryAttached = true;
      var retryBridgeInstall = function() {
        if (document.documentElement || document.head) {
          document.removeEventListener("readystatechange", retryBridgeInstall);
          document.removeEventListener("DOMContentLoaded", retryBridgeInstall);
          installPageShadowBridge();
        }
      };
      document.addEventListener("readystatechange", retryBridgeInstall);
      document.addEventListener("DOMContentLoaded", retryBridgeInstall);
    }
    return;
  }
  try {
    var bridge = document.createElement("script");
    bridge.src = chrome.runtime.getURL("content/shadow-bridge.js");
    bridge.async = false;
    bridge.addEventListener("load", function() {
      bridge.remove();
      window.vscPageShadowBridgeLoaded = true;
      window.vscPageShadowBridgeRetries = 0;
      clearTimeout(window.vscPageShadowBridgeRetryTimer);
    });
    bridge.addEventListener("error", function() {
      bridge.remove();
      handleBridgeFailure();
    });
    window.vscPageShadowBridgeRequested = true;
    parent.appendChild(bridge);
    // The bridge reports future roots, but cannot report roots that existed
    // before the extension loaded. Keep one bounded initial discovery pass.
    startBoundedShadowFallback();
  } catch (error) {
    handleBridgeFailure();
    log(`Unable to install page shadow bridge: ${error.message}`, 3);
  }
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

function hydrateRuntimeSettings(rawStorage, options) {
  var config = options || {};
  var storage =
    typeof vscExpandStoredSettings === "function"
      ? vscExpandStoredSettings(rawStorage || {})
      : Object.assign({}, tc.settings, rawStorage || {});
  var storedBindings = Array.isArray(storage.keyBindings)
    ? storage.keyBindings
    : [];

  tc.settings.keyBindings = storedBindings
    .map(function(binding) {
      return normalizeStoredBinding(binding);
    })
    .filter(Boolean);

  if (tc.settings.keyBindings.length === 0) {
    tc.settings.keyBindings = defaultKeyBindings(storage);
  }

  var unsavedLastSpeed = isValidSpeed(tc.pendingLastSpeedValue)
    ? Number(tc.pendingLastSpeedValue)
    : tc.lastSpeedWriteInFlight && isValidSpeed(tc.lastSpeedWriteValue)
      ? Number(tc.lastSpeedWriteValue)
      : null;
  var hasPendingLastSpeed = Boolean(
    config.preservePendingLastSpeed && isValidSpeed(unsavedLastSpeed)
  );
  var storedLastSpeed = Number(storage.lastSpeed);
  var nextLastSpeed = hasPendingLastSpeed
    ? unsavedLastSpeed
    : storedLastSpeed;

  if (!isValidSpeed(nextLastSpeed)) {
    log(`Invalid lastSpeed detected: ${storage.lastSpeed}, resetting to 1.0`, 3);
    nextLastSpeed = 1.0;
    if (!hasPendingLastSpeed) {
      chrome.storage.sync.set({ lastSpeed: 1.0 });
    }
  }
  tc.settings.lastSpeed = nextLastSpeed;
  if (isValidSpeed(storedLastSpeed)) {
    tc.persistedLastSpeed = storedLastSpeed;
  } else if (!hasPendingLastSpeed) {
    tc.persistedLastSpeed = nextLastSpeed;
  }

  tc.settings.rememberSpeed = storage.rememberSpeed === true;
  tc.settings.forceLastSavedSpeed = storage.forceLastSavedSpeed === true;
  tc.settings.audioBoolean = storage.audioBoolean === true;
  tc.settings.showAmbientLoopControls =
    storage.showAmbientLoopControls === true;
  tc.settings.enabled = storage.enabled !== false;
  tc.settings.startHidden = storage.startHidden === true;
  tc.settings.hideWithControls =
    typeof storage.hideWithControls !== "undefined"
      ? Boolean(storage.hideWithControls)
      : Boolean(storage.hideWithYouTubeControls);
  tc.settings.hideWithControlsTimer = Math.min(
    15,
    Math.max(0.1, Number(storage.hideWithControlsTimer) || 2.0)
  );
  tc.settings.hideWithYouTubeControls = tc.settings.hideWithControls;
  tc.settings.controllerLocation = normalizeControllerLocation(
    storage.controllerLocation
  );
  tc.settings.controllerOpacity = Number(storage.controllerOpacity);
  if (!Number.isFinite(tc.settings.controllerOpacity)) {
    tc.settings.controllerOpacity = getSharedDefault("controllerOpacity", 0.3);
  }
  tc.settings.controllerMarginTop = normalizeControllerMarginPx(
    storage.controllerMarginTop,
    getSharedDefault("controllerMarginTop", 0)
  );
  tc.settings.controllerMarginRight = normalizeControllerMarginPx(
    storage.controllerMarginRight,
    getSharedDefault("controllerMarginRight", 0)
  );
  tc.settings.controllerMarginBottom = normalizeControllerMarginPx(
    storage.controllerMarginBottom,
    getSharedDefault("controllerMarginBottom", 65)
  );
  tc.settings.controllerMarginLeft = normalizeControllerMarginPx(
    storage.controllerMarginLeft,
    getSharedDefault("controllerMarginLeft", 0)
  );
  tc.settings.shortcutTargetMode =
    storage.shortcutTargetMode === "all" ? "all" : "closest";
  tc.settings.siteRules = Array.isArray(storage.siteRules)
    ? storage.siteRules.map(function(rule) {
      return rule && typeof rule === "object" ? Object.assign({}, rule) : rule;
    })
    : getSharedDefault("siteRules", []);
  tc.settings.controllerButtons = Array.isArray(storage.controllerButtons)
    ? storage.controllerButtons.slice()
    : getSharedDefault("controllerButtons", [
      "rewind",
      "slower",
      "faster",
      "advance",
      "display"
    ]);
  tc.settings.enableSubtitleNudge = Boolean(storage.enableSubtitleNudge);
  tc.settings.subtitleNudgeEnabledByDefault =
    typeof storage.subtitleNudgeEnabledByDefault !== "undefined"
      ? Boolean(storage.subtitleNudgeEnabledByDefault)
      : getSharedDefault("subtitleNudgeEnabledByDefault", true);
  tc.settings.subtitleNudgeInterval = Math.min(
    1000,
    Math.max(250, Number(storage.subtitleNudgeInterval) || 250)
  );
  tc.settings.subtitleNudgeAmount =
    Number(storage.subtitleNudgeAmount) ||
    getSharedDefault("subtitleNudgeAmount", 0.001);

  var addedDefaultBinding = false;
  addedDefaultBinding =
    ensureDefaultKeyBinding("display", "KeyV", 0) || addedDefaultBinding;
  addedDefaultBinding =
    ensureDefaultKeyBinding("move", "KeyP", 0) || addedDefaultBinding;
  addedDefaultBinding =
    ensureDefaultKeyBinding("toggleSubtitleNudge", "KeyN", 0) ||
    addedDefaultBinding;

  if (addedDefaultBinding && config.persistMissingBindings !== false) {
    chrome.storage.sync.set({ keyBindings: tc.settings.keyBindings });
  }

  // Capture only freshly hydrated global values. Calling this while a current
  // route's overrides are still applied would promote those overrides into the
  // global base and leak them into the next SPA route.
  captureSiteRuleBase();
  return storage;
}

function replaceRememberedSpeeds(rememberedSpeeds) {
  Object.keys(tc.settings.speeds).forEach(function(sourceKey) {
    if (isPersistableSourceKey(sourceKey)) {
      delete tc.settings.speeds[sourceKey];
      delete tc.speedAccessTimes[sourceKey];
    }
  });

  var sourceMap =
    rememberedSpeeds && typeof rememberedSpeeds === "object"
      ? rememberedSpeeds
      : {};
  Object.keys(sourceMap).forEach(function(sourceKey) {
    var storedEntry = sourceMap[sourceKey];
    var storedSpeed =
      storedEntry && typeof storedEntry === "object"
        ? Number(storedEntry.speed)
        : Number(storedEntry);
    var storedUpdatedAt =
      storedEntry && typeof storedEntry === "object"
        ? Number(storedEntry.updatedAt) || 0
        : 0;
    if (
      !isPersistableSourceKey(sourceKey) ||
      !isValidSpeed(storedSpeed) ||
      (tc.rememberedSpeedsResetAt > 0 &&
        storedUpdatedAt <= tc.rememberedSpeedsResetAt)
    ) {
      return;
    }
    tc.settings.speeds[sourceKey] = storedSpeed;
    tc.speedAccessTimes[sourceKey] = storedUpdatedAt;
  });
}

function mergeRememberedSpeeds(rememberedSpeeds) {
  var sourceMap =
    rememberedSpeeds && typeof rememberedSpeeds === "object"
      ? rememberedSpeeds
      : {};
  Object.keys(sourceMap).forEach(function(sourceKey) {
    var storedEntry = sourceMap[sourceKey];
    var storedSpeed =
      storedEntry && typeof storedEntry === "object"
        ? Number(storedEntry.speed)
        : Number(storedEntry);
    var storedUpdatedAt =
      storedEntry && typeof storedEntry === "object"
        ? Number(storedEntry.updatedAt) || 0
        : 0;
    if (
      !isPersistableSourceKey(sourceKey) ||
      !isValidSpeed(storedSpeed) ||
      (tc.rememberedSpeedsResetAt > 0 &&
        storedUpdatedAt <= tc.rememberedSpeedsResetAt)
    ) {
      return;
    }

    var currentUpdatedAt = Number(tc.speedAccessTimes[sourceKey]) || 0;
    if (
      !isValidSpeed(Number(tc.settings.speeds[sourceKey])) ||
      storedUpdatedAt >= currentUpdatedAt
    ) {
      tc.settings.speeds[sourceKey] = storedSpeed;
      tc.speedAccessTimes[sourceKey] = storedUpdatedAt;
    }
  });
}

function rememberedSpeedsPayloadMatches(sourceMap, expectedPayload) {
  var actual = sourceMap && typeof sourceMap === "object" ? sourceMap : {};
  var expected =
    expectedPayload && typeof expectedPayload === "object"
      ? expectedPayload
      : {};
  var actualKeys = Object.keys(actual).filter(function(sourceKey) {
    return isPersistableSourceKey(sourceKey);
  });
  var expectedKeys = Object.keys(expected);
  if (actualKeys.length !== expectedKeys.length) return false;

  return expectedKeys.every(function(sourceKey) {
    var actualEntry = actual[sourceKey];
    var expectedEntry = expected[sourceKey];
    return Boolean(
      actualEntry &&
        expectedEntry &&
        Number(actualEntry.speed) === Number(expectedEntry.speed) &&
        (Number(actualEntry.updatedAt) || 0) ===
          (Number(expectedEntry.updatedAt) || 0)
    );
  });
}

function clearRememberedSpeedsInMemory(resetAt) {
  tc.rememberedSpeedsWriteEpoch += 1;
  if (tc.pendingRememberedSpeedsSave !== null) {
    clearTimeout(tc.pendingRememberedSpeedsSave);
    tc.pendingRememberedSpeedsSave = null;
  }
  tc.rememberedSpeedsSaveRetries = 0;
  var preserveAfter = Number(resetAt) || 0;
  Object.keys(tc.settings.speeds).forEach(function(sourceKey) {
    if (!isPersistableSourceKey(sourceKey)) return;
    if (
      preserveAfter > 0 &&
      (Number(tc.speedAccessTimes[sourceKey]) || 0) > preserveAfter
    ) {
      return;
    }
    delete tc.settings.speeds[sourceKey];
    delete tc.speedAccessTimes[sourceKey];
  });
}

function applyRememberedSpeedsResetMarker(value) {
  var resetAt = Number(value) || 0;
  if (resetAt <= tc.rememberedSpeedsResetAt) return false;
  tc.rememberedSpeedsResetAt = resetAt;
  clearRememberedSpeedsInMemory(resetAt);
  return true;
}

function applyCustomButtonIcons(customButtonIcons) {
  tc.settings.customButtonIcons =
    customButtonIcons && typeof customButtonIcons === "object"
      ? customButtonIcons
      : {};
  if (!tc.mediaElements || !tc.mediaElements.length) return;

  tc.mediaElements.forEach(function(video) {
    if (!video.vsc || !video.vsc.div) return;
    var doc = video.ownerDocument;
    var shadow = video.vsc.div.shadowRoot;
    if (!shadow) return;
    shadow.querySelectorAll("button[data-action]").forEach(function(btn) {
      var act = btn.dataset.action;
      if (!act) return;
      var svg =
        tc.settings.customButtonIcons &&
        tc.settings.customButtonIcons[act] &&
        tc.settings.customButtonIcons[act].svg;
      vscClearElement(btn);
      if (svg) {
        var customWrap = vscCreateSvgWrap(doc, svg, "vsc-btn-icon");
        if (customWrap) {
          btn.appendChild(customWrap);
        } else {
          var customDef = controllerButtonDefs[act];
          btn.textContent = (customDef && customDef.label) || "?";
        }
      } else if (typeof vscIconWrap === "function") {
        var wrap = vscIconWrap(doc, act, 14);
        if (wrap) {
          btn.appendChild(wrap);
        } else {
          var defaultDef = controllerButtonDefs[act];
          btn.textContent = (defaultDef && defaultDef.label) || "?";
        }
      } else {
        var fallbackDef = controllerButtonDefs[act];
        btn.textContent = (fallbackDef && fallbackDef.label) || "?";
      }
    });
    updateSubtitleNudgeIndicator(video);
  });
}

function scheduleRuntimeSettingsReload() {
  var reloadGeneration =
    (Number(window.vscSettingsReloadGeneration) || 0) + 1;
  window.vscSettingsReloadGeneration = reloadGeneration;
  clearTimeout(window.vscSettingsReloadTimer);
  clearTimeout(window.vscSettingsReloadRetryTimer);
  window.vscSettingsReloadTimer = setTimeout(function() {
    chrome.storage.sync.get(null, function(rawStorage) {
      if (reloadGeneration !== window.vscSettingsReloadGeneration) return;
      if (chrome.runtime.lastError) {
        if (tc.settingsReloadRetries < 3) {
          tc.settingsReloadRetries += 1;
          window.vscSettingsReloadRetryTimer = setTimeout(function() {
            if (reloadGeneration === window.vscSettingsReloadGeneration) {
              scheduleRuntimeSettingsReload();
            }
          }, 250 * tc.settingsReloadRetries);
        }
        return;
      }
      tc.settingsReloadRetries = 0;
      var wasForceEnabled = tc.settings.forceLastSavedSpeed === true;
      var wasRememberEnabled = tc.settings.rememberSpeed === true;
      hydrateRuntimeSettings(rawStorage || {}, {
        preservePendingLastSpeed: true,
        persistMissingBindings: false
      });
      applySiteRuleOverrides();
      if (
        (wasForceEnabled && !tc.settings.forceLastSavedSpeed) ||
        (wasRememberEnabled && !tc.settings.rememberSpeed)
      ) {
        clearAllSpeedRestoreEnforcement();
      }
      initializeWhenReady(document, true);
    });
  }, 75);
}

function loadInitialLocalSettings(attempt, callback) {
  chrome.storage.local.get(
    ["customButtonIcons", "rememberedSpeeds", "rememberedSpeedsResetAt"],
    function(localStorage) {
      if (chrome.runtime.lastError && attempt < 3) {
        setTimeout(function() {
          loadInitialLocalSettings(attempt + 1, callback);
        }, 100 * (attempt + 1));
        return;
      }
      callback(chrome.runtime.lastError ? {} : localStorage || {});
    }
  );
}

// Patch attachShadow immediately — before any async operations — so we
// catch shadow roots created while chrome.storage.sync.get is pending.
// Sites like archive.org create Lit/LitElement shadow DOMs during page load;
// waiting for the storage callback would miss them entirely.
patchAttachShadow();
installPageShadowBridge();

function loadInitialRuntimeSettings(attempt) {
  chrome.storage.sync.get(null, function(rawStorage) {
  if (chrome.runtime.lastError && attempt < 3) {
    setTimeout(function() {
      loadInitialRuntimeSettings(attempt + 1);
    }, 100 * (attempt + 1));
    return;
  }
  hydrateRuntimeSettings(rawStorage || {});
  // patchAttachShadow() is now called at top-level before this callback
  // Add a listener for messages from the popup.
  // We use a global flag to ensure the listener is only attached once.
  if (!window.vscMessageListener) {
    chrome.runtime.onMessage.addListener(
      function(request, sender, sendResponse) {
        if (request.action === "rescan_page") {
          log("Re-scan command received from popup.", 4);
          initializeWhenReady(document, true);
          sendResponse({ status: "complete" });
          return false;
        }
        if (request.action === "get_speed") {
          // Do not sendResponse in frames with no media — only one response is
          // accepted tab-wide, and the top frame often wins before an iframe.
          var videoGs = getPrimaryVideoElement();
          if (!videoGs) return false;
          sendResponse({
            speed: videoGs.playbackRate,
            frameToken: tc.frameToken,
            forceLastSavedSpeed: tc.settings.forceLastSavedSpeed === true,
            forceLastSavedSpeedControlledBySiteRule: Boolean(
              tc.activeSiteRule &&
                tc.activeSiteRule.forceLastSavedSpeed !== undefined
            )
          });
          return false;
        }
        if (request.action === "get_page_context") {
          sendResponse({ url: location.href });
          return false;
        }
        if (request.action === "set_force_last_saved_speed") {
          var forceEnabled = Boolean(request.enabled);
          if (tc.siteRuleBase) {
            tc.siteRuleBase.forceLastSavedSpeed = forceEnabled;
          }
          // Site rules own the effective per-page value. The popup changes the
          // global base, then this reapplication keeps both paths consistent.
          applySiteRuleOverrides();
          var forceVideo = getPrimaryVideoElement();
          if (tc.settings.forceLastSavedSpeed) {
            tc.mediaElements.forEach(function(video) {
              if (!video || !video.vsc) return;
              setSpeed(video, tc.settings.lastSpeed, false, false);
              video.vsc.targetSpeedOrigin = "policy";
              extendSpeedRestoreWindow(video);
            });
          }
          sendResponse({
            enabled: tc.settings.forceLastSavedSpeed,
            speed: forceVideo ? forceVideo.playbackRate : null
          });
          return false;
        }
        if (request.action === "run_action") {
          if (
            request.targetFrameToken &&
            request.targetFrameToken !== tc.frameToken
          ) {
            return false;
          }
          if (
            !siteRuleUtils.isSpeederActiveForSite(
              tc.settings.enabled,
              tc.activeSiteRule
            )
          ) {
            return false;
          }
          var value = request.value;
          if (value === undefined || value === null) {
            value = getKeyBindings(request.actionName, "value");
          }
          runAction(request.actionName, value);
          var videoAfter = getPrimaryVideoElement();
          if (!videoAfter) return false;
          sendResponse({
            speed: videoAfter.playbackRate
          });
          return false;
        }
        return false;
      }
    );

    // Set the flag to prevent adding the listener again.
    window.vscMessageListener = true;
  }
  loadInitialLocalSettings(0, function(loc) {
      applyCustomButtonIcons(loc && loc.customButtonIcons);

      applyRememberedSpeedsResetMarker(
        loc && loc.rememberedSpeedsResetAt
      );
      replaceRememberedSpeeds(loc && loc.rememberedSpeeds);

    if (!window.vscCustomIconListener) {
      window.vscCustomIconListener = true;
      chrome.storage.onChanged.addListener(function(changes, area) {
        if (area === "sync") {
          var changedKeys = Object.keys(changes || {});
          var isLastSpeedOnly =
            changedKeys.length === 1 && changedKeys[0] === "lastSpeed";
          if (isLastSpeedOnly) {
            var changedLastSpeed = Number(changes.lastSpeed.newValue);
            if (isValidSpeed(changedLastSpeed)) {
              tc.persistedLastSpeed = changedLastSpeed;
              var newerLocalLastSpeed = isValidSpeed(tc.pendingLastSpeedValue)
                ? Number(tc.pendingLastSpeedValue)
                : tc.lastSpeedWriteInFlight &&
                    isValidSpeed(tc.lastSpeedWriteValue)
                  ? Number(tc.lastSpeedWriteValue)
                  : null;
              if (
                isValidSpeed(newerLocalLastSpeed) &&
                newerLocalLastSpeed !== changedLastSpeed
              ) {
                return;
              }
              tc.settings.lastSpeed = changedLastSpeed;
              if (tc.settings.forceLastSavedSpeed) {
                tc.mediaElements.slice().forEach(applyRememberedSpeedPolicy);
              }
            }
            return;
          }

          var managedKeys =
            typeof vscGetManagedSyncKeys === "function"
              ? vscGetManagedSyncKeys()
              : [
                "enabled",
                "rememberSpeed",
                "forceLastSavedSpeed",
                "siteRules"
              ];
          if (
            changedKeys.some(function(key) {
              return managedKeys.indexOf(key) !== -1;
            })
          ) {
            // Options persistence may emit a set followed by a remove. Re-read
            // the final sparse state after the burst instead of reconstructing
            // settings from partial change records.
            scheduleRuntimeSettingsReload();
          }
          return;
        }

        if (area !== "local") return;
        if (changes.rememberedSpeedsResetAt) {
          window.vscRememberedSpeedsGeneration =
            (Number(window.vscRememberedSpeedsGeneration) || 0) + 1;
          applyRememberedSpeedsResetMarker(
            changes.rememberedSpeedsResetAt.newValue
          );
        }
        if (changes.rememberedSpeeds) {
          window.vscRememberedSpeedsGeneration =
            (Number(window.vscRememberedSpeedsGeneration) || 0) + 1;
          var changedRememberedSpeeds = changes.rememberedSpeeds.newValue;
          var inFlightRememberedSpeedsWrite =
            tc.rememberedSpeedsWriteInFlight;
          if (
            inFlightRememberedSpeedsWrite &&
            inFlightRememberedSpeedsWrite.epoch !==
              tc.rememberedSpeedsWriteEpoch &&
            inFlightRememberedSpeedsWrite.payload &&
            rememberedSpeedsPayloadMatches(
              changedRememberedSpeeds,
              inFlightRememberedSpeedsWrite.payload
            )
          ) {
            return;
          }
          if (
            !changedRememberedSpeeds ||
            typeof changedRememberedSpeeds !== "object" ||
            Object.keys(changedRememberedSpeeds).length === 0
          ) {
            clearRememberedSpeedsInMemory(tc.rememberedSpeedsResetAt);
            if (Object.keys(buildRememberedSpeedsPayload()).length > 0) {
              schedulePersistRememberedSpeeds(true);
            }
          } else {
            // Merge rather than replace: another frame can write while this
            // frame still has a newer per-source speed queued. If the storage
            // snapshot is missing one of our newer entries, self-heal it with a
            // merged write instead of silently losing either frame's intent.
            mergeRememberedSpeeds(changedRememberedSpeeds);
            var expectedRememberedSpeeds = buildRememberedSpeedsPayload();
            if (
              !rememberedSpeedsPayloadMatches(
                changedRememberedSpeeds,
                expectedRememberedSpeeds
              )
            ) {
              schedulePersistRememberedSpeeds(true);
            }
          }
        }
        if (!changes.customButtonIcons) return;
        window.vscCustomIconGeneration =
          (Number(window.vscCustomIconGeneration) || 0) + 1;
        var nv = changes.customButtonIcons.newValue;
        applyCustomButtonIcons(nv);
      });
    }
      // Close the small gap between the initial sync/local reads and listener
      // registration. A final read also converges if Options saved while this
      // content script was starting.
      scheduleRuntimeSettingsReload();
      var customIconGeneration =
        Number(window.vscCustomIconGeneration) || 0;
      var rememberedSpeedsGeneration =
        Number(window.vscRememberedSpeedsGeneration) || 0;
      chrome.storage.local.get(
        ["customButtonIcons", "rememberedSpeeds", "rememberedSpeedsResetAt"],
        function(latestLocal) {
          if (chrome.runtime.lastError) return;
          if (
            customIconGeneration ===
            (Number(window.vscCustomIconGeneration) || 0)
          ) {
            applyCustomButtonIcons(latestLocal && latestLocal.customButtonIcons);
          }
          if (
            rememberedSpeedsGeneration ===
            (Number(window.vscRememberedSpeedsGeneration) || 0)
          ) {
            applyRememberedSpeedsResetMarker(
              latestLocal && latestLocal.rememberedSpeedsResetAt
            );
            mergeRememberedSpeeds(latestLocal && latestLocal.rememberedSpeeds);
            var latestRememberedSpeeds =
              latestLocal && latestLocal.rememberedSpeeds;
            if (
              !rememberedSpeedsPayloadMatches(
                latestRememberedSpeeds,
                buildRememberedSpeedsPayload()
              )
            ) {
              schedulePersistRememberedSpeeds(true);
            }
            if (tc.settings.rememberSpeed || tc.settings.forceLastSavedSpeed) {
              tc.mediaElements.slice().forEach(applyRememberedSpeedPolicy);
            }
          }
        }
      );
      tc.runtimeSettingsHydrated = true;
      initializeWhenReady(document);
    });
  });
}

// Install before async settings hydration so SPA-owned window capture handlers
// cannot hide later key events from Speeder.
attachKeydownListeners(document);
loadInitialRuntimeSettings(0);

function getKeyBindings(action, what = "value") {
  try {
    return tc.settings.keyBindings.find((item) => item.action === action)[what];
  } catch (e) {
    return false;
  }
}

function setKeyBindings(action, value) {
  var binding = tc.settings.keyBindings.find(function(item) {
    return item.action === action;
  });
  if (!binding) return false;
  binding.value = value;
  return true;
}

function createControllerButton(doc, action, label, className) {
  var button = doc.createElement("button");
  button.dataset.action = action;
  var custom =
    tc.settings.customButtonIcons &&
    tc.settings.customButtonIcons[action] &&
    tc.settings.customButtonIcons[action].svg;
  if (custom) {
    var customWrap = vscCreateSvgWrap(doc, custom, "vsc-btn-icon");
    if (customWrap) {
      button.appendChild(customWrap);
    } else {
      button.textContent = label || "?";
    }
  } else if (typeof vscIconWrap === "function") {
    var wrap = vscIconWrap(doc, action, 14);
    if (wrap) {
      button.appendChild(wrap);
    } else {
      button.textContent = label || "?";
    }
  } else {
    button.textContent = label || "?";
  }
  if (className) {
    button.className = className;
  }
  return button;
}

function createsControllerStackingContext(element) {
  if (!element || !element.ownerDocument) return false;

  var win = element.ownerDocument.defaultView || window;
  var style = win.getComputedStyle(element);
  var position = style.position;
  var zIndex = style.zIndex;
  var contain = style.contain || "";
  var willChange = style.willChange || "";

  return (
    style.isolation === "isolate" ||
    position === "fixed" ||
    position === "sticky" ||
    (position && position !== "static" && zIndex && zIndex !== "auto") ||
    (style.opacity !== "" && Number(style.opacity) < 1) ||
    (style.transform && style.transform !== "none") ||
    (style.filter && style.filter !== "none") ||
    (style.perspective && style.perspective !== "none") ||
    contain.indexOf("paint") !== -1 ||
    contain.indexOf("layout") !== -1 ||
    willChange.indexOf("transform") !== -1 ||
    willChange.indexOf("opacity") !== -1
  );
}

function getSharedOverlayMount(mount, videoRect) {
  if (!mount || !mount.parentElement || !videoRect) return null;
  if (videoRect.width <= 0 || videoRect.height <= 0) return null;

  var parent = mount.parentElement;
  var parentRect = parent.getBoundingClientRect();
  var widthLimit = Math.max(videoRect.width * 1.35, videoRect.width + 80);
  var heightLimit = Math.max(videoRect.height * 1.35, videoRect.height + 80);
  var tightlyContainsVideo =
    parentRect.left <= videoRect.left + 1 &&
    parentRect.top <= videoRect.top + 1 &&
    parentRect.right >= videoRect.right - 1 &&
    parentRect.bottom >= videoRect.bottom - 1 &&
    parentRect.width <= widthLimit &&
    parentRect.height <= heightLimit;
  if (!tightlyContainsVideo) return null;

  var siblings = Array.from(parent.children || []);
  var hasCoveringSibling = siblings.some(function(sibling) {
    if (sibling === mount || sibling.classList.contains("vsc-controller")) {
      return false;
    }
    var rect = sibling.getBoundingClientRect();
    var overlapWidth = Math.max(
      0,
      Math.min(rect.right, videoRect.right) - Math.max(rect.left, videoRect.left)
    );
    var overlapHeight = Math.max(
      0,
      Math.min(rect.bottom, videoRect.bottom) - Math.max(rect.top, videoRect.top)
    );
    return (
      overlapWidth >= videoRect.width * 0.75 &&
      overlapHeight >= videoRect.height * 0.75
    );
  });

  return hasCoveringSibling ? parent : null;
}

function isShadowRootNode(node) {
  return Boolean(
    node &&
      node.nodeType === Node.DOCUMENT_FRAGMENT_NODE &&
      node.host &&
      node.host.nodeType === Node.ELEMENT_NODE
  );
}

function isComposedDescendant(node, ancestor) {
  if (!node || !ancestor) return false;
  if (node === ancestor) return true;
  if (typeof ancestor.contains === "function" && ancestor.contains(node)) {
    return true;
  }

  var current = node;
  var depth = 0;
  while (current && depth < 20) {
    if (current === ancestor) return true;
    if (current.parentElement) {
      current = current.parentElement;
    } else {
      var root =
        typeof current.getRootNode === "function" ? current.getRootNode() : null;
      current = root && root.host ? root.host : null;
    }
    depth += 1;
  }
  return false;
}

function getControllerGeometryMount(mount) {
  return isShadowRootNode(mount) ? mount.host : mount;
}

function getControllerMount(video, boundary) {
  if (!video) return null;

  // In fullscreen, mount at the promoted top-layer boundary. The normal size
  // heuristic is intentionally skipped: letterboxed/portrait video providers
  // can be much smaller than a full-player gesture pane sibling.
  if (
    boundary &&
    (boundary === video || isComposedDescendant(video, boundary))
  ) {
    // A VIDEO is a replaced element; author children appended inside it are
    // fallback content and are not painted. Direct-media fullscreen uses a
    // top-layer popover instead, while this function keeps a renderable DOM
    // mount as its ownership/geometry anchor.
    if (boundary === video) {
      return video.vsc && video.vsc.normalControllerMount
        ? video.vsc.normalControllerMount
        : getControllerMount(video);
    }
    if (
      boundary.shadowRoot &&
      isComposedDescendant(video, boundary.shadowRoot)
    ) {
      return boundary.shadowRoot;
    }
    return boundary;
  }

  // YouTube's .html5-video-container is often absolutely laid out and can
  // report a zero-height box even while its video is visibly playing. The
  // surrounding .html5-video-player is the real player/overlay boundary for
  // watch pages, Shorts, and hover-preview #inline-preview-player instances.
  // Keep every subsequent remount on that canonical boundary; otherwise an
  // event-driven ensureController call can undo the constructor's YouTube
  // mount and hide the controller in the zero-height inner container.
  if (isOnYouTube() && typeof video.closest === "function") {
    var youTubePlayerMount = video.closest(".html5-video-player");
    if (youTubePlayerMount) return youTubePlayerMount;
  }

  if (!video.parentElement) {
    var directRoot =
      typeof video.getRootNode === "function" ? video.getRootNode() : null;
    return isShadowRootNode(directRoot) ? directRoot : null;
  }

  var mountBoundary = null;

  var videoRect = video.getBoundingClientRect();
  var mount = video.parentElement;
  var candidate = mount;
  var depth = 0;

  // Usually stay inside the immediate local stacking boundary so a max-z-index
  // host cannot escape over page headers. The exception is a tightly-sized
  // shared player whose covering gesture/click pane is a sibling of that
  // boundary; mount one level up so the controller can win hit-testing.
  if (createsControllerStackingContext(mount)) {
    return getSharedOverlayMount(mount, videoRect) || mount;
  }

  // Player click-catchers are often siblings of the video's immediate parent.
  // Climb through tightly-sized wrappers so our host shares their stacking
  // context, but stop before broad page-layout containers.
  while (candidate && candidate.parentElement && depth < 5) {
    if (mountBoundary && candidate === mountBoundary) break;
    var next = candidate.parentElement;
    if (
      mountBoundary &&
      next !== mountBoundary &&
      !mountBoundary.contains(next)
    ) {
      break;
    }
    var nextRect = next.getBoundingClientRect();
    var widthLimit = Math.max(videoRect.width * 1.35, videoRect.width + 80);
    var heightLimit = Math.max(videoRect.height * 1.35, videoRect.height + 80);
    var containsVideo =
      nextRect.left <= videoRect.left + 1 &&
      nextRect.top <= videoRect.top + 1 &&
      nextRect.right >= videoRect.right - 1 &&
      nextRect.bottom >= videoRect.bottom - 1;

    if (
      videoRect.width <= 0 ||
      videoRect.height <= 0 ||
      !containsVideo ||
      nextRect.width > widthLimit ||
      nextRect.height > heightLimit
    ) {
      break;
    }

    mount = next;
    candidate = next;
    depth += 1;

    // In fullscreen, the wrapper must remain inside the exact subtree the
    // browser promotes to its top layer.
    if (mountBoundary && next === mountBoundary) break;

    // Never climb out of a player-owned stacking context. Doing so lets the
    // controller's high local z-index escape above sticky page headers.
    if (createsControllerStackingContext(next)) break;
  }

  return mount;
}

function getFullscreenElement(doc) {
  if (!doc) return null;
  return (
    doc.fullscreenElement ||
    doc.webkitFullscreenElement ||
    doc.mozFullScreenElement ||
    doc.msFullscreenElement ||
    null
  );
}

function positionControllerHost(wrapper, video, mount) {
  if (!wrapper || !video || !mount || !wrapper.isConnected) return;

  var geometryMount = getControllerGeometryMount(mount);
  if (!geometryMount || typeof geometryMount.getBoundingClientRect !== "function") {
    return;
  }
  var videoRect = video.getBoundingClientRect();
  if (wrapper.classList.contains("vsc-fullscreen-popover")) {
    if (videoRect.width <= 0 || videoRect.height <= 0) {
      wrapper.classList.add("vsc-geometry-hidden");
      wrapper.style.setProperty("display", "none", "important");
      return;
    }
    wrapper.classList.remove("vsc-geometry-hidden");
    wrapper.style.removeProperty("display");
    wrapper.style.setProperty("left", videoRect.left + "px", "important");
    wrapper.style.setProperty("top", videoRect.top + "px", "important");
    wrapper.style.setProperty("width", videoRect.width + "px", "important");
    wrapper.style.setProperty("height", videoRect.height + "px", "important");
    return;
  }
  var mountRect = geometryMount.getBoundingClientRect();
  if (
    videoRect.width <= 0 ||
    videoRect.height <= 0 ||
    mountRect.width <= 0 ||
    mountRect.height <= 0
  ) {
    wrapper.classList.add("vsc-geometry-hidden");
    wrapper.style.setProperty("display", "none", "important");
    wrapper.style.setProperty("width", "0px", "important");
    wrapper.style.setProperty("height", "0px", "important");
    return;
  }

  wrapper.classList.remove("vsc-geometry-hidden");
  wrapper.style.removeProperty("display");

  // Convert viewport pixels back into the mount's CSS pixel space. This keeps
  // the overlay aligned even when a player or ancestor is scaled.
  var mountWidth = geometryMount.offsetWidth || mountRect.width || 1;
  var mountHeight = geometryMount.offsetHeight || mountRect.height || 1;
  var scaleX = mountRect.width > 0 ? mountRect.width / mountWidth : 1;
  var scaleY = mountRect.height > 0 ? mountRect.height / mountHeight : 1;
  var left =
    (videoRect.left - mountRect.left) / scaleX -
    (geometryMount.clientLeft || 0) +
    (geometryMount.scrollLeft || 0);
  var top =
    (videoRect.top - mountRect.top) / scaleY -
    (geometryMount.clientTop || 0) +
    (geometryMount.scrollTop || 0);

  wrapper.style.setProperty("left", left + "px", "important");
  wrapper.style.setProperty("top", top + "px", "important");
  wrapper.style.setProperty(
    "width",
    videoRect.width / scaleX + "px",
    "important"
  );
  wrapper.style.setProperty(
    "height",
    videoRect.height / scaleY + "px",
    "important"
  );
}

function configureControllerAutoHide(videoController, wrapper, force) {
  if (!videoController || !wrapper) return;
  var signature = JSON.stringify([
    tc.settings.hideWithControls === true,
    Number(tc.settings.hideWithControlsTimer) || 2
  ]);
  if (force !== true && videoController.autoHideSettingsSignature === signature) {
    return;
  }

  if (videoController.youTubeAutoHideObserver) {
    videoController.youTubeAutoHideObserver.disconnect();
    videoController.youTubeAutoHideObserver = null;
  }
  if (videoController.youTubeAutoHideCleanup) {
    videoController.youTubeAutoHideCleanup();
    videoController.youTubeAutoHideCleanup = null;
  }
  if (videoController.genericAutoHideCleanup) {
    videoController.genericAutoHideCleanup();
    videoController.genericAutoHideCleanup = null;
  }

  wrapper.classList.remove("ytp-autohide", "vsc-idle-hidden");
  videoController.autoHideSettingsSignature = signature;
  if (!tc.settings.hideWithControls) return;

  if (isOnYouTube()) {
    videoController.setupYouTubeAutoHide(wrapper);
  } else {
    videoController.setupGenericAutoHide(wrapper);
  }
}

function setupControllerHostTracking(videoController, wrapper, mount) {
  if (!videoController || !wrapper || !mount) return;

  var doc = videoController.video.ownerDocument;
  var win = doc.defaultView || window;
  var geometryMount = getControllerGeometryMount(mount);
  if (!geometryMount || !geometryMount.style) return;
  var frameId = null;
  var geometryRetryTimer = null;
  var geometryRetryAttempts = 0;
  var maxGeometryRetryAttempts = 12;
  var update = function() {
    frameId = null;
    positionControllerHost(wrapper, videoController.video, mount);

    // Content scripts run at document_start, so a connected player can still
    // report a 0x0 rect while its stylesheet, route, or custom element is
    // settling. ResizeObserver normally repairs this, but it is not guaranteed
    // to exist (and some players only change ancestor layout). Keep a bounded
    // fallback alive long enough for those players instead of leaving the
    // inline display:none geometry guard stuck forever.
    if (
      wrapper.classList.contains("vsc-geometry-hidden") &&
      wrapper.isConnected &&
      videoController.video.isConnected &&
      geometryRetryAttempts < maxGeometryRetryAttempts
    ) {
      geometryRetryAttempts += 1;
      if (geometryRetryTimer === null) {
        geometryRetryTimer = win.setTimeout(function() {
          geometryRetryTimer = null;
          schedule();
        }, Math.min(500, 25 * geometryRetryAttempts));
      }
    } else if (!wrapper.classList.contains("vsc-geometry-hidden")) {
      geometryRetryAttempts = 0;
      if (geometryRetryTimer !== null) {
        win.clearTimeout(geometryRetryTimer);
        geometryRetryTimer = null;
      }
    }
  };
  var schedule = function() {
    if (frameId !== null) return;
    frameId = win.requestAnimationFrame(update);
  };

  if (win.getComputedStyle(geometryMount).position === "static") {
    geometryMount.dataset.vscPositionOwner = "true";
    geometryMount.dataset.vscOriginalPosition =
      geometryMount.style.getPropertyValue("position");
    geometryMount.dataset.vscOriginalPositionPriority =
      geometryMount.style.getPropertyPriority("position");
    geometryMount.dataset.vscAppliedPosition = "relative";
    geometryMount.style.setProperty("position", "relative");
  }

  if (!createsControllerStackingContext(geometryMount)) {
    geometryMount.dataset.vscIsolationOwner = "true";
    geometryMount.dataset.vscOriginalIsolation =
      geometryMount.style.getPropertyValue("isolation");
    geometryMount.dataset.vscOriginalIsolationPriority =
      geometryMount.style.getPropertyPriority("isolation");
    geometryMount.dataset.vscAppliedIsolation = "isolate";
    geometryMount.style.setProperty("isolation", "isolate");
  }

  var resizeObserver = null;
  if (typeof win.ResizeObserver === "function") {
    resizeObserver = new win.ResizeObserver(schedule);
    resizeObserver.observe(videoController.video);
    resizeObserver.observe(geometryMount);
  }

  win.addEventListener("resize", schedule, { passive: true });
  doc.addEventListener("fullscreenchange", schedule, { passive: true });
  geometryMount.addEventListener("scroll", schedule, { passive: true });
  update();

  videoController.controllerHostMount = mount;
  videoController.controllerHostCleanup = function(forceRestore) {
    if (resizeObserver) resizeObserver.disconnect();
    if (frameId !== null) win.cancelAnimationFrame(frameId);
    if (geometryRetryTimer !== null) win.clearTimeout(geometryRetryTimer);
    win.removeEventListener("resize", schedule);
    doc.removeEventListener("fullscreenchange", schedule);
    geometryMount.removeEventListener("scroll", schedule);
    var hasOtherController = false;
    try {
      hasOtherController = Array.from(
        mount.querySelectorAll(".vsc-controller")
      ).some(function(controllerHost) {
        return controllerHost !== wrapper;
      });
    } catch (e) {}
    if (
      geometryMount.dataset.vscPositionOwner === "true" &&
      !hasOtherController &&
      (forceRestore === true || !wrapper.isConnected)
    ) {
      if (
        geometryMount.style.getPropertyValue("position") ===
          geometryMount.dataset.vscAppliedPosition &&
        geometryMount.style.getPropertyPriority("position") === ""
      ) {
        if (geometryMount.dataset.vscOriginalPosition) {
          geometryMount.style.setProperty(
            "position",
            geometryMount.dataset.vscOriginalPosition,
            geometryMount.dataset.vscOriginalPositionPriority || ""
          );
        } else {
          geometryMount.style.removeProperty("position");
        }
      }
      delete geometryMount.dataset.vscPositionOwner;
      delete geometryMount.dataset.vscOriginalPosition;
      delete geometryMount.dataset.vscOriginalPositionPriority;
      delete geometryMount.dataset.vscAppliedPosition;
    }
    if (
      geometryMount.dataset.vscIsolationOwner === "true" &&
      !hasOtherController &&
      (forceRestore === true || !wrapper.isConnected)
    ) {
      if (
        geometryMount.style.getPropertyValue("isolation") ===
          geometryMount.dataset.vscAppliedIsolation &&
        geometryMount.style.getPropertyPriority("isolation") === ""
      ) {
        if (geometryMount.dataset.vscOriginalIsolation) {
          geometryMount.style.setProperty(
            "isolation",
            geometryMount.dataset.vscOriginalIsolation,
            geometryMount.dataset.vscOriginalIsolationPriority || ""
          );
        } else {
          geometryMount.style.removeProperty("isolation");
        }
      }
      delete geometryMount.dataset.vscIsolationOwner;
      delete geometryMount.dataset.vscOriginalIsolation;
      delete geometryMount.dataset.vscOriginalIsolationPriority;
      delete geometryMount.dataset.vscAppliedIsolation;
    }
  };

  configureControllerAutoHide(videoController, wrapper, true);
}

function remountControllerHost(videoController, mount) {
  if (
    !videoController ||
    !videoController.div ||
    !mount ||
    !(mount.isConnected || (isShadowRootNode(mount) && mount.host.isConnected))
  ) {
    return false;
  }

  if (
    mount === videoController.controllerHostMount &&
    videoController.div.isConnected &&
    videoController.div.parentNode === mount
  ) {
    // Keep the max-z-index host last among equal-z-index player overlays.
    if (videoController.div.nextSibling) {
      mount.appendChild(videoController.div);
      return true;
    }
    positionControllerHost(
      videoController.div,
      videoController.video,
      mount
    );
    return false;
  }

  if (videoController.controllerHostCleanup) {
    videoController.controllerHostCleanup(true);
    videoController.controllerHostCleanup = null;
  }

  mount.appendChild(videoController.div);
  setupControllerHostTracking(videoController, videoController.div, mount);
  return true;
}

function disableDirectFullscreenPopover(videoController) {
  if (!videoController || !videoController.div) return;
  var wrapper = videoController.div;
  if (
    !wrapper.vscFullscreenPopoverOpen &&
    !wrapper.classList.contains("vsc-fullscreen-popover")
  ) {
    return;
  }
  if (typeof wrapper.hidePopover === "function") {
    try {
      wrapper.hidePopover();
    } catch (_error) {}
  }
  wrapper.vscFullscreenPopoverOpen = false;
  wrapper.classList.remove("vsc-fullscreen-popover");
  wrapper.removeAttribute("popover");
}

function enableFullscreenPopover(videoController, preferredMount) {
  if (!videoController || !videoController.video || !videoController.div) {
    return false;
  }
  var wrapper = videoController.div;
  if (typeof wrapper.showPopover !== "function") return false;

  var normalMount = preferredMount || videoController.normalControllerMount;
  var normalMountIsConnected = Boolean(
    normalMount &&
      (normalMount.isConnected ||
        (isShadowRootNode(normalMount) && normalMount.host.isConnected))
  );
  if (!normalMountIsConnected) {
    normalMount = getControllerMount(videoController.video);
    videoController.normalControllerMount = normalMount;
  }
  if (!normalMount) return false;
  if (wrapper.parentNode !== normalMount) {
    remountControllerHost(videoController, normalMount);
  }

  wrapper.setAttribute("popover", "manual");
  wrapper.classList.add("vsc-fullscreen-popover");
  if (!wrapper.vscFullscreenPopoverOpen) {
    try {
      wrapper.showPopover();
      wrapper.vscFullscreenPopoverOpen = true;
    } catch (_error) {
      wrapper.classList.remove("vsc-fullscreen-popover");
      wrapper.removeAttribute("popover");
      return false;
    }
  }
  positionControllerHost(wrapper, videoController.video, normalMount);
  return true;
}

function syncControllerFullscreenMount(videoController) {
  if (!videoController || !videoController.video || !videoController.div) {
    return false;
  }

  var video = videoController.video;
  var doc = video.ownerDocument;
  var fullscreenElement = getFullscreenElement(doc);
  var targetMount = videoController.normalControllerMount;
  var ownsFullscreen = Boolean(
    fullscreenElement &&
      (fullscreenElement === video ||
        isComposedDescendant(video, fullscreenElement))
  );

  if (ownsFullscreen) {
    targetMount = getControllerMount(video, fullscreenElement);
  } else if (!fullscreenElement && (!targetMount || !targetMount.isConnected)) {
    targetMount = getControllerMount(video);
    videoController.normalControllerMount = targetMount;
  }

  if (!targetMount) return false;

  if (ownsFullscreen) {
    // Fullscreen elements and popovers both participate in the browser's top
    // layer. Showing Speeder's host after the player enters fullscreen keeps it
    // above provider-owned surfaces even when the provider clips descendants or
    // creates a new fullscreen stacking context (notably Firefox + YouTube).
    // Browsers without the Popover API retain the player-local remount fallback.
    if (enableFullscreenPopover(videoController, targetMount)) return true;
  } else {
    disableDirectFullscreenPopover(videoController);
  }

  return remountControllerHost(videoController, targetMount);
}

function defineVideoController() {
  tc.videoController = function(target, parent) {
    if (target.vsc) return target.vsc;
    tc.mediaElements.push(target);
    target.vsc = this;
    this.video = target;
    this.parent = target.parentElement || parent;
    this.nudgeAnimationId = null;
    this.restoreSpeedTimer = null;
    this.pendingRateChange = null;
    this.speedRestoreUntil = 0;
    this.speedVerificationTimer = null;
    this.speedVerificationTarget = null;
    this.speedVerificationAttempts = 0;
    this.subtitleNudgeEnabledOverride = null;
    this.suppressedRateChangeCount = 0;
    this.suppressedRateChangeUntil = 0;
    this.visibilityResumeHandler = null;
    this.resetToggleArmed = false;
    this.resetButtonEl = null;
    this.controllerLocation = normalizeControllerLocation(
      tc.settings.controllerLocation
    );
    this.structureSignature = getControllerStructureSignature();

    log(`Creating video controller for ${target.tagName} with src: ${target.src || target.currentSrc || "none"}`, 4);

    let storedSpeed = sanitizeSpeed(resolveTargetSpeed(target), 1.0);
    this.targetSpeed = storedSpeed;
    this.targetSpeedSourceKey = getVideoSourceKey(target);
    this.targetSpeedOrigin =
      tc.settings.rememberSpeed || tc.settings.forceLastSavedSpeed
        ? "policy"
        : "initial";
    this.mediaSourceKey = getVideoSourceKey(target);
    if (!tc.settings.rememberSpeed && !tc.settings.forceLastSavedSpeed) {
      setKeyBindings("reset", getKeyBindings("fast"));
    }

    log("Explicitly setting playbackRate to: " + storedSpeed, 5);
    try {
      target.playbackRate = storedSpeed;
    } catch (error) {
      log(`Unable to set initial playbackRate: ${error.message}`, 3);
    }

    this.div = this.initializeControls();

    if (!this.div) {
      log("ERROR: Failed to create controller div!", 2);
      return;
    }

    log(`Controller created and attached to DOM. Hidden: ${this.div.classList.contains("vsc-hidden")}`, 4);

    var mediaEventAction = function(event) {
      this.lastActivityAt = Date.now();
      if (event.type === "emptied") {
        var sourceAvailable = hasUsableMediaSource(event.target);
        if (this.div) {
          this.div.classList.toggle("vsc-nosource", !sourceAvailable);
        }
        this.stopSubtitleNudge();
        if (!sourceAvailable) {
          this.mediaSourceKey = "unknown_src";
          this.targetSpeedSourceKey = "unknown_src";
          return;
        }
        applySourceTransitionPolicy(event.target, true);
      }

      if (event.type === "loadstart") {
        if (this.div) {
          this.div.classList.toggle(
            "vsc-nosource",
            !hasUsableMediaSource(event.target)
          );
        }
        if (hasUsableMediaSource(event.target)) {
          applySourceTransitionPolicy(event.target, true);
        }
      }

      if (
        event.type === "loadedmetadata" ||
        event.type === "loadeddata" ||
        event.type === "canplay"
      ) {
        if (this.div) this.div.classList.remove("vsc-nosource");
        applySourceTransitionPolicy(event.target, false);
      }

      if (event.type === "play") {
        applySourceTransitionPolicy(event.target, false);
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
      "loadstart",
      (this.handleLoadStart = mediaEventAction.bind(this))
    );
    target.addEventListener(
      "emptied",
      (this.handleEmptied = mediaEventAction.bind(this))
    );
    target.addEventListener(
      "loadedmetadata",
      (this.handleLoadedMetadata = mediaEventAction.bind(this))
    );
    target.addEventListener(
      "loadeddata",
      (this.handleLoadedData = mediaEventAction.bind(this))
    );
    target.addEventListener(
      "canplay",
      (this.handleCanPlay = mediaEventAction.bind(this))
    );
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
              this.div.classList.toggle(
                "vsc-nosource",
                !hasUsableMediaSource(mutation.target)
              );
            } else {
              this.div.classList.remove("vsc-nosource");
              applySourceTransitionPolicy(this.video, true);
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

  tc.videoController.prototype.remove = function() {
    this.stopSubtitleNudge();
    disableDirectFullscreenPopover(this);
    if (
      this.visibilityResumeHandler &&
      this.video &&
      this.video.ownerDocument
    ) {
      this.video.ownerDocument.removeEventListener(
        "visibilitychange",
        this.visibilityResumeHandler,
        true
      );
      this.visibilityResumeHandler = null;
    }
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
    if (this.controllerHostCleanup) {
      this.controllerHostCleanup();
      this.controllerHostCleanup = null;
    }
    if (this.restoreSpeedTimer) clearTimeout(this.restoreSpeedTimer);
    clearSpeedVerification(this);
    if (this.video) {
      this.video.removeEventListener("loadstart", this.handleLoadStart);
      this.video.removeEventListener("emptied", this.handleEmptied);
      this.video.removeEventListener("loadedmetadata", this.handleLoadedMetadata);
      this.video.removeEventListener("loadeddata", this.handleLoadedData);
      this.video.removeEventListener("canplay", this.handleCanPlay);
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

  tc.videoController.prototype.startSubtitleNudge = function() {
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
      const nudgeAmount = Math.min(
        0.1,
        Math.max(0.000001, Number(tc.settings.subtitleNudgeAmount) || 0.001)
      );

      // Apply nudge from the stored target speed (not current rate)
      try {
        this.video.playbackRate = targetSpeed + nudgeAmount;
      } catch (error) {
        tc.isNudging = false;
        this.suppressedRateChangeCount = 0;
        this.stopSubtitleNudge();
        log(`Subtitle nudge failed: ${error.message}`, 3);
        return;
      }

      // Revert synchronously after a microtask to ensure it happens immediately
      Promise.resolve().then(() => {
        try {
          if (this.video && targetSpeed) {
            this.video.playbackRate = targetSpeed;
          }
        } catch (error) {
          this.suppressedRateChangeCount = 0;
          this.stopSubtitleNudge();
          log(`Subtitle nudge restore failed: ${error.message}`, 3);
        } finally {
          tc.isNudging = false;
        }
      });

      // Schedule next nudge
      this.nudgeAnimationId = setTimeout(performNudge, tc.settings.subtitleNudgeInterval);
    };

    // Start the first nudge
    this.nudgeAnimationId = setTimeout(performNudge, tc.settings.subtitleNudgeInterval);
    log(`Nudge: Starting with interval ${tc.settings.subtitleNudgeInterval}ms.`, 5);
  };

  tc.videoController.prototype.stopSubtitleNudge = function() {
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

  tc.videoController.prototype.performImmediateNudge = function() {
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
    const nudgeAmount = Math.min(
      0.1,
      Math.max(0.000001, Number(tc.settings.subtitleNudgeAmount) || 0.001)
    );

    tc.isNudging = true;
    suppressNextNudgeRateChanges(this, 2);
    try {
      this.video.playbackRate = targetRate + nudgeAmount;
    } catch (error) {
      tc.isNudging = false;
      this.suppressedRateChangeCount = 0;
      log(`Immediate subtitle nudge failed: ${error.message}`, 3);
      return;
    }

    // Revert synchronously via microtask
    Promise.resolve().then(() => {
      try {
        if (this.video) {
          this.video.playbackRate = targetRate;
        }
      } catch (error) {
        this.suppressedRateChangeCount = 0;
        log(`Immediate subtitle nudge restore failed: ${error.message}`, 3);
      } finally {
        tc.isNudging = false;
      }
    });

    log(`Immediate nudge performed at rate ${targetRate.toFixed(2)}`, 5);
  };

  tc.videoController.prototype.setupYouTubeAutoHide = function(wrapper) {
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
      if (
        ytPlayer.classList.contains("ytp-autohide") &&
        !this.controllerInteractionActive
      ) {
        wrapper.classList.add("ytp-autohide");

        // Preserve an active pointer reveal or shortcut-forced reveal. The
        // ytp-autohide class remains in place, so CSS hides the host as soon as
        // vsc-show's bounded timer expires.
        if (
          !wrapper.classList.contains("vsc-forced-show") &&
          !wrapper.classList.contains("vsc-show")
        ) {
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

    const handleControllerInteractionChange = (active) => {
      if (active) {
        wrapper.classList.remove("ytp-autohide");
        showController(wrapper, tc.settings.hideWithControlsTimer * 1000);
      } else {
        syncControllerVisibility();
      }
    };
    this.controllerInteractionChanged = handleControllerInteractionChange;

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
      if (this.controllerInteractionChanged === handleControllerInteractionChange) {
        this.controllerInteractionChanged = null;
      }
    };
  };

  tc.videoController.prototype.setupGenericAutoHide = function(wrapper) {
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
        timer = null;
        if (this.controllerInteractionActive) return;
        // Only hide if the video is not paused
        // (Many players keep controls visible while paused)
        // However, the user said "Reveal on every mouse and keyboard input"
        // and "auto-hidden after timespan".
        // We'll follow the timer strictly.
        wrapper.classList.add("vsc-idle-hidden");
        log("Generic hide: controller hidden due to inactivity", 5);
      }, tc.settings.hideWithControlsTimer * 1000);
    };

    const handleControllerInteractionChange = (active) => {
      if (active) {
        wrapper.classList.remove("vsc-idle-hidden");
        showController(wrapper, tc.settings.hideWithControlsTimer * 1000);
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      } else {
        resetTimer();
      }
    };
    this.controllerInteractionChanged = handleControllerInteractionChange;

    // Initial show/timer
    resetTimer();

    // The wrapper covers the player area on most sites due to inject.css styles,
    // but we listen on both the video and the wrapper for maximum coverage.
    const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart"];
    const parentEl =
      getControllerGeometryMount(this.controllerHostMount) ||
      video.parentElement;
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
      if (this.controllerInteractionChanged === handleControllerInteractionChange) {
        this.controllerInteractionChanged = null;
      }
    };

    log(`Generic auto-hide setup complete with ${tc.settings.hideWithControlsTimer}s timer`, 4);
  };

  tc.videoController.prototype.initializeControls = function() {
    const doc = this.video.ownerDocument;
    const speed = this.video.playbackRate.toFixed(2);
    var wrapper = doc.createElement("div");
    wrapper.classList.add("vsc-controller");
    if (!hasUsableMediaSource(this.video))
      wrapper.classList.add("vsc-nosource");
    if (tc.settings.startHidden) wrapper.classList.add("vsc-hidden");
    // z-index is handled by the base .vsc-controller CSS rule (2147483647).
    // The controller lives inside the video container, so high z-index only
    // makes it topmost within the local stacking context — it won't overlay
    // page-level modals or dialogs.
    var shadow = wrapper.attachShadow({ mode: "open" });
    var shadowStylesheet = doc.createElement("link");
    shadowStylesheet.rel = "stylesheet";
    shadowStylesheet.href = chrome.runtime.getURL("content/shadow.css");
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

    buttonConfig.forEach(function(btnId) {
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
    controller.appendChild(controls);
    /* Flash sits after #controls so it never inserts space between speed and buttons. */
    controller.appendChild(nudgeFlashIndicator);
    shadow.appendChild(controller);

    const setControllerInteractionActive = (active) => {
      this.controllerInteractionActive = active === true;
      controller.classList.toggle(
        "vsc-controls-hovered",
        this.controllerInteractionActive
      );
      wrapper.classList.toggle(
        "vsc-controls-hovered",
        this.controllerInteractionActive
      );
      if (typeof this.controllerInteractionChanged === "function") {
        this.controllerInteractionChanged(this.controllerInteractionActive);
      }
    };
    controller.addEventListener("pointerenter", () => {
      setControllerInteractionActive(true);
    });
    controller.addEventListener("pointerleave", () => {
      setControllerInteractionActive(false);
    });

    this.speedIndicator = dragHandle;
    this.subtitleNudgeIndicator = subtitleNudgeIndicator;
    this.nudgeFlashIndicator = nudgeFlashIndicator;
    this.resetButtonEl =
      shadow.querySelector("button[data-action=\"reset\"]") || null;
    this.resetToggleArmed = false;
    if (subtitleNudgeIndicator) {
      updateSubtitleNudgeIndicator(this.video);
    }

    function blurAfterPointerTap(target, e) {
      if (!target || typeof target.blur !== "function") return;
      var pt = e.pointerType;
      if (pt === "mouse" || pt === "touch" || (!pt && e.detail > 0)) {
        requestAnimationFrame(function() {
          target.blur();
        });
      }
    }

    dragHandle.addEventListener(
      "mousedown",
      (e) => {
        var dragAction = dragHandle.dataset.action;
        runAction(dragAction, getKeyBindings(dragAction, "value"), e);
        e.stopPropagation();
      },
      true
    );
    shadow.querySelectorAll("button").forEach((button) => {
      button.addEventListener(
        "click",
        (e) => {
          var action = button.dataset.action;
          runAction(action, getKeyBindings(action), e);
          blurAfterPointerTap(button, e);
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
          blurAfterPointerTap(subtitleNudgeIndicator, e);
          e.stopPropagation();
        },
        true
      );
    }
    controller.addEventListener("click", (e) => e.stopPropagation(), false);
    controller.addEventListener("mousedown", (e) => e.stopPropagation(), false);

    const parentEl =
      this.parent || this.video.parentElement || this.video.parentNode;
    var mountEl = getControllerMount(this.video) || parentEl;

    log(`Inserting controller: parentEl=${!!parentEl}, hostname=${location.hostname}`, 4);

    if (
      !mountEl ||
      !(mountEl.isConnected ||
        (isShadowRootNode(mountEl) && mountEl.host.isConnected))
    ) {
      log("No suitable parent found, appending to body", 4);
      doc.body.appendChild(wrapper);
      this.normalControllerMount = doc.body;
      setupControllerHostTracking(this, wrapper, doc.body);
      return wrapper;
    }

    try {
      switch (true) {
        case location.hostname === "www.amazon.com":
        case location.hostname === "www.reddit.com":
        case /hbogo\./.test(location.hostname):
          mountEl = parentEl.parentElement || mountEl;
          break;
        case location.hostname === "www.facebook.com":
          var facebookMount = parentEl;
          for (var facebookDepth = 0; facebookDepth < 7; facebookDepth += 1) {
            if (!facebookMount.parentElement) break;
            facebookMount = facebookMount.parentElement;
          }
          mountEl = facebookMount || mountEl;
          break;
        case location.hostname === "tv.apple.com":
          var appleRoot = parentEl.getRootNode();
          var appleScrim =
            appleRoot && appleRoot.querySelector
              ? appleRoot.querySelector(".scrim")
              : null;
          mountEl = appleScrim || mountEl;
          break;
        case location.hostname === "www.youtube.com":
        case location.hostname === "m.youtube.com":
        case location.hostname === "music.youtube.com":
          mountEl =
            (parentEl.closest && parentEl.closest(".html5-video-player")) ||
            mountEl;
          break;
      }
      mountEl.appendChild(wrapper);
      this.normalControllerMount = mountEl;
      setupControllerHostTracking(this, wrapper, mountEl);
      log("Controller successfully inserted into DOM", 4);
    } catch (error) {
      log(`Error inserting controller: ${error.message}`, 2);
      // Fallback to body insertion
      doc.body.appendChild(wrapper);
      this.normalControllerMount = doc.body;
      setupControllerHostTracking(this, wrapper, doc.body);
    }

    return wrapper;
  };
}

function applySiteRuleOverrides() {
  var wasForceEnabled = tc.settings.forceLastSavedSpeed === true;
  var wasRememberEnabled = tc.settings.rememberSpeed === true;

  function finishSiteRuleApplication(result) {
    if (
      (wasForceEnabled && !tc.settings.forceLastSavedSpeed) ||
      (wasRememberEnabled && !tc.settings.rememberSpeed)
    ) {
      clearAllSpeedRestoreEnforcement();
    }
    return result;
  }

  resetSettingsFromSiteRuleBase();
  tc.activeSiteRule = null;

  if (!Array.isArray(tc.settings.siteRules) || tc.settings.siteRules.length === 0) {
    return finishSiteRuleApplication(false);
  }

  var currentUrl = location.href;
  var matchedRule = siteRuleUtils.matchSiteRule(currentUrl, tc.settings.siteRules);

  if (!matchedRule) {
    return finishSiteRuleApplication(false);
  }

  tc.activeSiteRule = matchedRule;
  log(`Matched site rule: ${matchedRule.pattern}`, 4);

  // Check if extension should be enabled/disabled on this site
  if (siteRuleUtils.isSiteRuleDisabled(matchedRule)) {
    log(`Extension disabled for site: ${currentUrl}`, 4);
    return finishSiteRuleApplication(true);
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
    "showAmbientLoopControls",
    "controllerOpacity",
    "controllerMarginTop",
    "controllerMarginBottom",
    "shortcutTargetMode",
    "enableSubtitleNudge",
    "subtitleNudgeEnabledByDefault",
    "subtitleNudgeInterval"
  ];

  siteSettings.forEach((key) => {
    if (matchedRule[key] !== undefined) {
      log(`Overriding ${key} for site: ${matchedRule[key]}`, 4);
      tc.settings[key] = matchedRule[key];
    }
  });

  [
    "controllerMarginTop",
    "controllerMarginBottom"
  ].forEach(function(key) {
    tc.settings[key] = normalizeControllerMarginPx(tc.settings[key], 0);
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

  return finishSiteRuleApplication(false);
}

function removeIneligibleMediaControllers() {
  tc.mediaElements.slice().forEach(function(media) {
    if (
      media &&
      ((media.nodeName === "AUDIO" && !tc.settings.audioBoolean) ||
        isAmbientLoopMedia(media))
    ) {
      removeController(media);
    }
  });
}

/** Apply current tc.settings controller layout/opacity to every attached controller (after site rules). */
function refreshAllControllerGeometry() {
  tc.mediaElements.forEach(function(video) {
    if (!video || !video.vsc) return;
    applyControllerLocation(video.vsc, tc.settings.controllerLocation);
    var controllerEl = getControllerElement(video.vsc);
    if (controllerEl) {
      controllerEl.style.opacity = String(tc.settings.controllerOpacity);
    }
    configureControllerAutoHide(video.vsc, video.vsc.div, false);
  });
}

/** Re-match site rules for current URL and refresh controller position/opacity on every video. */
function reapplySiteRulesAndControllerGeometry() {
  applySiteRuleOverrides();
  if (!siteRuleUtils.isSpeederActiveForSite(tc.settings.enabled, tc.activeSiteRule)) {
    tc.mediaElements.slice().forEach(function(video) {
      removeController(video);
    });
    return false;
  }
  removeIneligibleMediaControllers();
  refreshAllControllerGeometry();
  return true;
}

function applyRememberedSpeedPolicy(video) {
  if (!video || !video.vsc) return false;
  var rememberedSpeed = getRememberedSpeed(video);
  if (!isValidSpeed(rememberedSpeed)) return false;

  video.vsc.targetSpeed = rememberedSpeed;
  video.vsc.targetSpeedSourceKey = getVideoSourceKey(video);
  video.vsc.targetSpeedOrigin = "policy";
  if (video.vsc.speedIndicator) {
    video.vsc.speedIndicator.textContent = rememberedSpeed.toFixed(2);
  }
  extendSpeedRestoreWindow(video);
  if (Math.abs(video.playbackRate - rememberedSpeed) > 0.01) {
    setSpeed(video, rememberedSpeed, false, false);
  }
  return true;
}

function shouldPreserveDesiredSpeed(video, speed) {
  if (!video || !video.vsc) return false;
  var desiredSpeed = getDesiredSpeed(video);
  if (!isValidSpeed(desiredSpeed) || Math.abs(speed - desiredSpeed) <= 0.01) {
    return false;
  }

  var preservesPausedTarget =
    video.paused === true &&
    (video.vsc.targetSpeedOrigin === "user" ||
      video.vsc.targetSpeedOrigin === "policy");

  return (
    preservesPausedTarget ||
    (typeof video.vsc.speedRestoreUntil === "number" &&
      video.vsc.speedRestoreUntil > Date.now())
  );
}

function setupListener(root) {
  root = root || document;
  if (root.vscRateListenerAttached) return;

  function updateSpeedFromEvent(video, options) {
    if (!video.vsc || !video.vsc.speedIndicator) return;
    var config = options || {};
    if (config.skipResetDisarm !== true) {
      video.vsc.resetToggleArmed = false;
    }
    var speed = video.playbackRate; // Preserve full precision (e.g. 0.01)
    video.vsc.speedIndicator.textContent = speed.toFixed(2);
    video.vsc.targetSpeed = speed;
    video.vsc.targetSpeedSourceKey = getVideoSourceKey(video);

    // A native ratechange has no trustworthy user-origin signal; sites emit the
    // same event when they clamp/reset speed. Durable intent is recorded only
    // by explicit Speeder actions (which pass shouldPersist).
    var shouldPersist = config.shouldPersist === true;
    if (config.preserveTargetOrigin !== true) {
      video.vsc.targetSpeedOrigin = shouldPersist ? "user" : "external";
    }
    if (shouldPersist) {
      rememberSourceSpeed(video, speed);
      tc.settings.lastSpeed = speed;
      schedulePersistLastSpeed(speed);
    }

    if (video.vsc) {
      if (speed === 1.0 || video.paused) video.vsc.stopSubtitleNudge();
      else video.vsc.startSubtitleNudge();
    }
  }

  root.addEventListener(
    "ratechange",
    function(event) {
      if (tc.isNudging) return;
      var video = event.target;
      if (!video || typeof video.playbackRate === "undefined" || !video.vsc)
        return;
      if (shouldIgnoreSuppressedRateChange(video)) return;
      var currentSpeed = video.playbackRate; // Preserve full precision (e.g. 0.01)
      var pendingRateChange = takePendingRateChange(video, currentSpeed);
      if (tc.settings.forceLastSavedSpeed) {
        if (pendingRateChange) {
          updateSpeedFromEvent(video, {
            skipResetDisarm: true,
            shouldPersist: pendingRateChange.shouldPersist === true,
            preserveTargetOrigin: true
          });
        } else {
          var forcedSpeed = sanitizeSpeed(tc.settings.lastSpeed, 1.0);
          if (Math.abs(currentSpeed - forcedSpeed) > 0.001) {
            setSpeed(video, forcedSpeed, false, false);
          } else {
            updateSpeedFromEvent(video, {
              shouldPersist: false,
              preserveTargetOrigin: true
            });
          }
        }
        event.stopImmediatePropagation();
      } else {
        var desiredSpeed = getDesiredSpeed(video);

        if (pendingRateChange) {
          updateSpeedFromEvent(video, {
            skipResetDisarm: true,
            shouldPersist: pendingRateChange.shouldPersist === true,
            preserveTargetOrigin: true
          });
          return;
        }

        if (shouldPreserveDesiredSpeed(video, currentSpeed)) {
          log(
            `Ignoring external rate change to ${currentSpeed.toFixed(4)} while preserving ${desiredSpeed.toFixed(4)}`,
            4
          );
          video.vsc.resetToggleArmed = false;
          video.vsc.speedIndicator.textContent = desiredSpeed.toFixed(2);
          scheduleSpeedRestore(video, desiredSpeed, "pause/play or seek");
          return;
        }

        updateSpeedFromEvent(video, { shouldPersist: false });
      }
    },
    true
  );
  root.vscRateListenerAttached = true;
}

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
  if (
    !tc.runtimeSettingsHydrated ||
    (!forceReinit && vscInitializedDocuments.has(doc)) ||
    !doc.body
  ) {
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

  var pendingInitializeHandler = function() {
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
  // Content scripts already run in every frame. Keeping each listener scoped
  // to its own frame avoids duplicate shortcuts and stale iframe ownership.
  var docs = [doc];

  docs.forEach(function(keyDoc) {
    var keyTarget = keyDoc.defaultView || keyDoc;
    if (keyTarget.vscKeydownListenerAttached) return;
    keyTarget.addEventListener(
      "keydown",
      function(event) {
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

        if (
          !siteRuleUtils.isSpeederActiveForSite(
            tc.settings.enabled,
            tc.activeSiteRule
          )
        ) {
          return;
        }

        if (!tc.mediaElements.length) return;

        var item = tc.settings.keyBindings.find(function(binding) {
          return matchesKeyBinding(binding, event);
        });

        if (item) {
          runAction(item.action, item.value, event);

          // The per-site "Block site from capturing keypress" option owns
          // propagation. Speeder still runs unblocked shortcuts, but the page
          // can receive them too when the user left that option off.
          if (item.force === true || item.force === "true") {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        }
      },
      true
    );
    keyTarget.vscKeydownListenerAttached = true;
  });
}

function attachMediaTargetTracking(doc) {
  if (!doc || doc.vscMediaTargetTrackingAttached) return;
  doc.addEventListener(
    "mousemove",
    function(event) {
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
        return;
      }
      tc.lastPointerPosition = {
        document: doc,
        x: event.clientX,
        y: event.clientY
      };
    },
    { capture: true, passive: true }
  );
  doc.vscMediaTargetTrackingAttached = true;
}

function attachMutationObserver(root) {
  if (root.vscMutationObserverAttached) return;

  var pendingMutations = [];
  var mutationProcessingScheduled = false;
  var observer = new MutationObserver(function(mutations) {
    pendingMutations.push(...mutations);
    if (mutationProcessingScheduled) return;

    mutationProcessingScheduled = true;
    requestIdle(
      function() {
        var mutationsToProcess = pendingMutations.splice(0);
        mutationProcessingScheduled = false;
        var controllerMountTargets = new Set();

        mutationsToProcess.forEach(function(mutation) {
          if (mutation.type === "childList") {
            controllerMountTargets.add(mutation.target);
            mutation.addedNodes.forEach(function(node) {
              // Skip text nodes, comments, etc. — only elements can contain media
              if (node.nodeType !== Node.ELEMENT_NODE) return;
              scanNodeForMedia(node, node.parentNode || mutation.target, true);
            });
            mutation.removedNodes.forEach(function(node) {
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
            target.nodeName === "SOURCE" &&
            mutation.attributeName === "src"
          ) {
            ensureControllerForMediaChild(target);
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

        // Reconcile once per batch, not once per mutation. Large news/social
        // pages can emit hundreds of childList records in one render pass.
        if (controllerMountTargets.size > 0) {
          tc.mediaElements.slice().forEach(function(video) {
            if (!video || !video.vsc || !video.vsc.div) return;
            var mount = video.vsc.controllerHostMount;
            if (!controllerMountTargets.has(mount)) return;
            remountControllerHost(video.vsc, mount);
          });
        }

        // Document selectors do not cross shadow boundaries. A detached
        // custom-element host can therefore hide connected-looking media from
        // the removed subtree scan; prune by composed connectivity as a final
        // reconciliation step for every mutation batch.
        tc.mediaElements.slice().forEach(function(video) {
          if (!video || video.isConnected) return;
          removeController(video);
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

  var handleDetectedMedia = function(event) {
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
  ].forEach(function(eventName) {
    root.addEventListener(eventName, handleDetectedMedia, true);
  });
  root.vscMediaEventListenersAttached = true;
}

function scheduleNavigationRescan() {
  var nextHref = location.href;
  if (window.vscLastObservedHref !== nextHref) {
    // Pointer and controller interaction state belongs to the previous route.
    // YouTube keeps hover-preview and Shorts players connected across SPA
    // navigations, so retaining either target can send shortcuts to an
    // off-screen/stale player even though the new watch controller works.
    tc.lastPointerPosition = null;
    tc.lastInteractedMedia = null;
  }
  window.vscLastObservedHref = nextHref;
  clearTimeout(window.vscNavigationRescanTimer);
  window.vscNavigationRescanTimer = setTimeout(function() {
    initializeWhenReady(document, true);
  }, 300);
}

function attachNavigationListeners() {
  if (window.vscNavigationListenersAttached) return;

  ["pushState", "replaceState"].forEach(function(method) {
    if (typeof history[method] !== "function") return;
    var original = history[method];
    history[method] = function() {
      var result = original.apply(this, arguments);
      scheduleNavigationRescan();
      return result;
    };
  });

  window.addEventListener("popstate", scheduleNavigationRescan);
  window.addEventListener("hashchange", scheduleNavigationRescan);
  /* YouTube often navigates without a history API call the extension can see first */
  if (typeof document !== "undefined" && isOnYouTube()) {
    document.addEventListener("yt-navigate-finish", scheduleNavigationRescan);
  }
  window.vscLastObservedHref = location.href;
  if (!window.vscLocationWatchTimer) {
    window.vscLocationWatchTimer = setInterval(function() {
      if (window.vscLastObservedHref !== location.href) {
        scheduleNavigationRescan();
      }
    }, 1000);
  }
  window.vscNavigationListenersAttached = true;
}

function initializeNow(doc, forceReinit = false) {
  if ((!forceReinit && vscInitializedDocuments.has(doc)) || !doc.body) return;

  // Navigation must remain observable even while this URL is disabled, or a
  // later whitelisted SPA route can never reactivate the extension.
  attachNavigationListeners();
  if (typeof tc.videoController === "undefined") defineVideoController();
  applySiteRuleOverrides();
  var isActive = siteRuleUtils.isSpeederActiveForSite(
    tc.settings.enabled,
    tc.activeSiteRule
  );

  // Keep observing while inactive so dynamically-created media/shadow roots
  // are available to the next forced SPA rescan, but remove stale controls.
  observeRoot(doc);
  if (!isActive) {
    tc.mediaElements.slice().forEach(function(video) {
      removeController(video);
    });
    vscInitializedDocuments.add(doc);
    return;
  }

  removeIneligibleMediaControllers();

  if (!doc.body.classList.contains("vsc-initialized")) {
    doc.body.classList.add("vsc-initialized");
  }
  attachKeydownListeners(doc);
  attachMediaTargetTracking(doc);

  if (forceReinit) {
    log("Force re-initialization requested", 4);
    // A root is normally scanned only once. A user-requested rescan must also
    // revisit media that was present but source-less during the initial scan.
    scanRootForMedia(doc);
    rescanObservedMediaRoots(doc);
    refreshAllControllerGeometry();
    if (tc.settings.rememberSpeed || tc.settings.forceLastSavedSpeed) {
      tc.mediaElements.slice().forEach(applyRememberedSpeedPolicy);
    }
  }

  vscInitializedDocuments.add(doc);
  flushPendingMediaCandidates();
}

function setSpeed(
  video,
  speed,
  isInitialCall = false,
  isUserKeyPress = false,
  fromResetSpeedToggle = false
) {
  const numericSpeed = Number(speed);

  if (!isValidSpeed(numericSpeed)) {
    log(
      `Invalid speed rejected: ${speed}, must be between ${MIN_SPEED} and ${MAX_SPEED}`,
      2
    );
    return;
  }

  if (!video || !video.vsc || !video.vsc.speedIndicator) return;

  if (isUserKeyPress && !fromResetSpeedToggle) {
    video.vsc.resetToggleArmed = false;
  }

  log(
    `setSpeed: Target ${numericSpeed.toFixed(2)}. Initial: ${isInitialCall}. UserKeyPress: ${isUserKeyPress}`,
    4
  );
  video.vsc.speedIndicator.textContent = numericSpeed.toFixed(2);

  if (isUserKeyPress) {
    tc.settings.lastSpeed = numericSpeed;
    rememberSourceSpeed(video, numericSpeed);
    schedulePersistLastSpeed(numericSpeed);
  }

  // Update the target speed for nudge so it knows what to revert to
  video.vsc.targetSpeed = numericSpeed;
  video.vsc.targetSpeedSourceKey = getVideoSourceKey(video);
  if (isUserKeyPress) {
    video.vsc.targetSpeedOrigin = "user";
  }

  if (isUserKeyPress && !isInitialCall && video.vsc && video.vsc.div) {
    runAction("blink", 1000, null, video); // Pass video to blink
    extendSpeedRestoreWindow(video); // Protect against immediate site-driven resets
  }

  // Try YouTube's native speed API first — keeps subtitles in sync without nudge
  var usedNativeSpeed = false;
  if (Math.abs(video.playbackRate - numericSpeed) > 0.001) {
    rememberPendingRateChange(video, numericSpeed, isUserKeyPress);
    if (!tc.settings.forceLastSavedSpeed) {
      usedNativeSpeed = tryYouTubeNativeSpeed(video, numericSpeed);
    }
    if (!usedNativeSpeed) {
      try {
        video.playbackRate = numericSpeed;
      } catch (error) {
        if (video.vsc) video.vsc.pendingRateChange = null;
        log(`Unable to set playbackRate to ${numericSpeed}: ${error.message}`, 2);
        if (
          tc.settings.forceLastSavedSpeed ||
          (tc.settings.rememberSpeed && video.vsc.targetSpeedOrigin === "policy") ||
          Number(video.vsc.speedRestoreUntil) > Date.now()
        ) {
          scheduleSpeedVerification(video, numericSpeed, true);
        }
        return false;
      }
    }
  }
  if (
    tc.settings.forceLastSavedSpeed ||
    (tc.settings.rememberSpeed && video.vsc.targetSpeedOrigin === "policy") ||
    Number(video.vsc.speedRestoreUntil) > Date.now()
  ) {
    scheduleSpeedVerification(video, numericSpeed, true);
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
  return true;
}

function getMediaFromControllerEvent(event, candidates) {
  if (!event || !event.target || !event.target.getRootNode) return null;
  var root = event.target.getRootNode();
  var controllerHost = root && root.host;
  if (!controllerHost) return null;
  return candidates.find(function(video) {
    return video.vsc && video.vsc.div === controllerHost;
  }) || null;
}

function distanceSquaredToRect(x, y, rect) {
  if (!rect) return Infinity;
  var dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
  var dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  return dx * dx + dy * dy;
}

function getClosestMediaToPointer(candidates, pointerPosition) {
  if (!pointerPosition || !Array.isArray(candidates)) return null;
  var best = null;
  var bestDistance = Infinity;

  candidates.forEach(function(video) {
    if (!video || !video.vsc || !video.isConnected) return;
    var target = getControllerElement(video.vsc) || video;
    var rect = null;
    try {
      rect = target.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        rect = video.getBoundingClientRect();
      }
    } catch (_error) {
      return;
    }
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    var distance = distanceSquaredToRect(
      pointerPosition.x,
      pointerPosition.y,
      rect
    );
    if (distance < bestDistance) {
      best = video;
      bestDistance = distance;
    }
  });

  return best;
}

function resolveActionMediaTargets(event, specificVideo) {
  if (specificVideo && specificVideo.vsc) return [specificVideo];

  var docContext =
    event && event.target && event.target.ownerDocument
      ? event.target.ownerDocument
      : document;
  var candidates = tc.mediaElements.filter(function(video) {
    return Boolean(
      video &&
        video.vsc &&
        video.isConnected &&
        video.ownerDocument === docContext
    );
  });
  if (candidates.length <= 1) return candidates;

  var controllerMedia = getMediaFromControllerEvent(event, candidates);
  if (controllerMedia) {
    tc.lastInteractedMedia = controllerMedia;
    return [controllerMedia];
  }

  if (tc.settings.shortcutTargetMode === "all") return candidates;

  if (
    isOnYouTube() &&
    /^\/(watch|live)(\/|$)/.test(location.pathname)
  ) {
    var youtubeMain = candidates.find(function(video) {
      return video.closest && video.closest("#movie_player");
    });
    if (youtubeMain) return [youtubeMain];
  }

  var pointer =
    tc.lastPointerPosition && tc.lastPointerPosition.document === docContext
      ? tc.lastPointerPosition
      : null;
  var closest = getClosestMediaToPointer(candidates, pointer);
  if (closest) {
    tc.lastInteractedMedia = closest;
    return [closest];
  }

  if (
    tc.lastInteractedMedia &&
    candidates.indexOf(tc.lastInteractedMedia) !== -1
  ) {
    return [tc.lastInteractedMedia];
  }

  var primary = getPrimaryVideoElement(candidates);
  return primary ? [primary] : [];
}

function runAction(action, value, e) {
  log("runAction Begin", 5);
  const specificVideo = arguments[3] || null;
  var subtitleNudgeToggleValue = null;
  var mediaTagsToProcess = resolveActionMediaTargets(e, specificVideo);
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

  mediaTagsToProcess.forEach(function(v) {
    if (!v.vsc) return; // Don't process videos without a controller
    var controller = v.vsc.div;
    const userDrivenActionsThatShowController = [
      "rewind",
      "advance",
      "faster",
      "slower",
      "louder",
      "softer",
      "reset",
      "fast",
      "move",
      "pause",
      "muted",
      "mark",
      "jump",
      "drag",
      "nudge",
      "toggleSubtitleNudge",
      "display"
    ];
    var subtitleNudgeActionBlocked =
      (action === "toggleSubtitleNudge" || action === "nudge") &&
      !isSubtitleNudgeAvailableForVideo(v);
    if (
      userDrivenActionsThatShowController.includes(action) &&
      action !== "display" &&
      !subtitleNudgeActionBlocked
    ) {
      showController(controller, 2000, true);
    }
    if (v.classList.contains("vsc-cancelled")) return;
    const numValue = keyBindingUtils.sanitizeActionValue(
      action,
      value,
      getKeyBindings(action, "value")
    );
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
        if (tc.activeSiteRule && tc.activeSiteRule.preferredSpeed !== undefined) {
          preferredSpeed = keyBindingUtils.sanitizeActionValue(
            "fast",
            tc.activeSiteRule.preferredSpeed,
            preferredSpeed
          );
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
      case "louder":
        volumeUp(v, Number.isFinite(numValue) ? numValue : 0.1);
        break;
      case "softer":
        volumeDown(v, Number.isFinite(numValue) ? numValue : 0.1);
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
      case "nudge":
        setSubtitleNudgeEnabledForVideo(
          v,
          !isSubtitleNudgeEnabledForVideo(v)
        );
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
      setSpeed(v, speedToRestore, false, true, true);
    } else {
      // Not at 1.0, save current as toggle speed and go to 1.0
      lastToggleSpeed[videoId] = currentSpeed;
      v.vsc.resetToggleArmed = true;
      setSpeed(v, resetSpeedValue, false, true, true);
    }
  }
}

function muted(v) {
  var nextMuted = !v.muted;
  v.muted = nextMuted;
  if (!isOnYouTube()) return;
  var ytApi = getYouTubePlayerApi(v);
  if (!ytApi) return;
  if (nextMuted && typeof ytApi.mute === "function") ytApi.mute();
  if (!nextMuted && typeof ytApi.unMute === "function") ytApi.unMute();
}

function getYouTubePlayerApi(video) {
  if (!isOnYouTube()) return null;
  var playerEl =
    (video && video.closest ? video.closest(".html5-video-player") : null) ||
    document.getElementById("movie_player") ||
    document.querySelector(".html5-video-player");
  if (!playerEl) return null;
  return playerEl.wrappedJSObject || playerEl;
}

function syncYouTubePlayerVolume(video, volume) {
  var ytApi = getYouTubePlayerApi(video);
  if (!ytApi || typeof ytApi.setVolume !== "function") return;
  ytApi.setVolume(Math.round(volume * 100));
  if (volume > 0 && typeof ytApi.unMute === "function") {
    ytApi.unMute();
  }
}

function setVideoVolume(video, targetVolume) {
  var nextVolume = Math.max(0, Math.min(1, Number(targetVolume.toFixed(2))));
  video.volume = nextVolume;
  if (nextVolume > 0 && video.muted) {
    video.muted = false;
  }
  syncYouTubePlayerVolume(video, nextVolume);
}

function volumeUp(v, value) {
  setVideoVolume(v, v.volume + value);
}

function volumeDown(v, value) {
  setVideoVolume(v, v.volume - value);
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
  var pE =
    getControllerGeometryMount(video.vsc.controllerHostMount) ||
    c.parentElement ||
    (c.parentNode && c.parentNode.host);
  if (!pE || typeof pE.addEventListener !== "function") return;
  var nextParent = pE.parentElement;
  while (
    nextParent &&
    nextParent.offsetHeight === pE.offsetHeight &&
    nextParent.offsetWidth === pE.offsetWidth
  ) {
    pE = nextParent;
    nextParent = pE.parentElement;
  }
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

  controller.showTimeOut = setTimeout(function() {
    controller.classList.remove("vsc-show");
    controller.classList.remove("vsc-forced-show");
    if (controller.restoreHiddenAfterShow === true) {
      controller.classList.add("vsc-hidden");
    }
    controller.restoreHiddenAfterShow = false;
    controller.showTimeOut = undefined;
  }, duration);
}

// Keep each controller inside the subtree promoted to the fullscreen top layer,
// then restore its normal player-local mount when fullscreen exits.
function handleFullscreenControllerTransition() {
  tc.mediaElements.forEach((video) => {
    if (video.vsc) {
      syncControllerFullscreenMount(video.vsc);
      applyControllerLocation(video.vsc, video.vsc.controllerLocation);
    }
  });
}

[
  "fullscreenchange",
  "webkitfullscreenchange",
  "mozfullscreenchange",
  "MSFullscreenChange"
].forEach(function(eventName) {
  document.addEventListener(eventName, handleFullscreenControllerTransition);
});
