const {
  createChromeMock,
  evaluateScript,
  loadHtmlString
} = require("./helpers/extension-test-utils");

describe("background toolbar state", () => {
  afterEach(() => {
    delete global.chrome;
  });

  it("initializes and follows the enabled storage setting", () => {
    loadHtmlString("<!doctype html><html><body></body></html>");
    const chrome = createChromeMock({ syncData: { enabled: false } });
    global.chrome = chrome;
    window.chrome = chrome;

    evaluateScript("extension/background/background.js");
    expect(chrome.browserAction.setIcon).toHaveBeenLastCalledWith({
      path: {
        19: "assets/icons/icon19_disabled.png",
        38: "assets/icons/icon38_disabled.png",
        48: "assets/icons/icon48_disabled.png"
      }
    });

    chrome.storage.sync.set({ enabled: true });
    expect(chrome.browserAction.setIcon).toHaveBeenLastCalledWith({
      path: {
        19: "assets/icons/icon19.png",
        38: "assets/icons/icon38.png",
        48: "assets/icons/icon48.png"
      }
    });
  });
});
