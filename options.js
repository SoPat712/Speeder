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
  controllerLocation: "top-left",
  forceLastSavedSpeed: false,
  enabled: true,
  controllerOpacity: 0.3,
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
    { pattern: "instagram.com", disableExtension: true },
    { pattern: "x.com", disableExtension: true },
    { pattern: "imgur.com", disableExtension: true },
    { pattern: "teams.microsoft.com", disableExtension: true }
  ],
  enableSubtitleNudge: true,
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
    selector.options[0].text = "Add shortcut...";
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
    valueInput.value = value || 0;
  }

  var removeButton = document.createElement("button");
  removeButton.className = "removeParent";
  removeButton.type = "button";
  removeButton.textContent = "X";

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

  // Only collect shortcuts from the main shortcuts section, NOT from site rules
  Array.from(document.querySelectorAll("#customs .customs")).forEach((item) => {
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
  settings.hideWithYouTubeControls = document.getElementById("hideWithYouTubeControls").checked;
  settings.controllerLocation = normalizeControllerLocation(
    document.getElementById("controllerLocation").value
  );
  settings.controllerOpacity =
    document.getElementById("controllerOpacity").value;
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

  // Collect site rules
  settings.siteRules = [];
  document.querySelectorAll(".site-rule").forEach((ruleEl) => {
    var pattern = ruleEl.querySelector(".site-pattern").value.trim();
    if (pattern.length === 0) return;

    var rule = { pattern: pattern };

    // Handle Enable toggle
    rule.enabled = ruleEl.querySelector(".site-enabled").checked;

    // Handle other site settings
    const siteSettings = [
      { key: "startHidden", type: "checkbox" },
      { key: "controllerLocation", type: "select" },
      { key: "rememberSpeed", type: "checkbox" },
      { key: "forceLastSavedSpeed", type: "checkbox" },
      { key: "audioBoolean", type: "checkbox" },
      { key: "controllerOpacity", type: "text" }
    ];

    siteSettings.forEach((s) => {
      var input = ruleEl.querySelector(`.site-${s.key}`);
      if (s.type === "checkbox") {
        rule[s.key] = input.checked;
      } else {
        rule[s.key] = input.value;
      }
    });

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

  chrome.storage.sync.remove([
    "resetSpeed",
    "speedStep",
    "fastSpeed",
    "rewindTime",
    "advanceTime",
    "resetKeyCode",
    "slowerKeyCode",
    "fasterKeyCode",
    "rewindKeyCode",
    "advanceKeyCode",
    "fastKeyCode",
    "blacklist"
  ]);

  chrome.storage.sync.set(settings, function () {
    status.textContent = "Options saved";
    setTimeout(function () {
      status.textContent = "";
    }, 1000);
  });
}

function ensureDisplayBinding(storage) {
  ensureDefaultBinding(
    storage,
    "display",
    "V",
    storage.displayKeyCode || tcDefaults.displayKeyCode,
    0
  );
}

function ensureMoveBinding(storage) {
  ensureDefaultBinding(storage, "move", "P", 80, 0);
}

function ensureSubtitleNudgeBinding(storage) {
  ensureDefaultBinding(storage, "toggleSubtitleNudge", "N", 78, 0);
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
  valueInput.value = value || 0;
  if (customActionsNoValues.includes(action)) {
    valueInput.disabled = true;
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

  const settings = [
    { key: "startHidden", type: "checkbox" },
    { key: "controllerLocation", type: "select" },
    { key: "rememberSpeed", type: "checkbox" },
    { key: "forceLastSavedSpeed", type: "checkbox" },
    { key: "audioBoolean", type: "checkbox" },
    { key: "controllerOpacity", type: "text" }
  ];

  settings.forEach((s) => {
    var input = ruleEl.querySelector(`.site-${s.key}`);
    var value;
    if (rule && rule[s.key] !== undefined) {
      value = rule[s.key];
    } else {
      // Initialize with current global value
      if (s.type === "checkbox") {
        value = document.getElementById(s.key).checked;
      } else {
        value = document.getElementById(s.key).value;
      }
    }

    if (s.type === "checkbox") {
      input.checked = value;
    } else {
      input.value = value;
    }
  });

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

function restore_options() {
  chrome.storage.sync.get(tcDefaults, function (storage) {
    document.getElementById("rememberSpeed").checked = storage.rememberSpeed;
    document.getElementById("forceLastSavedSpeed").checked =
      storage.forceLastSavedSpeed;
    document.getElementById("audioBoolean").checked = storage.audioBoolean;
    document.getElementById("enabled").checked = storage.enabled;
    document.getElementById("startHidden").checked = storage.startHidden;
    document.getElementById("hideWithYouTubeControls").checked = storage.hideWithYouTubeControls;
    document.getElementById("controllerLocation").value =
      normalizeControllerLocation(storage.controllerLocation);
    document.getElementById("controllerOpacity").value =
      storage.controllerOpacity;
    document.getElementById("enableSubtitleNudge").checked =
      storage.enableSubtitleNudge;
    document.getElementById("subtitleNudgeInterval").value =
      storage.subtitleNudgeInterval;

    if (!Array.isArray(storage.keyBindings) || storage.keyBindings.length === 0) {
      storage.keyBindings = tcDefaults.keyBindings.slice();
    }

    ensureDisplayBinding(storage);
    ensureMoveBinding(storage);
    ensureSubtitleNudgeBinding(storage);

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
        valueInput.value = item.value;
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
        event.target.textContent = "-";
      } else {
        ruleBody.style.display = "none";
        ruleEl.classList.add("collapsed");
        event.target.textContent = "+";
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
  });
});
