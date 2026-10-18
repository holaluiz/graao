/**
 * Combat HUD (DOM/CSS/SVG, never rendered into Three.js). Driven by the CombatDirector; it never decides gameplay.
 *
 *   bottom-left   Fôlego bubbles (only under water / catching breath), Escudo / Vida / Mana (+ status chips: LENTO)
 *   bottom-centre ability slots 1 2 3 + Ultimate 4: icon (shape per ability), Mana cost, cooldown sweep
 *   bottom-right  E / Q weapon slots (rarity mark, magazine · reserve, reload progress); above them the
 *                 consumable belt Z / X / C and the pickup feed (LootHud)
 *   centre-low    interaction prompt [F], the weapon replacement card, the use bar (LootHud)
 *   centre        reticle per weapon profile (spread, blocked shot), hitmarkers by hit kind, damage direction arcs
 *   top           place name, match status chip, room code, kill feed
 *   overlays      countdown / banners, elimination screen (the results card is its own screen: ResultsScreen)
 *   deploy        UFO / drop panel (bottom-centre): what to do, the jump key, the window bar, the altitude; combat
 *                 widgets hide while aboard and falling (`setMode`)
 *   tormenta      top-left card (phase pips, what it does now, the clock, the damage outside) over the planet map
 *                 (TormentaMap: safe region, Tormenta, next region around the player); under the status chip the way
 *                 back (arrow + metres) when outside the safe region or the region it closes onto; the screen edges
 *                 lose their pigment the deeper the player is in it (`setTormenta`, `tormentaHurt`)
 *
 * Attention: QUIET (static), RELEVANT (brief motion), URGENT (pulse once), CRITICAL (low health, persistent).
 * Every hit kind has its own shape, not only a color.
 */
import type { AbilityIcon } from '@graao/game-data';
import { HitKind } from '@graao/shared';
import { ABILITY_ICONS } from './abilityIcons';
import { TormentaMap, type TormentaMapView } from './TormentaMap';
import '../styles/tormenta.css';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The reticle follows the spread cone at this fraction of its true screen size: it still opens and closes with the
 *  weapon, aiming and bloom, but stays compact (the full cone of the Rajada de Pétalas covered a big slice of the screen). */
const RETICLE_SCALE = 0.35;

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
  /** Rounds left in the reserve of this weapon's ammunition. */
  reserve: number;
  /** Rarity colour and symbol (never colour alone); absent for an empty slot. */
  rarity?: { color: string; symbol: string; name: string };
  empty?: boolean;
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

/** UFO deployment panel (aboard, falling, landed). */
export interface DeployView {
  title: string;
  line: string;
  /** Key cap and what it does (the jump while aboard). */
  key?: string;
  keyLabel?: string;
  /** 0..1 of the jump window still open. */
  progress?: number;
  /** Metres above the ground (falling). */
  altitude?: number;
  tone: 'quiet' | 'relevant' | 'urgent';
}

/** The Tormenta as the HUD shows it (the TormentaDirector mirrors the server's phase; the HUD never decides). */
export interface TormentaView {
  stage: 'hold' | 'shrink' | 'final';
  /** Phase 1..n; n + 1 = the final region. */
  phase: number;
  phases: number;
  /** Seconds until it starts moving (hold) or stops (shrink); -1 in the final region. */
  seconds: number;
  /** 0..1 of the current hold or reduction done. */
  progress: number;
  /** Health per second outside the safe region now. */
  dps: number;
  /** Show the way back (alive and taking part). */
  guide: boolean;
  /** The local player is outside the safe region now. */
  outside: boolean;
  /** Metres to the safe region (outside) and to the region it closes onto (> 0 = outside it). */
  edge: number;
  nextEdge: number;
  /** Screen angle (rad) toward the region to reach: 0 straight ahead, + to the right. */
  arrow: number;
  /** 0..1: how deep in the Tormenta (screen edges lose their pigment). */
  depth: number;
  /** The planet map around the player (shown with the way back: alive and taking part). */
  map: TormentaMapView | null;
}

/** A ring torn on its outer edge: the Tormenta's glyph (shape, not colour). */
function tornRing(): string {
  let d = '';
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    const r = i % 2 ? 13.5 : 10.5 + (i % 3) * 0.6;
    d += `${i ? 'L' : 'M'}${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)} `;
  }
  return `${d}Z`;
}

