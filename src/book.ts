/** Diary storage: event entries on disk, grouped by local day and hour. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventEnvelope } from 'cortico/core/types.ts';

export interface DiaryEntry {
  cursor: number;
  ts: string;
  type: string;
  text: string;
  app?: string;
  title?: string;
  caption?: string;
}

const ENTRIES = 'entries.jsonl';
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

/** Entries in memory, appended to `entries.jsonl`; the read cursor survives restarts in `cursor.json`. */
export class DiaryBook {
  private entries: DiaryEntry[] = [];
  private lastCursor = 0;

  constructor(private readonly dir: string, private readonly timezone: string, private readonly keepDays: number) {
    mkdirSync(dir, { recursive: true });
    this.load();
  }

  /** The last event cursor already imported. */
  get cursor(): number {
    return this.lastCursor;
  }

  get size(): number {
    return this.entries.length;
  }

  /** Import events, persist new entries and advance the cursor even when an event is filtered out. */
  ingest(events: readonly EventEnvelope[]): number {
    const cutoff = Date.now() - Math.max(1, this.keepDays) * 86_400_000;
    let added = 0;
    for (const event of events) {
      this.lastCursor = Math.max(this.lastCursor, event.cursor);
      if (Date.parse(event.ts) < cutoff) continue;
      const entry = entryOf(event);
      this.entries.push(entry);
      appendFileSync(join(this.dir, ENTRIES), `${JSON.stringify(entry)}\n`, 'utf8');
      added += 1;
    }
    writeFileSync(join(this.dir, CURSOR), JSON.stringify({ cursor: this.lastCursor }), 'utf8');
    if (added) this.prune(cutoff);
    return added;
  }

  /** Entries of one local day, oldest first; today when `day` is omitted. */
  day(day?: string): DiaryEntry[] {
    const key = day ?? localParts(new Date().toISOString(), this.timezone).day;
    return this.entries.filter((entry) => localParts(entry.ts, this.timezone).day === key);
  }

  /** Newest entries first. */
  recent(limit = 100): DiaryEntry[] {
    return this.entries.slice(-Math.max(1, limit)).reverse();
  }

  /** Newest matches first; the keyword is matched case-insensitively across app, title, caption and text. */
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

  stats(now = Date.now()): { total: number; days: number; topApps: Array<{ app: string; count: number }> } {
    const daySet = new Set<string>();
    const appCounts = new Map<string, number>();
    for (const entry of this.entries) {
      daySet.add(localParts(entry.ts, this.timezone).day);
      if (entry.app) appCounts.set(entry.app, (appCounts.get(entry.app) ?? 0) + 1);
    }
    const topApps = [...appCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([app, count]) => ({ app, count }));
    return { total: this.entries.length, days: daySet.size, topApps };
  }

  /** Drop every entry but keep the read cursor, so old events are not imported again. */
  clear(): number {
    const removed = this.entries.length;
    this.entries = [];
    writeFileSync(join(this.dir, ENTRIES), '', 'utf8');
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
    const entriesFile = join(this.dir, ENTRIES);
    if (!existsSync(entriesFile)) return;
    const cutoff = Date.now() - Math.max(1, this.keepDays) * 86_400_000;
    for (const line of readFileSync(entriesFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as DiaryEntry;
        if (typeof entry.cursor === 'number' && typeof entry.ts === 'string' && Date.parse(entry.ts) >= cutoff) this.entries.push(entry);
      } catch { /* skip a torn line */ }
    }
    this.prune(cutoff);
  }

  private prune(cutoff: number): void {
    const kept = this.entries.filter((entry) => Date.parse(entry.ts) >= cutoff);
    if (kept.length === this.entries.length) return;
    this.entries = kept;
    writeFileSync(join(this.dir, ENTRIES), kept.map((entry) => `${JSON.stringify(entry)}\n`).join(''), 'utf8');
  }
}
