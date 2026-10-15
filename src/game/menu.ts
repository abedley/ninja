import type { Campaign } from '../level/campaigns';
import { clockText, el, secs } from './format';
import { levelScore, type Records } from './records';

type Screen = 'main' | 'play' | 'scores';

/**
 * The main menu: play a campaign, see the high scores, or open the level
 * editor. It's drawn over the game (which waits behind it), as plain DOM.
 */
export class Menu {
  private screen: Screen = 'main';
  /** Whether there's a game to go back to (shows "Resume"). */
  canResume = false;
  onPlay: (campaign: Campaign) => void = () => {};
  onResume: () => void = () => {};

  constructor(
    private readonly root: HTMLElement,
    private readonly campaigns: readonly Campaign[],
    private readonly records: Records,
  ) {}

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(screen: Screen = 'main'): void {
    this.screen = screen;
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.root.hidden = true;
  }

  /** Escape: up a level, or out of the menu back to the game. */
  back(): void {
    if (this.screen !== 'main') this.open('main');
    else if (this.canResume) this.onResume();
  }

  private render(): void {
    const panel = el('div', '', `menu-panel menu-${this.screen}`);
    if (this.screen === 'main') panel.append(...this.mainScreen());
    else if (this.screen === 'play') panel.append(...this.playScreen());
    else panel.append(...this.scoresScreen());
    this.root.replaceChildren(panel);
    this.root.scrollTop = 0;
    (panel.querySelector<HTMLElement>('.menu-item.primary') ?? panel.querySelector<HTMLElement>('.menu-item'))?.focus({ preventScroll: true });
  }

  private mainScreen(): HTMLElement[] {
    const logo = el('h1', 'NINJA', 'logo');
    const tagline = el('p', 'One button. A midnight city.', 'tagline');
    const items = el('nav', '', 'menu-items');
    if (this.canResume) items.append(this.button('Resume', () => this.onResume(), 'primary'));
    items.append(
      this.button('Play', () => this.open('play'), this.canResume ? '' : 'primary'),
      this.button('High scores', () => this.open('scores')),
    );
    const editor = el('a', 'Level editor', 'menu-item');
    editor.href = 'editor/';
    items.append(editor);
    const hint = el('p', 'Tap to jump · hold to jump higher', 'menu-foot');
    return [logo, tagline, items, hint];
  }

  private playScreen(): HTMLElement[] {
    const list = el('div', '', 'menu-list');
    for (const c of this.campaigns) {
      const card = el('article', '', 'menu-card');
      card.append(el('h2', c.name));
      if (c.description) card.append(el('p', c.description, 'menu-desc'));
      const levels = el('ol', '', 'level-list');
      for (const l of c.levels) {
        const item = el('li', l.name);
        const best = this.records.levelBest(l.name);
        if (best !== null) item.append(el('span', `${secs(levelScore(best))} s`, 'menu-dim'));
        levels.append(item);
      }
      card.append(levels);
      const best = this.records.runs(c.name)[0];
      card.append(
        el('p', `${c.levels.length} levels · ${c.time} s on the clock${best ? ` · best run ${clockText(best.timeLeft)} s left` : ''}`, 'menu-dim'),
        this.button('Play', () => this.onPlay(c), 'primary'),
      );
      list.append(card);
    }
    return [this.header('Play'), list];
  }

  private scoresScreen(): HTMLElement[] {
    const list = el('div', '', 'menu-list');
    for (const c of this.campaigns) {
      const card = el('article', '', 'menu-card');
      card.append(el('h2', c.name), el('h3', 'Best runs'));
      const runs = this.records.runs(c.name);
      if (runs.length) {
        const table = el('table', '', 'menu-table');
        const head = table.insertRow();
        for (const h of ['', 'Time left', 'Total time', 'Date']) head.append(el('th', h));
        runs.forEach((r, i) => {
          const row = table.insertRow();
          row.append(
            el('td', `${i + 1}`),
            el('td', `${clockText(r.timeLeft)} s`),
            el('td', `${secs(r.totalFrames)} s`),
            el('td', new Date(r.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), 'menu-dim'),
          );
        });
        card.append(table);
      } else {
        card.append(el('p', 'No finished runs yet. Finish all the levels on one clock to get on the board.', 'menu-dim'));
      }
      card.append(el('h3', 'Best level scores'));
      const table = el('table', '', 'menu-table');
      c.levels.forEach((l, i) => {
        const best = this.records.levelBest(l.name);
        const row = table.insertRow();
        row.append(el('td', `${i + 1}`), el('td', l.name), el('td', best === null ? '–' : `${secs(levelScore(best))} s`));
        row.append(el('td', best === null ? '' : `${secs(best.frames)} s · ${best.gold} gold`, 'menu-dim menu-detail'));
      });
      card.append(table, el('p', 'A level’s score is the time taken less 2 s for each piece of gold.', 'menu-dim'));
      list.append(card);
    }
    return [this.header('High scores'), list];
  }

  private header(title: string): HTMLElement {
    const header = el('header', '', 'menu-header');
    header.append(this.button('‹ Back', () => this.open('main'), 'menu-back'), el('h1', title));
    return header;
  }

  private button(text: string, action: () => void, extra = ''): HTMLButtonElement {
    const b = el('button', text, `menu-item ${extra}`.trim());
    b.type = 'button';
    b.addEventListener('click', action);
    return b;
  }
}
