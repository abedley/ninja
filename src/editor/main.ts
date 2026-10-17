import { TILE_POLYS } from '../game/tileShapes';
import { DEFAULT_LEVEL_TIME, TILE_LEGEND, type Coord, type LevelDef } from '../level/level';
import { LEVELS } from '../level/levels';
import { PLAYTEST_PARAM, savePlaytest } from '../level/playtest';
import { CircularSegment, LinearSegment } from '../physics/geometry';
import { GREASED_TILE, TILE_SIZE } from '../physics/tileDefs';
import { TileMap } from '../physics/tileMap';
import { LAUNCH_PAD_DIRECTIONS } from '../physics/launchPad';
import {
  blankLevel,
  check,
  clearRect,
  copyClip,
  exportText,
  fillStamp,
  flipClip,
  importText,
  insideLevel,
  placeObject,
  objectPlacements,
  pasteClip,
  placeStamp,
  rectCells,
  removeObjects,
  resize,
  size,
  stampCorner,
  shiftObjects,
  stampWidth,
  type Clip,
  type Edge,
  type Objects,
  type Placement,
  type Stamp,
} from './levelEdit';

/**
 * The level editor (served at /editor/). Paint terrain tiles on the grid and
 * place objects anywhere on N++'s 6 px entity grid (rectangles can
 * be copied and pasted, flipped if need be), then copy the exported
 * text into src/level/levels.json. The draft is kept in this browser's
 * storage, and Playtest opens it in the game.
 */

const DRAFT_KEY = 'ninja.editor.draft';
const COLORS = {
  bg: '#0d0b22',
  border: '#1c1840',
  tile: '#2a2563',
  edge: '#25d4ff',
  grease: '#ff8a2a',
  greaseFill: '#3a2140',
  grid: 'rgba(255, 255, 255, 0.07)',
  gridMajor: 'rgba(255, 255, 255, 0.14)',
  gold: '#ffd23f',
  mine: '#ff2d55',
  key: '#9dff4a',
  door: '#8a5cff',
  pad: '#c86bff',
  padLight: '#f1dcff',
  ninja: '#ff2bd6',
  hover: '#ffffff',
};

interface Tool {
  label: string;
  /** For a terrain tool: the block of tiles it paints (one tile, a two-tile ramp, or what was copied), by its top-left corner. */
  stamp?: Stamp;
  /** The select tool: drag out a rectangle of terrain to copy, cut or clear. */
  select?: true;
  /** The paste tool: what it places (terrain and objects); its stamp is the terrain, for the preview. */
  clip?: Clip;
  /** A fixed palette button id (the paste tool's stamp changes). */
  id?: string;
  /** For an object tool: what it places on a point of the 6 px grid (null: it removes objects instead). */
  object?: Placement | null;
  /** How its palette button is drawn: a tile or object character, as drawCell() draws them. */
  icon: string;
}

/** A tool's id, for its palette button. */
const toolId = (t: Tool) =>
  t.id ??
  (t.object === undefined ? t.stamp!.join('|') : t.object === null ? 'erase-objects' : [t.object.kind, t.object.facing ?? '', t.object.orientation ?? ''].join('-'));

const tile = (ch: string, label: string): Tool => ({ stamp: [ch], label, icon: ch });
/** A whole two-tile ramp, in one go. */
const ramp = (stamp: Stamp, label: string): Tool => ({ stamp, label, icon: '' });
const SELECT_TOOL: Tool = { select: true, id: 'select', label: 'Select (drag a rectangle), then copy, cut or clear its terrain and objects', icon: 'select' };
/** The paste tool places what was copied; it's made when there's something to paste. */
const pasteTool = (clip: Clip): Tool => ({ stamp: clip.rows, clip, id: 'paste', label: `Paste ${clipSize(clip)} (click to place; Esc to stop)`, icon: '' });
const NOTHING_COPIED: Clip = { rows: [], objects: {} };
/** A clip's size, and how many objects it holds. */
function clipSize(clip: Clip): string {
  const n = objectPlacements(clip.objects).length;
  return `${stampWidth(clip.rows)} × ${clip.rows.length}${n ? ` with ${n} object${n === 1 ? '' : 's'}` : ''}`;
}
const object = (icon: string, label: string, what: Placement): Tool => ({ object: what, label, icon });

/** N++'s launch pad orientations, clockwise from up. */
const PAD_TOOLS: [number, string][] = [
  [6, 'up'],
  [7, 'up and right'],
  [0, 'right'],
  [1, 'down and right'],
  [2, 'down'],
  [3, 'down and left'],
  [4, 'left'],
  [5, 'up and left'],
];

