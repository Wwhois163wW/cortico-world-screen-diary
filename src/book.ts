/** Diary storage: short-lived detail entries, long-lived smoothed state samples, and the read cursor. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventEnvelope } from 'cortico/core/types.ts';
import type { Category } from './state.ts';

export interface DiaryEntry {
  cursor: number;
  ts: string;
  type: string;
  text: string;
  app?: string;
  title?: string;
  caption?: string;
  category?: Category;
  tech?: number;
  work?: number;
}

/** One smoothed point of the two-axis state; details fade, these stay longer. */
export interface StateSample {
  ts: string;
  tech: number;
  work: number;
  category: Category;
  zh: string;
  en: string;
}

const ENTRIES = 'entries.jsonl';
const SAMPLES = 'samples.jsonl';
const CURSOR = 'cursor.json';

/** Local day (`YYYY-MM-DD`) and hour (`00`–`23`) of an ISO timestamp in the deployment timezone. */
export function localParts(ts: string, timezone: string): { day: string; hour: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date(ts));
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    hour: get('hour') === '24' ? '00' : get('hour'),
  };
}

/** The meta a producer may attach; unknown shapes are ignored. */
export function entryOf(event: EventEnvelope): DiaryEntry {
  const meta = (event.meta ?? {}) as Record<string, unknown>;
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  return {
    cursor: event.cursor,
    ts: event.ts,
    type: event.type,
    text: event.text,
    ...(text(meta.app) ? { app: text(meta.app) } : {}),
    ...(text(meta.title) ? { title: text(meta.title) } : {}),
    ...(text(meta.caption) ? { caption: text(meta.caption) } : {}),
  };
}

/** Entries are pruned after `detailHours`; smoothed samples survive `keepDays`. */
export class DiaryBook {
  private entries: DiaryEntry[] = [];
  private stateSamples: StateSample[] = [];
  private lastCursor = 0;

  constructor(
    private readonly dir: string,
    private readonly timezone: string,
    private readonly keepDays: number,
    private readonly detailHours = 72,
  ) {
    mkdirSync(dir, { recursive: true });
    this.load();
  }

  get cursor(): number {
    return this.lastCursor;
  }

  get size(): number {
    return this.entries.length;
  }

  get sampleCount(): number {
    return this.stateSamples.length;
  }

  /**
   * Import events and advance the cursor even when `transform` drops an event (privacy filter).
   * Events older than `detailHours` only advance the cursor.
   */
  ingest(events: readonly EventEnvelope[], transform?: (entry: DiaryEntry) => DiaryEntry | null): number {
    const cutoff = Date.now() - Math.max(1, this.detailHours) * 3_600_000;
    let added = 0;
    for (const event of events) {
      this.lastCursor = Math.max(this.lastCursor, event.cursor);
      if (Date.parse(event.ts) < cutoff) continue;
      const entry = transform ? transform(entryOf(event)) : entryOf(event);
      if (!entry) continue;
      this.entries.push(entry);
      appendFileSync(join(this.dir, ENTRIES), `${JSON.stringify(entry)}\n`, 'utf8');
      added += 1;
    }
    writeFileSync(join(this.dir, CURSOR), JSON.stringify({ cursor: this.lastCursor }), 'utf8');
    if (added) this.pruneEntries(cutoff);
    return added;
  }

  /** Persist one smoothed state point; the World decides how often to sample. */
  addSample(sample: StateSample): void {
    this.stateSamples.push(sample);
    appendFileSync(join(this.dir, SAMPLES), `${JSON.stringify(sample)}\n`, 'utf8');
  }

  /** Newest samples first. */
  samples(limit = 200): StateSample[] {
    return this.stateSamples.slice(-Math.max(1, limit)).reverse();
  }

  /** Samples of one local day, oldest first; today when `day` is omitted. */
  samplesOfDay(day?: string): StateSample[] {
    const key = day ?? localParts(new Date().toISOString(), this.timezone).day;
    return this.stateSamples.filter((sample) => localParts(sample.ts, this.timezone).day === key);
  }

