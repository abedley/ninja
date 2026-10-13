# Ninja

A mobile-first clone of Metanet Software's *N: The Way of the Ninja*, focused on
reproducing its physics exactly.

So far: running, skidding, jumping (with variable height), slope jumps, wall
sliding, wall jumps, every N/N++ tile shape, and fall-impact death.

## Running it

```sh
npm install
npm run dev      # serves on your LAN too, so you can open it on a phone
npm test         # physics tests
npm run build    # production build in dist/
```

### Controls

| | Touch (landscape) | Keyboard |
|---|---|---|
| Move | Left half of the screen: touch left or right of the pads' midline (you can slide between them) | ← → or A D |
| Jump | Anywhere on the right half; hold for a higher jump | Space, ↑, W, Z or Shift |
| Restart | ↺ button | R |
| Physics overlay | ⓘ button | `` ` `` (backtick) |

With the physics overlay on, clicking with a mouse drops the ninja at that spot.

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

`tests/golden.test.ts` replays about 27,000 frames of scripted and random input
through both simulators. Our ninja must match **bit for bit on every frame**
(position, speed and state). The traces cover running, jump buffering, wall
slides, both kinds of wall jump, slope jumps, every tile type and impact deaths.

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

## Layout

```
src/physics/   deterministic simulation: tiles -> segments, collision, ninja state machine
src/level/     ASCII level format (legend in level.ts) and levels.json
src/game/      game loop (fixed 60 Hz), input, renderer, animation, death debris
tools/golden/  reference-trace generator (needs an nclone checkout)
tests/         golden physics tests, level and debris tests
```

The physics has no dependencies on the browser, rendering or wall-clock time.
It advances exactly one frame per `Simulator.tick(horizontalInput, jumpHeld)`,
which keeps replays and tests deterministic.

## Not done yet

- Entities: gold, exit door and switch, mines, drones, thwumps, launch pads, bounce blocks, one-way platforms, doors
- Ragdoll death (the current one is a cosmetic stand-in)
- The time bar, level/episode flow and a level editor
- Real ninja animation data (current poses are procedural)