const TOOL_GROUPS: { title: string; tools: Tool[] }[] = [
  {
    title: 'Objects (anywhere on the 6 px grid)',
    tools: [
      object('N', 'Ninja start, facing right', { kind: 'spawn' }),
      object('<', 'Ninja start, facing left', { kind: 'spawn', facing: 'left' }),
      object('$', 'Gold (+2 s)', { kind: 'gold' }),
      object('*', 'Mine', { kind: 'mines' }),
      object('%', 'Toggle mine (safe until touched)', { kind: 'toggleMines' }),
      object('&', 'Toggle gold (collected on the second pass: touch it, move off, come back)', { kind: 'toggleGold' }),
      object('K', 'Key (opens the door)', { kind: 'key' }),
      object('D', 'Exit door', { kind: 'door' }),
      { object: null, label: 'Remove objects (drag over them)', icon: 'erase-objects' },
    ],
  },
  {
    title: 'Launch pads',
    tools: PAD_TOOLS.map(([orientation, way]) => object('', `Launch pad, throwing ${way}`, { kind: 'launchPads', orientation })),
  },
  {
    title: 'One-way platforms',
    tools: (
      [
        [6, 'solid on top: jump up through it, land on it'],
        [2, 'solid underneath: drop through it, bump your head on it'],
        [4, 'a wall on its left side, passed through from the right'],
        [0, 'a wall on its right side, passed through from the left'],
      ] as const
    ).map(([orientation, how]) => object('', `One-way platform, ${how}`, { kind: 'oneWays', orientation })),
  },
  {
    title: 'Copy and paste',
    tools: [SELECT_TOOL, { ...pasteTool(NOTHING_COPIED), icon: 'paste', label: 'Paste (copy something first)' }],
  },
  {
    title: 'Blocks',
    tools: [
      tile('.', 'Eraser (empty tile)'),
      tile('#', 'Solid block'),
      tile('G', 'Greased block (the ninja slides down its sides, speeding up)'),
      tile('T', 'Half block, top'),
      tile('B', 'Half block, bottom'),
      tile('L', 'Half block, left'),
      tile('R', 'Half block, right'),
    ],
  },
  {
    title: '45° slopes',
    tools: [
      tile('/', 'Floor rising right'),
      tile('\\', 'Floor falling right'),
      tile('y', 'Ceiling, solid top-left'),
      tile('z', 'Ceiling, solid top-right'),
    ],
  },
  {
    title: 'Curves',
    tools: [
      tile('U', 'Quarter pipe, facing down-right'),
      tile('V', 'Quarter pipe, facing down-left'),
      tile('W', 'Quarter pipe, facing up-left'),
      tile('X', 'Quarter pipe, facing up-right'),
      tile('u', 'Rounded corner, top-left'),
      tile('v', 'Rounded corner, top-right'),
      tile('w', 'Rounded corner, bottom-right'),
      tile('x', 'Rounded corner, bottom-left'),
    ],
  },
  {
    title: 'Mild slopes (two tiles per ramp)',
    tools: [
      ramp(['cg'], 'Ramp rising right, both tiles'),
      ramp(['hd'], 'Ramp falling right, both tiles'),
      ramp(['ea'], 'Ceiling ramp, solid top-left, both tiles'),
      ramp(['bf'], 'Ceiling ramp, solid top-right, both tiles'),
      tile('c', 'Floor rising right, lower half (put g after it)'),
      tile('g', 'Floor rising right, upper half'),
      tile('h', 'Floor falling right, upper half (put d after it)'),
      tile('d', 'Floor falling right, lower half'),
      tile('a', 'Ceiling, short (solid top-left)'),
      tile('b', 'Ceiling, short (solid top-right)'),
      tile('e', 'Ceiling, raised (solid top-left)'),
      tile('f', 'Ceiling, raised (solid top-right)'),
    ],
  },
  {
    title: 'Steep slopes (two tiles per ramp)',
    tools: [
      ramp(['k', 'o'], 'Ramp rising right, both tiles'),
      ramp(['l', 'p'], 'Ramp falling right, both tiles'),
      ramp(['m', 'i'], 'Ceiling ramp, solid top-left, both tiles'),
      ramp(['n', 'j'], 'Ceiling ramp, solid top-right, both tiles'),
      tile('k', 'Floor rising right, top (put o below it)'),
      tile('o', 'Floor rising right, bottom'),
      tile('l', 'Floor falling right, top (put p below it)'),
      tile('p', 'Floor falling right, bottom'),
      tile('i', 'Ceiling, short (solid top-left)'),
      tile('j', 'Ceiling, short (solid top-right)'),
      tile('m', 'Ceiling, raised (solid top-left)'),
      tile('n', 'Ceiling, raised (solid top-right)'),
    ],
  },
];
const ALL_TOOLS = TOOL_GROUPS.flatMap((g) => g.tools);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('grid');
const ctx = canvas.getContext('2d')!;
const scroller = $('scroller');
const fName = $<HTMLInputElement>('f-name');
const fDescription = $<HTMLTextAreaElement>('f-description');
const fTimed = $<HTMLInputElement>('f-timed');
const fTime = $<HTMLInputElement>('f-time');
const exportBox = $<HTMLTextAreaElement>('export');
const importBox = $<HTMLTextAreaElement>('import');
const loadSelect = $<HTMLSelectElement>('load-select');

let def: LevelDef = loadDraft() ?? blankLevel();
let tool: Tool = ALL_TOOLS.find((t) => t.stamp?.[0] === '#')!;
let zoom = 28;
const undoStack: LevelDef[] = [];
const redoStack: LevelDef[] = [];
/** Where the tool would act: the tile under the pointer, or for an object tool the nearest point of the 6 px grid. */
let hover: [number, number] | null = null;
/**
 * The stroke in progress: the tool, whether it erases (right button), where
 * it started (stamps dragged along line up with the first), its last position
 * and (shift-drag, terrain only) the rectangle's first corner. Positions are in
 * tiles, or in entity units for an object tool.
 */
let stroke: { tool: Tool; erase: boolean; origin: [number, number]; last: [number, number]; rectFrom: [number, number] | null; before: LevelDef } | null = null;
/** The select tool's rectangle (two corners, in tiles), and what was last copied. */
let selection: { from: [number, number]; to: [number, number] } | null = null;
let clipboard: Clip = NOTHING_COPIED;

// ---------------------------------------------------------------- state

function commit(next: LevelDef, before: LevelDef = def): void {
  if (next === before) return;
  undoStack.push(before);
  if (undoStack.length > 300) undoStack.shift();
  redoStack.length = 0;
  def = next;
  changed();
}

function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(def);
  def = prev;
  changed();
}

function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(def);
  def = next;
  changed();
}

let saveTimer = 0;
function changed(fields = true): void {
  if (fields) syncFields();
  syncPanel();
  draw();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(def));
    } catch {
      /* storage unavailable: the draft just isn't kept */
    }
  }, 300);
}

