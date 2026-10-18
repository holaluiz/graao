/**
 * Room lobby (DOM, over the warmup world): shown while the pointer is free between matches. The room code (copy it
 * for a friend), everyone in the room with their ready state and the room's running score, and the actions: ESTOU
 * PRONTO / CANCELAR (same as ENTER), VOLTAR AO MUNDO (lock the pointer and warm up) and SAIR DA SALA.
 * The server owns readiness; this panel only shows ROOM_STATE and sends intents.
 */
import type { PlayerPublic } from '@graao/shared';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export interface LobbyActions {
  ready(on: boolean): void;
  play(): void;
  leave(): void;
  click(): void;
}

export class LobbyPanel {
  readonly el = el('div', 'lobby');
  private readonly codeEl: HTMLElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly hint = el('div', 'lobby-hint');
  private readonly list = el('div', 'lobby-list');
  private readonly readyBtn = el('button', 'btn primary', undefined, 'Estou pronto');
  private code = '';
  private ready = false;
  private lastKey = '';

  constructor(private readonly actions: LobbyActions) {
    this.el.hidden = true;
    el('div', 'lobby-k', this.el, 'Sala');
    const top = el('div', 'lobby-top', this.el);
    this.codeEl = el('div', 'lobby-code', top);
    this.copyBtn = el('button', 'btn small', top, 'Copiar');
    this.copyBtn.addEventListener('click', () => {
      this.actions.click();
      void navigator.clipboard?.writeText(this.code).then(
        () => this.flash('Copiado!'),
        () => this.flash('Selecione e copie'),
      );
    });
    this.el.append(this.hint, this.list);
    this.readyBtn.addEventListener('click', () => {
      this.actions.click();
      this.actions.ready(!this.ready);
    });
    const play = el('button', 'btn', undefined, 'Voltar ao mundo');
    play.addEventListener('click', () => {
      this.actions.click();
      this.actions.play();
    });
    const leave = el('button', 'btn', undefined, 'Sair da sala');
    leave.addEventListener('click', () => {
      this.actions.click();
      this.actions.leave();
    });
    const row = el('div', 'row', this.el);
    row.append(play, leave);
    this.el.insertBefore(this.readyBtn, row);
    el('div', 'lobby-foot', this.el, 'Todos prontos → draft de habilidades → OVNI → luta. ENTER também marca pronto.');
  }

  private flash(text: string): void {
    this.copyBtn.textContent = text;
    setTimeout(() => (this.copyBtn.textContent = 'Copiar'), 1400);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(v: boolean): void {
    this.el.hidden = !v;
  }

  /** Refreshes from the room state (rebuilds the list only when something visible changed). */
  update(code: string, players: PlayerPublic[], me: number): void {
    this.code = code;
    const solo = players.some((p) => p.bot);
    const title = solo ? 'SOLO · BOTS' : code;
    if (this.codeEl.textContent !== title) this.codeEl.textContent = title;
    this.copyBtn.hidden = solo;
    const here = players.filter((p) => p.connected).sort((a, b) => a.index - b.index);
    this.el.classList.toggle('full-roster', here.length > 5);
    const mine = here.find((p) => p.index === me);
    this.ready = !!mine?.ready;
    const key = JSON.stringify(here.map((p) => [p.index, p.name, p.ready, p.wins, p.dropped])) + me;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.list.innerHTML = '';
    for (const p of here) {
      const row = el('div', `lobby-row${p.index === me ? ' me' : ''}`, this.list);
      const identity = el('span', 'lobby-identity', row);
      const name = el('span', 'lobby-name', identity, p.name);
      name.title = p.name;
      if (p.index === me) el('span', 'rt-tag', identity, 'você');
      if (p.bot) el('span', 'rt-tag', identity, 'bot');
      if (p.wins > 0) el('span', 'lobby-wins', identity, `♛ ${p.wins}`);
      el('span', `lobby-state${p.ready ? ' on' : ''}`, row, p.dropped ? 'reconectando…' : p.ready ? 'PRONTO ✓' : 'aquecendo');
    }
    const ready = here.filter((p) => p.ready).length;
    this.hint.textContent =
      solo ? 'Os bots estão prontos. Comece quando quiser.' : here.length < 2 ? 'Mande o código para alguém entrar pelo menu (ENTRAR).' : ready === here.length ? 'Todos prontos: começando…' : `${ready} de ${here.length} prontos`;
    this.readyBtn.textContent = this.ready ? 'Cancelar pronto' : 'Estou pronto';
    this.readyBtn.classList.toggle('primary', !this.ready);
  }
}
