/**
 * Ability Draft screen (DOM/CSS/SVG over the live world). It only shows the server's DRAFT_STATE and sends picks;
 * the server owns rounds, timers, priority, conflicts and the final loadouts.
 *
 *   top      round ("Rodada 2 de 4 · Básica"), a timer bar, who has priority this round
 *   centre   the round's cards: shape icon, name, description, Mana, cooldown, tags; taken cards carry the owner's
 *            name, your hidden choice shows a lock (opponents only ever see THAT you chose, never what)
 *   bottom   every player's four slots filling up round by round (the 4th is the Ultimate)
 *
 * Keys 1–8 choose the matching card; a click works too. Attention: the status line is QUIET while waiting, URGENT
 * once when a disputed ability goes to someone else (pick again), and the timer turns urgent in its last seconds.
 */
import { ABILITIES, isAbilityId, type AbilityDefinition } from '@graao/game-data';
import type { DraftStateMsg } from '@graao/shared';
import type { Cue } from '../audio/GRAAudioManager';
import { ABILITY_ICONS } from './abilityIcons';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

function icon(def: AbilityDefinition, cls: string): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('viewBox', '-16 -16 32 32');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ABILITY_ICONS[def.presentation.icon];
  s.style.color = def.presentation.color;
  return s;
}

const TAGS: Record<string, string> = {
  projectile: 'Projétil',
  damage: 'Dano',
  area: 'Área',
  slow: 'Lentidão',
  dash: 'Avanço',
  mobility: 'Mobilidade',
  defensive: 'Defesa',
  shield: 'Escudo',
  heal: 'Cura',
  knockback: 'Empurrão',
};

const seconds = (s: number) => `${(Math.round(s * 10) / 10).toString().replace('.', ',')} s`;

export interface DraftActions {
  pick(round: number, id: string): void;
  sound(cue: Cue): void;
}

export class DraftScreen {
  readonly el = el('div', 'draft');
  private readonly head = el('div', 'draft-head', this.el);
  private readonly kicker = el('div', 'draft-kicker', this.head, 'DRAFT DE HABILIDADES');
  private readonly title = el('div', 'draft-title', this.head);
  private readonly timer = el('div', 'draft-timer', this.head);
  private readonly timerFill = el('i', '', this.timer);
  private readonly timerText = el('div', 'draft-timer-text', this.head);
  private readonly priorityEl = el('div', 'draft-priority', this.head);
  private readonly statusEl = el('div', 'draft-status', this.el);
  private readonly cardsEl = el('div', 'draft-cards', this.el);
  private readonly seatsEl = el('div', 'draft-seats', this.el);
  private state: DraftStateMsg | null = null;
  private me = -1;
  private names: (index: number) => string = (i) => `Jogador ${i + 1}`;
  private sending: string | null = null;
  private lastTick = -1;
  private windowEnds = 0;
  private windowTotal = 1;
  private cardKey = '';
  private readonly cards = new Map<string, HTMLButtonElement>();

