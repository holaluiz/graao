/** Server-authoritative ability draft: inspect, select locally, then confirm a secret choice. */
import { ABILITIES, isAbilityId, type AbilityDefinition, type AbilityEffect } from '@graao/game-data';
import type { CharacterAppearance, DraftStateMsg } from '@graao/shared';
import type { Cue } from '../audio/GRAAudioManager';
import { ABILITY_ICONS } from './abilityIcons';
import { avatarPortrait } from './creatorPreviews';
import { DEFAULT_BINDINGS, keyLabel, type KeyBindings } from '../game/KeyBindings';

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
  projectile: 'Projétil', damage: 'Dano', area: 'Área', slow: 'Lentidão', dash: 'Avanço',
  mobility: 'Mobilidade', defensive: 'Defesa', shield: 'Escudo', heal: 'Cura', knockback: 'Empurrão',
};
const number = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
const seconds = (n: number) => `${number(n)} s`;
const CATEGORIES = { all: 'Todas', mobility: 'Mobilidade', control: 'Controle', defense: 'Defesa', exploration: 'Exploração', passive: 'Passivas', ultimate: 'Supremos' } as const;
type Category = keyof typeof CATEGORIES;

/** The same page powers keyboard selection and cards, so hidden pages cannot be selected by accident. */
export function draftCatalogPage(pool: readonly string[], category: Category, page: number, size: number): { ids: string[]; page: number; pages: number; total: number } {
  const filtered = pool.filter((id) => isAbilityId(id) && (category === 'all' || ABILITIES[id].category === category));
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.max(0, Math.min(page, pages - 1));
  return { ids: filtered.slice(current * size, (current + 1) * size), page: current, pages, total: filtered.length };
}

/** Ownership can repeat across players in larger rooms, but never inside a player's own build. */
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

function effectFacts(effects: readonly AbilityEffect[]): string[] {
  return effects.flatMap((e): string[] => {
    switch (e.kind) {
      case 'damage': return [`${number(e.amount)} de dano`];
      case 'heal': return [`Recupera ${number(e.amount)} de vida`];
      case 'shield': return [`Recupera ${number(e.amount)} de escudo`];
      case 'slow': return [`Reduz a velocidade em ${number((1 - e.factor) * 100)}% por ${seconds(e.duration)}`];
      case 'dash': return [`Avança ${number(e.distance)} m em ${seconds(e.duration)}`];
      case 'knockback': return ['Empurra e levanta os alvos atingidos'];
      case 'projectile': return effectFacts(e.onHit);
      case 'area': return [
        `Área de ${number(e.radius)} m de raio${e.delay ? ` · aviso de ${seconds(e.delay)}` : ''}${e.pulses > 1 ? ` · ${e.pulses} pulsos` : ''}`,
        ...effectFacts(e.effects),
      ];
      default: return [];
    }
  });
}

export interface DraftActions {
  pick(round: number, id: string): void;
  sound(cue: Cue): void;
}

