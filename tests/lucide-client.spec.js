const {
  evaluateScript,
  loadHtmlString
} = require("./helpers/extension-test-utils");

describe("lucide-client.js", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("builds icon URLs and rejects invalid slugs", () => {
    loadHtmlString("<!doctype html><html><body></body></html>");
    evaluateScript("extension/shared/ui-icons.js");
    evaluateScript("extension/options/lucide-client.js");

    expect(window.lucideIconSvgUrl("alarm-clock")).toContain(
      "/icons/alarm-clock.svg"
    );
    expect(window.lucideIconSvgUrl("bad slug!!")).toBe("");
    expect(window.lucideTagsJsonUrl()).toContain("/tags.json");
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
