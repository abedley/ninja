# Ninja

A one-button, portrait mobile game built on an exact copy of the physics of
Metanet Software's *N: The Way of the Ninja*.

The ninja runs by itself; you only jump. It keeps running the way it's going
until it hits a wall: on the ground, a wall (or anything else it can't get
past, like a sloping ceiling it's wedged under) turns it around; in the air, it
clings to the wall it hit and slides down until you tap, which kicks it off
the wall and sends it running the other way. In each level, pick up the key to
open the exit door, avoiding the mines, and get there before the clock runs
out. Fall too far and you die.

The game opens on a main menu: **Play** lists the campaigns, *Midnight City*
and *Cloud City*, **High scores** shows each campaign's best runs and best
level times, and **Level editor** opens the editor. The ⌂ button (or Esc)
during play pauses and brings the menu back, with **Resume** at the top.

A campaign is five levels on one clock, like an N++ episode: you
start with 30 seconds, each level starts with the time left at the end of the
one before, and each piece of gold adds two seconds. Dying (or running out of
time) sends you back to the start of the level you're on, with the clock back
where it was when you started it. Midnight City's levels are First Steps,
Wall Jumping, Hop, Skip, Jump!, Risk Reward Room and Fireman. Cloud City's are
Door in the Clouds, Silver Lining, Updraft (launch pads), Thunderhead (a storm
cloud with lightning) and Cloud Nine.

The game keeps your best score for each level and your five best runs, ranked
by the time left at the end, in the browser. A level's score is 30 seconds less
the time taken (from the first tap to the door), plus two seconds for each piece
of gold: the time you'd have left on a 30 second clock. Higher is better, and it
can go below zero. **Reset high scores**, at the bottom of the High scores
screen, deletes them all after asking to make sure.

It's set at midnight in a neon city. The platforms are dark blocks edged with
neon light, the ninja's headband glows hot pink, and gold, mines, the key and
the door each glow in their own colour. Behind the level, a dark skyline with
lamplit windows, in three parallax layers (generated from a fixed seed in
`src/game/cityscape.ts`), sinks away below as the ninja climbs; the neon is
kept for the level itself.

Physics so far: running, skidding, jumping (with variable height), slope jumps,
wall sliding, wall jumps, every N/N++ tile shape, fall-impact death, gold,
mines and the exit door and its switch (the key).

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
| Restart the level | ↺ button | R |
| Pause, main menu | ⌂ button | Esc |
| Physics overlay | ⓘ button | `` ` `` (backtick) |
| Sound effects on / off | Speaker button | M |

With the physics overlay on, alt-clicking drops the ninja at that spot.

### Sound

There are sound effects but no music. They're synthesised as they play with
the Web Audio API (`src/game/sound.ts`), so there are no sound files:
footsteps, jumps and wall jumps, landings and wall hits (louder the harder
they are), a hiss while sliding down a wall or skidding, gold (in a row, each
piece within 2 s of the last, about a full jump, it climbs a scale, with a
sparkle on top and a flourish every fifth piece), toggle gold waking, the key, launch
pads, toggle mines arming, the exit, and each way to die (a mine, a hard
landing, the clock). `Game.playSounds()` in `src/game/game.ts` works out
which to play by comparing the ninja and the objects before and after each
frame. Browsers only start audio after a tap or key press, so the game is
silent until the first one. The speaker button (or M) turns the sound off,
and the choice is remembered. On an iPhone, the ring/silent switch also
silences web audio.

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

`tests/golden.test.ts` replays about 170,000 frames of scripted and random input
through both simulators. Our ninja must match **bit for bit on every frame**
(position, speed and state). The traces cover running, jump buffering, wall
slides, both kinds of wall jump, slope jumps, every tile type and impact deaths.
Gold must be collected, mines must arm and go off, and the key and door must
open and be reached, on exactly the same frames. Some runs fill the level with
gold on every point of N++'s 6 px entity grid, and others place mines, keys
and doors where the ninja passes just inside or just outside touching
distance, to test the boundaries. Others check the order N++ tests entities
in, which decides what happens when the ninja touches the door and a mine (or
gold) on the same frame. Launch pads face all 8 ways and are met from every
side, with jumps timed on and around the frames they throw. One-way platforms
face all 4 ways, met from the front, from behind and at their ends; single
ones are placed wherever they change the ninja's path in the reference, and
others fill levels at random, some among launch pads.

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

Every level is in `src/level/levels.json`. The campaigns on the menu are in
`src/level/campaigns.json`: each has a name, a description, the `"time"` its
clock starts with, and its levels by name, in order. Add a campaign there and
it appears under Play and High scores. A level's own `"time"` is used when
it's played on its own, with `?level=<name>` (for example `?level=minefield`).
To start a campaign over, open the menu and play it again.

A level's `"rows"` hold only its terrain, as an ASCII grid with one character
per tile; the tile legend is in `src/level/level.ts`. Everything else is placed
by coordinates, in N++'s 6 px entity units: 4 per tile, counted from the outer
edge of the border, so a tile's centre is at `4n + 2` and its edges at
multiples of 4.

```json
"spawn": [6, 130],
"facing": "left",
"key": [26, 110],
"door": [46, 18],
"gold": [[18, 14], [34, 26]],
"mines": [[40, 92]],
"toggleMines": [[52, 92]],
"toggleGold": [[30, 60]],
"launchPads": [[24, 120, 6]],
"oneWays": [[30, 100, 6], [34, 100, 6]]
```

`"spawn"` is where the ninja starts; it faces (and sets off) right, or left with
`"facing": "left"`. A level has both a `"key"` and a `"door"`, or neither. Each
launch pad is `[x, y, direction]`, with N++'s directions: 0 right, 1
down-right, 2 down, 3 down-left, 4 left, 5 up-left, 6 up, 7 up-right. A
one-way platform is `[x, y, direction]` too, facing 0, 2, 4 or 6.
`"time"` gives the level a clock, in seconds.

Levels used to mark the spawn, gold, mines, key and door in their rows (`N`,
`<`, `$`, `*`, `%`, `K`, `D`). `upgradeLevel()` in `src/level/level.ts`
converts those, so older editor drafts, playtests and pasted levels still load.

`G` is a **greased block**, the one tile that isn't in N: solid like `#`, but
its sides have no grip. The ninja still clings to a greased wall and can jump
off it, but instead of slowing down it slides down as fast as it would fall,
speeding up, so a long greased wall can end in a fatal landing. Its top and
bottom are ordinary. In the game its slippery sides glow orange instead of
cyan, with drips down the block.

Entities work as in N++ (all but launch pads leave movement alone):

- **Gold** is a circle of radius 6, collected when it overlaps the ninja's
  circle (radius 10) during the collision step.
- **Mines** (radius 4) kill the ninja on contact.
- **Toggle mines** start safe (radius 3.5). Touching one starts arming it
  (radius 4.5), and it becomes a live mine once the ninja moves off it, so
  coming back the same way is deadly.
- **Toggle gold** isn't in N++: it's a toggle mine that's good for you. It
  starts dormant (a faint dashed square) and can't be collected. Touching it
  wakes it, and once the ninja moves off it, it's ordinary gold, collected
  the next time through. (If the ninja dies on it, it goes back to dormant.)
  It counts towards the level's gold, at 2 s like any other.
- **The key** (N++'s exit switch, radius 6) opens **the exit door** (radius
  12). The door can be entered from the frame after the key is collected;
  touching it completes the level and the ninja celebrates, no longer
  responding to input.
- **Launch pads** (radius 6) throw the ninja the way they point, at 3.4 px a
  frame, or 6.9 px a frame for a pad pointing straight up; upward ones throw
  harder. Jumping within 3 frames of the throw adds a little more. In N++ a pad
  is always fixed to a wall, floor or ceiling; here it can also float in
  mid-air. The physics is N++'s, which already works from behind and from the
  sides (N++ just never lets the ninja get there), so a floating pad works
  whichever way the ninja comes at it. From in front it fires only once the
  ninja is within 10 px of it, which is when it lands on a floor pad. When a
  pad throws the ninja sideways, the auto-run follows it.
- **One-way platforms** are solid only from the side they face: a surface a
  tile (24 px) across, centred on its point, facing up (6), down (2), left (4)
  or right (0), as in N++. Facing up, the ninja jumps up through it and lands
  on it; facing down, it drops through and bumps its head from below; facing
  sideways, it's a wall from the front (to slide down and jump off) and nothing
  from behind. Place them on tile edges (multiples of 4) to line them up with
  the terrain, and side by side, 4 apart, for a longer one. In the game they're
  a neon line like the terrain's edges, with chevrons behind pointing the way
  through. Like launch pads they're checked frame for frame against nclone.

The clock isn't part of N++'s physics: N has one, but nclone doesn't model it.
Here it starts with the first tap, counts down one frame per tick, stops when
the level is complete, gains two seconds per piece of gold, and kills the
ninja when it reaches zero.

### Level editor

The game's site has a level editor at `/editor/` (for example
`https://<user>.github.io/<repo>/editor/`, or `http://localhost:5173/editor/`
with `npm run dev`). Paint terrain on the grid: drag to paint, right-click to
erase, and Shift-drag to fill a rectangle. Objects (the ninja's start, facing
either way, gold, toggle gold, mines, toggle mines, the key and door, launch pads
pointing any of 8 ways, and one-way platforms facing any of 4) go on any point of the 6 px entity grid: on a tile's
edge (a floor, wall or ceiling), in its middle, or anywhere between. A faint
copy shows where the next one will go. A point holds one object, so placing
on one replaces it (or turns a launch pad), and there's only one start, key
and door, so placing those moves them. Right-click with an object tool, or
drag the **Remove objects** tool over them, to take objects away; painting
terrain leaves objects where they are. Ctrl+Z undoes.

