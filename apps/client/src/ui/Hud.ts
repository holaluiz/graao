/**
 * Combat HUD (DOM/CSS/SVG, never rendered into Three.js). Driven by the CombatDirector; it never decides gameplay.
 *
 *   bottom-left   Escudo / Vida / Mana (+ status chips such as LENTO)
 *   bottom-centre ability slots 1 2 3 + Ultimate 4: icon (shape per ability), Mana cost, cooldown sweep
 *   bottom-right  E / Q weapon slots with ammo and reload progress
 *   centre        reticle per weapon profile (spread, blocked shot), hitmarkers by hit kind, damage direction arcs
 *   top           place name, match status chip, room code, kill feed
 *   overlays      countdown / banners, elimination screen, results
 *
 * Attention: QUIET (static), RELEVANT (brief motion), URGENT (pulse once), CRITICAL (low health, persistent).
 * Every hit kind has its own shape, not only a color.
 */
import type { AbilityIcon } from '@graao/game-data';
import { HitKind } from '@graao/shared';
import { ABILITY_ICONS } from './abilityIcons';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

function svg(cls: string, viewBox: string, inner: string): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = inner;
  return s;
}

/** Restarts a CSS animation on an element. */
function replay(e: Element, cls: string): void {
  e.classList.remove(cls);
  void (e as HTMLElement).offsetWidth;
  e.classList.add(cls);
}

export interface WeaponSlotView {
  key: string;
  name: string;
  ammo: number;
  magazine: number;
}

export interface AbilitySlotView {
  key: string;
  name: string;
  icon: AbilityIcon;
  color: string;
  cost: number;
  ultimate: boolean;
  /** 0..1 of the cooldown still to run. */
  cd: number;
  secondsLeft: number;
  /** Mirror of the server state (the HUD only displays it). */
  state: 'ready' | 'cooldown' | 'nomana' | 'casting' | 'locked';
}

export interface ResultsView {
  victory: boolean;
  draw: boolean;
  winnerName: string;
  kills: number;
  damage: number;
  shots: number;
  hits: number;
  secondsLeft: number;
}

export class Hud {
  readonly el = el('div', 'hud');
  private readonly placeEl = el('div', 'place', this.el);
  private readonly hintEl = el('div', 'hint', this.el);
  private readonly roomEl = el('div', 'room', this.el);
  private readonly statusEl = el('div', 'status-chip', this.el);
  private readonly feedEl = el('div', 'feed', this.el);
  private readonly noticeEl = el('div', 'notice', this.el);
  private readonly bannerEl = el('div', 'banner', this.el);
  private readonly bannerBig = el('div', 'banner-big', this.bannerEl);
  private readonly bannerSub = el('div', 'banner-sub', this.bannerEl);

  // Centre.
  private readonly center = el('div', 'reticle-wrap', this.el);
  private readonly reticleCross = svg(
    'reticle cross',
    '-50 -50 100 100',
    '<g class="ticks"><rect class="t t-up" x="-2" y="-22" width="4" height="12" rx="2"/><rect class="t t-down" x="-2" y="10" width="4" height="12" rx="2"/>' +
      '<rect class="t t-left" x="-22" y="-2" width="12" height="4" rx="2"/><rect class="t t-right" x="10" y="-2" width="12" height="4" rx="2"/></g><circle class="dot" r="2.2"/>',
  );
  private readonly reticleCircle = svg('reticle circle', '-50 -50 100 100', '<circle class="ring" r="16"/><circle class="dot" r="2.2"/>');
  private readonly blocked = svg('blocked', '-50 -50 100 100', '<path d="M-7 -7 L7 7 M7 -7 L-7 7"/>');
  private readonly hitmarker = svg(
    'hitmarker',
    '-50 -50 100 100',
    '<g class="hm-x"><path d="M-17 -17 L-8 -8 M17 -17 L8 -8 M-17 17 L-8 8 M17 17 L8 8"/></g>' +
      '<path class="hm-hex" d="M0 -21 L18 -10.5 L18 10.5 L0 21 L-18 10.5 L-18 -10.5 Z"/>' +
      '<path class="hm-break" d="M0 -21 L18 -10.5 L9 -3 M18 10.5 L0 21 L-6 9 M-18 10.5 L-18 -10.5 L-8 -14"/>' +
      '<path class="hm-diamond" d="M0 -6 L6 0 L0 6 L-6 0 Z"/>' +
      '<circle class="hm-ring" r="24"/>' +
      // Ability hits add four small diamonds around the base shape (whatever it is).
      '<path class="hm-ab" d="M0 -31 L3 -27 L0 -23 L-3 -27 Z M31 0 L27 3 L23 0 L27 -3 Z M0 31 L-3 27 L0 23 L3 27 Z M-31 0 L-27 -3 L-23 0 L-27 3 Z"/>',
  );
  private readonly dmgDirs = el('div', 'dmg-dirs', this.el);
  private readonly numbers = el('div', 'dmg-numbers', this.el);

