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
  entries: number;
  days: number;
  lastCursor: number;
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
      for (const [dx, dy, text] of [[-1, 1, '开发'], [1, 1, '工作'], [-1, -1, '视频'], [1, -1, '游戏']] as const) {
        const node = el('text', { x: dx < 0 ? pad : w - pad - 20, y: dy > 0 ? pad - 12 : h - pad + 16, fill: 'currentColor', 'fill-opacity': 0.55, 'font-size': 11 });
        node.textContent = text;
        chart.append(node);
      }
      const axisTech = el('text', { x: cx + 6, y: pad - 12, fill: 'currentColor', 'fill-opacity': 0.5, 'font-size': 10 });
      axisTech.textContent = t.axisTech;
      const axisWork = el('text', { x: w - pad - 24, y: cy - 6, fill: 'currentColor', 'fill-opacity': 0.5, 'font-size': 10 });
      axisWork.textContent = t.axisWork;
      chart.append(axisTech, axisWork);

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

    root.append(bar, current, chartBox, detailsTitle, detailsNote, detailBar, notice, list);
    ctx.root.append(root);
    void load();
    return { dispose() {} };
  },
};

const bundle: WebUiClientBundle = { panels: { timeline: timelinePanel } };
export default bundle;
