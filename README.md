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

## 🧩 配套扩展：窥屏助手

本包不做任何采集：前台窗口、截图和视觉速写都来自 [窥屏助手](https://www.npmjs.com/package/cortico-world-screen-sense)（`cortico-world-screen-sense`）。它把 `screen-sense.focus` / `screen-sense.screenshot` 写进事件流，本包只读事件、做状态投影与记忆整理。

- 只用窥屏助手也能工作；本包是它的**可选消费方**，用来把事件变成可回顾的平滑记忆。
- 没装窥屏助手时，活动日记不会报错，只会提示等待事件源。
- 安装顺序：先窥屏助手，再活动日记。

GitHub：[cortico-world-screen-sense](https://github.com/Wwhois163wW/cortico-world-screen-sense) · [cortico-world-screen-diary](https://github.com/Wwhois163wW/cortico-world-screen-diary)

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

## 词袋状态与自定义词

面板里的「词汇与衰减」把**应用名和窗口标题词放在同一张表**：

- 列：词、次数、来源、坐标 `[工作/娱乐, 轻/重]`、权重、编辑
- 应用名去掉 `.exe` 后整体是一个 token；标题按英文/数字切词、中文 ICU 分词、停用词过滤
- 来源：`应用` / `内置` / `自定义` / `未知`；未知词回退 `(0,0)`、权重 `0.1`
- 应用词可改类型与流枯竭窗口；标题词可改坐标与权重，保存后成为**自定义词**
- 自定义词会持久化到 `lexicon.json`，并保留编辑记录（时间、token、前后值）
- 「恢复」把自定义词还原成内置词或未知词
- 只保存 token、计数、自定义词与编辑历史，不保存标题原文；通讯类在分词前过滤

词袋**正式参与状态计算**（`useWords: true`）：

- 每个应用词带它覆盖后的类别坐标与权重；标题词用自定义/内置词库坐标与权重
- 窗口内每个词按出现次数与时间衰减（半衰期默认 5 分钟）投票，得到 `(工作, 技术)` 质心
- 质心再经 `smoothing` 的 EMA 平滑，写入轨迹与采样
- 关闭 `useWords` 时回退到原来的“应用类别投影 + EMA”
- `diary_state` 与面板显示当前窗口的高频词，作为语义指纹
## 流枯竭：搭话时机，不是监控

不使用键鼠钩子，也不做全局输入监听；只利用**前台窗口切换的时间梯度**：

- 切换密集 = `busy`，不打扰
- 静默超过该应用的**衰退窗口** = `depleted`（专注或离开，不强行区分）
- `depleted` 后出现新切换 = `screen-diary.reengage`（piggyback），Coo 可以说“回来啦”
- 进入 `depleted` 时若开启主动搭话，发 `screen-diary.checkin`（debounce，默认关闭，带冷却）；之后仍无切换则内部确认 `away`，不再发事件

衰退窗口按应用类型乘倍率：开发/文书 20 分钟、视频 30 分钟、游戏 12 分钟、浏览器 8 分钟（基准可配）。flow 状态只服务当次交互，不进入雷达、不做长期画像。

## 隐私与遗忘

- **通讯类直接过滤**：微信、QQ、Discord、Telegram、Slack、Teams、Zoom、邮件客户端等不投影、不落盘、不进入状态。
- **AI 对话默认模糊为中性**：不记录具体窗口标题；可在配置里改为额外过滤或正常投影。
- **细节会淡忘**：窗口标题、速写、正文只保留 `detailHours`（默认 72 小时）；之后只剩平滑状态与日摘要，保留 `keepDays`（默认 30 天）。
- 状态是“大概在干什么”，允许不精确；需要精确回忆时才用显式搜索。

## 从 0.1 升级

0.2.0 之前只保存详细条目，没有状态采样。升级到 0.2.x 后第一次启动会自动回填：

- 旧条目按同一套投影与平滑重放成状态采样（每 1 分钟最多一个点）
- 回填时顺带删除旧数据里的通讯类与模糊 AI 条目
- 如果之前已经产生过 0.2 的采样，则不会重复回填

## 工具

| 工具 | 用途 |
| --- | --- |
| `diary_state` | 当前平滑状态 + 最近 10 个采样；反应类场景默认用它 |
| `diary_recent` | 最近 N 个平滑采样（默认 10） |
| `diary_today` | 某天按半小时分桶的平滑状态，默认今天 |
| `diary_search` | **显式回忆**：在短期细节记录里搜应用/标题/速写，最多 5 条 |
| `diary_stats` | 覆盖天数、状态采样数、主要状态 |

## 事件

| 事件 | 触发 | 默认 |
| --- | --- | --- |
| `screen-diary.reengage` | 长静默后重新出现窗口切换 | 开（piggyback） |
| `screen-diary.checkin` | 流枯竭且开启主动搭话 | 关（debounce，冷却 60 分钟） |

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
| `useWords` | `true` | 是否用词袋质心计算状态（关闭回退类别 EMA） |
| `wordWindowMinutes` | `15` | 词袋窗口长度 |
| `wordHalfLifeMinutes` | `5` | 词权重衰减半衰期 |
| `source` | `screen-sense` | 生产方 World id |
| `maxEventsPerPoll` | `500` | 单次导入上限 |
| `flowDecayMinutes` | `20` | 流枯竭基准窗口，按应用类型乘倍率 |
| `checkInEnabled` | `false` | 流枯竭时是否允许 Coo 主动搭话 |
| `awayAfterMinutes` | `10` | 搭话后仍无切换，多久确认离开 |
| `checkInCooldownMinutes` | `60` | 两次主动搭话的最小间隔 |

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
