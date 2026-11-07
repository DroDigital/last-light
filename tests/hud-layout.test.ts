import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '../src/core/input';
import { hudBindingLabel, visibleMapLabels } from '../src/ui/hud-layout';

describe('HUD control labels', () => {
  it('shows the binding for the active input device', () => {
    expect(hudBindingLabel(DEFAULT_BINDINGS, 'fire2', 'kbm')).toBe('RMB');
    expect(hudBindingLabel(DEFAULT_BINDINGS, 'ability1', 'pad')).toBe('Pad 4');
    expect(hudBindingLabel({ ...DEFAULT_BINDINGS, ability1: ['KeyZ', 'Pad4'] }, 'ability1', 'kbm')).toBe('Z');
  });
  it('does not claim an unrelated binding when the device has none', () => {
    expect(hudBindingLabel({ ...DEFAULT_BINDINGS, ability1: ['Pad4'] }, 'ability1', 'kbm')).toBe('—');
  });
});

describe('map label visibility', () => {
  it('keeps all selectable labels while suppressing crowded distant labels', () => {
    const visible = visibleMapLabels([
      { id: 1, x: 100, y: 100, priority: 'reachable' },
      { id: 2, x: 104, y: 102, priority: 'reachable' },
      { id: 3, x: 110, y: 105, priority: 'preview' },
      { id: 4, x: 300, y: 300, priority: 'distant' },
    ]);
    expect([...visible].sort()).toEqual([1, 2, 4]);
  });
});
