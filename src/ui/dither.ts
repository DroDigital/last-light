/**
 * UI dither textures. The interface is drawn in the same posterized language
 * as the world: every fade, glow and fill is an ordered (Bayer 4×4) dither on
 * a 3px cell grid, baked once at boot into data-URI masks exposed as CSS
 * variables. Components put a solid colour on a pseudo-element and mask it
 * with one of these, so any colour can be dithered crisply (masks are drawn at
 * 1:1 CSS pixels — never scaled, never blurred).
 */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const CELL = 3;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Paint cells where coverage(x, y) beats the Bayer threshold. */
function bake(w: number, h: number, coverage: (cx: number, cy: number, nx: number, ny: number) => number): string {
  const [c, g] = canvas(w, h);
  g.fillStyle = '#fff';
  const cw = Math.ceil(w / CELL);
  const ch = Math.ceil(h / CELL);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const th = (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
      if (coverage(x, y, (x + 0.5) / cw, (y + 0.5) / ch) > th) g.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  return `url(${c.toDataURL('image/png')})`;
}

export function installDitherTextures(): void {
  const root = document.documentElement.style;
  const tile = CELL * 4; // one Bayer period
  for (const p of [12, 25, 50, 75]) root.setProperty(`--m-${p}`, bake(tile, tile, () => p / 100));
  // horizontal fade: solid at the left, dithering away to the right
  root.setProperty('--m-fade-r', bake(480, tile, (_x, _y, nx) => 1 - nx));
  root.setProperty('--m-fade-l', bake(480, tile, (_x, _y, nx) => nx));
  // vertical fade: solid at the top, gone at the bottom
  root.setProperty('--m-fade-d', bake(tile, 240, (_x, _y, _nx, ny) => 1 - ny));
  root.setProperty('--m-fade-u', bake(tile, 240, (_x, _y, _nx, ny) => ny));
  // short rise for the wordmark: transparent above, dithering into solid below
  root.setProperty('--m-rise-30', bake(tile, 30, (_x, _y, _nx, ny) => ny));
  // radial glow
  root.setProperty('--m-glow', bake(120, 120, (_x, _y, nx, ny) => Math.max(0, 1 - Math.hypot(nx - 0.5, ny - 0.5) * 2.1) ** 1.3));
  // scan: every other cell row (CRT lines on panels)
  root.setProperty('--m-scan', bake(tile, tile, (_x, y) => (y % 2 === 0 ? 1 : 0)));
}

/** Tint the whole UI with the current sector's palette accent. */
export function setUiTint(primary: string, secondary: string): void {
  const root = document.documentElement.style;
  root.setProperty('--tint', primary);
  root.setProperty('--tint-2', secondary);
}
