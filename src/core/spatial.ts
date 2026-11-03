/**
 * Spatial hash broadphase for 3D points with radius. Rebuilt each tick.
 * Uses flat typed arrays (counting sort into buckets) for zero allocation.
 */
export class SpatialHash {
  readonly cell: number;
  private readonly tableSize: number;
  private counts: Int32Array;
  private starts: Int32Array;
  private items: Int32Array;
  private keys: Int32Array;
  private n = 0;
  private readonly maxItems: number;

  constructor(cell: number, maxItems: number, tableSize = 4096) {
    this.cell = cell;
    this.tableSize = tableSize;
    this.maxItems = maxItems;
    this.counts = new Int32Array(tableSize + 1);
    this.starts = new Int32Array(tableSize + 1);
    this.items = new Int32Array(maxItems);
    this.keys = new Int32Array(maxItems);
  }

  private hash(ix: number, iy: number, iz: number): number {
    const h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) >>> 0;
    return h % this.tableSize;
  }

  /** Build from positions. ids are indices 0..count-1. */
  build(count: number, xs: ArrayLike<number>, ys: ArrayLike<number>, zs: ArrayLike<number>): void {
    const n = Math.min(count, this.maxItems);
    this.n = n;
    const counts = this.counts;
    counts.fill(0);
    const inv = 1 / this.cell;
    for (let i = 0; i < n; i++) {
      const k = this.hash(Math.floor(xs[i]! * inv), Math.floor(ys[i]! * inv), Math.floor(zs[i]! * inv));
      this.keys[i] = k;
      counts[k]!++;
    }
    let acc = 0;
    for (let k = 0; k < this.tableSize; k++) {
      this.starts[k] = acc;
      acc += counts[k]!;
    }
    this.starts[this.tableSize] = acc;
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const k = this.keys[i]!;
      this.items[this.starts[k]! + counts[k]!] = i;
      counts[k]!++;
    }
  }

  /**
   * Query all ids whose cell overlaps the sphere (x,y,z,r). Writes into out,
   * returns count. Duplicates are possible only on hash collisions, so callers
   * should tolerate them (we dedupe via stamp arrays where it matters).
   */
  query(x: number, y: number, z: number, r: number, out: Int32Array): number {
    const inv = 1 / this.cell;
    const x0 = Math.floor((x - r) * inv);
    const x1 = Math.floor((x + r) * inv);
    const y0 = Math.floor((y - r) * inv);
    const y1 = Math.floor((y + r) * inv);
    const z0 = Math.floor((z - r) * inv);
    const z1 = Math.floor((z + r) * inv);
    let c = 0;
    const max = out.length;
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++)
        for (let iz = z0; iz <= z1; iz++) {
          const k = this.hash(ix, iy, iz);
          const s = this.starts[k]!;
          const e = s + this.counts[k]!;
          for (let j = s; j < e && c < max; j++) out[c++] = this.items[j]!;
        }
    return c;
  }

  get size(): number {
    return this.n;
  }
}
