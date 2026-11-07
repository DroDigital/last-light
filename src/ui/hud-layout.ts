import { Input, type Action, type Bindings } from '../core/input';

/** The HUD follows the active device and the player's own bindings. */
export function hudBindingLabel(bindings: Bindings, action: Action, device: 'kbm' | 'pad'): string {
  const code = bindings[action].find((binding) => binding.startsWith('Pad') === (device === 'pad'));
  return code ? Input.codeLabel(code) : '—';
}

export interface MapLabelPosition {
  id: number;
  x: number;
  y: number;
  priority: 'reachable' | 'current' | 'preview' | 'distant';
}

/** Protect selectable destinations, then remove route context labels that collide. */
export function visibleMapLabels(labels: MapLabelPosition[]): Set<number> {
  const weight = { reachable: 0, current: 1, preview: 2, distant: 3 } as const;
  const ordered = [...labels].sort((a, b) => weight[a.priority] - weight[b.priority]);
  const placed: MapLabelPosition[] = [];
  const visible = new Set<number>();
  for (const label of ordered) {
    const protectedLabel = label.priority === 'reachable' || label.priority === 'current';
    const crowded = placed.some((other) => Math.abs(label.x - other.x) < 80 && Math.abs(label.y - other.y) < 52);
    if (!protectedLabel && crowded) continue;
    visible.add(label.id);
    placed.push(label);
  }
  return visible;
}
