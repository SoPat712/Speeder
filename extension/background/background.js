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

chrome.storage.sync.get(["enabled"], function(storage) {
  if (!chrome.runtime.lastError) setToolbarIcon(storage.enabled !== false);
});

chrome.storage.onChanged.addListener(function(changes, areaName) {
  if (areaName === "sync" && changes.enabled) {
    setToolbarIcon(changes.enabled.newValue !== false);
  }
});

chrome.runtime.onMessage.addListener(function (request) {
  if (request.action === "openOptions") {
    chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html") });
  }
});
