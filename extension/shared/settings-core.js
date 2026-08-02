(function (global) {
  "use strict";

  var LEGACY_SITE_RULES_DIFF_FORMAT = "defaults-diff-v1";
  var SITE_RULES_DIFF_FORMAT = "defaults-diff-v2";
  var REMOVED_DEFAULT_RULE_KEYS_META = "removedDefaultRuleKeys";
  var MIN_SPEED = 0.1;
  var MAX_SPEED = 16;
  var DEFAULT_BUTTONS = ["rewind", "slower", "faster", "advance", "display"];
  var LEGACY_SYNC_KEYS = [
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
    "displayKeyCode",
    "blacklist"
  ];
  var DIFFABLE_OPTION_KEYS = [
    "rememberSpeed",
    "forceLastSavedSpeed",
    "audioBoolean",
    "showAmbientLoopControls",
    "enabled",
    "startHidden",
    "hideWithControls",
    "hideWithControlsTimer",
    "controllerLocation",
    "controllerOpacity",
    "controllerMarginTop",
    "controllerMarginRight",
    "controllerMarginBottom",
    "controllerMarginLeft",
    "shortcutTargetMode",
    "keyBindings",
    "siteRules",
    "siteRulesMeta",
    "siteRulesFormat",
    "controllerButtons",
    "showPopupControlBar",
    "popupMatchHoverControls",
    "popupControllerButtons",
    "enableSubtitleNudge",
    "subtitleNudgeEnabledByDefault",
    "subtitleNudgeInterval",
    "subtitleNudgeAmount"
  ];
  var MANAGED_SYNC_KEYS = DIFFABLE_OPTION_KEYS.concat(
    ["hideWithYouTubeControls"],
    LEGACY_SYNC_KEYS
  );

  var DEFAULT_SETTINGS = {
    speed: 1.0,
    lastSpeed: 1.0,
    rememberSpeed: false,
    audioBoolean: false,
    showAmbientLoopControls: false,
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
    shortcutTargetMode: "closest",
    keyBindings: [
      {
        action: "display",
        code: "KeyV",
        disabled: false,
        value: 0,
        force: false,
        predefined: true
      },
      {
        action: "move",
        code: "KeyP",
        disabled: false,
        value: 0,
        force: false,
        predefined: true
      },
      {
        action: "slower",
        code: "KeyS",
        disabled: false,
        value: 0.1,
        force: false,
        predefined: true
      },
      {
        action: "faster",
        code: "KeyD",
        disabled: false,
        value: 0.1,
        force: false,
        predefined: true
      },
      {
        action: "rewind",
        code: "KeyZ",
        disabled: false,
        value: 10,
        force: false,
        predefined: true
      },
      {
        action: "advance",
        code: "KeyX",
        disabled: false,
        value: 10,
        force: false,
        predefined: true
      },
      {
        action: "reset",
        code: "KeyR",
        disabled: false,
        value: 0,
        force: false,
        predefined: true
      },
      {
        action: "fast",
        code: "KeyG",
        disabled: false,
        value: 1.8,
        force: false,
        predefined: true
      },
      {
        action: "toggleSubtitleNudge",
        code: "KeyN",
        disabled: false,
        value: 0,
        force: false,
        predefined: true
      }
    ],
    siteRules: [
      {
        title: "YouTube videos",
        pattern: "/^https:\\/\\/(www\\.)?youtube\\.com\\/(?!shorts\\/).*/",
        enabled: true
      },
      {
        title: "YouTube Shorts",
        pattern: "/^https:\\/\\/(www\\.)?youtube\\.com\\/shorts\\/.*/",
        enabled: true,
        rememberSpeed: true,
        controllerMarginTop: 60,
        controllerMarginBottom: 85
      },
      {
        title: "YouTube Shorts (mobile)",
        pattern: "/^https:\\/\\/m\\.youtube\\.com\\/shorts\\/.*/",
        enabled: true,
        rememberSpeed: true,
        controllerMarginTop: 60,
        controllerMarginBottom: 85
      }
    ],
    controllerButtons: DEFAULT_BUTTONS.slice(),
    showPopupControlBar: true,
    popupMatchHoverControls: true,
    popupControllerButtons: DEFAULT_BUTTONS.slice(),
    enableSubtitleNudge: false,
    subtitleNudgeEnabledByDefault: true,
    subtitleNudgeInterval: 250,
    subtitleNudgeAmount: 0.001
  };

  function clonePlainData(value) {
    if (value === undefined) {
      return undefined;
    }
    return JSON.parse(JSON.stringify(value));
  }

  function hasOwn(obj, key) {
    return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function sortComparableValue(value) {
    if (Array.isArray(value)) {
      return value.map(sortComparableValue);
    }

    if (isPlainObject(value)) {
      var sorted = {};
      Object.keys(value)
        .sort()
        .forEach(function (key) {
          if (value[key] === undefined) {
            return;
          }
          sorted[key] = sortComparableValue(value[key]);
        });
      return sorted;
    }

    return value;
  }

  function areComparableValuesEqual(a, b) {
    return (
      JSON.stringify(sortComparableValue(a)) ===
      JSON.stringify(sortComparableValue(b))
    );
  }

  function deepMergeDefaults(defaults, overrides) {
    if (Array.isArray(defaults)) {
      return Array.isArray(overrides)
        ? clonePlainData(overrides)
        : clonePlainData(defaults);
    }

    if (isPlainObject(defaults)) {
      var result = clonePlainData(defaults) || {};
      if (!isPlainObject(overrides)) {
        return result;
      }

      Object.keys(overrides).forEach(function (key) {
        if (overrides[key] === undefined) {
          return;
        }

        if (hasOwn(defaults, key)) {
          result[key] = deepMergeDefaults(defaults[key], overrides[key]);
        } else {
          result[key] = clonePlainData(overrides[key]);
        }
      });

      return result;
    }

    return overrides === undefined
      ? clonePlainData(defaults)
      : clonePlainData(overrides);
  }

  function deepDiff(current, defaults) {
    if (current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      return areComparableValuesEqual(current, defaults)
        ? undefined
        : clonePlainData(current);
    }

    if (isPlainObject(current)) {
      var result = {};
      Object.keys(current).forEach(function (key) {
        var diff = deepDiff(current[key], defaults && defaults[key]);
        if (diff !== undefined) {
          result[key] = diff;
        }
      });
      return Object.keys(result).length > 0 ? result : undefined;
    }

    return areComparableValuesEqual(current, defaults)
      ? undefined
      : clonePlainData(current);
  }

  function getDefaultSiteRules() {
    return clonePlainData(DEFAULT_SETTINGS.siteRules) || [];
  }

  function getDefaultSiteRulesByPattern() {
    var map = Object.create(null);
    getDefaultSiteRules().forEach(function (rule) {
      if (!rule || typeof rule.pattern !== "string" || !rule.pattern) {
        return;
      }
      map[rule.pattern] = rule;
    });
    return map;
  }

  function coerceBoolean(value, fallback) {
    if (value === true || value === false) return value;
    if (value === "true" || value === 1 || value === "1") return true;
    if (value === "false" || value === 0 || value === "0") return false;
    return fallback;
  }

  function clampFiniteNumber(value, minimum, maximum, fallback) {
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "string" && value.trim() === "") ||
      (typeof value !== "number" && typeof value !== "string")
    ) {
      return fallback;
    }
    var numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    return Math.min(maximum, Math.max(minimum, numericValue));
  }

  var SITE_RULE_BOOLEAN_KEYS = new Set([
    "enabled",
    "startHidden",
    "hideWithControls",
    "rememberSpeed",
    "forceLastSavedSpeed",
    "audioBoolean",
    "showAmbientLoopControls",
    "enableSubtitleNudge",
    "subtitleNudgeEnabledByDefault",
    "showPopupControlBar",
    "popupMatchHoverControls"
  ]);

  function normalizeSiteRuleValue(key, value) {
    if (key === "title") {
      if (typeof value !== "string") return undefined;
      var title = value.trim();
      return title || undefined;
    }
    if (SITE_RULE_BOOLEAN_KEYS.has(key)) {
      return coerceBoolean(value, undefined);
    }
    if (key === "shortcutTargetMode") {
      return value === "all" || value === "closest" ? value : undefined;
    }
    if (key === "hideWithControlsTimer") {
      return clampFiniteNumber(value, 0.1, 15, undefined);
    }
    if (key === "controllerOpacity") {
      return clampFiniteNumber(value, 0, 1, undefined);
    }
    if (
      key === "controllerMarginTop" ||
      key === "controllerMarginRight" ||
      key === "controllerMarginBottom" ||
      key === "controllerMarginLeft"
    ) {
      return clampFiniteNumber(value, 0, 200, undefined);
    }
    if (key === "subtitleNudgeInterval") {
      return clampFiniteNumber(value, 250, 1000, undefined);
    }
    if (key === "preferredSpeed") {
      return clampFiniteNumber(value, MIN_SPEED, MAX_SPEED, undefined);
    }
    if (key === "shortcuts" && Array.isArray(value)) {
      return sanitizeStoredBindingValues(value).map(function(shortcut) {
        shortcut.disabled = coerceBoolean(shortcut.disabled, false);
        shortcut.force = coerceBoolean(shortcut.force, false);
        return shortcut;
      });
    }
    return clonePlainData(value);
  }

  function normalizeSiteRule(rule) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      return null;
    }

    var pattern = typeof rule.pattern === "string" ? rule.pattern.trim() : "";
    if (!pattern) {
      return null;
    }

    var normalized = { pattern: pattern };
    Object.keys(rule).forEach(function (key) {
      if (
        key === "pattern" ||
        key === "disableExtension" ||
        rule[key] === undefined
      ) {
        return;
      }

      var normalizedValue = normalizeSiteRuleValue(key, rule[key]);
      if (normalizedValue !== undefined) {
        normalized[key] = normalizedValue;
      }
    });

    if (!hasOwn(normalized, "enabled") && hasOwn(rule, "disableExtension")) {
      normalized.enabled = !coerceBoolean(rule.disableExtension, false);
    }

    return normalized;
  }

  function compressSiteRules(siteRules) {
    if (!Array.isArray(siteRules)) {
      return {};
    }

    var defaultRules = getDefaultSiteRules();
    var defaultRulesByPattern = getDefaultSiteRulesByPattern();
    var claimedDefaultPatterns = new Set();
    var exportRules = [];
    var removedDefaultRuleKeys = [];

    siteRules.forEach(function (rule) {
      var normalizedRule = normalizeSiteRule(rule);
      if (!normalizedRule) return;

      var pattern = normalizedRule.pattern;
      var defaultRule = defaultRulesByPattern[pattern];
      if (defaultRule && !claimedDefaultPatterns.has(pattern)) {
        claimedDefaultPatterns.add(pattern);
        var normalizedDefaultRule = normalizeSiteRule(defaultRule);
        var patch = { pattern: pattern };
        var removedKeys = [];

        Object.keys(normalizedRule).forEach(function (key) {
          if (key === "pattern") return;
          if (
            !hasOwn(normalizedDefaultRule, key) ||
            !areComparableValuesEqual(
              normalizedRule[key],
              normalizedDefaultRule[key]
            )
          ) {
            patch[key] = clonePlainData(normalizedRule[key]);
          }
        });

        Object.keys(normalizedDefaultRule).forEach(function (key) {
          if (key === "pattern" || hasOwn(normalizedRule, key)) return;
          removedKeys.push(key);
        });

        if (Object.keys(patch).length > 1) {
          exportRules.push(patch);
        }
        if (removedKeys.length > 0) {
          removedDefaultRuleKeys.push({
            pattern: pattern,
            keys: removedKeys.sort()
          });
        }
        return;
      }

      // A custom pattern-only rule is meaningful: it can whitelist a site while
      // global Speeder is disabled. Never discard it as an "empty" rule.
      exportRules.push(normalizedRule);
    });

    var removedDefaultPatterns = defaultRules
      .map(function (rule) {
        return rule && typeof rule.pattern === "string" ? rule.pattern : "";
      })
      .filter(function (pattern) {
        return pattern && !claimedDefaultPatterns.has(pattern);
      });

    var result = {};
    if (exportRules.length > 0) {
      result.siteRules = exportRules;
      result.siteRulesFormat = SITE_RULES_DIFF_FORMAT;
    }
    if (
      removedDefaultPatterns.length > 0 ||
      removedDefaultRuleKeys.length > 0
    ) {
      result.siteRulesMeta = {};
      if (removedDefaultPatterns.length > 0) {
        result.siteRulesMeta.removedDefaultPatterns = removedDefaultPatterns;
      }
      if (removedDefaultRuleKeys.length > 0) {
        result.siteRulesMeta[REMOVED_DEFAULT_RULE_KEYS_META] =
          removedDefaultRuleKeys;
      }
      result.siteRulesFormat = SITE_RULES_DIFF_FORMAT;
    }

    return result;
  }

  function getRemovedDefaultRuleKeysByPattern(siteRulesMeta) {
    var byPattern = Object.create(null);
    var entries =
      siteRulesMeta &&
      Array.isArray(siteRulesMeta[REMOVED_DEFAULT_RULE_KEYS_META])
        ? siteRulesMeta[REMOVED_DEFAULT_RULE_KEYS_META]
        : [];

    entries.forEach(function (entry) {
      if (
        !entry ||
        typeof entry.pattern !== "string" ||
        !Array.isArray(entry.keys)
      ) {
        return;
      }
      byPattern[entry.pattern] = entry.keys.filter(function (key) {
        return typeof key === "string" && key !== "pattern";
      });
    });
    return byPattern;
  }

  function expandSiteRules(siteRules, siteRulesMeta, supportsRemovedKeys) {
    var defaultRules = getDefaultSiteRules();
    var defaultRulesByPattern = getDefaultSiteRulesByPattern();
    if (defaultRules.length === 0) {
      return Array.isArray(siteRules) ? clonePlainData(siteRules) : [];
    }

    var removedDefaultPatterns = new Set(
      siteRulesMeta && Array.isArray(siteRulesMeta.removedDefaultPatterns)
        ? siteRulesMeta.removedDefaultPatterns
        : []
    );
    var removedKeysByPattern = supportsRemovedKeys
      ? getRemovedDefaultRuleKeysByPattern(siteRulesMeta)
      : Object.create(null);
    var modifiedDefaultRules = Object.create(null);
    var claimedDefaultPatterns = new Set();
    var customRules = [];

    if (Array.isArray(siteRules)) {
      siteRules.forEach(function (rule) {
        if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
          return;
        }

        var pattern = typeof rule.pattern === "string" ? rule.pattern.trim() : "";
        if (
          pattern &&
          Object.prototype.hasOwnProperty.call(defaultRulesByPattern, pattern) &&
          !claimedDefaultPatterns.has(pattern)
        ) {
          claimedDefaultPatterns.add(pattern);
          modifiedDefaultRules[pattern] = normalizeSiteRule(rule);
          return;
        }

        var customRule = normalizeSiteRule(rule);
        if (customRule) customRules.push(customRule);
      });
    }

    var mergedRules = [];

    defaultRules.forEach(function (rule) {
      var pattern = rule && typeof rule.pattern === "string" ? rule.pattern : "";
      if (!pattern || removedDefaultPatterns.has(pattern)) {
        return;
      }

      if (modifiedDefaultRules[pattern]) {
        var mergedRule = Object.assign(
          {},
          clonePlainData(rule),
          clonePlainData(modifiedDefaultRules[pattern])
        );
        (removedKeysByPattern[pattern] || []).forEach(function (key) {
          delete mergedRule[key];
        });
        mergedRules.push(mergedRule);
        return;
      }

      var unmodifiedRule = clonePlainData(rule);
      (removedKeysByPattern[pattern] || []).forEach(function (key) {
        delete unmodifiedRule[key];
      });
      mergedRules.push(unmodifiedRule);
    });

    customRules.forEach(function (rule) {
      mergedRules.push(rule);
    });

    return mergedRules;
  }

  function migrateLegacyFullSiteRules(siteRules) {
    var rules = clonePlainData(siteRules) || [];
    var defaults = getDefaultSiteRules();
    var mobileShortsDefault = defaults[2];
    if (!mobileShortsDefault || !mobileShortsDefault.pattern) return rules;

    // Full-rule backups from versions before rule titles should receive the
    // labels now attached to the built-ins. New saves use the sparse format,
    // where an intentionally removed title is represented by a tombstone.
    defaults.forEach(function(defaultRule) {
      var matchingRule = rules.find(function(rule) {
        return rule && rule.pattern === defaultRule.pattern;
      });
      if (
        matchingRule &&
        !hasOwn(matchingRule, "title") &&
        typeof defaultRule.title === "string"
      ) {
        matchingRule.title = defaultRule.title;
      }
    });

    var alreadyHasMobileRule = rules.some(function(rule) {
      return rule && rule.pattern === mobileShortsDefault.pattern;
    });
    if (alreadyHasMobileRule) return rules;

    // Older Options versions persisted the entire then-default list without a
    // format marker and sometimes filled in extra false/default-valued fields.
    // Presence of both known old default patterns is therefore the reliable
    // signal; the mobile rule did not exist yet, so it could not have been
    // intentionally removed from one of those legacy lists.
    var hasOldDefaultPatterns = defaults.slice(0, 2).every(function(defaultRule) {
      return rules.some(function(rule) {
        return rule && rule.pattern === defaultRule.pattern;
      });
    });
    if (hasOldDefaultPatterns) {
      rules.push(clonePlainData(mobileShortsDefault));
    }
    return rules;
  }

  function buildStoredSettingsDiff(currentSettings) {
    var defaults = clonePlainData(DEFAULT_SETTINGS);
    var normalized = deepMergeDefaults(defaults, currentSettings || {});
    var siteRuleData = compressSiteRules(normalized.siteRules, normalized);
    var diffDefaults = {};
    var diff = {};

    delete normalized.siteRules;
    delete normalized.siteRulesMeta;
    delete normalized.siteRulesFormat;
    delete normalized.hideWithYouTubeControls;

    if (siteRuleData.siteRules) {
      normalized.siteRules = siteRuleData.siteRules;
    }
    if (siteRuleData.siteRulesMeta) {
      normalized.siteRulesMeta = siteRuleData.siteRulesMeta;
    }
    if (siteRuleData.siteRulesFormat) {
      normalized.siteRulesFormat = siteRuleData.siteRulesFormat;
    }

    DIFFABLE_OPTION_KEYS.forEach(function (key) {
      if (hasOwn(DEFAULT_SETTINGS, key)) {
        diffDefaults[key] = clonePlainData(DEFAULT_SETTINGS[key]);
      }
      if (!hasOwn(normalized, key)) {
        return;
      }
      var valueDiff = deepDiff(normalized[key], diffDefaults[key]);
      if (valueDiff !== undefined) {
        diff[key] = valueDiff;
      }
    });

    return diff;
  }

  function legacyKeyCodeToCode(keyCode) {
    var numericCode = Number(keyCode);
    if (!Number.isInteger(numericCode)) return null;
    if (numericCode >= 48 && numericCode <= 57) {
      return "Digit" + String.fromCharCode(numericCode);
    }
    if (numericCode >= 65 && numericCode <= 90) {
      return "Key" + String.fromCharCode(numericCode);
    }
    if (numericCode >= 96 && numericCode <= 105) {
      return "Numpad" + (numericCode - 96);
    }
    if (numericCode >= 112 && numericCode <= 123) {
      return "F" + (numericCode - 111);
    }

    var keyCodeMap = {
      32: "Space",
      37: "ArrowLeft",
      38: "ArrowUp",
      39: "ArrowRight",
      40: "ArrowDown",
      59: "Semicolon",
      61: "Equal",
      106: "NumpadMultiply",
      107: "NumpadAdd",
      109: "NumpadSubtract",
      110: "NumpadDecimal",
      111: "NumpadDivide",
      173: "Minus",
      186: "Semicolon",
      187: "Equal",
      188: "Comma",
      189: "Minus",
      190: "Period",
      191: "Slash",
      192: "Backquote",
      219: "BracketLeft",
      220: "Backslash",
      221: "BracketRight",
      222: "Quote"
    };
    return keyCodeMap[numericCode] || null;
  }

  function finiteNumberOr(value, fallback) {
    var numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
  }

  function sanitizeStoredBindingValues(bindings) {
    var defaultValues = Object.create(null);
    DEFAULT_SETTINGS.keyBindings.forEach(function(binding) {
      defaultValues[binding.action] = Number(binding.value) || 0;
    });
    defaultValues.louder = 0.1;
    defaultValues.softer = 0.1;

    return (Array.isArray(bindings) ? bindings : [])
      .filter(function(binding) {
        return (
          isPlainObject(binding) &&
          typeof binding.action === "string" &&
          binding.action.length > 0
        );
      })
      .map(function(binding) {
      var normalized = clonePlainData(binding) || {};
      var action = normalized.action;
      var value = Number(normalized.value);
      var invalid = !Number.isFinite(value);
      if (action === "slower" || action === "faster") {
        invalid = invalid || value <= 0 || value > MAX_SPEED;
      } else if (action === "fast") {
        invalid = invalid || value < MIN_SPEED || value > MAX_SPEED;
      } else if (action === "rewind" || action === "advance") {
        invalid = invalid || value < 0;
      } else if (action === "louder" || action === "softer") {
        invalid = invalid || value <= 0 || value > 1;
      }
      normalized.value = invalid
        ? (hasOwn(defaultValues, action) ? defaultValues[action] : 0)
        : value;
      normalized.disabled = coerceBoolean(normalized.disabled, false);
      normalized.force = coerceBoolean(normalized.force, false);
      return normalized;
      });
  }

  function hasLegacyShortcutSettings(raw) {
    return [
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
      "displayKeyCode"
    ].some(function (key) {
      return hasOwn(raw, key);
    });
  }

  function migrateLegacyKeyBindings(raw) {
    var bindings = clonePlainData(DEFAULT_SETTINGS.keyBindings);
    var byAction = Object.create(null);
    bindings.forEach(function (binding) {
      byAction[binding.action] = binding;
    });

    var speedStep = finiteNumberOr(raw.speedStep, byAction.faster.value);
    if (speedStep > 0) {
      byAction.slower.value = speedStep;
      byAction.faster.value = speedStep;
    }
    var rewindTime = finiteNumberOr(raw.rewindTime, byAction.rewind.value);
    if (rewindTime >= 0) byAction.rewind.value = rewindTime;
    var advanceTime = finiteNumberOr(raw.advanceTime, byAction.advance.value);
    if (advanceTime >= 0) byAction.advance.value = advanceTime;
    var fastSpeed = finiteNumberOr(raw.fastSpeed, byAction.fast.value);
    if (fastSpeed > 0) byAction.fast.value = fastSpeed;

    [
      ["display", "displayKeyCode"],
      ["reset", "resetKeyCode"],
      ["slower", "slowerKeyCode"],
      ["faster", "fasterKeyCode"],
      ["rewind", "rewindKeyCode"],
      ["advance", "advanceKeyCode"],
      ["fast", "fastKeyCode"]
    ].forEach(function (mapping) {
      if (!hasOwn(raw, mapping[1])) return;
      var code = legacyKeyCodeToCode(raw[mapping[1]]);
      if (code) byAction[mapping[0]].code = code;
    });

    return bindings;
  }

  function migrateLegacyBlacklist(raw) {
    if (typeof raw.blacklist !== "string") return [];
    return raw.blacklist
      .split("\n")
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean)
      .map(function (pattern) {
        return { pattern: pattern, enabled: false };
      });
  }

  function buildManagedStorageMutation(currentStorage, currentSettings) {
    var raw = isPlainObject(currentStorage) ? currentStorage : {};
    var nextSettings = buildStoredSettingsDiff(currentSettings);
    var removeKeys = [];

    MANAGED_SYNC_KEYS.forEach(function (key) {
      if (!hasOwn(nextSettings, key) && hasOwn(raw, key)) {
        removeKeys.push(key);
      }
    });

    return {
      set: nextSettings,
      remove: Array.from(new Set(removeKeys))
    };
  }

  function expandStoredSettings(storage) {
    var raw = isPlainObject(storage) ? clonePlainData(storage) : {};
    var expanded = deepMergeDefaults(DEFAULT_SETTINGS, raw);

    if (
      !hasOwn(raw, "hideWithControls") &&
      hasOwn(raw, "hideWithYouTubeControls")
    ) {
      expanded.hideWithControls = coerceBoolean(
        raw.hideWithYouTubeControls,
        DEFAULT_SETTINGS.hideWithControls
      );
    }

    [
      "rememberSpeed",
      "forceLastSavedSpeed",
      "audioBoolean",
      "showAmbientLoopControls",
      "enabled",
      "startHidden",
      "hideWithControls",
      "showPopupControlBar",
      "popupMatchHoverControls",
      "enableSubtitleNudge",
      "subtitleNudgeEnabledByDefault"
    ].forEach(function(key) {
      expanded[key] = coerceBoolean(expanded[key], DEFAULT_SETTINGS[key]);
    });
    expanded.hideWithYouTubeControls = expanded.hideWithControls;
    expanded.shortcutTargetMode =
      expanded.shortcutTargetMode === "all" ? "all" : "closest";

    expanded.lastSpeed = clampFiniteNumber(
      expanded.lastSpeed,
      MIN_SPEED,
      MAX_SPEED,
      DEFAULT_SETTINGS.lastSpeed
    );
    expanded.hideWithControlsTimer = clampFiniteNumber(
      expanded.hideWithControlsTimer,
      0.1,
      15,
      DEFAULT_SETTINGS.hideWithControlsTimer
    );
    expanded.controllerOpacity = clampFiniteNumber(
      expanded.controllerOpacity,
      0,
      1,
      DEFAULT_SETTINGS.controllerOpacity
    );
    [
      "controllerMarginTop",
      "controllerMarginRight",
      "controllerMarginBottom",
      "controllerMarginLeft"
    ].forEach(function(key) {
      expanded[key] = clampFiniteNumber(
        expanded[key],
        0,
        200,
        DEFAULT_SETTINGS[key]
      );
    });
    expanded.subtitleNudgeInterval = clampFiniteNumber(
      expanded.subtitleNudgeInterval,
      250,
      1000,
      DEFAULT_SETTINGS.subtitleNudgeInterval
    );
    expanded.subtitleNudgeAmount = clampFiniteNumber(
      expanded.subtitleNudgeAmount,
      0.000001,
      0.1,
      DEFAULT_SETTINGS.subtitleNudgeAmount
    );

    if (Array.isArray(raw.keyBindings) && raw.keyBindings.length > 0) {
      expanded.keyBindings = clonePlainData(raw.keyBindings);
    } else if (hasLegacyShortcutSettings(raw)) {
      expanded.keyBindings = migrateLegacyKeyBindings(raw);
    } else {
      expanded.keyBindings = clonePlainData(DEFAULT_SETTINGS.keyBindings);
    }
    expanded.keyBindings = sanitizeStoredBindingValues(expanded.keyBindings);
    if (expanded.keyBindings.length === 0) {
      expanded.keyBindings = clonePlainData(DEFAULT_SETTINGS.keyBindings);
    }

    if (raw.siteRulesFormat === SITE_RULES_DIFF_FORMAT) {
      expanded.siteRules = expandSiteRules(
        raw.siteRules,
        raw.siteRulesMeta,
        true
      );
    } else if (raw.siteRulesFormat === LEGACY_SITE_RULES_DIFF_FORMAT) {
      expanded.siteRules = expandSiteRules(
        raw.siteRules,
        raw.siteRulesMeta,
        false
      );
    } else if (hasOwn(raw, "siteRules") && Array.isArray(raw.siteRules)) {
      expanded.siteRules = migrateLegacyFullSiteRules(raw.siteRules);
    } else if (hasOwn(raw, "blacklist")) {
      expanded.siteRules = getDefaultSiteRules().concat(
        migrateLegacyBlacklist(raw)
      );
    } else {
      expanded.siteRules = getDefaultSiteRules();
    }
    expanded.siteRules = expanded.siteRules
      .map(normalizeSiteRule)
      .filter(Boolean);

    return expanded;
  }

  function escapeStringRegExp(str) {
    var matcher = /[|\\{}()[\]^$+*?.]/g;
    return String(str).replace(matcher, "\\$&");
  }

  function siteRuleMatchesUrl(rule, currentUrl) {
    if (!rule || !rule.pattern || !currentUrl) {
      return false;
    }

    var pattern = String(rule.pattern).trim();
    if (!pattern) {
      return false;
    }

    var regex;
    if (pattern.startsWith("/") && pattern.lastIndexOf("/") === 0) {
      return false;
    }
    if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
      try {
        var lastSlash = pattern.lastIndexOf("/");
        regex = new RegExp(
          pattern.substring(1, lastSlash),
          pattern.substring(lastSlash + 1)
        );
      } catch (_error) {
        return false;
      }
    } else {
      regex = new RegExp(escapeStringRegExp(pattern));
    }

    return Boolean(regex && regex.test(currentUrl));
  }

  function mergeMatchingSiteRules(currentUrl, siteRules) {
    if (!currentUrl || !Array.isArray(siteRules)) {
      return null;
    }

    var matchedRules = [];
    for (var i = 0; i < siteRules.length; i++) {
      if (siteRuleMatchesUrl(siteRules[i], currentUrl)) {
        matchedRules.push(siteRules[i]);
      }
    }

    if (!matchedRules.length) {
      return null;
    }

    var mergedRule = {};
    matchedRules.forEach(function (rule) {
      Object.keys(rule).forEach(function (key) {
        var value = rule[key];
        if (Array.isArray(value)) {
          mergedRule[key] = clonePlainData(value);
          return;
        }
        if (isPlainObject(value)) {
          mergedRule[key] = clonePlainData(value);
          return;
        }
        mergedRule[key] = value;
      });
    });

    return mergedRule;
  }

  function isSiteRuleDisabled(rule) {
    return Boolean(
      rule &&
      (
        rule.enabled === false ||
        (typeof rule.enabled === "undefined" && rule.disableExtension === true)
      )
    );
  }

  global.vscClonePlainData = clonePlainData;
  global.vscAreComparableValuesEqual = areComparableValuesEqual;
  global.vscDeepMergeDefaults = deepMergeDefaults;
  global.vscBuildStoredSettingsDiff = buildStoredSettingsDiff;
  global.vscBuildManagedStorageMutation = buildManagedStorageMutation;
  global.vscExpandStoredSettings = expandStoredSettings;
  global.vscGetSettingsDefaults = function () {
    return clonePlainData(DEFAULT_SETTINGS);
  };
  global.vscGetManagedSyncKeys = function () {
    return MANAGED_SYNC_KEYS.slice();
  };
  global.vscGetSiteRulesDiffFormat = function () {
    return SITE_RULES_DIFF_FORMAT;
  };
  global.vscGetLegacySiteRulesDiffFormat = function () {
    return LEGACY_SITE_RULES_DIFF_FORMAT;
  };
  global.vscMatchSiteRule = function (url, rules) {
    var shared = global.SpeederShared && global.SpeederShared.siteRules;
    return shared && typeof shared.matchSiteRule === "function"
      ? shared.matchSiteRule(url, rules)
      : mergeMatchingSiteRules(url, rules);
  };
  global.vscSiteRuleMatchesUrl = function (rule, url) {
    var shared = global.SpeederShared && global.SpeederShared.siteRules;
    return shared && typeof shared.siteRuleMatchesUrl === "function"
      ? shared.siteRuleMatchesUrl(rule, url)
      : siteRuleMatchesUrl(rule, url);
  };
  global.vscIsSiteRuleDisabled = function (rule) {
    var shared = global.SpeederShared && global.SpeederShared.siteRules;
    return shared && typeof shared.isSiteRuleDisabled === "function"
      ? shared.isSiteRuleDisabled(rule)
      : isSiteRuleDisabled(rule);
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