  // Vitals.
  private readonly vitals = el('div', 'vitals', this.el);
  private readonly shieldRow = this.bar('shield', 'Escudo');
  private readonly healthRow = this.bar('health', 'Vida');
  private readonly manaRow = this.bar('mana', 'Mana');

  private readonly effectsEl = el('div', 'fx-chips', this.vitals);
  private readonly slowChip = el('div', 'fx-chip slow', this.effectsEl);

  // Abilities.
  private readonly abilitiesEl = el('div', 'abilities', this.el);
  private readonly abSlots: { root: HTMLElement; icon: SVGSVGElement; sweep: HTMLElement; time: HTMLElement; cost: HTMLElement; name: HTMLElement; key: HTMLElement; last: string }[] = [];

  // Weapons.
  private readonly weaponsEl = el('div', 'weapons', this.el);
  private readonly slots: { root: HTMLElement; name: HTMLElement; ammo: HTMLElement; fill: HTMLElement; key: HTMLElement }[] = [];
  private readonly ammoHint = el('div', 'ammo-hint', this.el);

  // Overlays.
  private readonly deathEl = el('div', 'death', this.el);
  private readonly deathTitle = el('div', 'death-title', this.deathEl, 'ELIMINADO');
  private readonly deathSub = el('div', 'death-sub', this.deathEl);
  private readonly resultsEl = el('div', 'results', this.el);
  private readonly lowHealthEl = el('div', 'low-health', this.el);

  private placeTimer = 0;
  private noticeTimer = 0;
  private bannerTimer = 0;
  private lastVitals = { health: -1, shield: -1, mana: -1 };

  constructor() {
    this.center.append(this.reticleCross, this.reticleCircle, this.blocked, this.hitmarker);
    this.placeEl.style.opacity = '0';
    this.roomEl.hidden = true;
    this.statusEl.hidden = true;
    this.bannerEl.hidden = true;
    this.deathEl.hidden = true;
    this.resultsEl.hidden = true;
    this.noticeEl.hidden = true;
    this.ammoHint.hidden = true;
    this.slowChip.hidden = true;
    for (let i = 0; i < 2; i++) {
      const root = el('div', 'slot', this.weaponsEl);
      const key = el('div', 'slot-key', root);
      const name = el('div', 'slot-name', root);
      const ammo = el('div', 'slot-ammo', root);
      const track = el('div', 'slot-reload', root);
      const fill = el('i', '', track);
      this.slots.push({ root, name, ammo, fill, key });
    }
  }

  private bar(kind: string, label: string): { root: HTMLElement; fill: HTMLElement; ghost: HTMLElement; value: HTMLElement } {
    const root = el('div', `vbar ${kind}`, this.vitals);
    el('div', 'vbar-label', root, label);
    const track = el('div', 'vbar-track', root);
    const ghost = el('i', 'ghost', track);
    const fill = el('i', 'fill', track);
    const value = el('div', 'vbar-value', root);
    return { root, fill, ghost, value };
  }

  show(v: boolean): void {
    this.el.hidden = !v;
  }

  // ------------------------------------------------------------------------------------------------ top

  setPlace(name: string): void {
    this.placeEl.textContent = name;
    this.placeEl.style.opacity = '1';
    this.placeTimer = 3;
  }