  /** Entries of one local day, oldest first. */
  day(day?: string): DiaryEntry[] {
    const key = day ?? localParts(new Date().toISOString(), this.timezone).day;
    return this.entries.filter((entry) => localParts(entry.ts, this.timezone).day === key);
  }

  /** Newest detail entries first (explicit recall only). */
  recent(limit = 100): DiaryEntry[] {
    return this.entries.slice(-Math.max(1, limit)).reverse();
  }

  /** Explicit text search over short-lived detail entries; newest matches first. */
  search(keyword: string, limit = 20): DiaryEntry[] {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return [];
    const hits: DiaryEntry[] = [];
    for (let i = this.entries.length - 1; i >= 0 && hits.length < limit; i -= 1) {
      const entry = this.entries[i]!;
      const hay = [entry.app, entry.title, entry.caption, entry.text].filter(Boolean).join('\n').toLowerCase();
      if (hay.includes(needle)) hits.push(entry);
    }
    return hits;
  }

  stats(now = Date.now()): { total: number; days: number; samples: number; topApps: Array<{ app: string; count: number }> } {
    const daySet = new Set<string>();
    const appCounts = new Map<string, number>();
    for (const entry of this.entries) {
      daySet.add(localParts(entry.ts, this.timezone).day);
      if (entry.app) appCounts.set(entry.app, (appCounts.get(entry.app) ?? 0) + 1);
    }
    for (const sample of this.stateSamples) daySet.add(localParts(sample.ts, this.timezone).day);
    const topApps = [...appCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([app, count]) => ({ app, count }));
    return { total: this.entries.length, days: daySet.size, samples: this.stateSamples.length, topApps };
  }

  /** Drop detail entries and samples, keeping the read cursor. */
  clear(): number {
    const removed = this.entries.length + this.stateSamples.length;
    this.entries = [];
    this.stateSamples = [];
    writeFileSync(join(this.dir, ENTRIES), '', 'utf8');
    writeFileSync(join(this.dir, SAMPLES), '', 'utf8');
    return removed;
  }

  private load(): void {
    const cursorFile = join(this.dir, CURSOR);
    if (existsSync(cursorFile)) {
      try {
        const state = JSON.parse(readFileSync(cursorFile, 'utf8')) as { cursor?: unknown };
        if (typeof state.cursor === 'number') this.lastCursor = state.cursor;
      } catch { /* a broken cursor file starts from zero */ }
    }
    this.loadLines(ENTRIES, (value) => this.entries.push(value as DiaryEntry), this.detailCutoff());
    this.loadLines(SAMPLES, (value) => this.stateSamples.push(value as StateSample), Date.now() - Math.max(1, this.keepDays) * 86_400_000);
    this.pruneEntries(this.detailCutoff());
    this.pruneSamples();
  }

  private loadLines(file: string, push: (value: unknown) => void, cutoff: number): void {
    const path = join(this.dir, file);
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line) as { ts?: unknown };
        if (typeof value.ts === 'string' && Date.parse(value.ts) >= cutoff) push(value);
      } catch { /* skip a torn line */ }
    }
  }

  private detailCutoff(): number {
    return Date.now() - Math.max(1, this.detailHours) * 3_600_000;
  }

  private pruneEntries(cutoff: number): void {
    const kept = this.entries.filter((entry) => Date.parse(entry.ts) >= cutoff);
    if (kept.length === this.entries.length) return;
    this.entries = kept;
    writeFileSync(join(this.dir, ENTRIES), kept.map((entry) => `${JSON.stringify(entry)}\n`).join(''), 'utf8');
  }

  private pruneSamples(): void {
    const cutoff = Date.now() - Math.max(1, this.keepDays) * 86_400_000;
    const kept = this.stateSamples.filter((sample) => Date.parse(sample.ts) >= cutoff);
    if (kept.length === this.stateSamples.length) return;
    this.stateSamples = kept;
    writeFileSync(join(this.dir, SAMPLES), kept.map((sample) => `${JSON.stringify(sample)}\n`).join(''), 'utf8');
  }
}
