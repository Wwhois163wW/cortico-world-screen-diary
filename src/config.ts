/** Config section `worlds.screen-diary`: event stream, privacy filter, smoothing and retention. */
import type { ConfigGroup } from 'cortico/core/config-schema.ts';
import type { Language } from 'cortico/core/language.ts';

export interface DiaryConfig {
  enabled: boolean;
  pollMs: number;
  lookbackMinutes: number;
  keepDays: number;
  source: string;
  maxEventsPerPoll: number;
  /** Blur AI chat apps to neutral instead of projecting them as development work. */
  blurAi: boolean;
  /** Extra app-name substrings to filter out, comma separated. */
  ignoreApps: string;
  /** EMA smoothing factor: higher reacts faster, lower is smoother. */
  smoothing: number;
  /** Detail entries (window titles, captions, text) are dropped after this many hours. */
  detailHours: number;
  /** Minimum gap between two stored state samples, seconds. */
  sampleSec: number;
}

export const DIARY_DEFAULTS: DiaryConfig = {
  enabled: false,
  pollMs: 5000,
  lookbackMinutes: 60,
  keepDays: 30,
  source: 'screen-sense',
  maxEventsPerPoll: 500,
  blurAi: true,
  ignoreApps: '',
  smoothing: 0.25,
  detailHours: 72,
  sampleSec: 30,
};

export type DiaryConfigSection = DiaryConfig;

function diaryText(language: Language) {
  const zh = language === 'zh' || language === 'zh-Hant';
  return zh ? {
    group: '事件流与记忆',
    groupDesc: '从哪里读事件、怎么过滤与平滑、细节保留多久。',
    enabledTitle: '读取事件流',
    enabledDesc: '打开后按固定间隔增量读取生产方的事件。',
    pollTitle: '轮询间隔',
    pollDesc: '每隔这么久检查一次新事件。',
    lookbackTitle: '首次回填',
    lookbackDesc: '第一次启动时导入最近多少分钟已有的历史事件。',
    keepTitle: '状态保留天数',
    keepDesc: '平滑状态与日摘要保留多久；超过后删除。',
    sourceTitle: '事件来源',
    sourceDesc: '生产方的 World id，默认 screen-sense（窥屏助手）。',
    maxTitle: '单次处理上限',
    maxDesc: '一次最多导入多少条；超出的留给下一拍继续。',
    blurAiTitle: '模糊 AI 对话',
    blurAiDesc: 'AI 聊天窗口默认按中性处理，不记录具体窗口标题。',
    ignoreTitle: '额外过滤',
    ignoreAppsDesc: '逗号分隔的应用名片段；通讯类应用默认已过滤。',
    smoothingTitle: '平滑强度',
    smoothingDesc: '0.05 很平滑，0.9 反应很快；默认 0.25。',
    detailTitle: '细节保留小时',
    detailDesc: '窗口标题、速写与正文只保留这么久，之后只留下平滑状态。',
    sampleTitle: '采样间隔',
    sampleDesc: '两次状态采样至少隔这么多秒。',
    storage: {
      label: '活动日记',
      note: '删除全部细节记录与平滑状态；不会影响生产方的相册与配置。',
      stat: (entries: string, samples: string) => `${entries} 条细节 · ${samples} 个状态采样`,
      cleared: (n: number) => `已删除 ${n} 条记录`,
    },
  } : {
    group: 'Event stream and memory',
    groupDesc: 'Where events come from, how they are filtered and smoothed, and how long details last.',
    enabledTitle: 'Read the event stream',
    enabledDesc: 'When on, new events are imported at a fixed interval.',
    pollTitle: 'Poll interval',
    pollDesc: 'How often to check for new events.',
    lookbackTitle: 'First import',
    lookbackDesc: 'On the first run, import up to this many minutes of existing events.',
    keepTitle: 'State kept, days',
    keepDesc: 'Smoothed state and daily summaries are kept this many days.',
    sourceTitle: 'Event source',
    sourceDesc: 'The producer World id; `screen-sense` by default.',
    maxTitle: 'Events per poll',
    maxDesc: 'Most events imported at once; the rest wait for the next poll.',
    blurAiTitle: 'Blur AI chats',
    blurAiDesc: 'AI chat windows count as neutral and their titles are not stored.',
    ignoreTitle: 'Extra filters',
    ignoreAppsDesc: 'Comma separated app-name fragments; communication apps are filtered by default.',
    smoothingTitle: 'Smoothing',
    smoothingDesc: '0.05 is very smooth, 0.9 reacts fast; 0.25 by default.',
    detailTitle: 'Detail hours',
    detailDesc: 'Window titles, captions and text are kept this long, then only smoothed state remains.',
    sampleTitle: 'Sample interval',
    sampleDesc: 'At least this many seconds between two stored state samples.',
    storage: {
      label: 'Activity diary',
      note: 'Deletes detail entries and smoothed state; the producer album and settings are untouched.',
      stat: (entries: string, samples: string) => `${entries} entries · ${samples} state samples`,
      cleared: (n: number) => `Deleted ${n} records`,
    },
  };
}

export function diaryStorageText(language: Language) {
  return diaryText(language).storage;
}