function loadDraft(): LevelDef | null {
  try {
    const text = localStorage.getItem(DRAFT_KEY);
    if (!text) return null;
    const d = importText(text);
    return typeof d === 'string' ? null : d;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- panel

function syncFields(): void {
  fName.value = def.name;
  fDescription.value = def.description ?? '';
  fTimed.checked = def.time !== undefined;
  fTime.disabled = def.time === undefined;
  fTime.value = String(def.time ?? DEFAULT_LEVEL_TIME);
}

function syncPanel(): void {
  const { width, height } = size(def);
  $('size-label').textContent = `${width} × ${height}`;
  exportBox.value = exportText(def);
  $('export-name').textContent = encodeURIComponent(def.name.toLowerCase());
  const { errors, warnings } = check(def);
  const list = $('checks');
  list.replaceChildren(
    ...errors.map((m) => item(m, 'error')),
    ...warnings.map((m) => item(m, 'warning')),
    ...(errors.length || warnings.length ? [] : [item('Ready to play.', 'ok')]),
  );
  const play = $<HTMLButtonElement>('btn-play');
  play.disabled = errors.length > 0;
  play.title = errors.length ? errors[0] : 'Play this level in the game';
  $<HTMLButtonElement>('btn-undo').disabled = !undoStack.length;
  $<HTMLButtonElement>('btn-redo').disabled = !redoStack.length;
  const existing = LEVELS.find((l) => l.name.toLowerCase() === def.name.trim().toLowerCase());
  $('copy-status').textContent = existing ? `Replaces the level “${existing.name}”.` : 'A new level.';
}

function item(text: string, kind: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = kind;
  li.textContent = text;
  return li;
}

// Text fields edit the level directly; each finished edit (on change) is one undo step.
let fieldBefore: LevelDef | null = null;
for (const el of [fName, fDescription, fTime]) {
  el.addEventListener('focus', () => (fieldBefore = def));
  el.addEventListener('input', () => {
    def = { ...def, name: fName.value, description: fDescription.value, ...(fTimed.checked ? { time: Math.max(1, Number(fTime.value) || DEFAULT_LEVEL_TIME) } : {}) };
    if (!fTimed.checked) delete def.time;
    changed(false);
  });
  el.addEventListener('change', () => {
    if (fieldBefore && fieldBefore !== def) commit(def, fieldBefore);
    fieldBefore = def;
  });
}
fTimed.addEventListener('change', () => {
  const next: LevelDef = { ...def };
  if (fTimed.checked) next.time = Math.max(1, Number(fTime.value) || DEFAULT_LEVEL_TIME);
  else delete next.time;
  commit(next);
});

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-edge]')) {
  btn.addEventListener('click', () => commit(resize(def, btn.dataset.edge as Edge, Number(btn.dataset.count))));
}

loadSelect.replaceChildren(
  ...LEVELS.map((l) => {
    const o = document.createElement('option');
    o.value = l.name;
    o.textContent = l.name;
    return o;
  }),
);
$('btn-load').addEventListener('click', () => {
  const level = LEVELS.find((l) => l.name === loadSelect.value);
  if (level) commit(structuredClone(level));
});
$('btn-new').addEventListener('click', () => commit(blankLevel()));
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);

$('btn-copy').addEventListener('click', async () => {
  const status = $('copy-status');
  try {
    await navigator.clipboard.writeText(exportBox.value);
    status.textContent = 'Copied.';
  } catch {
    exportBox.select();
    status.textContent = document.execCommand('copy') ? 'Copied.' : 'Select the text and copy it.';
  }
});

$('btn-import').addEventListener('click', () => {
  const result = importText(importBox.value);
  const status = $('import-status');
  if (typeof result === 'string') {
    status.textContent = result;
    return;
  }
  status.textContent = 'Loaded.';
  commit(result);
});

$('btn-play').addEventListener('click', () => {
  if (!savePlaytest(def)) {
    alert('This browser won’t let the editor store the level, so it can’t hand it to the game.');
    return;
  }
  location.href = `../?level=${PLAYTEST_PARAM}`;
});

window.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  if (typing) return;
  const k = e.key.toLowerCase();
  if (!(e.ctrlKey || e.metaKey)) {
    if ((k === 'delete' || k === 'backspace') && selection) clearSelection();
    else if (k === 'escape' && tool.id === 'paste') selectTool(SELECT_TOOL);
    else if (k === 'escape' && selection) setSelection(null);
    else return;
  } else if (k === 'z' && !e.shiftKey) undo();
  else if (k === 'y' || (k === 'z' && e.shiftKey)) redo();
  // Copying with nothing selected leaves the browser's own copy alone.
  else if (k === 'c' && selection) copySelection();
  else if (k === 'x' && selection) cutSelection();
  else if (k === 'v' && clipboard.rows.length) selectTool(pasteTool(clipboard));
  else return;
  e.preventDefault();
});

// ---------------------------------------------------------------- copy and paste

function selectionRect(): [number, number, number, number] | null {
  return selection ? [...selection.from, ...selection.to] : null;
}

function setSelection(next: typeof selection): void {
  selection = next;
  syncClipboardButtons();
  draw();
}

function copySelection(): void {
  const rect = selectionRect();
  if (!rect) return;
  clipboard = copyClip(def, ...rect);
  syncClipboardButtons();
  $('status-tool').textContent = `Copied ${clipSize(clipboard)}: paste it with Ctrl+V or the Paste tool.`;
}

function clearSelection(): void {
  const rect = selectionRect();
  if (rect) commit(clearRect(def, ...rect));
}

function cutSelection(): void {
  copySelection();
  clearSelection();
}

