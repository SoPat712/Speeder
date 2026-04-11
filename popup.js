document.addEventListener("DOMContentLoaded", function () {
  var speederShared =
    typeof SpeederShared === "object" && SpeederShared ? SpeederShared : {};
  var siteRuleUtils = speederShared.siteRules || {};
  var popupControlUtils = speederShared.popupControls || {};

  /* `label` is only used if ui-icons.js has no path for this action (fallback). */
  var controllerButtonDefs = {
    rewind:   { label: "", className: "rw" },
    slower:   { label: "", className: "" },
    faster:   { label: "", className: "" },
    advance:  { label: "", className: "rw" },
    display:  { label: "", className: "hideButton" },
    reset:    { label: "\u21BB", className: "" },
    fast:     { label: "", className: "" },
    nudge:    { label: "", className: "" },
    pause:    { label: "", className: "" },
    muted:    { label: "", className: "" },
    louder:   { label: "", className: "" },
    softer:   { label: "", className: "" },
    mark:     { label: "", className: "" },
    jump:     { label: "", className: "" },
    settings: { label: "", className: "" }
  };

  var defaultButtons = ["rewind", "slower", "faster", "advance", "display"];
  var popupExcludedButtonIds = new Set(["settings"]);
  var storageDefaults = {
    enabled: true,
    showPopupControlBar: true,
    controllerButtons: defaultButtons,
    popupMatchHoverControls: true,
    popupControllerButtons: defaultButtons,
    siteRules: []
  };
  var renderToken = 0;

  function matchSiteRule(url, siteRules) {
    return siteRuleUtils.matchSiteRule(url, siteRules);
  }

  function isSiteRuleDisabled(rule) {
    return siteRuleUtils.isSiteRuleDisabled(rule);
  }

  function resolvePopupButtons(storage, siteRule) {
    return popupControlUtils.resolvePopupButtons(storage, siteRule, {
      controllerButtonDefs: controllerButtonDefs,
      defaultButtons: defaultButtons,
      excludedIds: popupExcludedButtonIds
    });
  }

  function setControlBarVisible(visible) {
    var bar = document.getElementById("popupControlBar");
    var dividers = document.querySelectorAll(".popup-divider");
    if (bar) bar.style.display = visible ? "" : "none";
    dividers.forEach(function (d) { d.style.display = visible ? "" : "none"; });
  }

  function sendToActiveTab(message, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, message, function (response) {
          if (chrome.runtime.lastError) {
            if (callback) callback(null);
          } else {
            if (callback) callback(response);
          }
        });
      } else {
        if (callback) callback(null);
      }
    });
  }

  function getActiveTabContext(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var activeTab = tabs && tabs[0] ? tabs[0] : null;
      if (!activeTab || !activeTab.id) {
        if (callback) callback({ tab: null, url: "" });
        return;
      }

      var tabUrl = typeof activeTab.url === "string" ? activeTab.url : "";
      if (tabUrl.length > 0) {
        if (callback) callback({ tab: activeTab, url: tabUrl });
        return;
      }

      chrome.tabs.sendMessage(
        activeTab.id,
        { action: "get_page_context" },
        function (response) {
          if (chrome.runtime.lastError) {
            if (callback) callback({ tab: activeTab, url: "" });
            return;
          }

          var pageUrl =
            response && typeof response.url === "string" ? response.url : "";
          if (callback) callback({ tab: activeTab, url: pageUrl });
        }
      );
    });
  }

  function updateSpeedDisplay(speed) {
    var el = document.getElementById("popupSpeed");
    if (el) el.textContent = (speed != null ? Number(speed) : 1).toFixed(2);
  }

  function applySpeedAndResetFromResponse(response) {
    if (response && response.speed != null) {
      updateSpeedDisplay(response.speed);
    }
  }

  function pickBestFrameSpeedResult(results) {
    return popupControlUtils.pickBestFrameSpeedResult(results);
  }

  function querySpeed() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0] || tabs[0].id == null) {
        return;
      }
      var tabId = tabs[0].id;
      chrome.tabs.executeScript(
        tabId,
        { allFrames: true, file: "frameSpeedSnapshot.js" },
        function (results) {
          if (chrome.runtime.lastError) {
            sendToActiveTab({ action: "get_speed" }, function (response) {
              applySpeedAndResetFromResponse(response || { speed: 1 });
            });
            return;
          }
          var best = pickBestFrameSpeedResult(results);
          if (best) {
            applySpeedAndResetFromResponse(best);
          } else {
            sendToActiveTab({ action: "get_speed" }, function (response) {
              applySpeedAndResetFromResponse(response || { speed: 1 });
            });
          }
        }
      );
    });
  }

  function buildControlBar(buttons, customIconsMap) {
    var bar = document.getElementById("popupControlBar");
    if (!bar) return;

    var existing = bar.querySelectorAll("button");
    existing.forEach(function (btn) { btn.remove(); });

    var customMap = customIconsMap || {};

    buttons.forEach(function (btnId) {
      var def = controllerButtonDefs[btnId];
      if (!def) return;

      var btn = document.createElement("button");
      btn.dataset.action = btnId;
      var customEntry = customMap[btnId];
      if (customEntry && customEntry.svg) {
        var customSpan = vscCreateSvgWrap(document, customEntry.svg, "vsc-btn-icon");
        if (customSpan) {
          btn.appendChild(customSpan);
        } else {
          btn.textContent = def.label || "?";
        }
      } else if (typeof vscIconSvgString === "function") {
        var svgStr = vscIconSvgString(btnId, 16);
        if (svgStr) {
          var iconSpan = vscCreateSvgWrap(document, svgStr, "vsc-btn-icon");
          if (iconSpan) {
            btn.appendChild(iconSpan);
          } else {
            btn.textContent = def.label || "?";
          }
        } else {
          btn.textContent = def.label || "?";
        }
      } else {
        btn.textContent = def.label || "?";
      }
      if (def.className) btn.className = def.className;
      btn.title = btnId.charAt(0).toUpperCase() + btnId.slice(1);

      btn.addEventListener("click", function () {
        if (btnId === "settings") {
          window.open(chrome.runtime.getURL("options.html"));
          return;
        }
        sendToActiveTab(
          { action: "run_action", actionName: btnId },
          function () {
            querySpeed();
          }
        );
      });

      bar.appendChild(btn);
    });
  }

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

  document.querySelector("#donate").addEventListener("click", function () {
    this.classList.add("hide");
    document.querySelector("#donateOptions").classList.remove("hide");
  });

  document.querySelector("#donateKofi").addEventListener("click", function () {
    window.open("https://ko-fi.com/joshpatra");
  });

  document.querySelector("#donateGithub").addEventListener("click", function () {
    window.open("https://github.com/sponsors/SoPat712");
  });

  document.querySelector("#enable").addEventListener("click", function () {
    toggleEnabled(true, settingsSavedReloadMessage);
  });

  document.querySelector("#disable").addEventListener("click", function () {
    toggleEnabled(false, settingsSavedReloadMessage);
  });

  document.querySelector("#refresh").addEventListener("click", function () {
    setStatusMessage("Rescanning page...");
    sendToActiveTab({ action: "rescan_page" }, function (response) {
      if (!response) {
        setStatusMessage("Cannot run on this page.");
      } else if (response.status === "complete") {
        setStatusMessage("Scan complete. Closing...");
        setTimeout(function () { window.close(); }, 500);
      } else {
        setStatusMessage("Scan failed. Please reload the page.");
      }
    });
  });

  function renderForActiveTab() {
    var currentRenderToken = ++renderToken;

    chrome.storage.local.get(["customButtonIcons"], function (loc) {
      if (currentRenderToken !== renderToken) return;
      var customIconsMap =
        loc && loc.customButtonIcons && typeof loc.customButtonIcons === "object"
          ? loc.customButtonIcons
          : {};

      chrome.storage.sync.get(storageDefaults, function (storage) {
        if (currentRenderToken !== renderToken) return;

      getActiveTabContext(function (context) {
        if (currentRenderToken !== renderToken) return;

        var url = context && context.url ? context.url : "";
        var siteRule = matchSiteRule(url, storage.siteRules);
        var siteDisabled = isSiteRuleDisabled(siteRule);
        var siteAvailable = siteRuleUtils.isSpeederActiveForSite(
          storage.enabled,
          siteRule
        );
        var showBar = storage.showPopupControlBar !== false;

        if (siteRule && siteRule.showPopupControlBar !== undefined) {
          showBar = siteRule.showPopupControlBar;
        }

        toggleEnabledUI(storage.enabled !== false);
        buildControlBar(
          resolvePopupButtons(storage, siteRule),
          customIconsMap
        );
        setControlBarVisible(siteAvailable && showBar);

        if (siteDisabled) {
          setStatusMessage("Speeder is disabled for this site.");
          updateSpeedDisplay(1);
          return;
        }

        clearStatusMessage();
        if (siteAvailable) {
          querySpeed();
        } else {
          updateSpeedDisplay(1);
        }
      });
      });
    });
  }

  chrome.tabs.onActivated.addListener(function () {
    renderForActiveTab();
  });

  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (!tab || tab.active !== true) return;
    if (changeInfo.url !== undefined || changeInfo.status === "complete") {
      renderForActiveTab();
    }
  });

  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName === "local" && changes.customButtonIcons) {
      renderForActiveTab();
      return;
    }
    if (areaName !== "sync") return;
    if (
      changes.enabled ||
      changes.showPopupControlBar ||
      changes.controllerButtons ||
      changes.popupMatchHoverControls ||
      changes.popupControllerButtons ||
      changes.siteRules
    ) {
      renderForActiveTab();
    }
  });

  renderForActiveTab();

  function toggleEnabled(enabled, callback) {
    chrome.storage.sync.set({ enabled: enabled }, function () {
      toggleEnabledUI(enabled);
      if (callback) callback(enabled);
    });
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

  function clearStatusMessage() {
    const status_element = document.querySelector("#status");
    status_element.classList.toggle("hide", true);
    status_element.innerText = "";
  }
});