export interface DiaryPanelText {
  title: string;
  description: string;
  refresh: string;
  clear: string;
  clearConfirm: string;
  cleared: (n: number) => string;
  empty: string;
  waitingProducer: (source: string) => string;
  loading: string;
  failed: string;
  stateTitle: string;
  current: (label: string) => string;
  trend: string;
  noTrend: string;
  details: string;
  detailsNote: string;
  search: string;
  searchPlaceholder: string;
  noResults: string;
  privacyNote: string;
  axisTech: string;
  axisWork: string;
}

export function diaryPanelText(language: Language): DiaryPanelText {
  const zh = language === 'zh' || language === 'zh-Hant';
  return zh ? {
    title: '活动日记',
    description: '二维状态空间：技术重度与办公/娱乐的平滑轨迹；细节会随时间淡忘。',
    refresh: '刷新',
    clear: '清空日记',
    clearConfirm: '删除全部细节记录与平滑状态？不会影响窥屏助手的相册。',
    cleared: (n) => `已删除 ${n} 条记录`,
    empty: '还没有记录。先安装并启用窥屏助手，切几次应用后这里会出现状态轨迹。',
    waitingProducer: (source) => `还没有收到来自 ${source} 的事件；确认窥屏助手已安装并启用。`,
    loading: '读取中…',
    failed: '读取失败',
    stateTitle: '当前状态',
    current: (label) => `当前：${label}`,
    trend: '最近轨迹',
    noTrend: '还没有足够的采样点',
    details: '详细记录（显式回忆）',
    detailsNote: '只保留最近一段时间；通讯类应用不在此列。',
    search: '搜索',
    searchPlaceholder: '搜应用名、窗口标题或速写',
    noResults: '没有匹配的记录',
    privacyNote: '通讯类应用已过滤；AI 对话默认模糊为中性；窗口标题只短期保留。',
    axisTech: '技术重度',
    axisWork: '工作',
  } : {
    title: 'Activity diary',
    description: 'A two-axis state space: technical weight and work/entertainment, smoothed over time; details fade.',
    refresh: 'Refresh',
    clear: 'Clear diary',
    clearConfirm: 'Delete detail entries and smoothed state? The screen-sense album is untouched.',
    cleared: (n) => `Deleted ${n} records`,
    empty: 'No entries yet. Install and enable screen-sense, switch apps a few times, then come back.',
    waitingProducer: (source) => `No events from ${source} yet; check that screen-sense is installed and enabled.`,
    loading: 'Loading…',
    failed: 'Could not load',
    stateTitle: 'Current state',
    current: (label) => `Now: ${label}`,
    trend: 'Recent trajectory',
    noTrend: 'Not enough samples yet',
    details: 'Detail entries (explicit recall)',
    detailsNote: 'Kept briefly only; communication apps are excluded.',
    search: 'Search',
    searchPlaceholder: 'app, window title or caption',
    noResults: 'No matching entries',
    privacyNote: 'Communication apps are filtered; AI chats are blurred to neutral; titles are kept briefly.',
    axisTech: 'Technical',
    axisWork: 'Work',
  };
}

export function diaryConfigGroup(language: Language = 'zh'): ConfigGroup {
  const t = diaryText(language);
  const K = 'worlds.screen-diary';
  return {
    id: 'world:screen-diary',
    owner: 'world:screen-diary',
    schema: {
      type: 'object',
      title: t.group,
      description: t.groupDesc,
      properties: {
        [`${K}.enabled`]: { type: 'boolean', title: t.enabledTitle, description: t.enabledDesc, 'x-hot': true },
        [`${K}.pollMs`]: { type: 'integer', title: t.pollTitle, description: t.pollDesc, minimum: 1000, maximum: 300000, 'x-suffix': 'ms', 'x-hot': true },
        [`${K}.lookbackMinutes`]: { type: 'integer', title: t.lookbackTitle, description: t.lookbackDesc, minimum: 0, maximum: 1440, 'x-suffix': 'min' },
        [`${K}.keepDays`]: { type: 'integer', title: t.keepTitle, description: t.keepDesc, minimum: 1, maximum: 3650, 'x-suffix': 'd' },
        [`${K}.detailHours`]: { type: 'integer', title: t.detailTitle, description: t.detailDesc, minimum: 1, maximum: 720, 'x-suffix': 'h', 'x-hot': true },
        [`${K}.blurAi`]: { type: 'boolean', title: t.blurAiTitle, description: t.blurAiDesc, 'x-hot': true },
        [`${K}.ignoreApps`]: { type: 'string', title: t.ignoreTitle, description: t.ignoreAppsDesc, 'x-hot': true },
        [`${K}.smoothing`]: { type: 'number', title: t.smoothingTitle, description: t.smoothingDesc, minimum: 0.05, maximum: 0.9, 'x-hot': true },
        [`${K}.sampleSec`]: { type: 'integer', title: t.sampleTitle, description: t.sampleDesc, minimum: 5, maximum: 600, 'x-suffix': 's' },
        [`${K}.source`]: { type: 'string', title: t.sourceTitle, description: t.sourceDesc },
        [`${K}.maxEventsPerPoll`]: { type: 'integer', title: t.maxTitle, description: t.maxDesc, minimum: 1, maximum: 5000 },
      },
    },
  };
}