  constructor(private readonly actions: DraftActions) {
    this.el.hidden = true;
    window.addEventListener('keydown', (e) => {
      if (this.el.hidden || e.repeat || !this.state) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > this.state.pool.length) return;
      e.preventDefault();
      this.choose(this.state.pool[n - 1]!);
    });
  }

  show(on: boolean): void {
    this.el.hidden = !on;
    if (!on) {
      this.state = null;
      this.cardKey = '';
    }
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  /** New server state for this player. Plays the cue for what changed (lock, conflict lost, reveal). */
  setState(s: DraftStateMsg, me: number, names: (index: number) => string): void {
    const prev = this.state;
    this.state = s;
    this.me = me;
    this.names = names;
    this.sending = null;
    if (prev) {
      if (s.mine && s.mine !== prev.mine) this.actions.sound('draft.lock');
      if (s.repick && !(prev.repick && prev.round === s.round)) this.actions.sound('draft.lost');
      if (s.stage === 'reveal' && prev.stage !== 'reveal') this.actions.sound('draft.reveal');
    }
    this.render();
  }

  /** Timer and urgency; call every frame with the server clock. */
  update(serverNow: number): void {
    const s = this.state;
    if (!s || this.el.hidden) return;
    const left = Math.max(0, (s.endsAt - serverNow) / 1000);
    // The bar spans the window as first seen (a pick window, a repick window, or the reveal).
    if (s.endsAt !== this.windowEnds) {
      this.windowEnds = s.endsAt;
      this.windowTotal = Math.max(0.5, left);
    }
    this.timerFill.style.width = s.stage === 'done' ? '0%' : `${Math.min(1, left / this.windowTotal) * 100}%`;
    const mySeat = s.seats.find((x) => x.index === this.me);
    const choosing = s.stage === 'pick' && !!mySeat?.picking && !s.mine;
    this.timerText.textContent = s.stage === 'pick' ? `${Math.ceil(left)} s` : s.stage === 'reveal' ? 'revelando' : '';
    const urgent = choosing && left <= 3.5;
    this.timer.classList.toggle('urgent', urgent);
    if (urgent) {
      const tick = Math.ceil(left);
      if (tick !== this.lastTick && tick > 0) this.actions.sound('draft.tick');
      this.lastTick = tick;
    } else this.lastTick = -1;
  }

  private choose(id: string): void {
    const s = this.state;
    if (!s || s.stage !== 'pick') return;
    const seat = s.seats.find((x) => x.index === this.me);
    if (!seat?.picking) return;
    const card = this.cards.get(id);
    if (!card || card.disabled) return;
    this.sending = id;
    this.actions.pick(s.round, id);
    this.actions.sound('ui.click');
    this.render();
  }

  // ------------------------------------------------------------------------------------------------ render

  private render(): void {
    const s = this.state;
    if (!s) return;
    const mySeat = s.seats.find((x) => x.index === this.me);
    const spectator = !mySeat;
    const round = Math.min(s.round, s.rounds - 1);
    this.el.dataset.kind = s.kind;
    this.el.dataset.stage = s.stage;
    this.title.textContent = s.stage === 'done' ? 'Draft completo!' : `Rodada ${round + 1} de ${s.rounds} · ${s.kind === 'ultimate' ? 'Suprema' : 'Básica'}`;
    const top = s.priority[0];
    this.priorityEl.hidden = s.stage === 'done' || top === undefined || s.seats.length < 2;
    this.priorityEl.classList.toggle('mine', top === this.me);
    this.priorityEl.textContent = top === this.me ? '★ Você tem prioridade nesta rodada' : `★ Prioridade: ${this.names(top ?? 0)}`;
    this.renderStatus(s, spectator);
    this.renderCards(s, spectator);
    this.renderSeats(s);
  }

  private renderStatus(s: DraftStateMsg, spectator: boolean): void {
    const mySeat = s.seats.find((x) => x.index === this.me);
    const waitingFor = s.seats.filter((x) => x.picking && !x.locked && x.index !== this.me).map((x) => this.names(x.index));
    let text: string;
    let tone = 'quiet';
    if (spectator) text = 'Você entrou durante o draft: joga a próxima partida.';
    else if (s.stage === 'done') text = 'Preparando a partida…';
    else if (s.stage === 'reveal') {
      const mine = s.reveal.find((r) => r.index === this.me);
      text = mine && isAbilityId(mine.a) ? `Você ficou com ${ABILITIES[mine.a].name}${mine.auto ? ' (escolhida pelo tempo)' : ''}` : 'Rodada revelada';
      tone = 'relevant';
    } else if (s.repick && s.lostTo) {
      const what = isAbilityId(s.lostTo.a) ? ABILITIES[s.lostTo.a].name : s.lostTo.a;
      text = s.mine ? `Nova escolha travada · aguardando…` : `${this.names(s.lostTo.index)} ficou com ${what} (tinha prioridade). Escolha outra!`;
      tone = s.mine ? 'quiet' : 'urgent';
    } else if (!mySeat?.picking) text = waitingFor.length ? `Aguardando ${waitingFor.join(', ')}…` : 'Resolvendo a rodada…';
    else if (s.mine || this.sending) text = waitingFor.length ? `Escolha travada · aguardando ${waitingFor.join(', ')}…` : 'Escolha travada';
    else text = s.kind === 'ultimate' ? 'Escolha sua Suprema (tecla 4 na partida)' : `Escolha uma magia básica (tecla ${s.round + 1} na partida) · clique ou teclas 1–${s.pool.length}`;
    if (this.statusEl.textContent !== text) {
      this.statusEl.textContent = text;
      if (tone !== 'quiet') {
        this.statusEl.classList.remove('pop');
        void this.statusEl.offsetWidth;
        this.statusEl.classList.add('pop');
      }
    }
    this.statusEl.dataset.tone = tone;
  }

  private renderCards(s: DraftStateMsg, spectator: boolean): void {
    const key = `${s.round}|${s.pool.join(',')}`;
    if (key !== this.cardKey) {
      this.cardKey = key;
      this.cardsEl.innerHTML = '';
      this.cards.clear();
      s.pool.forEach((id, i) => {
        if (!isAbilityId(id)) return;
        const def = ABILITIES[id];
        const b = el('button', 'draft-card', this.cardsEl);
        b.type = 'button';
        b.style.setProperty('--ab-color', def.presentation.color);
        b.style.setProperty('--ab-color2', def.presentation.color2);
        el('span', 'dc-key', b, String(i + 1));
        const art = el('span', 'dc-art', b);
        art.appendChild(icon(def, 'dc-icon'));
        el('span', 'dc-name', b, def.name);
        el('span', 'dc-blurb', b, def.blurb);
        const stats = el('span', 'dc-stats', b);
        el('span', 'dc-mana', stats, `◆ ${def.manaCost}`);
        el('span', 'dc-cd', stats, `⟳ ${seconds(def.cooldown)}`);
        const tags = el('span', 'dc-tags', b);
        for (const t of def.tags) if (TAGS[t]) el('span', 'dc-tag', tags, TAGS[t]);
        el('span', 'dc-stamp', b);
        b.addEventListener('click', () => this.choose(id));
        this.cards.set(id, b);
      });
    }
    const owners = new Map(s.owners);
    const mySeat = s.seats.find((x) => x.index === this.me);
    const revealed = new Map(s.reveal.map((r) => [r.a, r]));
    for (const [id, b] of this.cards) {
      const owner = owners.get(id);
      const mine = owner === this.me;
      const taken = owner !== undefined && (s.unique || mine);
      const chosen = s.mine === id || this.sending === id;
      const canPick = !spectator && s.stage === 'pick' && !!mySeat?.picking && !taken;
      b.disabled = !canPick;
      b.classList.toggle('chosen', chosen && s.stage === 'pick');
      b.classList.toggle('sending', this.sending === id && s.mine !== id);
      b.classList.toggle('taken', taken && !mine);
      b.classList.toggle('mine', mine);
      const rev = revealed.get(id);
      b.classList.toggle('revealed', !!rev);
      b.classList.toggle('contested', !!rev?.contested);
      const stamp = b.querySelector('.dc-stamp') as HTMLElement;
      stamp.textContent = mine ? 'SUA' : taken ? this.names(owner!) : chosen && s.stage === 'pick' ? 'TRAVADA' : '';
      b.setAttribute('aria-label', `${ABILITIES[id as keyof typeof ABILITIES]?.name ?? id}${taken ? `, já é de ${mine ? 'você' : this.names(owner!)}` : ''}${chosen ? ', sua escolha' : ''}`);
    }
  }

  private renderSeats(s: DraftStateMsg): void {
    this.seatsEl.innerHTML = '';
    const ordered = [...s.seats].sort((a, b) => (a.index === this.me ? -1 : b.index === this.me ? 1 : a.index - b.index));
    for (const seat of ordered) {
      const row = el('div', `draft-seat${seat.index === this.me ? ' me' : ''}`, this.seatsEl);
      el('div', 'ds-name', row, seat.index === this.me ? 'Você' : this.names(seat.index));
      const slots = el('div', 'ds-slots', row);
      for (let k = 0; k < s.rounds; k++) {
        const slot = el('div', `ds-slot${k === s.rounds - 1 ? ' ult' : ''}`, slots);
        el('span', 'ds-key', slot, String(k + 1));
        const id = seat.picks[k];
        if (id && isAbilityId(id)) {
          slot.classList.add('filled');
          slot.appendChild(icon(ABILITIES[id], 'ds-icon'));
          slot.title = ABILITIES[id].name;
        } else if (k === s.round && s.stage === 'pick' && seat.picking) {
          slot.classList.add('current');
          const pending = seat.index === this.me ? s.mine : null;
          if (pending && isAbilityId(pending)) {
            slot.appendChild(icon(ABILITIES[pending], 'ds-icon ghost'));
          } else if (seat.locked) el('span', 'ds-lock', slot, '✓');
          else el('span', 'ds-wait', slot, '…');
        }
      }
    }
  }
}
