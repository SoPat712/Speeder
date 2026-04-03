(function (global) {
  "use strict";

  var SITE_RULES_DIFF_FORMAT = "defaults-diff-v1";
  var DEFAULT_BUTTONS = ["rewind", "slower", "faster", "advance", "display"];
  var SITE_RULE_OVERRIDE_KEYS = [
    "controllerLocation",
    "controllerMarginTop",
    "controllerMarginBottom",
    "startHidden",
    "hideWithControls",
    "hideWithControlsTimer",
    "rememberSpeed",
    "forceLastSavedSpeed",
    "audioBoolean",
    "controllerOpacity",
    "enableSubtitleNudge",
    "subtitleNudgeInterval",
    "controllerButtons",
    "showPopupControlBar",
    "popupControllerButtons",
    "shortcuts",
    "preferredSpeed"
  ];
  var DIFFABLE_OPTION_KEYS = [
    "rememberSpeed",
    "forceLastSavedSpeed",
    "audioBoolean",
    "enabled",
    "startHidden",
    "hideWithControls",
    "hideWithControlsTimer",
    "controllerLocation",
    "controllerOpacity",
    "controllerMarginTop",
    "controllerMarginBottom",
    "keyBindings",
    "siteRules",
    "siteRulesMeta",
    "siteRulesFormat",
    "controllerButtons",
    "showPopupControlBar",
    "popupMatchHoverControls",
    "popupControllerButtons",
    "enableSubtitleNudge",
    "subtitleNudgeInterval",
    "subtitleNudgeAmount"
  ];
  var MANAGED_SYNC_KEYS = DIFFABLE_OPTION_KEYS.concat([
    "hideWithYouTubeControls"
  ]);

  var DEFAULT_SETTINGS = {
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
      {
        action: "display",
        key: "V",
        keyCode: 86,
        code: null,
        disabled: false,
        value: 0,
        force: false,
        predefined: true
      },
      {
        action: "move",
        key: "P",
        keyCode: 80,
        code: null,
        disabled: false,
        value: 0,
        force: false,
        predefined: true
      },
      {
        action: "slower",
        key: "S",
        keyCode: 83,
        code: null,
        disabled: false,
        value: 0.1,
        force: false,
        predefined: true
      },
      {
        action: "faster",
        key: "D",
        keyCode: 68,
        code: null,
        disabled: false,
        value: 0.1,
        force: false,
        predefined: true
      },
      {
        action: "rewind",
        key: "Z",
        keyCode: 90,
        code: null,
        disabled: false,
        value: 10,
        force: false,
        predefined: true
      },
      {
        action: "advance",
        key: "X",
        keyCode: 88,
        code: null,
        disabled: false,
        value: 10,
        force: false,
        predefined: true
      },
      {
        action: "reset",
        key: "R",
        keyCode: 82,
        code: null,
        disabled: false,
        value: 0,
        force: false,
        predefined: true
      },
      {
        action: "fast",
        key: "G",
        keyCode: 71,
        code: null,
        disabled: false,
        value: 1.8,
        force: false,
        predefined: true
      },
      {
        action: "toggleSubtitleNudge",
        key: "N",
        keyCode: 78,
        code: null,
        disabled: false,
        value: 0,
        force: false,
        predefined: true
      }
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
    controllerButtons: DEFAULT_BUTTONS.slice(),
    showPopupControlBar: true,
    popupMatchHoverControls: true,
    popupControllerButtons: DEFAULT_BUTTONS.slice(),
    enableSubtitleNudge: false,
    subtitleNudgeInterval: 50,
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

  function normalizeSiteRuleForDiff(rule, baseSettings) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      return null;
    }

    var pattern = typeof rule.pattern === "string" ? rule.pattern.trim() : "";
    if (!pattern) {
      return null;
    }

    var normalized = { pattern: pattern };
    var baseEnabled = hasOwn(baseSettings, "enabled")
      ? Boolean(baseSettings.enabled)
      : true;
    var ruleEnabled = hasOwn(rule, "enabled")
      ? Boolean(rule.enabled)
      : hasOwn(rule, "disableExtension")
        ? !Boolean(rule.disableExtension)
        : baseEnabled;

    if (!areComparableValuesEqual(ruleEnabled, baseEnabled)) {
      normalized.enabled = ruleEnabled;
    }

    SITE_RULE_OVERRIDE_KEYS.forEach(function (key) {
      var baseValue = clonePlainData(baseSettings[key]);
      var effectiveValue = hasOwn(rule, key)
        ? clonePlainData(rule[key])
        : baseValue;

      if (!areComparableValuesEqual(effectiveValue, baseValue)) {
        normalized[key] = effectiveValue;
      }
    });

    Object.keys(rule).forEach(function (key) {
      if (
        key === "pattern" ||
        key === "enabled" ||
        key === "disableExtension" ||
        SITE_RULE_OVERRIDE_KEYS.indexOf(key) !== -1 ||
        rule[key] === undefined
      ) {
        return;
      }

      normalized[key] = clonePlainData(rule[key]);
    });

    return normalized;
  }

  function compressSiteRules(siteRules, baseSettings) {
    if (!Array.isArray(siteRules)) {
      return {};
    }

    var defaultRules = getDefaultSiteRules();
    var defaultRulesByPattern = getDefaultSiteRulesByPattern();
    var currentPatterns = new Set();
    var exportRules = [];

    siteRules.forEach(function (rule) {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
        return;
      }

      var pattern = typeof rule.pattern === "string" ? rule.pattern.trim() : "";
      if (pattern) {
        currentPatterns.add(pattern);
      }

      var normalizedRule = normalizeSiteRuleForDiff(rule, baseSettings);
      if (!normalizedRule || Object.keys(normalizedRule).length === 1) {
        return;
      }

      var defaultRule = pattern ? defaultRulesByPattern[pattern] : null;
      var normalizedDefaultRule = defaultRule
        ? normalizeSiteRuleForDiff(defaultRule, baseSettings)
        : null;
      if (normalizedDefaultRule) {
        if (areComparableValuesEqual(normalizedRule, normalizedDefaultRule)) {
          return;
        }

        var defaultRuleDiff = deepDiff(normalizedRule, normalizedDefaultRule);
        if (defaultRuleDiff && Object.keys(defaultRuleDiff).length > 0) {
          defaultRuleDiff.pattern = pattern;
          exportRules.push(defaultRuleDiff);
        }
        return;
      }

      exportRules.push(normalizedRule);
    });

    var removedDefaultPatterns = defaultRules
      .map(function (rule) {
        return rule && typeof rule.pattern === "string" ? rule.pattern : "";
      })
      .filter(function (pattern) {
        return pattern && !currentPatterns.has(pattern);
      });

    var result = {};
    if (exportRules.length > 0) {
      result.siteRules = exportRules;
      result.siteRulesFormat = SITE_RULES_DIFF_FORMAT;
    }
    if (removedDefaultPatterns.length > 0) {
      result.siteRulesMeta = {
        removedDefaultPatterns: removedDefaultPatterns
      };
      result.siteRulesFormat = SITE_RULES_DIFF_FORMAT;
    }

    return result;
  }

  function expandSiteRules(siteRules, siteRulesMeta) {
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
    var modifiedDefaultRules = Object.create(null);
    var customRules = [];

    if (Array.isArray(siteRules)) {
      siteRules.forEach(function (rule) {
        if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
          return;
        }

        var pattern = typeof rule.pattern === "string" ? rule.pattern.trim() : "";
        if (
          pattern &&
          Object.prototype.hasOwnProperty.call(defaultRulesByPattern, pattern)
        ) {
          modifiedDefaultRules[pattern] = clonePlainData(rule);
          return;
        }

        customRules.push(clonePlainData(rule));
      });
    }

    var mergedRules = [];

    defaultRules.forEach(function (rule) {
      var pattern = rule && typeof rule.pattern === "string" ? rule.pattern : "";
      if (!pattern || removedDefaultPatterns.has(pattern)) {
        return;
      }

      if (modifiedDefaultRules[pattern]) {
        mergedRules.push(
          Object.assign(
            {},
            clonePlainData(rule),
            clonePlainData(modifiedDefaultRules[pattern])
          )
        );
        return;
      }

      mergedRules.push(clonePlainData(rule));
    });

    customRules.forEach(function (rule) {
      mergedRules.push(rule);
    });

    return mergedRules;
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

  function expandStoredSettings(storage) {
    var raw = clonePlainData(storage) || {};
    var expanded = deepMergeDefaults(DEFAULT_SETTINGS, raw);

    if (
      !hasOwn(raw, "hideWithControls") &&
      hasOwn(raw, "hideWithYouTubeControls")
    ) {
      expanded.hideWithControls = Boolean(raw.hideWithYouTubeControls);
    }
    expanded.hideWithYouTubeControls = expanded.hideWithControls;

    if (raw.siteRulesFormat === SITE_RULES_DIFF_FORMAT) {
      expanded.siteRules = expandSiteRules(raw.siteRules, raw.siteRulesMeta);
    } else if (Array.isArray(raw.siteRules)) {
      expanded.siteRules = clonePlainData(raw.siteRules);
    } else {
      expanded.siteRules = getDefaultSiteRules();
    }

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
  global.vscMatchSiteRule = mergeMatchingSiteRules;
  global.vscSiteRuleMatchesUrl = siteRuleMatchesUrl;
  global.vscIsSiteRuleDisabled = isSiteRuleDisabled;
})(typeof globalThis !== "undefined" ? globalThis : this);