const clock = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

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
    '<g class="ticks"><rect class="t t-up" x="-1.5" y="-12" width="3" height="7" rx="1.5"/><rect class="t t-down" x="-1.5" y="5" width="3" height="7" rx="1.5"/>' +
      '<rect class="t t-left" x="-12" y="-1.5" width="7" height="3" rx="1.5"/><rect class="t t-right" x="5" y="-1.5" width="7" height="3" rx="1.5"/></g><circle class="dot" r="1.8"/>',
  );
  private readonly reticleCircle = svg('reticle circle', '-50 -50 100 100', '<circle class="ring" r="8"/><circle class="dot" r="1.8"/>');
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
  /** Breath under water: a row of bubbles over the vitals that pop as the air runs out. */
  private readonly breathEl = el('div', 'breath');
  private readonly breathBubbles: HTMLElement[] = [];
  private lastBreath = -2;

  // Abilities.
  private readonly abilitiesEl = el('div', 'abilities', this.el);
  private readonly abSlots: { root: HTMLElement; icon: SVGSVGElement; sweep: HTMLElement; time: HTMLElement; cost: HTMLElement; name: HTMLElement; key: HTMLElement; last: string }[] = [];

  // Weapons.
  private readonly weaponsEl = el('div', 'weapons', this.el);
  private readonly slots: { root: HTMLElement; name: HTMLElement; ammo: HTMLElement; fill: HTMLElement; key: HTMLElement; rarity: HTMLElement; last: string }[] = [];
  private readonly ammoHint = el('div', 'ammo-hint', this.el);

  // Overlays.
  private readonly deathEl = el('div', 'death', this.el);
  private readonly deathTitle = el('div', 'death-title', this.deathEl, 'ELIMINADO');
  private readonly deathSub = el('div', 'death-sub', this.deathEl);
  private readonly lowHealthEl = el('div', 'low-health', this.el);
  private readonly deployEl = el('div', 'deploy', this.el);
  private readonly deployTitle = el('div', 'deploy-title', this.deployEl);
  private readonly deployRow = el('div', 'deploy-row', this.deployEl);
  private readonly deployKey = el('div', 'deploy-key', this.deployRow);
  private readonly deployKeyLabel = el('div', 'deploy-key-label', this.deployRow);
  private readonly deployLine = el('div', 'deploy-line', this.deployEl);
  private readonly deployBar = el('div', 'deploy-bar', this.deployEl);
  private readonly deployFill = el('i', '', this.deployBar);
  private readonly altimeter = el('div', 'altimeter', this.el);
  private readonly altFill = el('i', '', this.altimeter);
  private lastDeploy = '';

  // Tormenta.
  private readonly tormEdge = el('div', 'torm-edge', this.el);
  // The way back comes before the column in the DOM: narrow screens hide the map while it shows (tormenta.css).
  private readonly outEl = el('div', 'torm-out', this.el);
  private readonly tormCol = el('div', 'torm-col', this.el);
  private readonly tormEl = el('div', 'tormenta', this.tormCol);
  private readonly tormMap = new TormentaMap();
  private readonly tormHead = el('div', 'torm-head', this.tormEl);
  private readonly tormPips = el('div', 'torm-pips');
  private readonly tormState = el('div', 'torm-state', this.tormEl);
  private readonly tormTime = el('div', 'torm-time', this.tormEl);
  private readonly tormBar = el('div', 'torm-bar', this.tormEl);
  private readonly tormFill = el('i', '', this.tormBar);
  private readonly tormRate = el('div', 'torm-rate', this.tormEl);
  private readonly outArrow = svg('torm-arrow', '-20 -20 40 40', '<path d="M0 -16 L12 4 L4 1.5 L4 15 L-4 15 L-4 1.5 L-12 4 Z"/>');
  private readonly outText = el('div', 'torm-out-text');
  private readonly outTitle = el('div', 'torm-out-title', this.outText);
  private readonly outLine = el('div', 'torm-out-line', this.outText);
  private lastTorm = '';
  private lastTormTime = '';
  private lastOut = '';

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
    this.noticeEl.hidden = true;
    this.ammoHint.hidden = true;
    this.slowChip.hidden = true;
    this.deployEl.hidden = true;
    this.altimeter.hidden = true;
    this.tormHead.append(svg('torm-icon', '-16 -16 32 32', `<path class="torn" d="${tornRing()}"/><circle class="safe" r="5.5"/>`), el('span', 'torm-title', undefined, 'TORMENTA'), this.tormPips);
    this.outEl.append(this.outArrow, this.outText);
    this.tormCol.append(this.tormMap.el);
    this.tormEl.hidden = true;
    this.tormMap.el.hidden = true;
    this.outEl.hidden = true;
    this.el.dataset.mode = 'combat';
    el('div', 'vbar-label', this.breathEl, 'Fôlego');
    const bubbles = el('div', 'breath-bubbles', this.breathEl);
    for (let i = 0; i < 10; i++) this.breathBubbles.push(el('i', 'bubble', bubbles));
    this.vitals.prepend(this.breathEl);
    this.breathEl.hidden = true;
    for (let i = 0; i < 2; i++) {
      const root = el('div', 'slot', this.weaponsEl);
      const key = el('div', 'slot-key', root);
      const head = el('div', 'slot-head', root);
      const rarity = el('span', 'slot-rarity', head);
      const name = el('span', 'slot-name', head);
      const ammo = el('div', 'slot-ammo', root);
      const track = el('div', 'slot-reload', root);
      const fill = el('i', '', track);
      this.slots.push({ root, name, ammo, fill, key, rarity, last: '' });
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

  /** Combat widgets (vitals, weapons, abilities, reticle) hide aboard the UFO and during the drop. */
  setMode(mode: 'combat' | 'ufo' | 'drop'): void {
    this.el.dataset.mode = mode;
  }

  /** The UFO / drop panel; null hides it. */
  setDeploy(v: DeployView | null): void {
    this.deployEl.hidden = !v;
    this.altimeter.hidden = !v || v.altitude === undefined;
    if (!v) {
      this.lastDeploy = '';
      return;
    }
    const key = `${v.title}|${v.line}|${v.key ?? ''}|${v.tone}`;
    if (key !== this.lastDeploy) {
      const titleChanged = !this.lastDeploy.startsWith(`${v.title}|`);
      this.lastDeploy = key;
      this.deployTitle.textContent = v.title;
      this.deployLine.textContent = v.line;
      this.deployRow.hidden = !v.key;
      this.deployKey.textContent = v.key ?? '';
      this.deployKeyLabel.textContent = v.keyLabel ?? '';
      this.deployEl.dataset.tone = v.tone;
      if (titleChanged && v.tone !== 'quiet') replay(this.deployEl, 'pop');
    }
    this.deployBar.hidden = v.progress === undefined;
    if (v.progress !== undefined) this.deployFill.style.width = `${Math.max(0, Math.min(1, v.progress)) * 100}%`;
    // Altimeter: a vertical gauge on the right, 100 m full scale.
    if (v.altitude !== undefined) this.altFill.style.height = `${Math.max(0, Math.min(1, v.altitude / 100)) * 100}%`;
  }

  // ------------------------------------------------------------------------------------------------ tormenta

  /**
   * The Tormenta card, the way back and the pigment-loss edge; null hides all of it. Attention: the card is QUIET while
   * it holds, RELEVANT while it closes (striped bar) and in the last seconds of a hold; being outside is URGENT (the
   * strip pulses once) and CRITICAL when deep inside (the edge). Every state has its own words and shapes.
   */
  setTormenta(v: TormentaView | null): void {
    this.tormEl.hidden = !v;
    this.tormMap.el.hidden = !v?.map;
    if (v?.map) this.tormMap.update(v.map);
    if (!v) {
      this.outEl.hidden = true;
      this.tormEdge.style.opacity = '0';
      this.lastTorm = this.lastTormTime = this.lastOut = '';
      return;
    }
    const key = `${v.phase}|${v.phases}|${v.stage}`;
    if (key !== this.lastTorm) {
      const first = this.lastTorm === '';
      this.lastTorm = key;
      this.tormEl.dataset.stage = v.stage;
      this.tormState.textContent = v.stage === 'final' ? 'ÁREA FINAL · não recua mais' : v.stage === 'shrink' ? `FASE ${v.phase} DE ${v.phases} · AVANÇANDO` : `FASE ${v.phase} DE ${v.phases} · avança em`;
      // Pips: done (filled), this phase (outlined, pulsing while it closes), still to come (small).
      this.tormPips.replaceChildren(
        ...Array.from({ length: v.phases }, (_, i) => el('i', i + 1 < v.phase || v.stage === 'final' ? 'done' : i + 1 === v.phase ? 'now' : '')),
      );
      if (!first) replay(this.tormEl, 'torm-pop');
    }
    const time = v.seconds >= 0 ? clock(v.seconds) : '—';
    if (time !== this.lastTormTime) {
      this.lastTormTime = time;
      this.tormTime.textContent = time;
    }
    const soon = v.stage === 'hold' && v.seconds <= 10;
    this.tormEl.dataset.tone = v.outside ? 'urgent' : v.stage === 'shrink' || soon ? 'relevant' : 'quiet';
    this.tormBar.hidden = v.stage === 'final';
    this.tormFill.style.width = `${(Math.max(0, Math.min(1, v.progress)) * 100).toFixed(1)}%`;
    this.tormRate.textContent = v.dps > 0 ? `Fora da área: −${v.dps} Vida/s` : 'Fora da área: sem dano ainda';

    // The way back: outside now (URGENT), or outside the region it is about to close onto (RELEVANT).
    const mode = !v.guide ? '' : v.outside ? 'out' : v.nextEdge > 0 && v.stage !== 'final' ? 'next' : '';
    this.outEl.hidden = !mode;
    if (mode) {
      const metres = Math.max(1, Math.ceil(mode === 'out' ? v.edge : v.nextEdge));
      const title = mode === 'out' ? 'FORA DA ÁREA SEGURA' : 'FORA DA PRÓXIMA ÁREA';
      const line = mode === 'out' ? `${metres} m até a área · −${v.dps} Vida/s` : `${metres} m · siga a seta antes que feche`;
      if (this.outTitle.textContent !== title) this.outTitle.textContent = title;
      if (this.outLine.textContent !== line) this.outLine.textContent = line;
      if (mode !== this.lastOut) {
        this.outEl.dataset.tone = mode === 'out' ? 'urgent' : 'relevant';
        replay(this.outEl, 'pop');
      }
      this.outArrow.style.transform = `rotate(${v.arrow.toFixed(3)}rad)`;
    }
    this.lastOut = mode;
    this.tormEdge.style.opacity = (Math.max(0, Math.min(1, v.depth)) * 0.9).toFixed(3);
    this.tormEdge.classList.toggle('deep', v.depth > 0.7);
  }

  /** The Tormenta took Health from the local player: the strip and the edge flinch, a "−N" floats off. */
  tormentaHurt(amount: number): void {
    replay(this.tormEdge, 'hurt');
    if (this.outEl.hidden) return;
    replay(this.outEl, 'hurt');
    const n = el('div', 'torm-hit', this.outEl, `−${amount}`);
    setTimeout(() => n.remove(), 800);
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
    const s = Math.max(0, spreadPx) * RETICLE_SCALE;
    this.reticleCross.style.setProperty('--spread', `${s}px`);
    // The ring follows the cone; its radius changes (not a scale), so the stroke stays thin at any spread.
    this.reticleCircle.style.setProperty('--ring', `${Math.max(8, s)}px`);
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

  /** Air left under water (0..1); null hides the meter (head out of the water and lungs full). */
  setBreath(frac: number | null): void {
    // Redraw only when a bubble visibly changes (twentieths).
    const key = frac === null ? -1 : Math.ceil(Math.max(0, Math.min(1, frac)) * 20);
    if (key === this.lastBreath) return;
    this.lastBreath = key;
    this.breathEl.hidden = frac === null;
    if (frac === null) return;
    const n = this.breathBubbles.length;
    this.breathBubbles.forEach((b, i) => {
      const fill = Math.max(0, Math.min(1, key / 20 * n - i));
      b.classList.toggle('gone', fill <= 0);
      b.style.transform = fill > 0 ? `scale(${(0.45 + 0.55 * fill).toFixed(2)})` : '';
    });
    this.breathEl.classList.toggle('low', key <= 6 && key > 0);
    this.breathEl.classList.toggle('out', key <= 0);
  }

  setWeapons(active: number, slots: WeaponSlotView[], reload: number): void {
    slots.forEach((s, i) => {
      const v = this.slots[i]!;
      const key = `${i === active}|${s.key}|${s.name}|${s.ammo}|${s.reserve}|${s.rarity?.name}|${s.empty}`;
      if (key !== v.last) {
        // A new weapon in this slot: a short pop so the change reads.
        if (v.last && v.name.textContent !== s.name) replay(v.root, 'fresh');
        v.last = key;
        v.root.classList.toggle('active', i === active && !s.empty);
        v.root.classList.toggle('empty', !!s.empty);
        v.key.textContent = s.key;
        v.name.textContent = s.empty ? 'vazio' : s.name;
        v.rarity.textContent = s.rarity?.symbol ?? '';
        v.rarity.title = s.rarity?.name ?? '';
        v.root.style.setProperty('--rarity', s.rarity?.color ?? 'transparent');
        v.ammo.innerHTML = s.empty ? '<small>pegue uma arma</small>' : `${s.ammo}<small> / ${s.reserve}</small>`;
        v.root.classList.toggle('dry', !s.empty && s.ammo === 0);
      }
      v.fill.style.width = i === active && reload >= 0 ? `${reload * 100}%` : '0%';
    });
    const a = slots[active];
    const dry = !!a && !a.empty && a.ammo === 0 && reload < 0;
    this.ammoHint.hidden = !(dry || reload >= 0);
    this.ammoHint.textContent = reload >= 0 ? 'RECARREGANDO…' : a && a.reserve <= 0 ? 'SEM MUNIÇÃO · procure caixas de munição' : 'SEM MUNIÇÃO · R';
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
    this.notice(`SUPREMO PRONTO · ${name.toUpperCase()}`, 1.6);
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
