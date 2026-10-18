/**
 * Loot HUD (DOM/CSS/SVG, inside the combat HUD): the interaction prompt, the weapon replacement card, the consumable
 * belt (Z / X / C), the use bar, the pickup feed and the floating labels of items on the ground. Driven by the
 * LootDirector; it never decides anything (the server does).
 *
 * Rarity is never colour alone: every label carries the rarity's symbol (● ▲ ◆ ★) and its name or pips.
 */
import { CONSUMABLES, CONSUMABLE_ORDER, RARITIES, type ConsumableId, type Rarity } from '@graao/game-data';
import { DEFAULT_BINDINGS, keyLabel, type KeyBindings } from '../game/KeyBindings';
import '../styles/loot.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

function replay(e: Element, cls: string): void {
  e.classList.remove(cls);
  void (e as HTMLElement).offsetWidth;
  e.classList.add(cls);
}

/** Icon per consumable: different shapes (heart-cross, hexagon, crystal), not only colours. */
const CONSUMABLE_ICON: Record<ConsumableId, string> = {
  health: '<circle cx="12" cy="13" r="8" class="fill"/><path d="M12 9v8M8 13h8" class="mark"/><rect x="10" y="2" width="4" height="4" rx="1" class="fill"/>',
  shield: '<path d="M12 2 20 6.5v9L12 20 4 15.5v-9Z" class="fill"/><path d="M12 6 16.5 8.5v5L12 16 7.5 13.5v-5Z" class="mark"/>',
  mana: '<path d="M12 1 17 10 12 23 7 10Z" class="fill"/><path d="M12 5 14 10 12 17" class="mark"/>',
};
export const CONSUMABLE_NAME: Record<ConsumableId, string> = { health: 'Néctar de Vida', shield: 'Cápsula de Escudo', mana: 'Cristal de Mana' };
const CONSUMABLE_STAT: Record<ConsumableId, string> = { health: 'Vida', shield: 'Escudo', mana: 'Mana' };

export interface LabelView {
  x: number;
  y: number;
  name: string;
  qty: number;
  rarity: Rarity;
  target: boolean;
  /** 0..1 by distance (closer = clearer). */
  alpha: number;
}

interface ChoiceView {
  item: string;
  rarity: Rarity;
  slots: { key: string; name: string; rarity?: Rarity }[];
}

export class LootHud {
  readonly el = el('div', 'loot-hud');
  private bindings: KeyBindings = { ...DEFAULT_BINDINGS };
  private readonly prompt = el('div', 'loot-prompt', this.el);
  private readonly promptKey = el('kbd', 'lp-key', this.prompt, 'F');
  private readonly promptText = el('div', 'lp-text', this.prompt);
  private readonly promptAction = el('div', 'lp-action', this.promptText);
  private readonly promptItem = el('div', 'lp-item', this.promptText);
  private lastPrompt = '';

  private readonly choice = el('div', 'loot-choice', this.el);
  private readonly choiceItem = el('div', 'lc-item', this.choice);
  private readonly choiceRows = el('div', 'lc-rows', this.choice);
  private choiceView: ChoiceView | null = null;

  private readonly useBar = el('div', 'loot-use', this.el);
  private readonly useText = el('div', 'lu-text', this.useBar);
  private readonly useTrack = el('div', 'lu-track', this.useBar);
  private readonly useFill = el('i', '', this.useTrack);

  private readonly belt = el('div', 'loot-belt', this.el);
  private readonly beltSlots: { root: HTMLElement; key: HTMLElement; count: HTMLElement; fill: HTMLElement; last: string }[] = [];

  private readonly feed = el('div', 'loot-feed', this.el);

  readonly labels = el('div', 'loot-labels');
  private readonly labelPool: HTMLElement[] = [];

