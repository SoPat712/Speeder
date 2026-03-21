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
  forceLastSavedSpeed: false,
  enabled: true,
  controllerOpacity: 0.3,
  keyBindings: [
    createDefaultBinding("display", "V", 86, 0),
    createDefaultBinding("slower", "S", 83, 0.1),
    createDefaultBinding("faster", "D", 68, 0.1),
    createDefaultBinding("rewind", "Z", 90, 10),
    createDefaultBinding("advance", "X", 88, 10),
    createDefaultBinding("reset", "R", 82, 1),
    createDefaultBinding("fast", "G", 71, 1.8)
  ],
  blacklist: `www.instagram.com
    twitter.com
    imgur.com
    teams.microsoft.com
  `.replace(regStrip, ""),
  enableSubtitleNudge: true,
  subtitleNudgeInterval: 25,
  subtitleNudgeAmount: 0.001
};

var customActionsNoValues = ["pause", "muted", "mark", "jump", "display"];

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
  if (binding.disabled) return "null";
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

function add_shortcut() {
  var html = `<select class="customDo"><option value="slower">Decrease speed</option><option value="faster">Increase speed</option><option value="rewind">Rewind</option><option value="advance">Advance</option><option value="reset">Reset speed</option><option value="fast">Preferred speed</option><option value="muted">Mute</option><option value="pause">Pause</option><option value="mark">Set marker</option><option value="jump">Jump to marker</option><option value="display">Show/hide controller</option></select><input class="customKey" type="text" placeholder="press a key"/><input class="customValue" type="text" placeholder="value (0.10)"/><select class="customForce"><option value="false">Do not disable website key bindings</option><option value="true">Disable website key bindings</option></select><button class="removeParent">X</button>`;
  var div = document.createElement("div");
  div.setAttribute("class", "row customs");
  div.innerHTML = html;
  var customsElement = document.getElementById("customs");
  customsElement.insertBefore(
    div,
    customsElement.children[customsElement.childElementCount - 1]
  );
}

function createKeyBindings(item) {
  var action = item.querySelector(".customDo").value;
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
    force: item.querySelector(".customForce").value,
    predefined: predefined
  });

  return { valid: true };
}

function validate() {
  var valid = true;
  var status = document.getElementById("status");
  document
    .getElementById("blacklist")
    .value.split("\n")
    .forEach((match) => {
      match = match.replace(regStrip, "");
      if (match.startsWith("/")) {
        try {
          new RegExp(match);
        } catch (err) {
          status.textContent =
            "Error: Invalid blacklist regex: " + match + ". Unable to save";
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

  Array.from(document.querySelectorAll(".customs")).forEach((item) => {
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
  settings.controllerOpacity =
    document.getElementById("controllerOpacity").value;
  settings.blacklist = document
    .getElementById("blacklist")
    .value.replace(regStrip, "");
  settings.keyBindings = keyBindings;
  settings.enableSubtitleNudge =
    document.getElementById("enableSubtitleNudge").checked;
  settings.subtitleNudgeInterval =
    parseInt(document.getElementById("subtitleNudgeInterval").value, 10) ||
    tcDefaults.subtitleNudgeInterval;
  settings.subtitleNudgeAmount =
    parseFloat(document.getElementById("subtitleNudgeAmount").value) ||
    tcDefaults.subtitleNudgeAmount;

  if (settings.subtitleNudgeInterval < 10) {
    settings.subtitleNudgeInterval = 10;
  }
  if (
    settings.subtitleNudgeAmount <= 0 ||
    settings.subtitleNudgeAmount > 0.1
  ) {
    settings.subtitleNudgeAmount = tcDefaults.subtitleNudgeAmount;
  }

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
    "fastKeyCode"
  ]);

  chrome.storage.sync.set(settings, function () {
    status.textContent = "Options saved";
    setTimeout(function () {
      status.textContent = "";
    }, 1000);
  });
}

function ensureDisplayBinding(storage) {
  if (storage.keyBindings.some((item) => item.action === "display")) return;
  storage.keyBindings.push(
    createDefaultBinding(
      "display",
      "V",
      storage.displayKeyCode || tcDefaults.displayKeyCode,
      0
    )
  );
}

function restore_options() {
  chrome.storage.sync.get(tcDefaults, function (storage) {
    document.getElementById("rememberSpeed").checked = storage.rememberSpeed;
    document.getElementById("forceLastSavedSpeed").checked =
      storage.forceLastSavedSpeed;
    document.getElementById("audioBoolean").checked = storage.audioBoolean;
    document.getElementById("enabled").checked = storage.enabled;
    document.getElementById("startHidden").checked = storage.startHidden;
    document.getElementById("controllerOpacity").value =
      storage.controllerOpacity;
    document.getElementById("blacklist").value = storage.blacklist;
    document.getElementById("enableSubtitleNudge").checked =
      storage.enableSubtitleNudge;
    document.getElementById("subtitleNudgeInterval").value =
      storage.subtitleNudgeInterval;
    document.getElementById("subtitleNudgeAmount").value =
      storage.subtitleNudgeAmount;

    if (!Array.isArray(storage.keyBindings) || storage.keyBindings.length === 0) {
      storage.keyBindings = tcDefaults.keyBindings.slice();
    }

    ensureDisplayBinding(storage);

    document.querySelectorAll(".customs:not([id])").forEach((row) => row.remove());

    storage.keyBindings.forEach((item) => {
      var fallbackKeyCode =
        item.action === "display"
          ? storage.displayKeyCode || tcDefaults.displayKeyCode
          : undefined;
      var normalizedBinding = normalizeStoredBinding(item, fallbackKeyCode);
      var row;

      if (item.predefined) {
        row = document.getElementById(item.action);
      } else {
        add_shortcut();
        row = document.querySelector(".customs:last-of-type");
        row.querySelector(".customDo").value = item.action;
      }

      if (!row) return;

      var valueInput = row.querySelector(".customValue");
      if (customActionsNoValues.includes(item.action)) {
        valueInput.disabled = true;
      }

      updateCustomShortcutInputText(
        row.querySelector(".customKey"),
        normalizedBinding || createDisabledBinding()
      );
      valueInput.value = item.value;
      row.querySelector(".customForce").value = String(item.force);
    });
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

function show_experimental() {
  document
    .querySelectorAll(".customForce")
    .forEach((item) => (item.style.display = "inline-block"));
}

document.addEventListener("DOMContentLoaded", function () {
  var manifest = chrome.runtime.getManifest();
  var versionElement = document.getElementById("app-version");
  if (versionElement) {
    versionElement.textContent = manifest.version;
  }

  restore_options();
  document.getElementById("save").addEventListener("click", save_options);
  document.getElementById("add").addEventListener("click", add_shortcut);
  document
    .getElementById("restore")
    .addEventListener("click", restore_defaults);
  document
    .getElementById("experimental")
    .addEventListener("click", show_experimental);

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
  document.addEventListener("click", (event) =>
    eventCaller(event, "removeParent", function () {
      event.target.parentNode.remove();
    })
  );
  document.addEventListener("change", (event) => {
    eventCaller(event, "customDo", function () {
      var valueInput = event.target.nextElementSibling.nextElementSibling;
      if (customActionsNoValues.includes(event.target.value)) {
        valueInput.disabled = true;
        valueInput.value = 0;
      } else {
        valueInput.disabled = false;
      }
    });
  });
});
