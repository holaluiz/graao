/**
 * Server-authoritative Ability Draft on one board: ten participants (five above, five below), a central bar with the
 * clock, round, turn and your build, the 30 basics and the 10 Ultimates always visible, and a detail panel. Inspect,
 * select locally, then confirm a secret choice; the server validates and reveals.
 */
import { ABILITIES, isAbilityId, type AbilityDefinition, type AbilityId } from '@graao/game-data';
import type { CharacterAppearance, DraftStateMsg } from '@graao/shared';
import type { Cue } from '../audio/GRAAudioManager';
import { ABILITY_ICONS } from './abilityIcons';
import { avatarPortrait } from './creatorPreviews';
import { DEFAULT_BINDINGS, keyLabel, type KeyBindings } from '../game/KeyBindings';
import { CATEGORY_INFO, abilityFacts, abilityHeadline, abilityStats, abilityTagLabels, draftCatalogSections, kindLabel } from './abilityFacts';
import { ROLE_INFO, abilityRoles, synergyHints, synergyMatches } from './abilityRoles';
import { abilityDiagram } from './abilityDiagram';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

function svg(viewBox: string, cls: string, body: string, color?: string): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = body;
  if (color) s.style.color = color;
  return s;
}

const icon = (def: AbilityDefinition, cls: string) => svg('-16 -16 32 32', cls, ABILITY_ICONS[def.presentation.icon]!, def.presentation.color);
const categoryGlyph = (def: AbilityDefinition) => svg('-8 -8 16 16', 'dc-glyph', CATEGORY_INFO[def.category].glyph);
const ORDINAL = ['1ª', '2ª', '3ª'];

/** Ownership can repeat across players, but never inside a player's own build; at most one passive. */
export function isDraftChoiceAvailable(s: DraftStateMsg, me: number, id: string | null): boolean {
  if (!id || !isAbilityId(id) || s.stage !== 'pick' || !s.pool.includes(id) || ABILITIES[id].slotType !== s.kind) return false;
  const seat = s.seats.find((x) => x.index === me);
  if (!seat?.picking || seat.picks.includes(id)) return false;
  if (ABILITIES[id].kind === 'passive' && seat.picks.some((pick) => isAbilityId(pick) && ABILITIES[pick].kind === 'passive')) return false;
  return !s.unique || !s.owners.some(([owned]) => owned === id);
}

/** A local preview survives timeout if the player has not pressed Confirm. The server validates it again. */
export function shouldAutoConfirmDraftChoice(s: DraftStateMsg, me: number, selected: string | null, sending: string | null, serverNow: number): boolean {
  const left = s.endsAt - serverNow;
  return left > 0 && left <= 200 && selected !== s.mine && sending === null && isDraftChoiceAvailable(s, me, selected);
}

/**
 * What a participant's four slots show. `confirmed` = public pick, or your own choice already sent; `preview` = your
 * local selection; `hidden` = someone else locked a secret choice; `current` = still choosing; `empty` = later round.
 * Another player's pending choice is never exposed, only their lock.
 */
export type DraftSlotState = 'empty' | 'current' | 'preview' | 'confirmed' | 'hidden';
export function draftSlots(s: DraftStateMsg, seatIndex: number, me: number, preview: string | null): { state: DraftSlotState; id: string | null }[] {
  const seat = s.seats.find((x) => x.index === seatIndex);
  return Array.from({ length: s.rounds }, (_, k) => {
    const committed = seat?.picks[k];
    if (committed) return { state: 'confirmed', id: committed };
    if (!seat || s.stage !== 'pick' || k !== s.round || !seat.picking) return { state: 'empty', id: null };
    if (seatIndex === me) {
      if (preview && preview !== s.mine) return { state: 'preview', id: preview };
      return s.mine ? { state: 'confirmed', id: s.mine } : { state: 'current', id: null };
    }
    return { state: seat.locked ? 'hidden' : 'current', id: null };
  });
}

export interface DraftActions {
  pick(round: number, id: string): void;
  sound(cue: Cue): void;
}

