"""Generate golden physics traces from nclone, the reference N++ simulator.

nclone (https://github.com/SimonV42/nclone) is the community's reverse-engineered
N++ physics, used to validate real N++ replays. This script runs scripted and
pseudo-random inputs through it and records, for every frame, a hash of the
ninja's exact state (position, speed, state), plus the frames on which gold is
collected and on which mines change state. tests/golden.test.ts replays the same inputs through our engine and
requires bit-identical results.

One adjustment is made to nclone when loading it: `x**2` is evaluated as `x*x`.
Python's `**` goes through the C library's pow(), which on glibc differs from
x*x in the last bit for roughly 1 in 1000 inputs, so nclone's own output varies
by platform. N++ is C++ and squares by multiplying, as does our engine.

Usage:
    git clone https://github.com/SimonV42/nclone /path/to/nclone
    python3 -I tools/golden/gen_golden.py /path/to/nclone tests/fixtures/golden.json
"""
import ast
import json
import math
import os
import struct
import sys
import types

# Must match TILE_LEGEND in src/level/level.ts.
TILE_LEGEND = '.#TRBLyz/\\uvwxUVWXabcdefghijklmnop'

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
with open(os.path.join(REPO, 'src', 'level', 'levels.json')) as _f:
    PLAYGROUND = json.load(_f)[0]['rows']

# Every tile type, scattered over low terrain so random inputs bump into all of them.
TILE_ZOO = [
    '..........................................',
    '..........................................',
    '..........................................',
    '...yz....ab....ef....ij....mn....UV.......',
    '...##....##....##....##....##....##.......',
    '..........................................',
    '..........................................',
    '..uv....TT....RL....BB....LR....uv...uv...',
    '..xw....................................xw',
    '..........................................',
    '..........................................',
    '.....#...........................#........',
    '.....#...........................#........',
    '.....#....T....R....L....B.......#........',
    '.....#...........................#........',
    '.....#...........................#........',
    '#....#...........................#.......#',
    'X....#...........................#.......W',
    '#...............................#.........',
    '#..........cg##hd.....k...l.......x.....w#',
    '#.........cg####hd....o##.p.......#.....##',
    '#.N../##\\.##########..####\\##.../#......##',
    '##########################################',
]

FLAT = [
    '..........................................' for _ in range(21)
] + ['....N.....................................', '##########################################']


def with_spawn(rows, x, y):
    rows = [r.replace('N', '.') for r in rows]
    assert rows[y][x] in '.$*%', (x, y, rows[y][x])
    rows[y] = rows[y][:x] + 'N' + rows[y][x + 1:]
    return rows


def gold_field():
    """Gold on every point of N++'s 6px entity grid inside the border (must match golden.test.ts)."""
    return [(x, y) for y in range(4, 97) for x in range(4, 173)]


# Entity type ids in N++ map data, by level character.
ENTITY_TYPES = {'$': 2, '*': 1, '%': 21}  # gold, mine, toggle mine


def to_map_data(rows, extra_gold=(), mines=(), toggle_mines=()):
    """Build an N++ map data array (tiles, ninja spawn, gold, mines) from an ASCII level.

    Extra entities are (x, y) in 6px units. Entities of one type are loaded (and
    so updated) in this order: those in the rows, then the extra ones.
    """
    assert len(rows) == 23 and all(len(r) == 42 for r in rows)
    data = [0] * 1235
    sx = sy = None
    entities = {t: [] for t in ENTITY_TYPES.values()}
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == 'N':
                sx, sy = x, y
                tile = 0
            elif ch in ENTITY_TYPES:
                entities[ENTITY_TYPES[ch]].append(((x + 1) * 4 + 2, (y + 1) * 4 + 2))
                tile = 0
            else:
                tile = TILE_LEGEND.index(ch)
            data[184 + x + y * 42] = tile
    # Entity coordinates are in 6px units; we spawn in the centre of the marked tile.
    data[1230] = 0
    data[1231] = (sx + 1) * 4 + 2
    data[1232] = (sy + 1) * 4 + 2
    entities[2] += extra_gold
    entities[1] += mines
    entities[21] += toggle_mines
    for t, coords in entities.items():
        for ex, ey in coords:
            data += [t, ex, ey, 0, 0]
    return data


