(function(root, factory) {
  var exports = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = exports;
  }

  root.SpeederShared = root.SpeederShared || {};
  root.SpeederShared.importExport = exports;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  var rawSettingsKeys = new Set([
    "audioBoolean",
    "controllerButtons",
    "controllerLocation",
    "controllerMarginBottom",
    "controllerMarginLeft",
    "controllerMarginRight",
    "controllerMarginTop",
    "controllerOpacity",
    "enableSubtitleNudge",
    "enabled",
    "forceLastSavedSpeed",
    "hideWithControls",
    "hideWithControlsTimer",
    "hideWithYouTubeControls",
    "keyBindings",
    "lastSpeed",
    "popupControllerButtons",
    "popupMatchHoverControls",
    "rememberSpeed",
    "showPopupControlBar",
    "siteRules",
    "speed",
    "startHidden",
    "subtitleNudgeAmount",
    "subtitleNudgeInterval"
  ]);

  function isRecognizedRawSettingsObject(backup) {
    if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
      return false;
    }

    return Object.keys(backup).some(function(key) {
      return rawSettingsKeys.has(key);
    });
  }

  /**
   * Local-only keys excluded from backup JSON. These are disposable caches
   * (e.g. Lucide tags.json) that bloat exports and are refetched when needed.
   * Keep in sync with lucide-client.js (LUCIDE_TAGS_CACHE_KEY + "At").
   */
  var localSettingsKeysOmittedFromExport = [
    "lucideTagsCacheV1",
    "lucideTagsCacheV1At"
  ];

  function filterLocalSettingsForExport(local) {
    if (!local || typeof local !== "object" || Array.isArray(local)) {
      return {};
    }
    var out = {};
    for (var key in local) {
      if (!Object.prototype.hasOwnProperty.call(local, key)) continue;
      if (localSettingsKeysOmittedFromExport.indexOf(key) !== -1) continue;
      out[key] = local[key];
    }
    return out;
  }

  function generateBackupFilename(now) {
    var date = now instanceof Date ? now : new Date(now || Date.now());
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    var hours = String(date.getHours()).padStart(2, "0");
    var minutes = String(date.getMinutes()).padStart(2, "0");
    var seconds = String(date.getSeconds()).padStart(2, "0");

    return (
      "speeder-backup_" +
      year +
      "-" +
      month +
      "-" +
      day +
      "_" +
      hours +
      "." +
      minutes +
      "." +
      seconds +
      ".json"
    );
  }

  function buildBackupPayload(settings, localSettings, now) {
    return {
      version: "1.1",
      exportDate: new Date(now || Date.now()).toISOString(),
      settings: settings,
      localSettings: localSettings || {}
    };
  }

  function extractImportSettings(backup) {
    var settingsToImport = null;
    var isWrappedBackup = false;

    if (backup && backup.settings && typeof backup.settings === "object") {
      settingsToImport = backup.settings;
      isWrappedBackup = true;
    } else if (
      backup &&
      typeof backup === "object" &&
      isRecognizedRawSettingsObject(backup)
    ) {
      settingsToImport = backup;
    }

    if (!settingsToImport) return null;

    return {
      isWrappedBackup: isWrappedBackup,
      settings: settingsToImport,
      localSettings:
        backup &&
        backup.localSettings &&
        typeof backup.localSettings === "object"
          ? backup.localSettings
          : null
    };
  }

  function parseImportText(text) {
    return extractImportSettings(JSON.parse(text));
  }

  return {
    buildBackupPayload: buildBackupPayload,
    extractImportSettings: extractImportSettings,
    filterLocalSettingsForExport: filterLocalSettingsForExport,
    generateBackupFilename: generateBackupFilename,
    isRecognizedRawSettingsObject: isRecognizedRawSettingsObject,
    parseImportText: parseImportText
  };
});
