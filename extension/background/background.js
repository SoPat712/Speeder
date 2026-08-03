function setToolbarIcon(enabled) {
  var suffix = enabled === false ? "_disabled" : "";
  chrome.browserAction.setIcon({
    path: {
      19: "assets/icons/icon19" + suffix + ".png",
      38: "assets/icons/icon38" + suffix + ".png",
      48: "assets/icons/icon48" + suffix + ".png"
    }
  });
}

var pausedTabIds = new Set();

function getMessageTabId(request, sender) {
  if (request && Number.isInteger(request.tabId)) return request.tabId;
  return sender && sender.tab && Number.isInteger(sender.tab.id)
    ? sender.tab.id
    : null;
}

chrome.storage.sync.get(["enabled"], function(storage) {
  if (!chrome.runtime.lastError) setToolbarIcon(storage.enabled !== false);
});

chrome.storage.onChanged.addListener(function(changes, areaName) {
  if (areaName === "sync" && changes.enabled) {
    setToolbarIcon(changes.enabled.newValue !== false);
  }
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "openOptions") {
    chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html") });
    return false;
  }
  if (request.action === "get_tab_pause_state") {
    var queriedTabId = getMessageTabId(request, sender);
    sendResponse({
      paused: queriedTabId !== null && pausedTabIds.has(queriedTabId)
    });
    return false;
  }
  if (request.action === "set_tab_paused") {
    var tabId = getMessageTabId(request, sender);
    if (tabId === null) {
      sendResponse({ paused: false });
      return false;
    }
    var paused = request.paused === true;
    if (paused) pausedTabIds.add(tabId);
    else pausedTabIds.delete(tabId);
    chrome.tabs.sendMessage(
      tabId,
      { action: "set_tab_paused", paused: paused },
      function () {
        void chrome.runtime.lastError;
      }
    );
    sendResponse({ paused: paused });
    return false;
  }
  return false;
});

chrome.tabs.onRemoved.addListener(function(tabId) {
  pausedTabIds.delete(tabId);
});
