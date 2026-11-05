/**
 * Flow model: derives "busy / focus-or-away" from foreground-switch timing only.
 *
 * No input hooks, no global monitoring. Window switching is the activity signal; silence past a
 * per-category decay window means focus or away (deliberately not distinguished), and a new switch
 * after that is a natural moment for the companion to talk. The state is transient and only drives
 * interaction; it is not long-term profiling data.
 */
import type { Category } from './state.ts';

export type FlowState = 'idle' | 'busy' | 'settling' | 'depleted' | 'away';

export interface FlowConfig {
  /** Base decay window in minutes; each category multiplies it. */
  baseDecayMinutes: number;
  /** Optional proactive check-in when the flow depletes (default off). */
  checkInEnabled: boolean;
  /** After a check-in, silence this long confirms "away". */
  awayAfterMinutes: number;
  /** At most one check-in per this many minutes. */
  checkInCooldownMinutes: number;
}

export const FLOW_DEFAULTS: FlowConfig = {
  baseDecayMinutes: 20,
  checkInEnabled: false,
  awayAfterMinutes: 10,
  checkInCooldownMinutes: 60,
};

/** Per-category multiplier applied to the base decay window. */
const DECAY_MULTIPLIER: Record<Category, number> = {
  develop: 1,
  office: 1,
  video: 1.5,
  game: 0.6,
  casual: 0.5,
  browser: 0.4,
  ai: 0.5,
  neutral: 0.5,
};

export interface SwitchResult {
  /** A long silence was interrupted by a new switch: a good moment to greet. */
  reengage?: { gapMs: number; previousCategory: Category };
}

export interface TickResult {
  /** Flow just crossed into "depleted". */
  depleted?: boolean;
  /** The optional check-in is due (respects the cooldown). */
  checkIn?: boolean;
  /** After a check-in and further silence, confirm the person is away. */
  away?: boolean;
}

export interface FlowSnapshot {
  lastAt: number;
  lastCategory: Category;
  state: FlowState;
  lastCheckInAt: number;
  checkedInAt: number;
}

/** Pure state machine; the World persists the snapshot and pushes the events. */
export class FlowModel {
  private lastAt = 0;
  private lastCategory: Category = 'neutral';
  private state: FlowState = 'idle';
  private lastCheckInAt = 0;
  private checkedInAt = 0;
  private readonly cfg: FlowConfig;

  constructor(cfg: Partial<FlowConfig> = {}) {
    this.cfg = { ...FLOW_DEFAULTS, ...cfg };
  }

  get current(): FlowState {
    return this.state;
  }

  get lastSwitchAt(): number {
    return this.lastAt;
  }

  get category(): Category {
    return this.lastCategory;
  }

  /** Milliseconds of silence that count as "flow depleted" for this category. */
  decayMs(category: Category = this.lastCategory): number {
    const base = Math.max(1, this.cfg.baseDecayMinutes) * 60_000;
    return base * (DECAY_MULTIPLIER[category] ?? 1);
  }

  /** Feed one accepted foreground switch. */
  observeSwitch(at: number, category: Category): SwitchResult {
    if (this.lastAt === 0) {
      this.lastAt = at;
      this.lastCategory = category;
      this.state = 'busy';
      return {};
    }
    const gapMs = Math.max(0, at - this.lastAt);
    const previousCategory = this.lastCategory;
    const wasQuiet = this.state === 'depleted' || this.state === 'away' || gapMs >= this.decayMs(previousCategory);
    this.lastAt = at;
    this.lastCategory = category;
    this.state = 'busy';
    this.checkedInAt = 0;
    if (wasQuiet && gapMs >= this.decayMs(previousCategory)) return { reengage: { gapMs, previousCategory } };
    return {};
  }

  /** Check the silence since the last switch; call on every poll tick. */
  tick(now: number): TickResult {
    if (this.lastAt === 0) return {};
    const gapMs = Math.max(0, now - this.lastAt);
    const decay = this.decayMs();
    if (gapMs >= decay) {
      if (this.state === 'depleted') {
        if (this.checkedInAt > 0 && now - this.checkedInAt >= Math.max(1, this.cfg.awayAfterMinutes) * 60_000) {
          this.state = 'away';
          return { away: true };
        }
        return {};
      }
      if (this.state === 'away') return {};
      this.state = 'depleted';
      const cooled = this.lastCheckInAt === 0 || now - this.lastCheckInAt >= Math.max(1, this.cfg.checkInCooldownMinutes) * 60_000;
      if (this.cfg.checkInEnabled && cooled) {
        this.lastCheckInAt = now;
        this.checkedInAt = now;
        return { depleted: true, checkIn: true };
      }
      return { depleted: true };
    }
    if (this.state !== 'busy' && this.state !== 'settling') this.state = 'settling';
    else this.state = gapMs > decay * 0.3 ? 'settling' : 'busy';
    return {};
  }

  snapshot(): FlowSnapshot {
    return {
      lastAt: this.lastAt,
      lastCategory: this.lastCategory,
      state: this.state,
      lastCheckInAt: this.lastCheckInAt,
      checkedInAt: this.checkedInAt,
    };
  }

  restore(snapshot: FlowSnapshot | null | undefined): void {
    if (!snapshot) return;
    this.lastAt = typeof snapshot.lastAt === 'number' ? snapshot.lastAt : 0;
    this.lastCategory = snapshot.lastCategory ?? 'neutral';
    this.state = snapshot.state ?? 'idle';
    this.lastCheckInAt = snapshot.lastCheckInAt ?? 0;
    this.checkedInAt = snapshot.checkedInAt ?? 0;
  }
}

/** `2 小时 13 分` / `2h 13m`, for event text. */
export function gapText(ms: number, language: 'zh' | 'en'): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (language === 'en') return hours ? `${hours}h ${rest}m` : `${rest}m`;
  return hours ? `${hours} 小时 ${rest} 分` : `${rest} 分`;
}
