/**
 * Inline SVG icons (Lucide-style strokes, compatible with https://lucide.dev — ISC license).
 * Use stroke="currentColor" so buttons inherit foreground for monochrome UI.
 */
var VSC_ICON_SIZE_DEFAULT = 18;
var VSC_SVG_NS = "http://www.w3.org/2000/svg";

/** Inner SVG markup only (paths / shapes inside <svg>). */
var vscUiIconPaths = {
  rewind:
    '<polygon points="11 19 2 12 11 5 11 19"/><polygon points="22 19 13 12 22 5 22 19"/>',
  advance:
    '<polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/>',
  reset:
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  slower: '<line x1="5" y1="12" x2="19" y2="12"/>',
  faster:
    '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  softer:
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="16" y1="12" x2="22" y2="12"/>',
  louder:
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="17" y1="9" x2="17" y2="15"/><line x1="14" y1="12" x2="20" y2="12"/>',
  moreHorizontal:
    '<circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  display:
    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  fast: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  pause:
    '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  muted:
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
  mark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  jump:
    '<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  nudge: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  /** Lucide check — subtitle nudge on */
  subtitleNudgeOn: '<path d="M20 6 9 17l-5-5"/>',
  /** Lucide x — subtitle nudge off */
  subtitleNudgeOff:
    '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
};

/**
 * @param {number} [size] - width/height in px
 * @returns {string} full <svg>…</svg>
 */
function vscIconSvgString(action, size) {
  var inner = vscUiIconPaths[action];
  if (!inner) return "";
  var s = size != null ? size : VSC_ICON_SIZE_DEFAULT;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    s +
    '" height="' +
    s +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    inner +
    "</svg>"
  );
}

function vscClearElement(el) {
  if (!el) return;
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

function vscSanitizeSvgTree(svg) {
  if (!svg || String(svg.tagName).toLowerCase() !== "svg") return null;

  svg.querySelectorAll("script, style, foreignObject").forEach(function (n) {
    n.remove();
  });

  svg.querySelectorAll("*").forEach(function (el) {
    for (var i = el.attributes.length - 1; i >= 0; i--) {
      var attr = el.attributes[i];
      var name = attr.name.toLowerCase();
      var val = attr.value;
      if (name.indexOf("on") === 0) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === "href" || name === "xlink:href") &&
        /^\s*javascript:/i.test(val)
      ) {
        el.removeAttribute(attr.name);
      }
    }
  });

  svg.setAttribute("xmlns", VSC_SVG_NS);
  svg.setAttribute("aria-hidden", "true");
  return svg;
}

function vscCreateSvgNode(doc, svgText) {
  if (!doc || !svgText || typeof svgText !== "string") return null;
  var clean = String(svgText).replace(/\0/g, "").trim();
  if (!clean || !/<svg[\s>]/i.test(clean)) return null;

  var parsed = new DOMParser().parseFromString(clean, "image/svg+xml");
  if (parsed.querySelector("parsererror")) return null;

  var svg = vscSanitizeSvgTree(parsed.querySelector("svg"));
  if (!svg) return null;

  return doc.importNode(svg, true);
}

function vscSetSvgContent(el, svgText) {
  if (!el) return false;
  vscClearElement(el);

  var doc = el.ownerDocument || document;
  var svg = vscCreateSvgNode(doc, svgText);
  if (!svg) return false;

  el.appendChild(svg);
  return true;
}

function vscCreateSvgWrap(doc, svgText, className) {
  if (!doc) return null;
  var span = doc.createElement("span");
  span.className = className || "vsc-btn-icon";
  if (!vscSetSvgContent(span, svgText)) {
    return null;
  }
  return span;
}

/**
 * @param {Document} doc
 * @param {string} action
 * @returns {HTMLElement|null} wrapper span containing svg, or null if no icon
 */
function vscIconWrap(doc, action, size) {
  var html = vscIconSvgString(action, size);
  if (!html) return null;
  return vscCreateSvgWrap(doc, html, "vsc-btn-icon");
}
