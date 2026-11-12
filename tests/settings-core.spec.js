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
        rememberSpeed: true,
        controllerMarginTop: 60,
        controllerMarginBottom: 85
      })
    );
    expect(settings.siteRules.every((rule) => !("enabled" in rule))).toBe(true);
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

describe("shared button and action tables", () => {
  beforeEach(() => {
    bootSettingsCore();
    evaluateScript("extension/shared/ui-icons.js");
  });

  it("describes every button once, in UI order, with an icon", () => {
    const defs = window.vscGetButtonDefs();
    expect(Object.keys(defs)).toEqual(window.vscGetButtonIds());
    expect(Object.keys(defs).slice(0, 5)).toEqual(window.vscGetDefaultButtonIds());
    Object.keys(defs).forEach((id) => {
      expect(Object.keys(defs[id]).sort()).toEqual(
        ["className", "fallbackIcon", "name", "popupAllowed", "title"]
      );
      expect(defs[id].name).toBeTruthy();
      expect(defs[id].title).toBeTruthy();
      expect(window.vscIconSvgString(id, 16)).toBeTruthy();
    });
    expect(
      Object.keys(defs).filter((id) => !defs[id].popupAllowed)
    ).toEqual(["settings"]);
    expect(defs.display.title).toBe("Show or hide controller");
    expect(defs.fast.title).toBe("Toggle preferred speed");

    defs.rewind.name = "mutated";
    expect(window.vscGetButtonDefs().rewind.name).toBe("Rewind");
  });

  it("derives known actions, value defaults and popup filtering from the tables", () => {
    const actions = window.vscGetActionDefs();
    expect(
      Object.keys(actions).filter((action) => actions[action].hasValue)
    ).toEqual(["slower", "faster", "rewind", "advance", "fast", "louder", "softer"]);
    expect(window.vscSanitizeActionValue("fast", "bad")).toBe(1.8);
    expect(window.vscSanitizeActionValue("pause", "bad")).toBe(0);

    const expanded = window.vscExpandStoredSettings({
      keyBindings: ["display", "nudge", "settings", "blink", "drag", "toggleSubtitleNudge", "bogus"]
        .map((action) => ({ action: action, code: "KeyQ" })),
      popupControllerButtons: ["settings", "rewind", "bogus"],
      controllerButtons: ["settings", "rewind"]
    });
    expect(expanded.keyBindings.map((binding) => binding.action)).toEqual(
      ["display", "nudge", "settings", "blink", "drag", "toggleSubtitleNudge"]
    );
    expect(expanded.popupControllerButtons).toEqual(["rewind"]);
    expect(expanded.controllerButtons).toEqual(["settings", "rewind"]);
    expect(window.SpeederShared).toBeDefined();
  });
});

