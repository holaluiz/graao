/**
 * ProgressionDirector (client): mirrors the local player's in-match level, XP and attribute points from SELF and
 * PROGRESS, runs the attribute panel (P, then 1–5 or a click / tap) and presents XP gains and level-ups (local and
 * remote). Spending a point is a request (ALLOCATE_STAT): the server decides and SELF brings the result. The panel
 * never pauses the match.
 */
import * as THREE from 'three';
import { ATTRIBUTES, CREEPS, CREEP_TYPE_IDS, STATS, STAT_IDS, STAT_RULES, xpRequiredForNextLevel } from '@graao/game-data';
import { statModifiers, type StatModifiers } from '@graao/game-core';
import { MatchPhase, type GameEvent, type ProgressMsg, type SelfStatusMsg } from '@graao/shared';
import type { GraaoApp } from '../app/GraaoApp';
import { Shape } from '../render/vfx/GRAVFXSystem';
import { ProgressionHud } from '../ui/ProgressionHud';
import { keyLabel } from './KeyBindings';

/** With the panel open, the ability keys (1–4 by default) and 5 spend points instead of casting. */
const PICK_ACTIONS = ['ability1', 'ability2', 'ability3', 'ultimate', 'stat5'] as const;

export class ProgressionDirector {
  readonly hud = new ProgressionHud();
  level = 1;
  cur = 0;
  next = xpRequiredForNextLevel(1);
  points = 0;
  stats: number[] = STAT_IDS.map(() => 0);
  mods: StatModifiers = statModifiers({ stats: this.stats });
  maxHealth: number = ATTRIBUTES.maxHealth;
  maxMana: number = ATTRIBUTES.maxMana;
  open = false;
  private seq = 0;
  private online = false;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(private readonly app: GraaoApp) {
    // The level strip is the last row of the vitals block; the panel floats right above the block.
    app.hud.vitalsEl.append(this.hud.el, this.hud.panel);
    this.hud.onPick = (k) => this.allocate(k);
    this.hud.onToggle = () => this.toggle();
  }

  /** Entering the world (solo offline has no progression: the strip stays hidden). */
  enter(online: boolean): void {
    this.online = online;
    this.reset();
  }

  reset(): void {
    this.level = 1;
    this.cur = 0;
    this.next = xpRequiredForNextLevel(1);
    this.points = 0;
    this.stats = STAT_IDS.map(() => 0);
    this.mods = statModifiers({ stats: this.stats });
    this.maxHealth = ATTRIBUTES.maxHealth;
    this.maxMana = ATTRIBUTES.maxMana;
    this.open = false;
    this.app.combat.melee.intervalMs = this.mods.meleeIntervalMs;
    this.app.combat.weapon.attackSpeed = 1;
  }

  /** The panel owns keys 1–5 while it is open (abilities do not fire meanwhile). */
  get panelOpen(): boolean {
    return this.open;
  }

  private get allowed(): boolean {
    const c = this.app.combat;
    return this.online && c.alive && (c.phase === MatchPhase.MATCH || c.phase === MatchPhase.FREE_ROAM);
  }

  toggle(): void {
    if (!this.allowed) {
      this.open = false;
      return;
    }
    this.open = !this.open;
    this.app.audio.play('ui.click');
  }

  /** Call before the abilities read their keys this frame. */
  update(): void {
    const input = this.app.input;
    if (input.consume('stats')) this.toggle();
    if (this.open && !this.allowed) this.open = false;
    if (this.open) {
      PICK_ACTIONS.forEach((a, k) => {
        if (input.consume(a)) this.allocate(k);
      });
    }
    this.hud.el.hidden = !this.online;
    this.hud.set({
      level: this.level, cur: this.cur, next: this.next, points: this.points, stats: this.stats, open: this.open, key: keyLabel(input.keyFor('stats')),
      rowKeys: [keyLabel(input.keyFor('ability1')), keyLabel(input.keyFor('ability2')), keyLabel(input.keyFor('ability3')), keyLabel(input.keyFor('ultimate')), '5'],
    });
  }

