chrome.runtime.onMessage.addListener(function (request) {
  if (request.action === "openOptions") {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
  }
});