describe("tri-state site-rule enabled migration", () => {
  const YT = "/^https:\\/\\/(www\\.)?youtube\\.com\\/(?!shorts\\/).*/";
  const WATCH_URL = "https://www.youtube.com/watch?v=1";

  beforeEach(() => {
    bootSettingsCore();
  });

  function persist(raw, update) {
    const settings = window.vscExpandStoredSettings(raw);
    if (update) update(settings);
    const mutation = window.vscBuildManagedStorageMutation(raw, settings);
    const next = Object.assign({}, raw, mutation.set);
    mutation.remove.forEach((key) => delete next[key]);
    return next;
  }

  function activeOn(settings, url) {
    const siteRules = window.SpeederShared.siteRules;
    return siteRules.isSpeederActiveForSite(
      settings.enabled,
      siteRules.matchSiteRule(url, settings.siteRules)
    );
  }

  function expectStable(raw) {
    const once = persist(raw);
    const twice = persist(once);
    expect(window.vscExpandStoredSettings(twice)).toEqual(
      window.vscExpandStoredSettings(once)
    );
    expect(persist(twice)).toEqual(twice);
    // Writing the migrated rules must not change what they mean (legacy full
    // lists may be reordered built-ins first, as before).
    const byPattern = (rules) =>
      rules.slice().sort((a, b) => a.pattern.localeCompare(b.pattern));
    expect(byPattern(window.vscExpandStoredSettings(twice).siteRules)).toEqual(
      byPattern(window.vscExpandStoredSettings(raw).siteRules)
    );
    return once;
  }

  it("turns legacy whitelist entries into inherit rules while global Speeder is on", () => {
    const raw = {
      siteRulesFormat: "defaults-diff-v2",
      siteRules: [
        { pattern: YT, controllerOpacity: 0.5 },
        { pattern: "custom.test", enabled: true, rememberSpeed: true },
        { pattern: "blocked.test", enabled: false },
        { pattern: "legacy.test", disableExtension: false }
      ]
    };
    const expanded = window.vscExpandStoredSettings(raw);

    expect(expanded.siteRules.filter((rule) => rule.enabled === true)).toEqual([]);
    expect(expanded.siteRules.find((rule) => rule.pattern === YT)).toEqual({
      title: "YouTube videos",
      pattern: YT,
      controllerOpacity: 0.5
    });
    expect(
      expanded.siteRules.find((rule) => rule.pattern === "blocked.test").enabled
    ).toBe(false);

    const stored = expectStable(raw);
    expect(stored.siteRulesMeta).toEqual({ enabledTriState: true });
    expect(stored.siteRules).toEqual([
      { pattern: YT, controllerOpacity: 0.5 },
      { pattern: "custom.test", rememberSpeed: true },
      { pattern: "blocked.test", enabled: false },
      { pattern: "legacy.test" }
    ]);

    const disabled = persist(stored, (settings) => {
      settings.enabled = false;
    });
    const afterDisable = window.vscExpandStoredSettings(disabled);
    expect(activeOn(afterDisable, WATCH_URL)).toBe(false);
    expect(activeOn(afterDisable, "https://custom.test/")).toBe(false);
  });

  it("keeps legacy whitelist entries, including built-ins, while global Speeder is off", () => {
    const raw = {
      enabled: false,
      siteRulesFormat: "defaults-diff-v2",
      siteRules: [{ pattern: "custom.test", enabled: true }]
    };
    const expanded = window.vscExpandStoredSettings(raw);

    expect(expanded.siteRules.map((rule) => rule.enabled)).toEqual([
      true,
      true,
      true,
      true
    ]);
    expect(activeOn(expanded, WATCH_URL)).toBe(true);
    expect(activeOn(expanded, "https://custom.test/")).toBe(true);
    expect(activeOn(expanded, "https://other.test/")).toBe(false);

    const stored = expectStable(raw);
    expect(stored.siteRulesMeta).toEqual({ enabledTriState: true });
    expect(stored.siteRules).toEqual(
      expect.arrayContaining([
        { pattern: YT, enabled: true },
        { pattern: "custom.test", enabled: true }
      ])
    );

    // Re-enabling globally afterwards must not resurrect the migration.
    const enabled = persist(stored, (settings) => {
      settings.enabled = true;
    });
    expect(
      window.vscExpandStoredSettings(enabled).siteRules.map((rule) => rule.enabled)
    ).toEqual([true, true, true, true]);
  });

  it("migrates untouched storage by the global switch alone", () => {
    expect(
      window.vscExpandStoredSettings({}).siteRules.some((rule) => "enabled" in rule)
    ).toBe(false);
    expect(activeOn(window.vscExpandStoredSettings({ enabled: false }), WATCH_URL)).toBe(true);
    expect(expectStable({})).toEqual({});

    // A fresh install disabled from the popup must not whitelist YouTube.
    const disabled = persist({}, (settings) => {
      settings.enabled = false;
    });
    expect(disabled).toEqual({
      enabled: false,
      siteRulesFormat: "defaults-diff-v2",
      siteRulesMeta: { enabledTriState: true }
    });
    expect(activeOn(window.vscExpandStoredSettings(disabled), WATCH_URL)).toBe(false);
    expectStable(disabled);
  });

  it("migrates legacy full lists, v1 diffs and blacklists", () => {
    const fullList = {
      siteRules: [
        { pattern: YT, enabled: true },
        {
          pattern: "/^https:\\/\\/(www\\.)?youtube\\.com\\/shorts\\/.*/",
          enabled: true,
          rememberSpeed: true
        },
        { pattern: "off.test", disableExtension: true }
      ]
    };
    const on = window.vscExpandStoredSettings(fullList);
    expect(on.siteRules.map((rule) => rule.enabled)).toEqual([
      undefined,
      undefined,
      false,
      undefined
    ]);
    const off = window.vscExpandStoredSettings(
      Object.assign({ enabled: false }, fullList)
    );
    expect(off.siteRules.map((rule) => rule.enabled)).toEqual([
      true,
      true,
      false,
      true
    ]);
    expectStable(fullList);
    expectStable(Object.assign({ enabled: false }, fullList));

    const v1 = window.vscExpandStoredSettings({
      enabled: false,
      siteRulesFormat: "defaults-diff-v1",
      siteRules: [{ pattern: YT, enabled: false }]
    });
    expect(v1.siteRules.map((rule) => rule.enabled)).toEqual([false, true, true]);

    const blacklist = window.vscExpandStoredSettings({ blacklist: "a.test\nb.test" });
    expect(blacklist.siteRules.map((rule) => rule.enabled)).toEqual([
      undefined,
      undefined,
      undefined,
      false,
      false
    ]);
  });

  it("preserves explicit Always on rules in tri-state data while global Speeder is on", () => {
    const raw = {
      siteRulesFormat: "defaults-diff-v2",
      siteRulesMeta: { enabledTriState: true },
      siteRules: [
        { pattern: YT, enabled: true },
        { pattern: "custom.test", enabled: true },
        { pattern: "follow.test" }
      ]
    };
    const expanded = window.vscExpandStoredSettings(raw);

    expect(expanded.siteRules.map((rule) => rule.enabled)).toEqual([
      true,
      undefined,
      undefined,
      true,
      undefined
    ]);
    expect(expectStable(raw)).toEqual(raw);

    const disabled = window.vscExpandStoredSettings(
      persist(raw, (settings) => {
        settings.enabled = false;
      })
    );
    expect(activeOn(disabled, WATCH_URL)).toBe(true);
    expect(activeOn(disabled, "https://custom.test/")).toBe(true);
    expect(activeOn(disabled, "https://follow.test/")).toBe(false);
  });
});

