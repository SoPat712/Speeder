/**
 * Lucide static icons via jsDelivr (same registry as lucide.dev).
 * ISC License — https://lucide.dev
 */
var LUCIDE_STATIC_VERSION = "1.7.0";
var LUCIDE_CDN_BASE =
  "https://cdn.jsdelivr.net/npm/lucide-static@" +
  LUCIDE_STATIC_VERSION;

var LUCIDE_TAGS_CACHE_KEY = "lucideTagsCacheV1";
var LUCIDE_TAGS_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; /* 7 days */

function lucideIconSvgUrl(slug) {
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) {
    return "";
  }
  return LUCIDE_CDN_BASE + "/icons/" + slug.toLowerCase() + ".svg";
}

function lucideTagsJsonUrl() {
  return LUCIDE_CDN_BASE + "/tags.json";
}

/** Collapse whitespace for smaller storage. */
function lucideMinifySvg(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

function sanitizeLucideSvg(svgText) {
  if (!svgText || typeof svgText !== "string") return null;
  var t = String(svgText).replace(/\0/g, "").trim();
  if (!/<svg[\s>]/i.test(t)) return null;
  var doc = new DOMParser().parseFromString(t, "image/svg+xml");
  var svg = doc.querySelector("svg");
  if (!svg) return null;
  svg.querySelectorAll("script").forEach(function (n) {
    n.remove();
  });
  svg.querySelectorAll("style").forEach(function (n) {
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
        /^javascript:/i.test(val)
      ) {
        el.removeAttribute(attr.name);
      }
    }
  });
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("aria-hidden", "true");
  return lucideMinifySvg(svg.outerHTML);
}

function fetchLucideSvg(slug) {
  var url = lucideIconSvgUrl(slug);
  if (!url) {
    return Promise.reject(new Error("Invalid icon name"));
  }
  return fetch(url, { cache: "force-cache" }).then(function (r) {
    if (!r.ok) {
      throw new Error("Icon not found: " + slug);
    }
    return r.text();
  });
}

function fetchAndCacheLucideTags(chromeLocal, resolve, reject) {
  fetch(lucideTagsJsonUrl(), { cache: "force-cache" })
    .then(function (r) {
      if (!r.ok) throw new Error("tags.json HTTP " + r.status);
      return r.json();
    })
    .then(function (obj) {
      var payload = {};
      payload[LUCIDE_TAGS_CACHE_KEY] = obj;
      payload[LUCIDE_TAGS_CACHE_KEY + "At"] = Date.now();
      if (chromeLocal && chromeLocal.set) {
        chromeLocal.set(payload, function () {
          resolve(obj);
        });
      } else {
        resolve(obj);
      }
    })
    .catch(reject);
}

/** @returns {Promise<Object<string, string[]>>} slug -> tags */
function getLucideTagsMap(chromeLocal, bypassCache) {
  return new Promise(function (resolve, reject) {
    if (!chromeLocal || !chromeLocal.get) {
      fetch(lucideTagsJsonUrl(), { cache: "force-cache" })
        .then(function (r) {
          return r.json();
        })
        .then(resolve)
        .catch(reject);
      return;
    }
    if (bypassCache) {
      fetchAndCacheLucideTags(chromeLocal, resolve, reject);
      return;
    }
    chromeLocal.get(
      [LUCIDE_TAGS_CACHE_KEY, LUCIDE_TAGS_CACHE_KEY + "At"],
      function (stored) {
        if (chrome.runtime.lastError) {
          fetchAndCacheLucideTags(chromeLocal, resolve, reject);
          return;
        }
        var data = stored[LUCIDE_TAGS_CACHE_KEY];
        var at = stored[LUCIDE_TAGS_CACHE_KEY + "At"];
        if (
          data &&
          typeof data === "object" &&
          at &&
          Date.now() - at < LUCIDE_TAGS_MAX_AGE_MS
        ) {
          resolve(data);
          return;
        }
        fetchAndCacheLucideTags(chromeLocal, resolve, reject);
      }
    );
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
