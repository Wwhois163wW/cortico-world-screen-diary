/** 这个 World 让模型读到的文本：日记工具的回执，中英各一份。 */
import type { DiaryEntry } from './book.ts';

const zh = {
  empty: '活动日记还没有记录。',
  todayHead: (day: string, n: number) => `[diary] ${day} 共 ${n} 条：`,
  line: (entry: DiaryEntry, clock: string) => {
    const app = entry.app ? `${entry.app}${entry.title ? `(${entry.title})` : ''}:` : '';
    return `${clock} ${app}${entry.caption ?? entry.text}`;
  },
  noMatch: (keyword: string) => `日记里没有匹配「${keyword}」的记录。`,
  searchHead: (keyword: string, n: number) => `[diary] 匹配「${keyword}」的最近 ${n} 条：`,
  stats: (days: number, total: number, top: Array<{ app: string; count: number }>) =>
    `[diary] ${days} 天共 ${total} 条` + (top.length ? `；最常出现：${top.map((item) => `${item.app} ${item.count} 次`).join('、')}` : '。'),
};

const en: typeof zh = {
  empty: 'The activity diary has no entries yet.',
  todayHead: (day, n) => `[diary] ${day}, ${n} entries:`,
  line: (entry, clock) => {
    const app = entry.app ? `${entry.app}${entry.title ? ` (${entry.title})` : ''}: ` : '';
    return `${clock} ${app}${entry.caption ?? entry.text}`;
  },
  noMatch: (keyword) => `No diary entries match "${keyword}".`,
  searchHead: (keyword, n) => `[diary] The ${n} most recent matches for "${keyword}":`,
  stats: (days, total, top) =>
    `[diary] ${total} entries across ${days} days` + (top.length ? `; most seen: ${top.map((item) => `${item.app} (${item.count})`).join(', ')}` : '.'),
};

export type ModelLanguage = 'zh' | 'en';
export type ModelText = typeof zh;
export const MODEL_TEXT: Record<ModelLanguage, ModelText> = { zh, en };
