/**
 * Input: keyboard + mouse (pointer lock) + gamepad, mapped to actions.
 * All bindings are rebindable and persisted via settings.
 */
export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'fire1'
  | 'fire2'
  | 'boost'
  | 'dodge'
  | 'ability1'
  | 'ability2'
  | 'flare'
  | 'camera'
  | 'map'
  | 'pause'
  | 'confirm'
  | 'cancel';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Thrust forward',
  back: 'Reverse',
  left: 'Strafe left',
  right: 'Strafe right',
  up: 'Rise',
  down: 'Sink',
  fire1: 'Primary fire',
  fire2: 'Secondary fire',
  boost: 'Boost',
  dodge: 'Dodge roll',
  ability1: 'Ability: Shockwave',
  ability2: 'Ability: Stasis',
  flare: 'Flare overdrive',
  camera: 'Toggle camera',
  map: 'Sector map',
  pause: 'Pause',
  confirm: 'Confirm',
  cancel: 'Back',
};

export type Bindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  up: ['KeyR'],
  down: ['KeyC'],
  fire1: ['Mouse0'],
  fire2: ['Mouse2'],
  boost: ['Space'],
  dodge: ['ShiftLeft', 'ShiftRight'],
  ability1: ['KeyQ'],
  ability2: ['KeyE'],
  flare: ['KeyF'],
  camera: ['KeyV'],
  map: ['Tab'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter'],
  cancel: ['Escape', 'Backspace'],
};

// Standard gamepad mapping indices
const PAD: Partial<Record<Action, number[]>> = {
  fire1: [7],
  fire2: [6],
  boost: [0],
  dodge: [1],
  ability1: [4],
  ability2: [5],
  flare: [3],
  camera: [8],
  map: [9],
  pause: [9],
  confirm: [0],
  cancel: [1],
};

