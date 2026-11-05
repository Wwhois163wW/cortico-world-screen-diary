/**
 * Stage 1 of the word-bag model: tokenisation and a read-only word table.
 *
 * App process names and window-title words are the same kind of token. Nothing here changes the
 * current projection rules yet: it only counts tokens so we can see whether title words carry
 * useful signal before switching the state model over.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type TokenKind = 'app' | 'word';

export interface TokenRecord {
  token: string;
  kind: TokenKind;
  /** Original process name for app tokens, used by the per-app policy editor. */
  app?: string;
  count: number;
  lastSeen: string;
  /** [work/entertainment, light/heavy] in [-1, 1]. */
  coord: [number, number];
  weight: number;
}

interface LexiconPoint {
  /** [work/entertainment, light/heavy] */
  coord: [number, number];
  weight: number;
}

/** Neutral containers and recognisable feature words; coordinates follow [work, tech]. */
const BUILTIN: Record<string, LexiconPoint> = {
  chrome: { coord: [0, 0], weight: 0.1 },
  msedge: { coord: [0, 0], weight: 0.1 },
  firefox: { coord: [0, 0], weight: 0.1 },
  explorer: { coord: [0, 0], weight: 0.1 },
  finder: { coord: [0, 0], weight: 0.1 },
  deepseek: { coord: [0.8, 0.9], weight: 2.5 },
  harness: { coord: [0.8, 0.9], weight: 2.5 },
  terminal: { coord: [0.8, 0.9], weight: 2.5 },
  powershell: { coord: [0.8, 0.9], weight: 2.5 },
  vscode: { coord: [0.8, 0.9], weight: 2.5 },
  code: { coord: [0.8, 0.9], weight: 2.5 },
  github: { coord: [0.7, 0.8], weight: 2.2 },
  npm: { coord: [0.7, 0.8], weight: 2.0 },
  pnpm: { coord: [0.7, 0.8], weight: 2.0 },
  docker: { coord: [0.6, 0.8], weight: 2.0 },
  python: { coord: [0.7, 0.9], weight: 2.2 },
  typescript: { coord: [0.7, 0.9], weight: 2.2 },
  bilibili: { coord: [-0.8, -0.7], weight: 2.5 },
  youtube: { coord: [-0.8, -0.7], weight: 2.5 },
  netflix: { coord: [-0.8, -0.7], weight: 2.5 },
  genshin: { coord: [-0.8, 0.8], weight: 2.5 },
  steam: { coord: [-0.8, 0.8], weight: 2.5 },
  league: { coord: [-0.8, 0.8], weight: 2.5 },
  arxiv: { coord: [0.6, -0.4], weight: 2.0 },
  zotero: { coord: [0.6, -0.4], weight: 2.0 },
  pdf: { coord: [0.6, -0.4], weight: 2.0 },
  word: { coord: [0.6, -0.4], weight: 2.0 },
  excel: { coord: [0.6, -0.4], weight: 2.0 },
  notion: { coord: [0.6, -0.3], weight: 1.8 },
  docs: { coord: [0.6, -0.4], weight: 1.8 },
  figma: { coord: [0.4, 0.2], weight: 1.6 },
};

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'new', 'tab', 'window', 'untitled',
  'file', 'edit', 'view', 'help', 'index', 'home', 'page', 'google', 'microsoft', 'mozilla',
  'chrome', 'edge', 'firefox', 'app', 'application', 'document', 'person', 'user',
  '的', '了', '一个', '页面', '窗口', '标签', '文件', '用户', '正在', '显示', '其中',
]);

const MAX_TITLE_TOKENS = 12;

/** Process name as one token (`chrome.exe` → `chrome`). */
export function appToken(app: string): string {
  return app.trim().replace(/\.exe$/i, '').toLowerCase();
}

