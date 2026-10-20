/** Bot intent only; the room still validates movement, ammo, line of sight and damage. */
import { TraversalMode } from '@graao/game-data';
import { northTangent, type CharacterState, type WindVolume } from '@graao/game-core';
import { InputButton, v3cross, v3len, v3normalize, v3projectOnPlane, type Vec3 } from '@graao/shared';
import type { NavStep } from './BotNav';

export interface BotIntent {
  wish: Vec3;
  aim: Vec3;
  origin: Vec3;
  distance: number;
  buttons: number;
}

/**
 * Spherical pursuit with a little strafing and aim sway, so opponents can react. With `move` (the next point of a
 * navigation path, BotNav.ts) the bot walks there instead of straight at the target, still aiming at the target when
 * it has one in sight (`fight`), else looking where it goes. `keep` is the room it keeps from its target in a direct
 * fight (an unarmed bot passes about a metre: it has to get into punching reach).
 */
export function botIntent(state: CharacterState, target: Vec3 | undefined, index: number, now: number, blocked = false, move: Vec3 | null = null, fight = true, keep = 6): BotIntent {
  const up = v3normalize(state.pos);
  const origin = { x: state.pos.x + up.x * 1.6, y: state.pos.y + up.y * 1.6, z: state.pos.z + up.z * 1.6 };
  const time = now / 1000;
  if (move) {
    const to = v3projectOnPlane({ x: move.x - state.pos.x, y: move.y - state.pos.y, z: move.z - state.pos.z }, up);
    const wish = Math.hypot(to.x, to.y, to.z) > 1e-4 ? v3normalize(to) : { x: 0, y: 0, z: 0 };
    const distance = target ? Math.hypot(target.x - state.pos.x, target.y - state.pos.y, target.z - state.pos.z) : Infinity;
    const aimAt = target && fight ? target : null;
    const aim = aimAt
      ? v3normalize({ x: aimAt.x + v3normalize(aimAt).x * 1.0 - origin.x, y: aimAt.y + v3normalize(aimAt).y * 1.0 - origin.y, z: aimAt.z + v3normalize(aimAt).z * 1.0 - origin.z })
      : Math.hypot(wish.x, wish.y, wish.z) > 0.5 ? wish : state.facing;
    let buttons = aimAt && distance < 30 ? InputButton.AIM : InputButton.SPRINT;
    if ((blocked || state.swimming) && Math.floor(time * 2 + index) % 4 === 0) buttons |= InputButton.JUMP;
    return { wish, aim, origin, distance, buttons };
  }
  if (!target) return { wish: { x: 0, y: 0, z: 0 }, aim: state.facing, origin, distance: Infinity, buttons: 0 };
  const targetUp = v3normalize(target);
  const toward = { x: target.x - state.pos.x, y: target.y - state.pos.y, z: target.z - state.pos.z };
  const distance = Math.hypot(toward.x, toward.y, toward.z);
  const projected = v3projectOnPlane(toward, up);
  const forward = Math.hypot(projected.x, projected.y, projected.z) > 1e-5 ? v3normalize(projected) : northTangent(up);
  const right = v3normalize(v3cross(forward, up));
  // Seek at range; keep a few metres of room near the target and strafe to avoid stacking.
  const advance = state.diving || distance > Math.max(15, keep + 4) ? 1 : distance < keep ? -0.65 : keep < 3 ? 1 : 0.15;
  const strafe = blocked ? (index % 2 ? 1.5 : -1.5) : Math.sin(time * 0.8 + index * 2.1) * (keep < 3 ? 0.2 : 0.6);
  const wish = v3normalize({ x: forward.x * advance + right.x * strafe, y: forward.y * advance + right.y * strafe, z: forward.z * advance + right.z * strafe });
  // Aim around the chest. A modest fixed sway keeps the bot from being a perfect tracking turret.
  const sway = Math.sin(time * 2.3 + index * 1.7) * Math.min(1.1, distance * 0.025);
  const aim = v3normalize({ x: target.x + targetUp.x * 1.0 + right.x * sway - origin.x, y: target.y + targetUp.y * 1.0 + right.y * sway - origin.y, z: target.z + targetUp.z * 1.0 + right.z * sway - origin.z });
  let buttons = distance > 22 ? InputButton.SPRINT : InputButton.AIM;
  // Release jump between attempts: the controller uses its rising edge for double jumps.
  if ((blocked || state.swimming) && Math.floor(time * 2 + index) % 4 === 0) buttons |= InputButton.JUMP;
  return { wish, aim, origin, distance, buttons };
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * On foot a bot never steps off a drop deeper than this (m: the deepest step down of the navigation graph, nav.ts):
 * off an island, a roof or a terrace it goes only by a traversal link (a glide), never walking or fighting at the edge.
 */
export const BOT_MAX_DROP = 3.6;

/** Would a step along `wish` from `pos` (feet) go off a drop deeper than BOT_MAX_DROP (no ground there within reach)? */
export function botDropAhead(physics: { castRay(o: Vec3, d: Vec3, max: number): unknown }, pos: Vec3, wish: Vec3): boolean {
  const up = v3normalize(pos);
  const flat = v3projectOnPlane(wish, up);
  const l = v3len(flat);
  if (l < 0.1) return false;
  const k = 0.8 / l;
  const probe = { x: pos.x + up.x * 0.8 + flat.x * k, y: pos.y + up.y * 0.8 + flat.y * k, z: pos.z + up.z * 0.8 + flat.z * k };
  return !physics.castRay(probe, { x: -up.x, y: -up.y, z: -up.z }, 0.8 + BOT_MAX_DROP);
}
/** The unit tangent at `pos` toward `p` (zero when `p` is straight above or below). */
function toward(pos: Vec3, p: Vec3): Vec3 {
  const t = v3projectOnPlane({ x: p.x - pos.x, y: p.y - pos.y, z: p.z - pos.z }, v3normalize(pos));
  return v3len(t) > 1e-4 ? v3normalize(t) : { ...ZERO };
}
/** On for `on` ms of every `period` ms: a button pressed and let go, so the motor sees a fresh press each time. */
const pulse = (ms: number, period: number, on: number) => ms % period < on;

/**
 * The wish and buttons of a bot taking a traversal link (docs/world/VERTICAL_BOT_NAVIGATION.md): the inputs a person
 * would give, nothing else — the motor, allowed the link's traversal, does the climbing, the gliding and the rest.
 * - escalada: push toward the end (into the face); jump at it while pressed against it; on the face push up (the pull-up
 *   over the top follows by itself).
 * - corrente: walk into the column (holding jump when it starts below the feet: off the edge into it), jump in it and
 *   hold jump; centred in the column until high over the end, then steer to it.
 * - planagem: walk off the edge toward the landing and hold jump in the air (a jump off the edge, then the glider opens
 *   on the way down); a glide on a wind across jumps off at once (the wind needs the height). An edge met short of the
 *   top (an island's) is grabbed and pulled up onto.
 * - salto: jump toward the next footing again and again (a ledge in reach is pulled up onto).
 * Resting at the start for stamina: stand still. To the bell that wakes the link's wind and back: walk (the room rings
 * it once in reach). A link let go of on a wall or a ledge: let go (sprint).
 */
export function botLinkIntent(state: CharacterState, step: NavStep, winds: readonly WindVolume[]): { wish: Vec3; buttons: number } {
  const link = step.link;
  const mode = state.traversal;
  const onWall = mode === TraversalMode.CLIMB || mode === TraversalMode.HANG;
  if (!link) return onWall ? { wish: { ...ZERO }, buttons: InputButton.SPRINT } : { wish: { ...ZERO }, buttons: 0 };
  if (step.rest) return { wish: { ...ZERO }, buttons: 0 };
  if (step.stage) return { wish: toward(state.pos, step.point!), buttons: 0 };
  const to = step.point!;
  const ms = step.linkMs ?? 0;
  const up = v3normalize(state.pos);
  const radial = (p: Vec3) => v3len(p);
  const flatSpeed = v3len(v3projectOnPlane(state.vel, up));
  switch (link.kind) {
    case 'escalada': {
      if (onWall) return { wish: { ...state.facing }, buttons: 0 };
      const wish = toward(state.pos, to);
      // Jump only while pressed against the face (jumping short of it lands back at the start: a miss).
      const pressed = state.grounded && mode === TraversalMode.NONE && flatSpeed < 0.6 && ms > 250;
      return { wish, buttons: pressed && pulse(ms, 600, 120) ? InputButton.JUMP : 0 };
    }
    case 'corrente': {
      const w = winds[link.wind];
      if (!w) return { wish: toward(state.pos, to), buttons: InputButton.JUMP };
      const off = v3projectOnPlane({ x: state.pos.x - w.base.x, y: state.pos.y - w.base.y, z: state.pos.z - w.base.z }, w.axis);
      const d = v3len(off);
      const centre = d > 1e-3 ? { x: -off.x / d, y: -off.y / d, z: -off.z / d } : { ...ZERO };
      if (!state.grounded) {
        // High enough over the end: steer to it; until then stay in the column (the wind rises, the kite holds).
        if (radial(state.pos) > radial(to) + 2.5) return { wish: toward(state.pos, to), buttons: InputButton.JUMP };
        const k = d > w.radius * 0.35 ? 0.6 : 0;
        return { wish: { x: centre.x * k, y: centre.y * k, z: centre.z * k }, buttons: InputButton.JUMP };
      }
      const inColumn = d < w.radius * 0.5;
      // A column that starts under the feet (beside an island's edge) is entered from the air: off the edge holding jump.
      const below = radial(w.base) < radial(state.pos) - 0.8;
      if (!inColumn) return { wish: centre, buttons: below ? InputButton.JUMP : 0 };
      return { wish: { ...ZERO }, buttons: pulse(ms, 400, 200) ? InputButton.JUMP : 0 };
    }
    case 'planagem':
      // A jump straight from the start lands back on it (a miss) unless a wind carries it; off the edge it opens the kite.
      return { wish: toward(state.pos, to), buttons: !state.grounded || link.wind >= 0 ? InputButton.JUMP : 0 };
    case 'salto':
      if (onWall) return { wish: { ...state.facing }, buttons: 0 };
      return { wish: toward(state.pos, to), buttons: state.grounded && ms > 60 && pulse(ms, 450, 100) ? InputButton.JUMP : 0 };
  }
}

