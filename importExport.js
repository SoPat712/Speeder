// Import/Export functionality for Video Speed Controller settings
var speederShared =
  typeof SpeederShared === "object" && SpeederShared ? SpeederShared : {};
var importExportUtils = speederShared.importExport || {};

function generateBackupFilename() {
  return importExportUtils.generateBackupFilename(new Date());
}

function exportSettings() {
  chrome.storage.sync.get(null, function (storage) {
    chrome.storage.local.get(null, function (localStorage) {
      const backup = importExportUtils.buildBackupPayload(
        storage,
        localStorage,
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

        function importLocalSettings(callback) {
          if (parsedBackup.isWrappedBackup !== true) {
            callback();
            return;
          }

          chrome.storage.local.clear(function () {
            if (chrome.runtime.lastError) {
              showStatus(
                "Error: Failed to clear local extension data - " +
                  chrome.runtime.lastError.message,
                true
              );
              return;
            }

            if (localToImport && Object.keys(localToImport).length > 0) {
              chrome.storage.local.set(localToImport, function () {
                if (chrome.runtime.lastError) {
                  showStatus(
                    "Error: Failed to save local extension data - " +
                      chrome.runtime.lastError.message,
                    true
                  );
                  return;
                }
                callback();
              });
              return;
            }

            callback();
          });
        }

        function afterLocalImport() {
          chrome.storage.sync.clear(function () {
            chrome.storage.sync.set(settingsToImport, function () {
              if (chrome.runtime.lastError) {
                showStatus(
                  "Error: Failed to save imported settings - " +
                    chrome.runtime.lastError.message,
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
          });
        }

        importLocalSettings(afterLocalImport);
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