def random_mines(seed, rows, count):
    """Scatter mines over empty tiles, at random points of the 6px grid."""
    rng = Lcg(seed)
    out = []
    while len(out) < count:
        x, y = int(rng.next() * 168) + 4, int(rng.next() * 92) + 4
        if rows[y // 4 - 1][x // 4 - 1] in '.$':
            out.append((x, y))
    return out


class Lcg:
    def __init__(self, seed):
        self.state = seed

    def next(self):
        self.state = (self.state * 1103515245 + 12345) % 2**31
        return self.state / 2**31


def random_inputs(seed, frames, right_bias=0.0):
    """Hold random input combinations for random durations; includes short jump taps."""
    rng = Lcg(seed)
    out = []
    while len(out) < frames:
        r = rng.next()
        hor = -1 if r < 0.33 - right_bias else (0 if r < 0.5 else 1)
        jump = rng.next() < 0.45
        dur = 1 + int(rng.next() ** 2 * 50)
        out += [(hor, jump)] * dur
    return out[:frames]


def scripted(*segments):
    out = []
    for frames, hor, jump in segments:
        out += [(hor, jump)] * frames
    return out


def encode_inputs(inputs):
    # nclone's raw input encoding: bit 0 = jump, 2 = right, 4/5 = left.
    return ''.join(str((4 if h < 0 else 2 if h > 0 else 0) | int(j)) for h, j in inputs)


def state_hash(n):
    """FNV-1a (32 bit) over the little-endian bytes of five doubles."""
    h = 0x811C9DC5
    for b in struct.pack('<5d', n.xpos, n.ypos, n.xspeed, n.yspeed, float(n.state)):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return '%08x' % h


def graze_mines(Simulator, rows, inputs):
    """Grid points sorted by how close the ninja passes, from a mine-free run.

    Returns {(x, y): (closest distance, first frame within 15px)} in 6px units,
    for points the ninja passes within 15px of.
    """
    sim = Simulator()
    sim.load(to_map_data(rows))
    # Entities touch the ninja where it is before think(), which can move it (jumps).
    n = sim.ninja
    seen = []
    think = n.think
    n.think = lambda: (seen.append((n.xpos, n.ypos)), think())
    near = {}
    for hor, jump in inputs:
        sim.tick(hor, int(jump))
        if n.state >= 6:
            break
        nx, ny = seen[-1]
        gx, gy = nx / 6, ny / 6
        for x in range(int(gx) - 3, int(gx) + 4):
            for y in range(int(gy) - 3, int(gy) + 4):
                d = math.sqrt((x * 6 - nx) ** 2 + (y * 6 - ny) ** 2)
                if d < 15 and (x, y) not in near or d < near.get((x, y), (99,))[0]:
                    near[(x, y)] = (d, near.get((x, y), (0, sim.frame))[1])
    return near


def run(Simulator, rows, inputs, extra_gold=(), mines=(), toggle_mines=()):
    sim = Simulator()
    sim.load(to_map_data(rows, extra_gold, mines, toggle_mines))
    all_mines = sim.entity_dic[1] + sim.entity_dic[21]
    mine_states = [m.state for m in all_mines]
    hashes = []
    checkpoints = []
    gold = []  # [frame, total collected] whenever the total changes
    mine_log = []  # [frame, mine index, new state] for every mine state change
    for hor, jump in inputs:
        sim.tick(hor, int(jump))
        n = sim.ninja
        hashes.append(state_hash(n))
        if sim.gold_collected != (gold[-1][1] if gold else 0):
            gold.append([sim.frame, sim.gold_collected])
        for i, m in enumerate(all_mines):
            if m.state != mine_states[i]:
                mine_states[i] = m.state
                mine_log.append([sim.frame, i, m.state])
        if sim.frame % 30 == 0 or n.state == 6:
            checkpoints.append([sim.frame, n.xpos, n.ypos, n.xspeed, n.yspeed, n.state])
        if n.state == 6:
            break
    return hashes, checkpoints, gold, mine_log


class SquareAsMultiply(ast.NodeTransformer):
    """Rewrite `expr ** 2` as `expr * expr` (all such expressions in nsim are side-effect free)."""

    def visit_BinOp(self, node):
        self.generic_visit(node)
        if isinstance(node.op, ast.Pow) and isinstance(node.right, ast.Constant) and node.right.value == 2:
            return ast.copy_location(ast.BinOp(left=node.left, op=ast.Mult(), right=node.left), node)
        return node


def load_nsim(nclone_dir):
    path = os.path.join(nclone_dir, 'nsim.py')
    with open(path) as f:
        tree = ast.parse(f.read(), path)
    tree = ast.fix_missing_locations(SquareAsMultiply().visit(tree))
    module = types.ModuleType('nsim')
    module.__file__ = path
    sys.argv = ['nsim']  # nsim parses argv at import time
    exec(compile(tree, path, 'exec'), module.__dict__)
    return module


def main():
    nclone_dir, out_path = sys.argv[1], sys.argv[2]
    Simulator = load_nsim(nclone_dir).Simulator

    scenarios = [
        ('flat: idle', FLAT, scripted((120, 0, False))),
        ('flat: run right then release', FLAT, scripted((150, 1, False), (90, 0, False))),
        ('flat: run then reverse (skid)', FLAT, scripted((100, 1, False), (80, -1, False), (40, 0, False))),
        ('flat: tap jump', FLAT, scripted((10, 0, False), (1, 0, True), (90, 0, False))),
        ('flat: full jump', FLAT, scripted((10, 0, False), (80, 0, True), (40, 0, False))),
        ('flat: jump held through landing', FLAT, scripted((10, 0, False), (200, 0, True), (20, 0, False))),
        ('flat: running jumps', FLAT, scripted((60, 1, False), (30, 1, True), (5, 1, False), (40, 1, True), (60, 0, False))),
        ('flat: jump buffer before landing', FLAT,
         scripted((10, 0, False), (30, 1, True), (52, 1, False), (1, 1, True), (2, 1, False), (40, 0, False))),
        ('playground: run right', PLAYGROUND, scripted((600, 1, False))),
        ('playground: run right hopping', PLAYGROUND, scripted(*[(25, 1, False), (20, 1, True)] * 20)),
        ('playground: run left from shaft', with_spawn(PLAYGROUND, 20, 21), scripted((300, -1, False))),
        ('playground: wall slide', with_spawn(PLAYGROUND, 20, 16), scripted((200, 1, False))),
        ('playground: shaft wall jumps', with_spawn(PLAYGROUND, 20, 21),
         scripted((20, 1, False), (8, 1, True), *[(14, -1, False), (10, -1, True), (14, 1, False), (10, 1, True)] * 10,
                  (60, 0, False))),
        ('playground: wall slide jumps (holding into wall)', with_spawn(PLAYGROUND, 21, 16),
         scripted((30, 1, False), *[(3, 1, True), (12, 1, False)] * 12, (60, 1, False))),
        ('playground: quarter pipe', with_spawn(PLAYGROUND, 26, 21), scripted((400, 1, False))),
        ('playground: fall death', with_spawn(PLAYGROUND, 1, 0), scripted((300, 0, False))),
        ('playground: fall onto 45 degree slope', with_spawn(PLAYGROUND, 3, 0), scripted((300, 0, False))),
        ('playground: fall onto mild slope', with_spawn(PLAYGROUND, 9, 0), scripted((300, 0, False))),
        ('playground: fall onto steep slope', with_spawn(PLAYGROUND, 14, 0), scripted((300, 0, False))),
        ('playground: survivable drop', with_spawn(PLAYGROUND, 27, 10), scripted((200, 0, False))),
    ]
    spawns = [(1, 21), (20, 21), (28, 21), (14, 6), (27, 16), (36, 13)]
    for i, (x, y) in enumerate(spawns):
        scenarios.append((f'playground: random #{i}', with_spawn(PLAYGROUND, x, y),
                          random_inputs(1000 + i, 1800, right_bias=0.05 if x < 20 else 0)))
    zoo_spawns = [(2, 20), (12, 17), (25, 17), (38, 17), (8, 9), (30, 9), (20, 5)]
    for i, (x, y) in enumerate(zoo_spawns):
        scenarios.append((f'tile zoo: random #{i}', with_spawn(TILE_ZOO, x, y), random_inputs(2000 + i, 1800)))
    # Gold everywhere, so the exact overlap boundary gets exercised thousands of times.
    for i, (x, y) in enumerate([(1, 21), (20, 21), (28, 21)]):
        scenarios.append((f'gold field: playground random #{i}', with_spawn(PLAYGROUND, x, y),
                          random_inputs(3000 + i, 1800), True))
    for i, (x, y) in enumerate([(2, 20), (25, 17)]):
        scenarios.append((f'gold field: tile zoo random #{i}', with_spawn(TILE_ZOO, x, y),
                          random_inputs(4000 + i, 1800), True))
    # Mines: mostly toggle mines (which get armed as the ninja passes), so runs
    # last a while before a mine kills the ninja.
    for i, (x, y) in enumerate([(1, 21), (20, 21), (28, 21), (14, 6), (27, 16), (36, 13), (2, 20), (25, 17)]):
        base = PLAYGROUND if i < 6 else TILE_ZOO
        rows = with_spawn(base, x, y)
        sx, sy = (x + 1) * 4 + 2, (y + 1) * 4 + 2
        far = lambda pts: [p for p in pts if abs(p[0] - sx) > 8 or abs(p[1] - sy) > 8]
        mines = far(random_mines(5000 + i, rows, 12))
        toggles = far(random_mines(6000 + i, rows, 60))
        scenarios.append((f'mines: random #{i}', rows, random_inputs(7000 + i, 3600), False, mines, toggles))

    # Mines right at the edge of touching: the ninja's path is known from a run
    # without mines, so mines can be placed where it passes just outside (or
    # inside) touching distance. Radii: ninja 10, mine 4 (armed) / 3.5 (safe).
    for i, (x, y) in enumerate([(1, 21), (20, 21), (28, 21), (14, 6)]):
        rows = with_spawn(PLAYGROUND, x, y)
        inputs = random_inputs(8000 + i, 1800, right_bias=0.05)
        near = graze_mines(Simulator, rows, inputs)
        misses = sorted(p for p, (d, _) in near.items() if 14 <= d < 14.6)
        toggles = sorted(p for p, (d, _) in near.items() if 12.8 <= d < 14.2 and p not in misses)
        scenarios.append((f'mines: near misses #{i}', rows, inputs, False, misses, []))
        scenarios.append((f'mines: toggle mines on the edge #{i}', rows, inputs, False, [], toggles))
        # The two mines the ninja only just touches.
        hits = sorted((p for p, (d, _) in near.items() if d < 14), key=lambda p: -near[p][0])
        for j, p in enumerate(hits[:2]):
            scenarios.append((f'mines: graze #{i}.{j} (distance {near[p][0]:.5f})', rows, inputs, False, [p], []))

    fixture = {
        'source': 'nclone @ 842190b2a216579b5b5c551e0a0b4505fc3381cc',
        'tables': {
            'ortho': {str(k): v for k, v in Simulator.TILE_SEGMENT_ORTHO_MAP.items() if k < 34},
            'diag': {str(k): v for k, v in Simulator.TILE_SEGMENT_DIAG_MAP.items()},
            'circular': {str(k): v for k, v in Simulator.TILE_SEGMENT_CIRCULAR_MAP.items()},
        },
        'scenarios': [],
    }
    for name, rows, inputs, *extra in scenarios:
        field = bool(extra and extra[0])
        mines, toggles = (extra[1], extra[2]) if len(extra) > 1 else ([], [])
        hashes, checkpoints, gold, mine_log = run(Simulator, rows, inputs, gold_field() if field else (), mines, toggles)
        fixture['scenarios'].append({
            'name': name,
            'rows': rows,
            'goldField': field,
            'mines': [list(m) for m in mines],
            'toggleMines': [list(m) for m in toggles],
            'inputs': encode_inputs(inputs[:len(hashes)]),
            'hashes': ''.join(hashes),
            'checkpoints': checkpoints,
            'gold': gold,
            'mineLog': mine_log,
        })
        print(f'{name}: {len(hashes)} frames, final state {checkpoints[-1][5]}, gold {gold[-1][1] if gold else 0}, '
              f'mine changes {len(mine_log)}')

    with open(out_path, 'w') as f:
        json.dump(fixture, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
