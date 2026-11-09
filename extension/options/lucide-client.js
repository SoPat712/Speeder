/** Bundled Lucide static icons. ISC License — see vendor/LICENSE. */
var LUCIDE_STATIC_VERSION = "1.7.0";
var lucideBundle = null;
var lucideBundlePromise = null;

function lucideTagsJsonUrl() {
  return chrome.runtime.getURL("options/vendor/lucide-icons.json");
}

function loadLucideBundle() {
  if (!lucideBundlePromise) {
    lucideBundlePromise = fetch(lucideTagsJsonUrl(), { cache: "force-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("Could not load bundled icons");
        return r.json();
      })
      .then(function (data) {
        if (data.version !== LUCIDE_STATIC_VERSION) throw new Error("Lucide version mismatch");
        lucideBundle = data;
        return data;
      })
      .catch(function (error) {
        lucideBundlePromise = null;
        throw error;
      });
  }
  return lucideBundlePromise;
}

function isLucideSlug(slug) {
  return typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug);
}

function lucideIconSvgUrl(slug) {
  if (!isLucideSlug(slug) || !lucideBundle) return "";
  var svg = Object.prototype.hasOwnProperty.call(lucideBundle.icons, slug.toLowerCase())
    ? lucideBundle.icons[slug.toLowerCase()] : null;
  return svg ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg) : "";
}

/** Collapse whitespace for smaller storage. */
function lucideMinifySvg(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

function sanitizeLucideSvg(svgText) {
  var svg = vscParseSvg(svgText);
  if (!svg) return null;
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("aria-hidden", "true");
  return lucideMinifySvg(svg.outerHTML);
}

function fetchLucideSvg(slug) {
  if (!isLucideSlug(slug)) return Promise.reject(new Error("Invalid icon name"));
  return loadLucideBundle().then(function (data) {
    var svg = Object.prototype.hasOwnProperty.call(data.icons, slug.toLowerCase())
      ? data.icons[slug.toLowerCase()] : null;
    if (!svg) throw new Error("Icon not found: " + slug);
    return svg;
  });
}

/** @returns {Promise<Object<string, string[]>>} slug -> tags */
function getLucideTagsMap() {
  return loadLucideBundle().then(function (data) {
    return data.tags;
  });
}

/**
 * @param {Object<string,string[]>} tagsMap
 * @param {string} query
 * @param {number} limit
 * @returns {string[]} slugs
 */
function searchLucideSlugs(tagsMap, query, limit) {
  var lim = limit != null ? limit : 60;
  var q = String(query || "")
    .toLowerCase()
    .trim();
  if (!tagsMap || !q) return [];
  var matches = [];
  for (var slug in tagsMap) {
    if (!Object.prototype.hasOwnProperty.call(tagsMap, slug)) continue;
    var hay =
      slug +
      " " +
      (Array.isArray(tagsMap[slug]) ? tagsMap[slug].join(" ") : "");
    if (hay.toLowerCase().indexOf(q) === -1) continue;
    matches.push(slug);
  }
  matches.sort(function (a, b) {
    var al = a.toLowerCase();
    var bl = b.toLowerCase();
    var ap = al.indexOf(q) === 0 ? 0 : 1;
    var bp = bl.indexOf(q) === 0 ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return al.localeCompare(bl);
  });
  return matches.slice(0, lim);
}
