// Import/Export functionality for Video Speed Controller settings

const EXPORTABLE_LOCAL_SETTINGS_KEYS = ["customButtonIcons"];

function getExportableLocalSettings(localStorage) {
  const exportable = {};
  const customButtonIcons =
    localStorage &&
    localStorage.customButtonIcons &&
    typeof localStorage.customButtonIcons === "object" &&
    !Array.isArray(localStorage.customButtonIcons)
      ? localStorage.customButtonIcons
      : null;

  if (customButtonIcons) {
    exportable.customButtonIcons = customButtonIcons;
  }

  return exportable;
}

function replaceImportableLocalSettings(localSettings, callback) {
  chrome.storage.local.remove(EXPORTABLE_LOCAL_SETTINGS_KEYS, function () {
    if (chrome.runtime.lastError) {
      showStatus(
        "Error: Failed to clear local icon overrides - " +
          chrome.runtime.lastError.message,
        true
      );
      return;
    }

    if (!localSettings || Object.keys(localSettings).length === 0) {
      callback();
      return;
    }

    chrome.storage.local.set(localSettings, function () {
      if (chrome.runtime.lastError) {
        showStatus(
          "Error: Failed to save local icon overrides - " +
            chrome.runtime.lastError.message,
          true
        );
        return;
      }

      callback();
    });
  });
}

function generateBackupFilename() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `speeder-backup_${year}-${month}-${day}_${hours}.${minutes}.${seconds}.json`;
}

function getBackupManifestVersion() {
  var manifest = chrome.runtime.getManifest();
  return manifest && manifest.version ? manifest.version : "unknown";
}

function getExportableSyncSettings(syncStorage) {
  return vscBuildStoredSettingsDiff(vscExpandStoredSettings(syncStorage));
}

function getImportableSyncSettings(backup, rawSettings) {
  var importable = vscClonePlainData(rawSettings) || {};

  if (
    backup &&
    backup.siteRulesFormat &&
    importable.siteRulesFormat === undefined
  ) {
    importable.siteRulesFormat = backup.siteRulesFormat;
  }

  if (
    backup &&
    backup.siteRulesMeta &&
    importable.siteRulesMeta === undefined
  ) {
    importable.siteRulesMeta = backup.siteRulesMeta;
  }

  return vscExpandStoredSettings(importable);
}

function exportSettings() {
  chrome.storage.sync.get(null, function (storage) {
    chrome.storage.local.get(
      EXPORTABLE_LOCAL_SETTINGS_KEYS,
      function (localStorage) {
        const localSettings = getExportableLocalSettings(localStorage);
        const syncSettings = getExportableSyncSettings(storage);
        const backup = {
          version: getBackupManifestVersion(),
          exportDate: new Date().toISOString(),
          settings: syncSettings
        };

        if (Object.keys(localSettings).length > 0) {
          backup.localSettings = localSettings;
        }

        const dataStr = JSON.stringify(backup, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = generateBackupFilename();
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showStatus("Settings exported successfully");
      }
    );
  });
}

function importSettings() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";

  input.onchange = function (event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const backup = JSON.parse(e.target.result);
        let settingsToImport = null;

        // Detect backup format: check for 'settings' wrapper or raw storage keys
        if (backup.settings && typeof backup.settings === "object") {
          settingsToImport = getImportableSyncSettings(backup, backup.settings);
        } else if (typeof backup === "object" && (backup.keyBindings || backup.rememberSpeed !== undefined)) {
          settingsToImport = getImportableSyncSettings(backup, backup);
        }

        if (!settingsToImport) {
          showStatus("Error: Invalid backup file format", true);
          return;
        }

        var localToImport = getExportableLocalSettings(backup.localSettings);

        function afterLocalImport() {
          persistManagedSyncSettings(settingsToImport, function (error) {
            if (error) {
              showStatus(
                "Error: Failed to save imported settings - " + error.message,
                true
              );
              return;
            }
            showStatus("Settings imported successfully. Reloading...");
            setTimeout(function () {
              if (typeof restore_options === "function") {
                restore_options();
              } else {
                location.reload();
              }
            }, 500);
          });
        }

        replaceImportableLocalSettings(localToImport, afterLocalImport);
      } catch (err) {
        showStatus("Error: Failed to parse backup file - " + err.message, true);
      }
    };

    reader.onerror = function () {
      showStatus("Error: Failed to read file", true);
    };

    reader.readAsText(file);
  };

  input.click();
}

function showStatus(message, isError = false) {
  const status = document.getElementById("status");
  if (status) {
    status.textContent = message;
    status.style.color = isError ? "#d32f2f" : "";
    setTimeout(function () {
      status.textContent = "";
      status.style.color = "";
    }, 3000);
  }
}

// Initialize import/export buttons when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initImportExport);
} else {
  initImportExport();
}

function initImportExport() {
  const exportBtn = document.getElementById("exportSettings");
  const importBtn = document.getElementById("importSettings");

  if (exportBtn) {
    exportBtn.addEventListener("click", exportSettings);
  }

  if (importBtn) {
    importBtn.addEventListener("click", importSettings);
  }
}
