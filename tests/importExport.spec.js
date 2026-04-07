const { afterEach, beforeEach, describe, expect, it, vi } = require("vitest");
const {
  createChromeMock,
  evaluateScript,
  flushAsyncWork,
  installCommonWindowMocks,
  loadHtmlString
} = require("./helpers/extension-test-utils");

function bootImportExport(options) {
  const config = options || {};

  loadHtmlString(`<!doctype html><html><body>
    <button id="exportSettings">Export</button>
    <button id="importSettings">Import</button>
    <div id="status"></div>
  </body></html>`);

  installCommonWindowMocks();

  const chrome = createChromeMock({
    syncData: config.syncData,
    localData: config.localData
  });

  global.chrome = chrome;
  window.chrome = chrome;

  const createObjectURL = vi.fn(() => "blob:test");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", {
    createObjectURL,
    revokeObjectURL
  });

  evaluateScript("importExport.js");
  return { chrome, createObjectURL, revokeObjectURL };
}

describe("importExport.js", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete global.chrome;
  });

  it("generates timestamped backup filenames", () => {
    vi.setSystemTime(new Date("2026-04-04T13:14:15Z"));
    bootImportExport();

    expect(window.generateBackupFilename()).toBe(
      "speeder-backup_2026-04-04_13.14.15.json"
    );
  });

  it("exports sync and local settings into a downloadable backup", async () => {
    const clickSpy = vi
      .spyOn(window.HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const { createObjectURL, revokeObjectURL } = bootImportExport({
      syncData: {
        rememberSpeed: true,
        keyBindings: [{ action: "faster", code: "KeyD", value: 0.1 }]
      },
      localData: {
        customButtonIcons: {
          faster: { slug: "rocket", svg: "<svg></svg>" }
        }
      }
    });

    document.querySelector("#exportSettings").click();
    await flushAsyncWork();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    const backup = JSON.parse(await blob.text());

    expect(backup.settings.rememberSpeed).toBe(true);
    expect(backup.localSettings.customButtonIcons.faster.slug).toBe("rocket");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    expect(document.querySelector("#status").textContent).toContain("exported");
  });

  it("imports wrapped backups, restores local data, and refreshes the options page", async () => {
    const { chrome } = bootImportExport();
    window.restore_options = vi.fn();

    const realCreateElement = document.createElement.bind(document);
    const fakeInput = realCreateElement("input");
    Object.defineProperty(fakeInput, "files", {
      configurable: true,
      value: [
        {
          __contents: JSON.stringify({
            settings: {
              rememberSpeed: true,
              enabled: false
            },
            localSettings: {
              customButtonIcons: {
                faster: { slug: "rocket", svg: "<svg></svg>" }
              }
            }
          })
        }
      ]
    });
    fakeInput.click = vi.fn(() => {
      fakeInput.onchange({ target: fakeInput });
    });

    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (String(tagName).toLowerCase() === "input") {
        return fakeInput;
      }
      return realCreateElement(tagName);
    });

    class FakeFileReader {
      readAsText(file) {
        this.onload({ target: { result: file.__contents } });
      }
    }

    vi.stubGlobal("FileReader", FakeFileReader);

    document.querySelector("#importSettings").click();
    await flushAsyncWork();

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      {
        customButtonIcons: {
          faster: { slug: "rocket", svg: "<svg></svg>" }
        }
      },
      expect.any(Function)
    );
    expect(chrome.storage.sync.clear).toHaveBeenCalled();
    expect(chrome.storage.sync.set).toHaveBeenCalledWith(
      { rememberSpeed: true, enabled: false },
      expect.any(Function)
    );

    vi.advanceTimersByTime(500);
    expect(window.restore_options).toHaveBeenCalled();
  });

  it("shows an error for malformed backups", async () => {
    bootImportExport();

    const realCreateElement = document.createElement.bind(document);
    const fakeInput = realCreateElement("input");
    Object.defineProperty(fakeInput, "files", {
      configurable: true,
      value: [{ __contents: "{bad json" }]
    });
    fakeInput.click = vi.fn(() => {
      fakeInput.onchange({ target: fakeInput });
    });

    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (String(tagName).toLowerCase() === "input") {
        return fakeInput;
      }
      return realCreateElement(tagName);
    });

    class FakeFileReader {
      readAsText(file) {
        this.onload({ target: { result: file.__contents } });
      }
    }

    vi.stubGlobal("FileReader", FakeFileReader);

    document.querySelector("#importSettings").click();
    await flushAsyncWork();

    expect(document.querySelector("#status").textContent).toContain(
      "Failed to parse backup file"
    );
  });
});