  setHint(text: string): void {
    this.hintEl.hidden = !text;
    this.hintEl.textContent = text;
  }

  setRoom(code: string | null): void {
    this.roomEl.hidden = !code;
    this.roomEl.textContent = code ? `SALA ${code}` : '';
  }

  setStatus(text: string, tone: 'quiet' | 'relevant' | 'urgent' = 'quiet'): void {
    this.statusEl.hidden = !text;
    if (this.statusEl.textContent !== text) {
      this.statusEl.textContent = text;
      this.statusEl.dataset.tone = tone;
      if (tone !== 'quiet') replay(this.statusEl, 'pop');
    }
  }

  /** Kill feed entry. `me` highlights entries involving the local player. */
  feed(killer: string, victim: string, me: 'killer' | 'victim' | null): void {
    const row = el('div', `feed-row${me ? ` me-${me}` : ''}`, this.feedEl);
    el('span', 'who', row, killer);
    row.appendChild(svg('feed-icon', '-10 -10 20 20', '<path d="M-6 -6 L6 6 M6 -6 L-6 6"/>'));
    el('span', 'who', row, victim);
    setTimeout(() => row.classList.add('out'), 5000);
    setTimeout(() => row.remove(), 5600);
    while (this.feedEl.children.length > 5) this.feedEl.firstElementChild?.remove();
  }

  /** Brief URGENT message under the reticle ("Sem munição", "Escudo quebrado!", "Sem mana"). */
  notice(text: string, seconds = 1.4): void {
    this.noticeEl.hidden = false;
    delete this.noticeEl.dataset.tone;
    this.noticeEl.textContent = text;
    replay(this.noticeEl, 'pop');
    this.noticeTimer = seconds;
  }

  /** Big centre text (countdown, LUTEM!, phase changes). */
  banner(big: string, sub = '', seconds = 1.6, tone: 'neutral' | 'good' | 'bad' = 'neutral'): void {
    this.bannerEl.hidden = false;
    this.bannerEl.dataset.tone = tone;
    if (this.bannerBig.textContent !== big) replay(this.bannerEl, 'pop');
    this.bannerBig.textContent = big;
    this.bannerSub.textContent = sub;
    this.bannerTimer = seconds;
  }

  // ------------------------------------------------------------------------------------------------ centre

  setReticle(profile: 'dot-cross' | 'circle', spreadPx: number, blocked: boolean, visible: boolean): void {
    this.reticleCross.style.display = visible && profile === 'dot-cross' ? '' : 'none';
    this.reticleCircle.style.display = visible && profile === 'circle' ? '' : 'none';
    this.blocked.style.display = visible && blocked ? '' : 'none';
    const s = Math.max(0, spreadPx);
    this.reticleCross.style.setProperty('--spread', `${s}px`);
    this.reticleCircle.style.setProperty('--ring', `${1 + s / 18}`);
  }

  /** Server-confirmed hit by the local player. The strongest kind decides the shape; abilities add their diamonds. */
  hit(kinds: HitKind[]): void {
    const has = (k: HitKind) => kinds.includes(k);
    const kind = has(HitKind.ELIMINATION) ? 'elim' : has(HitKind.SHIELD_BREAK) ? 'break' : has(HitKind.CRITICAL) ? 'crit' : has(HitKind.SHIELD) ? 'shield' : 'body';
    this.hitmarker.dataset.kind = kind;
    this.hitmarker.dataset.ability = has(HitKind.ABILITY) ? '1' : '0';
    replay(this.hitmarker, 'show');
    if (kind === 'break') this.notice('ESCUDO QUEBRADO', 1.1);
  }

