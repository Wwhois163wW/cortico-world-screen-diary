import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventEnvelope } from 'cortico/core/types.ts';
import { DiaryBook, entryOf, localParts } from '../src/book.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'screen-diary-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const event = (cursor: number, ts: string, text: string, meta: Record<string, unknown> = {}): EventEnvelope => ({
  cursor, ts, type: 'screen-sense.focus', source: 'screen-sense', origin: 'external', text, meta,
});

describe('localParts', () => {
  it('uses the deployment timezone', () => {
    expect(localParts('2026-11-03T15:00:00.000Z', 'Asia/Tokyo')).toEqual({ day: '2026-11-04', hour: '00' });
    expect(localParts('2026-11-03T15:00:00.000Z', 'UTC')).toEqual({ day: '2026-11-03', hour: '15' });
  });
});

describe('DiaryBook', () => {
  it('imports entries with meta and advances the cursor', () => {
    const book = new DiaryBook(dir, 'Asia/Tokyo', 30);
    const at = new Date().toISOString();
    expect(book.ingest([event(1, at, '[focus] 前台切到 Code.exe', { kind: 'focus', app: 'Code.exe', title: 'main.ts' })])).toBe(1);
    expect(book.cursor).toBe(1);
    const [entry] = book.recent(1);
    expect(entry).toMatchObject({ cursor: 1, app: 'Code.exe', title: 'main.ts' });
    expect(entryOf(event(3, at, 'x', { app: 42 }))).not.toHaveProperty('app');
  });

  it('survives a restart', () => {
    const at = new Date().toISOString();
    const first = new DiaryBook(dir, 'Asia/Tokyo', 30);
    first.ingest([event(5, at, '[screen] a terminal', { kind: 'screenshot', app: 'WindowsTerminal.exe', caption: 'a terminal' })]);
    const reopened = new DiaryBook(dir, 'Asia/Tokyo', 30);
    expect(reopened.cursor).toBe(5);
    expect(reopened.recent(1)[0]).toMatchObject({ caption: 'a terminal', app: 'WindowsTerminal.exe' });
  });

  it('searches text, app and caption case-insensitively, newest first', () => {
    const book = new DiaryBook(dir, 'UTC', 30);
    const now = Date.now();
    book.ingest([
      event(1, new Date(now - 3000).toISOString(), '[focus] 前台切到 Chrome', { app: 'chrome.exe' }),
      event(2, new Date(now - 2000).toISOString(), '[screen] Editor with README', { app: 'Code.exe', caption: 'Editor with README' }),
      event(3, new Date(now - 1000).toISOString(), '[focus] 前台切到 Terminal', { app: 'WindowsTerminal.exe' }),
    ]);
    expect(book.search('chrome').map((entry) => entry.cursor)).toEqual([1]);
    expect(book.search('readme').map((entry) => entry.cursor)).toEqual([2]);
    expect(book.search('terminal').map((entry) => entry.cursor)).toEqual([3]);
    expect(book.search('missing')).toEqual([]);
  });

  it('groups by local day and reports stats', () => {
    const book = new DiaryBook(dir, 'Asia/Tokyo', 30);
    const now = new Date();
    book.ingest([
      event(1, new Date(now.getTime() - 60_000).toISOString(), 'a', { app: 'Code.exe' }),
      event(2, new Date(now.getTime() - 30_000).toISOString(), 'b', { app: 'Code.exe' }),
      event(3, new Date(now.getTime() - 10_000).toISOString(), 'c', { app: 'chrome.exe' }),
    ]);
    const stats = book.stats();
    expect(stats.total).toBe(3);
    expect(stats.days).toBe(1);
    expect(stats.topApps[0]).toEqual({ app: 'Code.exe', count: 2 });
    expect(book.day().length).toBe(3);
  });

  it('clears entries but keeps the cursor', () => {
    const book = new DiaryBook(dir, 'UTC', 30);
    book.ingest([event(9, new Date().toISOString(), 'x')]);
    expect(book.clear()).toBe(1);
    expect(book.size).toBe(0);
    expect(book.cursor).toBe(9);
    expect(new DiaryBook(dir, 'UTC', 30).cursor).toBe(9);
  });

  it('drops entries older than the kept days on load', () => {
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const first = new DiaryBook(dir, 'UTC', 1);
    first.ingest([event(1, old, 'old')]);
    const reopened = new DiaryBook(dir, 'UTC', 1);
    expect(reopened.size).toBe(0);
    expect(reopened.cursor).toBe(1);
  });
});
