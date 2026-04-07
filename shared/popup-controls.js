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

    var fallback = null;
    for (var i = 0; i < results.length; i++) {
      var result = results[i];
      if (!result || typeof result.speed !== "number") continue;
      if (result.preferred) return { speed: result.speed };
      if (!fallback) fallback = { speed: result.speed };
    }

    return fallback;
  }

  return {
    pickBestFrameSpeedResult: pickBestFrameSpeedResult,
    resolvePopupButtons: resolvePopupButtons,
    sanitizeButtonOrder: sanitizeButtonOrder
  };
});
