import { CampaignRun } from './game/campaign';
import { clockText, el, secs } from './game/format';
import { Game, Phase } from './game/game';
import { Input } from './game/input';
import { Menu } from './game/menu';
import { browserStore, levelScore, Records, RUNS_KEPT, type LevelRecord } from './game/records';
import { Renderer } from './game/renderer';
import { CAMPAIGNS, type Campaign } from './level/campaigns';
import { parseLevel, type LevelDef } from './level/level';
import { LEVELS } from './level/levels';
import { loadPlaytest, PLAYTEST_PARAM } from './level/playtest';
import { TICK_RATE } from './physics/simulator';

const app = document.getElementById('app')!;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const message = document.getElementById('message')!;
const hud = document.getElementById('hud')!;
const btnRestart = document.getElementById('btn-restart')!;
const btnDebug = document.getElementById('btn-debug')!;
const btnFullscreen = document.getElementById('btn-fullscreen')!;
const btnMenu = document.getElementById('btn-menu')!;
const goldCounter = document.getElementById('gold-counter')!;
const goldCount = document.getElementById('gold-count')!;
const keyIndicator = document.getElementById('key-indicator')!;
const timer = document.getElementById('timer')!;
const timerFill = document.getElementById('timer-fill')!;
const timerText = document.getElementById('timer-text')!;
const levelLabel = document.getElementById('level-label')!;

// The game opens on the main menu, where you pick a campaign (campaigns.json).
// ?level=<name> plays one level on its own; ?level=editor plays the level editor's level.
const wanted = new URLSearchParams(location.search).get('level')?.toLowerCase();
const playtest = wanted === PLAYTEST_PARAM ? validLevel(loadPlaytest()) : null;
const single = playtest ?? LEVELS.find((l) => l.name.toLowerCase() === wanted) ?? null;
/** The campaign being played (null for a single level). */
let run: CampaignRun | null = null;
/** Which levels of this run set a new best time. */
let newBests: boolean[] = [];
/** This run's clear of each level. */
let clears: LevelRecord[] = [];
const records = new Records(browserStore());
records.adoptOldRuns(CAMPAIGNS[0].name);
// Ask the browser not to clear the records to free up space (a home-screen app on iOS may otherwise lose them).
void navigator.storage?.persist?.().catch(() => {});

function validLevel(def: LevelDef | null): LevelDef | null {
  try {
    if (def) parseLevel(def);
    return def;
  } catch {
    return null;
  }
}

// Playtesting from the editor: a button goes back to it.
const btnEdit = document.getElementById('btn-edit') as HTMLAnchorElement;
btnEdit.hidden = !playtest;

const renderer = new Renderer(canvas);
const input = new Input(app);
// Behind the menu, the first level waits.
const game = single ? new Game(renderer, input, single) : new Game(renderer, input, CAMPAIGNS[0].levels[0], CAMPAIGNS[0].time * TICK_RATE);
const menu = new Menu(document.getElementById('menu')!, CAMPAIGNS, records);

function resize(): void {
  // Let the top of the level scroll clear of the HUD (buttons, and the clock below them).
  renderer.topInset = (game.timed ? timer : hud).getBoundingClientRect().bottom;
  renderer.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, 3));
  game.snapCamera();
}

input.onRestart = restartLevel;
input.onToggleDebug = toggleDebug;
input.onMenu = () => (menu.isOpen ? menu.back() : openMenu());

function toggleDebug(): void {
  game.debug = !game.debug;
  btnDebug.setAttribute('aria-pressed', String(game.debug));
}

/** Buttons must not also count as jumps (and must still get their clicks on touch screens). */
function ownTaps(el: HTMLElement): void {
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
}
for (const btn of [btnMenu, btnRestart, btnDebug, btnFullscreen, btnEdit]) ownTaps(btn);

/** Back to the start of the current level (or, once the campaign is finished, a new run). */
function restartLevel(): void {
  if (run?.finished) newRun();
  else game.restart();
}

/** Start a campaign from its first level, on a full clock. */
function startRun(campaign: Campaign): void {
  run = new CampaignRun(campaign);
  newBests = [];
  clears = [];
  game.loadLevel(run.level, run.clockAtStart);
  game.onContinue = continueRun;
  levelChanged();
  closeMenu();
}

/** Start the current campaign again from the first level. */
function newRun(): void {
  if (run) startRun(run.campaign);
}

/** In a campaign, a tap after reaching the exit moves on to the next level. */
function continueRun(): void {
  if (!run) return;
  if (run.finished) {
    newRun();
    return;
  }
  run.complete(game.clearFrames, game.framesLeft);
  game.loadLevel(run.level, run.clockAtStart);
  levelChanged();
}

/** Whether the game loop was stopped for the menu. */
let paused = false;

