import { Game } from './game/game';
import { Input } from './game/input';
import { Renderer } from './game/renderer';
import { PLAYGROUND } from './level/levels';

const app = document.getElementById('app')!;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const padLeft = document.getElementById('pad-left')!;
const padRight = document.getElementById('pad-right')!;
const padJump = document.getElementById('pad-jump')!;
const message = document.getElementById('message')!;
const btnRestart = document.getElementById('btn-restart')!;
const btnDebug = document.getElementById('btn-debug')!;
const btnFullscreen = document.getElementById('btn-fullscreen')!;
const goldCounter = document.getElementById('gold-counter')!;
const goldCount = document.getElementById('gold-count')!;

const renderer = new Renderer(canvas);
const input = new Input(app);
const game = new Game(renderer, input, PLAYGROUND);

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, 3));
  const l = padLeft.getBoundingClientRect();
  const r = padRight.getBoundingClientRect();
  input.layout = {
    // Before the touch pads are first shown they have no size; fall back to sensible defaults.
    padCenterX: l.width ? (l.right + r.left) / 2 : 100,
    jumpAreaX: window.innerWidth / 2,
  };
}

function setTouchMode(touch: boolean): void {
  document.body.classList.toggle('touch', touch);
  resize();
}

input.onTouchModeChange = setTouchMode;
input.onRestart = () => game.restart();
input.onToggleDebug = toggleDebug;
setTouchMode(matchMedia('(pointer: coarse)').matches);

function toggleDebug(): void {
  game.debug = !game.debug;
  btnDebug.setAttribute('aria-pressed', String(game.debug));
}

// HUD buttons must not also count as movement/jump touches.
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
        // Not supported everywhere (notably iOS); landscape is only a preference.
        await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
      }
    } catch {
      /* ignore */
    }
  });
}

// With the physics overlay on, clicking with a mouse drops the ninja there.
canvas.addEventListener('pointerdown', (e) => {
  if (game.debug && e.pointerType === 'mouse') game.teleportToScreen(e.clientX, e.clientY);
});

window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.stop();
  else game.start();
});

// Reflect touch state on the on-screen pads, show the retry prompt and count gold.
let lastUi = '';
let lastGold = -1;
function updateUi(): void {
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

  const dir = input.touchDir;
  const ui = `${dir}|${input.touchJump}|${game.isDead}|${input.usingTouch}`;
  if (ui !== lastUi) {
    lastUi = ui;
    padLeft.classList.toggle('active', dir === -1);
    padRight.classList.toggle('active', dir === 1);
    padJump.classList.toggle('active', input.touchJump);
    message.hidden = !game.isDead;
    message.textContent = input.usingTouch ? 'Tap jump to try again' : 'Press jump to try again';
  }
  requestAnimationFrame(updateUi);
}

resize();
game.start();
requestAnimationFrame(updateUi);
