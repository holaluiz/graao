/** Bot intent only; the room still validates movement, ammo, line of sight and damage. */
import { northTangent, type CharacterState } from '@graao/game-core';
import { InputButton, v3cross, v3normalize, v3projectOnPlane, type Vec3 } from '@graao/shared';

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