  constructor() {
    this.prompt.hidden = true;
    this.choice.hidden = true;
    this.useBar.hidden = true;
    el('div', 'lc-title', this.choice, 'NOVA ARMA ENCONTRADA');
    this.choice.insertBefore(this.choice.lastChild!, this.choiceItem);
    for (const id of CONSUMABLE_ORDER) {
      const def = CONSUMABLES[id];
      const root = el('div', `belt-slot c-${id}`, this.belt);
      root.title = `${CONSUMABLE_NAME[id]}: +${def.amount} ${CONSUMABLE_STAT[id]}`;
      const key = el('kbd', 'belt-key', root, def.key);
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('class', 'belt-icon');
      icon.innerHTML = CONSUMABLE_ICON[id];
      root.appendChild(icon);
      const count = el('div', 'belt-count', root, '0');
      const fill = el('i', 'belt-fill', root);
      this.beltSlots.push({ root, key, count, fill, last: '' });
    }
  }

  setKeyBindings(bindings: KeyBindings): void {
    this.bindings = { ...bindings };
    this.promptKey.textContent = keyLabel(bindings.interact);
    const actions = ['item1', 'item2', 'item3'] as const;
    this.beltSlots.forEach((slot, i) => { slot.key.textContent = keyLabel(bindings[actions[i]!]); });
    if (this.choiceView) {
      this.setChoice({
        ...this.choiceView,
        slots: this.choiceView.slots.map((slot, i) => ({ ...slot, key: keyLabel(bindings[i === 0 ? 'weapon1' : 'weapon2']) })),
      });
    }
  }

  // ------------------------------------------------------------------------------------------------ prompt

  /** `[F] action · item (rarity)`; null hides it. */
  setPrompt(p: { action: string; item?: string; rarity?: Rarity; qty?: number; note?: string } | null): void {
    const key = p ? `${p.action}|${p.item}|${p.rarity}|${p.qty}|${p.note}` : '';
    if (key === this.lastPrompt) return;
    this.lastPrompt = key;
    this.prompt.hidden = !p;
    if (!p) return;
    this.promptAction.textContent = p.action;
    this.promptItem.hidden = !p.item;
    if (p.item) {
      const r = p.rarity ? RARITIES[p.rarity] : null;
      this.promptItem.innerHTML = '';
      if (r) {
        const tag = el('span', 'lp-rarity', this.promptItem, `${r.symbol} ${r.name}`);
        tag.style.setProperty('--rarity', r.color);
      }
      el('span', 'lp-name', this.promptItem, p.qty && p.qty > 1 ? `${p.item} ×${p.qty}` : p.item);
      if (p.note) el('span', 'lp-note', this.promptItem, p.note);
    }
    replay(this.prompt, 'pop');
  }

  // ------------------------------------------------------------------------------------------------ replacement card

  /** Both slots hold a weapon: which one does the new one replace? null hides the card. */
  setChoice(c: ChoiceView | null): void {
    this.choiceView = c;
    this.choice.hidden = !c;
    if (!c) return;
    const r = RARITIES[c.rarity];
    this.choice.style.setProperty('--rarity', r.color);
    this.choiceItem.innerHTML = '';
    el('span', 'lc-name', this.choiceItem, c.item);
    el('span', 'lc-rarity', this.choiceItem, `${r.symbol} ${r.name}`);
    this.choiceRows.innerHTML = '';
    for (const [index, s] of c.slots.entries()) {
      const row = el('div', 'lc-row', this.choiceRows);
      el('kbd', '', row, s.key);
      el('span', '', row, `Substituir arma ${index + 1}`);
      el('span', 'lc-old', row, s.rarity ? `${RARITIES[s.rarity].symbol} ${s.name}` : s.name);
    }
    const cancel = el('div', 'lc-row cancel', this.choiceRows);
    el('kbd', '', cancel, keyLabel(this.bindings.interact));
    el('span', '', cancel, 'Cancelar');
    replay(this.choice, 'pop');
  }

  // ------------------------------------------------------------------------------------------------ belt and use bar

