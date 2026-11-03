/**
 * Fixed 60 Hz simulation with interpolated rendering.
 * - `timeScale` slows the sim (slow-mo, assist speed).
 * - `hitStop(ms)` freezes the sim while rendering keeps going (juice).
 */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export interface LoopCallbacks {
  update(dt: number): void;
  render(alpha: number, frameDt: number): void;
}

export class GameLoop {
  timeScale = 1;
  private acc = 0;
  private last = 0;
  private running = false;
  private stopUntil = 0;
  private rafId = 0;
  /** Real seconds since start. */
  realTime = 0;
  /** Sim ticks executed. */
  tick = 0;
  simMs = 0;
  renderMs = 0;
  frameMs = 16.6;

  constructor(private cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(frame);
      this.step(now);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  hitStop(ms: number): void {
    const until = performance.now() + ms;
    if (until > this.stopUntil) this.stopUntil = until;
  }

  get frozen(): boolean {
    return performance.now() < this.stopUntil;
  }

  /** Exposed for tests/automation: advance manually. */
  step(now: number): void {
    let frameDt = (now - this.last) / 1000;
    this.last = now;
    if (frameDt > 0.25) frameDt = 0.25; // tab switch protection
    this.frameMs = this.frameMs * 0.9 + frameDt * 1000 * 0.1;
    this.realTime += frameDt;

    const t0 = performance.now();
    if (now >= this.stopUntil) {
      this.acc += frameDt * this.timeScale;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < 5) {
        this.cb.update(SIM_DT);
        this.acc -= SIM_DT;
        this.tick++;
        steps++;
      }
      if (steps >= 5) this.acc = 0; // spiral-of-death guard
    }
    const t1 = performance.now();
    this.cb.render(this.acc / SIM_DT, frameDt);
    const t2 = performance.now();
    this.simMs = this.simMs * 0.9 + (t1 - t0) * 0.1;
    this.renderMs = this.renderMs * 0.9 + (t2 - t1) * 0.1;
  }
}
