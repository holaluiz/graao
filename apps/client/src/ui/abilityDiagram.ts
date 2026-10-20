/**
 * A small schematic of an ability for the Draft's detail panel: shapes and labels come from the numbers in the
 * canonical catalog, drawn to scale where a distance matters. It never simulates anything — a short CSS loop (see
 * `draft.css`, `.dg-anim-*`) is the only motion.
 */
import type { AbilityDefinition, AbilityEffect, PassiveDefinition } from '@graao/game-data';
import { num } from './abilityFacts';

const W = 240;
const H = 96;
const Y = 50;
/** Caster position for directional/point abilities (top view). */
const X0 = 24;
/** Longest drawable distance from the caster (px). */
const L = 200;
const GROUND = 84;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (n: number) => String(Math.round(n * 10) / 10);
const text = (x: number, y: number, label: string, anchor: 'start' | 'middle' | 'end' = 'middle') =>
  `<text class="dg-label" x="${f(x)}" y="${f(y)}" text-anchor="${anchor}">${esc(label)}</text>`;
const me = (x: number, y: number) => `<g class="dg-me"><circle cx="${f(x)}" cy="${f(y)}" r="6.5"/><path d="M${f(x + 6.5)} ${f(y)}h5"/></g>`;
const foe = (x: number, y: number) => `<circle class="dg-foe" cx="${f(x)}" cy="${f(y)}" r="5.5"/>`;
const path = (x1: number, y1: number, x2: number, y2: number) => `<line class="dg-path" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
const ring = (x: number, y: number, r: number, cls: string) => `<circle class="${cls}" cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/>`;
const arrows = (x: number, y: number, r: number) => [0, 90, 180, 270].map((a) => {
  const c = Math.cos((a + 45) * Math.PI / 180);
  const s = Math.sin((a + 45) * Math.PI / 180);
  return `<path class="dg-push" d="M${f(x + c * r * 0.45)} ${f(y + s * r * 0.45)}L${f(x + c * r * 0.95)} ${f(y + s * r * 0.95)}"/>`;
}).join('');
const pluses = (x: number, y: number, r: number) => [[-0.4, -0.3], [0.35, -0.4], [0.1, 0.45]].map(([dx, dy]) =>
  `<path class="dg-plus" d="M${f(x + dx! * r - 3)} ${f(y + dy! * r)}h6M${f(x + dx! * r)} ${f(y + dy! * r - 3)}v6"/>`).join('');

/** Ground-level effects drawn around a centre (the zone of an area, a cloud, a trap). */
function zone(e: AbilityEffect, x: number, y: number, r: number): string {
  if (e.kind === 'cloud') return `${ring(x, y, r, 'dg-cloud')}${ring(x, y, r * 0.55, 'dg-cloud dg-anim-pulse')}`;
  if (e.kind === 'trap') return `${ring(x, y, r, 'dg-zone')}<path class="dg-spikes" d="M${f(x - r * 0.6)} ${f(y + r * 0.3)}l${f(r * 0.3)} ${f(-r * 0.8)} ${f(r * 0.3)} ${f(r * 0.8)} ${f(r * 0.3)} ${f(-r * 0.8)} ${f(r * 0.3)} ${f(r * 0.8)}"/>`;
  if (e.kind !== 'area') return '';
  let out = ring(x, y, r, 'dg-zone');
  if (e.delay > 0) out += ring(x, y, r, 'dg-warn dg-anim-warn');
  if (e.pulses > 1) out += ring(x, y, r * 0.6, 'dg-pulse dg-anim-pulse');
  if (e.effects.some((n) => n.kind === 'knockback')) out += arrows(x, y, r);
  if (e.effects.some((n) => n.kind === 'heal' || n.kind === 'shield')) out += pluses(x, y, r);
  return out;
}

function topView(def: AbilityDefinition): string | null {
  const e = def.effects[0];
  if (!e) return null;
  const at = (radius: number, range: number) => {
    // Scale so the whole zone fits: the range along the line, the radius up and down.
    const s = Math.min((L - 6) / Math.max(1, range + radius), (H / 2 - 6) / Math.max(0.5, radius));
    return { s, x: X0 + range * s, r: radius * s };
  };
  switch (e.kind) {
    case 'projectile': {
      const end = X0 + L - 8;
      const label = `${num(e.speed * e.lifetime)} m`;
      return `${path(X0 + 10, Y, end, Y)}${foe(end, Y)}${ring(end, Y, 11, 'dg-warn dg-anim-pulse')}`
        + `<circle class="dg-shot dg-anim-travel" cx="${X0 + 10}" cy="${Y}" r="3.5" style="--len:${f(end - X0 - 16)}px"/>${me(X0, Y)}${text((X0 + end) / 2, Y - 8, label)}`;
    }
    case 'area': {
      if (def.targetType === 'self' || e.follow) {
        const r = H / 2 - 8;
        return `${zone(e, W / 2, Y, r)}${me(W / 2, Y)}${text(W / 2 + r + 6, Y + 3, `${num(e.radius)} m`, 'start')}`;
      }
      const z = at(e.radius, def.range);
      const second = def.effects[1];
      const walls = second?.kind === 'barrier' ? Array.from({ length: second.count }, (_, i) => {
        const wy = Y - z.r * 0.45 + i * z.r * 0.9 / Math.max(1, second.count - 1);
        return `<rect class="dg-wall" x="${f(z.x + z.r * 0.55)}" y="${f(wy - second.width * z.s / 2)}" width="${f(Math.max(3, second.depth * z.s))}" height="${f(second.width * z.s)}"/>`;
      }).join('') : '';
      return `${path(X0 + 8, Y, z.x, Y)}${zone(e, z.x, Y, z.r)}${walls}${me(X0, Y)}${text((X0 + z.x - z.r) / 2 + 4, Y - 7, `${num(def.range)} m`)}${text(z.x, Y + z.r + 9 > H ? H - 2 : Y + z.r + 9, `raio ${num(e.radius)} m`)}`;
    }
    case 'trap': case 'cloud': {
      const z = at(e.radius, def.range);
      const blocked = e.kind === 'cloud' ? `${path(z.x + z.r + 4, Y, X0 + L, Y)}${foe(X0 + L - 4, Y)}` : foe(z.x + z.r + 12, Y + 4);
      return `${path(X0 + 8, Y, z.x - z.r, Y)}${blocked}${zone(e, z.x, Y, z.r)}${me(X0, Y)}${text((X0 + z.x - z.r) / 2 + 4, Y - 7, `${num(def.range)} m`)}${text(z.x, Math.min(H - 2, Y + z.r + 10), `raio ${num(e.radius)} m`)}`;
    }
    case 'barrier': {
      const s = Math.min((L - 40) / Math.max(1, def.range), (H - 24) / Math.max(1, e.width));
      const x = X0 + def.range * s;
      const walls = Array.from({ length: e.count }, (_, i) => {
        const offset = (i - (e.count - 1) / 2) * (e.width * s * 0.42);
        const wx = x + Math.abs(offset) * 0.35;
        return `<rect class="dg-wall dg-anim-rise" x="${f(wx)}" y="${f(Y + offset - e.width * s / 2 / Math.max(1, e.count * 0.6))}" width="${f(Math.max(3, e.depth * s * 2))}" height="${f(e.width * s / Math.max(1, e.count * 0.6))}"/>`;
      }).join('');
      const shots = [Y - 14, Y + 2, Y + 16].map((y) => `<path class="dg-shot-line" d="M${X0 + L} ${y}H${f(x + 10)}"/>`).join('');
      return `${shots}${walls}${me(X0, Y)}${text((X0 + x) / 2, Y - 8, `${num(def.range)} m`)}${text(x + 4, H - 2, `${num(e.width)} m de largura`)}`;
    }
    case 'dash': case 'mobility': {
      if (e.kind === 'mobility' && e.mode !== 'slide') return null;
      const d = e.kind === 'dash' ? e.distance : e.distance ?? 0;
      const end = X0 + L - 10;
      const ghosts = [0.33, 0.66].map((t) => `<circle class="dg-ghost" cx="${f(X0 + (end - X0) * t)}" cy="${Y}" r="6"/>`).join('');
      return `${path(X0 + 8, Y, end - 8, Y)}<path class="dg-arrow" d="M${f(end - 14)} ${Y - 6}l7 6-7 6"/>${ghosts}<g class="dg-anim-travel" style="--len:${f(end - X0)}px">${me(X0, Y)}</g>${text((X0 + end) / 2, Y - 10, `${num(d)} m`)}`;
    }
    case 'wave': {
      const s = L / Math.max(1, e.distance);
      const h = Math.min(H - 20, e.width * s);
      const chevrons = [0.25, 0.5, 0.75].map((t) => `<path class="dg-push dg-anim-travel" style="--len:${f(L * 0.2)}px" d="M${f(X0 + L * t)} ${f(Y - h / 3)}l8 ${f(h / 3)}-8 ${f(h / 3)}"/>`).join('');
      return `<rect class="dg-zone" x="${X0 + 6}" y="${f(Y - h / 2)}" width="${L - 6}" height="${f(h)}" rx="4"/>${chevrons}${me(X0, Y)}${text(X0 + L / 2, Y - h / 2 - 3, `${num(e.distance)} m`)}${text(X0 + L - 2, Y + h / 2 + 9 > H ? H - 2 : Y + h / 2 + 9, `${num(e.width)} m de largura`, 'end')}`;
    }
    case 'portal': {
      const a = X0 + 22;
      const b = X0 + L - 10;
      return `<ellipse class="dg-portal" cx="${a}" cy="${Y}" rx="5" ry="12"/><ellipse class="dg-portal dg-anim-pulse" cx="${b}" cy="${Y}" rx="5" ry="12"/><path class="dg-path" d="M${a} ${Y - 14}Q${f((a + b) / 2)} ${Y - 44} ${b} ${Y - 14}"/>${me(X0 - 6, Y)}${text((a + b) / 2, Y - 34, `até ${num(e.range)} m`)}`;
    }
    case 'frontShield': {
      const x = 92;
      const r = 32;
      const half = e.arc / 2 * Math.PI / 180;
      const arc = `M${f(x + Math.cos(-half) * r)} ${f(Y + Math.sin(-half) * r)}A${r} ${r} 0 0 1 ${f(x + Math.cos(half) * r)} ${f(Y + Math.sin(half) * r)}`;
      const shots = [Y - 16, Y, Y + 16].map((y) => `<path class="dg-shot-line" d="M${W - 6} ${y}H${f(x + Math.sqrt(Math.max(0, r * r - (y - Y) ** 2)) + 3)}"/>`).join('');
      return `${shots}<path class="dg-shield dg-anim-rise" d="${arc}"/>${me(x, Y)}${text(x, H - 4, `${num(e.arc)}°`)}`;
    }
    case 'reveal': {
      if (e.mode === 'target') return null;
      const r = H / 2 - 8;
      const cx = W / 2;
      const inside = e.mode === 'resources'
        ? [[-0.5, -0.3], [0.45, 0.25], [0.1, -0.6]].map(([dx, dy]) => `<rect class="dg-chest" x="${f(cx + dx! * r - 4)}" y="${f(Y + dy! * r - 3)}" width="8" height="6" rx="1"/>`).join('')
        : e.mode === 'trails'
          ? `<path class="dg-trail" d="M${f(cx - r * 0.8)} ${f(Y + r * 0.5)}Q${f(cx)} ${f(Y - r * 0.6)} ${f(cx + r * 0.7)} ${f(Y + r * 0.1)}"/>`
          : [-60, 20, 140].map((a) => `<path class="dg-push" d="M${f(cx + Math.cos(a * Math.PI / 180) * 10)} ${f(Y + Math.sin(a * Math.PI / 180) * 10)}L${f(cx + Math.cos(a * Math.PI / 180) * r * 0.8)} ${f(Y + Math.sin(a * Math.PI / 180) * r * 0.8)}"/>`).join('');
      const centre = e.mode === 'beacon' ? `<path class="dg-beacon" d="M${cx - 4} ${Y + 7}h8l-2-14h-4Z"/><circle class="dg-beacon" cx="${cx}" cy="${Y - 10}" r="3"/>` : me(cx, Y);
      return `${ring(cx, Y, r, 'dg-scan')}${ring(cx, Y, r, 'dg-warn dg-anim-pulse')}${inside}${centre}${text(cx + r + 6, Y + 3, `${num(e.radius)} m`, 'start')}`;
    }
    case 'temporaryShield': case 'shield': case 'heal':
      return `${ring(W / 2, Y, 22, 'dg-bubble dg-anim-pulse')}${me(W / 2, Y)}${text(W / 2, H - 4, `+${num(e.amount)}`)}`;
    case 'cleanse': case 'status': {
      const drops = [-28, -12, 12, 28].map((dx, i) => `<path class="dg-drop dg-anim-fall" style="animation-delay:${i * 0.18}s" d="M${W / 2 + dx} ${Y - 30}v8"/>`).join('');
      const speed = def.effects.some((n) => n.kind === 'status' && n.status === 'speed') ? `<path class="dg-push" d="M${W / 2 - 40} ${Y + 6}h-16M${W / 2 - 40} ${Y - 2}h-22M${W / 2 - 40} ${Y + 14}h-12"/>` : '';
      return `${drops}${speed}${me(W / 2, Y)}`;
    }
    default:
      return null;
  }
}

/** Side view for the abilities that move you up, along or away from a surface. */
function sideView(def: AbilityDefinition): string | null {
  const e = def.effects[0];
  if (e?.kind !== 'mobility' || e.mode === 'slide') return null;
  const ground = `<path class="dg-ground" d="M0 ${GROUND}H${W}"/>`;
  switch (e.mode) {
    case 'jump':
      return `${ground}<path class="dg-path" d="M30 ${GROUND - 6}Q70 18 110 40"/><path class="dg-path dg-anim-dash" d="M110 40Q140 2 175 26"/>${me(110, 40)}${text(175, 40, 'salto extra no ar')}`;
    case 'grapple': {
      const top = 22;
      return `${ground}<rect class="dg-wall" x="196" y="${top}" width="36" height="${GROUND - top}"/><path class="dg-rope" d="M40 ${GROUND - 8}L196 ${top + 4}"/><g class="dg-anim-climb">${me(40, GROUND - 8)}</g>${text(112, top + 22, `até ${num(e.surfaceRange ?? e.distance ?? 0)} m`)}`;
    }
    case 'glide':
      return `${ground}<path class="dg-path" d="M26 16Q120 30 222 ${GROUND - 8}"/><path class="dg-wing" d="M18 12l10 6 10-6"/>${me(26, 18)}${text(150, 28, `até ${num(e.duration ?? 0)} s`)}`;
    case 'flight':
      return `${ground}<path class="dg-path" d="M26 ${GROUND - 6}Q46 20 90 20H226"/><path class="dg-wing dg-anim-pulse" d="M92 8l10 10-10 10-10-10Z"/>${me(92, 20)}${text(160, 14, `até ${num(e.duration ?? 0)} s`)}`;
    case 'ricochet':
      return `${ground}<rect class="dg-wall" x="8" y="10" width="14" height="${GROUND - 10}"/><path class="dg-path" d="M34 ${GROUND - 10}Q90 10 160 24"/><path class="dg-arrow" d="M152 18l9 6-9 6"/>${me(34, GROUND - 10)}${text(30, 18, `parede a até ${num(e.surfaceRange ?? 0)} m`, 'start')}`;
  }
}

const PASSIVE_BARS: Record<PassiveDefinition['type'], { label: string; ratio: (p: PassiveDefinition) => number; delta: (p: PassiveDefinition) => string }> = {
  outOfCombatSpeed: { label: 'Corrida fora de combate', ratio: (p) => p.factor, delta: (p) => `+${num((p.factor - 1) * 100)}%` },
  weaponHandling: { label: 'Recuo e dispersão', ratio: (p) => p.factor, delta: (p) => `−${num((1 - p.factor) * 100)}%` },
  weaponSwap: { label: 'Tempo de troca de arma', ratio: (p) => p.factor, delta: (p) => `−${num((1 - p.factor) * 100)}%` },
  scavenger: { label: 'Alcance de coleta', ratio: (p) => p.factor, delta: (p) => `+${num((p.factor - 1) * 100)}%` },
  quietSteps: { label: 'Volume dos seus passos', ratio: (p) => p.factor, delta: (p) => `−${num((1 - p.factor) * 100)}%` },
  shieldRegen: { label: 'Escudo regenerado fora de combate', ratio: (p) => p.ceiling ?? 0.5, delta: (p) => `até ${num((p.ceiling ?? 0.5) * 100)}%` },
  airControl: { label: 'Controle no ar', ratio: (p) => p.factor, delta: (p) => `+${num((p.factor - 1) * 100)}%` },
  debuffResistance: { label: 'Duração de lentidões e silêncios', ratio: (p) => 1 - p.factor, delta: (p) => `−${num(p.factor * 100)}%` },
};

function passiveView(def: AbilityDefinition): string | null {
  const p = def.passive;
  if (!p) return null;
  const bar = PASSIVE_BARS[p.type];
  const ratio = bar.ratio(p);
  const unit = 150 / Math.max(1, ratio);
  const without = p.type === 'shieldRegen' ? 0 : unit;
  return `${text(12, 18, bar.label, 'start')}`
    + `${text(12, 42, 'sem', 'start')}<rect class="dg-bar-base" x="44" y="34" width="${f(Math.max(2, without))}" height="10" rx="3"/>`
    + `${text(12, 70, 'com', 'start')}<rect class="dg-bar dg-anim-grow" x="44" y="62" width="${f(unit * ratio)}" height="10" rx="3"/>`
    + text(Math.min(W - 4, 50 + unit * ratio), 70, bar.delta(p), unit * ratio > 170 ? 'end' : 'start');
}

export interface AbilityDiagram { svg: string; caption: string }

export function abilityDiagram(def: AbilityDefinition): AbilityDiagram {
  const passive = passiveView(def);
  const side = passive ? null : sideView(def);
  const top = passive || side ? null : topView(def);
  const body = passive ?? side ?? top ?? `${me(W / 2, Y)}`;
  const caption = passive ? 'Sem e com a passiva' : side ? 'Vista de lado' : 'Vista de cima';
  return {
    svg: `<svg class="dg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${caption}: ${def.name}`)}">${body}</svg>`,
    caption: `${caption} · números do catálogo`,
  };
}
