const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const readText = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function fail(message) {
  console.error(`i18n check failed: ${message}`);
  process.exitCode = 1;
}

function decodeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&#10;/g, "\n")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function decodeJsString(value) {
  try {
    return JSON.parse(`"${String(value || "").replace(/"/g, "\\\"")}"`);
  } catch {
    return String(value || "");
  }
}

function messageKeys(locale) {
  return new Set(Object.keys(readJson(`_locales/${locale}/messages.json`)));
}

const localeDirs = fs
  .readdirSync(path.join(root, "_locales"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const enLocaleKeys = messageKeys("en");
for (const locale of localeDirs.filter((locale) => locale !== "en")) {
  const localeKeys = messageKeys(locale);
  for (const key of enLocaleKeys) {
    if (!localeKeys.has(key)) fail(`_locales/${locale}/messages.json is missing "${key}"`);
  }
  for (const key of localeKeys) {
    if (!enLocaleKeys.has(key)) fail(`_locales/en/messages.json is missing "${key}"`);
  }
}

const manifest = readJson("manifest.json");
if (manifest.default_locale !== "en") fail("manifest.json must set default_locale to en");

const manifestText = readText("manifest.json");
for (const [, key] of manifestText.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
  if (!enLocaleKeys.has(key)) fail(`manifest references missing locale message "${key}"`);
}

const runtimeText = `${readText("sidepanel.js")}\n${readText("diagnostics.js")}`;
const i18nText = readText("src/i18n.js");
const runtimeKeys = new Set();
for (const [, key] of runtimeText.matchAll(/"([^"\n]+)"\s*:\s*"[^"]*"/g)) {
  runtimeKeys.add(decodeJsString(key));
}
for (const [, key] of runtimeText.matchAll(/^\s*([A-Za-z][A-Za-z0-9_ ]*)\s*:\s*"[^"]*"/gm)) {
  runtimeKeys.add(key.trim());
}
for (const key of enLocaleKeys) runtimeKeys.add(key);

const htmlText = `${readText("sidepanel.html")}\n${readText("diagnostics.html")}`;
const htmlI18nKeys = new Set();
for (const [, rawKey] of htmlText.matchAll(/\bdata-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
  htmlI18nKeys.add(decodeHtmlAttribute(rawKey));
}

for (const key of htmlI18nKeys) {
  if (!runtimeKeys.has(key)) fail(`HTML references missing runtime i18n key "${key.replace(/\n/g, "\\n")}"`);
}

if (!/src="src\/i18n\.js"[\s\S]*src="sidepanel\.js"/.test(readText("sidepanel.html"))) {
  fail("sidepanel.html must load src/i18n.js before sidepanel.js");
}
if (!/src="src\/i18n\.js"[\s\S]*src="diagnostics\.js"/.test(readText("diagnostics.html"))) {
  fail("diagnostics.html must load src/i18n.js before diagnostics.js");
}
if (!/src="src\/shared\.js"[\s\S]*src="src\/i18n\.js"[\s\S]*src="diagnostics\.js"/.test(readText("diagnostics.html"))) {
  fail("diagnostics.html must load src/shared.js before src/i18n.js and diagnostics.js");
}

for (const language of ["zh-TW", "ja", "fr", "ru"]) {
  if (!i18nText.includes(`code: "${language}"`)) {
    fail(`src/i18n.js must expose ${language} as a selectable language`);
  }
}
if (!i18nText.includes("AUTO_LANGUAGE") || !i18nText.includes("normalizeLanguagePreference")) {
  fail("src/i18n.js must support an automatic browser-language preference");
}
if (!i18nText.includes("LANGUAGE_FALLBACKS") || !i18nText.includes("toTraditionalChinese")) {
  fail("src/i18n.js must provide zh-TW runtime fallback through Traditional Chinese conversion");
}
if (!runtimeText.includes('"zh-TW"')) {
  fail("runtime UI messages must register zh-TW translations");
}

if (!process.exitCode) {
  console.log(`i18n check passed (${htmlI18nKeys.size} HTML runtime keys, ${enLocaleKeys.size} Chrome locale keys)`);
}
