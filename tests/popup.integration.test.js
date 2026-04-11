import {
  createChromeMock,
  flushAsyncWork,
  loadHtml,
  loadScript,
  triggerDomContentLoaded
} from "./helpers/browser.js";

async function setupPopup(overrides = {}) {
  loadHtml("popup.html");
  globalThis.chrome = createChromeMock(overrides);
  window.chrome = globalThis.chrome;
  loadScript("shared/site-rules.js");
  loadScript("shared/popup-controls.js");
  loadScript("ui-icons.js");
  loadScript("popup.js");
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

    expect(document.getElementById("app-version").innerText).toBe("5.1.7.0");
    expect(document.getElementById("popupSpeed").textContent).toBe("1.75");
    expect(
      document.querySelectorAll("#popupControlBar button").length
    ).toBeGreaterThan(0);
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

    expect(document.getElementById("status").innerText).toBe(
      "Speeder is disabled for this site."
    );
    expect(document.getElementById("popupSpeed").textContent).toBe("1.00");
    expect(document.getElementById("popupControlBar").style.display).toBe(
      "none"
    );
  });

  it("toggles enabled state and updates the browser action icons", async () => {
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
    expect(chrome.browserAction.setIcon).toHaveBeenCalledWith({
      path: {
        19: "icons/icon19_disabled.png",
        38: "icons/icon38_disabled.png",
        48: "icons/icon48_disabled.png"
      }
    });
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
    expect(document.getElementById("status").innerText).toBe(
      "Cannot run on this page."
    );

    response = { status: "complete" };
    document.getElementById("refresh").click();
    expect(document.getElementById("status").innerText).toBe(
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
});
