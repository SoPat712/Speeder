(function(root, factory) {
  var exports = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = exports;
  }

  root.SpeederShared = root.SpeederShared || {};
  root.SpeederShared.controllerUtils = exports;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  var CONTROLLER_MARGIN_MAX_PX = 200;
  var controllerLocations = [
    "top-left",
    "top-center",
    "top-right",
    "middle-right",
    "bottom-right",
    "bottom-center",
    "bottom-left",
    "middle-left"
  ];
  var defaultControllerLocation = controllerLocations[0];

  function normalizeControllerLocation(location, fallback) {
    if (controllerLocations.includes(location)) return location;
    return typeof fallback === "string"
      ? fallback
      : defaultControllerLocation;
  }

  function clampControllerMarginPx(value, fallback) {
    var numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;

    return Math.min(
      CONTROLLER_MARGIN_MAX_PX,
      Math.max(0, Math.round(numericValue))
    );
  }

  function getNextControllerLocation(location) {
    var normalizedLocation = normalizeControllerLocation(location);
    var currentIndex = controllerLocations.indexOf(normalizedLocation);
    return controllerLocations[(currentIndex + 1) % controllerLocations.length];
  }

  return {
    CONTROLLER_MARGIN_MAX_PX: CONTROLLER_MARGIN_MAX_PX,
    clampControllerMarginPx: clampControllerMarginPx,
    controllerLocations: controllerLocations.slice(),
    defaultControllerLocation: defaultControllerLocation,
    getNextControllerLocation: getNextControllerLocation,
    normalizeControllerLocation: normalizeControllerLocation
  };
});
