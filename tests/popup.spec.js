const { afterEach, beforeEach, describe, expect, it, vi } = require("vitest");
const {
  createChromeMock,
  evaluateScript,
  fireDOMContentLoaded,
  flushAsyncWork,
  installCommonWindowMocks,
  loadHtmlFile
} = require("./helpers/extension-test-utils");

function bootPopup(options) {
  const config = options || {};

  loadHtmlFile("popup.html");
  installCommonWindowMocks();

  const chrome = createChromeMock({
    manifest: { version: "9.9.9-test" },
    syncData: config.syncData,
    localData: config.localData,
    tabsQueryResult: [
      config.activeTab || { id: 99, active: true, url: "https://example.com/" }
    ]
  });

  chrome.tabs.executeScript.mockImplementation(
    config.executeScriptImpl ||
      ((tabId, details, callback) => {
        if (callback) callback([{ speed: 1.0, preferred: true }]);
      })
  );
  chrome.tabs.sendMessage.mockImplementation(
    config.sendMessageImpl ||
      ((tabId, message, callback) => {
        if (message.action === "get_speed") {
          callback({ speed: 1.0 });
          return;
        }
        if (message.action === "rescan_page") {
          callback({ status: "complete" });
          return;
        }
        callback({ speed: 1.0 });
      })
  );

  global.chrome = chrome;
  window.chrome = chrome;

  evaluateScript("ui-icons.js");
  evaluateScript("popup.js");
  fireDOMContentLoaded();

  return chrome;
}

describe("popup.js", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete global.chrome;
  });

  it("renders the popup disabled state when a site rule disables Speeder", async () => {
    bootPopup({
      syncData: {
        enabled: true,
        siteRules: [
          {
            pattern: "youtube.com",
            enabled: false
          }
        ]
      },
      activeTab: {
        id: 10,
        active: true,
        url: "https://www.youtube.com/watch?v=abc123"
      }
    });

    await flushAsyncWork();

    expect(document.querySelector("#app-version").textContent).toBe("9.9.9-test");
    expect(document.querySelector("#status").textContent).toContain(
      "disabled for this site"
    );
    expect(document.querySelector("#popupSpeed").textContent).toBe("1.00");
    expect(document.querySelector("#popupControlBar").style.display).toBe("none");
  });

  it("builds sanitized popup buttons and refreshes speed after an action", async () => {
    const chrome = bootPopup({
      syncData: {
        enabled: true,
        controllerButtons: ["faster", "settings", "rewind", "faster"],
        popupMatchHoverControls: true
      }
    });

    chrome.tabs.executeScript
      .mockImplementationOnce((tabId, details, callback) => {
        callback([
          { speed: 1.25, preferred: false },
          { speed: 1.5, preferred: true }
        ]);
      })
      .mockImplementationOnce((tabId, details, callback) => {
        callback([{ speed: 1.75, preferred: true }]);
      });

    chrome.tabs.sendMessage.mockImplementation((tabId, message, callback) => {
      if (message.action === "run_action") {
        callback({ speed: 1.75 });
        return;
      }
      callback({ speed: 1.0 });
    });

    document.dispatchEvent(new window.Event("DOMContentLoaded"));
    await flushAsyncWork();

    const buttons = Array.from(
      document.querySelectorAll("#popupControlBar button[data-action]")
    ).map((button) => button.dataset.action);
    expect(buttons).toEqual(["faster", "rewind"]);
    expect(document.querySelector("#popupSpeed").textContent).toBe("1.50");

    document.querySelector('#popupControlBar button[data-action="faster"]').click();
    await flushAsyncWork();

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      99,
      { action: "run_action", actionName: "faster" },
      expect.any(Function)
    );
    expect(document.querySelector("#popupSpeed").textContent).toBe("1.75");
  });

  it("toggles enablement and closes after a successful refresh", async () => {
    vi.useFakeTimers();

    const chrome = bootPopup({
      syncData: {
        enabled: false
      }
    });

    await flushAsyncWork();

    expect(document.querySelector("#enable").classList.contains("hide")).toBe(false);
    expect(document.querySelector("#disable").classList.contains("hide")).toBe(true);

    document.querySelector("#enable").click();
    expect(chrome.storage.sync.set).toHaveBeenCalledWith(
      { enabled: true },
      expect.any(Function)
    );
    expect(chrome.browserAction.setIcon).toHaveBeenCalledWith({
      path: {
        19: "icons/icon19.png",
        38: "icons/icon38.png",
        48: "icons/icon48.png"
      }
    });

    document.querySelector("#refresh").click();
    expect(document.querySelector("#status").textContent).toContain("Closing");

    vi.advanceTimersByTime(500);
    expect(window.close).toHaveBeenCalled();
  });
});
