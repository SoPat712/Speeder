import {
  createChromeMock,
  flushAsyncWork,
  loadHtml,
  loadScript,
  triggerDomContentLoaded
} from "./helpers/browser.js";

async function setupPopup(overrides = {}) {
  loadHtml("extension/popup/popup.html");
  globalThis.chrome = createChromeMock(overrides);
  window.chrome = globalThis.chrome;
  loadScript("extension/shared/settings-core.js");
  loadScript("extension/shared/site-rules.js");
  loadScript("extension/shared/popup-controls.js");
  loadScript("extension/shared/ui-icons.js");
  loadScript("extension/popup/popup.js");
  triggerDomContentLoaded();
  await flushAsyncWork();
  return globalThis.chrome;
}

describe("popup UI", () => {
  it("renders version, builds controls, and prefers the active frame speed", async () => {
    await setupPopup({
      manifestVersion: "5.1.7.0",
      executeScriptResponse: [
        { speed: 1.1, preferred: false },
        { speed: 1.75, preferred: true }
      ]
    });

    expect(document.getElementById("app-version").textContent).toBe("5.1.7.0");
    expect(document.getElementById("popupSpeed").textContent).toBe("1.75");
    expect(
      document.querySelectorAll("#popupControlBar button").length
    ).toBeGreaterThan(0);
    expect(document.getElementById("status").getAttribute("role")).toBe(
      "status"
    );
    expect(
      document.querySelector("#popupControlBar button").getAttribute("aria-label")
    ).not.toBe("");
  });

  it("shows controls when globally disabled but a whitelist site rule matches", async () => {
    await setupPopup({
      sync: {
        enabled: false,
        siteRules: [{ pattern: "example.com", enabled: true }]
      }
    });

    expect(document.getElementById("status").classList.contains("hide")).toBe(
      true
    );
    expect(document.getElementById("popupControlBar").style.display).not.toBe(
      "none"
    );
  });

  it("shows disabled state for a matching site rule", async () => {
    await setupPopup({
      sync: {
        enabled: true,
        siteRules: [{ pattern: "example.com", enabled: false }]
      }
    });

    expect(document.getElementById("status").textContent).toBe(
      "Speeder is disabled for this site."
    );
    expect(document.getElementById("popupSpeed").textContent).toBe("1.00");
    expect(document.getElementById("popupControlBar").style.display).toBe(
      "none"
    );
  });

  it("toggles enabled state without owning background icon state", async () => {
    const chrome = await setupPopup();
    chrome.storage.sync.set.mockClear();
    chrome.browserAction.setIcon.mockClear();

    document.getElementById("disable").click();

    expect(chrome.storage.sync.set).toHaveBeenCalledWith(
      { enabled: false },
      expect.any(Function)
    );
    expect(document.getElementById("enable").classList.contains("hide")).toBe(
      false
    );
    expect(chrome.browserAction.setIcon).not.toHaveBeenCalled();
  });

  it("handles refresh responses for unsupported and successful pages", async () => {
    vi.useFakeTimers();
    const chrome = await setupPopup();
    let response = null;
    chrome.tabs.sendMessage.mockImplementation((tabId, message, callback) => {
      if (message.action === "rescan_page") {
        callback(response);
        return;
      }
      callback({ speed: 1.25 });
    });

    document.getElementById("refresh").click();
    expect(document.getElementById("status").textContent).toBe(
      "Cannot run on this page."
    );

    response = { status: "complete" };
    document.getElementById("refresh").click();
    expect(document.getElementById("status").textContent).toBe(
      "Scan complete. Closing..."
    );
    vi.advanceTimersByTime(500);
    expect(window.close).toHaveBeenCalled();
  });

  it("dispatches popup control bar actions back to the active tab", async () => {
    const chrome = await setupPopup();
    chrome.tabs.sendMessage.mockClear();
    chrome.tabs.executeScript.mockClear();

    document.querySelector("#popupControlBar button").click();

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        action: "run_action"
      }),
      expect.any(Function)
    );
    expect(chrome.tabs.executeScript).toHaveBeenCalled();
  });

  it("toggles force last saved speed and applies it to the active page", async () => {
    const chrome = await setupPopup({
      sync: { lastSpeed: 1.8, forceLastSavedSpeed: false }
    });
    chrome.tabs.sendMessage.mockClear();

    document.getElementById("forceLastSavedSpeed").click();
    await flushAsyncWork();

    expect(chrome.storage.sync.__state.forceLastSavedSpeed).toBe(true);
    expect(
      document.getElementById("forceLastSavedSpeed").getAttribute("aria-pressed")
    ).toBe("true");
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      {
        action: "set_force_last_saved_speed",
        enabled: true
      },
      expect.any(Function)
    );
  });

  it("keeps the global force setting unchanged when a site rule controls it", async () => {
    const chrome = await setupPopup({
      sync: {
        forceLastSavedSpeed: false,
        siteRules: [
          {
            pattern: "example.com",
            enabled: true,
            forceLastSavedSpeed: true
          }
        ]
      }
    });
    const forceButton = document.getElementById("forceLastSavedSpeed");
    expect(forceButton.getAttribute("aria-pressed")).toBe("true");
    const storageBeforeClick = JSON.parse(
      JSON.stringify(chrome.storage.sync.__state)
    );
    chrome.storage.sync.set.mockClear();
    chrome.storage.sync.remove.mockClear();
    chrome.tabs.sendMessage.mockClear();

    forceButton.click();
    await flushAsyncWork();

    expect(chrome.storage.sync.__state).toEqual(storageBeforeClick);
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(chrome.storage.sync.remove).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(forceButton.getAttribute("aria-pressed")).toBe("true");
    expect(document.getElementById("status").textContent).toBe(
      "Force setting is controlled by this site rule."
    );
  });
});
