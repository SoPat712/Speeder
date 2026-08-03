(function(root, factory) {
  var exports = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = exports;
  }

  root.SpeederShared = root.SpeederShared || {};
  root.SpeederShared.popupControls = exports;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  function normalizeExcludedIds(excludedIds) {
    if (excludedIds instanceof Set) return excludedIds;
    return new Set(Array.isArray(excludedIds) ? excludedIds : []);
  }

  function sanitizeButtonOrder(buttonIds, controllerButtonDefs, excludedIds) {
    if (!Array.isArray(buttonIds)) return [];

    var seen = new Set();
    var excluded = normalizeExcludedIds(excludedIds);

    return buttonIds.filter(function(id) {
      if (!controllerButtonDefs[id] || excluded.has(id) || seen.has(id)) {
        return false;
      }

      seen.add(id);
      return true;
    });
  }

  function resolvePopupButtons(storage, siteRule, options) {
    var settings = storage || {};
    var config = options || {};
    var controllerButtonDefs = config.controllerButtonDefs || {};
    var defaultButtons = Array.isArray(config.defaultButtons)
      ? config.defaultButtons
      : [];
    var excludedIds = config.excludedIds;

    function sanitize(buttonIds) {
      return sanitizeButtonOrder(buttonIds, controllerButtonDefs, excludedIds);
    }

    if (siteRule && Array.isArray(siteRule.popupControllerButtons)) {
      return sanitize(siteRule.popupControllerButtons);
    }

    if (settings.popupMatchHoverControls) {
      if (siteRule && Array.isArray(siteRule.controllerButtons)) {
        return sanitize(siteRule.controllerButtons);
      }

      if (Array.isArray(settings.controllerButtons)) {
        return sanitize(settings.controllerButtons);
      }
    }

    if (Array.isArray(settings.popupControllerButtons)) {
      return sanitize(settings.popupControllerButtons);
    }

    return sanitize(defaultButtons);
  }

  function pickBestFrameSpeedResult(results) {
    if (!results || !results.length) return null;

    function normalizeResult(result) {
      var normalized = { speed: result.speed };
      if (typeof result.frameToken === "string") {
        normalized.frameToken = result.frameToken;
      }
      if (result.diagnostics && typeof result.diagnostics === "object") {
        normalized.diagnostics = result.diagnostics;
      }
      if (typeof result.forceLastSavedSpeed === "boolean") {
        normalized.forceLastSavedSpeed = result.forceLastSavedSpeed;
      }
      if (
        typeof result.forceLastSavedSpeedControlledBySiteRule === "boolean"
      ) {
        normalized.forceLastSavedSpeedControlledBySiteRule =
          result.forceLastSavedSpeedControlledBySiteRule;
      }
      return normalized;
    }

    var fallback = null;
    for (var i = 0; i < results.length; i++) {
      var result = results[i];
      if (!result || typeof result.speed !== "number") continue;
      if (result.preferred) return normalizeResult(result);
      if (!fallback) fallback = normalizeResult(result);
    }

    return fallback;
  }

  function getSafePageDetails(url) {
    try {
      var parsed = new URL(url);
      return {
        protocol: parsed.protocol,
        hostname: parsed.hostname || null
      };
    } catch (_error) {
      return { protocol: null, hostname: null };
    }
  }

  function buildDiagnosticReport(context) {
    var config = context || {};
    var storage = config.storage || {};
    var siteRule = config.siteRule || null;
    var frame = config.frame || null;

    return JSON.stringify(
      {
        speederVersion: config.speederVersion || null,
        browser: config.browser || null,
        platform: config.platform || null,
        page: getSafePageDetails(config.url),
        globalSettings: {
          enabled: storage.enabled !== false,
          rememberSpeed: storage.rememberSpeed === true,
          forceLastSavedSpeed: storage.forceLastSavedSpeed === true,
          audioEnabled: storage.audioBoolean === true,
          startHidden: storage.startHidden === true,
          hideWithControls: storage.hideWithControls === true,
          controllerLocation: storage.controllerLocation,
          shortcutTargetMode: storage.shortcutTargetMode
        },
        matchedSiteRule: {
          matched: Boolean(siteRule),
          disabled: config.siteRuleDisabled === true,
          overrideKeys: siteRule
            ? Object.keys(siteRule)
                .filter(function(key) {
                  return key !== "pattern" && key !== "title";
                })
                .sort()
            : []
        },
        tabPaused: config.tabPaused === true,
        frame: frame && frame.diagnostics ? frame.diagnostics : null
      },
      null,
      2
    );
  }

  return {
    buildDiagnosticReport: buildDiagnosticReport,
    pickBestFrameSpeedResult: pickBestFrameSpeedResult,
    resolvePopupButtons: resolvePopupButtons,
    sanitizeButtonOrder: sanitizeButtonOrder
  };
});
