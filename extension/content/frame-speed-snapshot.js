/* Runs via chrome.tabs.executeScript(allFrames) in the same isolated world as inject.js */
(function () {
  try {
    if (typeof getPrimaryVideoElement !== "function") {
      return null;
    }
    var v = getPrimaryVideoElement();
    if (!v) return null;
    return {
      speed: v.playbackRate,
      frameToken:
        typeof tc === "object" && typeof tc.frameToken === "string"
          ? tc.frameToken
          : null,
      preferred: !v.paused,
      forceLastSavedSpeed: Boolean(
        typeof tc === "object" && tc.settings && tc.settings.forceLastSavedSpeed
      ),
      forceLastSavedSpeedControlledBySiteRule: Boolean(
        typeof tc === "object" &&
          tc.activeSiteRule &&
          tc.activeSiteRule.forceLastSavedSpeed !== undefined
      )
    };
  } catch (e) {
    return null;
  }
})();
