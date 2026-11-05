import { describe, expect, it } from 'vitest';
import { FlowModel } from '../src/flow.ts';

const at = (minutes: number) => 1_000_000 + minutes * 60_000;

describe('FlowModel', () => {
  it('uses the category decay window', () => {
    const flow = new FlowModel({ baseDecayMinutes: 20 });
    expect(flow.decayMs('develop')).toBe(20 * 60_000);
    expect(flow.decayMs('video')).toBe(30 * 60_000);
    expect(flow.decayMs('browser')).toBe(8 * 60_000);
  });

  it('depletes after the window and reengages on a new switch', () => {
    const flow = new FlowModel({ baseDecayMinutes: 20 });
    expect(flow.observeSwitch(at(0), 'develop')).toEqual({});
    expect(flow.tick(at(19))).toEqual({});
    expect(flow.tick(at(21))).toEqual({ depleted: true });
    expect(flow.current).toBe('depleted');
    const result = flow.observeSwitch(at(40), 'browser');
    expect(result.reengage).toMatchObject({ previousCategory: 'develop' });
    expect(flow.current).toBe('busy');
  });

  it('keeps watching as depleted for longer on video', () => {
    const flow = new FlowModel({ baseDecayMinutes: 20 });
    flow.observeSwitch(at(0), 'video');
    expect(flow.tick(at(25))).toEqual({});
    expect(flow.tick(at(31))).toEqual({ depleted: true });
  });

  it('checks in once with the cooldown, then confirms away', () => {
    const flow = new FlowModel({ baseDecayMinutes: 20, checkInEnabled: true, awayAfterMinutes: 10, checkInCooldownMinutes: 60 });
    flow.observeSwitch(at(0), 'develop');
    expect(flow.tick(at(21))).toEqual({ depleted: true, checkIn: true });
    expect(flow.tick(at(30))).toEqual({});
    expect(flow.tick(at(31))).toEqual({ away: true });
    expect(flow.current).toBe('away');
    expect(flow.observeSwitch(at(50), 'develop').reengage).toBeDefined();
  });

  it('does not check in by default', () => {
    const flow = new FlowModel({ baseDecayMinutes: 20 });
    flow.observeSwitch(at(0), 'develop');
    expect(flow.tick(at(21))).toEqual({ depleted: true });
  });

  it('restores its snapshot', () => {
    const flow = new FlowModel({ baseDecayMinutes: 20 });
    flow.observeSwitch(at(0), 'develop');
    flow.tick(at(21));
    const restored = new FlowModel({ baseDecayMinutes: 20 });
    restored.restore(flow.snapshot());
    expect(restored.current).toBe('depleted');
    expect(restored.lastSwitchAt).toBe(at(0));
  });
});
