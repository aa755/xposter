# xPoster

Move polished Markdown drafts into X Articles without rebuilding the article by hand.

xPoster is a free, open source Chrome extension for writers who draft in Markdown first and publish on X later. Paste a draft, choose a `.md` file, or drop multiple files into the side panel; xPoster checks the active X Article editor, writes the draft into X, and leaves the final Publish click to you.

[中文说明](README.zh-CN.md) · [Chrome Web Store](https://chromewebstore.google.com/detail/xposter/iimkimodgdjnnmdopeolboakhjmhfbbj?authuser=0&hl=zh-CN) · [Usage guide](docs/usage.md) · [Privacy](docs/privacy.md)

![xPoster Markdown to X Articles overview](docs/images/github-hero.svg)

## What It Does

- Turns Markdown drafts into X Article content while preserving the original Markdown in the side panel.
- Handles the parts that are painful to copy by hand: headings, paragraphs, lists, quotes, inline styles, links, images, tables, code blocks, dividers, and X/Twitter embeds.
- Runs a preflight check before writing so you know whether the draft, active X Article tab, editor bridge, and images are ready.
- Supports single drafts and queued multi-file imports from local `.md` files.
- Keeps recoverable records so previous Markdown can be searched, copied, edited, and written again.
- Adds an optional, quiet Markdown export button on readable X Article pages.
- Stays local: no account, subscription, backend service, analytics, license server, or payment gate.

## Install

Recommended for most users:

1. Open [xPoster on the Chrome Web Store](https://chromewebstore.google.com/detail/xposter/iimkimodgdjnnmdopeolboakhjmhfbbj?authuser=0&hl=zh-CN).
2. Click **Add to Chrome**.
3. Open or create an X Article at `https://x.com/compose/articles`.

The Web Store version is the supported install path and receives updates.

Developer install from source:

![Chrome load unpacked steps](docs/images/install-steps.svg)

1. Download or clone this project.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the xPoster project folder, the folder that contains `manifest.json`.

Use the source install only if you want to inspect, test, or modify the extension yourself.

## Workflow

![xPoster publishing flow](docs/images/publishing-flow.svg)

1. Open or create an X Article at `https://x.com/compose/articles`.
2. Open the xPoster side panel.
3. Paste Markdown, choose a `.md` file, or drop one or more Markdown files.
4. Review the recognized title, text, media, tables, code, dividers, and embeds.
5. Click **Check article** to confirm the active X Article editor is reachable.
6. Click **Write to X draft**. Queued files can be written one by one, edited in a popup, or written as a batch.
7. Review the imported article inside X.
8. Click X's own Publish button only when the article looks right.

## Markdown Support

| Markdown input | How xPoster handles it |
| --- | --- |
| `--- title: My title ---` | Uses frontmatter as the X Article title when possible. |
| `# Heading` | Uses the first H1 as title when frontmatter has no title. |
| Paragraphs, lists, quotes | Converts them into rich text for the editor. |
| `**bold**`, `*italic*`, `` `code` ``, links | Keeps inline formatting where X accepts it. |
| `![alt](image.png)` | Uploads supported images when xPoster can read the file. |
| Markdown tables | Renders tables as images so they stay readable in X. |
| X/Twitter status URLs | Inserts tweet embeds through X's editor model. |
| Code fences and dividers | Imports them as X Article atomic blocks where supported. |

A smoke-test draft is included at [fixtures/live-x-smoke.md](fixtures/live-x-smoke.md).

## Images

Local images: keep image files near your Markdown file and choose the local image folder when xPoster asks.

Web images: Chrome may ask for one-time permission to read the image website. xPoster needs that browser permission to download the image file and pass it to X for upload. Failed downloads stay as Markdown links instead of becoming uploaded X images.

The public source build does not expose private image hosts. If you maintain your own fork and need remote image support for a specific host, declare only the host you trust in your own extension manifest.

## Privacy And Safety

- Drafts and import records are stored in your browser's local extension storage.
- xPoster runs on `x.com` and `twitter.com` because it needs to fill the X Article editor and read article pages for optional Markdown export.
- xPoster asks for `tabs` only to find and check the active X Article tab.
- Optional host permissions are requested only when a draft uses web images that need to be downloaded.
- xPoster does not include analytics, a backend service, a license server, or a payment gate.
- xPoster does not click Publish. You always review and publish manually in X.

Read the shorter privacy note in [docs/privacy.md](docs/privacy.md).

## Developer Checks

This project is dependency-light. Node is only used for local verification.

```bash
npm run check
npm test
npm run verify
```

`npm run check` verifies JavaScript syntax, `manifest.json`, and i18n coverage.

`npm test` verifies the fixture, manifest references, icons, and Markdown parsing behavior.

## Project Layout

```text
manifest.json          Chrome extension manifest
sidepanel.html         Main side panel UI
sidepanel.css          Side panel styling
sidepanel.js           Side panel workflow and import controls
diagnostics.html       Toolbar popup for active-tab checks
diagnostics.js         Diagnostics UI logic
src/background.js      MV3 service worker and image fetch proxy
src/content.js         X page content script, page status, and Markdown export
src/main-world.js      MAIN-world Draft.js / X editor adapter
src/shared.js          Markdown parser, paste plan, local image helpers
fixtures/              Example Markdown used by checks and demos
docs/                  Usage guide, images, privacy notes
scripts/               Local verification scripts
```

## Common Problems

**I cannot see xPoster in Chrome.**
Install the Web Store version, or enable Developer mode and load the source folder that contains `manifest.json`.

**Write to X draft is disabled.**
Load or edit a Markdown draft first, open an X Article tab, then click **Check article**.

**Images stay as links.**
Local images need a selected image folder. Web images need to be publicly downloadable after Chrome grants the image-site permission.

**The imported article looks wrong.**
Do not publish yet. Edit directly in X or reset the draft and retry from the saved Markdown record.

**X changed its editor and import stopped working.**
Open an issue with your Chrome version, xPoster version, and the diagnostics JSON from the toolbar popup.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Support

xPoster is free and open source. If it saves you time and you want to support ongoing maintenance, you can scan the Buy Me a Coffee QR code below. This is optional; feedback, issues, and stars also help.

<img src="docs/images/buy-me-a-coffee-qr.png" alt="Buy Me a Coffee QR code" width="220">

## Contact

Contact the author on X: [@xiaoxiaodong01](https://x.com/xiaoxiaodong01).

## License

MIT. See [LICENSE](LICENSE).
