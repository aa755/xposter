# xPoster

> 用 Markdown 写长文，用 X Articles 发布，不再把文章重新排一遍。
>
> Chrome 扩展 | Markdown 到 X Articles | 图片上传 | 表格图片 | 推文嵌入 | 多草稿队列 | 本地优先

xPoster 是一个免费开源的 Chrome 扩展，给习惯先写 Markdown、最后发到 X 的人用。它提供一个侧边栏暂存区，检查当前打开的 X Article 编辑器，把草稿、图片、表格和嵌入内容写入 X，保存可恢复记录，并把最后的发布按钮留给你自己。

[English README](README.md) · [Chrome 应用商店](https://chromewebstore.google.com/detail/xposter/iimkimodgdjnnmdopeolboakhjmhfbbj?authuser=0&hl=zh-CN) · [使用指南](docs/usage.zh-CN.md) · [隐私说明](docs/privacy.zh-CN.md)

![xPoster Markdown 到 X Articles 概览](docs/images/github-hero.zh-CN.svg)

## 为什么需要它

X Articles 适合发长文，但很多人并不想在 X 编辑器里完成写作。你可能在 Obsidian、Typora、Notion、VS Code、iA Writer 或其他 Markdown 工具里写完文章，最后发布时却还要手动搬运：

- 一段段复制正文，尽量不弄乱结构
- 重新设置标题、列表、引用、链接、加粗、斜体和行内代码
- 按正确位置上传图片
- 想办法让 Markdown 表格在 X 里还能看
- 把推文链接变成真正的 X 嵌入
- 检查当前 X 编辑器是否还能被脚本访问
- 防止导入一半失败后找不到原稿

xPoster 解决的就是这段交接。Markdown 继续作为你的原始稿，X 继续作为最终发布界面。

## 它能做什么

- **Markdown 写入 X Article**：把标题、段落、列表、引用、行内格式、链接、代码、分割线、图片、表格和 X/Twitter 推文嵌入写进 X 编辑器。
- **单篇或多篇队列**：可以粘贴一篇草稿，选择一个 `.md` 文件，拖入一篇 Markdown，也可以一次排队多篇再逐篇写入。
- **图片导入**：支持 Markdown 附近的本地图片；需要相对路径图片时，会提示选择本地图片文件夹；网页图片则按需请求 Chrome 一次性授权。
- **表格可读**：Markdown 表格会渲染成图片再放进 X，避免在编辑器里变成难读的纯文本。
- **标题和封面辅助**：可以从 frontmatter、第一个 H1、第一张图片里识别文章标题和封面。
- **写入前检查**：检查当前标签页、X Articles 页面、编辑器桥接、Draft.js 编辑器、媒体上传器、图片准备状态和编辑器已有内容。
- **可恢复记录**：保存本地导入记录，之前用过的 Markdown 可以搜索、复制、编辑并再次写入。
- **文章导出工具**：可选在可读取的 X Article 标题旁显示 Markdown 复制/下载按钮。
- **诊断信息**：提供工具栏诊断弹窗和技术记录，方便排查 X 编辑器改版带来的问题。
- **本地优先**：没有后台服务、账号系统、订阅、许可证服务器、付费墙或统计分析。

## 适合 / 不适合

**适合**

- 用 Markdown 写 X 长文的人
- 想把 Obsidian、Notion 导出、博客草稿或本地 `.md` 文件搬到 X Articles 的人
- 文章里有图片、表格、代码块、推文嵌入和多级结构的人
- 一次准备多篇草稿，不想反复复制粘贴的人
- 想使用可审计、可修改开源工具的人

**不适合**

- 自动发布、定时发布或代替你点击 Publish
- 绕过 X 的限制、审核或账号规则
- X threads、Newsletter 或普通推文编辑器
- 追求在每一次 X 编辑器改版后都 100% 视觉一致
- 无法被 Chrome 授权读取的私有图床或内网图片

## 30 秒开始

1. 从 [Chrome 应用商店安装 xPoster](https://chromewebstore.google.com/detail/xposter/iimkimodgdjnnmdopeolboakhjmhfbbj?authuser=0&hl=zh-CN)。
2. 打开或新建一篇 X Article：`https://x.com/compose/articles`。
3. 打开 xPoster 侧边栏。
4. 粘贴 Markdown，选择 `.md` 文件，或把 Markdown 文件拖进侧边栏。
5. 点击 **Check article / 检查文章**。
6. 点击 **Write to X draft / 写入 X 草稿**。
7. 回到 X 里检查效果，确认无误后手动发布。

![xPoster 发布流程](docs/images/publishing-flow.zh-CN.svg)

## 导入时发生了什么

当你点击 **Write to X draft / 写入 X 草稿** 时，xPoster 不只是把整篇文章粘贴进去：

1. 先把 Markdown 解析成标题、封面候选、正文块、图片、表格、推文、代码块和分割线。
2. 准备 X 不能直接接收的媒体，比如本地图片、网页图片和渲染后的表格图片。
3. 确认当前标签页仍然是刚刚通过 **Check article / 检查文章** 的那篇 X Article。
4. 根据当前设置写入标题和封面。
5. 把正文写进 X 的 Draft.js 编辑器。
6. 把临时标记替换成上传后的图片、表格图片、推文嵌入、代码块或分割线。
7. 保存本地记录，并提示哪些内容没有成功上传或放置。

所以 **Check article / 检查文章** 不只是让按钮变亮。它是在正式导入前，先确认 xPoster 能锁定真实的 X 编辑器。

## Markdown 示例

```md
---
title: 我如何写一篇 X 长文
cover: ./images/cover.png
---

# 我如何写一篇 X 长文

我先用 Markdown 写草稿，再用 xPoster 做最后的搬运。

![工作台](./images/workspace.png)

| 步骤 | 工具 |
| --- | --- |
| 写作 | Obsidian |
| 发布 | X Articles |

https://x.com/xiaoxiaodong01/status/1234567890
```

在这个例子里，xPoster 可以读取 frontmatter 标题，尝试设置封面，上传正文图片，把表格渲染成图片，并在 X 支持时把推文链接插入成嵌入块。

## 常见使用场景

| 任务 | xPoster 怎么帮你 |
| --- | --- |
| 发布一篇已经写好的长文 | 粘贴 Markdown，检查 X 编辑器，写入草稿，在 X 里最终确认。 |
| 导入带图片的本地 `.md` | 选择 Markdown 文件，按提示授权本地图片文件夹，再写入 X。 |
| 一次准备多篇文章 | 拖入多个 Markdown 文件，形成待发布队列，逐篇写入。 |
| 修正上次导入内容 | 在 Records 里找到保存的 Markdown，编辑后重新写入。 |
| 发布表格很多的文章 | 保留 Markdown 表格，xPoster 会把表格渲染成图片。 |
| 在文章中嵌入推文 | 把 X/Twitter 推文链接放进草稿，xPoster 会尽量插入成 X 嵌入块。 |
| 留下本地技术记录 | 运行检查或写入后，在诊断和记录区域查看本次操作证据。 |
| 把已有 X Article 复制回 Markdown | 开启文章导出工具，在可读取文章页标题旁复制或下载 Markdown。 |

## Markdown 和媒体支持

| 输入 | xPoster 会怎么处理 |
| --- | --- |
| `--- title: 标题 ---` | 尽量用 frontmatter 设置 X 文章标题。 |
| `# 一级标题` | 没有 frontmatter 标题时，尽量用第一个 H1 当标题。 |
| 段落、标题、列表、引用 | 转成 X Article 能接受的富文本。 |
| `**加粗**`、`*斜体*`、`` `代码` ``、链接 | 在 X 支持的范围内保留行内格式。 |
| `![alt](image.png)` | 在能读取图片文件时上传本地或网页图片。 |
| `cover:` frontmatter 或第一张图片 | 开启设置后可用于文章封面。 |
| Markdown 表格 | 渲染成图片，保证在 X 里更稳定可读。 |
| X/Twitter 推文链接 | 尽量通过 X 编辑器模型插入为推文嵌入块。 |
| 代码块、分割线 | 尽量转成 X Article 支持的特殊内容块。 |

测试草稿在这里：[fixtures/live-x-smoke.md](fixtures/live-x-smoke.md)。

## 图片说明

**本地图片**：把图片文件放在 Markdown 附近，并在 xPoster 提示时选择对应的本地图片文件夹。像 `./images/photo.png` 这样的相对路径，只有在 Chrome 授权 xPoster 读取对应文件夹后才可用。

**网页图片**：Chrome 可能会询问是否允许 xPoster 读取图片所在网站。xPoster 需要拿到图片文件本身，才能交给 X 上传。下载失败的网页图片会保留为 Markdown 链接，不会悄悄消失。

**私有图床**：公开源码版本不会暴露私人图床域名。如果你维护自己的 fork，并且需要固定支持某个图片网站，请只在自己的 manifest 里声明可信域名。

## 稳定性与恢复

xPoster 的设计前提是：浏览器自动化一定可能失败。X 可能改编辑器，文件可能不存在，网页图片可能被拦截，上传也可能中途停住。这个扩展尽量让失败变得可见、可恢复：

- **导入前**：预检查会确认页面、编辑器桥接、Draft.js 编辑器、媒体上传通道和当前草稿状态是否可用。
- **导入中**：进度信息会显示当前阶段，比如解析、准备媒体、设置标题封面、写入正文、上传媒体或放置嵌入。
- **导入后**：警告会告诉你哪些图片、表格或封面没有成功上传，只保留成了 Markdown。
- **重新尝试**：Records 会在本地保留原始 Markdown，你可以复制、编辑，或在一篇干净的 X Article 里再次写入。
- **排查问题**：工具栏诊断弹窗和技术记录会保留足够上下文，方便维护者判断是不是 X 编辑器改版导致的问题。

最稳妥的习惯是：先运行 **Check article / 检查文章**，写入一篇干净的 X Article 草稿，在 X 里完整检查结果，确认无误后再手动发布。

## 为什么这样设计

- **写入真实 X 编辑器**：不假装有发布 API，最终检查和发布都留在 X 里。
- **先检查再写入**：X 编辑器经常变化，提前失败比写一半卡住更好。
- **保存本地记录**：媒体、嵌入和编辑器状态都可能中途失败，记录能让你快速恢复。
- **不点击发布**：扩展负责搬运和排版，不替你做最后的编辑判断。
- **依赖尽量少**：方便审计、维护和自己修改。

## 源码安装

普通用户建议安装应用商店版本。只有当你想审计、测试或修改扩展时，才需要源码安装。

![Chrome 加载解包扩展步骤](docs/images/install-steps.zh-CN.svg)

1. 下载或 clone 这个仓库。
2. 打开 Chrome 的 `chrome://extensions`。
3. 打开右上角 **开发者模式**。
4. 点击 **加载已解压的扩展程序**。
5. 选择包含 `manifest.json` 的 xPoster 项目文件夹。

## 隐私与安全

- 草稿和导入记录保存在你自己的浏览器扩展本地存储里。
- xPoster 运行在 `x.com` 和 `twitter.com`，因为它需要填写 X Article 编辑器，也需要在可选导出功能中读取文章页面。
- xPoster 使用 `tabs` 权限，是为了找到并检查当前 X Article 标签页。
- 只有当草稿里有需要下载的网页图片时，才会请求对应图片网站的可选权限。
- xPoster 没有分析统计、后台服务、许可证验证或付费墙。
- xPoster 不会点击发布。最终发布永远由你自己在 X 中确认。

更多隐私说明见：[docs/privacy.zh-CN.md](docs/privacy.zh-CN.md)。

## 开发者检查

这个项目依赖很轻。Node 只用于本地校验。

```bash
npm run check
npm test
npm run verify
```

`npm run check` 会检查 JavaScript 语法、`manifest.json` 和 i18n 覆盖。

`npm test` 会检查测试草稿、manifest 引用、图标和 Markdown 解析行为。

## 项目结构

```text
manifest.json          Chrome 扩展 manifest
sidepanel.html         主侧边栏界面
sidepanel.css          侧边栏样式
sidepanel.js           侧边栏流程、记录、队列和导入控制
diagnostics.html       工具栏诊断弹窗
diagnostics.js         诊断界面逻辑
src/background.js      MV3 service worker 和图片下载代理
src/content.js         X 页面脚本、页面状态和 Markdown 导出
src/main-world.js      MAIN world Draft.js / X 编辑器适配
src/shared.js          Markdown 解析、写入计划、本地图片工具
fixtures/              用于检查和演示的 Markdown 示例
docs/                  使用指南、图片和隐私说明
scripts/               本地校验脚本
```

## 常见问题

**我在 Chrome 里看不到 xPoster。**
请安装应用商店版本；如果用源码安装，请打开开发者模式，并选择包含 `manifest.json` 的文件夹。

**写入 X 草稿按钮不能点。**
先载入或编辑 Markdown 草稿，再打开 X Article 标签页，然后点击 **Check article / 检查文章**。

**图片没有变成 X 里的图片。**
本地图片需要选择图片文件夹。网页图片需要在 Chrome 授权后能公开下载。

**导入后看起来不对。**
先不要发布。可以在 X 里手动修改，或者从保存的 Markdown 记录重新开始。

**X 改版导致失效。**
欢迎在 GitHub 提 issue，并附上 Chrome 版本、xPoster 版本和工具栏诊断弹窗里的 JSON。

## 参与贡献

欢迎提交 issue 和 pull request。可以先看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 支持作者

xPoster 会继续保持免费开源。如果它帮你节省了整理和发布长文的时间，也愿意支持后续维护，可以扫描下面的 Buy Me a Coffee 二维码请作者喝杯咖啡。完全自愿；反馈、Star 和 issue 同样有帮助。

<img src="docs/images/buy-me-a-coffee-qr.png" alt="Buy Me a Coffee 支持二维码" width="220">

## 联系作者

可以通过作者 X 主页联系：[@xiaoxiaodong01](https://x.com/xiaoxiaodong01)。

## 开源协议

MIT。见 [LICENSE](LICENSE)。
