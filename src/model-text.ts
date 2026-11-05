/** 这个 World 让模型读到的文本：状态、轨迹、在场切换与显式回忆的回执，中英各一份。 */
import type { DiaryEntry } from './book.ts';

const zh = {
  empty: '活动日记还没有状态采样。',
  state: (label: string) => `[diary] 当前状态：${label}`,
  recentHead: (n: number) => `[diary] 最近 ${n} 个状态采样：`,
  recentLine: (clock: string, label: string) => `${clock} ${label}`,
  todayHead: (day: string) => `[diary] ${day} 的平滑状态：`,
  binLine: (range: string, label: string) => `${range} ${label}`,
  noSamples: '这一天还没有状态采样。',
  searchHead: (keyword: string, n: number) => `[diary] 显式回忆：匹配「${keyword}」的最近 ${n} 条细节：`,
  noMatch: (keyword: string) => `日记里没有匹配「${keyword}」的细节记录。`,
  detailLine: (entry: DiaryEntry, clock: string) => {
    const app = entry.app ? `${entry.app}${entry.title ? `(${entry.title})` : ''}:` : '';
    return `${clock} ${app}${entry.caption ?? entry.text}`;
  },
  reengage: (gap: string, category: string) => `[presence] 安静了 ${gap} 后回到${category}。`,
  checkin: (gap: string, category: string) => `[presence] 已经 ${gap} 没有窗口切换，可能专注或离开（最后在${category}）。可以提醒休息，或轻声确认。`,
  stats: (days: number, samples: number, top: Array<{ label: string; count: number }>) =>
    `[diary] ${days} 天、${samples} 个状态采样` + (top.length ? `；主要状态：${top.map((item) => `${item.label} ${item.count}`).join('、')}` : '。'),
};

const en: typeof zh = {
  empty: 'The activity diary has no state samples yet.',
  state: (label) => `[diary] Current state: ${label}`,
  recentHead: (n) => `[diary] The ${n} most recent state samples:`,
  recentLine: (clock, label) => `${clock} ${label}`,
  todayHead: (day) => `[diary] Smoothed states for ${day}:`,
  binLine: (range, label) => `${range} ${label}`,
  noSamples: 'No state samples for that day yet.',
  searchHead: (keyword, n) => `[diary] Explicit recall: the ${n} most recent detail matches for "${keyword}":`,
  noMatch: (keyword) => `No detail entries match "${keyword}".`,
  detailLine: (entry, clock) => {
    const app = entry.app ? `${entry.app}${entry.title ? ` (${entry.title})` : ''}: ` : '';
    return `${clock} ${app}${entry.caption ?? entry.text}`;
  },
  reengage: (gap, category) => `[presence] Back to ${category} after ${gap} of quiet.`,
  checkin: (gap, category) => `[presence] ${gap} without a window switch; possibly focused or away (last: ${category}). A break reminder or a soft check-in fits.`,
  stats: (days, samples, top) =>
    `[diary] ${days} days, ${samples} state samples` + (top.length ? `; main states: ${top.map((item) => `${item.label} ${item.count}`).join(', ')}` : '.'),
};

export type ModelLanguage = 'zh' | 'en';
export type ModelText = typeof zh;
export const MODEL_TEXT: Record<ModelLanguage, ModelText> = { zh, en };