export class DraftScreen {
  readonly el = el('div', 'draft');
  private readonly shell = el('div', 'draft-shell', this.el);
  private readonly head = el('header', 'draft-head', this.shell);
  private readonly heading = el('div', 'draft-heading', this.head);
  private readonly kicker = el('div', 'draft-kicker', this.heading, 'ABILITY DRAFT');
  private readonly title = el('h1', 'draft-title', this.heading, 'Escolha suas habilidades');
  private readonly subtitle = el('p', 'draft-subtitle', this.heading, '3 básicas + 1 Supremo, uma por rodada. Clique numa carta, confira os detalhes e confirme.');
  private readonly clock = el('div', 'draft-clock', this.head);
  private readonly roundEl = el('div', 'draft-round', this.clock);
  private readonly timerText = el('strong', 'draft-timer-text', this.clock);
  private readonly timer = el('div', 'draft-timer', this.clock);
  private readonly timerFill = el('i', '', this.timer);
  private readonly build = el('section', 'draft-build', this.shell);
  private readonly buildHead = el('div', 'draft-build-head', this.build);
  private readonly buildLabel = el('strong', '', this.buildHead, 'SUA COMBINAÇÃO');
  private readonly buildProgress = el('span', 'draft-build-progress', this.buildHead);
  private readonly buildSlots = el('div', 'draft-build-slots', this.build);
  private readonly workspace = el('div', 'draft-workspace', this.shell);
  private readonly catalogue = el('section', 'draft-catalogue', this.workspace);
  private readonly catalogueHead = el('div', 'draft-catalogue-head', this.catalogue);
  private readonly catalogueTitle = el('strong', '', this.catalogueHead);
  private readonly priorityEl = el('span', 'draft-priority', this.catalogueHead);
  private readonly filters = el('nav', 'draft-filters', this.catalogue);
  private readonly cardsEl = el('div', 'draft-cards', this.catalogue);
  private readonly pagination = el('nav', 'draft-pagination', this.catalogue);
  private readonly details = el('aside', 'draft-details', this.workspace);
  private readonly detailBody = el('div', 'draft-detail-body', this.details);
  private readonly detailHead = el('div', 'draft-detail-head', this.detailBody);
  private readonly detailArt = el('div', 'draft-detail-art', this.detailHead);
  private readonly detailIdentity = el('div', 'draft-detail-identity', this.detailHead);
  private readonly detailCategory = el('div', 'draft-detail-category', this.detailIdentity);
  private readonly detailName = el('h2', 'draft-detail-name', this.detailIdentity);
  private readonly detailDescription = el('p', 'draft-detail-description', this.detailBody);
  private readonly detailStats = el('div', 'draft-detail-stats', this.detailBody);
  private readonly detailEffects = el('ul', 'draft-detail-effects', this.detailBody);
  private readonly detailTags = el('div', 'dc-tags', this.detailBody);
  private readonly actionsEl = el('div', 'draft-actions', this.details);
  private readonly statusEl = el('div', 'draft-status', this.actionsEl);
  private readonly confirm = el('button', 'draft-confirm', this.actionsEl, 'CONFIRMAR ESCOLHA');
  private readonly change = el('button', 'draft-change', this.actionsEl, 'ALTERAR SELEÇÃO');
  private readonly help = el('p', 'draft-help', this.actionsEl);
  private readonly participants = el('section', 'draft-participants', this.shell);
  private readonly participantsHead = el('div', 'draft-participants-head', this.participants);
  private readonly participantsLabel = el('strong', '', this.participantsHead, 'NA PARTIDA');
  private readonly participantsProgress = el('span', '', this.participantsHead);
  private readonly seatsEl = el('div', 'draft-seats', this.participants);
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
  private cardKey = '';
  private detailKey = '';
  private readonly cards = new Map<string, HTMLButtonElement>();
  private keyBindings: KeyBindings = { ...DEFAULT_BINDINGS };
  private category: Category = 'all';
  private page = 0;
  private visibleIds: string[] = [];
  private readonly small = window.matchMedia('(max-width: 560px), (max-height: 620px)');

