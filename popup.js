document.addEventListener("DOMContentLoaded", function () {
  var regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;

  var controllerButtonDefs = {
    rewind:   { label: "\u00AB", className: "rw" },
    slower:   { label: "\u2212", className: "" },
    faster:   { label: "+",      className: "" },
    advance:  { label: "\u00BB", className: "rw" },
    display:  { label: "\u00D7", className: "hideButton" },
    reset:    { label: "\u21BA", className: "" },
    fast:     { label: "\u2605", className: "" },
    settings: { label: "\u2699", className: "" },
    pause:    { label: "\u23EF", className: "" },
    muted:    { label: "M",      className: "" },
    mark:     { label: "\u2691", className: "" },
    jump:     { label: "\u21E5", className: "" }
  };

  var defaultButtons = ["rewind", "slower", "faster", "advance", "display"];

  function escapeStringRegExp(str) {
    const m = /[|\\{}()[\]^$+*?.]/g;
    return str.replace(m, "\\$&");
  }

  function isBlacklisted(url, blacklist) {
    let b = false;
    const l = blacklist ? blacklist.split("\n") : [];
    l.forEach((m) => {
      if (b) return;
      m = m.replace(regStrip, "");
      if (m.length == 0) return;
      let r;
      if (m.startsWith("/") && m.lastIndexOf("/") > 0) {
        try {
          const ls = m.lastIndexOf("/");
          r = new RegExp(m.substring(1, ls), m.substring(ls + 1));
        } catch (e) {
          return;
        }
      } else r = new RegExp(escapeStringRegExp(m));
      if (r && r.test(url)) b = true;
    });
    return b;
  }

  function matchSiteRule(url, siteRules) {
    if (!url || !Array.isArray(siteRules)) return null;
    for (var i = 0; i < siteRules.length; i++) {
      var rule = siteRules[i];
      if (!rule || !rule.pattern) continue;
      var pattern = rule.pattern.replace(regStrip, "");
      if (pattern.length === 0) continue;
      var re;
      if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
        try {
          var ls = pattern.lastIndexOf("/");
          re = new RegExp(pattern.substring(1, ls), pattern.substring(ls + 1));
        } catch (e) {
          continue;
        }
      } else {
        re = new RegExp(escapeStringRegExp(pattern));
      }
      if (re && re.test(url)) return rule;
    }
    return null;
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

  function updateSpeedDisplay(speed) {
    var el = document.getElementById("popupSpeed");
    if (el) el.textContent = (speed != null ? Number(speed) : 1).toFixed(2);
  }

  function querySpeed() {
    sendToActiveTab({ action: "get_speed" }, function (response) {
      if (response && response.speed != null) {
        updateSpeedDisplay(response.speed);
      }
    });
  }

  function buildControlBar(buttons) {
    var bar = document.getElementById("popupControlBar");
    if (!bar) return;

    var existing = bar.querySelectorAll("button");
    existing.forEach(function (btn) { btn.remove(); });

    buttons.forEach(function (btnId) {
      if (btnId === "nudge") return;
      var def = controllerButtonDefs[btnId];
      if (!def) return;

      var btn = document.createElement("button");
      btn.dataset.action = btnId;
      btn.textContent = def.label;
      if (def.className) btn.className = def.className;
      btn.title = btnId.charAt(0).toUpperCase() + btnId.slice(1);

      btn.addEventListener("click", function () {
        if (btnId === "settings") {
          window.open(chrome.runtime.getURL("options.html"));
          return;
        }
        sendToActiveTab(
          { action: "run_action", actionName: btnId },
          function (response) {
            if (response && response.speed != null) {
              updateSpeedDisplay(response.speed);
            }
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

  chrome.storage.sync.get(
    {
      enabled: true,
      showPopupControlBar: true,
      controllerButtons: defaultButtons,
      popupMatchHoverControls: true,
      popupControllerButtons: defaultButtons,
      siteRules: [],
      blacklist: `\
      www.instagram.com
      twitter.com
      vine.co
      imgur.com
      teams.microsoft.com
    `.replace(/^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm, "")
    },
    function (storage) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        const url = tabs[0]?.url || "";
        const blacklisted = isBlacklisted(url, storage.blacklist);
        toggleEnabledUI(storage.enabled && !blacklisted);
        if (blacklisted) {
          setStatusMessage("Site is blacklisted.");
        }

        var siteRule = matchSiteRule(url, storage.siteRules);

        var buttons = storage.popupMatchHoverControls
          ? storage.controllerButtons
          : storage.popupControllerButtons;

        if (siteRule && Array.isArray(siteRule.popupControllerButtons) && siteRule.popupControllerButtons.length > 0) {
          buttons = siteRule.popupControllerButtons;
        }

        if (!Array.isArray(buttons) || buttons.length === 0) {
          buttons = defaultButtons;
        }

        buildControlBar(buttons);
        querySpeed();

        var showBar = storage.showPopupControlBar !== false;
        if (siteRule && siteRule.showPopupControlBar !== undefined) {
          showBar = siteRule.showPopupControlBar;
        }
        setControlBarVisible(showBar);
      });
    }
  );

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
});