/** Flip what's copied (the paste tool's preview shows it). */
function flipClipboard(axis: 'horizontal' | 'vertical'): void {
  if (!clipboard.rows.length) return;
  clipboard = flipClip(clipboard, axis);
  selectTool(pasteTool(clipboard));
}

/** The buttons that act on the selection and clipboard, and the paste tool's icon (what's copied). */
function syncClipboardButtons(): void {
  for (const id of ['btn-copy-sel', 'btn-cut-sel', 'btn-clear-sel']) $<HTMLButtonElement>(id).disabled = !selection;
  const copied = clipboard.rows.length > 0;
  for (const id of ['btn-flip-h', 'btn-flip-v']) $<HTMLButtonElement>(id).disabled = !copied;
  const paste = document.querySelector<HTMLButtonElement>('.tool[data-tool="paste"]')!;
  paste.disabled = !copied;
  paste.title = copied ? `Paste the ${clipSize(clipboard)} copied (Ctrl+V)` : 'Paste (copy something first)';
  drawToolIcon(paste.querySelector('canvas')!, copied ? pasteTool(clipboard) : { ...pasteTool(NOTHING_COPIED), icon: 'paste' });
}

// ---------------------------------------------------------------- palette

function buildPalette(): void {
  const palette = $('palette');
  for (const group of TOOL_GROUPS) {
    const section = document.createElement('section');
    const h = document.createElement('h2');
    h.textContent = group.title;
    const grid = document.createElement('div');
    grid.className = 'tools';
    for (const t of group.tools) {
      const btn = document.createElement('button');
      btn.className = 'tool';
      btn.title = t.stamp?.length === 1 && t.stamp[0].length === 1 && !t.id ? `${t.label}  (${t.stamp[0]})` : t.label;
      btn.setAttribute('aria-label', t.label);
      btn.dataset.tool = toolId(t);
      const icon = document.createElement('canvas');
      drawToolIcon(icon, t);
      btn.append(icon);
      // (The paste button always picks up what's copied now.)
      btn.addEventListener('click', () => selectTool(t.id === 'paste' ? pasteTool(clipboard) : t));
      grid.append(btn);
    }
    section.append(h, grid);
    if (group.tools.includes(SELECT_TOOL)) section.append(clipboardActions());
    palette.append(section);
  }
  syncClipboardButtons();
}

/** Buttons under the select and paste tools. */
function clipboardActions(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'clip-actions';
  const button = (id: string, text: string, title: string, action: () => void) => {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', action);
    row.append(b);
  };
  button('btn-copy-sel', 'Copy', 'Copy the selected terrain and objects (Ctrl+C)', copySelection);
  button('btn-cut-sel', 'Cut', 'Copy the selected terrain and objects, and clear them (Ctrl+X)', cutSelection);
  button('btn-clear-sel', 'Clear', 'Clear the selected terrain and objects (Delete)', clearSelection);
  button('btn-flip-h', 'Flip ↔', 'Flip what’s copied left to right', () => flipClipboard('horizontal'));
  button('btn-flip-v', 'Flip ↕', 'Flip what’s copied upside down', () => flipClipboard('vertical'));
  return row;
}

/** A palette button's picture: a tile, an object, a launch pad, or a block of tiles shrunk to fit. */
function drawToolIcon(icon: HTMLCanvasElement, t: Tool): void {
  const px = 32;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  icon.width = icon.height = px * dpr;
  icon.style.width = icon.style.height = `${px}px`;
  const g = icon.getContext('2d')!;
  g.scale(dpr, dpr);
  g.fillStyle = COLORS.bg;
  g.fillRect(0, 0, px, px);
  if (t.object?.kind === 'oneWays') {
    drawOneWay(g, px / 2, px / 2, 26, t.object.orientation!);
  } else if (t.object?.kind === 'launchPads') {
    // Set back a little, so the chevrons fit.
    const o = t.object.orientation!;
    const [dx, dy] = LAUNCH_PAD_DIRECTIONS[o];
    drawPad(g, px / 2 - dx * 4, px / 2 - dy * 4, 32, o);
  } else if (t.icon === '' && t.stamp) {
    const w = stampWidth(t.stamp);
    const h = t.stamp.length;
    const s = Math.min(24, 28 / Math.max(w, h));
    const [x0, y0] = [(px - w * s) / 2, (px - h * s) / 2];
    t.stamp.forEach((row, y) => [...row].forEach((ch, x) => drawCell(g, ch, x0 + x * s, y0 + y * s, s, true, false)));
    g.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    g.strokeRect(x0 - 0.5, y0 - 0.5, w * s + 1, h * s + 1);
  } else {
    drawCell(g, t.icon, 4, 4, 24, true);
  }
}

function selectTool(t: Tool): void {
  tool = t;
  for (const b of document.querySelectorAll<HTMLButtonElement>('.tool')) b.setAttribute('aria-pressed', String(b.dataset.tool === toolId(t)));
  $('status-tool').textContent = t.label;
  // The selection belongs to the select tool: Copy, Cut and Clear act on it only there.
  if (!t.select && selection) setSelection(null);
  else draw();
}

// ---------------------------------------------------------------- drawing

/**
 * Draw one cell's contents (tile or entity) in a square at (x, y) of side s.
 * As an icon, tiles are drawn on their own, and the empty tile as an eraser
 * (unless `eraserMark` is off: then it's just left empty).
 */
