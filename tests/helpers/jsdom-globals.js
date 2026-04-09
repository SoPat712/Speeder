/**
 * Point Vitest/jsdom test globals at a new JSDOM window (no document.write).
 * Call after creating `new JSDOM(html, options).window`.
 */
import { vi } from "vitest";

export function applyJSDOMWindow(win) {
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.navigator = win.navigator;
  globalThis.customElements = win.customElements;
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.Element = win.Element;
  globalThis.Node = win.Node;
  globalThis.Text = win.Text;
  globalThis.DocumentFragment = win.DocumentFragment;
  globalThis.Event = win.Event;
  globalThis.MouseEvent = win.MouseEvent;
  globalThis.KeyboardEvent = win.KeyboardEvent;
  globalThis.DOMParser = win.DOMParser;
  globalThis.URL = win.URL;
  globalThis.Blob = win.Blob;
  globalThis.FileReader = win.FileReader;

  // Vitest fake timers patch host `Date`; jsdom’s window keeps its own otherwise.
  win.Date = globalThis.Date;

  win.open = vi.fn();
  win.close = vi.fn();
}
