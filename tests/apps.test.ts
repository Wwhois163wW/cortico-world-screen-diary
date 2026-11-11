import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppCatalog } from '../src/apps.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'screen-diary-apps-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('AppCatalog policies', () => {
  it('creates a record for an app that was never observed, so saving cannot silently fail', () => {
    const catalog = new AppCatalog(dir);
    const record = catalog.setPolicy('SomeGame.exe', 'game', 12);
    expect(record).toMatchObject({ app: 'SomeGame.exe', category: 'game', decayMinutes: 12 });
    expect(new AppCatalog(dir).policy('SomeGame.exe')?.category).toBe('game');
  });

  it('keeps existing observations and can clear an override', () => {
    const catalog = new AppCatalog(dir);
    catalog.observe('SomeGame.exe', Date.now(), 'neutral');
    expect(catalog.setPolicy('SomeGame.exe', 'game', null)?.category).toBe('game');
    expect(catalog.setPolicy('SomeGame.exe', null, null)?.category).toBeUndefined();
    expect(catalog.policy('SomeGame.exe')?.count).toBe(1);
  });
});
