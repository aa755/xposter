#!/usr/bin/env node
/*
 * Create, inspect, and optionally publish X Article drafts through the official
 * X API. The default operation is deliberately conservative: it creates a draft
 * only. Publishing requires --publish, or --publish-existing for a draft that
 * was already reviewed in the browser.
 *
 * Typical workflows:
 *   X_CLIENT_ID=... node scripts/upload-x-article.js --test-draft
 *   node scripts/upload-x-article.js article.md \
 *     --prepare-markdown \
 *     --base-url https://example.com/blog/post/ \
 *     --output article.xposter.md
 *   node scripts/upload-x-article.js article.md --dry-run --output payload.json
 *   node scripts/upload-x-article.js article.md \
 *     --preprocess \
 *     --base-url https://example.com/blog/post/ \
 *     --upload-images \
 *     --open-draft
 *   node scripts/upload-x-article.js article.md \
 *     --preprocess \
 *     --base-url https://example.com/blog/post/ \
 *     --upload-images \
 *     --publish
 *
 * Markdown and formatting:
 *   - The script parses Markdown through xPoster's shared parser and converts
 *     it into X's Draft.js-shaped Article payload.
 *   - Code blocks and tables are sent as Markdown blocks by default. X accepts
 *     these as Article "link" entities with data.markdown. The optional
 *     --render-special-blocks-as-images mode is only for non-interactive blocks;
 *     linked tables always stay as Markdown so their links are not destroyed.
 *   - Use --preprocess to prepare Markdown around parsing. That strips HTML
 *     comments before parsing, then normalizes fence language aliases such as
 *     c++ -> cpp, converts inline code spans to Unicode monospace text, and can
 *     rewrite Markdown links/images after parsing.
 *
 * Assets and links:
 *   - --base-url only has an effect with --preprocess. It rewrites relative
 *     Markdown links and image sources in the input document to absolute URLs.
 *   - --upload-images uploads Markdown image sources by bytes. http:// and
 *     https:// images are downloaded first. Local image files are read directly:
 *     relative paths resolve from the Markdown file's directory, /absolute paths
 *     are used as-is, ~/ paths resolve from the home directory, and file:// URLs
 *     are decoded with Node's file URL handling.
 *   - Linked HTML pages are treated as ordinary links. This script does not
 *     fetch sibling HTML pages or rewrite relative links/assets inside those
 *     pages. If a Markdown link points to appendix.html, use --preprocess
 *     --base-url so X receives a public absolute URL, and make sure that hosted
 *     HTML page itself resolves its own relative assets correctly.
 *   - Before any API call, the script warns about links that X readers cannot
 *     resolve and image sources that --upload-images cannot read or download.
 *
 * Authentication:
 *   - Tested setup: go to https://developer.x.com/, create a project/app if you
 *     do not already have one, and add API credits/billing. In the session that
 *     produced this script, Article API calls did not work until paid credits
 *     were added.
 *   - In the app's user-auth settings, enable OAuth 2.0 with write-capable
 *     permissions. Add this callback/redirect URL exactly:
 *       http://127.0.0.1:8765/callback
 *     You normally should not change it. Only pick another localhost URL if
 *     port 8765 is already in use, and then pass the same value to this script
 *     with --redirect-uri.
 *   - Get the app's OAuth2 Client ID from the Developer Portal app settings and
 *     pass it as --client-id, X_CLIENT_ID, or TWITTER_CLIENT_ID. The script will
 *     open the browser for approval, then cache the access/refresh tokens at
 *     ~/.config/xposter/x-oauth-token.json by default.
 *   - Reuse path: after the tested OAuth flow has cached tokens, rerun the
 *     script without --client-id. It reads the cache and refreshes the access
 *     token when needed.
 *   - Untested escape hatch: X_BEARER_TOKEN or TWITTER_BEARER_TOKEN may be set
 *     to an existing user OAuth access token with the required scopes. This is
 *     intentionally not an app-only bearer token.
 *   - Untested optional path: X_CLIENT_SECRET or TWITTER_CLIENT_SECRET may be
 *     supplied for a confidential OAuth client.
 *
 * API calls:
 *   - Create draft: POST https://api.x.com/2/articles/draft
 *   - Publish:      POST https://api.x.com/2/articles/{article_id}/publish
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { fileURLToPath } = require("node:url");

const shared = require("../src/shared.js");

const API_BASE_URL = "https://api.x.com";
const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const DEFAULT_REDIRECT_URI = "http://127.0.0.1:8765/callback";
const DEFAULT_SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"];
const DEFAULT_TOKEN_FILE = path.join(os.homedir(), ".config", "xposter", "x-oauth-token.json");
const VALID_BLOCK_TYPES = new Set([
  "unstyled",
  "header-one",
  "header-two",
  "header-three",
  "unordered-list-item",
  "ordered-list-item",
  "blockquote",
  "atomic"
]);
const STYLE_MAP = {
  Bold: "bold",
  Italic: "italic",
  Strikethrough: "strikethrough",
  Code: ""
};
const MONO_UPPER_A = 0x1d670;
const MONO_LOWER_A = 0x1d68a;
const MONO_DIGIT_0 = 0x1d7f6;
const FENCE_OPEN_RE = /^([ \t]{0,3})(`{3,}|~{3,})([^\n]*)$/;
const LANGUAGE_ALIASES = new Map(Object.entries({
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  "h++": "cpp",
  hh: "cpp",
  hpp: "cpp",
  "c#": "csharp",
  cs: "csharp",
  "f#": "fsharp",
  fs: "fsharp",
  fsi: "fsharp",
  fsx: "fsharp",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  node: "javascript",
  ts: "typescript",
  py: "python",
  py3: "python",
  python3: "python",
  rb: "ruby",
  rs: "rust",
  golang: "go",
  kt: "kotlin",
  kts: "kotlin",
  objc: "objectivec",
  "objective-c": "objectivec",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  terminal: "bash",
  console: "bash",
  ps1: "powershell",
  yml: "yaml",
  docker: "dockerfile",
  make: "makefile",
  mk: "makefile",
  md: "markdown"
}));

function usage() {
  return `Usage:
  node scripts/upload-x-article.js --test-draft [options]
  node scripts/upload-x-article.js article.md [options]

Options:
  --title TITLE                  Override the article title.
  --body TEXT                    Body for a small manual draft, instead of reading a file.
  --test-draft                   Upload a tiny draft for API/auth validation.
  --dry-run                      Build the payload but do not call X.
  --output FILE                  Write the built payload or API response JSON.
  --prepare-markdown             Write prepared Markdown for xPoster and do not call X.
  --preprocess                   Prepare Markdown around parsing.
  --base-url URL                 Base URL used to resolve relative links/images when preprocessing.
  --h3-as-bold                   Convert H3 headings to bold paragraphs when preprocessing.
  --smart-punctuation            Enable xPoster's smart punctuation parser option.
  --plain-special-blocks         Convert code/table/tweet/divider blocks to plain text.
  --render-special-blocks-as-images
                                  Optional fallback: render code/plain tables as PNG images.
  --upload-images                Upload http(s) and local Markdown images as Article image entities.
  --skip-media                   Convert image blocks to Markdown text. Default behavior.
  --markdown-entity-type TYPE    Entity type for code/table Markdown atomics. Default: link.
  --chrome-path PATH             Chrome binary for --render-special-blocks-as-images.
  --publish                      Publish the created draft Article after creation.
  --publish-existing ARTICLE_ID  Publish an existing draft Article without creating a new draft.
  --open-draft                   Open the created draft in Chrome/default browser after creation.
  --client-id ID                 OAuth2 client ID. Also reads X_CLIENT_ID or TWITTER_CLIENT_ID.
  --client-secret SECRET         Optional OAuth2 client secret. Also reads X_CLIENT_SECRET/TWITTER_CLIENT_SECRET.
  --redirect-uri URI             OAuth2 callback URL. Default: ${DEFAULT_REDIRECT_URI}
  --scope "a b c"                OAuth2 scopes. Default: ${DEFAULT_SCOPES.join(" ")}
  --token-file FILE              OAuth token cache. Default: ${DEFAULT_TOKEN_FILE}
  --force-auth                   Ignore cached refresh/access token and run browser auth.
  --no-open                      Print auth URL instead of opening a browser.
  --help                         Show this help.

By default this script only creates drafts. Use --publish only after reviewing
the generated draft.`;
}

function parseArgs(argv) {
  const args = {
    input: "",
    title: "",
    body: "",
    testDraft: false,
    dryRun: false,
    output: "",
    prepareMarkdown: false,
    preprocess: false,
    baseUrl: "",
    h3AsBold: false,
    smartPunctuation: false,
    plainSpecialBlocks: false,
    renderSpecialBlocksAsImages: false,
    skipMedia: true,
    markdownEntityType: process.env.X_ARTICLE_MARKDOWN_ENTITY_TYPE || "link",
    chromePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    publish: false,
    publishExisting: "",
    openDraft: false,
    clientId: process.env.X_CLIENT_ID || process.env.TWITTER_CLIENT_ID || "",
    clientSecret: process.env.X_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET || "",
    redirectUri: process.env.X_REDIRECT_URI || process.env.TWITTER_REDIRECT_URI || DEFAULT_REDIRECT_URI,
    scope: process.env.X_OAUTH_SCOPE || DEFAULT_SCOPES.join(" "),
    tokenFile: process.env.X_TOKEN_FILE || DEFAULT_TOKEN_FILE,
    forceAuth: false,
    openBrowser: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };

    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (arg === "--title") args.title = next();
    else if (arg === "--body") args.body = next();
    else if (arg === "--test-draft") args.testDraft = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--output" || arg === "-o") args.output = next();
    else if (arg === "--prepare-markdown") args.prepareMarkdown = true;
    else if (arg === "--preprocess") args.preprocess = true;
    else if (arg === "--base-url") args.baseUrl = next();
    else if (arg === "--h3-as-bold") args.h3AsBold = true;
    else if (arg === "--smart-punctuation") args.smartPunctuation = true;
    else if (arg === "--plain-special-blocks") args.plainSpecialBlocks = true;
    else if (arg === "--render-special-blocks-as-images") args.renderSpecialBlocksAsImages = true;
    else if (arg === "--upload-images") args.skipMedia = false;
    else if (arg === "--skip-media") args.skipMedia = true;
    else if (arg === "--markdown-entity-type") args.markdownEntityType = next();
    else if (arg === "--chrome-path") args.chromePath = next();
    else if (arg === "--publish") args.publish = true;
    else if (arg === "--publish-existing") args.publishExisting = next();
    else if (arg === "--open-draft") args.openDraft = true;
    else if (arg === "--client-id") args.clientId = next();
    else if (arg === "--client-secret") args.clientSecret = next();
    else if (arg === "--redirect-uri") args.redirectUri = next();
    else if (arg === "--scope") args.scope = next();
    else if (arg === "--token-file") args.tokenFile = next();
    else if (arg === "--force-auth") args.forceAuth = true;
    else if (arg === "--no-open") args.openBrowser = false;
    else if (arg === "-" && !args.input) args.input = arg;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (!args.input) args.input = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  if (args.prepareMarkdown) args.preprocess = true;
  return args;
}

function readInputMarkdown(args) {
  if (args.testDraft) {
    return [
      "# xPoster API draft test",
      "",
      `API draft test from xPoster at ${new Date().toISOString()}.`,
      "",
      "Do not publish."
    ].join("\n");
  }
  if (args.body) return args.title ? `# ${args.title}\n\n${args.body}` : args.body;
  if (!args.input || args.input === "-") return fs.readFileSync(0, "utf8");
  return fs.readFileSync(args.input, "utf8");
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fenceCloseRe(marker) {
  return new RegExp(`^[ \\t]{0,3}${regexEscape(marker[0])}{${marker.length},}[ \\t]*$`);
}

function stripLineEnd(value) {
  return String(value).replace(/[\n\r]+$/g, "");
}

function stripHtmlCommentsOutsideFences(markdown) {
  const lines = String(markdown ?? "").match(/[^\n]*\n|[^\n]+$/g) || [];
  const output = [];
  let inFence = false;
  let closeRe = null;
  let inComment = false;

  for (const originalLine of lines) {
    const lineForMatch = stripLineEnd(originalLine);

    if (inFence) {
      output.push(originalLine);
      if (closeRe?.test(lineForMatch)) {
        inFence = false;
        closeRe = null;
      }
      continue;
    }

    const opener = lineForMatch.match(FENCE_OPEN_RE);
    if (opener) {
      output.push(originalLine);
      inFence = true;
      closeRe = fenceCloseRe(opener[2]);
      continue;
    }

    let rebuilt = "";
    let cursor = 0;
    while (cursor < originalLine.length) {
      if (inComment) {
        const end = originalLine.indexOf("-->", cursor);
        if (end < 0) break;
        cursor = end + 3;
        inComment = false;
        continue;
      }

      const start = originalLine.indexOf("<!--", cursor);
      if (start < 0) {
        rebuilt += originalLine.slice(cursor);
        break;
      }

      rebuilt += originalLine.slice(cursor, start);
      const end = originalLine.indexOf("-->", start + 4);
      if (end < 0) {
        inComment = true;
        break;
      }
      cursor = end + 3;
    }
    output.push(rebuilt);
  }

  const stripped = output.join("");
  return `${stripped.trim()}\n`;
}

function maybePrepareMarkdownBeforeParse(markdown, args) {
  if (!args.preprocess) return markdown;
  return stripHtmlCommentsOutsideFences(markdown);
}

function monospaceText(value) {
  let output = "";
  for (const char of String(value ?? "")) {
    if (char >= "A" && char <= "Z") output += String.fromCodePoint(MONO_UPPER_A + char.charCodeAt(0) - 65);
    else if (char >= "a" && char <= "z") output += String.fromCodePoint(MONO_LOWER_A + char.charCodeAt(0) - 97);
    else if (char >= "0" && char <= "9") output += String.fromCodePoint(MONO_DIGIT_0 + char.charCodeAt(0) - 48);
    else if (char === "*") output += "\u2217";
    else output += char;
  }
  return output;
}

function normalizeBaseUrl(baseUrl) {
  const value = String(baseUrl || "").trim();
  if (!value) return "";
  return value.endsWith("/") ? value : `${value}/`;
}

function isAbsoluteOrSpecialTarget(target) {
  const value = String(target || "").trim();
  return Boolean(
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) ||
      value.startsWith("#") ||
      value.startsWith("//")
  );
}

function rewriteTargetWithBase(target, baseUrl) {
  const value = String(target || "").trim();
  const base = normalizeBaseUrl(baseUrl);
  if (!base || isAbsoluteOrSpecialTarget(value)) return value;
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
}

function rewriteMarkdownLinkTargets(value, baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return String(value || "");
  return String(value || "").replace(/(!?\[[^\]]*\]\()([^)]+)(\))/g, (match, prefix, target, suffix) => {
    return `${prefix}${rewriteTargetWithBase(target, base)}${suffix}`;
  });
}

function hasMarkdownLink(value) {
  return /\[[^\]]+\]\([^)]+\)/.test(String(value || ""));
}

function tableHasMarkdownLinks(table) {
  return [
    ...(table.headers || []),
    ...(table.rows || []).flat()
  ].some(hasMarkdownLink);
}

function shouldRenderSpecialBlockAsImage(segment) {
  if (segment.type === "code") return true;
  if (segment.type === "table") return !tableHasMarkdownLinks(segment);
  return false;
}

function normalizeLanguageLabel(language) {
  const value = String(language || "");
  const trimmed = value.trim();
  if (!trimmed) return value;
  const [label, ...rest] = trimmed.split(/\s+/);
  const normalized = LANGUAGE_ALIASES.get(label.toLowerCase()) || label;
  return [normalized, ...rest].join(" ");
}

function findBacktickCodeReplacements(text, occupiedRanges = []) {
  const replacements = [];
  let cursor = 0;
  const overlapsOccupied = (start, end) =>
    occupiedRanges.some((range) => start < range.end && end > range.start);

  while (cursor < text.length) {
    const start = text.indexOf("`", cursor);
    if (start < 0) break;

    let markerEnd = start;
    while (markerEnd < text.length && text[markerEnd] === "`") markerEnd += 1;
    const marker = text.slice(start, markerEnd);
    const end = text.indexOf(marker, markerEnd);
    if (end < 0) break;

    const replacementEnd = end + marker.length;
    if (!overlapsOccupied(start, replacementEnd)) {
      replacements.push({
        start,
        end: replacementEnd,
        text: monospaceText(text.slice(markerEnd, end))
      });
    }
    cursor = replacementEnd;
  }

  return replacements;
}

function applyTextReplacements(segment, replacements, { dropCodeRanges = false } = {}) {
  const text = String(segment.text || "");
  const sorted = replacements
    .filter((replacement) => replacement.end > replacement.start)
    .sort((left, right) => left.start - right.start);
  if (!sorted.length) return segment;

  let nextText = "";
  let cursor = 0;
  for (const replacement of sorted) {
    if (replacement.start < cursor) continue;
    nextText += text.slice(cursor, replacement.start);
    nextText += replacement.text;
    cursor = replacement.end;
  }
  nextText += text.slice(cursor);

  const mapPosition = (position, preferEnd = false) => {
    let delta = 0;
    for (const replacement of sorted) {
      if (position < replacement.start) break;
      const oldLength = replacement.end - replacement.start;
      const newLength = replacement.text.length;
      if (position > replacement.start && position < replacement.end) {
        return replacement.start + delta + (preferEnd ? newLength : 0);
      }
      if (position === replacement.start) return replacement.start + delta;
      delta += newLength - oldLength;
    }
    return position + delta;
  };

  const inlineStyleRanges = (segment.inlineStyleRanges || [])
    .filter((range) => !dropCodeRanges || range.style !== "Code")
    .map((range) => {
      const start = mapPosition(range.offset);
      const end = mapPosition(range.offset + range.length, true);
      return { ...range, offset: start, length: Math.max(0, end - start) };
    })
    .filter((range) => range.length > 0);
  const links = (segment.links || [])
    .map((link) => {
      const start = mapPosition(link.offset);
      const end = mapPosition(link.offset + link.length, true);
      return { ...link, offset: start, length: Math.max(0, end - start) };
    })
    .filter((link) => link.length > 0);

  return { ...segment, text: nextText, inlineStyleRanges, links };
}

function transformInlineCodeInTextSegment(segment) {
  const text = String(segment.text || "");
  const codeRanges = (segment.inlineStyleRanges || [])
    .filter((range) => range.style === "Code" && range.length > 0)
    .map((range) => ({
      start: range.offset,
      end: range.offset + range.length,
      text: monospaceText(text.slice(range.offset, range.offset + range.length))
    }));
  const backtickReplacements = findBacktickCodeReplacements(text, codeRanges);
  return applyTextReplacements(segment, [...codeRanges, ...backtickReplacements], { dropCodeRanges: true });
}

function convertMarkdownInlineCodeText(value) {
  const segment = {
    type: "text",
    kind: "unstyled",
    text: String(value || ""),
    inlineStyleRanges: [],
    links: []
  };
  return transformInlineCodeInTextSegment(segment).text;
}

function prepareMarkdownCell(value, args) {
  return rewriteMarkdownLinkTargets(convertMarkdownInlineCodeText(value), args.baseUrl);
}

function maybePostprocessParsed(parsed, args) {
  if (!args.preprocess) return parsed;

  const segments = (parsed.segments || []).map((segment) => {
    if (segment.type === "text") {
      let next = transformInlineCodeInTextSegment(segment);
      if (args.baseUrl) {
        next = {
          ...next,
          links: (next.links || []).map((link) => ({ ...link, url: rewriteTargetWithBase(link.url, args.baseUrl) }))
        };
      }
      if (args.h3AsBold && next.kind === "header-three") {
        const existing = next.inlineStyleRanges || [];
        next = {
          ...next,
          kind: "unstyled",
          inlineStyleRanges: [{ offset: 0, length: next.text.length, style: "Bold" }, ...existing]
        };
      }
      return next;
    }

    if (segment.type === "image") {
      return {
        ...segment,
        alt: convertMarkdownInlineCodeText(segment.alt || ""),
        source: args.baseUrl ? rewriteTargetWithBase(segment.source, args.baseUrl) : segment.source
      };
    }

    if (segment.type === "code") {
      return { ...segment, language: normalizeLanguageLabel(segment.language) };
    }

    if (segment.type === "table") {
      return {
        ...segment,
        headers: (segment.headers || []).map((cell) => prepareMarkdownCell(cell, args)),
        rows: (segment.rows || []).map((row) => row.map((cell) => prepareMarkdownCell(cell, args)))
      };
    }

    return segment;
  });

  return { ...parsed, segments };
}

function markdownEscapeLinkTarget(value) {
  return String(value ?? "").replace(/\)/g, "%29");
}

function insertMarkdownWrappers(text, wrappers) {
  const inserts = new Map();
  const addInsert = (offset, value, order) => {
    if (!inserts.has(offset)) inserts.set(offset, []);
    inserts.get(offset).push({ value, order });
  };

  for (const wrapper of wrappers) {
    if (wrapper.length <= 0) continue;
    addInsert(wrapper.offset, wrapper.open, wrapper.openOrder);
    addInsert(wrapper.offset + wrapper.length, wrapper.close, wrapper.closeOrder);
  }

  let output = "";
  for (let index = 0; index <= text.length; index += 1) {
    const items = inserts.get(index);
    if (items) {
      items
        .sort((left, right) => left.order - right.order)
        .forEach((item) => {
          output += item.value;
        });
    }
    if (index < text.length) output += text[index];
  }
  return output;
}

function markdownInlineFromTextSegment(segment) {
  const text = String(segment.text || "");
  const wrappers = [];

  for (const link of segment.links || []) {
    wrappers.push({
      offset: link.offset,
      length: link.length,
      open: "[",
      close: `](${markdownEscapeLinkTarget(link.url)})`,
      openOrder: 30,
      closeOrder: 10
    });
  }

  for (const range of segment.inlineStyleRanges || []) {
    const style = range.style;
    const marker = style === "Bold" ? "**" : style === "Italic" ? "*" : style === "Strikethrough" ? "~~" : "";
    if (!marker) continue;
    wrappers.push({
      offset: range.offset,
      length: range.length,
      open: marker,
      close: marker,
      openOrder: 20,
      closeOrder: 20
    });
  }

  return insertMarkdownWrappers(text, wrappers);
}

function preparedTextSegmentToMarkdown(segment) {
  const value = markdownInlineFromTextSegment(segment);
  if (!value) return "";

  switch (segment.kind) {
    case "header-one":
      return `# ${value}`;
    case "header-two":
      return `## ${value}`;
    case "header-three":
      return `### ${value}`;
    case "header-four":
      return `#### ${value}`;
    case "header-five":
      return `##### ${value}`;
    case "header-six":
      return `###### ${value}`;
    case "blockquote":
      return value
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "unordered-list-item":
      return value
        .split("\n")
        .map((line, index) => (index === 0 ? `- ${line}` : `  ${line}`))
        .join("\n");
    case "ordered-list-item":
      return value
        .split("\n")
        .map((line, index) => (index === 0 ? `1. ${line}` : `   ${line}`))
        .join("\n");
    default:
      return value;
  }
}

function codeFenceMarkdown(segment) {
  const code = String(segment.code || "");
  const marker = code.includes("```") ? "~~~" : "```";
  return `${marker}${segment.language || ""}\n${code}\n${marker}`;
}

function preparedSegmentToMarkdown(segment) {
  if (segment.type === "text") return preparedTextSegmentToMarkdown(segment);
  if (segment.type === "image") return imageFallbackMarkdown(segment);
  if (segment.type === "code") return codeFenceMarkdown(segment);
  if (segment.type === "table") return tableToMarkdown(segment);
  if (segment.type === "tweet") return `https://x.com/i/web/status/${segment.tweetId}`;
  if (segment.type === "divider") return "---";
  return segmentFallbackText(segment);
}

function preparedMarkdownFromParsed(parsed, args) {
  const parts = [];
  const title = args.title || parsed.title || "";
  if (title) parts.push(`# ${title}`);

  for (const segment of parsed.segments || []) {
    const markdown = preparedSegmentToMarkdown(segment).trim();
    if (markdown) parts.push(markdown);
  }

  return `${parts.join("\n\n").trim()}\n`;
}

function writeTextOrPrint(value, outputPath) {
  if (outputPath) fs.writeFileSync(outputPath, value);
  else process.stdout.write(value);
}

function makeBlockKey(index) {
  const value = index.toString(36);
  return crypto
    .createHash("sha1")
    .update(`${Date.now()}:${process.pid}:${index}:${value}`)
    .digest("base64url")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 5)
    .padEnd(5, "0")
    .toLowerCase();
}

function makeTextBlock(segment, key) {
  const entityRanges = [];
  const entities = [];
  for (const link of segment.links || []) {
    const entityKey = entities.length;
    entities.push({
      key: String(entityKey),
      value: {
        type: "link",
        mutability: "mutable",
        data: { url: link.url }
      }
    });
    entityRanges.push({
      offset: link.offset,
      length: link.length,
      key: entityKey
    });
  }

  const inlineStyleRanges = (segment.inlineStyleRanges || [])
    .map((range) => ({
      offset: range.offset,
      length: range.length,
      style: Object.prototype.hasOwnProperty.call(STYLE_MAP, range.style) ? STYLE_MAP[range.style] : range.style
    }))
    .filter((range) => range.length > 0 && ["bold", "italic", "strikethrough"].includes(range.style));
  const block = {
    text: String(segment.text || ""),
    type: VALID_BLOCK_TYPES.has(segment.kind) ? segment.kind : "unstyled"
  };
  if (key) block.key = key;
  if (inlineStyleRanges.length) block.inline_style_ranges = inlineStyleRanges;
  if (entityRanges.length) block.entity_ranges = entityRanges;
  return { block, entities };
}

function makeAtomicBlock(entityType, data, key, entityKey) {
  const type = String(entityType || "").toLowerCase();
  return {
    block: {
      key,
      text: " ",
      type: "atomic",
      entity_ranges: [{ offset: 0, length: 1, key: entityKey }],
      data: {}
    },
    entity: {
      key: String(entityKey),
      value: {
        type,
        mutability: type === "link" ? "mutable" : "immutable",
        data
      }
    }
  };
}

function tableToMarkdown(table) {
  const lines = [];
  lines.push(`| ${table.headers.join(" | ")} |`);
  lines.push(
    `| ${table.alignments
      .map((alignment) => (alignment === "center" ? ":---:" : alignment === "right" ? "---:" : "---"))
      .join(" | ")} |`
  );
  for (const row of table.rows) lines.push(`| ${row.join(" | ")} |`);
  return lines.join("\n");
}

function imageFallbackMarkdown(segment) {
  const alt = String(segment.alt || "image").replace(/[\]\r\n]+/g, " ").trim() || "image";
  return `![${alt}](${segment.source || ""})`;
}

function mimeFromSource(source, fallback = "image/png") {
  const clean = String(source || "").split(/[?#]/)[0].toLowerCase();
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".bmp")) return "image/bmp";
  if (clean.endsWith(".tif") || clean.endsWith(".tiff")) return "image/tiff";
  return fallback;
}

function fileNameFromSource(source, fallback = "image.png") {
  try {
    const url = new URL(source);
    return path.basename(decodeURIComponent(url.pathname)) || fallback;
  } catch {
    return path.basename(String(source || "")) || fallback;
  }
}

function isHttpUrl(source) {
  return /^https?:\/\//i.test(String(source || "").trim());
}

function stripQueryAndHash(source) {
  return String(source || "").trim().split(/[?#]/)[0];
}

function inputBaseDirectory(args) {
  if (args.input && args.input !== "-") return path.dirname(path.resolve(args.input));
  return process.cwd();
}

function localImagePathFromSource(source, args) {
  const value = String(source || "").trim();
  if (!value || isHttpUrl(value) || value.startsWith("#") || value.startsWith("//")) return "";

  if (/^file:/i.test(value)) {
    try {
      return fileURLToPath(value);
    } catch {
      return "";
    }
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return "";

  const clean = stripQueryAndHash(value);
  if (clean.startsWith("~/")) return path.join(os.homedir(), clean.slice(2));
  if (path.isAbsolute(clean)) return clean;
  return path.resolve(inputBaseDirectory(args), clean);
}

function localImageExists(source, args) {
  const imagePath = localImagePathFromSource(source, args);
  if (!imagePath) return false;
  try {
    return fs.statSync(imagePath).isFile();
  } catch {
    return false;
  }
}

function htmlEscape(value) {
  return shared.escapeHtml(String(value ?? ""));
}

function tableSegmentToHtml(table) {
  const header = `<tr>${table.headers.map((cell) => `<th>${htmlEscape(cell)}</th>`).join("")}</tr>`;
  const rows = table.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${htmlEscape(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<table>${header}${rows}</table>`;
}

function specialBlockHtml(segment) {
  if (segment.type === "table") return tableSegmentToHtml(segment);
  if (segment.type === "code") {
    const language = segment.language ? `<div class="code-label">${htmlEscape(segment.language)}</div>` : "";
    return `${language}<pre><code>${htmlEscape(segment.code || "")}</code></pre>`;
  }
  return `<p>${htmlEscape(segmentFallbackText(segment))}</p>`;
}

function estimateSpecialBlockImageSize(segment) {
  const width = 1400;
  if (segment.type === "code") {
    const visualLines = String(segment.code || "")
      .split("\n")
      .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 100)), 0);
    return { width, height: Math.min(9000, Math.max(260, 120 + visualLines * 32)) };
  }
  if (segment.type === "table") {
    const columnCount = Math.max(1, segment.headers?.length || 1);
    const charsPerColumn = Math.max(18, Math.floor(95 / columnCount));
    const rows = [segment.headers || [], ...(segment.rows || [])];
    const visualRows = rows.reduce((sum, row) => {
      const rowLines = Math.max(
        1,
        ...row.map((cell) => Math.ceil(String(cell || "").length / charsPerColumn))
      );
      return sum + rowLines;
    }, 0);
    return { width, height: Math.min(9000, Math.max(260, 90 + visualRows * 34)) };
  }
  return { width, height: 360 };
}

function renderSpecialBlockImage(segment, args, index) {
  if (!fs.existsSync(args.chromePath)) {
    throw new Error(`Chrome binary not found: ${args.chromePath}`);
  }

  const { width, height } = estimateSpecialBlockImageSize(segment);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xposter-special-"));
  const htmlPath = path.join(tmpDir, `block-${index}.html`);
  const pngPath = path.join(tmpDir, `block-${index}.png`);
  const profilePath = path.join(tmpDir, "chrome-profile");
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #ffffff;
      color: #111827;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .frame {
      width: ${width}px;
      min-height: ${height}px;
      padding: 36px;
      background: #ffffff;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 22px;
      line-height: 1.38;
    }
    th, td {
      border: 2px solid #d1d5db;
      padding: 16px 18px;
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th {
      background: #f3f4f6;
      font-weight: 700;
    }
    tr:nth-child(odd) td {
      background: #fafafa;
    }
    .code-label {
      display: inline-block;
      margin-bottom: 12px;
      padding: 6px 12px;
      border-radius: 6px;
      background: #e5e7eb;
      color: #374151;
      font: 600 18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    pre {
      margin: 0;
      padding: 24px;
      border-radius: 8px;
      background: #111827;
      color: #f9fafb;
      font: 22px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  </style>
</head>
<body><div class="frame">${specialBlockHtml(segment)}</div></body>
</html>`;

  fs.writeFileSync(htmlPath, html);
  fs.mkdirSync(profilePath);
  const result = spawnSync(
    args.chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--disable-background-networking",
      "--hide-scrollbars",
      `--user-data-dir=${profilePath}`,
      `--screenshot=${pngPath}`,
      `--window-size=${width},${height}`,
      `file://${htmlPath}`
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 20000, killSignal: "SIGKILL" }
  );
  if (result.error && !(result.error.code === "ETIMEDOUT" && fs.existsSync(pngPath))) throw result.error;
  if (result.status !== 0 || !fs.existsSync(pngPath)) {
    if (result.error?.code === "ETIMEDOUT" && fs.existsSync(pngPath)) {
      // Chrome can leave a valid screenshot while failing to exit in headless
      // mode on macOS. The timeout kills the browser; the PNG is still usable.
    } else {
    throw new Error(`Chrome screenshot failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    }
  }

  const buffer = fs.readFileSync(pngPath);
  return {
    buffer,
    base64: buffer.toString("base64"),
    mime: "image/png",
    fileName: `xposter-${segment.type}-${index}.png`,
    source: `rendered:${segment.type}:${index}`
  };
}

function plainTextSegment(text, kind = "unstyled") {
  return {
    type: "text",
    kind,
    text,
    inlineStyleRanges: [],
    links: []
  };
}

function segmentFallbackText(segment) {
  if (segment.type === "code") return `\`\`\`${segment.language || ""}\n${segment.code || ""}\n\`\`\``;
  if (segment.type === "table") return tableToMarkdown(segment);
  if (segment.type === "tweet") return `https://x.com/i/web/status/${segment.tweetId}`;
  if (segment.type === "divider") return "---";
  if (segment.type === "image") return imageFallbackMarkdown(segment);
  return "";
}

function contentStateFromSegments(segments, options = {}) {
  const blocks = [];
  const entities = [];

  const addText = (segment) => {
    const { block, entities: localEntities } = makeTextBlock(segment, makeBlockKey(blocks.length));
    for (const entity of localEntities) {
      const newKey = entities.length;
      for (const range of block.entity_ranges) {
        if (range.key === Number(entity.key)) range.key = newKey;
      }
      entities.push({ ...entity, key: String(newKey) });
    }
    blocks.push(block);
  };

  const addAtomic = (type, data) => {
    const entityKey = entities.length;
    const { block, entity } = makeAtomicBlock(type, data, makeBlockKey(blocks.length), entityKey);
    blocks.push(block);
    entities.push(entity);
  };

  for (const segment of segments) {
    if (segment.type === "text") {
      addText(segment);
      continue;
    }

    if (options.plainSpecialBlocks) {
      addText(plainTextSegment(segmentFallbackText(segment)));
      continue;
    }

    const specialBlockUpload = options.specialBlockUploads?.get(segment);
    if ((segment.type === "code" || segment.type === "table") && specialBlockUpload?.media_id) {
      const data = {
        media_items: [
          {
            media_category: specialBlockUpload.article_media_category || "TWEET_IMAGE",
            media_id: String(specialBlockUpload.media_id)
          }
        ]
      };
      addAtomic("image", data);
      continue;
    }

    if (segment.type === "code") {
      addAtomic(options.markdownEntityType, {
        markdown: `\`\`\`${segment.language || ""}\n${segment.code || ""}\n\`\`\``
      });
      continue;
    }
    if (segment.type === "table") {
      addAtomic(options.markdownEntityType, { markdown: tableToMarkdown(segment) });
      continue;
    }
    if (segment.type === "tweet") {
      const postId = String(segment.tweetId || "");
      addAtomic("post", { post_id: postId });
      continue;
    }
    if (segment.type === "image") {
      const uploaded = options.imageUploads?.get(segment);
      if (uploaded?.media_id) {
        const data = {
          media_items: [
            {
              media_category: uploaded.article_media_category || "TWEET_IMAGE",
              media_id: String(uploaded.media_id)
            }
          ]
        };
        if (segment.alt) data.caption = segment.alt;
        addAtomic("image", data);
      } else {
        addText(plainTextSegment(segmentFallbackText(segment)));
      }
      continue;
    }
    if (segment.type === "divider") {
      addText(plainTextSegment("---"));
    }
  }

  if (!blocks.length) addText(plainTextSegment(" "));
  return { blocks, entities };
}

function parseArticleMarkdown(markdown, args) {
  const sourceFileName = args.input && args.input !== "-" ? path.basename(args.input) : "";
  return shared.parseMarkdown(markdown, {
    sourceFileName,
    smartPunctuation: args.smartPunctuation
  });
}

function buildPayloadFromParsed(parsed, args, imageUploads = new Map(), specialBlockUploads = new Map()) {
  const title = args.title || parsed.title || "Untitled Article";
  return {
    title,
    content_state: contentStateFromSegments(parsed.segments, {
      plainSpecialBlocks: args.plainSpecialBlocks,
      markdownEntityType: args.markdownEntityType,
      imageUploads,
      specialBlockUploads
    })
  };
}

async function downloadRemoteImage(source) {
  const response = await fetch(source, {
    headers: {
      "user-agent": "xposter-api-uploader/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`download failed for ${source} (${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const mime = contentType && contentType.startsWith("image/") ? contentType : mimeFromSource(source);
  return {
    buffer,
    base64: buffer.toString("base64"),
    mime,
    fileName: fileNameFromSource(source),
    source
  };
}

function readLocalImage(source, args) {
  const imagePath = localImagePathFromSource(source, args);
  if (!imagePath) {
    throw new Error(`unsupported local image source: ${source}`);
  }
  let stat;
  try {
    stat = fs.statSync(imagePath);
  } catch (error) {
    throw new Error(`local image not found: ${source} resolved to ${imagePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`local image is not a file: ${source} resolved to ${imagePath}`);
  }

  const buffer = fs.readFileSync(imagePath);
  return {
    buffer,
    base64: buffer.toString("base64"),
    mime: mimeFromSource(imagePath),
    fileName: path.basename(imagePath) || fileNameFromSource(source),
    source
  };
}

async function loadImageAsset(source, args) {
  if (isHttpUrl(source)) return downloadRemoteImage(source);
  return readLocalImage(source, args);
}

async function apiJson(pathname, accessToken, body, label) {
  const headers = {
    authorization: `Bearer ${accessToken}`
  };
  const init = {
    method: "POST",
    headers
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    ...init
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const rate = rateLimitSummary(response);
    throw new Error(`${label} failed (${response.status}).${rate} ${text.slice(0, 1000)}`);
  }
  return json;
}

async function uploadMedia(image, accessToken) {
  const response = await apiJson(
    "/2/media/upload",
    accessToken,
    {
      media: image.base64,
      media_category: "tweet_image",
      media_type: image.mime
    },
    `Upload media ${image.fileName}`
  );
  const data = response.data || {};
  const mediaId = data.id || data.media_id;
  if (!mediaId) throw new Error(`Upload media ${image.fileName} did not return a media id`);
  return {
    media_id: String(mediaId),
    media_key: data.media_key || "",
    article_media_category: "TWEET_IMAGE",
    source: image.source,
    fileName: image.fileName,
    mime: image.mime,
    size: image.buffer.length
  };
}

async function uploadImagesForParsed(parsed, args, accessToken) {
  const uploads = new Map();
  if (args.skipMedia) return uploads;

  const segments = (parsed.segments || []).filter((segment) => segment.type === "image");
  const bySource = new Map();
  for (const segment of segments) {
    if (!bySource.has(segment.source)) bySource.set(segment.source, []);
    bySource.get(segment.source).push(segment);
  }

  for (const [source, matchingSegments] of bySource) {
    const image = await loadImageAsset(source, args);
    const uploaded = await uploadMedia(image, accessToken);
    for (const segment of matchingSegments) uploads.set(segment, uploaded);
  }

  return uploads;
}

async function uploadRenderedSpecialBlocksForParsed(parsed, args, accessToken) {
  const uploads = new Map();
  if (!args.renderSpecialBlocksAsImages) return uploads;

  let index = 1;
  for (const segment of parsed.segments || []) {
    if (!shouldRenderSpecialBlockAsImage(segment)) continue;
    const image = renderSpecialBlockImage(segment, args, index++);
    const uploaded = await uploadMedia(image, accessToken);
    uploads.set(segment, uploaded);
  }

  return uploads;
}

function mockImageUploads(parsed) {
  const uploads = new Map();
  let index = 1;
  for (const segment of parsed.segments || []) {
    if (segment.type !== "image") continue;
    uploads.set(segment, {
      media_id: String(index++),
      article_media_category: "TWEET_IMAGE",
      source: segment.source || "",
      fileName: fileNameFromSource(segment.source || "", "image.png"),
      mime: mimeFromSource(segment.source || "")
    });
  }
  return uploads;
}

function mockSpecialBlockUploads(parsed) {
  const uploads = new Map();
  let index = 1;
  for (const segment of parsed.segments || []) {
    if (!shouldRenderSpecialBlockAsImage(segment)) continue;
    uploads.set(segment, {
      media_id: `special-${index++}`,
      article_media_category: "TWEET_IMAGE",
      source: `rendered:${segment.type}`,
      fileName: `xposter-${segment.type}.png`,
      mime: "image/png"
    });
  }
  return uploads;
}

function ensureTokenFileDirectory(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
}

function readTokenFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeTokenFile(file, token) {
  ensureTokenFileDirectory(file);
  fs.writeFileSync(file, `${JSON.stringify(token, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort on non-POSIX filesystems.
  }
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function openUrl(url) {
  return new Promise((resolve) => {
    const child = spawn("open", [url], { stdio: "ignore", detached: true });
    child.on("error", () => resolve(false));
    child.on("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

function waitForCallback(redirectUri, expectedState) {
  const url = new URL(redirectUri);
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const host = url.hostname;
  const callbackPath = url.pathname || "/";

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for OAuth callback"));
    }, 120000);

    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url, redirectUri);
      if (requestUrl.pathname !== callbackPath) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("Not found");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state");
      if (error) {
        response.writeHead(400, { "content-type": "text/html" });
        response.end("<p>X authorization failed. You can close this tab.</p>");
        clearTimeout(timer);
        server.close();
        reject(new Error(`OAuth authorization failed: ${error}`));
        return;
      }
      if (!code || state !== expectedState) {
        response.writeHead(400, { "content-type": "text/html" });
        response.end("<p>OAuth callback was invalid. You can close this tab.</p>");
        clearTimeout(timer);
        server.close();
        reject(new Error("OAuth callback missing code or state mismatch"));
        return;
      }

      response.writeHead(200, { "content-type": "text/html" });
      response.end("<p>X authorization complete. You can close this tab.</p>");
      clearTimeout(timer);
      server.close();
      resolve(code);
    });

    server.on("error", reject);
    server.listen(port, host);
  });
}

async function tokenRequest(form, args) {
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (args.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${args.clientId}:${args.clientSecret}`).toString("base64")}`;
  }
  if (args.clientId && !form.has("client_id")) form.set("client_id", args.clientId);

  const response = await fetch(`${API_BASE_URL}/2/oauth2/token`, {
    method: "POST",
    headers,
    body: form
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Keep raw text for diagnostics below.
  }
  if (!response.ok) {
    throw new Error(`OAuth token request failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return json;
}

function withExpiry(token) {
  const expiresIn = Number(token.expires_in || 0);
  return {
    ...token,
    expires_at: expiresIn ? Date.now() + Math.max(0, expiresIn - 60) * 1000 : 0
  };
}

function scopeSet(value) {
  return new Set(String(value || "").split(/\s+/).filter(Boolean));
}

function tokenHasRequestedScopes(token, args) {
  const tokenScopes = scopeSet(token?.scope || token?.scopes || "");
  if (!tokenScopes.size) return true;
  for (const scope of scopeSet(args.scope)) {
    if (!tokenScopes.has(scope)) return false;
  }
  return true;
}

async function refreshAccessToken(token, args) {
  if (!token?.refresh_token) return null;
  if (!tokenHasRequestedScopes(token, args)) return null;
  const tokenArgs = args.clientId || !token.client_id ? args : { ...args, clientId: token.client_id };
  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", token.refresh_token);
  const refreshed = withExpiry(await tokenRequest(form, tokenArgs));
  if (!refreshed.refresh_token && token.refresh_token) refreshed.refresh_token = token.refresh_token;
  if (!refreshed.client_id && tokenArgs.clientId) refreshed.client_id = tokenArgs.clientId;
  writeTokenFile(args.tokenFile, refreshed);
  return refreshed.access_token;
}

async function runOAuth(args) {
  if (!args.clientId) {
    throw new Error("Missing OAuth client ID. Set X_CLIENT_ID, TWITTER_CLIENT_ID, or pass --client-id.");
  }

  const verifier = base64Url(crypto.randomBytes(64));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64Url(crypto.randomBytes(24));
  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", args.clientId);
  authUrl.searchParams.set("redirect_uri", args.redirectUri);
  authUrl.searchParams.set("scope", args.scope);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const callbackPromise = waitForCallback(args.redirectUri, state);
  if (args.openBrowser) {
    const opened = await openUrl(authUrl.toString());
    if (!opened) console.error(`Open this URL in your browser:\n${authUrl.toString()}`);
  } else {
    console.error(`Open this URL in your browser:\n${authUrl.toString()}`);
  }

  const code = await callbackPromise;
  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", code);
  form.set("redirect_uri", args.redirectUri);
  form.set("code_verifier", verifier);
  const token = withExpiry(await tokenRequest(form, args));
  token.client_id = args.clientId;
  writeTokenFile(args.tokenFile, token);
  return token.access_token;
}

async function getAccessToken(args) {
  const existingBearer = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN || "";
  if (existingBearer) return existingBearer;

  const cached = readTokenFile(args.tokenFile);
  const tokenArgs = args.clientId || !cached?.client_id ? args : { ...args, clientId: cached.client_id };
  if (!args.forceAuth) {
    if (cached?.access_token && (!cached.expires_at || cached.expires_at > Date.now()) && tokenHasRequestedScopes(cached, args)) {
      return cached.access_token;
    }
    const refreshed = await refreshAccessToken(cached, tokenArgs);
    if (refreshed) return refreshed;
  }

  return runOAuth(tokenArgs);
}

async function createDraft(payload, accessToken) {
  return apiJson("/2/articles/draft", accessToken, payload, "Create draft");
}

async function publishArticle(articleId, accessToken) {
  return apiJson(`/2/articles/${encodeURIComponent(articleId)}/publish`, accessToken, undefined, "Publish article");
}

function rateLimitSummary(response) {
  const limit = response.headers.get("x-rate-limit-limit");
  const remaining = response.headers.get("x-rate-limit-remaining");
  const reset = response.headers.get("x-rate-limit-reset");
  if (!limit && !remaining && !reset) return "";

  const parts = [];
  if (limit != null) parts.push(`rate_limit_limit=${limit}`);
  if (remaining != null) parts.push(`rate_limit_remaining=${remaining}`);
  if (reset != null) {
    parts.push(`rate_limit_reset=${reset}`);
    const resetSeconds = Number(reset);
    if (Number.isFinite(resetSeconds)) {
      parts.push(`rate_limit_reset_at=${new Date(resetSeconds * 1000).toString()}`);
    }
  }
  return ` ${parts.join(" ")}`;
}

function writeJsonOrPrint(value, outputPath) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (outputPath) fs.writeFileSync(outputPath, text);
  else process.stdout.write(text);
}

function linkContext(segment) {
  const text = String(segment.text || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return ` in "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`;
}

function localTargetReason(target) {
  const value = String(target || "").trim();
  if (!value) return "empty URL";
  if (value.startsWith("#")) return "fragment-only URL";
  if (value.startsWith("//")) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return "invalid URL";
    }
    if (url.protocol === "file:") return "file URL";
    if (url.protocol === "http:" || url.protocol === "https:") {
      const hostname = url.hostname.toLowerCase();
      if (hostname === "localhost" || hostname === "0.0.0.0" || hostname === "::1" || /^127\./.test(hostname)) {
        return "localhost URL";
      }
    }
    return "";
  }
  if (value.startsWith("/") || value.startsWith("~/") || value.startsWith("./") || value.startsWith("../")) {
    return "local or relative path";
  }
  return "relative URL";
}

function warnArticleInputs(parsed, args) {
  const warnings = [];

  if (args.baseUrl && !args.preprocess) {
    warnings.push("--base-url was supplied without --preprocess, so relative Markdown links/images will not be rewritten.");
  }

  let linkedTableCount = 0;
  for (const segment of parsed.segments || []) {
    if (segment.type === "table") {
      if (tableHasMarkdownLinks(segment)) linkedTableCount += 1;
    }

    if (segment.type === "text") {
      for (const link of segment.links || []) {
        const reason = localTargetReason(link.url);
        if (reason) {
          warnings.push(
            `link target ${JSON.stringify(link.url)}${linkContext(segment)} is a ${reason}; ` +
              "X readers cannot resolve local/relative targets. Use --preprocess --base-url or make the link absolute."
          );
        }
      }
      continue;
    }

    if (segment.type === "image") {
      if (args.skipMedia) {
        warnings.push(
          `image source ${JSON.stringify(segment.source)} will not be uploaded because --skip-media is active by default. ` +
            "Pass --upload-images to upload http(s) images or local files."
        );
      } else if (!isHttpUrl(segment.source) && !localImageExists(segment.source, args)) {
        const reason = localTargetReason(segment.source);
        warnings.push(
          `image source ${JSON.stringify(segment.source)} cannot be resolved as an http(s) URL or local file` +
            `${reason ? ` (${reason})` : ""}. Relative image paths resolve from the Markdown file's directory.`
        );
      }
    }
  }

  if (linkedTableCount && args.renderSpecialBlocksAsImages) {
    warnings.push(
      `${linkedTableCount} linked table(s) will stay as Markdown because rendering them as images would remove links.`
    );
  }

  for (const warning of warnings) console.error(`warning: ${warning}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.publishExisting) {
    const accessToken = await getAccessToken(args);
    const response = await publishArticle(args.publishExisting, accessToken);
    writeJsonOrPrint({ published: response }, args.output);
    return;
  }

  const markdown = maybePrepareMarkdownBeforeParse(readInputMarkdown(args), args);
  const parsed = maybePostprocessParsed(parseArticleMarkdown(markdown, args), args);
  if (args.prepareMarkdown) {
    writeTextOrPrint(preparedMarkdownFromParsed(parsed, args), args.output);
    return;
  }

  warnArticleInputs(parsed, args);
  const dryRunUploads = args.skipMedia ? new Map() : mockImageUploads(parsed);
  const dryRunSpecialUploads = args.renderSpecialBlocksAsImages ? mockSpecialBlockUploads(parsed) : new Map();
  const payload = buildPayloadFromParsed(parsed, args, dryRunUploads, dryRunSpecialUploads);

  if (args.dryRun) {
    writeJsonOrPrint(payload, args.output);
    return;
  }

  const accessToken = await getAccessToken(args);
  const imageUploads = await uploadImagesForParsed(parsed, args, accessToken);
  const specialBlockUploads = await uploadRenderedSpecialBlocksForParsed(parsed, args, accessToken);
  const finalPayload = buildPayloadFromParsed(parsed, args, imageUploads, specialBlockUploads);
  const response = await createDraft(finalPayload, accessToken);
  const articleId = response?.data?.id;
  let publishResponse = null;
  if (args.openDraft && articleId) await openUrl(`https://x.com/compose/articles/edit/${articleId}`);
  if (args.publish) {
    if (!articleId) throw new Error("Draft response did not include an article id to publish");
    publishResponse = await publishArticle(articleId, accessToken);
  }
  writeJsonOrPrint({ draft: response, published: publishResponse }, args.output);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