  /** Floating damage number at a screen position. */
  damageNumber(x: number, y: number, amount: number, kinds: HitKind[]): void {
    const crit = kinds.includes(HitKind.CRITICAL);
    const shield = kinds.includes(HitKind.SHIELD) || kinds.includes(HitKind.SHIELD_BREAK);
    const ability = kinds.includes(HitKind.ABILITY);
    const cls = `dmg-num${crit ? ' crit' : ''}${shield && !kinds.includes(HitKind.BODY) && !crit ? ' shield' : ''}${ability ? ' ability' : ''}`;
    const n = el('div', cls, this.numbers, `${ability ? '✦' : ''}${amount}${crit ? '!' : ''}`);
    const drift = (Math.random() - 0.5) * 40;
    n.style.left = `${x + drift}px`;
    n.style.top = `${y}px`;
    setTimeout(() => n.remove(), 900);
    while (this.numbers.children.length > 14) this.numbers.firstElementChild?.remove();
  }

  /** Damage taken from a direction: angle in radians, 0 = straight ahead, positive = to the right. */
  damageFrom(angle: number, shield: boolean): void {
    const arc = svg(`dmg-dir${shield ? ' shield' : ''}`, '-60 -60 120 120', '<path d="M-22 -50 Q0 -58 22 -50" />');
    arc.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    this.dmgDirs.appendChild(arc);
    setTimeout(() => arc.remove(), 1300);
    while (this.dmgDirs.children.length > 6) this.dmgDirs.firstElementChild?.remove();
  }

  // ------------------------------------------------------------------------------------------------ vitals & weapons

  setVitals(health: number, shield: number, mana: number, maxHealth: number, maxShield: number, maxMana: number): void {
    const set = (row: { root: HTMLElement; fill: HTMLElement; ghost: HTMLElement; value: HTMLElement }, v: number, max: number, last: number) => {
      const f = `${Math.max(0, Math.min(1, v / max)) * 100}%`;
      row.fill.style.width = f;
      // The ghost lingers on damage (shows how much was lost), snaps on heal.
      if (v < last) setTimeout(() => (row.ghost.style.width = f), 380);
      else row.ghost.style.width = f;
      row.value.textContent = String(Math.max(0, Math.round(v)));
      if (v < last && last >= 0) replay(row.root, 'hurt');
    };
    if (health !== this.lastVitals.health) set(this.healthRow, health, maxHealth, this.lastVitals.health);
    if (shield !== this.lastVitals.shield) set(this.shieldRow, shield, maxShield, this.lastVitals.shield);
    if (mana !== this.lastVitals.mana) set(this.manaRow, mana, maxMana, this.lastVitals.mana);
    this.shieldRow.root.classList.toggle('empty', shield <= 0);
    this.lastVitals = { health, shield, mana };
    const low = health > 0 && health <= maxHealth * 0.3;
    this.lowHealthEl.classList.toggle('on', low);
    this.healthRow.root.classList.toggle('critical', low);
  }

  setWeapons(active: number, slots: WeaponSlotView[], reload: number): void {
    slots.forEach((s, i) => {
      const v = this.slots[i]!;
      v.root.classList.toggle('active', i === active);
      v.key.textContent = s.key;
      v.name.textContent = s.name;
      v.ammo.textContent = `${s.ammo}/${s.magazine}`;
      v.root.classList.toggle('dry', s.ammo === 0);
      v.fill.style.width = i === active && reload >= 0 ? `${reload * 100}%` : '0%';
    });
    const a = slots[active];
    const dry = !!a && a.ammo === 0 && reload < 0;
    this.ammoHint.hidden = !(dry || reload >= 0);
    this.ammoHint.textContent = reload >= 0 ? 'RECARREGANDO…' : 'SEM MUNIÇÃO · R';
  }

