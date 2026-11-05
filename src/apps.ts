/**
 * Seen applications and their local policy overrides.
 *
 * The default projection comes from `state.classify`; a per-app override can change the category
 * ("word class") or the flow-decay window. Only app names, counters and overrides are stored here;
 * window titles are never kept.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Category } from './state.ts';

export type AppCategory = Category | 'filtered';

export interface AppRecord {
  app: string;
  count: number;
  lastSeen: string;
  /** What the built-in classifier says; refreshed on sight. */
  defaultCategory: AppCategory;
  /** User/pet override; undefined means follow `defaultCategory`. */
  category?: AppCategory;
  /** Per-app flow decay in minutes; undefined means the category default. */
  decayMinutes?: number;
}

const FILE = 'apps.json';

export class AppCatalog {
  private records = new Map<string, AppRecord>();

  constructor(private readonly dir: string) {
    this.load();
  }

  /** Count one sighting and refresh the default category. */
  observe(app: string, at: number, defaultCategory: AppCategory): void {
    if (!app) return;
    const seen = new Date(at).toISOString();
    const record = this.records.get(app);
    this.records.set(app, record
      ? { ...record, count: record.count + 1, lastSeen: seen, defaultCategory }
      : { app, count: 1, lastSeen: seen, defaultCategory });
  }

  policy(app: string): AppRecord | undefined {
    return this.records.get(app);
  }

  /** Set or clear the per-app overrides; returns the updated record. */
  setPolicy(app: string, category: AppCategory | null | undefined, decayMinutes: number | null | undefined): AppRecord | undefined {
    const record = this.records.get(app);
    if (!record) return undefined;
    const next: AppRecord = { ...record };
    if (category === null) delete next.category;
    else if (category !== undefined) next.category = category;
    if (decayMinutes === null || decayMinutes === 0) delete next.decayMinutes;
    else if (decayMinutes !== undefined && decayMinutes > 0) next.decayMinutes = Math.min(180, Math.max(1, Math.round(decayMinutes)));
    this.records.set(app, next);
    this.save();
    return next;
  }

  /** Records sorted by most recently seen. */
  list(): AppRecord[] {
    return [...this.records.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }

  save(): void {
    try {
      writeFileSync(join(this.dir, FILE), JSON.stringify([...this.records.values()], null, 2), 'utf8');
    } catch {
      /* the catalog is helpful, not essential */
    }
  }

  private load(): void {
    const path = join(this.dir, FILE);
    if (!existsSync(path)) return;
    try {
      const rows = JSON.parse(readFileSync(path, 'utf8')) as AppRecord[];
      for (const row of rows) {
        if (row && typeof row.app === 'string') this.records.set(row.app, row);
      }
    } catch {
      /* a broken catalog starts empty */
    }
  }
}
