import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

export function loadHtml(relPath) {
  document.open();
  document.write(readRepoFile(relPath));
  document.close();
}

export function loadScript(relPath) {
  window.eval(
    "var chrome = window.chrome || globalThis.chrome;\n" +
      readRepoFile(relPath) +
      "\n//# sourceURL=" +
      relPath
  );
}

export async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

export function triggerDomContentLoaded() {
  document.dispatchEvent(
    new window.Event("DOMContentLoaded", {
      bubbles: true,
      cancelable: true
    })
  );
}

function createEvent() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    trigger(...args) {
      listeners.forEach((listener) => listener(...args));
    },
    listeners
  };
}

function createStorageArea(initialState = {}) {
  const state = { ...initialState };

  function resolveGet(keys) {
    if (keys == null) return { ...state };
    if (Array.isArray(keys)) {
      return keys.reduce((acc, key) => {
        if (Object.prototype.hasOwnProperty.call(state, key)) {
          acc[key] = state[key];
        }
        return acc;
      }, {});
    }
    if (typeof keys === "string") {
      return Object.prototype.hasOwnProperty.call(state, keys)
        ? { [keys]: state[keys] }
        : {};
    }
    if (typeof keys === "object") {
      const result = { ...keys };
      Object.keys(state).forEach((key) => {
        result[key] = state[key];
      });
      return result;
    }
    return {};
  }

  return {
    __state: state,
    get: vi.fn((keys, callback) => {
      callback(resolveGet(keys));
    }),
    set: vi.fn((items, callback) => {
      Object.assign(state, items);
      if (callback) callback();
    }),
    remove: vi.fn((keys, callback) => {
      const list = Array.isArray(keys) ? keys : [keys];
      list.forEach((key) => {
        delete state[key];
      });
      if (callback) callback();
    }),
    clear: vi.fn((callback) => {
      Object.keys(state).forEach((key) => delete state[key]);
      if (callback) callback();
    })
  };
}

export function createChromeMock(options = {}) {
  const syncArea = createStorageArea(options.sync ?? {});
  const localArea = createStorageArea(options.local ?? {});
  const tabsOnActivated = createEvent();
  const tabsOnUpdated = createEvent();
  const storageOnChanged = createEvent();

  const chrome = {
    runtime: {
      lastError: null,
      getManifest: vi.fn(() => ({
        version: options.manifestVersion || "9.9.9"
      })),
      getURL: vi.fn((url) => "moz-extension://speeder/" + url)
    },
    storage: {
      sync: syncArea,
      local: localArea,
      onChanged: storageOnChanged
    },
    tabs: {
      query: vi.fn((queryInfo, callback) => {
        callback(
          options.tabs ??
            [
              {
                id: 1,
                active: true,
                url: "https://example.com/watch"
              }
            ]
        );
      }),
      sendMessage: vi.fn((tabId, message, callback) => {
        if (callback) {
          callback(options.sendMessageResponse ?? { speed: 1.25 });
        }
      }),
      executeScript: vi.fn((tabId, details, callback) => {
        if (callback) {
          callback(
            options.executeScriptResponse ?? [
              { speed: 1.25, preferred: true }
            ]
          );
        }
      }),
      create: vi.fn(),
      onActivated: tabsOnActivated,
      onUpdated: tabsOnUpdated
    },
    browserAction: {
      setIcon: vi.fn()
    }
  };

  return chrome;
}
