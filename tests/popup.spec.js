const {
  createChromeMock,
  evaluateScript,
  fireDOMContentLoaded,
  flushAsyncWork,
  installCommonWindowMocks,
  loadHtmlFile
} = require("./helpers/extension-test-utils");
const manifest = require("../extension/manifest.json");

function bootPopup(options) {
  const config = options || {};

  loadHtmlFile("extension/popup/popup.html");
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

  evaluateScript("extension/shared/settings-core.js");
  evaluateScript("extension/shared/site-rules.js");
  evaluateScript("extension/shared/popup-controls.js");
  evaluateScript("extension/shared/ui-icons.js");
  evaluateScript("extension/popup/popup.js");
  fireDOMContentLoaded();

  return chrome;
}

describe("popup.js", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete global.chrome;
  });

  it("declares activeTab for the popup all-frame speed snapshot", () => {
    expect(manifest.permissions).toContain("activeTab");
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
    let speedQueryCount = 0;
    const chrome = bootPopup({
      syncData: {
        enabled: true,
        controllerButtons: ["faster", "settings", "rewind", "faster"],
        popupMatchHoverControls: true
      },
      executeScriptImpl: (tabId, details, callback) => {
        speedQueryCount += 1;
        callback(
          speedQueryCount <= 2
            ? [
                { speed: 1.25, preferred: false },
                { speed: 1.5, frameToken: "playing-frame", preferred: true }
              ]
            : [{ speed: 1.75, preferred: true }]
        );
      }
    });

    chrome.tabs.sendMessage.mockImplementation((tabId, message, callback) => {
      if (message.action === "run_action") {
        callback({ speed: 1.75 });
        return;
      }
      callback({ speed: 1.0 });
    });

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
      {
        action: "run_action",
        actionName: "faster",
        targetFrameToken: "playing-frame"
      },
      expect.any(Function)
    );
    expect(document.querySelector("#popupSpeed").textContent).toBe("1.75");
  });

  it("keeps all-video popup actions intentionally untargeted", async () => {
    const chrome = bootPopup({
      syncData: { shortcutTargetMode: "all" },
      executeScriptImpl: (tabId, details, callback) => {
        callback([{ speed: 1.5, frameToken: "playing-frame", preferred: true }]);
      }
    });
    await flushAsyncWork();
    chrome.tabs.sendMessage.mockClear();

    document.querySelector("#popupControlBar button").click();

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      99,
      { action: "run_action", actionName: "rewind" },
      expect.any(Function)
    );
  });

  it("copies redacted diagnostics for the active media frame", async () => {
    bootPopup({
      activeTab: {
        id: 12,
        active: true,
        url: "https://video.example/watch?private_token=secret"
      },
      executeScriptImpl: (tabId, details, callback) => {
        callback([
          {
            speed: 1.5,
            preferred: true,
            diagnostics: {
              mediaType: "video",
              fullscreen: { active: true, element: "div", ownsMedia: true },
              controller: { present: true, hidden: false }
            }
          }
        ]);
      }
    });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    await flushAsyncWork();

    document.querySelector("#copyDiagnostics").click();
    await flushAsyncWork();

    expect(writeText).toHaveBeenCalled();
    const reportText = writeText.mock.calls.at(-1)[0];
    const report = JSON.parse(reportText);
    expect(report.page).toEqual({
      protocol: "https:",
      hostname: "video.example"
    });
    expect(report.frame.mediaType).toBe("video");
    expect(reportText).not.toContain("private_token");
    expect(reportText).not.toContain("secret");
    expect(document.querySelector("#status").textContent).toContain("copied");
  });

  it("toggles enablement and closes after a successful refresh", async () => {
    const chrome = bootPopup({
      syncData: {
        enabled: false
      }
    });

    await flushAsyncWork();
    vi.useFakeTimers();

    expect(document.querySelector("#enable").classList.contains("hide")).toBe(false);
    expect(document.querySelector("#disable").classList.contains("hide")).toBe(true);

    document.querySelector("#enable").click();
    expect(chrome.storage.sync._dump()).not.toHaveProperty("enabled");
    expect(
      window.vscExpandStoredSettings(chrome.storage.sync._dump()).enabled
    ).toBe(true);
    expect(chrome.browserAction.setIcon).not.toHaveBeenCalled();

    document.querySelector("#refresh").click();
    expect(document.querySelector("#status").textContent).toContain("Closing");

    vi.advanceTimersByTime(500);
    expect(window.close).toHaveBeenCalled();
  });
});