  constructor(private readonly actions: DraftActions) {
    this.el.hidden = true;
    this.el.setAttribute('aria-label', 'Escolha de habilidades');
    this.build.setAttribute('aria-label', 'Sua combinação de quatro habilidades');
    this.cardsEl.setAttribute('aria-label', 'Habilidades disponíveis');
    this.filters.setAttribute('aria-label', 'Categorias de magias');
    this.pagination.setAttribute('aria-label', 'Páginas de magias');
    this.small.addEventListener('change', () => { this.cardKey = ''; this.render(); });
    this.statusEl.setAttribute('role', 'status');
    this.confirm.type = this.change.type = 'button';
    this.confirm.addEventListener('click', () => this.submitSelection());
    this.change.addEventListener('click', () => this.startChange());
    window.addEventListener('keydown', (e) => {
      if (this.el.hidden || e.repeat || !this.state || e.altKey || e.ctrlKey || e.metaKey) return;
      // Enter is the explicit confirm step; digits only select a preview.
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        this.submitSelection();
        return;
      }
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > this.visibleIds.length) return;
      e.preventDefault();
      this.choose(this.visibleIds[n - 1]!);
    });
  }

  show(on: boolean): void {
    this.el.hidden = !on;
    if (!on) {
      this.state = null;
      this.cardKey = this.detailKey = '';
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
      if (!prev || prev.round !== s.round) { this.category = s.kind === 'ultimate' ? 'ultimate' : 'all'; this.page = 0; }
      this.selected = s.mine;
      this.sending = null;
      this.editing = false;
      this.automaticPreview = !!prev && prev.round === s.round && s.stage === 'reveal' && this.automaticPreview;
      this.lastTick = -1;
      this.windowEnds = 0;
      const revealed = s.reveal.find((x) => x.index === me)?.a;
      this.inspected = s.mine ?? revealed ?? s.pool.find((id) => isDraftChoiceAvailable(s, me, id)) ?? s.pool[0] ?? null;
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
    const choosing = s.stage === 'pick' && !!s.seats.find((x) => x.index === this.me)?.picking && (!s.mine || this.editing);
    const urgent = choosing && left <= 5;
    this.clock.classList.toggle('urgent', urgent);
    if (urgent) {
      const tick = Math.ceil(left);
      if (tick !== this.lastTick && tick > 0) this.actions.sound('draft.tick');
      this.lastTick = tick;
    } else this.lastTick = -1;
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

  private inspect(id: string): void {
    this.inspected = id;
    this.renderDetails();
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    const round = Math.min(s.round, s.rounds - 1);
    this.el.dataset.kind = s.kind;
    this.el.dataset.stage = s.stage;
    this.roundEl.textContent = s.stage === 'done' ? 'COMBINAÇÃO COMPLETA' : `RODADA ${round + 1} DE ${s.rounds} · ${s.kind === 'ultimate' ? 'SUPREMO' : 'BÁSICA'}`;
    this.catalogueTitle.textContent = s.stage === 'done' ? 'Tudo pronto para a partida' : s.kind === 'ultimate' ? 'Agora: escolha seu Supremo' : `Agora: escolha sua ${round + 1}ª habilidade básica`;
    const top = s.priority[0];
    this.priorityEl.hidden = !s.unique || s.stage === 'done' || top === undefined || s.seats.length < 2;
    this.priorityEl.classList.toggle('mine', top === this.me);
    this.priorityEl.textContent = top === this.me ? '★ Sua prioridade' : `★ Prioridade: ${this.names(top ?? 0)}`;
    this.renderBuild(s);
    this.renderFilters(s);
    this.renderCards(s);
    this.renderDetails();
    this.renderActions(s);
    this.renderSeats(s);
  }

  private renderBuild(s: DraftStateMsg): void {
    const seat = s.seats.find((x) => x.index === this.me);
    const pending = this.selected ?? s.mine;
    const complete = seat?.picks.length ?? 0;
    const selectedCount = complete + (s.stage === 'pick' && seat?.picking && pending ? 1 : 0);
    const passives = seat?.picks.filter((id) => isAbilityId(id) && ABILITIES[id].kind === 'passive').length ?? 0;
    this.buildProgress.textContent = `${selectedCount}/${s.rounds} selecionadas · ${passives}/1 passiva`;
    this.buildSlots.replaceChildren();
    for (let k = 0; k < s.rounds; k++) {
      const current = s.stage === 'pick' && k === s.round && !!seat?.picking;
      const committed = seat?.picks[k];
      const id = committed ?? (current ? pending : null);
      const slot = el('div', `draft-build-slot${k === s.rounds - 1 ? ' ultimate' : ''}${current ? ' current' : ''}${committed ? ' filled' : ''}`, this.buildSlots);
      const passive = !!id && isAbilityId(id) && ABILITIES[id].kind === 'passive';
      const binding = keyLabel(this.keyBindings[(['ability1', 'ability2', 'ability3', 'ultimate'] as const)[k]!]);
      el('span', 'db-key', slot, passive ? 'P' : binding);
      const art = el('span', 'db-art', slot);
      if (id && isAbilityId(id)) art.appendChild(icon(ABILITIES[id], 'db-icon'));
      else art.textContent = k === s.rounds - 1 ? '✦' : '+';
      const identity = el('div', 'db-identity', slot);
      el('span', 'db-kind', identity, passive ? 'PASSIVA · AUTOMÁTICA' : `${k === s.rounds - 1 ? 'SUPREMO' : `BÁSICA ${k + 1}`} · ${binding}`);
      el('strong', 'db-name', identity, id && isAbilityId(id) ? ABILITIES[id].name : current ? 'Escolha agora' : 'A escolher');
      el('span', 'db-state', identity, committed ? '✓ Confirmada' : current && id ? s.mine && !this.editing ? '✓ Confirmada · aguardando' : 'Prévia · falta confirmar' : current ? 'Sua vez de escolher' : `Rodada ${k + 1}`);
      // A confirmed choice can still be swapped while its round is open.
      if (current && s.mine && !this.editing && !this.sending) {
        const swap = el('button', 'db-swap', slot, 'Trocar');
        swap.type = 'button';
        swap.addEventListener('click', () => this.startChange());
      }
    }
  }

  private renderFilters(s: DraftStateMsg): void {
    this.filters.replaceChildren();
    const categories: Category[] = s.kind === 'ultimate' ? ['ultimate'] : ['all', 'mobility', 'control', 'defense', 'exploration', 'passive'];
    for (const category of categories) {
      const button = el('button', '', this.filters, CATEGORIES[category]);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(this.category === category));
      button.addEventListener('click', () => { this.category = category; this.page = 0; this.render(); });
    }
  }

  private renderCards(s: DraftStateMsg): void {
    const size = this.small.matches ? 4 : 6;
    const page = draftCatalogPage(s.pool, this.category, this.page, size);
    this.page = page.page;
    this.visibleIds = page.ids;
    this.pagination.replaceChildren();
    const previous = el('button', '', this.pagination, '←');
    previous.type = 'button'; previous.disabled = page.page === 0; previous.setAttribute('aria-label', 'Página anterior de magias');
    previous.addEventListener('click', () => { this.page--; this.render(); });
    el('span', '', this.pagination, `${page.page + 1} / ${page.pages} · ${page.total} magias`);
    const next = el('button', '', this.pagination, '→');
    next.type = 'button'; next.disabled = page.page + 1 >= page.pages; next.setAttribute('aria-label', 'Próxima página de magias');
    next.addEventListener('click', () => { this.page++; this.render(); });
    const key = `${s.round}|${this.category}|${this.page}|${page.ids.join(',')}`;
    if (key !== this.cardKey) {
      this.cardKey = key;
      this.cardsEl.replaceChildren();
      this.cards.clear();
      page.ids.forEach((id, i) => {
        if (!isAbilityId(id)) return;
        const def = ABILITIES[id];
        const b = el('button', 'draft-card', this.cardsEl);
        b.type = 'button';
        b.style.setProperty('--ab-color', def.presentation.color);
        b.style.setProperty('--ab-color2', def.presentation.color2);
        el('span', 'dc-key', b, String(i + 1));
        const art = el('span', 'dc-art', b);
        art.appendChild(icon(def, 'dc-icon'));
        el('span', 'dc-category', b, CATEGORIES[def.category]);
        el('span', 'dc-name', b, def.name);
        el('span', 'dc-blurb', b, def.blurb);
        const stats = el('span', 'dc-stats', b);
        if (def.kind === 'passive') el('span', 'dc-mana', stats, 'PASSIVA · AUTOMÁTICA');
        else {
          el('span', 'dc-mana', stats, `◆ ${def.manaCost} mana`);
          el('span', 'dc-cd', stats, `⟳ ${seconds(def.cooldown)}`);
        }
        el('span', 'dc-stamp', b);
        b.addEventListener('click', () => this.choose(id));
        b.addEventListener('mouseenter', () => this.inspect(id));
        b.addEventListener('focus', () => this.inspect(id));
        this.cards.set(id, b);
      });
    }
    const owners = new Map(s.owners);
    const mySeat = s.seats.find((x) => x.index === this.me);
    const revealed = new Map(s.reveal.map((r) => [r.a, r]));
    for (const [id, b] of this.cards) {
      const owner = owners.get(id);
      const mine = !!mySeat?.picks.includes(id);
      const taken = mine || (s.unique && owner !== undefined);
      const selected = this.selected === id && s.stage === 'pick';
      const confirmed = (s.mine === id || this.sending === id) && s.stage === 'pick';
      // aria-disabled keeps even unavailable cards focusable so their effects can still be inspected.
      const canChoose = !this.sending && (!s.mine || this.editing) && isDraftChoiceAvailable(s, this.me, id);
      b.setAttribute('aria-disabled', String(!canChoose));
      b.setAttribute('aria-pressed', String(selected));
      b.classList.toggle('chosen', selected);
      b.classList.toggle('confirmed', confirmed);
      b.classList.toggle('sending', this.sending === id && s.mine !== id);
      b.classList.toggle('taken', taken && !mine);
      b.classList.toggle('mine', mine);
      const rev = revealed.get(id);
      b.classList.toggle('revealed', !!rev);
      b.classList.toggle('contested', !!rev?.contested);
      const stamp = b.querySelector('.dc-stamp') as HTMLElement;
      const passiveLimit = isAbilityId(id) && ABILITIES[id].kind === 'passive' && mySeat?.picks.some((pick) => isAbilityId(pick) && ABILITIES[pick].kind === 'passive');
      stamp.textContent = mine ? 'JÁ ESCOLHIDA' : passiveLimit ? 'LIMITE: 1 PASSIVA' : taken ? this.names(owner!) : confirmed ? 'CONFIRMADA' : selected ? 'SELECIONADA' : '';
      b.setAttribute('aria-label', `${ABILITIES[id as keyof typeof ABILITIES]?.name ?? id}${taken ? `, ${mine ? 'já está na sua combinação' : `já é de ${this.names(owner!)}`}` : ''}${selected ? ', selecionada' : ''}${confirmed ? ', confirmada' : ''}`);
    }
  }

  private renderDetails(): void {
    const s = this.state;
    if (!s) return;
    const id = this.inspected;
    if (!id || !isAbilityId(id) || this.detailKey === id) return;
    this.detailKey = id;
    const def = ABILITIES[id];
    this.detailArt.replaceChildren(icon(def, 'draft-detail-icon'));
    this.detailArt.style.setProperty('--ab-color', def.presentation.color);
    this.detailArt.style.setProperty('--ab-color2', def.presentation.color2);
    this.detailCategory.textContent = `${CATEGORIES[def.category]} · ${def.kind === 'passive' ? 'PASSIVA' : def.slotType === 'ultimate' ? 'SUPREMO' : 'ATIVA'}`;
    this.detailName.textContent = def.name;
    this.detailDescription.textContent = def.blurb;
    this.detailStats.replaceChildren();
    for (const [label, value] of [
      ['MANA', def.kind === 'passive' ? 'Sem custo' : String(def.manaCost)],
      ['RECARGA', def.kind === 'passive' ? 'Automática' : seconds(def.cooldown)],
      ['ALCANCE', def.targetType === 'self' ? 'Em você' : `${number(def.range)} m`],
    ]) {
      const stat = el('div', '', this.detailStats);
      el('span', '', stat, label);
      el('strong', '', stat, value);
    }
    this.detailEffects.replaceChildren();
    for (const fact of [...new Set(effectFacts(def.effects))].slice(0, 3)) el('li', '', this.detailEffects, fact);
    this.detailTags.replaceChildren();
    for (const t of def.tags) if (TAGS[t]) el('span', 'dc-tag', this.detailTags, TAGS[t]);
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
    } else text = this.selected ? `${selectedName} selecionada. Confirme sua escolha para esta rodada.` : 'Clique em uma habilidade e confirme sua escolha.';
    this.statusEl.textContent = text;
    this.statusEl.dataset.tone = tone;
    this.confirm.hidden = !choosing || confirmed;
    this.confirm.disabled = !valid || !!this.sending;
    this.confirm.textContent = this.sending ? 'CONFIRMANDO…' : 'CONFIRMAR ESCOLHA';
    this.change.hidden = !choosing || !confirmed;
    this.change.disabled = !!this.sending;
    this.help.textContent = s.stage !== 'pick' ? 'As habilidades reveladas ficam visíveis para todos.' : confirmed ? 'Você pode alterar enquanto esta rodada estiver aberta.' : `Teclas 1–${this.visibleIds.length} selecionam nesta página. Máximo: 1 passiva. Sem confirmar, a seleção é automática.`;
  }

  private renderSeats(s: DraftStateMsg): void {
    this.seatsEl.replaceChildren();
    const ready = s.seats.filter((x) => x.locked || !x.picking).length;
    this.participantsProgress.textContent = s.stage === 'pick' ? `${ready} / ${s.seats.length} confirmaram` : `${s.seats.length} jogadores · ${s.stage === 'done' ? 'prontos' : 'escolhas reveladas'}`;
    const ordered = [...s.seats].sort((a, b) => (a.index === this.me ? -1 : b.index === this.me ? 1 : a.index - b.index));
    for (const seat of ordered) {
      const confirmed = seat.locked || !seat.picking;
      const row = el('div', `draft-seat${seat.index === this.me ? ' me' : ''}${confirmed ? ' ready' : ''}`, this.seatsEl);
      row.title = this.names(seat.index);
      const look = this.looks(seat.index);
      const avatar = el('div', 'ds-avatar', row);
      if (look) avatar.innerHTML = avatarPortrait(look);
      el('div', 'ds-name', row, seat.index === this.me ? `${this.names(seat.index)} · você` : this.names(seat.index));
      el('div', 'ds-status', row, s.stage === 'pick' ? confirmed ? '✓ Confirmou' : '◌ Escolhendo' : s.stage === 'done' ? '✓ Pronto' : '✓ Revelado');
      const slots = el('div', 'ds-slots', row);
      for (let k = 0; k < s.rounds; k++) {
        const slot = el('div', `ds-slot${k === s.rounds - 1 ? ' ult' : ''}`, slots);
        const id = seat.picks[k];
        if (id && isAbilityId(id)) {
          slot.classList.add('filled');
          slot.appendChild(icon(ABILITIES[id], 'ds-icon'));
          slot.title = ABILITIES[id].name;
        } else if (k === s.round && s.stage === 'pick' && seat.picking) {
          slot.classList.add('current');
          // Pending opponents' choices are represented only by their public lock state.
          el('span', 'ds-lock', slot, seat.locked ? '✓' : '?');
        } else slot.textContent = String(k + 1);
      }
    }
  }
}
