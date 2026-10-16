/** Frames a sparkle lasts. */
export const SPARKLE_FRAMES = 24;

/** A cosmetic burst: where gold or the key was collected, a mine went off, a launch pad fired, or the exit was reached. */
export interface Sparkle {
  x: number;
  y: number;
  age: number;
  kind: 'gold' | 'blast' | 'key' | 'exit' | 'launch';
  /** For a launch: the way the pad threw (a unit vector). */
  dir?: readonly [number, number];
  /** Text that floats up from the burst (the time a gold piece added). */
  label?: string;
}

/** How many frames a sparkle lasts: a floating label and the exit burst linger longer. */
export function sparkleLife(s: Sparkle): number {
  return s.kind === 'exit' ? 60 : s.label ? 50 : SPARKLE_FRAMES;
}
