/** Config section `worlds.screen-diary`: which event stream to read and how much to keep. */
import type { ConfigGroup } from 'cortico/core/config-schema.ts';
import type { Language } from 'cortico/core/language.ts';

export interface DiaryConfig {
  /** Read the producer's events; the World itself is enabled from the World overview. */
  enabled: boolean;
  /** How often the event store is checked for new events. */
  pollMs: number;
  /** On the first run, import this many minutes of existing events. */
  lookbackMinutes: number;
  /** Entries older than this many days are dropped. */
  keepDays: number;
  /** The event source id to read; the producer is `screen-sense` by default. */
  source: string;
  /** Most events imported per poll; the next poll continues from the last cursor. */
  maxEventsPerPoll: number;
}

export const DIARY_DEFAULTS: DiaryConfig = {
  enabled: false,
  pollMs: 5000,
  lookbackMinutes: 60,
  keepDays: 30,
  source: 'screen-sense',
  maxEventsPerPoll: 500,
};

export type DiaryConfigSection = DiaryConfig;

/** Text for the console config group; `zh` and `en` are complete. */
function diaryText(language: Language) {
  const zh = language === 'zh' || language === 'zh-Hant';
  return zh ? {
    group: '事件流',
    groupDesc: '从哪里读事件、读多久、保留多久。',
    enabledTitle: '读取事件流',
    enabledDesc: '打开后按固定间隔增量读取生产方的事件。',
    pollTitle: '轮询间隔',
    pollDesc: '每隔这么久检查一次新事件。',
    lookbackTitle: '首次回填',
    lookbackDesc: '第一次启动时导入最近多少分钟已有的历史事件。',
    keepTitle: '保留天数',
    keepDesc: '超过后删除最旧的日记条目。',
    sourceTitle: '事件来源',
    sourceDesc: '生产方的 World id，默认 screen-sense（窥屏助手）。',
    maxTitle: '单次处理上限',
    maxDesc: '一次最多导入多少条；超出的留给下一拍继续。',
    storage: {
      label: '活动日记',
      note: '删除全部已整理的日记条目；不会影响生产方的相册与配置。',
      stat: (n: number) => `${n} 条记录`,
      cleared: (n: number) => `已删除 ${n} 条记录`,
    },
  } : {
    group: 'Event stream',
    groupDesc: 'Where events come from, how far back to read, and how long to keep them.',
    enabledTitle: 'Read the event stream',
    enabledDesc: 'When on, new events are imported at a fixed interval.',
    pollTitle: 'Poll interval',
    pollDesc: 'How often to check for new events.',
    lookbackTitle: 'First import',
    lookbackDesc: 'On the first run, import up to this many minutes of existing events.',
    keepTitle: 'Days kept',
    keepDesc: 'Older diary entries are dropped past this many days.',
    sourceTitle: 'Event source',
    sourceDesc: 'The producer World id; `screen-sense` by default.',
    maxTitle: 'Events per poll',
    maxDesc: 'Most events imported at once; the rest wait for the next poll.',
    storage: {
      label: 'Activity diary',
      note: 'Deletes every collected diary entry; the producer album and settings are untouched.',
      stat: (n: number) => `${n} entries`,
      cleared: (n: number) => `Deleted ${n} entries`,
    },
  };
}

export function diaryStorageText(language: Language) {
  return diaryText(language).storage;
}

/** The timeline panel's text, in the browser's language. */
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
  total: (n: number) => string;
  search: string;
  searchPlaceholder: string;
  noResults: string;
  today: string;
  stats: (days: number, events: number) => string;
}

export function diaryPanelText(language: Language): DiaryPanelText {
  const zh = language === 'zh' || language === 'zh-Hant';
  return zh ? {
    title: '活动日记',
    description: '窥屏助手事件流整理出的时间线：前台切换与视觉速写，按天和小时排列。',
    refresh: '刷新',
    clear: '清空日记',
    clearConfirm: '删除整理好的全部日记条目？不会影响窥屏助手的相册。',
    cleared: (n) => `已删除 ${n} 条记录`,
    empty: '还没有记录。先安装并启用窥屏助手，切几次应用后这里会出现内容。',
    waitingProducer: (source) => `还没有收到来自 ${source} 的事件；确认窥屏助手已安装并启用。`,
    loading: '读取中…',
    failed: '读取失败',
    total: (n) => `${n} 条记录`,
    search: '搜索',
    searchPlaceholder: '搜应用名、窗口标题或速写',
    noResults: '没有匹配的记录',
    today: '今天',
    stats: (days, events) => `${days} 天 · ${events} 条`,
  } : {
    title: 'Activity diary',
    description: 'A timeline built from the screen-sense event stream: foreground switches and vision captions by day and hour.',
    refresh: 'Refresh',
    clear: 'Clear diary',
    clearConfirm: 'Delete every collected diary entry? The screen-sense album is untouched.',
    cleared: (n) => `Deleted ${n} entries`,
    empty: 'No entries yet. Install and enable screen-sense, switch apps a few times, then come back.',
    waitingProducer: (source) => `No events from ${source} yet; check that screen-sense is installed and enabled.`,
    loading: 'Loading…',
    failed: 'Could not load',
    total: (n) => `${n} ${n === 1 ? 'entry' : 'entries'}`,
    search: 'Search',
    searchPlaceholder: 'app, window title or caption',
    noResults: 'No matching entries',
    today: 'Today',
    stats: (days, events) => `${days} days · ${events} entries`,
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
        [`${K}.keepDays`]: { type: 'integer', title: t.keepTitle, description: t.keepDesc, minimum: 1, maximum: 3650, 'x-suffix': 'd', 'x-hot': true },
        [`${K}.source`]: { type: 'string', title: t.sourceTitle, description: t.sourceDesc },
        [`${K}.maxEventsPerPoll`]: { type: 'integer', title: t.maxTitle, description: t.maxDesc, minimum: 1, maximum: 5000 },
      },
    },
  };
}
