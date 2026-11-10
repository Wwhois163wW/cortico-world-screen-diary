/** The activity state panel: a two-axis trajectory plus short-lived detail entries. */
import type { WebUiClientBundle, WebUiPanel, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { diaryPanelText } from '../config.ts';
import './style.css';

interface Point { ts: string; tech: number; work: number; zh: string; en: string }
interface State {
  enabled: boolean;
  source: string;
  current: { tech: number; work: number; zh: string; en: string; category: string };
  samples: Point[];
  top: Array<{ token: string; weight: number }>;
  entries: number;
  days: number;
  lastCursor: number;
  flow: { state: string; gapMs: number; decayMs: number; category: string } | null;
}
interface Entry {
  cursor: number;
  ts: string;
  type: string;
  text: string;
  app?: string;
  title?: string;
  caption?: string;
  clock: string;
  day: string;
  hour: string;
}

const SVG = 'http://www.w3.org/2000/svg';
const el = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

const timelinePanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const t = diaryPanelText(ctx.language);
    const zh = ctx.language === 'zh' || ctx.language === 'zh-Hant';
    const label = (point: { zh: string; en: string }) => (zh ? point.zh : point.en);

    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:12px;height:100%;box-sizing:border-box;padding:14px;overflow:auto';

    const button = (text: string, danger = false) => {
      const node = document.createElement('button');
      node.textContent = text;
      node.style.cssText = `font:inherit;font-size:13px;padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid rgba(128,128,128,.45);background:${danger ? 'rgba(200,60,60,.12)' : 'transparent'};color:inherit`;
      return node;
    };
    const input = (placeholder: string) => {
      const node = document.createElement('input');
      node.placeholder = placeholder;
      node.style.cssText = 'font:inherit;font-size:13px;padding:4px 8px;border-radius:6px;background:transparent;color:inherit;border:1px solid rgba(128,128,128,.45);min-width:200px';
      return node;
    };

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
    const count = document.createElement('span');
    count.style.cssText = 'opacity:.75;font-size:13px';
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    const refresh = button(t.refresh);
    const clear = button(t.clear, true);
    bar.append(count, spacer, refresh, clear);

    const current = document.createElement('div');
    current.style.cssText = 'font-size:14px;font-weight:600';
    const topLine = document.createElement('div');
    topLine.style.cssText = 'font-size:12px;opacity:.7';

    const chart = el('svg', { viewBox: '0 0 420 300', width: '100%', height: '300', style: 'max-width:520px;align-self:center' });
    const chartBox = document.createElement('div');
    chartBox.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    const privacy = document.createElement('div');
    privacy.textContent = t.privacyNote;
    privacy.style.cssText = 'font-size:12px;opacity:.7;max-width:640px';
    chartBox.append(chart, privacy);

    const detailsTitle = document.createElement('div');
    detailsTitle.textContent = t.details;
    detailsTitle.style.cssText = 'font-size:13px;font-weight:600;opacity:.85;margin-top:6px';
    const detailsNote = document.createElement('div');
    detailsNote.textContent = t.detailsNote;
    detailsNote.style.cssText = 'font-size:12px;opacity:.65';

    const detailBar = document.createElement('div');
    detailBar.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
    const search = input(t.searchPlaceholder);
    const searchButton = button(t.search);
    const reset = button(t.refresh);
    detailBar.append(search, searchButton, reset);

    const notice = document.createElement('div');
    notice.style.cssText = 'font-size:12px;opacity:.8;min-height:16px;white-space:pre-wrap';
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:6px';

    const draw = (state: State) => {
      chart.replaceChildren();
      const w = 420, h = 300, cx = w / 2, cy = h / 2, pad = 40;
      const x = (work: number) => cx + Math.max(-1, Math.min(1, work)) * (cx - pad);
      const y = (tech: number) => cy - Math.max(-1, Math.min(1, tech)) * (cy - pad);
      chart.append(
        el('line', { x1: pad, y1: cy, x2: w - pad, y2: cy, stroke: 'currentColor', 'stroke-opacity': 0.35, 'stroke-width': 1 }),
        el('line', { x1: cx, y1: pad, x2: cx, y2: h - pad, stroke: 'currentColor', 'stroke-opacity': 0.35, 'stroke-width': 1 }),
      );
      const points = state.samples.slice(-120).reverse();
      if (points.length >= 2) {
        const path = el('polyline', {
          points: points.map((point) => `${x(point.work)},${y(point.tech)}`).join(' '),
          fill: 'none', stroke: '#5fd4c8', 'stroke-width': 2, 'stroke-opacity': 0.85,
        });
        chart.append(path);
        for (const point of points.slice(0, 12)) {
          chart.append(el('circle', { cx: x(point.work), cy: y(point.tech), r: 3, fill: '#5fd4c8', 'fill-opacity': 0.5 }));
        }
      }
      chart.append(el('circle', { cx: x(state.current.work), cy: y(state.current.tech), r: 7, fill: '#5fd4c8' }));
    };

    const row = (entry: Entry): HTMLElement => {
      const box = document.createElement('div');
      box.style.cssText = 'display:flex;gap:10px;align-items:baseline;font-size:13px;padding:3px 0;border-bottom:1px solid rgba(128,128,128,.12)';
      const clock = document.createElement('span');
      clock.textContent = entry.clock;
      clock.style.cssText = 'font-family:ui-monospace,monospace;opacity:.7;flex:none';
      const app = document.createElement('span');
      app.textContent = entry.app ?? '';
      app.style.cssText = 'font-family:ui-monospace,monospace;opacity:.85;flex:none;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const text = document.createElement('span');
      text.textContent = entry.caption ?? entry.text;
      text.style.cssText = 'flex:1;line-height:1.45';
      box.append(clock, app, text);
      return box;
    };

    const loadDetails = async (keyword = '') => {
      list.replaceChildren();
      notice.textContent = '';
      try {
        const data = keyword
          ? await ctx.invoke<{ entries: Entry[] }>('search', [keyword, 20])
          : await ctx.invoke<{ entries: Entry[] }>('list', [{ limit: 50 }]);
        if (data.entries.length === 0) {
          notice.textContent = keyword ? t.noResults : t.detailsNote;
          return;
        }
        for (const entry of data.entries) list.append(row(entry));
      } catch (err) {
        notice.textContent = `${t.failed}: ${err instanceof Error ? err.message : String(err)}`;
      }
    };

    const load = async () => {
      count.textContent = t.loading;
      try {
        const state = await ctx.invoke<State>('state');
        count.textContent = `${state.days} 天 · ${state.samples.length} 采样`;
        current.textContent = t.current(label(state.current));
        topLine.textContent = state.top && state.top.length ? (zh ? '高频词：' : 'Top tokens: ') + state.top.map((row) => row.token).join(' · ') : '';
        if (state.samples.length === 0) {
          notice.textContent = t.waitingProducer(state.source);
        }
        draw(state);
        await loadDetails();
      } catch (err) {
        count.textContent = `${t.failed}: ${err instanceof Error ? err.message : String(err)}`;
      }
    };

    refresh.addEventListener('click', () => void load());
    reset.addEventListener('click', () => { search.value = ''; void loadDetails(); });
    searchButton.addEventListener('click', () => void loadDetails(search.value.trim()));
    search.addEventListener('keydown', (event) => { if (event.key === 'Enter') void loadDetails(search.value.trim()); });
    clear.addEventListener('click', () => {
      if (!window.confirm(t.clearConfirm)) return;
      void (async () => {
        try {
          const out = await ctx.invoke<{ removed: number }>('clear', []);
          notice.textContent = t.cleared(out.removed);
          await load();
        } catch (err) {
          notice.textContent = `${t.failed}: ${err instanceof Error ? err.message : String(err)}`;
        }
      })();
    });

    root.append(bar, current, topLine, chartBox, detailsTitle, detailsNote, detailBar, notice, list);
    ctx.root.append(root);
    void load();
    return { dispose() {} };
  },
};

