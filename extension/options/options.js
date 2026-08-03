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

var tcDefaults = vscGetSettingsDefaults();
var optionsSyncSettingsLoaded = false;
var autoSaveTimer = null;
var saveStatusTimer = null;

function scheduleAutoSave() {
  if (!optionsSyncSettingsLoaded) return;
  clearTimeout(autoSaveTimer);
  var sourceSaveButton = document.getElementById("save");
  var scheduledTimer = setTimeout(function () {
    if (
      autoSaveTimer !== scheduledTimer ||
      !sourceSaveButton ||
      !sourceSaveButton.isConnected
    ) {
      return;
    }
    autoSaveTimer = null;
    save_options(true);
  }, 300);
  autoSaveTimer = scheduledTimer;
}

function setOptionsSyncSettingsLoaded(loaded) {
  optionsSyncSettingsLoaded = loaded === true;
  if (!optionsSyncSettingsLoaded) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  var saveButton = document.getElementById("save");
  if (saveButton) {
    saveButton.disabled = !optionsSyncSettingsLoaded;
    saveButton.setAttribute(
      "aria-busy",
      optionsSyncSettingsLoaded ? "false" : "true"
    );
  }
}

function persistManagedSyncSettings(settings, callback, existingStorage) {
  function persistFromRaw(rawStorage) {
    // Preserve canonical values that this version of the Options UI does not
    // expose (for example legacy left/right placement margins). A caller can
    // still reset every managed value by passing the complete defaults object.
    var completeSettings = vscDeepMergeDefaults(
      vscExpandStoredSettings(rawStorage || {}),
      settings || {}
    );
    var mutation = vscBuildManagedStorageMutation(
      rawStorage,
      completeSettings
    );

    function removeStaleKeys() {
      if (!mutation.remove.length) {
        callback(null);
        return;
      }
      chrome.storage.sync.remove(mutation.remove, function () {
        callback(chrome.runtime.lastError || null);
      });
    }

    if (Object.keys(mutation.set).length === 0) {
      removeStaleKeys();
      return;
    }

    chrome.storage.sync.set(mutation.set, function () {
      if (chrome.runtime.lastError) {
        callback(chrome.runtime.lastError);
        return;
      }
      removeStaleKeys();
    });
  }

  if (existingStorage && typeof existingStorage === "object") {
    persistFromRaw(existingStorage);
    return;
  }

  chrome.storage.sync.get(null, function (rawStorage) {
    if (chrome.runtime.lastError) {
      callback(chrome.runtime.lastError);
      return;
    }
    persistFromRaw(rawStorage || {});
  });
}

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
  return keyBindingUtils.sanitizeActionValue(
    action,
    value,
    getDefaultShortcutValue(action)
  );
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

  Object.keys(actionLabels).forEach((action) => {
    const option = document.createElement("option");
    option.value = action;
    option.text = actionLabels[action];
    selector.appendChild(option);
  });

  selector.disabled = false;
  selector.options[0].text = "Add shortcut\u2026";
}

function refreshSiteRuleAddShortcutSelector(ruleEl) {
  if (!ruleEl) return;
  var selector = ruleEl.querySelector(".site-add-shortcut-selector");
  if (!selector) return;

  while (selector.options.length > 1) {
    selector.remove(1);
  }

  Object.keys(actionLabels).forEach(function (action) {
    var option = document.createElement("option");
    option.value = action;
    option.textContent = actionLabels[action];
    selector.appendChild(option);
  });

  var overrideShortcutsOn =
    ruleEl.querySelector(".override-shortcuts") &&
    ruleEl.querySelector(".override-shortcuts").checked;

  selector.disabled = !overrideShortcutsOn;
  selector.options[0].text = "Add shortcut\u2026";
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

function readOptionalPreferredSpeedInput(input) {
  var rawValue = input && typeof input.value === "string"
    ? input.value.trim()
    : "";
  if (!rawValue) return undefined;
  var parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(
    keyBindingUtils.MAX_SPEED,
    Math.max(keyBindingUtils.MIN_SPEED, parsed)
  );
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
    shiftKey: binding.shiftKey === true,
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
  return (binding.shiftKey ? "Shift+" : "") + formatBindingCode(binding.code);
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
    shiftKey: event.shiftKey === true,
    disabled: false
  };
}

