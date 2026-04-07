const { afterEach, beforeEach, describe, expect, it, vi } = require("vitest");
const {
  createChromeMock,
  evaluateScript,
  fireDOMContentLoaded,
  flushAsyncWork,
  installCommonWindowMocks,
  loadHtmlFile
} = require("./helpers/extension-test-utils");

function bootOptions(options) {
  const config = options || {};

  loadHtmlFile("options.html");
  installCommonWindowMocks();

  const chrome = createChromeMock({
    manifest: { version: "5.1.7.0" },
    syncData: config.syncData,
    localData: config.localData
  });

  global.chrome = chrome;
  window.chrome = chrome;
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve("<svg></svg>")
    })
  );
  window.fetch = global.fetch;

  evaluateScript("ui-icons.js");
  evaluateScript("lucide-client.js");
  evaluateScript("options.js");
  fireDOMContentLoaded();

  return chrome;
}

describe("options.js", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete global.chrome;
    delete global.fetch;
  });

  it("restores saved settings, bindings, site rules, and popup bar order", async () => {
    bootOptions({
      syncData: {
        rememberSpeed: true,
        forceLastSavedSpeed: true,
        controllerLocation: "middle-right",
        controllerOpacity: 0.75,
        controllerMarginTop: 22,
        controllerMarginBottom: 14,
        popupMatchHoverControls: false,
        controllerButtons: ["rewind", "fast", "display"],
        popupControllerButtons: ["advance", "settings", "rewind", "advance"],
        keyBindings: [
          { action: "display", code: "KeyV", value: 0, predefined: true },
          { action: "pause", code: "KeyQ", value: 0, predefined: false }
        ],
        siteRules: [
          {
            pattern: "youtube.com",
            enabled: false,
            controllerMarginTop: 12,
            popupControllerButtons: ["advance", "settings", "rewind"]
          }
        ]
      }
    });

    await flushAsyncWork(3);

    expect(document.getElementById("app-version").textContent).toBe("5.1.7.0");
    expect(document.getElementById("rememberSpeed").checked).toBe(true);
    expect(document.getElementById("forceLastSavedSpeed").checked).toBe(true);
    expect(document.getElementById("controllerLocation").value).toBe(
      "middle-right"
    );
    expect(document.getElementById("controllerOpacity").value).toBe("0.75");
    expect(document.getElementById("controllerMarginTop").value).toBe("22");
    expect(document.getElementById("popupMatchHoverControls").checked).toBe(false);
    expect(
      document.getElementById("popupCbEditorWrap").classList.contains(
        "cb-editor-disabled"
      )
    ).toBe(false);

    const popupButtons = Array.from(
      document.querySelectorAll("#popupControlBarActive .cb-block")
    ).map((block) => block.dataset.buttonId);
    expect(popupButtons).toEqual(["advance", "rewind"]);

    expect(
      document.querySelector('.shortcut-row.customs[data-action="pause"]')
    ).not.toBeNull();
    expect(document.querySelectorAll(".site-rule")).toHaveLength(1);
    expect(document.querySelector(".site-rule .site-enabled").checked).toBe(false);
  });

  it("saves normalized settings and site rule overrides", async () => {
    const chrome = bootOptions();
    await flushAsyncWork(3);

    document.getElementById("rememberSpeed").checked = true;
    document.getElementById("hideWithControlsTimer").value = "99";
    document.getElementById("controllerLocation").value = "bottom-left";
    document.getElementById("controllerOpacity").value = "0.65";
    document.getElementById("controllerMarginTop").value = "250";
    document.getElementById("controllerMarginBottom").value = "-5";
    document.getElementById("popupMatchHoverControls").checked = false;
    document.getElementById("showPopupControlBar").checked = true;

    window.populatePopupControlBarEditor(["advance", "settings", "rewind"]);

    window.createSiteRule({ pattern: "youtube.com" });
    const ruleEl = document.querySelector(".site-rule");
    ruleEl.querySelector(".override-placement").checked = true;
    ruleEl.querySelector(".site-controllerLocation").value = "top-right";
    ruleEl.querySelector(".site-controllerMarginTop").value = "300";
    ruleEl.querySelector(".site-controllerMarginBottom").value = "-10";

    ruleEl.querySelector(".override-autohide").checked = true;
    ruleEl.querySelector(".site-hideWithControls").checked = true;
    ruleEl.querySelector(".site-hideWithControlsTimer").value = "0";

    ruleEl.querySelector(".override-popup-controlbar").checked = true;
    ruleEl.querySelector(".site-showPopupControlBar").checked = false;
    window.populateControlBarZones(
      ruleEl.querySelector(".site-popup-cb-active"),
      ruleEl.querySelector(".site-popup-cb-available"),
      ["advance", "settings", "rewind"],
      function (id) {
        return id !== "settings";
      }
    );

    window.save_options();

    expect(chrome.storage.sync.remove).toHaveBeenCalledWith(
      [
        "resetSpeed",
        "speedStep",
        "fastSpeed",
        "rewindTime",
        "advanceTime",
        "resetKeyCode",
        "slowerKeyCode",
        "fasterKeyCode",
        "rewindKeyCode",
        "advanceKeyCode",
        "fastKeyCode",
        "blacklist"
      ],
      expect.any(Function)
    );

    const savedSettings = chrome.storage.sync.set.mock.calls.at(-1)[0];
    expect(savedSettings.rememberSpeed).toBe(true);
    expect(savedSettings.hideWithControlsTimer).toBe(15);
    expect(savedSettings.controllerLocation).toBe("bottom-left");
    expect(savedSettings.controllerMarginTop).toBe(200);
    expect(savedSettings.controllerMarginBottom).toBe(0);
    expect(savedSettings.popupControllerButtons).toEqual(["advance", "rewind"]);
    expect(savedSettings.siteRules).toEqual([
      {
        pattern: "youtube.com",
        enabled: true,
        controllerLocation: "top-right",
        controllerMarginTop: 200,
        controllerMarginBottom: 0,
        hideWithControls: true,
        hideWithControlsTimer: 0.1,
        showPopupControlBar: false,
        popupControllerButtons: ["advance", "rewind"]
      }
    ]);
  });

  it("blocks save when a site rule regex is invalid", async () => {
    const chrome = bootOptions();
    await flushAsyncWork(3);

    window.createSiteRule({ pattern: "/[abc/" });
    window.save_options();

    expect(document.getElementById("status").textContent).toContain(
      "Invalid site rule regex"
    );
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  it("adds shortcuts from the selector and records key input states", async () => {
    bootOptions();
    await flushAsyncWork(3);

    const selector = document.getElementById("addShortcutSelector");
    selector.value = "pause";
    selector.dispatchEvent(new window.Event("change", { bubbles: true }));

    const row = document.querySelector('.shortcut-row.customs[data-action="pause"]');
    expect(row).not.toBeNull();

    const keyInput = row.querySelector(".customKey");
    keyInput.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "q",
        code: "KeyQ",
        bubbles: true
      })
    );
    expect(keyInput.vscBinding.code).toBe("KeyQ");
    expect(keyInput.value).toBe("Q");

    keyInput.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true
      })
    );
    expect(keyInput.vscBinding.disabled).toBe(true);
    expect(selector.disabled).toBe(false);
  });
});