  /** Counts per consumable (CONSUMABLE_ORDER), which one is in use and how far along (0..1). */
  setBelt(counts: number[], using: number, progress: number): void {
    this.beltSlots.forEach((v, i) => {
      const n = counts[i] ?? 0;
      const key = `${n}|${using === i}`;
      if (key !== v.last) {
        if (v.last && Number(v.last.split('|')[0]) < n) replay(v.root, 'gain');
        v.last = key;
        v.count.textContent = String(n);
        v.root.classList.toggle('none', n <= 0);
        v.root.classList.toggle('using', using === i);
      }
      v.fill.style.transform = `scaleY(${using === i ? progress : 0})`;
    });
    this.useBar.hidden = using < 0;
    if (using >= 0) {
      const id = CONSUMABLE_ORDER[using]!;
      this.useText.textContent = `Usando ${CONSUMABLE_NAME[id]}…`;
      this.useFill.style.width = `${Math.round(progress * 100)}%`;
      this.useBar.dataset.kind = id;
    }
  }

  // ------------------------------------------------------------------------------------------------ feed

  /** One line in the pickup feed (`+ Fuzil Kalash ◆ Raro`, `+24 Cápsulas Solares`). */
  pickup(text: string, rarity: Rarity | null, sub = ''): void {
    const row = el('div', 'loot-feed-row', this.feed);
    if (rarity) {
      const r = RARITIES[rarity];
      row.style.setProperty('--rarity', r.color);
      el('span', 'lf-sym', row, r.symbol);
    }
    el('span', 'lf-text', row, text);
    if (sub) el('span', 'lf-sub', row, sub);
    while (this.feed.children.length > 4) this.feed.firstChild!.remove();
    setTimeout(() => row.classList.add('out'), 2600);
    setTimeout(() => row.remove(), 3200);
  }

  // ------------------------------------------------------------------------------------------------ labels

  /** Floating labels over nearby items (screen px), pooled. Nearest first; a label that would cover one already
   * placed is lifted above it, so stacked rewards read as a little column. */
  setLabels(list: LabelView[]): void {
    const placed: { x: number; y: number; w: number }[] = [];
    for (const v of list) {
      const w = 26 + (v.name.length + (v.qty > 1 ? 4 : 0)) * 6.4;
      for (let k = 0; k < 8; k++) {
        const hit = placed.find((p) => Math.abs(p.x - v.x) < (p.w + w) / 2 && Math.abs(p.y - v.y) < 21);
        if (!hit) break;
        v.y = hit.y - 22;
      }
      placed.push({ x: v.x, y: v.y, w });
    }
    while (this.labelPool.length < list.length) {
      const e = el('div', 'loot-label', this.labels);
      el('span', 'll-sym', e);
      el('span', 'll-name', e);
      el('span', 'll-pips', e);
      this.labelPool.push(e);
    }
    this.labelPool.forEach((e, i) => {
      const v = list[i];
      if (!v) {
        e.style.display = 'none';
        return;
      }
      const r = RARITIES[v.rarity];
      e.style.display = 'flex';
      e.style.transform = `translate(${v.x.toFixed(0)}px, ${v.y.toFixed(0)}px) translate(-50%, -100%)`;
      e.style.opacity = v.alpha.toFixed(2);
      e.style.setProperty('--rarity', r.color);
      e.classList.toggle('target', v.target);
      const name = v.qty > 1 ? `${v.name} ×${v.qty}` : v.name;
      const [sym, nm, pips] = e.children as unknown as HTMLElement[];
      if (sym!.textContent !== r.symbol) sym!.textContent = r.symbol;
      if (nm!.textContent !== name) nm!.textContent = name;
      const p = '•'.repeat(r.pips);
      if (pips!.textContent !== p) pips!.textContent = p;
    });
  }

  clear(): void {
    this.setPrompt(null);
    this.setChoice(null);
    this.setLabels([]);
    this.feed.innerHTML = '';
  }
}
