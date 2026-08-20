const {
  evaluateScript,
  loadHtmlString
} = require("./helpers/extension-test-utils");

function bootSettingsCore() {
  loadHtmlString("<!doctype html><html><head></head><body></body></html>");
  evaluateScript("extension/shared/settings-core.js");
  evaluateScript("extension/shared/site-rules.js");
}

function youtubeShortsRule(settings) {
  return settings.siteRules.find(function (rule) {
    return String(rule.pattern).includes("\\/shorts\\/");
  });
}

describe("canonical settings storage", () => {
  beforeEach(() => {
    bootSettingsCore();
  });

  it("expands missing settings to the built-in Shorts remember-speed rule", () => {
    const settings = window.vscExpandStoredSettings({});
    const shortsRule = youtubeShortsRule(settings);

    expect(shortsRule).toEqual(
      expect.objectContaining({
        title: "YouTube Shorts",
        enabled: true,
        rememberSpeed: true,
        controllerMarginTop: 60,
        controllerMarginBottom: 85
      })
    );
    expect(settings.shortcutTargetMode).toBe("closest");
    expect(settings.showAmbientLoopControls).toBe(false);
    expect(settings.subtitleNudgeInterval).toBe(250);
    expect(settings.siteRules[0].enableSubtitleNudge).toBeUndefined();
  });

  it("round-trips global and site-specific ambient-loop visibility", () => {
    const settings = window.vscExpandStoredSettings({
      showAmbientLoopControls: true,
      siteRules: [
        {
          pattern: "cnn.com",
          showAmbientLoopControls: false
        }
      ]
    });
    const restored = window.vscExpandStoredSettings(
      window.vscBuildStoredSettingsDiff(settings)
    );

    expect(restored.showAmbientLoopControls).toBe(true);
    expect(restored.siteRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pattern: "cnn.com",
          showAmbientLoopControls: false
        })
      ])
    );
  });

  it("round-trips global and site-specific shortcut targeting", () => {
    const settings = window.vscExpandStoredSettings({
      shortcutTargetMode: "all",
      siteRules: [
        {
          title: "One player at a time",
          pattern: "example.org",
          shortcutTargetMode: "closest"
        }
      ]
    });
    const stored = window.vscBuildStoredSettingsDiff(settings);
    const restored = window.vscExpandStoredSettings(stored);

    expect(restored.shortcutTargetMode).toBe("all");
    expect(restored.siteRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pattern: "example.org",
          shortcutTargetMode: "closest"
        })
      ])
    );
  });

  it("keeps every managed setting recognizable in legacy raw backups", () => {
    evaluateScript("extension/shared/import-export.js");
    const importExport = window.SpeederShared.importExport;

    window.vscGetManagedSyncKeys().forEach(function (key) {
      expect(importExport.isRecognizedRawSettingsObject({ [key]: null })).toBe(
        true
      );
    });
  });

  it("provides titles for built-in video rules and round-trips title edits sparsely", () => {
    const settings = window.vscExpandStoredSettings({});
    expect(settings.siteRules.map((rule) => rule.title)).toEqual([
      "YouTube videos",
      "YouTube Shorts",
      "YouTube Shorts (mobile)"
    ]);

    settings.siteRules[1].title = "Short-form videos";
    const stored = window.vscBuildStoredSettingsDiff(settings);
    expect(stored.siteRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pattern: settings.siteRules[1].pattern,
          title: "Short-form videos"
        })
      ])
    );
    expect(window.vscExpandStoredSettings(stored).siteRules[1].title).toBe(
      "Short-form videos"
    );
  });

  it("keeps an intentionally cleared built-in title cleared", () => {
    const settings = window.vscExpandStoredSettings({});
    const pattern = settings.siteRules[0].pattern;
    delete settings.siteRules[0].title;

    const stored = window.vscBuildStoredSettingsDiff(settings);
    const tombstone = stored.siteRulesMeta.removedDefaultRuleKeys.find(
      (entry) => entry.pattern === pattern
    );

    expect(tombstone.keys).toContain("title");
    expect(window.vscExpandStoredSettings(stored).siteRules[0]).not.toHaveProperty(
      "title"
    );
  });

  it("round-trips an intentionally empty site-rule list", () => {
    const expanded = window.vscExpandStoredSettings({ siteRules: [] });
    expect(expanded.siteRules).toEqual([]);

    const stored = window.vscBuildStoredSettingsDiff(expanded);
    expect(stored.siteRulesFormat).toBe("defaults-diff-v2");
    expect(stored.siteRules).toBeUndefined();
    expect(stored.siteRulesMeta.removedDefaultPatterns).toHaveLength(3);
    expect(window.vscExpandStoredSettings(stored).siteRules).toEqual([]);
  });

  it("keeps removals from built-in rules through sparse persistence", () => {
    const settings = window.vscExpandStoredSettings({});
    const shortsRule = youtubeShortsRule(settings);
    delete shortsRule.rememberSpeed;

    const stored = window.vscBuildStoredSettingsDiff(settings);
    const tombstone = stored.siteRulesMeta.removedDefaultRuleKeys.find(
      function (entry) {
        return entry.pattern === shortsRule.pattern;
      }
    );
    expect(tombstone.keys).toContain("rememberSpeed");

    const restoredRule = youtubeShortsRule(
      window.vscExpandStoredSettings(stored)
    );
    expect(restoredRule).not.toHaveProperty("rememberSpeed");
    expect(restoredRule.controllerMarginTop).toBe(60);
    expect(restoredRule.controllerMarginBottom).toBe(85);
  });

  it("expands legacy defaults-diff-v1 site-rule patches", () => {
    const defaults = window.vscGetSettingsDefaults();
    const shortsPattern = youtubeShortsRule(defaults).pattern;
    const settings = window.vscExpandStoredSettings({
      siteRulesFormat: "defaults-diff-v1",
      siteRules: [{ pattern: shortsPattern, controllerMarginTop: 72 }]
    });
    const shortsRule = youtubeShortsRule(settings);

    expect(shortsRule.rememberSpeed).toBe(true);
    expect(shortsRule.controllerMarginTop).toBe(72);
    expect(shortsRule.controllerMarginBottom).toBe(85);
  });

  it("migrates legacy shortcut, hide, and blacklist values", () => {
    const settings = window.vscExpandStoredSettings({
      speedStep: 0.25,
      rewindTime: 7,
      advanceTime: 14,
      fastSpeed: 2.25,
      displayKeyCode: 81,
      fasterKeyCode: 70,
      hideWithYouTubeControls: true,
      blacklist: "bad.test\nhttps://blocked.test/watch"
    });
    const bindings = Object.fromEntries(
      settings.keyBindings.map(function (binding) {
        return [binding.action, binding];
      })
    );

    expect(bindings.slower.value).toBe(0.25);
    expect(bindings.faster).toEqual(
      expect.objectContaining({ code: "KeyF", value: 0.25 })
    );
    expect(bindings.rewind.value).toBe(7);
    expect(bindings.advance.value).toBe(14);
    expect(bindings.fast.value).toBe(2.25);
    expect(bindings.display.code).toBe("KeyQ");
    expect(settings.hideWithControls).toBe(true);
    expect(settings.siteRules).toEqual(
      expect.arrayContaining([
        { pattern: "bad.test", enabled: false },
        { pattern: "https://blocked.test/watch", enabled: false }
      ])
    );
  });

  it("adds the mobile Shorts default to legacy full default-rule lists", () => {
    const defaults = window.vscGetSettingsDefaults();
    const legacyRules = defaults.siteRules.slice(0, 2).map(function(rule) {
      return Object.assign({}, rule, {
        forceLastSavedSpeed: false,
        audioBoolean: false
      });
    });

    const expanded = window.vscExpandStoredSettings({ siteRules: legacyRules });

    expect(
      expanded.siteRules.some(function(rule) {
        return String(rule.pattern).includes("m\\.youtube") &&
          rule.rememberSpeed === true;
      })
    ).toBe(true);
    expect(expanded.siteRules.map((rule) => rule.title)).toEqual([
      "YouTube videos",
      "YouTube Shorts",
      "YouTube Shorts (mobile)"
    ]);
  });

  it("normalizes imported rule types and unsafe numeric ranges", () => {
    const expanded = window.vscExpandStoredSettings({
      enabled: "false",
      siteRules: [
        {
          title: "  Example videos  ",
          pattern: "example.org",
          enabled: "false",
          rememberSpeed: "false",
          forceLastSavedSpeed: "true",
          controllerOpacity: 3,
          subtitleNudgeInterval: -5,
          preferredSpeed: 500
        }
      ]
    });
    const rule = expanded.siteRules[0];

    expect(expanded.enabled).toBe(false);
    expect(rule.title).toBe("Example videos");
    expect(rule.enabled).toBe(false);
    expect(rule.rememberSpeed).toBe(false);
    expect(rule.forceLastSavedSpeed).toBe(true);
    expect(rule.controllerOpacity).toBe(1);
    expect(rule.subtitleNudgeInterval).toBe(250);
    expect(rule.preferredSpeed).toBe(16);
  });

  it("falls back for null and blank numeric settings instead of coercing zero", () => {
    const expanded = window.vscExpandStoredSettings({
      lastSpeed: null,
      controllerMarginBottom: "   ",
      siteRules: [
        {
          pattern: "example.org",
          preferredSpeed: "",
          controllerMarginBottom: null
        }
      ]
    });

    expect(expanded.lastSpeed).toBe(1);
    expect(expanded.controllerMarginBottom).toBe(65);
    expect(expanded.siteRules[0].preferredSpeed).toBeUndefined();
    expect(expanded.siteRules[0].controllerMarginBottom).toBeUndefined();
  });

  it("repairs invalid imported shortcut values to safe action defaults", () => {
    const expanded = window.vscExpandStoredSettings({
      keyBindings: [
        { action: "faster", code: "KeyD", value: 0 },
        { action: "fast", code: "KeyG", value: "not-a-number" },
        { action: "rewind", code: "KeyZ", value: -2 }
      ]
    });

    expect(expanded.keyBindings.map((binding) => binding.value)).toEqual([
      0.1,
      1.8,
      10
    ]);
  });

  it("drops malformed primitive shortcut entries instead of crashing hydration", () => {
    expect(() =>
      window.vscExpandStoredSettings({
        keyBindings: [null, "bad", 7, { action: "faster", code: "KeyD", value: 0.2 }]
      })
    ).not.toThrow();

    expect(
      window.vscExpandStoredSettings({
        keyBindings: [null, "bad", { action: "faster", code: "KeyD", value: 0.2 }]
      }).keyBindings
    ).toEqual([
      expect.objectContaining({ action: "faster", value: 0.2 })
    ]);
  });

  it("removes stale managed keys without touching runtime or future data", () => {
    const raw = {
      rememberSpeed: true,
      speedStep: 0.2,
      lastSpeed: 1.75,
      futureRuntimeValue: { keep: true }
    };
    const settings = window.vscExpandStoredSettings(raw);
    settings.rememberSpeed = false;

    const mutation = window.vscBuildManagedStorageMutation(raw, settings);
    expect(mutation.remove).toEqual(
      expect.arrayContaining(["rememberSpeed", "speedStep"])
    );
    expect(mutation.remove).not.toContain("lastSpeed");
    expect(mutation.remove).not.toContain("futureRuntimeValue");
    expect(mutation.set.keyBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "faster", value: 0.2 })
      ])
    );
  });
});

