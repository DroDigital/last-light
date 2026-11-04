import type { Input } from '../core/input';
import type { AudioEngine } from '../audio/audio';

export type ActionFn = (arg: string, el: HTMLElement) => void;

/**
 * DOM UI framework: screens are HTML strings with data-act buttons.
 * Keyboard/gamepad navigation moves a focus ring spatially between
 * [data-nav] elements; confirm clicks, cancel triggers [data-back].
 */
export class UI {
  readonly root: HTMLElement;
  readonly hudEl: HTMLElement;
  readonly screenEl: HTMLElement;
  readonly overlayEl: HTMLElement;
  private actions = new Map<string, ActionFn>();
  current = '';
  private focusEl: HTMLElement | null = null;
  private navCd = 0;
  onBack: (() => void) | null = null;

  constructor(private input: Input, private audio: AudioEngine) {
    this.root = document.getElementById('ui')!;
    this.hudEl = document.createElement('div');
    this.hudEl.className = 'hud';
    this.screenEl = document.createElement('div');
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'hud';
    this.root.append(this.hudEl, this.screenEl, this.overlayEl);
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!el || (el as HTMLButtonElement).disabled) return;
      e.stopPropagation();
      this.fire(el);
    });
    this.root.addEventListener('mouseover', (e) => {
      const el = (e.target as HTMLElement).closest('[data-nav]') as HTMLElement | null;
      if (el && el !== this.focusEl) {
        this.setFocus(el, false);
        this.audio.play('uiMove', 0, 0.4);
      }
    });
    this.root.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      const act = el.dataset.input;
      if (act) this.actions.get(act)?.(el.value, el);
    });
    this.root.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      const act = el.dataset.change;
      if (act) this.actions.get(act)?.(el.value, el);
    });
  }

  on(act: string, fn: ActionFn): void {
    this.actions.set(act, fn);
  }

  private fire(el: HTMLElement): void {
    const act = el.dataset.act!;
    const fn = this.actions.get(act);
    if (!fn) return;
    if (!el.dataset.silent) this.audio.play(el.dataset.sfx === 'back' ? 'uiBack' : 'uiSelect', 0, 0.6);
    fn(el.dataset.arg ?? '', el);
  }

  show(name: string, html: string, cls = ''): void {
    this.current = name;
    this.screenEl.innerHTML = html ? `<div class="screen ${cls}" data-screen="${name}">${html}</div>` : '';
    this.focusEl = null;
    const first = (this.screenEl.querySelector('[data-autofocus]') ?? this.screenEl.querySelector('[data-nav]')) as HTMLElement | null;
    if (first) this.setFocus(first, false);
  }

  /** Re-render the same screen but keep focus on the same arg/act if possible. */
  refresh(name: string, html: string, cls = ''): void {
    const key = this.focusEl ? `${this.focusEl.dataset.act}|${this.focusEl.dataset.arg ?? ''}` : '';
    const scroll = (this.screenEl.querySelector('.scroll') as HTMLElement | null)?.scrollTop ?? 0;
    this.current = name;
    this.screenEl.innerHTML = `<div class="screen ${cls}" data-screen="${name}" style="animation:none">${html}</div>`;
    const sc = this.screenEl.querySelector('.scroll') as HTMLElement | null;
    if (sc) sc.scrollTop = scroll;
    this.focusEl = null;
    if (key) {
      for (const el of this.screenEl.querySelectorAll<HTMLElement>('[data-nav]')) {
        if (`${el.dataset.act}|${el.dataset.arg ?? ''}` === key) {
          this.setFocus(el, false);
          return;
        }
      }
    }
  }

  clear(): void {
    this.show('', '');
  }

  private setFocus(el: HTMLElement, scroll = true): void {
    this.focusEl?.classList.remove('focus');
    this.focusEl = el;
    el.classList.add('focus');
    if (scroll) el.scrollIntoView({ block: 'nearest' });
  }

  /** Per-frame navigation by keyboard arrows / gamepad. */
  update(dt: number, allowKeys = true): void {
    this.navCd -= dt;
    const inp = this.input;
    const els = Array.from(this.screenEl.querySelectorAll<HTMLElement>('[data-nav]')).filter((e) => e.offsetParent !== null);
    let dx = 0;
    let dy = 0;
    if (allowKeys) {
      if (inp.keyPressed('ArrowUp')) dy = -1;
      if (inp.keyPressed('ArrowDown')) dy = 1;
      if (inp.keyPressed('ArrowLeft')) dx = -1;
      if (inp.keyPressed('ArrowRight')) dx = 1;
    }
    if (inp.padButtonPressed(12)) dy = -1;
    if (inp.padButtonPressed(13)) dy = 1;
    if (inp.padButtonPressed(14)) dx = -1;
    if (inp.padButtonPressed(15)) dx = 1;
    if (this.navCd <= 0 && (Math.abs(inp.padLX) > 0.6 || Math.abs(inp.padLY) > 0.6)) {
      if (Math.abs(inp.padLX) > Math.abs(inp.padLY)) dx = Math.sign(inp.padLX);
      else dy = Math.sign(inp.padLY);
      this.navCd = 0.22;
    }
    // left/right adjusts a focused slider (keyboard and gamepad) instead of moving focus
    const fe = this.focusEl as HTMLInputElement | null;
    if (dx && fe && fe.tagName === 'INPUT' && fe.type === 'range') {
      const step = Number(fe.step) || 0.05;
      const v = Math.min(Number(fe.max), Math.max(Number(fe.min), Number(fe.value) + dx * step));
      fe.value = String(v);
      fe.dispatchEvent(new Event('input', { bubbles: true }));
      this.audio.play('uiMove', 0, 0.3);
      dx = 0;
    }
    if (dx && fe && fe.tagName === 'SELECT') {
      const select = fe as unknown as HTMLSelectElement;
      select.selectedIndex = Math.min(select.options.length - 1, Math.max(0, select.selectedIndex + dx));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      this.audio.play('uiMove', 0, 0.3);
      dx = 0;
    }
    if ((dx || dy) && els.length) {
      if (!this.focusEl || !els.includes(this.focusEl)) this.setFocus(els[0]!);
      else {
        const r0 = this.focusEl.getBoundingClientRect();
        const cx = r0.left + r0.width / 2;
        const cy = r0.top + r0.height / 2;
        let best: HTMLElement | null = null;
        let bestScore = Infinity;
        for (const e of els) {
          if (e === this.focusEl) continue;
          const r = e.getBoundingClientRect();
          const ex = r.left + r.width / 2 - cx;
          const ey = r.top + r.height / 2 - cy;
          const along = ex * dx + ey * dy;
          if (along <= 4) continue;
          const perp = Math.abs(ex * dy) + Math.abs(ey * dx);
          const score = along + perp * 2.5;
          if (score < bestScore) {
            bestScore = score;
            best = e;
          }
        }
        if (best) {
          this.setFocus(best);
          this.audio.play('uiMove', 0, 0.4);
        }
      }
    }
    const confirm = inp.pressed('confirm') || (allowKeys && inp.keyPressed('Space'));
    if (confirm && this.focusEl && this.focusEl.dataset.act) {
      if (this.focusEl.tagName === 'INPUT') return;
      this.fire(this.focusEl);
    }
    const back = inp.pressed('cancel');
    if (back) {
      const b = this.screenEl.querySelector('[data-back]') as HTMLElement | null;
      if (b) {
        this.audio.play('uiBack', 0, 0.6);
        this.fire(b);
      } else this.onBack?.();
    }
  }
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
