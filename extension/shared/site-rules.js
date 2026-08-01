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

  // Decode valid percent-encoded runs without letting one malformed escape make
  // the entire URL unusable. This also preserves incomplete UTF-8 bytes instead
  // of replacing them with lossy placeholder characters.
  function safelyDecodeUrlText(value) {
    return String(value).replace(/(?:%[\da-f]{2})+/gi, function(encodedRun) {
      var decoded = "";
      var tripletCount = encodedRun.length / 3;
      var tripletIndex = 0;

      while (tripletIndex < tripletCount) {
        var tripletOffset = tripletIndex * 3;
        var firstByte = parseInt(
          encodedRun.substring(tripletOffset + 1, tripletOffset + 3),
          16
        );
        var sequenceLength = firstByte <= 0x7f
          ? 1
          : firstByte >= 0xc2 && firstByte <= 0xdf
            ? 2
            : firstByte >= 0xe0 && firstByte <= 0xef
              ? 3
              : firstByte >= 0xf0 && firstByte <= 0xf4
                ? 4
                : 0;
        var encodedSequence = sequenceLength
          ? encodedRun.substring(
            tripletOffset,
            tripletOffset + sequenceLength * 3
          )
          : "";

        if (
          sequenceLength &&
          tripletIndex + sequenceLength <= tripletCount
        ) {
          try {
            decoded += decodeURIComponent(encodedSequence);
            tripletIndex += sequenceLength;
            continue;
          } catch (_error) {
            // Preserve this byte below, then retry at the next triplet so a
            // later valid character in the same run can still be decoded.
          }
        }

        decoded += encodedRun.substring(tripletOffset, tripletOffset + 3);
        tripletIndex += 1;
      }

      return decoded;
    });
  }

  function decodedUrlMatchCandidate(url) {
    var parsedUrl;
    try {
      parsedUrl = new URL(String(url));
    } catch (_error) {
      return null;
    }

    var authority = "";
    if (parsedUrl.host || parsedUrl.protocol === "file:") {
      authority = "//";
      if (parsedUrl.username) {
        authority += parsedUrl.username;
        if (parsedUrl.password) authority += ":" + parsedUrl.password;
        authority += "@";
      }
      authority += parsedUrl.host;
    }

    return (
      parsedUrl.protocol +
      authority +
      safelyDecodeUrlText(parsedUrl.pathname || "") +
      (parsedUrl.search
        ? "?" + safelyDecodeUrlText(parsedUrl.search.substring(1))
        : "") +
      (parsedUrl.hash
        ? "#" + safelyDecodeUrlText(parsedUrl.hash.substring(1))
        : "")
    );
  }

  function parsePlainSitePattern(pattern) {
    var normalized = String(pattern).replace(regStrip, "");
    if (!normalized) return null;

    var hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(normalized);
    var wildcardSubdomains = false;
    var parsed;

    try {
      if (hasScheme) {
        parsed = new URL(normalized);
      } else {
        var slashIndex = normalized.indexOf("/");
        var authority = slashIndex === -1
          ? normalized
          : normalized.substring(0, slashIndex);
        var path = slashIndex === -1 ? "" : normalized.substring(slashIndex);
        if (authority.indexOf("@") !== -1 || /[?#]/.test(authority)) return null;
        if (authority.indexOf("*.") === 0) {
          wildcardSubdomains = true;
          authority = authority.substring(2);
        }
        parsed = new URL("http://" + authority + path);
      }
    } catch (_error) {
      return null;
    }

    var hostname = String(parsed.hostname || "").toLowerCase().replace(/\.$/, "");
    if (!hostname && parsed.protocol !== "file:") return null;

    var pathPrefix = parsed.pathname || "";
    if (!hasScheme && pathPrefix === "/") pathPrefix = "";
    if (parsed.search) pathPrefix += parsed.search;
    if (parsed.hash) pathPrefix += parsed.hash;

    return {
      protocol: hasScheme ? parsed.protocol : null,
      hostname: hostname,
      port: parsed.port || "",
      pathPrefix: pathPrefix,
      wildcardSubdomains: wildcardSubdomains
    };
  }

  function plainSitePatternMatchesUrl(pattern, url) {
    var parsedPattern = parsePlainSitePattern(pattern);
    if (!parsedPattern) return false;

    var parsedUrl;
    try {
      parsedUrl = new URL(String(url));
    } catch (_error) {
      return false;
    }

    if (parsedPattern.protocol && parsedPattern.protocol !== parsedUrl.protocol) {
      return false;
    }
    if (parsedPattern.port && parsedPattern.port !== parsedUrl.port) {
      return false;
    }

    var currentHost = String(parsedUrl.hostname || "").toLowerCase().replace(/\.$/, "");
    var hostMatches =
      currentHost === parsedPattern.hostname ||
      currentHost.endsWith("." + parsedPattern.hostname);
    if (!hostMatches) return false;
    if (
      parsedPattern.wildcardSubdomains &&
      currentHost === parsedPattern.hostname
    ) {
      return false;
    }

    if (parsedPattern.pathPrefix) {
      var currentPath =
        (parsedUrl.pathname || "/") +
        (parsedUrl.search || "") +
        (parsedUrl.hash || "");
      var decodedPatternPath = safelyDecodeUrlText(parsedPattern.pathPrefix);
      if (
        !currentPath.startsWith(parsedPattern.pathPrefix) &&
        !safelyDecodeUrlText(currentPath).startsWith(decodedPatternPath)
      ) {
        return false;
      }
    }

    return true;
  }

  function compileSiteRulePattern(pattern) {
    if (typeof pattern !== "string") return null;

    var normalizedPattern = pattern.replace(regStrip, "");
    if (normalizedPattern.length === 0) return null;

    if (
      normalizedPattern.startsWith("/") &&
      normalizedPattern.lastIndexOf("/") === 0
    ) {
      return null;
    }

    if (
      normalizedPattern.startsWith("/") &&
      normalizedPattern.lastIndexOf("/") > 0
    ) {
      var lastSlash = normalizedPattern.lastIndexOf("/");
      var regularExpression = new RegExp(
        normalizedPattern.substring(1, lastSlash),
        normalizedPattern.substring(lastSlash + 1)
      );
      return {
        test: function(url) {
          var rawUrl = String(url);
          var decodedUrl = decodedUrlMatchCandidate(rawUrl);
          var candidates = decodedUrl && decodedUrl !== rawUrl
            ? [rawUrl, decodedUrl]
            : [rawUrl];

          for (var i = 0; i < candidates.length; i++) {
            // Global and sticky expressions retain state between test() calls.
            // Site matching must be deterministic across navigation checks.
            regularExpression.lastIndex = 0;
            if (regularExpression.test(candidates[i])) {
              regularExpression.lastIndex = 0;
              return true;
            }
          }
          regularExpression.lastIndex = 0;
          return false;
        }
      };
    }

    return {
      test: function(url) {
        return plainSitePatternMatchesUrl(normalizedPattern, url);
      }
    };
  }

  function siteRuleMatchesUrl(rule, url) {
    if (!rule || !rule.pattern || !url) return false;
    try {
      var matcher = compileSiteRulePattern(rule.pattern);
      return Boolean(matcher && matcher.test(url));
    } catch (_error) {
      return false;
    }
  }

  function cloneRuleValue(value) {
    if (!value || typeof value !== "object") return value;
    return JSON.parse(JSON.stringify(value));
  }

  function matchSiteRule(url, siteRules) {
    if (!url || !Array.isArray(siteRules)) return null;

    var matches = [];
    for (var i = 0; i < siteRules.length; i++) {
      var rule = siteRules[i];
      if (siteRuleMatchesUrl(rule, url)) matches.push(rule);
    }

    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];

    var mergedRule = {};
    matches.forEach(function(rule) {
      Object.keys(rule).forEach(function(key) {
        if (rule[key] !== undefined) {
          mergedRule[key] = cloneRuleValue(rule[key]);
        }
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
    matchSiteRule: matchSiteRule,
    plainSitePatternMatchesUrl: plainSitePatternMatchesUrl,
    safelyDecodeUrlText: safelyDecodeUrlText,
    siteRuleMatchesUrl: siteRuleMatchesUrl
  };
});