/** Tokens from a title: English/number words and Chinese 2-grams, with stopwords removed. */
export function titleTokens(title: string): string[] {
  const clean = title
    .replace(/\s+[-–—]\s+(google chrome|microsoft edge|mozilla firefox|visual studio code|brave|opera)\s*$/i, '')
    .replace(/https?:\/\/\S+/gi, ' ');
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (token: string) => {
    const value = token.trim().toLowerCase();
    if (!value || STOPWORDS.has(value) || seen.has(value)) return;
    if (out.length >= MAX_TITLE_TOKENS) return;
    seen.add(value);
    out.push(value);
  };
  for (const part of clean.split(/[^a-zA-Z0-9_\u4e00-\u9fa5]+/)) {
    if (!part) continue;
    if (/^[\u4e00-\u9fa5]+$/.test(part)) {
      const chars = [...part];
      if (chars.length === 1) {
        if (chars[0] !== '的') push(part);
        continue;
      }
      if (chars.length <= 4) push(part);
      for (let i = 0; i + 1 < chars.length; i += 1) push(`${chars[i]}${chars[i + 1]}`);
      continue;
    }
    if (/^\d+$/.test(part)) continue;
    if (part.length < 3) continue;
    push(part);
  }
  return out;
}

/** Tokenise one foreground sighting; app first, then title words. */
export function tokenize(app: string | null | undefined, title: string | null | undefined): Array<{ token: string; kind: TokenKind; app?: string }> {
  const out: Array<{ token: string; kind: TokenKind; app?: string }> = [];
  const process = app?.trim() ?? '';
  if (process) {
    const token = appToken(process);
    if (token) out.push({ token, kind: 'app', app: process });
  }
  for (const token of titleTokens(title ?? '')) out.push({ token, kind: 'word' });
  return out;
}

/** Builtin coordinates/weight for a token; unknown words stay neutral but visible. */
export function lexiconFor(token: string): LexiconPoint {
  return BUILTIN[token] ?? { coord: [0, 0], weight: 0.1 };
}

const FILE = 'tokens.json';
const MAX_TOKENS = 5000;

/** Counts sighted tokens; stores tokens only, never titles. */
export class TokenCatalog {
  private records = new Map<string, TokenRecord>();

  constructor(private readonly dir: string) {
    this.load();
  }

  record(tokens: ReadonlyArray<{ token: string; kind: TokenKind; app?: string }>, at: number): void {
    const seen = new Date(at).toISOString();
    for (const token of tokens) {
      const point = lexiconFor(token.token);
      const existing = this.records.get(token.token);
      this.records.set(token.token, existing
        ? { ...existing, count: existing.count + 1, lastSeen: seen, ...(token.app ? { app: token.app } : {}) }
        : { token: token.token, kind: token.kind, count: 1, lastSeen: seen, coord: point.coord, weight: point.weight, ...(token.app ? { app: token.app } : {}) });
    }
    this.prune();
    this.save();
  }

  /** Most frequent tokens first. */
  list(limit = 300): TokenRecord[] {
    return [...this.records.values()].sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen)).slice(0, Math.max(1, limit));
  }

  count(): number {
    return this.records.size;
  }

  private prune(): void {
    if (this.records.size <= MAX_TOKENS) return;
    const keep = new Set(this.list(MAX_TOKENS - 500).map((row) => row.token));
    for (const token of [...this.records.keys()]) if (!keep.has(token)) this.records.delete(token);
  }

  private save(): void {
    try {
      writeFileSync(join(this.dir, FILE), JSON.stringify([...this.records.values()]), 'utf8');
    } catch {
      /* diagnostics only */
    }
  }

  private load(): void {
    const path = join(this.dir, FILE);
    if (!existsSync(path)) return;
    try {
      const rows = JSON.parse(readFileSync(path, 'utf8')) as TokenRecord[];
      for (const row of rows) if (row && typeof row.token === 'string') this.records.set(row.token, row);
    } catch {
      /* start empty */
    }
  }
}