function drawCell(g: CanvasRenderingContext2D, ch: string, x: number, y: number, s: number, icon = false, eraserMark = true): void {
  const k = s / TILE_SIZE;
  const id = TILE_LEGEND.indexOf(ch);
  if (id > 0) {
    if (!icon) return; // tiles on the grid are drawn all together (see draw())
    const poly = TILE_POLYS[id];
    g.beginPath();
    g.moveTo(x + poly[0][0] * k, y + poly[0][1] * k);
    for (const [px, py] of poly.slice(1)) g.lineTo(x + px * k, y + py * k);
    g.closePath();
    const greased = id === GREASED_TILE;
    g.fillStyle = greased ? COLORS.greaseFill : COLORS.tile;
    g.fill();
    g.strokeStyle = greased ? COLORS.grease : COLORS.edge;
    g.lineWidth = 1;
    g.stroke();
    return;
  }
  const cx = x + s / 2;
  const cy = y + s / 2;
  g.lineWidth = Math.max(1, s / 16);
  switch (ch) {
    case 'erase-objects':
      // A gold piece and a mine, struck through.
      drawCell(g, '$', x - s * 0.18, y - s * 0.18, s * 0.8);
      drawCell(g, '*', x + s * 0.3, y + s * 0.3, s * 0.6);
      g.strokeStyle = '#ff6a86';
      g.lineWidth = Math.max(1.5, s / 12);
      g.beginPath();
      g.moveTo(x + 2, y + s - 2);
      g.lineTo(x + s - 2, y + 2);
      g.stroke();
      return;
    case 'select':
    case 'paste':
      // A dashed rectangle (paste: a faint one, with nothing copied yet).
      g.strokeStyle = ch === 'select' ? COLORS.edge : 'rgba(255, 255, 255, 0.3)';
      g.setLineDash([3, 2]);
      g.strokeRect(x + 2.5, y + 4.5, s - 5, s - 9);
      g.setLineDash([]);
      return;
    case '.':
      if (icon && eraserMark) {
        // Eraser: an empty cell, crossed out.
        g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
        g.beginPath();
        g.moveTo(x + 4, y + 4);
        g.lineTo(x + s - 4, y + s - 4);
        g.stroke();
      }
      return;
    case 'N':
    case '<': {
      // A little ninja: head, body and headband (trailing behind), mirrored to face left.
      g.save();
      if (ch === '<') {
        g.translate(2 * cx, 0);
        g.scale(-1, 1);
      }
      g.strokeStyle = '#e6f6ff';
      g.fillStyle = '#e6f6ff';
      g.lineCap = 'round';
      g.beginPath();
      g.arc(cx, y + s * 0.25, s * 0.13, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(cx, y + s * 0.38);
      g.lineTo(cx, y + s * 0.66);
      g.moveTo(cx - s * 0.2, y + s * 0.5);
      g.lineTo(cx + s * 0.2, y + s * 0.46);
      g.moveTo(cx, y + s * 0.66);
      g.lineTo(cx - s * 0.17, y + s * 0.92);
      g.moveTo(cx, y + s * 0.66);
      g.lineTo(cx + s * 0.17, y + s * 0.92);
      g.stroke();
      g.strokeStyle = COLORS.ninja;
      g.beginPath();
      g.moveTo(cx - s * 0.14, y + s * 0.22);
      g.lineTo(cx - s * 0.38, y + s * 0.18);
      g.stroke();
      // An arrow at the feet: the way it starts running.
      g.fillStyle = COLORS.ninja;
      g.beginPath();
      g.moveTo(cx + s * 0.44, y + s * 0.84);
      g.lineTo(cx + s * 0.3, y + s * 0.76);
      g.lineTo(cx + s * 0.3, y + s * 0.92);
      g.closePath();
      g.fill();
      g.restore();
      return;
    }
    case '&':
      // Toggle gold: a dashed outline, like a dormant one in the game.
      g.strokeStyle = COLORS.gold;
      g.setLineDash([s * 0.08, s * 0.05]);
      g.strokeRect(cx - s * 0.19, cy - s * 0.19, s * 0.38, s * 0.38);
      g.setLineDash([]);
      return;
    case '$':
      g.fillStyle = 'rgba(255, 210, 63, 0.2)';
      g.fillRect(cx - s * 0.19, cy - s * 0.19, s * 0.38, s * 0.38);
      g.strokeStyle = COLORS.gold;
      g.strokeRect(cx - s * 0.19, cy - s * 0.19, s * 0.38, s * 0.38);
      return;
    case '*':
    case '%': {
      g.beginPath();
      if (ch === '*') {
        for (let i = 0; i < 16; i++) {
          const a = (i * Math.PI) / 8;
          const r = (i % 2 ? 0.12 : 0.24) * s;
          g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        g.closePath();
        g.fillStyle = '#1a0610';
        g.fill();
        g.strokeStyle = COLORS.mine;
        g.stroke();
      } else {
        g.arc(cx, cy, s * 0.15, 0, Math.PI * 2);
        g.strokeStyle = COLORS.mine;
        g.setLineDash([s * 0.08, s * 0.06]);
        g.stroke();
        g.setLineDash([]);
      }
      return;
    }
    case 'D':
      g.fillStyle = '#120e2a';
      g.fillRect(x + s * 0.12, y, s * 0.76, s);
      g.strokeStyle = COLORS.door;
      g.strokeRect(x + s * 0.12, y + g.lineWidth / 2, s * 0.76, s - g.lineWidth / 2);
      g.fillStyle = COLORS.key;
      g.beginPath();
      g.arc(cx, cy - s * 0.06, s * 0.07, 0, Math.PI * 2);
      g.fill();
      return;
    case 'K':
      g.strokeStyle = COLORS.key;
      g.beginPath();
      g.arc(cx - s * 0.18, cy, s * 0.12, 0, Math.PI * 2);
      g.moveTo(cx - s * 0.06, cy);
      g.lineTo(cx + s * 0.3, cy);
      g.moveTo(cx + s * 0.22, cy);
      g.lineTo(cx + s * 0.22, cy + s * 0.12);
      g.moveTo(cx + s * 0.1, cy);
      g.lineTo(cx + s * 0.1, cy + s * 0.1);
      g.stroke();
      return;
  }
}

/** A launch pad centred at (x, y), at `s` px per tile: a plate across the way it throws, with a chevron ahead. */
function drawPad(g: CanvasRenderingContext2D, x: number, y: number, s: number, orientation: number, alpha = 1): void {
  const [dx, dy] = LAUNCH_PAD_DIRECTIONS[orientation];
  const k = s / TILE_SIZE;
  g.save();
  g.globalAlpha *= alpha;
  g.translate(x, y);
  g.rotate(Math.atan2(dy, dx));
  g.scale(k, k);
  g.fillStyle = '#2a0f45';
  g.strokeStyle = COLORS.pad;
  g.lineWidth = 1.2;
  g.beginPath();
  g.rect(-1.8, -6.5, 3.6, 13);
  g.fill();
  g.stroke();
  g.strokeStyle = COLORS.padLight;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  for (const at of [6, 10]) {
    g.moveTo(at - 2.6, -3.8);
    g.lineTo(at, 0);
    g.lineTo(at - 2.6, 3.8);
  }
  g.stroke();
  g.restore();
}

/**
 * A one-way platform centred at (x, y), at `s` px per tile: its solid face a
 * tile across, a strip behind it, and chevrons the way it can be passed through.
 */
function drawOneWay(g: CanvasRenderingContext2D, x: number, y: number, s: number, orientation: number): void {
  const [nx, ny] = LAUNCH_PAD_DIRECTIONS[orientation];
  const k = s / TILE_SIZE;
  g.save();
  g.translate(x, y);
  // The face along x, the side it faces towards -y.
  g.rotate(Math.atan2(nx, -ny));
  g.scale(k, k);
  g.fillStyle = 'rgba(37, 212, 255, 0.18)';
  g.fillRect(-12, 0, 24, 4.5);
  g.strokeStyle = COLORS.edge;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 0.9;
  g.beginPath();
  for (const cx of [-7, 0, 7]) {
    g.moveTo(cx - 2, 3.8);
    g.lineTo(cx, 1.6);
    g.lineTo(cx + 2, 3.8);
  }
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-12, 0);
  g.lineTo(12, 0);
  g.stroke();
  g.restore();
}

function tileMapOf(d: LevelDef): TileMap {
  const { width, height } = size(d);
  const tiles = new Uint8Array((width + 2) * (height + 2)).fill(1);
  d.rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) tiles[(y + 1) * (width + 2) + x + 1] = Math.max(0, TILE_LEGEND.indexOf(row[x]));
  });
  return new TileMap(width + 2, height + 2, tiles);
}

