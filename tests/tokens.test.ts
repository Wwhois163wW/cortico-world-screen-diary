import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appToken, titleTokens, tokenize, TokenCatalog } from '../src/tokens.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'screen-diary-words-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('appToken', () => {
  it('strips .exe and lowercases', () => {
    expect(appToken('chrome.exe')).toBe('chrome');
    expect(appToken('WeChat.EXE')).toBe('wechat');
  });
});

describe('titleTokens', () => {
  it('removes browser suffixes and stopwords', () => {
    const tokens = titleTokens('DeepSeek Harness - 性能评估 - Google Chrome');
    expect(tokens).toContain('deepseek');
    expect(tokens).toContain('harness');
    expect(tokens).not.toContain('chrome');
    expect(tokens).not.toContain('google');
  });

  it('segments Chinese into words instead of 2-grams', () => {
    const tokens = titleTokens('性能评估');
    expect(tokens).toContain('性能');
    expect(tokens).toContain('评估');
    expect(tokens).not.toContain('能评');
  });

  it('keeps meaningful words out of a mixed title', () => {
    const tokens = titleTokens('Coopanion 智能体记忆与行为解析');
    expect(tokens).toEqual(expect.arrayContaining(['智能', '记忆', '行为', '解析']));
    expect(tokens).not.toContain('能体');
    expect(tokens).not.toContain('忆与');
  });

  it('drops short latin words and numbers', () => {
    const tokens = titleTokens('a new tab 123 abcdef');
    expect(tokens).toEqual(['abcdef']);
  });
});

describe('tokenize', () => {
  it('puts the app first and marks kinds', () => {
    const tokens = tokenize('chrome.exe', 'bilibili 视频');
    expect(tokens[0]).toMatchObject({ token: 'chrome', kind: 'app', app: 'chrome.exe' });
    expect(tokens.slice(1).every((token) => token.kind === 'word')).toBe(true);
    expect(tokens.map((token) => token.token)).toContain('bilibili');
  });
});

describe('TokenCatalog', () => {
  it('counts tokens and persists them', () => {
    const catalog = new TokenCatalog(dir);
    catalog.record(tokenize('chrome.exe', 'bilibili'), 1_700_000_000_000);
    catalog.record(tokenize('chrome.exe', 'bilibili'), 1_700_000_001_000);
    const rows = catalog.list();
    const chrome = rows.find((row) => row.token === 'chrome');
    const bilibili = rows.find((row) => row.token === 'bilibili');
    expect(chrome).toMatchObject({ kind: 'app', count: 2 });
    expect(bilibili?.count).toBe(2);
    expect(bilibili?.weight).toBe(2.5);
    expect(new TokenCatalog(dir).list().find((row) => row.token === 'chrome')?.count).toBe(2);
  });
});
