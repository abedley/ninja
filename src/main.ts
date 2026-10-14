import { Game, Phase } from './game/game';
import { Input } from './game/input';
import { Renderer } from './game/renderer';
import { LEVELS, TOWER } from './level/levels';

const app = document.getElementById('app')!;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const message = document.getElementById('message')!;
const hud = document.getElementById('hud')!;
const btnRestart = document.getElementById('btn-restart')!;
const btnDebug = document.getElementById('btn-debug')!;
const btnFullscreen = document.getElementById('btn-fullscreen')!;
const goldCounter = document.getElementById('gold-counter')!;
const goldCount = document.getElementById('gold-count')!;
const keyIndicator = document.getElementById('key-indicator')!;
const timer = document.getElementById('timer')!;
const timerFill = document.getElementById('timer-fill')!;
const timerText = document.getElementById('timer-text')!;

// ?level=<name> picks another level (e.g. ?level=playground).
const wanted = new URLSearchParams(location.search).get('level')?.toLowerCase();
const levelDef = LEVELS.find((l) => l.name.toLowerCase() === wanted) ?? TOWER;

const renderer = new Renderer(canvas);
const input = new Input(app);
const game = new Game(renderer, input, levelDef);

function resize(): void {
  // Let the top of the level scroll clear of the HUD (buttons, and the clock below them).
  renderer.topInset = (game.timed ? timer : hud).getBoundingClientRect().bottom;
  renderer.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, 3));
  game.snapCamera();
}

input.onRestart = () => game.restart();
input.onToggleDebug = toggleDebug;

function toggleDebug(): void {
  game.debug = !game.debug;
  btnDebug.setAttribute('aria-pressed', String(game.debug));
}

// HUD buttons must not also count as jumps.
for (const btn of [btnRestart, btnDebug, btnFullscreen]) {
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
}
btnRestart.addEventListener('click', () => game.restart());
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
  else game.start();
});

/** Seconds below which the clock turns red. */
const LOW_TIME = 10;

/** Most time left at the exit so far (N's score), kept in this browser. */
const bestKey = `ninja.best.${game.levelName}`;
function loadBest(): number | null {
  try {
    const v = Number(localStorage.getItem(bestKey));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}
function saveBest(v: number): void {
  try {
    localStorage.setItem(bestKey, String(v));
  } catch {
    /* storage unavailable: the best just isn't remembered */
  }
}

function showMessage(): void {
  message.classList.toggle('won', game.phase === Phase.Won);
  message.hidden = game.phase === Phase.Playing;
  switch (game.phase) {
    case Phase.Ready:
      message.textContent = 'Tap to start';
      break;
    case Phase.Dead:
      message.textContent = game.timedOut ? 'Out of time!\nTap to try again' : 'Tap to try again';
      break;
    case Phase.Won: {
      const title = document.createElement('strong');
      title.textContent = 'Level complete!';
      const lines = [`Gold ${game.goldCollected}/${game.goldTotal}`];
      if (game.timed) {
        const left = Math.round(game.timeLeft * 10) / 10;
        const best = loadBest();
        lines.unshift(`Time left ${left.toFixed(1)} s`);
        if (best === null || left > best) {
          saveBest(left);
          if (best !== null) lines.push('New best!');
        } else {
          lines.push(`Best ${best.toFixed(1)} s`);
        }
      }
      lines.push('', 'Tap to play again');
      message.replaceChildren(title, lines.join('\n'));
      break;
    }
  }
}

// Prompt, clock and gold counter.
let lastPhase = -1;
let lastGold = -1;
let lastTimeText = '';
let lastKey: boolean | null = null;
timer.hidden = !game.timed;
keyIndicator.hidden = !game.hasExit;
function updateUi(): void {
  if (game.phase !== lastPhase) {
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

resize();
game.start();
requestAnimationFrame(updateUi);
