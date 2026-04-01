var regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;

var keyBindings = [];

var keyCodeAliases = {
  0: "null",
  null: "null",
  undefined: "null",
  32: "Space",
  37: "Left",
  38: "Up",
  39: "Right",
  40: "Down",
  96: "Num 0",
  97: "Num 1",
  98: "Num 2",
  99: "Num 3",
  100: "Num 4",
  101: "Num 5",
  102: "Num 6",
  103: "Num 7",
  104: "Num 8",
  105: "Num 9",
  106: "Num *",
  107: "Num +",
  109: "Num -",
  110: "Num .",
  111: "Num /",
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

var keyCodeToKey = {
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

var modifierKeys = new Set([
  "Alt",
  "AltGraph",
  "Control",
  "Fn",
  "Hyper",
  "Meta",
  "OS",
  "Shift"
]);

var displayKeyAliases = {
  " ": "Space",
  ArrowLeft: "Left",
  ArrowUp: "Up",
  ArrowRight: "Right",
  ArrowDown: "Down"
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

var controllerButtonDefs = {
  rewind:   { icon: "\u00AB", name: "Rewind" },
  slower:   { icon: "\u2212", name: "Decrease speed" },
  faster:   { icon: "+",      name: "Increase speed" },
  advance:  { icon: "\u00BB", name: "Advance" },
  display:  { icon: "\u00D7", name: "Close controller" },
  reset:    { icon: "1.00x", name: "Reset speed" },
  fast:     { icon: "\u2605", name: "Preferred speed" },
  nudge:    { icon: "\u2713", name: "Subtitle nudge" },
  settings: { icon: "\u2699", name: "Settings" },
  pause:    { icon: "\u23EF", name: "Pause / Play" },
  muted:    { icon: "M",      name: "Mute / Unmute" },
  mark:     { icon: "\u2691", name: "Set marker" },
  jump:     { icon: "\u21E5", name: "Jump to marker" }
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

var tcDefaults = {
  speed: 1.0,
  lastSpeed: 1.0,
  displayKeyCode: 86,
  rememberSpeed: false,
  audioBoolean: false,
  startHidden: false,
  hideWithYouTubeControls: false,
  hideWithControls: false,
  hideWithControlsTimer: 2.0,
  controllerLocation: "top-left",
  forceLastSavedSpeed: false,
  enabled: true,
  controllerOpacity: 0.3,
  controllerMarginTop: 0,
  controllerMarginRight: 0,
  controllerMarginBottom: 65,
  controllerMarginLeft: 0,
  keyBindings: [
    createDefaultBinding("display", "V", 86, 0),
    createDefaultBinding("move", "P", 80, 0),
    createDefaultBinding("slower", "S", 83, 0.1),
    createDefaultBinding("faster", "D", 68, 0.1),
    createDefaultBinding("rewind", "Z", 90, 10),
    createDefaultBinding("advance", "X", 88, 10),
    createDefaultBinding("reset", "R", 82, 1),
    createDefaultBinding("fast", "G", 71, 1.8),
    createDefaultBinding("toggleSubtitleNudge", "N", 78, 0)
  ],
  siteRules: [
    {
      pattern: "/^https:\\/\\/(www\\.)?youtube\\.com\\/(?!shorts\\/).*/",
      enabled: true,
      enableSubtitleNudge: true,
      subtitleNudgeInterval: 50
    },
    {
      pattern: "/^https:\\/\\/(www\\.)?youtube\\.com\\/shorts\\/.*/",
      enabled: true,
      controllerMarginTop: 60,
      controllerMarginBottom: 85
    }
  ],
  controllerButtons: ["rewind", "slower", "faster", "advance", "display"],
  showPopupControlBar: true,
  popupMatchHoverControls: true,
  popupControllerButtons: ["rewind", "slower", "faster", "advance", "display"],
  enableSubtitleNudge: false,
  subtitleNudgeInterval: 50,
  subtitleNudgeAmount: 0.001
};

const actionLabels = {
  display: "Show/hide controller",
  move: "Move controller",
  slower: "Decrease speed",
  faster: "Increase speed",
  rewind: "Rewind",
  advance: "Advance",
  reset: "Reset speed",
  fast: "Preferred speed",
  muted: "Mute",
  pause: "Pause",
  mark: "Set marker",
  jump: "Jump to marker",
  toggleSubtitleNudge: "Toggle subtitle nudge"
};

const speedBindingActions = ["slower", "faster", "fast"];

function formatSpeedBindingDisplay(action, value) {
  if (!speedBindingActions.includes(action)) {
    return value;
  }
  var n = Number(value);
  if (!isFinite(n)) {
    return value;
  }
  return n.toFixed(2);
}

const customActionsNoValues = [
  "reset",
  "display",
  "move",
  "muted",
  "pause",
  "mark",
  "jump",
  "toggleSubtitleNudge"
];

function refreshAddShortcutSelector() {
  const selector = document.getElementById("addShortcutSelector");
  if (!selector) return;

  // Clear existing options except the first one
  while (selector.options.length > 1) {
    selector.remove(1);
  }

  // Find all currently used actions
  const usedActions = new Set();
  document.querySelectorAll(".shortcut-row").forEach((row) => {
    const action = row.dataset.action;
    if (action) {
      usedActions.add(action);
    }
  });

  // Add all unused actions
  Object.keys(actionLabels).forEach((action) => {
    if (!usedActions.has(action)) {
      const option = document.createElement("option");
      option.value = action;
      option.text = actionLabels[action];
      selector.appendChild(option);
    }
  });

  // If no available actions, hide or disable the selector
  if (selector.options.length === 1) {
    selector.disabled = true;
    selector.options[0].text = "All shortcuts added";
  } else {
    selector.disabled = false;
    selector.options[0].text = "Add shortcut\u2026";
  }
}

function ensureDefaultBinding(storage, action, key, keyCode, value) {
  if (storage.keyBindings.some((item) => item.action === action)) return;

  storage.keyBindings.push(createDefaultBinding(action, key, keyCode, value));
}

function normalizeControllerLocation(location) {
  if (controllerLocations.includes(location)) return location;
  return tcDefaults.controllerLocation;
}

function clampMarginPxInput(el, fallback) {
  var n = parseInt(el && el.value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(200, Math.max(0, n));
}

function syncSiteRuleField(ruleEl, rule, key, isCheckbox) {
  var input = ruleEl.querySelector(".site-" + key);
  if (!input) return;
  var globalEl = document.getElementById(key);
  var value;
  if (rule && rule[key] !== undefined) {
    value = rule[key];
  } else if (globalEl) {
    value = isCheckbox ? globalEl.checked : globalEl.value;
  } else {
    return;
  }
  if (isCheckbox) input.checked = Boolean(value);
  else input.value = value;
}

function normalizeBindingKey(key) {
  if (typeof key !== "string" || key.length === 0) return null;
  if (key === "Spacebar") return " ";
  if (key === "Esc") return "Escape";
  if (key.length === 1 && /[a-z]/i.test(key)) return key.toUpperCase();
  return key;
}

function getLegacyKeyCode(binding) {
  if (!binding) return null;
  if (Number.isInteger(binding.keyCode)) return binding.keyCode;
  if (typeof binding.key === "number" && Number.isInteger(binding.key)) {
    return binding.key;
  }
  return null;
}

function legacyKeyCodeToBinding(keyCode) {
  if (!Number.isInteger(keyCode)) return null;
  var normalizedKey = keyCodeToKey[keyCode];
  if (!normalizedKey && keyCode >= 48 && keyCode <= 57) {
    normalizedKey = String.fromCharCode(keyCode);
  }
  if (!normalizedKey && keyCode >= 65 && keyCode <= 90) {
    normalizedKey = String.fromCharCode(keyCode);
  }
  return {
    key: normalizeBindingKey(normalizedKey),
    keyCode: keyCode,
    code: null,
    disabled: false
  };
}

function createDisabledBinding() {
  return {
    key: null,
    keyCode: null,
    code: null,
    disabled: true
  };
}

function normalizeStoredBinding(binding, fallbackKeyCode) {
  var fallbackBinding = legacyKeyCodeToBinding(fallbackKeyCode);
  if (!binding) {
    return fallbackBinding;
  }

  if (
    binding.disabled === true ||
    (binding.key === null &&
      binding.keyCode === null &&
      binding.code === null)
  ) {
    return createDisabledBinding();
  }

  var normalized = {
    key: null,
    keyCode: null,
    code:
      typeof binding.code === "string" && binding.code.length > 0
        ? binding.code
        : null,
    disabled: false
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

function getBindingLabel(binding) {
  if (!binding) return "";
  if (binding.disabled) return "";
  if (binding.key) {
    return displayKeyAliases[binding.key] || binding.key;
  }
  var legacyKeyCode = getLegacyKeyCode(binding);
  if (keyCodeAliases[legacyKeyCode]) return keyCodeAliases[legacyKeyCode];
  if (Number.isInteger(legacyKeyCode)) return String.fromCharCode(legacyKeyCode);
  return "";
}

function setShortcutInputBinding(input, binding) {
  input.vscBinding = binding ? Object.assign({}, binding) : null;
  input.keyCode =
    binding && Number.isInteger(binding.keyCode) ? binding.keyCode : null;
  input.value = getBindingLabel(binding);
}

function captureBindingFromEvent(event) {
  var normalizedKey = normalizeBindingKey(event.key);
  if (!normalizedKey || modifierKeys.has(normalizedKey)) return null;
  return {
    key: normalizedKey,
    keyCode: Number.isInteger(event.keyCode) ? event.keyCode : null,
    code: event.code || null,
    disabled: false
  };
}

function recordKeyPress(event) {
  if (event.key === "Tab") return;

  if (event.key === "Backspace") {
    setShortcutInputBinding(event.target, null);
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (event.key === "Escape") {
    setShortcutInputBinding(event.target, createDisabledBinding());
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  var binding = captureBindingFromEvent(event);
  if (!binding) return;

  setShortcutInputBinding(event.target, binding);
  event.preventDefault();
  event.stopPropagation();
}

function inputFilterNumbersOnly(event) {
  var char = String.fromCharCode(event.keyCode);
  if (
    !/[\d\.]$/.test(char) ||
    !/^\d+(\.\d*)?$/.test(event.target.value + char)
  ) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function inputFocus(event) {
  event.target.value = "";
}

function inputBlur(event) {
  setShortcutInputBinding(event.target, event.target.vscBinding || null);
}

function updateCustomShortcutInputText(inputItem, bindingOrKeyCode) {
  if (
    bindingOrKeyCode &&
    typeof bindingOrKeyCode === "object" &&
    !Array.isArray(bindingOrKeyCode)
  ) {
    setShortcutInputBinding(inputItem, bindingOrKeyCode);
    return;
  }

  setShortcutInputBinding(inputItem, legacyKeyCodeToBinding(bindingOrKeyCode));
}

function appendSelectOptions(select, options) {
  options.forEach(function (optionData) {
    var option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    select.appendChild(option);
  });
}

function add_shortcut(action, value) {
  if (!action) return;

  var div = document.createElement("div");
  div.setAttribute("class", "shortcut-row customs");
  div.dataset.action = action;

  var actionLabel = document.createElement("div");
  actionLabel.className = "shortcut-label";
  actionLabel.textContent = actionLabels[action] || action;

  var keyInput = document.createElement("input");
  keyInput.className = "customKey";
  keyInput.type = "text";
  keyInput.placeholder = "press a key";

  var valueInput = document.createElement("input");
  valueInput.className = "customValue";
  valueInput.type = "text";
  valueInput.placeholder = "value";
  if (customActionsNoValues.includes(action)) {
    valueInput.value = "N/A";
    valueInput.disabled = true;
  } else {
    valueInput.value = formatSpeedBindingDisplay(action, value || 0);
  }

  var removeButton = document.createElement("button");
  removeButton.className = "removeParent";
  removeButton.type = "button";
  removeButton.textContent = "\u00d7";

  div.appendChild(actionLabel);
  div.appendChild(keyInput);
  div.appendChild(valueInput);
  div.appendChild(removeButton);

  var customsElement = document.querySelector(".shortcuts-grid");
  customsElement.appendChild(div);
  
  refreshAddShortcutSelector();
}

function createKeyBindings(item) {
  var action = item.dataset.action || item.querySelector(".customDo").value;
  var input = item.querySelector(".customKey");
  var valueInput = item.querySelector(".customValue");
  var predefined = !!item.id;
  var fallbackKeyCode =
    predefined && action === "display"
      ? tcDefaults.displayKeyCode
      : undefined;
  var binding = normalizeStoredBinding(input.vscBinding, fallbackKeyCode);

  if (!binding) {
    return {
      valid: false,
      message: "Error: Shortcut for " + action + " is invalid. Unable to save"
    };
  }

  keyBindings.push({
    action: action,
    key: binding.key,
    keyCode: binding.keyCode,
    code: binding.code,
    disabled: binding.disabled === true,
    value: customActionsNoValues.includes(action)
      ? 0
      : Number(valueInput.value),
    force: false,
    predefined: predefined
  });

  return { valid: true };
}

function validate() {
  var valid = true;
  var status = document.getElementById("status");
  
  // Validate site rules patterns
  document.querySelectorAll(".site-rule").forEach((ruleEl) => {
    var pattern = ruleEl.querySelector(".site-pattern").value.trim();
    if (pattern.length === 0) return;
    
    if (pattern.startsWith("/")) {
      try {
        var lastSlash = pattern.lastIndexOf("/");
        if (lastSlash > 0) {
          new RegExp(pattern.substring(1, lastSlash), pattern.substring(lastSlash + 1));
        }
      } catch (err) {
        status.textContent =
          "Error: Invalid site rule regex: " + pattern + ". Unable to save";
        valid = false;
        return;
      }
    }
  });
  
  return valid;
}

function save_options() {
  if (validate() === false) return;

  keyBindings = [];
  var status = document.getElementById("status");
  var saveError = null;

  // Collect shortcuts from the main shortcuts section (both default and custom)
  Array.from(document.querySelectorAll("#customs .shortcut-row")).forEach((item) => {
    if (saveError) return;
    var result = createKeyBindings(item);
    if (!result.valid) saveError = result.message;
  });

  if (saveError) {
    status.textContent = saveError;
    return;
  }

  var settings = {};
  settings.rememberSpeed = document.getElementById("rememberSpeed").checked;
  settings.forceLastSavedSpeed =
    document.getElementById("forceLastSavedSpeed").checked;
  settings.audioBoolean = document.getElementById("audioBoolean").checked;
  settings.enabled = document.getElementById("enabled").checked;
  settings.startHidden = document.getElementById("startHidden").checked;
  settings.hideWithControls = document.getElementById("hideWithControls").checked;
  settings.hideWithControlsTimer =
    Math.min(15, Math.max(0.1, parseFloat(document.getElementById("hideWithControlsTimer").value) || tcDefaults.hideWithControlsTimer));

  // Sync back to the legacy key if it exists, for backward compatibility
  settings.hideWithYouTubeControls = settings.hideWithControls;

  if (settings.hideWithControlsTimer < 0.1) settings.hideWithControlsTimer = 0.1;
  if (settings.hideWithControlsTimer > 15) settings.hideWithControlsTimer = 15;

  settings.controllerLocation = normalizeControllerLocation(
    document.getElementById("controllerLocation").value
  );
  settings.controllerOpacity =
    parseFloat(document.getElementById("controllerOpacity").value) ||
    tcDefaults.controllerOpacity;

  settings.controllerMarginTop = clampMarginPxInput(
    document.getElementById("controllerMarginTop"),
    tcDefaults.controllerMarginTop
  );
  settings.controllerMarginBottom = clampMarginPxInput(
    document.getElementById("controllerMarginBottom"),
    tcDefaults.controllerMarginBottom
  );

  settings.keyBindings = keyBindings;
  settings.enableSubtitleNudge =
    document.getElementById("enableSubtitleNudge").checked;
  settings.subtitleNudgeInterval =
    parseInt(document.getElementById("subtitleNudgeInterval").value, 10) ||
    tcDefaults.subtitleNudgeInterval;
  settings.subtitleNudgeAmount = tcDefaults.subtitleNudgeAmount;

  if (settings.subtitleNudgeInterval < 10) {
    settings.subtitleNudgeInterval = 10;
  }
  if (settings.subtitleNudgeInterval > 1000) {
    settings.subtitleNudgeInterval = 1000;
  }

  settings.controllerButtons = getControlBarOrder();
  settings.showPopupControlBar =
    document.getElementById("showPopupControlBar").checked;
  settings.popupMatchHoverControls =
    document.getElementById("popupMatchHoverControls").checked;
  settings.popupControllerButtons = getPopupControlBarOrder();

  // Collect site rules
  settings.siteRules = [];
  document.querySelectorAll(".site-rule").forEach((ruleEl) => {
    var pattern = ruleEl.querySelector(".site-pattern").value.trim();
    if (pattern.length === 0) return;

    var rule = { pattern: pattern };

    // Handle Enable toggle
    rule.enabled = ruleEl.querySelector(".site-enabled").checked;

    if (ruleEl.querySelector(".override-placement").checked) {
      rule.controllerLocation = normalizeControllerLocation(
        ruleEl.querySelector(".site-controllerLocation").value
      );
      rule.controllerMarginTop = clampMarginPxInput(
        ruleEl.querySelector(".site-controllerMarginTop"),
        clampMarginPxInput(
          document.getElementById("controllerMarginTop"),
          tcDefaults.controllerMarginTop
        )
      );
      rule.controllerMarginBottom = clampMarginPxInput(
        ruleEl.querySelector(".site-controllerMarginBottom"),
        clampMarginPxInput(
          document.getElementById("controllerMarginBottom"),
          tcDefaults.controllerMarginBottom
        )
      );
    }

    if (ruleEl.querySelector(".override-visibility").checked) {
      rule.startHidden = ruleEl.querySelector(".site-startHidden").checked;
    }

    if (ruleEl.querySelector(".override-autohide").checked) {
      rule.hideWithControls = ruleEl.querySelector(".site-hideWithControls").checked;
      var st = parseFloat(
        ruleEl.querySelector(".site-hideWithControlsTimer").value
      );
      rule.hideWithControlsTimer = Math.min(
        15,
        Math.max(0.1, Number.isFinite(st) ? st : settings.hideWithControlsTimer)
      );
    }

    if (ruleEl.querySelector(".override-playback").checked) {
      rule.rememberSpeed = ruleEl.querySelector(".site-rememberSpeed").checked;
      rule.forceLastSavedSpeed =
        ruleEl.querySelector(".site-forceLastSavedSpeed").checked;
      rule.audioBoolean = ruleEl.querySelector(".site-audioBoolean").checked;
    }

    if (ruleEl.querySelector(".override-opacity").checked) {
      rule.controllerOpacity =
        parseFloat(ruleEl.querySelector(".site-controllerOpacity").value) ||
        settings.controllerOpacity;
    }

    if (ruleEl.querySelector(".override-subtitleNudge").checked) {
      rule.enableSubtitleNudge =
        ruleEl.querySelector(".site-enableSubtitleNudge").checked;
      var nudgeIv = parseInt(
        ruleEl.querySelector(".site-subtitleNudgeInterval").value,
        10
      );
      rule.subtitleNudgeInterval = Math.min(
        1000,
        Math.max(
          10,
          Number.isFinite(nudgeIv) ? nudgeIv : settings.subtitleNudgeInterval
        )
      );
    }

    if (ruleEl.querySelector(".override-controlbar").checked) {
      var activeZone = ruleEl.querySelector(".site-cb-active");
      if (activeZone) {
        rule.controllerButtons = readControlBarOrder(activeZone);
      }
    }

    if (ruleEl.querySelector(".override-popup-controlbar").checked) {
      rule.showPopupControlBar =
        ruleEl.querySelector(".site-showPopupControlBar").checked;
      var popupActiveZone = ruleEl.querySelector(".site-popup-cb-active");
      if (popupActiveZone) {
        rule.popupControllerButtons = readControlBarOrder(popupActiveZone);
      }
    }

    if (ruleEl.querySelector(".override-shortcuts").checked) {
      var shortcuts = [];
      ruleEl.querySelectorAll(".site-shortcuts-container .customs").forEach((shortcutRow) => {
        var action = shortcutRow.dataset.action;
        var keyInput = shortcutRow.querySelector(".customKey");
        var valueInput = shortcutRow.querySelector(".customValue");
        var forceCheckbox = shortcutRow.querySelector(".customForce");
        var binding = normalizeStoredBinding(keyInput.vscBinding);

        if (binding) {
          shortcuts.push({
            action: action,
            key: binding.key,
            keyCode: binding.keyCode,
            code: binding.code,
            disabled: binding.disabled === true,
            value: customActionsNoValues.includes(action)
              ? 0
              : Number(valueInput.value),
            force: forceCheckbox ? forceCheckbox.checked : false
          });
        }
      });
      if (shortcuts.length > 0) rule.shortcuts = shortcuts;
    }

    settings.siteRules.push(rule);
  });

  // Legacy keys to remove
  const legacyKeys = [
    "resetSpeed", "speedStep", "fastSpeed", "rewindTime", "advanceTime",
    "resetKeyCode", "slowerKeyCode", "fasterKeyCode", "rewindKeyCode",
    "advanceKeyCode", "fastKeyCode", "blacklist"
  ];

  chrome.storage.sync.remove(legacyKeys, function () {
    chrome.storage.sync.set(settings, function () {
      status.textContent = "Options saved";
      setTimeout(function () {
        status.textContent = "";
      }, 1000);
    });
  });
}

function ensureAllDefaultBindings(storage) {
  tcDefaults.keyBindings.forEach((binding) => {
    // Special case for "display" to support legacy displayKeyCode
    if (binding.action === "display" && storage.displayKeyCode) {
      ensureDefaultBinding(storage, "display", "V", storage.displayKeyCode, 0);
    } else {
      ensureDefaultBinding(
        storage,
        binding.action,
        binding.key,
        binding.keyCode,
        binding.value
      );
    }
  });
}

function migrateLegacyBlacklist(storage) {
  if (!storage.blacklist || typeof storage.blacklist !== "string") {
    return [];
  }

  var siteRules = [];
  var lines = storage.blacklist.split("\n");
  
  lines.forEach((line) => {
    var pattern = line.replace(regStrip, "");
    if (pattern.length === 0) return;
    
    siteRules.push({
      pattern: pattern,
      disableExtension: true
    });
  });

  return siteRules;
}

function addSiteRuleShortcut(container, action, binding, value, force) {
  var div = document.createElement("div");
  div.setAttribute("class", "shortcut-row customs");
  div.dataset.action = action;

  var actionLabel = document.createElement("div");
  actionLabel.className = "shortcut-label";
  var actionLabels = {
    display: "Show/hide controller",
    move: "Move controller",
    slower: "Decrease speed",
    faster: "Increase speed",
    rewind: "Rewind",
    advance: "Advance",
    reset: "Reset speed",
    fast: "Preferred speed",
    muted: "Mute",
    pause: "Pause",
    mark: "Set marker",
    jump: "Jump to marker",
    toggleSubtitleNudge: "Toggle subtitle nudge"
  };
  var actionLabelText = actionLabels[action] || action;
  if (action === "toggleSubtitleNudge") {
    // Check if the site rule is for YouTube.
    // We look up the pattern from the site rule element this container belongs to.
    var ruleEl = container.closest(".site-rule");
    var pattern = ruleEl ? ruleEl.querySelector(".site-pattern").value : "";
    if (!pattern.toLowerCase().includes("youtube.com")) {
      actionLabelText += " (only for YouTube embeds)";
    }
  }
  actionLabel.textContent = actionLabelText;

  var keyInput = document.createElement("input");
  keyInput.className = "customKey";
  keyInput.type = "text";
  keyInput.placeholder = "press a key";
  updateCustomShortcutInputText(keyInput, binding || createDisabledBinding());

  var valueInput = document.createElement("input");
  valueInput.className = "customValue";
  valueInput.type = "text";
  valueInput.placeholder = "value (0.10)";
  if (customActionsNoValues.includes(action)) {
    valueInput.value = "N/A";
    valueInput.disabled = true;
  } else {
    valueInput.value = formatSpeedBindingDisplay(action, value || 0);
  }

  var forceLabel = document.createElement("label");
  forceLabel.className = "force-label";
  forceLabel.title = "Prevent website from capturing this key";
  
  var forceCheckbox = document.createElement("input");
  forceCheckbox.type = "checkbox";
  forceCheckbox.className = "customForce";
  forceCheckbox.checked = force === true || force === "true";

  var forceText = document.createElement("span");
  forceText.textContent = "Block site from capturing keypress";
  forceText.className = "force-text";

  forceLabel.appendChild(forceCheckbox);
  forceLabel.appendChild(forceText);

  div.appendChild(actionLabel);
  div.appendChild(keyInput);
  div.appendChild(valueInput);
  div.appendChild(forceLabel);

  container.appendChild(div);
}

function createSiteRule(rule) {
  var template = document.getElementById("siteRuleTemplate");
  var clone = template.content.cloneNode(true);
  var ruleEl = clone.querySelector(".site-rule");

  var pattern = rule && rule.pattern ? rule.pattern : "";
  ruleEl.querySelector(".site-pattern").value = pattern;

  // Make the rule body collapsed by default
  var ruleBody = ruleEl.querySelector(".site-rule-body");
  ruleBody.style.display = "none";
  ruleEl.classList.add("collapsed");

  var enabledCheckbox = ruleEl.querySelector(".site-enabled");
  var contentEl = ruleEl.querySelector(".site-rule-content");

  function updateDisabledState() {
    if (enabledCheckbox.checked) {
      contentEl.classList.remove("disabled-rule");
    } else {
      contentEl.classList.add("disabled-rule");
    }
  }

  enabledCheckbox.addEventListener("change", updateDisabledState);

  if (rule) {
    if (rule.enabled !== undefined) {
      enabledCheckbox.checked = rule.enabled;
    } else if (rule.disableExtension !== undefined) {
      enabledCheckbox.checked = !rule.disableExtension;
    } else {
      enabledCheckbox.checked = true;
    }
  } else {
    enabledCheckbox.checked = true;
  }
  updateDisabledState();

  var placementKeys = [
    "controllerLocation",
    "controllerMarginTop",
    "controllerMarginBottom"
  ];
  var hasPlacementOverride =
    rule && placementKeys.some(function (k) { return rule[k] !== undefined; });
  if (hasPlacementOverride) {
    ruleEl.querySelector(".override-placement").checked = true;
    ruleEl.querySelector(".site-placement-container").style.display = "block";
  }
  syncSiteRuleField(ruleEl, rule, "controllerLocation", false);
  syncSiteRuleField(ruleEl, rule, "controllerMarginTop", false);
  syncSiteRuleField(ruleEl, rule, "controllerMarginBottom", false);

  if (rule && rule.startHidden !== undefined) {
    ruleEl.querySelector(".override-visibility").checked = true;
    ruleEl.querySelector(".site-visibility-container").style.display = "block";
  }
  syncSiteRuleField(ruleEl, rule, "startHidden", true);

  if (
    rule &&
    (rule.hideWithControls !== undefined ||
      rule.hideWithControlsTimer !== undefined)
  ) {
    ruleEl.querySelector(".override-autohide").checked = true;
    ruleEl.querySelector(".site-autohide-container").style.display = "block";
  }
  syncSiteRuleField(ruleEl, rule, "hideWithControls", true);
  syncSiteRuleField(ruleEl, rule, "hideWithControlsTimer", false);

  if (
    rule &&
    (rule.rememberSpeed !== undefined ||
      rule.forceLastSavedSpeed !== undefined ||
      rule.audioBoolean !== undefined)
  ) {
    ruleEl.querySelector(".override-playback").checked = true;
    ruleEl.querySelector(".site-playback-container").style.display = "block";
  }
  syncSiteRuleField(ruleEl, rule, "rememberSpeed", true);
  syncSiteRuleField(ruleEl, rule, "forceLastSavedSpeed", true);
  syncSiteRuleField(ruleEl, rule, "audioBoolean", true);

  if (rule && rule.controllerOpacity !== undefined) {
    ruleEl.querySelector(".override-opacity").checked = true;
    ruleEl.querySelector(".site-opacity-container").style.display = "block";
  }
  syncSiteRuleField(ruleEl, rule, "controllerOpacity", false);

  if (
    rule &&
    (rule.enableSubtitleNudge !== undefined ||
      rule.subtitleNudgeInterval !== undefined)
  ) {
    ruleEl.querySelector(".override-subtitleNudge").checked = true;
    ruleEl.querySelector(".site-subtitleNudge-container").style.display =
      "block";
  }
  syncSiteRuleField(ruleEl, rule, "enableSubtitleNudge", true);
  syncSiteRuleField(ruleEl, rule, "subtitleNudgeInterval", false);

  if (rule && Array.isArray(rule.controllerButtons)) {
    ruleEl.querySelector(".override-controlbar").checked = true;
    var cbContainer = ruleEl.querySelector(".site-controlbar-container");
    cbContainer.style.display = "block";
    populateControlBarZones(
      ruleEl.querySelector(".site-cb-active"),
      ruleEl.querySelector(".site-cb-available"),
      rule.controllerButtons
    );
  }

  if (
    rule &&
    (rule.showPopupControlBar !== undefined ||
      Array.isArray(rule.popupControllerButtons))
  ) {
    ruleEl.querySelector(".override-popup-controlbar").checked = true;
    var popupCbContainer = ruleEl.querySelector(".site-popup-controlbar-container");
    popupCbContainer.style.display = "block";
    var sitePopupActive = ruleEl.querySelector(".site-popup-cb-active");
    var sitePopupAvailable = ruleEl.querySelector(".site-popup-cb-available");
    if (Array.isArray(rule.popupControllerButtons)) {
      populateControlBarZones(
        sitePopupActive,
        sitePopupAvailable,
        rule.popupControllerButtons
      );
    } else if (
      sitePopupActive &&
      sitePopupAvailable &&
      sitePopupActive.children.length === 0
    ) {
      populateControlBarZones(
        sitePopupActive,
        sitePopupAvailable,
        getPopupControlBarOrder()
      );
    }
  }
  syncSiteRuleField(ruleEl, rule, "showPopupControlBar", true);

  if (rule && Array.isArray(rule.shortcuts) && rule.shortcuts.length > 0) {
    ruleEl.querySelector(".override-shortcuts").checked = true;
    var container = ruleEl.querySelector(".site-shortcuts-container");
    container.style.display = "block";

    rule.shortcuts.forEach((shortcut) => {
      addSiteRuleShortcut(
        container,
        shortcut.action,
        shortcut,
        shortcut.value,
        shortcut.force
      );
    });
  }

  document.getElementById("siteRulesContainer").appendChild(ruleEl);
}

function populateDefaultSiteShortcuts(container) {
  tcDefaults.keyBindings.forEach((binding) => {
    addSiteRuleShortcut(container, binding.action, binding, binding.value, false);
  });
}

function createControlBarBlock(buttonId) {
  var def = controllerButtonDefs[buttonId];
  if (!def) return null;

  var block = document.createElement("div");
  block.className = "cb-block";
  block.dataset.buttonId = buttonId;
  block.draggable = true;

  var grip = document.createElement("span");
  grip.className = "cb-grip";

  var icon = document.createElement("span");
  icon.className = "cb-icon";
  icon.textContent = def.icon;

  var label = document.createElement("span");
  label.className = "cb-label";
  label.textContent = def.name;

  block.appendChild(grip);
  block.appendChild(icon);
  block.appendChild(label);

  return block;
}

function populateControlBarZones(activeZone, availableZone, activeIds) {
  activeZone.innerHTML = "";
  availableZone.innerHTML = "";

  activeIds.forEach(function (id) {
    var block = createControlBarBlock(id);
    if (block) activeZone.appendChild(block);
  });

  Object.keys(controllerButtonDefs).forEach(function (id) {
    if (!activeIds.includes(id)) {
      var block = createControlBarBlock(id);
      if (block) availableZone.appendChild(block);
    }
  });
}

function readControlBarOrder(activeZone) {
  var blocks = activeZone.querySelectorAll(".cb-block");
  return Array.from(blocks).map(function (block) {
    return block.dataset.buttonId;
  });
}

function populateControlBarEditor(activeIds) {
  populateControlBarZones(
    document.getElementById("controlBarActive"),
    document.getElementById("controlBarAvailable"),
    activeIds
  );
}

function getControlBarOrder() {
  return readControlBarOrder(document.getElementById("controlBarActive"));
}

function populatePopupControlBarEditor(activeIds) {
  populateControlBarZones(
    document.getElementById("popupControlBarActive"),
    document.getElementById("popupControlBarAvailable"),
    activeIds
  );
}

function getPopupControlBarOrder() {
  return readControlBarOrder(document.getElementById("popupControlBarActive"));
}

function updatePopupEditorDisabledState() {
  var checkbox = document.getElementById("popupMatchHoverControls");
  var wrap = document.getElementById("popupCbEditorWrap");
  if (!checkbox || !wrap) return;
  if (checkbox.checked) {
    wrap.classList.add("cb-editor-disabled");
  } else {
    wrap.classList.remove("cb-editor-disabled");
  }
}

function getDragAfterElement(container, x, y) {
  var elements = Array.from(
    container.querySelectorAll(".cb-block:not(.cb-dragging)")
  );

  for (var i = 0; i < elements.length; i++) {
    var box = elements[i].getBoundingClientRect();
    var centerX = box.left + box.width / 2;
    var centerY = box.top + box.height / 2;
    var rowThresh = box.height * 0.5;

    if (y - centerY > rowThresh) continue;
    if (centerY - y > rowThresh) return elements[i];
    if (x < centerX) return elements[i];
  }

  return undefined;
}

function initControlBarEditor() {
  var draggedBlock = null;

  function clearControlBarDropTargets(activeZone) {
    document.querySelectorAll(".cb-dropzone.cb-over").forEach(function (zone) {
      if (zone !== activeZone) {
        zone.classList.remove("cb-over");
      }
    });
  }

  document.addEventListener("dragstart", function (e) {
    var block = e.target.closest(".cb-block");
    if (!block) return;
    draggedBlock = block;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", block.dataset.buttonId);
    requestAnimationFrame(function () {
      block.classList.add("cb-dragging");
    });
  });

  document.addEventListener("dragend", function (e) {
    var block = e.target.closest(".cb-block");
    if (!block) return;
    block.classList.remove("cb-dragging");
    draggedBlock = null;
    clearControlBarDropTargets(null);
  });

  document.addEventListener("dragover", function (e) {
    var zone = e.target.closest(".cb-dropzone");
    if (!zone) {
      clearControlBarDropTargets(null);
      return;
    }

    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    clearControlBarDropTargets(zone);
    zone.classList.add("cb-over");

    if (!draggedBlock) return;

    var afterEl = getDragAfterElement(zone, e.clientX, e.clientY);
    if (afterEl) {
      zone.insertBefore(draggedBlock, afterEl);
    } else {
      zone.appendChild(draggedBlock);
    }
  });

  document.addEventListener("drop", function (e) {
    var zone = e.target.closest(".cb-dropzone");
    if (zone) {
      e.preventDefault();
    }

    clearControlBarDropTargets(null);
  });
}

function restore_options() {
  chrome.storage.sync.get(tcDefaults, function (storage) {
    document.getElementById("rememberSpeed").checked = storage.rememberSpeed;
    document.getElementById("forceLastSavedSpeed").checked =
      storage.forceLastSavedSpeed;
    document.getElementById("audioBoolean").checked = storage.audioBoolean;
    document.getElementById("enabled").checked = storage.enabled;
    document.getElementById("startHidden").checked = storage.startHidden;

    // Migration/Normalization for hideWithControls
    const hideWithControls = typeof storage.hideWithControls !== "undefined"
      ? storage.hideWithControls
      : storage.hideWithYouTubeControls;
    
    document.getElementById("hideWithControls").checked = hideWithControls;
    document.getElementById("hideWithControlsTimer").value = 
      storage.hideWithControlsTimer || tcDefaults.hideWithControlsTimer;

    document.getElementById("controllerLocation").value =
      normalizeControllerLocation(storage.controllerLocation);
    document.getElementById("controllerOpacity").value =
      storage.controllerOpacity;
    document.getElementById("controllerMarginTop").value =
      storage.controllerMarginTop ?? tcDefaults.controllerMarginTop;
    document.getElementById("controllerMarginBottom").value =
      storage.controllerMarginBottom ?? tcDefaults.controllerMarginBottom;
    document.getElementById("showPopupControlBar").checked =
      storage.showPopupControlBar !== false;
    document.getElementById("enableSubtitleNudge").checked =
      storage.enableSubtitleNudge;
    document.getElementById("subtitleNudgeInterval").value =
      storage.subtitleNudgeInterval;

    if (!Array.isArray(storage.keyBindings) || storage.keyBindings.length === 0) {
      storage.keyBindings = tcDefaults.keyBindings.slice();
    }

    ensureAllDefaultBindings(storage);

    document.querySelectorAll(".customs:not([id])").forEach((row) => row.remove());

    storage.keyBindings.forEach((item) => {
      var row = document.getElementById(item.action);
      var normalizedBinding = normalizeStoredBinding(item);

      if (!row) {
        add_shortcut(item.action, item.value);
        row = document.querySelector(".shortcut-row.customs:last-of-type");
      }

      if (!row) return;

      var keyInput = row.querySelector(".customKey");
      if (keyInput) {
        updateCustomShortcutInputText(keyInput, normalizedBinding || null);
      }

      var valueInput = row.querySelector(".customValue");
      if (customActionsNoValues.includes(item.action)) {
        if (valueInput) {
          valueInput.value = "N/A";
          valueInput.disabled = true;
        }
      } else if (valueInput) {
        valueInput.value = formatSpeedBindingDisplay(item.action, item.value);
      }
    });

    refreshAddShortcutSelector();

    // Load site rules (use defaults if none in storage or if storage has empty array)
    var siteRules = Array.isArray(storage.siteRules) && storage.siteRules.length > 0
      ? storage.siteRules
      : (storage.blacklist ? migrateLegacyBlacklist(storage) : (tcDefaults.siteRules || []));

    // If we migrated from blacklist, save the new format
    if (storage.blacklist && siteRules.length > 0) {
      chrome.storage.sync.set({ siteRules: siteRules });
      chrome.storage.sync.remove(["blacklist"]);
    }

    document.getElementById("siteRulesContainer").innerHTML = "";
    if (siteRules.length > 0) {
      siteRules.forEach((rule) => {
        if (rule && rule.pattern) {
          createSiteRule(rule);
        }
      });
    }

    var controllerButtons = Array.isArray(storage.controllerButtons)
      ? storage.controllerButtons
      : tcDefaults.controllerButtons;
    populateControlBarEditor(controllerButtons);

    document.getElementById("popupMatchHoverControls").checked =
      storage.popupMatchHoverControls !== false;

    var popupButtons = Array.isArray(storage.popupControllerButtons)
      ? storage.popupControllerButtons
      : tcDefaults.popupControllerButtons;
    populatePopupControlBarEditor(popupButtons);
    updatePopupEditorDisabledState();
  });
}

function restore_defaults() {
  document.querySelectorAll(".customs:not([id])").forEach((el) => el.remove());

  chrome.storage.sync.set(tcDefaults, function () {
    restore_options();
    var status = document.getElementById("status");
    status.textContent = "Default options restored";
    setTimeout(function () {
      status.textContent = "";
    }, 1000);
  });
}

document.addEventListener("DOMContentLoaded", function () {
  var manifest = chrome.runtime.getManifest();
  var versionElement = document.getElementById("app-version");
  if (versionElement) {
    versionElement.textContent = manifest.version;
  }

  restore_options();
  initControlBarEditor();

  document.getElementById("popupMatchHoverControls")
    .addEventListener("change", updatePopupEditorDisabledState);

  document.getElementById("save").addEventListener("click", save_options);
  
  const addSelector = document.getElementById("addShortcutSelector");
  if (addSelector) {
    addSelector.addEventListener("change", function (e) {
      if (e.target.value) {
        add_shortcut(e.target.value);
        e.target.value = ""; // Reset selector
      }
    });
  }
  document
    .getElementById("restore")
    .addEventListener("click", restore_defaults);
  document
    .getElementById("addSiteRule")
    .addEventListener("click", function () {
      createSiteRule(null);
    });

  function eventCaller(event, className, funcName) {
    if (!event.target.classList || !event.target.classList.contains(className)) {
      return;
    }
    funcName(event);
  }

  document.addEventListener("keypress", (event) =>
    eventCaller(event, "customValue", inputFilterNumbersOnly)
  );
  document.addEventListener("focus", (event) =>
    eventCaller(event, "customKey", inputFocus)
  );
  document.addEventListener("blur", (event) =>
    eventCaller(event, "customKey", inputBlur)
  );
  document.addEventListener("keydown", (event) =>
    eventCaller(event, "customKey", recordKeyPress)
  );
  document.addEventListener("click", (event) => {
    if (event.target.classList.contains("removeParent")) {
      event.target.parentNode.remove();
      refreshAddShortcutSelector();
      return;
    }
    if (event.target.classList.contains("remove-site-rule")) {
      event.target.closest(".site-rule").remove();
      return;
    }
    if (event.target.classList.contains("toggle-site-rule")) {
      var ruleEl = event.target.closest(".site-rule");
      var ruleBody = ruleEl.querySelector(".site-rule-body");
      var isCollapsed = ruleEl.classList.contains("collapsed");
      
      if (isCollapsed) {
        ruleBody.style.display = "block";
        ruleEl.classList.remove("collapsed");
        event.target.textContent = "\u2212";
      } else {
        ruleBody.style.display = "none";
        ruleEl.classList.add("collapsed");
        event.target.textContent = "\u002b";
      }
      return;
    }
  });
  document.addEventListener("change", (event) => {
    if (event.target.classList.contains("customDo")) {
      var valueInput = event.target.nextElementSibling.nextElementSibling;
      if (customActionsNoValues.includes(event.target.value)) {
        valueInput.disabled = true;
        valueInput.value = 0;
      } else {
        valueInput.disabled = false;
      }
    }

    // Site rule: show/hide optional override sections
    var siteOverrideContainers = {
      "override-placement": "site-placement-container",
      "override-visibility": "site-visibility-container",
      "override-autohide": "site-autohide-container",
      "override-playback": "site-playback-container",
      "override-opacity": "site-opacity-container",
      "override-subtitleNudge": "site-subtitleNudge-container"
    };
    for (var ocb in siteOverrideContainers) {
      if (event.target.classList.contains(ocb)) {
        var siteRuleRoot = event.target.closest(".site-rule");
        var targetBox = siteRuleRoot.querySelector(
          "." + siteOverrideContainers[ocb]
        );
        if (targetBox) {
          targetBox.style.display = event.target.checked ? "block" : "none";
        }
        return;
      }
    }

    // Handle site rule override checkboxes
    if (event.target.classList.contains("override-shortcuts")) {
      var container = event.target
        .closest(".site-rule-shortcuts")
        .querySelector(".site-shortcuts-container");
      if (event.target.checked) {
        container.style.display = "block";
        if (container.children.length === 0) {
          populateDefaultSiteShortcuts(container);
        }
      } else {
        container.style.display = "none";
      }
    }

    if (event.target.classList.contains("override-controlbar")) {
      var cbContainer = event.target
        .closest(".site-rule-controlbar")
        .querySelector(".site-controlbar-container");
      if (event.target.checked) {
        cbContainer.style.display = "block";
        var activeZone = cbContainer.querySelector(".site-cb-active");
        var availableZone = cbContainer.querySelector(".site-cb-available");
        if (
          activeZone &&
          availableZone &&
          activeZone.children.length === 0 &&
          availableZone.children.length === 0
        ) {
          populateControlBarZones(
            activeZone,
            availableZone,
            getControlBarOrder()
          );
        }
      } else {
        cbContainer.style.display = "none";
      }
    }

    if (event.target.classList.contains("override-popup-controlbar")) {
      var popupCbContainer = event.target
        .closest(".site-rule-controlbar")
        .querySelector(".site-popup-controlbar-container");
      if (event.target.checked) {
        popupCbContainer.style.display = "block";
        var popupActiveZone = popupCbContainer.querySelector(".site-popup-cb-active");
        var popupAvailableZone = popupCbContainer.querySelector(".site-popup-cb-available");
        if (
          popupActiveZone &&
          popupAvailableZone &&
          popupActiveZone.children.length === 0 &&
          popupAvailableZone.children.length === 0
        ) {
          populateControlBarZones(
            popupActiveZone,
            popupAvailableZone,
            getPopupControlBarOrder()
          );
        }
      } else {
        popupCbContainer.style.display = "none";
      }
    }
  });
});