The mild and steep slopes take two tiles per ramp; the first four buttons in
each of those groups place a whole ramp (both tiles) in one click, by its
top-left tile. Dragging or Shift-dragging with one repeats it edge to edge.
To copy part of a level, pick **Select**, drag a rectangle, then **Copy**
(Ctrl+C), **Cut** (Ctrl+X) or **Clear** (Delete). The copy holds the terrain
and the objects in the rectangle, including those on its edges (a mine on a
floor at the bottom, say). **Paste** (Ctrl+V) shows the copy under the
pointer; click to place it by its top-left corner, and Esc to stop. A paste
replaces everything under it, empty tiles and objects too, except the
level's start, key and door: there's only one of each, so they stay unless
the copy has its own, which moves them. **Flip ↔** and **Flip ↕** mirror the
copy: tiles, objects, launch pad directions and the way the start faces, so
a piece copied from one side of a cloud fits the other. The copy stays while
you load other levels, so you can move pieces between them. You
can resize the level at any edge, set a time limit, and load any level in the
game to start from. **Playtest** opens the level in the game, with a pencil
button to come back. The draft is kept in your browser.

The **Export** box holds the level as an entry for `src/level/levels.json`:
copy it into that file's list (replacing the entry with the same name, if you
edited an existing level) and add its name to a campaign in
`src/level/campaigns.json`, or play it on its own with `?level=<name>`. Editing logic is in `src/editor/levelEdit.ts`.

