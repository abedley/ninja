import { Game, Phase } from './game/game';
import { Input } from './game/input';
import { Renderer } from './game/renderer';
import { LEVELS, TOWER } from './level/levels';

const app = document.getElementById('app')!;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const message = document.getElementById('message')!;
const btnRestart = document.getElementById('btn-restart')!;
const btnDebug = document.getElementById('btn-debug')!;
const btnFullscreen = document.getElementById('btn-fullscreen')!;
const goldCounter = document.getElementById('gold-counter')!;
const goldCount = document.getElementById('gold-count')!;

// ?level=<name> picks another level (e.g. ?level=playground).
const wanted = new URLSearchParams(location.search).get('level')?.toLowerCase();
const levelDef = LEVELS.find((l) => l.name.toLowerCase() === wanted) ?? TOWER;

const renderer = new Renderer(canvas);
const input = new Input(app);
const game = new Game(renderer, input, levelDef);

function resize(): void {
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

const PROMPTS: Record<Phase, string> = {
  [Phase.Ready]: 'Tap to start',
  [Phase.Playing]: '',
  [Phase.Dead]: 'Tap to try again',
};

// Prompt and gold counter.
let lastPhase = -1;
let lastGold = -1;
function updateUi(): void {
  if (game.phase !== lastPhase) {
    lastPhase = game.phase;
    message.textContent = PROMPTS[game.phase];
    message.hidden = game.phase === Phase.Playing;
  }
  const gold = game.goldCollected;
  if (gold !== lastGold) {
    const total = game.goldTotal;
    goldCount.textContent = `${gold}/${total}`;
    goldCounter.hidden = total === 0;
    goldCounter.classList.toggle('complete', gold === total && total > 0);
    // Restart the bump animation on each pickup (not on a reset to 0).
    goldCounter.classList.remove('bump');
    if (gold > lastGold && lastGold >= 0) {
      void goldCounter.offsetWidth;
      goldCounter.classList.add('bump');
    }
    lastGold = gold;
  }
  requestAnimationFrame(updateUi);
}

resize();
game.start();
requestAnimationFrame(updateUi);
