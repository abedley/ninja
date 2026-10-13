/**
 * One-button input: touching anywhere on the screen (or clicking, or pressing
 * a jump key) is "jump". Holding it makes the jump higher, as in N.
 */
const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW', 'KeyZ', 'KeyX', 'Enter', 'ShiftLeft', 'ShiftRight']);

export class Input {
  private keys = new Set<string>();
  private pointers = new Set<number>();
  /** Set on any new press, so a tap shorter than one frame still registers. */
  private latch = false;

  onRestart: (() => void) | null = null;
  onToggleDebug: (() => void) | null = null;

  constructor(surface: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    surface.addEventListener('pointerdown', this.onPointerDown);
    surface.addEventListener('pointerup', this.onPointerUp);
    surface.addEventListener('pointercancel', this.onPointerUp);
    // Stop the browser from scrolling, zooming or showing callouts during play.
    surface.addEventListener('touchstart', preventDefault, { passive: false });
    surface.addEventListener('touchmove', preventDefault, { passive: false });
    surface.addEventListener('contextmenu', preventDefault);
  }

  /** Whether jump is held this frame. Consumes the press latch. */
  takeJump(): boolean {
    const held = this.held || this.latch;
    this.latch = false;
    return held;
  }

  get held(): boolean {
    return this.keys.size > 0 || this.pointers.size > 0;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    if (JUMP_KEYS.has(code)) {
      if (!e.repeat && !this.keys.has(code)) this.latch = true;
      this.keys.add(code);
    } else if (code === 'KeyR' && !e.repeat) {
      this.onRestart?.();
    } else if (code === 'Backquote' && !e.repeat) {
      this.onToggleDebug?.();
    } else {
      return;
    }
    e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onPointerDown = (e: PointerEvent): void => {
    // Alt-click is reserved for the debug teleport.
    if ((e.pointerType === 'mouse' && e.button !== 0) || e.altKey) return;
    this.pointers.add(e.pointerId);
    this.latch = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
  };

  private clear = (): void => {
    this.keys.clear();
    this.pointers.clear();
  };
}

function preventDefault(e: Event): void {
  e.preventDefault();
}
