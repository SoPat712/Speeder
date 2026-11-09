(function (global) {
  "use strict";

  var LEGACY_SITE_RULES_DIFF_FORMAT = "defaults-diff-v1";
  var SITE_RULES_DIFF_FORMAT = "defaults-diff-v2";
  var REMOVED_DEFAULT_RULE_KEYS_META = "removedDefaultRuleKeys";
  // Marks site rules saved with tri-state `enabled` (absent = follow global).
  // Data without it predates that change: built-in rules then carried
  // `enabled: true`, and an `enabled: true` rule only mattered while global
  // Speeder was off. Kept inside siteRulesMeta so older versions still read
  // the v2 diff, and drop the marker when they rewrite it.
  var ENABLED_TRI_STATE_META = "enabledTriState";
  var MIN_SPEED = 0.1;
  var MAX_SPEED = 16;
  var CONTROLLER_LOCATIONS = [
    "top-left", "top-center", "top-right", "middle-right", "bottom-right",
    "bottom-center", "bottom-left", "middle-left"
  ];
  // Control-bar buttons in UI order. `name` labels the Options editor;
  // `title` is the tooltip/accessible name on the in-page and popup bars;
  // `fallbackIcon` is shown only when ui-icons.js has no icon for the id.
  var BUTTON_DEFS = {
    rewind: { name: "Rewind", title: "Rewind", fallbackIcon: "\u00AB", className: "rw" },
    slower: { name: "Decrease speed", title: "Decrease speed", fallbackIcon: "\u2212" },
    faster: { name: "Increase speed", title: "Increase speed", fallbackIcon: "+" },
    advance: { name: "Advance", title: "Advance", fallbackIcon: "\u00BB", className: "rw" },
    display: {
      name: "Close controller",
      title: "Show or hide controller",
      fallbackIcon: "\u00D7",
      className: "hideButton"
    },
    reset: { name: "Reset speed", title: "Reset speed", fallbackIcon: "\u21BB" },
    fast: { name: "Preferred speed", title: "Toggle preferred speed", fallbackIcon: "\u2605" },
    nudge: { name: "Subtitle nudge", title: "Toggle subtitle nudge", fallbackIcon: "\u2713" },
    pause: { name: "Play / Pause", title: "Play or pause", fallbackIcon: "\u23EF" },
    muted: { name: "Mute / Unmute", title: "Mute or unmute", fallbackIcon: "M" },
    louder: { name: "Increase volume", title: "Increase volume", fallbackIcon: "+" },
    softer: { name: "Decrease volume", title: "Decrease volume", fallbackIcon: "\u2212" },
    mark: { name: "Set marker", title: "Mark position", fallbackIcon: "\u2691" },
    jump: { name: "Jump to marker", title: "Jump to marked position", fallbackIcon: "\u21E5" },
    settings: {
      name: "Settings",
      title: "Open Speeder settings",
      fallbackIcon: "\u2699",
      popupAllowed: false
    }
  };
  Object.keys(BUTTON_DEFS).forEach(function (id) {
    var def = BUTTON_DEFS[id];
    if (def.className === undefined) def.className = "";
    if (def.popupAllowed === undefined) def.popupAllowed = true;
  });
  // Shortcut actions in the order Options offers them. `defaultValue` is set
  // exactly for the actions that take a value.
  var ACTION_DEFS = {
    display: { label: "Show/hide controller" },
    move: { label: "Move controller" },
    slower: { label: "Decrease speed", defaultValue: 0.1 },
    faster: { label: "Increase speed", defaultValue: 0.1 },
    rewind: { label: "Rewind", defaultValue: 10 },
    advance: { label: "Advance", defaultValue: 10 },
    reset: { label: "Reset speed" },
    fast: { label: "Preferred speed", defaultValue: 1.8 },
    toggleSubtitleNudge: { label: "Toggle subtitle nudge" },
    pause: { label: "Play / Pause" },
    muted: { label: "Mute / Unmute" },
    louder: { label: "Increase volume", defaultValue: 0.1 },
    softer: { label: "Decrease volume", defaultValue: 0.1 },
    mark: { label: "Set marker" },
    jump: { label: "Jump to marker" }
  };
  Object.keys(ACTION_DEFS).forEach(function (action) {
    ACTION_DEFS[action].hasValue = ACTION_DEFS[action].defaultValue !== undefined;
  });
  var BUTTON_IDS = new Set(Object.keys(BUTTON_DEFS));
  var POPUP_BUTTON_IDS = new Set(Object.keys(BUTTON_DEFS).filter(function (id) {
    return BUTTON_DEFS[id].popupAllowed;
  }));
  // "blink" and "drag" are internal controller actions with no UI entry.
  var KNOWN_ACTIONS = new Set(
    Object.keys(BUTTON_DEFS).concat(Object.keys(ACTION_DEFS), ["blink", "drag"])
  );
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
        pattern: "/^https:\\/\\/(www\\.)?youtube\\.com\\/(?!shorts\\/).*/"
      },
      {
        title: "YouTube Shorts",
        pattern: "/^https:\\/\\/(www\\.)?youtube\\.com\\/shorts\\/.*/",
        rememberSpeed: true,
        controllerMarginTop: 60,
        controllerMarginBottom: 85
      },
      {
        title: "YouTube Shorts (mobile)",
        pattern: "/^https:\\/\\/m\\.youtube\\.com\\/shorts\\/.*/",
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

  function getDefaultSiteRules(legacyEnabled) {
    var rules = clonePlainData(DEFAULT_SETTINGS.siteRules) || [];
    if (legacyEnabled) {
      rules.forEach(function (rule) {
        rule.enabled = true;
      });
    }
    return rules;
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

  function normalizeButtonIds(value, fallback, popup) {
    if (!Array.isArray(value)) return clonePlainData(fallback);
    return value.filter(function(id, index) {
      return (popup ? POPUP_BUTTON_IDS : BUTTON_IDS).has(id) && value.indexOf(id) === index;
    });
  }

  function normalizeLocation(value, fallback) {
    return CONTROLLER_LOCATIONS.indexOf(value) !== -1 ? value : fallback;
  }

  function reportRepair(report, path, before, after) {
    if (report && !areComparableValuesEqual(before, after)) report.push(path);
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
    if (key === "controllerLocation") return normalizeLocation(value, DEFAULT_SETTINGS.controllerLocation);
    if (key === "controllerButtons" || key === "popupControllerButtons") {
      return Array.isArray(value) ? normalizeButtonIds(value, [], key === "popupControllerButtons") : undefined;
    }
    if (key === "subtitleNudgeAmount") return clampFiniteNumber(value, 0.000001, 0.1, undefined);
    return undefined;
  }

  function normalizeSiteRule(rule) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      return null;
    }

    var pattern = typeof rule.pattern === "string" ? rule.pattern.trim() : "";
    if (!pattern || rule.pattern.length > 2048) {
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

  function compressSiteRules(siteRules, settings) {
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

      // Never discard a custom pattern-only rule as "empty": the user added it
      // (for example from the popup) and may still customize it.
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
    // Without stored rules, legacy and tri-state data only differ while global
    // Speeder is off (legacy built-ins were whitelisted), so mark that case too.
    if (result.siteRulesFormat || (settings && settings.enabled === false)) {
      result.siteRulesMeta = result.siteRulesMeta || {};
      result.siteRulesMeta[ENABLED_TRI_STATE_META] = true;
      result.siteRulesFormat = SITE_RULES_DIFF_FORMAT;
    }

    return result;
  }

  function hasTriStateSiteRules(raw) {
    return (
      raw.siteRulesFormat === SITE_RULES_DIFF_FORMAT &&
      isPlainObject(raw.siteRulesMeta) &&
      raw.siteRulesMeta[ENABLED_TRI_STATE_META] === true
    );
  }

  function migrateLegacySiteRuleEnabled(siteRules, globalEnabled) {
    if (globalEnabled === false) return siteRules;
    siteRules.forEach(function (rule) {
      if (rule.enabled === true) delete rule.enabled;
    });
    return siteRules;
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

  function expandSiteRules(
    siteRules,
    siteRulesMeta,
    supportsRemovedKeys,
    legacyEnabled
  ) {
    var defaultRules = getDefaultSiteRules(legacyEnabled);
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
    var defaults = getDefaultSiteRules(true);
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
    var normalized = expandStoredSettings(currentSettings || {}, null, true);
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
    var numericCode = finiteNumberOr(keyCode, NaN);
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
    try {
      var numericValue = Number(value);
      return Number.isFinite(numericValue) ? numericValue : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function getActionValueError(action, value) {
    var numericValue = finiteNumberOr(value, NaN);
    if (!Number.isFinite(numericValue)) return "must be a finite number";
    if (
      (action === "slower" || action === "faster") &&
      (numericValue <= 0 || numericValue > MAX_SPEED)
    ) {
      return "must be greater than 0 and no more than " + MAX_SPEED;
    }
    if (
      action === "fast" &&
      (numericValue < MIN_SPEED || numericValue > MAX_SPEED)
    ) {
      return "must be between " + MIN_SPEED + " and " + MAX_SPEED;
    }
    if (
      (action === "rewind" || action === "advance") &&
      numericValue < 0
    ) {
      return "must be zero or greater";
    }
    if (
      (action === "louder" || action === "softer") &&
      (numericValue <= 0 || numericValue > 1)
    ) {
      return "must be greater than 0 and no more than 1";
    }
    return null;
  }

  function sanitizeActionValue(action, value, fallback) {
    if (!getActionValueError(action, value)) return Number(value);
    if (!getActionValueError(action, fallback)) return Number(fallback);
    if (hasOwn(ACTION_DEFS, action) && ACTION_DEFS[action].hasValue) {
      return ACTION_DEFS[action].defaultValue;
    }
    return 0;
  }


  function sanitizeStoredBindingValues(bindings) {
    return (Array.isArray(bindings) ? bindings : []).filter(function(binding) {
      return isPlainObject(binding) && KNOWN_ACTIONS.has(binding.action);
    }).map(function(binding) {
      var normalized = { action: binding.action };
      ["code", "key"].forEach(function(key) {
        if (typeof binding[key] === "string" && binding[key].length <= 128) {
          normalized[key] = binding[key];
        } else if (binding[key] === null) {
          normalized[key] = null;
        }
      });
      // Numeric keys were the original backup format, before KeyboardEvent.code.
      if (Number.isInteger(binding.key)) normalized.key = binding.key;
      if (Number.isInteger(binding.keyCode)) normalized.keyCode = binding.keyCode;
      normalized.value = sanitizeActionValue(binding.action, binding.value);
      normalized.disabled = coerceBoolean(binding.disabled, false) ||
        (binding.code === null && binding.key === null && binding.keyCode === null);
      normalized.force = coerceBoolean(binding.force, false);
      if (hasOwn(binding, "shiftKey")) normalized.shiftKey = binding.shiftKey === true;
      if (hasOwn(binding, "predefined")) normalized.predefined = Boolean(binding.predefined);
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

  function migrateLegacyBlacklist(raw, report) {
    if (typeof raw.blacklist !== "string") return [];
    return raw.blacklist
      .split("\n")
      .map(function (line) {
        return line.trim();
      })
      .map(function (pattern, index) {
        if (!pattern) return null;
        var rule = { pattern: pattern, enabled: false };
        var normalized = normalizeSiteRule(rule);
        reportRepair(report, "blacklist[" + index + "]", rule, normalized);
        return normalized;
      }).filter(Boolean);
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

  function expandStoredSettings(storage, report, alreadyExpanded) {
    var raw = isPlainObject(storage) ? clonePlainData(storage) : {};
    var expanded = deepMergeDefaults(DEFAULT_SETTINGS, raw);
    if (Array.isArray(raw.siteRules)) {
      raw.siteRules = raw.siteRules.map(function(rule, index) {
        var normalized = normalizeSiteRule(rule);
        reportRepair(report, "siteRules[" + index + "]", rule, normalized);
        return normalized;
      }).filter(Boolean);
    } else if (report && hasOwn(raw, "siteRules")) {
      report.push("siteRules");
    }
    expanded.controllerLocation = normalizeLocation(expanded.controllerLocation, DEFAULT_SETTINGS.controllerLocation);
    ["controllerButtons", "popupControllerButtons"].forEach(function(key) {
      expanded[key] = normalizeButtonIds(expanded[key], DEFAULT_SETTINGS[key], key === "popupControllerButtons");
    });

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

    var legacyEnabled = !alreadyExpanded && !hasTriStateSiteRules(raw);
    if (alreadyExpanded) {
      expanded.siteRules = raw.siteRules || getDefaultSiteRules();
    } else if (raw.siteRulesFormat === SITE_RULES_DIFF_FORMAT) {
      expanded.siteRules = expandSiteRules(
        raw.siteRules,
        raw.siteRulesMeta,
        true,
        legacyEnabled
      );
    } else if (raw.siteRulesFormat === LEGACY_SITE_RULES_DIFF_FORMAT) {
      expanded.siteRules = expandSiteRules(
        raw.siteRules,
        raw.siteRulesMeta,
        false,
        true
      );
    } else if (hasOwn(raw, "siteRules") && Array.isArray(raw.siteRules)) {
      expanded.siteRules = migrateLegacyFullSiteRules(raw.siteRules);
    } else if (hasOwn(raw, "blacklist")) {
      expanded.siteRules = getDefaultSiteRules(true).concat(
        migrateLegacyBlacklist(raw, report)
      );
    } else {
      expanded.siteRules = getDefaultSiteRules(true);
    }
    expanded.siteRules = expanded.siteRules
      .map(normalizeSiteRule)
      .filter(Boolean);
    if (legacyEnabled) {
      migrateLegacySiteRuleEnabled(expanded.siteRules, expanded.enabled);
    }

    if (report) {
      Object.keys(raw).forEach(function(key) {
        if (MANAGED_SYNC_KEYS.indexOf(key) === -1 && key !== "lastSpeed" && key !== "speed") {
          report.push(key);
        }
      });
      DIFFABLE_OPTION_KEYS.concat(["lastSpeed"]).forEach(function(key) {
        if (key === "siteRules" || key === "siteRulesMeta" || key === "siteRulesFormat") return;
        if (hasOwn(raw, key)) reportRepair(report, key, raw[key], expanded[key]);
      });
    }
    return expanded;
  }

  function normalizeLocalSettings(local, report) {
    var normalized = {};
    if (!isPlainObject(local) || !hasOwn(local, "customButtonIcons")) return normalized;
    var icons = local.customButtonIcons;
    var clean = {};
    if (isPlainObject(icons)) {
      Object.keys(icons).forEach(function(id) {
        var entry = icons[id];
        var path = "customButtonIcons." + id;
        if ((!BUTTON_IDS.has(id) && id !== "subtitleNudgeOn" && id !== "subtitleNudgeOff") ||
            !isPlainObject(entry) || typeof entry.slug !== "string" || entry.slug.length > 128 ||
            !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(entry.slug) || typeof entry.svg !== "string") {
          if (report) report.push(path);
          return;
        }
        var repaired = false;
        var svg = typeof global.vscParseSvg === "function"
          ? global.vscParseSvg(entry.svg, function() { repaired = true; }) : null;
        if (!svg) {
          if (report) report.push(path);
          return;
        }
        clean[id] = { slug: entry.slug, svg: repaired ? svg.outerHTML : entry.svg };
        reportRepair(report, path, entry, clean[id]);
      });
    } else if (report) {
      report.push("customButtonIcons");
    }
    normalized.customButtonIcons = clean;
    return normalized;
  }

  function writeManagedStorageMutation(mutation, callback) {
    function removeStaleKeys() {
      if (!mutation.remove.length) {
        callback(null);
        return;
      }
      chrome.storage.sync.remove(mutation.remove, function () {
        callback(chrome.runtime.lastError || null);
      });
    }

    if (!Object.keys(mutation.set).length) {
      removeStaleKeys();
      return;
    }

    // Preserve old settings if writing their replacement fails.
    chrome.storage.sync.set(mutation.set, function () {
      if (chrome.runtime.lastError) {
        callback(chrome.runtime.lastError);
        return;
      }
      removeStaleKeys();
    });
  }

  global.vscWriteManagedStorageMutation = writeManagedStorageMutation;
  global.vscLegacyKeyCodeToCode = legacyKeyCodeToCode;
  global.vscGetButtonIds = function () {
    return Array.from(BUTTON_IDS);
  };
  global.vscGetButtonDefs = function () {
    return clonePlainData(BUTTON_DEFS);
  };
  global.vscGetActionDefs = function () {
    return clonePlainData(ACTION_DEFS);
  };
  global.vscGetSpeedLimits = function () {
    return { min: MIN_SPEED, max: MAX_SPEED };
  };
  global.vscGetDefaultButtonIds = function () {
    return DEFAULT_BUTTONS.slice();
  };
  global.vscNormalizeLocalSettings = normalizeLocalSettings;
  global.vscGetActionValueError = getActionValueError;
  global.vscSanitizeActionValue = sanitizeActionValue;
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
})(typeof globalThis !== "undefined" ? globalThis : this);
