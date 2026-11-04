/**
 * Activity diary: a consumer World. It reads the producer's event stream from the host store,
 * projects each non-private foreground app onto two axes (technical weight, work/entertainment),
 * smooths the trajectory and keeps the gist; window titles only survive for `detailHours`.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Language } from 'cortico/core/language.ts';
import type { EventEnvelope, ToolDef, ToolOutcome, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { shortTime } from 'cortico/core/util.ts';
import { DiaryBook, type DiaryEntry } from './book.ts';
import { diaryConfigGroup, diaryPanelText, diaryStorageText, type DiaryConfigSection } from './config.ts';
import { MODEL_TEXT, type ModelLanguage, type ModelText } from './model-text.ts';
import { classify, encodeState, StateFilter } from './state.ts';

const ENV_PROMPT_FILES: Record<ModelLanguage, string> = {
  zh: fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url)),
  en: fileURLToPath(new URL('./ENV_PROMPT.en.md', import.meta.url)),
};

export const SCREEN_DIARY_ID = 'screen-diary';
const BIN_MINUTES = 30;

export interface DiaryOptions {
  cfg: DiaryConfigSection;
  timezone: string;
  dataDir: string;
  modelLanguage?: () => ModelLanguage;
  language?: () => Language;
}

export const SCREEN_DIARY_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'diary_state',
    tags: ['read'],
    description: 'The current smoothed activity state (technical weight and work/entertainment) plus the most recent samples. Use it to sense what the person is doing now.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'diary_recent',
    tags: ['read'],
    description: 'The most recent smoothed state samples (default 10), newest first. Cheaper and coarser than reading detail entries.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Most samples to return; default 10.' } },
    },
  },
  {
    name: 'diary_today',
    tags: ['read'],
    description: 'The smoothed state for one local day, in half-hour bins (today by default). Use it for a rough recap, not exact recall.',
    parameters: { type: 'object', properties: { day: { type: 'string', description: 'Local date, YYYY-MM-DD; today when omitted.' } } },
  },
  {
    name: 'diary_search',
    tags: ['read'],
    description: 'Explicit recall: search short-lived detail entries (app, title, caption, text) when approximate memory is not enough. Returns at most 5 matches.',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Case-insensitive text to look for.' },
        limit: { type: 'integer', minimum: 1, maximum: 5, description: 'Most matches; default 3.' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'diary_stats',
    tags: ['read'],
    description: 'How many days and state samples the diary holds, and which states dominate.',
    parameters: { type: 'object', properties: {} },
  },
];

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class ScreenDiaryWorld implements World {
  readonly id = SCREEN_DIARY_ID;

  private host: WorldHost | null = null;
  private book: DiaryBook | null = null;
  private filter: StateFilter | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private lastSampleAt = 0;

  constructor(private readonly opts: DiaryOptions) {}

  envPromptVars(): Record<string, string> {
    return {};
  }

  tools(): ToolDef[] {
    const handlers: Record<string, ToolDef['handler']> = {
      diary_state: async () => this.stateOutcome(),
      diary_recent: async (args) => this.recentOutcome(args),
      diary_today: async (args) => this.today(args),
      diary_search: async (args) => this.search(args),
      diary_stats: async () => this.stats(),
    };
    return SCREEN_DIARY_TOOL_DECLS.map((decl) => ({ ...decl, handler: handlers[decl.name] }));
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    this.book = new DiaryBook(join(this.opts.dataDir, 'diary'), this.opts.timezone, Math.max(1, this.opts.cfg.keepDays), Math.max(1, this.opts.cfg.detailHours));
    this.filter = new StateFilter(this.opts.cfg.smoothing);
    const latest = this.book.samples(1)[0];
    if (latest) {
      this.filter.observe({ tech: latest.tech, work: latest.work });
      this.lastSampleAt = Date.parse(latest.ts) || 0;
    }
    if (this.book.sampleCount === 0 && this.book.size > 0) this.backfill(this.book);
    if (!this.opts.cfg.enabled) return;
    void this.poll();
    this.timer = setInterval(() => { void this.poll(); }, Math.max(1000, this.opts.cfg.pollMs));
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.book = null;
    this.filter = null;
    this.host = null;
  }

  webUi(language: Language = 'zh'): WorldWebUiDecl {
    const t = diaryPanelText(language);
    return {
      label: language === 'zh' || language === 'zh-Hant' ? '活动日记' : 'Activity diary',
      panels: [{ id: 'timeline', title: t.title, description: t.description, getMethods: ['state', 'list', 'search', 'clear'] }],
      invoke: (panel, method, args) => this.invoke(panel, method, args),
      config: [diaryConfigGroup(language)],
      storage: [{
        key: 'diary',
        label: diaryStorageText(language).label,
        kind: 'disk',
        location: 'data/diary/',
        danger: true,
        note: diaryStorageText(language).note,
        stat: () => diaryStorageText(language).stat(String(this.book?.size ?? 0), String(this.book?.sampleCount ?? 0)),
        clear: () => diaryStorageText(language).cleared(this.clear()),
      }],
      promptDocs: [{
        key: `worlds.${SCREEN_DIARY_ID}.envPrompt`,
        title: language === 'zh' || language === 'zh-Hant' ? '活动日记' : 'Activity diary',
        description: language === 'zh' || language === 'zh-Hant'
          ? '说明状态空间、隐私过滤与显式回忆。'
          : 'Explains the state space, privacy filter and explicit recall.',
        path: ENV_PROMPT_FILES[this.modelLanguage()],
        role: 'envPrompt',
      }],
    };
  }

  /* ---------- event import ---------- */

  private async poll(): Promise<void> {
    const host = this.host, book = this.book, filter = this.filter;
    if (!host || !book || !filter || this.busy) return;
    this.busy = true;
    try {
      const latest = host.store.latestCursor();
      if (latest <= book.cursor) return;
      const source = this.opts.cfg.source.trim() || 'screen-sense';
      const limit = Math.max(1, this.opts.cfg.maxEventsPerPoll);
      const events: EventEnvelope[] = book.cursor === 0
        ? host.store.range({ fromTs: new Date(Date.now() - Math.max(0, this.opts.cfg.lookbackMinutes) * 60_000).toISOString(), toCursor: latest, source, limit })
        : host.store.range({ fromCursor: book.cursor + 1, toCursor: latest, source, limit });
      if (events.length === 0) return;
      book.ingest(events, (entry) => this.project(entry, filter));
    } catch (err) {
      this.host?.log.child('diary').warn('读取事件流失败', { err: errText(err) });
    } finally {
      this.busy = false;
    }
  }

  /** Privacy filter, projection and smoothing for one event; null means it is not stored at all. */
  private project(entry: DiaryEntry, filter: StateFilter): DiaryEntry | null {
    const projection = classify(entry.app ?? null, entry.title ?? null, {
      blurAi: this.opts.cfg.blurAi,
      ignoreApps: this.opts.cfg.ignoreApps,
    });
    // communication apps and blurred AI chats never reach the diary
    if (projection.filtered || projection.blurred) return null;
    const at = Date.parse(entry.ts);
    if (Number.isNaN(at)) return null;
    const smoothed = filter.observe({ tech: projection.tech, work: projection.work });
    if (at - this.lastSampleAt >= Math.max(5, this.opts.cfg.sampleSec) * 1000) {
      const encoded = encodeState(smoothed.tech, smoothed.work);
      this.book?.addSample({
        ts: new Date(at).toISOString(),
        tech: Math.round(smoothed.tech * 1000) / 1000,
        work: Math.round(smoothed.work * 1000) / 1000,
        category: encoded.category,
        zh: encoded.zh,
        en: encoded.en,
      });
      this.lastSampleAt = at;
    }
    return { ...entry, category: projection.category, tech: projection.tech, work: projection.work };
  }

  /** 0.1 stored only detail entries; replay them through the same projection so the panel has history. */
  private backfill(book: DiaryBook): void {
    const filter = this.filter;
    if (!filter) return;
    const step = Math.max(60_000, Math.max(5, this.opts.cfg.sampleSec) * 1000);
    let last = 0;
    for (const entry of book.chronological()) {
      const projection = classify(entry.app ?? null, entry.title ?? null, {
        blurAi: this.opts.cfg.blurAi,
        ignoreApps: this.opts.cfg.ignoreApps,
      });
      if (projection.filtered || projection.blurred) continue;
      const at = Date.parse(entry.ts);
      if (Number.isNaN(at)) continue;
      const smoothed = filter.observe({ tech: projection.tech, work: projection.work });
      if (at - last < step) continue;
      const encoded = encodeState(smoothed.tech, smoothed.work);
      book.addSample({
        ts: new Date(at).toISOString(),
        tech: Math.round(smoothed.tech * 1000) / 1000,
        work: Math.round(smoothed.work * 1000) / 1000,
        category: encoded.category,
        zh: encoded.zh,
        en: encoded.en,
      });
      last = at;
    }
    // remove pre-0.2 sensitive detail entries (communication apps and blurred AI chats)
    book.retainEntries((entry) => {
      const projection = classify(entry.app ?? null, entry.title ?? null, {
        blurAi: this.opts.cfg.blurAi,
        ignoreApps: this.opts.cfg.ignoreApps,
      });
      return !(projection.filtered || projection.blurred);
    });
    this.lastSampleAt = last;
  }

  /* ---------- tools ---------- */

  private stateLabel(): string {
    const current = this.filter?.current ?? { tech: 0, work: 0 };
    const encoded = encodeState(current.tech, current.work);
    return this.modelLanguage() === 'en' ? encoded.en : encoded.zh;
  }

  private stateOutcome(): ToolOutcome {
    const book = this.book;
    if (!book || book.sampleCount === 0) return { text: this.t.empty };
    const recent = book.samples(10).map((sample) => this.t.recentLine(this.clock(sample.ts), this.modelLanguage() === 'en' ? sample.en : sample.zh));
    return { text: [this.t.state(this.stateLabel()), this.t.recentHead(recent.length), ...recent].join('\n') };
  }

  private recentOutcome(args: Record<string, unknown>): ToolOutcome {
    const book = this.book;
    if (!book || book.sampleCount === 0) return { text: this.t.empty };
    const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.min(20, Math.max(1, Math.round(args.limit))) : 10;
    const samples = book.samples(limit);
    return {
      text: [this.t.recentHead(samples.length), ...samples.map((sample) => this.t.recentLine(this.clock(sample.ts), this.modelLanguage() === 'en' ? sample.en : sample.zh))].join('\n'),
    };
  }

  private today(args: Record<string, unknown>): ToolOutcome {
    const book = this.book;
    if (!book) return { text: this.t.empty };
    const day = typeof args.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.day) ? args.day : undefined;
    const bins = this.bins(day);
    if (bins.length === 0) return { text: this.t.noSamples };
    return { text: [this.t.todayHead(day ?? bins[0]!.day), ...bins.map((bin) => this.t.binLine(bin.range, bin.label))].join('\n') };
  }

  private search(args: Record<string, unknown>): ToolOutcome {
    const book = this.book;
    if (!book) return { text: this.t.empty };
    const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : '';
    if (!keyword) return { text: this.t.noMatch(''), failed: true };
    const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.min(5, Math.max(1, Math.round(args.limit))) : 3;
    const entries = book.search(keyword, limit);
    if (entries.length === 0) return { text: this.t.noMatch(keyword) };
    return {
      text: [this.t.searchHead(keyword, entries.length), ...entries.map((entry) => this.t.detailLine(entry, this.clock(entry.ts)))].join('\n'),
    };
  }

  private stats(): ToolOutcome {
    const book = this.book;
    if (!book) return { text: this.t.empty };
    const stats = book.stats();
    const counts = new Map<string, number>();
    for (const sample of book.samples(10_000)) {
      const label = this.modelLanguage() === 'en' ? sample.en : sample.zh;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, count]) => ({ label, count }));
    return { text: this.t.stats(stats.days, stats.samples, top) };
  }

  /** Half-hour bins of smoothed state for one local day. */
  private bins(day?: string): Array<{ day: string; range: string; label: string }> {
    const book = this.book;
    if (!book) return [];
    const samples = book.samplesOfDay(day);
    const buckets = new Map<string, { day: string; from: string; to: string; labels: Map<string, number> }>();
    for (const sample of samples) {
      const parts = this.localClock(sample.ts);
      const minute = Number(parts.minute) < BIN_MINUTES ? '00' : '30';
      const from = `${parts.hour}:${minute}`;
      const endMinute = minute === '00' ? '30' : '00';
      const endHour = minute === '00' ? parts.hour : String((Number(parts.hour) + 1) % 24).padStart(2, '0');
      const key = `${parts.day} ${from}`;
      const bucket = buckets.get(key) ?? { day: parts.day, from, to: `${endHour}:${endMinute}`, labels: new Map<string, number>() };
      const label = this.modelLanguage() === 'en' ? sample.en : sample.zh;
      bucket.labels.set(label, (bucket.labels.get(label) ?? 0) + 1);
      buckets.set(key, bucket);
    }
    return [...buckets.values()]
      .sort((a, b) => `${a.day} ${a.from}`.localeCompare(`${b.day} ${b.from}`))
      .slice(-24)
      .map((bucket) => {
        const label = [...bucket.labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
        return { day: bucket.day, range: `${bucket.from}–${bucket.to}`, label };
      });
  }

  private localClock(ts: string): { day: string; hour: string; minute: string } {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.opts.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(ts));
    const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
    return {
      day: `${get('year')}-${get('month')}-${get('day')}`,
      hour: get('hour') === '24' ? '00' : get('hour'),
      minute: get('minute'),
    };
  }

  /* ---------- panel ---------- */

  private async invoke(panel: string, method: string, args: unknown[]): Promise<unknown> {
    if (panel !== 'timeline') return null;
    const book = this.book;
    switch (method) {
      case 'state': {
        const current = this.filter?.current ?? { tech: 0, work: 0 };
        const encoded = encodeState(current.tech, current.work);
        const samples = (book?.samples(240) ?? []).map((sample) => ({ ts: sample.ts, tech: sample.tech, work: sample.work, zh: sample.zh, en: sample.en }));
        const stats = book?.stats() ?? { total: 0, days: 0, samples: 0, topApps: [] };
        return {
          enabled: this.opts.cfg.enabled,
          source: this.opts.cfg.source.trim() || 'screen-sense',
          current: { tech: current.tech, work: current.work, zh: encoded.zh, en: encoded.en, category: encoded.category },
          samples,
          entries: stats.total,
          days: stats.days,
          lastCursor: book?.cursor ?? 0,
        };
      }
      case 'list': {
        const raw = (args[0] ?? {}) as Record<string, unknown>;
        const limit = typeof raw.limit === 'number' && Number.isFinite(raw.limit) ? Math.min(200, Math.max(1, Math.round(raw.limit))) : 50;
        return { entries: (book?.recent(limit) ?? []).map((entry) => this.view(entry)) };
      }
      case 'search': {
        const keyword = typeof args[0] === 'string' ? args[0] : '';
        const limit = typeof args[1] === 'number' && Number.isFinite(args[1]) ? Math.min(50, Math.max(1, Math.round(args[1]))) : 20;
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
    this.filter = new StateFilter(this.opts.cfg.smoothing);
    this.lastSampleAt = 0;
    return removed;
  }

  private view(entry: DiaryEntry): Record<string, unknown> {
    const clock = this.localClock(entry.ts);
    return { ...entry, day: clock.day, hour: clock.hour, clock: this.clock(entry.ts) };
  }

  private clock(ts: string): string {
    return shortTime(this.opts.timezone, new Date(ts));
  }

  private get t(): ModelText {
    return MODEL_TEXT[this.modelLanguage()];
  }

  private modelLanguage(): ModelLanguage {
    return this.modelLanguageRaw();
  }

  private modelLanguageRaw(): ModelLanguage {
    return this.opts.modelLanguage?.() ?? 'zh';
  }
}