function draw(): void {
  const { width, height } = size(def);
  const W = (width + 2) * zoom;
  const H = (height + 2) * zoom;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  // Tiles, in world units, with the game's collision outline in neon.
  const map = tileMapOf(def);
  const k = zoom / TILE_SIZE;
  ctx.save();
  ctx.scale(k, k);
  const solid = new Path2D();
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const poly = TILE_POLYS[map.tileAt(tx, ty)];
      if (!poly) continue;
      solid.moveTo(tx * TILE_SIZE + poly[0][0], ty * TILE_SIZE + poly[0][1]);
      for (const [px, py] of poly.slice(1)) solid.lineTo(tx * TILE_SIZE + px, ty * TILE_SIZE + py);
      solid.closePath();
    }
  }
  ctx.fillStyle = COLORS.tile;
  ctx.fill(solid);
  // Greased blocks: tinted, with their slippery walls in orange.
  const greasedTiles = new Path2D();
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) if (map.tileAt(tx, ty) === GREASED_TILE) greasedTiles.rect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  }
  ctx.fillStyle = COLORS.greaseFill;
  ctx.fill(greasedTiles);
  const outline = new Path2D();
  const greasedWalls = new Path2D();
  for (const seg of map.allSegments()) {
    if (seg instanceof LinearSegment) {
      const midY = (seg.y1 + seg.y2) / 2;
      const greased = seg.x1 === seg.x2 && (map.isGreasedAt(seg.x1 - 1, midY) || map.isGreasedAt(seg.x1 + 1, midY));
      const path = greased ? greasedWalls : outline;
      path.moveTo(seg.x1, seg.y1);
      path.lineTo(seg.x2, seg.y2);
    } else if (seg instanceof CircularSegment) {
      outline.moveTo(seg.pHorX, seg.pHorY);
      outline.arc(seg.cx, seg.cy, seg.radius, Math.atan2(0, seg.hor), Math.atan2(seg.ver, 0), Math.sign(seg.hor * seg.ver) < 0);
    }
  }
  ctx.strokeStyle = COLORS.edge;
  ctx.lineWidth = 1.2 / k;
  ctx.stroke(outline);
  ctx.strokeStyle = COLORS.grease;
  ctx.lineWidth = 2 / k;
  ctx.stroke(greasedWalls);
  ctx.restore();

  // The border isn't editable: shade it.
  ctx.fillStyle = 'rgba(7, 5, 26, 0.55)';
  ctx.fillRect(0, 0, W, zoom);
  ctx.fillRect(0, H - zoom, W, zoom);
  ctx.fillRect(0, zoom, zoom, H - 2 * zoom);
  ctx.fillRect(W - zoom, zoom, zoom, H - 2 * zoom);

  // Grid, with a stronger line every 5 cells.
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x++) {
    ctx.strokeStyle = x % 5 === 0 ? COLORS.gridMajor : COLORS.grid;
    ctx.beginPath();
    ctx.moveTo((x + 1) * zoom + 0.5, zoom);
    ctx.lineTo((x + 1) * zoom + 0.5, H - zoom);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y++) {
    // Count from the bottom, the way levels are climbed.
    ctx.strokeStyle = (height - y) % 5 === 0 ? COLORS.gridMajor : COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(zoom, (y + 1) * zoom + 0.5);
    ctx.lineTo(W - zoom, (y + 1) * zoom + 0.5);
    ctx.stroke();
  }

  // Objects, at their points (N++ entity units: 4 per tile, from the outer edge of the border).
  const unit = zoom / 4;
  drawObjects(ctx, def, unit);

  // What the next click would do.
  const active = stroke?.tool ?? tool;
  if (active.object !== undefined) {
    if (hover) {
      const [px, py] = [hover[0] * unit, hover[1] * unit];
      const erasing = active.object === null || stroke?.erase;
      // The object to place, faintly, where it would go.
      if (!erasing) drawObject(ctx, active.object!, px, py, unit, 0.55);
      ctx.strokeStyle = erasing ? '#ff6a86' : COLORS.hover;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, erasing ? ERASE_REACH * unit : Math.max(3, unit * 0.9), 0, Math.PI * 2);
      ctx.stroke();
    }
    return;
  }
  if (active.select) {
    const rect = selectionRect() ?? (hover ? [...hover, ...hover] : null);
    if (rect) {
      const [x0, y0, x1, y1] = rect;
      const [left, top] = [Math.min(x0, x1), Math.min(y0, y1)];
      ctx.strokeStyle = COLORS.edge;
      ctx.lineWidth = 2;
      ctx.setLineDash(selection ? [6, 4] : [2, 3]);
      ctx.strokeRect(zoom + left * zoom + 1, zoom + top * zoom + 1, (Math.abs(x1 - x0) + 1) * zoom - 2, (Math.abs(y1 - y0) + 1) * zoom - 2);
      ctx.setLineDash([]);
    }
    return;
  }
  const stamp = active.stamp!;
  if (stroke?.rectFrom && hover) {
    ctx.strokeStyle = COLORS.hover;
    ctx.lineWidth = 2;
    for (const [x, y] of rectCells(...stroke.rectFrom, ...hover)) ctx.strokeRect(zoom + x * zoom + 1, zoom + y * zoom + 1, zoom - 2, zoom - 2);
  } else if (hover) {
    // What the stamp would leave, faintly, with its outline.
    const [cx, cy] = stroke ? stampCorner(stamp, stroke.origin, hover) : hover;
    const [w, h] = [stampWidth(stamp), stamp.length];
    if (!stroke?.erase) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      stamp.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          const [px, py] = [zoom + (cx + x) * zoom, zoom + (cy + y) * zoom];
          ctx.fillStyle = COLORS.bg;
          ctx.fillRect(px, py, zoom, zoom);
          drawCell(ctx, ch, px, py, zoom, true, false);
        }),
      );
      // A pasted rectangle's objects too.
      if (active.clip) drawObjects(ctx, shiftObjects(active.clip.objects, cx, cy), zoom / 4);
      ctx.restore();
    }
    ctx.strokeStyle = stroke?.erase ? '#ff6a86' : COLORS.hover;
    ctx.lineWidth = 2;
    ctx.strokeRect(zoom + cx * zoom + 1, zoom + cy * zoom + 1, w * zoom - 2, h * zoom - 2);
  }
}

