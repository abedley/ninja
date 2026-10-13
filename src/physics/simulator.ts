import { Ninja, NinjaState, type HorInput } from './ninja';
import { TileMap } from './tileMap';

/** Simulation runs at a fixed 60 ticks per second, like N++. */
export const TICK_RATE = 60;

export class Simulator {
  readonly map: TileMap;
  ninja: Ninja;
  frame = 0;

  constructor(map: TileMap, spawnX: number, spawnY: number) {
    this.map = map;
    this.ninja = new Ninja(map, spawnX, spawnY);
  }

  /** Advance the simulation by exactly one frame. */
  tick(horInput: HorInput, jumpInput: boolean): void {
    this.frame++;
    const ninja = this.ninja;
    ninja.horInput = horInput;
    ninja.jumpInput = jumpInput;

    if (ninja.state === NinjaState.Disabled || ninja.state === NinjaState.Dead) return;

    ninja.integrate();
    ninja.preCollision();
    // N++ runs four collision passes per frame (entities would go in between).
    for (let i = 0; i < 4; i++) ninja.collideVsTiles();
    ninja.postCollision();
    ninja.think();
  }
}
