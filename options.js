var regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;

var tcDefaults = {
  speed: 1.0, // default:
  displayKeyCode: 86, // default: V
  rememberSpeed: false, // default: false
  audioBoolean: false, // default: false
  startHidden: false, // default: false
  forceLastSavedSpeed: false, //default: false
  enabled: true, // default enabled
  controllerOpacity: 0.3, // default: 0.3
  keyBindings: [
    { action: "display", key: 86, value: 0, force: false, predefined: true }, // V
    { action: "slower", key: 83, value: 0.1, force: false, predefined: true }, // S
    { action: "faster", key: 68, value: 0.1, force: false, predefined: true }, // D
    { action: "rewind", key: 90, value: 10, force: false, predefined: true }, // Z
    { action: "advance", key: 88, value: 10, force: false, predefined: true }, // X
    { action: "reset", key: 82, value: 1, force: false, predefined: true }, // R
    { action: "fast", key: 71, value: 1.8, force: false, predefined: true } // G
  ],
  blacklist: `www.instagram.com
    twitter.com
    imgur.com
    teams.microsoft.com
  `.replace(regStrip, ""),
  // ADDED: Nudge defaults
  enableSubtitleNudge: true,
  subtitleNudgeInterval: 25,
  subtitleNudgeAmount: 0.001
};

var keyBindings = []; // This is populated during save/restore

