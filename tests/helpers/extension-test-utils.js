const fs = require("fs");
const path = require("path");
const { vi } = require("vitest");

const ROOT = path.resolve(__dirname, "..", "..");

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function workspacePath(relPath) {
  return path.join(ROOT, relPath);
}

function readWorkspaceFile(relPath) {
  return fs.readFileSync(workspacePath(relPath), "utf8");
}

function loadHtmlFile(relPath) {
  document.open();
  document.write(readWorkspaceFile(relPath));
  document.close();
}

function loadHtmlString(html) {
  document.open();
  document.write(html);
  document.close();
}

function evaluateScript(relPath) {
  const source = readWorkspaceFile(relPath);
  window.eval(
    `${source}\n//# sourceURL=${workspacePath(relPath).replace(/\\/g, "/")}`
  );
}

function fireDOMContentLoaded() {
  document.dispatchEvent(
    new window.Event("DOMContentLoaded", {
      bubbles: true,
      cancelable: true
    })
  );
}

async function flushAsyncWork(turns) {
  const count = turns || 2;
  for (let i = 0; i < count; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function pickStorageValues(data, keys) {
  if (keys == null) return clone(data || {});

  if (typeof keys === "string") {
    return { [keys]: clone(data ? data[keys] : undefined) };
  }

  if (Array.isArray(keys)) {
    const result = {};
    keys.forEach((key) => {
      result[key] = clone(data ? data[key] : undefined);
    });
    return result;
  }

  if (typeof keys === "object") {
    const result = clone(keys) || {};
    Object.keys(keys).forEach((key) => {
      if (data && Object.prototype.hasOwnProperty.call(data, key)) {
        result[key] = clone(data[key]);
      }
    });
    return result;
  }

  return {};
}

function createChromeEvent() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    removeListener(listener) {
      const index = listeners.indexOf(listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
    hasListener(listener) {
      return listeners.includes(listener);
    },
    emit(...args) {
      listeners.slice().forEach((listener) => listener(...args));
    },
    listeners
  };
}

function createStorageArea(areaName, initialData, onChangedEvent) {
  let data = clone(initialData) || {};

  function emitChanges(changes) {
    if (changes && Object.keys(changes).length > 0) {
      onChangedEvent.emit(changes, areaName);
    }
  }

  return {
    get: vi.fn((keys, callback) => {
      if (callback) callback(pickStorageValues(data, keys));
    }),
    set: vi.fn((items, callback) => {
      const nextItems = items || {};
      const changes = {};

      Object.keys(nextItems).forEach((key) => {
        const oldValue = clone(data[key]);
        const newValue = clone(nextItems[key]);
        data[key] = newValue;
        changes[key] = { oldValue, newValue };
      });

      emitChanges(changes);
      if (callback) callback();
    }),
    remove: vi.fn((keys, callback) => {
      const list = Array.isArray(keys) ? keys : [keys];
      const changes = {};

      list.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          changes[key] = {
            oldValue: clone(data[key]),
            newValue: undefined
          };
          delete data[key];
        }
      });

      emitChanges(changes);
      if (callback) callback();
    }),
    clear: vi.fn((callback) => {
      const changes = {};
      Object.keys(data).forEach((key) => {
        changes[key] = {
          oldValue: clone(data[key]),
          newValue: undefined
        };
      });
      data = {};
      emitChanges(changes);
      if (callback) callback();
    }),
    _dump() {
      return clone(data);
    }
  };
}

function createChromeMock(options) {
  const config = options || {};
  const storageOnChanged = createChromeEvent();
  const tabsOnActivated = createChromeEvent();
  const tabsOnUpdated = createChromeEvent();
  const runtimeOnMessage = createChromeEvent();

  const chrome = {
    runtime: {
      lastError: null,
      getManifest: vi.fn(() => clone(config.manifest) || { version: "0.0.0-test" }),
      getURL: vi.fn((relPath) => `moz-extension://${relPath}`),
      onMessage: runtimeOnMessage
    },
    browserAction: {
      setIcon: vi.fn()
    },
    tabs: {
      query: vi.fn((queryInfo, callback) => {
        const tabs = clone(config.tabsQueryResult) || [
          { id: 1, active: true, url: "https://example.com/" }
        ];
        if (callback) callback(tabs);
      }),
      sendMessage: vi.fn((tabId, message, callback) => {
        if (callback) callback(null);
      }),
      executeScript: vi.fn((tabId, details, callback) => {
        if (callback) callback([]);
      }),
      create: vi.fn(),
      onActivated: tabsOnActivated,
      onUpdated: tabsOnUpdated
    },
    storage: {
      onChanged: storageOnChanged,
      sync: null,
      local: null
    }
  };

  chrome.storage.sync = createStorageArea(
    "sync",
    config.syncData,
    storageOnChanged
  );
  chrome.storage.local = createStorageArea(
    "local",
    config.localData,
    storageOnChanged
  );

  return chrome;
}

function installCommonWindowMocks() {
  window.open = vi.fn();
  window.close = vi.fn();
  window.requestAnimationFrame = vi.fn((callback) => setTimeout(callback, 0));
  window.cancelAnimationFrame = vi.fn((id) => clearTimeout(id));
}

module.exports = {
  createChromeMock,
  evaluateScript,
  fireDOMContentLoaded,
  flushAsyncWork,
  installCommonWindowMocks,
  loadHtmlFile,
  loadHtmlString,
  readWorkspaceFile,
  workspacePath
};
