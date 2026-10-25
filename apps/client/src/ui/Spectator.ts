import './spectator.css';

export interface SpectatorTarget {
  index: number;
  name: string;
  hp: number;
  shield: number;
  kills: number;
}

export interface SpectatorActions {
  previous(): void;
  next(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = cls;
  if (text !== undefined) element.textContent = text;
  parent?.append(element);
  return element;
}

const amount = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

/** The camera controller owns the selected survivor; this card only presents its public state. */
export class Spectator {
  readonly el = el('section', 'spectator');
  private readonly heading = el('div', 'spectator-heading', this.el);
  private readonly count = el('span', 'spectator-count', this.heading);
  private readonly row = el('div', 'spectator-row', this.el);
  private readonly previous = el('button', 'spectator-switch', this.row, '←');
  private readonly player = el('div', 'spectator-player', this.row);
  private readonly name = el('strong', 'spectator-name', this.player);
  private readonly stats = el('div', 'spectator-stats', this.player);
  private readonly health = el('span', 'spectator-health', this.stats);
  private readonly shield = el('span', 'spectator-shield', this.stats);
  private readonly kills = el('span', 'spectator-kills', this.stats);
  private readonly next = el('button', 'spectator-switch', this.row, '→');
  private readonly hint = el('div', 'spectator-hint', this.el);

  constructor(actions: SpectatorActions) {
    this.el.hidden = true;
    this.el.setAttribute('aria-label', 'Modo espectador');
    this.heading.prepend(el('span', 'spectator-label', undefined, 'ESPECTADOR'));
    this.name.setAttribute('aria-live', 'polite');
    this.name.setAttribute('aria-atomic', 'true');
    this.hint.textContent = '← → trocar jogador · TAB placar';
    for (const [button, label, action] of [
      [this.previous, 'Observar jogador anterior', actions.previous],
      [this.next, 'Observar próximo jogador', actions.next],
    ] as const) {
      button.type = 'button';
      button.disabled = true;
      button.setAttribute('aria-label', label);
      button.title = label;
      // Keep a mouse click in this card from requesting pointer lock or retaining button focus.
      button.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        if (event.pointerType === 'mouse') event.preventDefault();
      });
      button.addEventListener('mousedown', (event) => event.stopPropagation());
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        action();
        if (event.detail > 0) button.blur();
      });
      // Native keyboard activation remains available without sending Enter/Space to gameplay input.
      for (const type of ['keydown', 'keyup'] as const) button.addEventListener(type, (event) => {
        if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space') event.stopPropagation();
      });
    }
    this.update(null, 0, 0);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  update(target: SpectatorTarget | null, alive: number, total: number): void {
    const living = amount(alive);
    this.count.textContent = `${living} / ${Math.max(living, amount(total))} vivos`;
    const title = target?.name || (living > 0 ? 'Aguardando jogador…' : 'Aguardando resultado…');
    if (this.name.textContent !== title) this.name.textContent = title;
    this.name.title = title;
    this.el.dataset.target = target ? String(target.index) : '';
    this.stats.hidden = !target;
    if (target) {
      this.health.textContent = `Vida ${amount(target.hp)}`;
      this.shield.textContent = `Escudo ${amount(target.shield)}`;
      this.kills.textContent = `${amount(target.kills)} elim.`;
      this.kills.setAttribute('aria-label', `${amount(target.kills)} eliminações`);
    }
    this.previous.disabled = this.next.disabled = !target || living <= 1;
    const touch = document.body?.classList.contains('touch-ui');
    this.hint.textContent = !target
      ? touch ? 'A partida continua · segure PLACAR' : 'A partida continua · TAB placar'
      : living > 1 ? touch ? 'Toque nas setas · segure PLACAR' : '← → trocar jogador · TAB placar'
        : touch ? 'Último sobrevivente · segure PLACAR' : 'Último sobrevivente · TAB placar';
  }

  show(on: boolean): void {
    const entering = on && this.el.hidden;
    this.el.hidden = !on;
    if (entering && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (!on && this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }
}
