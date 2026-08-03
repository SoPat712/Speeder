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

  it("keeps tab pauses in memory and clears closed tabs", () => {
    loadHtmlString("<!doctype html><html><body></body></html>");
    const chrome = createChromeMock();
    global.chrome = chrome;
    window.chrome = chrome;

    evaluateScript("extension/background/background.js");
    const listener = chrome.runtime.onMessage.listeners[0];
    const respond = vi.fn();

    listener(
      { action: "set_tab_paused", tabId: 42, paused: true },
      {},
      respond
    );
    expect(respond).toHaveBeenLastCalledWith({ paused: true });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      42,
      { action: "set_tab_paused", paused: true },
      expect.any(Function)
    );

    listener({ action: "get_tab_pause_state" }, { tab: { id: 42 } }, respond);
    expect(respond).toHaveBeenLastCalledWith({ paused: true });

    chrome.tabs.onRemoved.emit(42);
    listener({ action: "get_tab_pause_state", tabId: 42 }, {}, respond);
    expect(respond).toHaveBeenLastCalledWith({ paused: false });
  });
});
