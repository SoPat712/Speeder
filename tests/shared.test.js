import controllerUtils from "../extension/shared/controller-utils.js";
import importExportUtils from "../extension/shared/import-export.js";
import keyBindingUtils from "../extension/shared/key-bindings.js";
import popupControls from "../extension/shared/popup-controls.js";
import siteRules from "../extension/shared/site-rules.js";

describe("shared helpers", () => {
  it("matches site rules and skips invalid regex patterns", () => {
    const literalRule = { pattern: "example.com/watch" };
    const regexRule = { pattern: "/youtube\\.com\\/watch/i" };

    expect(
      siteRules.matchSiteRule("https://example.com/watch?v=1", [literalRule])
    ).toBe(literalRule);
    expect(
      siteRules.matchSiteRule("https://www.youtube.com/watch?v=2", [regexRule])
    ).toBe(regexRule);
    expect(
      siteRules.matchSiteRule("https://www.youtube.com/shorts/3", [
        { pattern: "/(/" },
        regexRule
      ])
    ).toBeNull();
    expect(siteRules.isSiteRuleDisabled({ enabled: false })).toBe(true);
    expect(siteRules.compileSiteRulePattern("/youtube")).toBeNull();
    expect(
      siteRules.siteRuleMatchesUrl(
        { pattern: "/youtube" },
        "https://youtube.com/watch"
      )
    ).toBe(false);
  });

  it("matches plain and regex rules against safely decoded URL text", () => {
    expect(
      siteRules.siteRuleMatchesUrl(
        { pattern: "example.com/path?title=Hello World#part one" },
        "https://example.com/%70ath?title=Hello%20World#part%20one"
      )
    ).toBe(true);
    expect(
      siteRules.siteRuleMatchesUrl(
        { pattern: "/example\\.com\\/path\\?title=Hello World#part one/i" },
        "https://example.com/%70ath?title=Hello%20World#part%20one"
      )
    ).toBe(true);

    // Raw matching remains available for rules intentionally written against
    // the encoded form.
    expect(
      siteRules.siteRuleMatchesUrl(
        { pattern: "/%70ath\\?title=Hello%20World/" },
        "https://example.com/%70ath?title=Hello%20World"
      )
    ).toBe(true);
  });

  it("tolerates malformed URL escapes and keeps regex matching deterministic", () => {
    expect(siteRules.safelyDecodeUrlText("/%70%ZZ%E2/end")).toBe(
      "/p%ZZ%E2/end"
    );
    expect(siteRules.safelyDecodeUrlText("/%E2%82%AC%FF%70")).toBe(
      "/€%FFp"
    );
    expect(
      siteRules.siteRuleMatchesUrl(
        { pattern: "/example\\.com\\/p%ZZ%E2/" },
        "https://example.com/%70%ZZ%E2"
      )
    ).toBe(true);

    const globalRule = { pattern: "/example\\.com\\/watch/g" };
    expect(
      siteRules.siteRuleMatchesUrl(globalRule, "https://example.com/watch")
    ).toBe(true);
    expect(
      siteRules.siteRuleMatchesUrl(globalRule, "https://example.com/watch")
    ).toBe(true);
  });

  it("combines global enabled with matched site rules (whitelist / blacklist)", () => {
    const allowSite = { pattern: "good.test", enabled: true };
    const blockSite = { pattern: "bad.test", enabled: false };

    expect(siteRules.isSpeederActiveForSite(true, null)).toBe(true);
    expect(siteRules.isSpeederActiveForSite(false, null)).toBe(false);

    expect(siteRules.isSpeederActiveForSite(true, blockSite)).toBe(false);
    expect(siteRules.isSpeederActiveForSite(false, blockSite)).toBe(false);

    expect(siteRules.isSpeederActiveForSite(true, allowSite)).toBe(true);
    expect(siteRules.isSpeederActiveForSite(false, allowSite)).toBe(true);
  });

  it("sanitizes and resolves popup button orders", () => {
    const controllerButtonDefs = {
      rewind: {},
      faster: {},
      advance: {},
      display: {},
      settings: {}
    };

    expect(
      popupControls.sanitizeButtonOrder(
        ["rewind", "settings", "rewind", "faster", "missing"],
        controllerButtonDefs,
        new Set(["settings"])
      )
    ).toEqual(["rewind", "faster"]);

    expect(
      popupControls.resolvePopupButtons(
        {
          popupMatchHoverControls: true,
          controllerButtons: ["advance", "display"],
          popupControllerButtons: ["rewind"]
        },
        { controllerButtons: ["faster", "advance"] },
        {
          controllerButtonDefs,
          defaultButtons: ["rewind", "display"],
          excludedIds: ["settings"]
        }
      )
    ).toEqual(["faster", "advance"]);

    expect(
      popupControls.resolvePopupButtons(
        {
          popupMatchHoverControls: false,
          popupControllerButtons: ["rewind", "display"]
        },
        { popupControllerButtons: ["advance", "settings", "advance"] },
        {
          controllerButtonDefs,
          defaultButtons: ["rewind", "display"],
          excludedIds: ["settings"]
        }
      )
    ).toEqual(["advance"]);
  });

  it("keeps the selected frame token with the displayed popup speed", () => {
    expect(
      popupControls.pickBestFrameSpeedResult([
        { speed: 1.25, frameToken: "background", preferred: false },
        { speed: 1.75, frameToken: "playing", preferred: true }
      ])
    ).toEqual({ speed: 1.75, frameToken: "playing" });
  });

  it("normalizes controller locations and margins", () => {
    expect(controllerUtils.normalizeControllerLocation("top-right")).toBe(
      "top-right"
    );
    expect(controllerUtils.normalizeControllerLocation("bogus")).toBe(
      controllerUtils.defaultControllerLocation
    );
    expect(controllerUtils.clampControllerMarginPx(300, 65)).toBe(200);
    expect(controllerUtils.clampControllerMarginPx(-5, 65)).toBe(0);
    expect(controllerUtils.getNextControllerLocation("top-left")).toBe(
      "top-center"
    );
  });

  it("infers key binding codes from legacy formats", () => {
    expect(keyBindingUtils.normalizeBindingKey("a")).toBe("A");
    expect(keyBindingUtils.normalizeBindingKey("Esc")).toBe("Escape");
    expect(keyBindingUtils.legacyBindingKeyToCode(" ")).toBe("Space");
    expect(keyBindingUtils.legacyKeyCodeToCode(90)).toBe("KeyZ");
    expect(keyBindingUtils.inferBindingCode({ key: "x" }, null)).toBe("KeyX");
    expect(keyBindingUtils.inferBindingCode({ keyCode: 107 }, null)).toBe(
      "NumpadAdd"
    );
    expect(keyBindingUtils.getLegacyKeyCode({ key: 65 })).toBe(65);
    expect(keyBindingUtils.getActionValueError("fast", 0.1)).toBeNull();
    expect(keyBindingUtils.getActionValueError("fast", 16)).toBeNull();
    expect(keyBindingUtils.getActionValueError("fast", 0.099)).toContain(
      "between 0.1 and 16"
    );
    expect(keyBindingUtils.getActionValueError("fast", 16.001)).toContain(
      "between 0.1 and 16"
    );
  });

  it("builds and parses import/export payloads", () => {
    expect(
      importExportUtils.generateBackupFilename(new Date(2026, 3, 4, 8, 9, 10))
    ).toBe("speeder-backup_2026-04-04_08.09.10.json");

    expect(
      importExportUtils.buildBackupPayload(
        { rememberSpeed: true },
        { customButtonIcons: {} },
        "2026-04-04T08:09:10Z"
      )
    ).toEqual({
      version: "1.1",
      exportDate: "2026-04-04T08:09:10.000Z",
      settings: { rememberSpeed: true },
      localSettings: { customButtonIcons: {} }
    });

    expect(
      importExportUtils.extractImportSettings({
        settings: { rememberSpeed: true },
        localSettings: { customButtonIcons: {} }
      })
    ).toEqual({
      isWrappedBackup: true,
      settings: { rememberSpeed: true },
      localSettings: { customButtonIcons: {} }
    });

    expect(
      importExportUtils.parseImportText(
        JSON.stringify({ rememberSpeed: true, keyBindings: [] })
      )
    ).toEqual({
      isWrappedBackup: false,
      settings: { rememberSpeed: true, keyBindings: [] },
      localSettings: null
    });

    expect(
      importExportUtils.extractImportSettings({
        subtitleNudgeEnabledByDefault: false
      })
    ).toEqual({
      isWrappedBackup: false,
      settings: { subtitleNudgeEnabledByDefault: false },
      localSettings: null
    });

    expect(
      importExportUtils.extractImportSettings({ enabled: true })
    ).toEqual({
      isWrappedBackup: false,
      settings: { enabled: true },
      localSettings: null
    });

    expect(importExportUtils.isRecognizedRawSettingsObject({ wat: true })).toBe(
      false
    );
    expect(
      importExportUtils.isRecognizedRawSettingsObject({
        siteRulesFormat: "defaults-diff-v2"
      })
    ).toBe(true);
    expect(
      importExportUtils.extractImportSettings({ settings: [] })
    ).toBeNull();
    expect(
      importExportUtils.extractImportSettings({
        settings: { enabled: true },
        localSettings: []
      })
    ).toBeNull();
    [null, "bad", []].forEach((customButtonIcons) => {
      expect(
        importExportUtils.extractImportSettings({
          settings: { enabled: true },
          localSettings: { customButtonIcons }
        })
      ).toBeNull();
    });

    expect(
      importExportUtils.filterLocalSettingsForExport({
        customButtonIcons: { faster: { slug: "zap" } },
        lucideTagsCacheV1: { "a-arrow-down": ["letter"] },
        lucideTagsCacheV1At: 123,
        rememberedSpeeds: { "https://example.com/video.mp4": 1.75 },
        futureRuntimeData: true
      })
    ).toEqual({
      customButtonIcons: { faster: { slug: "zap" } }
    });
  });
});