function openMenu(): void {
  // A level in play waits, frozen, until "Resume"; otherwise the ninja idles behind the menu.
  menu.canResume = run !== null || single !== null;
  if (game.phase === Phase.Playing) {
    game.stop();
    paused = true;
  }
  input.enabled = false;
  app.classList.add('menu-open');
  menu.open();
}

function closeMenu(): void {
  menu.close();
  app.classList.remove('menu-open');
  input.enabled = true;
  if (paused) {
    paused = false;
    game.start();
  }
}

menu.onPlay = startRun;
menu.onResume = closeMenu;
btnMenu.addEventListener('click', openMenu);

btnRestart.addEventListener('click', restartLevel);
btnDebug.addEventListener('click', toggleDebug);

if (document.fullscreenEnabled) {
  btnFullscreen.hidden = false;
  btnFullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        // Not supported everywhere (notably iOS); portrait is only a preference.
        await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('portrait');
      }
    } catch {
      /* ignore */
    }
  });
}

// With the physics overlay on, alt-clicking drops the ninja at that spot.
canvas.addEventListener('pointerdown', (e) => {
  if (game.debug && e.altKey) game.teleportToScreen(e.clientX, e.clientY);
});

window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.stop();
  else if (!paused) game.start();
});

/** Seconds below which the clock turns red. */
const LOW_TIME = 10;

/** A button inside the message, for starting the campaign over. */
function startOverButton(): HTMLButtonElement {
  const btn = el('button', 'Start over from level 1', 'msg-btn');
  ownTaps(btn);
  btn.addEventListener('click', newRun);
  return btn;
}

/** A button inside the message, back to the main menu. */
function menuButton(): HTMLButtonElement {
  const btn = el('button', 'Main menu', 'msg-btn');
  ownTaps(btn);
  btn.addEventListener('click', openMenu);
  return btn;
}

/** What the result of the level just cleared was, worked out once when the exit is reached. */
let result: HTMLElement[] = [];

function onWon(): void {
  const name = game.levelDef.name;
  const frames = game.clearFrames;
  const clear = { frames, gold: game.goldCollected };
  // Best scores aren't kept for the level being playtested from the editor (but are for a campaign started from its menu).
  const testing = playtest !== null && !run;
  const best = testing ? null : records.submitLevel(name, clear);
  const isNewBest = best === null || levelScore(clear) > levelScore(best);
  if (run) {
    newBests[run.index] = isNewBest;
    clears[run.index] = clear;
  }
  const scoreLine = el('p', `Score ${secs(levelScore(clear))} s`);
  if (!testing) scoreLine.append(isNewBest ? el('span', 'New best!', 'new-best') : el('span', `Best ${secs(levelScore(best!))} s`, 'best'));
  const lines: HTMLElement[] = [
    el('p', `Time ${secs(frames)} s`),
    el('p', `Gold ${game.goldCollected}/${game.goldTotal}`),
    scoreLine,
    el('p', 'Score: 30 s less your time, plus 2 s per gold', 'note'),
  ];

  if (!run) {
    if (game.timed) lines.push(el('p', `Time left ${clockText(game.framesLeft)} s`));
    result = [el('strong', 'Level complete!'), ...lines, el('p', 'Tap to play again', 'prompt')];
    return;
  }
  if (!run.isLastLevel) {
    lines.push(el('p', `Clock ${clockText(game.framesLeft)} s, carried over`));
    const next = run.levels[run.index + 1];
    result = [el('strong', 'Level complete!'), ...lines, el('p', `Tap for level ${run.index + 2}: ${next.name}`, 'prompt')];
    return;
  }

  // The last level: the run is over.
  run.complete(frames, game.framesLeft);
  const campaign = run.campaign.name;
  const runsBefore = records.runs(campaign);
  const place = records.submitRun(campaign, { timeLeft: run.finalClock, totalFrames: run.totalFrames, date: Date.now() });
  const score = el('p', `Time left ${clockText(run.finalClock)} s`, 'score');
  if (place === 0) score.append(el('span', runsBefore.length ? 'New best run!' : 'First run!', 'new-best'));
  else if (place > 0) score.append(el('span', `Your #${place + 1} run`, 'best'));
  else score.append(el('span', `Best ${clockText(runsBefore[0].timeLeft)} s`, 'best'));

  const table = el('table', '', 'results');
  const head = table.insertRow();
  for (const h of ['Level', 'Time', 'Score', 'Best']) head.append(el('th', h));
  run.levels.forEach((l, i) => {
    const row = table.insertRow();
    row.append(el('td', `${i + 1} ${l.name}`), el('td', secs(run!.levelFrames[i])), el('td', clears[i] ? secs(levelScore(clears[i])) : '–'));
    const lb = records.levelBest(l.name);
    row.append(newBests[i] ? el('td', 'New!', 'new-best') : el('td', lb === null ? '–' : secs(levelScore(lb))));
  });
  const total = table.insertRow();
  total.className = 'total';
  total.append(el('td', 'Total'), el('td', secs(run.totalFrames)), el('td'), el('td'));

  result = [el('strong', 'Campaign complete!'), score, table, runsTable(campaign, place), el('p', 'Tap to play again', 'prompt'), menuButton()];
}

