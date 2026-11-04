/**
 * Activity diary: a consumer World. It never captures the screen; it reads the producer's
 * events from the host event store (`host.store.range`), keeps them in its own local diary and
 * offers tools and a timeline panel. The producer does not know this World exists.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Language } from 'cortico/core/language.ts';
import type { EventEnvelope, ToolDef, ToolOutcome, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { shortTime } from 'cortico/core/util.ts';
import { DiaryBook, type DiaryEntry } from './book.ts';
import { diaryConfigGroup, diaryPanelText, diaryStorageText, type DiaryConfigSection } from './config.ts';
import { MODEL_TEXT, type ModelLanguage, type ModelText } from './model-text.ts';

const ENV_PROMPT_FILES: Record<ModelLanguage, string> = {
  zh: fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url)),
  en: fileURLToPath(new URL('./ENV_PROMPT.en.md', import.meta.url)),
};

export const SCREEN_DIARY_ID = 'screen-diary';

export interface DiaryOptions {
  cfg: DiaryConfigSection;
  timezone: string;
  /** Diary data lives in `<data>/diary`. */
  dataDir: string;
  modelLanguage?: () => ModelLanguage;
  language?: () => Language;
}

export const SCREEN_DIARY_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'diary_today',
    tags: ['read'],
    description: 'Read the activity diary for one local day (today by default): foreground switches and vision captions grouped by hour.',
    parameters: {
      type: 'object',
      properties: { day: { type: 'string', description: 'Local date, YYYY-MM-DD; today when omitted.' } },
    },
  },
  {
    name: 'diary_search',
    tags: ['read'],
    description: 'Search the activity diary by app name, window title, caption or event text; newest matches first.',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Case-insensitive text to look for.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Most matches to return; default 10.' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'diary_stats',
    tags: ['read'],
    description: 'Report how many entries the diary holds, over how many days, and the apps seen most often.',
    parameters: { type: 'object', properties: {} },
  },
];

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class ScreenDiaryWorld implements World {
  readonly id = SCREEN_DIARY_ID;

  private host: WorldHost | null = null;
  private book: DiaryBook | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(private readonly opts: DiaryOptions) {}

  envPromptVars(): Record<string, string> {
    return {};
  }

  tools(): ToolDef[] {
    const handlers: Record<string, ToolDef['handler']> = {
      diary_today: async (args) => this.today(args),
      diary_search: async (args) => this.search(args),
      diary_stats: async () => this.stats(),
    };
    return SCREEN_DIARY_TOOL_DECLS.map((decl) => ({ ...decl, handler: handlers[decl.name] }));
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    this.book = new DiaryBook(join(this.opts.dataDir, 'diary'), this.opts.timezone, Math.max(1, this.opts.cfg.keepDays));
    if (!this.opts.cfg.enabled) return;
    void this.poll();
    this.timer = setInterval(() => { void this.poll(); }, Math.max(1000, this.opts.cfg.pollMs));
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.book = null;
    this.host = null;
  }

  webUi(language: Language = 'zh'): WorldWebUiDecl {
    const t = diaryPanelText(language);
    return {
      label: language === 'zh' || language === 'zh-Hant' ? '活动日记' : 'Activity diary',
      panels: [{ id: 'timeline', title: t.title, description: t.description, getMethods: ['list', 'state', 'search', 'clear'] }],
      invoke: (panel, method, args) => this.invoke(panel, method, args),
      config: [diaryConfigGroup(language)],
      storage: [{
        key: 'diary',
        label: diaryStorageText(language).label,
        kind: 'disk',
        location: 'data/diary/',
        danger: true,
        note: diaryStorageText(language).note,
        stat: () => diaryStorageText(language).stat(this.book?.size ?? 0),
        clear: () => diaryStorageText(language).cleared(this.clear()),
      }],
      promptDocs: [{
        key: `worlds.${SCREEN_DIARY_ID}.envPrompt`,
        title: language === 'zh' || language === 'zh-Hant' ? '活动日记' : 'Activity diary',
        description: language === 'zh' || language === 'zh-Hant'
          ? '说明日记工具与事件来源。'
          : 'Explains the diary tools and where its entries come from.',
        path: ENV_PROMPT_FILES[this.modelLanguage()],
        role: 'envPrompt',
      }],
    };
  }

  /* ---------- event import ---------- */

  /** Read new producer events from the host store; the cursor lives on disk, so restarts continue. */
  private async poll(): Promise<void> {
    const host = this.host, book = this.book;
    if (!host || !book || this.busy) return;
    this.busy = true;
    try {
      const latest = host.store.latestCursor();
      if (latest <= book.cursor) return;
      const source = this.opts.cfg.source.trim() || 'screen-sense';
      const limit = Math.max(1, this.opts.cfg.maxEventsPerPoll);
      const events: EventEnvelope[] = book.cursor === 0
        ? host.store.range({ fromTs: new Date(Date.now() - Math.max(0, this.opts.cfg.lookbackMinutes) * 60_000).toISOString(), toCursor: latest, source, limit })
        : host.store.range({ fromCursor: book.cursor + 1, toCursor: latest, source, limit });
      if (events.length) book.ingest(events);
    } catch (err) {
      this.host?.log.child('diary').warn('读取事件流失败', { err: errText(err) });
    } finally {
      this.busy = false;
    }
  }

  /* ---------- tools ---------- */

  private today(args: Record<string, unknown>): ToolOutcome {
    const book = this.book;
    if (!book) return { text: this.t.empty };
    const day = typeof args.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.day) ? args.day : undefined;
    const entries = book.day(day);
    if (entries.length === 0) return { text: this.t.empty };
    const head = this.t.todayHead(day ?? this.localDay(entries[0]!.ts).day, entries.length);
    return { text: [head, ...entries.map((entry) => this.t.line(entry, this.clock(entry.ts)))].join('\n') };
  }

  private search(args: Record<string, unknown>): ToolOutcome {
    const book = this.book;
    if (!book) return { text: this.t.empty };
    const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : '';
    if (!keyword) return { text: this.t.noMatch(''), failed: true };
    const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.min(50, Math.max(1, Math.round(args.limit))) : 10;
    const entries = book.search(keyword, limit);
    if (entries.length === 0) return { text: this.t.noMatch(keyword) };
    return {
      text: [this.t.searchHead(keyword, entries.length), ...entries.map((entry) => this.t.line(entry, this.clock(entry.ts)))].join('\n'),
    };
  }

  private stats(): ToolOutcome {
    const book = this.book;
    if (!book) return { text: this.t.empty };
    const stats = book.stats();
    return { text: this.t.stats(stats.days, stats.total, stats.topApps) };
  }

  /* ---------- panel ---------- */

  private async invoke(panel: string, method: string, args: unknown[]): Promise<unknown> {
    if (panel !== 'timeline') return null;
    const book = this.book;
    switch (method) {
      case 'state': {
        const stats = book?.stats() ?? { total: 0, days: 0, topApps: [] };
        return {
          total: stats.total,
          days: stats.days,
          source: this.opts.cfg.source.trim() || 'screen-sense',
          lastCursor: book?.cursor ?? 0,
          enabled: this.opts.cfg.enabled,
        };
      }
      case 'list': {
        const raw = (args[0] ?? {}) as Record<string, unknown>;
        const limit = typeof raw.limit === 'number' && Number.isFinite(raw.limit) ? Math.min(500, Math.max(1, Math.round(raw.limit))) : 100;
        return { entries: (book?.recent(limit) ?? []).map((entry) => this.view(entry)) };
      }
      case 'search': {
        const keyword = typeof args[0] === 'string' ? args[0] : '';
        const limit = typeof args[1] === 'number' && Number.isFinite(args[1]) ? Math.min(100, Math.max(1, Math.round(args[1]))) : 30;
        return { entries: (book?.search(keyword, limit) ?? []).map((entry) => this.view(entry)) };
      }
      case 'clear':
        return { removed: this.clear() };
      default:
        return null;
    }
  }

  private clear(): number {
    const removed = this.book?.clear() ?? 0;
    return removed;
  }

  private view(entry: DiaryEntry): Record<string, unknown> {
    const parts = this.localDay(entry.ts);
    return { ...entry, day: parts.day, hour: parts.hour, clock: this.clock(entry.ts) };
  }

  private localDay(ts: string): { day: string; hour: string } {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.opts.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
    }).formatToParts(new Date(ts));
    const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
    return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: get('hour') === '24' ? '00' : get('hour') };
  }

  private clock(ts: string): string {
    return shortTime(this.opts.timezone, new Date(ts));
  }

  private get t(): ModelText {
    return MODEL_TEXT[this.modelLanguage()];
  }

  private modelLanguage(): ModelLanguage {
    return this.opts.modelLanguage?.() ?? 'zh';
  }
}