interface WordRow {
  token: string;
  kind: 'app' | 'word';
  app?: string;
  source: 'app' | 'builtin' | 'custom' | 'unknown';
  count: number;
  lastSeen: string;
  coord: [number, number];
  weight: number;
}

const SOURCE_LABEL = (source: WordRow['source'], zh: boolean): string => {
  if (source === 'app') return zh ? '应用' : 'app';
  if (source === 'builtin') return zh ? '内置' : 'builtin';
  if (source === 'custom') return zh ? '自定义' : 'custom';
  return zh ? '未知' : 'unknown';
};

const APP_OPTIONS = [
  ['develop', '开发', 'Development'],
  ['office', '文书', 'Documents'],
  ['video', '视频', 'Video'],
  ['game', '游戏', 'Gaming'],
  ['casual', '挂机/轻娱乐', 'Casual'],
  ['browser', '浏览器', 'Browser'],
  ['ai', 'AI', 'AI'],
  ['neutral', '中性', 'Neutral'],
  ['filtered', '过滤', 'Filtered'],
] as const;
const wordsPanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const zh = ctx.language === 'zh' || ctx.language === 'zh-Hant';
    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:10px;height:100%;box-sizing:border-box;padding:14px;overflow:auto';

    const title = document.createElement('div');
    title.textContent = zh ? '词汇与衰减' : 'Words and decay';
    title.style.cssText = 'font-size:14px;font-weight:600';
    const note = document.createElement('div');
    note.textContent = zh
      ? '应用名与标题词同表；坐标 = [工作/娱乐, 轻/重]，权重越高越能拉动状态。应用词改类型/衰减；标题词可直接改坐标/权重，手动编辑会存为自定义词并保留编辑记录。标题只以词频形式保留。'
      : 'App names and title words share one table; coordinates are [work/entertainment, light/heavy]. App tokens edit category/decay; title words can edit coordinates/weight directly, saved as custom words with an edit history. Titles are kept only as token counts.';
    note.style.cssText = 'font-size:12px;opacity:.7;max-width:820px';

    const controls = document.createElement('label');
    controls.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:12px;opacity:.75;cursor:pointer';
    const showAll = document.createElement('input');
    showAll.type = 'checkbox';
    const showAllText = document.createElement('span');
    showAllText.textContent = zh ? '显示未知词' : 'Show unknown words';
    controls.append(showAll, showAllText);
    showAll.addEventListener('change', () => void load());

    const status = document.createElement('div');
    status.style.cssText = 'font-size:12px;opacity:.75;min-height:16px';
    const table = document.createElement('div');
    table.style.cssText = 'display:flex;flex-direction:column;gap:6px';

    const COLUMNS = 'minmax(130px,1.4fr) 44px 58px 52px 52px 46px minmax(250px,2fr)';

    const header = (): HTMLElement => {
      const head = document.createElement('div');
      head.style.cssText = 'display:grid;grid-template-columns:' + COLUMNS + ';gap:8px;align-items:center;font-size:11px;opacity:.55;padding:4px 0;border-bottom:1px solid rgba(128,128,128,.3)';
      const labels = [
        zh ? '词' : 'token',
        zh ? '次数' : 'count',
        zh ? '来源' : 'source',
        zh ? '工作' : 'work',
        zh ? '技术' : 'tech',
        zh ? '权重' : 'weight',
        zh ? '编辑' : 'edit',
      ];
      for (let i = 0; i < labels.length; i += 1) {
        const cell = document.createElement('span');
        cell.textContent = labels[i]!;
        if (i >= 1 && i <= 5) cell.style.textAlign = 'right';
        head.append(cell);
      }
      return head;
    };

    const field = (value: number | string, width: number): HTMLInputElement => {
      const input = document.createElement('input');
      if (typeof value === 'number') {
        input.type = 'number';
        input.step = '0.1';
        input.value = String(value);
      } else {
        input.value = value;
      }
      input.style.cssText = 'width:' + width + 'px;font:inherit;font-size:12px;padding:3px 4px;border-radius:5px;background:transparent;color:inherit;border:1px solid rgba(128,128,128,.4)';
      return input;
    };

    const actionButton = (label: string, danger = false): HTMLButtonElement => {
      const button = document.createElement('button');
      button.textContent = label;
      button.style.cssText = 'font:inherit;font-size:12px;padding:3px 8px;border-radius:5px;cursor:pointer;border:1px solid rgba(128,128,128,.45);background:' + (danger ? 'rgba(200,60,60,.12)' : 'transparent') + ';color:inherit';
      return button;
    };

    const renderRow = (row: WordRow): HTMLElement => {
      const line = document.createElement('div');
      line.style.cssText = 'display:grid;grid-template-columns:' + COLUMNS + ';gap:8px;align-items:center;font-size:13px;padding:5px 0;border-bottom:1px solid rgba(128,128,128,.14)';
      const token = document.createElement('span');
      token.textContent = row.token;
      token.style.cssText = 'font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const count = document.createElement('span');
      count.textContent = row.count + ' ×';
      count.style.cssText = 'opacity:.65;font-size:12px;text-align:right';
      const source = document.createElement('span');
      source.textContent = SOURCE_LABEL(row.source, zh);
      source.style.cssText = 'font-size:11px;opacity:' + (row.source === 'custom' ? '1' : '.55');
      const work = document.createElement('span');
      work.textContent = row.coord[0].toFixed(2);
      work.style.cssText = 'opacity:.7;font-size:12px;text-align:right;font-family:ui-monospace,monospace';
      const tech = document.createElement('span');
      tech.textContent = row.coord[1].toFixed(2);
      tech.style.cssText = 'opacity:.7;font-size:12px;text-align:right;font-family:ui-monospace,monospace';
      const weight = document.createElement('span');
      weight.textContent = row.weight.toFixed(1);
      weight.style.cssText = 'opacity:.7;font-size:12px;text-align:right;font-family:ui-monospace,monospace';
      line.append(token, count, source, work, tech, weight);

      const tools = document.createElement('div');
      tools.style.cssText = 'display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end';

      if (row.kind === 'app' && row.app) {
        const select = document.createElement('select');
        select.style.cssText = 'font:inherit;font-size:12px;padding:3px 4px;border-radius:5px;background:transparent;color:inherit;border:1px solid rgba(128,128,128,.4);max-width:110px';
        const auto = document.createElement('option');
        auto.value = '';
        auto.textContent = zh ? '跟随默认' : 'default';
        select.append(auto);
        for (const [value, labelZh, labelEn] of APP_OPTIONS) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = zh ? labelZh : labelEn;
          select.append(option);
        }
        const decay = field('', 58);
        decay.placeholder = zh ? '衰减' : 'decay';
        decay.title = zh ? '留空跟随类别默认' : 'Empty follows the category default';
        const save = actionButton(zh ? '保存' : 'Save');
        save.addEventListener('click', () => {
          void (async () => {
            try {
              const minutes = decay.value.trim() ? Number(decay.value) : 0;
              await ctx.invoke('setApp', [row.app, select.value || null, minutes]);
              await load();
            } catch (err) {
              status.textContent = (zh ? '保存失败' : 'Save failed') + ': ' + (err instanceof Error ? err.message : String(err));
            }
          })();
        });
        tools.append(select, decay, save);
      } else {
        const workInput = field(row.coord[0], 52);
        const techInput = field(row.coord[1], 52);
        const weightInput = field(row.weight, 46);
        const save = actionButton(zh ? '保存' : 'Save');
        save.addEventListener('click', () => {
          void (async () => {
            try {
              await ctx.invoke('setWord', [row.token, Number(workInput.value), Number(techInput.value), Number(weightInput.value)]);
              await load();
            } catch (err) {
              status.textContent = (zh ? '保存失败' : 'Save failed') + ': ' + (err instanceof Error ? err.message : String(err));
            }
          })();
        });
        tools.append(workInput, techInput, weightInput, save);
        if (row.source === 'custom') {
          const reset = actionButton(zh ? '恢复' : 'Reset', true);
          reset.addEventListener('click', () => {
            void (async () => {
              try {
                await ctx.invoke('resetWord', [row.token]);
                await load();
              } catch (err) {
                status.textContent = (zh ? '恢复失败' : 'Reset failed') + ': ' + (err instanceof Error ? err.message : String(err));
              }
            })();
          });
          tools.append(reset);
        }
      }
      line.append(tools);
      return line;
    };

    const historyTitle = document.createElement('div');
    historyTitle.textContent = zh ? '最近编辑' : 'Recent edits';
    historyTitle.style.cssText = 'font-size:12px;font-weight:600;opacity:.8;margin-top:4px';
    const historyBox = document.createElement('div');
    historyBox.style.cssText = 'display:flex;flex-direction:column;gap:3px;font-size:11px;opacity:.75';

    const loadHistory = async () => {
      historyBox.replaceChildren();
      try {
        const data = await ctx.invoke<{ history: Array<{ token: string; at: string; action: string; before?: { coord: [number, number]; weight: number }; after?: { coord: [number, number]; weight: number } }> }>('wordHistory');
        if (!data.history.length) {
          historyBox.textContent = zh ? '还没有手动编辑' : 'No manual edits yet';
          return;
        }
        for (const edit of data.history.slice(0, 8)) {
          const row = document.createElement('div');
          const after = edit.after ? `(${edit.after.coord[0].toFixed(2)}, ${edit.after.coord[1].toFixed(2)}) w=${edit.after.weight.toFixed(1)}` : '';
          row.textContent = `${new Date(edit.at).toLocaleString()} ${edit.action} ${edit.token} ${after}`;
          historyBox.append(row);
        }
      } catch {
        /* history is optional */
      }
    };

    const load = async () => {
      table.replaceChildren();
      status.textContent = zh ? '读取中…' : 'Loading…';
      try {
        const data = await ctx.invoke<{ words: WordRow[] }>('words');
        const visible = showAll.checked ? data.words : data.words.filter((row) => row.kind === 'app' || row.source !== 'unknown');
        status.textContent = visible.length
          ? `${visible.length} / ${data.words.length} ${zh ? '个词' : 'tokens'}`
          : (zh ? '还没有采集到有信号词；可勾选“显示未知词”查看全部' : 'No signal tokens yet; enable “Show unknown words” to see everything');
        table.append(header());
        for (const row of visible) table.append(renderRow(row));
        await loadHistory();
      } catch (err) {
        status.textContent = (zh ? '读取失败' : 'Failed') + ': ' + (err instanceof Error ? err.message : String(err));
      }
    };

    root.append(title, note, controls, status, table, historyTitle, historyBox);
    ctx.root.append(root);
    void load();
    return { dispose() {} };
  },
};
interface Diagnostics {
  flow: { state: string; lastSwitchAt: number; gapMs: number; decayMs: number; category: string; checkInEnabled: boolean; baseDecayMinutes: number; awayAfterMinutes: number; checkInCooldownMinutes: number };
  config: { source: string; sampleSec: number; detailHours: number; keepDays: number; smoothing: number; blurAi: boolean; ignoreApps: string };
  counts: { apps: number; samples: number; entries: number; cursor: number };
  rules: Array<{ id: string; enabled: boolean; action: string; trigger: string; title: string }>;
}

const developerPanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const zh = ctx.language === 'zh' || ctx.language === 'zh-Hant';
    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:10px;height:100%;box-sizing:border-box;padding:14px;overflow:auto';
    const title = document.createElement('div');
    title.textContent = zh ? '开发者选项' : 'Developer options';
    title.style.cssText = 'font-size:14px;font-weight:600';
    const note = document.createElement('div');
    note.textContent = zh ? '这里显示当前规则与诊断；下一步的规则开关、阈值与触发原因会放在这里。' : 'Current rules and diagnostics; rule toggles, thresholds and reasons will live here next.';
    note.style.cssText = 'font-size:12px;opacity:.7;max-width:760px';
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:10px;font-size:13px';
    const status = document.createElement('div');
    status.style.cssText = 'font-size:12px;opacity:.75;min-height:16px';
    const controls = document.createElement('label');
    controls.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:12px;opacity:.75;cursor:pointer';
    const showAll = document.createElement('input');
    showAll.type = 'checkbox';
    const showAllText = document.createElement('span');
    showAllText.textContent = zh ? '显示未知词（权重 0.1）' : 'Show unknown tokens (weight 0.1)';
    controls.append(showAll, showAllText);
    showAll.addEventListener('change', () => void load());

    const section = (heading: string): HTMLElement => {
      const box = document.createElement('div');
      box.style.cssText = 'display:flex;flex-direction:column;gap:5px;padding:10px;border:1px solid rgba(128,128,128,.18);border-radius:8px';
      const h = document.createElement('div');
      h.textContent = heading;
      h.style.cssText = 'font-size:12px;font-weight:600;opacity:.8';
      box.append(h);
      return box;
    };
    const line = (text: string, value: string): HTMLElement => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:12px;font-size:12px';
      const left = document.createElement('span');
      left.textContent = text;
      left.style.cssText = 'opacity:.6;min-width:170px';
      const right = document.createElement('span');
      right.textContent = value;
      right.style.cssText = 'font-family:ui-monospace,monospace;word-break:break-all';
      row.append(left, right);
      return row;
    };

    const load = async () => {
      body.replaceChildren();
      status.textContent = zh ? '读取中…' : 'Loading…';
      try {
        const data = await ctx.invoke<Diagnostics>('diagnostics');
        status.textContent = '';
        const flow = section(zh ? '当前 flow' : 'Current flow');
        flow.append(
          line(zh ? '状态' : 'state', data.flow.state),
          line(zh ? '最后切换' : 'last switch', data.flow.lastSwitchAt ? new Date(data.flow.lastSwitchAt).toLocaleString() : '—'),
          line(zh ? '静默 / 阈值' : 'gap / decay', `${Math.round(data.flow.gapMs / 1000)}s / ${Math.round(data.flow.decayMs / 1000)}s`),
          line(zh ? '最后类型' : 'last category', data.flow.category),
        );
        const rules = section(zh ? '规则' : 'Rules');
        for (const rule of data.rules) {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;gap:10px;align-items:center;font-size:12px';
          const badge = document.createElement('span');
          badge.textContent = rule.enabled ? (zh ? '开' : 'on') : (zh ? '关' : 'off');
          badge.style.cssText = `padding:1px 6px;border-radius:999px;border:1px solid ${rule.enabled ? 'rgba(95,212,200,.6)' : 'rgba(128,128,128,.35)'};opacity:${rule.enabled ? 1 : 0.55};font-size:11px`;
          const name = document.createElement('span');
          name.textContent = `${rule.id} · ${rule.action}`;
          name.style.cssText = 'font-family:ui-monospace,monospace';
          const trigger = document.createElement('span');
          trigger.textContent = rule.trigger;
          trigger.style.cssText = 'opacity:.55;margin-left:auto';
          row.append(badge, name, trigger);
          rules.append(row);
        }
        const config = section(zh ? '配置与计数' : 'Config and counts');
        config.append(
          line('source', data.config.source),
          line('smoothing', String(data.config.smoothing)),
          line(zh ? '细节小时' : 'detailHours', String(data.config.detailHours)),
          line(zh ? '保留天数' : 'keepDays', String(data.config.keepDays)),
          line(zh ? '应用 / 采样 / 细节' : 'apps / samples / entries', `${data.counts.apps} / ${data.counts.samples} / ${data.counts.entries}`),
          line(zh ? '游标' : 'cursor', String(data.counts.cursor)),
        );
        body.append(flow, rules, config);
      } catch (err) {
        status.textContent = `${zh ? '读取失败' : 'Failed'}: ${err instanceof Error ? err.message : String(err)}`;
      }
    };

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;align-items:center';
    const refresh = document.createElement('button');
    refresh.textContent = zh ? '刷新' : 'Refresh';
    refresh.style.cssText = 'font:inherit;font-size:12px;padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid rgba(128,128,128,.45);background:transparent;color:inherit';
    refresh.addEventListener('click', () => void load());
    bar.append(refresh);

    root.append(title, note, bar, status, body);
    ctx.root.append(root);
    void load();
    return { dispose() {} };
  },
};

const bundle: WebUiClientBundle = { panels: { timeline: timelinePanel, words: wordsPanel, developer: developerPanel } };
export default bundle;
