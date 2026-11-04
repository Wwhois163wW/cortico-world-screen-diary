Owner: `src/index.ts`

# cortico-world-screen-diary（活动日记）

[![CI](https://github.com/Wwhois163wW/cortico-world-screen-diary/actions/workflows/ci.yml/badge.svg)](https://github.com/Wwhois163wW/cortico-world-screen-diary/actions/workflows/ci.yml)

**活动日记**是一个**消费方 World**：它不截屏、不读窗口，只读另一个 World（[窥屏助手](https://www.npmjs.com/package/cortico-world-screen-sense)）写进事件流的前台切换与视觉速写，整理成本地的时间线、搜索与统计。

这是“World 依赖事件流”的 PoC：生产方（窥屏助手）不知道本扩展存在；本扩展只依赖事件契约，不依赖它的代码。

## 依赖

先安装并启用 **`cortico-world-screen-sense`（窥屏助手）**，然后在扩展页安装本包：

```text
cortico-world-screen-diary
```

装完重启 Core，在「World 总览」里启用「活动日记」。如果窥屏助手没启用或还没产生事件，面板会提示等待，不会报错。

## 它读什么

通过宿主提供的 `host.store` 增量读取（`source = screen-sense`）：

- `screen-sense.focus`：`meta = { kind: 'focus', app, title, previousMs }`
- `screen-sense.screenshot`：`meta = { kind: 'screenshot', app, title, photoId, caption }`

只保存文本与结构化字段；**事件里没有原图**。生产方改名/删除事件类型属于 major，新增字段属于 minor。

读取游标保存在本 World 数据目录，重启后从上次位置继续；第一次启动可按 `lookbackMinutes` 回填一段历史。记录按 `keepDays` 保留，超过自动淘汰。

## 工具

| 工具 | 作用 |
| --- | --- |
| `diary_today` | 读某一天（默认今天）的日记，按小时列出前台切换与速写 |
| `diary_search` | 按应用名、窗口标题、速写或正文搜索，新的在前 |
| `diary_stats` | 总条数、覆盖天数、最常出现的应用 |

## 配置（`worlds.screen-diary.*`）

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `false` | 是否轮询事件流（World 总览里启用后生效） |
| `pollMs` | `5000` | 检查新事件的间隔 |
| `lookbackMinutes` | `60` | 首次启动回填最近多少分钟 |
| `keepDays` | `30` | 日记保留天数 |
| `source` | `screen-sense` | 生产方 World id |
| `maxEventsPerPoll` | `500` | 单次导入上限，超出留给下一拍 |

## 隐私

- 本 World 不截屏、不读窗口、不联网；只读宿主里已有的文本事件。
- 日记条目保存在 `data/diary/`，可随时在面板清空；清空不会影响窥屏助手的相册。
- 事件内容来自屏幕观察，属于个人数据；窥屏助手的 `sensitive-data` 警示同样适用于这些条目。

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

## 许可

AGPL-3.0-or-later。