var keyCodeAliases = {
  /* ... same as your original ... */ 0: "null",
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

function recordKeyPress(e) {
  /* ... same as your original ... */
  if (
    (e.keyCode >= 48 && e.keyCode <= 57) ||
    (e.keyCode >= 65 && e.keyCode <= 90) ||
    keyCodeAliases[e.keyCode]
  ) {
    e.target.value =
      keyCodeAliases[e.keyCode] || String.fromCharCode(e.keyCode);
    e.target.keyCode = e.keyCode;
    e.preventDefault();
    e.stopPropagation();
  } else if (e.keyCode === 8) {
    e.target.value = "";
  } else if (e.keyCode === 27) {
    e.target.value = "null";
    e.target.keyCode = null;
  }
}
function inputFilterNumbersOnly(e) {
  /* ... same as your original ... */
  var char = String.fromCharCode(e.keyCode);
  if (!/[\d\.]$/.test(char) || !/^\d+(\.\d*)?$/.test(e.target.value + char)) {
    e.preventDefault();
    e.stopPropagation();
  }
}
function inputFocus(e) {
  /* ... same as your original ... */ e.target.value = "";
}
function inputBlur(e) {
  /* ... same as your original ... */ e.target.value =
    keyCodeAliases[e.target.keyCode] || String.fromCharCode(e.target.keyCode);
}
// function updateShortcutInputText(inputId, keyCode) { /* ... same as your original ... */ } // Not directly used in provided options.js logic flow
function updateCustomShortcutInputText(inputItem, keyCode) {
  /* ... same as your original ... */ inputItem.value =
    keyCodeAliases[keyCode] || String.fromCharCode(keyCode);
  inputItem.keyCode = keyCode;
}
var customActionsNoValues = ["pause", "muted", "mark", "jump", "display"]; // Original
function add_shortcut() {
  /* ... same as your original ... */
  var html = `<select class="customDo"><option value="slower">Decrease speed</option><option value="faster">Increase speed</option><option value="rewind">Rewind</option><option value="advance">Advance</option><option value="reset">Reset speed</option><option value="fast">Preferred speed</option><option value="muted">Mute</option><option value="pause">Pause</option><option value="mark">Set marker</option><option value="jump">Jump to marker</option><option value="display">Show/hide controller</option></select><input class="customKey" type="text" placeholder="press a key"/><input class="customValue" type="text" placeholder="value (0.10)"/><select class="customForce"><option value="false">Do not disable website key bindings</option><option value="true">Disable website key bindings</option></select><button class="removeParent">X</button>`;
  var div = document.createElement("div");
  div.setAttribute("class", "row customs");
  div.innerHTML = html;
  var customs_element = document.getElementById("customs");
  customs_element.insertBefore(
    div,
    customs_element.children[customs_element.childElementCount - 1]
  );
}
function createKeyBindings(item) {
  /* ... same as your original ... */
  const action = item.querySelector(".customDo").value;
  const key = item.querySelector(".customKey").keyCode;
  const value = Number(item.querySelector(".customValue").value);
  const force = item.querySelector(".customForce").value;
  const predefined = !!item.id;
  keyBindings.push({
    action: action,
    key: key,
    value: value,
    force: force,
    predefined: predefined
  });
}
function validate() {
  /* ... same as your original ... */
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

// MODIFIED: save_options to include nudge settings
function save_options() {
  if (validate() === false) return;

  keyBindings = []; // Reset global keyBindings before populating from DOM
  Array.from(document.querySelectorAll(".customs")).forEach((item) =>
    createKeyBindings(item)
  );

  var s = {}; // Object to hold all settings to be saved
  s.rememberSpeed = document.getElementById("rememberSpeed").checked;
  s.forceLastSavedSpeed = document.getElementById(
    "forceLastSavedSpeed"
  ).checked;
  s.audioBoolean = document.getElementById("audioBoolean").checked;
  s.enabled = document.getElementById("enabled").checked;
  s.startHidden = document.getElementById("startHidden").checked;
  s.controllerOpacity = document.getElementById("controllerOpacity").value;
  s.blacklist = document
    .getElementById("blacklist")
    .value.replace(regStrip, "");
  s.keyBindings = keyBindings; // Use the populated global keyBindings

  // ADDED: Save nudge settings
  s.enableSubtitleNudge = document.getElementById(
    "enableSubtitleNudge"
  ).checked;
  s.subtitleNudgeInterval =
    parseInt(document.getElementById("subtitleNudgeInterval").value, 10) ||
    tcDefaults.subtitleNudgeInterval;
  s.subtitleNudgeAmount =
    parseFloat(document.getElementById("subtitleNudgeAmount").value) ||
    tcDefaults.subtitleNudgeAmount;
  // Basic validation for nudge interval and amount
  if (s.subtitleNudgeInterval < 10) s.subtitleNudgeInterval = 10; // Min 10ms
  if (s.subtitleNudgeAmount <= 0 || s.subtitleNudgeAmount > 0.1)
    s.subtitleNudgeAmount = tcDefaults.subtitleNudgeAmount;

  // Remove old flat settings (original logic)
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

  chrome.storage.sync.set(s, function () {
    var status = document.getElementById("status");
    status.textContent = "Options saved";
    setTimeout(function () {
      status.textContent = "";
    }, 1000);
  });
}

// MODIFIED: restore_options to include nudge settings
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

    // ADDED: Restore nudge settings
    document.getElementById("enableSubtitleNudge").checked =
      storage.enableSubtitleNudge;
    document.getElementById("subtitleNudgeInterval").value =
      storage.subtitleNudgeInterval;
    document.getElementById("subtitleNudgeAmount").value =
      storage.subtitleNudgeAmount;

    // Original key binding restoration logic
    if (
      !Array.isArray(storage.keyBindings) ||
      storage.keyBindings.length === 0
    ) {
      // If keyBindings missing or not an array, use defaults from tcDefaults
      storage.keyBindings = tcDefaults.keyBindings;
    }
    if (storage.keyBindings.filter((x) => x.action == "display").length == 0) {
      storage.keyBindings.push({
        action: "display",
        value: 0,
        force: false,
        predefined: true,
        key: storage.displayKeyCode || tcDefaults.displayKeyCode
      });
    }

    // Clear existing dynamic shortcuts before restoring (if any were added by mistake)
    const dynamicShortcuts = document.querySelectorAll(".customs:not([id])");
    dynamicShortcuts.forEach((sc) => sc.remove());

    for (let i in storage.keyBindings) {
      var item = storage.keyBindings[i];
      if (item.predefined) {
        if (item["action"] == "display" && typeof item["key"] === "undefined") {
          item["key"] = storage.displayKeyCode || tcDefaults.displayKeyCode;
        }
        if (customActionsNoValues.includes(item["action"])) {
          const el = document.querySelector(
            "#" + item["action"] + " .customValue"
          );
          if (el) el.disabled = true;
        }
        const keyEl = document.querySelector(
          "#" + item["action"] + " .customKey"
        );
        const valEl = document.querySelector(
          "#" + item["action"] + " .customValue"
        );
        const forceEl = document.querySelector(
          "#" + item["action"] + " .customForce"
        );
        if (keyEl) updateCustomShortcutInputText(keyEl, item["key"]);
        if (valEl) valEl.value = item["value"];
        if (forceEl) forceEl.value = String(item["force"]); // Ensure string for select value
      } else {
        // Non-predefined, dynamically added shortcuts
        add_shortcut();
        const dom = document.querySelector(".customs:last-of-type"); // Gets the newly added one
        dom.querySelector(".customDo").value = item["action"];
        if (customActionsNoValues.includes(item["action"])) {
          dom.querySelector(".customValue").disabled = true;
        }
        updateCustomShortcutInputText(
          dom.querySelector(".customKey"),
          item["key"]
        );
        dom.querySelector(".customValue").value = item["value"];
        dom.querySelector(".customForce").value = String(item["force"]);
      }
    }
  });
}

function restore_defaults() {
  /* ... same as your original, tcDefaults now includes nudge defaults ... */
  // Remove all dynamically added shortcuts first
  document.querySelectorAll(".customs:not([id])").forEach((el) => el.remove());
  // Then set defaults and restore options, which will re-add predefined ones correctly
  chrome.storage.sync.set(tcDefaults, function () {
    restore_options(); // This will populate based on tcDefaults
    var status = document.getElementById("status");
    status.textContent = "Default options restored";
    setTimeout(function () {
      status.textContent = "";
    }, 1000);
  });
}

function show_experimental() {
  /* ... same as your original ... */
  document
    .querySelectorAll(".customForce")
    .forEach((item) => (item.style.display = "inline-block"));
}

document.addEventListener("DOMContentLoaded", function () {
  /* ... same as your original event listeners setup ... */
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
    if (!event.target.classList || !event.target.classList.contains(className))
      return;
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
      if (customActionsNoValues.includes(event.target.value)) {
        event.target.nextElementSibling.nextElementSibling.disabled = true;
        event.target.nextElementSibling.nextElementSibling.value = 0; // Or "" if placeholder is preferred
      } else {
        event.target.nextElementSibling.nextElementSibling.disabled = false;
      }
    });
  });
});