  /** Ability slots 1–4. The views mirror the server (cooldowns, Mana, wind-up); the HUD never decides. */
  setAbilities(slots: AbilitySlotView[]): void {
    while (this.abSlots.length < slots.length) {
      const root = el('div', 'ab-slot', this.abilitiesEl);
      const icon = svg('ab-icon', '-16 -16 32 32', '');
      root.appendChild(icon);
      const sweep = el('div', 'ab-sweep', root);
      const time = el('div', 'ab-time', root);
      const key = el('div', 'ab-key', root);
      const cost = el('div', 'ab-cost', root);
      const name = el('div', 'ab-name', root);
      this.abSlots.push({ root, icon, sweep, time, cost, name, key, last: '' });
    }
    slots.forEach((v, i) => {
      const s = this.abSlots[i]!;
      const ident = `${v.name}|${v.icon}|${v.color}|${v.cost}|${v.key}|${v.ultimate}`;
      if (s.last !== ident) {
        s.last = ident;
        s.icon.innerHTML = ABILITY_ICONS[v.icon];
        s.root.style.setProperty('--ab-color', v.color);
        s.root.classList.toggle('ult', v.ultimate);
        s.key.textContent = v.key;
        s.cost.textContent = String(v.cost);
        s.name.textContent = v.name;
      }
      if (s.root.dataset.state !== v.state) s.root.dataset.state = v.state;
      s.sweep.style.setProperty('--p', v.cd.toFixed(3));
      const t = v.secondsLeft > 0 ? (v.secondsLeft >= 10 ? String(Math.ceil(v.secondsLeft)) : v.secondsLeft.toFixed(1).replace('.', ',')) : '';
      if (s.time.textContent !== t) s.time.textContent = t;
      if (v.ultimate && v.state !== 'cooldown' && v.state !== 'locked') s.root.classList.add('charged');
      else s.root.classList.remove('charged');
    });
  }

  /** The server refused a cast (or the mirror expects it to): shake that slot. */
  abilityDenied(slot: number): void {
    const s = this.abSlots[slot];
    if (s) replay(s.root, 'denied');
  }

  /** Ultimate charged: URGENT once (pop + notice), then RELEVANT (a short shimmer), then a quiet golden rim. */
  ultimateReady(name: string): void {
    const s = this.abSlots.find((x) => x.root.classList.contains('ult'));
    if (s) replay(s.root, 'ult-pop');
    this.notice(`SUPREMA PRONTA · ${name.toUpperCase()}`, 1.6);
    this.noticeEl.dataset.tone = 'ult';
  }

  /** Status effects on the local player (slow seconds left, 0 = none). */
  setEffects(slowSeconds: number, slowFactor: number): void {
    const on = slowSeconds > 0;
    this.slowChip.hidden = !on;
    if (on) this.slowChip.textContent = `LENTO −${Math.round((1 - slowFactor) * 100)}% · ${slowSeconds.toFixed(1).replace('.', ',')} s`;
  }

  // ------------------------------------------------------------------------------------------------ overlays

  setDeath(show: boolean, sub = ''): void {
    this.deathEl.hidden = !show;
    this.deathSub.textContent = sub;
  }

  setResults(r: ResultsView | null): void {
    this.resultsEl.hidden = !r;
    if (!r) return;
    const title = r.draw ? 'EMPATE' : r.victory ? 'VITÓRIA!' : 'DERROTA';
    const sub = r.draw ? 'Ninguém ficou de pé' : r.victory ? 'Você foi o último de pé' : `${r.winnerName} venceu a partida`;
    const acc = r.shots > 0 ? Math.round((100 * r.hits) / r.shots) : 0;
    this.resultsEl.dataset.tone = r.draw ? 'neutral' : r.victory ? 'good' : 'bad';
    this.resultsEl.innerHTML = '';
    el('div', 'results-title', this.resultsEl, title);
    el('div', 'results-sub', this.resultsEl, sub);
    const grid = el('div', 'results-grid', this.resultsEl);
    for (const [k, v] of [
      ['Eliminações', String(r.kills)],
      ['Dano causado', String(Math.round(r.damage))],
      ['Precisão', `${acc}%`],
    ] as const) {
      const c = el('div', 'results-cell', grid);
      el('div', 'results-v', c, v);
      el('div', 'results-k', c, k);
    }
    el('div', 'results-foot', this.resultsEl, `De volta ao aquecimento em ${Math.max(0, r.secondsLeft)} s`);
  }

  update(dt: number): void {
    if (this.placeTimer > 0) {
      this.placeTimer -= dt;
      if (this.placeTimer <= 0) this.placeEl.style.opacity = '0';
    }
    if (this.noticeTimer > 0) {
      this.noticeTimer -= dt;
      if (this.noticeTimer <= 0) this.noticeEl.hidden = true;
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.hidden = true;
    }
  }
}
