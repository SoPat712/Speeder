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

  loadHtmlFile("extension/options/options.html");
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

  evaluateScript("extension/shared/controller-utils.js");
  evaluateScript("extension/shared/key-bindings.js");
  evaluateScript("extension/shared/settings-core.js");
  evaluateScript("extension/shared/popup-controls.js");
  evaluateScript("extension/shared/ui-icons.js");
  evaluateScript("extension/options/lucide-client.js");
  evaluateScript("extension/options/options.js");
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

  it("rejects invalid zero-valued speed steps instead of saving broken shortcuts", async () => {
    const chrome = bootOptions();
    await flushAsyncWork(3);
    const fasterRow = Array.from(
      document.querySelectorAll("#customs .shortcut-row")
    ).find((row) => row.dataset.action === "faster");
    fasterRow.querySelector(".customValue").value = "0";
    chrome.storage.sync.set.mockClear();

    window.save_options();

    expect(document.getElementById("status").textContent).toContain(
      "must be greater than 0"
    );
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  it("automatically saves changed settings", async () => {
    const chrome = bootOptions({ syncData: { rememberSpeed: false } });
    await flushAsyncWork(3);
    vi.useFakeTimers();
    chrome.storage.sync.set.mockClear();

    const rememberSpeed = document.getElementById("rememberSpeed");
    rememberSpeed.checked = true;
    rememberSpeed.dispatchEvent(new Event("change", { bubbles: true }));

    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);

    expect(chrome.storage.sync._dump().rememberSpeed).toBe(true);
    expect(document.getElementById("status").textContent).toBe("Auto-saved");
  });

  it("copies privacy-safe diagnostics from settings", async () => {
    bootOptions({
      syncData: {
        enabled: false,
        rememberSpeed: true,
        siteRules: [
          {
            title: "Private account",
            pattern: "secret.example/private-token",
            enabled: true
          }
        ]
      }
    });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    await flushAsyncWork(3);

    document.getElementById("copyDiagnostics").click();
    await flushAsyncWork(3);

    const reportText = writeText.mock.calls[0][0];
    const report = JSON.parse(reportText);
    expect(report.globalSettings.enabled).toBe(false);
    expect(report.globalSettings.rememberSpeed).toBe(true);
    expect(report.page).toEqual({ protocol: null, hostname: null });
    expect(report.matchedSiteRule.matched).toBe(false);
    expect(report.frame).toBeNull();
    expect(reportText).not.toContain("Private account");
    expect(reportText).not.toContain("private-token");
    expect(document.getElementById("status").textContent).toContain("copied");
  });

  it("does not partially save options when a required site shortcut is invalid", async () => {
    const chrome = bootOptions({ syncData: { rememberSpeed: false } });
    await flushAsyncWork(3);
    window.createSiteRule({
      pattern: "example.org",
      shortcuts: [
        {
          action: "faster",
          code: "KeyD",
          value: 0.1,
          disabled: false
        }
      ]
    });
    const rule = document.getElementById("siteRulesContainer").lastElementChild;
    rule.querySelector('.shortcut-row[data-action="faster"] .customKey').vscBinding =
      null;
    document.getElementById("rememberSpeed").checked = true;
    chrome.storage.sync.set.mockClear();
    chrome.storage.sync.remove.mockClear();

    window.save_options();

    expect(document.getElementById("status").textContent).toContain(
      "cannot be empty"
    );
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(chrome.storage.sync.remove).not.toHaveBeenCalled();
    expect(chrome.storage.sync._dump().rememberSpeed).toBe(false);
  });

  it("preserves the supported unexposed subtitle nudge amount when saving", async () => {
    const chrome = bootOptions({ syncData: { subtitleNudgeAmount: 0.004 } });
    await flushAsyncWork(3);

    window.save_options();

    expect(
      window.vscExpandStoredSettings(chrome.storage.sync._dump())
        .subtitleNudgeAmount
    ).toBe(0.004);
  });

  it("does not turn a blank per-site preferred speed into the 1.8 fast default", async () => {
    const chrome = bootOptions();
    await flushAsyncWork(3);
    const shortsRule = Array.from(document.querySelectorAll(".site-rule")).find(
      (rule) => rule.querySelector(".site-title").value === "YouTube Shorts"
    );

    expect(shortsRule).toBeTruthy();
    expect(shortsRule.querySelector(".site-preferredSpeed").value).toBe("");
    window.save_options();

    const expanded = window.vscExpandStoredSettings(chrome.storage.sync._dump());
    const savedShortsRule = expanded.siteRules.find(
      (rule) => rule.title === "YouTube Shorts"
    );
    expect(savedShortsRule.preferredSpeed).toBeUndefined();
  });

  it("keeps the loaded UI and blocks saves when a settings reload fails", async () => {
    const chrome = bootOptions({
      syncData: {
        rememberSpeed: true,
        siteRules: [{ pattern: "example.org", enabled: true }]
      }
    });
    await flushAsyncWork(3);
    const originalRuleCount = document.querySelectorAll(".site-rule").length;

    chrome.storage.sync.get.mockImplementationOnce(function (_keys, callback) {
      chrome.runtime.lastError = { message: "temporary read failure" };
      callback({});
      chrome.runtime.lastError = null;
    });
    chrome.storage.sync.set.mockClear();
    chrome.storage.sync.remove.mockClear();

    window.restore_options();

    expect(document.getElementById("rememberSpeed").checked).toBe(true);
    expect(document.querySelectorAll(".site-rule")).toHaveLength(
      originalRuleCount
    );
    expect(document.getElementById("save").disabled).toBe(true);
    expect(document.getElementById("status").textContent).toContain(
      "temporary read failure"
    );

    document.getElementById("rememberSpeed").checked = false;
    window.save_options();

    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(chrome.storage.sync.remove).not.toHaveBeenCalled();
    expect(chrome.storage.sync._dump().rememberSpeed).toBe(true);
    expect(document.getElementById("status").textContent).toContain(
      "Settings have not loaded"
    );
  });

  it("does not clear local data or live rows when the sync reset fails", async () => {
    const chrome = bootOptions({
      syncData: {
        keyBindings: [
          { action: "display", code: "KeyV", value: 0, predefined: true },
          { action: "pause", code: "KeyQ", value: 0, predefined: false }
        ]
      },
      localData: {
        customButtonIcons: { faster: { slug: "rocket" } },
        rememberedSpeeds: { "https://example.org/video.mp4": 1.5 }
      }
    });
    await flushAsyncWork(3);
    expect(
      document.querySelector('.shortcut-row.customs[data-action="pause"]')
    ).not.toBeNull();

    chrome.storage.local.remove.mockClear();
    chrome.storage.sync.remove.mockImplementationOnce(function (_keys, callback) {
      chrome.runtime.lastError = { message: "sync reset failed" };
      callback();
      chrome.runtime.lastError = null;
    });

    window.restore_defaults();
    await flushAsyncWork(3);

    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    expect(chrome.storage.local._dump().customButtonIcons).toBeDefined();
    expect(chrome.storage.local._dump().rememberedSpeeds).toBeDefined();
    expect(
      document.querySelector('.shortcut-row.customs[data-action="pause"]')
    ).not.toBeNull();
    expect(document.getElementById("save").disabled).toBe(false);
    expect(document.getElementById("status").textContent).toContain(
      "sync reset failed"
    );
  });

  it("reports a local reset failure after resetting sync defaults", async () => {
    const chrome = bootOptions({
      syncData: { rememberSpeed: true, lastSpeed: 1.75 },
      localData: { customButtonIcons: { faster: { slug: "rocket" } } }
    });
    await flushAsyncWork(3);

    chrome.storage.local.remove.mockImplementationOnce(function (_keys, callback) {
      chrome.runtime.lastError = { message: "local reset failed" };
      callback();
      chrome.runtime.lastError = null;
    });

    window.restore_defaults();
    await flushAsyncWork(3);

    expect(
      window.vscExpandStoredSettings(chrome.storage.sync._dump()).rememberSpeed
    ).toBe(false);
    expect(chrome.storage.sync._dump().lastSpeed).toBe(1);
    expect(chrome.storage.local._dump().customButtonIcons).toBeDefined();
    expect(document.getElementById("save").disabled).toBe(false);
    expect(document.getElementById("status").textContent).toContain(
      "local reset failed"
    );
  });

  it("does not remove local data when the speed reset marker cannot be written", async () => {
    const chrome = bootOptions({
      localData: {
        customButtonIcons: { faster: { slug: "rocket" } },
        rememberedSpeeds: { "https://example.org/video.mp4": 1.5 }
      }
    });
    await flushAsyncWork(3);
    chrome.storage.local.remove.mockClear();
    chrome.storage.local.set.mockImplementationOnce(function (_items, callback) {
      chrome.runtime.lastError = { message: "reset marker failed" };
      callback();
      chrome.runtime.lastError = null;
    });

    window.restore_defaults();
    await flushAsyncWork(3);

    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    expect(chrome.storage.local._dump().customButtonIcons).toBeDefined();
    expect(chrome.storage.local._dump().rememberedSpeeds).toBeDefined();
    expect(document.getElementById("status").textContent).toContain(
      "reset marker failed"
    );
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
    const siteRuleEls = document.querySelectorAll(".site-rule");
    const ruleEl = siteRuleEls[siteRuleEls.length - 1];
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

    const savedSettings = window.vscExpandStoredSettings(
      chrome.storage.sync._dump()
    );
    expect(savedSettings.rememberSpeed).toBe(true);
    expect(savedSettings.hideWithControlsTimer).toBe(15);
    expect(savedSettings.controllerLocation).toBe("bottom-left");
    expect(savedSettings.controllerMarginTop).toBe(200);
    expect(savedSettings.controllerMarginBottom).toBe(0);
    expect(savedSettings.popupControllerButtons).toEqual(["advance", "rewind"]);
    expect(savedSettings.siteRules).toHaveLength(4);
    expect(savedSettings.siteRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pattern: "youtube.com",
          enabled: true,
          controllerLocation: "top-right",
          controllerMarginTop: 200,
          controllerMarginBottom: 0,
          hideWithControls: true,
          hideWithControlsTimer: 0.1,
          showPopupControlBar: false,
          popupControllerButtons: ["advance", "rewind"]
        })
      ])
    );
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
