(function(root, factory) {
  if (typeof module === "object" && module.exports) require("./settings-core.js");
  var exports = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = exports;
  }

  root.SpeederShared = root.SpeederShared || {};
  root.SpeederShared.keyBindings = exports;
})(typeof globalThis !== "undefined" ? globalThis : this, function(root) {
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

  function legacyBindingKeyToCode(key) {
    var normalizedKey = normalizeBindingKey(key);
    if (!normalizedKey) return null;
    if (/^[A-Z]$/.test(normalizedKey)) return "Key" + normalizedKey;
    if (/^[0-9]$/.test(normalizedKey)) return "Digit" + normalizedKey;
    if (/^F([1-9]|1[0-2])$/.test(normalizedKey)) return normalizedKey;

    var keyMap = {
      " ": "Space",
      ArrowLeft: "ArrowLeft",
      ArrowUp: "ArrowUp",
      ArrowRight: "ArrowRight",
      ArrowDown: "ArrowDown",
      ";": "Semicolon",
      "<": "Comma",
      "-": "Minus",
      "+": "Equal",
      ">": "Period",
      "/": "Slash",
      "~": "Backquote",
      "[": "BracketLeft",
      "\\": "Backslash",
      "]": "BracketRight",
      "'": "Quote"
    };

    return keyMap[normalizedKey] || null;
  }

  function legacyKeyCodeToCode(keyCode) {
    if (!Number.isInteger(keyCode)) return null;
    return root.vscLegacyKeyCodeToCode(keyCode);
  }

  function inferBindingCode(binding, fallbackCode) {
    if (binding && typeof binding.code === "string" && binding.code.length > 0) {
      return binding.code;
    }

    if (binding && typeof binding.key === "string") {
      var codeFromKey = legacyBindingKeyToCode(binding.key);
      if (codeFromKey) return codeFromKey;
    }

    var legacyKeyCode = getLegacyKeyCode(binding);
    if (Number.isInteger(legacyKeyCode)) {
      var codeFromKeyCode = legacyKeyCodeToCode(legacyKeyCode);
      if (codeFromKeyCode) return codeFromKeyCode;
    }

    return typeof fallbackCode === "string" && fallbackCode.length > 0
      ? fallbackCode
      : null;
  }

  function getActionValueError(action, value) {
    return root.vscGetActionValueError(action, value);
  }

  function sanitizeActionValue(action, value, fallback) {
    return root.vscSanitizeActionValue(action, value, fallback);
  }

  var exports = {
    getActionValueError: getActionValueError,
    getLegacyKeyCode: getLegacyKeyCode,
    inferBindingCode: inferBindingCode,
    legacyBindingKeyToCode: legacyBindingKeyToCode,
    legacyKeyCodeToCode: legacyKeyCodeToCode,
    normalizeBindingKey: normalizeBindingKey,
    sanitizeActionValue: sanitizeActionValue
  };

  // Speed limits live in settings-core.js, which pages load after this file;
  // read them on access rather than copying them here.
  ["MIN_SPEED", "MAX_SPEED"].forEach(function(name) {
    Object.defineProperty(exports, name, {
      enumerable: true,
      get: function() {
        return typeof root.vscGetSpeedLimits === "function"
          ? root.vscGetSpeedLimits()[name === "MIN_SPEED" ? "min" : "max"]
          : undefined;
      }
    });
  });

  return exports;
});