  /** Per frame (HUD timers). */
  tick(dt: number): void {
    this.hud.update(dt);
  }

  allocate(k: number): void {
    if (!this.allowed) return;
    if (this.points <= 0) {
      this.app.audio.play('ab.denied');
      this.app.hud.notice('SEM PONTOS · derrote criaturas para subir de nível', 1.4);
      return;
    }
    const id = STAT_IDS[k];
    if (!id) return;
    // The server refuses a full attribute too; saying it here saves the round trip.
    if ((this.stats[k] ?? 0) >= STAT_RULES.maxPerStat) {
      this.app.audio.play('ab.denied');
      this.app.hud.notice(`${STATS[id].name} NO MÁXIMO (${STAT_RULES.maxPerStat})`, 1.2);
      return;
    }
    this.seq = (this.seq + 1) & 0x7fffffff;
    this.app.net?.sendAllocate(this.seq, k);
    this.app.audio.play('ui.ready');
    this.hud.spent(k);
  }

  onSelf(s: SelfStatusMsg): void {
    if (s.prog) [this.level, this.cur, this.next, this.points] = s.prog;
    if (s.stats) {
      this.stats = [...s.stats];
      this.mods = statModifiers({ stats: this.stats });
      // Velocidade de Ataque: the punch interval and the weapons' fire rate the client predicts (the server's numbers).
      this.app.combat.melee.intervalMs = this.mods.meleeIntervalMs;
      this.app.combat.weapon.attackSpeed = this.mods.attackSpeed;
    }
    if (s.maxHealth) this.maxHealth = s.maxHealth;
    if (s.maxMana) this.maxMana = s.maxMana;
    if (this.points <= 0 && this.open) this.open = false;
  }

  /** XP just earned (private). */
  onProgress(m: ProgressMsg): void {
    const type = CREEP_TYPE_IDS[m.creep];
    this.hud.gain(m.xp, type ? CREEPS[type].name : '');
    this.app.audio.play('xp', { pitch: m.last ? 1 : 0.9 });
    this.level = m.level;
    this.cur = m.cur;
    this.next = m.next;
    this.points = m.points;
    if (m.up > 0) this.levelUp(m.level, m.up);
  }

  /** Our level-up: a small card by the XP bar (never a banner across the fight), the fanfare and a golden swirl. */
  private levelUp(level: number, gained: number): void {
    this.hud.levelUp(level, gained, keyLabel(this.app.input.keyFor('stats')));
    this.app.audio.play('levelup');
    this.burst(this.app.local.state.pos);
  }

  /** Someone reached a level (public): a golden swirl around them. The local one is presented by PROGRESS. */
  onLevel(e: Extract<GameEvent, { e: 'lvl' }>): void {
    if (e.target === this.app.net?.myIndex) return;
    const r = this.app.net?.remote(e.target);
    if (r) this.burst(r.pos);
  }

  private burst(feet: { x: number; y: number; z: number }): void {
    const vfx = this.app.vfx;
    const up = this.tmp.set(feet.x, feet.y, feet.z).normalize();
    const at = this.tmp2.set(feet.x, feet.y, feet.z).addScaledVector(up, 0.2);
    vfx.ring(at, '#ffd36e', 2.6, 0.7);
    at.addScaledVector(up, 0.9);
    vfx.burst(at, up, { color: '#ffe9a8', count: 22, speed: 3.6, size: 0.14, life: 1.0, gravity: -1.5, drag: 1.8, spread: 1.2, shape: Shape.SPARK, category: 'GameplayCritical' });
    vfx.burst(at, up, { color: '#fff6d6', count: 10, speed: 1.4, size: 0.2, life: 1.2, gravity: -2.2, drag: 1.2, spread: 2.4, shape: Shape.PETAL, category: 'GameplayCritical' });
  }
}