describe("site-rule matching", () => {
  beforeEach(() => {
    bootSettingsCore();
  });

  it("merges all matches in order so a later specific rule wins", () => {
    const matched = window.vscMatchSiteRule(
      "https://www.youtube.com/shorts/abc",
      [
        {
          pattern: "youtube.com",
          enabled: false,
          rememberSpeed: false,
          controllerOpacity: 0.2
        },
        {
          pattern: "youtube.com/shorts",
          enabled: true,
          rememberSpeed: true
        }
      ]
    );

    expect(matched).toEqual(
      expect.objectContaining({
        enabled: true,
        rememberSpeed: true,
        controllerOpacity: 0.2
      })
    );
  });

  it("matches plain host patterns only on safe hostname boundaries", () => {
    const matcher = window.SpeederShared.siteRules;

    expect(
      matcher.plainSitePatternMatchesUrl(
        "example.com",
        "https://media.example.com/watch"
      )
    ).toBe(true);
    expect(
      matcher.plainSitePatternMatchesUrl(
        "example.com",
        "https://notexample.com/watch"
      )
    ).toBe(false);
    expect(
      matcher.plainSitePatternMatchesUrl(
        "example.com",
        "https://example.com.evil.test/watch"
      )
    ).toBe(false);
    expect(
      matcher.plainSitePatternMatchesUrl(
        "example.com",
        "https://safe.test/watch?next=example.com"
      )
    ).toBe(false);
  });
});
