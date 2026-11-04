import { describe, expect, it } from 'vitest';
import { classify, encodeState, formatSpan, StateFilter } from '../src/state.ts';

describe('classify', () => {
  it('filters communication apps entirely', () => {
    for (const app of ['WeChat.exe', 'QQ.exe', 'Discord.exe', 'Teams.exe', 'Zoom.exe', 'Outlook.exe']) {
      expect(classify(app, 'anything').filtered).toBe(true);
    }
  });

  it('blurs AI chat by default and can treat it as development', () => {
    expect(classify('ChatGPT.exe', 'chat')).toMatchObject({ category: 'ai', blurred: true, tech: 0, work: 0 });
    expect(classify('ChatGPT.exe', 'chat', { blurAi: false, ignoreApps: '' })).toMatchObject({ category: 'develop', blurred: false });
  });

  it('projects known apps to the axes', () => {
    expect(classify('Code.exe', 'main.ts')).toMatchObject({ category: 'develop', tech: 0.8, work: 0.6 });
    expect(classify('steam.exe', 'library')).toMatchObject({ category: 'game', tech: 0.6, work: -0.8 });
    expect(classify('WINWORD.EXE', 'doc')).toMatchObject({ category: 'office', tech: -0.2, work: 0.8 });
    expect(classify('vlc.exe', 'movie')).toMatchObject({ category: 'video', tech: -0.5, work: -0.8 });
  });

  it('infers a browser topic from the window title', () => {
    expect(classify('chrome.exe', 'github.com/pull/1')).toMatchObject({ category: 'develop' });
    expect(classify('chrome.exe', 'bilibili 视频')).toMatchObject({ category: 'video' });
    expect(classify('chrome.exe', 'unknown page')).toMatchObject({ category: 'neutral', tech: 0, work: 0 });
  });

  it('honours extra ignored apps', () => {
    expect(classify('Bank.exe', 'app', { blurAi: true, ignoreApps: 'bank' }).filtered).toBe(true);
  });
});

describe('encodeState', () => {
  it('names the quadrant', () => {
    expect(encodeState(0.5, 0.5).zh).toBe('开发/工作');
    expect(encodeState(-0.5, 0.5).zh).toBe('文书/工作');
    expect(encodeState(0.5, -0.5).zh).toBe('游戏/娱乐');
    expect(encodeState(-0.5, -0.5).zh).toBe('视频/娱乐');
    expect(encodeState(0.05, 0.05).zh).toBe('中性');
  });
});

describe('StateFilter', () => {
  it('smooths towards new points and starts at the first one', () => {
    const filter = new StateFilter(0.5);
    expect(filter.observe({ tech: 1, work: 1 })).toEqual({ tech: 1, work: 1 });
    expect(filter.observe({ tech: 0, work: 0 })).toEqual({ tech: 0.5, work: 0.5 });
    expect(filter.current).toEqual({ tech: 0.5, work: 0.5 });
  });
});

describe('formatSpan', () => {
  it('formats durations in both languages', () => {
    expect(formatSpan(2 * 3_600_000 + 13 * 60_000)).toBe('2 小时 13 分');
    expect(formatSpan(45 * 60_000, 'en')).toBe('45m');
  });
});
