/**
 * Two-axis activity projection and smoothing, with privacy filtering.
 *
 * - vertical: technical weight (heavy / light)
 * - horizontal: work (office) to entertainment
 *
 * Communication apps are filtered out before projection; AI chat apps are blurred to neutral by
 * default. Nothing here keeps window titles: only a category and two numbers leave this module.
 */

export type Category = 'develop' | 'game' | 'casual' | 'office' | 'video' | 'browser' | 'ai' | 'neutral';

export interface Projection {
  category: Category;
  tech: number;
  work: number;
  /** AI chat blurred to neutral; the caller should not store its text. */
  blurred: boolean;
  /** Communication apps: skip entirely. */
  filtered: boolean;
}

export interface ClassifyOptions {
  /** Blur AI chat apps to (0,0) instead of treating them as development work. */
  blurAi: boolean;
  /** Extra app-name substrings to filter out, comma separated. */
  ignoreApps: string;
}

export const PROJECTION_DEFAULTS: ClassifyOptions = { blurAi: true, ignoreApps: '' };

const COMMUNICATION = /wechat|weixin|\bqq\b|tim\.exe|discord|telegram|slack|teams|zoom|webex|meeting|outlook|thunderbird|foxmail|feishu|lark|dingtalk|wecom|whatsapp|signal|skype|line\b|messages|mail/i;
const AI_CHAT = /chatgpt|openai|claude|gemini|copilot|deepseek|kimi|doubao|yuanbao|chatbox|\bpoe\b|character\.ai|lm studio|ollama/i;
const DEVELOP = /code|vscode|cursor|idea|pycharm|webstorm|rider|goland|terminal|powershell|\bcmd\b|bash|wsl|git|docker|kubernetes|github|npm|pnpm|node|python|java|rust|unity|unreal|blender|postman|insomnia/i;
const GAME = /steam|game|league|valorant|minecraft|elden|genshin|honkai|starrail|epicgames|battle\.net|wegame|ubisoft|rockstar|riot/i;
const CASUAL = /gacha|抽卡|放置|挂机|afk|clicker|idle game|养成|放置类/i;
const OFFICE = /word|excel|powerpoint|onenote|notion|obsidian|acrobat|\bpdf\b|wps|libreoffice|office|docs|excel/i;
const VIDEO = /bilibili|youtube|netflix|iqiyi|youku|qqvideo|tencentvideo|\bvlc\b|mpv|potplayer|disney|primevideo|twitch|spotify|music/i;
const BROWSER = /chrome|edge|firefox|safari|brave|opera|chromium/i;
const DEV_TITLE = /github|gitlab|\bnpm\b|pnpm|stackoverflow|developer|localhost|api\b|docs|documentation|code/i;
const VIDEO_TITLE = /bilibili|youtube|netflix|视频|直播|番剧|电影/i;
const OFFICE_TITLE = /google docs|office|excel|word|pdf|notion|文档/i;
const GAME_TITLE = /steam|游戏|game/i;

const pos = (category: Category, tech: number, work: number, blurred = false): Projection => ({ category, tech, work, blurred, filtered: false });
const NEUTRAL: Projection = pos('neutral', 0, 0);

/** Project one foreground window to the two axes. Titles are only used to infer a browser's topic. */
export function classify(app: string | null, title: string | null, options: ClassifyOptions = PROJECTION_DEFAULTS): Projection {
  const a = app?.trim() ?? '';
  const t = title?.trim() ?? '';
  const extra = options.ignoreApps.split(',').map((item) => item.trim()).filter(Boolean);
  if (!a) return NEUTRAL;
  if (COMMUNICATION.test(a)) return { ...NEUTRAL, filtered: true };
  if (extra.some((item) => a.toLowerCase().includes(item.toLowerCase()))) return { ...NEUTRAL, filtered: true };
  if (AI_CHAT.test(a)) {
    return options.blurAi ? { ...NEUTRAL, category: 'ai', blurred: true } : pos('develop', 0.5, 0.4);
  }
  if (DEVELOP.test(a)) return pos('develop', 0.8, 0.6);
  if (GAME.test(a)) return pos('game', 0.6, -0.8);
  if (OFFICE.test(a)) return pos('office', -0.2, 0.8);
  if (VIDEO.test(a)) return pos('video', -0.5, -0.8);
  if (BROWSER.test(a)) {
    if (DEV_TITLE.test(t)) return pos('develop', 0.8, 0.6);
    if (VIDEO_TITLE.test(t)) return pos('video', -0.5, -0.8);
    if (OFFICE_TITLE.test(t)) return pos('office', -0.2, 0.8);
    if (GAME_TITLE.test(t)) return pos('game', 0.6, -0.8);
    return NEUTRAL;
  }
  return NEUTRAL;
}

/** Projection for an explicit category override. */
export function projectionFor(category: Category): Projection {
  const points: Record<Category, [number, number]> = {
    develop: [0.8, 0.6], game: [0.6, -0.8], casual: [0.25, -0.35],
    office: [-0.2, 0.8], video: [-0.5, -0.8], browser: [0, 0], ai: [0, 0], neutral: [0, 0],
  };
  const [tech, work] = points[category];
  return pos(category, tech, work, category === 'ai');
}

/** The quadrant and its Chinese/English label for a smoothed point. */
export function encodeState(tech: number, work: number): { category: Category; zh: string; en: string } {
  if (Math.abs(tech) < 0.2 && Math.abs(work) < 0.2) return { category: 'neutral', zh: '中性', en: 'neutral' };
  if (work >= 0.2) {
    return tech >= 0.2
      ? { category: 'develop', zh: '开发/工作', en: 'developing / work' }
      : { category: 'office', zh: '文书/工作', en: 'documents / work' };
  }
  return tech >= 0.2
    ? { category: 'game', zh: '游戏/娱乐', en: 'playing / entertainment' }
    : { category: 'video', zh: '视频/娱乐', en: 'watching / entertainment' };
}

/** Exponential moving average over projected points; one instance per World. */
export class StateFilter {
  private tech = 0;
  private work = 0;
  private seen = false;

  constructor(private readonly alpha = 0.25) {}

  observe(point: { tech: number; work: number }): { tech: number; work: number } {
    const alpha = Math.min(0.9, Math.max(0.05, this.alpha));
    if (!this.seen) {
      this.tech = point.tech;
      this.work = point.work;
      this.seen = true;
    } else {
      this.tech += alpha * (point.tech - this.tech);
      this.work += alpha * (point.work - this.work);
    }
    return { tech: this.tech, work: this.work };
  }

  get current(): { tech: number; work: number } {
    return { tech: this.tech, work: this.work };
  }
}

/** Compact duration text, e.g. `2 小时 13 分`. */
export function formatSpan(ms: number, language: 'zh' | 'en' = 'zh'): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (language === 'en') return hours ? `${hours}h ${rest}m` : `${rest}m`;
  return hours ? `${hours} 小时 ${rest} 分` : `${rest} 分`;
}

/** Human label for a category in event text. */
export function categoryLabel(category: Category, language: 'zh' | 'en'): string {
  const zh: Record<Category, string> = {
    develop: '开发', game: '游戏', casual: '挂机/轻娱乐', office: '文书', video: '视频', browser: '浏览器', ai: 'AI', neutral: '中性',
  };
  const en: Record<Category, string> = {
    develop: 'development', game: 'gaming', casual: 'casual gaming', office: 'documents', video: 'video', browser: 'browser', ai: 'AI', neutral: 'neutral',
  };
  return (language === 'en' ? en : zh)[category] ?? category;
}