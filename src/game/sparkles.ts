/** Frames a sparkle lasts. */
export const SPARKLE_FRAMES = 24;

/** A cosmetic burst: where gold was collected, or where a mine went off. */
export interface Sparkle {
  x: number;
  y: number;
  age: number;
  kind: 'gold' | 'blast';
}