/** How far from the pointer objects are removed, in entity units. */
const ERASE_REACH = 1.5;

/** One object (as an object tool places it) centred at (x, y) px, at `unit` px per entity unit. */
function drawObject(g: CanvasRenderingContext2D, what: Placement, x: number, y: number, unit: number, alpha = 1): void {
  const tileSize = unit * 4;
  g.save();
  g.globalAlpha *= alpha;
  if (what.kind === 'launchPads') {
    drawPad(g, x, y, tileSize, what.orientation ?? 6);
  } else if (what.kind === 'oneWays') {
    drawOneWay(g, x, y, tileSize, what.orientation ?? 6);
  } else {
    const ch = { spawn: what.facing === 'left' ? '<' : 'N', gold: '$', toggleGold: '&', mines: '*', toggleMines: '%', key: 'K', door: 'D' }[what.kind];
    // Mines are drawn a little smaller, so neighbours stay apart.
    const s = what.kind === 'mines' || what.kind === 'toggleMines' ? tileSize * 0.8 : tileSize;
    drawCell(g, ch, x - s / 2, y - s / 2, s);
  }
  g.restore();
}

/** All of a level's objects. */
function drawObjects(g: CanvasRenderingContext2D, d: Objects, unit: number): void {
  const at = ([x, y]: Coord, what: Placement) => drawObject(g, what, x * unit, y * unit, unit);
  if (d.door) at(d.door, { kind: 'door' });
  if (d.key) at(d.key, { kind: 'key' });
  for (const p of d.gold ?? []) at(p, { kind: 'gold' });
  for (const p of d.mines ?? []) at(p, { kind: 'mines' });
  for (const p of d.toggleGold ?? []) at(p, { kind: 'toggleGold' });
  for (const p of d.toggleMines ?? []) at(p, { kind: 'toggleMines' });
  for (const [x, y, orientation] of d.oneWays ?? []) at([x, y], { kind: 'oneWays', orientation });
  for (const [x, y, orientation] of d.launchPads ?? []) at([x, y], { kind: 'launchPads', orientation });
  if (d.spawn) at(d.spawn, { kind: 'spawn', facing: d.facing });
}

// ---------------------------------------------------------------- painting

/** Where a tool would act: the tile under the pointer, or for an object tool the nearest point of the 6 px entity grid. */
function toolAt(e: PointerEvent, t: Tool): [number, number] | null {
  if (t.object === undefined) return gridAt(e);
  const r = canvas.getBoundingClientRect();
  const unit = zoom / 4;
  const p: Coord = [Math.round((e.clientX - r.left) / unit), Math.round((e.clientY - r.top) / unit)];
  return insideLevel(def, p) ? p : null;
}