export class Input {
  bindings: Bindings = structuredClone(DEFAULT_BINDINGS);
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private padPrev: boolean[] = [];
  private padNow: boolean[] = [];
  mouseDX = 0;
  mouseDY = 0;
  mouseX = 0;
  mouseY = 0;
  /** Mouse position normalized -1..1 relative to the screen center. */
  mouseNX = 0;
  mouseNY = 0;
  locked = false;
  sensitivity = 1;
  invertY = false;
  padSensitivity = 1;
  /** Gamepad axes after deadzone. */
  padLX = 0;
  padLY = 0;
  padRX = 0;
  padRY = 0;
  padConnected = false;
  lastDevice: 'kbm' | 'pad' = 'kbm';
  /** If set, the next key/button press is captured for rebinding. */
  captureNext: ((code: string) => void) | null = null;
  /** Toggle vs hold for boost. */
  holdToggle: Partial<Record<Action, boolean>> = {};
  private toggled = new Set<Action>();
  private canvas: HTMLElement;
  /** Automation override: when set, these actions are held. */
  synthetic = new Set<Action>();
  syntheticAimX = 0;
  syntheticAimY = 0;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (this.captureNext) {
        e.preventDefault();
        const cb = this.captureNext;
        this.captureNext = null;
        cb(e.code);
        return;
      }
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('F') || e.code === 'Backspace') {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }
      if (!this.down.has(e.code)) this.pressedThisFrame.add(e.code);
      this.down.add(e.code);
      this.lastDevice = 'kbm';
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('mousedown', (e) => {
      const code = 'Mouse' + e.button;
      if (this.captureNext) {
        const cb = this.captureNext;
        this.captureNext = null;
        cb(code);
        return;
      }
      if (!this.down.has(code)) this.pressedThisFrame.add(code);
      this.down.add(code);
      this.lastDevice = 'kbm';
    });
    window.addEventListener('mouseup', (e) => this.down.delete('Mouse' + e.button));
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseNX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseNY = (e.clientY / window.innerHeight) * 2 - 1;
      if (this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });
  }

  requestLock(): void {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Poll gamepads; call once per frame before reading. */
  poll(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) pad = p;
    this.padConnected = !!pad;
    this.padPrev = this.padNow;
    this.padNow = [];
    if (pad) {
      const dz = (v: number) => {
        const a = Math.abs(v);
        if (a < 0.15) return 0;
        return Math.sign(v) * ((a - 0.15) / 0.85);
      };
      this.padLX = dz(pad.axes[0] ?? 0);
      this.padLY = dz(pad.axes[1] ?? 0);
      // radial deadzone on the aim stick so resting drift never turns the ship
      const rx = pad.axes[2] ?? 0;
      const ry = pad.axes[3] ?? 0;
      const rm = Math.hypot(rx, ry);
      const rk = rm < 0.2 ? 0 : (rm - 0.2) / 0.8 / rm;
      this.padRX = rx * rk;
      this.padRY = ry * rk;
      for (let i = 0; i < pad.buttons.length; i++) {
        const b = pad.buttons[i]!;
        this.padNow[i] = b.pressed || b.value > 0.4;
        if (this.padNow[i] && !this.padPrev[i]) {
          this.lastDevice = 'pad';
          if (this.captureNext) {
            const cb = this.captureNext;
            this.captureNext = null;
            cb('Pad' + i);
          }
        }
      }
      if (Math.abs(this.padLX) + Math.abs(this.padLY) + Math.abs(this.padRX) + Math.abs(this.padRY) > 0.2)
        this.lastDevice = 'pad';
    } else {
      this.padLX = this.padLY = this.padRX = this.padRY = 0;
    }
  }

  private padHeld(i: number): boolean {
    return !!this.padNow[i];
  }
  private padPressed(i: number): boolean {
    return !!this.padNow[i] && !this.padPrev[i];
  }

  held(a: Action): boolean {
    if (this.synthetic.has(a)) return true;
    if (this.holdToggle[a]) return this.toggled.has(a);
    return this.rawHeld(a);
  }

  private rawHeld(a: Action): boolean {
    for (const c of this.bindings[a]) {
      if (c.startsWith('Pad')) {
        if (this.padHeld(+c.slice(3))) return true;
      } else if (this.down.has(c)) return true;
    }
    for (const i of PAD[a] ?? []) if (this.padHeld(i)) return true;
    return false;
  }

  pressed(a: Action): boolean {
    for (const c of this.bindings[a]) {
      if (c.startsWith('Pad')) {
        if (this.padPressed(+c.slice(3))) return true;
      } else if (this.pressedThisFrame.has(c)) return true;
    }
    for (const i of PAD[a] ?? []) if (this.padPressed(i)) return true;
    return false;
  }

  /** Raw pad button press for UI navigation (dpad etc). */
  padButtonPressed(i: number): boolean {
    return this.padPressed(i);
  }

  keyPressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  /** Call at end of frame. Handles toggle-mode actions. */
  endFrame(): void {
    for (const a of Object.keys(this.holdToggle) as Action[]) {
      if (this.holdToggle[a] && this.pressed(a)) {
        if (this.toggled.has(a)) this.toggled.delete(a);
        else this.toggled.add(a);
      }
    }
    this.pressedThisFrame.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  /** Movement axes in ship space: x strafe, y vertical, z thrust (+forward). */
  moveAxes(out: { x: number; y: number; z: number }): void {
    let x = 0;
    let y = 0;
    let z = 0;
    if (this.held('right')) x += 1;
    if (this.held('left')) x -= 1;
    if (this.held('up')) y += 1;
    if (this.held('down')) y -= 1;
    if (this.held('forward')) z += 1;
    if (this.held('back')) z -= 1;
    x += this.padLX;
    z -= this.padLY;
    // Pad: d-pad up/down for vertical
    if (this.padHeld(12)) y += 1;
    if (this.padHeld(13)) y -= 1;
    out.x = Math.max(-1, Math.min(1, x));
    out.y = Math.max(-1, Math.min(1, y));
    out.z = Math.max(-1, Math.min(1, z));
  }

  static codeLabel(code: string): string {
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code === 'Mouse0') return 'LMB';
    if (code === 'Mouse1') return 'MMB';
    if (code === 'Mouse2') return 'RMB';
    if (code.startsWith('Pad')) return 'Pad ' + code.slice(3);
    if (code === 'ShiftLeft') return 'L-Shift';
    if (code === 'ShiftRight') return 'R-Shift';
    return code;
  }
}
