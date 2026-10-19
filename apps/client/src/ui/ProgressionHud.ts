/**
 * In-match progression HUD (DOM/CSS): the level badge and XP bar under the vitals, the attributes button (it pulses
 * while there are points to spend), the level-up toast, the attribute panel and the XP gains. It mirrors the server
 * (SELF `prog`, `stats`, PROGRESS); it never decides.
 *
 *   bottom-left, last vitals row    [NÍVEL 3] ▰▰45 / 135 XP▱▱   [+1 PONTO · P]
 *   above the vitals (P)            ATRIBUTOS — 1 Ataque · 2 Defesa · 3 Vel. Ataque · 4 Vitalidade · 5 Energia
 *                                   (keys or clicks/taps; each row shows what it gives now and with the next point)
 */
import { STATS, STAT_IDS, STAT_RULES, type StatId } from '@graao/game-data';
import { statModifiers, type StatModifiers } from '@graao/game-core';
import '../styles/unarmed.css';

export interface ProgressionView {
  level: number;
  /** XP into the level and what the next one needs (0 at the cap). */
  cur: number;
  next: number;
  points: number;
  stats: readonly number[];
  open: boolean;
  /** Key cap (label) of the panel toggle, and of each attribute row. */
  key: string;
  rowKeys: readonly string[];
}

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

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** What attribute `id` gives with these modifiers (the panel's "now" and "next point" columns). */
export function statEffect(id: StatId, m: StatModifiers): string {
  switch (id) {
    case 'ataque':
      return m.damage > 1 ? `+${pct(m.damage - 1)} dano` : 'dano base';
    case 'defesa':
      return m.defense < 1 ? `-${pct(1 - m.defense)} dano recebido` : 'sem redução';
    case 'velAtaque':
      return m.attackSpeed > 1 ? `+${pct(m.attackSpeed - 1)} cadência` : 'cadência base';
    case 'vitalidade':
      return `${m.maxHealth} Vida máx.`;
    case 'energia':
      return `${m.maxMana} Mana máx.`;
  }
}

export class ProgressionHud {
  readonly el = el('div', 'prog');
  private readonly badge = el('div', 'prog-level', this.el);
  private readonly track = el('div', 'prog-track', this.el);
  private readonly fill = el('i', '', this.track);
  private readonly xpText = el('div', 'prog-xp', this.el);
  private readonly pointsEl = el('button', 'prog-points', this.el);
  private readonly gains = el('div', 'prog-gains', this.el);
  private readonly toast = el('div', 'prog-toast', this.el);
  readonly panel = el('div', 'stat-panel');
  private readonly panelHead = el('div', 'stat-head', this.panel);
  private readonly closeEl = el('button', 'stat-close', this.panel, '×');
  private readonly rows: { root: HTMLButtonElement; key: HTMLElement; count: HTMLElement; now: HTMLElement; next: HTMLElement }[] = [];
  private last = '';
  private toastTimer = 0;
  /** A row was clicked (attribute index) or the button / close toggles the panel. */
  onPick: ((k: number) => void) | null = null;
  onToggle: (() => void) | null = null;

  constructor() {
    this.pointsEl.type = 'button';
    this.pointsEl.addEventListener('click', () => this.onToggle?.());
    this.closeEl.type = 'button';
    this.closeEl.title = 'Fechar';
    this.closeEl.addEventListener('click', () => this.onToggle?.());
    this.toast.hidden = true;
    STAT_IDS.forEach((id, k) => {
      const def = STATS[id];
      const root = el('button', 'stat-row', this.panel);
      root.type = 'button';
      root.style.setProperty('--stat', def.color);
      const key = el('span', 'stat-key', root, String(k + 1));
      const text = el('span', 'stat-text', root);
      el('span', 'stat-name', text, def.name);
      el('span', 'stat-line', text, def.line);
      const val = el('span', 'stat-val', root);
      const count = el('span', 'stat-count', val, '0');
      const now = el('span', 'stat-now', val);
      const next = el('span', 'stat-next', val);
      el('span', 'stat-plus', root, '+');
      root.addEventListener('click', () => this.onPick?.(k));
      this.rows.push({ root, key, count, now, next });
    });
    el('div', 'stat-foot', this.panel, `até ${STAT_RULES.maxPerStat} pontos por atributo · a partida não pausa`);
    this.panel.hidden = true;
  }

  set(v: ProgressionView): void {
    const key = `${v.level}|${v.cur}|${v.next}|${v.points}|${v.stats.join(',')}|${v.open}|${v.key}|${v.rowKeys.join(',')}`;
    if (key === this.last) return;
    this.last = key;
    this.badge.textContent = `NÍVEL ${v.level}`;
    const max = v.next <= 0;
    this.fill.style.width = max ? '100%' : `${Math.max(0, Math.min(1, v.cur / v.next)) * 100}%`;
    this.el.classList.toggle('max', max);
    this.xpText.textContent = max ? 'NÍVEL MÁXIMO' : `${v.cur} / ${v.next} XP`;
    this.pointsEl.classList.toggle('has', v.points > 0);
    this.pointsEl.textContent = v.points > 0 ? `+${v.points} ${v.points === 1 ? 'PONTO' : 'PONTOS'} · ${v.key}` : `ATRIBUTOS · ${v.key}`;
    this.pointsEl.title = v.points > 0 ? 'Distribuir pontos de atributo' : 'Ver atributos (derrote criaturas para subir de nível)';
    this.pointsEl.classList.toggle('open', v.open);
    this.panel.hidden = !v.open;
    if (v.open) this.toast.hidden = true;
    this.panelHead.textContent = v.points > 0 ? `ATRIBUTOS · ${v.points} ${v.points === 1 ? 'ponto para distribuir' : 'pontos para distribuir'}` : 'ATRIBUTOS · sem pontos agora';
    const mods = statModifiers({ stats: v.stats as number[] });
    this.rows.forEach((r, k) => {
      const id = STAT_IDS[k]!;
      const n = v.stats[k] ?? 0;
      const capped = n >= STAT_RULES.maxPerStat;
      r.key.textContent = v.rowKeys[k] ?? String(k + 1);
      r.count.textContent = `${n}/${STAT_RULES.maxPerStat}`;
      r.now.textContent = statEffect(id, mods);
      if (capped) r.next.textContent = 'máximo';
      else {
        const more = [...v.stats];
        more[k] = n + 1;
        r.next.textContent = `→ ${statEffect(id, statModifiers({ stats: more }))}`;
      }
      r.root.classList.toggle('capped', capped);
      r.root.disabled = v.points <= 0 || capped;
    });
  }

  /** Per frame: hides the level-up toast when its time is up. */
  update(dt: number): void {
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toast.hidden = true;
  }

  /** "+35 XP · Barrolinho" rising from the bar. */
  gain(xp: number, what: string): void {
    const n = el('div', 'prog-gain', this.gains, `+${xp} XP${what ? ` · ${what}` : ''}`);
    setTimeout(() => n.remove(), 1600);
    while (this.gains.children.length > 4) this.gains.firstElementChild?.remove();
    replay(this.track, 'pulse');
  }

  /** A small card above the bar (never in the middle of the screen): the new level and the point(s) it gave. */
  levelUp(level: number, gained: number, key: string): void {
    this.toast.replaceChildren();
    el('b', '', this.toast, `NÍVEL ${level}`);
    el('span', '', this.toast, `NOVO NÍVEL! +${gained} ${gained === 1 ? 'PONTO' : 'PONTOS'} DE ATRIBUTO · ${key}`);
    this.toast.hidden = false;
    this.toastTimer = 2.6;
    replay(this.toast, 'pop');
    replay(this.badge, 'up');
    replay(this.pointsEl, 'up');
  }

  /** A point just went into attribute `k`. */
  spent(k: number): void {
    const r = this.rows[k];
    if (r) replay(r.root, 'spent');
  }
}