/** The tile under the pointer. */
function gridAt(e: PointerEvent): [number, number] | null {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left - zoom) / zoom);
  const y = Math.floor((e.clientY - r.top - zoom) / zoom);
  const { width, height } = size(def);
  return x >= 0 && y >= 0 && x < width && y < height ? [x, y] : null;
}

/**
 * Use a tool (or erase with it) at some positions: tiles, or points of the
 * entity grid for an object tool. A terrain tool's stamp goes in every block
 * the positions touch, the blocks lined up with the one at `origin`.
 */
function paint(d: LevelDef, t: Tool, erase: boolean, at: [number, number][], origin: [number, number] = at[0]): LevelDef {
  if (t.select) return d;
  if (t.object === undefined) {
    const corners = new Map(at.map((p) => stampCorner(t.stamp!, origin, p)).map((c) => [c.join(), c]));
    for (const [x, y] of corners.values()) {
      if (t.clip) d = erase ? clearRect(d, x, y, x + stampWidth(t.stamp!) - 1, y + t.stamp!.length - 1) : pasteClip(d, x, y, t.clip);
      else d = placeStamp(d, x, y, t.stamp!, erase);
    }
    return d;
  }
  if (erase || t.object === null) return removeObjects(d, at, ERASE_REACH);
  return placeObject(d, at[at.length - 1], t.object);
}

/** Cells on the line between two cells, so fast drags don't leave gaps. */
function lineCells([x0, y0]: [number, number], [x1, y1]: [number, number]): [number, number][] {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const out: [number, number][] = [];
  for (let i = 1; i <= n; i++) out.push([Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n)]);
  return out;
}

// On touch screens, one finger paints; the Scroll button switches it to scrolling instead.
let scrollMode = false;
const btnScroll = $<HTMLButtonElement>('btn-scroll');
btnScroll.addEventListener('click', () => {
  scrollMode = !scrollMode;
  btnScroll.setAttribute('aria-pressed', String(scrollMode));
  canvas.style.touchAction = scrollMode ? 'pan-x pan-y' : 'none';
});

canvas.addEventListener('pointerdown', (e) => {
  if (scrollMode && e.pointerType !== 'mouse') return;
  const at = toolAt(e, tool);
  if (!at || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2)) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  hover = at;
  if (tool.select) {
    // Drag out a rectangle; a right-click lets go of it.
    stroke = { tool, erase: false, origin: at, last: at, rectFrom: null, before: def };
    setSelection(e.button === 2 ? null : { from: at, to: at });
    if (e.button === 2) stroke = null;
    return;
  }
  // (Objects go one per click, without rectangles.)
  stroke = { tool, erase: e.button === 2, origin: at, last: at, rectFrom: e.shiftKey && tool.object === undefined && !tool.clip ? at : null, before: def };
  if (!stroke.rectFrom) {
    def = paint(def, tool, stroke.erase, [at]);
    changed();
  } else {
    draw();
  }
});

canvas.addEventListener('pointermove', (e) => {
  const active = stroke?.tool ?? tool;
  const at = toolAt(e, active);
  hover = at;
  const cell = gridAt(e);
  const point = at && active.object !== undefined ? ` · point ${at[0]}, ${at[1]}` : '';
  $('status-cell').textContent = cell ? `column ${cell[0] + 1}, row ${size(def).height - cell[1]} from the bottom${point}` : '';
  // Dragging paints terrain and removes objects, but doesn't drop an object at every point.
  const drags = active.object === undefined || active.object === null || stroke?.erase;
  if (stroke && at && active.select && selection) {
    if (at[0] !== selection.to[0] || at[1] !== selection.to[1]) setSelection({ from: selection.from, to: at });
    else draw();
  } else if (stroke && at && drags && !stroke.rectFrom && (at[0] !== stroke.last[0] || at[1] !== stroke.last[1])) {
    def = paint(def, stroke.tool, stroke.erase, lineCells(stroke.last, at), stroke.origin);
    stroke.last = at;
    changed();
  } else {
    draw();
  }
});

function endStroke(): void {
  if (!stroke) return;
  // A rectangle is filled with the stamp, repeated from its first corner.
  if (stroke.rectFrom && hover) def = fillStamp(def, rectCells(...stroke.rectFrom, ...hover), stroke.rectFrom, stroke.tool.stamp!, stroke.erase);
  const before = stroke.before;
  stroke = null;
  if (def !== before) {
    const after = def;
    def = before;
    commit(after);
  } else {
    draw();
  }
}
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('pointerleave', () => {
  if (!stroke) {
    hover = null;
    draw();
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function setZoom(z: number): void {
  // Keep the middle of the view where it is.
  const cx = (scroller.scrollLeft + scroller.clientWidth / 2) / zoom;
  const cy = (scroller.scrollTop + scroller.clientHeight / 2) / zoom;
  zoom = Math.min(56, Math.max(12, z));
  draw();
  scroller.scrollLeft = cx * zoom - scroller.clientWidth / 2;
  scroller.scrollTop = cy * zoom - scroller.clientHeight / 2;
}
$('btn-zoom-in').addEventListener('click', () => setZoom(zoom + 6));
$('btn-zoom-out').addEventListener('click', () => setZoom(zoom - 6));

// ---------------------------------------------------------------- start

buildPalette();
selectTool(tool);
// Start zoomed so the level's width fits (on a phone, say).
zoom = Math.min(28, Math.max(12, Math.floor((scroller.clientWidth - 32) / (size(def).width + 2))));
changed();
// Levels are climbed from the bottom: start scrolled to it.
scroller.scrollTop = scroller.scrollHeight;