export class DraftScreen {
  readonly el = el('div', 'draft');
  private readonly shell = el('div', 'draft-shell', this.el);
  private readonly seatsTop = el('section', 'draft-seats top', this.shell);
  private readonly bar = el('header', 'draft-bar', this.shell);
  private readonly clock = el('div', 'draft-clock', this.bar);
  private readonly kicker = el('span', 'draft-kicker', this.clock, 'ABILITY DRAFT');
  private readonly roundEl = el('strong', 'draft-round', this.clock);
  private readonly timerText = el('strong', 'draft-timer-text', this.clock);
  private readonly timer = el('div', 'draft-timer', this.clock);
  private readonly timerFill = el('i', '', this.timer);
  private readonly turn = el('div', 'draft-turn', this.bar);
  private readonly turnTitle = el('strong', 'draft-turn-title', this.turn);
  private readonly turnSub = el('span', 'draft-turn-sub', this.turn);
  private readonly build = el('div', 'draft-build', this.bar);
  private readonly buildHead = el('div', 'draft-build-head', this.build);
  private readonly buildLabel = el('strong', '', this.buildHead, 'SUA COMBINAÇÃO');
  private readonly buildProgress = el('span', 'draft-build-progress', this.buildHead);
  private readonly buildSlots = el('div', 'draft-build-slots', this.build);
  private readonly board = el('div', 'draft-board', this.shell);
  private readonly pools = el('div', 'draft-pools', this.board);
  private readonly basicPool = el('section', 'draft-pool', this.pools);
  private readonly basicHead = el('div', 'draft-pool-head', this.basicPool);
  private readonly basicNote = el('span', 'draft-pool-note', this.basicHead);
  private readonly basicGrid = el('div', 'draft-grid basic', this.basicPool);
  private readonly ultimatePool = el('section', 'draft-pool ultimate', this.pools);
  private readonly ultimateHead = el('div', 'draft-pool-head', this.ultimatePool);
  private readonly ultimateNote = el('span', 'draft-pool-note', this.ultimateHead);
  private readonly ultimateGrid = el('div', 'draft-grid ultimate', this.ultimatePool);
  private readonly details = el('aside', 'draft-details', this.board);
  private readonly detailBody = el('div', 'draft-detail-body', this.details);
  private readonly detailHead = el('div', 'dd-head', this.detailBody);
  private readonly detailArt = el('div', 'dd-art', this.detailHead);
  private readonly detailIdentity = el('div', 'dd-identity', this.detailHead);
  private readonly detailCategory = el('div', 'dd-category', this.detailIdentity);
  private readonly detailName = el('h2', 'dd-name', this.detailIdentity);
  private readonly detailDescription = el('p', 'dd-desc', this.detailBody);
  private readonly detailStats = el('dl', 'dd-stats', this.detailBody);
  private readonly detailPreview = el('figure', 'dd-preview', this.detailBody);
  private readonly detailEffects = el('ul', 'dd-effects', this.detailBody);
  private readonly detailTags = el('div', 'dd-tags', this.detailBody);
  private readonly detailSynergy = el('div', 'dd-synergy', this.detailBody);
  private readonly actionsEl = el('div', 'draft-actions', this.details);
  private readonly statusEl = el('div', 'draft-status', this.actionsEl);
  private readonly confirm = el('button', 'draft-confirm', this.actionsEl, 'CONFIRMAR ESCOLHA');
  private readonly change = el('button', 'draft-change', this.actionsEl, 'ALTERAR SELEÇÃO');
  private readonly help = el('p', 'draft-help', this.actionsEl);
  private readonly seatsBottom = el('section', 'draft-seats bottom', this.shell);
  private state: DraftStateMsg | null = null;
  private me = -1;
  private names: (index: number) => string = (i) => `Jogador ${i + 1}`;
  private looks: (index: number) => CharacterAppearance | undefined = () => undefined;
  private selected: string | null = null;
  private inspected: string | null = null;
  private sending: string | null = null;
  private editing = false;
  private automaticPreview = false;
  private lastTick = -1;
  private windowEnds = 0;
  private windowTotal = 1;
  private detailKey = '';
  private readonly cards = new Map<AbilityId, HTMLButtonElement>();
  private keyBindings: KeyBindings = { ...DEFAULT_BINDINGS };

