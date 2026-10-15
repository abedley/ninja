import { TICK_RATE } from '../physics/simulator';

/** A time in frames, in seconds to the hundredth (for times taken). */
export const secs = (frames: number): string => (frames / TICK_RATE).toFixed(2);

/** Clock time in frames, as the HUD shows it (tenths, rounded up). */
export const clockText = (frames: number): string => (Math.ceil((frames / TICK_RATE) * 10) / 10).toFixed(1);

/** Make an element with optional text and class. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (className) e.className = className;
  return e;
}