### Checking that a level can be beaten

`tools/solver/` is a search bot that plays with the one-button controls and
looks for a sequence of presses that collects the key and reaches the exit
(or, for a level without one, climbs to a given row):

```sh
npx vite-node tools/solver/solve.ts "First Steps"   # [level] [beam width] [goal row]
```

It steers towards the key, then the door, by the length of the path to them
through open tiles.

The tests don't use the shipped levels (beyond checking that the game can
load them and the campaigns), so levels can change without touching them.
They have their own, in `tests/fixtures/levels.json` (an earlier version of
the campaign): `tests/campaign.test.ts` replays a solver route through each,
with the level's own clock, and then all five on one clock. The routes are
frame-exact, so a change to the physics or the controls can break them; then
re-solve the level (copy it into `levels.json` to use `solve.ts`) and paste the
new route into the test.

## Layout

```
src/physics/   deterministic simulation: tiles -> segments, collision, ninja state machine
src/level/     ASCII level format (legend in level.ts), levels.json and campaigns.json
src/editor/    level editor (editor/index.html)
src/game/      game loop (fixed 60 Hz), main menu, campaign run and best times, one-button
               auto-runner, input, camera and renderer (neon style), parallax
               city backdrop, animation, death debris
tools/golden/  reference-trace generator (needs an nclone checkout)
tools/solver/  search bot that proves levels can be beaten with one button
tests/         golden physics tests; level, campaign, editor, auto-runner and debris tests
```

The physics has no dependencies on the browser, rendering or wall-clock time.
It advances exactly one frame per `Simulator.tick(horizontalInput, jumpHeld)`,
which keeps replays and tests deterministic.

## Not done yet

- Entities: drones, thwumps, bounce blocks, one-way platforms, other doors
- Ragdoll death (the current one is a cosmetic stand-in)
- Real ninja animation data (current poses are procedural)
