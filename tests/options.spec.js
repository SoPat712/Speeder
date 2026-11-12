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
  evaluateScript("extension/shared/site-rules.js");
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
    expect(document.querySelector(".site-rule .site-enabled-mode").value).toBe("off");
  });

  it("seeds site-rule button editors from the stored global bars on load", async () => {
    vi.useFakeTimers();
    const chrome = bootOptions({
      syncData: {
        controllerButtons: ["rewind", "fast", "display"],
        popupMatchHoverControls: false,
        popupControllerButtons: ["advance", "pause"],
        siteRules: [
          { pattern: "popup-only.test", showPopupControlBar: false },
          { pattern: "plain.test", rememberSpeed: true }
        ]
      }
    });
    await flushAsyncWork(3);

    const ruleFor = (pattern) =>
      Array.from(document.querySelectorAll(".site-rule")).find(
        (el) => el.querySelector(".site-pattern").value === pattern
      );
    const order = (zone) =>
      Array.from(zone.querySelectorAll(".cb-block")).map((b) => b.dataset.buttonId);

    const popupOnly = ruleFor("popup-only.test");
    expect(order(popupOnly.querySelector(".site-popup-cb-active"))).toEqual([
      "advance",
      "pause"
    ]);
    const plain = ruleFor("plain.test");
    expect(order(plain.querySelector(".site-cb-active"))).toEqual([
      "rewind",
      "fast",
      "display"
    ]);

    // Turning on the hover override and autosaving must not store an empty bar.
    const override = plain.querySelector(".override-controlbar");
    override.checked = true;
    override.dispatchEvent(new window.Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(400);

    const saved = window.vscExpandStoredSettings(chrome.storage.sync._dump());
    const savedRule = (pattern) =>
      saved.siteRules.find((rule) => rule.pattern === pattern);
    expect(savedRule("plain.test").controllerButtons).toEqual([
      "rewind",
      "fast",
      "display"
    ]);
    expect(savedRule("popup-only.test").popupControllerButtons).toEqual([
      "advance",
      "pause"
    ]);
  });

  it("reloads on external storage changes and ignores its own saves", async () => {
    vi.useFakeTimers();
    const chrome = bootOptions({ syncData: { rememberSpeed: true } });
    await flushAsyncWork(3);
    const restoreSpy = vi.spyOn(chrome.storage.sync, "get");

    // Own autosave: no reload, and the saved value stays.
    const remember = document.getElementById("rememberSpeed");
    remember.checked = false;
    remember.dispatchEvent(new window.Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(400);
    expect(chrome.storage.sync._dump().rememberSpeed).toBeUndefined();
    const readsAfterSave = restoreSpy.mock.calls.length;

    // Runtime-only writes (lastSpeed) are not settings edits.
    chrome.storage.sync.set({ lastSpeed: 1.5 });
    expect(restoreSpy.mock.calls.length).toBe(readsAfterSave);

    // The popup disables Speeder: the page reloads instead of reverting it.
    const ruleEl = document.querySelector(".site-rule");
    window.setSiteRuleExpandedState(ruleEl, true);
    chrome.storage.sync.set({ enabled: false });
    expect(document.getElementById("enabled").checked).toBe(false);
    expect(document.getElementById("externalChangeNotice").hidden).toBe(true);
    expect(
      document.querySelector(".site-rule").classList.contains("collapsed")
    ).toBe(false);

    // A later local edit must not resurrect the old value.
    document.getElementById("audioBoolean").checked = true;
    document
      .getElementById("audioBoolean")
      .dispatchEvent(new window.Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(400);
    const saved = window.vscExpandStoredSettings(chrome.storage.sync._dump());
    expect(saved.enabled).toBe(false);
    expect(saved.audioBoolean).toBe(true);
  });

  it("asks before replacing pending local edits with external changes", async () => {
    vi.useFakeTimers();
    const chrome = bootOptions();
    await flushAsyncWork(3);

    // An unsaved edit: the invalid regex blocks autosave.
    window.createSiteRule({ pattern: "ok.test" });
    const rules = document.querySelectorAll(".site-rule");
    const pattern = rules[rules.length - 1].querySelector(".site-pattern");
    pattern.value = "/[bad/";
    pattern.dispatchEvent(new window.Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(400);

    chrome.storage.sync.set({ enabled: false });
    const notice = document.getElementById("externalChangeNotice");
    expect(notice.hidden).toBe(false);
    expect(document.getElementById("enabled").checked).toBe(true);
    expect(pattern.isConnected).toBe(true);

    // Autosave stays paused while the notice is up.
    document.getElementById("audioBoolean").checked = true;
    document
      .getElementById("audioBoolean")
      .dispatchEvent(new window.Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(400);
    expect(chrome.storage.sync._dump().audioBoolean).toBeUndefined();

    document.getElementById("externalChangeReload").click();
    expect(notice.hidden).toBe(true);
    expect(document.getElementById("enabled").checked).toBe(false);
    expect(document.getElementById("audioBoolean").checked).toBe(false);
    expect(pattern.isConnected).toBe(false);

    // Keeping local edits saves them over the external change.
    document.getElementById("rememberSpeed").checked = true;
    document.getElementById("rememberSpeed").focus();
    chrome.storage.sync.set({ forceLastSavedSpeed: true });
    expect(notice.hidden).toBe(true);
    const text = document.getElementById("hideWithControlsTimer");
    text.focus();
    chrome.storage.sync.set({ startHidden: true });
    expect(notice.hidden).toBe(false);
    document.getElementById("startHidden").checked = false;
    document.getElementById("externalChangeKeep").click();
    expect(notice.hidden).toBe(true);
    const kept = window.vscExpandStoredSettings(chrome.storage.sync._dump());
    expect(kept.startHidden).toBe(false);
    expect(kept.enabled).toBe(false);
  });

  it("reveals the site rule the popup asked for", async () => {
    const chrome = bootOptions({
      syncData: { siteRules: [{ pattern: "https://a.test" }] },
      localData: { optionsIntent: { siteRulePattern: "https://a.test" } }
    });
    await flushAsyncWork(3);

    const ruleFor = (value) =>
      Array.from(document.querySelectorAll(".site-rule")).find(
        (el) => el.querySelector(".site-pattern").value === value
      );
    expect(ruleFor("https://a.test").classList.contains("collapsed")).toBe(false);
    expect(chrome.storage.local._dump()).not.toHaveProperty("optionsIntent");

    // Already open: the new rule arrives through sync, the intent through local.
    const raw = chrome.storage.sync._dump();
    const settings = window.vscExpandStoredSettings(raw);
    settings.siteRules.push({ pattern: "https://b.test" });
    const mutation = window.vscBuildManagedStorageMutation(raw, settings);
    chrome.storage.sync.set(mutation.set);
    chrome.storage.local.set({ optionsIntent: { siteRulePattern: "https://b.test" } });
    expect(ruleFor("https://b.test").classList.contains("collapsed")).toBe(false);
    expect(chrome.storage.local._dump()).not.toHaveProperty("optionsIntent");
  });

  it("restores and saves the tri-state site enable mode", async () => {
    const chrome = bootOptions({
      syncData: {
        enabled: false,
        siteRulesFormat: "defaults-diff-v2",
        siteRulesMeta: { enabledTriState: true },
        siteRules: [
          { pattern: "on.test", enabled: true },
          { pattern: "off.test", enabled: false },
          { pattern: "follow.test" },
          { pattern: "legacy-off.test", disableExtension: true }
        ]
      }
    });
    await flushAsyncWork(3);

    const modeFor = (pattern) =>
      Array.from(document.querySelectorAll(".site-rule"))
        .find((el) => el.querySelector(".site-pattern").value === pattern)
        .querySelector(".site-enabled-mode");
    expect(modeFor("on.test").value).toBe("on");
    expect(modeFor("off.test").value).toBe("off");
    expect(modeFor("follow.test").value).toBe("inherit");
    expect(modeFor("legacy-off.test").value).toBe("off");
    expect(
      modeFor("off.test").closest(".site-rule").querySelector(".site-rule-content")
        .classList.contains("disabled-rule")
    ).toBe(true);
    // Built-in rules follow the global switch by default.
    expect(
      modeFor(window.vscGetSettingsDefaults().siteRules[0].pattern).value
    ).toBe("inherit");

    window.createSiteRule(null);
    const newRule = document.querySelectorAll(".site-rule");
    expect(newRule[newRule.length - 1].querySelector(".site-enabled-mode").value).toBe(
      "inherit"
    );

    modeFor("on.test").value = "inherit";
    modeFor("follow.test").value = "off";
    modeFor("off.test").value = "on";
    window.save_options();

    const enabledByPattern = Object.fromEntries(
      window.vscExpandStoredSettings(chrome.storage.sync._dump()).siteRules.map(
        (rule) => [rule.pattern, rule.enabled]
      )
    );
    expect(enabledByPattern).toEqual(
      expect.objectContaining({
        "on.test": undefined,
        "off.test": true,
        "follow.test": false,
        "legacy-off.test": false
      })
    );
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

  it("flags shortcuts that share a key until the clash is fixed", async () => {
    bootOptions();
    await flushAsyncWork(3);

    const row = (action) =>
      document.querySelector('#customs .shortcut-row[data-action="' + action + '"]');
    const press = (action, init) =>
      row(action).querySelector(".customKey").dispatchEvent(
        new window.KeyboardEvent("keydown", Object.assign({ bubbles: true }, init))
      );

    // Increase speed defaults to D.
    press("reset", { key: "d", code: "KeyD" });
    expect(row("reset").classList.contains("shortcut-conflict")).toBe(true);
    expect(row("faster").classList.contains("shortcut-conflict")).toBe(true);
    expect(row("reset").querySelector(".shortcut-conflict-note").textContent).toBe(
      "Same key as Increase speed. Only one will work."
    );
    const keyInput = row("faster").querySelector(".customKey");
    expect(keyInput.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(keyInput.getAttribute("aria-describedby")).textContent)
      .toContain("Reset speed");

    // Shift+D is a separate key.
    press("reset", { key: "D", code: "KeyD", shiftKey: true });
    expect(document.querySelector(".shortcut-conflict")).toBeNull();
    expect(document.querySelector(".shortcut-conflict-note")).toBeNull();
    expect(keyInput.hasAttribute("aria-invalid")).toBe(false);

    press("reset", { key: "d", code: "KeyD" });
    expect(row("faster").classList.contains("shortcut-conflict")).toBe(true);
    press("reset", { key: "Escape", code: "Escape" });
    expect(document.querySelector(".shortcut-conflict")).toBeNull();
  });

  it("flags stored duplicate shortcuts on load and clears them when a row is removed", async () => {
    bootOptions({
      syncData: {
        keyBindings: [
          { action: "slower", code: "KeyS", value: 0.1 },
          { action: "faster", code: "KeyD", value: 0.1 },
          { action: "fast", code: "KeyG", value: 1.8 },
          { action: "fast", code: "KeyG", value: 2.5 }
        ]
      }
    });
    await flushAsyncWork(3);

    const fastRows = document.querySelectorAll('#customs .shortcut-row[data-action="fast"]');
    expect(fastRows).toHaveLength(2);
    fastRows.forEach((fastRow) => {
      expect(fastRow.classList.contains("shortcut-conflict")).toBe(true);
      expect(fastRow.querySelector(".shortcut-conflict-note").textContent).toBe(
        "Same key as Preferred speed. Only one will work."
      );
    });

    fastRows[1].querySelector(".removeParent").click();
    expect(document.querySelector(".shortcut-conflict")).toBeNull();
  });

  it("checks site rule shortcuts only against the same rule", async () => {
    bootOptions();
    await flushAsyncWork(3);
    window.createSiteRule({
      pattern: "example.org",
      shortcuts: [
        { action: "rewind", code: "KeyD", value: 10, disabled: false },
        { action: "advance", code: "KeyD", value: 10, disabled: false },
        { action: "slower", code: "KeyS", value: 0.1, disabled: false }
      ]
    });
    const rule = document.getElementById("siteRulesContainer").lastElementChild;
    const siteRow = (action) =>
      rule.querySelector('.site-shortcuts-rows .shortcut-row[data-action="' + action + '"]');

    expect(siteRow("rewind").classList.contains("shortcut-conflict")).toBe(true);
    expect(siteRow("advance").classList.contains("shortcut-conflict")).toBe(true);
    // D is also the global Increase speed key, but the site rule replaces it there.
    expect(siteRow("slower").classList.contains("shortcut-conflict")).toBe(false);
    expect(
      document.querySelector('#customs .shortcut-row[data-action="faster"]')
        .classList.contains("shortcut-conflict")
    ).toBe(false);

    const override = rule.querySelector(".override-shortcuts");
    override.checked = false;
    override.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(rule.querySelector(".shortcut-conflict")).toBeNull();
  });
});
