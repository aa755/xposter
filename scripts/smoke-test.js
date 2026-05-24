const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

const manifest = readJson("manifest.json");
const pkg = readJson("package.json");
const defaultMessages = readJson("_locales/en/messages.json");
const manifestMessage = (value) => {
  const match = String(value || "").match(/^__MSG_([A-Za-z0-9_]+)__$/);
  if (!match) return value;
  return defaultMessages[match[1]]?.message || value;
};

assert.equal(manifest.manifest_version, 3, "manifest must be MV3");
assert.equal(manifest.default_locale, "en", "manifest must declare a default locale");
assert.equal(manifestMessage(manifest.name), "xPoster", "manifest name must resolve to xPoster");
assert.equal(pkg.version.replace(/\.0$/, ""), manifest.version, "package and manifest versions must match");

const requiredFiles = [
  "sidepanel.html",
  "sidepanel.css",
  "sidepanel.js",
  "diagnostics.html",
  "diagnostics.css",
  "diagnostics.js",
  "src/background.js",
  "src/content.js",
  "src/main-world.js",
  "src/shared.js",
  "fixtures/live-x-smoke.md",
  "README.zh-CN.md",
  "docs/usage.md",
  "docs/usage.zh-CN.md",
  "docs/privacy.md",
  "docs/privacy.zh-CN.md",
  "docs/images/buy-me-a-coffee-qr.png",
  "assets/icon-16.png",
  "assets/icon-32.png",
  "assets/icon-48.png",
  "assets/icon-128.png"
];

for (const file of requiredFiles) {
  assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
}

for (const contentScript of manifest.content_scripts || []) {
  for (const file of contentScript.js || []) {
    assert.ok(fs.existsSync(path.join(root, file)), `content script ${file} is missing`);
  }
}

for (const resourceGroup of manifest.web_accessible_resources || []) {
  for (const file of resourceGroup.resources || []) {
    assert.ok(fs.existsSync(path.join(root, file)), `web resource ${file} is missing`);
  }
}

const shared = require(path.join(root, "src/shared.js"));
const fixture = fs.readFileSync(path.join(root, "fixtures/live-x-smoke.md"), "utf8");
const parsed = shared.parseMarkdown(fixture);
const counts = shared.segmentCounts(parsed.segments);
const plan = shared.buildPastePlan(parsed.segments);
const remoteImageDraft = "Before\n\n![remote cover](https://images.example.test/path/cover.png)\n\nAfter";
const remoteImageParsed = shared.parseMarkdown(remoteImageDraft);
const failedRemoteImageMap = new Map(
  remoteImageParsed.segments
    .filter((segment) => segment.type === "image")
    .map((segment) => [segment, { ok: false, permissionRequired: true, error: "Chrome permission required" }])
);
const remoteFallbackPlan = shared.buildPastePlan(remoteImageParsed.segments, failedRemoteImageMap);
const frontmatterOnlyCoverDraft = [
  "---",
  "title: Cover only",
  "cover: https://images.example.test/path/cover.png",
  "---",
  "",
  "Body without a repeated image."
].join("\n");
const frontmatterOnlyCoverParsed = shared.parseMarkdown(frontmatterOnlyCoverDraft);
const coverOnlyPlan = shared.buildPastePlan(
  frontmatterOnlyCoverParsed.segments,
  new Map(),
  new Map(),
  {
    coverSource: frontmatterOnlyCoverParsed.cover,
    coverResult: {
      ok: true,
      base64: "AA==",
      mime: "image/png",
      fileName: "cover.png"
    }
  }
);
const contentScriptText = fs.readFileSync(path.join(root, "src/content.js"), "utf8");
const statusHelperStart = contentScriptText.indexOf("  function normalizeText");
const statusHelperEnd = contentScriptText.indexOf("  function showStatus");
const statusSandbox = {
  document: { body: {}, documentElement: {} },
  getComputedStyle: () => ({ backgroundColor: "rgb(18, 26, 34)" }),
  window: { matchMedia: () => ({ matches: false }) }
};

assert.ok(statusHelperStart >= 0 && statusHelperEnd > statusHelperStart, "status helper functions should be present");
vm.runInNewContext(
  `${contentScriptText.slice(statusHelperStart, statusHelperEnd)}; this.statusHelpers = { statusThemeFromPage, statusProgressForText };`,
  statusSandbox
);

