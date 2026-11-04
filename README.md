Owner: `src/index.ts`

# cortico-world-screen-diary（活动日记）

[![CI](https://github.com/Wwhois163wW/cortico-world-screen-diary/actions/workflows/ci.yml/badge.svg)](https://github.com/Wwhois163wW/cortico-world-screen-diary/actions/workflows/ci.yml)

**活动日记**是一个**消费方 World**：它不截屏、不读窗口，只读另一个 World（[窥屏助手](https://www.npmjs.com/package/cortico-world-screen-sense)）写进事件流的前台切换，把工作状态投影到二维空间并做平滑；窗口标题只短期保留，之后只剩“大概在干什么”。

这是“World 依赖事件流”的 PoC：生产方不知道本扩展存在；本扩展只依赖事件契约，不依赖它的代码。

## 依赖

先安装并启用 **`cortico-world-screen-sense`（窥屏助手）**，再安装本包：

```text
cortico-world-screen-diary
```

装完重启 Core，在「World 总览」里启用「活动日记」。生产方没启用或还没事件时，面板会提示等待。

## 二维状态空间

- **纵轴 技术轴**：重度（开发/折腾）↔ 轻度（看视频/轻办公）
- **横轴 办公轴**：工作 ↔ 娱乐

每个前台应用先投影成 `(tech, work)`，再按 `smoothing` 做 EMA 平滑，得到连续状态与轨迹。窗口标题只用来判断浏览器在哪个象限（github → 开发，Bilibili → 视频），不会长期保存。

| 类别 | 示例 | tech | work |
| --- | --- | --- | --- |
| 开发 | IDE、终端、git、docker、github、npm | +0.8 | +0.6 |
| 游戏 | Steam、Minecraft、LOL | +0.6 | -0.8 |
| 文书 | Word/Excel/PDF/Notion | -0.2 | +0.8 |
| 视频 | bilibili、YouTube、播放器 | -0.5 | -0.8 |
| 浏览器 | Chrome/Edge | 按标题推断，默认 (0,0) | |

## 隐私与遗忘

- **通讯类直接过滤**：微信、QQ、Discord、Telegram、Slack、Teams、Zoom、邮件客户端等不投影、不落盘、不进入状态。
- **AI 对话默认模糊为中性**：不记录具体窗口标题；可在配置里改为额外过滤或正常投影。
- **细节会淡忘**：窗口标题、速写、正文只保留 `detailHours`（默认 72 小时）；之后只剩平滑状态与日摘要，保留 `keepDays`（默认 30 天）。
- 状态是“大概在干什么”，允许不精确；需要精确回忆时才用显式搜索。

## 工具

| 工具 | 用途 |
| --- | --- |
| `diary_state` | 当前平滑状态 + 最近 10 个采样；反应类场景默认用它 |
| `diary_recent` | 最近 N 个平滑采样（默认 10） |
| `diary_today` | 某天按半小时分桶的平滑状态，默认今天 |
| `diary_search` | **显式回忆**：在短期细节记录里搜应用/标题/速写，最多 5 条 |
| `diary_stats` | 覆盖天数、状态采样数、主要状态 |

## 配置（`worlds.screen-diary.*`）

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `false` | 是否轮询事件流 |
| `pollMs` | `5000` | 检查新事件的间隔 |
| `lookbackMinutes` | `60` | 首次启动回填最近多少分钟 |
| `keepDays` | `30` | 平滑状态与日摘要保留天数 |
| `detailHours` | `72` | 细节（标题/速写/正文）保留小时 |
| `blurAi` | `true` | AI 对话是否模糊为中性 |
| `ignoreApps` | `""` | 额外过滤的应用名片段 |
| `smoothing` | `0.25` | EMA 平滑强度，0.05 平滑、0.9 灵敏 |
| `sampleSec` | `30` | 两次状态采样最小间隔 |
| `source` | `screen-sense` | 生产方 World id |
| `maxEventsPerPoll` | `500` | 单次导入上限 |

## 隐私

- 本 World 不截屏、不联网；只读宿主里已有的文本事件，并立即投影为分类与两个数值。
- 通讯类应用完全跳过；AI 对话默认不保存标题。
- 日记数据在 `data/diary/`，可随时在面板清空；不影响窥屏助手的相册。
- 生产方的 `sensitive-data` 警示同样适用于这里的短期细节。

## 开发

```bash
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

发布前，在 Cortico 仓库根目录：

```bash
pnpm describe:extension <本包目录>
pnpm check:extension <本包目录>
```

## 发布

本包目前**手动发布**，不依赖 tag / 可信发布：

```bash
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
npm publish --access public
```

> 仓库没有自动发布 workflow；不要给本包打 `v*` tag，直接 `npm publish` 即可，它会先跑 `prepublishOnly` 检查。

## 许可

AGPL-3.0-or-later。