function recordKeyPress(event) {
  if (event.key === "Tab") return;

  if (event.key === "Backspace") {
    setShortcutInputBinding(event.target, null);
    scheduleAutoSave();
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (event.key === "Escape") {
    setShortcutInputBinding(event.target, createDisabledBinding());
    scheduleAutoSave();
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  var binding = captureBindingFromEvent(event);
  if (!binding) return;

  setShortcutInputBinding(event.target, binding);
  scheduleAutoSave();
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

function labelShortcutRow(row) {
  if (!row) return;
  var action = row.dataset.action;
  var name = actionLabels[action] || action || "Shortcut";
  var keyInput = row.querySelector(".customKey");
  var valueInput = row.querySelector(".customValue");
  var removeButton = row.querySelector(".removeParent");
  if (keyInput) keyInput.setAttribute("aria-label", name + " key");
  if (valueInput) valueInput.setAttribute("aria-label", name + " value");
  if (removeButton) {
    removeButton.setAttribute("aria-label", "Remove " + name + " shortcut");
  }
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
  labelShortcutRow(div);

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

  var bindingValue = 0;
  if (!customActionsNoValues.includes(action)) {
    var valueError = keyBindingUtils.getActionValueError(
      action,
      valueInput.value
    );
    if (valueError) {
      return {
        valid: false,
        message:
          "Error: Value for " +
          (actionLabels[action] || action) +
          " " +
          valueError +
          ". Unable to save"
      };
    }
    bindingValue = Number(valueInput.value);
  }

  keyBindings.push({
    action: action,
    code: binding.code,
    shiftKey: binding.shiftKey === true,
    disabled: binding.disabled === true,
    value: bindingValue,
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
        if (lastSlash === 0) throw new Error("Missing closing slash");
        new RegExp(pattern.substring(1, lastSlash), pattern.substring(lastSlash + 1));
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

function save_options(isAutoSave) {
  clearTimeout(autoSaveTimer);
  clearTimeout(saveStatusTimer);
  autoSaveTimer = null;
  var status = document.getElementById("status");
  if (!optionsSyncSettingsLoaded) {
    status.textContent =
      "Error: Settings have not loaded. Retry before saving.";
    return;
  }
  if (validate() === false) return;

  keyBindings = [];
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
  settings.showAmbientLoopControls =
    document.getElementById("showAmbientLoopControls").checked;
  settings.enabled = document.getElementById("enabled").checked;
  settings.startHidden = document.getElementById("startHidden").checked;
  settings.shortcutTargetMode =
    document.getElementById("shortcutTargetMode").value === "all"
      ? "all"
      : "closest";
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
  settings.subtitleNudgeEnabledByDefault =
    document.getElementById("subtitleNudgeEnabledByDefault").checked;
  settings.subtitleNudgeInterval =
    parseInt(document.getElementById("subtitleNudgeInterval").value, 10) ||
    tcDefaults.subtitleNudgeInterval;

  if (settings.subtitleNudgeInterval < 250) {
    settings.subtitleNudgeInterval = 250;
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

    var rule = vscClonePlainData(ruleEl.vscOriginalRule) || {};
    rule.pattern = pattern;
    var title = ruleEl.querySelector(".site-title").value.trim();
    if (title) rule.title = title;
    else delete rule.title;
    delete rule.disableExtension;

    // Handle Enable toggle
    rule.enabled = ruleEl.querySelector(".site-enabled").checked;

    if (ruleEl.querySelector(".override-shortcut-target").checked) {
      rule.shortcutTargetMode =
        ruleEl.querySelector(".site-shortcutTargetMode").value === "all"
          ? "all"
          : "closest";
    } else {
      delete rule.shortcutTargetMode;
    }

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
    } else {
      delete rule.controllerLocation;
      delete rule.controllerMarginTop;
      delete rule.controllerMarginBottom;
    }

    if (ruleEl.querySelector(".override-visibility").checked) {
      rule.startHidden = ruleEl.querySelector(".site-startHidden").checked;
    } else {
      delete rule.startHidden;
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
    } else {
      delete rule.hideWithControls;
      delete rule.hideWithControlsTimer;
    }

    if (ruleEl.querySelector(".override-playback").checked) {
      rule.rememberSpeed = ruleEl.querySelector(".site-rememberSpeed").checked;
      rule.forceLastSavedSpeed =
        ruleEl.querySelector(".site-forceLastSavedSpeed").checked;
      var preferredSpeed = readOptionalPreferredSpeedInput(
        ruleEl.querySelector(".site-preferredSpeed")
      );
      if (preferredSpeed === undefined) {
        delete rule.preferredSpeed;
      } else {
        rule.preferredSpeed = preferredSpeed;
      }
      rule.audioBoolean = ruleEl.querySelector(".site-audioBoolean").checked;
      rule.showAmbientLoopControls = ruleEl.querySelector(
        ".site-showAmbientLoopControls"
      ).checked;
    } else {
      delete rule.rememberSpeed;
      delete rule.forceLastSavedSpeed;
      delete rule.preferredSpeed;
      delete rule.audioBoolean;
      delete rule.showAmbientLoopControls;
    }

    if (ruleEl.querySelector(".override-opacity").checked) {
      rule.controllerOpacity =
        parseFiniteNumberOrFallback(
          ruleEl.querySelector(".site-controllerOpacity").value,
          settings.controllerOpacity
        );
    } else {
      delete rule.controllerOpacity;
    }

    if (ruleEl.querySelector(".override-subtitleNudge").checked) {
      rule.enableSubtitleNudge =
        ruleEl.querySelector(".site-enableSubtitleNudge").checked;
      rule.subtitleNudgeEnabledByDefault =
        ruleEl.querySelector(".site-subtitleNudgeEnabledByDefault").checked;
      var nudgeIv = parseInt(
        ruleEl.querySelector(".site-subtitleNudgeInterval").value,
        10
      );
      rule.subtitleNudgeInterval = Math.min(
        1000,
        Math.max(
          250,
          Number.isFinite(nudgeIv) ? nudgeIv : settings.subtitleNudgeInterval
        )
      );
    } else {
      delete rule.enableSubtitleNudge;
      delete rule.subtitleNudgeEnabledByDefault;
      delete rule.subtitleNudgeInterval;
    }

    if (ruleEl.querySelector(".override-controlbar").checked) {
      var activeZone = ruleEl.querySelector(".site-cb-active");
      if (activeZone) {
        rule.controllerButtons = readControlBarOrder(activeZone);
      }
    } else {
      delete rule.controllerButtons;
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
    } else {
      delete rule.showPopupControlBar;
      delete rule.popupControllerButtons;
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

        var shortcutValue = 0;
        if (!customActionsNoValues.includes(action)) {
          var shortcutValueError = keyBindingUtils.getActionValueError(
            action,
            valueInput.value
          );
          if (shortcutValueError) {
            saveError =
              "Error: Site rule value for " +
              (actionLabels[action] || action) +
              " " +
              shortcutValueError +
              ". Unable to save";
            return;
          }
          shortcutValue = Number(valueInput.value);
        }

        shortcuts.push({
          action: action,
          code: binding.code,
          shiftKey: binding.shiftKey === true,
          disabled: binding.disabled === true,
          value: shortcutValue,
          force: forceCheckbox ? forceCheckbox.checked : false
        });
      });
      if (saveError) return;
      if (shortcuts.length > 0) rule.shortcuts = shortcuts;
      else delete rule.shortcuts;
    } else {
      delete rule.shortcuts;
    }

    settings.siteRules.push(rule);
  });

  if (saveError) {
    status.textContent = saveError;
    return;
  }

  persistManagedSyncSettings(settings, function (error) {
    if (error) {
      status.textContent = "Error: Unable to save options - " + error.message;
      return;
    }
    status.textContent = isAutoSave === true ? "Auto-saved" : "Options saved";
    saveStatusTimer = setTimeout(function () {
      status.textContent = "";
    }, 1000);
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
  actionLabel.textContent = actionLabels[action] || action;

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
  labelShortcutRow(div);

  rowsEl.appendChild(div);
}

var siteRuleControlId = 0;

function associateSiteRuleLabels(ruleEl) {
  ruleEl.querySelectorAll(".site-rule-option").forEach(function(option) {
    var label = Array.from(option.children).find(function(child) {
      return child.tagName === "LABEL";
    });
    var controls = option.querySelectorAll("input, select, textarea");
    if (!label || controls.length !== 1 || label.contains(controls[0])) return;
    controls[0].id = "site-rule-control-" + ++siteRuleControlId;
    label.htmlFor = controls[0].id;
  });

  ruleEl.querySelectorAll(".margin-pad-cell").forEach(function(cell) {
    var input = cell.querySelector("input");
    var miniLabel = cell.querySelector(".margin-pad-mini");
    if (input && miniLabel) {
      input.setAttribute(
        "aria-label",
        "Controller margin " +
          (miniLabel.textContent === "T" ? "top" : "bottom")
      );
    }
  });

  var removeRule = ruleEl.querySelector(".remove-site-rule");
  if (removeRule) removeRule.setAttribute("aria-label", "Remove site rule");
}

function createSiteRule(rule) {
  var template = document.getElementById("siteRuleTemplate");
  var clone = template.content.cloneNode(true);
  var ruleEl = clone.querySelector(".site-rule");
  ruleEl.vscOriginalRule = vscClonePlainData(rule) || {};

  var pattern = rule && rule.pattern ? rule.pattern : "";
  ruleEl.querySelector(".site-pattern").value = pattern;
  ruleEl.querySelector(".site-title").value =
    rule && typeof rule.title === "string" ? rule.title : "";

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

  ruleEl.querySelector(".override-shortcut-target").checked = Boolean(
    rule && rule.shortcutTargetMode !== undefined
  );
  ruleEl.querySelector(".site-shortcutTargetMode").value =
    rule && rule.shortcutTargetMode === "all" ? "all" : "closest";
  applySiteRuleOverrideState(
    ruleEl,
    "override-shortcut-target",
    "site-shortcut-target-container"
  );

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
      rule.preferredSpeed !== undefined ||
      rule.audioBoolean !== undefined ||
      rule.showAmbientLoopControls !== undefined)
  );
  ruleEl.querySelector(".override-playback").checked = hasPlaybackOverride;
  syncSiteRuleField(ruleEl, rule, "rememberSpeed", true);
  syncSiteRuleField(ruleEl, rule, "forceLastSavedSpeed", true);
  ruleEl.querySelector(".site-preferredSpeed").value =
    rule && Number.isFinite(Number(rule.preferredSpeed))
      ? String(rule.preferredSpeed)
      : "";
  syncSiteRuleField(ruleEl, rule, "audioBoolean", true);
  syncSiteRuleField(ruleEl, rule, "showAmbientLoopControls", true);
  applySiteRuleOverrideState(ruleEl, "override-playback", "site-playback-container");

  ruleEl.querySelector(".override-opacity").checked = Boolean(
    rule && rule.controllerOpacity !== undefined
  );
  syncSiteRuleField(ruleEl, rule, "controllerOpacity", false);
  applySiteRuleOverrideState(ruleEl, "override-opacity", "site-opacity-container");

  var hasSubtitleNudgeOverride = Boolean(
    rule &&
    (rule.enableSubtitleNudge !== undefined ||
      rule.subtitleNudgeEnabledByDefault !== undefined ||
      rule.subtitleNudgeInterval !== undefined)
  );
  ruleEl.querySelector(".override-subtitleNudge").checked = hasSubtitleNudgeOverride;
  syncSiteRuleField(ruleEl, rule, "enableSubtitleNudge", true);
  syncSiteRuleField(ruleEl, rule, "subtitleNudgeEnabledByDefault", true);
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
  associateSiteRuleLabels(ruleEl);

  document.getElementById("siteRulesContainer").appendChild(ruleEl);
}

function createControlBarBlock(buttonId) {
  var def = controllerButtonDefs[buttonId];
  if (!def) return null;

  var block = document.createElement("button");
  block.type = "button";
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

function updateControlBarBlockLabels(editor) {
  if (!editor) return;
  editor.querySelectorAll(".cb-dropzone").forEach(function(zone) {
    var state = zone.classList.contains("cb-active-zone")
      ? "active"
      : "available";
    zone.querySelectorAll(".cb-block").forEach(function(block) {
      var def = controllerButtonDefs[block.dataset.buttonId];
      block.setAttribute(
        "aria-label",
        (def ? def.name : block.dataset.buttonId) +
          ", " +
          state +
          ". Press Enter to move; use arrow keys to reorder."
      );
    });
  });
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

  updateControlBarBlockLabels(activeZone.closest(".cb-editor"));
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
  wrap.classList.toggle("cb-editor-disabled", checkbox.checked);
  wrap.querySelectorAll(".cb-block").forEach(function(block) {
    block.disabled = checkbox.checked;
    block.draggable = !checkbox.checked;
  });
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
  if (document.vscControlBarEditorInitialized) return;
  document.vscControlBarEditorInitialized = true;
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
    if (!block || block.disabled) return;
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
      updateControlBarBlockLabels(zone.closest(".cb-editor"));
      scheduleAutoSave();
    }

    clearControlBarDropTargets(null);
  });

  document.addEventListener("click", function(e) {
    var block = e.target.closest ? e.target.closest(".cb-block") : null;
    if (!block || block.disabled) return;
    var editor = block.closest(".cb-editor");
    var currentZone = block.closest(".cb-dropzone");
    if (!editor || !currentZone) return;
    var otherZone = editor.querySelector(
      currentZone.classList.contains("cb-active-zone")
        ? ".cb-available-zone"
        : ".cb-active-zone"
    );
    if (!otherZone) return;
    otherZone.appendChild(block);
    updateControlBarBlockLabels(editor);
    block.focus();
    scheduleAutoSave();
  });

  document.addEventListener("keydown", function(e) {
    var block = e.target.closest ? e.target.closest(".cb-block") : null;
    if (!block || block.disabled) return;
    var previous = e.key === "ArrowLeft" || e.key === "ArrowUp";
    var next = e.key === "ArrowRight" || e.key === "ArrowDown";
    if (!previous && !next) return;
    var sibling = previous ? block.previousElementSibling : block.nextElementSibling;
    if (!sibling) return;
    e.preventDefault();
    if (previous) {
      block.parentNode.insertBefore(block, sibling);
    } else {
      block.parentNode.insertBefore(block, sibling.nextElementSibling);
    }
    updateControlBarBlockLabels(block.closest(".cb-editor"));
    block.focus();
    scheduleAutoSave();
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
      b.setAttribute(
        "aria-pressed",
        slug === lucidePickerSelectedSlug ? "true" : "false"
      );
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
            x.setAttribute(
              "aria-pressed",
              x.dataset.slug === slug ? "true" : "false"
            );
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
                ". Open pages update automatically."
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

function restore_options(callback) {
  var done = typeof callback === "function" ? callback : function () {};
  var status = document.getElementById("status");
  setOptionsSyncSettingsLoaded(false);
  chrome.storage.sync.get(null, function (rawStorage) {
    var syncError = chrome.runtime.lastError;
    if (syncError) {
      status.textContent =
        "Error: Unable to load options - " + syncError.message;
      done(syncError);
      return;
    }
    var storage = vscExpandStoredSettings(rawStorage || {});
    chrome.storage.local.get(["customButtonIcons"], function (loc) {
      var localError = chrome.runtime.lastError;
      customButtonIconsLive =
        !localError &&
        loc &&
        loc.customButtonIcons &&
        typeof loc.customButtonIcons === "object"
          ? loc.customButtonIcons
          : {};

    document.getElementById("rememberSpeed").checked = storage.rememberSpeed;
    document.getElementById("forceLastSavedSpeed").checked =
      storage.forceLastSavedSpeed;
    document.getElementById("audioBoolean").checked = storage.audioBoolean;
    document.getElementById("showAmbientLoopControls").checked =
      storage.showAmbientLoopControls;
    document.getElementById("enabled").checked = storage.enabled;
    document.getElementById("startHidden").checked = storage.startHidden;
    document.getElementById("shortcutTargetMode").value =
      storage.shortcutTargetMode === "all" ? "all" : "closest";

    document.getElementById("hideWithControls").checked =
      storage.hideWithControls;
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
    document.getElementById("subtitleNudgeEnabledByDefault").checked =
      storage.subtitleNudgeEnabledByDefault;
    document.getElementById("subtitleNudgeInterval").value =
      storage.subtitleNudgeInterval;

    if (!Array.isArray(storage.keyBindings) || storage.keyBindings.length === 0) {
      storage.keyBindings = tcDefaults.keyBindings.slice();
    }

    ensureAllDefaultBindings(storage);

    document.querySelectorAll(".customs:not([id])").forEach((row) => row.remove());

    var usedDefaultShortcutRows = new Set();
    storage.keyBindings.forEach((item) => {
      var row = document.getElementById(item.action);
      var normalizedBinding = normalizeStoredBinding(item);

      if (!row || usedDefaultShortcutRows.has(item.action)) {
        add_shortcut(item.action, item.value);
        row = document.querySelector(".shortcut-row.customs:last-of-type");
      } else {
        usedDefaultShortcutRows.add(item.action);
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

    var siteRules = Array.isArray(storage.siteRules) ? storage.siteRules : [];

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
    setOptionsSyncSettingsLoaded(true);
    if (localError) {
      status.textContent =
        "Warning: Options loaded, but custom icons could not be read - " +
        localError.message;
    }
    done(localError || null);
    });
  });
}

function restore_defaults() {
  if (
    !window.confirm(
      "Restore all defaults? This removes saved preferences, remembered speeds, and custom icons."
    )
  ) {
    return;
  }
  var status = document.getElementById("status");
  var restoreButton = document.getElementById("restore");
  setOptionsSyncSettingsLoaded(false);
  if (restoreButton) restoreButton.disabled = true;

  function finishRestore(error) {
    // Leave the storage callback before rereading. Besides avoiding nested API
    // calls, this prevents a callback-scoped runtime.lastError from being
    // mistaken for an error from the fresh read.
    Promise.resolve().then(function () {
      restore_options(function (reloadError) {
        if (restoreButton) restoreButton.disabled = false;
        if (error) {
          status.textContent =
            "Error: Unable to restore all defaults - " + error.message;
          return;
        }
        if (reloadError) {
          status.textContent =
            "Defaults restored, but the options page could not reload - " +
            reloadError.message;
          return;
        }
        status.textContent = "Default options restored";
        setTimeout(function () {
          status.textContent = "";
        }, 1000);
      });
    });
  }

  persistManagedSyncSettings(tcDefaults, function (error) {
    if (error) {
      finishRestore(error);
      return;
    }

    chrome.storage.sync.set({ lastSpeed: tcDefaults.lastSpeed }, function () {
      var lastSpeedError = chrome.runtime.lastError;
      if (lastSpeedError) {
        finishRestore(lastSpeedError);
        return;
      }

      chrome.storage.local.set(
        {
          rememberedSpeeds: {},
          rememberedSpeedsResetAt: Date.now()
        },
        function () {
          var speedResetError = chrome.runtime.lastError;
          if (speedResetError) {
            finishRestore(speedResetError);
            return;
          }
          chrome.storage.local.remove(
            [
              "customButtonIcons",
              "lucideTagsCacheV1",
              "lucideTagsCacheV1At",
              "rememberedSpeeds"
            ],
            function () {
              finishRestore(chrome.runtime.lastError || null);
            }
          );
        }
      );
    });
  });
}

document.addEventListener("DOMContentLoaded", function () {
  var manifest = chrome.runtime.getManifest();
  var versionElement = document.getElementById("app-version");
  if (versionElement) {
    versionElement.textContent = manifest.version;
  }

  document.querySelectorAll("#customs .shortcut-row").forEach(labelShortcutRow);

  restore_options();
  initControlBarEditor();

  document.getElementById("popupMatchHoverControls")
    .addEventListener("change", updatePopupEditorDisabledState);

  document.getElementById("save").addEventListener("click", save_options);
  document.getElementById("copyDiagnostics").addEventListener("click", function () {
    var status = document.getElementById("status");
    if (
      !navigator.clipboard ||
      typeof navigator.clipboard.writeText !== "function"
    ) {
      status.textContent = "Clipboard access is unavailable.";
      return;
    }
    var report = popupControlUtils.buildDiagnosticReport({
      speederVersion: manifest.version,
      browser: navigator.userAgent,
      platform: navigator.platform || null,
      storage: {
        enabled: document.getElementById("enabled").checked,
        rememberSpeed: document.getElementById("rememberSpeed").checked,
        forceLastSavedSpeed:
          document.getElementById("forceLastSavedSpeed").checked,
        audioBoolean: document.getElementById("audioBoolean").checked,
        startHidden: document.getElementById("startHidden").checked,
        hideWithControls: document.getElementById("hideWithControls").checked,
        controllerLocation: document.getElementById("controllerLocation").value,
        shortcutTargetMode:
          document.getElementById("shortcutTargetMode").value
      }
    });
    navigator.clipboard.writeText(report).then(
      function() {
        status.textContent = "Diagnostics copied. Review before sharing.";
      },
      function() {
        status.textContent = "Could not copy diagnostics.";
      }
    );
  });
  
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
      scheduleAutoSave();
      return;
    }
    var removeSiteRuleButton = targetEl.closest(".remove-site-rule");
    if (removeSiteRuleButton) {
      removeSiteRuleButton.closest(".site-rule").remove();
      scheduleAutoSave();
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
  document.addEventListener("change", (event) => {
    if (
      event.target.id !== "addShortcutSelector" &&
      !event.target.closest("#lucideIconSettings")
    ) {
      scheduleAutoSave();
    }
  });
});
