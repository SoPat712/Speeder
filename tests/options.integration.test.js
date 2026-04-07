import {
  createChromeMock,
  flushAsyncWork,
  loadHtml,
  loadScript,
  triggerDomContentLoaded
} from "./helpers/browser.js";

async function setupOptions(overrides = {}) {
  loadHtml("options.html");
  globalThis.chrome = createChromeMock(overrides);
  window.chrome = globalThis.chrome;
  globalThis.fetch = vi.fn();
  loadScript("shared/controller-utils.js");
  loadScript("shared/key-bindings.js");
  loadScript("shared/popup-controls.js");
  loadScript("ui-icons.js");
  loadScript("lucide-client.js");
  loadScript("options.js");
  triggerDomContentLoaded();
  await flushAsyncWork();
  return globalThis.chrome;
}

describe("options page", () => {
  it("restores stored settings, custom shortcuts, and site rules", async () => {
    await setupOptions({
      manifestVersion: "5.1.7.0",
      sync: {
        rememberSpeed: true,
        enabled: false,
        popupMatchHoverControls: false,
        popupControllerButtons: ["rewind", "settings", "advance", "advance"],
        keyBindings: [
          { action: "display", code: "KeyV", value: 0, predefined: true },
          { action: "pause", code: "KeyQ", value: 0, predefined: false }
        ],
        siteRules: [
          {
            pattern: "youtube.com",
            enabled: true,
            showPopupControlBar: false,
            popupControllerButtons: ["advance", "settings", "advance"]
          }
        ]
      }
    });

    expect(document.getElementById("app-version").textContent).toBe("5.1.7.0");
    expect(document.getElementById("rememberSpeed").checked).toBe(true);
    expect(document.getElementById("enabled").checked).toBe(false);
    expect(document.querySelector('.shortcut-row[data-action="pause"]')).not.toBe(
      null
    );
    expect(document.getElementById("siteRulesContainer").children.length).toBe(
      1
    );
    expect(globalThis.getPopupControlBarOrder()).toEqual(["rewind", "advance"]);
  });

  it("validates site rule regexes before saving", async () => {
    const chrome = await setupOptions();
    chrome.storage.sync.set.mockClear();
    globalThis.createSiteRule(null);
    const rule = document.querySelector(".site-rule");
    rule.querySelector(".site-pattern").value = "/(/";

    globalThis.save_options();

    expect(document.getElementById("status").textContent).toContain(
      "Invalid site rule regex"
    );
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  it("saves normalized settings and sanitized popup/site-rule controls", async () => {
    const chrome = await setupOptions();

    document.getElementById("rememberSpeed").checked = true;
    document.getElementById("hideWithControlsTimer").value = "20";
    document.getElementById("controllerOpacity").value = "0.55";
    document.getElementById("controllerMarginTop").value = "250";
    document.getElementById("controllerMarginBottom").value = "-4";
    document.getElementById("enableSubtitleNudge").checked = true;
    document.getElementById("subtitleNudgeInterval").value = "5";
    document.getElementById("popupMatchHoverControls").checked = false;
    document.getElementById("showPopupControlBar").checked = false;

    globalThis.populatePopupControlBarEditor([
      "rewind",
      "settings",
      "faster",
      "faster"
    ]);

    globalThis.createSiteRule(null);
    const rule = document.querySelector(".site-rule");
    rule.querySelector(".site-pattern").value = "youtube.com";
    rule.querySelector(".override-playback").checked = true;
    rule.querySelector(".site-rememberSpeed").checked = true;
    rule.querySelector(".override-popup-controlbar").checked = true;
    rule.querySelector(".site-showPopupControlBar").checked = false;
    globalThis.populateControlBarZones(
      rule.querySelector(".site-popup-cb-active"),
      rule.querySelector(".site-popup-cb-available"),
      ["advance", "settings", "advance"],
      function (id) {
        return id !== "settings";
      }
    );

    globalThis.save_options();

    expect(chrome.storage.sync.remove).toHaveBeenCalled();
    const savedSettings =
      chrome.storage.sync.set.mock.calls[
        chrome.storage.sync.set.mock.calls.length - 1
      ][0];

    expect(savedSettings.rememberSpeed).toBe(true);
    expect(savedSettings.hideWithControlsTimer).toBe(15);
    expect(savedSettings.controllerOpacity).toBe(0.55);
    expect(savedSettings.controllerMarginTop).toBe(200);
    expect(savedSettings.controllerMarginBottom).toBe(0);
    expect(savedSettings.subtitleNudgeInterval).toBe(10);
    expect(savedSettings.showPopupControlBar).toBe(false);
    expect(savedSettings.popupMatchHoverControls).toBe(false);
    expect(savedSettings.popupControllerButtons).toEqual(["rewind", "faster"]);
    expect(savedSettings.siteRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pattern: "youtube.com",
          rememberSpeed: true,
          showPopupControlBar: false,
          popupControllerButtons: ["advance"]
        })
      ])
    );
  });
});