describe("site-rule matching", () => {
  beforeEach(() => {
    bootSettingsCore();
  });

  it("merges all matches in order so a later specific rule wins", () => {
    const matched = window.SpeederShared.siteRules.matchSiteRule(
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

describe("stored shortcut modifiers", () => {
  beforeEach(() => {
    bootSettingsCore();
  });

  it("keeps Alt and Shift on stored bindings and coerces them to booleans", () => {
    const expanded = window.vscExpandStoredSettings({
      keyBindings: [
        { action: "slower", code: "KeyS", value: 0.1 },
        { action: "faster", code: "KeyD", value: 0.1, altKey: true, shiftKey: true },
        { action: "rewind", code: "KeyZ", value: 10, altKey: "yes" }
      ]
    });
    const byAction = (action) =>
      expanded.keyBindings.find((binding) => binding.action === action);

    expect(byAction("slower")).not.toHaveProperty("altKey");
    expect(byAction("faster")).toMatchObject({ altKey: true, shiftKey: true });
    expect(byAction("rewind").altKey).toBe(false);
  });
});

describe("site rules larger than one sync item", () => {
  beforeEach(() => {
    bootSettingsCore();
  });

  function manyRules(count) {
    return Array.from({ length: count }, (_, index) => ({
      pattern: "/^https:\\/\\/video-site-number-" + index + "\\.example\\.(com|net)\\/watch/",
      title: "Example video site with a fairly long descriptive title " + index,
      rememberSpeed: true
    }));
  }

  function itemBytes(key, value) {
    return Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value));
  }

  function applyMutation(raw, mutation) {
    const next = Object.assign({}, raw, mutation.set);
    mutation.remove.forEach((key) => delete next[key]);
    return next;
  }

  it("splits rules across part keys under the per-item quota and reads them back", () => {
    const settings = window.vscExpandStoredSettings({});
    settings.siteRules = settings.siteRules.concat(manyRules(120));

    const mutation = window.vscBuildManagedStorageMutation({}, settings);
    Object.keys(mutation.set).forEach((key) => {
      expect(itemBytes(key, mutation.set[key])).toBeLessThanOrEqual(8192);
    });
    expect(mutation.set.siteRulesMeta.parts).toBeGreaterThan(0);
    expect(mutation.set).toHaveProperty("siteRulesPart1");

    const restored = window.vscExpandStoredSettings(mutation.set);
    expect(restored.siteRules).toEqual(settings.siteRules);
    expect(restored.siteRulesMeta).not.toHaveProperty("parts");
    expect(window.vscBuildStoredSettingsDiff(restored)).toEqual(mutation.set);
  });

  it("drops part keys once the rules fit in one item again", () => {
    const settings = window.vscExpandStoredSettings({});
    settings.siteRules = settings.siteRules.concat(manyRules(120));
    const raw = applyMutation({}, window.vscBuildManagedStorageMutation({}, settings));

    const shrunk = window.vscExpandStoredSettings(raw);
    shrunk.siteRules = shrunk.siteRules.slice(0, 5);
    const mutation = window.vscBuildManagedStorageMutation(raw, shrunk);
    const next = applyMutation(raw, mutation);

    expect(Object.keys(next).some((key) => key.startsWith("siteRulesPart"))).toBe(false);
    expect(next.siteRulesMeta).not.toHaveProperty("parts");
    expect(window.vscExpandStoredSettings(next).siteRules).toEqual(shrunk.siteRules);
  });

  it("ignores leftover part keys that siteRulesMeta does not list", () => {
    const settings = window.vscExpandStoredSettings({});
    settings.siteRules = settings.siteRules.concat(manyRules(120));
    const raw = applyMutation({}, window.vscBuildManagedStorageMutation({}, settings));
    // An older Speeder rewrites siteRules and siteRulesMeta but not the parts.
    delete raw.siteRulesMeta.parts;

    expect(window.vscExpandStoredSettings(raw).siteRules).toEqual(
      window.vscExpandStoredSettings({ ...raw, siteRulesPart1: undefined }).siteRules
    );
    expect(window.vscBuildManagedStorageMutation(raw, window.vscExpandStoredSettings(raw)).remove)
      .toContain("siteRulesPart1");
  });

  it("lists the part keys as managed sync keys", () => {
    expect(window.vscGetManagedSyncKeys()).toEqual(
      expect.arrayContaining(["siteRulesPart1", "siteRulesPart12"])
    );
  });
});
