(function(root, factory) {
  var exports = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = exports;
  }

  root.SpeederShared = root.SpeederShared || {};
  root.SpeederShared.keyBindings = exports;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
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
    if (keyCode >= 48 && keyCode <= 57) return "Digit" + String.fromCharCode(keyCode);
    if (keyCode >= 65 && keyCode <= 90) return "Key" + String.fromCharCode(keyCode);
    if (keyCode >= 96 && keyCode <= 105) return "Numpad" + (keyCode - 96);
    if (keyCode >= 112 && keyCode <= 123) return "F" + (keyCode - 111);

    var keyCodeMap = {
      32: "Space",
      37: "ArrowLeft",
      38: "ArrowUp",
      39: "ArrowRight",
      40: "ArrowDown",
      106: "NumpadMultiply",
      107: "NumpadAdd",
      109: "NumpadSubtract",
      110: "NumpadDecimal",
      111: "NumpadDivide",
      186: "Semicolon",
      188: "Comma",
      189: "Minus",
      187: "Equal",
      190: "Period",
      191: "Slash",
      192: "Backquote",
      219: "BracketLeft",
      220: "Backslash",
      221: "BracketRight",
      222: "Quote",
      59: "Semicolon",
      61: "Equal",
      173: "Minus"
    };

    return keyCodeMap[keyCode] || null;
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

  return {
    getLegacyKeyCode: getLegacyKeyCode,
    inferBindingCode: inferBindingCode,
    legacyBindingKeyToCode: legacyBindingKeyToCode,
    legacyKeyCodeToCode: legacyKeyCodeToCode,
    normalizeBindingKey: normalizeBindingKey
  };
});
