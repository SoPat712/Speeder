document.addEventListener("DOMContentLoaded", function () {
  var manifest = chrome.runtime.getManifest();
  var versionElement = document.querySelector("#app-version");
  if (versionElement) {
    versionElement.innerText = manifest.version;
  }

  document.querySelector("#config").addEventListener("click", function () {
    window.open(chrome.runtime.getURL("options.html"));
  });

  document.querySelector("#about").addEventListener("click", function () {
    window.open("https://github.com/SoPat712/Speeder");
  });

  document.querySelector("#feedback").addEventListener("click", function () {
    window.open("https://github.com/SoPat712/Speeder/issues");
  });

  document.querySelector("#enable").addEventListener("click", function () {
    toggleEnabled(true, settingsSavedReloadMessage);
  });

  document.querySelector("#disable").addEventListener("click", function () {
    toggleEnabled(false, settingsSavedReloadMessage);
  });

  // --- REVISED: "Re-scan" button functionality ---
  document.querySelector("#refresh").addEventListener("click", function () {
    setStatusMessage("Re-scanning page...");
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0] && tabs[0].id) {
        // Send a message to the content script, asking it to re-initialize.
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: "rescan_page" },
          function (response) {
            if (chrome.runtime.lastError) {
              // This error is expected on pages where content scripts cannot run.
              setStatusMessage("Cannot run on this page.");
            } else if (response && response.status === "complete") {
              setStatusMessage("Scan complete. Closing...");
              setTimeout(() => window.close(), 500); // Close popup on success.
            } else {
              setStatusMessage("Scan failed. Please reload the page.");
            }
          }
        );
      }
    });
  });

  chrome.storage.sync.get({ enabled: true }, function (storage) {
    toggleEnabledUI(storage.enabled);
  });

  function toggleEnabled(enabled, callback) {
    chrome.storage.sync.set(
      {
        enabled: enabled
      },
      function () {
        toggleEnabledUI(enabled);
        if (callback) callback(enabled);
      }
    );
  }

  function toggleEnabledUI(enabled) {
    document.querySelector("#enable").classList.toggle("hide", enabled);
    document.querySelector("#disable").classList.toggle("hide", !enabled);

    const suffix = `${enabled ? "" : "_disabled"}.png`;
    chrome.browserAction.setIcon({
      path: {
        19: "icons/icon19" + suffix,
        38: "icons/icon38" + suffix,
        48: "icons/icon48" + suffix
      }
    });
  }

  function settingsSavedReloadMessage(enabled) {
    setStatusMessage(
      `${enabled ? "Enabled" : "Disabled"}. Reload page to see changes`
    );
  }

  function setStatusMessage(str) {
    const status_element = document.querySelector("#status");
    status_element.classList.toggle("hide", false);
    status_element.innerText = str;
  }
});
