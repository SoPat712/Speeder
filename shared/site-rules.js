(function(root, factory) {
  var exports = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = exports;
  }

  root.SpeederShared = root.SpeederShared || {};
  root.SpeederShared.siteRules = exports;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  var regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;

  function escapeStringRegExp(str) {
    return String(str).replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
  }

  function compileSiteRulePattern(pattern) {
    if (typeof pattern !== "string") return null;

    var normalizedPattern = pattern.replace(regStrip, "");
    if (normalizedPattern.length === 0) return null;

    if (
      normalizedPattern.startsWith("/") &&
      normalizedPattern.lastIndexOf("/") > 0
    ) {
      var lastSlash = normalizedPattern.lastIndexOf("/");
      return new RegExp(
        normalizedPattern.substring(1, lastSlash),
        normalizedPattern.substring(lastSlash + 1)
      );
    }

    return new RegExp(escapeStringRegExp(normalizedPattern));
  }

  function matchSiteRule(url, siteRules) {
    if (!url || !Array.isArray(siteRules)) return null;

    for (var i = 0; i < siteRules.length; i++) {
      var rule = siteRules[i];
      if (!rule || !rule.pattern) continue;

      try {
        var re = compileSiteRulePattern(rule.pattern);
        if (re && re.test(url)) {
          return rule;
        }
      } catch (e) {
      }
    }

    return null;
  }

  function isSiteRuleDisabled(rule) {
    return Boolean(
      rule &&
      (rule.enabled === false || rule.disableExtension === true)
    );
  }

  /**
   * Whether Speeder should run on this URL given global enabled and the matched rule (if any).
   * - No rule: follows global (enabled unless explicitly false).
   * - Rule with site "off" / disableExtension: always inactive (blacklist).
   * - Rule with site "on": active even when global is off (whitelist).
   */
  function isSpeederActiveForSite(globalEnabled, siteRule) {
    var globalOn = globalEnabled !== false;
    if (!siteRule) {
      return globalOn;
    }
    if (isSiteRuleDisabled(siteRule)) {
      return false;
    }
    return true;
  }

  return {
    compileSiteRulePattern: compileSiteRulePattern,
    escapeStringRegExp: escapeStringRegExp,
    isSiteRuleDisabled: isSiteRuleDisabled,
    isSpeederActiveForSite: isSpeederActiveForSite,
    matchSiteRule: matchSiteRule
  };
});