/** The best runs, highlighting the one just finished (if it made the table). */
function runsTable(campaign: string, highlight: number): HTMLElement {
  const runs = records.runs(campaign);
  const box = el('div', '', 'runs');
  box.append(el('p', `Best runs (time left)`));
  const list = el('ol');
  runs.slice(0, RUNS_KEPT).forEach((r, i) => {
    const item = el('li', `${clockText(r.timeLeft)} s`);
    item.append(el('span', ` in ${secs(r.totalFrames)} s`, 'best'));
    if (i === highlight) item.className = 'you';
    list.append(item);
  });
  box.append(list);
  return box;
}

function showMessage(): void {
  const phase = game.phase;
  const card = phase === Phase.Won || (phase === Phase.Ready && run !== null);
  message.classList.toggle('card', card);
  message.hidden = phase === Phase.Playing;
  switch (phase) {
    case Phase.Ready: {
      if (!run) {
        message.replaceChildren('Tap to start');
        break;
      }
      const parts: (HTMLElement | string)[] = [
        el('p', `Level ${run.index + 1} of ${run.levels.length}`, 'eyebrow'),
        el('strong', run.level.name),
      ];
      if (run.level.description) parts.push(el('p', run.level.description, 'description'));
      const best = records.levelBest(run.level.name);
      if (run.index === 0) {
        parts.push(el('p', `Clock ${clockText(run.clockAtStart)} s for all ${run.levels.length} levels`));
        const top = records.runs(run.campaign.name)[0];
        if (top) parts.push(el('p', `Best run ${clockText(top.timeLeft)} s left`, 'best'));
      } else {
        parts.push(el('p', `Clock ${clockText(run.clockAtStart)} s`));
      }
      if (best !== null) parts.push(el('p', `Best score ${secs(levelScore(best))} s`, 'best'));
      parts.push(el('p', 'Tap to start', 'prompt'));
      if (run.index > 0) parts.push(startOverButton());
      message.replaceChildren(...parts);
      break;
    }
    case Phase.Dead: {
      const text = game.timedOut ? 'Out of time!\nTap to try again' : 'Tap to try again';
      message.replaceChildren(text);
      if (run && run.index > 0) message.append(startOverButton());
      break;
    }
    case Phase.Won:
      message.replaceChildren(...result);
      break;
  }
}

/** After loading a level: HUD parts that depend on it. */
function levelChanged(): void {
  timer.hidden = !game.timed;
  keyIndicator.hidden = !game.hasExit;
  levelLabel.hidden = !run;
  if (run) levelLabel.textContent = `${run.index + 1}/${run.levels.length}`;
  lastPhase = -1;
  lastGold = -1;
  lastKey = null;
  lastTimeText = '';
  resize();
}

// Prompt, clock and gold counter.
let lastPhase = -1;
let lastGold = -1;
let lastTimeText = '';
let lastKey: boolean | null = null;
function updateUi(): void {
  if (game.phase !== lastPhase) {
    if (game.phase === Phase.Won) onWon();
    lastPhase = game.phase;
    showMessage();
  }
  if (game.hasKey !== lastKey) {
    lastKey = game.hasKey;
    keyIndicator.classList.toggle('got', lastKey);
    keyIndicator.setAttribute('aria-label', lastKey ? 'Key collected: the exit is open' : 'Key not collected yet');
  }
  const gold = game.goldCollected;
  if (game.timed) {
    const left = game.timeLeft;
    // Round up, so the clock reads 0.0 only once time is actually up.
    const text = (Math.ceil(left * 10) / 10).toFixed(1);
    if (text !== lastTimeText) {
      lastTimeText = text;
      timerText.textContent = text;
      timerFill.style.transform = `scaleX(${Math.min(1, left / game.timeLimit)})`;
      timer.classList.toggle('low', left < LOW_TIME && game.phase !== Phase.Won);
    }
  }
  if (gold !== lastGold) {
    const total = game.goldTotal;
    goldCount.textContent = `${gold}/${total}`;
    goldCounter.hidden = total === 0;
    goldCounter.classList.toggle('complete', gold === total && total > 0);
    // Restart the bump animations on each pickup (not on a reset to 0).
    goldCounter.classList.remove('bump');
    timer.classList.remove('bonus');
    if (gold > lastGold && lastGold >= 0) {
      void goldCounter.offsetWidth;
      goldCounter.classList.add('bump');
      timer.classList.add('bonus');
    }
    lastGold = gold;
  }
  requestAnimationFrame(updateUi);
}

// For poking at the game from the console (and scripted screenshots) during development.
if (import.meta.env.DEV) Object.assign(window, { game });

levelChanged();
game.start();
requestAnimationFrame(updateUi);
if (!single) openMenu();
