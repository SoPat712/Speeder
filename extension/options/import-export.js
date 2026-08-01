// Import/Export functionality for Video Speed Controller settings
var speederShared =
  typeof SpeederShared === "object" && SpeederShared ? SpeederShared : {};
var importExportUtils = speederShared.importExport || {};

function generateBackupFilename() {
  return importExportUtils.generateBackupFilename(new Date());
}

function normalizedSettingsForExport(rawStorage) {
  var raw = rawStorage && typeof rawStorage === "object" ? rawStorage : {};
  var expanded = vscExpandStoredSettings(raw);
  var normalized = vscBuildStoredSettingsDiff(expanded);

  // Backups should remain readable outside the extension too. Storage stays
  // sparse, but explicitly include built-in rule titles in the exported v2
  // patches. Custom rule titles are already part of their normal patches.
  var titledRulePatches = Array.isArray(normalized.siteRules)
    ? normalized.siteRules.slice()
    : [];
  var orderedRulePatches = [];
  var claimedRulePatches = new Set();
  vscGetSettingsDefaults().siteRules.forEach(function(defaultRule) {
    var expandedRule = expanded.siteRules.find(function(rule) {
      return rule && rule.pattern === defaultRule.pattern;
    });
    if (!expandedRule) return;
    var patch = titledRulePatches.find(function(candidate) {
      return (
        candidate &&
        candidate.pattern === defaultRule.pattern &&
        !claimedRulePatches.has(candidate)
      );
    });
    if (!patch && typeof expandedRule.title === "string") {
      patch = { pattern: defaultRule.pattern };
      titledRulePatches.push(patch);
    }
    if (!patch) return;
    if (typeof expandedRule.title === "string") {
      patch.title = expandedRule.title;
    }
    claimedRulePatches.add(patch);
    orderedRulePatches.push(patch);
  });
  titledRulePatches.forEach(function(patch) {
    if (!claimedRulePatches.has(patch)) orderedRulePatches.push(patch);
  });
  if (orderedRulePatches.length > 0) {
    normalized.siteRules = orderedRulePatches;
    normalized.siteRulesFormat = vscGetSiteRulesDiffFormat();
  }

  // lastSpeed is useful user data, but it is intentionally outside the
  // managed options diff because content scripts update it at runtime.
  if (Object.prototype.hasOwnProperty.call(raw, "lastSpeed")) {
    if (Number.isFinite(expanded.lastSpeed)) {
      normalized.lastSpeed = expanded.lastSpeed;
    }
  }

  return normalized;
}

function exportSettings() {
  chrome.storage.sync.get(null, function (storage) {
    if (chrome.runtime.lastError) {
      showStatus(
        "Error: Failed to read settings - " + chrome.runtime.lastError.message,
        true
      );
      return;
    }

    chrome.storage.local.get(null, function (localStorage) {
      if (chrome.runtime.lastError) {
        showStatus(
          "Error: Failed to read local extension data - " +
            chrome.runtime.lastError.message,
          true
        );
        return;
      }

      const backup = importExportUtils.buildBackupPayload(
        normalizedSettingsForExport(storage),
        importExportUtils.filterLocalSettingsForExport(localStorage),
        new Date()
      );

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
    });
  });
}

function persistImportedSyncSettings(currentRaw, importedRaw, callback) {
  var expanded = vscExpandStoredSettings(importedRaw || {});
  var mutation = vscBuildManagedStorageMutation(currentRaw || {}, expanded);

  if (
    importedRaw &&
    Object.prototype.hasOwnProperty.call(importedRaw, "lastSpeed")
  ) {
    if (Number.isFinite(expanded.lastSpeed)) {
      mutation.set.lastSpeed = expanded.lastSpeed;
    }
  }

  function removeStaleSettings() {
    if (!mutation.remove.length) {
      callback(null);
      return;
    }
    chrome.storage.sync.remove(mutation.remove, function () {
      callback(chrome.runtime.lastError || null);
    });
  }

  if (!Object.keys(mutation.set).length) {
    removeStaleSettings();
    return;
  }

  // Write the replacement first. A failed write must not leave the user with
  // their old managed settings already deleted.
  chrome.storage.sync.set(mutation.set, function () {
    if (chrome.runtime.lastError) {
      callback(chrome.runtime.lastError);
      return;
    }
    removeStaleSettings();
  });
}

function importLocalSettings(localToImport, callback) {
  if (localToImport === null) {
    callback(null);
    return;
  }

  var icons = localToImport.customButtonIcons;
  if (icons && typeof icons === "object" && !Array.isArray(icons)) {
    chrome.storage.local.set({ customButtonIcons: icons }, function () {
      callback(chrome.runtime.lastError || null);
    });
    return;
  }

  // Backups only own customButtonIcons. Keep Lucide caches, remembered speed
  // history, and any future local runtime data private to the current install.
  chrome.storage.local.remove("customButtonIcons", function () {
    callback(chrome.runtime.lastError || null);
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
        const parsedBackup = importExportUtils.parseImportText(e.target.result);

        if (!parsedBackup) {
          showStatus("Error: Invalid backup file format", true);
          return;
        }

        var settingsToImport = parsedBackup.settings;
        var localToImport = parsedBackup.localSettings;

        chrome.storage.sync.get(null, function (currentRaw) {
          if (chrome.runtime.lastError) {
            showStatus(
              "Error: Failed to read current settings - " +
                chrome.runtime.lastError.message,
              true
            );
            return;
          }

          persistImportedSyncSettings(
            currentRaw || {},
            settingsToImport,
            function (syncError) {
              if (syncError) {
                showStatus(
                  "Error: Failed to save imported settings - " +
                    syncError.message,
                  true
                );
                return;
              }

              var scopedLocalSettings =
                parsedBackup.isWrappedBackup === true ? localToImport : null;
              importLocalSettings(scopedLocalSettings, function (localError) {
                if (localError) {
                  showStatus(
                    "Settings imported, but custom icons could not be updated - " +
                      localError.message +
                      ". Reloading...",
                    true
                  );
                } else {
                  showStatus("Settings imported successfully. Reloading...");
                }

                setTimeout(function () {
                  if (typeof restore_options === "function") {
                    restore_options();
                  } else {
                    location.reload();
                  }
                }, 500);
              });
            }
          );
        });
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
