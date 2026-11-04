import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventEnvelope } from 'cortico/core/types.ts';
import { DiaryBook } from '../src/book.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'screen-diary-migrate-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const event = (cursor: number, app: string, ts = new Date().toISOString()): EventEnvelope => ({
  cursor, ts, type: 'screen-sense.focus', source: 'screen-sense', origin: 'external',
  text: `[focus] ${app}`, meta: { kind: 'focus', app, title: '' },
});

describe('migration helpers', () => {
  it('replays entries oldest first', () => {
    const book = new DiaryBook(dir, 'UTC', 30, 72);
    const now = Date.now();
    book.ingest([
      event(2, 'Code.exe', new Date(now - 1000).toISOString()),
      event(1, 'chrome.exe', new Date(now - 5000).toISOString()),
    ]);
    expect(book.chronological().map((entry) => entry.cursor)).toEqual([1, 2]);
  });

  it('drops filtered entries and persists the rewrite', () => {
    const book = new DiaryBook(dir, 'UTC', 30, 72);
    book.ingest([event(1, 'Code.exe'), event(2, 'WeChat.exe'), event(3, 'ChatGPT.exe')]);
    const removed = book.retainEntries((entry) => !/wechat|chatgpt/i.test(entry.app ?? ''));
    expect(removed).toBe(2);
    expect(book.size).toBe(1);
    expect(new DiaryBook(dir, 'UTC', 30, 72).size).toBe(1);
  });
});
