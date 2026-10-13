import type { HorInput } from '../physics/ninja';

/**
 * Collects player input from the keyboard and from touch controls.
 *
 * Touch layout (landscape): the left half of the screen is a left/right pad,
 * where the side of the pad's centre line you touch picks the direction (you
 * can slide across it without lifting). The right half of the screen is jump.
 */
export interface TouchLayout {
  /** Screen x (CSS px) dividing "left" from "right" on the movement pad. */
  padCenterX: number;
  /** Screen x where the jump area begins. */
  jumpAreaX: number;
}

type TouchRole = 'move' | 'jump';

export class Input {
  private keysLeft = new Set<string>();
  private keysRight = new Set<string>();
  private keysJump = new Set<string>();
  private touches = new Map<number, { role: TouchRole; x: number }>();
  /** Set on any new jump press, so a tap shorter than one frame still registers. */
  private jumpLatch = false;
  /** Order in which directions were pressed: the latest one wins when both are held. */
  private lastDir: HorInput = 0;

  layout: TouchLayout = { padCenterX: 0, jumpAreaX: 0 };
  onRestart: (() => void) | null = null;
  onToggleDebug: (() => void) | null = null;
  /** True once the player has used a touchscreen; switches the UI to touch mode. */
  usingTouch = false;
  onTouchModeChange: ((touch: boolean) => void) | null = null;

  constructor(private readonly surface: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    surface.addEventListener('pointerdown', this.onPointerDown);
    surface.addEventListener('pointermove', this.onPointerMove);
    surface.addEventListener('pointerup', this.onPointerUp);
    surface.addEventListener('pointercancel', this.onPointerUp);
    // Stop the browser from scrolling, zooming or showing callouts during play.
    surface.addEventListener('touchstart', preventDefault, { passive: false });
    surface.addEventListener('touchmove', preventDefault, { passive: false });
    surface.addEventListener('contextmenu', preventDefault);
  }

  /** Horizontal input for this frame. */
  get hor(): HorInput {
    const touchDir = this.touchDir;
    const left = this.keysLeft.size > 0 || touchDir === -1;
    const right = this.keysRight.size > 0 || touchDir === 1;
    if (left && right) return touchDir || this.lastDir;
    return left ? -1 : right ? 1 : 0;
  }

  /** Jump state for this frame. Consumes the press latch. */
  takeJump(): boolean {
    let held = this.keysJump.size > 0;
    for (const t of this.touches.values()) if (t.role === 'jump') held = true;
    const jump = held || this.jumpLatch;
    this.jumpLatch = false;
    return jump;
  }

  get touchDir(): HorInput {
    for (const t of this.touches.values()) {
      if (t.role === 'move') return t.x < this.layout.padCenterX ? -1 : 1;
    }
    return 0;
  }

  get touchJump(): boolean {
    for (const t of this.touches.values()) if (t.role === 'jump') return true;
    return false;
  }

  private setTouchMode(touch: boolean): void {
    if (this.usingTouch === touch) return;
    this.usingTouch = touch;
    this.onTouchModeChange?.(touch);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    let handled = true;
    if (code === 'ArrowLeft' || code === 'KeyA') {
      this.keysLeft.add(code);
      this.lastDir = -1;
    } else if (code === 'ArrowRight' || code === 'KeyD') {
      this.keysRight.add(code);
      this.lastDir = 1;
    } else if (code === 'Space' || code === 'ArrowUp' || code === 'KeyW' || code === 'KeyZ' || code === 'ShiftLeft' || code === 'ShiftRight') {
      if (!e.repeat && !this.keysJump.has(code)) this.jumpLatch = true;
      this.keysJump.add(code);
    } else if (code === 'KeyR' && !e.repeat) {
      this.onRestart?.();
    } else if (code === 'Backquote' && !e.repeat) {
      this.onToggleDebug?.();
    } else {
      handled = false;
    }
    if (handled) {
      e.preventDefault();
      this.setTouchMode(false);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysLeft.delete(e.code);
    this.keysRight.delete(e.code);
    this.keysJump.delete(e.code);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    this.setTouchMode(true);
    const role: TouchRole = e.clientX < this.layout.jumpAreaX ? 'move' : 'jump';
    if (role === 'move') {
      // Only one finger steers; a new one takes over.
      for (const [id, t] of this.touches) if (t.role === 'move') this.touches.delete(id);
    } else {
      this.jumpLatch = true;
    }
    this.touches.set(e.pointerId, { role, x: e.clientX });
    this.surface.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const t = this.touches.get(e.pointerId);
    if (t) t.x = e.clientX;
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
  };

  private clear = (): void => {
    this.keysLeft.clear();
    this.keysRight.clear();
    this.keysJump.clear();
    this.touches.clear();
  };
}

function preventDefault(e: Event): void {
  e.preventDefault();
}
