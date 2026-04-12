var regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;
var speederShared =
  typeof SpeederShared === "object" && SpeederShared ? SpeederShared : {};
var controllerUtils = speederShared.controllerUtils || {};
var keyBindingUtils = speederShared.keyBindings || {};
var popupControlUtils = speederShared.popupControls || {};

var keyBindings = [];

var bindingCodeAliases = {
  Space: "Space",
  ArrowLeft: "Left",
  ArrowUp: "Up",
  ArrowRight: "Right",
  ArrowDown: "Down",
  Numpad0: "Num 0",
  Numpad1: "Num 1",
  Numpad2: "Num 2",
  Numpad3: "Num 3",
  Numpad4: "Num 4",
  Numpad5: "Num 5",
  Numpad6: "Num 6",
  Numpad7: "Num 7",
  Numpad8: "Num 8",
  Numpad9: "Num 9",
  NumpadMultiply: "Num *",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  NumpadDecimal: "Num .",
  NumpadDivide: "Num /",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/"
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

var controllerButtonDefs = {
  rewind:   { icon: "\u00AB", name: "Rewind" },
  slower:   { icon: "\u2212", name: "Decrease speed" },
  faster:   { icon: "+",      name: "Increase speed" },
  advance:  { icon: "\u00BB", name: "Advance" },
  display:  { icon: "\u00D7", name: "Close controller" },
  reset:    { icon: "\u21BB", name: "Reset speed" },
  fast:     { icon: "\u2605", name: "Preferred speed" },
  nudge:    { icon: "\u2713", name: "Subtitle nudge" },
  pause:    { icon: "\u23EF", name: "Play / Pause" },
  muted:    { icon: "M",      name: "Mute / Unmute" },
  louder:   { icon: "+",      name: "Increase volume" },
  softer:   { icon: "\u2212", name: "Decrease volume" },
  mark:     { icon: "\u2691", name: "Set marker" },
  jump:     { icon: "\u21E5", name: "Jump to marker" },
  settings: { icon: "\u2699", name: "Settings" },
};
var popupExcludedButtonIds = new Set(["settings"]);

/** Lucide picker only — not control-bar blocks (chip uses subtitleNudgeOn/Off). */
var lucideSubtitleNudgeActionLabels = {
  subtitleNudgeOn: "Subtitle nudge — enabled",
  subtitleNudgeOff: "Subtitle nudge — disabled"
};

function sanitizePopupButtonOrder(buttonIds) {
  return popupControlUtils.sanitizeButtonOrder(
    buttonIds,
    controllerButtonDefs,
    popupExcludedButtonIds
  );
}

/** Cached custom Lucide SVGs (mirrors chrome.storage.local customButtonIcons). */
var customButtonIconsLive = {};

function fillControlBarIconElement(icon, buttonId) {
  if (!icon || !buttonId) return;
  var doc = icon.ownerDocument || document;
  if (buttonId === "nudge") {
    vscClearElement(icon);
    icon.className = "cb-icon cb-icon-nudge-pair";
    function nudgeChipMarkup(action) {
      var c = customButtonIconsLive[action];
      if (c && c.svg) return c.svg;
      if (typeof vscIconSvgString === "function") {
        return vscIconSvgString(action, 14) || "";
      }
      return "";
    }
    function appendChip(action, stateKey) {
      var sp = document.createElement("span");
      sp.className = "cb-nudge-chip";
      sp.setAttribute("data-nudge-state", stateKey);
      var inner = nudgeChipMarkup(action);
      if (inner) {
        var wrap = vscCreateSvgWrap(doc, inner, "vsc-btn-icon");
        if (wrap) {
          sp.appendChild(wrap);
        }
      }
      icon.appendChild(sp);
    }
    appendChip("subtitleNudgeOn", "on");
    var sep = document.createElement("span");
    sep.className = "cb-nudge-sep";
    sep.textContent = "/";
    icon.appendChild(sep);
    appendChip("subtitleNudgeOff", "off");
    return;
  }
  icon.className = "cb-icon";
  var custom = customButtonIconsLive[buttonId];
  if (custom && custom.svg) {
    if (vscSetSvgContent(icon, custom.svg)) return;
  }
  if (typeof vscIconSvgString === "function") {
    var svgHtml = vscIconSvgString(buttonId, 16);
    if (svgHtml) {
      if (vscSetSvgContent(icon, svgHtml)) return;
    }
  }
  vscClearElement(icon);
  var def = controllerButtonDefs[buttonId];
  icon.textContent = (def && def.icon) || "?";
}

function createDefaultBinding(action, code, value) {
  return {
    action: action,
    code: code,
    value: value,
    force: false,
    predefined: true
  };
}

var tcDefaults = {
  speed: 1.0,
  lastSpeed: 1.0,
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
    createDefaultBinding("display", "KeyV", 0),
    createDefaultBinding("move", "KeyP", 0),
    createDefaultBinding("slower", "KeyS", 0.1),
    createDefaultBinding("faster", "KeyD", 0.1),
    createDefaultBinding("rewind", "KeyZ", 10),
    createDefaultBinding("advance", "KeyX", 10),
    createDefaultBinding("reset", "KeyR", 1),
    createDefaultBinding("fast", "KeyG", 1.8),
    createDefaultBinding("toggleSubtitleNudge", "KeyN", 0)
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
      rememberSpeed: true,
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
  toggleSubtitleNudge: "Toggle subtitle nudge",
  pause: "Play / Pause",
  muted: "Mute / Unmute",
  louder: "Increase volume",
  softer: "Decrease volume",
  mark: "Set marker",
  jump: "Jump to marker"
};

const speedBindingActions = ["slower", "faster", "fast", "softer", "louder"];
const requiredShortcutActions = new Set(["slower", "faster"]);

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

function getDefaultShortcutValue(action) {
  if (action === "louder" || action === "softer") {
    return 0.1;
  }
  var defaultBinding = tcDefaults.keyBindings.find(function (binding) {
    return binding.action === action;
  });
  if (defaultBinding && Number.isFinite(Number(defaultBinding.value))) {
    return Number(defaultBinding.value);
  }
  return 0;
}

function resolveShortcutValue(action, value) {
  if (value === undefined || value === null) {
    return getDefaultShortcutValue(action);
  }
  var numericValue = Number(value);
  if (Number.isFinite(numericValue)) {
    return numericValue;
  }
  return 0;
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

function refreshSiteRuleAddShortcutSelector(ruleEl) {
  if (!ruleEl) return;
  var selector = ruleEl.querySelector(".site-add-shortcut-selector");
  if (!selector) return;

  while (selector.options.length > 1) {
    selector.remove(1);
  }

  var usedActions = new Set();
  ruleEl.querySelectorAll(".site-shortcuts-rows .shortcut-row.customs").forEach(function (row) {
    var action = row.dataset.action;
    if (action) usedActions.add(action);
  });

  Object.keys(actionLabels).forEach(function (action) {
    if (!usedActions.has(action)) {
      var option = document.createElement("option");
      option.value = action;
      option.textContent = actionLabels[action];
      selector.appendChild(option);
    }
  });

  var overrideShortcutsOn =
    ruleEl.querySelector(".override-shortcuts") &&
    ruleEl.querySelector(".override-shortcuts").checked;

  if (selector.options.length === 1) {
    selector.disabled = true;
    selector.options[0].text = "All shortcuts added";
  } else {
    selector.disabled = !overrideShortcutsOn;
    selector.options[0].text = "Add shortcut\u2026";
  }
}

function getGlobalBindingSnapshotForSiteShortcut(action) {
  var row = document.querySelector(
    '#customs .shortcut-row[data-action="' + action + '"]'
  );
  if (row) {
    var keyInput = row.querySelector(".customKey");
    var binding = normalizeStoredBinding(keyInput && keyInput.vscBinding);
    if (binding) {
      var valueInput = row.querySelector(".customValue");
      var value = customActionsNoValues.includes(action)
        ? 0
        : Number(valueInput && valueInput.value);
      return { binding: binding, value: value };
    }
  }
  var def = tcDefaults.keyBindings.find(function (b) {
    return b.action === action;
  });
  if (def) {
    return {
      binding: normalizeStoredBinding(def),
      value: def.value
    };
  }
  return { binding: null, value: undefined };
}

function ensureDefaultBinding(storage, action, code, value) {
  if (storage.keyBindings.some((item) => item.action === action)) return;

  storage.keyBindings.push(createDefaultBinding(action, code, value));
}

function normalizeControllerLocation(location) {
  return controllerUtils.normalizeControllerLocation(
    location,
    tcDefaults.controllerLocation
  );
}

function clampMarginPxInput(el, fallback) {
  return controllerUtils.clampControllerMarginPx(el && el.value, fallback);
}

function parseFiniteNumberOrFallback(value, fallback) {
  var numericValue = parseFloat(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function updateSiteRuleToggleIcon(toggleButton, action) {
  if (!toggleButton) return;
  var iconEl = toggleButton.querySelector(".site-rule-toggle-icon");
  if (!iconEl) return;

  if (typeof vscIconSvgString === "function" && typeof vscSetSvgContent === "function") {
    var svgHtml = vscIconSvgString(action, 16);
    if (svgHtml && vscSetSvgContent(iconEl, svgHtml)) {
      return;
    }
  }

  iconEl.textContent = action === "chevronUp" ? "\u2212" : "\u2026";
}

function setSiteRuleExpandedState(ruleEl, expanded) {
  if (!ruleEl) return;

  var ruleBody = ruleEl.querySelector(".site-rule-body");
  var toggleButton = ruleEl.querySelector(".toggle-site-rule");
  if (ruleBody) {
    ruleBody.style.display = expanded ? "block" : "none";
  }

  ruleEl.classList.toggle("collapsed", !expanded);

  if (!toggleButton) return;
  var label = expanded ? "Collapse site rule" : "Expand site rule";
  toggleButton.title = label;
  toggleButton.setAttribute("aria-label", label);
  toggleButton.setAttribute("aria-expanded", expanded ? "true" : "false");
  updateSiteRuleToggleIcon(toggleButton, expanded ? "chevronUp" : "moreHorizontal");
}

function setSiteOverrideContainerState(container, enabled) {
  if (!container) return;

  container.classList.toggle("site-override-disabled", !enabled);
  container.setAttribute("aria-disabled", enabled ? "false" : "true");

  Array.prototype.forEach.call(
    container.querySelectorAll("input, select, textarea, button"),
    function (control) {
      control.disabled = !enabled;
    }
  );

  Array.prototype.forEach.call(
    container.querySelectorAll(".cb-block"),
    function (block) {
      block.draggable = enabled;
    }
  );
}

function applySiteRuleOverrideState(ruleEl, checkboxClass, containerClass) {
  if (!ruleEl) return;
  var checkbox = ruleEl.querySelector("." + checkboxClass);
  var container = ruleEl.querySelector("." + containerClass);
  if (!container) return;

  container.style.display = "block";
  setSiteOverrideContainerState(container, checkbox ? checkbox.checked : false);
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
  return keyBindingUtils.normalizeBindingKey(key);
}

function getLegacyKeyCode(binding) {
  return keyBindingUtils.getLegacyKeyCode(binding);
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

function createDisabledBinding() {
  return {
    code: null,
    disabled: true
  };
}

function normalizeStoredBinding(binding, fallbackCode) {
  if (!binding) {
    if (!fallbackCode) return null;
    return {
      code: fallbackCode,
      disabled: false
    };
  }

  if (
    binding.disabled === true ||
    (binding.code === null &&
      binding.key === null &&
      binding.keyCode === null)
  ) {
    return createDisabledBinding();
  }

  var normalizedCode = inferBindingCode(binding, fallbackCode);
  if (!normalizedCode) {
    return null;
  }

  var normalized = {
    code: normalizedCode,
    disabled: false
  };

  return normalized;
}

function formatBindingCode(code) {
  if (typeof code !== "string" || code.length === 0) return "";
  if (bindingCodeAliases[code]) return bindingCodeAliases[code];
  if (/^Key[A-Z]$/.test(code)) return code.substring(3);
  if (/^Digit[0-9]$/.test(code)) return code.substring(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return code;
}

function getBindingLabel(binding) {
  if (!binding) return "";
  if (binding.disabled) return "";
  return formatBindingCode(binding.code);
}

function setShortcutInputBinding(input, binding) {
  input.vscBinding = binding ? Object.assign({}, binding) : null;
  input.value = getBindingLabel(binding);
}

function captureBindingFromEvent(event) {
  if (modifierKeys.has(event.key)) return null;
  if (typeof event.code !== "string" || event.code.length === 0) return null;
  return {
    code: event.code,
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
  var char = event.key;
  if (
    typeof char !== "string" ||
    char.length !== 1 ||
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

  if (typeof bindingOrKeyCode === "string") {
    setShortcutInputBinding(inputItem, { code: bindingOrKeyCode, disabled: false });
    return;
  }

  setShortcutInputBinding(
    inputItem,
    normalizeStoredBinding({ keyCode: bindingOrKeyCode })
  );
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
    valueInput.value = formatSpeedBindingDisplay(
      action,
      resolveShortcutValue(action, value)
    );
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
  var binding = normalizeStoredBinding(input.vscBinding);

  if (!binding) {
    if (requiredShortcutActions.has(action)) {
      return {
        valid: false,
        message:
          "Error: Shortcut for " +
          (actionLabels[action] || action) +
          " cannot be empty. Unable to save"
      };
    }
    binding = createDisabledBinding();
  }

  if (binding.disabled === true && requiredShortcutActions.has(action)) {
    return {
      valid: false,
      message:
        "Error: Shortcut for " +
        (actionLabels[action] || action) +
        " cannot be empty. Unable to save"
    };
  }

  keyBindings.push({
    action: action,
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
    parseFiniteNumberOrFallback(
      document.getElementById("controllerOpacity").value,
      tcDefaults.controllerOpacity
    );

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
  settings.popupControllerButtons = sanitizePopupButtonOrder(getPopupControlBarOrder());

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
        parseFiniteNumberOrFallback(
          ruleEl.querySelector(".site-controllerOpacity").value,
          settings.controllerOpacity
        );
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
        rule.popupControllerButtons = sanitizePopupButtonOrder(
          readControlBarOrder(popupActiveZone)
        );
      }
    }

    if (ruleEl.querySelector(".override-shortcuts").checked) {
      var shortcuts = [];
      ruleEl.querySelectorAll(".site-shortcuts-container .customs").forEach((shortcutRow) => {
        if (saveError) return;
        var action = shortcutRow.dataset.action;
        var keyInput = shortcutRow.querySelector(".customKey");
        var valueInput = shortcutRow.querySelector(".customValue");
        var forceCheckbox = shortcutRow.querySelector(".customForce");
        var binding = normalizeStoredBinding(keyInput.vscBinding);

        if (!binding) {
          if (requiredShortcutActions.has(action)) {
            saveError =
              "Error: Site rule shortcut for " +
              (actionLabels[action] || action) +
              " cannot be empty. Unable to save";
            return;
          }
          binding = createDisabledBinding();
        }

        if (binding.disabled === true && requiredShortcutActions.has(action)) {
          saveError =
            "Error: Site rule shortcut for " +
            (actionLabels[action] || action) +
            " cannot be empty. Unable to save";
          return;
        }

        shortcuts.push({
          action: action,
          code: binding.code,
          disabled: binding.disabled === true,
          value: customActionsNoValues.includes(action)
            ? 0
            : Number(valueInput.value),
          force: forceCheckbox ? forceCheckbox.checked : false
        });
      });
      if (saveError) return;
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
    ensureDefaultBinding(storage, binding.action, binding.code, binding.value);
  });
}

function addSiteRuleShortcut(rowsEl, action, binding, value, force) {
  if (!rowsEl) return;

  var div = document.createElement("div");
  div.setAttribute("class", "shortcut-row customs");
  div.dataset.action = action;

  var actionLabel = document.createElement("div");
  actionLabel.className = "shortcut-label";
  var actionLabelText = actionLabels[action] || action;
  if (action === "toggleSubtitleNudge") {
    var ruleEl = rowsEl.closest(".site-rule");
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
    valueInput.value = formatSpeedBindingDisplay(
      action,
      resolveShortcutValue(action, value)
    );
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

  var removeButton = document.createElement("button");
  removeButton.className = "removeParent";
  removeButton.type = "button";
  removeButton.textContent = "\u00d7";

  div.appendChild(actionLabel);
  div.appendChild(keyInput);
  div.appendChild(valueInput);
  div.appendChild(forceLabel);
  div.appendChild(removeButton);

  rowsEl.appendChild(div);
}

function createSiteRule(rule) {
  var template = document.getElementById("siteRuleTemplate");
  var clone = template.content.cloneNode(true);
  var ruleEl = clone.querySelector(".site-rule");

  var pattern = rule && rule.pattern ? rule.pattern : "";
  ruleEl.querySelector(".site-pattern").value = pattern;

  // Make the rule body collapsed by default
  setSiteRuleExpandedState(ruleEl, false);

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
  ruleEl.querySelector(".override-placement").checked = Boolean(hasPlacementOverride);
  syncSiteRuleField(ruleEl, rule, "controllerLocation", false);
  syncSiteRuleField(ruleEl, rule, "controllerMarginTop", false);
  syncSiteRuleField(ruleEl, rule, "controllerMarginBottom", false);
  applySiteRuleOverrideState(ruleEl, "override-placement", "site-placement-container");

  ruleEl.querySelector(".override-visibility").checked = Boolean(
    rule && rule.startHidden !== undefined
  );
  syncSiteRuleField(ruleEl, rule, "startHidden", true);
  applySiteRuleOverrideState(ruleEl, "override-visibility", "site-visibility-container");

  var hasAutohideOverride = Boolean(
    rule &&
    (rule.hideWithControls !== undefined ||
      rule.hideWithControlsTimer !== undefined)
  );
  ruleEl.querySelector(".override-autohide").checked = hasAutohideOverride;
  syncSiteRuleField(ruleEl, rule, "hideWithControls", true);
  syncSiteRuleField(ruleEl, rule, "hideWithControlsTimer", false);
  applySiteRuleOverrideState(ruleEl, "override-autohide", "site-autohide-container");

  var hasPlaybackOverride = Boolean(
    rule &&
    (rule.rememberSpeed !== undefined ||
      rule.forceLastSavedSpeed !== undefined ||
      rule.audioBoolean !== undefined)
  );
  ruleEl.querySelector(".override-playback").checked = hasPlaybackOverride;
  syncSiteRuleField(ruleEl, rule, "rememberSpeed", true);
  syncSiteRuleField(ruleEl, rule, "forceLastSavedSpeed", true);
  syncSiteRuleField(ruleEl, rule, "audioBoolean", true);
  applySiteRuleOverrideState(ruleEl, "override-playback", "site-playback-container");

  ruleEl.querySelector(".override-opacity").checked = Boolean(
    rule && rule.controllerOpacity !== undefined
  );
  syncSiteRuleField(ruleEl, rule, "controllerOpacity", false);
  applySiteRuleOverrideState(ruleEl, "override-opacity", "site-opacity-container");

  var hasSubtitleNudgeOverride = Boolean(
    rule &&
    (rule.enableSubtitleNudge !== undefined ||
      rule.subtitleNudgeInterval !== undefined)
  );
  ruleEl.querySelector(".override-subtitleNudge").checked = hasSubtitleNudgeOverride;
  syncSiteRuleField(ruleEl, rule, "enableSubtitleNudge", true);
  syncSiteRuleField(ruleEl, rule, "subtitleNudgeInterval", false);
  applySiteRuleOverrideState(
    ruleEl,
    "override-subtitleNudge",
    "site-subtitleNudge-container"
  );

  var hasControlbarOverride = Boolean(rule && Array.isArray(rule.controllerButtons));
  ruleEl.querySelector(".override-controlbar").checked = hasControlbarOverride;
  populateControlBarZones(
    ruleEl.querySelector(".site-cb-active"),
    ruleEl.querySelector(".site-cb-available"),
    hasControlbarOverride ? rule.controllerButtons : getControlBarOrder()
  );
  applySiteRuleOverrideState(ruleEl, "override-controlbar", "site-controlbar-container");

  var hasPopupControlbarOverride = Boolean(
    rule &&
    (rule.showPopupControlBar !== undefined ||
      Array.isArray(rule.popupControllerButtons))
  );
  ruleEl.querySelector(".override-popup-controlbar").checked =
    hasPopupControlbarOverride;
  populateControlBarZones(
    ruleEl.querySelector(".site-popup-cb-active"),
    ruleEl.querySelector(".site-popup-cb-available"),
    hasPopupControlbarOverride && Array.isArray(rule.popupControllerButtons)
      ? sanitizePopupButtonOrder(rule.popupControllerButtons)
      : getPopupControlBarOrder(),
    function (id) {
      return !popupExcludedButtonIds.has(id);
    }
  );
  syncSiteRuleField(ruleEl, rule, "showPopupControlBar", true);
  applySiteRuleOverrideState(
    ruleEl,
    "override-popup-controlbar",
    "site-popup-controlbar-container"
  );

  var hasShortcutOverride = Boolean(
    rule && Array.isArray(rule.shortcuts) && rule.shortcuts.length > 0
  );
  ruleEl.querySelector(".override-shortcuts").checked = hasShortcutOverride;
  var rowsEl = ruleEl.querySelector(".site-shortcuts-rows");
  if (hasShortcutOverride) {
    rule.shortcuts.forEach((shortcut) => {
      addSiteRuleShortcut(
        rowsEl,
        shortcut.action,
        shortcut,
        shortcut.value,
        shortcut.force
      );
    });
  }
  applySiteRuleOverrideState(ruleEl, "override-shortcuts", "site-shortcuts-container");
  refreshSiteRuleAddShortcutSelector(ruleEl);

  document.getElementById("siteRulesContainer").appendChild(ruleEl);
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
  fillControlBarIconElement(icon, buttonId);

  var label = document.createElement("span");
  label.className = "cb-label";
  label.textContent = def.name;

  block.appendChild(grip);
  block.appendChild(icon);
  block.appendChild(label);

  return block;
}

function populateControlBarZones(activeZone, availableZone, activeIds, allowButtonId) {
  vscClearElement(activeZone);
  vscClearElement(availableZone);

  var allowed = function (id) {
    if (!controllerButtonDefs[id]) return false;
    return typeof allowButtonId === "function" ? Boolean(allowButtonId(id)) : true;
  };

  activeIds.forEach(function (id) {
    if (!allowed(id)) return;
    var block = createControlBarBlock(id);
    if (block) activeZone.appendChild(block);
  });

  Object.keys(controllerButtonDefs).forEach(function (id) {
    if (!allowed(id)) return;
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
  var popupActiveIds = sanitizePopupButtonOrder(activeIds);
  populateControlBarZones(
    document.getElementById("popupControlBarActive"),
    document.getElementById("popupControlBarAvailable"),
    popupActiveIds,
    function (id) {
      return !popupExcludedButtonIds.has(id);
    }
  );
}

function getPopupControlBarOrder() {
  return sanitizePopupButtonOrder(
    readControlBarOrder(document.getElementById("popupControlBarActive"))
  );
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

var lucidePickerSelectedSlug = null;
var lucideSearchTimer = null;

function setLucideStatus(msg) {
  var el = document.getElementById("lucideIconStatus");
  if (el) el.textContent = msg || "";
}

function repaintAllCbIconsFromCustomMap() {
  document.querySelectorAll(".cb-block .cb-icon").forEach(function (icon) {
    var block = icon.closest(".cb-block");
    if (!block) return;
    fillControlBarIconElement(icon, block.dataset.buttonId);
  });
}

function persistCustomButtonIcons(map, callback) {
  chrome.storage.local.set({ customButtonIcons: map }, function () {
    if (chrome.runtime.lastError) {
      setLucideStatus(
        "Could not save icons: " + chrome.runtime.lastError.message
      );
      return;
    }
    customButtonIconsLive = map;
    if (callback) callback();
    repaintAllCbIconsFromCustomMap();
  });
}

function initLucideButtonIconsUI() {
  var actionSel = document.getElementById("lucideIconActionSelect");
  var searchInput = document.getElementById("lucideIconSearch");
  var resultsEl = document.getElementById("lucideIconResults");
  var previewEl = document.getElementById("lucideIconPreview");
  if (!actionSel || !searchInput || !resultsEl || !previewEl) return;
  if (typeof getLucideTagsMap !== "function") return;

  if (!actionSel.dataset.lucideInit) {
    actionSel.dataset.lucideInit = "1";
    vscClearElement(actionSel);
    Object.keys(controllerButtonDefs).forEach(function (aid) {
      if (aid === "nudge") {
        Object.keys(lucideSubtitleNudgeActionLabels).forEach(function (subId) {
          var o2 = document.createElement("option");
          o2.value = subId;
          o2.textContent =
            lucideSubtitleNudgeActionLabels[subId] + " (" + subId + ")";
          actionSel.appendChild(o2);
        });
        return;
      }
      var o = document.createElement("option");
      o.value = aid;
      o.textContent =
        controllerButtonDefs[aid].name + " (" + aid + ")";
      actionSel.appendChild(o);
    });
  }

  function renderResults(slugs) {
    vscClearElement(resultsEl);
    slugs.forEach(function (slug) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "lucide-result-tile";
      b.dataset.slug = slug;
      b.title = slug;
      b.setAttribute("aria-label", slug);
      if (slug === lucidePickerSelectedSlug) {
        b.classList.add("lucide-picked");
      }
      var url =
        typeof lucideIconSvgUrl === "function" ? lucideIconSvgUrl(slug) : "";
      if (url) {
        var img = document.createElement("img");
        img.className = "lucide-result-thumb";
        img.src = url;
        img.alt = "";
        img.loading = "lazy";
        b.appendChild(img);
      } else {
        b.textContent = slug.slice(0, 3);
      }
      b.addEventListener("click", function () {
        lucidePickerSelectedSlug = slug;
        Array.prototype.forEach.call(
          resultsEl.querySelectorAll("button"),
          function (x) {
            x.classList.toggle("lucide-picked", x.dataset.slug === slug);
          }
        );
        fetchLucideSvg(slug)
          .then(function (txt) {
            var safe = sanitizeLucideSvg(txt);
            if (!safe) throw new Error("Bad SVG");
            if (!vscSetSvgContent(previewEl, safe)) {
              throw new Error("Preview render failed");
            }
            setLucideStatus("Preview: " + slug);
          })
          .catch(function (e) {
            vscClearElement(previewEl);
            setLucideStatus(
              "Could not load: " + slug + " — " + e.message
            );
          });
      });
      resultsEl.appendChild(b);
    });
  }

  if (!searchInput.dataset.lucideBound) {
    searchInput.dataset.lucideBound = "1";
    searchInput.addEventListener("input", function () {
      clearTimeout(lucideSearchTimer);
      lucideSearchTimer = setTimeout(function () {
        getLucideTagsMap(chrome.storage.local, false)
          .then(function (map) {
            var q = searchInput.value;
            if (!q.trim()) {
              vscClearElement(resultsEl);
              return;
            }
            renderResults(searchLucideSlugs(map, q, 48));
          })
          .catch(function (e) {
            setLucideStatus("Icon list error: " + e.message);
          });
      }, 200);
    });
  }

  var applyBtn = document.getElementById("lucideIconApply");
  if (applyBtn && !applyBtn.dataset.lucideBound) {
    applyBtn.dataset.lucideBound = "1";
    applyBtn.addEventListener("click", function () {
      var action = actionSel.value;
      var slug = lucidePickerSelectedSlug;
      if (!action || !slug) {
        setLucideStatus("Pick an action and click an icon first.");
        return;
      }
      fetchLucideSvg(slug)
        .then(function (txt) {
          var safe = sanitizeLucideSvg(txt);
          if (!safe) throw new Error("Sanitize failed");
          var next = Object.assign({}, customButtonIconsLive);
          next[action] = { slug: slug, svg: safe };
          persistCustomButtonIcons(next, function () {
            setLucideStatus(
              "Saved " +
                slug +
                " for " +
                action +
                ". Reload pages for the hover bar."
            );
          });
        })
        .catch(function (e) {
          setLucideStatus("Apply failed: " + e.message);
        });
    });
  }

  var clrOne = document.getElementById("lucideIconClearAction");
  if (clrOne && !clrOne.dataset.lucideBound) {
    clrOne.dataset.lucideBound = "1";
    clrOne.addEventListener("click", function () {
      var action = actionSel.value;
      if (!action) return;
      var next = Object.assign({}, customButtonIconsLive);
      delete next[action];
      persistCustomButtonIcons(next, function () {
        setLucideStatus("Cleared custom icon for " + action + ".");
      });
    });
  }

  var clrAll = document.getElementById("lucideIconClearAll");
  if (clrAll && !clrAll.dataset.lucideBound) {
    clrAll.dataset.lucideBound = "1";
    clrAll.addEventListener("click", function () {
      persistCustomButtonIcons({}, function () {
        setLucideStatus("All custom icons cleared.");
      });
    });
  }

  var reloadTags = document.getElementById("lucideIconReloadTags");
  if (reloadTags && !reloadTags.dataset.lucideBound) {
    reloadTags.dataset.lucideBound = "1";
    reloadTags.addEventListener("click", function () {
      getLucideTagsMap(chrome.storage.local, true)
        .then(function () {
          setLucideStatus("Icon name list refreshed.");
        })
        .catch(function (e) {
          setLucideStatus("Refresh failed: " + e.message);
        });
    });
  }
}

function restore_options() {
  chrome.storage.sync.get(tcDefaults, function (storage) {
    chrome.storage.local.get(["customButtonIcons"], function (loc) {
      customButtonIconsLive =
        loc && loc.customButtonIcons && typeof loc.customButtonIcons === "object"
          ? loc.customButtonIcons
          : {};

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

    // Load site rules (use defaults if none in storage or empty array)
    var siteRules =
      Array.isArray(storage.siteRules) && storage.siteRules.length > 0
        ? storage.siteRules
        : tcDefaults.siteRules || [];

    vscClearElement(document.getElementById("siteRulesContainer"));
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

    initLucideButtonIconsUI();
    });
  });
}

function restore_defaults() {
  document.querySelectorAll(".customs:not([id])").forEach((el) => el.remove());

  chrome.storage.local.remove(
    ["customButtonIcons", "lucideTagsCacheV1", "lucideTagsCacheV1At"],
    function () {}
  );

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
    var target = event.target;
    var targetEl = target && target.closest ? target : target.parentElement;
    if (!targetEl) return;

    var removeParentButton = targetEl.closest(".removeParent");
    if (removeParentButton) {
      var removedRow = removeParentButton.parentNode;
      var siteRuleForShortcut = removedRow.closest(".site-rule");
      removedRow.remove();
      refreshAddShortcutSelector();
      if (siteRuleForShortcut) {
        refreshSiteRuleAddShortcutSelector(siteRuleForShortcut);
      }
      return;
    }
    var removeSiteRuleButton = targetEl.closest(".remove-site-rule");
    if (removeSiteRuleButton) {
      removeSiteRuleButton.closest(".site-rule").remove();
      return;
    }
    var toggleButton = targetEl.closest(".toggle-site-rule");
    if (toggleButton) {
      var ruleEl = toggleButton.closest(".site-rule");
      var isCollapsed = ruleEl.classList.contains("collapsed");
      setSiteRuleExpandedState(ruleEl, isCollapsed);
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

    if (event.target.classList.contains("site-add-shortcut-selector")) {
      var action = event.target.value;
      if (!action) return;
      var siteRuleRoot = event.target.closest(".site-rule");
      var rows = siteRuleRoot && siteRuleRoot.querySelector(".site-shortcuts-rows");
      if (rows) {
        var snap = getGlobalBindingSnapshotForSiteShortcut(action);
        addSiteRuleShortcut(
          rows,
          action,
          snap.binding,
          snap.value,
          false
        );
        refreshSiteRuleAddShortcutSelector(siteRuleRoot);
      }
      event.target.value = "";
      return;
    }

    // Site rule: show/hide optional override sections
    var siteOverrideContainers = {
      "override-placement": "site-placement-container",
      "override-visibility": "site-visibility-container",
      "override-autohide": "site-autohide-container",
      "override-playback": "site-playback-container",
      "override-opacity": "site-opacity-container",
      "override-subtitleNudge": "site-subtitleNudge-container",
      "override-controlbar": "site-controlbar-container",
      "override-popup-controlbar": "site-popup-controlbar-container",
      "override-shortcuts": "site-shortcuts-container"
    };
    for (var ocb in siteOverrideContainers) {
      if (event.target.classList.contains(ocb)) {
        var siteRuleRoot = event.target.closest(".site-rule");
        var targetBox = siteRuleRoot.querySelector(
          "." + siteOverrideContainers[ocb]
        );
        if (targetBox) {
          setSiteOverrideContainerState(targetBox, event.target.checked);
        }
        if (ocb === "override-shortcuts") {
          refreshSiteRuleAddShortcutSelector(siteRuleRoot);
        }
        return;
      }
    }
  });
});
