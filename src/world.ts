/**
 * Activity diary: a consumer World. It reads the producer's event stream from the host store,
 * projects each non-private foreground app onto two axes (technical weight, work/entertainment),
 * smooths the trajectory and keeps the gist; window titles only survive for `detailHours`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Language } from 'cortico/core/language.ts';
import type { EventEnvelope, ToolDef, ToolOutcome, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { shortTime } from 'cortico/core/util.ts';
import { DiaryBook, type DiaryEntry } from './book.ts';
import { diaryConfigGroup, diaryPanelText, diaryStorageText, type DiaryConfigSection } from './config.ts';
import { MODEL_TEXT, type ModelLanguage, type ModelText } from './model-text.ts';
import { classify, encodeState, StateFilter, categoryLabel, projectionFor } from './state.ts';
import { FlowModel, gapText, type FlowSnapshot } from './flow.ts';
import { AppCatalog, type AppCategory } from './apps.ts';
import { TokenCatalog, tokenize } from './tokens.ts';

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
  {
    name: 'diary_apps',
    tags: ['read'],
    description: 'List the applications seen most recently, their category and their per-app flow-decay override (if any).',
    parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Most apps to return; default 15.' } } },
  },
  {
    name: 'diary_set_app',
    tags: ['write'],
    description: 'Set or clear the per-app category (word class) and flow-decay minutes when the default classification feels wrong for this person.',
    parameters: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Application name exactly as listed by diary_apps.' },
        category: { type: 'string', enum: ['develop', 'game', 'casual', 'office', 'video', 'browser', 'ai', 'neutral', 'filtered'], description: 'Override category; omit to leave unchanged.' },
        decayMinutes: { type: 'integer', minimum: 1, maximum: 180, description: 'Per-app flow-decay minutes; 0 clears the override.' },
      },
      required: ['app'],
    },
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
  private flow: FlowModel | null = null;
  private catalog: AppCatalog | null = null;
  private tokenCatalog: TokenCatalog | null = null;
  private flowActions: Array<{ type: 'reengage' | 'checkin'; text: string; meta: Record<string, unknown> }> = [];

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
      diary_apps: async (args) => this.appsOutcome(args),
      diary_set_app: async (args) => this.setApp(args),
      diary_stats: async () => this.stats(),
    };
    return SCREEN_DIARY_TOOL_DECLS.map((decl) => ({ ...decl, handler: handlers[decl.name] }));
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    this.book = new DiaryBook(join(this.opts.dataDir, 'diary'), this.opts.timezone, Math.max(1, this.opts.cfg.keepDays), Math.max(1, this.opts.cfg.detailHours));
    this.catalog = new AppCatalog(join(this.opts.dataDir, 'diary'));
    this.tokenCatalog = new TokenCatalog(join(this.opts.dataDir, 'diary'));
    this.filter = new StateFilter(this.opts.cfg.smoothing);
    const latest = this.book.samples(1)[0];
    if (latest) {
      this.filter.observe({ tech: latest.tech, work: latest.work });
      this.lastSampleAt = Date.parse(latest.ts) || 0;
    }
    if (this.book.sampleCount === 0 && this.book.size > 0) this.backfill(this.book);
    this.flow = new FlowModel({
      baseDecayMinutes: this.opts.cfg.flowDecayMinutes,
      checkInEnabled: this.opts.cfg.checkInEnabled,
      awayAfterMinutes: this.opts.cfg.awayAfterMinutes,
      checkInCooldownMinutes: this.opts.cfg.checkInCooldownMinutes,
    });
    this.flow.restore(this.readFlow());
    if (this.flow.lastSwitchAt === 0) this.seedFlow();
    if (!this.opts.cfg.enabled) return;
    void this.poll();
    this.timer = setInterval(() => { void this.poll(); }, Math.max(1000, this.opts.cfg.pollMs));
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.book = null;
    this.flow = null;
    this.flowActions = [];
    this.filter = null;
    this.host = null;
  }

  webUi(language: Language = 'zh'): WorldWebUiDecl {
    const t = diaryPanelText(language);
    return {
      label: language === 'zh' || language === 'zh-Hant' ? '活动日记' : 'Activity diary',
      panels: [
        { id: 'timeline', title: t.title, description: t.description, getMethods: ['state', 'list', 'search', 'clear'] },
        {
          id: 'words',
          title: language === 'zh' || language === 'zh-Hant' ? '词汇与衰减' : 'Words and decay',
          description: language === 'zh' || language === 'zh-Hant'
            ? '出现过的应用：查看默认类型，逐行覆盖类型（词性）与流枯竭窗口。'
            : 'Sighted tokens (app names and title words alike): count, coordinates, weight; app tokens can override category and decay.',
          getMethods: ['words', 'setApp'],
        },
        {
          id: 'developer',
          title: language === 'zh' || language === 'zh-Hant' ? '开发者选项' : 'Developer options',
          description: language === 'zh' || language === 'zh-Hant'
            ? '诊断与规则状态；后续的规则编辑会放在这里。'
            : 'Diagnostics and rule status; rule editing will live here next.',
          getMethods: ['diagnostics'],
        },
      ],
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
      if (this.flow) {
        const tick = this.flow.tick(Date.now());
        if (tick.checkIn) {
          const gap = Date.now() - this.flow.lastSwitchAt;
          this.flowActions.push({
            type: 'checkin',
            text: this.t.checkin(gapText(gap, this.modelLanguage()), categoryLabel(this.flow.category, this.modelLanguage())),
            meta: { kind: 'checkin', gapMs: gap },
          });
        }
        this.saveFlow();
      }
      if (latest <= book.cursor) {
        await this.flushFlow();
        return;
      }
      const source = this.opts.cfg.source.trim() || 'screen-sense';
      const limit = Math.max(1, this.opts.cfg.maxEventsPerPoll);
      const events: EventEnvelope[] = book.cursor === 0
        ? host.store.range({ fromTs: new Date(Date.now() - Math.max(0, this.opts.cfg.lookbackMinutes) * 60_000).toISOString(), toCursor: latest, source, limit })
        : host.store.range({ fromCursor: book.cursor + 1, toCursor: latest, source, limit });
      if (events.length === 0) return;
      book.ingest(events, (entry) => this.project(entry, filter));
      await this.flushFlow();
    } catch (err) {
      this.host?.log.child('diary').warn('读取事件流失败', { err: errText(err) });
    } finally {
      this.busy = false;
    }
  }

  /** Privacy filter, projection and smoothing for one event; null means it is not stored at all. */
  private project(entry: DiaryEntry, filter: StateFilter): DiaryEntry | null {
    const app = entry.app ?? '';
    const baseline = classify(app || null, entry.title ?? null, {
      blurAi: this.opts.cfg.blurAi,
      ignoreApps: this.opts.cfg.ignoreApps,
    });
    const at = Date.parse(entry.ts);
    if (Number.isNaN(at)) return null;
    this.catalog?.observe(app, at, baseline.filtered ? 'filtered' : baseline.category);
    const override = app ? this.catalog?.policy(app) : undefined;
    if (override?.category === 'filtered') return null;
    // communication apps and blurred AI chats never reach the diary unless explicitly overridden
    if (!override?.category && (baseline.filtered || baseline.blurred)) return null;
    const projection = override?.category ? projectionFor(override.category) : baseline;
    const customDecay = override?.decayMinutes ?? 0;
    if (entry.type.endsWith('.focus')) {
      this.tokenCatalog?.record(tokenize(entry.app ?? null, entry.title ?? null), at);
    }
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
    const flow = this.flow;
    if (flow && entry.type.endsWith('.focus')) {
      const result = flow.observeSwitch(at, projection.category, customDecay);
      if (result.reengage) {
        this.flowActions.push({
          type: 'reengage',
          text: this.t.reengage(
            gapText(result.reengage.gapMs, this.modelLanguage()),
            categoryLabel(result.reengage.previousCategory, this.modelLanguage()),
          ),
          meta: {
            kind: 'reengage',
            gapMs: result.reengage.gapMs,
            previousCategory: result.reengage.previousCategory,
          },
        });
      }
      this.saveFlow();
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

  private flowPath(): string {
    return join(this.opts.dataDir, 'diary', 'flow.json');
  }

  private readFlow(): FlowSnapshot | null {
    try {
      return JSON.parse(readFileSync(this.flowPath(), 'utf8')) as FlowSnapshot;
    } catch {
      return null;
    }
  }

  private saveFlow(): void {
    if (!this.flow) return;
    try {
      writeFileSync(this.flowPath(), JSON.stringify(this.flow.snapshot()), 'utf8');
    } catch {
      /* the flow state is transient; a failed save is not fatal */
    }
  }

  /** After a restart, seed the flow clock from the latest accepted switch so it is not "busy". */
  /** After a restart, seed the flow clock from the latest accepted switch so it is not "busy". */
  private seedFlow(): void {
    if (!this.book || !this.flow) return;
    const flow = this.flow;
    const entries = this.book.chronological();
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i]!;
      if (!entry.type.endsWith('.focus')) continue;
      const at = Date.parse(entry.ts);
      if (Number.isNaN(at)) return;
      const app = entry.app ?? '';
      const baseline = classify(app || null, entry.title ?? null, {
        blurAi: this.opts.cfg.blurAi,
        ignoreApps: this.opts.cfg.ignoreApps,
      });
      const override = app ? this.catalog?.policy(app) : undefined;
      if (override?.category === 'filtered') return;
      if (!override?.category && (baseline.filtered || baseline.blurred)) return;
      const projection = override?.category ? projectionFor(override.category) : baseline;
      flow.observeSwitch(at, projection.category, override?.decayMinutes ?? 0);
      this.saveFlow();
      return;
    }
  }

  /** Push queued presence events; reengage piggybacks, check-in may start a turn. */
  private async flushFlow(): Promise<void> {
    const host = this.host;
    if (!host) {
      this.flowActions = [];
      return;
    }
    const actions = this.flowActions.splice(0);
    for (const action of actions) {
      try {
        await host.pushEvent({
          type: `screen-diary.${action.type}`,
          source: this.id,
          senderKey: `screen-diary.${action.type}`,
          ts: new Date().toISOString(),
          text: action.text,
          meta: action.meta,
        }, { trigger: action.type === 'checkin' ? 'debounce' : 'piggyback' });
      } catch (err) {
        this.host?.log.child('diary').warn('推送在场事件失败', { err: errText(err) });
      }
    }
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

  private appLabel(category: AppCategory): string {
    if (category === 'filtered') return this.modelLanguage() === 'en' ? 'filtered' : '过滤';
    return categoryLabel(category, this.modelLanguage());
  }

  private appsOutcome(args: Record<string, unknown>): ToolOutcome {
    const catalog = this.catalog;
    if (!catalog) return { text: this.t.empty };
    const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.min(50, Math.max(1, Math.round(args.limit))) : 15;
    const rows = catalog.list().slice(0, limit);
    if (rows.length === 0) return { text: this.t.empty };
    return {
      text: [
        this.t.appsHead(rows.length),
        ...rows.map((row) => this.t.appLine(row.app, this.appLabel(row.category ?? row.defaultCategory), row.decayMinutes ?? 0, row.count)),
      ].join('\n'),
    };
  }

  private setApp(args: Record<string, unknown>): ToolOutcome {
    const catalog = this.catalog;
    const app = typeof args.app === 'string' ? args.app.trim() : '';
    if (!catalog || !app) return { text: this.t.appSet(app || '?', '中性', 0), failed: true };
    const allowed: AppCategory[] = ['develop', 'game', 'casual', 'office', 'video', 'browser', 'ai', 'neutral', 'filtered'];
    const category = typeof args.category === 'string' && allowed.includes(args.category as AppCategory) ? args.category as AppCategory : undefined;
    const decay = typeof args.decayMinutes === 'number' && Number.isFinite(args.decayMinutes) ? (args.decayMinutes > 0 ? Math.round(args.decayMinutes) : 0) : undefined;
    const record = catalog.setPolicy(app, category, decay);
    if (!record) return { text: this.t.noMatch(app), failed: true };
    return { text: this.t.appSet(record.app, this.appLabel(record.category ?? record.defaultCategory), record.decayMinutes ?? 0) };
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
    if (panel !== 'timeline' && panel !== 'words' && panel !== 'developer') return null;
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
      case 'diagnostics': {
        const flow = this.flow;
        const now = Date.now();
        return {
          flow: {
            state: flow?.current ?? 'idle',
            lastSwitchAt: flow?.lastSwitchAt ?? 0,
            gapMs: flow?.lastSwitchAt ? now - flow.lastSwitchAt : 0,
            decayMs: flow?.decayMs() ?? 0,
            category: flow?.category ?? 'neutral',
            checkInEnabled: this.opts.cfg.checkInEnabled,
            baseDecayMinutes: this.opts.cfg.flowDecayMinutes,
            awayAfterMinutes: this.opts.cfg.awayAfterMinutes,
            checkInCooldownMinutes: this.opts.cfg.checkInCooldownMinutes,
          },
          config: {
            source: this.opts.cfg.source,
            sampleSec: this.opts.cfg.sampleSec,
            detailHours: this.opts.cfg.detailHours,
            keepDays: this.opts.cfg.keepDays,
            smoothing: this.opts.cfg.smoothing,
            blurAi: this.opts.cfg.blurAi,
            ignoreApps: this.opts.cfg.ignoreApps,
          },
          counts: {
            apps: this.catalog?.list().length ?? 0,
            tokens: this.tokenCatalog?.count() ?? 0,
            samples: this.book?.sampleCount ?? 0,
            entries: this.book?.size ?? 0,
            cursor: this.book?.cursor ?? 0,
          },
          rules: [
            { id: 'reengage', enabled: true, action: 'screen-diary.reengage', trigger: 'piggyback', title: '长静默后回来' },
            { id: 'checkin', enabled: this.opts.cfg.checkInEnabled, action: 'screen-diary.checkin', trigger: 'debounce', title: '流枯竭时主动搭话' },
          ],
        };
      }
      case 'words': {
        const limit = typeof args[0] === 'number' && Number.isFinite(args[0]) ? Math.min(1000, Math.max(1, Math.round(args[0]))) : 300;
        return { words: this.tokenCatalog?.list(limit) ?? [] };
      }
      case 'setApp': {
        const [appArg, categoryArg, decayArg] = args;
        const app = typeof appArg === 'string' ? appArg : '';
        const allowed: AppCategory[] = ['develop', 'game', 'casual', 'office', 'video', 'browser', 'ai', 'neutral', 'filtered'];
        const category = typeof categoryArg === 'string' && categoryArg && allowed.includes(categoryArg as AppCategory) ? categoryArg as AppCategory : undefined;
        const decay = typeof decayArg === 'number' && Number.isFinite(decayArg) ? (decayArg > 0 ? Math.round(decayArg) : 0) : undefined;
        const record = this.catalog?.setPolicy(app, category, decay);
        return { record: record ?? null };
      }
      case 'clear':
        return { removed: this.clear() };
      default:
        return null;
    }
  }

  private clear(): number {
    const removed = this.book?.clear() ?? 0;
    this.catalog = new AppCatalog(join(this.opts.dataDir, 'diary'));
    this.tokenCatalog = new TokenCatalog(join(this.opts.dataDir, 'diary'));
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
