/* Runs via chrome.tabs.executeScript(allFrames) in the same isolated world as inject.js */
(function () {
  try {
    if (
      typeof getPrimaryVideoElement !== "function" ||
      typeof computeResetButtonLabelForVideo !== "function"
    ) {
      return null;
    }
    var v = getPrimaryVideoElement();
    if (!v) return null;
    return {
      speed: v.playbackRate,
      resetLabel: computeResetButtonLabelForVideo(v),
      preferred: !v.paused
    };
  } catch (e) {
    return null;
  }
})();
