# Ninja

A one-button, portrait mobile game built on an exact copy of the physics of
Metanet Software's *N: The Way of the Ninja*.

The ninja runs by itself; you only jump. It keeps running the way it's going
until it hits a wall: on the ground, a wall turns it around; in the air, it
clings to the wall it hit and slides down until you tap, which kicks it off
the wall and sends it running the other way. Climb the Tower (98 rows high)
and collect the gold, avoiding the mines. Fall too far and you die.

Physics so far: running, skidding, jumping (with variable height), slope jumps,
wall sliding, wall jumps, every N/N++ tile shape, fall-impact death, gold and
mines.

## Running it

```sh
npm install
npm run dev      # serves on your LAN too, so you can open it on a phone
npm test         # physics tests
npm run build    # production build in dist/
```

### Controls

Hold the phone upright.

| | Touch | Keyboard / mouse |
|---|---|---|
| Start, jump | Tap anywhere; hold for a higher jump | Space, ↑, W, Z, X, Enter or Shift; or click |
| Restart | ↺ button | R |
| Physics overlay | ⓘ button | `` ` `` (backtick) |

With the physics overlay on, alt-clicking drops the ninja at that spot.

The camera follows the ninja, leading a little in the running direction and
upwards. Zoom is set by `VIEW_MIN_W` / `VIEW_MIN_H` in `src/game/renderer.ts`
(the view is at least 10 tiles across and 20 tiles tall), and how the camera
follows by the `CAMERA_*` constants in `src/game/game.ts`.

## Hosting

Pushing to `main` runs `.github/workflows/deploy.yml`. It runs the tests, builds
the game and publishes it to GitHub Pages at `https://<user>.github.io/<repo>/`.
This needs a one-time setting in the repo: **Settings → Pages → Build and
deployment → Source: GitHub Actions**. Asset paths are relative
(`vite.config.ts`), so the build works under any sub-path.

## How faithful is the physics?

The engine in `src/physics/` is a port of N++'s movement and collision model,
based on [nclone](https://github.com/SimonV42/nclone). nclone is the community's
reverse-engineered N++ simulator, used to validate real N++ replays. N++ uses N's
model, run at 60 fps instead of 40 (its per-frame multipliers are N's raised to
the power 2/3).

`tests/golden.test.ts` replays about 36,000 frames of scripted and random input
through both simulators. Our ninja must match **bit for bit on every frame**
(position, speed and state). The traces cover running, jump buffering, wall
slides, both kinds of wall jump, slope jumps, every tile type and impact deaths.
Gold must be collected, and mines must arm and go off, on exactly the same
frames. Some runs fill the level with gold on every point of N++'s 6 px entity
grid, and others place mines where the ninja passes just inside or just
outside touching distance, to test the boundaries.

The reference is run with one change: Python's `x**2` is evaluated as `x*x`.
Python's `**` calls the C library's `pow()`, which on glibc differs from `x*x` in
the last bit for about 1 in 1000 inputs, so nclone's own output depends on the
platform. N++ is C++ and presumably squares by multiplying, as this engine does.

Order of floating-point operations matters for exactness. If you change anything
in `src/physics/`, run `npm test`.

### Regenerating the reference traces

```sh
git clone https://github.com/SimonV42/nclone /tmp/nclone
python3 -I tools/golden/gen_golden.py /tmp/nclone tests/fixtures/golden.json
```

## Levels

The game opens the **Tower**; add `?level=playground` to the URL for the
Playground (built for the original two-handed controls, but playable).

Levels live in `src/level/levels.json` as ASCII grids; the tile legend is in
`src/level/level.ts`. `N` is the spawn; `$`, `*` and `%` put a piece of gold,
a mine or a toggle mine in the middle of a tile. For finer placement, a level
can also list `"gold"`, `"mines"` and `"toggleMines"` as `[[x, y], ...]` in
N++'s 6 px entity units, counted from the outer edge of the border (tile
centres are at `4n + 2`).

Entities work as in N++ (they don't affect movement):

- **Gold** is a circle of radius 6, collected when it overlaps the ninja's
  circle (radius 10) during the collision step.
- **Mines** (radius 4) kill the ninja on contact.
- **Toggle mines** start safe (radius 3.5). Touching one starts arming it
  (radius 4.5), and it becomes a live mine once the ninja moves off it, so
  coming back the same way is deadly.

### Checking that a level can be beaten

`tools/solver/` is a search bot that plays with the one-button controls and
looks for a sequence of presses that reaches the top of a level:

```sh
npx vite-node tools/solver/solve.ts Tower   # [level] [goal row] [beam width]
```

`tests/tower.test.ts` replays the route it found for the Tower. If you change
the Tower, re-run the solver and paste the new route into the test.

## Layout

```
src/physics/   deterministic simulation: tiles -> segments, collision, ninja state machine
src/level/     ASCII level format (legend in level.ts) and levels.json
src/game/      game loop (fixed 60 Hz), one-button auto-runner, input, camera and
               renderer, animation, death debris
tools/golden/  reference-trace generator (needs an nclone checkout)
tools/solver/  search bot that proves levels can be beaten with one button
tests/         golden physics tests, level, Tower/auto-runner and debris tests
```

The physics has no dependencies on the browser, rendering or wall-clock time.
It advances exactly one frame per `Simulator.tick(horizontalInput, jumpHeld)`,
which keeps replays and tests deterministic.

## Not done yet

- Entities: exit door and switch, drones, thwumps, launch pads, bounce blocks, one-way platforms, doors
- Ragdoll death (the current one is a cosmetic stand-in)
- An exit / level-complete state, the time bar (in N, each piece of gold adds time), more levels and a level editor
- Real ninja animation data (current poses are procedural)
