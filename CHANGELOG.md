# Changelog

## 0.2.0

- 二维状态空间：技术轴（重度/轻度）× 办公轴（工作/娱乐），应用先投影再 EMA 平滑
- 隐私过滤：通讯类应用直接过滤；AI 对话默认模糊为中性，可配置
- 细节遗忘：标题/速写/正文只保留 `detailHours`，之后只留平滑状态
- 工具改为 `diary_state`、`diary_recent`、`diary_today`（半小时分桶）、`diary_search`（显式回忆）、`diary_stats`
- 面板改为二维轨迹图 + 当前象限 + 短期细节
## 0.1.0

- 第一个版本：消费窥屏助手的事件流，整理成本地活动日记
- 工具：`diary_today`、`diary_search`、`diary_stats`
- 时间线面板（按天/小时）、搜索与清空
- 游标持久化、首次回填、保留天数淘汰
