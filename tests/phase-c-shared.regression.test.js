const {
  createChromeMock,
  evaluateScript,
  loadHtmlString,
  readWorkspaceFile
} = require("./helpers/extension-test-utils");

function bootCore() {
  loadHtmlString("<!doctype html><html><head></head><body></body></html>");
  window.chrome = createChromeMock();
  evaluateScript("extension/shared/settings-core.js");
}

describe("Phase C shared contracts", () => {
  beforeEach(bootCore);

  it.each(["extension/manifest.json", "extension/options/options.html", "extension/popup/popup.html"])(
    "keeps settings-core available before consumers in %s", (path) => {
      const source = readWorkspaceFile(path);
      const core = source.indexOf("shared/settings-core.js");
      expect(core).toBeGreaterThan(-1);
      const consumer = path.endsWith("manifest.json") ? "content/inject.js"
        : path.includes("options") ? 'src="options.js"' : 'src="popup.js"';
      expect(source.indexOf(consumer)).toBeGreaterThan(core);
    }
  );

  it.each([true, false])("shares the complete legacy map with key-bindings loaded first=%s", (first) => {
    bootCore();
    if (first) {
      loadHtmlString("<!doctype html><html><head></head><body></body></html>");
      evaluateScript("extension/shared/key-bindings.js");
      evaluateScript("extension/shared/settings-core.js");
    } else {
      evaluateScript("extension/shared/key-bindings.js");
    }
    const convert = window.SpeederShared.keyBindings.legacyKeyCodeToCode;
    const special = {
      32: "Space", 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown",
      59: "Semicolon", 61: "Equal", 106: "NumpadMultiply", 107: "NumpadAdd",
      109: "NumpadSubtract", 110: "NumpadDecimal", 111: "NumpadDivide",
      173: "Minus", 186: "Semicolon", 187: "Equal", 188: "Comma", 189: "Minus",
      190: "Period", 191: "Slash", 192: "Backquote", 219: "BracketLeft",
      220: "Backslash", 221: "BracketRight", 222: "Quote"
    };
    for (let code = 0; code <= 255; code++) {
      let expected = special[code] || null;
      if (code >= 48 && code <= 57) expected = "Digit" + String.fromCharCode(code);
      if (code >= 65 && code <= 90) expected = "Key" + String.fromCharCode(code);
      if (code >= 96 && code <= 105) expected = "Numpad" + (code - 96);
      if (code >= 112 && code <= 123) expected = "F" + (code - 111);
      expect(convert(code)).toBe(expected);
    }
    expect(convert("65")).toBeNull();
    expect(convert(65.5)).toBeNull();
    expect(window.vscLegacyKeyCodeToCode("65")).toBe("KeyA");
    expect(window.vscExpandStoredSettings({ displayKeyCode: "65" }).keyBindings
      .find((binding) => binding.action === "display").code).toBe("KeyA");
  });

  it("returns independent default and available button lists in the existing UI order", () => {
    const defaults = ["rewind", "slower", "faster", "advance", "display"];
    const available = defaults.concat(["reset", "fast", "nudge", "pause", "muted", "louder", "softer", "mark", "jump", "settings", "previousFrame", "nextFrame"]);
    expect(window.vscGetButtonIds()).toEqual(available);
    expect(window.vscGetDefaultButtonIds()).toEqual(defaults);
    window.vscGetButtonIds().pop();
    window.vscGetDefaultButtonIds().reverse();
    expect(window.vscGetButtonIds()).toEqual(available);
    expect(window.vscGetSettingsDefaults().controllerButtons).toEqual(defaults);
    expect(window.vscGetSettingsDefaults().popupControllerButtons).toEqual(defaults);
  });

  it.each([
    [{ set: {}, remove: [] }, []],
    [{ set: {}, remove: ["legacy"] }, ["remove"]],
    [{ set: { enabled: false }, remove: [] }, ["set"]],
    [{ set: { enabled: false, lastSpeed: 1.8 }, remove: ["legacy"] }, ["set", "remove"]]
  ])("writes mutation %j in order", (mutation, expected) => {
    const calls = [];
    window.chrome.storage.sync.set.mockImplementation((values, callback) => {
      calls.push("set");
      expect(values).toEqual(mutation.set);
      callback();
    });
    window.chrome.storage.sync.remove.mockImplementation((keys, callback) => {
      calls.push("remove");
      expect(keys).toEqual(mutation.remove);
      callback();
    });
    const done = vi.fn();
    window.vscWriteManagedStorageMutation(mutation, done);
    expect(calls).toEqual(expected);
    expect(done).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("waits for the replacement write to succeed before removing stale settings", () => {
    let finishWrite;
    let finishRemove;
    window.chrome.storage.sync.set.mockImplementation((values, callback) => {
      finishWrite = callback;
    });
    window.chrome.storage.sync.remove.mockImplementation((keys, callback) => {
      finishRemove = callback;
    });
    const done = vi.fn();
    window.vscWriteManagedStorageMutation({ set: { enabled: false }, remove: ["legacy"] }, done);
    expect(window.chrome.storage.sync.remove).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    finishWrite();
    expect(window.chrome.storage.sync.remove).toHaveBeenCalledExactlyOnceWith(["legacy"], expect.any(Function));
    expect(done).not.toHaveBeenCalled();
    finishRemove();
    expect(done).toHaveBeenCalledExactlyOnceWith(null);
  });

  it.each(["set", "remove"])("reports the %s error once and never removes after a failed write", (operation) => {
    const error = { message: operation + " failed" };
    const calls = [];
    ["set", "remove"].forEach((method) => {
      window.chrome.storage.sync[method].mockImplementation((data, callback) => {
        calls.push(method);
        window.chrome.runtime.lastError = method === operation ? error : null;
        callback();
        window.chrome.runtime.lastError = null;
      });
    });
    const done = vi.fn();
    window.vscWriteManagedStorageMutation({ set: { enabled: false }, remove: ["legacy"] }, done);
    expect(calls).toEqual(operation === "set" ? ["set"] : ["set", "remove"]);
    expect(done).toHaveBeenCalledExactlyOnceWith(error);
  });
});