assert.equal(parsed.title, "xPoster live smoke test", "frontmatter title should parse");
assert.ok(parsed.cover, "cover should parse");
assert.ok(counts.image >= 1, "fixture should include an image");
assert.ok(counts.table >= 1, "fixture should include a table");
assert.ok(counts.tweet >= 1, "fixture should include a tweet");
assert.ok(counts.code >= 1, "fixture should include a code block");
assert.ok(counts.divider >= 1, "fixture should include a divider");
assert.ok(plan.html.includes("__XPOSTER_"), "paste plan should include replacement markers");
assert.ok(
  remoteFallbackPlan.plain.includes("![remote cover](https://images.example.test/path/cover.png)"),
  "failed remote images should remain as Markdown image links"
);
assert.ok(
  !remoteFallbackPlan.plain.includes("Chrome permission required"),
  "failed remote image fallback should not write internal permission errors into the article"
);
assert.ok(
  contentScriptText.includes('showStatus(formatCompletionMessage(summary), "done", 7000)'),
  "successful Markdown writes should finish with a done status even when images stay as links"
);
assert.ok(
  contentScriptText.includes("uploadDroppedImageUrl"),
  "content script should upload dropped web image URLs instead of only showing a drop hint"
);
assert.ok(
  contentScriptText.includes('data-slot="image"'),
  "drop hint should expose an image drop mode"
);
assert.equal(statusSandbox.statusHelpers.statusThemeFromPage(), "dark", "status overlay should detect a dark host surface");
assert.equal(
  statusSandbox.statusHelpers.statusProgressForText("Preparing Markdown...", "work"),
  6,
  "status background progress should begin during preparation"
);
assert.equal(
  statusSandbox.statusHelpers.statusProgressForText("Uploading image 1/1...", "work"),
  80,
  "the final image upload should leave room for final writing steps"
);
assert.equal(
  statusSandbox.statusHelpers.statusProgressForText("Cleaning up import markers...", "work"),
  96,
  "cleanup should display near-complete progress"
);
assert.equal(
  statusSandbox.statusHelpers.statusProgressForText("Article written.", "done"),
  100,
  "completed status should fill the status background"
);
assert.ok(
  fs.readFileSync(path.join(root, "src/main-world.js"), "utf8").includes("uploadFilesToEditor"),
  "main-world bridge should hand dropped image files to X's own uploader"
);
assert.ok(
  coverOnlyPlan.plan.some(
    (item) =>
      item.op.type === "image" &&
      item.op.coverOnly === true &&
      item.op.source === "https://images.example.test/path/cover.png"
  ),
  "frontmatter-only cover should create a temporary cover upload operation"
);
assert.ok(
  !coverOnlyPlan.plain.includes("![cover]"),
  "frontmatter-only cover placeholder should not add visible Markdown image text"
);

const readText = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const readme = readText("README.md");
const readmeZh = readText("README.zh-CN.md");
const usageZh = readText("docs/usage.zh-CN.md");
const allPublicText = [
  "README.md",
  "README.zh-CN.md",
  "docs/usage.md",
  "docs/usage.zh-CN.md",
  "docs/privacy.md",
  "docs/privacy.zh-CN.md",
  "manifest.json",
  "sidepanel.js"
]
  .map(readText)
  .join("\n");

assert.ok(
  readme.includes("https://chromewebstore.google.com/detail/xposter/iimkimodgdjnnmdopeolboakhjmhfbbj"),
  "English README should recommend the Chrome Web Store listing"
);
assert.ok(readmeZh.includes("Chrome Web Store"), "Chinese README should mention Chrome Web Store");
assert.ok(usageZh.includes("添加至 Chrome"), "Chinese usage guide should explain store installation");
assert.ok(readmeZh.includes("https://x.com/xiaoxiaodong01"), "Chinese README should include author contact");
assert.ok(
  readme.includes("docs/images/buy-me-a-coffee-qr.png"),
  "English README should include the support QR code"
);
assert.ok(
  readmeZh.includes("docs/images/buy-me-a-coffee-qr.png"),
  "Chinese README should include the support QR code"
);
assert.ok(
  !/https:\/\/[^\s"']*cos\.ap-guangzhou\.myqcloud\.com/.test(allPublicText),
  "private image host must not be exposed"
);

console.log("xPoster smoke test passed");
