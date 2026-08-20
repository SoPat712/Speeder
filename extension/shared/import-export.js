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
    "shortcutTargetMode",
    "showAmbientLoopControls",
    "showPopupControlBar",
    "siteRules",
    "siteRulesFormat",
    "siteRulesMeta",
    "speed",
    "startHidden",
    "subtitleNudgeAmount",
    "subtitleNudgeEnabledByDefault",
    "subtitleNudgeInterval",
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
   * Only user-authored local settings belong in backups. Disposable caches,
   * per-source speed history, and future runtime data stay installation-local.
   */
  function filterLocalSettingsForExport(local) {
    if (!local || typeof local !== "object" || Array.isArray(local)) {
      return {};
    }
    var out = {};
    if (
      local.customButtonIcons &&
      typeof local.customButtonIcons === "object" &&
      !Array.isArray(local.customButtonIcons)
    ) {
      out.customButtonIcons = local.customButtonIcons;
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
    var backupIsObject =
      backup && typeof backup === "object" && !Array.isArray(backup);
    var hasWrappedSettings =
      backupIsObject &&
      Object.prototype.hasOwnProperty.call(backup, "settings");

    if (hasWrappedSettings) {
      if (
        !backup.settings ||
        typeof backup.settings !== "object" ||
        Array.isArray(backup.settings)
      ) {
        return null;
      }
      settingsToImport = backup.settings;
      isWrappedBackup = true;
    } else if (backupIsObject && isRecognizedRawSettingsObject(backup)) {
      settingsToImport = backup;
    }

    if (!settingsToImport) return null;

    if (
      isWrappedBackup &&
      Object.prototype.hasOwnProperty.call(backup, "localSettings") &&
      (
        !backup.localSettings ||
        typeof backup.localSettings !== "object" ||
        Array.isArray(backup.localSettings)
      )
    ) {
      return null;
    }

    if (
      isWrappedBackup &&
      backup.localSettings &&
      Object.prototype.hasOwnProperty.call(
        backup.localSettings,
        "customButtonIcons"
      ) &&
      (
        !backup.localSettings.customButtonIcons ||
        typeof backup.localSettings.customButtonIcons !== "object" ||
        Array.isArray(backup.localSettings.customButtonIcons)
      )
    ) {
      return null;
    }

    return {
      isWrappedBackup: isWrappedBackup,
      settings: settingsToImport,
      localSettings:
        backup &&
        backup.localSettings &&
        typeof backup.localSettings === "object" &&
        !Array.isArray(backup.localSettings)
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
