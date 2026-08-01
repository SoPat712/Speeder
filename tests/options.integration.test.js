import {
  createChromeMock,
  flushAsyncWork,
  loadHtml,
  loadScript,
  triggerDomContentLoaded
} from "./helpers/browser.js";

async function setupOptions(overrides = {}) {
  loadHtml("extension/options/options.html");
  globalThis.chrome = createChromeMock(overrides);
  window.chrome = globalThis.chrome;
  globalThis.fetch = vi.fn();
  loadScript("extension/shared/controller-utils.js");
  loadScript("extension/shared/key-bindings.js");
  loadScript("extension/shared/settings-core.js");
  loadScript("extension/shared/popup-controls.js");
  loadScript("extension/shared/ui-icons.js");
  loadScript("extension/options/lucide-client.js");
  loadScript("extension/options/options.js");
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
        showAmbientLoopControls: true,
        enabled: false,
        shortcutTargetMode: "all",
        subtitleNudgeEnabledByDefault: false,
        popupMatchHoverControls: false,
        popupControllerButtons: ["rewind", "settings", "advance", "advance"],
        keyBindings: [
          { action: "display", code: "KeyV", value: 0, predefined: true },
          { action: "pause", code: "KeyQ", value: 0, predefined: false }
        ],
        siteRules: [
          {
            title: "YouTube testing",
            pattern: "youtube.com",
            enabled: true,
            shortcutTargetMode: "all",
            preferredSpeed: 2.4,
            showAmbientLoopControls: false,
            subtitleNudgeEnabledByDefault: false,
            showPopupControlBar: false,
            popupControllerButtons: ["advance", "settings", "advance"]
          }
        ]
      }
    });

    expect(document.getElementById("app-version").textContent).toBe("5.1.7.0");
    expect(document.getElementById("rememberSpeed").checked).toBe(true);
    expect(document.getElementById("showAmbientLoopControls").checked).toBe(true);
    expect(document.getElementById("enabled").checked).toBe(false);
    expect(document.getElementById("shortcutTargetMode").value).toBe("all");
    expect(document.getElementById("subtitleNudgeEnabledByDefault").checked).toBe(
      false
    );
    expect(document.querySelector('.shortcut-row[data-action="pause"]')).not.toBe(
      null
    );
    expect(document.getElementById("siteRulesContainer").children.length).toBe(
      1
    );
    expect(document.querySelector(".site-rule .override-subtitleNudge").checked).toBe(
      true
    );
    expect(document.querySelector(".site-rule .site-preferredSpeed").value).toBe(
      "2.4"
    );
    expect(
      document.querySelector(".site-rule .site-showAmbientLoopControls").checked
    ).toBe(false);
    expect(
      document.querySelector(".site-rule .site-shortcutTargetMode").value
    ).toBe("all");
    expect(document.querySelector(".site-rule .site-title").value).toBe(
      "YouTube testing"
    );
    expect(
      document.querySelector(".site-rule .site-subtitleNudgeEnabledByDefault")
        .checked
    ).toBe(false);
    expect(globalThis.getPopupControlBarOrder()).toEqual(["rewind", "advance"]);
  });

  it("reorders and toggles control-bar buttons from the keyboard", async () => {
    await setupOptions({
      sync: { controllerButtons: ["rewind", "faster"] }
    });
    const active = document.getElementById("controlBarActive");
    const rewind = active.querySelector('[data-button-id="rewind"]');

    rewind.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true
      })
    );
    expect(globalThis.getControlBarOrder()).toEqual(["faster", "rewind"]);

    expect(rewind.disabled).toBe(false);
    rewind.click();
    expect(globalThis.getControlBarOrder()).toEqual(["faster"]);
    expect(rewind.closest(".cb-available-zone")).not.toBeNull();
    expect(rewind.getAttribute("aria-label")).toContain("available");
  });

  it("labels shortcut and generated site-rule controls", async () => {
    await setupOptions();
    expect(
      document.querySelector('#display .customKey').getAttribute("aria-label")
    ).toBe("Show/hide controller key");

    globalThis.createSiteRule(null);
    const rule = document.querySelector(".site-rule");
    const location = rule.querySelector(".site-controllerLocation");
    const locationLabel = location.closest(".site-rule-option").querySelector("label");
    expect(location.id).not.toBe("");
    expect(locationLabel.htmlFor).toBe(location.id);
    expect(
      rule.querySelector(".site-controllerMarginTop").getAttribute("aria-label")
    ).toBe("Controller margin top");
    expect(
      rule.querySelector(".remove-site-rule").getAttribute("aria-label")
    ).toBe("Remove site rule");
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

  it("adds and restores duplicate actions with Shift bindings", async () => {
    const chrome = await setupOptions();
    const selector = document.getElementById("addShortcutSelector");
    expect(selector.querySelector('option[value="rewind"]')).not.toBeNull();

    selector.value = "rewind";
    selector.dispatchEvent(new window.Event("change", { bubbles: true }));
    const duplicate = document.querySelector(
      '.shortcut-row.customs[data-action="rewind"]'
    );
    duplicate.querySelector(".customKey").dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "Z",
        code: "KeyZ",
        shiftKey: true,
        bubbles: true
      })
    );
    duplicate.querySelector(".customValue").value = "3";

    globalThis.save_options();
    expect(
      chrome.storage.sync.__state.keyBindings.filter(
        (binding) => binding.action === "rewind"
      )
    ).toEqual([
      expect.objectContaining({ value: 10, shiftKey: false }),
      expect.objectContaining({ value: 3, shiftKey: true })
    ]);

    globalThis.restore_options();
    await flushAsyncWork();
    expect(
      document.querySelectorAll('.shortcut-row[data-action="rewind"]')
    ).toHaveLength(2);
    expect(
      document.querySelector(
        '.shortcut-row.customs[data-action="rewind"] .customKey'
      ).value
    ).toBe("Shift+Z");
  });

  it("shows a more-menu trigger for collapsed site rules and a collapse trigger when open", async () => {
    await setupOptions({ sync: { siteRules: [] } });

    globalThis.createSiteRule({ pattern: "youtube.com" });

    const rule = document.getElementById("siteRulesContainer").lastElementChild;
    const toggle = rule.querySelector(".toggle-site-rule");
    const body = rule.querySelector(".site-rule-body");

    expect(rule.classList.contains("collapsed")).toBe(true);
    expect(body.style.display).toBe("none");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Expand site rule");
    expect(toggle.querySelector("svg")).not.toBeNull();

    globalThis.setSiteRuleExpandedState(rule, true);

    expect(rule.classList.contains("collapsed")).toBe(false);
    expect(body.style.display).toBe("block");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Collapse site rule");
  });

  it("site rule shortcut override shows no rows by default and adds via selector", async () => {
    await setupOptions({ sync: { siteRules: [] } });

    globalThis.createSiteRule({ pattern: "example.com" });
    const rule = document.getElementById("siteRulesContainer").lastElementChild;
    const rows = rule.querySelector(".site-shortcuts-rows");
    const selector = rule.querySelector(".site-add-shortcut-selector");

    expect(rows.querySelectorAll(".shortcut-row").length).toBe(0);
    expect(selector).not.toBeNull();
    expect(selector.disabled).toBe(true);

    rule.querySelector(".override-shortcuts").checked = true;
    rule.querySelector(".override-shortcuts").dispatchEvent(
      new Event("change", { bubbles: true })
    );

    expect(selector.disabled).toBe(false);
    expect(selector.options.length).toBeGreaterThan(1);

    selector.value = "pause";
    selector.dispatchEvent(new Event("change", { bubbles: true }));

    expect(rows.querySelectorAll('.shortcut-row[data-action="pause"]').length).toBe(1);
  });

  it("keeps site override settings visible but disabled until enabled", async () => {
    await setupOptions({ sync: { siteRules: [] } });

    globalThis.createSiteRule({ pattern: "youtube.com" });

    const rule = document.getElementById("siteRulesContainer").lastElementChild;
    const playbackOverride = rule.querySelector(".override-playback");
    const playbackContainer = rule.querySelector(".site-playback-container");
    const rememberSpeed = rule.querySelector(".site-rememberSpeed");

    expect(playbackContainer.classList.contains("site-override-disabled")).toBe(
      true
    );
    expect(rememberSpeed.disabled).toBe(true);

    playbackOverride.checked = true;
    playbackOverride.dispatchEvent(
      new Event("change", {
        bubbles: true
      })
    );

    expect(playbackContainer.classList.contains("site-override-disabled")).toBe(
      false
    );
    expect(rememberSpeed.disabled).toBe(false);
  });

  it("saves normalized settings and sanitized popup/site-rule controls", async () => {
    const chrome = await setupOptions();

    document.getElementById("rememberSpeed").checked = true;
    document.getElementById("showAmbientLoopControls").checked = true;
    document.getElementById("hideWithControlsTimer").value = "20";
    document.getElementById("controllerOpacity").value = "0";
    document.getElementById("controllerMarginTop").value = "250";
    document.getElementById("controllerMarginBottom").value = "-4";
    document.getElementById("enableSubtitleNudge").checked = true;
    document.getElementById("subtitleNudgeEnabledByDefault").checked = false;
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
    rule.querySelector(".site-title").value = "My YouTube rule";
    rule.querySelector(".site-pattern").value = "youtube.com";
    rule.querySelector(".override-playback").checked = true;
    rule.querySelector(".site-rememberSpeed").checked = true;
    rule.querySelector(".site-showAmbientLoopControls").checked = false;
    rule.querySelector(".site-preferredSpeed").value = "2.4";
    rule.querySelector(".override-shortcut-target").checked = true;
    rule.querySelector(".site-shortcutTargetMode").value = "all";
    rule.querySelector(".override-opacity").checked = true;
    rule.querySelector(".site-controllerOpacity").value = "0";
    rule.querySelector(".override-subtitleNudge").checked = true;
    rule.querySelector(".site-enableSubtitleNudge").checked = true;
    rule.querySelector(".site-subtitleNudgeEnabledByDefault").checked = false;
    rule.querySelector(".site-subtitleNudgeInterval").value = "75";
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

    const savedSettings = globalThis.vscExpandStoredSettings(
      chrome.storage.sync.__state
    );

    expect(savedSettings.rememberSpeed).toBe(true);
    expect(savedSettings.showAmbientLoopControls).toBe(true);
    expect(savedSettings.hideWithControlsTimer).toBe(15);
    expect(savedSettings.controllerOpacity).toBe(0);
    expect(savedSettings.controllerMarginTop).toBe(200);
    expect(savedSettings.controllerMarginBottom).toBe(0);
    expect(savedSettings.subtitleNudgeEnabledByDefault).toBe(false);
    expect(savedSettings.subtitleNudgeInterval).toBe(250);
    expect(savedSettings.showPopupControlBar).toBe(false);
    expect(savedSettings.popupMatchHoverControls).toBe(false);
    expect(savedSettings.popupControllerButtons).toEqual(["rewind", "faster"]);
    expect(savedSettings.siteRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
        title: "My YouTube rule",
        pattern: "youtube.com",
        rememberSpeed: true,
        showAmbientLoopControls: false,
        shortcutTargetMode: "all",
        preferredSpeed: 2.4,
        controllerOpacity: 0,
        enableSubtitleNudge: true,
        subtitleNudgeEnabledByDefault: false,
        subtitleNudgeInterval: 250,
        showPopupControlBar: false,
        popupControllerButtons: ["advance"]
      })
      ])
    );
  });

  it("restores managed defaults and clears private local UI/runtime data", async () => {
    const chrome = await setupOptions({
      sync: {
        rememberSpeed: true,
        siteRules: [],
        lastSpeed: 1.6,
        futureRuntimeValue: "keep"
      },
      local: {
        customButtonIcons: { faster: { slug: "rocket" } },
        rememberedSpeeds: { "https://example.com/video.mp4": 1.75 },
        unrelatedLocalValue: "keep"
      }
    });

    globalThis.restore_defaults();
    await flushAsyncWork();

    const raw = chrome.storage.sync.__state;
    const restored = globalThis.vscExpandStoredSettings(raw);
    expect(restored.rememberSpeed).toBe(false);
    expect(restored.siteRules).toEqual(
      globalThis.vscGetSettingsDefaults().siteRules
    );
    expect(raw.lastSpeed).toBe(1);
    expect(raw.futureRuntimeValue).toBe("keep");
    expect(chrome.storage.local.__state.customButtonIcons).toBeUndefined();
    expect(chrome.storage.local.__state.rememberedSpeeds).toBeUndefined();
    expect(
      chrome.storage.local.__state.rememberedSpeedsResetAt
    ).toEqual(expect.any(Number));
    expect(chrome.storage.local.__state.unrelatedLocalValue).toBe("keep");
  });
});