  constructor(private readonly actions: DraftActions) {
    this.el.hidden = true;
    this.el.setAttribute('aria-label', 'Escolha de habilidades');
    this.seatsTop.setAttribute('aria-label', 'Participantes');
    this.seatsBottom.setAttribute('aria-label', 'Participantes');
    this.build.setAttribute('aria-label', 'Sua combinação de quatro habilidades');
    this.details.setAttribute('aria-label', 'Detalhes da habilidade');
    this.turnTitle.setAttribute('role', 'status');
    this.statusEl.setAttribute('role', 'status');
    const sections = draftCatalogSections();
    el('strong', '', this.basicHead, `BÁSICAS · ${sections.basic.length}`);
    this.basicHead.prepend(this.legend());
    el('strong', '', this.ultimateHead, `SUPREMOS · ${sections.ultimate.length}`);
    this.basicHead.append(this.basicNote);
    this.ultimateHead.append(this.ultimateNote);
    this.basicGrid.setAttribute('aria-label', 'Habilidades básicas');
    this.ultimateGrid.setAttribute('aria-label', 'Supremos');
    for (const id of sections.basic) this.basicGrid.appendChild(this.card(id));
    for (const id of sections.ultimate) this.ultimateGrid.appendChild(this.card(id));
    this.pools.addEventListener('mouseleave', () => this.inspect(this.selected ?? this.state?.mine ?? this.inspected));
    this.confirm.type = this.change.type = 'button';
    this.confirm.addEventListener('click', () => this.submitSelection());
    this.change.addEventListener('click', () => this.startChange());
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  show(on: boolean): void {
    this.el.hidden = !on;
    if (!on) {
      this.state = null;
      this.detailKey = '';
      this.selected = this.inspected = this.sending = null;
      this.editing = this.automaticPreview = false;
      this.windowEnds = 0;
      this.lastTick = -1;
    }
  }

  get visible(): boolean { return !this.el.hidden; }

  setKeyBindings(bindings: KeyBindings): void {
    this.keyBindings = { ...bindings };
    if (this.state) this.renderBuild(this.state);
  }

  /** Only the server commits choices and reveals opponents' abilities. */
  setState(s: DraftStateMsg, me: number, names: (index: number) => string, looks?: (index: number) => CharacterAppearance | undefined): void {
    const prev = this.state;
    const newWindow = !prev || prev.round !== s.round || prev.endsAt !== s.endsAt || prev.stage !== s.stage;
    this.state = s;
    this.me = me;
    this.names = names;
    if (looks) this.looks = looks;
    if (newWindow) {
      this.selected = s.mine;
      this.sending = null;
      this.editing = false;
      this.automaticPreview = !!prev && prev.round === s.round && s.stage === 'reveal' && this.automaticPreview;
      this.lastTick = -1;
      this.windowEnds = 0;
      if (!prev || prev.round !== s.round || s.stage === 'reveal') {
        const revealed = s.reveal.find((x) => x.index === me)?.a;
        const current = this.inspected && isAbilityId(this.inspected) && ABILITIES[this.inspected].slotType === s.kind ? this.inspected : null;
        this.inspected = s.mine ?? revealed ?? current ?? s.pool.find((id) => isDraftChoiceAvailable(s, me, id)) ?? s.pool[0] ?? null;
        this.detailKey = '';
      }
    } else {
      if (s.mine === this.sending) {
        this.sending = null;
        this.editing = false;
      }
      if (s.mine && !this.editing && !this.sending) this.selected = s.mine;
      if (this.selected && !isDraftChoiceAvailable(s, me, this.selected)) this.selected = null;
    }
    if (prev) {
      if (s.mine && s.mine !== prev.mine) this.actions.sound('draft.lock');
      if (s.repick && !(prev.repick && prev.round === s.round)) this.actions.sound('draft.lost');
      if (s.stage === 'reveal' && prev.stage !== 'reveal') this.actions.sound('draft.reveal');
    }
    this.render();
  }

  /** Call every frame with the server clock, including the final chance to confirm a local preview. */
  update(serverNow: number): void {
    const s = this.state;
    if (!s || this.el.hidden) return;
    if (shouldAutoConfirmDraftChoice(s, this.me, this.selected, this.sending, serverNow)) this.submitSelection(true);
    const left = Math.max(0, (s.endsAt - serverNow) / 1000);
    if (s.endsAt !== this.windowEnds) {
      this.windowEnds = s.endsAt;
      this.windowTotal = Math.max(0.5, left);
    }
    this.timerFill.style.width = s.stage === 'done' ? '0%' : `${Math.min(1, left / this.windowTotal) * 100}%`;
    this.timerText.textContent = s.stage === 'pick' ? `${Math.ceil(left)} s` : s.stage === 'reveal' ? 'Revelando' : 'Pronto!';
    const urgent = this.choosing(s) && left <= 5;
    this.clock.classList.toggle('urgent', urgent);
    if (urgent) {
      const tick = Math.ceil(left);
      if (tick !== this.lastTick && tick > 0) this.actions.sound('draft.tick');
      this.lastTick = tick;
    } else this.lastTick = -1;
  }

  private choosing(s: DraftStateMsg): boolean {
    return s.stage === 'pick' && !!s.seats.find((x) => x.index === this.me)?.picking && (!s.mine || this.editing);
  }

  /** The local preview shown in your build (null once confirmed and not being changed). */
  private preview(s: DraftStateMsg): string | null {
    return !s.mine || this.editing ? this.selected : null;
  }

  private card(id: AbilityId): HTMLButtonElement {
    const def = ABILITIES[id];
    const b = el('button', 'draft-card');
    b.type = 'button';
    b.dataset.id = id;
    b.dataset.category = def.category;
    b.dataset.kind = def.kind;
    b.style.setProperty('--cat', CATEGORY_INFO[def.category].color);
    b.style.setProperty('--ab-color', def.presentation.color);
    b.style.setProperty('--ab-color2', def.presentation.color2);
    const band = el('span', 'dc-band', b);
    band.appendChild(categoryGlyph(def));
    el('span', 'dc-category', band, def.kind === 'passive' ? 'PASSIVA' : CATEGORY_INFO[def.category].label.toUpperCase());
    const art = el('span', 'dc-art', b);
    art.appendChild(icon(def, 'dc-icon'));
    el('span', 'dc-name', b, def.name);
    b.dataset.headline = abilityHeadline(def);
    el('span', 'dc-headline', b, b.dataset.headline);
    el('span', 'dc-blurb', b, def.blurb);
    const meta = el('span', 'dc-meta', b);
    if (def.kind === 'passive') el('span', 'dc-auto', meta, 'AUTOMÁTICA');
    else {
      el('span', 'dc-mana', meta, `◆ ${def.manaCost}`);
      el('span', 'dc-cd', meta, `⟳ ${String(def.cooldown).replace('.', ',')} s`);
    }
    const roles = el('span', 'dc-roles', b);
    for (const role of abilityRoles(def)) el('span', 'dc-role', roles, ROLE_INFO[role].label);
    el('span', 'dc-stamp', b);
    el('span', 'dc-syn', b, '✦');
    b.addEventListener('click', () => { this.inspect(id); this.choose(id); });
    b.addEventListener('mouseenter', () => this.inspect(id));
    b.addEventListener('focus', () => this.inspect(id));
    this.cards.set(id, b);
    return b;
  }

  private legend(): HTMLElement {
    const legend = el('span', 'draft-legend');
    for (const category of ['mobility', 'control', 'defense', 'exploration', 'passive'] as const) {
      const item = el('span', '', legend);
      item.style.setProperty('--cat', CATEGORY_INFO[category].color);
      item.appendChild(svg('-8 -8 16 16', 'dc-glyph', CATEGORY_INFO[category].glyph));
      item.append(CATEGORY_INFO[category].label);
    }
    return legend;
  }

  private onKey(e: KeyboardEvent): void {
    if (this.el.hidden || !this.state || e.altKey || e.ctrlKey || e.metaKey) return;
    const card = e.target instanceof HTMLElement ? e.target.closest<HTMLButtonElement>('.draft-card') : null;
    if (card && e.key.startsWith('Arrow')) {
      e.preventDefault();
      this.moveFocus(card, e.key);
      return;
    }
    if (e.repeat || e.key !== 'Enter') return;
    // Enter on the selected card (or outside any button) is the explicit confirm step; on another card it selects.
    if (card ? card.dataset.id === this.selected : !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      this.submitSelection();
    }
  }

  private moveFocus(card: HTMLButtonElement, key: string): void {
    const grid = card.parentElement!;
    const items = [...grid.children] as HTMLButtonElement[];
    const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
    const i = items.indexOf(card);
    const step = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -columns : key === 'ArrowDown' ? columns : 0;
    let next = items[i + step];
    // Down from the last basic row continues in the Ultimates and up from them returns to the basics.
    if (!next && (key === 'ArrowDown' || key === 'ArrowUp')) {
      const other = (grid === this.basicGrid ? this.ultimateGrid : this.basicGrid).children;
      next = (key === 'ArrowDown' ? other[Math.min(i % columns, other.length - 1)] : other[other.length - 1]) as HTMLButtonElement | undefined;
    }
    next?.focus();
  }

  /** Reopens the current round's choice (the confirmed one stands until a new confirmation). */
  private startChange(): void {
    if (!this.state || this.sending || !this.state.seats.find((x) => x.index === this.me)?.picking) return;
    this.editing = true;
    this.actions.sound('ui.click');
    this.render();
  }

  private choose(id: string): void {
    const s = this.state;
    if (!s || this.sending || (s.mine && !this.editing) || !isDraftChoiceAvailable(s, this.me, id)) return;
    this.selected = this.inspected = id;
    this.automaticPreview = false;
    this.actions.sound('ui.click');
    this.render();
  }

  private submitSelection(automatic = false): void {
    const s = this.state;
    const id = this.selected;
    if (!s || !id || this.sending || (s.mine && !this.editing) || !isDraftChoiceAvailable(s, this.me, id)) return;
    this.sending = id;
    this.automaticPreview = automatic;
    this.actions.pick(s.round, id);
    if (!automatic) this.actions.sound('ui.click');
    this.render();
  }

  private inspect(id: string | null): void {
    if (!id || id === this.inspected) return;
    this.inspected = id;
    this.renderDetails();
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    this.el.dataset.kind = s.kind;
    this.el.dataset.stage = s.stage;
    this.renderBar(s);
    this.renderBuild(s);
    this.renderCards(s);
    this.renderDetails();
    this.renderActions(s);
    this.renderSeats(s);
  }

  private renderBar(s: DraftStateMsg): void {
    const round = Math.min(s.round, s.rounds - 1);
    const seat = s.seats.find((x) => x.index === this.me);
    this.roundEl.textContent = s.stage === 'done' ? 'COMBINAÇÃO COMPLETA' : `RODADA ${round + 1} DE ${s.rounds} · ${s.kind === 'ultimate' ? 'SUPREMO' : 'BÁSICA'}`;
    const waiting = s.seats.filter((x) => x.picking && !x.locked);
    const ready = s.seats.length - waiting.length;
    const what = s.kind === 'ultimate' ? 'seu Supremo' : `sua ${ORDINAL[round] ?? `${round + 1}ª`} habilidade básica`;
    let title: string;
    let tone = 'quiet';
    if (s.stage === 'done') title = 'Combinações prontas · preparando a partida';
    else if (s.stage === 'reveal') { title = `Revelando as escolhas da rodada ${round + 1}`; tone = 'relevant'; }
    else if (!seat) title = 'Você acompanha o draft e joga a próxima partida';
    else if (this.choosing(s)) { title = `Sua vez · escolha ${what}`; tone = 'mine'; }
    else title = waiting.length ? `Escolha garantida · aguardando ${waiting.length === 1 ? this.names(waiting[0]!.index) : `${waiting.length} jogadores`}` : 'Todos escolheram';
    this.turnTitle.textContent = title;
    this.turn.dataset.tone = tone;
    const top = s.priority[0];
    const priority = s.unique && s.stage === 'pick' && top !== undefined && s.seats.length > 1 ? ` · ★ prioridade: ${top === this.me ? 'sua' : this.names(top)}` : '';
    this.turnSub.textContent = s.stage === 'pick' ? `${ready} de ${s.seats.length} confirmaram · todos escolhem ao mesmo tempo${priority}` : s.stage === 'reveal' ? 'As escolhas reveladas ficam visíveis para todos' : 'Boa partida!';
    this.basicNote.textContent = s.kind === 'basic' && s.stage !== 'done' ? `agora · ${ORDINAL[round] ?? ''} escolha` : 'rodadas 1–3';
    this.ultimateNote.textContent = s.kind === 'ultimate' && s.stage !== 'done' ? 'agora · rodada 4' : 'rodada 4';
  }

  private renderBuild(s: DraftStateMsg): void {
    const seat = s.seats.find((x) => x.index === this.me);
    const slots = draftSlots(s, this.me, this.me, this.preview(s));
    const passives = slots.filter((x) => x.id && isAbilityId(x.id) && ABILITIES[x.id].kind === 'passive' && x.state === 'confirmed').length;
    this.buildProgress.textContent = `${slots.filter((x) => x.id).length}/${s.rounds} · ${passives}/1 passiva`;
    this.buildSlots.replaceChildren();
    slots.forEach((slot, k) => {
      const id = slot.id && isAbilityId(slot.id) ? slot.id : null;
      const def = id ? ABILITIES[id] : null;
      const sent = !seat?.picks[k] && slot.state === 'confirmed';
      const box = el('div', `db-slot ${slot.state}${k === s.rounds - 1 ? ' ultimate' : ''}${sent ? ' sent' : ''}`, this.buildSlots);
      const binding = keyLabel(this.keyBindings[(['ability1', 'ability2', 'ability3', 'ultimate'] as const)[k]!]);
      el('span', 'db-key', box, def?.kind === 'passive' ? 'P' : binding);
      const art = el('span', 'db-art', box);
      if (def) art.appendChild(icon(def, 'db-icon'));
      else art.textContent = k === s.rounds - 1 ? '✦' : '+';
      const identity = el('span', 'db-identity', box);
      el('strong', 'db-name', identity, def ? def.name : slot.state === 'current' ? 'Escolha agora' : k === s.rounds - 1 ? 'Supremo' : `Básica ${k + 1}`);
      el('span', 'db-state', identity, slot.state === 'preview' ? 'Prévia · falta confirmar' : sent ? '✓ Confirmada · aguardando' : slot.state === 'confirmed' ? '✓ Confirmada' : slot.state === 'current' ? 'Sua vez' : `Rodada ${k + 1}`);
      box.title = def ? `${def.name} · ${def.kind === 'passive' ? 'passiva' : `tecla ${binding}`}` : `Rodada ${k + 1}`;
      // A confirmed choice can still be swapped while its round is open.
      if (sent && !this.editing && !this.sending) {
        const swap = el('button', 'db-swap', box, 'Trocar');
        swap.type = 'button';
        swap.addEventListener('click', () => this.startChange());
      }
    });
  }

  /** Your build for synergy: committed picks plus the choice of this round (preview or confirmed). */
  private buildIds(s: DraftStateMsg): AbilityId[] {
    return draftSlots(s, this.me, this.me, this.preview(s)).flatMap((x) => (x.id && isAbilityId(x.id) ? [x.id] : []));
  }

  private renderCards(s: DraftStateMsg): void {
    const owners = new Map(s.owners);
    const mySeat = s.seats.find((x) => x.index === this.me);
    const revealed = new Map<string, string[]>();
    for (const r of s.reveal) revealed.set(r.a, [...(revealed.get(r.a) ?? []), this.names(r.index)]);
    const passiveTaken = !!mySeat?.picks.some((pick) => isAbilityId(pick) && ABILITIES[pick].kind === 'passive');
    const build = this.buildIds(s);
    const canPick = !this.sending && (!s.mine || this.editing);
    for (const [id, b] of this.cards) {
      const def = ABILITIES[id];
      const active = def.slotType === s.kind && s.stage !== 'done';
      const owner = owners.get(id);
      const mine = !!mySeat?.picks.includes(id);
      const taken = s.unique && owner !== undefined && !mine;
      const selected = this.selected === id && s.stage === 'pick';
      const confirmed = (s.mine === id || this.sending === id) && s.stage === 'pick';
      // aria-disabled keeps every card focusable so its effects can always be inspected.
      const available = isDraftChoiceAvailable(s, this.me, id);
      b.setAttribute('aria-disabled', String(!(canPick && available)));
      b.setAttribute('aria-pressed', String(selected));
      b.classList.toggle('inactive', !active);
      b.classList.toggle('chosen', selected);
      b.classList.toggle('confirmed', confirmed);
      b.classList.toggle('sending', this.sending === id && s.mine !== id);
      b.classList.toggle('taken', taken);
      b.classList.toggle('mine', mine);
      const who = revealed.get(id);
      b.classList.toggle('revealed', !!who);
      const passiveLimit = active && def.kind === 'passive' && passiveTaken && !mine;
      b.classList.toggle('blocked', passiveLimit);
      const matches = active && available && build.length ? synergyMatches(id, build) : [];
      b.classList.toggle('synergy', matches.length > 0);
      const syn = b.querySelector('.dc-syn') as HTMLElement;
      syn.title = matches.length ? `Combina com ${[...new Set(matches.map((m) => ABILITIES[m.partner].name))].join(' e ')}` : '';
      const stamp = b.querySelector('.dc-stamp') as HTMLElement;
      stamp.textContent = mine ? 'NA SUA COMBINAÇÃO' : passiveLimit ? 'LIMITE: 1 PASSIVA' : who ? (who.length > 1 ? `${who.length} JOGADORES` : who[0]!.toUpperCase())
        : taken ? this.names(owner!) : confirmed ? 'CONFIRMADA' : selected ? 'SELECIONADA' : '';
      const state = mine ? ', já está na sua combinação' : passiveLimit ? ', indisponível: limite de uma passiva' : !active ? `, disponível na ${def.slotType === 'ultimate' ? 'rodada 4' : 'rodadas 1 a 3'}` : '';
      b.setAttribute('aria-label', `${def.name}, ${kindLabel(def).toLowerCase()}, ${b.dataset.headline}${state}${selected ? ', selecionada' : ''}${confirmed ? ', confirmada' : ''}${matches.length ? `, ${syn.title.toLowerCase()}` : ''}`);
    }
  }

  private renderDetails(): void {
    const s = this.state;
    const id = this.inspected;
    if (!s || !id || !isAbilityId(id)) return;
    const build = this.buildIds(s).filter((x) => x !== id);
    const key = `${id}|${build.join(',')}`;
    if (this.detailKey === key) return;
    this.detailKey = key;
    const def = ABILITIES[id];
    this.details.style.setProperty('--cat', CATEGORY_INFO[def.category].color);
    this.details.style.setProperty('--ab-color', def.presentation.color);
    this.details.style.setProperty('--ab-color2', def.presentation.color2);
    this.detailArt.replaceChildren(icon(def, 'dd-icon'));
    this.detailCategory.replaceChildren(categoryGlyph(def), `${CATEGORY_INFO[def.category].label} · ${kindLabel(def)}`);
    this.detailName.textContent = def.name;
    this.detailDescription.textContent = def.blurb;
    this.detailStats.replaceChildren();
    for (const stat of abilityStats(def)) {
      const box = el('div', `dd-stat ${stat.key}`, this.detailStats);
      el('dt', '', box, stat.label);
      el('dd', '', box, stat.value);
    }
    const diagram = abilityDiagram(def);
    this.detailPreview.innerHTML = diagram.svg;
    this.detailPreview.style.color = def.presentation.color;
    el('figcaption', '', this.detailPreview, diagram.caption);
    this.detailEffects.replaceChildren();
    if (def.kind === 'passive') el('li', '', this.detailEffects, 'Automática: não usa tecla nem Mana');
    for (const fact of abilityFacts(def)) el('li', '', this.detailEffects, fact.text);
    this.detailTags.replaceChildren();
    for (const role of abilityRoles(def)) {
      const chip = el('span', 'dd-role', this.detailTags, ROLE_INFO[role].label);
      chip.title = ROLE_INFO[role].hint;
    }
    for (const label of abilityTagLabels(def)) el('span', 'dd-tag', this.detailTags, label);
    this.renderSynergy(id, build);
  }

  private renderSynergy(id: AbilityId, build: AbilityId[]): void {
    this.detailSynergy.replaceChildren();
    const matches = synergyMatches(id, build);
    const hints = synergyHints(id);
    if (!matches.length && !hints.length) {
      this.detailSynergy.hidden = true;
      return;
    }
    this.detailSynergy.hidden = false;
    el('strong', 'dd-syn-title', this.detailSynergy, matches.length ? '✦ COMBINA COM SUA COMBINAÇÃO' : 'SINERGIAS POSSÍVEIS');
    const lines = el('ul', '', this.detailSynergy);
    if (matches.length) {
      for (const m of matches.slice(0, 3)) {
        const li = el('li', '', lines);
        el('b', '', li, ABILITIES[m.partner].name);
        li.append(` · ${ROLE_INFO[m.candidateRole].label} + ${ROLE_INFO[m.partnerRole].label}: ${m.synergy.text}`);
      }
    } else {
      for (const h of hints.slice(0, 2)) el('li', '', lines, `${ROLE_INFO[h.has].label} + ${ROLE_INFO[h.wants].label}: ${h.synergy.text}`);
    }
    el('span', 'dd-syn-note', this.detailSynergy, 'Sugestão opcional: nenhuma combinação dá bônus.');
  }

  private renderActions(s: DraftStateMsg): void {
    const seat = s.seats.find((x) => x.index === this.me);
    const choosing = s.stage === 'pick' && !!seat?.picking;
    const confirmed = !!s.mine && !this.editing;
    const valid = isDraftChoiceAvailable(s, this.me, this.selected);
    const selectedName = this.selected && isAbilityId(this.selected) ? ABILITIES[this.selected].name : '';
    let text: string;
    let tone = 'quiet';
    if (!seat) text = 'Você acompanha o draft e joga a próxima partida.';
    else if (s.stage === 'done') text = 'Combinação pronta. Preparando a partida…';
    else if (s.stage === 'reveal') {
      const result = s.reveal.find((r) => r.index === this.me);
      text = result && isAbilityId(result.a)
        ? result.auto ? `Tempo esgotado: ${ABILITIES[result.a].name} foi escolhida automaticamente.`
          : this.automaticPreview ? `Tempo esgotado: sua seleção, ${ABILITIES[result.a].name}, foi confirmada automaticamente.`
            : `${ABILITIES[result.a].name} entrou na sua combinação!`
        : 'Revelando as escolhas da rodada…';
      tone = 'relevant';
    } else if (!choosing) text = 'Sua habilidade já está garantida. Aguardando os outros jogadores…';
    else if (this.sending) text = this.automaticPreview ? 'Tempo no fim: confirmando sua seleção automaticamente…' : 'Enviando sua escolha…';
    else if (confirmed) text = this.automaticPreview ? 'Sua seleção foi confirmada ao fim do tempo. Aguardando a rodada…' : 'Escolha confirmada! Aguardando a rodada…';
    else if (s.repick && s.lostTo) {
      const what = isAbilityId(s.lostTo.a) ? ABILITIES[s.lostTo.a].name : s.lostTo.a;
      text = `${this.names(s.lostTo.index)} tinha prioridade e ficou com ${what}. Escolha outra habilidade.`;
      tone = 'urgent';
    } else text = this.selected ? `${selectedName} selecionada. Confirme para esta rodada.` : `Toque ou clique numa ${s.kind === 'ultimate' ? 'carta de Supremo' : 'carta básica'} e confirme.`;
    this.statusEl.textContent = text;
    this.statusEl.dataset.tone = tone;
    this.confirm.hidden = !choosing || confirmed;
    this.confirm.disabled = !valid || !!this.sending;
    this.confirm.textContent = this.sending ? 'CONFIRMANDO…' : 'CONFIRMAR ESCOLHA';
    this.change.hidden = !choosing || !confirmed;
    this.change.disabled = !!this.sending;
    this.help.textContent = s.stage !== 'pick' ? 'As habilidades reveladas ficam visíveis para todos.'
      : confirmed ? 'Você pode alterar enquanto esta rodada estiver aberta.'
        : 'Setas navegam, Enter confirma. Máximo: 1 passiva. Sem confirmar, a seleção vale ao fim do tempo.';
  }

  private renderSeats(s: DraftStateMsg): void {
    const ordered = [...s.seats].sort((a, b) => (a.index === this.me ? -1 : b.index === this.me ? 1 : a.index - b.index));
    const half = Math.ceil(ordered.length / 2);
    const fresh = new Map(s.reveal.map((r) => [r.index, r]));
    const row = (target: HTMLElement, seats: typeof ordered) => {
      target.replaceChildren();
      for (const seat of seats) {
        const confirmed = seat.locked || !seat.picking;
        const me = seat.index === this.me;
        const box = el('div', `draft-seat${me ? ' me' : ''}${confirmed ? ' ready' : ' picking'}`, target);
        box.title = this.names(seat.index);
        const avatar = el('div', 'ds-avatar', box);
        const look = this.looks(seat.index);
        if (look) avatar.innerHTML = avatarPortrait(look);
        const id = el('div', 'ds-id', box);
        el('strong', 'ds-name', id, me ? `${this.names(seat.index)} · você` : this.names(seat.index));
        el('span', 'ds-status', id, s.stage === 'pick' ? seat.picking ? seat.locked ? '✓ Confirmou' : 'Escolhendo…' : '✓ Garantida' : s.stage === 'done' ? '✓ Pronto' : '✓ Revelado');
        const slots = el('div', 'ds-slots', box);
        const reveal = fresh.get(seat.index);
        draftSlots(s, seat.index, this.me, me ? this.preview(s) : null).forEach((slot, k) => {
          const def = slot.id && isAbilityId(slot.id) ? ABILITIES[slot.id] : null;
          const cell = el('div', `ds-slot ${slot.state}${k === s.rounds - 1 ? ' ult' : ''}`, slots);
          if (def) {
            cell.appendChild(icon(def, 'ds-icon'));
            cell.title = `${def.name}${slot.state === 'preview' ? ' (prévia)' : ''}`;
            if (reveal && reveal.a === slot.id && k === s.round) {
              cell.classList.add('fresh');
              if (reveal.auto) { cell.classList.add('auto'); cell.title += ' · escolhida ao fim do tempo'; }
            }
          } else if (slot.state === 'hidden') {
            el('span', 'ds-lock', cell, '?');
            cell.title = 'Escolha confirmada e oculta até a revelação';
          } else if (slot.state === 'current') {
            el('span', 'ds-lock', cell, '…');
            cell.title = 'Escolhendo';
          } else cell.textContent = k === s.rounds - 1 ? '✦' : String(k + 1);
        });
      }
    };
    row(this.seatsTop, ordered.slice(0, half));
    row(this.seatsBottom, ordered.slice(half));
  }
}
