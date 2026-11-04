import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input, DEFAULT_BINDINGS } from '../src/core/input';
import { defaultSave, migrate } from '../src/meta/save';

function setup() {
  const target = { addEventListener: vi.fn() };
  vi.stubGlobal('window', target);
  vi.stubGlobal('document', target);
  let pads: (Gamepad | null)[] = [];
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  const input = new Input({} as HTMLElement);
  const pad = (buttons: number[] = [], axes = [0, 0, 0, 0]) => ({
    connected: true, index: 0, axes,
    buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: buttons.includes(i), value: buttons.includes(i) ? 1 : 0 })),
  }) as unknown as Gamepad;
  return { input, setPads: (value: (Gamepad | null)[]) => { pads = value; }, pad };
}
afterEach(() => vi.unstubAllGlobals());

describe('gamepad input', () => {
  it('keeps pause and radar on separate buttons', () => {
    const { input, setPads, pad } = setup();
    setPads([pad([9])]); input.poll();
    expect(input.pressed('pause')).toBe(true);
    expect(input.pressed('map')).toBe(false);
    setPads([pad()]); input.poll();
    setPads([pad([10])]); input.poll();
    expect(input.pressed('map')).toBe(true);
    expect(input.pressed('pause')).toBe(false);
  });
  it('honors a rebound pad button without retaining its old default', () => {
    const { input, setPads, pad } = setup();
    input.bindings.fire1 = ['Mouse0', 'Pad2'];
    setPads([pad([7])]); input.poll();
    expect(input.held('fire1')).toBe(false);
    setPads([pad([2])]); input.poll();
    expect(input.pressed('fire1')).toBe(true);
  });
  it('does not trigger the button used to capture a binding until it is released', () => {
    const { input, setPads, pad } = setup();
    const capture = vi.fn(); input.captureNext = capture;
    setPads([pad([0])]); input.poll();
    expect(capture).toHaveBeenCalledWith('Pad0');
    expect(input.padButtonPressed(0)).toBe(false);
    input.poll(); expect(input.held('boost')).toBe(false);
    setPads([pad()]); input.poll();
    setPads([pad([0])]); input.poll();
    expect(input.pressed('boost')).toBe(true);
  });
  it('clears stick and button state when disconnected', () => {
    const { input, setPads, pad } = setup();
    setPads([pad([7], [0.7, -0.7, 0.5, 0])]); input.poll();
    expect(input.held('fire1')).toBe(true);
    setPads([]); input.poll();
    expect(input.held('fire1')).toBe(false);
    expect([input.padLX, input.padLY, input.padRX, input.padRY]).toEqual([0, 0, 0, 0]);
  });
  it('migrates existing keyboard and custom pad bindings without losing either', () => {
    const old = defaultSave(); old.version = 3;
    old.settings.bindings.fire1 = ['KeyX'];
    old.settings.bindings.fire2 = ['Mouse2', 'Pad2'];
    const saved = migrate(old);
    expect(saved.settings.bindings.fire1).toEqual(['KeyX', 'Pad7']);
    expect(saved.settings.bindings.fire2).toEqual(['Mouse2', 'Pad2']);
    expect(DEFAULT_BINDINGS.map).toContain('Pad10');
    expect(migrate(saved).settings.bindings).toEqual(saved.settings.bindings);
  });
});
