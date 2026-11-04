/** The timeline panel: diary entries grouped by local day and hour. */
import type { WebUiClientBundle, WebUiPanel, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { diaryPanelText } from '../config.ts';
import './style.css';

interface Entry {
  cursor: number;
  ts: string;
  type: string;
  text: string;
  app?: string;
  title?: string;
  caption?: string;
  day: string;
  hour: string;
  clock: string;
}
interface State { total: number; days: number; source: string; lastCursor: number; enabled: boolean }

const timelinePanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const t = diaryPanelText(ctx.language);

    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:12px;height:100%;box-sizing:border-box;padding:14px;overflow:auto';

    const button = (label: string, danger = false) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `font:inherit;font-size:13px;padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid rgba(128,128,128,.45);background:${danger ? 'rgba(200,60,60,.12)' : 'transparent'};color:inherit`;
      return b;
    };

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
    const count = document.createElement('span');
    count.style.cssText = 'opacity:.75;font-size:13px';
    const search = document.createElement('input');
    search.placeholder = t.searchPlaceholder;
    search.style.cssText = 'font:inherit;font-size:13px;padding:4px 8px;border-radius:6px;background:transparent;color:inherit;border:1px solid rgba(128,128,128,.45);min-width:220px';
    const searchButton = button(t.search);
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    const refresh = button(t.refresh);
    const clear = button(t.clear, true);
    bar.append(count, search, searchButton, spacer, refresh, clear);

    const notice = document.createElement('div');
    notice.style.cssText = 'font-size:12px;opacity:.8;min-height:16px;white-space:pre-wrap';

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:14px';

    const stateLine = (state: State): string => `${t.total(state.total)} · ${t.stats(state.days, state.total)} · ${state.source}`;

    const row = (entry: Entry): HTMLElement => {
      const box = document.createElement('div');
      box.style.cssText = 'display:flex;gap:10px;align-items:baseline;font-size:13px;padding:4px 0;border-bottom:1px solid rgba(128,128,128,.12)';
      const clock = document.createElement('span');
      clock.textContent = entry.clock;
      clock.style.cssText = 'font-family:ui-monospace,monospace;opacity:.75;flex:none';
      const app = document.createElement('span');
      app.textContent = entry.app ?? '';
      app.style.cssText = 'font-family:ui-monospace,monospace;opacity:.85;flex:none;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const text = document.createElement('span');
      text.textContent = entry.caption ?? entry.text;
      text.style.cssText = 'flex:1;line-height:1.45';
      box.append(clock, app, text);
      return box;
    };

    const render = (entries: Entry[]) => {
      list.replaceChildren();
      if (entries.length === 0) return;
      let day = '';
      let section: HTMLElement | null = null;
      for (const entry of entries) {
        if (entry.day !== day) {
          day = entry.day;
          const heading = document.createElement('div');
          heading.textContent = day;
          heading.style.cssText = 'font-size:13px;font-weight:600;opacity:.8;margin-top:4px';
          section = document.createElement('div');
          list.append(heading, section);
        }
        section!.append(row(entry));
      }
    };

    const load = async (keyword = '') => {
      count.textContent = t.loading;
      list.replaceChildren();
      notice.textContent = '';
      try {
        const state = await ctx.invoke<State>('state');
        count.textContent = stateLine(state);
        if (state.total === 0) {
          notice.textContent = t.waitingProducer(state.source);
          return;
        }
        const data = keyword
          ? await ctx.invoke<{ entries: Entry[] }>('search', [keyword, 100])
          : await ctx.invoke<{ entries: Entry[] }>('list', [{ limit: 300 }]);
        if (data.entries.length === 0) {
          notice.textContent = keyword ? t.noResults : t.empty;
          return;
        }
        render(data.entries);
      } catch (err) {
        count.textContent = `${t.failed}: ${err instanceof Error ? err.message : String(err)}`;
      }
    };

    const doSearch = () => void load(search.value.trim());
    searchButton.addEventListener('click', doSearch);
    search.addEventListener('keydown', (event) => { if (event.key === 'Enter') doSearch(); });
    refresh.addEventListener('click', () => void load(search.value.trim()));
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

    root.append(bar, notice, list);
    ctx.root.append(root);
    void load();
    return { dispose() {} };
  },
};

const bundle: WebUiClientBundle = { panels: { timeline: timelinePanel } };
export default bundle;
