document.addEventListener("DOMContentLoaded", function () {
  var speederShared =
    typeof SpeederShared === "object" && SpeederShared ? SpeederShared : {};
  var siteRuleUtils = speederShared.siteRules || {};
  var popupControlUtils = speederShared.popupControls || {};

  /* `label` is only used if shared/ui-icons.js has no path for this action (fallback). */
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
  var renderToken = 0;
  var forceLastSavedSpeedControlledBySiteRule = null;
  var selectedFrameToken = null;
  var shortcutTargetMode = "closest";

  function persistExpandedSettings(rawStorage, settings, callback) {
    var mutation = vscBuildManagedStorageMutation(rawStorage, settings);

    function removeStaleKeys() {
      if (!mutation.remove.length) {
        callback(null);
        return;
      }
      chrome.storage.sync.remove(mutation.remove, function () {
        callback(chrome.runtime.lastError || null);
      });
    }

    if (!Object.keys(mutation.set).length) {
      removeStaleKeys();
      return;
    }

    chrome.storage.sync.set(mutation.set, function () {
      if (chrome.runtime.lastError) {
        callback(chrome.runtime.lastError);
        return;
      }
      removeStaleKeys();
    });
  }

  function updateStoredSettings(update, callback) {
    chrome.storage.sync.get(null, function (rawStorage) {
      if (chrome.runtime.lastError) {
        callback(chrome.runtime.lastError);
        return;
      }
      var settings = vscExpandStoredSettings(rawStorage || {});
      update(settings);
      persistExpandedSettings(rawStorage || {}, settings, callback);
    });
  }

  function updateForceButton(enabled) {
    var button = document.getElementById("forceLastSavedSpeed");
    if (!button) return;
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
    button.title = enabled
      ? "Stop forcing the saved speed"
      : "Keep this page at the last speed saved by Speeder";
  }

  function setForceButtonLoading(loading) {
    var button = document.getElementById("forceLastSavedSpeed");
    if (!button) return;
    button.disabled = loading === true;
    button.setAttribute("aria-busy", loading ? "true" : "false");
  }

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
    selectedFrameToken =
      response && typeof response.frameToken === "string"
        ? response.frameToken
        : null;
  }

  function pickBestFrameSpeedResult(results) {
    return popupControlUtils.pickBestFrameSpeedResult(results);
  }

  function querySpeed(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0] || tabs[0].id == null) {
        if (callback) callback(null);
        return;
      }
      var tabId = tabs[0].id;
      chrome.tabs.executeScript(
        tabId,
        { allFrames: true, file: "content/frame-speed-snapshot.js" },
        function (results) {
          if (chrome.runtime.lastError) {
            sendToActiveTab({ action: "get_speed" }, function (response) {
              applySpeedAndResetFromResponse(response || { speed: 1 });
              if (callback) callback(response || null);
            });
            return;
          }
          var best = pickBestFrameSpeedResult(results);
          if (best) {
            applySpeedAndResetFromResponse(best);
            if (callback) callback(best);
          } else {
            sendToActiveTab({ action: "get_speed" }, function (response) {
              applySpeedAndResetFromResponse(response || { speed: 1 });
              if (callback) callback(response || null);
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
      btn.setAttribute("aria-label", btn.title);

      btn.addEventListener("click", function () {
        if (btnId === "settings") {
          window.open(chrome.runtime.getURL("options/options.html"));
          return;
        }
        var message = { action: "run_action", actionName: btnId };
        if (shortcutTargetMode !== "all" && selectedFrameToken) {
          message.targetFrameToken = selectedFrameToken;
        }
        sendToActiveTab(
          message,
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
    versionElement.textContent = manifest.version;
  }

  document.querySelector("#config").addEventListener("click", function () {
    window.open(chrome.runtime.getURL("options/options.html"));
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

  var forceLastSavedSpeedButton = document.querySelector(
    "#forceLastSavedSpeed"
  );
  if (!forceLastSavedSpeedButton.dataset.listenerAttached) {
    forceLastSavedSpeedButton.dataset.listenerAttached = "true";
    forceLastSavedSpeedButton.addEventListener("click", function () {
      if (forceLastSavedSpeedControlledBySiteRule === null) {
        setStatusMessage("Loading page settings...");
        return;
      }
      if (forceLastSavedSpeedControlledBySiteRule) {
        setStatusMessage("Force setting is controlled by this site rule.");
        return;
      }

      var button = this;
      var enabled = button.getAttribute("aria-pressed") !== "true";
      updateStoredSettings(
        function (settings) {
          settings.forceLastSavedSpeed = enabled;
        },
        function (error) {
          if (error) {
            setStatusMessage("Could not update speed forcing: " + error.message);
            return;
          }
          sendToActiveTab(
            {
              action: "set_force_last_saved_speed",
              enabled: enabled
            },
            function (response) {
              var effectiveEnabled =
                response && typeof response.enabled === "boolean"
                  ? response.enabled
                  : enabled;
              updateForceButton(effectiveEnabled);
              if (effectiveEnabled !== enabled) {
                setStatusMessage("Force setting is controlled by this site rule.");
                if (response && response.speed != null) {
                  updateSpeedDisplay(response.speed);
                }
                return;
              }
              if (response && response.speed != null) {
                updateSpeedDisplay(response.speed);
                setStatusMessage(
                  effectiveEnabled
                    ? "Saved speed is now forced."
                    : "Speed forcing is off."
                );
              } else {
                setStatusMessage(
                  effectiveEnabled
                    ? "Force enabled. No video found on this page."
                    : "Speed forcing is off."
                );
              }
            }
          );
        }
      );
    });
  }

  function renderForActiveTab() {
    var currentRenderToken = ++renderToken;
    forceLastSavedSpeedControlledBySiteRule = null;
    selectedFrameToken = null;
    setForceButtonLoading(true);

    chrome.storage.local.get(["customButtonIcons"], function (loc) {
      if (currentRenderToken !== renderToken) return;
      var customIconsMap =
        loc && loc.customButtonIcons && typeof loc.customButtonIcons === "object"
          ? loc.customButtonIcons
          : {};

      chrome.storage.sync.get(null, function (rawStorage) {
        if (currentRenderToken !== renderToken) return;
        var storage = vscExpandStoredSettings(rawStorage || {});

        getActiveTabContext(function (context) {
          if (currentRenderToken !== renderToken) return;

          var url = context && context.url ? context.url : "";
          var siteRule = matchSiteRule(url, storage.siteRules);
          var siteDisabled = isSiteRuleDisabled(siteRule);
          var siteAvailable = siteRuleUtils.isSpeederActiveForSite(
            storage.enabled,
            siteRule
          );
          shortcutTargetMode =
            siteRule && siteRule.shortcutTargetMode !== undefined
              ? siteRule.shortcutTargetMode
              : storage.shortcutTargetMode;
          var showBar = storage.showPopupControlBar !== false;
          forceLastSavedSpeedControlledBySiteRule = Boolean(
            siteRule && siteRule.forceLastSavedSpeed !== undefined
          );
          var effectiveForceLastSavedSpeed =
            forceLastSavedSpeedControlledBySiteRule
              ? siteRule.forceLastSavedSpeed === true
              : storage.forceLastSavedSpeed === true;

          if (siteRule && siteRule.showPopupControlBar !== undefined) {
            showBar = siteRule.showPopupControlBar;
          }

          toggleEnabledUI(storage.enabled !== false);
          updateForceButton(effectiveForceLastSavedSpeed);
          buildControlBar(
            resolvePopupButtons(storage, siteRule),
            customIconsMap
          );
          setControlBarVisible(siteAvailable && showBar);

          if (siteDisabled) {
            setForceButtonLoading(false);
            setStatusMessage("Speeder is disabled for this site.");
            updateSpeedDisplay(1);
            return;
          }

          clearStatusMessage();
          if (siteAvailable) {
            querySpeed(function(frameContext) {
              if (currentRenderToken !== renderToken) return;
              if (
                frameContext &&
                typeof frameContext.forceLastSavedSpeed === "boolean"
              ) {
                effectiveForceLastSavedSpeed =
                  frameContext.forceLastSavedSpeed;
              }
              if (
                frameContext &&
                typeof frameContext.forceLastSavedSpeedControlledBySiteRule ===
                  "boolean"
              ) {
                forceLastSavedSpeedControlledBySiteRule =
                  frameContext.forceLastSavedSpeedControlledBySiteRule;
              }
              updateForceButton(effectiveForceLastSavedSpeed);
              setForceButtonLoading(false);
            });
          } else {
            updateSpeedDisplay(1);
            setForceButtonLoading(false);
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
      changes.forceLastSavedSpeed ||
      changes.showPopupControlBar ||
      changes.controllerButtons ||
      changes.popupMatchHoverControls ||
      changes.popupControllerButtons ||
      changes.siteRules ||
      changes.siteRulesMeta ||
      changes.siteRulesFormat
    ) {
      renderForActiveTab();
    }
  });

  renderForActiveTab();

  function toggleEnabled(enabled, callback) {
    updateStoredSettings(
      function (settings) {
        settings.enabled = enabled;
      },
      function (error) {
        if (error) {
          setStatusMessage("Could not update Speeder: " + error.message);
          return;
        }
        toggleEnabledUI(enabled);
        if (callback) callback(enabled);
      }
    );
  }

  function toggleEnabledUI(enabled) {
    document.querySelector("#enable").classList.toggle("hide", enabled);
    document.querySelector("#disable").classList.toggle("hide", !enabled);
  }

  function settingsSavedReloadMessage(enabled) {
    setStatusMessage(
      `${enabled ? "Enabled" : "Disabled"}. Reload page to see changes`
    );
  }

  function setStatusMessage(str) {
    const status_element = document.querySelector("#status");
    status_element.classList.toggle("hide", false);
    status_element.textContent = str;
  }

  function clearStatusMessage() {
    const status_element = document.querySelector("#status");
    status_element.classList.toggle("hide", true);
    status_element.textContent = "";
  }
});
