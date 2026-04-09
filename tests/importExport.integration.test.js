import {
  createChromeMock,
  flushAsyncWork,
  loadHtml,
  loadScript
} from "./helpers/browser.js";

async function setupImportExport(overrides = {}) {
  loadHtml("options.html");
  globalThis.chrome = createChromeMock(overrides);
  window.chrome = globalThis.chrome;
  const restoreSpy = vi.fn();
  globalThis.restore_options = restoreSpy;
  window.restore_options = restoreSpy;
  loadScript("shared/import-export.js");
  loadScript("importExport.js");
  await flushAsyncWork();
  return globalThis.chrome;
}

describe("import/export flows", () => {
  it("exports sync and local settings as a JSON download", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 4, 8, 9, 10));
    const chrome = await setupImportExport({
      sync: { rememberSpeed: true },
      local: { customButtonIcons: { faster: { slug: "rocket" } } }
    });
    const OriginalBlob = window.Blob;
    class TestBlob {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
      }

      async text() {
        return this.parts.join("");
      }
    }
    globalThis.Blob = TestBlob;
    window.Blob = TestBlob;

    let capturedBlob = null;
    let clickedDownload = null;
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob) => {
        capturedBlob = blob;
        return "blob:test";
      })
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(() => {})
    });
    vi.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(
      function () {
        clickedDownload = this.download;
      }
    );

    document.getElementById("exportSettings").click();

    expect(clickedDownload).toBe("speeder-backup_2026-04-04_08.09.10.json");
    expect(capturedBlob).not.toBeNull();
    const blobText = await capturedBlob.text();
    expect(JSON.parse(blobText)).toEqual({
      version: "1.1",
      exportDate: "2026-04-04T12:09:10.000Z",
      settings: { rememberSpeed: true },
      localSettings: { customButtonIcons: { faster: { slug: "rocket" } } }
    });
    expect(document.getElementById("status").textContent).toBe(
      "Settings exported successfully"
    );
    expect(chrome.storage.sync.get).toHaveBeenCalled();
    expect(chrome.storage.local.get).toHaveBeenCalled();
    globalThis.Blob = OriginalBlob;
    window.Blob = OriginalBlob;
  });

  it("imports wrapped backup payloads and refreshes options", async () => {
    vi.useFakeTimers();
    const chrome = await setupImportExport();

    const originalCreateElement = document.createElement.bind(document);
    let createdInput = null;
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      const el = originalCreateElement(tagName);
      if (tagName === "input") {
        createdInput = el;
        el.click = vi.fn();
      }
      return el;
    });

    class MockFileReader {
      readAsText(file) {
        this.onload({
          target: {
            result: file.__text
          }
        });
      }
    }
    globalThis.FileReader = MockFileReader;
    window.FileReader = MockFileReader;

    globalThis.importSettings();
    createdInput.onchange({
      target: {
        files: [
          {
            __text: JSON.stringify({
              settings: { rememberSpeed: true },
              localSettings: { customButtonIcons: { faster: { slug: "rocket" } } }
            })
          }
        ]
      }
    });

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      { customButtonIcons: { faster: { slug: "rocket" } } },
      expect.any(Function)
    );
    expect(chrome.storage.sync.clear).toHaveBeenCalled();
    expect(chrome.storage.sync.set).toHaveBeenCalledWith(
      { rememberSpeed: true },
      expect.any(Function)
    );
    expect(document.getElementById("status").textContent).toBe(
      "Settings imported successfully. Reloading..."
    );

    vi.advanceTimersByTime(500);
    expect(globalThis.restore_options).toHaveBeenCalled();
  });

  it("imports raw settings objects without touching local storage", async () => {
    vi.useFakeTimers();
    const chrome = await setupImportExport({
      local: { customButtonIcons: { faster: { slug: "rocket" } } }
    });

    const originalCreateElement = document.createElement.bind(document);
    let createdInput = null;
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      const el = originalCreateElement(tagName);
      if (tagName === "input") {
        createdInput = el;
        el.click = vi.fn();
      }
      return el;
    });

    class MockFileReader {
      readAsText(file) {
        this.onload({
          target: {
            result: file.__text
          }
        });
      }
    }
    globalThis.FileReader = MockFileReader;
    window.FileReader = MockFileReader;

    globalThis.importSettings();
    createdInput.onchange({
      target: {
        files: [
          {
            __text: JSON.stringify({
              enabled: false,
              siteRules: [{ pattern: "example.com", enabled: false }]
            })
          }
        ]
      }
    });

    expect(chrome.storage.local.clear).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(chrome.storage.sync.set).toHaveBeenCalledWith(
      {
        enabled: false,
        siteRules: [{ pattern: "example.com", enabled: false }]
      },
      expect.any(Function)
    );
  });

  it("clears stale local data when a wrapped backup has empty local settings", async () => {
    vi.useFakeTimers();
    const chrome = await setupImportExport({
      local: {
        customButtonIcons: { faster: { slug: "rocket" } },
        lucideTagsCacheV1: { stale: true }
      }
    });

    const originalCreateElement = document.createElement.bind(document);
    let createdInput = null;
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      const el = originalCreateElement(tagName);
      if (tagName === "input") {
        createdInput = el;
        el.click = vi.fn();
      }
      return el;
    });

    class MockFileReader {
      readAsText(file) {
        this.onload({
          target: {
            result: file.__text
          }
        });
      }
    }
    globalThis.FileReader = MockFileReader;
    window.FileReader = MockFileReader;

    globalThis.importSettings();
    createdInput.onchange({
      target: {
        files: [
          {
            __text: JSON.stringify({
              settings: { rememberSpeed: true },
              localSettings: {}
            })
          }
        ]
      }
    });

    expect(chrome.storage.local.clear).toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(chrome.storage.sync.set).toHaveBeenCalledWith(
      { rememberSpeed: true },
      expect.any(Function)
    );
  });

  it("shows an error for invalid backup files", async () => {
    vi.useFakeTimers();
    const chrome = await setupImportExport();

    const originalCreateElement = document.createElement.bind(document);
    let createdInput = null;
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      const el = originalCreateElement(tagName);
      if (tagName === "input") {
        createdInput = el;
        el.click = vi.fn();
      }
      return el;
    });

    class MockFileReader {
      readAsText(file) {
        this.onload({
          target: {
            result: file.__text
          }
        });
      }
    }
    globalThis.FileReader = MockFileReader;
    window.FileReader = MockFileReader;

    globalThis.importSettings();
    createdInput.onchange({
      target: {
        files: [
          {
            __text: JSON.stringify({ wat: true })
          }
        ]
      }
    });

    expect(document.getElementById("status").textContent).toBe(
      "Error: Invalid backup file format"
    );
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });
});
