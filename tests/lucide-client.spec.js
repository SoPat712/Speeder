const {
  evaluateScript,
  loadHtmlString
} = require("./helpers/extension-test-utils");

describe("lucide-client.js", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("loads the pinned bundle lazily, caches it and never requests a remote URL", async () => {
    loadHtmlString("<!doctype html><html><body></body></html>");
    const bundle = require("../extension/options/vendor/lucide-icons.json");
    const pkg = require("../package.json");
    window.chrome = { runtime: { getURL: (path) => "moz-extension://speeder/" + path } };
    window.fetch = vi.fn(async () => ({ ok: true, json: async () => bundle }));
    evaluateScript("extension/shared/ui-icons.js");
    evaluateScript("extension/options/lucide-client.js");
    expect(window.fetch).not.toHaveBeenCalled();
    expect(bundle.version).toBe(pkg.devDependencies["lucide-static"]);
    expect(bundle.version).toBe(window.LUCIDE_STATIC_VERSION);
    const [tags, svg] = await Promise.all([
      window.getLucideTagsMap(), window.fetchLucideSvg("Alarm-Clock")
    ]);
    expect(tags).toEqual(bundle.tags);
    expect(svg).toBe(bundle.icons["alarm-clock"]);
    expect(window.lucideIconSvgUrl("alarm-clock")).toBe(
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
    );
    expect(window.lucideIconSvgUrl("bad slug!!")).toBe("");
    await expect(window.fetchLucideSvg("../evil")).rejects.toThrow("Invalid icon name");
    await expect(window.fetchLucideSvg("does-not-exist")).rejects.toThrow("Icon not found");
    await expect(window.fetchLucideSvg("constructor")).rejects.toThrow("Icon not found");
    expect(window.lucideIconSvgUrl("constructor")).toBe("");
    await window.getLucideTagsMap();
    expect(window.fetch).toHaveBeenCalledTimes(1);
    expect(window.fetch.mock.calls[0][0]).toBe("moz-extension://speeder/options/vendor/lucide-icons.json");
  });

  it("sanitizes SVG before persisting a Lucide icon", () => {
    loadHtmlString("<!doctype html><html><body></body></html>");
    evaluateScript("extension/shared/ui-icons.js");
    evaluateScript("extension/options/lucide-client.js");

    const sanitized = window.sanitizeLucideSvg(`
      <svg width="10" height="10" onclick="evil()">
        <script>alert(1)</script>
        <foreignObject>bad</foreignObject>
        <image href="https://tracking.example/icon.png"></image>
        <use href="https://tracking.example/sprite.svg#icon"></use>
        <animate attributeName="opacity" values="0;1"></animate>
        <path style="fill: url(https://tracking.example/a)" fill="url(#paint)" d="M0 0h10v10"></path>
      </svg>
    `);

    expect(sanitized).toContain("<svg");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("foreignObject");
    expect(sanitized).not.toContain("tracking.example");
    expect(sanitized).not.toContain("<image");
    expect(sanitized).not.toContain("<use");
    expect(sanitized).not.toContain("<animate");
    expect(sanitized).not.toContain("style=");
    expect(sanitized).not.toContain("url(");
    expect(sanitized).toContain('width="100%"');
  });

  it("searches and ranks icon slugs by query", () => {
    loadHtmlString("<!doctype html><html><body></body></html>");
    evaluateScript("extension/shared/ui-icons.js");
    evaluateScript("extension/options/lucide-client.js");

    const results = window.searchLucideSlugs(
      {
        alarm: ["clock", "time"],
        "badge-alert": ["alert", "warning"],
        calendar: ["date", "time"]
      },
      "al",
      10
    );

    expect(results).toEqual(["alarm", "badge-alert", "calendar"]);
  });
});
